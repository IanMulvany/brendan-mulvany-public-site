# Full archive Cloudflare preview

The preview at https://new.brendan-mulvany-photography.com/ includes **1,383
photographs across 74 collections**. Every photo ID and original image URL was
verified against the current public rolls index and all 74 live roll pages.
The live and local publication inventories matched. Verification took place on
13 September 2026; the existing site's recorded build date was 26 April 2026.

The collection directory is https://new.brendan-mulvany-photography.com/collections/.
The original three collection and all existing preview photo URLs are preserved;
additional collections use `roll-<original-roll>` slugs.

Deployment: `f5355d7d-f822-4b24-852d-09a2545d2a63`. Cache namespace:
`2026-09-13-full-v1`. Cloudflare reported a 5 ms Worker startup and a 5.26 KiB
bundle (2.07 KiB gzip).

## Content and storage

- 1,363 published final crops and 20 published scans. The existing exclusion,
  photo `261093582`, remains absent. No other current public database photographs
  fall outside the verified publication inventory.
- **No images are generated, copied, uploaded or transformed.** HTML uses existing
  CDN thumbnail, small and large WebP/AVIF URLs. All 60 existing WebP variants for
  the 20 scans returned HTTP 200 in metadata-only checks. Python's default HTTP
  client received 403; normal curl requests succeeded. No image files were saved.
- Descriptions and public contextual metadata come from published pages. The
  source SQLite file is queried through a disposable copy and remains unchanged.
  No user, annotation, credential or local-path fields are exported.
- Generated manifest: 2,934,925 bytes. Seed SQL: 2,705,255 bytes. These are local
  build inputs, excluded from both Git and the deployed static assets.
- Remote D1 after import: **9,273,344 bytes**, including the full-text index.
  The local SQLite test database measured 13,512,704 bytes; this is a separate
  local measurement, not the deployed database size.
- The full database is `brendan-mulvany-preview-full`, UUID
  `6d3afe2d-34ec-4193-98ca-6cef32e699e5`, primary region WEUR. Read replication is
  enabled (`auto`) and the Worker uses D1 Sessions for replica reads.
- The original 114-photo D1 database was retained for rollback. The full index
  was imported and checked separately before switching the Worker binding and
  static pages together. The main Vercel site and Turso database were not changed.

## Serving and rendering

The build produces 1,464 HTML pages and 1,468 files in total. HTML totals
10,314,255 bytes; each visitor downloads only the pages they visit.

| Asset/page | Decoded bytes |
| --- | ---: |
| Homepage | 9,075 |
| First collection-directory page | 42,439 |
| Search HTML | 8,948 |
| CSS | 13,103 |
| Search JavaScript | 7,908 |

The homepage keeps three featured collections. The directory has four pages of
up to 24 collections. Gallery pages are bounded at 48 photographs; the largest
current collection has 43. Static pagination also works for larger collections:
a temporary 97-photo fixture verified three pages and navigation across both
boundaries. All internal links, image source attributes and noindex metadata were
checked across the complete generated site.

Browsing works without JavaScript or database requests. Search alone loads the
small JavaScript module. Responsive source sizes, lazy loading, fixed image boxes
and limited high-priority images are retained. Published date anomalies remain in
individual metadata; the global footer avoids claiming an unreliable year span.

## Search validation

All 11 automated tests pass. Tests independently compare the export with the full
public roll inventory, rather than accepting whatever the manifest happens to
contain. Browsing covers all 1,383 IDs exactly once across 58 pages: page 58 has
15 photos and page 59 is empty. Every collection is isolated and retrievable by
its roll number. The seven-field result payload, description matching, AND/prefix
semantics, Unicode handling and input bounds are checked.

The 100-page search bound accommodates 2,400 photographs. A capacity test fails
if future publication exceeds that limit, prompting a deliberate pagination
update. Collection queries use `(collection_id, id)`; text queries use FTS5 and
primary-key lookups. The deterministic rank/ID tie sort remains appropriate at
this size. Remote verification confirmed 1,383 rows, 74 collections, zero rows for
the excluded ID and 111 full-archive matches for the prefix query `pope`.

Live verification made 214 successful requests: all 58 search pages, all 74
collection filters and 82 static pages. Every returned photo ID, collection,
title and image URL matched the manifest. The browser also returned all 20 scans
for roll `6000` and visibly loaded their existing WebP images. The generated
verification record is `data/deployment-verification.json`.

The initial [114-photo measurements](PERFORMANCE.md) are historical. Full-archive
measurements below describe the expanded dataset. One-client response timings
are not Core Web Vitals, global traffic measurements, or proof of a causal hosting
improvement: the preview's AND/prefix search semantics differ from Vercel's search.

## Live comparison

Measured at 22:09 UTC on 13 September 2026. Seven sequential requests per
endpoint, from one client without throttling,
produced 84 HTTP 200 responses. The first observed request is not a guaranteed
cold start. Warm medians use the remaining six samples.

| Endpoint | Preview first | Preview warm median | Vercel warm median |
| --- | ---: | ---: | ---: |
| Homepage | 127.9 ms | 25.0 ms | 24.6 ms |
| Pope collection | 56.8 ms | 23.6 ms | 25.8 ms |
| Search `pope` | 284.6 ms | 27.7 ms | 918.8 ms |
| Search `football` | 53.5 ms | 29.0 ms | 916.8 ms |
| Search `1979` | 52.6 ms | 30.6 ms | 906.4 ms |
| Search `pope ireland` | 50.6 ms | 23.7 ms | 921.7 ms |

All four initial preview searches were cache MISS; D1 execution took 1.32, 2.13,
1.69 and 0.97 ms respectively. All 24 warm preview searches were HIT, avoiding a
database query. All 28 Vercel search responses reported MISS. The first preview
search was substantially slower than the other first misses; no global cold-start
or tail-latency claim is made from this small run.

Static endpoint latency was similar in this run. The homepage transfers 9,075
decoded HTML bytes instead of Vercel's 122,215; the Pope collection transfers
64,707 instead of 121,549. This does not include image transfers or rendering.
Raw observations, including first page responses and cache headers, are preserved
in generated `data/full-archive-benchmark.json`.
