import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';

registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith('.ts')) {
    return nextResolve(`${specifier}.ts`, context);
  }
  return nextResolve(specifier, context);
} });
const { readJson, assertOrigin } = await import('../src/http.ts');
const { handleCommunity } = await import('../src/community.ts');
const { el } = await import('../static/ui.js');
const { reviewRow } = await import('../static/moderation.js');
const origin = 'https://archive.test';
const rejects = (promise, status) => assert.rejects(promise, error => error.status === status);

class Statement {
  constructor(db, sql, values = []) { this.db = db; this.sql = sql; this.values = values; }
  bind(...values) { return new Statement(this.db, this.sql, values); }
  first(column) {
    const row = this.db.prepare(this.sql).get(...this.values);
    return Promise.resolve(row ? (column ? row[column] : { ...row }) : null);
  }
  execute() {
    const results = this.db.prepare(this.sql).all(...this.values).map(row => ({ ...row }));
    return { results, success: true, meta: { changes: this.db.prepare('SELECT changes() AS n').get().n } };
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

function fixture(t) {
  const archive = new D1(), community = new D1();
  archive.sqlite.exec(readFileSync(new URL('../migrations/0001_search.sql', import.meta.url), 'utf8'));
  const directory = new URL('../community-migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    community.sqlite.exec(readFileSync(new URL(file, directory), 'utf8'));
  }
  archive.sqlite.exec(`INSERT INTO photos VALUES(1,'roll','Published photograph','','1980','1980','','[]','https://cdn.example.test/1',1200,800)`);
  archive.sqlite.exec(`INSERT INTO photos VALUES(2,'roll','Another photograph','','1980','1980','','[]','https://cdn.example.test/2',1200,800)`);
  const identities = {};
  const at = Math.floor(Date.now() / 1000);
  for (const name of ['member', 'other', 'admin']) {
    const id = randomUUID(), token = randomBytes(32).toString('hex');
    community.sqlite.prepare(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
      VALUES(?,?,?,?,'active',?,?,?)`).run(id, `${name}@example.test`, name, name === 'admin' ? 'admin' : 'member', at, at, at);
    community.sqlite.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)')
      .run(createHash('sha256').update(token).digest('hex'), id, at, at + 3600);
    identities[name] = { id, token };
  }
  const env = { DB: archive, COMMUNITY: community, PUBLIC_ORIGIN: origin, ADMIN_EMAIL: 'admin@example.test' };
  const call = async (path, { method = 'GET', as, body, headers = {} } = {}) => {
    const request = new Request(origin + path, {
      method, headers: { origin, ...(as ? { cookie: `__Host-bm_session=${identities[as].token}` } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const response = await handleCommunity(request, env);
    assert.ok(response);
    return { response, data: await response.json() };
  };
  t.after(() => { archive.sqlite.close(); community.sqlite.close(); });
  return { call, db: community.sqlite, identities };
}

test('comment JSON enforces a byte cap even with absent or dishonest Content-Length', async () => {
  for (const declared of [null, '1']) {
    let cancelled = false;
    const body = new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"body":"' + 'é'.repeat(4096))); },
      cancel() { cancelled = true; },
    });
    const request = new Request(origin, { method: 'POST', duplex: 'half', body, headers: {
      'content-type': 'application/json', ...(declared ? { 'content-length': declared } : {}),
    } });
    await rejects(readJson(request), 413);
    assert.equal(cancelled, true, 'stop reading an oversized stream immediately');
  }
  const tooLarge = new Request(origin, { method: 'POST', headers: {
    'content-type': 'application/json', 'content-length': '8193',
  }, body: '{}' });
  await rejects(readJson(tooLarge), 413);
});

test('comment JSON rejects form content, invalid UTF-8 and non-object payloads', async () => {
  for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data']) {
    await rejects(readJson(new Request(origin, { method: 'POST', headers: { 'content-type': contentType }, body: '{"body":"hello"}' })), 415);
  }
  for (const body of ['null', '[]', '"hello"', '{broken', new Uint8Array([0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d])]) {
    await rejects(readJson(new Request(origin, { method: 'POST', headers: { 'content-type': 'application/json' }, body })), 400);
  }
  assert.deepEqual(await readJson(new Request(origin, { method: 'POST', headers: {
    'content-type': 'Application/JSON; charset=utf-8',
  }, body: '{"body":"A memory\n"}'.replace('\n', '\\n') })), { body: 'A memory\n' });
});

test('write origin checks reject missing, opaque, sibling-site and misleading origins', () => {
  for (const requestOrigin of [null, 'null', 'https://evil.test', 'https://archive.test.evil.test', 'https://sub.archive.test', 'http://archive.test']) {
    const request = new Request(origin + '/api/photos/1/comments', { method: 'POST', headers: requestOrigin ? { origin: requestOrigin } : {} });
    assert.throws(() => assertOrigin(request, { PUBLIC_ORIGIN: origin }), error => error.status === 403);
  }
  for (const site of ['cross-site', 'same-site']) {
    assert.throws(() => assertOrigin(new Request(origin, { method: 'POST', headers: { origin, 'sec-fetch-site': site } }), { PUBLIC_ORIGIN: origin }), error => error.status === 403);
  }
  assert.throws(() => assertOrigin(new Request('https://other.test/', { method: 'POST', headers: { origin } }), { PUBLIC_ORIGIN: origin }), error => error.status === 403);
  assert.doesNotThrow(() => assertOrigin(new Request(origin, { method: 'POST', headers: { origin, 'sec-fetch-site': 'same-origin' } }), { PUBLIC_ORIGIN: origin }));
});

test('malicious comment payloads stay literal text through real SQL storage and public/admin reads', async t => {
  const { call, db } = fixture(t);
  const payloads = [
    '<img src=x onerror=alert(document.cookie)> <script>alert(1)</script>',
    '<svg onload=alert(1)><a href="javascript:alert(1)">name</a></svg>',
    "'); DROP TABLE users; --",
    '[open](javascript:alert(1)) https://attacker.example/track?email=private',
    'A memory of Seán and عائلة — 1980.\nAnother line.\tA detail.',
  ];
  for (const body of payloads) {
    const result = await call('/api/photos/1/comments', { method: 'POST', as: 'member', body: { body, userId: 'admin', hiddenAt: 1, reviewedAt: 1 } });
    assert.equal(result.response.status, 201);
    assert.equal(result.data.body, body);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 3);
  const publicRead = await call('/api/photos/1/community');
  assert.deepEqual(new Set(publicRead.data.comments.map(row => row.body)), new Set(payloads));
  assert.match(publicRead.response.headers.get('content-type'), /application\/json/);
  assert.equal(publicRead.response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(publicRead.response.headers.get('cache-control'), /private.*no-store/);
  assert.equal(publicRead.response.headers.get('access-control-allow-origin'), null);
  assert.ok(!JSON.stringify(publicRead.data).includes('@example.test'));
  const adminRead = await call('/api/admin/comments?filter=unreviewed', { as: 'admin' });
  assert.deepEqual(new Set(adminRead.data.comments.map(row => row.body)), new Set(payloads));
  assert.match(adminRead.response.headers.get('cache-control'), /private.*no-store/);
  for (const as of [undefined, 'member']) await rejects(call('/api/admin/comments', { as }), as ? 403 : 401);
});

test('shared renderer and actual admin review cards never treat submitted markup or links as HTML', t => {
  const original = globalThis.document;
  const created = [];
  globalThis.document = { createElement(tagName) {
    const node = { tagName, textContent: '', children: [], dataset: {},
      append(...children) { this.children.push(...children); }, addEventListener() {},
      set innerHTML(_value) { throw new Error('Unsafe HTML sink'); }, set outerHTML(_value) { throw new Error('Unsafe HTML sink'); },
    };
    created.push(node); return node;
  } };
  t.after(() => { if (original === undefined) delete globalThis.document; else globalThis.document = original; });
  const payload = '<svg onload=alert(1)><a href="javascript:alert(1)">Click</a></svg>';
  const node = el('p', 'community-item__body', payload);
  assert.equal(node.textContent, payload);
  assert.equal(created.length, 1, 'only a paragraph is created, no image, script or link');
  for (const kind of ['comments', 'annotations']) {
    const item = { id: randomUUID(), photoId: 1, photo: null, createdAt: 1, displayName: payload,
      email: 'member@example.test', body: payload, name: payload, note: payload };
    reviewRow(item, kind, () => {});
  }
  assert.ok(created.filter(item => item.textContent === payload).length >= 4);
  assert.ok(!created.some(item => ['script', 'svg', 'iframe', 'img'].includes(item.tagName)));
  for (const link of created.filter(item => item.tagName === 'a')) assert.match(link.href, /^\/image\/1\/#(?:comment|annotation)-/);
});

test('comment input rejects invisible control and bidi override characters without excluding natural-language text', async t => {
  const { call, db } = fixture(t);
  for (const control of ['\u0000', '\u0001', '\u0008', '\u000b', '\u001b', '\u007f', '\u0085', '\u202e', '\u2066']) {
    await rejects(call('/api/photos/1/comments', { method: 'POST', as: 'member', body: { body: `before${control}after` } }), 400);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 0);
  assert.equal((await call('/api/photos/1/comments', { method: 'POST', as: 'member', body: { body: 'Seán\nعائلة\t1980' } })).response.status, 201);
});

test('comment flood limits cannot be avoided by alternating photographs or concurrent requests', async t => {
  const { call, db } = fixture(t);
  const responses = await Promise.allSettled(Array.from({ length: 9 }, (_, index) => call(`/api/photos/${index % 2 + 1}/comments`, {
    method: 'POST', as: 'member', body: { body: `Attempt ${index}` },
  })));
  assert.equal(responses.filter(item => item.status === 'fulfilled').length, 5);
  assert.ok(responses.filter(item => item.status === 'rejected').every(item => item.reason.status === 429));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 5);
  // The independent member account is not locked out by another person's quota.
  assert.equal((await call('/api/photos/1/comments', { method: 'POST', as: 'other', body: { body: 'An independent member' } })).response.status, 201);
});

test('hourly comment quota still applies after the minute quota expires', async t => {
  const { call, db, identities } = fixture(t);
  for (let index = 0; index < 30; index++) {
    if (index % 5 === 0) db.prepare('UPDATE rate_limits SET expires_at=0 WHERE key=?').run(`community:comments:minute:${identities.member.id}`);
    assert.equal((await call('/api/photos/1/comments', { method: 'POST', as: 'member', body: { body: `Memory ${index}` } })).response.status, 201);
  }
  db.prepare('UPDATE rate_limits SET expires_at=0 WHERE key=?').run(`community:comments:minute:${identities.member.id}`);
  await rejects(call('/api/photos/1/comments', { method: 'POST', as: 'member', body: { body: 'Over the hourly quota' } }), 429);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM comments').get().n, 30);
});

test('moderation is admin-only and hidden comment text cannot leak through public reads', async t => {
  const { call, db, identities } = fixture(t);
  const comment = (await call('/api/photos/1/comments', { method: 'POST', as: 'member', body: { body: 'Private after moderation' } })).data;
  for (const as of [undefined, 'member', 'other']) {
    await rejects(call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', as, body: { action: 'hide' } }), as ? 403 : 401);
  }
  for (const action of [['hide'], ['restore'], { action: 'hide' }, 1, null]) {
    await rejects(call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', as: 'admin', body: { action } }), 400);
  }
  await rejects(call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', as: 'admin', body: { action: 'hide' }, headers: { origin: 'https://evil.test' } }), 403);
  await rejects(call(`/api/comments/${comment.id}`, { method: 'DELETE', as: 'other' }), 403);
  await call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', as: 'admin', body: { action: 'hide' } });
  assert.equal(db.prepare('SELECT hidden_by FROM comments WHERE id=?').get(comment.id).hidden_by, identities.admin.id);
  for (const as of [undefined, 'member', 'other', 'admin']) {
    const result = await call('/api/photos/1/community', { as });
    assert.ok(!JSON.stringify(result.data).includes(comment.body));
    assert.equal(result.data.comments.length, 0);
  }
  const hidden = (await call('/api/admin/comments?filter=hidden', { as: 'admin' })).data.comments;
  assert.equal(hidden[0].body, comment.body);
  await call(`/api/admin/comments/${comment.id}`, { method: 'PATCH', as: 'admin', body: { action: 'restore' } });
  assert.equal((await call('/api/photos/1/community')).data.comments[0].body, comment.body);
});
