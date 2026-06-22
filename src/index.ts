import { type Env, requireEnv } from "./env";
import { getBaseSchema } from "./airtable/client";
import { fetchAllCollections } from "./sync/collection";
import { runSync } from "./sync/run";
import { loadSyncState } from "./sync/state";
import { buildSchemaFingerprint, detectSchemaDrift } from "./sync/schema-drift";

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function authorizeSync(request: Request, syncSecret: string): boolean {
  if (!syncSecret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === syncSecret;
}

function parseOptionalInt(value: string | null): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : undefined;
}

async function handleHealth(env: Env): Promise<Response> {
  try {
    const config = requireEnv(env);
    const collections = await fetchAllCollections(config.webflowToken, config.webflowSiteId);

    let airtable: { baseId: string; tables: number; ok: boolean; error?: string } = {
      baseId: config.airtableBaseId,
      tables: 0,
      ok: false,
    };

    try {
      const schema = await getBaseSchema(config.airtableApiKey, config.airtableBaseId);
      airtable = { baseId: config.airtableBaseId, tables: schema.tables.length, ok: true };
    } catch (error) {
      airtable.error = error instanceof Error ? error.message : "Airtable check failed";
    }

    const state = await loadSyncState(env.SYNC_STATE);
    const fingerprint = buildSchemaFingerprint(collections);
    const schemaChanges = detectSchemaDrift(
      state.schemaFingerprint ? JSON.parse(state.schemaFingerprint) : null,
      fingerprint,
    );

    return json({
      ok: airtable.ok,
      webflow: {
        ok: true,
        siteId: config.webflowSiteId,
        collections: collections.length,
        collectionNames: collections.map((c) => c.displayName),
      },
      airtable,
      schemaDrift: schemaChanges,
      lastSchemaFingerprint: state.schemaFingerprint ? "set" : "none",
    });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : "Health check failed" },
      500,
    );
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (request.method === "GET" && (path === "/health" || path === "/")) {
      return handleHealth(env);
    }

    if (request.method === "POST" && path === "/sync") {
      const config = requireEnv(env);
      if (!authorizeSync(request, config.syncSecret)) {
        return json({ error: "Unauthorized" }, 401);
      }

      try {
        const full = url.searchParams.get("full") === "1" || url.searchParams.get("full") === "true";
        const schemaOnly =
          url.searchParams.get("schema") === "1" || url.searchParams.get("schema") === "true";
        const collectionSlug = url.searchParams.get("collection") ?? undefined;

        const result = await runSync(config, env.SYNC_STATE, {
          full,
          schemaOnly,
          collectionSlug,
          batchOffset: parseOptionalInt(url.searchParams.get("offset")),
          batchSize: parseOptionalInt(url.searchParams.get("batch")) ?? (full ? 25 : undefined),
        });
        return json(result);
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : "Sync failed" },
          500,
        );
      }
    }

    return json({ error: "Not found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = requireEnv(env);
    ctx.waitUntil(runSync(config, env.SYNC_STATE, { lightweightProbe: true }));
  },
};
