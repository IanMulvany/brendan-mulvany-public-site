import assert from 'node:assert/strict';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';

registerHooks({resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith('.ts')) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
}});
const {DEFAULT_HOMEPAGE_COLLECTION_IDS, MAX_HOMEPAGE_COLLECTIONS, getHomepageCollectionIds, handleHomepageSettings}
  = await import('../src/homepage-settings.ts');

// Exercise the real SQL and session authentication without production services.
class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON'); }
  withSession() { return this; }
  prepare(sql) {
    const database = this.sqlite;
    const prepared = values => ({
      bind: (...nextValues) => prepared(nextValues),
      first: async () => database.prepare(sql).get(...values) ?? null,
      all: async () => ({results: database.prepare(sql).all(...values).map(row => ({...row}))}),
      run: async () => ({success: true, meta: database.prepare(sql).run(...values)}),
    });
    return prepared([]);
  }
}
const origin = 'https://archive.test';
function fixture(t) {
  const archive = new D1(), community = new D1();
  archive.sqlite.exec(readFileSync(new URL('../migrations/0001_search.sql', import.meta.url), 'utf8'));
  for (const filename of ['0001_accounts.sql', '0002_community.sql', '0003_homepage.sql', '0005_moderation.sql']) {
    community.sqlite.exec(readFileSync(new URL(`../community-migrations/${filename}`, import.meta.url), 'utf8'));
  }
  const collections = [...DEFAULT_HOMEPAGE_COLLECTION_IDS, 'roll-6000', 'roll-4000', 'roll-9000', 'roll-extra'];
  collections.forEach((id, index) => archive.sqlite.prepare(`INSERT INTO photos
    (id,collection_id,title,description,date,year,location,tags,image_base,width,height)
    VALUES(?,?,'Photograph','','1980','1980','','[]','https://cdn.example.test/photo',800,600)`).run(index + 1, id));
  const env = {DB: archive, COMMUNITY: community, PUBLIC_ORIGIN: origin, ADMIN_EMAIL: 'admin@example.test'};
  const users = {};
  const at = Math.floor(Date.now() / 1000);
  for (const [name, role, status, verified] of [
    ['admin', 'admin', 'active', true], ['member', 'member', 'active', true],
    ['storedAdmin', 'admin', 'active', true], ['suspended', 'member', 'suspended', true],
    ['unverified', 'member', 'active', false],
  ]) {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    community.sqlite.prepare(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, `${name}@example.test`, name, role, status, verified ? at : null, at, at);
    community.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(createHash('sha256').update(token).digest('hex'), id, at, at + 3600);
    users[name] = {id, token};
  }
  async function call({method = 'GET', as = 'admin', body, requestOrigin = origin, pathname = '/api/admin/homepage'} = {}) {
    const response = await handleHomepageSettings(new Request(origin + pathname, {method,
      headers: {
        ...(as ? {cookie: `__Host-bm_session=${users[as].token}`} : {}),
        ...(method !== 'GET' ? {origin: requestOrigin} : {}),
        ...(body !== undefined ? {'content-type': 'application/json'} : {}),
      }, ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    }), env);
    if (!response) return null;
    return {status: response.status, headers: response.headers, body: await response.json()};
  }
  t.after(() => { archive.sqlite.close(); community.sqlite.close(); });
  return {env, archive: archive.sqlite, db: community.sqlite, users, collections, call};
}
const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);

test('an unsaved homepage uses the three defaults without creating a settings row', async t => {
  const {env, db, call} = fixture(t);
  assert.equal(MAX_HOMEPAGE_COLLECTIONS, 6);
  assert.deepEqual(DEFAULT_HOMEPAGE_COLLECTION_IDS, ['popes-visit', 'ireland-england', 'french-grand-prix']);
  const ids = await getHomepageCollectionIds(env);
  assert.deepEqual(ids, [...DEFAULT_HOMEPAGE_COLLECTION_IDS]);
  ids.reverse();
  assert.deepEqual(await getHomepageCollectionIds(env), [...DEFAULT_HOMEPAGE_COLLECTION_IDS], 'callers cannot mutate shared defaults');
  const response = await call();
  assert.deepEqual(response.body, {collectionIds: [...DEFAULT_HOMEPAGE_COLLECTION_IDS], maxCollections: 6});
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM homepage_settings').get().count, 0);
  assert.equal(await call({pathname: '/api/admin/other'}), null);
});

test('only an active verified administrator can read or save, with same-origin writes', async t => {
  const {call, env, db} = fixture(t);
  for (const [as, status] of [[null, 401], ['member', 403], ['storedAdmin', 403], ['suspended', 401], ['unverified', 401]]) {
    await rejects(call({as}), status);
    await rejects(call({as, method: 'PUT', body: {collectionIds: ['popes-visit']}}), status);
  }
  // Even the configured administrator must have an active, verified session.
  for (const invalidAdmin of ['suspended', 'unverified']) {
    env.ADMIN_EMAIL = `${invalidAdmin}@example.test`;
    await rejects(call({as: invalidAdmin, method: 'PUT', body: {collectionIds: ['popes-visit']}}), 401);
  }
  env.ADMIN_EMAIL = 'admin@example.test';
  await rejects(call({method: 'PUT', requestOrigin: 'https://evil.test', body: {collectionIds: ['popes-visit']}}), 403);
  await rejects(call({method: 'POST', body: {collectionIds: ['popes-visit']}}), 405);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM homepage_settings').get().count, 0);
});

test('invalid counts, duplicates, malformed and unpublished IDs cannot replace saved settings', async t => {
  const {call, env, collections, db} = fixture(t);
  await call({method: 'PUT', body: {collectionIds: ['roll-6000']}});
  for (const value of [
    undefined, null, 'popes-visit', [], collections, ['popes-visit', 'popes-visit'],
    [''], ['  popes-visit'], ['../popes-visit'], ['x'.repeat(81)], [123], [{}],
    ['not-published'], ['popes-visit', 'not-published'], ["popes-visit') OR 1=1 --"],
  ]) {
    await rejects(call({method: 'PUT', body: {collectionIds: value}}), 400);
    assert.deepEqual(await getHomepageCollectionIds(env), ['roll-6000']);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM homepage_settings').get().count, 1);
});

test('saved collections preserve explicit order, singleton identity, editor and timestamp across archive reseeding', async t => {
  const {call, env, archive, db, users, collections} = fixture(t);
  const chosen = collections.slice(0, 6).reverse();
  const startedAt = Math.floor(Date.now() / 1000);
  const saved = await call({method: 'PUT', body: {collectionIds: chosen}});
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body, {collectionIds: chosen, maxCollections: 6});
  assert.match(saved.headers.get('cache-control'), /no-store/);
  assert.deepEqual((await call()).body.collectionIds, chosen);
  const row = db.prepare('SELECT * FROM homepage_settings').get();
  assert.equal(row.id, 1);
  assert.equal(row.updated_by, users.admin.id);
  assert.ok(row.updated_at >= startedAt);
  assert.deepEqual(JSON.parse(row.collection_ids), chosen);
  await call({method: 'PUT', body: {collectionIds: ['ireland-england']}});
  assert.deepEqual(await getHomepageCollectionIds(env), ['ireland-england']);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM homepage_settings').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM activity').get().count, 0, 'homepage settings do not change the existing activity schema');
  archive.exec('DELETE FROM photos');
  assert.deepEqual(await getHomepageCollectionIds(env), ['ireland-england'], 'saved editorial order lives independently of the archive snapshot');
  await rejects(call({method: 'PUT', body: {collectionIds: ['ireland-england']}}), 400, 'new saves still require current publication');
});

test('the shared write quota and singleton/JSON/foreign-key constraints are enforced', async t => {
  const {call, db, users} = fixture(t);
  const expiresAt = Math.floor(Date.now() / 1000) + 60;
  db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)').run(`community:user:${users.admin.id}`, 60, expiresAt);
  await rejects(call({method: 'PUT', body: {collectionIds: ['popes-visit']}}), 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM homepage_settings').get().count, 0);
  const insert = db.prepare('INSERT INTO homepage_settings(id,collection_ids,updated_by,updated_at) VALUES(?,?,?,?)');
  for (const [id, ids] of [[2, '["popes-visit"]'], [1, '[]'], [1, '{}'], [1, 'not-json'], [1, JSON.stringify(Array(7).fill('a'))]]) {
    assert.throws(() => insert.run(id, ids, users.admin.id, 1));
  }
  assert.throws(() => insert.run(1, '["popes-visit"]', randomUUID(), 1), /FOREIGN KEY/);
});
