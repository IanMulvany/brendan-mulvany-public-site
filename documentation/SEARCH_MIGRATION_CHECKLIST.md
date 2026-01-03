# Search Migration Checklist (Legacy -> Normalized)

Goal: enable fast FTS search on Turso/SQLite while minimizing impact on the
current static build + public site.

## Phase 0: Baseline and backups
- Snapshot current Turso schema and data.
  - `turso db shell <db-name> ".schema"`
  - `turso db dump <db-name> > turso_dump.sql`
- Snapshot local DB.
  - `sqlite3 public_site.db ".schema"`
  - `sqlite3 public_site.db ".dump" > local_dump.sql`
- Record baseline counts (for later validation):
  - `SELECT COUNT(*) FROM scenes;`
  - `SELECT COUNT(*) FROM image_versions WHERE r2_key IS NOT NULL;`
  - `SELECT COUNT(*) FROM scenes_fts;`

## Phase 1: Add normalized schema (keep legacy intact)
- Apply `schema.sql` to local SQLite (adds normalized tables + scene_search_fts).
- Apply `schema.sql` to Turso (same additions).
- Do NOT drop or modify legacy tables/columns (`scenes`, `scenes_fts`).

## Phase 2: Backfill normalized tables + FTS
- Run migration locally:
  - `uv run python migrate_to_normalized_schema.py --db-path public_site.db --vacuum`
- Run migration on Turso:
  - `uv run python migrate_to_normalized_schema.py --turso-url ... --turso-token ...`
- Validate counts:
  - `SELECT COUNT(*) FROM scene_descriptions;`
  - `SELECT COUNT(*) FROM scene_metadata;`
  - `SELECT COUNT(*) FROM scene_search_fts;`
  - Spot-check a few scene_ids match expected data.

## Phase 3: Update ingestion to keep normalized tables fresh
- Update `PublicSiteDatabase.batch_sync_scenes` to upsert into:
  - `scene_descriptions`, `scene_metadata`, `scene_tags`, `scene_people`
- Keep legacy `scenes` writes intact to preserve existing build behavior.
- Ensure FTS triggers fire on both schemas.

## Phase 4: Switch reads to normalized search
- Update search queries to use `scene_search_fts` + joins.
- Update `build_static.py` to read from normalized tables (or the view).
- Confirm `/search` and API endpoints return results + facets.

## Phase 5: Optional cleanup (only after stability)
- Run `--compact-scenes` to drop legacy text columns.
- Remove legacy FTS usage only after full verification.

## Vercel-safe guardrails
- Keep `scenes` + `scenes_fts` until Vercel build and pages are verified.
- Avoid schema changes that remove columns used by `build_static.py`.

## Local testing checklist
- `uv run python main.py` with `PUBLIC_DB_PATH=./public_site.db`
- `curl http://localhost:8000/api/public/search?q=example`
- Open `/search` and confirm results + facets
