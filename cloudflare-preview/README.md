# Cloudflare archive preview

Live at https://new.brendan-mulvany-photography.com/ — a separate Workers + D1
trial of three collections from the public archive:

| Collection | Roll | Photos |
| --- | --- | ---: |
| The Pope’s visit | 3071 | 43 |
| Ireland at Wembley | 4083 | 36 |
| The French Grand Prix | 5005 | 35 |

The Vercel site and Turso database remain the production system. This preview has
no account, annotation, upload, or write API. Photos use the existing public R2
CDN. Only public metadata for the selected 114 photos goes into its own D1 DB.
Every photo ID and URL is checked against the published roll pages by the exporter.
Existing machine-generated descriptions can contain historical inaccuracies;
they remain searchable but are labelled on photo pages.

## Local run

Requires Node 24+, Python 3.9+, the existing `../public_site.db`, and the existing
static build in `../public/`. No Turso credentials are needed.

```sh
npm ci
python3 scripts/export-sample.py --verify-live-origin https://www.brendan-mulvany-photography.com
npm run build
npm run types
npm run check
npm test
npm run db:local
npm run dev -- --port 8787
```

Open http://localhost:8787. The manifest and SQL under `data/`, local D1 state,
and `dist/` are generated and excluded from Git. Export stops if the approved
photo count or its published URLs change, so updating the sample requires review.
The source must be a stable checkpointed offline SQLite file: active WAL/journal
files cause export to stop. SQLite queries run on a disposable copy, preserving
the source file and avoiding read-only WAL compatibility problems.

## Deployment

The preview uses the `ian@mulvany.net` Cloudflare account and the confirmed domain
`new.brendan-mulvany-photography.com`. Wrangler config records the dedicated D1
ID and account ID; these identifiers are not credentials. The database is located
in Western Europe (AMS observed during verification), with global read replication
enabled. The Worker uses D1 Sessions to allow reads from available replicas.

For an update:

```sh
npx wrangler whoami
python3 scripts/export-sample.py --verify-live-origin https://www.brendan-mulvany-photography.com
npm run build
npm run types
npm run check
npm test
npm run db:remote
npx wrangler deploy --dry-run
npx wrangler deploy
npm run benchmark -- https://new.brendan-mulvany-photography.com
```

Verify that `whoami` shows `ian@mulvany.net` before remote commands. If using a
named profile, activate it for this directory or append `--profile YOUR_PROFILE`
to Wrangler commands. Increment `CACHE_VERSION` whenever reseeding, and deploy
static pages and the search snapshot together. The seed replaces only this preview
DB's photo snapshot and rebuilds FTS. It never connects to Turso.

The custom domain binds only `new`. The main site, `www`, and CDN continue using
their existing configuration. Read replication is configured on the D1 database
(`read_replication.mode: auto`), separately from Wrangler's binding configuration.
It can be verified with `npx wrangler d1 info DB --json`.

## Speed choices and limits

- Static HTML for home, collections and details: no database call or JavaScript
  is needed to paint or browse. No framework or external font download.
- Hashed CSS/JS, CDN WebP-first image variants with AVIF fallback, fixed image boxes,
  lazy images below the fold.
  Large originals are never part of the initial page load.
- Search uses one bound FTS5 query, relevance ordering, prefix matching, and a
  collection index. Words are joined with AND; the old search uses OR, so some
  multiword results differ deliberately. No fuzzy spelling or semantic search.
- The API fetches 25 rows for a 24-photo page, avoiding separate count/facet
  queries. Input length, token count and page range are bounded. Only fields used
  by result cards are returned; full descriptions remain indexed and live in
  static detail pages. This cuts result payloads by about 63% before compression.
- A 180 ms debounce and request cancellation prevent obsolete results appearing.
- Search responses use a five-minute, per-data-centre Cache API entry. Cached
  database durations are historical; the UI labels cached responses and reports
  current browser request duration separately. Search fetches bypass the browser's
  HTTP cache to make this measurement useful.
- Increment `CACHE_VERSION` in Wrangler config whenever reseeding. This selects a
  new cache namespace. Static pages and search must be built from the same sample.
- All preview pages and API responses have `noindex`; `robots.txt` disallows
  crawling. This is a public trial, not password-protected private storage.

A 114-photo trial tests usability and deployment; it cannot establish full-archive
performance, multi-region latency, production traffic capacity, or Core Web Vitals.
Compare an equal-sized dataset and representative traffic before migrating.

## References

- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [D1 SQL and FTS5 support](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 read replication and sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
