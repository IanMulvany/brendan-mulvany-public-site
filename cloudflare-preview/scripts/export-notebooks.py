#!/usr/bin/env python3
"""Export notebook page derivatives and reviewed links without publishing.

Original photographs and the local notebook database are read-only. Raw OCR,
local paths, scan notes and EXIF data are never included in the public bundle.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sqlite3
import tempfile
from collections import defaultdict
from pathlib import Path

from PIL import Image, ImageOps, __version__ as PILLOW_VERSION

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = {"version": 1, "detailEdge": 2600, "thumbnailEdge": 320, "quality": 88, "method": 6,
            "format": "webp", "pillow": PILLOW_VERSION, "orientation": "exif-transpose", "metadata": "stripped"}
SOURCE_NAME = re.compile(r"IMG_\d+\.jpe?g", re.I)
ROLL = re.compile(r"[A-Za-z0-9_-]{1,80}")
ENTRY = re.compile(r"[A-Za-z0-9:_-]{1,160}")


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    try:
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def polygon(value):
    if value is None:
        return None
    if not isinstance(value, list) or not 3 <= len(value) <= 12:
        raise ValueError("A notebook polygon needs 3 to 12 normalized points")
    points = []
    for point in value:
        if not isinstance(point, (list, tuple)) or len(point) != 2:
            raise ValueError("A notebook polygon point must be [x, y]")
        if any(type(number) not in (float, int) or not math.isfinite(number) or not 0 <= number <= 1 for number in point):
            raise ValueError("Notebook polygon coordinates must be finite numbers between 0 and 1")
        points.append([round(float(number), 7) for number in point])
    area = abs(sum(a[0] * b[1] - b[0] * a[1] for a, b in zip(points, points[1:] + points[:1]))) / 2
    if area <= 0.000001:
        raise ValueError("A notebook polygon must enclose a visible area")
    return points


def reviewed_links(path, manifest=None):
    if not Path(path).is_file():
        raise ValueError(f"Reviewed notebook links are missing: {path}. Restore scripts/notebook-links.json before exporting.")
    document = read_json(path)
    if document.get("version") != 1 or not isinstance(document.get("links"), list):
        raise ValueError("Reviewed notebook links must contain version:1 and a links array")
    links = []
    for row in document["links"]:
        if not isinstance(row, dict) or row.get("verification") != "visual":
            raise ValueError("Notebook links require explicit visual verification")
        links.append({**row, "polygon": polygon(row.get("polygon"))})
    curated_sources = {(row.get("sourceImage"), row.get("roll")) for row in links}
    if manifest:
        for collection in read_json(manifest).get("collections", []):
            for source in collection.get("notebookSources", []):
                # These references are allowlisted from metadata the user
                # accepted in the scanning app; uncertain OCR is not exported.
                if (source.get("sourceImage"), collection.get("roll")) in curated_sources:
                    continue
                links.append({**source, "roll": collection.get("roll"), "verification": "accepted_metadata",
                              "polygon": polygon(source.get("polygon"))})
    for row in links:
        if not isinstance(row.get("roll"), str) or not ROLL.fullmatch(row["roll"]):
            raise ValueError("A reviewed notebook link has an invalid roll identifier")
        if not isinstance(row.get("sourceImage"), str) or not SOURCE_NAME.fullmatch(row["sourceImage"]):
            raise ValueError("A reviewed notebook link has an invalid source photograph")
        if not isinstance(row.get("entryId"), str) or not ENTRY.fullmatch(row["entryId"]):
            raise ValueError("A reviewed notebook link has an invalid entry identifier")
        if row.get("sourceSha256") and not re.fullmatch(r"[a-f0-9]{64}", row["sourceSha256"]):
            raise ValueError("Notebook sourceSha256 must be a SHA-256 digest")
    return links


def page_catalogue(source_root):
    path = source_root / "notebook_helper/notebook.sqlite3"
    if not path.is_file():
        return {}
    with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as db:
        return {name: {"book": str(book) if book else "unassigned", "type": page_type}
                for name, book, page_type in db.execute("SELECT source_image,book_number,page_type FROM pages")}


def derivative(image, edge, directory, suffix):
    resized = image.copy()
    resized.thumbnail((edge, edge), Image.Resampling.LANCZOS)
    # Construct fresh pixels so orientation/GPS/camera EXIF and other metadata
    # cannot be carried into a Pillow encoder through image.info.
    clean = Image.new("RGB", resized.size)
    clean.paste(resized)
    with tempfile.NamedTemporaryFile(dir=directory, suffix=".webp", delete=False) as stream:
        temporary = Path(stream.name)
    try:
        clean.save(temporary, format="WEBP", quality=SETTINGS["quality"], method=SETTINGS["method"])
        checksum = sha256(temporary)
        filename = checksum[:32] + suffix + ".webp"
        destination = directory / filename
        temporary.replace(destination)
        return {"file": filename, "sha256": checksum, "width": clean.width, "height": clean.height}
    finally:
        temporary.unlink(missing_ok=True)


def valid_cached(cached, media, source_hash):
    if not isinstance(cached, dict) or cached.get("sourceHash") != source_hash or cached.get("settings") != SETTINGS:
        return False
    for kind in ("detail", "thumbnail"):
        item = cached.get(kind, {})
        filename = item.get("file", "")
        if not re.fullmatch(r"[a-f0-9]{32}(?:-thumb)?\.webp", filename):
            return False
        path = media / filename
        if not path.is_file() or path.is_symlink() or sha256(path) != item.get("sha256"):
            return False
    return True


def export_notebooks(source_root, output, links_path, manifest=None):
    source_root, output = Path(source_root).resolve(), Path(output).resolve()
    images = source_root / "images_valoi/index_photos"
    if not images.is_dir():
        raise ValueError(f"Notebook photographs are missing: {images}. Restore the originals before exporting.")
    sources = sorted((path for path in images.iterdir() if SOURCE_NAME.fullmatch(path.name)), key=lambda path: path.name.casefold())
    if not sources or any(not path.is_file() or path.is_symlink() for path in sources):
        raise ValueError("Notebook sources must contain regular IMG_*.jpeg photographs, not symbolic links")
    if output == images or output.is_relative_to(images) or images.is_relative_to(output):
        raise ValueError("Notebook export must be outside the source photographs")
    links = reviewed_links(links_path, manifest)
    known_sources = {path.name for path in sources}
    if missing := {row["sourceImage"] for row in links} - known_sources:
        raise ValueError("Reviewed notebook links reference missing source images: " + ", ".join(sorted(missing)))
    catalogue = page_catalogue(source_root)
    by_source = defaultdict(list)
    for row in links:
        by_source[row["sourceImage"]].append(row)
    media = output / "media"
    media.mkdir(parents=True, exist_ok=True)
    cache_path = output / ".export-cache.json"
    try:
        cache = read_json(cache_path) if cache_path.is_file() else {}
    except (ValueError, OSError):
        cache = {}
    next_cache, pages, book_pages = {}, [], defaultdict(int)
    generated = reused = 0
    for path in sources:
        source_hash = sha256(path)
        for row in by_source[path.name]:
            if row.get("sourceSha256") and row["sourceSha256"] != source_hash:
                raise ValueError(f"Notebook photograph {path.name} changed since its links were reviewed. Review the new photograph before exporting.")
        cached = cache.get(path.name)
        if valid_cached(cached, media, source_hash):
            reused += 1
        else:
            with Image.open(path) as original:
                image = ImageOps.exif_transpose(original).convert("RGB")
                cached = {"sourceHash": source_hash, "settings": SETTINGS,
                          "detail": derivative(image, SETTINGS["detailEdge"], media, ""),
                          "thumbnail": derivative(image, SETTINGS["thumbnailEdge"], media, "-thumb")}
            generated += 1
        next_cache[path.name] = cached
        # An interrupted long first export can resume without re-encoding the
        # pages already completed. The public index is still replaced last.
        cache[path.name] = cached
        write_json(cache_path, cache)
        hints = {str(row["book"]) for row in by_source[path.name] if row.get("book")}
        book = catalogue.get(path.name, {}).get("book") or (next(iter(hints)) if len(hints) == 1 else "unassigned")
        if hints and hints != {book}:
            raise ValueError(f"Reviewed notebook book differs from the page catalogue for {path.name}")
        book_pages[book] += 1
        entries = {}
        geometries = defaultdict(set)
        for row in by_source[path.name]:
            geometries[row["entryId"]].add(json.dumps(row["polygon"], separators=(",", ":")))
        for row in by_source[path.name]:
            entry_id = row["entryId"]
            if len(geometries[entry_id]) > 1:
                area_hash = hashlib.sha256(json.dumps(row["polygon"], separators=(",", ":")).encode()).hexdigest()[:10]
                entry_id = entry_id[:140] + ":area:" + area_hash
            item = entries.get(entry_id)
            if item is None:
                item = {"id": entry_id, "rolls": [], "polygon": row["polygon"], "method": "verified"}
                if isinstance(row.get("description"), str) and row["verification"] == "visual":
                    item["description"] = row["description"].strip()[:500]
                if isinstance(row.get("publicNote"), str) and row["verification"] == "visual":
                    item["note"] = row["publicNote"].strip()[:1000]
                entries[entry_id] = item
            # Curated links precede accepted metadata and take precedence over
            # an older or missing area in a saved metadata snapshot.
            if row["roll"] not in item["rolls"]:
                item["rolls"].append(row["roll"])
        for entry in entries.values():
            entry["rolls"].sort()
        detail, thumb = cached["detail"], cached["thumbnail"]
        pages.append({"id": path.stem.lower().replace("_", "-"), "sourceImage": path.name, "sourceHash": source_hash,
                      "book": book, "pageNumber": book_pages[book],
                      "title": f"Notebook {book} · {path.stem}" if book != "unassigned" else f"Notebook photograph · {path.stem}",
                      "width": detail["width"], "height": detail["height"],
                      "image": "/notebooks/media/" + detail["file"], "thumbnail": "/notebooks/media/" + thumb["file"],
                      "entries": sorted(entries.values(), key=lambda entry: entry["id"])})
    document = {"version": 1, "pages": pages}
    write_json(cache_path, next_cache)
    write_json(output / "index.json", document)
    return {"pages": len(pages), "reviewedEntries": sum(len(page["entries"]) for page in pages),
            "generatedPages": generated, "reusedPages": reused, "output": str(output / "index.json")}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, default=ROOT.parents[1] / "brendan-mulvany-photo-system")
    parser.add_argument("--output", type=Path, default=ROOT / "static/notebooks")
    parser.add_argument("--links", type=Path, default=ROOT / "scripts/notebook-links.json")
    parser.add_argument("--manifest", type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(export_notebooks(args.source_root, args.output, args.links, args.manifest)))
    except (ValueError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"Notebook export failed: {error}\n")


if __name__ == "__main__":
    main()
