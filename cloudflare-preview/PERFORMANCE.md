# Live Cloudflare preview — 13 September 2026

The preview is live at https://new.brendan-mulvany-photography.com/ with three
collections and 114 photographs. It uses a Cloudflare Worker, static assets,
and a dedicated D1 SQLite full-text index in Western Europe. D1 read replication
is disabled for this trial. The original Vercel/Turso site remains available.

Deployment version: `25cd33bd-5f06-498c-99e8-a5529b46b883`.
Worker name: `brendan-mulvany-cloudflare-preview`.
D1: `brendan-mulvany-preview`, 782,336 bytes after import.
Cloudflare reported a 5 ms Worker startup time and a 5.30 KiB bundle (2.09 KiB gzip).

## Live comparison

Measured at 21:39 UTC on 13 September 2026 from one development machine, with
seven sequential GET requests per endpoint, no throttling and a 20-second timeout.
All 84 requests returned HTTP 200. Initial means first observed in this run, not
necessarily a cold provider process. Warm statistics use the following six
requests; medians average the middle two values.

| Endpoint | Preview initial | Preview warm median | Existing site initial | Existing warm median |
| --- | ---: | ---: | ---: | ---: |
| Homepage | See raw observations | 24 ms | See raw observations | 34 ms |
| Collection 3071 | See raw observations | 23 ms | See raw observations | 28 ms |
| Search `pope` | 282 ms | 25 ms | 3,353 ms | 925 ms |
| Search `football` | 69 ms | 25 ms | 994 ms | 901 ms |
| Search `1979` | 65 ms | 23 ms | 916 ms | 942 ms |
| Search `pope ireland` | 48 ms | 26 ms | 1,011 ms | 939 ms |

All four initial preview searches were confirmed Cache API MISS responses. Their
D1 query durations were 6.40, 2.98, 3.35 and 1.18 ms respectively. All subsequent
preview searches were confirmed HIT responses, with 3–6 ms reported Worker time
and no database query. Existing search responses consistently reported Vercel
MISS. Cache entries are local to the serving Cloudflare data centre.

These are response-transfer timings, excluding typing delay, rendering and image
loads. Raw observations are in generated `data/benchmark.json`. The benchmark
script now computes even-sized medians correctly; existing observations were
recalculated from their raw samples without repeating or replacing requests.
The six-request warm sample is too small for a robust tail-latency estimate.

The preview searches 114 photographs rather than the full archive, uses AND/prefix
matching rather than exact-token/OR matching, and omits total counts and facets.
The results demonstrate this trial's behavior; they do not establish that moving
the unchanged full site would produce the same improvement. An equal-data,
equal-query comparison and representative multi-region traffic are needed before
choosing a production migration. No Lighthouse or Core Web Vitals claim is made.

## Pages and images

- Homepage HTML: 7,712 decoded bytes versus 122,215 bytes (93.7% smaller).
- Pope collection HTML: 49,701 bytes versus 121,549 bytes.
- CSS: 12,091 bytes; search JavaScript: 7,802 bytes, loaded only on search pages.
  Browsing and photo detail pages render and work without JavaScript.
- Hashed CSS/JS have a verified one-year immutable cache policy. HTML revalidates.
- All 120 checked CDN image URLs returned HTTP 200. GET responses have a four-hour
  browser cache lifetime; repeat GETs are Cloudflare HIT. HEAD responses omitted
  those cache headers, so GET was used to verify actual cache behavior.
- For three representative covers, WebP small images totalled 108 KB versus
  203 KB AVIF; large WebP totalled 561 KB versus 1,092 KB AVIF. The preview therefore
  prefers WebP and keeps AVIF fallback. This measures bytes, not equal visual
  quality. Derivative targets are 200/800/1600 pixels, capped by original size.
- Fixed image boxes, lazy loading and responsive derivatives reduce loading work
  and layout movement. Large originals are not part of initial page loads.

Image observations are in generated `data/image-health.json` and `data/cdn-get.json`.

## Correctness and deployment checks

- Every selected photograph and original image URL matched the existing live roll
  pages before export. No users, annotations, credentials or local paths exported.
- The offline exporter validates a stable checkpointed source and queries a
  disposable copy, avoiding a read-only SQLite WAL issue without modifying the
  source file. Active journals or source changes cause export to stop.
- Ten automated tests pass: real SQLite SQL, pagination, collection isolation,
  year/roll/prefix/AND search, Unicode, input bounds, publication allowlist,
  deterministic public export, repeatable seeding and FTS integrity.
- TypeScript validation and deployment dry run pass. Live D1 counts are 43,36,35.
- Live HTTPS smoke tests pass for all collections, paging, filters, malformed
  input, unsupported methods, API/static404, noindex and hashed-asset caching.
- Live browser search returned photographs with a cached timing label. Opening
  a result loaded its WebP and full detail page successfully. Mobile layout and
  previous/next navigation were checked locally at 390×844 without overflow.
- The FTS query plan uses the virtual full-text index and primary-key photo
  lookups; deterministic ranking ties still require a temporary sort. Collection
  browsing uses `(collection_id, id)`.

The trial is intentionally public and marked noindex, with no write endpoints.
It is a deployment and usability trial, not a full archive migration.
