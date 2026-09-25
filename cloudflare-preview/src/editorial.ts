import {requireAdmin} from './auth';
import {HttpError, assertOrigin, json, rateLimit, readJson} from './http';

const photoFields = new Set(['title', 'description', 'date', 'location', 'rotation']);
const collectionFields = new Set(['title', 'description']);
const statuses = new Set(['pending', 'cancelled', 'applied_local', 'published', 'conflict']);
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function correction(body: Record<string, unknown>) {
  const {kind, entityId, field, baseValue, value} = body;
  if (kind !== 'photo' && kind !== 'collection') throw new HttpError(400, 'Choose a photograph or collection.');
  if (typeof entityId !== 'string' ||
      (kind === 'photo' ? !/^[1-9][0-9]{0,9}$/.test(entityId) : !idPattern.test(entityId))) {
    throw new HttpError(400, 'Choose a valid published item.');
  }
  if (typeof field !== 'string' || !(kind === 'photo' ? photoFields : collectionFields).has(field)) {
    throw new HttpError(400, 'Choose an editable field.');
  }
  if (typeof baseValue !== 'string' || typeof value !== 'string' || baseValue.length > 5000) {
    throw new HttpError(400, 'Enter a valid correction.');
  }
  const proposed = value.normalize('NFC').trim();
  const limit = field === 'description' ? 3000 : field === 'title' ? 180 : field === 'location' ? 180 : 10;
  if (field === 'rotation' && (proposed !== 'left' && proposed !== 'right')) {
    throw new HttpError(400, 'Choose rotate left or rotate right.');
  }
  if (proposed.length > limit || (field === 'title' && !proposed) ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(proposed)) {
    throw new HttpError(400, `Use at most ${limit} characters without control characters.`);
  }
  if (field === 'date' && proposed && !/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(proposed)) {
    throw new HttpError(400, 'Use YYYY, YYYY-MM, or YYYY-MM-DD for a date.');
  }
  if (field === 'date' && proposed.length > 4) {
    const [year, month, day = 1] = proposed.split('-').map(Number);
    const actual = new Date(Date.UTC(year, month - 1, day));
    if (month < 1 || month > 12 || actual.getUTCFullYear() !== year ||
        actual.getUTCMonth() + 1 !== month || actual.getUTCDate() !== day) {
      throw new HttpError(400, 'Enter a valid calendar date.');
    }
  }
  if (proposed === baseValue) throw new HttpError(400, 'Change the value before saving.');
  return {kind, entityId, field, baseValue, value: proposed};
}

export async function handleEditorial(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== '/api/admin/corrections' && !url.pathname.startsWith('/api/admin/corrections/')) return null;
  assertOrigin(request, env);
  const user = await requireAdmin(request, env);
  const db = env.COMMUNITY.withSession('first-primary');
  const photo = /^\/api\/admin\/corrections\/photo\/([1-9][0-9]{0,9})$/.exec(url.pathname);
  if (photo && request.method === 'GET') {
    const row = await env.DB.prepare('SELECT title,description,date,location,image_base AS imageBase FROM photos WHERE id=?')
      .bind(Number(photo[1])).first();
    if (!row) throw new HttpError(404, 'This photograph is not published.');
    return json({photo: row, sourceVersion: env.CACHE_VERSION});
  }
  if (url.pathname === '/api/admin/corrections' && request.method === 'GET') {
    const status = url.searchParams.get('status') || 'pending';
    if (status !== 'open' && !statuses.has(status)) throw new HttpError(400, 'Invalid correction status.');
    const query = `SELECT id,kind,entity_id AS entityId,field,base_value AS baseValue,
      value,source_version AS sourceVersion,status,created_at AS createdAt,updated_at AS updatedAt,
      local_receipt AS localReceipt,published_release AS publishedRelease
      FROM editorial_corrections WHERE ${status === 'open' ? "status IN ('pending','applied_local','conflict')" : 'status=?'}
      ORDER BY created_at,id LIMIT 200`;
    const rows = await (status === 'open' ? db.prepare(query) : db.prepare(query).bind(status)).all();
    return json({corrections: rows.results});
  }
  if (url.pathname === '/api/admin/corrections' && request.method === 'POST') {
    await rateLimit(env, `community:user:${user.id}`, 60, 60);
    const next = correction(await readJson(request));
    if (next.kind === 'photo') {
      // SQL identifiers are selected from the server's fixed allowlist above.
      const column = next.field === 'rotation' ? 'image_base' : next.field;
      const row = await env.DB.prepare(`SELECT ${column} AS value FROM photos WHERE id=?`)
        .bind(Number(next.entityId)).first<{value: string}>();
      if (!row) throw new HttpError(404, 'This photograph is not published.');
      if ((row.value ?? '') !== next.baseValue) throw new HttpError(409, 'The published value changed. Reload before editing.');
    } else {
      const row = await env.DB.prepare('SELECT 1 AS found FROM photos WHERE collection_id=? LIMIT 1')
        .bind(next.entityId).first();
      if (!row) throw new HttpError(404, 'This collection is not published.');
      // Collection metadata is in static pages; the local importer compares
      // baseValue against the authoritative published manifest before applying.
    }
    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const inserted = await db.prepare(`INSERT INTO editorial_corrections
      (id,kind,entity_id,field,base_value,value,source_version,created_by,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING RETURNING id`)
      .bind(id,next.kind,next.entityId,next.field,next.baseValue,next.value,
        env.CACHE_VERSION,user.id,now,now).first<{id: string}>();
    if (!inserted) throw new HttpError(409, 'A correction for this field is already open.');
    return json({id, status: 'pending'}, 201);
  }
  const cancel = /^\/api\/admin\/corrections\/([^/]+)$/.exec(url.pathname);
  if (cancel && request.method === 'DELETE') {
    if (!uuidPattern.test(cancel[1])) throw new HttpError(400, 'Invalid correction ID.');
    await rateLimit(env, `community:user:${user.id}`, 60, 60);
    const now = Math.floor(Date.now() / 1000);
    const row = await db.prepare(`UPDATE editorial_corrections SET status='cancelled',updated_at=?
      WHERE id=? AND status='pending' RETURNING id`).bind(now, cancel[1]).first();
    if (!row) throw new HttpError(409, 'Only queued corrections can be cancelled.');
    return json({id: cancel[1], status: 'cancelled'});
  }
  throw new HttpError(405, 'Method not allowed.');
}
