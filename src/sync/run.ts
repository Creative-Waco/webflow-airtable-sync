import { createMetaLogRecord, getBaseSchema } from "../airtable/client";
import { ensureSyncMetaTable, ensureCollectionTable } from "../airtable/schema";
import type { SyncConfig } from "../env";
import { fingerprintFromCollections, probeChanges } from "./change-probe";
import {
  ensureAssetFolder,
  fetchAllCollections,
  logSchemaWarnings,
  syncCollection,
  type CollectionSyncStats,
} from "./collection";
import { sortCollectionsForSync } from "./order";
import { schemaHasChanges } from "./schema-drift";
import { loadSyncState, saveSyncState } from "./state";

export interface SyncRunOptions {
  full?: boolean;
  schemaOnly?: boolean;
  collectionSlug?: string;
}

export interface SyncRunResult {
  ok: boolean;
  skipped: boolean;
  reason?: string;
  startedAt: string;
  finishedAt: string;
  schemaChanges: import("./schema-drift").SchemaDriftChange[];
  imagesOptimized: number;
  collections: CollectionSyncStats[];
}

export async function runSync(
  config: SyncConfig,
  kv: KVNamespace,
  options: SyncRunOptions = {},
): Promise<SyncRunResult> {
  const startedAt = new Date().toISOString();
  const state = await loadSyncState(kv);

  const allCollections = await fetchAllCollections(config.webflowToken, config.webflowSiteId);
  const collections = sortCollectionsForSync(allCollections);

  const probe = await probeChanges({
    webflowToken: config.webflowToken,
    airtableApiKey: config.airtableApiKey,
    airtableBaseId: config.airtableBaseId,
    collections,
    state,
    full: Boolean(options.full),
    schemaOnly: Boolean(options.schemaOnly),
    targetSlug: options.collectionSlug,
  });

  if (probe.skipped && !options.schemaOnly) {
    const finishedAt = new Date().toISOString();
    await createMetaLogRecord(config.airtableApiKey, config.airtableBaseId, {
      Event: "sync_skipped",
      Message: "No changes detected in Webflow, Airtable, or schema",
      Timestamp: finishedAt,
    });
    return {
      ok: true,
      skipped: true,
      reason: "no changes",
      startedAt,
      finishedAt,
      schemaChanges: probe.schemaChanges,
      imagesOptimized: 0,
      collections: [],
    };
  }

  const schema = await getBaseSchema(config.airtableApiKey, config.airtableBaseId);
  await ensureSyncMetaTable(config.airtableApiKey, config.airtableBaseId, schema);
  await logSchemaWarnings(config.airtableApiKey, config.airtableBaseId, probe.schemaChanges);

  const collectionIdToTableId = new Map<string, string>();
  for (const table of schema.tables) {
    const col = collections.find((c) => c.displayName === table.name);
    if (col) collectionIdToTableId.set(col.id, table.id);
  }

  const assetFolderId = options.schemaOnly
    ? ""
    : await ensureAssetFolder(config.webflowToken, config.webflowSiteId);

  const targetCollections = options.collectionSlug
    ? collections.filter((c) => c.slug === options.collectionSlug)
    : collections;

  const results: CollectionSyncStats[] = [];
  let imagesOptimized = 0;

  if (options.schemaOnly) {
    for (const collection of targetCollections) {
      await ensureCollectionTable(
        config.airtableApiKey,
        config.airtableBaseId,
        schema,
        collection,
        collectionIdToTableId,
      );
    }
  } else if (!options.schemaOnly) {
    for (const collection of targetCollections) {
      const plan = probe.collections[collection.slug] ?? {
        airtableChanges: true,
        webflowChanges: true,
        changedWebflowIds: [],
        newWebflowIds: [],
      };

      const needsSchema =
        schemaHasChanges(probe.schemaChanges) ||
        probe.schemaChanges.some((c) => c.collectionSlug === collection.slug);

      if (
        !options.full &&
        !plan.airtableChanges &&
        !plan.webflowChanges &&
        !needsSchema
      ) {
        continue;
      }

      const stats = await syncCollection(
        {
          webflowToken: config.webflowToken,
          webflowSiteId: config.webflowSiteId,
          airtableApiKey: config.airtableApiKey,
          airtableBaseId: config.airtableBaseId,
          schema,
          collectionIdToTableId,
          state,
          assetFolderId,
          full: Boolean(options.full),
        },
        collection,
        plan,
        probe.schemaChanges,
      );
      results.push(stats);
      imagesOptimized += stats.imagesOptimized;
    }

    if (options.full) {
      for (const collection of targetCollections) {
        await ensureCollectionTable(
          config.airtableApiKey,
          config.airtableBaseId,
          schema,
          collection,
          collectionIdToTableId,
        );
      }
    }
  }

  state.schemaFingerprint = fingerprintFromCollections(collections);
  await saveSyncState(kv, state);

  const finishedAt = new Date().toISOString();
  await createMetaLogRecord(config.airtableApiKey, config.airtableBaseId, {
    Event: options.schemaOnly ? "schema_sync" : "sync_complete",
    Message: options.schemaOnly
      ? `Schema check: ${probe.schemaChanges.length} change(s)`
      : `Synced ${results.length} collection(s)`,
    "Details JSON": JSON.stringify({ results, schemaChanges: probe.schemaChanges }),
    Timestamp: finishedAt,
  });

  return {
    ok: results.every((r) => r.errors.length === 0),
    skipped: false,
    startedAt,
    finishedAt,
    schemaChanges: probe.schemaChanges,
    imagesOptimized,
    collections: results,
  };
}
