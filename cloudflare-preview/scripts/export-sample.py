#!/usr/bin/env python3
"""Export the complete already-published archive into a dedicated D1 database.

The source DB is copied without modification into an isolated, temporary
snapshot. Only scenes and their current public image versions are queried; account
tables, annotations, filesystem paths and credentials are never exported.
Every row must also be present in its public roll page.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import sqlite3
import sys
import tempfile
from urllib.request import Request, urlopen


PREVIEW = Path(__file__).resolve().parents[1]
REPO = PREVIEW.parent
CDN = "https://cdn.brendan-mulvany-photography.com"
FEATURED_COLLECTIONS = [
    {
        "id": "popes-visit",
        "roll": "3071",
        "title": "The Pope’s visit",
        "description": "A collection from John Paul II’s visit to Ireland in 1979.",
        "date": "1979",
        "location": "Ireland",
        "tags": ["Pope", "John Paul II", "Ireland", "1979"],
    },
    {
        "id": "ireland-england",
        "roll": "4083",
        "title": "Ireland at Wembley",
        "description": "Ireland versus England at Wembley, from the 1980 archive.",
        "date": "1980",
        "location": "Wembley, England",
        "tags": ["Ireland", "England", "Wembley", "football", "1980"],
    },
    {
        "id": "french-grand-prix",
        "roll": "5005",
        "title": "The French Grand Prix",
        "description": "Formula One, cars and the paddock at the 1980 French Grand Prix.",
        "date": "1980",
        "location": "France",
        "tags": ["French Grand Prix", "France", "Formula One", "motorsport", "1980"],
    },
]
COLLECTION_OVERRIDES = {collection["roll"]: collection for collection in FEATURED_COLLECTIONS}
MAX_PAGE_BYTES = 2_000_000


def image_id(scene_id):
    return int(hashlib.md5(scene_id.encode()).hexdigest()[:8], 16) % 10**9


def public_page_data(html, label, variable="__PAGE_DATA__"):
    match = re.search(r"window\." + re.escape(variable) + r"\s*=\s*", html)
    if not match:
        raise ValueError(f"No public {variable} data found in {label}")
    payload, _ = json.JSONDecoder().raw_decode(html[match.end():])
    date_match = re.search(r'<meta name="build-date" content="([^"]+)"', html)
    return payload, date_match.group(1) if date_match else None


def roll_index(html, label):
    payload, build_date = public_page_data(html, label, "__STATIC_DATA__")
    rolls = {}
    for item in payload.get("rolls", []):
        roll = str(item["roll_number"])
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", roll) or roll in rolls:
            raise ValueError("Invalid or duplicate public roll identifier")
        if not isinstance(item.get("count"), int) or item["count"] < 1:
            raise ValueError(f"Invalid published photo count for roll {roll}")
        rolls[roll] = item["count"]
    if not rolls:
        raise ValueError("The public rolls index is empty; refusing an empty export")
    return rolls, build_date


def fetch_public_html(url):
    request = Request(url, headers={"User-Agent": "ArchiveCloudflareExport/1.0"})
    with urlopen(request, timeout=30) as response:
        data = response.read(MAX_PAGE_BYTES + 1)
    if len(data) > MAX_PAGE_BYTES:
        raise ValueError("Public archive page exceeds the bounded download limit")
    return data.decode("utf-8")


def published_images(payload, roll, expected_count):
    if str(payload.get("roll_number")) != roll:
        raise ValueError(f"Published roll identifier mismatch for {roll}")
    images = payload.get("images", [])
    if len(images) != expected_count or payload.get("count") != expected_count:
        raise ValueError(f"Published photo count differs from the rolls index for {roll}")
    result = {}
    for item in images:
        identifier = item.get("image_id")
        if not isinstance(identifier, int) or isinstance(identifier, bool) or identifier in result:
            raise ValueError(f"Invalid or duplicate published photo identifier in roll {roll}")
        result[identifier] = item
    return result


def clean_text(value):
    text = str(value).strip() if value is not None else ""
    return "" if text.lower() in {"none", "null", "nan"} else text


def collection_metadata(roll, published):
    override = COLLECTION_OVERRIDES.get(roll)
    if override:
        return dict(override)
    images = list(published.values())
    title = next((clean_text(image.get(field)) for field in ("index_book_comment", "roll_comment")
                  for image in images if clean_text(image.get(field))), f"Roll {roll}")
    dates = sorted({clean_text(image.get("capture_date") or image.get("roll_date"))[:4]
                    for image in images if clean_text(image.get("capture_date") or image.get("roll_date"))})
    date = "–".join(dict.fromkeys([dates[0], dates[-1]])) if dates else ""
    return {
        "id": f"roll-{roll.lower()}", "roll": roll, "title": title,
        "description": f"Photographs from Brendan Mulvany’s archive{', ' + date if date else ''}.",
        "date": date, "location": "", "tags": [],
    }


def skipped_ids(path):
    text = path.read_text()
    section = text.split("## Images to Skip", 1)[-1]
    # The existing site excludes numeric image IDs. Ignore Markdown examples.
    return {int(line.strip()) for line in section.splitlines() if line.strip().isdigit()}


def sql_value(value):
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


@contextmanager
def public_snapshot(database):
    """Query an unchanged, checkpointed source without creating source sidecars.

    SQLite files retain WAL mode after their sidecars disappear. Some SQLite
    builds cannot query such a file with mode=ro, because they need to create
    fresh WAL/shared-memory files. Opening only our disposable copy read/write
    permits that housekeeping; query_only still prohibits SQL writes.

    This is an offline exporter, not an online backup facility. Never copy an
    active WAL or rollback journal independently of its database: refuse it,
    and require a separately checkpointed snapshot. Also reject replacement or
    modification of the source while copying it.
    """
    source = database.resolve(strict=True)
    sidecars = [Path(str(source) + suffix) for suffix in ("-wal", "-journal")]

    def ensure_checkpointed():
        if any(path.exists() for path in sidecars):
            raise ValueError("Source database has a WAL or rollback journal. Export a checkpointed offline snapshot and pass it with --database.")

    def identity(stat):
        return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)

    ensure_checkpointed()
    before = identity(source.stat())
    with tempfile.TemporaryDirectory(prefix="bm-public-snapshot-") as directory:
        snapshot = Path(directory) / "public.sqlite"
        with source.open("rb") as reader, snapshot.open("wb") as writer:
            if identity(source.stat()) != before:
                raise ValueError("Source database changed before copying; retry with a stable offline snapshot.")
            shutil.copyfileobj(reader, writer)
        ensure_checkpointed()
        if identity(source.stat()) != before or snapshot.stat().st_size != before[2]:
            raise ValueError("Source database changed while copying; retry with a stable offline snapshot.")
        connection = sqlite3.connect(str(snapshot))
        try:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA query_only=ON")
            yield connection
        finally:
            connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", type=Path, default=REPO / "public_site.db")
    parser.add_argument("--public-dir", type=Path, default=REPO / "public")
    parser.add_argument("--output-dir", type=Path, default=PREVIEW / "data")
    parser.add_argument("--verify-live-origin", help="Verify the complete live HTTPS rolls index and all its roll pages")
    parser.add_argument("--live-dir", type=Path, help="Verify freshly fetched rolls.html and bm-roll-<roll>.html files in this directory")
    args = parser.parse_args()
    if args.verify_live_origin and not re.fullmatch(r"https://[a-zA-Z0-9.-]+", args.verify_live_origin):
        parser.error("--verify-live-origin must be an HTTPS origin without a path")
    if args.verify_live_origin and args.live_dir:
        parser.error("Use either --verify-live-origin or --live-dir")

    excluded = skipped_ids(REPO / "skip_images.md")
    local_index_path = args.public_dir / "rolls" / "index.html"
    local_rolls, local_index_date = roll_index(local_index_path.read_text(), str(local_index_path))
    live_rolls, live_index_date, live_html = None, None, {}
    if args.live_dir:
        live_rolls, live_index_date = roll_index((args.live_dir / "rolls.html").read_text(), "live rolls index")
        live_html = {roll: (args.live_dir / f"bm-roll-{roll}.html").read_text() for roll in live_rolls}
    elif args.verify_live_origin:
        index_url = args.verify_live_origin + "/rolls/"
        live_rolls, live_index_date = roll_index(fetch_public_html(index_url), index_url)
        # Bound requests and downloaded page sizes; never fetch or copy images.
        with ThreadPoolExecutor(max_workers=6) as executor:
            html_pages = executor.map(fetch_public_html, (f"{args.verify_live_origin}/roll/{roll}/" for roll in live_rolls))
            live_html = dict(zip(live_rolls, html_pages))
    if live_rolls is not None and live_rolls != local_rolls:
        raise ValueError("Local and live published roll inventories differ; refresh the offline public snapshot before exporting.")

    photos, collections, sources = [], [], []
    version_counts, published_ids = {}, set()
    # Match the production application's publication gate. The page inventory,
    # rather than a version-type assumption, authorizes each individual image.
    with public_snapshot(args.database) as connection:
        rows = connection.execute(
            """SELECT s.scene_id, s.base_filename, s.roll_number,
                      v.r2_key, v.width, v.height, v.version_type
               FROM scenes AS s
               JOIN image_versions AS v ON v.scene_id = s.scene_id
                    AND v.is_current = 1 AND v.r2_key IS NOT NULL"""
        ).fetchall()
        current_versions = {}
        for row in rows:
            identifier = image_id(row["scene_id"])
            if identifier in current_versions:
                raise ValueError("Image ID collision or duplicate current version; refusing ambiguous export")
            current_versions[identifier] = dict(row)

    # Preserve the original three collection slugs and their display order.
    roll_order = [roll for roll in COLLECTION_OVERRIDES if roll in local_rolls]
    roll_order += sorted(set(local_rolls) - set(roll_order))
    for roll in roll_order:
        page_path = args.public_dir / "roll" / roll / "index.html"
        local_data, build_date = public_page_data(page_path.read_text(), str(page_path))
        local_published = published_images(local_data, roll, local_rolls[roll])
        published = local_published
        source = {"roll": roll, "localBuildDate": build_date, "liveVerified": live_rolls is not None}
        if live_rolls is not None:
            live_data, live_date = public_page_data(live_html[roll], f"live roll {roll}")
            published = published_images(live_data, roll, live_rolls[roll])
            if published.keys() != local_published.keys():
                raise ValueError(f"Local and live published photographs differ for roll {roll}")
            source.update({"liveBuildDate": live_date, "verifiedAt": datetime.now(timezone.utc).isoformat()})
        sources.append(source)
        collection = collection_metadata(roll, published)
        selected = []
        for identifier, item in sorted(published.items(), key=lambda pair: (str(pair[1].get("image_name", "")), pair[0])):
            if identifier in published_ids:
                raise ValueError(f"Photo {identifier} appears in more than one published roll")
            published_ids.add(identifier)
            if identifier in excluded:
                continue
            row = current_versions.get(identifier)
            if row is None or row["scene_id"] != item.get("scene_id") or str(row["roll_number"]) != roll:
                raise ValueError(f"Published photo {identifier} has no matching current public database version")
            if not re.fullmatch(r"[A-Za-z0-9_-]+", row["r2_key"]):
                raise ValueError("Unexpected public image key format")
            image_base = f'{CDN}/{row["r2_key"]}'
            for label, available in [("local", local_published), ("live", published)]:
                if available[identifier].get("image_url") != image_base + "/original.jpg":
                    raise ValueError(f"Photo {identifier} is not published with this URL in the {label} roll page")
            date = clean_text(item.get("capture_date") or item.get("roll_date")) or collection["date"]
            tags = collection["tags"] + [roll] + [clean_text(item.get(field)) for field in
                ("short_description", "roll_comment", "index_book_comment", "roll_date", "index_book_date")]
            selected.append({
                "id": identifier, "collectionId": collection["id"],
                "title": f'{collection["title"]} · {row["base_filename"]}',
                # Metadata comes from the published page, not unreviewed updates
                # to a database row whose image happened to be published earlier.
                "description": clean_text(item.get("description")) or clean_text(item.get("short_description")),
                "date": date, "year": date[:4], "location": collection["location"],
                "tags": list(dict.fromkeys(tag for tag in tags if tag)),
                "imageBase": image_base, "width": row["width"], "height": row["height"],
            })
            version_counts[row["version_type"]] = version_counts.get(row["version_type"], 0) + 1
        if not selected:
            continue
        collections.append({key: collection[key] for key in ["id", "roll", "title", "description", "date"]}
                           | {"count": len(selected), "coverId": selected[0]["id"]})
        photos.extend(selected)
    if len({photo["id"] for photo in photos}) != len(photos):
        raise ValueError("Image ID collision or duplicate current version; refusing ambiguous export")
    if len({collection["id"] for collection in collections}) != len(collections):
        raise ValueError("Collection slug collision; refusing ambiguous export")
    audit = {
        "scope": "full-published-archive", "publishedRolls": len(local_rolls),
        "publishedPhotos": sum(local_rolls.values()), "exportedPhotos": len(photos),
        "skippedIds": sorted(excluded & current_versions.keys()),
        "currentDatabaseOnlyPhotos": len(current_versions.keys() - published_ids - excluded),
        "versionTypes": version_counts, "sourceDatabaseBytes": args.database.stat().st_size,
        "localIndexBuildDate": local_index_date, "liveIndexBuildDate": live_index_date,
        "preservedCollectionIds": [collection["id"] for collection in collections if collection["roll"] in COLLECTION_OVERRIDES],
    }
    payload = {
        "collections": collections,
        "photos": photos,
        "sourceValidation": {
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "sources": sources,
            "audit": audit,
            "descriptionNote": "Descriptions are inherited machine-generated archive metadata and may contain inaccuracies.",
        },
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "sample.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    fields = ["id", "collectionId", "title", "description", "date", "year", "location", "tags", "imageBase", "width", "height"]
    sql = ["-- Published public archive only. No account, annotation, credential or local-path data.", "DELETE FROM photos;"]
    for photo in photos:
        values = [json.dumps(photo[field], ensure_ascii=False) if field == "tags" else photo[field] for field in fields]
        sql.append("INSERT INTO photos (id,collection_id,title,description,date,year,location,tags,image_base,width,height) VALUES (" + ",".join(map(sql_value, values)) + ");")
    sql.extend(["INSERT INTO photos_fts(photos_fts) VALUES ('rebuild');", "INSERT INTO photos_fts(photos_fts) VALUES ('optimize');"])
    (args.output_dir / "seed.sql").write_text("\n".join(sql) + "\n")
    print(json.dumps({"photos": len(photos), "collectionCount": len(collections), "audit": audit,
                      "manifestBytes": (args.output_dir / "sample.json").stat().st_size,
                      "seedBytes": (args.output_dir / "seed.sql").stat().st_size}, ensure_ascii=False, indent=2))
    if not args.verify_live_origin and not args.live_dir:
        print("WARNING: verified against local public pages only; their build dates may be stale. Use --verify-live-origin to confirm current publication.", file=sys.stderr)


if __name__ == "__main__":
    main()
