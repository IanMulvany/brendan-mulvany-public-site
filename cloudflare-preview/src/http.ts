export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'private, no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-robots-tag', 'noindex, nofollow');
  return Response.json(data, {status, headers});
}

export async function readJson(request: Request, maxBytes = 8192): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new HttpError(415, 'Send this request as JSON.');
  }
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new HttpError(413, 'This request is too large.');
  if (!request.body) throw new HttpError(400, 'A JSON object is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new HttpError(413, 'This request is too large.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal: true, ignoreBOM: false}).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Not an object');
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, 'A valid JSON object is required.');
  }
}

export function assertOrigin(request: Request, env: Env): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  let origin: string;
  try { origin = new URL(env.PUBLIC_ORIGIN).origin; }
  catch { throw new HttpError(503, 'Account services are temporarily unavailable.'); }
  if (origin === 'null' || request.headers.get('origin') !== origin || new URL(request.url).origin !== origin) {
    throw new HttpError(403, 'Please submit this request from the archive website.');
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new HttpError(403, 'Please submit this request from the archive website.');
  }
}

export async function rateLimit(env: Env, key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  // One atomic statement enforces the limit even across simultaneous requests.
  const row = await env.COMMUNITY.withSession('first-primary').prepare(`
    INSERT INTO rate_limits(key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN rate_limits.expires_at <= ? THEN 1 ELSE rate_limits.count + 1 END,
      expires_at = CASE WHEN rate_limits.expires_at <= ? THEN excluded.expires_at ELSE rate_limits.expires_at END
    RETURNING count
  `).bind(key, now + windowSeconds, now, now).first<{count: number}>();
  if (!row || row.count > limit) throw new HttpError(429, 'Too many requests. Please wait and try again.');
}
