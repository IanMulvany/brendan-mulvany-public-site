import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, test} from 'node:test';
import {InvalidSearch, PAGE_SIZE, parseSearch, searchStatement} from '../src/search.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'bm-search-test-'));
after(() => rmSync(output, {recursive: true, force: true}));
execFileSync('python3', ['scripts/export-sample.py', '--output-dir', output], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']});
const sample = JSON.parse(readFileSync(join(output, 'sample.json'), 'utf8'));

function input(params = {}) {
  return parseSearch(new URL(`https://archive.test/api/search?${new URLSearchParams(params)}`));
}

// Execute the actual TypeScript-generated query and bound parameters against
// the real migration and freshly exported archive data. Search work is read-only.
function runSearch(params = {}) {
  const statement = searchStatement(input(params));
  return JSON.parse(execFileSync('python3', ['-c', String.raw`
import json, pathlib, sqlite3, sys
request = json.load(sys.stdin)
connection = sqlite3.connect(':memory:')
connection.row_factory = sqlite3.Row
connection.executescript(pathlib.Path('migrations/0001_search.sql').read_text())
connection.executescript(pathlib.Path(request['seed']).read_text())
connection.execute('PRAGMA query_only=ON')
rows = connection.execute(request['sql'], request['args']).fetchall()
print(json.dumps([dict(row) for row in rows]))
`, ], {cwd: root, input: JSON.stringify({...statement, seed: join(output, 'seed.sql')}), encoding: 'utf8'}));
}

function allPages(params = {}) {
  const result = [];
  for (let page = 1; page <= 6; page++) {
    const rows = runSearch({...params, page: String(page)});
    result.push(...rows.slice(0, PAGE_SIZE));
    if (rows.length <= PAGE_SIZE) return result;
  }
  assert.fail('Sample unexpectedly exceeds the bounded pagination test');
}

test('browsing visits all 114 public photos once across stable pages', () => {
  const results = allPages();
  assert.equal(results.length, 114);
  assert.equal(new Set(results.map(row => row.id)).size, results.length);
  assert.deepEqual(results.map(row => row.id).sort((a, b) => a - b), sample.photos.map(row => row.id).sort((a, b) => a - b));
  assert.deepEqual(runSearch({page: '100'}), []);
});

test('search cards receive their render fields while full descriptions remain searchable', () => {
  const fields = ['id', 'collection_id', 'title', 'year', 'image_base', 'width', 'height'].sort();
  const results = allPages();
  // "clover" occurs in archive descriptions, outside the card metadata. Reducing
  // the response must not narrow the indexed text that can retrieve a photo.
  const descriptionMatches = runSearch({q: 'clover'});
  assert.ok(descriptionMatches.length > 0);
  for (const photo of [...results, ...descriptionMatches]) {
    assert.deepEqual(Object.keys(photo).sort(), fields);
    assert.ok(Number.isSafeInteger(photo.id));
    assert.ok(photo.title.trim(), 'card title must not need a description fallback');
    assert.match(photo.year, /^\d{4}$/);
    assert.match(photo.image_base, /^https:\/\/cdn\.brendan-mulvany-photography\.com\/[A-Za-z0-9_-]+$/);
    assert.ok(photo.width === null || photo.width > 0);
    assert.ok(photo.height === null || photo.height > 0);
  }
  assert.ok(descriptionMatches.every(photo => !photo.title.toLowerCase().includes('clover')));
});

test('collection browsing and full-text search never cross collection boundaries', () => {
  for (const collection of sample.collections) {
    const results = allPages({collection: collection.id});
    assert.equal(results.length, collection.count);
    assert.ok(results.every(row => row.collection_id === collection.id));
    const searched = allPages({q: collection.roll, collection: collection.id});
    assert.deepEqual(searched.map(row => row.id).sort(), results.map(row => row.id).sort());
  }
  assert.deepEqual(runSearch({collection: 'does-not-exist'}), []);
  assert.deepEqual(runSearch({q: '3071', collection: 'french-grand-prix'}), []);
});

test('year, roll and multiple prefix words search the seeded archive', () => {
  const yearResults = allPages({q: '1979', collection: 'popes-visit'});
  assert.equal(yearResults.length, 43);
  assert.equal(allPages({q: '3071'}).length, 43);
  assert.equal(allPages({q: '4083'}).length, 36);
  assert.equal(allPages({q: '5005'}).length, 35);
  assert.equal(allPages({q: 'wem eng', collection: 'ireland-england'}).length, 36);
  assert.equal(allPages({q: 'fren gran', collection: 'french-grand-prix'}).length, 35);
});

test('quoting and punctuation cannot become FTS operators or break SQL', () => {
  for (const q of ['"pope', '"pope"*', 'pope:', '(pope)', 'pope\\', 'pope\u0000', "pope'", '[pope]']) {
    assert.equal(allPages({q}).length, 43, q);
  }
  for (const q of ['NEAR(pope, 1)', "' OR 1=1 --", 'title:pope', 'pope OR wembley']) {
    assert.doesNotThrow(() => runSearch({q}), q);
  }
  assert.equal(allPages({q: 'pope'}).length, 43, 'malformed queries must leave the seed searchable');
});

test('Unicode canonical equivalents and case yield the same search results', () => {
  assert.deepEqual(runSearch({q: 'FRENCH'}), runSearch({q: '  french  '}));
  assert.deepEqual(runSearch({q: 'église'}), runSearch({q: 'e\u0301glise'}));
  assert.doesNotThrow(() => runSearch({q: '北京'}));
  assert.doesNotThrow(() => runSearch({q: 'αθλητισμός'}));
});

test('invalid input is rejected before reaching the database', () => {
  for (const page of ['0', '-1', '01', '1.2', '1e2', '101', '1000', 'Infinity', ' 1']) {
    assert.throws(() => input({page}), InvalidSearch, page);
  }
  for (const q of ['*', '"', '😀', 'a'.repeat(121), 'one two three four five six seven eight nine']) {
    assert.throws(() => input({q}), InvalidSearch, q);
  }
  for (const collection of ["' OR 1=1 --", '../photos', 'x'.repeat(81)]) {
    assert.throws(() => input({collection}), InvalidSearch, collection);
  }
});
