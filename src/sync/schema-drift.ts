import type { WebflowCollection } from "../webflow/client";

export interface SchemaFingerprintField {
  slug: string;
  type: string;
  options?: string[];
}

export interface SchemaFingerprintCollection {
  id: string;
  slug: string;
  displayName: string;
  fields: SchemaFingerprintField[];
}

export interface SchemaDriftChange {
  kind:
    | "collection_added"
    | "collection_removed"
    | "field_added"
    | "field_removed"
    | "field_type_changed"
    | "option_choices_changed";
  collectionSlug: string;
  collectionName: string;
  fieldSlug?: string;
  message: string;
}

export function buildSchemaFingerprint(
  collections: WebflowCollection[],
): SchemaFingerprintCollection[] {
  return collections
    .map((c) => ({
      id: c.id,
      slug: c.slug,
      displayName: c.displayName,
      fields: c.fields
        .filter((f) => f.slug !== "slug")
        .map((f) => ({
          slug: f.slug,
          type: f.type,
          options:
            f.type === "Option"
              ? (f.validations?.options ?? []).map((o) => o.name).sort()
              : undefined,
        }))
        .sort((a, b) => a.slug.localeCompare(b.slug)),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function fingerprintHash(fingerprint: SchemaFingerprintCollection[]): string {
  return JSON.stringify(fingerprint);
}

export function detectSchemaDrift(
  previous: SchemaFingerprintCollection[] | null,
  current: SchemaFingerprintCollection[],
): SchemaDriftChange[] {
  if (!previous) return [];

  const changes: SchemaDriftChange[] = [];
  const prevBySlug = new Map(previous.map((c) => [c.slug, c]));
  const currBySlug = new Map(current.map((c) => [c.slug, c]));

  for (const curr of current) {
    const prev = prevBySlug.get(curr.slug);
    if (!prev) {
      changes.push({
        kind: "collection_added",
        collectionSlug: curr.slug,
        collectionName: curr.displayName,
        message: `New Webflow collection: ${curr.displayName} (${curr.slug})`,
      });
      continue;
    }

    const prevFields = new Map(prev.fields.map((f) => [f.slug, f]));
    const currFields = new Map(curr.fields.map((f) => [f.slug, f]));

    for (const field of curr.fields) {
      const prevField = prevFields.get(field.slug);
      if (!prevField) {
        changes.push({
          kind: "field_added",
          collectionSlug: curr.slug,
          collectionName: curr.displayName,
          fieldSlug: field.slug,
          message: `New field ${field.slug} (${field.type}) in ${curr.displayName}`,
        });
        continue;
      }
      if (prevField.type !== field.type) {
        changes.push({
          kind: "field_type_changed",
          collectionSlug: curr.slug,
          collectionName: curr.displayName,
          fieldSlug: field.slug,
          message: `Field ${field.slug} type changed ${prevField.type} → ${field.type} in ${curr.displayName}`,
        });
      }
      if (field.options && prevField.options) {
        const a = field.options.join("|");
        const b = prevField.options.join("|");
        if (a !== b) {
          changes.push({
            kind: "option_choices_changed",
            collectionSlug: curr.slug,
            collectionName: curr.displayName,
            fieldSlug: field.slug,
            message: `Option choices changed for ${field.slug} in ${curr.displayName}`,
          });
        }
      }
    }

    for (const field of prev.fields) {
      if (!currFields.has(field.slug)) {
        changes.push({
          kind: "field_removed",
          collectionSlug: curr.slug,
          collectionName: curr.displayName,
          fieldSlug: field.slug,
          message: `Field ${field.slug} removed from Webflow ${curr.displayName} (Airtable column kept)`,
        });
      }
    }
  }

  for (const prev of previous) {
    if (!currBySlug.has(prev.slug)) {
      changes.push({
        kind: "collection_removed",
        collectionSlug: prev.slug,
        collectionName: prev.displayName,
        message: `Webflow collection removed: ${prev.displayName} (Airtable table kept)`,
      });
    }
  }

  return changes;
}

export function schemaHasChanges(changes: SchemaDriftChange[]): boolean {
  return changes.some(
    (c) =>
      c.kind === "collection_added" ||
      c.kind === "field_added" ||
      c.kind === "option_choices_changed",
  );
}

export function schemaHasWarnings(changes: SchemaDriftChange[]): boolean {
  return changes.some(
    (c) =>
      c.kind === "field_type_changed" ||
      c.kind === "field_removed" ||
      c.kind === "collection_removed",
  );
}
