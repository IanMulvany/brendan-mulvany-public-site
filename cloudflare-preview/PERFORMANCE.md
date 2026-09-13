# Live Cloudflare preview — 13 September 2026

The preview is live at https://new.brendan-mulvany-photography.com/ with three
collections and 114 photographs. It uses a Cloudflare Worker, static assets,
and a dedicated D1 SQLite full-text index with its primary in Western Europe.
Global D1 read replication is enabled and the Worker uses Sessions to allow
replica reads. The original Vercel/Turso site remains available.

Initial benchmark deployment: `25cd33bd-5f06-498c-99e8-a5529b46b883`.
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
| Homepage | 137 ms | 24 ms | 113 ms | 34 ms |
| Collection 3071 | 45 ms | 23 ms | 35 ms | 28 ms |
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

Sizes below describe the initial benchmark deployment, before the follow-up
responsive image and search payload improvements.

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

## Follow-up optimizations

Current deployment: `cf900a79-24cd-40c0-b3b2-06f0a3affef3`, cache namespace `v2`.
Worker bundle: 5.23 KiB (2.05 KiB gzip), with a reported 5 ms startup.

- Search now returns only seven fields needed by result cards. For 24-result
  arrays, `pope` fell from 14,091 to 5,185 UTF-8 JSON bytes (63.2%); representative
  French Grand Prix and Wembley arrays fell by 63.5% and 64.1%. These comparisons
  exclude the response envelope and compression. IDs and ordering are identical.
  Full descriptions remain indexed: a live search for `clover`, absent from card
  titles, still finds its photograph and renders its result correctly.
- Responsive image `sizes` now match the actual wrappers, breakpoints and gaps.
  A 390 CSS-pixel viewport has 170-pixel gallery cells. Browser checks show those
  cells selecting the 200w thumbnail at DPR 1.1, whereas the previous sizing chose
  the 800w small variant at DPR 1. High-density displays can still choose larger
  variants as needed. Static and dynamically rendered search cards share the
  sizing contract, and only the first gallery image receives high priority.
- All 120 HTML pages and 232 picture elements passed link and source-attribute
  checks. Updated homepage HTML is 9,028 bytes; CSS remains 12,091 bytes and search
  JavaScript is 7,893 bytes. The longer responsive sizing expressions modestly
  increase HTML while allowing the browser to select appropriate image downloads.
- Global read replication was enabled and verified as `read_replication.mode:
  auto` on the dedicated preview database. Sessions allow replica reads for this
  static snapshot. Global latency benefits have not been measured; the benchmark
  uses one client location. [Cloudflare's replication documentation](https://developers.cloudflare.com/d1/best-practices/read-replication/)
  describes routing and consistency behavior.

The deployed follow-up was measured with seven sequential requests for each of
four queries, using Node HTTPS with keep-alive and Brotli. All 28 responses were
HTTP 200; each first request was MISS and all 24 subsequent requests were HIT.

| Query | First total | First D1 duration | Warm median total |
| --- | ---: | ---: | ---: |
| `pope` | 152 ms | 0.84 ms | 24.1 ms |
| `football` | 82 ms | 0.72 ms | 24.0 ms |
| `1979` | 44 ms | 0.72 ms | 24.5 ms |
| `pope ireland` | 108 ms | 2.76 ms | 25.5 ms |

The complete `pope` response fell from 14,232 decoded bytes to 5,326 (62.6% smaller).
Its first Brotli-encoded response was 564 bytes; all four queries ranged from
546–577 bytes. Every response had exactly 24 results and seven fields per result.
All seven Pope requests matched the previously captured result IDs and ordering.
Raw observations are in generated `data/optimization-benchmark.json`. These use a
different HTTP client from the first benchmark, so timings are descriptive and
cannot isolate the effect of replication or the payload change. No further
requests were made to the Vercel site for this follow-up.

## Correctness and deployment checks

- Every selected photograph and original image URL matched the existing live roll
  pages before export. No users, annotations, credentials or local paths exported.
- The offline exporter validates a stable checkpointed source and queries a
  disposable copy, avoiding a read-only SQLite WAL issue without modifying the
  source file. Active journals or source changes cause export to stop.
- Eleven automated tests pass: real SQLite SQL, pagination, collection isolation,
  year/roll/prefix/AND search, Unicode, input bounds, publication allowlist,
  deterministic public export, repeatable seeding, FTS integrity, and retrieval
  from description text omitted from result payloads.
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
