# The roll notebooks

`/notebooks/` is a special collection of the 160 original notebook photographs. It defaults to pages with published roll links, with filters for notebook, published roll or page filename, and all pages. It is linked from the main navigation and collection directory.

Every notebook photograph has a stable page such as `/notebooks/img-6238/`. Reviewed polygons mark the handwritten rows that correspond to published collections. Selecting a row opens the roll; a shared physical row offers a choice of its collections. The adjacent list provides the same links for keyboard and touch use. Zoom enlarges the image and its overlays together. Collection pages link back to the relevant notebook page and highlight its entry.

Notebook photographs remain separate from the published film photograph count and the archive/search database. A row is linked only when its roll is present in the current published manifest and its source has been reviewed or explicitly accepted through the scanning app. A page without links is still browsable. Missing matches and synthetic roll identifiers are not guessed.

## Source and build

- Original photographs: `brendan-mulvany-photo-system/images_valoi/index_photos/`.
- Notebook/page catalogue: the local helper's `notebook.sqlite3`, opened read-only.
- Reviewed links: `scripts/notebook-links.json`, tracked with the site source. Each link records its roll, source filename, source SHA-256, entry identifier and normalized polygon. Coordinates refer to the top-left of the EXIF-upright photograph. Separate physical rows can share a transcription ID.
- Exporter: `scripts/export-notebooks.py`. It creates 2600-pixel maximum-edge WebP page images and 320-pixel thumbnails without modifying the originals. EXIF and camera metadata are stripped. Content hashes name the derivatives, and the cache verifies source and derivative checksums before reuse.
- Generated bundle: `static/notebooks/`, ignored by Git. Only the public manifest and referenced media are used by the site builder; private cache metadata is not deployed.
- Renderer and interaction: `scripts/notebooks.mjs`, `static/notebooks.js` and `static/notebooks.css`.

From the public-site repository, rebuild the bundle using the photo-system's Python environment, which already includes Pillow:

```sh
../brendan-mulvany-photo-system/.venv/bin/python \
  cloudflare-preview/scripts/export-notebooks.py \
  --source-root ../brendan-mulvany-photo-system
npm --prefix cloudflare-preview run build
```

The ordinary site build works without a notebook bundle for isolated fixtures; to include the notebooks in a deployment, generate or retain the bundle before building. Deploy with the current published archive snapshot and database bindings, as documented in `README.md`.

## Future batches and corrections

The scanning app's publisher preserves an accepted notebook source as an allowlisted `collection.notebookSources` reference in the public manifest. During preparation it copies the shared source bundle into the isolated release and exports that release's accepted sources there. It does not change another batch's notebook references. Existing reviewed coordinates take precedence over older accepted coordinates for the same roll/source. An accepted reading with no coordinates supplies a source-page backlink and a collection-list entry, without inventing a highlighted row.

To add or correct a reviewed row, inspect the original, update `scripts/notebook-links.json`, then rerun the export and site build. Changed source checksums stop the export until the new photograph is reviewed. Rebuild prepared publications after site-source changes so an older preview cannot replace the new UI. In-progress deployments retain their sealed release for recovery.

The first reviewed set connects 64 of the current 75 collections across 17 notebook pages. Nine synthetic-number collections and rolls `9001` and `r-9002` have no confirmed entry in these photographed notebooks. Existing description conflicts on rolls `3093`, `4083` and `6008` are shown beside their notebook links; links follow the literal roll numbers and do not rewrite archive metadata.

## Validation

```sh
node --experimental-strip-types --test cloudflare-preview/tests/notebooks*.test.mjs
../brendan-mulvany-photo-system/.venv/bin/python \
  cloudflare-preview/tests/test_export_notebooks.py
```

Tests cover published-only links, all reciprocal anchors and media files, shared rows, distinct ditto rows, invalid paths and geometry, escaped text and discrepancy notes, gallery filters, zoom, keyboard selection, source checksums, EXIF handling and incremental exports. The scanning publisher has additional tests for accepted-source preservation and isolated release preparation.
