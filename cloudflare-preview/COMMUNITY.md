# Community features

The Cloudflare application's configured public origin is `https://brendan-mulvany-photography.com`, set by `PUBLIC_ORIGIN` in `wrangler.jsonc`. It supports verified accounts, photograph comments and likes, rectangular person annotations, newsletter consent, and administration. The independent configuration in `wrangler.redirects.jsonc` assigns `www` and the former `new` preview hostname to an apex redirect. See [production cutover validation](#production-cutover-validation) for deployment status. Photo files continue to use the existing CDN; this application does not generate, copy or upload them.

## Using the site

- `/account/`: enter an email address and optional public display name, then the eight-digit email code. The same process registers a new member or signs in an existing member. Codes expire after 15 minutes. Members can change their display name and sign out here.
- After moving from `new` to the main hostname, open `https://brendan-mulvany-photography.com/account/` and request a fresh code. The account, display name, contributions and permissions remain in COMMUNITY, but the host-scoped session cookie does not transfer. The administrator uses the same email-code flow. Verification emails use the configured `PUBLIC_ORIGIN`; keep it aligned with the site's canonical hostname. Alias hostnames accept browsing redirects only, so submit account and contribution forms from the main site.
- `/image/{id}/`: active, verified members can like photographs and add comments. Adding a person's name and optional note requires administrator approval first. New members await approval; they see an explanation while annotation tools remain hidden. Approved members can draw areas with mouse/touch or enter keyboard-accessible percentages. Names and comments are separate from the archive's original metadata. Members can remove their own contributions. Earlier preview links at `/photos/{id}/` redirect here; photo IDs and contributions are unchanged.
- Annotation names and notes are included in photo search, alongside archive descriptions, subjects, places and dates. Queries can combine these fields, and a photo appears once even when several annotations match. Each annotation has a “Search this name” link. Existing visible annotations are included; additions, removals and moderation changes appear in search within 30 seconds. Hidden annotations and annotations from unverified accounts are excluded. Suspending a member retains their existing public contributions, as elsewhere on the site.
- `/newsletter/`: explicit consent followed by email confirmation; this does not require an account. Already verified members can subscribe or unsubscribe directly. The newsletter provider is deliberately **not connected** and no campaigns are sent.
- `/admin/`: available after verifying `ian@mulvany.net`, with an **Admin** link in the header. **Annotation approvals & members** lists pending members and lets Ian approve, decline or revoke their annotation access. Approval requires an active, verified account. Revoking annotation access leaves likes/comments available; suspending an account blocks all contributions and revokes its sessions. The administrator cannot revoke their own access or suspend themselves.
- **Review contributions** (`/admin/#admin-review-section`): switch between comments and annotations, and filter by needs review, public, hidden or all. Each card shows the photograph, contributor and submitted text; annotation cards highlight the marked area. Mark reviewed, hide from the public site, or restore a hidden item. Comments and approved members' annotations publish immediately; review is retrospective. Hidden content remains available to the administrator, with decisions recorded in activity. Existing contributions are retained and initially appear as unreviewed.
- Collection covers: choose a collection, select an existing thumbnail, then save. The homepage and collection directory reflect the selection within 60 seconds. Photo and collection URLs remain stable. The featured homepage photo follows its collection's hero selection.
- Homepage albums (`/admin/#admin-homepage-section`): add one to six published albums, move them up or down, remove unwanted albums, then save. The first album supplies the large lead photograph; every album uses its configured collection cover. Changes appear within 60 seconds. The original three albums remain until the first save. Saved choices survive archive reseeding; albums absent from a later build are skipped, falling back to the original selection if none remain available.

Administrators can also change a collection cover directly on `/roll/{roll}/`: choose **Choose collection cover**, then **Use as collection cover** beneath a photograph. The current cover is marked and linked. Choices save immediately through the existing admin endpoint and appear on the homepage and collection directory within a minute. The picker uses the photographs already on the page, works with keyboard activation, and closes with a sign-in prompt if the admin session expires. Signed-out visitors and ordinary members do not see these controls.

## Storage and email

`DB` remains the replaceable public archive snapshot (`brendan-mulvany-preview-full`) used to validate published photographs and collection membership. `COMMUNITY` is a separate D1 database, `brendan-mulvany-community`, ID `c5aeec54-17ff-4710-8902-acd42210f8fe`. It stores users, sessions, verification challenges, quotas, comments, likes, annotations, activity, subscriber consent, collection heroes, ordered homepage album settings, and a public search catalog. The original archive seed must never target COMMUNITY.

Migration `0004_search.sql` adds `search_photos` and its FTS5 index. Each search document combines public archive metadata with all visible annotation names/notes. Database triggers update the document and index atomically with annotation changes and user-verification changes. Searches select only the original seven public photo-card fields, never account data or annotation bodies. Comments are not indexed by this feature.

Migration `0005_moderation.sql` adds annotation permission, contribution review fields and a moderation audit table. It retains existing accounts, sessions, comments, names and search data. New and existing non-admin members start with pending annotation access; the configured administrator has access automatically. Apply this additive migration before deploying code that reads the new fields. Never seed or replace COMMUNITY. Record a current D1 Time Travel bookmark before migration.

`npm run search:sync:remote` refreshes this catalog from the validated public `data/sample.json` after archive publication changes; use `search:sync:local` in development. It stages only public metadata, validates the staged row count, and atomically activates the catalog while deriving annotation text from current COMMUNITY records. It removes only stale search rows and retains annotations, account data and editorial settings. D1 file imports can briefly pause community requests; ordinary annotation updates need no import, rebuild or deployment. Keep the catalog, public snapshot and static build from the same published archive version.

Schema changes use versioned `community-migrations/*.sql`. Never edit an already applied migration. Use [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) for recovery within the account's retention window; visitor data cannot be rebuilt from the photographic archive. Inspect the intended recovery point and the writes it would replace before restoring.

The ordinary D1 export command is not a supported complete backup here: [Cloudflare's export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/#known-limitations) include databases with virtual tables, and COMMUNITY contains FTS5. Do not drop the live search index to take a routine backup. A separate logical backup and restore procedure for private tables must be tested before relying on it; any resulting account/subscriber data must stay outside version control. Photo binaries continue to come from the existing CDN.

Transactional verification mail uses Cloudflare's native `EMAIL` binding from `no-reply@brendan-mulvany-photography.com`. The sending domain is enabled with SPF, DKIM and DMARC. `allowed_sender_addresses` restricts the Worker to that sender. Cloudflare Email Service is used for verification only; newsletter campaigns will use the later Resend/blog integration.

`AUTH_SECRET` is declared in `secrets.required` and is a random Worker secret, installed with `wrangler secret put AUTH_SECRET`. It is not in source control. `PUBLIC_ORIGIN`, `ADMIN_EMAIL`, `EMAIL_FROM`, both D1 bindings, and the email binding are declared in `wrangler.jsonc`. The main Worker retains its historical service name `brendan-mulvany-cloudflare-preview`; that name does not identify a separate preview database. The redirect Worker has no secret, database or email bindings. Changing the canonical hostname requires updating `PUBLIC_ORIGIN`, custom domains, the redirect target in `src/redirects.ts`, and rebuilt site/email links together. Existing host-scoped sessions require a fresh sign-in on the new hostname.

## Security and performance

- Email ownership is verified before creating an account or session. Admin access is derived from the configured verified admin email; profile requests cannot assign a role.
- Codes use cryptographic randomness, purpose-bound HMAC storage, a 15-minute expiry, and at most five attempts. Challenge consumption, account changes and session creation share an atomic transaction, preventing concurrent replay.
- Session cookies are `__Host-bm_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, and expire after 30 days. Only hashes of random session tokens are stored. Authentication always reads the primary database and checks suspension, expiry, and revocation.
- Mutations require the exact configured origin; JSON bodies and all text/rectangle fields are bounded. IP/email and member quotas limit writes and verification mail. SQL parameters are bound. Public contribution responses omit email addresses. Frontend contributions are rendered as text, not HTML.
- Comment submissions are capped at 2,000 characters, five per minute and 30 per hour per member across photographs. JSON input is capped at 8 KiB while streaming. Unsafe control characters and bidirectional overrides are rejected; ordinary Unicode and line breaks remain supported. Annotation approval is enforced both when reading the session and atomically when inserting a name. See [the focused security review](SECURITY_REVIEW.md) for checks, fixes and limitations.
- Private/API errors use `private, no-store`. Account state is fetched separately from static pages and never placed into shared HTML caches. Public HTML covers are rewritten server-side and cached for 60 seconds, independent of cookies. Search uses a single primary FTS query on cache misses, caches public cards for 30 seconds, and requires browser revalidation. Photo/gallery pages remain static.
- A daily Worker cron at 03:17 UTC removes expired sessions, codes and quota counters. It preserves users, consent and contribution records. Logs omit codes, cookies, email addresses and contribution bodies.

## Development and deployment

Use Node 24 or newer. Local `.dev.vars` is ignored and contains a development `AUTH_SECRET` and `PUBLIC_ORIGIN=http://localhost:8787`. Do not reuse the production secret locally. Local email delivery is simulated by Wrangler.

```sh
npm ci
npm run export
npm run types
npm run community:local
npm run db:local
npm run search:sync:local
npm run build
npm run check
npm test
npm run dev
```

`npm run export` reads the reviewed original `../public/` and offline `../public_site.db` snapshot; it does not fetch the production Cloudflare site. The optional `--verify-live-origin` exporter flag is for a separately verified legacy Vercel renderer, whose embedded page data differs from the production Cloudflare build. Do not point that flag at the apex, `www` or `new` after cutover. See [README.md](README.md) for snapshot review and import details.

The test suite includes real SQLite constraint/authorization tests and an isolated Workerd/D1 integration test with a test-only email Worker. Homepage coverage verifies admin-only writes, selection bounds, order, stale albums, hero overrides in inserted HTML, and cache isolation. Annotation-search tests cover existing-name backfill, mixed metadata/name/note matching, visibility changes, atomic rollback, staged imports, and preservation of community data. Static asset tests exercise actual Cloudflare redirects, query preservation, original photo/roll URIs, pagination, 404s and generated internal links. Run `npm run build` before the tests. There is no test-login route or production email bypass.

For application changes, build, type-check and test before deploying both configurations:

```sh
npm run build
npm run check
npm test
npx wrangler deploy --dry-run
npm run deploy
npm run deploy:redirects
npm run verify:deployment -- https://brendan-mulvany-photography.com
```

Use the current `PUBLIC_ORIGIN` if it changes. `npm run deploy` rebuilds and deploys the main Worker; `deploy:redirects` deploys the stateless hostname redirect Worker separately. Public canonical, social and sitemap URLs are generated from the main configuration; utility pages and APIs retain noindex settings.

When a change adds community schema, apply `npm run community:remote` before deploying the dependent code. It applies migrations only. `db:remote` is the separate public archive reseed operation; do not run it as part of account migrations. Run `search:sync:remote` only after a reviewed archive metadata/publication update, or when deliberately repairing the public search mirror. Ordinary account, annotation and frontend changes need no search import.

For production rollback, retain compatible COMMUNITY migrations and the current canonical origin. Rolling back to an old preview Worker version can restore `new` origin checks or links and break main-domain sign-in; redeploy the reviewed older code with current configuration when needed. A Worker version rollback does not restore custom domains, DNS or D1 data. Keep backups of visitor data and retain Vercel separately for a hosting rollback. Restore the apex/`www` routing direction coherently to avoid a redirect loop, and do not leave the main configuration owning aliases that belong to the redirect Worker. See [hostname cutover and rollback](README.md#hostname-cutover-and-rollback) for the deployment sequence.

## Later newsletter integration

The blog uses Resend. This application captures `pending`, `confirmed`, and `unsubscribed` states, explicit consent time, confirmation time, and unsubscribe time. `provider_sync_status` stays `not_connected`. When connecting the systems, import/sync only confirmed consent, propagate unsubscribe/suppression state, and keep account registration separate from newsletter membership. No blog secrets, contacts, segments, or broadcasts have been copied or changed.

## Production cutover validation

The production application was activated on 15 September 2026 as version `1188b599-1af2-4f6b-8da3-df7e44f24455`. The apex belongs to the main Worker; `www` and `new` belong to redirect Worker version `4d40f311-5507-43f0-a25d-938682e9c08c`. Both aliases return 301 to the apex while retaining paths and query strings. The old Vercel A records were removed manually before attachment. The prior apex DNS TTL was allowed to expire before enabling the reverse `www` redirect. Final Cloudflare domain ownership is recorded in ignored `data/cutover-complete.json`.

Production checks passed for all 1,383 photo URIs, 58 search pages, 74 collection filters, 86 legacy redirects and the complete 1,499-URL sitemap. The initial full audit reached its final hostname section while a cached `www` DNS answer still led to Vercel. All 12 hostname GET/HEAD checks passed separately after propagation; their results are recorded in ignored `data/hostname-verification.json`. The robots validator accounts for Cloudflare's named crawler restrictions while checking that the generic public policy permits indexing. The 62-test suite and TypeScript checks passed before deployment; four additional focused robots tests passed after this validator correction.

Browser checks confirmed that a saved preview photo link retains its `#community` anchor and the existing “Patrick Hillery” annotation; searching that name returns photograph `188329213`. Signed-out account responses remain private and uncached, and admin/newsletter account endpoints reject anonymous access. A new sign-in is required on the apex because sessions are host-scoped. No D1 data or image objects changed during this deployment.

A bounded sample in ignored `data/benchmark-production-cutover.json` measured warm homepage requests at 22.85 ms, collection requests at 23.15 ms, and search requests at 18.15–23.4 ms from one UK client, using three requests per endpoint. These are request timings, not Core Web Vitals, capacity tests or multi-region measurements.

## Earlier preview deployment validation

These records describe the earlier `new` deployments. They are historical checks, not validation of the production hostname cutover. Verify the current main and redirect configurations separately using the commands above.

Original public URI support was deployed in version `63970660-9df3-4e66-9614-ac809a505f5c` on 15 September 2026. All 56 tests, TypeScript and deployment dry-run passed. The build contains 1,504 HTML pages; all original photo/roll links and all nine published year memberships were checked. Live verification passed for all 1,383 original photo URIs, 94 public pages, 86 redirects, 58 search pages and 74 collection filters (1,695 requests). Browser verification confirmed a saved preview photo link retains its query and `#community` anchor, loads the existing annotation, and links to the new canonical photo address from search. Cloudflare reported 4 ms Worker startup. This deployment changed no D1 data, image objects or main-domain DNS records.

Annotation search was deployed in version `b7f2cc8a-1c2d-4fcf-b838-a263baf686bc` on 14 September 2026. All 49 tests passed, along with TypeScript, build and independent database review. Live verification covered all 1,383 photographs, 58 search pages and all 74 collection filters. The existing “Patrick Hillery” annotation and its note both retrieve photograph `188329213`; a browser check confirmed the name search returns that photograph. Warm repeated searches measured 18–20 ms from one client, with the original database query taking about 1.4 ms. Cloudflare reported 4 ms Worker startup. No test annotations or accounts were created on the live site.

The new migration uses a conditional `SELECT RAISE` instead of an unparenthesized `CASE … END` to avoid [Cloudflare's remote trigger-parser issue](https://github.com/cloudflare/workers-sdk/issues/4727). The rejected attempt rolled back completely before the compatible migration was applied.

Homepage album administration was deployed in version `3a263dbe-a934-49f9-86c1-959326a1355f` on 14 September 2026. All 39 tests and TypeScript checks passed, including real Worker rendering with saved order, cover overrides, stale-album fallback and cookie-independent caching. Desktop and 390 px browser checks covered adding, reordering, limits, save/reload, and recovery when selected albums become unavailable. Live checks confirmed the admin asset, anonymous/cross-origin denial, 74 compiled album fragments, unchanged default choices and working search. No live album selection was changed for testing. The 9,509-byte homepage remains script-free; requests measured 381 ms on the first cache miss and 26–32 ms on warm cache hits from one client. Cloudflare reported 4 ms Worker startup.

Deployed version `257ae210-0195-4343-8c4d-a47964caff36` on 14 September 2026 (Europe/London). Cloudflare reported 4 ms Worker startup. All 34 tests and TypeScript checks passed. Desktop and 390 px browser checks exercised sign-in, comments, likes, region drawing and resizing, moderation, cover selection, subscription withdrawal and failure retry using isolated synthetic data. Physical touch hardware was not separately tested.

Live checks returned the expected page/API statuses, denied anonymous admin access and cross-origin verification requests, and confirmed private responses are not cached. Cloudflare accepted the administrator verification email; final inbox receipt and sign-in are user-verifiable. Warm homepage/directory requests measured 26–29 ms and search 22–42 ms from one client; these are request timings, not Core Web Vitals or a multi-region benchmark.
