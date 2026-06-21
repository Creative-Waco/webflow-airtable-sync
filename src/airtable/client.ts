const API_ROOT = "https://api.airtable.com/v0";

import {
  FIELD_WEBFLOW_ITEM_ID,
  SYNC_META_TABLE,
} from "../constants";

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
  createdTime?: string;
}

export interface AirtableTable {
  id: string;
  name: string;
  fields?: Array<{ id: string; name: string; type: string }>;
}

export interface AirtableFieldDef {
  name: string;
  type: string;
  options?: Record<string, unknown>;
  description?: string;
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const data = JSON.parse(text) as { error?: { message?: string } };
    return data.error?.message ?? text;
  } catch {
    return text || response.statusText;
  }
}

export async function airtableFetch<T = unknown>(
  apiKey: string,
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_ROOT}${path}`, {
    ...options,
    headers: {
      ...authHeaders(apiKey),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const message = await parseError(response);
    throw new Error(`Airtable API ${response.status}: ${message}`);
  }

  if (response.status === 204) return null as T;
  return response.json() as Promise<T>;
}

export async function getBaseSchema(
  apiKey: string,
  baseId: string,
): Promise<{ tables: AirtableTable[] }> {
  const data = await airtableFetch<{ tables: AirtableTable[] }>(
    apiKey,
    `/meta/bases/${baseId}/tables`,
  );
  return { tables: data.tables ?? [] };
}

export function findTableByName(
  schema: { tables: AirtableTable[] },
  tableName: string,
): AirtableTable | null {
  return schema.tables.find((t) => t.name === tableName) ?? null;
}

function tableHasField(
  schema: { tables: AirtableTable[] },
  tableId: string,
  fieldName: string,
): boolean {
  const table = schema.tables.find((t) => t.id === tableId);
  return (table?.fields ?? []).some((f) => f.name === fieldName);
}

export async function createTable(
  apiKey: string,
  baseId: string,
  name: string,
  fields: AirtableFieldDef[],
  description?: string,
): Promise<AirtableTable> {
  const body: Record<string, unknown> = { name, fields };
  if (description) body.description = description;
  return airtableFetch<AirtableTable>(apiKey, `/meta/bases/${baseId}/tables`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function createField(
  apiKey: string,
  baseId: string,
  tableId: string,
  field: AirtableFieldDef,
): Promise<{ id: string; name: string; type: string }> {
  return airtableFetch(apiKey, `/meta/bases/${baseId}/tables/${tableId}/fields`, {
    method: "POST",
    body: JSON.stringify(field),
  });
}

export async function updateField(
  apiKey: string,
  baseId: string,
  tableId: string,
  fieldId: string,
  patch: Partial<AirtableFieldDef>,
): Promise<void> {
  await airtableFetch(apiKey, `/meta/bases/${baseId}/tables/${tableId}/fields/${fieldId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function ensureFieldExists(
  apiKey: string,
  baseId: string,
  tableId: string,
  field: AirtableFieldDef,
  schema: { tables: AirtableTable[] },
): Promise<void> {
  if (tableHasField(schema, tableId, field.name)) return;
  const created = await createField(apiKey, baseId, tableId, field);
  const table = schema.tables.find((t) => t.id === tableId);
  if (table) {
    table.fields = [
      ...(table.fields ?? []),
      { id: created.id, name: field.name, type: field.type },
    ];
  }
}

export async function listRecords(
  apiKey: string,
  baseId: string,
  tableNameOrId: string,
  options: { fields?: string[]; filterByFormula?: string; pageSize?: number } = {},
): Promise<AirtableRecord[]> {
  const params = new URLSearchParams();
  if (options.filterByFormula) params.set("filterByFormula", options.filterByFormula);
  if (options.pageSize) params.set("pageSize", String(options.pageSize));
  if (options.fields?.length) {
    for (const field of options.fields) params.append("fields[]", field);
  }

  const records: AirtableRecord[] = [];
  let offset: string | undefined;

  do {
    const pageParams = new URLSearchParams(params);
    if (offset) pageParams.set("offset", offset);
    const query = pageParams.toString();
    const path = `/${baseId}/${encodeURIComponent(tableNameOrId)}${query ? `?${query}` : ""}`;
    const data = await airtableFetch<{ records: AirtableRecord[]; offset?: string }>(
      apiKey,
      path,
    );
    records.push(...(data.records ?? []));
    offset = data.offset;
  } while (offset);

  return records;
}

export async function countModifiedSince(
  apiKey: string,
  baseId: string,
  tableNameOrId: string,
  sinceIso: string,
): Promise<number> {
  const formula = `IS_AFTER(LAST_MODIFIED_TIME(), '${sinceIso}')`;
  const records = await listRecords(apiKey, baseId, tableNameOrId, {
    filterByFormula: formula,
    fields: [FIELD_WEBFLOW_ITEM_ID],
  });
  return records.length;
}

export async function createRecordsBatch(
  apiKey: string,
  baseId: string,
  tableNameOrId: string,
  fieldsList: Record<string, unknown>[],
): Promise<AirtableRecord[]> {
  const created: AirtableRecord[] = [];
  for (let i = 0; i < fieldsList.length; i += 10) {
    const chunk = fieldsList.slice(i, i + 10);
    const data = await airtableFetch<{ records: AirtableRecord[] }>(
      apiKey,
      `/${baseId}/${encodeURIComponent(tableNameOrId)}`,
      {
        method: "POST",
        body: JSON.stringify({
          records: chunk.map((fields) => ({ fields })),
          typecast: true,
        }),
      },
    );
    created.push(...(data.records ?? []));
  }
  return created;
}

export async function updateRecordsBatch(
  apiKey: string,
  baseId: string,
  tableNameOrId: string,
  updates: Array<{ id: string; fields: Record<string, unknown> }>,
): Promise<void> {
  for (let i = 0; i < updates.length; i += 10) {
    const chunk = updates.slice(i, i + 10);
    await airtableFetch(apiKey, `/${baseId}/${encodeURIComponent(tableNameOrId)}`, {
      method: "PATCH",
      body: JSON.stringify({ records: chunk, typecast: true }),
    });
  }
}

export async function createMetaLogRecord(
  apiKey: string,
  baseId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  try {
    await createRecordsBatch(apiKey, baseId, SYNC_META_TABLE, [fields]);
  } catch {
    // Meta table may not exist yet on first run
  }
}
