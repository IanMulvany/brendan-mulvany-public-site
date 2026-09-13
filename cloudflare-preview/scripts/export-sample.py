#!/usr/bin/env python3
"""Export an allowlisted, already-published archive sample into a fresh D1 DB.

The source DB is copied without modification into an isolated, temporary
snapshot. Only scenes and current final-crop versions are queried; account
tables, annotations, filesystem paths and credentials are never exported.
Every row must also be present in its public roll page.
"""

import argparse
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
COLLECTIONS = [
    {
        "id": "popes-visit",
        "batch": "2025-12-01-batch-5",
        "roll": "3071",
        "title": "The Pope’s visit",
        "description": "A collection from John Paul II’s visit to Ireland in 1979.",
        "date": "1979",
        "location": "Ireland",
        "tags": ["Pope", "John Paul II", "Ireland", "1979"],
        "expectedCount": 43,
    },
    {
        "id": "ireland-england",
        "batch": "2025-12-11-batch-2",
        "roll": "4083",
        "title": "Ireland at Wembley",
        "description": "Ireland versus England at Wembley, from the 1980 archive.",
        "date": "1980",
        "location": "Wembley, England",
        "tags": ["Ireland", "England", "Wembley", "football", "1980"],
        "expectedCount": 36,
    },
    {
        "id": "french-grand-prix",
        "batch": "2025-12-01-batch-4",
        "roll": "5005",
        "title": "The French Grand Prix",
        "description": "Formula One, cars and the paddock at the 1980 French Grand Prix.",
        "date": "1980",
        "location": "France",
        "tags": ["French Grand Prix", "France", "Formula One", "motorsport", "1980"],
        "expectedCount": 35,
    },
]


def image_id(scene_id):
    return int(hashlib.md5(scene_id.encode()).hexdigest()[:8], 16) % 10**9


def public_page_data(html, label):
    match = re.search(r"window\.__PAGE_DATA__\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not match:
        raise ValueError(f"No public roll data found in {label}")
    payload = json.loads(match.group(1))
    date_match = re.search(r'<meta name="build-date" content="([^"]+)"', html)
    return payload, date_match.group(1) if date_match else None


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
    parser.add_argument("--verify-live-origin", help="Also require membership on live HTTPS roll pages")
    parser.add_argument("--live-dir", type=Path, help="Validate freshly fetched bm-roll-<roll>.html files in this directory")
    args = parser.parse_args()
    if args.verify_live_origin and not re.fullmatch(r"https://[a-zA-Z0-9.-]+", args.verify_live_origin):
        parser.error("--verify-live-origin must be an HTTPS origin without a path")
    if args.verify_live_origin and args.live_dir:
        parser.error("Use either --verify-live-origin or --live-dir")

    excluded = skipped_ids(REPO / "skip_images.md")
    photos, collections, sources = [], [], []
    with public_snapshot(args.database) as connection:
        for collection in COLLECTIONS:
            page_path = args.public_dir / "roll" / collection["roll"] / "index.html"
            page_data, build_date = public_page_data(page_path.read_text(), str(page_path))
            published = {int(photo["image_id"]): photo for photo in page_data["images"]}
            live_published = None
            if args.live_dir:
                live_path = args.live_dir / f'bm-roll-{collection["roll"]}.html'
                live_data, live_date = public_page_data(live_path.read_text(), str(live_path))
                live_published = {int(photo["image_id"]): photo for photo in live_data["images"]}
            elif args.verify_live_origin:
                url = f'{args.verify_live_origin}/roll/{collection["roll"]}/'
                request = Request(url, headers={"User-Agent": "ArchiveCloudflarePreview/1.0"})
                with urlopen(request, timeout=30) as response:
                    live_data, live_date = public_page_data(response.read().decode(), url)
                live_published = {int(photo["image_id"]): photo for photo in live_data["images"]}
            source = {
                "roll": collection["roll"],
                "localBuildDate": build_date,
                "liveVerified": live_published is not None,
            }
            if live_published is not None:
                source["liveBuildDate"] = live_date
                source["verifiedAt"] = datetime.now(timezone.utc).isoformat()
            sources.append(source)

            # Exact publication join used by the current app, narrowed to the
            # explicit collection allowlist and only its final-crop versions.
            rows = connection.execute(
                """SELECT s.scene_id, s.base_filename, s.short_description,
                          s.description, s.capture_date, s.roll_date,
                          v.r2_key, v.width, v.height
                   FROM scenes AS s
                   JOIN image_versions AS v ON v.scene_id = s.scene_id
                        AND v.is_current = 1 AND v.r2_key IS NOT NULL
                        AND v.version_type = 'final_crops'
                   WHERE s.batch_name = ? AND s.roll_number = ?
                   ORDER BY s.base_filename, s.scene_id""",
                (collection["batch"], collection["roll"]),
            ).fetchall()
            selected = []
            for row in rows:
                identifier = image_id(row["scene_id"])
                if identifier in excluded:
                    continue
                if not re.fullmatch(r"[A-Za-z0-9_-]+", row["r2_key"]):
                    raise ValueError("Unexpected public image key format")
                image_base = f'{CDN}/{row["r2_key"]}'
                for label, available in [("local", published), ("live", live_published)]:
                    if available is None:
                        continue
                    item = available.get(identifier)
                    if item is None or item.get("image_url") != image_base + "/original.jpg":
                        raise ValueError(f"Photo {identifier} is not published with this URL in the {label} roll page")
                date = row["capture_date"] or row["roll_date"] or collection["date"]
                selected.append({
                    "id": identifier,
                    "collectionId": collection["id"],
                    "title": f'{collection["title"]} · {row["base_filename"]}',
                    # Source descriptions are machine-generated archive metadata;
                    # preserve them for search, without promoting them to fact.
                    "description": row["description"] or row["short_description"] or "",
                    "date": date,
                    "year": str(date)[:4],
                    "location": collection["location"],
                    "tags": collection["tags"] + [collection["roll"]],
                    "imageBase": image_base,
                    "width": row["width"],
                    "height": row["height"],
                })
            if len(selected) != collection["expectedCount"]:
                raise ValueError(f'{collection["id"]}: expected {collection["expectedCount"]} public photos, found {len(selected)}; review the allowlist')
            collections.append({
                key: collection[key] for key in ["id", "roll", "title", "description", "date"]
            } | {"count": len(selected), "coverId": selected[0]["id"]})
            photos.extend(selected)
    if len({photo["id"] for photo in photos}) != len(photos):
        raise ValueError("Image ID collision or duplicate current version; refusing ambiguous export")
    payload = {
        "collections": collections,
        "photos": photos,
        "sourceValidation": {
            "exportedAt": datetime.now(timezone.utc).isoformat(),
            "sources": sources,
            "descriptionNote": "Descriptions are inherited machine-generated archive metadata and may contain inaccuracies.",
        },
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "sample.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    fields = ["id", "collectionId", "title", "description", "date", "year", "location", "tags", "imageBase", "width", "height"]
    sql = ["-- Public sample only. No account, annotation, credential or local-path data.", "DELETE FROM photos;"]
    for photo in photos:
        values = [json.dumps(photo[field], ensure_ascii=False) if field == "tags" else photo[field] for field in fields]
        sql.append("INSERT INTO photos (id,collection_id,title,description,date,year,location,tags,image_base,width,height) VALUES (" + ",".join(map(sql_value, values)) + ");")
    sql.extend(["INSERT INTO photos_fts(photos_fts) VALUES ('rebuild');", "INSERT INTO photos_fts(photos_fts) VALUES ('optimize');"])
    (args.output_dir / "seed.sql").write_text("\n".join(sql) + "\n")
    print(json.dumps({"photos": len(photos), "collections": collections, "sources": sources}, ensure_ascii=False, indent=2))
    if not args.verify_live_origin and not args.live_dir:
        print("WARNING: verified against local public pages only; their build dates may be stale. Use --verify-live-origin to confirm current publication.", file=sys.stderr)


if __name__ == "__main__":
    main()
