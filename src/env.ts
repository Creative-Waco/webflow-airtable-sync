export interface Env {
  SYNC_STATE: KVNamespace;
  WEBFLOW_DATA_API_TOKEN: string;
  WEBFLOW_SITE_ID?: string;
  AIRTABLE_API_KEY: string;
  AIRTABLE_BASE_ID: string;
  SYNC_SECRET: string;
}

export interface SyncConfig {
  webflowToken: string;
  webflowSiteId: string;
  airtableApiKey: string;
  airtableBaseId: string;
  syncSecret: string;
}

export function requireEnv(env: Env): SyncConfig {
  const webflowToken = env.WEBFLOW_DATA_API_TOKEN?.trim();
  const webflowSiteId = env.WEBFLOW_SITE_ID?.trim() || "68b3cf2c25982ab007b0152a";
  const airtableApiKey = env.AIRTABLE_API_KEY?.trim();
  const airtableBaseId = env.AIRTABLE_BASE_ID?.trim();

  if (!webflowToken) throw new Error("WEBFLOW_DATA_API_TOKEN is not configured.");
  if (!airtableApiKey) throw new Error("AIRTABLE_API_KEY is not configured.");
  if (!airtableBaseId) throw new Error("AIRTABLE_BASE_ID is not configured.");

  return {
    webflowToken,
    webflowSiteId,
    airtableApiKey,
    airtableBaseId,
    syncSecret: env.SYNC_SECRET?.trim() || "",
  };
}
