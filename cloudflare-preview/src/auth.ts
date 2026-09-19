import {assertOrigin, HttpError, json, rateLimit, readJson} from './http';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  annotationStatus: 'pending' | 'approved' | 'revoked';
  canAnnotate: boolean;
}

interface UserRow { id: string; email: string; display_name: string; annotation_status: AuthUser['annotationStatus']; }
interface ChallengeRow { id: string; email: string; code_hash: string; display_name: string; }
type Purpose = 'auth' | 'newsletter';
const COOKIE = '__Host-bm_session';
const CODE_SECONDS = 15 * 60;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
const nowSeconds = () => Math.floor(Date.now() / 1000);

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function randomCode(): string {
  const words = new Uint32Array(1);
  do { crypto.getRandomValues(words); } while (words[0] >= 4_200_000_000);
  return String(words[0] % 100_000_000).padStart(8, '0');
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (typeof env.AUTH_SECRET !== 'string' || env.AUTH_SECRET.length < 32) {
    throw new HttpError(503, 'Account services are temporarily unavailable.');
  }
  return crypto.subtle.importKey('raw', encoder.encode(env.AUTH_SECRET), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign', 'verify']);
}

function codeContext(purpose: Purpose, challengeId: string, code: string): Uint8Array {
  return encoder.encode(`${purpose}\0${challengeId}\0${code}`);
}

async function codeHash(env: Env, purpose: Purpose, id: string, code: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), codeContext(purpose, id, code)));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function emailAddress(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Enter a valid email address.');
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email)
      || email.split('@')[0].length > 64 || email.startsWith('.') || email.includes('..') || email.includes('.@')) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  return email;
}

function displayName(value: unknown, required = false): string {
  if (value === undefined && !required) return 'Archive member';
  if (typeof value !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)) {
    throw new HttpError(400, 'Enter a display name without control characters.');
  }
  const name = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'Use a display name between 1 and 80 characters.');
  }
  return name;
}

function userResponse(row: UserRow, env: Env): AuthUser {
  const role = row.email.toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase() ? 'admin' : 'member';
  const annotationStatus = role === 'admin' ? 'approved' : row.annotation_status;
  return {id: row.id, email: row.email, displayName: row.display_name, role, annotationStatus,
    canAnnotate: annotationStatus === 'approved'};
}

function cookieToken(request: Request): string | null {
  const matches = (request.headers.get('cookie') || '').split(';').map(part => part.trim())
    .filter(part => part.startsWith(COOKIE + '='));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function sessionCookie(token: string, maxAge = SESSION_SECONDS): string {
  return `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export async function getUser(request: Request, env: Env): Promise<AuthUser | null> {
  const token = cookieToken(request);
  if (!token) return null;
  const row = await env.COMMUNITY.withSession('first-primary').prepare(`
    SELECT u.id, u.email, u.display_name, u.annotation_status FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?
      AND u.status = 'active' AND u.verified_at IS NOT NULL
  `).bind(await sha256(token), nowSeconds()).first<UserRow>();
  return row ? userResponse(row, env) : null;
}

export async function requireUser(request: Request, env: Env): Promise<AuthUser> {
  const user = await getUser(request, env);
  if (!user) throw new HttpError(401, 'Please sign in to continue.');
  return user;
}

export async function requireAdmin(request: Request, env: Env): Promise<AuthUser> {
  const user = await requireUser(request, env);
  if (user.role !== 'admin') throw new HttpError(403, 'Administrator access is required.');
  return user;
}

export async function cleanupAuth(env: Env): Promise<void> {
  const db = env.COMMUNITY.withSession('first-primary');
  const now = nowSeconds();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now),
  ]);
}

async function requestLimits(request: Request, env: Env, email: string, purpose: Purpose): Promise<void> {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const [ipKey, emailKey] = await Promise.all([sha256(ip), sha256(email)]);
  await rateLimit(env, `email:request:ip:${ipKey}`, 10, 3600);
  await rateLimit(env, `email:request:address:${emailKey}`, 5, 3600);
  await rateLimit(env, `email:resend:${purpose}:${emailKey}`, 1, 60);
}

async function requestCode(request: Request, env: Env, purpose: Purpose): Promise<Response> {
  const body = await readJson(request);
  const email = emailAddress(body.email);
  const name = displayName(body.displayName);
  if (purpose === 'newsletter' && body.consent !== true) throw new HttpError(400, 'Please confirm that you want to receive the newsletter.');
  // Check configuration before reserving quotas or storing a challenge.
  await hmacKey(env);
  if (!env.EMAIL || !env.EMAIL_FROM) throw new HttpError(503, 'Email delivery is temporarily unavailable.');
  await requestLimits(request, env, email, purpose);
  const id = randomToken();
  const code = randomCode();
  const now = nowSeconds();
  const db = env.COMMUNITY.withSession('first-primary');
  const statements = [
    db.prepare('UPDATE auth_challenges SET consumed_at = ? WHERE email = ? AND purpose = ? AND consumed_at IS NULL').bind(now, email, purpose),
    db.prepare(`INSERT INTO auth_challenges(id,purpose,email,display_name,code_hash,consent_at,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).bind(id, purpose, email, name, await codeHash(env, purpose, id, code), purpose === 'newsletter' ? now : null, now, now + CODE_SECONDS),
  ];
  if (purpose === 'newsletter') statements.push(db.prepare(`
    INSERT INTO newsletter_subscribers(id,email,display_name,status,consent_at,created_at,updated_at)
    VALUES(?,?,?,'pending',?,?,?) ON CONFLICT(email) DO UPDATE SET
      status = CASE WHEN newsletter_subscribers.status = 'confirmed' THEN 'confirmed' ELSE 'pending' END,
      consent_at = CASE WHEN newsletter_subscribers.status = 'confirmed' THEN newsletter_subscribers.consent_at ELSE excluded.consent_at END,
      updated_at = excluded.updated_at
  `).bind(crypto.randomUUID(), email, name, now, now, now));
  await db.batch(statements);
  const newsletter = purpose === 'newsletter';
  const subject = newsletter ? 'Confirm your Brendan Mulvany archive newsletter subscription' : 'Your Brendan Mulvany archive sign-in code';
  const explanation = newsletter
    ? 'Enter this code on the archive website to confirm your newsletter subscription. This does not create an account.'
    : 'Enter this code on the archive website to sign in or finish creating your account. This does not subscribe you to the newsletter.';
  try {
    await env.EMAIL.send({
      to: email, from: {email: env.EMAIL_FROM, name: 'Brendan Mulvany Photo Archive'}, subject,
      text: `${explanation}\n\n${code}\n\nThis code expires in 15 minutes and can be used once. Never share it. If you did not request this email, you can ignore it.`,
      html: `<p>${explanation}</p><p style="font-size:28px;letter-spacing:5px"><strong>${code}</strong></p><p>This code expires in 15 minutes and can be used once. Never share it. If you did not request this email, you can ignore it.</p>`,
    });
    await db.prepare('UPDATE auth_challenges SET delivered_at = ? WHERE id = ?').bind(nowSeconds(), id).run();
  } catch {
    await db.prepare('UPDATE auth_challenges SET consumed_at = ? WHERE id = ?').bind(nowSeconds(), id).run();
    console.warn(JSON.stringify({event: 'auth_email_delivery_failed'}));
    throw new HttpError(503, 'The email could not be sent. Please try again later.');
  }
  return json({challengeId: id, message: 'If this address can receive email, a verification code is on its way.'});
}

async function verifyCode(request: Request, env: Env, purpose: Purpose): Promise<Response> {
  const body = await readJson(request);
  if (typeof body.challengeId !== 'string' || !/^[a-f0-9]{64}$/.test(body.challengeId)
      || typeof body.code !== 'string' || !/^\d{8}$/.test(body.code)) {
    throw new HttpError(400, 'Enter the eight-digit code from your email.');
  }
  await rateLimit(env, `email:verify:ip:${await sha256(request.headers.get('cf-connecting-ip') || 'unknown')}`, 40, 900);
  const now = nowSeconds();
  const db = env.COMMUNITY.withSession('first-primary');
  const challenge = await db.prepare(`SELECT id,email,code_hash,display_name FROM auth_challenges
    WHERE id = ? AND purpose = ? AND consumed_at IS NULL AND delivered_at IS NOT NULL AND expires_at > ? AND attempts < 5`)
    .bind(body.challengeId, purpose, now).first<ChallengeRow>();
  const invalid = () => new HttpError(400, 'This code is invalid or expired. Please request a new one.');
  if (!challenge) throw invalid();
  const signature = Uint8Array.from(challenge.code_hash.match(/.{2}/g) || [], byte => Number.parseInt(byte, 16));
  const matches = await crypto.subtle.verify('HMAC', await hmacKey(env), signature, codeContext(purpose, challenge.id, body.code));
  const claim = randomToken();
  // Consumption, account/subscriber mutation and session creation share one D1
  // transaction. A unique claim token makes concurrent replay a no-op, even if
  // multiple requests verified the same hash before either obtained the write.
  const consume = db.prepare(`UPDATE auth_challenges SET attempts = attempts + 1,
      consumed_at = CASE WHEN ? = 1 THEN ? ELSE consumed_at END,
      consumed_by = CASE WHEN ? = 1 THEN ? ELSE consumed_by END
    WHERE id = ? AND purpose = ? AND code_hash = ? AND consumed_at IS NULL
      AND delivered_at IS NOT NULL AND expires_at > ? AND attempts < 5`)
    .bind(Number(matches), now, Number(matches), claim, challenge.id, purpose, challenge.code_hash, now);
  if (purpose === 'newsletter') {
    const results = await db.batch<{status: string}>([
      consume,
      db.prepare(`INSERT INTO newsletter_subscribers(id,email,display_name,status,consent_at,confirmed_at,created_at,updated_at)
        SELECT ?,email,display_name,'confirmed',consent_at,?,?,? FROM auth_challenges
        WHERE id = ? AND consumed_by = ? AND consent_at IS NOT NULL
        ON CONFLICT(email) DO UPDATE SET status='confirmed',consent_at=excluded.consent_at,
          confirmed_at=excluded.confirmed_at,unsubscribed_at=NULL,updated_at=excluded.updated_at,
          provider_sync_status='not_connected'`).bind(crypto.randomUUID(), now, now, now, challenge.id, claim),
      db.prepare(`SELECT n.status FROM newsletter_subscribers n JOIN auth_challenges c ON c.email=n.email
        WHERE c.id=? AND c.consumed_by=?`).bind(challenge.id, claim),
    ]);
    if (!results[2].results[0]) throw invalid();
    return json({status: 'confirmed'});
  }
  const token = randomToken();
  const tokenHash = await sha256(token);
  const role = challenge.email.toLowerCase() === env.ADMIN_EMAIL.trim().toLowerCase() ? 'admin' : 'member';
  const results = await db.batch<UserRow>([
    consume,
    db.prepare(`INSERT INTO users(id,email,display_name,role,status,verified_at,created_at,last_login_at)
      SELECT ?,email,display_name,?,'active',?,?,? FROM auth_challenges WHERE id=? AND consumed_by=?
      ON CONFLICT(email) DO UPDATE SET role=excluded.role,verified_at=COALESCE(users.verified_at,excluded.verified_at),
        last_login_at=excluded.last_login_at WHERE users.status='active'`)
      .bind(crypto.randomUUID(), role, now, now, now, challenge.id, claim),
    db.prepare(`INSERT INTO sessions(token_hash,user_id,created_at,expires_at)
      SELECT ?,u.id,?,? FROM users u JOIN auth_challenges c ON c.email=u.email
      WHERE c.id=? AND c.consumed_by=? AND u.status='active' AND u.verified_at IS NOT NULL`)
      .bind(tokenHash, now, now + SESSION_SECONDS, challenge.id, claim),
    db.prepare(`SELECT u.id,u.email,u.display_name,u.annotation_status FROM users u JOIN sessions s ON s.user_id=u.id
      WHERE s.token_hash=?`).bind(tokenHash),
  ]);
  const row = results[3].results[0];
  if (!row) throw invalid();
  return json({user: userResponse(row, env)}, 200, {'set-cookie': sessionCookie(token)});
}

export async function handleAuth(request: Request, env: Env): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/auth/') && !path.startsWith('/api/newsletter/')) return null;
  try {
    assertOrigin(request, env);
    if (request.method === 'POST' && path === '/api/auth/request') return await requestCode(request, env, 'auth');
    if (request.method === 'POST' && path === '/api/auth/verify') return await verifyCode(request, env, 'auth');
    if (request.method === 'POST' && path === '/api/newsletter/request') return await requestCode(request, env, 'newsletter');
    if (request.method === 'POST' && path === '/api/newsletter/verify') return await verifyCode(request, env, 'newsletter');
    if (request.method === 'GET' && path === '/api/auth/me') return json({user: await getUser(request, env)});
    if (request.method === 'POST' && path === '/api/auth/logout') {
      const token = cookieToken(request);
      if (token) await env.COMMUNITY.withSession('first-primary').prepare('UPDATE sessions SET revoked_at=? WHERE token_hash=?')
        .bind(nowSeconds(), await sha256(token)).run();
      return json({user: null}, 200, {'set-cookie': sessionCookie('', 0)});
    }
    if (request.method === 'PATCH' && path === '/api/auth/profile') {
      const user = await requireUser(request, env);
      const body = await readJson(request);
      const name = displayName(body.displayName, true);
      await rateLimit(env, `profile:${user.id}`, 20, 3600);
      const row = await env.COMMUNITY.withSession('first-primary').prepare(`UPDATE users SET display_name=?
        WHERE id=? AND status='active' AND verified_at IS NOT NULL RETURNING id,email,display_name,annotation_status`)
        .bind(name, user.id).first<UserRow>();
      if (!row) throw new HttpError(401, 'Please sign in to continue.');
      return json({user: userResponse(row, env)});
    }
    if (request.method === 'GET' && path === '/api/newsletter/status') {
      const user = await requireUser(request, env);
      const row = await env.COMMUNITY.withSession('first-primary').prepare('SELECT status,provider_sync_status FROM newsletter_subscribers WHERE email=?')
        .bind(user.email).first<{status: string; provider_sync_status: string}>();
      return json({status: row?.status || 'not_subscribed', providerSyncStatus: row?.provider_sync_status || 'not_connected'});
    }
    if (request.method === 'POST' && path === '/api/newsletter/subscribe') {
      const user = await requireUser(request, env);
      const body = await readJson(request);
      if (body.consent !== true) throw new HttpError(400, 'Please confirm that you want to receive the newsletter.');
      await rateLimit(env, `newsletter:subscribe:${user.id}`, 10, 3600);
      const now = nowSeconds();
      await env.COMMUNITY.withSession('first-primary').prepare(`
        INSERT INTO newsletter_subscribers(id,email,display_name,status,consent_at,confirmed_at,created_at,updated_at)
        VALUES(?,?,?,'confirmed',?,?,?,?) ON CONFLICT(email) DO UPDATE SET
          status='confirmed',consent_at=excluded.consent_at,confirmed_at=excluded.confirmed_at,
          unsubscribed_at=NULL,updated_at=excluded.updated_at,provider_sync_status='not_connected'
      `).bind(crypto.randomUUID(), user.email, user.displayName, now, now, now, now).run();
      return json({status: 'confirmed'});
    }
    if (request.method === 'POST' && path === '/api/newsletter/unsubscribe') {
      const user = await requireUser(request, env);
      const now = nowSeconds();
      const db = env.COMMUNITY.withSession('first-primary');
      await db.batch([
        db.prepare(`UPDATE newsletter_subscribers SET status='unsubscribed',unsubscribed_at=?,updated_at=?,provider_sync_status='not_connected' WHERE email=?`)
          .bind(now, now, user.email),
        db.prepare(`UPDATE auth_challenges SET consumed_at=? WHERE email=? AND purpose='newsletter' AND consumed_at IS NULL`).bind(now, user.email),
      ]);
      return json({status: 'unsubscribed'});
    }
    const known = new Set(['/api/auth/request', '/api/auth/verify', '/api/auth/me', '/api/auth/logout', '/api/auth/profile',
      '/api/newsletter/request', '/api/newsletter/verify', '/api/newsletter/status', '/api/newsletter/subscribe', '/api/newsletter/unsubscribe']);
    throw new HttpError(known.has(path) ? 405 : 404, known.has(path) ? 'Method not allowed.' : 'Not found.');
  } catch (error) {
    if (error instanceof HttpError) return json({error: error.message}, error.status);
    console.error(JSON.stringify({event: 'account_request_failed', type: error instanceof Error ? error.name : 'unknown'}));
    return json({error: 'Account services are temporarily unavailable. Please try again.'}, 503);
  }
}
