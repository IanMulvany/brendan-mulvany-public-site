# Cloudflare archive preview

Preview URL: https://new.brendan-mulvany-photography.com/ — a separate Workers + D1
version of the full published archive: 1,383 photographs across 74 collections.
Administrators can choose and order one to six homepage albums; the original three
remain until a selection is saved. The collection directory exposes the complete
archive with 24 collections per page.

The Vercel site and Turso database remain the production system. This preview now
includes verified accounts, comments, likes, person annotations, newsletter signup
and administration; see [COMMUNITY.md](COMMUNITY.md) for use and operations.
Photos use the existing public R2 CDN. No images are generated, uploaded, copied,
or transformed by this project. Public archive metadata remains in its D1 snapshot.
The separate community D1 stores accounts and contributions plus a searchable copy
of public metadata combined with visible annotation names and notes.
Every photo ID and URL is checked against the published roll pages by the exporter.
Existing machine-generated descriptions can contain historical inaccuracies;
they remain searchable but are labelled on photo pages.

## Existing public addresses

Photo pages use `/image/{id}/` and galleries use `/roll/{roll}/`, matching the
Vercel archive. Roll names are preserved verbatim, including `misc-*` and `r-9002`.
The original `/years/`, `/year/{year}/`, `/batches/`, and `/about/` pages are also
available. Year membership comes from the same published photo metadata; historical
metadata anomalies are retained rather than silently corrected by this change.

Earlier preview photo links under `/photos/{id}/`, and original alternate links
under `/image_detail/{id}/`, permanently redirect to `/image/{id}/`. Preview
collection links redirect to the corresponding original roll URL. `/rolls/`
redirects to the collection directory and `/search.html` to `/search/`. Query
strings survive redirects; no fragment is set so browser-held anchors such as
`#community` remain intact. Static assets handle bare and `index.html` spellings
of page URLs. Internal links use the final trailing-slash addresses directly.
The generated `_redirects` file uses six dynamic photo rules and bounded static
collection rules, with a build-time limit check. Photo/gallery pages remain static;
no additional Worker or database lookup is needed for canonical image pages.
Photo IDs, D1 rows, community contributions and CDN image URLs do not change.

Switching the main hostname is a separate deployment. DNS currently resolves
both the apex and `www` to Vercel, while Cloudflare already manages the nameservers.
Before cutover, inspect and record the actual DNS records for rollback, replace
the Vercel records with Worker Custom Domains, and choose one canonical hostname
with a redirect from the other. Cloudflare provisions DNS and certificates for
Custom Domains; existing CNAME records must first be removed if present. Public
DNS alone cannot distinguish an A record from a flattened CNAME.
Update `PUBLIC_ORIGIN`, hostname redirects, canonical links/sitemap and crawler
settings together; remove the preview branding and links back to the original.
Users sign in again on the main hostname because sessions are host-scoped.
Keep Vercel available for rollback and leave the CDN and mail records intact.
This route update deploys only to `new` and retains its noindex settings.

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
npm run community:local
npm run search:sync:local
npm run dev -- --port 8787
```

Set a development `AUTH_SECRET` and `PUBLIC_ORIGIN=http://localhost:8787` in the
ignored `.dev.vars` file as described in [COMMUNITY.md](COMMUNITY.md).
Open http://localhost:8787. The manifest and SQL under `data/`, local D1 state,
and `dist/` are generated and excluded from Git. The legacy filenames
`scripts/export-sample.py` and `data/sample.json` now represent the complete
published archive. Export validates publication membership and URLs before
writing data; the explicit `skip_images.md` exclusion remains in force.
The source must be a stable checkpointed offline SQLite file: active WAL/journal
files cause export to stop. SQLite queries run on a disposable copy, preserving
the source file and avoiding read-only WAL compatibility problems.

## Deployment

The preview uses the `ian@mulvany.net` Cloudflare account and the confirmed domain
`new.brendan-mulvany-photography.com`. Wrangler config records the dedicated D1
ID and account ID; these identifiers are not credentials. The archive snapshot is
located in Western Europe with global read replication enabled. Search now reads
the COMMUNITY primary on cache misses so annotation changes do not lag on replicas.

The full archive uses `brendan-mulvany-preview-full`
(`6d3afe2d-34ec-4193-98ca-6cef32e699e5`). It was prepared separately from the original
114-photo database, then bound to the Worker together with the complete static
build. The original database remains available for rollback.

For an update:

```sh
npx wrangler whoami
python3 scripts/export-sample.py --verify-live-origin https://www.brendan-mulvany-photography.com
npm run build
npm run types
npm run check
npm test
npm run db:remote
npm run community:remote
npm run search:sync:remote
npx wrangler deploy --dry-run
npx wrangler deploy
npm run verify:deployment -- https://new.brendan-mulvany-photography.com
npm run benchmark -- https://new.brendan-mulvany-photography.com
```

Verify that `whoami` shows `ian@mulvany.net` before remote commands. If using a
named profile, activate it for this directory or append `--profile YOUR_PROFILE`
to Wrangler commands. Increment `CACHE_VERSION` whenever reseeding, and deploy
static pages and the search snapshot together. The seed replaces only this preview
DB's photo snapshot and rebuilds FTS. It never connects to Turso.
For a change in archive membership, stage and verify a separate D1 snapshot before
switching its binding and static assets together, as done for this expansion.
After changing published archive metadata, also run `search:sync:remote` to refresh
the public search catalog in COMMUNITY before deployment. This command validates
the complete generated catalog, stages it, then atomically activates it while
retaining live annotations and all account data. D1 file imports can briefly pause
the community database, so reserve catalog syncs for archive updates. New, removed,
or moderated annotations update the index automatically without an import or build.

The custom domain binds only `new`. The main site, `www`, and CDN continue using
their existing configuration. Read replication is configured on the D1 database
(`read_replication.mode: auto`), separately from Wrangler's binding configuration.
It can be verified with `npx wrangler d1 info DB --json`.

## Speed choices and limits

- Static HTML for photo and gallery pages. Homepage and collection-directory HTML
  receive selected hero images at the edge, cached for 60 seconds; no JavaScript is
  needed to paint or browse. No framework or external font download.
- Account/community scripts load only on their own pages. Private account state
  is fetched separately and is never mixed into shared HTML/search caches.
- The homepage shows one to six selected albums, with the first album supplying
  the lead photograph. Album choices and hero images are rendered on cache misses
  from bounded build fragments and separate community settings, with no homepage
  JavaScript or per-visitor database query. The directory has 24 collections
  per page; collection galleries are bounded at 48 photos per page, with static
  previous/next links. Every current collection fits on a single gallery page.
- Hashed CSS/JS, CDN WebP-first image variants with AVIF fallback, fixed image boxes,
  lazy images below the fold.
  Large originals are never part of the initial page load.
- Search uses one bound FTS5 query on COMMUNITY, relevance ordering, prefix
  matching, and a collection index. Each photo is one document containing archive
  metadata and visible annotation names/notes, so mixed queries such as a name plus
  a year work and each photo appears only once. Words are joined with AND; the old
  Vercel search uses OR. No fuzzy spelling or semantic search.
- The API fetches 25 rows for a 24-photo page, avoiding separate count/facet
  queries. Input length, token count and page range are bounded. Only fields used
  by result cards are returned; full descriptions remain indexed and live in
  static detail pages. Search pages contain 24 results and support up to 100 pages;
  tests fail if the archive exceeds this 2,400-photo capacity.
- A 180 ms debounce and request cancellation prevent obsolete results appearing.
- Search responses use a 30-second, per-data-centre Cache API entry. Annotation
  additions and removals become visible within that interval. Cached
  database durations are historical; the UI labels cached responses and reports
  current browser request duration separately. Search fetches bypass the browser's
  HTTP cache to make this measurement useful.
- Increment `CACHE_VERSION` in Wrangler config whenever reseeding. This selects a
  new cache namespace. Static pages and search must be built from the same snapshot.
- All preview pages and API responses have `noindex`; `robots.txt` disallows
  crawling. This is a public trial, not password-protected private storage.

Full-archive counts and timings are recorded in [FULL_ARCHIVE.md](FULL_ARCHIVE.md).
The earlier [PERFORMANCE.md](PERFORMANCE.md) preserves measurements from the
114-photo trial. Timings from one client do not establish multi-region latency,
production traffic capacity, or Core Web Vitals. Search semantics still differ
from Vercel's implementation. Use `PREVIEW_ONLY=1` to benchmark only this preview
and `OUTPUT_FILE=data/full-archive-benchmark.json` to keep a separate result file.

## References

- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static asset redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [D1 SQL and FTS5 support](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 read replication and sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
