import type { AirtableRecord, AirtableTable } from "../airtable/client";
import {
  createMetaLogRecord,
  createRecordsBatch,
  listRecords,
  updateRecordsBatch,
} from "../airtable/client";
import type { FieldMapping } from "../airtable/field-map";
import {
  airtableToWebflowFieldValue,
  getAirtableImageUrl,
  getAirtableMultiImageUrls,
  webflowToAirtableFieldValue,
} from "../airtable/field-map";
import { ensureCollectionTable, updateOptionFieldChoices } from "../airtable/schema";
import {
  FIELD_LAST_SYNCED_AT,
  FIELD_WEBFLOW_CMS_STATUS,
  FIELD_WEBFLOW_CREATED_ON,
  FIELD_WEBFLOW_ITEM_ID,
  FIELD_WEBFLOW_LAST_UPDATED,
  FIELD_WEBFLOW_SLUG,
  webflowCmsStatus,
} from "../constants";
import { prepareImageForWebflow } from "../images/optimize";
import {
  archiveCollectionItem,
  createCollectionItem,
  getCollection,
  listCollectionItems,
  publishCollectionItems,
  unpublishCollectionItem,
  unarchiveCollectionItem,
  updateCollectionItem,
  type WebflowCollection,
  type WebflowItem,
} from "../webflow/client";
import { getOrCreateAssetFolder, guessFileName, uploadAsset } from "../webflow/assets";
import type { SchemaDriftChange } from "./schema-drift";
import {
  bumpAirtableCursor,
  getCollectionState,
  updateItemTimestamps,
  type SyncStateStore,
} from "./state";

export interface CollectionSyncStats {
  collectionSlug: string;
  collectionName: string;
  airtablePushed: number;
  webflowPulled: number;
  conflictsSkipped: number;
  skipped: number;
  imagesOptimized: number;
  errors: string[];
}

export interface CollectionSyncPlan {
  airtableChanges: boolean;
  webflowChanges: boolean;
  changedWebflowIds: string[];
  newWebflowIds: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

function buildWebflowIdMap(records: AirtableRecord[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rec of records) {
    const wfId = rec.fields[FIELD_WEBFLOW_ITEM_ID];
    if (wfId != null) map.set(rec.id, String(wfId).trim());
  }
  return map;
}

function recordByWebflowId(records: AirtableRecord[]): Map<string, AirtableRecord> {
  const map = new Map<string, AirtableRecord>();
  for (const rec of records) {
    const wfId = rec.fields[FIELD_WEBFLOW_ITEM_ID];
    if (wfId != null) map.set(String(wfId).trim(), rec);
  }
  return map;
}

function syncMetadataFromWebflow(item: WebflowItem): Record<string, unknown> {
  return {
    [FIELD_WEBFLOW_ITEM_ID]: item.id,
    [FIELD_WEBFLOW_SLUG]: item.fieldData.slug ?? "",
    [FIELD_WEBFLOW_LAST_UPDATED]: item.lastUpdated ?? null,
    [FIELD_WEBFLOW_CREATED_ON]: item.createdOn ?? null,
    [FIELD_WEBFLOW_CMS_STATUS]: webflowCmsStatus(item),
    [FIELD_LAST_SYNCED_AT]: nowIso(),
  };
}

function resolveReferenceLinks(
  mappings: FieldMapping[],
  recordFields: Record<string, unknown>,
  webflowIdByRecordId: Map<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const mapping of mappings) {
    if (!mapping.isReference) continue;
    const linked = recordFields[mapping.airtableName];
    if (!Array.isArray(linked)) continue;
    const wfIds = linked
      .map((recId) => webflowIdByRecordId.get(String(recId)))
      .filter((id): id is string => Boolean(id));
    if (mapping.webflowType === "Reference") {
      out[mapping.webflowSlug] = wfIds[0] ?? null;
    } else {
      out[mapping.webflowSlug] = wfIds;
    }
  }
  return out;
}

async function pushImagesToWebflow(
  ctx: {
    webflowToken: string;
    webflowSiteId: string;
    assetFolderId: string;
  },
  mappings: FieldMapping[],
  recordFields: Record<string, unknown>,
  webflowItemId: string,
): Promise<{ fieldData: Record<string, unknown>; optimized: number }> {
  const fieldData: Record<string, unknown> = {};
  let optimized = 0;

  for (const mapping of mappings) {
    if (mapping.isImage) {
      const url = getAirtableImageUrl(recordFields, mapping);
      if (!url) continue;
      try {
        const prepared = await prepareImageForWebflow(url, guessFileName(url, webflowItemId));
        if (prepared.optimized) optimized += 1;
        const uploaded = await uploadAsset(
          ctx.webflowToken,
          ctx.webflowSiteId,
          ctx.assetFolderId,
          prepared.fileName,
          prepared.bytes,
        );
        fieldData[mapping.webflowSlug] = {
          fileId: uploaded.fileId,
          url: uploaded.url,
          alt: mapping.airtableName,
        };
      } catch (err) {
        console.warn(`Image upload failed for ${mapping.webflowSlug}:`, err);
      }
      continue;
    }

    if (mapping.isMultiImage) {
      const urls = getAirtableMultiImageUrls(recordFields, mapping);
      const images: unknown[] = [];
      for (let i = 0; i < urls.length; i++) {
        try {
          const prepared = await prepareImageForWebflow(urls[i], guessFileName(urls[i], `${webflowItemId}-${i}`));
          if (prepared.optimized) optimized += 1;
          const uploaded = await uploadAsset(
            ctx.webflowToken,
            ctx.webflowSiteId,
            ctx.assetFolderId,
            prepared.fileName,
            prepared.bytes,
          );
          images.push({ fileId: uploaded.fileId, url: uploaded.url, alt: mapping.airtableName });
        } catch (err) {
          console.warn(`Multi-image upload failed:`, err);
        }
      }
      if (images.length) fieldData[mapping.webflowSlug] = images;
    }
  }

  return { fieldData, optimized };
}

async function applyWebflowStatus(
  token: string,
  collectionId: string,
  itemId: string,
  status: string,
  current?: WebflowItem,
): Promise<void> {
  const currentStatus = current ? webflowCmsStatus(current) : null;
  if (status === currentStatus) return;

  if (status === "archived") {
    await archiveCollectionItem(token, collectionId, itemId);
  } else if (status === "draft") {
    await unpublishCollectionItem(token, collectionId, itemId);
  } else if (status === "published") {
    if (current?.isArchived) await unarchiveCollectionItem(token, collectionId, itemId);
    await publishCollectionItems(token, collectionId, [itemId]);
  }
}

export async function syncCollection(
  ctx: {
    webflowToken: string;
    webflowSiteId: string;
    airtableApiKey: string;
    airtableBaseId: string;
    schema: { tables: import("../airtable/client").AirtableTable[] };
    collectionIdToTableId: Map<string, string>;
    state: SyncStateStore;
    assetFolderId: string;
    full: boolean;
  },
  collection: WebflowCollection,
  plan: CollectionSyncPlan,
  schemaChanges: SchemaDriftChange[],
): Promise<CollectionSyncStats> {
  const stats: CollectionSyncStats = {
    collectionSlug: collection.slug,
    collectionName: collection.displayName,
    airtablePushed: 0,
    webflowPulled: 0,
    conflictsSkipped: 0,
    skipped: 0,
    imagesOptimized: 0,
    errors: [],
  };

  try {
    const { table, mappings } = await ensureCollectionTable(
      ctx.airtableApiKey,
      ctx.airtableBaseId,
      ctx.schema,
      collection,
      ctx.collectionIdToTableId,
    );

    for (const change of schemaChanges) {
      if (change.kind === "option_choices_changed" && change.collectionSlug === collection.slug) {
        const field = collection.fields.find((f) => f.slug === change.fieldSlug);
        if (field?.validations?.options) {
          await updateOptionFieldChoices(
            ctx.airtableApiKey,
            ctx.airtableBaseId,
            ctx.schema,
            table.id,
            field.displayName ?? field.slug,
            field.validations.options.map((o) => o.name),
          );
        }
      }
    }

    const itemState = getCollectionState(ctx.state, collection.slug);
    const webflowItems = await listCollectionItems(ctx.webflowToken, collection.id);
    const webflowById = new Map(webflowItems.map((i) => [i.id, i]));

    const airtableRecords = await listRecords(ctx.airtableApiKey, ctx.airtableBaseId, table.name, {
      fields: [
        FIELD_WEBFLOW_ITEM_ID,
        FIELD_WEBFLOW_CMS_STATUS,
        ...mappings.flatMap((m) => [m.airtableName, m.sourceUrlField, m.urlsJsonField].filter(Boolean) as string[]),
      ],
    });
    const byWebflowId = recordByWebflowId(airtableRecords);
    const webflowIdByRecordId = buildWebflowIdMap(airtableRecords);

    const pushedRecordIds = new Set<string>();

    if (plan.airtableChanges || ctx.full) {
      const cursor = itemState.airtableCursor;
      const formula = ctx.full
        ? `{${FIELD_WEBFLOW_ITEM_ID}} != ''`
        : `IS_AFTER(LAST_MODIFIED_TIME(), '${cursor}')`;
      const modifiedRecords = await listRecords(ctx.airtableApiKey, ctx.airtableBaseId, table.name, {
        filterByFormula: formula,
        fields: [
          FIELD_WEBFLOW_ITEM_ID,
          FIELD_WEBFLOW_CMS_STATUS,
          FIELD_WEBFLOW_SLUG,
          ...mappings.flatMap((m) => [m.airtableName, m.sourceUrlField, m.urlsJsonField].filter(Boolean) as string[]),
        ],
      });

      for (const record of modifiedRecords) {
        try {
          const wfItemId = String(record.fields[FIELD_WEBFLOW_ITEM_ID] ?? "").trim();
          const fieldData: Record<string, unknown> = {};

          for (const mapping of mappings) {
            if (mapping.isImage || mapping.isMultiImage || mapping.isReference) continue;
            const val = airtableToWebflowFieldValue(mapping, record.fields, webflowIdByRecordId);
            if (val != null && val !== "") fieldData[mapping.webflowSlug] = val;
          }

          Object.assign(
            fieldData,
            resolveReferenceLinks(mappings, record.fields, webflowIdByRecordId),
          );

          const nameCol = mappings.find((m) => m.webflowSlug === "name");
          if (nameCol && record.fields[nameCol.airtableName] != null) {
            fieldData.name = record.fields[nameCol.airtableName];
          }

          const slugFromAirtable = record.fields[FIELD_WEBFLOW_SLUG];
          if (typeof slugFromAirtable === "string" && slugFromAirtable.trim()) {
            fieldData.slug = slugFromAirtable.trim();
          }

          let targetItemId = wfItemId;
          const existing = wfItemId ? webflowById.get(wfItemId) : undefined;
          const isDraft = existing?.isDraft ?? false;

          const { fieldData: imageFields, optimized } = await pushImagesToWebflow(
            ctx,
            mappings,
            record.fields,
            targetItemId || record.id,
          );
          Object.assign(fieldData, imageFields);
          stats.imagesOptimized += optimized;

          if (targetItemId && existing) {
            await updateCollectionItem(
              ctx.webflowToken,
              collection.id,
              targetItemId,
              fieldData,
              isDraft,
            );
          } else {
            const created = await createCollectionItem(
              ctx.webflowToken,
              collection.id,
              fieldData,
              isDraft,
            );
            targetItemId = created.id;
            await updateRecordsBatch(ctx.airtableApiKey, ctx.airtableBaseId, table.name, [
              {
                id: record.id,
                fields: {
                  [FIELD_WEBFLOW_ITEM_ID]: targetItemId,
                  [FIELD_LAST_SYNCED_AT]: nowIso(),
                },
              },
            ]);
            webflowById.set(targetItemId, created);
          }

          const desiredStatus = String(record.fields[FIELD_WEBFLOW_CMS_STATUS] ?? "published");
          if (targetItemId) {
            await applyWebflowStatus(
              ctx.webflowToken,
              collection.id,
              targetItemId,
              desiredStatus,
              webflowById.get(targetItemId),
            );
          }

          pushedRecordIds.add(record.id);
          stats.airtablePushed += 1;
        } catch (err) {
          stats.errors.push(
            `Airtable→Webflow ${record.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      bumpAirtableCursor(itemState);
    }

    if (plan.webflowChanges || ctx.full) {
      const targetIds = ctx.full
        ? webflowItems.map((i) => i.id)
        : [...plan.changedWebflowIds, ...plan.newWebflowIds];

      const creates: Record<string, unknown>[] = [];
      const updates: Array<{ id: string; fields: Record<string, unknown> }> = [];

      for (const itemId of targetIds) {
        const item = webflowById.get(itemId);
        if (!item) continue;

        const existing = byWebflowId.get(item.id);
        if (existing && pushedRecordIds.has(existing.id)) {
          stats.conflictsSkipped += 1;
          continue;
        }

        const fields: Record<string, unknown> = {
          ...syncMetadataFromWebflow(item),
        };

        if (item.fieldData.name != null) {
          const nameMapping = mappings.find((m) => m.webflowSlug === "name");
          if (nameMapping) fields[nameMapping.airtableName] = item.fieldData.name;
        }

        for (const mapping of mappings) {
          Object.assign(fields, webflowToAirtableFieldValue(mapping, item.fieldData[mapping.webflowSlug]));
        }

        if (existing) {
          updates.push({ id: existing.id, fields });
          stats.webflowPulled += 1;
        } else {
          creates.push(fields);
          stats.webflowPulled += 1;
        }
      }

      if (creates.length) await createRecordsBatch(ctx.airtableApiKey, ctx.airtableBaseId, table.name, creates);
      if (updates.length) await updateRecordsBatch(ctx.airtableApiKey, ctx.airtableBaseId, table.name, updates);
    }

    updateItemTimestamps(itemState, webflowItems);
    ctx.state.collections[collection.slug] = itemState;
  } catch (err) {
    stats.errors.push(err instanceof Error ? err.message : String(err));
  }

  return stats;
}

export async function ensureAssetFolder(webflowToken: string, siteId: string): Promise<string> {
  return getOrCreateAssetFolder(webflowToken, siteId);
}

export async function fetchAllCollections(webflowToken: string, siteId: string): Promise<WebflowCollection[]> {
  const { listCollections } = await import("../webflow/client");
  const summaries = await listCollections(webflowToken, siteId);
  const collections: WebflowCollection[] = [];
  for (const summary of summaries) {
    collections.push(await getCollection(webflowToken, summary.id));
  }
  return collections;
}

export async function logSchemaWarnings(
  apiKey: string,
  baseId: string,
  changes: SchemaDriftChange[],
): Promise<void> {
  for (const change of changes) {
    if (
      change.kind === "field_type_changed" ||
      change.kind === "field_removed" ||
      change.kind === "collection_removed"
    ) {
      await createMetaLogRecord(apiKey, baseId, {
        Event: change.kind,
        Message: change.message,
        Timestamp: nowIso(),
      });
    }
  }
}
