# Owner archive corrections

The signed-in owner can queue photograph title, description, date, and location
changes from photo pages, and collection display-title and description changes
from roll pages. The administration page lists open corrections. Other accounts
cannot read or submit them. A queued change is private and does not alter a
published page or search result until the local archive publishes a new release.

Apply `community-migrations/0006_editorial_corrections.sql` to the existing
COMMUNITY database before deploying the Worker. The correction table is kept
apart from the replaceable archive DB. Do not reseed COMMUNITY.

The local scanning archive's `python -m scanning_app.editorial` command reviews,
applies, and publishes corrections. See its `scanning_app/README.md` for the
sequence. The local `editorial_corrections.json` holds the canonical overrides;
original machine descriptions and scan metadata remain available for provenance.
The normal scanning-batch publisher also applies these overrides to every future
release. Collection IDs, roll URLs, photograph IDs, and image URLs stay stable.

The API allows one open proposal per item and field. The local importer checks
the previous value and publication version before applying, and records each
operation ID so retries cannot apply it twice. A new correction to the same
field can be queued after the previous one is published.
