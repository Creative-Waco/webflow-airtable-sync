# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed

- `?full=1` now seeds Webflow → Airtable only (skips Airtable → Webflow push during bulk import)
- Hourly cron uses lightweight change probe (Airtable + schema; skips full Webflow item pagination)
- Single-collection sync (`?collection=slug`) fetches only one collection schema in detail (fewer subrequests)

### Fixed

- Avoid subrequest limit errors on full-site sync by documenting per-collection seed workflow
- 2-way sync between all Webflow CMS collections and Airtable base `appux7Z1wivZRMNlr`
- Pre-sync change probe — skips run when Webflow, Airtable, and schema are unchanged
- Airtable as source of truth for conflict resolution
- Dynamic schema drift: auto-create Airtable tables for new collections and columns for new Webflow fields
- Image optimization pipeline (4 MB cap) using `@jsquash/jpeg` / `@jsquash/resize` before Webflow Assets upload
- Endpoints: `GET /health`, `POST /sync` with `full`, `schema`, and `collection` query params
- KV state (`WEBFLOW_AIRTABLE_SYNC_STATE`) for schema fingerprints and per-item Webflow timestamps
- `_Sync Meta` Airtable table for run logs and schema warnings
