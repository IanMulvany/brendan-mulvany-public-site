# Community features

The Cloudflare preview at `https://new.brendan-mulvany-photography.com` now supports verified accounts, photograph comments and likes, rectangular person annotations, newsletter consent, and administration. This does not change the main Vercel site or generate, copy, or upload any image files.

## Using the site

- `/account/`: enter an email address and optional public display name, then the eight-digit email code. The same process registers a new member or signs in an existing member. Codes expire after 15 minutes. Members can change their display name and sign out here.
- `/image/{id}/`: signed-in members can like a photograph, add a comment, and mark a rectangular area with a person's name and optional note. Areas can be drawn with mouse/touch or entered with keyboard-accessible percentage controls. Names and comments are community contributions, separate from the archive's original metadata. Members can remove their own contributions. Earlier preview links at `/photos/{id}/` redirect here; photo IDs and contributions are unchanged.
- Annotation names and notes are included in photo search, alongside archive descriptions, subjects, places and dates. Queries can combine these fields, and a photo appears once even when several annotations match. Each annotation has a “Search this name” link. Existing visible annotations are included; additions, removals and moderation changes appear in search within 30 seconds. Hidden annotations and annotations from unverified accounts are excluded. Suspending a member retains their existing public contributions, as elsewhere on the site.
- `/newsletter/`: explicit consent followed by email confirmation; this does not require an account. Already verified members can subscribe or unsubscribe directly. The newsletter provider is deliberately **not connected** and no campaigns are sent.
- `/admin/`: available after verifying `ian@mulvany.net`. Shows users, recent contribution/moderation activity, subscription states, and collection cover choices. Administrators can suspend/reactivate members, review photographs and hide contributions. Suspension revokes the member's sessions. Administrators cannot suspend themselves or other administrators.
- Collection covers: choose a collection, select an existing thumbnail, then save. The homepage and collection directory reflect the selection within 60 seconds. Photo and collection URLs remain stable. The featured homepage photo follows its collection's hero selection.
- Homepage albums (`/admin/#admin-homepage-section`): add one to six published albums, move them up or down, remove unwanted albums, then save. The first album supplies the large lead photograph; every album uses its configured collection cover. Changes appear within 60 seconds. The original three albums remain until the first save. Saved choices survive archive reseeding; albums absent from a later build are skipped, falling back to the original selection if none remain available.

## Storage and email

`DB` remains the replaceable public archive snapshot (`brendan-mulvany-preview-full`) used to validate published photographs and collection membership. `COMMUNITY` is a separate D1 database, `brendan-mulvany-community`, ID `c5aeec54-17ff-4710-8902-acd42210f8fe`. It stores users, sessions, verification challenges, quotas, comments, likes, annotations, activity, subscriber consent, collection heroes, ordered homepage album settings, and a public search catalog. The original archive seed must never target COMMUNITY.

Migration `0004_search.sql` adds `search_photos` and its FTS5 index. Each search document combines public archive metadata with all visible annotation names/notes. Database triggers update the document and index atomically with annotation changes and user-verification changes. Searches select only the original seven public photo-card fields, never account data or annotation bodies. Comments are not indexed by this feature.

`npm run search:sync:remote` refreshes this catalog from the validated public `data/sample.json` after archive publication changes; use `search:sync:local` in development. It stages only public metadata, validates the staged row count, and atomically activates the catalog while deriving annotation text from current COMMUNITY records. It removes only stale search rows and retains annotations, account data and editorial settings. D1 file imports can briefly pause community requests; ordinary annotation updates need no import, rebuild or deployment. Keep the catalog, public snapshot and static build from the same published archive version.

Schema changes use versioned `community-migrations/*.sql`. Never edit an already applied migration. D1 backups/Time Travel should be used for recovery of visitor data; it cannot be rebuilt from the photographic archive. For an explicit snapshot:

```sh
npx wrangler d1 export COMMUNITY --remote --output /secure/backup/path/community.sql
```

That export contains private account/subscriber data and must stay out of version control. Photo binaries continue to come from the existing CDN.

Transactional verification mail uses Cloudflare's native `EMAIL` binding from `no-reply@brendan-mulvany-photography.com`. The sending domain is enabled with SPF, DKIM and DMARC. `allowed_sender_addresses` restricts the Worker to that sender. Cloudflare Email Service is used for verification only; newsletter campaigns will use the later Resend/blog integration.

`AUTH_SECRET` is declared in `secrets.required` and is a random Worker secret, installed with `wrangler secret put AUTH_SECRET`. It is not in source control. `PUBLIC_ORIGIN`, `ADMIN_EMAIL`, `EMAIL_FROM`, both D1 bindings, and the email binding are declared in `wrangler.jsonc`. Changing the primary hostname later requires updating `PUBLIC_ORIGIN`, custom routes, and email/site links together. Existing host-scoped sessions will require a fresh sign-in on the new hostname.

## Security and performance

- Email ownership is verified before creating an account or session. Admin access is derived from the configured verified admin email; profile requests cannot assign a role.
- Codes use cryptographic randomness, purpose-bound HMAC storage, a 15-minute expiry, and at most five attempts. Challenge consumption, account changes and session creation share an atomic transaction, preventing concurrent replay.
- Session cookies are `__Host-bm_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, and expire after 30 days. Only hashes of random session tokens are stored. Authentication always reads the primary database and checks suspension, expiry, and revocation.
- Mutations require the exact configured origin; JSON bodies and all text/rectangle fields are bounded. IP/email and member quotas limit writes and verification mail. SQL parameters are bound. Public contribution responses omit email addresses. Frontend contributions are rendered as text, not HTML.
- Private/API errors use `private, no-store`. Account state is fetched separately from static pages and never placed into shared HTML caches. Public HTML covers are rewritten server-side and cached for 60 seconds, independent of cookies. Search uses a single primary FTS query on cache misses, caches public cards for 30 seconds, and requires browser revalidation. Photo/gallery pages remain static.
- A daily Worker cron at 03:17 UTC removes expired sessions, codes and quota counters. It preserves users, consent and contribution records. Logs omit codes, cookies, email addresses and contribution bodies.

## Development and deployment

Use Node 24 or newer. Local `.dev.vars` is ignored and contains a development `AUTH_SECRET` and `PUBLIC_ORIGIN=http://localhost:8787`. Do not reuse the production secret locally. Local email delivery is simulated by Wrangler.

```sh
npm ci
npm run types
npm run community:local
npm run db:local
npm run search:sync:local
npm run build
npm run check
npm test
npm run dev
```

The 56-test suite includes real SQLite constraint/authorization tests and an isolated Workerd/D1 integration test with a test-only email Worker. Homepage coverage verifies admin-only writes, selection bounds, order, stale albums, hero overrides in inserted HTML, and cache isolation. Annotation-search tests cover existing-name backfill, mixed metadata/name/note matching, visibility changes, atomic rollback, staged imports, and preservation of community data. Static asset tests exercise actual Cloudflare redirects, query preservation, original photo/roll URIs, pagination, 404s and generated internal links. Run `npm run build` before the tests. There is no test-login route or production email bypass. After changes:

```sh
npm run community:remote
npm run search:sync:remote
npx wrangler deploy --dry-run
npm run deploy
```

`community:remote` applies schema migrations only. `db:remote` is the separate public archive reseed operation. Do not run it as part of account migrations.

## Later newsletter integration

The blog uses Resend. This preview captures `pending`, `confirmed`, and `unsubscribed` states, explicit consent time, confirmation time, and unsubscribe time. `provider_sync_status` stays `not_connected`. When connecting the systems, import/sync only confirmed consent, propagate unsubscribe/suppression state, and keep account registration separate from newsletter membership. No blog secrets, contacts, segments, or broadcasts have been copied or changed.

## Deployment validation

Original public URI support was deployed in version `63970660-9df3-4e66-9614-ac809a505f5c` on 15 September 2026. All 56 tests, TypeScript and deployment dry-run passed. The build contains 1,504 HTML pages; all original photo/roll links and all nine published year memberships were checked. Live verification passed for all 1,383 original photo URIs, 94 public pages, 86 redirects, 58 search pages and 74 collection filters (1,695 requests). Browser verification confirmed a saved preview photo link retains its query and `#community` anchor, loads the existing annotation, and links to the new canonical photo address from search. Cloudflare reported 4 ms Worker startup. This deployment changed no D1 data, image objects or main-domain DNS records.

Annotation search was deployed in version `b7f2cc8a-1c2d-4fcf-b838-a263baf686bc` on 14 September 2026. All 49 tests passed, along with TypeScript, build and independent database review. Live verification covered all 1,383 photographs, 58 search pages and all 74 collection filters. The existing “Patrick Hillery” annotation and its note both retrieve photograph `188329213`; a browser check confirmed the name search returns that photograph. Warm repeated searches measured 18–20 ms from one client, with the original database query taking about 1.4 ms. Cloudflare reported 4 ms Worker startup. No test annotations or accounts were created on the live site.

The new migration uses a conditional `SELECT RAISE` instead of an unparenthesized `CASE … END` to avoid [Cloudflare's remote trigger-parser issue](https://github.com/cloudflare/workers-sdk/issues/4727). The rejected attempt rolled back completely before the compatible migration was applied.

Homepage album administration was deployed in version `3a263dbe-a934-49f9-86c1-959326a1355f` on 14 September 2026. All 39 tests and TypeScript checks passed, including real Worker rendering with saved order, cover overrides, stale-album fallback and cookie-independent caching. Desktop and 390 px browser checks covered adding, reordering, limits, save/reload, and recovery when selected albums become unavailable. Live checks confirmed the admin asset, anonymous/cross-origin denial, 74 compiled album fragments, unchanged default choices and working search. No live album selection was changed for testing. The 9,509-byte homepage remains script-free; requests measured 381 ms on the first cache miss and 26–32 ms on warm cache hits from one client. Cloudflare reported 4 ms Worker startup.

Deployed version `257ae210-0195-4343-8c4d-a47964caff36` on 14 September 2026 (Europe/London). Cloudflare reported 4 ms Worker startup. All 34 tests and TypeScript checks passed. Desktop and 390 px browser checks exercised sign-in, comments, likes, region drawing and resizing, moderation, cover selection, subscription withdrawal and failure retry using isolated synthetic data. Physical touch hardware was not separately tested.

Live checks returned the expected page/API statuses, denied anonymous admin access and cross-origin verification requests, and confirmed private responses are not cached. Cloudflare accepted the administrator verification email; final inbox receipt and sign-in are user-verifiable. Warm homepage/directory requests measured 26–29 ms and search 22–42 ms from one client; these are request timings, not Core Web Vitals or a multi-region benchmark.
