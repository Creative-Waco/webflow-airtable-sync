import type { WebflowItem } from "../webflow/client";
import { countModifiedSince } from "../airtable/client";

export interface CollectionItemState {
  /** webflowItemId → lastUpdated ISO */
  items: Record<string, string>;
  /** ISO timestamp — Airtable records modified before this were synced */
  airtableCursor: string;
}

export interface SyncStateStore {
  schemaFingerprint: string | null;
  collections: Record<string, CollectionItemState>;
}

const STATE_KEY = "sync:state";

export async function loadSyncState(kv: KVNamespace): Promise<SyncStateStore> {
  const raw = await kv.get(STATE_KEY, "json");
  if (!raw) {
    return { schemaFingerprint: null, collections: {} };
  }
  return raw as SyncStateStore;
}

export async function saveSyncState(kv: KVNamespace, state: SyncStateStore): Promise<void> {
  await kv.put(STATE_KEY, JSON.stringify(state));
}

export function getCollectionState(
  state: SyncStateStore,
  collectionSlug: string,
): CollectionItemState {
  return (
    state.collections[collectionSlug] ?? {
      items: {},
      airtableCursor: "1970-01-01T00:00:00.000Z",
    }
  );
}

export function detectWebflowItemChanges(
  items: WebflowItem[],
  itemState: CollectionItemState,
): { hasChanges: boolean; changedIds: string[]; newIds: string[] } {
  const changedIds: string[] = [];
  const newIds: string[] = [];

  for (const item of items) {
    const stored = itemState.items[item.id];
    const updated = item.lastUpdated ?? "";
    if (!stored) {
      newIds.push(item.id);
    } else if (updated && updated > stored) {
      changedIds.push(item.id);
    }
  }

  return {
    hasChanges: changedIds.length > 0 || newIds.length > 0,
    changedIds,
    newIds,
  };
}

export async function detectAirtableChanges(
  apiKey: string,
  baseId: string,
  tableName: string,
  cursor: string,
): Promise<boolean> {
  try {
    const count = await countModifiedSince(apiKey, baseId, tableName, cursor);
    return count > 0;
  } catch {
    return true;
  }
}

export function updateItemTimestamps(
  itemState: CollectionItemState,
  items: WebflowItem[],
): void {
  for (const item of items) {
    if (item.lastUpdated) {
      itemState.items[item.id] = item.lastUpdated;
    }
  }
}

export function bumpAirtableCursor(itemState: CollectionItemState): void {
  itemState.airtableCursor = new Date().toISOString();
}
