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
const {handleEditorial} = await import('../src/editorial.ts');

class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON'); }
  withSession() { return this; }
  prepare(sql) {
    const db = this.sqlite;
    const bound = values => ({
      bind: (...next) => bound(next),
      first: async () => db.prepare(sql).get(...values) ?? null,
      all: async () => ({results: db.prepare(sql).all(...values)}),
      run: async () => ({meta: db.prepare(sql).run(...values)}),
    });
    return bound([]);
  }
}

function fixture(t) {
  const archive = new D1(), community = new D1();
  archive.sqlite.exec(readFileSync(new URL('../migrations/0001_search.sql', import.meta.url), 'utf8'));
  for (const filename of ['0001_accounts.sql', '0002_community.sql', '0005_moderation.sql', '0006_editorial_corrections.sql']) {
    community.sqlite.exec(readFileSync(new URL(`../community-migrations/${filename}`, import.meta.url), 'utf8'));
  }
  archive.sqlite.prepare(`INSERT INTO photos(id,collection_id,title,description,date,year,location,tags,image_base)
    VALUES(1,'roll-5088','Original title','Original caption','1986','1986','','[]','https://cdn.example.test/a')`).run();
  const tokens = {};
  const at = Math.floor(Date.now() / 1000);
  for (const name of ['owner', 'member', 'fakeAdmin']) {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    community.sqlite.prepare(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, `${name}@example.test`, name, name === 'fakeAdmin' ? 'admin' : 'member', 'active', at, at, at);
    community.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(createHash('sha256').update(token).digest('hex'), id, at, at + 3600);
    tokens[name] = token;
  }
  const origin = 'https://archive.test';
  const env = {DB: archive, COMMUNITY: community, PUBLIC_ORIGIN: origin,
    ADMIN_EMAIL: 'owner@example.test', CACHE_VERSION: 'scan-current'};
  async function call(method = 'GET', body, as = 'owner', path = '/api/admin/corrections', requestOrigin = origin) {
    return handleEditorial(new Request(origin + path, {method,
      headers: {...(as ? {cookie: `__Host-bm_session=${tokens[as]}`} : {}),
        ...(method !== 'GET' ? {origin: requestOrigin} : {}),
        ...(body ? {'content-type': 'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})}), env);
  }
  t.after(() => { archive.sqlite.close(); community.sqlite.close(); });
  return {call, db: community.sqlite};
}

const proposal = {kind: 'photo', entityId: '1', field: 'description',
  baseValue: 'Original caption', value: 'A corrected caption'};
const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);

test('only the verified configured owner can queue, list and cancel corrections', async t => {
  const {call, db} = fixture(t);
  for (const as of [null, 'member', 'fakeAdmin']) {
    const status = as ? 403 : 401;
    await rejects(call('GET', undefined, as), status);
    await rejects(call('POST', proposal, as), status);
  }
  await rejects(call('POST', proposal, 'owner', undefined, 'https://evil.test'), 403);
  const response = await call('POST', proposal);
  assert.equal(response.status, 201);
  const {id} = await response.json();
  assert.match(id, /^[0-9a-f-]{36}$/);
  const list = await (await call()).json();
  assert.equal(list.corrections.length, 1);
  assert.equal(list.corrections[0].sourceVersion, 'scan-current');
  assert.match((await call()).headers.get('cache-control'), /no-store/);
  assert.equal(db.prepare('SELECT status FROM editorial_corrections WHERE id=?').get(id).status, 'pending');
  await rejects(call('DELETE', undefined, 'member', `/api/admin/corrections/${id}`), 403);
  assert.equal((await call('DELETE', undefined, 'owner', `/api/admin/corrections/${id}`)).status, 200);
  assert.equal(db.prepare('SELECT status FROM editorial_corrections WHERE id=?').get(id).status, 'cancelled');
});

test('published base checks, field allowlist and one open change per field', async t => {
  const {call, db} = fixture(t);
  for (const body of [
    {...proposal, field: 'imageBase'}, {...proposal, entityId: '2'},
    {...proposal, baseValue: 'Stale caption'}, {...proposal, value: 'Original caption'},
    {...proposal, value: '<script>\u0000</script>'},
    {...proposal, kind: 'collection', entityId: '../roll', field: 'title'},
  ]) await rejects(call('POST', body), body.entityId === '2' ? 404 : body.baseValue === 'Stale caption' ? 409 : 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM editorial_corrections').get().total, 0);
  assert.equal((await call('POST', proposal)).status, 201);
  await rejects(call('POST', {...proposal, value: 'Another caption'}), 409);
  assert.equal((await call('POST', {kind: 'collection', entityId: 'roll-5088', field: 'title',
    baseValue: 'Old roll title', value: 'A better roll title'})).status, 201);
  assert.equal(db.prepare('SELECT COUNT(*) AS total FROM editorial_corrections').get().total, 2);
});
