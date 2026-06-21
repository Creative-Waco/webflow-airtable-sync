import type { WebflowCollection } from "../webflow/client";
import { listCollectionItems } from "../webflow/client";
import { detectAirtableChanges, detectWebflowItemChanges, getCollectionState } from "./state";
import {
  buildSchemaFingerprint,
  detectSchemaDrift,
  fingerprintHash,
  schemaHasChanges,
  type SchemaDriftChange,
} from "./schema-drift";
import type { SyncStateStore } from "./state";

export interface ChangeProbeResult {
  skipped: boolean;
  schemaChanges: SchemaDriftChange[];
  schemaDrift: boolean;
  collections: Record<
    string,
    {
      airtableChanges: boolean;
      webflowChanges: boolean;
      changedWebflowIds: string[];
      newWebflowIds: string[];
    }
  >;
}

export interface ChangeProbeContext {
  webflowToken: string;
  airtableApiKey: string;
  airtableBaseId: string;
  collections: WebflowCollection[];
  state: SyncStateStore;
  full: boolean;
  schemaOnly: boolean;
  targetSlug?: string;
}

export async function probeChanges(ctx: ChangeProbeContext): Promise<ChangeProbeResult> {
  const fingerprint = buildSchemaFingerprint(ctx.collections);
  const schemaChanges = detectSchemaDrift(
    ctx.state.schemaFingerprint ? JSON.parse(ctx.state.schemaFingerprint) : null,
    fingerprint,
  );
  const schemaDrift = schemaHasChanges(schemaChanges) || schemaChanges.length > 0;

  const collections: ChangeProbeResult["collections"] = {};
  let anyDataChanges = false;

  const targetCollections = ctx.targetSlug
    ? ctx.collections.filter((c) => c.slug === ctx.targetSlug)
    : ctx.collections;

  if (ctx.full) {
    for (const col of targetCollections) {
      collections[col.slug] = {
        airtableChanges: true,
        webflowChanges: true,
        changedWebflowIds: [],
        newWebflowIds: [],
      };
      anyDataChanges = true;
    }
    return { skipped: false, schemaChanges, schemaDrift, collections };
  }

  for (const col of targetCollections) {
    const itemState = getCollectionState(ctx.state, col.slug);
    const items = await listCollectionItems(ctx.webflowToken, col.id);
    const webflow = detectWebflowItemChanges(items, itemState);
    const airtableChanges = await detectAirtableChanges(
      ctx.airtableApiKey,
      ctx.airtableBaseId,
      col.displayName,
      itemState.airtableCursor,
    );

    collections[col.slug] = {
      airtableChanges,
      webflowChanges: webflow.hasChanges,
      changedWebflowIds: webflow.changedIds,
      newWebflowIds: webflow.newIds,
    };

    if (airtableChanges || webflow.hasChanges) anyDataChanges = true;
  }

  const skipped = !schemaDrift && !anyDataChanges && !ctx.schemaOnly;

  return { skipped: ctx.schemaOnly ? false : skipped, schemaChanges, schemaDrift, collections };
}

export function fingerprintFromCollections(collections: WebflowCollection[]): string {
  return fingerprintHash(buildSchemaFingerprint(collections));
}
