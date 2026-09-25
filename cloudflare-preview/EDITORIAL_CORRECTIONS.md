# Owner archive corrections

The signed-in owner can queue photograph title, description, date, location, and
90-degree left or right image rotations from photo pages, and collection display-title and description changes
from roll pages. The administration page lists open corrections. Other accounts
cannot read or submit them. A queued change is private and does not alter a
published page or search result until the local archive publishes a new release.

Apply `community-migrations/0006_editorial_corrections.sql` and
`community-migrations/0007_annotation_rotation.sql` to the existing
COMMUNITY database before deploying the Worker. The correction and annotation tables are kept
apart from the replaceable archive DB. Do not reseed COMMUNITY.

The local scanning archive's `python -m scanning_app.editorial` command reviews,
applies, and publishes corrections. See its `scanning_app/README.md` for the
sequence. The local `editorial_corrections.json` holds the canonical overrides;
original machine descriptions and scan metadata remain available for provenance.
For a rotation, the local archive keeps the downloaded published original and
a rotated full-size JPEG under `scanning_app/state/editorial_images/`. Publication
generates new immutable image variants and URL, updates the photograph dimensions,
and leaves the photograph ID and page URL intact. Person boxes retain the
orientation in which they were drawn and are transformed when read, including
after later rotations. Back up the local state directory with the archive.
The normal scanning-batch publisher also applies these overrides to every future
release. Collection IDs, roll URLs, photograph IDs, and image URLs stay stable.

The API allows one open proposal per item and field. The local importer checks
the previous value and publication version before applying, and records each
operation ID so retries cannot apply it twice. A new correction to the same
field can be queued after the previous one is published.
