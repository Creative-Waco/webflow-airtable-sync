export const SYNC_META_TABLE = "_Sync Meta";

export const FIELD_WEBFLOW_ITEM_ID = "Webflow Item ID";
export const FIELD_WEBFLOW_SLUG = "Webflow Slug";
export const FIELD_WEBFLOW_LAST_UPDATED = "Webflow Last Updated";
export const FIELD_WEBFLOW_CREATED_ON = "Webflow Created On";
export const FIELD_WEBFLOW_CMS_STATUS = "Webflow CMS Status";
export const FIELD_LAST_SYNCED_AT = "Last Synced At";

export const ASSET_FOLDER_NAME = "Airtable sync";

export const MAX_WEBFLOW_ASSET_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_DOWNLOAD_BYTES = 25 * 1024 * 1024;

export const SYNC_METADATA_FIELDS = [
  FIELD_WEBFLOW_ITEM_ID,
  FIELD_WEBFLOW_SLUG,
  FIELD_WEBFLOW_LAST_UPDATED,
  FIELD_WEBFLOW_CREATED_ON,
  FIELD_WEBFLOW_CMS_STATUS,
  FIELD_LAST_SYNCED_AT,
] as const;

export function imageSourceUrlFieldName(fieldSlug: string): string {
  return `${fieldSlug} Source URL`;
}

export function multiImageUrlsFieldName(fieldSlug: string): string {
  return `${fieldSlug} URLs JSON`;
}

export function airtableColumnName(field: { displayName?: string; slug: string }): string {
  const name = field.displayName?.trim() || field.slug;
  if (SYNC_METADATA_FIELDS.includes(name as (typeof SYNC_METADATA_FIELDS)[number])) {
    return `${name} (Webflow)`;
  }
  return name;
}

export function webflowCmsStatus(item: {
  isDraft?: boolean;
  isArchived?: boolean;
}): string {
  if (item.isArchived) return "archived";
  if (item.isDraft) return "draft";
  return "published";
}
