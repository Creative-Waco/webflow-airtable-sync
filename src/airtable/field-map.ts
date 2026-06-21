import type { AirtableFieldDef } from "./client";
import type { WebflowField } from "../webflow/client";
import {
  airtableColumnName,
  imageSourceUrlFieldName,
  multiImageUrlsFieldName,
} from "../constants";

const dateTimeOptions = {
  dateFormat: { name: "iso" },
  timeFormat: { name: "24hour" },
  timeZone: "utc",
};

const checkboxOptions = { icon: "check", color: "greenBright" };

export interface FieldMapping {
  webflowSlug: string;
  airtableName: string;
  webflowType: string;
  airtableType: string;
  linkedCollectionId?: string;
  isImage: boolean;
  isMultiImage: boolean;
  isReference: boolean;
  sourceUrlField?: string;
  urlsJsonField?: string;
}

export function webflowFieldToAirtableDefs(
  field: WebflowField,
  linkedTableId?: string,
): AirtableFieldDef[] {
  const col = airtableColumnName(field);
  const type = field.type;

  switch (type) {
    case "PlainText":
      return [{ name: col, type: "singleLineText" }];
    case "RichText":
      return [{ name: col, type: "multilineText" }];
    case "Link":
    case "VideoLink":
      return [{ name: col, type: "url" }];
    case "Email":
      return [{ name: col, type: "email" }];
    case "Phone":
      return [{ name: col, type: "phoneNumber" }];
    case "Number":
      return [{ name: col, type: "number", options: { precision: 2 } }];
    case "DateTime":
      return [{ name: col, type: "dateTime", options: dateTimeOptions }];
    case "Switch":
      return [{ name: col, type: "checkbox", options: checkboxOptions }];
    case "Color":
      return [{ name: col, type: "singleLineText" }];
    case "Option": {
      const choices = (field.validations?.options ?? []).map((o) => ({ name: o.name }));
      return [
        {
          name: col,
          type: "singleSelect",
          options: choices.length ? { choices } : undefined,
        },
      ];
    }
    case "Image":
      return [
        { name: imageSourceUrlFieldName(field.slug), type: "url" },
        { name: col, type: "multipleAttachments" },
      ];
    case "MultiImage":
      return [
        { name: multiImageUrlsFieldName(field.slug), type: "multilineText" },
        { name: col, type: "multipleAttachments" },
      ];
    case "Reference":
    case "MultiReference":
      if (!linkedTableId) {
        return [{ name: col, type: "multilineText", description: "Unresolved reference — link pending" }];
      }
      return [
        {
          name: col,
          type: "multipleRecordLinks",
          options: { linkedTableId },
        },
      ];
    default:
      return [{ name: col, type: "singleLineText", description: `Webflow type: ${type}` }];
  }
}

export function buildFieldMappings(
  fields: WebflowField[],
  collectionIdToTableId: Map<string, string>,
): FieldMapping[] {
  const mappings: FieldMapping[] = [];

  for (const field of fields) {
    if (field.slug === "slug") continue;

    const col = airtableColumnName(field);
    const linkedCollectionId = field.validations?.collectionId;
    const linkedTableId = linkedCollectionId
      ? collectionIdToTableId.get(linkedCollectionId)
      : undefined;

    mappings.push({
      webflowSlug: field.slug,
      airtableName: col,
      webflowType: field.type,
      airtableType: webflowFieldToAirtableDefs(field, linkedTableId)[0]?.type ?? "singleLineText",
      linkedCollectionId,
      isImage: field.type === "Image",
      isMultiImage: field.type === "MultiImage",
      isReference: field.type === "Reference" || field.type === "MultiReference",
      sourceUrlField: field.type === "Image" ? imageSourceUrlFieldName(field.slug) : undefined,
      urlsJsonField: field.type === "MultiImage" ? multiImageUrlsFieldName(field.slug) : undefined,
    });
  }

  return mappings;
}

export function webflowImageValue(value: unknown): { url?: string; alt?: string } | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as { url?: string; alt?: string };
  if (!obj.url) return null;
  return { url: obj.url, alt: obj.alt ?? "" };
}

export function webflowMultiImageValues(value: unknown): Array<{ url: string; alt?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => webflowImageValue(entry))
    .filter((v): v is { url: string; alt?: string } => Boolean(v?.url));
}

export function airtableAttachmentFromUrl(url: string, filename?: string): { url: string; filename?: string } {
  return { url, ...(filename ? { filename } : {}) };
}

export function webflowToAirtableFieldValue(
  field: FieldMapping,
  value: unknown,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  if (value == null || value === "") return out;

  switch (field.webflowType) {
    case "Switch":
      out[field.airtableName] = Boolean(value);
      break;
    case "Number":
      out[field.airtableName] = typeof value === "number" ? value : Number(value);
      break;
    case "Option":
      out[field.airtableName] = typeof value === "string" ? value : String(value);
      break;
    case "Image": {
      const img = webflowImageValue(value);
      if (img?.url) {
        if (field.sourceUrlField) out[field.sourceUrlField] = img.url;
        out[field.airtableName] = [airtableAttachmentFromUrl(img.url, img.alt || undefined)];
      }
      break;
    }
    case "MultiImage": {
      const imgs = webflowMultiImageValues(value);
      if (imgs.length) {
        if (field.urlsJsonField) {
          out[field.urlsJsonField] = JSON.stringify(imgs.map((i) => i.url));
        }
        out[field.airtableName] = imgs.map((i) => airtableAttachmentFromUrl(i.url, i.alt));
      }
      break;
    }
    case "Reference":
    case "MultiReference":
      break;
    default:
      out[field.airtableName] = typeof value === "string" ? value : JSON.stringify(value);
  }

  return out;
}

export function airtableAttachments(value: unknown): Array<{ url: string; filename?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a) => a && typeof a === "object" && "url" in a)
    .map((a) => ({
      url: String((a as { url: string }).url),
      filename: (a as { filename?: string }).filename,
    }));
}

export function resolveAirtableLinks(
  value: unknown,
  webflowIdByRecordId: Map<string, string>,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((id) => webflowIdByRecordId.get(String(id)))
    .filter((id): id is string => Boolean(id));
}

export function airtableToWebflowFieldValue(
  field: FieldMapping,
  recordFields: Record<string, unknown>,
  webflowIdByRecordId: Map<string, string>,
): unknown {
  if (field.isReference) {
    const linked = recordFields[field.airtableName];
    const ids = resolveAirtableLinks(linked, webflowIdByRecordId);
    if (field.webflowType === "Reference") return ids[0] ?? null;
    return ids;
  }

  const value = recordFields[field.airtableName];
  if (value == null || value === "") return null;

  switch (field.webflowType) {
    case "Switch":
      return Boolean(value);
    case "Number":
      return typeof value === "number" ? value : Number(value);
    case "Option":
      return String(value);
    case "Image":
    case "MultiImage":
      return null;
    default:
      return typeof value === "string" ? value : String(value);
  }
}

export function getAirtableImageUrl(recordFields: Record<string, unknown>, field: FieldMapping): string | null {
  const attachments = airtableAttachments(recordFields[field.airtableName]);
  if (attachments[0]?.url) return attachments[0].url;
  if (field.sourceUrlField) {
    const src = recordFields[field.sourceUrlField];
    if (typeof src === "string" && src.trim()) return src.trim();
  }
  return null;
}

export function getAirtableMultiImageUrls(recordFields: Record<string, unknown>, field: FieldMapping): string[] {
  const attachments = airtableAttachments(recordFields[field.airtableName]);
  if (attachments.length) return attachments.map((a) => a.url);
  if (field.urlsJsonField) {
    const raw = recordFields[field.urlsJsonField];
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {
        /* ignore */
      }
    }
  }
  return [];
}
