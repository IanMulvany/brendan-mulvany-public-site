# Comment and annotation security review

Reviewed 19 September 2026. This review covers the archive's Worker handlers, D1 queries and migrations, public contribution rendering, account checks, and administrator moderation. It uses source inspection and local automated tests with real SQLite constraints and transactions. No attack payloads were submitted to the live site.

## Result and changes

No exploitable stored-XSS, SQL-injection or cross-site request-forgery path was identified in the reviewed comment flow. Comments already used plain-text rendering, prepared SQL statements, authenticated writes, same-origin checks and bounded JSON parsing. This review also addressed these concrete gaps:

| Finding | Change |
| --- | --- |
| Any verified member could create image annotations. | New and existing non-admin accounts now default to `pending`. An administrator must approve annotation permission. The API enforces this independently of the interface and rechecks it in the insert transaction. Likes and comments remain available to active verified members. |
| The shared 60-writes/minute limit allowed excessive comment submissions. | Comment creation now additionally permits at most five accepted submissions per minute and 30 per hour per member, shared across photographs. D1 increments counters atomically. |
| Comment/name/note text accepted most invisible control characters, including bidirectional overrides that could mislead reviewers. | Validation rejects C0/C1 controls except tabs and line breaks, plus bidirectional override/isolate controls. Ordinary Unicode names, Arabic text, accents and line breaks remain accepted. |
| Administrators had to visit individual image pages to remove contributions. | An admin-only review API and screen provide unreviewed, visible, hidden and all filters. Review, hide and restore decisions retain the original contribution and a separate audit trail. |

Comments are visible immediately after submission. “Unreviewed” means an administrator has not yet marked the contribution reviewed; it is not a prepublication queue. Hiding a comment removes it from public community responses, while retaining it for administrator review. Annotation search results can take up to the existing 30-second search-cache lifetime to reflect hiding/restoring a name.

## Checked protections

- **Stored XSS and links:** `static/community.js`, `static/admin.js` and `static/moderation.js` build submitted text using `el()` from `static/ui.js`, which assigns `textContent`. Comment bodies, names, notes and display names are never treated as HTML or Markdown. Submitted HTML, `javascript:` URLs and Markdown link syntax remain literal text. No automatic linkification, image embedding or URL fetching is performed for comments. Admin review requires the same treatment because hostile text can target administrators too. This follows [OWASP's safe-sink guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).
- **SQL injection:** Comment text, identifiers, filters and account values are supplied through prepared-statement bindings. Dynamic table names and SQL clauses come from fixed server-controlled alternatives. Neither comments nor annotation text become SQL syntax. The API uses [D1 parameter binding](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
- **CSRF:** Every contribution/moderation mutation checks the exact configured public origin against both the request URL and `Origin` header. Missing/opaque/other-site origins fail. Supplied `Sec-Fetch-Site` must be `same-origin` or `none`. JSON is required for payload-bearing mutations, and the API grants no permissive cross-origin access. `SameSite=Lax` is an additional cookie protection, not the only check. See [OWASP's origin and Fetch Metadata guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html).
- **Authentication and access:** Sessions are unpredictable tokens stored hashed in D1, carried in a `__Host-` cookie with `Secure`, `HttpOnly`, `Path=/` and `SameSite=Lax`. A valid, unexpired, unrevoked session and active, verified account are required for writes. Administrator identity is derived from the verified email matching server configuration, not a role sent by the client or an arbitrary stored role. Each admin route independently enforces administrator access. Ordinary members cannot access author emails, approve themselves or moderate someone else's contribution.
- **Ownership:** Public delete endpoints authorize only the original author or the administrator. The administrator review endpoints are stricter and accept only administrator sessions. Client-supplied ownership, moderation and review fields in a comment POST are ignored.
- **Resource use:** Comments are limited to 2,000 JavaScript string code units, names to 120 and notes to 500. The JSON reader requires an object, rejects malformed UTF-8 and caps the actual streamed body at 8,192 bytes even when `Content-Length` is absent or dishonest. An oversized stream is cancelled. Public and admin results are paginated. Streaming bounded input follows [Cloudflare Workers request handling guidance](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/).
- **Privacy and caching:** Community/account/admin JSON uses `private, no-store` and `nosniff`. Anonymous community data contains public contribution text and display names, but no email addresses, sessions or moderation history. Admin-only review responses may include author email. Hidden contribution text is excluded from public responses. Worker error messages and logs avoid request bodies, email addresses, cookies, codes and SQL errors.
- **Browser defense in depth:** Generated pages have a CSP limiting scripts/connects to the site, disabling objects and framing, and restricting forms to the same origin. This supplements the safe rendering and server authorization; it does not replace them.

## Regression evidence

Run from `cloudflare-preview`:

```sh
node --experimental-strip-types --test tests/comment-security.test.mjs
```

The nine security tests cover dishonest/missing content lengths, UTF-8/JSON/content-type validation, origin spoofing and same-site sibling origins, stored XSS/SQL/URL payload round trips, plain-text rendering, invisible controls, concurrent comment quotas across photos, the hourly quota, owner/admin authorization and hidden-comment privacy. They load every community migration and use genuine hashed session records; security decisions are not mocked.

The wider authentication, community, moderation and Worker integration suites cover email-code verification/replay, permission approval/revocation, suspension, pagination, moderation history and annotation search. The test result for deployment is recorded by the release workflow; this document does not assert that a particular production version has been deployed.

## Operational boundaries

This is a focused code and local regression review, not a penetration-test certification or an audit of the Cloudflare account, email provider or administrator device. Application quotas reduce abuse by one account; they do not eliminate distributed spam across many verified addresses. Administrators can hide contributions and suspend abusive accounts. Suspension/revocation prevents future authorized contributions; previously published material remains visible until explicitly hidden, preserving legitimate archive contributions.

Keep submitted content on text-only DOM paths when extending the site. Any later rich-text rendering, linkification, file upload or outbound URL-fetch feature needs a separate review before release.
