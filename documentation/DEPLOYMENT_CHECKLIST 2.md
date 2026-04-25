## Turso Search Deployment Checklist

This repository now ships with a normalized schema and FTS-backed search tuned for Turso/SQLite. Use the following checklist during deployments or large metadata ingestion jobs.

### Turso Sync Terminology

This project does not use Turso database sync, embedded replicas, or the new `@tursodatabase/sync`/`pyturso` push-pull APIs. The "sync" code in this repo is application-level ingestion: a management workflow sends scene metadata to the public-site API, which batch-upserts rows into the production database and records the ingest in `sync_log`.

For the Vercel public-site deployment, prefer direct remote Turso access. Turso database sync would only be worth revisiting if the public site needs a durable local database with offline/local-first writes.

### 1. Schema + Data Migration
- Back up the production database `turso db dump <db-name>`.
- Run the migration locally first:  
  `uv run python migrate_to_normalized_schema.py --db-path public_site.db --vacuum`
- Migrate Turso (requires `libsql_experimental`):  
  `uv run python migrate_to_normalized_schema.py --turso-url "$TURSO_URL" --turso-token "$TURSO_TOKEN" --vacuum`
- After verifying the new tables, optionally compact the legacy `scenes` table:  
  `uv run python migrate_to_normalized_schema.py ... --compact-scenes`
- Regenerate cached metadata JSON for the CDN (see **Cache Refresh** below).

### 2. Turso Remote Database Placement
- Keep one primary in the same region as the ingestion pipeline.
- Add read replicas close to primary viewers, for example:  
  ```bash
  turso db locations set archive-db primary-region
  turso db locations add archive-db london
  turso db locations add archive-db frankfurt
  ```
- Confirm replication status: `turso db replicas archive-db`.

### 3. WAL & Performance Pragmas
- Turso enables WAL mode automatically, but double-check when running locally:  
  `sqlite3 public_site.db "PRAGMA journal_mode=WAL;"`.
- Ensure `PRAGMA synchronous = NORMAL` for local SQLite files used in development or migration checks.
- For heavy ingestion, wrap batches with the new normalized `batch_sync_scenes` to keep write locking minimal and automatically invalidate cached metadata.

### 4. Cache Refresh Workflow
- The API exposes `PublicSiteDatabase.get_search_metadata_snapshot()`, which caches roll/date/batch facets for 5 minutes.
- After any bulk ingest or migration, refresh the cache to keep the CDN snapshot warm:
  ```bash
  uv run python - <<'PY'
  from database import PublicSiteDatabase
  from pathlib import Path

  db = PublicSiteDatabase(db_path=Path("public_site.db"))
  snapshot = db.get_search_metadata_snapshot(refresh=True)
  print("Facet cache refreshed:", snapshot["total_scenes"], "scenes")
  PY
  ```
- Persist the snapshot to R2 or Vercel Edge Functions for instant page-loads (example tooling lives in `storage.py`).

### 5. Smoke Tests
- Run compile checks: `uv run python -m compileall database.py main.py`.
- Exercise the search API locally: `uv run python - <<'PY' ...` to ensure FTS queries return results and include current image versions.
- Verify the `/api/public/search` endpoint returns cached facets (no DB hit) when no filters are applied.

Following this checklist keeps Turso search latency low while ensuring caches and public-site metadata stay aligned after ingestion.
