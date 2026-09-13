import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {after, test} from 'node:test';
import {InvalidSearch, MAX_PAGE, PAGE_SIZE, parseSearch, searchStatement} from '../src/search.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = mkdtempSync(join(tmpdir(), 'bm-search-test-'));
after(() => rmSync(output, {recursive: true, force: true}));
execFileSync('python3', ['scripts/export-sample.py', '--output-dir', output], {cwd: root, stdio: ['ignore', 'ignore', 'pipe']});
const sample = JSON.parse(readFileSync(join(output, 'sample.json'), 'utf8'));

function input(params = {}) {
  return parseSearch(new URL(`https://archive.test/api/search?${new URLSearchParams(params)}`));
}

const byRoll = roll => sample.collections.find(collection => collection.roll === roll);
const popeCollection = byRoll('3071');
const footballCollection = byRoll('4083');
const racingCollection = byRoll('5005');
const quoteVariants = ['"pope', '"pope"*', 'pope:', '(pope)', 'pope\\', 'pope\u0000', "pope'", '[pope]'];
const operatorVariants = ['NEAR(pope, 1)', "' OR 1=1 --", 'title:pope', 'pope OR wembley'];
const key = params => JSON.stringify(input(params));
const cases = new Map();

function addCase(params = {}, paginated = true) {
  const caseKey = key(params);
  if (cases.has(caseKey)) return;
  // Each statement comes from production TypeScript, including its bound offset.
  // Execute them together below; do not reseed or spawn once per page.
  const pages = paginated ? Math.min(MAX_PAGE, Math.ceil(sample.photos.length / PAGE_SIZE) + 1) : 1;
  const statements = Array.from({length: pages}, (_, page) => searchStatement(input({
    ...params, ...(paginated ? {page: String(page + 1)} : {}),
  })));
  cases.set(caseKey, {key: caseKey, paginated, statements});
}

addCase();
addCase({page: String(MAX_PAGE)}, false);
const afterLastPage = Math.ceil(sample.photos.length / PAGE_SIZE) + 1;
if (afterLastPage <= MAX_PAGE) addCase({page: String(afterLastPage)}, false);
for (const collection of sample.collections) {
  addCase({collection: collection.id});
  addCase({q: collection.roll, collection: collection.id});
}
addCase({collection: 'does-not-exist'});
addCase({q: '3071', collection: racingCollection.id});
addCase({q: '1979', collection: popeCollection.id});
addCase({q: 'wem eng', collection: footballCollection.id});
addCase({q: 'fren gran', collection: racingCollection.id});
for (const q of ['pope', 'clover', 'wem', 'eng', 'wem eng', ...quoteVariants, ...operatorVariants,
  'FRENCH', '  french  ', 'église', 'e\u0301glise', '北京', 'αθλητισμός']) addCase({q});

// One isolated SQLite database and one Python process execute every full-archive
// case, keeping the suite practical as collections and page counts increase.
const resultSets = new Map(JSON.parse(execFileSync('python3', ['-c', String.raw`
import json, pathlib, sqlite3, sys
request = json.load(sys.stdin)
connection = sqlite3.connect(':memory:')
connection.row_factory = sqlite3.Row
connection.executescript(pathlib.Path('migrations/0001_search.sql').read_text())
connection.executescript(pathlib.Path(request['seed']).read_text())
connection.execute('PRAGMA query_only=ON')
results = []
for case in request['cases']:
    pages = []
    complete = False
    for statement in case['statements']:
        rows = [dict(row) for row in connection.execute(statement['sql'], statement['args'])]
        pages.append(rows)
        if not case['paginated'] or len(rows) <= request['pageSize']:
            complete = True
            break
    results.append([case['key'], {'pages': pages, 'complete': complete}])
print(json.dumps(results))
`], {
  cwd: root,
  input: JSON.stringify({seed: join(output, 'seed.sql'), pageSize: PAGE_SIZE, cases: [...cases.values()]}),
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
})));

function pagesFor(params = {}) {
  const result = resultSets.get(key(params));
  assert.ok(result, `Missing batched search case: ${key(params)}`);
  assert.ok(result.complete, `Search exceeds the bounded pagination capacity: ${key(params)}`);
  return result.pages;
}

function allPages(params = {}) {
  return pagesFor(params).flatMap(rows => rows.slice(0, PAGE_SIZE));
}

const ids = rows => rows.map(row => row.id);
const sortedIds = rows => ids(rows).sort((a, b) => a - b);

test('every published photo fits the pagination bound and is visited exactly once', () => {
  const publicRolls = join(root, '../public/roll');
  const rollDirectories = readdirSync(publicRolls, {withFileTypes: true}).filter(entry => entry.isDirectory());
  const publishedPhotos = rollDirectories.flatMap(roll => {
    const html = readFileSync(join(publicRolls, roll.name, 'index.html'), 'utf8');
    const match = html.match(/window\.__PAGE_DATA__\s*=\s*(\{.*?\});\s*<\/script>/s);
    assert.ok(match, `Public roll ${roll.name} has no publication data`);
    return JSON.parse(match[1]).images.map(photo => ({id: Number(photo.image_id)}));
  });
  assert.equal(sample.collections.length, rollDirectories.length, 'the export includes every public roll');
  assert.deepEqual(sortedIds(sample.photos), sortedIds(publishedPhotos), 'the search seed includes every publicly listed photo');
  assert.ok(sample.photos.length > 0);
  assert.ok(sample.photos.length <= MAX_PAGE * PAGE_SIZE,
    `The archive has ${sample.photos.length} photos; increase pagination capacity before publishing.`);
  const pages = pagesFor();
  const results = allPages();
  assert.equal(pages.length, Math.ceil(sample.photos.length / PAGE_SIZE));
  assert.equal(results.length, sample.photos.length);
  assert.equal(new Set(ids(results)).size, results.length);
  assert.deepEqual(ids(results), sortedIds(sample.photos), 'browse order is stable across all page boundaries');
  for (let page = 0; page < pages.length - 1; page++) {
    assert.equal(pages[page].length, PAGE_SIZE + 1, 'non-final page has a hasMore sentinel');
    assert.equal(pages[page][PAGE_SIZE].id, pages[page + 1][0].id, 'sentinel becomes the next page first card');
  }
  assert.ok(pages.at(-1).length <= PAGE_SIZE);
  if (afterLastPage <= MAX_PAGE) assert.deepEqual(allPages({page: String(afterLastPage)}), []);
  if (sample.photos.length <= (MAX_PAGE - 1) * PAGE_SIZE) {
    assert.deepEqual(allPages({page: String(MAX_PAGE)}), []);
  }
});

test('search returns only card fields while full descriptions remain searchable', () => {
  const fields = ['id', 'collection_id', 'title', 'year', 'image_base', 'width', 'height'].sort();
  const descriptionMatches = allPages({q: 'clover'});
  assert.ok(descriptionMatches.length > 0);
  for (const photo of allPages()) {
    assert.deepEqual(Object.keys(photo).sort(), fields);
    assert.ok(Number.isSafeInteger(photo.id));
    assert.ok(photo.title.trim(), 'card title must not need a description fallback');
    assert.match(photo.year, /^(?:\d{4})?$/);
    assert.match(photo.image_base, /^https:\/\/cdn\.brendan-mulvany-photography\.com\/[A-Za-z0-9_-]+$/);
    assert.ok(photo.width === null || photo.width > 0);
    assert.ok(photo.height === null || photo.height > 0);
  }
  const fullMetadata = new Map(sample.photos.map(photo => [photo.id, photo]));
  assert.ok(descriptionMatches.some(photo => {
    const source = fullMetadata.get(photo.id);
    return source.description.toLowerCase().includes('clover') && !photo.title.toLowerCase().includes('clover');
  }), 'a description word absent from the card title must still retrieve the photograph');
});

test('all collections have complete, isolated browse and roll-search coverage', () => {
  for (const collection of sample.collections) {
    const expected = sample.photos.filter(photo => photo.collectionId === collection.id);
    const results = allPages({collection: collection.id});
    assert.equal(results.length, collection.count, collection.id);
    assert.ok(results.every(row => row.collection_id === collection.id), collection.id);
    assert.deepEqual(sortedIds(results), sortedIds(expected), collection.id);
    const searched = allPages({q: collection.roll, collection: collection.id});
    assert.deepEqual(sortedIds(searched), sortedIds(expected), `roll text must retrieve its collection: ${collection.id}`);
  }
  assert.deepEqual(allPages({collection: 'does-not-exist'}), []);
  assert.deepEqual(allPages({q: '3071', collection: racingCollection.id}), []);
});

test('year and multiple prefix words retain the original collection search behavior', () => {
  assert.equal(allPages({q: '1979', collection: popeCollection.id}).length, popeCollection.count);
  assert.equal(allPages({q: 'wem eng', collection: footballCollection.id}).length, footballCollection.count);
  assert.equal(allPages({q: 'fren gran', collection: racingCollection.id}).length, racingCollection.count);
  const english = new Set(ids(allPages({q: 'eng'})));
  const intersection = allPages({q: 'wem'}).filter(photo => english.has(photo.id));
  assert.deepEqual(sortedIds(allPages({q: 'wem eng'})), sortedIds(intersection), 'prefix words combine with AND');
});

test('quoting and punctuation cannot become FTS operators or break SQL', () => {
  const expected = ids(allPages({q: 'pope'}));
  for (const q of quoteVariants) assert.deepEqual(ids(allPages({q})), expected, q);
  for (const q of operatorVariants) assert.doesNotThrow(() => allPages({q}), q);
  assert.ok(expected.length >= popeCollection.count, 'malformed queries leave the complete archive searchable');
});

test('Unicode canonical equivalents and case yield the same search results', () => {
  assert.deepEqual(allPages({q: 'FRENCH'}), allPages({q: '  french  '}));
  assert.deepEqual(allPages({q: 'église'}), allPages({q: 'e\u0301glise'}));
  assert.doesNotThrow(() => allPages({q: '北京'}));
  assert.doesNotThrow(() => allPages({q: 'αθλητισμός'}));
});

test('invalid input and pages beyond archive capacity are rejected before SQL', () => {
  assert.equal(input({page: String(MAX_PAGE)}).page, MAX_PAGE);
  for (const page of ['0', '-1', '01', '1.2', '1e2', String(MAX_PAGE + 1), '1000', 'Infinity', ' 1']) {
    assert.throws(() => input({page}), InvalidSearch, page);
  }
  for (const q of ['*', '"', '😀', 'a'.repeat(121), 'one two three four five six seven eight nine']) {
    assert.throws(() => input({q}), InvalidSearch, q);
  }
  for (const collection of ["' OR 1=1 --", '../photos', 'x'.repeat(81)]) {
    assert.throws(() => input({collection}), InvalidSearch, collection);
  }
});
