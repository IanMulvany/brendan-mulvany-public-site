## Search Optimization Overview

We are evolving the public photo archive to deliver sub-10 ms search on Turso/SQLite while keeping ingestion lightweight. The upgrade focuses on:

- **Narrow primary tables** so hot rows remain memory-resident.
- **Normalized metadata** (descriptions, rolls, people, tags) for selective indexes and low-cost joins.
- **FTS5 indexing** that combines captions, batch notes, tags, and people in a single searchable corpus.
- **Prepared, covering queries** that fetch scenes + current image versions without N+1 lookups.
- **Edge-friendly caching**: precomputed facet metadata and static JSON snapshots so the frontend avoids re-querying the database for common views.

### Current Architecture
- `scenes`: minimal columns (id, batch, filename, capture date, timestamps).
- `scene_descriptions`, `scene_metadata`, `scene_tags`, `scene_people`: hold large text and multi-valued attributes.
- `scene_search_index` view + `scene_search_fts` virtual table: feed FTS5 with normalized data, including tags/people.
- Updated data access layer (`database.py`) pulls search results via a single SQL query that joins current image versions.

### Migration Strategy
1. **Baseline & backups**: Dump the existing database (`turso db dump` or `sqlite3 .dump`) before any structural change.
2. **Dry run locally**: Execute `uv run python migrate_to_normalized_schema.py --db-path <local.db> --vacuum` to confirm the schema/migration on a copy.
3. **Turso migration**: Run the same script against the Turso instance (`--turso-url/--turso-token`). The script:
   - Populates the new normalized tables from legacy columns.
   - Rebuilds the FTS index via the materialized view.
   - Optionally compacts the legacy `scenes` table (`--compact-scenes`) once the application code is using the new structure.
4. **Cache refresh**: Call `get_search_metadata_snapshot(refresh=True)` (or run the helper snippet in the deployment checklist) and publish the resulting JSON to R2/Vercel for fast initial loads.
5. **Smoke tests**: Hit `/api/public/search` with representative queries, verify facets, confirm image URLs, and benchmark query latencies.

### Risks & Mitigations
| Risk | Impact | Mitigation |
| --- | --- | --- |
| Migration script misses data (e.g., people/tags not mapped) | Missing facets / incomplete search results | Script generates from existing tables; run on staging first, compare counts (`scene_people`, `scene_tags`, FTS row counts). |
| FTS not refreshed after ingestion | Stale search results | Triggers cover `scenes`, `scene_metadata`, `scene_descriptions`, `scene_tags`, `scene_people`. Batch sync clears cached metadata automatically. |
| Large captions slowing queries | Higher I/O, slower scans | `scene_descriptions` keeps captions out of the narrow `scenes` table; FTS handles text search. |
| Turso replica inconsistency during writes | Temporary stale reads | Turso WAL handles replication; batch writes grouped in transactions; consider read-after-write delays when verifying immediately. |
| Cache serving stale facets | Incorrect counts in UI | Metadata cache expires every 5 minutes; force refresh after bulk updates. |
| Client code expecting old columns on `scenes` | Runtime errors post-compact | Leave legacy columns until deployment verified; only run `--compact-scenes` after application code proves stable. |

With these pieces in place, Turso becomes the single source of truth for fast, filtered search while keeping ingestion and pagination predictable.

