import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {buildSearchCatalogSql} from '../scripts/search-catalog.mjs';
import {SEARCH_CACHE_SECONDS} from '../src/search.ts';

// Exercise the actual Worker and D1 runtime. The isolated mail Worker is a test
// double only: it captures mail in ephemeral KV, with no production bypass.
test('Worker: verified sessions, community isolation, moderation, newsletter and cached homepage choices', async () => {
  const bundle = await build({entryPoints: ['src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:*']});
  const origin = 'https://archive.test';
  const picture = (id, base) => `<picture data-collection-id="${id}"><source srcset="https://cdn.brendan-mulvany-photography.com/${base}/thumb.webp 200w, https://cdn.brendan-mulvany-photography.com/${base}/small.webp 800w"><img src="https://cdn.brendan-mulvany-photography.com/${base}/small.webp" width="1500" height="1000" alt="Old"></picture>`;
  const fragments = (id, photo, base) => ({
    leadHtml: `<a href="/photos/${photo}/" data-collection-id="${id}" data-collection-hero-link>${picture(id, base)}</a>`,
    cardHtml: `<a href="/collections/${id}/">${picture(id, base)}Collection</a>`,
  });
  const first = fragments('roll-a', 1, 'old');
  const fixture = `<html><body><div id="homepage-lead">${first.leadHtml}</div><div id="homepage-collections">${first.cardHtml}</div></body></html>`;
  const manifest = {'popes-visit': first, 'roll-a': first, 'roll-b': fragments('roll-b', 3, 'other')};
  const mf = new Miniflare(convertV4MiniflareOptions({workers: [{name: 'site', script: bundle.outputFiles[0].text, modules: true,
    compatibilityDate: '2026-09-13', compatibilityFlags: ['nodejs_compat'],
    bindings: {PUBLIC_ORIGIN: origin, ADMIN_EMAIL: 'admin@example.test', EMAIL_FROM: 'no-reply@example.test', AUTH_SECRET: crypto.randomUUID() + crypto.randomUUID(), CACHE_VERSION: 'test'},
    d1Databases: {DB: 'archive', COMMUNITY: 'community'},
    serviceBindings: {EMAIL: {name: 'mail', entrypoint: 'EmailMock'},
      ASSETS: async request => new URL(request.url).pathname === '/homepage-fragments.json'
        ? Response.json(manifest)
        : new Response(fixture, {headers: {'content-type': 'text/html', etag: 'old-static-tag'}})},
  }, {name: 'mail', modules: true, compatibilityDate: '2026-09-13', kvNamespaces: ['MAILBOX'],
    script: `import {WorkerEntrypoint} from 'cloudflare:workers';
      export class EmailMock extends WorkerEntrypoint {
        async send(message) { await this.env.MAILBOX.put(typeof message.to === 'string' ? message.to : message.to[0], JSON.stringify(message)); return {messageId: crypto.randomUUID()}; }
      }
      export default {fetch() {return new Response('Test mail double');}};`,
  }]}));
  try {
    const db = await mf.getD1Database('DB', 'site');
    const community = await mf.getD1Database('COMMUNITY', 'site');
    for (const filename of ['community-migrations/0001_accounts.sql', 'community-migrations/0002_community.sql', 'community-migrations/0003_homepage.sql', 'community-migrations/0004_search.sql']) {
      const sql = await readFile(filename, 'utf8');
      // D1 exec accepts one SQL statement per line.
      await community.exec(sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' '));
    }
    await db.exec((await readFile('migrations/0001_search.sql', 'utf8')).replace(/\s+/g, ' '));
    const catalogPhotos = [];
    for (const [id, collection, title, base] of [[1, 'roll-a', 'First', 'old'], [2, 'roll-a', 'Chosen <hero>', 'chosen'], [3, 'roll-b', 'Other', 'other']]) {
      await db.prepare(`INSERT INTO photos VALUES(?,?,?,'','1979','1979','','',?,1500,1000)`).bind(id, collection, title, `https://cdn.brendan-mulvany-photography.com/${base}`).run();
      catalogPhotos.push({id, collectionId: collection, title, description: '', date: '1979', year: '1979', location: '', tags: [], imageBase: `https://cdn.brendan-mulvany-photography.com/${base}`, width: 1500, height: 1000});
    }
    await community.exec(buildSearchCatalogSql({photos: catalogPhotos}).replace(/^--[^\n]*\n/gm, '').trim());
    await db.exec("INSERT INTO photos_fts(photos_fts) VALUES('rebuild');");
    const mailbox = await mf.getKVNamespace('MAILBOX', 'mail');
    async function call(path, {method = 'GET', body, cookie, requestOrigin = origin} = {}) {
      return mf.dispatchFetch(origin + path, {method, headers: {
        ...(method !== 'GET' ? {origin: requestOrigin, 'content-type': 'application/json'} : {}),
        ...(cookie ? {cookie} : {}), 'cf-connecting-ip': '192.0.2.10',
      }, ...(body !== undefined ? {body: JSON.stringify(body)} : {})});
    }
    async function signin(email, displayName) {
      const started = await call('/api/auth/request', {method: 'POST', body: {email, displayName}});
      assert.equal(started.status, 200, await started.clone().text());
      const challenge = await started.json();
      assert.ok(challenge.challengeId);
      assert.equal(challenge.code, undefined);
      const mail = JSON.parse(await mailbox.get(email));
      const code = mail.text.match(/\b\d{8}\b/)[0];
      const response = await call('/api/auth/verify', {method: 'POST', body: {challengeId: challenge.challengeId, code}});
      assert.equal(response.status, 200, await response.clone().text());
      const cookie = response.headers.get('set-cookie');
      assert.match(cookie, /__Host-/);
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert.ok(cookie.includes(flag));
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.equal((await call('/api/auth/verify', {method: 'POST', body: {challengeId: challenge.challengeId, code}})).status, 400, 'codes cannot be replayed');
      return {cookie: cookie.split(';')[0], ...(await response.json())};
    }
    assert.equal((await call('/api/admin/users')).status, 401);
    assert.equal((await call('/api/photos/1/comments', {method: 'POST', body: {body: 'No login'}})).status, 401);
    assert.equal((await call('/api/auth/request', {method: 'POST', requestOrigin: 'https://evil.test', body: {email: 'attack@example.test'}})).status, 403);
    const member = await signin('member@example.test', 'Community member');
    const admin = await signin('admin@example.test', 'Archive admin');
    assert.equal(member.user.role, 'member');
    assert.equal(admin.user.role, 'admin');
    assert.equal((await call('/api/admin/users', {cookie: member.cookie})).status, 403);
    assert.match((await call('/api/auth/me', {cookie: member.cookie})).headers.get('cache-control'), /no-store/);
    assert.equal((await call('/api/photos/1/comments', {method: 'POST', cookie: member.cookie, requestOrigin: 'https://evil.test', body: {body: 'CSRF'}})).status, 403);
    const commentResponse = await call('/api/photos/1/comments', {method: 'POST', cookie: member.cookie, body: {body: '<script>alert("stored text")</script>'}});
    assert.equal(commentResponse.status, 201);
    const comment = await commentResponse.json();
    for (let i = 0; i < 2; i++) assert.equal((await call('/api/photos/1/like', {method: 'PUT', cookie: member.cookie})).status, 200);
    assert.deepEqual((await call('/api/search?q=remembered').then(r => r.json())).results, []);
    const annotated = await call('/api/photos/1/annotations', {method: 'POST', cookie: member.cookie, body: {name: 'A remembered name', note: 'Community identification', x: .1, y: .2, width: .3, height: .4}});
    assert.equal(annotated.status, 201);
    const annotation = await annotated.json();
    assert.equal(SEARCH_CACHE_SECONDS, 30);
    await mf.purgeCache(); // Simulate the documented 30-second search expiry.
    for (const q of ['remembered', 'identification', 'remember first 1979 identif']) {
      const result = await call(`/api/search?q=${encodeURIComponent(q)}`);
      assert.equal(result.status, 200, await result.clone().text());
      assert.equal(result.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
      const data = await result.json();
      assert.deepEqual(data.results.map(photo => photo.id), [1], 'names and notes combine with archive fields');
      assert.deepEqual(Object.keys(data.results[0]).sort(), ['id', 'collection_id', 'title', 'year', 'image_base', 'width', 'height'].sort());
      assert.ok(!JSON.stringify(data).includes('@example.test'));
    }
    const cachedSearch = await call('/api/search?q=remembered', {cookie: admin.cookie});
    assert.equal(cachedSearch.headers.get('x-search-cache'), 'HIT');
    assert.equal(cachedSearch.headers.get('set-cookie'), null);
    assert.deepEqual((await cachedSearch.json()).results.map(photo => photo.id), [1]);
    assert.deepEqual((await call('/api/search?q=remembered&collection=roll-b').then(r => r.json())).results, []);
    await community.exec(buildSearchCatalogSql({photos: catalogPhotos}).replace(/^--[^\n]*\n/gm, '').trim());
    await mf.purgeCache();
    assert.deepEqual((await call('/api/search?q=remembered').then(r => r.json())).results.map(photo => photo.id), [1], 'catalog sync retains live annotations');
    await community.exec("CREATE TRIGGER reject_annotation_audit BEFORE INSERT ON activity WHEN NEW.action = 'annotation.created' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;");
    const rejectedAnnotation = await call('/api/photos/1/annotations', {method: 'POST', cookie: member.cookie, body: {name: 'Rollbackonly', note: '', x: .1, y: .2, width: .3, height: .4}});
    assert.equal(rejectedAnnotation.status, 503);
    await community.exec('DROP TRIGGER reject_annotation_audit;');
    assert.deepEqual((await call('/api/search?q=rollbackonly').then(r => r.json())).results, [], 'failed annotation transactions leave no searchable terms');
    assert.equal((await call('/api/photos/1/annotations', {method: 'POST', cookie: member.cookie, body: {name: 'Outside', x: .9, y: .1, width: .3, height: .1}})).status, 400);
    assert.equal((await call('/api/photos/999/comments', {method: 'POST', cookie: member.cookie, body: {body: 'Unpublished'}})).status, 404);
    const publicResponse = await call('/api/photos/1/community');
    const publicBody = await publicResponse.json();
    assert.equal(publicBody.user, null);
    assert.equal(publicBody.likeCount, 1);
    assert.equal(publicBody.comments[0].body, comment.body);
    assert.equal(publicBody.annotations.length, 1);
    assert.ok(!JSON.stringify(publicBody).includes('@example.test'), 'public activity exposes no email addresses');
    assert.equal((await call('/api/photos/1/community', {cookie: member.cookie}).then(r => r.json())).liked, true);
    assert.equal((await call(`/api/comments/${comment.id}`, {method: 'DELETE', cookie: admin.cookie})).status, 200);
    assert.equal((await call('/api/photos/1/community').then(r => r.json())).comments.length, 0);
    assert.ok((await community.prepare('SELECT hidden_at FROM comments WHERE id = ?').bind(comment.id).first()).hidden_at, 'moderation preserves its audit record');
    assert.equal((await call(`/api/annotations/${annotation.id}`, {method: 'DELETE', cookie: admin.cookie})).status, 200);
    await mf.purgeCache();
    for (const q of ['remembered', 'identification']) assert.deepEqual((await call(`/api/search?q=${q}`).then(r => r.json())).results, [], 'moderated annotation terms disappear from search');
    assert.equal((await call('/api/admin/collections/roll-a/hero', {method: 'PUT', cookie: member.cookie, body: {photoId: 2}})).status, 403);
    assert.equal((await call('/api/admin/collections/roll-a/hero', {method: 'PUT', cookie: admin.cookie, body: {photoId: 3}})).status, 400);
    assert.equal((await call('/api/admin/collections/roll-a/hero', {method: 'PUT', cookie: admin.cookie, body: {photoId: 2}})).status, 200);
    const home = await call('/', {cookie: admin.cookie});
    const html = await home.text();
    assert.match(html, /chosen\/small.webp/);
    assert.match(html, /href="\/photos\/2\/"/);
    assert.match(html, /href="\/collections\/roll-a\/"/);
    assert.ok(!html.includes('old/small.webp'));
    assert.equal(home.headers.get('etag'), null);
    assert.equal(home.headers.get('set-cookie'), null);
    const nextHome = await call('/');
    assert.equal(await nextHome.text(), html, 'public cached HTML is independent of user cookies');
    assert.equal((await call('/api/admin/homepage')).status, 401);
    assert.equal((await call('/api/admin/homepage', {cookie: member.cookie})).status, 403);
    const defaults = await call('/api/admin/homepage', {cookie: admin.cookie});
    assert.match(defaults.headers.get('cache-control'), /no-store/);
    assert.deepEqual((await defaults.json()).collectionIds, ['popes-visit', 'ireland-england', 'french-grand-prix']);
    assert.equal((await call('/api/admin/homepage', {method: 'PUT', cookie: admin.cookie, requestOrigin: 'https://evil.test', body: {collectionIds: ['roll-b']}})).status, 403);
    assert.equal((await call('/api/admin/homepage', {method: 'PUT', cookie: admin.cookie, body: {collectionIds: ['roll-a', 'roll-a']}})).status, 400);
    const saved = await call('/api/admin/homepage', {method: 'PUT', cookie: admin.cookie, body: {collectionIds: ['roll-b', 'roll-a']}});
    assert.equal(saved.status, 200);
    assert.deepEqual((await saved.json()).collectionIds, ['roll-b', 'roll-a']);
    await mf.purgeCache(); // Simulate expiry of the 60-second public HTML cache.
    const selectedHome = await call('/');
    const selectedHtml = await selectedHome.text();
    assert.match(selectedHtml, /id="homepage-lead"><a href="\/photos\/3\/"/);
    assert.ok(selectedHtml.indexOf('/collections/roll-b/') < selectedHtml.indexOf('/collections/roll-a/'), 'album cards follow the saved order');
    assert.match(selectedHtml, /chosen\/small.webp/, 'inserted album cards receive the current hero override');
    assert.ok(!selectedHtml.includes('old/small.webp'));
    assert.equal(selectedHome.headers.get('set-cookie'), null);
    assert.equal(selectedHome.headers.get('etag'), null);
    assert.equal(await call('/', {cookie: member.cookie}).then(r => r.text()), selectedHtml);
    const directoryHtml = await call('/collections/').then(r => r.text());
    assert.match(directoryHtml, /chosen\/small.webp/);
    assert.ok(!directoryHtml.includes('/collections/roll-b/'), 'homepage choices do not replace directory contents');
    assert.equal((await call('/api/admin/homepage', {method: 'PUT', cookie: admin.cookie, body: {collectionIds: ['roll-a']}})).status, 200);
    await mf.purgeCache();
    const singleHtml = await call('/').then(r => r.text());
    assert.match(singleHtml, /id="homepage-lead"><a href="\/photos\/2\/"/, 'chosen first album uses its current lead photo');
    assert.ok(!singleHtml.includes('/collections/roll-b/'), 'removed albums disappear');
    await community.prepare('UPDATE homepage_settings SET collection_ids = ? WHERE id = 1').bind(JSON.stringify(['removed-album', 'roll-b'])).run();
    await mf.purgeCache();
    const staleHtml = await call('/').then(r => r.text());
    assert.match(staleHtml, /id="homepage-lead"><a href="\/photos\/3\/"/);
    assert.ok(!staleHtml.includes('removed-album'), 'later unpublished albums are skipped');
    await community.prepare('UPDATE homepage_settings SET collection_ids = ? WHERE id = 1').bind(JSON.stringify(['removed-album'])).run();
    await mf.purgeCache();
    assert.equal(await call('/').then(r => r.text()), html, 'all stale choices fall back to available default albums');
    const newsletter = await call('/api/newsletter/subscribe', {method: 'POST', cookie: member.cookie, body: {consent: true}});
    assert.equal(newsletter.status, 200);
    const status = await call('/api/newsletter/status', {cookie: member.cookie}).then(r => r.json());
    assert.equal(status.status, 'confirmed');
    assert.equal(status.providerSyncStatus, 'not_connected');
    assert.equal((await call('/api/newsletter/unsubscribe', {method: 'POST', cookie: member.cookie})).status, 200);
    assert.equal((await call('/api/newsletter/status', {cookie: member.cookie}).then(r => r.json())).status, 'unsubscribed');
    assert.equal((await call(`/api/admin/users/${member.user.id}`, {method: 'PATCH', cookie: admin.cookie, body: {status: 'suspended'}})).status, 200);
    assert.equal((await call('/api/photos/1/like', {method: 'PUT', cookie: member.cookie})).status, 401);
    const stats = await call('/api/admin/summary', {cookie: admin.cookie}).then(r => r.json());
    assert.equal(stats.users, 2);
    assert.equal(stats.suspendedUsers, 1);
    const activity = await call('/api/admin/activity', {cookie: admin.cookie}).then(r => r.json());
    assert.ok(activity.activity.some(event => event.action === 'collection.hero_changed'));
    assert.equal((await call('/api/auth/logout', {method: 'POST', cookie: admin.cookie})).status, 200);
    assert.equal((await call('/api/admin/users', {cookie: admin.cookie})).status, 401);
    const search = await call('/api/search?q=first');
    assert.equal(search.status, 200);
    assert.equal((await search.json()).results[0].id, 1);
  } finally { await mf.dispose(); }
});
