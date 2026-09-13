import {getUser, requireAdmin, requireUser, type AuthUser} from './auth';
import {HttpError, assertOrigin, json, rateLimit, readJson} from './http';

const PAGE_SIZE = 100;
const ADMIN_PAGE_SIZE = 50;
const CARD_FIELDS = 'id, collection_id, title, year, image_base, width, height';
const now = () => Math.floor(Date.now() / 1000);
const publicUser = (user: AuthUser | null) => user ? {id: user.id, displayName: user.displayName, role: user.role} : null;
const canDelete = (user: AuthUser | null, owner: string) => Boolean(user && (user.id === owner || user.role === 'admin'));

type Photo = {id: number; collection_id: string; title: string; year: string; image_base: string; width: number | null; height: number | null};
type Comment = {id: string; userId: string; displayName: string; body: string; createdAt: number};
type Annotation = {id: string; userId: string; displayName: string; name: string; note: string; x: number; y: number; width: number; height: number; createdAt: number};
type Position = {at: number; id: string};
type Cursor = {v: 1; photoId: number; comments: Position | null; annotations: Position | null};

function positiveId(value: string | number) {
  if (!/^[1-9]\d{0,15}$/.test(String(value)) || !Number.isSafeInteger(Number(value))) throw new HttpError(400, 'Invalid photograph.');
  return Number(value);
}
function itemId(value: string) {
  if (!/^[a-f0-9-]{36}$/i.test(value)) throw new HttpError(400, 'Invalid contribution.');
  return value;
}
function collectionId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(value)) throw new HttpError(400, 'Invalid collection.');
  return value;
}
function textField(value: unknown, label: string, maximum: number, optional = false) {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.includes('\0')) throw new HttpError(400, `${label} must be text.`);
  const text = value.trim();
  if ((!optional && !text) || text.length > maximum) throw new HttpError(400, `${label} must contain ${optional ? 'no more than' : 'between 1 and'} ${maximum} characters.`);
  return text;
}

export function validateAnnotation(body: Record<string, unknown>) {
  const name = textField(body.name, 'Name', 120);
  const note = textField(body.note, 'Note', 500, true);
  const {x, y, width, height} = body;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number'
    || ![x, y, width, height].every(Number.isFinite)
    || x < 0 || y < 0 || width < 0.01 || height < 0.01 || x > 1 || y > 1 || width > 1 || height > 1
    || x + width > 1 || y + height > 1) {
    throw new HttpError(400, 'Select a rectangle inside the photograph, at least 1% wide and high.');
  }
  return {name, note, x, y, width, height};
}

async function photo(env: Env, id: number) {
  const found = await env.DB.prepare(`SELECT ${CARD_FIELDS} FROM photos WHERE id = ?`).bind(id).first<Photo>();
  if (!found) throw new HttpError(404, 'Photograph not found.');
  return found;
}
async function writer(request: Request, env: Env, admin = false) {
  assertOrigin(request, env);
  const user = admin ? await requireAdmin(request, env) : await requireUser(request, env);
  await rateLimit(env, `community:user:${user.id}`, 60, 60);
  return user;
}
function audit(env: Env, user: AuthUser, action: string, photoId: number | null, targetId: string | null,
  condition = '1', args: (string | number | null)[] = []) {
  return env.COMMUNITY.prepare(`INSERT INTO activity (id,user_id,action,photo_id,target_id,created_at)
    SELECT ?,?,?,?,?,? WHERE ${condition}`).bind(crypto.randomUUID(), user.id, action, photoId, targetId, now(), ...args);
}

function decodeCursor(value: string | null, photoId: number): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 700 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(atob(value.replace(/-/g, '+').replace(/_/g, '/')));
    if (parsed.v !== 1 || parsed.photoId !== photoId) throw new Error();
    for (const name of ['comments', 'annotations']) {
      const position = parsed[name];
      if (position !== null && (!position || !Number.isSafeInteger(position.at) || position.at < 0
        || typeof position.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(position.id))) throw new Error();
    }
    return parsed;
  } catch {
    throw new HttpError(400, 'Invalid community page cursor.');
  }
}
function encodeCursor(cursor: Cursor) {
  return btoa(JSON.stringify(cursor)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function contributions<T extends Comment | Annotation>(env: Env, table: 'comments' | 'annotations', photoId: number,
  position: Position | null | undefined) {
  if (position === null) return [];
  const fields = table === 'comments' ? 'c.body' : 'c.name, c.note, c.x, c.y, c.width, c.height';
  const args: (number | string)[] = [photoId];
  if (position) args.push(position.at, position.at, position.id);
  args.push(PAGE_SIZE + 1);
  const result = await env.COMMUNITY.prepare(`SELECT c.id, c.user_id AS userId, u.display_name AS displayName,
    ${fields}, c.created_at AS createdAt FROM ${table} c JOIN users u ON u.id = c.user_id
    WHERE c.photo_id = ? AND c.hidden_at IS NULL AND u.verified_at IS NOT NULL
    ${position ? 'AND (c.created_at < ? OR (c.created_at = ? AND c.id < ?))' : ''}
    ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).bind(...args).all<T>();
  return result.results;
}
async function likeState(env: Env, photoId: number, user: AuthUser | null) {
  const state = await env.COMMUNITY.prepare(`SELECT COUNT(*) AS likeCount,
    COALESCE(MAX(CASE WHEN l.user_id = ? THEN 1 ELSE 0 END),0) AS liked
    FROM likes l JOIN users u ON u.id = l.user_id WHERE l.photo_id = ? AND u.verified_at IS NOT NULL`)
    .bind(user?.id ?? '', photoId).first<{likeCount: number; liked: number}>();
  return {likeCount: state?.likeCount ?? 0, liked: Boolean(state?.liked)};
}
async function getCommunity(request: Request, env: Env, photoId: number) {
  await photo(env, photoId);
  const user = await getUser(request, env);
  const cursor = decodeCursor(new URL(request.url).searchParams.get('cursor'), photoId);
  const [comments, annotations, likes] = await Promise.all([
    contributions<Comment>(env, 'comments', photoId, cursor?.comments),
    contributions<Annotation>(env, 'annotations', photoId, cursor?.annotations),
    likeState(env, photoId, user),
  ]);
  const next = (rows: (Comment | Annotation)[]) => rows.length > PAGE_SIZE
    ? {at: rows[PAGE_SIZE - 1].createdAt, id: rows[PAGE_SIZE - 1].id} : null;
  const nextPage: Cursor = {v: 1, photoId, comments: next(comments), annotations: next(annotations)};
  return json({user: publicUser(user), ...likes,
    comments: comments.slice(0, PAGE_SIZE).map(item => ({...item, canDelete: canDelete(user, item.userId)})),
    annotations: annotations.slice(0, PAGE_SIZE).map(item => ({...item, canDelete: canDelete(user, item.userId)})),
    ...(nextPage.comments || nextPage.annotations ? {nextCursor: encodeCursor(nextPage)} : {}),
  });
}
async function createComment(request: Request, env: Env, photoId: number) {
  const user = await writer(request, env);
  await photo(env, photoId);
  const body = textField((await readJson(request)).body, 'Comment', 2000);
  const id = crypto.randomUUID(), createdAt = now();
  await env.COMMUNITY.batch([
    env.COMMUNITY.prepare('INSERT INTO comments (id,photo_id,user_id,body,created_at) VALUES (?,?,?,?,?)')
      .bind(id, photoId, user.id, body, createdAt),
    audit(env, user, 'comment.created', photoId, id),
  ]);
  return json({id, userId: user.id, displayName: user.displayName, body, createdAt, canDelete: true}, 201);
}
async function createAnnotation(request: Request, env: Env, photoId: number) {
  const user = await writer(request, env);
  await photo(env, photoId);
  const value = validateAnnotation(await readJson(request));
  const id = crypto.randomUUID(), createdAt = now();
  await env.COMMUNITY.batch([
    env.COMMUNITY.prepare('INSERT INTO annotations (id,photo_id,user_id,name,note,x,y,width,height,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, photoId, user.id, value.name, value.note, value.x, value.y, value.width, value.height, createdAt),
    audit(env, user, 'annotation.created', photoId, id),
  ]);
  return json({id, userId: user.id, displayName: user.displayName, ...value, createdAt, canDelete: true}, 201);
}
async function hideContribution(request: Request, env: Env, table: 'comments' | 'annotations', id: string) {
  const user = await writer(request, env);
  const item = await env.COMMUNITY.prepare(`SELECT photo_id, user_id FROM ${table} WHERE id = ?`).bind(id)
    .first<{photo_id: number; user_id: string}>();
  if (!item) throw new HttpError(404, 'Contribution not found.');
  if (!canDelete(user, item.user_id)) throw new HttpError(403, 'You cannot remove this contribution.');
  await photo(env, item.photo_id);
  await env.COMMUNITY.batch([
    audit(env, user, table === 'comments' ? 'comment.hidden' : 'annotation.hidden', item.photo_id, id,
      `EXISTS(SELECT 1 FROM ${table} WHERE id = ? AND hidden_at IS NULL)`, [id]),
    env.COMMUNITY.prepare(`UPDATE ${table} SET hidden_at = ?, hidden_by = ? WHERE id = ? AND hidden_at IS NULL`)
      .bind(now(), user.id, id),
  ]);
  return json({ok: true});
}
async function changeLike(request: Request, env: Env, photoId: number) {
  const user = await writer(request, env);
  await photo(env, photoId);
  if (request.method === 'PUT') {
    const id = crypto.randomUUID();
    await env.COMMUNITY.batch([
      env.COMMUNITY.prepare('INSERT INTO likes (id,photo_id,user_id,created_at) VALUES (?,?,?,?) ON CONFLICT(photo_id,user_id) DO NOTHING')
        .bind(id, photoId, user.id, now()),
      audit(env, user, 'like.added', photoId, null, 'EXISTS(SELECT 1 FROM likes WHERE id = ?)', [id]),
    ]);
  } else {
    await env.COMMUNITY.batch([
      audit(env, user, 'like.removed', photoId, null, 'EXISTS(SELECT 1 FROM likes WHERE photo_id = ? AND user_id = ?)', [photoId, user.id]),
      env.COMMUNITY.prepare('DELETE FROM likes WHERE photo_id = ? AND user_id = ?').bind(photoId, user.id),
    ]);
  }
  return json(await likeState(env, photoId, user));
}
function pageNumber(url: URL) {
  const raw = url.searchParams.get('page') ?? '1';
  if (!/^[1-9]\d{0,3}$/.test(raw) || Number(raw) > 1000) throw new HttpError(400, 'Page must be between 1 and 1000.');
  return Number(raw);
}
const USER_FIELDS = 'id,email,display_name AS displayName,role,status,verified_at AS verifiedAt,created_at AS createdAt,last_login_at AS lastLoginAt';
async function summary(env: Env) {
  const result = await env.COMMUNITY.prepare(`SELECT
    (SELECT COUNT(*) FROM users) AS users,
    (SELECT COUNT(*) FROM users WHERE status = 'active') AS activeUsers,
    (SELECT COUNT(*) FROM users WHERE status = 'suspended') AS suspendedUsers,
    (SELECT COUNT(*) FROM comments WHERE hidden_at IS NULL) AS comments,
    (SELECT COUNT(*) FROM annotations WHERE hidden_at IS NULL) AS annotations,
    (SELECT COUNT(*) FROM likes) AS likes,
    (SELECT COUNT(*) FROM newsletter_subscribers WHERE status = 'confirmed') AS subscribers,
    (SELECT COUNT(*) FROM collection_heroes) AS collectionsWithCustomHeroes`).first();
  return json(result);
}
async function adminList(env: Env, name: 'users' | 'activity' | 'subscribers', page: number) {
  const sql = name === 'users' ? `SELECT ${USER_FIELDS} FROM users ORDER BY created_at DESC, id DESC`
    : name === 'activity' ? `SELECT a.id,a.user_id AS userId,u.display_name AS displayName,a.action,
      a.photo_id AS photoId,a.target_id AS targetId,a.created_at AS createdAt
      FROM activity a JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC,a.id DESC`
    : `SELECT id,email,display_name AS displayName,status,consent_at AS consentAt,confirmed_at AS confirmedAt,
      unsubscribed_at AS unsubscribedAt,created_at AS createdAt,provider_sync_status AS providerSyncStatus
      FROM newsletter_subscribers ORDER BY created_at DESC,id DESC`;
  const result = await env.COMMUNITY.prepare(`${sql} LIMIT ? OFFSET ?`).bind(ADMIN_PAGE_SIZE + 1, (page - 1) * ADMIN_PAGE_SIZE).all();
  return json({[name]: result.results.slice(0, ADMIN_PAGE_SIZE), hasMore: result.results.length > ADMIN_PAGE_SIZE});
}
async function changeUser(request: Request, env: Env, id: string) {
  const user = await writer(request, env, true);
  const body = await readJson(request);
  if (body.status !== 'active' && body.status !== 'suspended') throw new HttpError(400, 'Choose active or suspended status.');
  const target = await env.COMMUNITY.prepare('SELECT id,email,role FROM users WHERE id = ?').bind(id).first<{id: string; email: string; role: string}>();
  if (!target) throw new HttpError(404, 'User not found.');
  const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase();
  if (body.status === 'suspended' && (target.id === user.id || target.role === 'admin' || target.email.toLowerCase() === adminEmail)) {
    throw new HttpError(403, 'Administrators cannot suspend themselves or another administrator.');
  }
  const eligible = `id = ? AND status != ? AND (? != 'suspended' OR (role != 'admin' AND lower(email) != ? AND id != ?))`;
  const args = [id, body.status, body.status, adminEmail, user.id];
  const statements = [
    audit(env, user, 'user.status_changed', null, id, `EXISTS(SELECT 1 FROM users WHERE ${eligible})`, args),
    env.COMMUNITY.prepare(`UPDATE users SET status = ? WHERE ${eligible}`).bind(body.status, ...args),
  ];
  if (body.status === 'suspended') statements.push(env.COMMUNITY.prepare(`UPDATE sessions SET revoked_at = ?
    WHERE user_id = ? AND revoked_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id = ? AND status = 'suspended')`).bind(now(), id, id));
  await env.COMMUNITY.batch(statements);
  return json({user: await env.COMMUNITY.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).bind(id).first()});
}
async function adminCollections(env: Env) {
  const [collections, heroes] = await Promise.all([
    env.DB.prepare('SELECT DISTINCT collection_id AS id FROM photos ORDER BY collection_id LIMIT 1001').all<{id: string}>(),
    env.COMMUNITY.prepare('SELECT collection_id,photo_id FROM collection_heroes LIMIT 1001').all<{collection_id: string; photo_id: number}>(),
  ]);
  if (collections.results.length > 1000 || heroes.results.length > 1000) throw new HttpError(503, 'Collection directory needs pagination.');
  const chosen = new Map(heroes.results.map(hero => [hero.collection_id, hero.photo_id]));
  return json({collections: collections.results.map(collection => ({...collection, heroPhotoId: chosen.get(collection.id) ?? null}))});
}
async function collectionPhotos(env: Env, id: string) {
  const result = await env.DB.prepare(`SELECT ${CARD_FIELDS} FROM photos WHERE collection_id = ? ORDER BY id LIMIT 201`).bind(id).all<Photo>();
  if (!result.results.length) throw new HttpError(404, 'Collection not found.');
  if (result.results.length > 200) throw new HttpError(503, 'This collection needs photo pagination.');
  return json({photos: result.results});
}
async function setHero(request: Request, env: Env, id: string) {
  const user = await writer(request, env, true);
  const body = await readJson(request);
  if (typeof body.photoId !== 'number') throw new HttpError(400, 'Choose a photograph.');
  const chosen = await photo(env, positiveId(body.photoId));
  if (chosen.collection_id !== id) throw new HttpError(400, 'The photograph must belong to this collection.');
  await env.COMMUNITY.batch([
    audit(env, user, 'collection.hero_changed', chosen.id, id,
      'NOT EXISTS(SELECT 1 FROM collection_heroes WHERE collection_id = ? AND photo_id = ?)', [id, chosen.id]),
    env.COMMUNITY.prepare(`INSERT INTO collection_heroes (collection_id,photo_id,updated_by,updated_at) VALUES (?,?,?,?)
      ON CONFLICT(collection_id) DO UPDATE SET photo_id=excluded.photo_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at
      WHERE collection_heroes.photo_id != excluded.photo_id`).bind(id, chosen.id, user.id, now()),
  ]);
  return json({ok: true, collectionId: id, photoId: chosen.id});
}
export async function getCollectionHeroes(env: Env) {
  const stored = await env.COMMUNITY.prepare('SELECT collection_id,photo_id FROM collection_heroes ORDER BY collection_id LIMIT 1001')
    .all<{collection_id: string; photo_id: number}>();
  if (stored.results.length > 1000) throw new HttpError(503, 'Collection directory needs pagination.');
  const photos = new Map<number, Photo>();
  // D1 limits bound parameters per query; batches stay below that limit.
  for (let offset = 0; offset < stored.results.length; offset += 80) {
    const ids = stored.results.slice(offset, offset + 80).map(hero => hero.photo_id);
    const result = await env.DB.prepare(`SELECT ${CARD_FIELDS} FROM photos WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<Photo>();
    for (const photo of result.results) photos.set(photo.id, photo);
  }
  const heroes = stored.results.flatMap(hero => {
    const selected = photos.get(hero.photo_id);
    return selected?.collection_id === hero.collection_id ? [{collectionId: hero.collection_id, photoId: selected.id,
      imageBase: selected.image_base, title: selected.title, width: selected.width, height: selected.height}] : [];
  });
  return heroes;
}

export async function handleCommunity(request: Request, env: Env): Promise<Response | null> {
  const url = new URL(request.url), path = url.pathname;
  if (path === '/api/collection-heroes') {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');
    const response = json({heroes: await getCollectionHeroes(env)});
    response.headers.set('cache-control', 'public, max-age=60');
    return response;
  }
  let match = path.match(/^\/api\/photos\/([^/]+)\/(community|comments|annotations|like)$/);
  if (match) {
    const id = positiveId(match[1]), action = match[2];
    if (action === 'community' && request.method === 'GET') return getCommunity(request, env, id);
    if (action === 'comments' && request.method === 'POST') return createComment(request, env, id);
    if (action === 'annotations' && request.method === 'POST') return createAnnotation(request, env, id);
    if (action === 'like' && ['PUT', 'DELETE'].includes(request.method)) return changeLike(request, env, id);
    throw new HttpError(405, 'Method not allowed.');
  }
  match = path.match(/^\/api\/(comments|annotations)\/([^/]+)$/);
  if (match) {
    if (request.method !== 'DELETE') throw new HttpError(405, 'Method not allowed.');
    return hideContribution(request, env, match[1] === 'comments' ? 'comments' : 'annotations', itemId(match[2]));
  }
  if (!path.startsWith('/api/admin/')) return null;
  await requireAdmin(request, env);
  if (request.method === 'GET') {
    if (path === '/api/admin/summary') return summary(env);
    if (path === '/api/admin/collections') return adminCollections(env);
    match = path.match(/^\/api\/admin\/(users|activity|subscribers)$/);
    if (match) return adminList(env, match[1] as 'users' | 'activity' | 'subscribers', pageNumber(url));
    match = path.match(/^\/api\/admin\/collections\/([^/]+)\/photos$/);
    if (match) return collectionPhotos(env, collectionId(match[1]));
  }
  match = path.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (match && request.method === 'PATCH') return changeUser(request, env, itemId(match[1]));
  match = path.match(/^\/api\/admin\/collections\/([^/]+)\/hero$/);
  if (match && request.method === 'PUT') return setHero(request, env, collectionId(match[1]));
  throw new HttpError(404, 'Admin endpoint not found.');
}
