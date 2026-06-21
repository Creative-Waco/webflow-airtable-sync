# Webflow ↔ Airtable Sync

Cloudflare Worker that makes **Airtable the editing interface** for Creative Waco Webflow CMS. Staff edit content in Airtable; the worker keeps Webflow CMS in sync (and seeds Airtable from Webflow on first run).

**Airtable base:** `appux7Z1wivZRMNlr`  
**Webflow site:** `68b3cf2c25982ab007b0152a`  
**Worker:** `creativewaco-webflow-airtable-sync`  
**Production URL:** https://creativewaco-webflow-airtable-sync.josh-837.workers.dev

## Features

- **2-way sync** for all Webflow CMS collections (discovered dynamically — currently 15 collections)
- **Airtable is source of truth** — when both sides change, Airtable wins
- **Pre-sync change probe** — skips the run when Webflow, Airtable, and schema are unchanged
- **Schema drift handling** — new Webflow collections/fields auto-create Airtable tables/columns hourly
- **Image optimization** — Airtable attachments over 4 MB are resized/recompressed before Webflow Assets upload
- **Hourly cron** (`0 * * * *`) plus manual `POST /sync`

## Sync flow

1. **Change probe** (read-only) — schema fingerprint, Airtable `LAST_MODIFIED_TIME()`, Webflow `lastUpdated` vs KV
2. **Schema drift** — create tables/columns for new Webflow collections/fields
3. **Airtable → Webflow** (primary) — push edits, upload images, preserve publish state
4. **Webflow → Airtable** (secondary) — seed new items and Designer-only edits; skip rows Airtable already pushed

Early exit when nothing changed: `{ skipped: true, reason: "no changes" }`.

## Airtable tables

One table per Webflow collection (display name), plus **`_Sync Meta`** for run logs.

Every collection table includes sync metadata:

| Column | Purpose |
|--------|---------|
| Webflow Item ID | Upsert key |
| Webflow Slug | URL slug |
| Webflow Last Updated | Conflict tracking |
| Webflow Created On | Audit |
| Webflow CMS Status | draft / published / archived |
| Last Synced At | Freshness |

## Setup

### 1. Airtable personal access token

Create a PAT with scopes:

- `data.records:read`
- `data.records:write`
- `schema.bases:read`
- `schema.bases:write`

**Enable base `appux7Z1wivZRMNlr`** on the token (required — 403 without it).

### 2. Webflow Data API token

Needs scopes: `cms:read`, `cms:write`, `assets:read`, `assets:write`.

### 3. Local development

Copy [`.env.example`](.env.example) to **`.dev.vars`**:

```bash
WEBFLOW_DATA_API_TOKEN=...
WEBFLOW_SITE_ID=68b3cf2c25982ab007b0152a
AIRTABLE_API_KEY=pat...
AIRTABLE_BASE_ID=appux7Z1wivZRMNlr
SYNC_SECRET=your-random-secret
```

```bash
npm install
npm run dev
```

### 4. Deploy

```bash
npx wrangler secret put WEBFLOW_DATA_API_TOKEN
npx wrangler secret put AIRTABLE_API_KEY
npx wrangler secret put SYNC_SECRET
npm run deploy
```

KV namespace `WEBFLOW_AIRTABLE_SYNC_STATE` is configured in [`wrangler.toml`](wrangler.toml).

## API

| Route | Description |
|-------|-------------|
| `GET /health` | Webflow + Airtable connectivity, schema drift |
| `POST /sync` | Run sync (`Authorization: Bearer $SYNC_SECRET`) |
| `POST /sync?full=1` | Force full sync (bypass change probe) |
| `POST /sync?schema=1` | Schema drift check / table provisioning only |
| `POST /sync?collection=event` | Single collection by slug |

## Initial seed

After deploy and PAT setup:

```bash
curl -X POST "https://creativewaco-webflow-airtable-sync.josh-837.workers.dev/sync?full=1" \
  -H "Authorization: Bearer $SYNC_SECRET"
```

## Transition notes

- **Pause Flowtable Event Sync** (base `appyW67qAxbJpLPEm`) once this base is live — avoid two Airtable bases writing Events.
- **Sunset Culturalyst → Webflow** separately; `culturalyst-*` CMS fields sync as normal Airtable columns.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Airtable 403 on `/health` | Add base `appux7Z1wivZRMNlr` to PAT; verify schema write scopes |
| Cron not running | Cloudflare dashboard → Workers → Triggers → Past Events |
| Images fail upload | Confirm `assets:read` / `assets:write`; check worker logs for optimization errors |
| Reference fields empty | Run a second full sync after all tables exist (linked tables must sync first) |

## GitHub

https://github.com/Creative-Waco/webflow-airtable-sync
