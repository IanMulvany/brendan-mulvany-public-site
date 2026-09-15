import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';

const origin = process.argv[2] || 'http://localhost:8787';
const manifest = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url), 'utf8'));
const expected = new Map(manifest.photos.map(photo => [photo.id, photo]));
const fields = ['id', 'collection_id', 'title', 'year', 'image_base', 'width', 'height'].sort();
let requests = 0;
async function request(path, method = 'GET') {
  for (let attempt = 0; ; attempt++) {
    requests++;
    try {
      return await fetch(new URL(path, origin), {method, redirect: 'manual', signal: AbortSignal.timeout(20000)});
    } catch (error) {
      // Long public-URI audits may meet transient local DNS/network failures.
      // HTTP errors are not retried or masked; only transport failures are.
      if (attempt >= 2) throw error;
      await delay(500 * (attempt + 1));
    }
  }
}
async function get(path, method = 'GET') {
  const response = await request(path, method);
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

const staticPaths = new Set(['/', '/collections/', '/search/', '/about/', '/years/', '/batches/',
  ...manifest.collections.map(collection => `/roll/${collection.roll}/`),
  `/image/${manifest.photos[0].id}/`, `/image/${manifest.photos.at(-1).id}/`]);
for (let page = 2; page <= Math.ceil(manifest.collections.length / 24); page++) staticPaths.add(`/collections/page/${page}/`);
for (const year of await readdir(new URL('../dist/year/', import.meta.url))) staticPaths.add(`/year/${year}/`);
for (const path of staticPaths) {
  const response = await get(path);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(await response.text(), /Brendan Mulvany/);
}
// Check every original photo URI with four bounded concurrent HEAD requests.
// The build tests separately check that each path contains the correct photo.
for (let offset = 0; offset < manifest.photos.length; offset += 4) {
  const checked = await Promise.allSettled(manifest.photos.slice(offset, offset + 4).map(async photo => {
    const response = await get(`/image/${photo.id}/`, 'HEAD');
    assert.match(response.headers.get('content-type') || '', /text\/html/);
  }));
  for (const check of checked) if (check.status === 'rejected') throw check.reason;
}
let redirects = 0;
async function checkRedirect(path, target, permanentOnly = true) {
  const response = await request(path);
  await response.body?.cancel();
  assert.ok((permanentOnly ? [301, 308] : [301, 302, 307, 308]).includes(response.status), `${path}: redirect status ${response.status}`);
  assert.equal(new URL(response.headers.get('location'), origin).href, new URL(target, origin).href, `${path}: redirect destination`);
  redirects++;
}
for (const collection of manifest.collections) await checkRedirect(`/collections/${collection.id}/?from=saved`, `/roll/${collection.roll}/?from=saved`);
const firstId = manifest.photos[0].id;
for (const prefix of ['photos', 'image_detail']) for (const ending of ['', '/', '/index.html']) {
  await checkRedirect(`/${prefix}/${firstId}${ending}?from=saved`, `/image/${firstId}/?from=saved`);
}
for (const path of ['/rolls', '/rolls/', '/rolls/index.html']) await checkRedirect(path, '/collections/');
await checkRedirect('/search.html?q=Patrick%20Hillery', '/search/?q=Patrick%20Hillery');
// Cloudflare's built-in HTML normalization uses 307; our legacy aliases use301.
for (const path of [`/image/${firstId}`, `/image/${firstId}/index.html`]) await checkRedirect(path, `/image/${firstId}/`, false);
const result = {verifiedAt: new Date().toISOString(), origin, photos: seen.length,
  collections: manifest.collections.length, searchPages: pages, staticPages: staticPaths.size,
  originalPhotoUris: manifest.photos.length, redirects,
  requests, allPhotoIdsAndUrlsMatch: true, allCollectionFiltersMatch: true};
await writeFile(new URL('../data/deployment-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
