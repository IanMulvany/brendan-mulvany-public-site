import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, test} from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'bm-export-test-'));
after(() => rmSync(output, {recursive: true, force: true}));

function exportSample() {
  execFileSync('python3', ['scripts/export-sample.py', '--output-dir', output], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']});
  return JSON.parse(readFileSync(join(output, 'sample.json'), 'utf8'));
}

const sample = exportSample();

test('the export contains only public image metadata with valid collection links', () => {
  const allowed = ['id', 'collectionId', 'title', 'description', 'date', 'year', 'location', 'tags', 'imageBase', 'width', 'height'].sort();
  assert.equal(sample.photos.length, 114);
  assert.equal(sample.collections.length, 3);
  for (const photo of sample.photos) {
    assert.deepEqual(Object.keys(photo).sort(), allowed);
    assert.equal(Number.isSafeInteger(photo.id), true);
    assert.notEqual(photo.id, 261093582, 'the existing site’s excluded image must stay excluded');
    assert.match(photo.imageBase, /^https:\/\/cdn\.brendan-mulvany-photography\.com\/[A-Za-z0-9_-]+$/);
    assert.doesNotMatch(JSON.stringify(photo), /\/Users\/|password_hash|auth_token|TURSO_DATABASE_URL/);
    const collection = sample.collections.find(item => item.id === photo.collectionId);
    assert.ok(collection);
    assert.ok(photo.tags.includes(collection.roll));
  }
  for (const collection of sample.collections) {
    const members = sample.photos.filter(photo => photo.collectionId === collection.id);
    assert.equal(members.length, collection.count);
    assert.ok(members.some(photo => photo.id === collection.coverId));
  }
});

test('same source creates identical public data and SQL; provenance may change', () => {
  const firstSeed = readFileSync(join(output, 'seed.sql'), 'utf8');
  const again = exportSample();
  assert.deepEqual(again.photos, sample.photos);
  assert.deepEqual(again.collections, sample.collections);
  assert.equal(readFileSync(join(output, 'seed.sql'), 'utf8'), firstSeed);
  assert.ok(again.sourceValidation.sources.every(source => source.liveVerified === false));
});

test('export fails closed when a selected photograph is missing from its published roll', () => {
  const publicDir = join(output, 'changed-public');
  const destination = join(output, 'rejected-export');
  for (const collection of sample.collections) {
    const directory = join(publicDir, 'roll', collection.roll);
    mkdirSync(directory, {recursive: true});
    let html = readFileSync(join(root, '..', 'public', 'roll', collection.roll, 'index.html'), 'utf8');
    if (collection.roll === '3071') {
      html = html.replace(/window\.__PAGE_DATA__\s*=\s*(\{.*?\});\s*<\/script>/s, (_, serialized) => {
        const page = JSON.parse(serialized);
        page.images.shift();
        return `window.__PAGE_DATA__ = ${JSON.stringify(page)};</script>`;
      });
    }
    writeFileSync(join(directory, 'index.html'), html);
  }
  assert.throws(() => execFileSync('python3', [
    'scripts/export-sample.py', '--public-dir', publicDir, '--output-dir', destination,
  ], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']}), error => {
    assert.match(error.stderr.toString(), /not published with this URL in the local roll page/);
    return true;
  });
  assert.equal(existsSync(join(destination, 'sample.json')), false);
  assert.equal(existsSync(join(destination, 'seed.sql')), false);
});

test('migration and seed recreate a consistent full-text snapshot without duplicates', () => {
  const result = JSON.parse(execFileSync('python3', ['-c', String.raw`
import json, pathlib, sqlite3, sys
connection = sqlite3.connect(':memory:')
migration = pathlib.Path('migrations/0001_search.sql').read_text()
seed = pathlib.Path(sys.argv[1]).read_text()
for _ in range(2):
    connection.executescript(migration)
    connection.executescript(seed)
    connection.execute("INSERT INTO photos_fts(photos_fts, rank) VALUES ('integrity-check', 1)")
    assert connection.execute('SELECT COUNT(*) FROM photos').fetchone()[0] == 114
    assert connection.execute('SELECT COUNT(DISTINCT id) FROM photos').fetchone()[0] == 114
counts = dict(connection.execute('SELECT collection_id, COUNT(*) FROM photos GROUP BY collection_id'))
indexed = dict((term, connection.execute('SELECT COUNT(*) FROM photos_fts WHERE photos_fts MATCH ?', (term,)).fetchone()[0]) for term in ['tags:3071', 'tags:4083', 'tags:5005', 'date:1979'])
tables = [row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print(json.dumps({'counts': counts, 'indexed': indexed, 'tables': tables}))
`, join(output, 'seed.sql')], {cwd: root, encoding: 'utf8'}));
  assert.deepEqual(result.counts, {'popes-visit': 43, 'ireland-england': 36, 'french-grand-prix': 35});
  assert.deepEqual(result.indexed, {'tags:3071': 43, 'tags:4083': 36, 'tags:5005': 35, 'date:1979': 43});
  assert.ok(result.tables.every(table => table === 'photos' || table.startsWith('photos_fts')));
});
