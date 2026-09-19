"""Local notebook export checks; run with the photo-system Python environment."""
import importlib.util
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/export-notebooks.py"
spec = importlib.util.spec_from_file_location("notebook_export", SCRIPT)
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class NotebookExportTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.images = self.root / "images_valoi/index_photos"
        self.images.mkdir(parents=True)
        self.helper = self.root / "notebook_helper"
        self.helper.mkdir()
        self.output = self.root / "public-notebooks"
        self.links = self.root / "links.json"
        self.manifest = self.root / "sample.json"
        self.first = self.images / "IMG_6238.jpeg"
        exif = Image.Exif()
        exif[274] = 6
        exif[315] = "Private photographer metadata"
        Image.new("RGB", (100, 200), "grey").save(self.first, exif=exif)
        Image.new("RGB", (600, 300), "white").save(self.images / "IMG_6239.jpeg")
        with sqlite3.connect(self.helper / "notebook.sqlite3") as db:
            db.execute("CREATE TABLE pages(source_image TEXT,book_number TEXT,page_type TEXT)")
            db.executemany("INSERT INTO pages VALUES(?,?,'index')", [("IMG_6238.jpeg", "2"), ("IMG_6239.jpeg", "2")])
        self.write(self.links, {"version": 1, "links": [self.link()]})

    def write(self, path, value):
        path.write_text(json.dumps(value))

    def link(self, **kwargs):
        return {"roll": "5005", "sourceImage": "IMG_6238.jpeg", "entryId": "IMG_6238:visual:001", "book": "2",
                "polygon": [[.1, .2], [.8, .2], [.8, .3], [.1, .3]], "verification": "visual", **kwargs}

    def run_export(self, manifest=None):
        return exporter.export_notebooks(self.root, self.output, self.links, manifest)

    def test_export_is_bounded_oriented_metadata_free_and_incremental(self):
        before = exporter.sha256(self.first)
        first = self.run_export()
        index = json.loads((self.output / "index.json").read_text())
        self.assertEqual(first["pages"], 2)
        self.assertEqual(first["generatedPages"], 2)
        page = index["pages"][0]
        self.assertEqual(page["id"], "img-6238")
        self.assertEqual((page["width"], page["height"]), (200, 100), "EXIF rotation is baked into pixels")
        self.assertEqual(page["sourceHash"], before)
        self.assertEqual(page["title"], "Notebook 2 · IMG_6238")
        self.assertEqual([p["pageNumber"] for p in index["pages"]], [1, 2])
        self.assertEqual(page["entries"][0]["rolls"], ["5005"])
        self.assertNotIn(str(self.root), json.dumps(index))
        self.assertNotIn("Private photographer metadata", json.dumps(index))
        for page in index["pages"]:
            for field, limit in [("image", 2600), ("thumbnail", 320)]:
                asset = self.output / page[field].removeprefix("/notebooks/")
                with Image.open(asset) as derivative:
                    self.assertLessEqual(max(derivative.size), limit)
                    self.assertFalse(derivative.getexif())
                    self.assertNotIn("exif", derivative.info)
        times = {path.name: path.stat().st_mtime_ns for path in (self.output / "media").iterdir()}
        second = self.run_export()
        self.assertEqual(second["generatedPages"], 0)
        self.assertEqual(second["reusedPages"], 2)
        self.assertEqual(times, {path.name: path.stat().st_mtime_ns for path in (self.output / "media").iterdir()})
        self.assertEqual(exporter.sha256(self.first), before, "source bytes are never altered")

    def test_large_page_is_resized_without_distorting_its_coordinates(self):
        Image.new("RGB", (1000, 3000), "white").save(self.first)
        self.run_export()
        page = json.loads((self.output / "index.json").read_text())["pages"][0]
        self.assertEqual(page["height"], 2600)
        self.assertAlmostEqual(page["width"] / page["height"], 1 / 3, places=3)
        self.assertEqual(page["entries"][0]["polygon"], self.link()["polygon"])

    def test_only_reviewed_links_or_accepted_metadata_are_exported(self):
        (self.helper / "entries.jsonl").write_text(json.dumps({"roll_numbers": ["9999"], "description": "PRIVATE raw OCR"}))
        self.write(self.links, {"version": 1, "links": [self.link(), self.link(roll="5006")]})
        self.write(self.manifest, {"collections": [{"roll": "new-roll", "notebookSources": [
            {"sourceImage": "IMG_6239.jpeg", "entryId": "accepted:1", "book": "2", "polygon": None,
             "transcription": "PRIVATE source wording"}]}]})
        self.run_export(self.manifest)
        index = json.loads((self.output / "index.json").read_text())
        self.assertEqual(index["pages"][0]["entries"][0]["rolls"], ["5005", "5006"])
        self.assertEqual(index["pages"][1]["entries"][0], {"id": "accepted:1", "rolls": ["new-roll"], "polygon": None, "method": "verified"})
        self.assertNotIn("PRIVATE", json.dumps(index))
        self.assertNotIn("9999", json.dumps(index))

    def test_distinct_rows_from_one_transcription_keep_independent_hotspots_and_public_notes(self):
        self.write(self.links, {"version": 1, "links": [
            self.link(publicNote="The collection title differs from the notebook."),
            self.link(roll="5006", polygon=[[.1, .3], [.8, .3], [.8, .4], [.1, .4]])]})
        self.write(self.manifest, {"collections": [{"roll": "5005", "notebookSources": [
            {"sourceImage": "IMG_6238.jpeg", "entryId": "old-snapshot:1", "polygon": None}]}]})
        self.run_export(self.manifest)
        entries = json.loads((self.output / "index.json").read_text())["pages"][0]["entries"]
        self.assertEqual(len(entries), 2)
        self.assertNotEqual(entries[0]["id"], entries[1]["id"])
        self.assertEqual(sorted([entry["rolls"] for entry in entries]), [["5005"], ["5006"]])
        self.assertEqual(next(entry for entry in entries if entry["rolls"] == ["5005"])["note"], "The collection title differs from the notebook.")

    def test_bad_source_coordinates_ids_and_unreviewed_records_fail_without_replacing_index(self):
        self.run_export()
        before = (self.output / "index.json").read_bytes()
        for invalid in [self.link(verification="ocr"), self.link(sourceImage="../outside.jpeg"), self.link(entryId="../row"),
                        self.link(roll="../roll"), self.link(polygon=[[0, 0], [1, 0], [2, 1]]),
                        self.link(polygon=[[0, 0], [0, 0], [0, 0]]), self.link(sourceImage="IMG_9999.jpeg"),
                        self.link(sourceSha256="0" * 64)]:
            with self.subTest(invalid=invalid):
                self.write(self.links, {"version": 1, "links": [invalid]})
                with self.assertRaises(ValueError):
                    self.run_export()
                self.assertEqual((self.output / "index.json").read_bytes(), before)

    def test_missing_or_corrupt_cached_assets_are_regenerated(self):
        self.run_export()
        page = json.loads((self.output / "index.json").read_text())["pages"][0]
        (self.output / page["image"].removeprefix("/notebooks/")).write_bytes(b"not an image")
        result = self.run_export()
        self.assertEqual(result["generatedPages"], 1)
        self.assertEqual(result["reusedPages"], 1)


if __name__ == "__main__":
    unittest.main()
