import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {buildRedirects} from '../scripts/redirects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const origin = 'https://archive.test';
const query = '?q=Sean+O%27Brien&source=old%2Fpreview&source=second';

function assetsRuntime(directory, assets) {
  // Use Cloudflare's actual assets router, _redirects parser and HTML handling.
  // Dynamic homepage/community behavior is tested separately in worker.test.mjs.
  return new Miniflare(convertV4MiniflareOptions({
    modules: true, compatibilityDate: '2026-09-13',
    script: 'export default { fetch(request, env) { return env.ASSETS.fetch(request); } };',
    assets: {directory, binding: 'ASSETS', run_worker_first: assets.run_worker_first,
      routerConfig: {has_user_worker: true},
      assetConfig: {html_handling: assets.html_handling, not_found_handling: assets.not_found_handling}},
  }));
}
const request = (mf, path) => mf.dispatchFetch(origin + path, {redirect: 'manual'});
async function redirect(mf, from, to, status = 301) {
  const response = await request(mf, from + query);
  assert.equal(response.status, status, from);
  const location = response.headers.get('location');
  assert.ok(location, `Missing Location for ${from}`);
  const destination = new URL(location, origin);
  assert.equal(destination.origin, origin, `Unexpected external redirect for ${from}`);
  assert.equal(destination.pathname, to, from);
  assert.equal(destination.search, query, `Query lost or changed for ${from}`);
  // A URL fragment is never in the HTTP request. Omitting a fragment here lets
  // the browser retain #community instead of replacing it during navigation.
  assert.ok(!location.includes('#'), `Redirect overrides the caller's fragment: ${from}`);
  await response.arrayBuffer();
  return destination;
}

test('built archive assets preserve canonical URIs and redirect old preview links without loops', async t => {
  // Run npm run build before this integration test; inspect the deployable output.
  const sample = JSON.parse(await readFile(join(root, 'data/sample.json'), 'utf8'));
  const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'));
  const redirects = await readFile(join(dist, '_redirects'), 'utf8');
  const mf = assetsRuntime(dist, config.assets);
  try {
    await t.test('canonical photo, roll, directory and home pages respond directly; HTML aliases normalize once', async () => {
      const selectedPhotos = [sample.photos[0], sample.photos[Math.floor(sample.photos.length / 2)], sample.photos.at(-1)];
      const selectedCollections = [sample.collections[0], sample.collections.find(collection => /[A-Za-z]/.test(collection.roll)) ?? sample.collections.at(-1)];
      const paths = ['/', '/collections/', '/collections/page/2/', ...selectedPhotos.map(photo => `/image/${photo.id}/`),
        ...selectedCollections.map(collection => `/roll/${encodeURIComponent(collection.roll)}/`)];
      for (const path of paths) {
        const response = await request(mf, path + query);
        assert.equal(response.status, 200, path);
        assert.equal(response.headers.get('location'), null, path);
        assert.match(response.headers.get('content-type'), /text\/html/);
        const html = await response.text();
        assert.match(html, /<main\b/);
        if (path.startsWith('/image/')) assert.match(html, /id="community"/);
        if (path === '/') continue;
        for (const alias of [path.slice(0, -1), `${path}index.html`]) {
          const normalized = await request(mf, alias + query);
          assert.ok([301, 307, 308].includes(normalized.status), `${alias}: ${normalized.status}`);
          const location = new URL(normalized.headers.get('location'), origin);
          assert.equal(location.pathname, path, alias);
          assert.equal(location.search, query, alias);
          await normalized.arrayBuffer();
        }
      }
    });

    await t.test('every generated preview redirect reaches a published canonical page and preserves duplicate query parameters', async () => {
      const targets = new Set();
      const rules = redirects.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
      const sources = new Set(rules.map(rule => rule.split(/\s+/)[0]));
      for (const source of ['/rolls', '/rolls/', '/rolls/index.html', '/search.html',
        ...['/photos/:id', '/image_detail/:id'].flatMap(path => [path, `${path}/`, `${path}/index.html`]),
        ...sample.collections.flatMap(collection => [`/collections/${collection.id}`, `/collections/${collection.id}/`, `/collections/${collection.id}/index.html`])]) {
        assert.ok(sources.has(source), `Missing shared URL alias: ${source}`);
      }
      for (const rule of rules) {
        const [source, target, status, unexpected] = rule.split(/\s+/);
        assert.equal(unexpected, undefined, `Unexpected redirect syntax: ${rule}`);
        const from = source.replaceAll(':id', String(sample.photos[0].id));
        const to = target.replaceAll(':id', String(sample.photos[0].id));
        await redirect(mf, from, to, Number(status));
        targets.add(to);
      }
      for (const target of targets) {
        const response = await request(mf, target + query);
        assert.equal(response.status, 200, `Redirect target must be direct and published: ${target}`);
        assert.equal(response.headers.get('location'), null, `Redirect loop at ${target}`);
        await response.arrayBuffer();
      }
    });

    await t.test('unpublished and out-of-range routes terminate at 404 instead of an album, SPA or redirect loop', async () => {
      const first = sample.collections[0];
      for (const path of ['/image/0/', '/image/unpublished/', '/roll/not-published/', '/collections/not-published/',
        `/roll/${first.roll}/page/999/`, `/collections/${first.id}/page/999/`]) {
        const response = await request(mf, path);
        assert.equal(response.status, 404, path);
        assert.equal(response.headers.get('location'), null, path);
        await response.arrayBuffer();
      }
      // The deliberately generic photo alias must still end at a 404 for a
      // nonexistent ID; redirecting a URL does not make that photograph public.
      await redirect(mf, '/photos/0/', '/image/0/');
      const removed = await request(mf, '/image/0/');
      assert.equal(removed.status, 404);
      await removed.arrayBuffer();
    });
  } finally { await mf.dispose(); }
});

test('all built photo and roll links, including homepage fragments and sign-in return paths, target published canonical pages', async () => {
  const sample = JSON.parse(await readFile(join(root, 'data/sample.json'), 'utf8'));
  const files = await readdir(dist, {recursive: true});
  const filesSet = new Set(files);
  const publishedPhotos = new Set(sample.photos.map(photo => `/image/${photo.id}/index.html`));
  const publishedRolls = new Set(sample.collections.map(collection => `/roll/${encodeURIComponent(collection.roll)}/index.html`));
  for (const path of [...publishedPhotos, ...publishedRolls]) assert.ok(filesSet.has(path.slice(1)), `Missing published page ${path}`);
  assert.equal(files.filter(path => /^image\/[^/]+\/index\.html$/.test(path)).length, publishedPhotos.size);
  assert.ok(!files.some(path => path.startsWith('photos/')), 'Old preview photo pages must not remain as duplicate assets');
  assert.ok(!files.some(path => /^collections\/[^/]+\/index\.html$/.test(path)), 'Album assets belong under /roll/');
  const linkedPhotos = new Set(), linkedRolls = new Set();
  let checked = 0;
  function checkLink(raw, file) {
    const url = new URL(raw.replaceAll('&amp;', '&'), origin);
    if (url.origin !== origin) return;
    const path = url.pathname;
    assert.ok(!path.startsWith('/photos/'), `Old preview photo link in ${file}: ${raw}`);
    assert.ok(!/^\/collections\/(?!page(?:\/|$))[^/]+/.test(path), `Old preview album link in ${file}: ${raw}`);
    if (path.startsWith('/image/') || path.startsWith('/roll/')) {
      assert.ok(path.endsWith('/'), `Noncanonical internal link in ${file}: ${raw}`);
      assert.ok(filesSet.has(`${path.slice(1)}index.html`), `Broken internal link in ${file}: ${raw}`);
      if (path.startsWith('/image/')) linkedPhotos.add(`${path}index.html`);
      if (/^\/roll\/[^/]+\/$/.test(path)) linkedRolls.add(`${path}index.html`);
      checked++;
    }
    if (url.searchParams.has('returnTo')) checkLink(url.searchParams.get('returnTo'), `${file} returnTo`);
  }
  function inspect(html, file) {
    for (const match of html.matchAll(/\bhref="([^"]+)"/g)) checkLink(match[1], file);
  }
  for (const file of files.filter(path => path.endsWith('.html'))) inspect(await readFile(join(dist, file), 'utf8'), file);
  const fragments = JSON.parse(await readFile(join(dist, 'homepage-fragments.json'), 'utf8'));
  for (const [id, fragment] of Object.entries(fragments)) {
    inspect(fragment.cardHtml, `homepage fragment ${id}`);
    inspect(fragment.leadHtml, `homepage lead ${id}`);
  }
  assert.deepEqual([...linkedPhotos].sort(), [...publishedPhotos].sort(), 'Every public photograph remains reachable');
  assert.deepEqual([...linkedRolls].sort(), [...publishedRolls].sort(), 'Every public roll remains reachable');
  assert.ok(checked >= sample.photos.length + sample.collections.length);
});

test('paginated preview aliases preserve the page number through the real assets redirect parser', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-route-pagination-'));
  const collections = [{id: 'old-album', roll: 'R-9002', count: 49}];
  const photos = Array.from({length: 49}, (_, index) => ({id: index + 1, collectionId: 'old-album'}));
  let mf;
  try {
    await mkdir(join(directory, 'roll/R-9002/page/2'), {recursive: true});
    await writeFile(join(directory, 'roll/R-9002/index.html'), '<main>First page</main>');
    await writeFile(join(directory, 'roll/R-9002/page/2/index.html'), '<main>Second page</main>');
    await writeFile(join(directory, '_redirects'), buildRedirects(collections, photos));
    mf = assetsRuntime(directory, {html_handling: 'auto-trailing-slash', not_found_handling: '404-page'});
    for (const suffix of ['', '/', '/index.html']) {
      await redirect(mf, `/collections/old-album/page/2${suffix}`, '/roll/R-9002/page/2/');
    }
    const response = await request(mf, '/roll/R-9002/page/2/');
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '<main>Second page</main>');
    const missing = await request(mf, '/collections/old-album/page/3/');
    assert.equal(missing.status, 404);
    await missing.arrayBuffer();
  } finally {
    if (mf) await mf.dispose();
    await rm(directory, {recursive: true, force: true});
  }
});

test('redirect generation rejects ambiguous routes, missing collections and configurations beyond Cloudflare limits', () => {
  const collection = {id: 'an-album', roll: '3071'};
  const photos = [{id: 1, collectionId: 'an-album'}];
  for (const invalid of [{...collection, id: 'page'}, {...collection, id: '../private'}, {...collection, roll: '3071\n/evil /target 301'},
    {...collection, roll: 'a/b'}]) {
    assert.throws(() => buildRedirects([invalid], photos), /collection route/);
  }
  assert.throws(() => buildRedirects([collection, collection], photos), /duplicate/);
  assert.throws(() => buildRedirects([collection, {...collection, id: 'other'}], photos), /duplicate/);
  assert.throws(() => buildRedirects([collection], []), /no photographs/);
  assert.throws(() => buildRedirects([], photos), /no collection route/);
  assert.throws(() => buildRedirects([collection], photos, 0), /page size/);
  // 666 gallery pages need 1,998 aliases plus the four original-site aliases.
  assert.throws(() => buildRedirects([collection], Array.from({length: 666}, (_, id) => ({id, collectionId: collection.id})), 1), /redirect limit/);
});
