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
const {handleCommunity, getCollectionHeroes, validateAnnotation} = await import('../src/community.ts');

// Real SQLite constraints and transactions, behind the small D1 surface used by
// the handlers. Authentication is real too: hashed, expiring session cookies.
class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  first(column) {
    const row = this.db.prepare(this.sql).get(...this.values);
    return Promise.resolve(row ? (column ? row[column] : {...row}) : null);
  }
  execute() {
    const rows = this.db.prepare(this.sql).all(...this.values).map(row => ({...row}));
    const changes = this.db.prepare('SELECT changes() AS changes').get().changes;
    return {results: rows, success: true, meta: {changes}};
  }
  all() { return Promise.resolve(this.execute()); }
  run() { return Promise.resolve(this.execute()); }
}
class D1 {
  constructor() { this.sqlite = new DatabaseSync(':memory:'); this.sqlite.exec('PRAGMA foreign_keys=ON'); }
  prepare(sql) { return new Statement(this.sqlite, sql); }
  withSession() { return this; }
  batch(statements) {
    this.sqlite.exec('BEGIN');
    try {
      const results = statements.map(statement => statement.execute());
      this.sqlite.exec('COMMIT');
      return Promise.resolve(results);
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
  }
}

const origin = 'https://archive.test';
function fixture(t) {
  const archive = new D1(), community = new D1();
  archive.sqlite.exec(readFileSync(new URL('../migrations/0001_search.sql', import.meta.url), 'utf8'));
  for (const file of ['0001_accounts.sql', '0002_community.sql', '0004_search.sql', '0005_moderation.sql']) {
    community.sqlite.exec(readFileSync(new URL(`../community-migrations/${file}`, import.meta.url), 'utf8'));
  }
  const insert = archive.sqlite.prepare(`INSERT INTO photos
    (id,collection_id,title,description,date,year,location,tags,image_base,width,height) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  for (const [id, collection] of [[1, 'one'], [2, 'one'], [3, 'two']]) {
    insert.run(id, collection, `Photo ${id}`, 'Published photograph', '1980', '1980', 'Ireland', '[]', `https://cdn.example.test/${id}`, 1200, 800);
  }
  const env = {DB: archive, COMMUNITY: community, PUBLIC_ORIGIN: origin, ADMIN_EMAIL: 'admin@example.test'};
  const identities = {};
  for (const [name, role, status, verified] of [
    ['member', 'member', 'active', true], ['other', 'member', 'active', true], ['admin', 'admin', 'active', true],
    ['unverified', 'member', 'active', false], ['suspended', 'member', 'suspended', true], ['storedAdmin', 'admin', 'active', true],
  ]) {
    const id = randomUUID(), token = randomBytes(32).toString('hex'), at = Math.floor(Date.now() / 1000);
    community.sqlite.prepare(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(id, `${name}@example.test`, name, role, status, verified ? at : null, at, at);
    community.sqlite.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at)
      VALUES (?,?,?,?)`).run(createHash('sha256').update(token).digest('hex'), id, at, at + 3600);
    identities[name] = {id, token};
  }
  community.sqlite.prepare("UPDATE users SET annotation_status='approved' WHERE id=?").run(identities.member.id);
  async function call(path, {method = 'GET', as = null, body, requestOrigin = origin, headers = {}} = {}) {
    const requestHeaders = {...headers};
    if (as) requestHeaders.cookie = `__Host-bm_session=${identities[as].token}`;
    if (method !== 'GET') requestHeaders.origin = requestOrigin;
    if (body !== undefined) requestHeaders['content-type'] = 'application/json';
    const response = await handleCommunity(new Request(origin + path, {
      method, headers: requestHeaders, ...(body !== undefined ? {body: JSON.stringify(body)} : {}),
    }), env);
    assert.ok(response, `Route should be handled: ${path}`);
    return {status: response.status, headers: response.headers, body: await response.json()};
  }
  t.after(() => { archive.sqlite.close(); community.sqlite.close(); });
  return {env, archive: archive.sqlite, db: community.sqlite, identities, call};
}
const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);
const box = {name: 'A person', note: 'In the crowd', x: 0.1, y: 0.2, width: 0.2, height: 0.3};

test('anonymous public reads omit email, while verified active sessions are required for every write', async t => {
  const {call, db} = fixture(t);
  const read = await call('/api/photos/1/community');
  assert.deepEqual(read.body, {user: null, likeCount: 0, liked: false, comments: [], annotations: []});
  assert.match(read.headers.get('cache-control'), /no-store/);
  for (const as of [null, 'unverified', 'suspended']) {
    const restrictedRead = await call('/api/photos/1/community', {as});
    assert.equal(restrictedRead.body.user, null, `${as || 'anonymous'} must not receive a contributing identity`);
    await rejects(call('/api/photos/1/comments', {method: 'POST', as, body: {body: 'A comment'}}), 401);
    await rejects(call('/api/photos/1/annotations', {method: 'POST', as, body: box}), 401);
    await rejects(call('/api/photos/1/like', {method: 'PUT', as}), 401);
  }
  await rejects(call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'Cross-site'}, requestOrigin: 'https://evil.test'}), 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  const created = await call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'A public comment'}});
  assert.equal(created.status, 201);
  const anonymous = await call('/api/photos/1/community');
  assert.equal(anonymous.body.comments[0].canDelete, false);
  assert.equal(anonymous.body.comments[0].body, 'A public comment');
  const signedIn = await call('/api/photos/1/community', {as: 'member'});
  assert.equal(signedIn.body.comments[0].canDelete, true);
  assert.equal(signedIn.body.user.displayName, 'member');
  assert.ok(!JSON.stringify(signedIn.body).includes('@'), 'public JSON must not expose user email addresses');
});

test('unverified, suspended, revoked and expired sessions can read names but receive no annotation permissions', async t => {
  const {call, db, identities} = fixture(t);
  const annotation = (await call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: box})).body;
  for (const as of ['unverified', 'suspended']) {
    const read = (await call('/api/photos/1/community', {as})).body;
    assert.equal(read.user, null);
    assert.equal(read.annotations[0].id, annotation.id);
    assert.equal(read.annotations[0].name, box.name);
    assert.equal(read.annotations[0].canDelete, false);
  }
  const at = Math.floor(Date.now() / 1000);
  for (const [column, value] of [['revoked_at', at], ['expires_at', at - 1]]) {
    db.prepare('UPDATE sessions SET revoked_at=NULL, expires_at=? WHERE user_id=?').run(at + 3600, identities.member.id);
    db.prepare(`UPDATE sessions SET ${column}=? WHERE user_id=?`).run(value, identities.member.id);
    const read = (await call('/api/photos/1/community', {as: 'member'})).body;
    assert.equal(read.user, null, `${column} must remove the contributing identity`);
    assert.equal(read.annotations[0].name, box.name);
    assert.equal(read.annotations[0].canDelete, false, 'a former session cannot manage even its own contributions');
    await rejects(call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: box}), 401);
  }
});

test('comments and annotations can only be hidden by their owner or an administrator', async t => {
  const {call, db, identities} = fixture(t);
  const comment = (await call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'Remembered event'}})).body;
  const annotation = (await call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: box})).body;
  await rejects(call(`/api/comments/${comment.id}`, {method: 'DELETE', as: 'other'}), 403);
  await rejects(call(`/api/annotations/${annotation.id}`, {method: 'DELETE', as: 'other'}), 403);
  await call(`/api/comments/${comment.id}`, {method: 'DELETE', as: 'member'});
  await call(`/api/comments/${comment.id}`, {method: 'DELETE', as: 'member'});
  await call(`/api/annotations/${annotation.id}`, {method: 'DELETE', as: 'admin'});
  const visible = (await call('/api/photos/1/community')).body;
  assert.deepEqual(visible.comments, []);
  assert.deepEqual(visible.annotations, []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 1, 'moderation preserves the contribution record');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='comment.hidden'").get().n, 1, 'repeated deletion is idempotent');
  assert.equal(db.prepare('SELECT hidden_by FROM annotations').get().hidden_by, identities.admin.id);
  const activity = (await call('/api/admin/activity', {as: 'admin'})).body.activity;
  assert.ok(activity.some(row => row.action === 'annotation.hidden' && row.userId === identities.admin.id));
  assert.ok(!JSON.stringify(activity).includes('Remembered event'));
  assert.ok(!JSON.stringify(activity).includes('In the crowd'));
  assert.ok(!JSON.stringify(activity).includes('@'));
});

test('unpublished photos and invalid comments are rejected before contribution mutations', async t => {
  const {call, archive, db} = fixture(t);
  for (const body of ['', '  ', 'x'.repeat(2001), 'bad\u0000text', 123]) {
    await rejects(call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body}}), 400);
  }
  await rejects(call('/api/photos/999/comments', {method: 'POST', as: 'member', body: {body: 'Unpublished'}}), 404);
  await rejects(call('/api/photos/999/annotations', {method: 'POST', as: 'member', body: box}), 404);
  await rejects(call('/api/photos/999/like', {method: 'PUT', as: 'member'}), 404);
  const comment = (await call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'Before removal'}})).body;
  archive.prepare('DELETE FROM photos WHERE id=1').run();
  await rejects(call(`/api/comments/${comment.id}`, {method: 'DELETE', as: 'member'}), 404);
  await rejects(call('/api/photos/1/like', {method: 'DELETE', as: 'member'}), 404);
  assert.equal(db.prepare('SELECT hidden_at FROM comments').get().hidden_at, null);
});

test('likes are unique and idempotent, including activity records', async t => {
  const {call, db, identities} = fixture(t);
  for (let i = 0; i < 2; i++) {
    const liked = await call('/api/photos/1/like', {method: 'PUT', as: 'member'});
    assert.deepEqual(liked.body, {likeCount: 1, liked: true});
  }
  await call('/api/photos/1/like', {method: 'PUT', as: 'other'});
  assert.equal((await call('/api/photos/1/community')).body.likeCount, 2);
  assert.throws(() => db.prepare('INSERT INTO likes(id,photo_id,user_id,created_at) VALUES(?,?,?,?)')
    .run(randomUUID(), 1, identities.member.id, 1), /UNIQUE/);
  for (let i = 0; i < 2; i++) {
    assert.deepEqual((await call('/api/photos/1/like', {method: 'DELETE', as: 'member'})).body, {likeCount: 1, liked: false});
  }
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='like.added'").get().n, 2);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='like.removed'").get().n, 1);
});

test('person rectangles reject non-finite, overflowing, tiny and invalid fields in both API and SQL', async t => {
  const {call, db, identities} = fixture(t);
  for (const value of [
    {...box, x: NaN}, {...box, y: Infinity}, {...box, width: '0.2'}, {...box, x: -0.01},
    {...box, x: 0.9}, {...box, y: 0.9}, {...box, width: 0.009}, {...box, height: 0},
    {...box, name: ''}, {...box, name: 'x'.repeat(121)}, {...box, note: 'x'.repeat(501)},
  ]) assert.throws(() => validateAnnotation(value), error => error.status === 400);
  await rejects(call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: {...box, width: 0.009}}), 400);
  const edge = {...box, x: 0.99, y: 0.99, width: 0.01, height: 0.01};
  const created = await call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: edge});
  assert.equal(created.body.width, 0.01);
  const insert = db.prepare(`INSERT INTO annotations(id,photo_id,user_id,name,note,x,y,width,height,created_at)
    VALUES(?,?,?,'Person','',?,?,?,?,1)`);
  for (const [x, y, width, height] of [[-1, 0, 0.2, 0.2], [0.9, 0, 0.2, 0.2], [0, 0, 0.001, 0.2], [0, 1, 0.2, 0.2]]) {
    assert.throws(() => insert.run(randomUUID(), 1, identities.member.id, x, y, width, height), /CHECK/);
  }
});

test('keyset pagination visits every contribution once despite equal timestamps and exhausted types', async t => {
  const {call, db, identities} = fixture(t);
  const insert = db.prepare('INSERT INTO comments(id,photo_id,user_id,body,created_at) VALUES(?,?,?,?,?)');
  const expected = [];
  for (let i = 0; i < 205; i++) {
    const id = randomUUID(); expected.push(id); insert.run(id, 1, identities.member.id, `Comment ${i}`, 1234);
  }
  const createdAnnotation = (await call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: box})).body;
  let next = '/api/photos/1/community';
  const comments = [], annotations = [], pageLengths = [];
  while (next) {
    const response = await call(next);
    pageLengths.push(response.body.comments.length);
    comments.push(...response.body.comments);
    annotations.push(...response.body.annotations);
    next = response.body.nextCursor ? '/api/photos/1/community?cursor=' + response.body.nextCursor : null;
    assert.ok(pageLengths.length <= 3, 'cursor must make progress');
  }
  assert.deepEqual(pageLengths, [100, 100, 5]);
  assert.deepEqual(comments.map(row => row.id).sort(), expected.sort());
  assert.equal(new Set(comments.map(row => row.id)).size, 205);
  assert.deepEqual(annotations.map(row => row.id), [createdAnnotation.id]);
  const cursor = (await call('/api/photos/1/community')).body.nextCursor;
  await rejects(call('/api/photos/2/community?cursor=' + cursor), 400);
  await rejects(call('/api/photos/1/community?cursor=garbage'), 400);
});

test('administration is restricted and suspension revokes all sessions without permitting admin suspension', async t => {
  const {call, db, identities} = fixture(t);
  for (const endpoint of ['/api/admin/summary', '/api/admin/users', '/api/admin/activity', '/api/admin/subscribers', '/api/admin/collections']) {
    await rejects(call(endpoint), 401);
    await rejects(call(endpoint, {as: 'member'}), 403);
    await rejects(call(endpoint, {as: 'storedAdmin'}), 403, 'stored role cannot override configured admin identity');
  }
  for (const target of ['admin']) {
    await rejects(call(`/api/admin/users/${identities[target].id}`, {method: 'PATCH', as: 'admin', body: {status: 'suspended'}}), 403);
  }
  await call(`/api/admin/users/${identities.member.id}`, {method: 'PATCH', as: 'admin', body: {status: 'suspended'}});
  assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get(identities.member.id).status, 'suspended');
  assert.ok(db.prepare('SELECT revoked_at FROM sessions WHERE user_id=?').get(identities.member.id).revoked_at > 0);
  await rejects(call('/api/photos/1/like', {method: 'PUT', as: 'member'}), 401);
  await call(`/api/admin/users/${identities.member.id}`, {method: 'PATCH', as: 'admin', body: {status: 'active'}});
  await rejects(call('/api/photos/1/like', {method: 'PUT', as: 'member'}), 401, 'reactivation must not resurrect old sessions');
  const summary = (await call('/api/admin/summary', {as: 'admin'})).body;
  assert.equal(summary.users, 6);
  assert.equal(summary.suspendedUsers, 1);
  const users = await call('/api/admin/users', {as: 'admin'});
  assert.equal(users.body.users.length, 6);
  assert.equal(users.body.hasMore, false);
  assert.match(users.headers.get('cache-control'), /no-store/);
  await rejects(call('/api/admin/users?page=0', {as: 'admin'}), 400);
});

test('hero choices require an admin and same-collection published photo, and survive archive reseeding', async t => {
  const {call, env, archive, db} = fixture(t);
  await rejects(call('/api/admin/collections/one/hero', {method: 'PUT', as: 'member', body: {photoId: 1}}), 403);
  await rejects(call('/api/admin/collections/one/hero', {method: 'PUT', as: 'admin', body: {photoId: 3}}), 400);
  await rejects(call('/api/admin/collections/one/hero', {method: 'PUT', as: 'admin', body: {photoId: 999}}), 404);
  const cards = (await call('/api/admin/collections/one/photos', {as: 'admin'})).body.photos;
  assert.equal(cards.length, 2);
  assert.equal(Object.keys(cards[0]).length, 7);
  for (let i = 0; i < 2; i++) await call('/api/admin/collections/one/hero', {method: 'PUT', as: 'admin', body: {photoId: 2}});
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM activity WHERE action='collection.hero_changed'").get().n, 1);
  let response = await call('/api/collection-heroes');
  assert.equal(response.headers.get('cache-control'), 'public, max-age=60');
  assert.deepEqual(response.body.heroes, await getCollectionHeroes(env));
  assert.equal(response.body.heroes[0].photoId, 2);
  assert.ok(!JSON.stringify(response.body).includes('@'));
  const saved = archive.prepare('SELECT * FROM photos WHERE id=2').get();
  archive.prepare('DELETE FROM photos WHERE id=2').run();
  assert.deepEqual((await call('/api/collection-heroes')).body.heroes, [], 'unpublished hero is never returned');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM collection_heroes').get().n, 1, 'archive reseed cannot delete durable hero choice');
  archive.prepare(`INSERT INTO photos(id,collection_id,title,description,date,year,location,tags,image_base,width,height)
    VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(...Object.values(saved));
  assert.equal((await call('/api/collection-heroes')).body.heroes[0].photoId, 2);
  archive.prepare("UPDATE photos SET collection_id='two' WHERE id=2").run();
  assert.deepEqual((await call('/api/collection-heroes')).body.heroes, [], 'moved photo cannot become another collection hero');
});

test('per-user write quota is enforced and foreign-key constraints prevent orphaned contributions', async t => {
  const {call, db, identities} = fixture(t);
  const until = Math.floor(Date.now() / 1000) + 60;
  db.prepare('INSERT INTO rate_limits(key,count,expires_at) VALUES(?,?,?)').run(`community:user:${identities.member.id}`, 60, until);
  await rejects(call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'Over quota'}}), 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  assert.throws(() => db.prepare('INSERT INTO comments(id,photo_id,user_id,body,created_at) VALUES(?,?,?,?,?)')
    .run(randomUUID(), 1, randomUUID(), 'Orphan', 1), /FOREIGN KEY/);
  assert.throws(() => db.prepare('INSERT INTO comments(id,photo_id,user_id,body,created_at) VALUES(?,?,?,?,?)')
    .run(randomUUID(), 1, identities.member.id, 'x'.repeat(2001), 1), /CHECK/);
});

test('admin directories paginate users, activity and subscribers without exposing subscriber details publicly', async t => {
  const {call, db, identities} = fixture(t);
  const at = Math.floor(Date.now() / 1000);
  const userInsert = db.prepare(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
    VALUES (?,?,?,'member','active',?,?,?)`);
  const subscriberInsert = db.prepare(`INSERT INTO newsletter_subscribers
    (id,email,display_name,status,consent_at,confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`);
  const activityInsert = db.prepare('INSERT INTO activity(id,user_id,action,photo_id,target_id,created_at) VALUES(?,?,?,?,?,?)');
  for (let i = 0; i < 52; i++) {
    userInsert.run(randomUUID(), `visitor-${i}@example.test`, `Visitor ${i}`, at, at, at);
    subscriberInsert.run(randomUUID(), `subscriber-${i}@example.test`, `Subscriber ${i}`, i === 0 ? 'pending' : 'confirmed', at, i === 0 ? null : at, at, at);
    activityInsert.run(randomUUID(), identities.member.id, 'like.added', 1, null, at);
  }
  for (const name of ['users', 'activity', 'subscribers']) {
    const first = (await call(`/api/admin/${name}?page=1`, {as: 'admin'})).body;
    const second = (await call(`/api/admin/${name}?page=2`, {as: 'admin'})).body;
    assert.equal(first[name].length, 50, name);
    assert.equal(first.hasMore, true, name);
    assert.equal(second.hasMore, false, name);
    const expected = name === 'users' ? 58 : 52;
    assert.equal(new Set([...first[name], ...second[name]].map(row => row.id)).size, expected, name);
  }
  assert.equal((await call('/api/admin/summary', {as: 'admin'})).body.subscribers, 51, 'only confirmed subscriptions count');
  assert.ok(!JSON.stringify((await call('/api/photos/1/community')).body).includes('subscriber-'));
});

test('contribution and audit writes roll back together on failure', async t => {
  const {call, db} = fixture(t);
  db.exec(`CREATE TRIGGER reject_test_audit BEFORE INSERT ON activity
    BEGIN SELECT RAISE(ABORT, 'simulated audit failure'); END`);
  await assert.rejects(call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'Must roll back'}}), /simulated audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  await assert.rejects(call('/api/photos/1/like', {method: 'PUT', as: 'member'}), /simulated audit failure/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM likes').get().n, 0);
});

test('annotation approval and revocation take effect on existing sessions while likes and comments stay available', async t => {
  const {call, db, identities} = fixture(t);
  const permissionUrl = `/api/admin/users/${identities.other.id}`;
  const permission = annotationStatus => call(permissionUrl, {method: 'PATCH', as: 'admin', body: {annotationStatus}});
  let user = (await call('/api/photos/1/community', {as: 'other'})).body.user;
  assert.equal(user.canAnnotate, false);
  assert.equal(user.annotationStatus, 'pending');
  await rejects(call('/api/photos/1/annotations', {method: 'POST', as: 'other', body: box}), 403);
  await rejects(call(permissionUrl, {method: 'PATCH', as: 'other', body: {annotationStatus: 'approved'}}), 403);
  assert.equal((await call('/api/photos/1/like', {method: 'PUT', as: 'other'})).status, 200);
  assert.equal((await call('/api/photos/1/comments', {method: 'POST', as: 'other', body: {body: 'Before approval'}})).status, 201);
  for (let i = 0; i < 2; i++) assert.equal((await permission('approved')).body.user.canAnnotate, true);
  const annotation = (await call('/api/photos/1/annotations', {method: 'POST', as: 'other', body: box})).body;
  for (let i = 0; i < 2; i++) assert.equal((await permission('revoked')).body.user.canAnnotate, false);
  user = (await call('/api/photos/1/community', {as: 'other'})).body.user;
  assert.equal(user.annotationStatus, 'revoked');
  assert.equal(user.canAnnotate, false);
  assert.equal(db.prepare('SELECT revoked_at FROM sessions WHERE user_id=?').get(identities.other.id).revoked_at, null);
  await rejects(call('/api/photos/1/annotations', {method: 'POST', as: 'other', body: box}), 403);
  assert.equal((await call('/api/photos/1/comments', {method: 'POST', as: 'other', body: {body: 'After revocation'}})).status, 201);
  assert.equal((await call('/api/photos/1/like', {method: 'PUT', as: 'other'})).status, 200);
  assert.equal((await call('/api/photos/1/community')).body.annotations[0].id, annotation.id, 'existing annotations are retained');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM moderation_activity').get().n, 2, 'repeated decisions are idempotent');
  assert.equal((await call(`/api/annotations/${annotation.id}`, {method: 'DELETE', as: 'other'})).status, 200, 'authors can still withdraw old contributions');
});

test('permission listings show effective admin roles, filter approvals, and prevent privilege injection', async t => {
  const {call, db, identities} = fixture(t);
  let all = (await call('/api/admin/users', {as: 'admin'})).body.users;
  assert.equal(all.find(user => user.id === identities.admin.id).annotationStatus, 'approved');
  assert.equal(all.find(user => user.id === identities.storedAdmin.id).role, 'member');
  assert.equal(all.find(user => user.id === identities.storedAdmin.id).canAnnotate, false);
  assert.equal((await call('/api/admin/users?annotationStatus=approved', {as: 'admin'})).body.users.length, 2);
  const pending = (await call('/api/admin/users?annotationStatus=pending', {as: 'admin'})).body.users;
  assert.equal(pending.length, 4);
  assert.ok(pending.every(user => user.annotationStatus === 'pending'));
  assert.equal((await call('/api/admin/summary', {as: 'admin'})).body.pendingAnnotationUsers, 2, 'only active verified nonadmins need a decision');
  for (const annotationStatus of ['admin', 'pending', true]) {
    await rejects(call(`/api/admin/users/${identities.other.id}`, {method: 'PATCH', as: 'admin', body: {annotationStatus}}), 400);
  }
  await rejects(call(`/api/admin/users/${identities.other.id}`, {method: 'PATCH', as: 'admin', body: {annotationStatus: 'approved', status: 'active'}}), 400);
  for (const target of ['unverified', 'suspended']) {
    await rejects(call(`/api/admin/users/${identities[target].id}`, {method: 'PATCH', as: 'admin', body: {annotationStatus: 'approved'}}), 400);
  }
  await rejects(call(`/api/admin/users/${identities.admin.id}`, {method: 'PATCH', as: 'admin', body: {annotationStatus: 'revoked'}}), 403);
  await rejects(call(`/api/admin/users/${randomUUID()}`, {method: 'PATCH', as: 'admin', body: {annotationStatus: 'approved'}}), 404);
  await rejects(call('/api/admin/users?annotationStatus=invalid', {as: 'admin'}), 400);
  await rejects(call(`/api/admin/users/${identities.other.id}`, {method: 'PATCH', as: 'admin', body: {annotationStatus: 'approved'}, requestOrigin: 'https://evil.test'}), 403);
  await call(`/api/admin/users/${identities.storedAdmin.id}`, {method: 'PATCH', as: 'admin', body: {status: 'suspended'}});
  assert.equal(db.prepare('SELECT status FROM users WHERE id=?').get(identities.storedAdmin.id).status, 'suspended', 'a stale stored admin role cannot protect an ordinary member');
});

test('revocation between permission lookup and annotation insertion prevents the write and audit event', async t => {
  const {call, env, db, identities} = fixture(t);
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    db.prepare("UPDATE users SET annotation_status='revoked' WHERE id=?").run(identities.member.id);
    return prepare(sql);
  };
  await rejects(call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: box}), 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM annotations').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity').get().n, 0);
});

test('suspension between session lookup and comment insertion prevents the write and audit event', async t => {
  const {call, env, db, identities} = fixture(t);
  const prepare = env.DB.prepare.bind(env.DB);
  env.DB.prepare = sql => {
    db.prepare("UPDATE users SET status='suspended' WHERE id=?").run(identities.member.id);
    return prepare(sql);
  };
  await rejects(call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'A stale session'}}), 403);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM activity').get().n, 0);
});

test('admin review preserves contributions, has independent review and visibility filters, and audits idempotently', async t => {
  const {call, db, identities} = fixture(t);
  const comment = (await call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: '<em>Remembered event</em>'}})).body;
  const annotation = (await call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: box})).body;
  for (const [table, item] of [['comments', comment], ['annotations', annotation]]) {
    const path = `/api/admin/${table}/${item.id}`;
    const queue = await call(`/api/admin/${table}`, {as: 'admin'});
    assert.match(queue.headers.get('cache-control'), /no-store/);
    assert.equal(queue.body[table][0].email, 'member@example.test');
    assert.equal(queue.body[table][0].photo.imageBase, 'https://cdn.example.test/1');
    assert.equal(queue.body[table][0].reviewedAt, null);
    for (const action of ['review', 'hide', 'restore']) {
      for (let i = 0; i < 2; i++) await call(path, {method: 'PATCH', as: 'admin', body: {action}});
      assert.equal((await call(`/api/admin/${table}?filter=unreviewed`, {as: 'admin'})).body[table].length, 0);
      const visible = (await call(`/api/admin/${table}?filter=visible`, {as: 'admin'})).body[table];
      const hidden = (await call(`/api/admin/${table}?filter=hidden`, {as: 'admin'})).body[table];
      assert.equal(visible.length, action === 'hide' ? 0 : 1);
      assert.equal(hidden.length, action === 'hide' ? 1 : 0);
      assert.equal((await call('/api/photos/1/community')).body[table].length, action === 'hide' ? 0 : 1);
    }
    const stored = db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(item.id);
    assert.equal(stored.hidden_at, null);
    assert.equal(stored.hidden_by, null);
    assert.equal(stored.reviewed_by, identities.admin.id);
    assert.ok(stored.reviewed_at > 0);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM moderation_activity').get().n, 6);
  const activity = (await call('/api/admin/activity', {as: 'admin'})).body.activity;
  assert.ok(activity.some(row => row.action === 'comment.restored'));
  assert.ok(activity.some(row => row.action === 'annotation.reviewed'));
  assert.ok(!JSON.stringify(activity).includes('Remembered event'));
  assert.ok(!JSON.stringify(activity).includes('@example.test'));
});

test('moderation is admin-only, paginated, validates IDs and filters, and supports unpublished photographs', async t => {
  const {call, db, archive, identities} = fixture(t);
  for (const table of ['comments', 'annotations']) {
    for (const as of [null, 'member', 'storedAdmin']) {
      await rejects(call(`/api/admin/${table}`, {as}), as === null ? 401 : 403);
      await rejects(call(`/api/admin/${table}/${randomUUID()}`, {method: 'PATCH', as, body: {action: 'hide'}}), as === null ? 401 : 403);
    }
    for (const bad of ['bad', 'x'.repeat(36), '-'.repeat(36), "%27OR%201=1--"]) {
      await rejects(call(`/api/admin/${table}/${bad}`, {method: 'PATCH', as: 'admin', body: {action: 'hide'}}), 400);
    }
    await rejects(call(`/api/admin/${table}?filter=invalid`, {as: 'admin'}), 400);
    await rejects(call(`/api/admin/${table}?page=1001`, {as: 'admin'}), 400);
    await rejects(call(`/api/admin/${table}/${randomUUID()}`, {method: 'PATCH', as: 'admin', body: {action: 'restore'}}), 404);
  }
  const ids = [];
  for (let i = 0; i < 53; i++) {
    const id = randomUUID(); ids.push(id);
    db.prepare('INSERT INTO comments(id,photo_id,user_id,body,created_at) VALUES(?,?,?,?,?)').run(id, 1, identities.member.id, `Comment ${i}`, 1);
  }
  const first = (await call('/api/admin/comments', {as: 'admin'})).body;
  const second = (await call('/api/admin/comments?page=2', {as: 'admin'})).body;
  assert.equal(first.comments.length, 50);
  assert.equal(second.comments.length, 3);
  assert.equal(first.hasMore, true);
  assert.equal(second.hasMore, false);
  assert.deepEqual([...first.comments, ...second.comments].map(item => item.id).sort(), ids.sort());
  const path = `/api/admin/comments/${ids[0]}`;
  for (const action of ['delete', ['hide'], {action: 'hide'}, 1, null]) {
    await rejects(call(path, {method: 'PATCH', as: 'admin', body: {action}}), 400);
  }
  await rejects(call(path, {method: 'PATCH', as: 'admin', body: {action: 'hide'}, requestOrigin: 'https://evil.test'}), 403);
  archive.prepare('DELETE FROM photos WHERE id=1').run();
  assert.equal((await call('/api/admin/comments', {as: 'admin'})).body.comments[0].photo, null);
  assert.equal((await call(path, {method: 'PATCH', as: 'admin', body: {action: 'hide'}})).status, 200, 'orphaned contributions can still be moderated');
});

test('permission and moderation audit failures roll back decisions, and moderation quotas are enforced', async t => {
  const {call, db, identities} = fixture(t);
  const comment = (await call('/api/photos/1/comments', {method: 'POST', as: 'member', body: {body: 'Keep visible'}})).body;
  db.exec(`CREATE TRIGGER reject_moderation_audit BEFORE INSERT ON moderation_activity
    BEGIN SELECT RAISE(ABORT, 'simulated moderation audit failure'); END`);
  await assert.rejects(call(`/api/admin/comments/${comment.id}`, {method: 'PATCH', as: 'admin', body: {action: 'hide'}}), /audit failure/);
  assert.equal(db.prepare('SELECT hidden_at FROM comments').get().hidden_at, null);
  await assert.rejects(call(`/api/admin/users/${identities.other.id}`, {method: 'PATCH', as: 'admin', body: {annotationStatus: 'approved'}}), /audit failure/);
  assert.equal(db.prepare('SELECT annotation_status FROM users WHERE id=?').get(identities.other.id).annotation_status, 'pending');
  db.exec('DROP TRIGGER reject_moderation_audit');
  db.prepare('UPDATE rate_limits SET count=60,expires_at=? WHERE key=?').run(Math.floor(Date.now() / 1000) + 60, `community:user:${identities.admin.id}`);
  await rejects(call(`/api/admin/comments/${comment.id}`, {method: 'PATCH', as: 'admin', body: {action: 'hide'}}), 429);
  assert.equal(db.prepare('SELECT hidden_at FROM comments').get().hidden_at, null);
});

test('reviewing, hiding and restoring annotations updates search terms through existing triggers', async t => {
  const {call, db} = fixture(t);
  db.exec(`INSERT INTO search_photos(id,collection_id,title,description,date,year,location,tags,image_base)
    VALUES(1,'one','A photograph','','1980','1980','','[]','https://cdn.example.test/1')`);
  const annotation = (await call('/api/photos/1/annotations', {method: 'POST', as: 'member', body: {...box, name: 'Findableperson'}})).body;
  const found = () => db.prepare("SELECT rowid FROM search_photos_fts WHERE search_photos_fts MATCH 'Findableperson'").all().length;
  assert.equal(found(), 1);
  for (const [action, expected] of [['review', 1], ['hide', 0], ['restore', 1]]) {
    await call(`/api/admin/annotations/${annotation.id}`, {method: 'PATCH', as: 'admin', body: {action}});
    assert.equal(found(), expected);
  }
});

test('the additive moderation migration keeps historical accounts, contributions, settings and search unchanged', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of ['0001_accounts.sql', '0002_community.sql', '0003_homepage.sql', '0004_search.sql']) {
    db.exec(readFileSync(new URL(`../community-migrations/${file}`, import.meta.url), 'utf8'));
  }
  db.exec(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
    VALUES('old-member','old@example.test','Old member','member','active',1,1,1);
    INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES('session','old-member',1,9999999999);
    INSERT INTO comments(id,photo_id,user_id,body,created_at) VALUES('old-comment',1,'old-member','Historical comment',1);
    INSERT INTO annotations(id,photo_id,user_id,name,x,y,width,height,created_at) VALUES('old-name',1,'old-member','Historicalperson',0,0,1,1,1);
    INSERT INTO likes(id,photo_id,user_id,created_at) VALUES('old-like',1,'old-member',1);
    INSERT INTO collection_heroes VALUES('one',1,'old-member',1);
    INSERT INTO search_photos(id,collection_id,title,description,date,year,location,tags,image_base,annotation_text)
      VALUES(1,'one','Archive','','1980','1980','','[]','https://cdn.example.test/1','Historicalperson');`);
  const tables = ['users', 'sessions', 'comments', 'annotations', 'likes', 'collection_heroes', 'search_photos'];
  const before = new Map(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()]));
  db.exec(readFileSync(new URL('../community-migrations/0005_moderation.sql', import.meta.url), 'utf8'));
  for (const table of tables) {
    const columns = Object.keys(before.get(table)[0]);
    assert.deepEqual(db.prepare(`SELECT ${columns.join(',')} FROM ${table}`).all(), before.get(table), table);
  }
  assert.equal(db.prepare('SELECT annotation_status FROM users').get().annotation_status, 'pending');
  assert.equal(db.prepare('SELECT reviewed_at FROM comments').get().reviewed_at, null);
  assert.equal(db.prepare("SELECT rowid FROM search_photos_fts WHERE search_photos_fts MATCH 'Historicalperson'").all().length, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
