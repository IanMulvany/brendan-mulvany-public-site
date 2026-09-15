import assert from 'node:assert/strict';
import {readFile, writeFile, readdir} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {checkPublicRobots} from './robots.mjs';

const origin = process.argv[2] || 'http://localhost:8787';
const canonicalOrigin = 'https://brendan-mulvany-photography.com';
const utilityPaths = new Set(['/search/', '/account/', '/newsletter/', '/admin/', '/404.html']);
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
  const pathname = new URL(path, origin).pathname;
  if (pathname.startsWith('/api/') || utilityPaths.has(pathname)) assert.match(response.headers.get('x-robots-tag') || '', /\bnoindex\b/i, `${path}: missing noindex`);
  else assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /\b(?:noindex|none)\b/i, `${path}: public indexing blocked`);
  return response;
}
const decodeEntities = text => text.replace(/&(amp|quot|apos|lt|gt);/g, (_, entity) => ({amp: '&', quot: '"', apos: "'", lt: '<', gt: '>'})[entity]);
function attribute(tag, name) {
  return decodeEntities(tag.match(new RegExp(`\\b${name}=["']([^"']*)["']`, 'i'))?.[1] ?? '');
}
function checkHtml(html, path) {
  assert.match(html, /Brendan Mulvany/, path);
  assert.doesNotMatch(html, /class="preview-(?:strip|badge)"|Archive preview|new\.brendan-mulvany-photography\.com/, `${path}: preview content remains`);
  const directives = [...html.matchAll(/<meta\b[^>]*>/gi)].filter(([tag]) => attribute(tag, 'name').toLowerCase() === 'robots')
    .map(([tag]) => attribute(tag, 'content')).join(',');
  if (utilityPaths.has(path)) assert.match(directives, /\bnoindex\b/i, `${path}: utility indexing enabled`);
  else {
    assert.doesNotMatch(directives, /\b(?:noindex|none)\b/i, `${path}: public indexing blocked`);
    const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].filter(([tag]) => attribute(tag, 'rel').split(/\s+/).includes('canonical'))
      .map(([tag]) => attribute(tag, 'href'));
    assert.deepEqual(canonical, [canonicalOrigin + path], `${path}: canonical URL`);
  }
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

const staticPaths = new Set(['/', '/collections/', '/search/', '/about/', '/years/', '/batches/', '/account/', '/newsletter/', '/admin/',
  ...manifest.collections.map(collection => `/roll/${collection.roll}/`),
  `/image/${manifest.photos[0].id}/`, `/image/${manifest.photos.at(-1).id}/`]);
for (let page = 2; page <= Math.ceil(manifest.collections.length / 24); page++) staticPaths.add(`/collections/page/${page}/`);
for (const year of await readdir(new URL('../dist/year/', import.meta.url))) staticPaths.add(`/year/${year}/`);
for (const path of staticPaths) {
  const response = await get(path);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  checkHtml(await response.text(), path);
}

// Compare the deployed sitemap with all indexable build outputs, not a sample.
const htmlFiles = (await readdir(new URL('../dist/', import.meta.url), {recursive: true})).filter(file => file.endsWith('.html'));
const indexablePaths = htmlFiles.map(file => file === 'index.html' ? '/' : '/' + file.replace(/index\.html$/, '')).filter(path => !utilityPaths.has(path));
const sitemap = await (await get('/sitemap.xml')).text();
assert.match(sitemap, /<urlset\b[^>]*xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9"/);
const sitemapUrls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => decodeEntities(match[1]));
assert.deepEqual(sitemapUrls.sort(), indexablePaths.map(path => canonicalOrigin + path).sort(), 'Deployed sitemap differs from the complete public build');
const robots = await (await get('/robots.txt')).text();
checkPublicRobots(robots, canonicalOrigin);
console.log(`Verified production canonicals and all ${sitemapUrls.length} sitemap URLs`);
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

// Only probe live host aliases when explicitly verifying the production apex.
// GET/HEAD are read-only; unsafe-method rejection is covered by local tests.
let hostnameRedirects = 0;
if (new URL(origin).origin === canonicalOrigin) {
  for (const host of ['www.brendan-mulvany-photography.com', 'new.brendan-mulvany-photography.com']) {
    for (const method of ['GET', 'HEAD']) {
      for (const path of ['/', `/image/${firstId}/?from=alias&q=Sean+O%27Brien&from=second`, `/photos/${firstId}/?returnTo=%2Faccount%2F`]) {
        const response = await request(`https://${host}${path}`, method);
        assert.equal(response.status, 301, `${host}${path}: hostname redirect status`);
        assert.equal(response.headers.get('location'), canonicalOrigin + path, `${host}${path}: hostname redirect destination`);
        assert.equal(response.headers.get('set-cookie'), null, 'Redirect hosts must not create account cookies');
        assert.ok(!response.headers.get('location').includes('#'), 'Hostname redirects must allow browser fragment inheritance');
        await response.body?.cancel();
        hostnameRedirects++;
      }
    }
  }
}
const result = {verifiedAt: new Date().toISOString(), origin, photos: seen.length,
  collections: manifest.collections.length, searchPages: pages, staticPages: staticPaths.size,
  originalPhotoUris: manifest.photos.length, redirects,
  canonicalOrigin, sitemapUrls: sitemapUrls.length, utilityPages: staticPaths.size - [...staticPaths].filter(path => !utilityPaths.has(path)).length,
  hostnameRedirects, allIndexablePagesInSitemap: true,
  requests, allPhotoIdsAndUrlsMatch: true, allCollectionFiltersMatch: true};
await writeFile(new URL('../data/deployment-verification.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
