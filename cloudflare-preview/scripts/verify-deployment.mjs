import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';

const origin = process.argv[2] || 'http://localhost:8787';
const manifest = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url), 'utf8'));
const expected = new Map(manifest.photos.map(photo => [photo.id, photo]));
const fields = ['id', 'collection_id', 'title', 'year', 'image_base', 'width', 'height'].sort();
let requests = 0;
async function get(path) {
  requests++;
  const response = await fetch(new URL(path, origin), {signal: AbortSignal.timeout(20000)});
  assert.equal(response.status, 200, `${path}: unexpected status`);
  assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
  return response;
}
function checkPhoto(photo) {
  assert.deepEqual(Object.keys(photo).sort(), fields);
  const source = expected.get(photo.id);
  assert.ok(source, `Unexpected public photo ${photo.id}`);
  assert.equal(photo.collection_id, source.collectionId);
  assert.equal(photo.image_base, source.imageBase);
  assert.equal(photo.title, source.title);
}

const seen = [];
let pages = 0;
for (let page = 1; page <= 100; page++) {
  const data = await (await get(`/api/search?page=${page}`)).json();
  assert.equal(data.page, page);
  assert.equal(data.pageSize, 24);
  assert.ok(data.results.length <= 24);
  for (const photo of data.results) { checkPhoto(photo); seen.push(photo.id); }
  pages++;
  if (!data.hasMore) break;
  assert.equal(data.results.length, 24);
  assert.ok(page < 100, 'Archive exceeds the bounded search page capacity');
}
assert.deepEqual(seen, [...expected.keys()].sort((a, b) => a - b), 'All archive IDs must appear exactly once');
console.log(`Verified ${seen.length} photographs across ${pages} API pages`);

// Keep public endpoint load low: one collection filter request at a time.
for (const collection of manifest.collections) {
  const data = await (await get(`/api/search?collection=${encodeURIComponent(collection.id)}`)).json();
  const photos = manifest.photos.filter(photo => photo.collectionId === collection.id).sort((a, b) => a.id - b.id);
  assert.deepEqual(data.results.map(photo => photo.id), photos.slice(0, 24).map(photo => photo.id));
  assert.equal(data.hasMore, photos.length > 24);
  data.results.forEach(checkPhoto);
}
console.log(`Verified all ${manifest.collections.length} collection filters`);

const staticPaths = new Set(['/', '/collections/', '/search/',
  ...manifest.collections.map(collection => `/collections/${collection.id}/`),
  `/photos/${manifest.photos[0].id}/`, `/photos/${manifest.photos.at(-1).id}/`]);
for (let page = 2; page <= Math.ceil(manifest.collections.length / 24); page++) staticPaths.add(`/collections/page/${page}/`);
for (const path of staticPaths) {
  const response = await get(path);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(await response.text(), /Brendan Mulvany/);
}
const result = {verifiedAt: new Date().toISOString(), origin, photos: seen.length,
  collections: manifest.collections.length, searchPages: pages, staticPages: staticPaths.size,
  requests, allPhotoIdsAndUrlsMatch: true, allCollectionFiltersMatch: true};
await writeFile(new URL('../data/deployment-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
