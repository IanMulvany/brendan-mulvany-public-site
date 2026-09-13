# Cloudflare archive preview

A separate Workers + D1 trial of three collections from the public archive:

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

## Deployment

Deploy to the Cloudflare account that owns `brendan-mulvany-photography.com`.
The BMJ credentials present during development do not have that zone; do not use
that account as an accidental substitute. The zero UUID in `wrangler.jsonc` is a
local-development placeholder and must be replaced with the new D1 database ID.

1. Authenticate Wrangler to the correct account (a separate named profile can
   preserve other projects' login). Verify its account and zone before creating
   resources. `wrangler auth list` lists existing profiles.
2. Create **one new** D1 database named `brendan-mulvany-preview`, with a Western
   Europe location hint: `npx wrangler d1 create brendan-mulvany-preview --location weur`.
   If using a named profile, append `--profile YOUR_PROFILE` to Wrangler commands.
3. Set `account_id` and the returned `d1_databases[0].database_id` in
   `wrangler.jsonc`. The user confirmed this custom domain, now included in the config:
   `"routes": [{"pattern": "new.brendan-mulvany-photography.com", "custom_domain": true}]`.
   Inspect any existing record for `new` first; preserve the apex, `www`, and CDN.
4. Run `npm run db:remote` (or its two Wrangler commands with the named profile).
   Seed only the dedicated preview DB. The seed replaces its photo snapshot,
   rebuilds FTS, and is repeatable. It never connects to Turso.
5. Run `npm run build`, `npm run check`, `npm test`, and
   `npx wrangler deploy --dry-run`, then `npx wrangler deploy` with the same profile.
6. Verify HTTPS, all three collections, a detail page, search and paging at the
   custom domain. Test a second identical search to confirm `X-Search-Cache: HIT`.
   The Worker uses D1 Sessions so it can use read replicas if enabled in D1.
   Replication is optional for this trial; do not assume it is enabled by default.
7. Run `npm run benchmark -- https://new.brendan-mulvany-photography.com` and save
   the observed results. Do not call localhost measurements Cloudflare latency.

## Speed choices and limits

- Static HTML for home, collections and details: no database call or JavaScript
  is needed to paint or browse. No framework or external font download.
- Hashed CSS/JS, CDN image variants, fixed image boxes, lazy images below the fold.
  Large originals are never part of the initial page load.
- Search uses one bound FTS5 query, relevance ordering, prefix matching, and a
  collection index. Words are joined with AND; the old search uses OR, so some
  multiword results differ deliberately. No fuzzy spelling or semantic search.
- The API fetches 25 rows for a 24-photo page, avoiding separate count/facet
  queries. Input length, token count and page range are bounded. Only a short
  description excerpt is returned; full metadata lives in static detail pages.
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
