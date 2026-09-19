# Cloudflare photographic archive

Configured public URL: https://brendan-mulvany-photography.com/ — the Workers + D1
version of the full published archive: 1,383 photographs across 74 collections.
`PUBLIC_ORIGIN` in `wrangler.jsonc` controls the main Worker's origin and the build's
canonical, social and sitemap URLs. The separate Worker configuration in
`wrangler.redirects.jsonc` assigns `www` and the former `new` preview hostname
to an apex redirect. Keep its destination in `src/redirects.ts` aligned with
`PUBLIC_ORIGIN`. Current deployment validation is recorded in [COMMUNITY.md](COMMUNITY.md#production-cutover-validation).
Administrators can choose and order one to six homepage albums; the original three
remain until a selection is saved. The collection directory exposes the complete
archive with 24 collections per page.

The application includes verified accounts, comments, likes, person annotations,
newsletter signup and administration; see [COMMUNITY.md](COMMUNITY.md) for use and
operations. Keep the original Vercel deployment and Turso database available for
rollback; Cloudflare does not write to them.
Photos use the existing public R2 CDN. No images are generated, uploaded, copied,
or transformed by this project. Public archive metadata remains in its D1 snapshot.
The separate community D1 stores accounts and contributions plus a searchable copy
of public metadata combined with visible annotation names and notes.
Every photo ID and URL is checked against the reviewed original public roll-page
snapshot by the exporter.
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

Hostname redirects preserve the path and query for GET/HEAD requests, including
saved preview links. The redirect Worker has no asset, database, email or secret
bindings. It rejects mutations: open the main site and sign in there before posting
or managing an account. Host-scoped sessions on `new` do not transfer to the apex.
Canonical photo/gallery requests retain direct static-asset serving on the main
Worker; hostname redirects do not add a Worker invocation to those requests.

On roll pages, signed-in administrators can choose a collection cover beside the
existing photo thumbnails. A small deferred module checks the current session;
cover settings are requested only when an admin opens the picker. It reuses the
existing cover API and image elements, with no additional image downloads or
database migration. Failed saves retain the previous selection and allow retry.

## Local run

Requires Node 24+, Python 3.9+, the existing `../public_site.db`, and the existing
static build in `../public/`. No Turso credentials are needed.

```sh
npm ci
npm run export
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

Review `../public/` and `../public_site.db` as one original archive snapshot before
exporting an archive update. The exporter reports their build dates and warns that
local publication evidence can be stale. Its optional `--verify-live-origin` flag
expects the original Vercel renderer's embedded roll-page data; it is useful only
against a separately verified legacy deployment that still serves that renderer.
Do not pass the production apex, `www`, or `new` after cutover: the Cloudflare site
does not expose that legacy payload. `--live-dir` can instead consume previously
reviewed captures of the original renderer. Neither option is required for the
normal reviewed-snapshot export above.

## Deployment

The production configuration uses the `ian@mulvany.net` Cloudflare account. The
main Worker retains the historical name `brendan-mulvany-cloudflare-preview`;
its custom domain is the apex, not a separate preview environment. Wrangler config
records the dedicated D1 ID and account ID; these identifiers are not credentials.
The archive snapshot is
located in Western Europe with global read replication enabled. Search now reads
the COMMUNITY primary on cache misses so annotation changes do not lag on replicas.

The full archive uses `brendan-mulvany-preview-full`
(`6d3afe2d-34ec-4193-98ca-6cef32e699e5`). It was prepared separately from the original
114-photo database, then bound to the Worker together with the complete static
build. The original database remains available for rollback.

For an application update, using the current `PUBLIC_ORIGIN` for verification:

```sh
npx wrangler whoami
npm run build
npm run types
npm run check
npm test
npx wrangler deploy --dry-run
npm run deploy
npm run deploy:redirects
npm run verify:deployment -- https://brendan-mulvany-photography.com
PREVIEW_ONLY=1 OUTPUT_FILE=data/production-benchmark.json npm run benchmark -- https://brendan-mulvany-photography.com
```

Verify that `whoami` shows `ian@mulvany.net` before remote commands. If using a
named profile, activate it for this directory or append `--profile YOUR_PROFILE`
to Wrangler commands. `npm run deploy` builds and deploys the main Worker;
`deploy:redirects` deploys the independent hostname redirect Worker. These are
separate operations, so verify both. Apply any new community migrations with
`npm run community:remote` before deploying code that needs them. Frontend-only
changes do not require a database reseed or search import.

For a reviewed archive update, run `npm run export` first, rebuild and test, then
refresh the public snapshot with `npm run db:remote` and the community search copy
with `npm run search:sync:remote` before deployment. Increment `CACHE_VERSION`
whenever reseeding, and deploy static pages and the search snapshot together.
The archive seed replaces only `DB`'s photo snapshot and rebuilds its FTS index.
It never connects to Turso and must never be executed against `COMMUNITY`.
For a change in archive membership, stage and verify a separate D1 snapshot before
switching its binding and static assets together, as done for this expansion.
After changing published archive metadata, also run `search:sync:remote` to refresh
the public search catalog in COMMUNITY before deployment. This command validates
the complete generated catalog, stages it, then atomically activates it while
retaining live annotations and all account data. D1 file imports can briefly pause
the community database, so reserve catalog syncs for archive updates. New, removed,
or moderated annotations update the index automatically without an import or build.

Read replication is configured on the D1 database
(`read_replication.mode: auto`), separately from Wrangler's binding configuration.
It can be verified with `npx wrangler d1 info DB --json`.

## Hostname cutover and rollback

The main configuration owns only the apex; the redirect configuration owns `www`
and `new`. Do not add those aliases back to the main Worker configuration: a later
deployment can reassign Custom Domains from another Worker. Cloudflare provisions
DNS and certificates for Custom Domains. Wrangler can request replacement of
conflicting DNS records and domain ownership; inspect the exact affected hostnames
and retain the original DNS/domain records before such a deployment.

For an initial cutover, keep `new` on the main Worker while attaching and verifying
the apex, then transfer `new` directly to the already tested redirect Worker. Avoid
deleting an active domain before assigning its replacement. The old Vercel apex
redirects to `www`; changing `www` to redirect back to the apex before cached old
apex DNS expires can cause a loop. Allow the prior DNS TTL to age and verify DNS,
TLS and HTTP behavior before reversing the redirect direction. Propagation may
vary between clients.

For a code rollback, select a known compatible Worker version while retaining the
current production hostnames and `PUBLIC_ORIGIN`. An older preview version may
embed `new` URLs, noindex settings, or an origin check that rejects production
mutations; redeploy a reviewed revision with current configuration when necessary.
Worker code/version rollback does not restore DNS, custom domains or D1 data.
Wrangler activates code before publishing domain triggers, so a failed domain step
can leave the new code active and needs explicit verification.

For a hosting rollback to Vercel, restore the recorded apex and `www` DNS/domain
configuration together with the original redirect direction. Do not leave
Cloudflare `www` redirecting to a Vercel apex that redirects back to `www`. Preserve
the COMMUNITY database and its backups; accounts, newsletter consent and visitor
contributions are not mirrored into Turso. Leave CDN and mail records intact.

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
- Public archive pages have production canonical/social URLs and appear in the
  generated sitemap. `robots.txt` allows public browsing and advertises that sitemap.
  Account, admin, search and newsletter utility pages, API responses and homepage
  fragments remain excluded from indexing. Public pages have no preview branding.

Full-archive counts and timings are recorded in [FULL_ARCHIVE.md](FULL_ARCHIVE.md).
The earlier [PERFORMANCE.md](PERFORMANCE.md) preserves measurements from the
114-photo trial. Timings from one client do not establish multi-region latency,
production traffic capacity, or Core Web Vitals. Search semantics still differ
from Vercel's implementation. The benchmark script retains the legacy switch
`PREVIEW_ONLY=1`, which means measure only the supplied target. Use it for production:
the default comparison hostname `www` now belongs to the redirect configuration,
so it is not an independent Vercel baseline. Only supply a separate Vercel origin
when that original deployment has been independently verified.

## References

- [Workers static assets](https://developers.cloudflare.com/workers/static-assets/)
- [Static asset redirects](https://developers.cloudflare.com/workers/static-assets/redirects/)
- [D1 SQL and FTS5 support](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
- [D1 read replication and sessions](https://developers.cloudflare.com/d1/best-practices/read-replication/)
- [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)

### Immersive image viewing

Image pages have a **View full screen** link opening a viewport-filling dialog. It displays the uncropped large image and navigates the current roll in the same order as the gallery, including across gallery pagination boundaries. Use touch swipes, arrow buttons or Left/Right keys; close with Escape, Close or browser Back. **View image page** opens the currently displayed photograph's normal page for metadata and contributions. Annotation controls remain on the normal page.

A content-hashed JSON manifest is shared by all image pages in each roll. Only the displayed large image is requested; opening the viewer does not download the entire roll. The link falls back to the original image without JavaScript. Pinch zoom and vertical gestures do not trigger navigation. The viewer does not require database or image-storage changes.

### Naming people beside the photograph

Annotation controls, drawing guidance and image overlays stay hidden until the server confirms an active, verified member or administrator session. Guests see a prominent **Sign in or create an account** link; published names remain readable below the photograph. Failed permission checks and expired sessions hide the editing controls again.

Choose **Add a name** and draw around a person. The name field opens beside the
selected area when there is space, or directly below the photograph on a small
screen. A close-up keeps the selection visible while typing. The name field is
focused automatically. Optional notes and numeric area adjustments expand on
demand; **Use area controls** also supports identification without dragging.
**Redraw area** preserves the entered name and note. Escape or the close button
cancels. Saving confirms the name beside the image and leaves **Add a name** ready
for the next person. Failed saves keep the selection and entered text for retry.

### Deploying UI changes after publishing a scanning batch

GitHub stores source history. The current release workflow sends the built site
directly to Cloudflare with Wrangler; pushing source alone does not publish it.
The scanning app can publish a newer archive snapshot and switch the Worker's
archive DB binding without updating this checkout's older build inputs.

Before a frontend-only release, prepare a separate build with the latest
`scanning_app/state/published.json` publication: use that release's
`cloudflare-preview/wrangler.jsonc`, `data/sample.json` and
`public/batches/index.html`, together with the current source. Verify the manifest
against live search and preserve both D1 bindings. Then build, check, test and run
`npm run deploy` in the prepared `cloudflare-preview` directory. Do not reseed or
migrate databases for a frontend-only change, and do not deploy this checkout's
older snapshot over a more recent scanning publication.
