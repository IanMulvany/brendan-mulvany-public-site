# Preview validation — 13 September 2026

The Cloudflare implementation is complete and tested locally. Deployment is
pending access to the Cloudflare account holding the photography domain. The
initial Wrangler default profile belonged to BMJ and its zone lookup returned no
`brendan-mulvany-photography.com` or `brendan-mulvany-photogrophy.com` zone. No remote
Worker, D1 database, DNS record, Vercel configuration or Turso data was changed.

## Existing site: measured HTTP responses

Measured from this development machine, 7 sequential GET requests per endpoint,
20-second timeout, 13 September 2026. All 35 requests returned HTTP 200 with gzip.
“Initial” means first observed in this run; it does not establish a cold origin.
The median and observed p95 use the subsequent 6 requests. Six samples provide
only a rough tail estimate, not a robust performance percentile.

| Endpoint | Initial total | Subsequent median | Observed p95 |
| --- | ---: | ---: | ---: |
| Homepage | 75 ms | 78 ms | 96 ms |
| Roll 3071 | 77 ms | 68 ms | 81 ms |
| Search `pope` | 3,004 ms | 950 ms | 1,009 ms |
| Search `football` | 967 ms | 956 ms | 1,925 ms |
| Search `1979` | 1,073 ms | 955 ms | 1,196 ms |

Pages consistently reported Vercel HIT; search reported MISS. Measurements exclude
rendering, images and typing delay. Search requested `limit=24`. Raw results are
in generated `data/baseline.json`.

Current code opens a remote Turso connection for each request, performs separate
result/count/facet queries sequentially, and the search UI has a 500 ms debounce.
These are confirmed implementation differences, not a measured attribution of
latency to a particular provider. D1 deployment must be measured before choosing
a production migration.

## Preview: implementation and local checks

- Homepage HTML is 6,541 bytes versus 122,215 bytes for the existing homepage:
  94.6% smaller uncompressed. Locally gzipped: 1,662 versus 11,381 bytes. This
  reflects reduced content and embedded metadata as well as a smaller UI.
- CSS is about 12 KB; search JavaScript about 7.7 KB, loaded only on search pages.
  Browsing and photo detail pages need no JavaScript. Worker upload in the dry run
  was 5.30 KiB / 2.09 KiB gzip.
- Existing CDN variants verified: thumbnail 200 px, small 800 px, large 1600 px.
  Images use responsive AVIF/WebP and reserved boxes; originals are not loaded.
- Local D1 full-text query plan uses the FTS virtual index plus primary-key photo
  lookups. Ordering equal-rank results deterministically still uses a temporary
  sort. Collection browsing has a `(collection_id, id)` index.
- One local `french` search: initial 34 ms total, subsequent cache hits about
  2–4 ms. These are localhost emulator timings, **not deployed Cloudflare speed**.
- 10 automated tests pass: real SQLite query execution, pagination, public-only
  export, publication allowlist, repeated seed, Unicode, input validation and
  collection/year/roll/prefix/AND search.
- TypeScript validation and Cloudflare deployment dry run pass. Local Workers+D1
  HTTP checks pass for paging, filters, cache/HEAD, input errors, unsupported
  methods, API404, static404 and noindex headers.
- Browser checks pass for desktop search and paging; mobile collection/detail
  at 390×844 have no horizontal overflow and working previous/next navigation.

This is a 114-photo trial, whereas the existing site searches the wider archive.
Preview prefix/AND search also differs from the existing exact-token/OR search.
No equal-dataset comparison, deployed D1 benchmark, multi-region test or Core Web
Vitals/Lighthouse claim has been made. Run the benchmark again against the real
custom domain after deployment; use equal data and representative traffic before
a full migration.
