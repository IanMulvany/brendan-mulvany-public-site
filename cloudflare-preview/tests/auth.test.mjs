import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {test} from 'node:test';

registerHooks({resolve(specifier, context, nextResolve) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) return nextResolve(specifier + '.ts', context);
  return nextResolve(specifier, context);
}});
const {cleanupAuth, getUser, handleAuth, requireAdmin, requireUser} = await import('../src/auth.ts');
const {assertOrigin, HttpError, rateLimit, readJson} = await import('../src/http.ts');
const migration = readFileSync(new URL('../community-migrations/0001_accounts.sql', import.meta.url), 'utf8');

function harness() {
  const sql = new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(migration);
  const messages = [];
  const sessions = [];
  let failSend = false;
  let failAfterFirstBatchStatement = false;
  function result(statement) {
    const rows = sql.prepare(statement.sql).all(...statement.args);
    return {results: rows, success: true, meta: {changes: sql.prepare('SELECT changes() AS changes').get().changes, duration: 0}};
  }
  function prepare(query) {
    const statement = {
      sql: query, args: [],
      bind(...args) { return Object.assign(Object.create(this), {args}); },
      async first(column) { const row = result(this).results[0] || null; return column && row ? row[column] : row; },
      async run() { return result(this); },
      async all() { return result(this); },
    };
    return statement;
  }
  const binding = {
    prepare,
    async batch(statements) {
      sql.exec('BEGIN IMMEDIATE');
      try {
        const values = statements.map((statement, index) => {
          const value = result(statement);
          if (index === 0 && failAfterFirstBatchStatement) throw new Error('Injected transaction failure');
          return value;
        });
        sql.exec('COMMIT');
        return values;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    },
    withSession(constraint) { sessions.push(constraint); return binding; },
  };
  const env = {
    COMMUNITY: binding, PUBLIC_ORIGIN: 'https://archive.example.test', ADMIN_EMAIL: 'ian@mulvany.net',
    AUTH_SECRET: 'unit-test-secret-only-never-a-production-secret', EMAIL_FROM: 'noreply@example.test',
    EMAIL: {async send(message) {
      if (failSend) throw new Error('Injected email delivery failure');
      messages.push(message);
      return {messageId: 'test-delivery'};
    }},
  };
  function request(path, body, options = {}) {
    const headers = new Headers({'origin': env.PUBLIC_ORIGIN, 'cf-connecting-ip': '192.0.2.10', 'content-type': 'application/json', ...options.headers});
    if (options.cookie) headers.set('cookie', options.cookie);
    const method = options.method || (body === undefined ? 'GET' : 'POST');
    return new Request(env.PUBLIC_ORIGIN + path, {method, headers, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
  }
  const call = (path, body, options) => handleAuth(request(path, body, options), env);
  function expireResend() { sql.exec("UPDATE rate_limits SET expires_at=0 WHERE key LIKE 'email:resend:%'"); }
  async function challenge(email = 'member@example.test', options = {}) {
    const newsletter = options.newsletter;
    const prefix = newsletter ? '/api/newsletter' : '/api/auth';
    const response = await call(prefix + '/request', {email, displayName: options.displayName || 'Archive reader', ...(newsletter ? {consent: true} : {}), ...options.body});
    assert.equal(response.status, 200);
    const payload = await response.json();
    const sent = messages.at(-1);
    const code = sent.text.match(/\b\d{8}\b/)[0];
    return {...payload, code, prefix};
  }
  async function login(email, displayName) {
    const entry = await challenge(email, {displayName});
    const response = await call('/api/auth/verify', {challengeId: entry.challengeId, code: entry.code});
    assert.equal(response.status, 200);
    return {user: (await response.json()).user, cookie: response.headers.get('set-cookie').split(';')[0], setCookie: response.headers.get('set-cookie')};
  }
  return {sql, env, messages, sessions, request, call, challenge, login, expireResend,
    setFailSend(value) { failSend = value; },
    setFailBatch(value) { failAfterFirstBatchStatement = value; }};
}

test('verified email creates one account with a hashed secure session and no newsletter consent', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const entry = await h.challenge('Alice@Example.Test', {displayName: 'Alice', body: {role: 'admin'}});
  assert.deepEqual(Object.keys(entry).sort(), ['challengeId', 'code', 'message', 'prefix']);
  const stored = h.sql.prepare('SELECT * FROM auth_challenges').get();
  assert.match(stored.code_hash, /^[a-f0-9]{64}$/);
  assert.notEqual(stored.code_hash, entry.code);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM users').get().n, 0);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM newsletter_subscribers').get().n, 0);
  const response = await h.call('/api/auth/verify', {challengeId: entry.challengeId, code: entry.code});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const {user} = await response.json();
  assert.equal(user.email, 'alice@example.test');
  assert.equal(user.displayName, 'Alice');
  assert.equal(user.role, 'member');
  const cookie = response.headers.get('set-cookie');
  for (const flag of ['__Host-bm_session=', 'Path=/', 'Secure', 'HttpOnly', 'SameSite=Lax', 'Max-Age=2592000']) assert.ok(cookie.includes(flag));
  assert.ok(!cookie.includes('Domain='));
  const token = cookie.split(';')[0].split('=')[1];
  const session = h.sql.prepare('SELECT * FROM sessions').get();
  assert.equal(session.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(session.token_hash, token);
  assert.equal(session.expires_at - session.created_at, 30 * 24 * 60 * 60);
  assert.deepEqual(await getUser(h.request('/api/auth/me', undefined, {cookie: cookie.split(';')[0]}), h.env), user);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM newsletter_subscribers').get().n, 0);
  assert.ok(h.sessions.every(constraint => constraint === 'first-primary'));
});

test('concurrent code replay creates at most one session and exhausted attempts cannot succeed', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const entry = await h.challenge();
  const replies = await Promise.all(Array.from({length: 5}, () => h.call('/api/auth/verify', {challengeId: entry.challengeId, code: entry.code})));
  assert.equal(replies.filter(response => response.status === 200).length, 1);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM sessions').get().n, 1);
  assert.equal((await h.call('/api/auth/verify', {challengeId: entry.challengeId, code: entry.code})).status, 400);
  const next = await h.challenge('second@example.test');
  const incorrect = next.code === '00000000' ? '11111111' : '00000000';
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.equal((await h.call('/api/auth/verify', {challengeId: next.challengeId, code: incorrect})).status, 400);
  }
  assert.equal(h.sql.prepare('SELECT attempts FROM auth_challenges WHERE id=?').get(next.challengeId).attempts, 5);
  assert.equal((await h.call('/api/auth/verify', {challengeId: next.challengeId, code: next.code})).status, 400);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM users').get().n, 1);
});

test('expired and superseded codes fail, and failed transactions do not consume a valid code', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const old = await h.challenge();
  h.expireResend();
  const fresh = await h.challenge();
  assert.equal((await h.call('/api/auth/verify', {challengeId: old.challengeId, code: old.code})).status, 400);
  h.sql.prepare('UPDATE auth_challenges SET expires_at=0 WHERE id=?').run(fresh.challengeId);
  assert.equal((await h.call('/api/auth/verify', {challengeId: fresh.challengeId, code: fresh.code})).status, 400);
  const retriable = await h.challenge('retry@example.test');
  h.setFailBatch(true);
  assert.equal((await h.call('/api/auth/verify', {challengeId: retriable.challengeId, code: retriable.code})).status, 503);
  assert.equal(h.sql.prepare('SELECT consumed_at FROM auth_challenges WHERE id=?').get(retriable.challengeId).consumed_at, null);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM users').get().n, 0);
  h.setFailBatch(false);
  assert.equal((await h.call('/api/auth/verify', {challengeId: retriable.challengeId, code: retriable.code})).status, 200);
});

test('sign-in cannot overwrite profiles or grant admin from request/database role values', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const first = await h.login('member@example.test', 'Original name');
  h.expireResend();
  const second = await h.login('member@example.test', 'Unwanted replacement');
  assert.equal(second.user.id, first.user.id);
  assert.equal(second.user.displayName, 'Original name');
  h.sql.prepare("UPDATE users SET role='admin' WHERE id=?").run(first.user.id);
  const request = h.request('/api/auth/me', undefined, {cookie: first.cookie});
  assert.equal((await getUser(request, h.env)).role, 'member');
  await assert.rejects(() => requireAdmin(request, h.env), error => error instanceof HttpError && error.status === 403);
  const admin = await h.login('IAN@MULVANY.NET', 'Ian');
  assert.equal(admin.user.role, 'admin');
  assert.equal((await requireAdmin(h.request('/api/auth/me', undefined, {cookie: admin.cookie}), h.env)).id, admin.user.id);
  assert.equal((await getUser(h.request('/api/auth/me', undefined, {cookie: admin.cookie}), {...h.env, ADMIN_EMAIL: 'another@example.test'})).role, 'member');
});

test('logout, expiry, missing verification and suspension revoke access on primary reads', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const session = await h.login();
  const request = h.request('/api/auth/me', undefined, {cookie: session.cookie});
  h.sql.prepare("UPDATE users SET status='suspended' WHERE id=?").run(session.user.id);
  assert.equal(await getUser(request, h.env), null);
  h.expireResend();
  const blocked = await h.challenge();
  assert.equal((await h.call('/api/auth/verify', {challengeId: blocked.challengeId, code: blocked.code})).status, 400);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM sessions').get().n, 1);
  h.sql.prepare("UPDATE users SET status='active',verified_at=NULL WHERE id=?").run(session.user.id);
  assert.equal(await getUser(request, h.env), null);
  h.sql.prepare('UPDATE users SET verified_at=1 WHERE id=?').run(session.user.id);
  h.sql.exec('UPDATE sessions SET expires_at=0');
  assert.equal(await getUser(request, h.env), null);
  h.sql.exec('UPDATE sessions SET expires_at=9999999999');
  const response = await h.call('/api/auth/logout', {}, {cookie: session.cookie});
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(await getUser(request, h.env), null);
  await assert.rejects(() => requireUser(request, h.env), error => error.status === 401);
  assert.equal(await getUser(h.request('/api/auth/me', undefined, {cookie: session.cookie + '; ' + session.cookie}), h.env), null);
});

test('newsletter double opt-in is separate from account creation and cannot consume an auth code', async t => {
  const h = harness(); t.after(() => h.sql.close());
  assert.equal((await h.call('/api/newsletter/request', {email: 'news@example.test', consent: false})).status, 400);
  assert.equal(h.messages.length, 0);
  const newsletter = await h.challenge('news@example.test', {newsletter: true});
  assert.equal(h.sql.prepare('SELECT status FROM newsletter_subscribers').get().status, 'pending');
  assert.equal((await h.call('/api/auth/verify', {challengeId: newsletter.challengeId, code: newsletter.code})).status, 400);
  const response = await h.call('/api/newsletter/verify', {challengeId: newsletter.challengeId, code: newsletter.code});
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  const subscriber = h.sql.prepare('SELECT * FROM newsletter_subscribers').get();
  assert.equal(subscriber.status, 'confirmed');
  assert.ok(subscriber.consent_at > 0 && subscriber.confirmed_at > 0);
  assert.equal(subscriber.provider_sync_status, 'not_connected');
  assert.equal(h.sql.prepare('SELECT count(*) n FROM users').get().n, 0);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM sessions').get().n, 0);
  assert.equal((await h.call('/api/newsletter/verify', {challengeId: newsletter.challengeId, code: newsletter.code})).status, 400);
  const login = await h.challenge('auth-only@example.test');
  assert.equal((await h.call('/api/newsletter/verify', {challengeId: login.challengeId, code: login.code})).status, 400);
  assert.equal((await h.call('/api/auth/verify', {challengeId: login.challengeId, code: login.code})).status, 200);
});

test('verified members still need explicit newsletter consent and unsubscribe cancels pending confirmations', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const member = await h.login();
  const options = {cookie: member.cookie};
  let state = await h.call('/api/newsletter/status', undefined, options);
  assert.equal((await state.json()).status, 'not_subscribed');
  assert.equal((await h.call('/api/newsletter/subscribe', {}, options)).status, 400);
  assert.equal((await h.call('/api/newsletter/subscribe', {consent: true}, options)).status, 200);
  const pending = await h.challenge('member@example.test', {newsletter: true});
  assert.equal((await h.call('/api/newsletter/unsubscribe', {}, options)).status, 200);
  assert.equal((await h.call('/api/newsletter/verify', {challengeId: pending.challengeId, code: pending.code})).status, 400);
  state = await h.call('/api/newsletter/status', undefined, options);
  assert.equal((await state.json()).status, 'unsubscribed');
  assert.ok(h.sql.prepare('SELECT unsubscribed_at FROM newsletter_subscribers').get().unsubscribed_at > 0);
  assert.equal((await h.call('/api/newsletter/subscribe', {consent: true})).status, 401);
});

test('request codes have generic responses, atomic rate limits and a sixty-second resend cooldown', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const first = await h.challenge();
  const response = await h.call('/api/auth/request', {email: 'member@example.test'});
  assert.equal(response.status, 429);
  assert.equal(h.messages.length, 1);
  const other = await h.challenge('other@example.test');
  assert.equal(other.message, first.message);
  const results = await Promise.allSettled(Array.from({length: 12}, () => rateLimit(h.env, 'parallel:test', 3, 60)));
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 3);
  assert.ok(results.filter(item => item.status === 'rejected').every(item => item.reason.status === 429));
  h.sql.prepare('UPDATE rate_limits SET expires_at=0 WHERE key=?').run('parallel:test');
  await rateLimit(h.env, 'parallel:test', 3, 60);
  assert.equal(h.sql.prepare('SELECT count FROM rate_limits WHERE key=?').get('parallel:test').count, 1);
});

test('email delivery failure never returns a code or leaves a usable challenge', async t => {
  const h = harness(); t.after(() => h.sql.close());
  h.setFailSend(true);
  const response = await h.call('/api/auth/request', {email: 'failure@example.test'});
  assert.equal(response.status, 503);
  assert.deepEqual(Object.keys(await response.json()), ['error']);
  assert.equal(h.messages.length, 0);
  const challenge = h.sql.prepare('SELECT * FROM auth_challenges').get();
  assert.ok(challenge.consumed_at > 0);
  assert.equal(challenge.delivered_at, null);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM users').get().n, 0);
});

test('origin checks and bounded JSON reject cross-site or malformed mutations without storing data', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const body = {email: 'blocked@example.test'};
  assert.equal((await h.call('/api/auth/request', body, {headers: {origin: 'https://evil.example'}})).status, 403);
  const noOrigin = h.request('/api/auth/request', body); noOrigin.headers.delete('origin');
  assert.equal((await handleAuth(noOrigin, h.env)).status, 403);
  assert.throws(() => assertOrigin(new Request('https://other.example/api/auth/request', {method: 'POST', headers: {origin: h.env.PUBLIC_ORIGIN}}), h.env), error => error.status === 403);
  assert.equal((await h.call('/api/auth/request', body, {headers: {'content-type': 'text/plain'}})).status, 415);
  assert.equal((await h.call('/api/auth/request', {...body, extra: 'x'.repeat(9000)})).status, 413);
  for (const raw of ['[]', 'null', '{invalid']) {
    await assert.rejects(() => readJson(new Request(h.env.PUBLIC_ORIGIN, {method: 'POST', headers: {'content-type': 'application/json'}, body: raw})), error => error.status === 400);
  }
  assert.equal(h.sql.prepare('SELECT count(*) n FROM auth_challenges').get().n, 0);
  assert.equal(h.messages.length, 0);
});

test('profile changes only the authenticated display name and cleanup retains users and consent', async t => {
  const h = harness(); t.after(() => h.sql.close());
  const member = await h.login();
  const response = await h.call('/api/auth/profile', {displayName: 'New name', role: 'admin', email: 'ian@mulvany.net'}, {method: 'PATCH', cookie: member.cookie});
  assert.equal(response.status, 200);
  const user = (await response.json()).user;
  assert.equal(user.displayName, 'New name');
  assert.equal(user.email, member.user.email);
  assert.equal(user.role, 'member');
  assert.equal((await h.call('/api/auth/profile', {displayName: 'x'.repeat(81)}, {method: 'PATCH', cookie: member.cookie})).status, 400);
  await h.call('/api/newsletter/subscribe', {consent: true}, {cookie: member.cookie});
  h.sql.exec('UPDATE sessions SET expires_at=0; UPDATE auth_challenges SET expires_at=0; UPDATE rate_limits SET expires_at=0;');
  await cleanupAuth(h.env);
  for (const table of ['sessions', 'auth_challenges', 'rate_limits']) assert.equal(h.sql.prepare(`SELECT count(*) n FROM ${table}`).get().n, 0);
  assert.equal(h.sql.prepare('SELECT count(*) n FROM users').get().n, 1);
  assert.equal(h.sql.prepare('SELECT status FROM newsletter_subscribers').get().status, 'confirmed');
});
