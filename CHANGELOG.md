# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed

- **Scheduling** — Per-worker cron removed; sync runs daily via `creativewaco-daily-orchestrator`. See `cron/docs/WORKER-SCHEDULING.md`.
- **Deployed to Creative Waco Cloudflare account** — production URL is now `creative-waco.workers.dev`; new KV namespace on account `adf90c1aff577a446a714eae4b9f4859`; removed old worker from Tortoise and Hare Studio account
- **One-way sync only (Webflow → Airtable)** — removed Airtable → Webflow push, image upload, and publish-state writes; Webflow is the source of truth
- Change probe now detects **Webflow item changes and schema drift only** (Airtable edits no longer trigger sync)
- Hourly cron runs full Webflow change detection (removed lightweight probe that skipped Webflow pagination)
- **Webflow CMS Status** field description updated: mirrored from Webflow, read-only (does not push back)
- Webflow API token requirement reduced to **`cms:read`** only
- Removed image optimization dependencies (`@jsquash/*`, `spark-md5`) and Webflow Assets upload code

### Fixed

- Schema sync no longer fails with 422 when **Webflow CMS Status** is already a single-select field

### Added

- **Webflow CMS Status** single-select dropdown (`draft` / `published` / `archived`) on collection tables; existing text columns upgraded on schema sync
- Single-collection sync (`?collection=slug`) fetches only one collection schema in detail (fewer subrequests)

### Fixed

- Per-collection sync no longer overwrites the KV schema fingerprint with incomplete field lists (fixes inflated `/health` schema drift after seeding)

### Removed

- 2-way sync and Airtable-as-source-of-truth conflict resolution
- Airtable → Webflow content push, image optimization, and CMS publish/archive/unpublish API calls

## Initial release

- Webflow → Airtable sync for all CMS collections in base `appux7Z1wivZRMNlr`
- Pre-sync change probe with early exit when nothing changed
- Dynamic schema drift: auto-create Airtable tables for new collections and columns for new Webflow fields
- Endpoints: `GET /health`, `POST /sync` with `full`, `schema`, and `collection` query params
- KV state (`WEBFLOW_AIRTABLE_SYNC_STATE`) for schema fingerprints and per-item Webflow timestamps
- `_Sync Meta` Airtable table for run logs and schema warnings
