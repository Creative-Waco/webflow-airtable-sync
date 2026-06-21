import type { AirtableFieldDef, AirtableTable } from "./client";
import {
  createTable,
  ensureFieldExists,
  findTableByName,
  getBaseSchema,
  updateField,
} from "./client";
import type { WebflowCollection } from "../webflow/client";
import { buildFieldMappings, webflowFieldToAirtableDefs } from "./field-map";
import {
  FIELD_LAST_SYNCED_AT,
  FIELD_WEBFLOW_CMS_STATUS,
  FIELD_WEBFLOW_CREATED_ON,
  FIELD_WEBFLOW_ITEM_ID,
  FIELD_WEBFLOW_LAST_UPDATED,
  FIELD_WEBFLOW_SLUG,
  SYNC_META_TABLE,
  SYNC_METADATA_FIELDS,
} from "../constants";

const dateTimeOptions = {
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
  timeZone: "utc",
};

function syncMetadataFieldDefs(): AirtableFieldDef[] {
  return [
    { name: FIELD_WEBFLOW_ITEM_ID, type: "singleLineText" },
    { name: FIELD_WEBFLOW_SLUG, type: "singleLineText" },
    { name: FIELD_WEBFLOW_LAST_UPDATED, type: "dateTime", options: dateTimeOptions },
    { name: FIELD_WEBFLOW_CREATED_ON, type: "dateTime", options: dateTimeOptions },
    { name: FIELD_WEBFLOW_CMS_STATUS, type: "singleLineText" },
    { name: FIELD_LAST_SYNCED_AT, type: "dateTime", options: dateTimeOptions },
  ];
}

export async function ensureSyncMetaTable(
  apiKey: string,
  baseId: string,
  schema: { tables: AirtableTable[] },
): Promise<AirtableTable> {
  let table = findTableByName(schema, SYNC_META_TABLE);
  if (!table) {
    table = await createTable(
      apiKey,
      baseId,
      SYNC_META_TABLE,
      [
        { name: "Event", type: "singleLineText" },
        { name: "Message", type: "multilineText" },
        { name: "Details JSON", type: "multilineText" },
        { name: "Timestamp", type: "dateTime", options: dateTimeOptions },
      ],
      "Webflow ↔ Airtable sync logs and schema drift",
    );
    schema.tables.push(table);
  }
  return table;
}

export interface CollectionSchemaResult {
  table: AirtableTable;
  mappings: ReturnType<typeof buildFieldMappings>;
}

export async function ensureCollectionTable(
  apiKey: string,
  baseId: string,
  schema: { tables: AirtableTable[] },
  collection: WebflowCollection,
  collectionIdToTableId: Map<string, string>,
): Promise<CollectionSchemaResult> {
  const tableName = collection.displayName;
  let table = findTableByName(schema, tableName);

  const cmsFields = collection.fields.filter((f) => f.slug !== "slug");
  const fieldDefs: AirtableFieldDef[] = [...syncMetadataFieldDefs()];

  for (const field of cmsFields) {
    const linkedTableId = field.validations?.collectionId
      ? collectionIdToTableId.get(field.validations.collectionId)
      : undefined;
    fieldDefs.push(...webflowFieldToAirtableDefs(field, linkedTableId));
  }

  if (!table) {
    const primary = { name: FIELD_WEBFLOW_ITEM_ID, type: "singleLineText" };
    const rest = fieldDefs.filter((f) => f.name !== FIELD_WEBFLOW_ITEM_ID);
    table = await createTable(
      apiKey,
      baseId,
      tableName,
      [primary, ...rest],
      `Synced from Webflow CMS collection "${collection.slug}"`,
    );
    schema.tables.push(table);
  } else {
    for (const def of fieldDefs) {
      await ensureFieldExists(apiKey, baseId, table.id, def, schema);
    }
  }

  collectionIdToTableId.set(collection.id, table.id);

  const mappings = buildFieldMappings(cmsFields, collectionIdToTableId);
  return { table, mappings };
}

export async function updateOptionFieldChoices(
  apiKey: string,
  baseId: string,
  schema: { tables: AirtableTable[] },
  tableId: string,
  fieldName: string,
  choices: string[],
): Promise<void> {
  const table = schema.tables.find((t) => t.id === tableId);
  const field = table?.fields?.find((f) => f.name === fieldName);
  if (!field) return;

  await updateField(apiKey, baseId, tableId, field.id, {
    type: "singleSelect",
    options: { choices: choices.map((name) => ({ name })) },
  });
}

export async function loadBaseSchema(apiKey: string, baseId: string) {
  return getBaseSchema(apiKey, baseId);
}

export { SYNC_METADATA_FIELDS };
