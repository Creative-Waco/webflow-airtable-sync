import type { WebflowCollection } from "../webflow/client";

/** Leaf collections (no outgoing refs) sync first. */
const LEAF_SLUGS = new Set(["categories", "tags", "collections", "donors"]);

export function sortCollectionsForSync(collections: WebflowCollection[]): WebflowCollection[] {
  const byId = new Map(collections.map((c) => [c.id, c]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();

  for (const col of collections) {
    inDegree.set(col.id, 0);
    dependents.set(col.id, []);
  }

  for (const col of collections) {
    for (const field of col.fields) {
      const refId = field.validations?.collectionId;
      if (
        refId &&
        (field.type === "Reference" || field.type === "MultiReference") &&
        byId.has(refId) &&
        refId !== col.id
      ) {
        inDegree.set(col.id, (inDegree.get(col.id) ?? 0) + 1);
        dependents.get(refId)?.push(col.id);
      }
    }
  }

  const queue: WebflowCollection[] = [];

  for (const col of collections) {
    if ((inDegree.get(col.id) ?? 0) === 0 || LEAF_SLUGS.has(col.slug)) {
      queue.push(col);
    }
  }

  queue.sort((a, b) => a.displayName.localeCompare(b.displayName));

  const sorted: WebflowCollection[] = [];
  const seen = new Set<string>();

  while (queue.length) {
    const col = queue.shift()!;
    if (seen.has(col.id)) continue;
    seen.add(col.id);
    sorted.push(col);

    for (const depId of dependents.get(col.id) ?? []) {
      const next = (inDegree.get(depId) ?? 1) - 1;
      inDegree.set(depId, next);
      if (next <= 0) {
        const dep = byId.get(depId);
        if (dep) queue.push(dep);
      }
    }
    queue.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  for (const col of collections) {
    if (!seen.has(col.id)) sorted.push(col);
  }

  return sorted;
}
