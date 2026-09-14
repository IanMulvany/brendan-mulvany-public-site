import {requireAdmin} from './auth';
import {HttpError, assertOrigin, json, rateLimit, readJson} from './http';

export const DEFAULT_HOMEPAGE_COLLECTION_IDS = Object.freeze([
  'popes-visit', 'ireland-england', 'french-grand-prix',
]);
export const MAX_HOMEPAGE_COLLECTIONS = 6;

function collectionIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_HOMEPAGE_COLLECTIONS) {
    throw new HttpError(400, `Choose between 1 and ${MAX_HOMEPAGE_COLLECTIONS} homepage collections.`);
  }
  if (!value.every((id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(id))) {
    throw new HttpError(400, 'Choose valid collection IDs.');
  }
  if (new Set(value).size !== value.length) throw new HttpError(400, 'Each homepage collection can only be selected once.');
  return value;
}

export async function getHomepageCollectionIds(env: Env): Promise<string[]> {
  const saved = await env.COMMUNITY.withSession('first-primary').prepare('SELECT collection_ids FROM homepage_settings WHERE id = 1')
    .first<{collection_ids: string}>();
  if (!saved) return [...DEFAULT_HOMEPAGE_COLLECTION_IDS];
  try {
    return collectionIds(JSON.parse(saved.collection_ids));
  } catch {
    throw new HttpError(503, 'The saved homepage selection could not be read.');
  }
}

export async function handleHomepageSettings(request: Request, env: Env): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/admin/homepage') return null;
  assertOrigin(request, env);
  const user = await requireAdmin(request, env);
  if (request.method === 'GET') {
    return json({collectionIds: await getHomepageCollectionIds(env), maxCollections: MAX_HOMEPAGE_COLLECTIONS});
  }
  if (request.method !== 'PUT') throw new HttpError(405, 'Method not allowed.');
  await rateLimit(env, `community:user:${user.id}`, 60, 60);
  const selected = collectionIds((await readJson(request)).collectionIds);
  // Membership comes from the public archive, using at most six bound values.
  // Keep the administrator's order rather than the database's result order.
  const published = await env.DB.prepare(`SELECT DISTINCT collection_id FROM photos
    WHERE collection_id IN (${selected.map(() => '?').join(',')})`).bind(...selected).all<{collection_id: string}>();
  const available = new Set(published.results.map(row => row.collection_id));
  if (selected.some(id => !available.has(id))) throw new HttpError(400, 'Every homepage collection must contain a published photograph.');
  await env.COMMUNITY.withSession('first-primary').prepare(`
    INSERT INTO homepage_settings(id,collection_ids,updated_by,updated_at) VALUES(1,?,?,?)
    ON CONFLICT(id) DO UPDATE SET collection_ids=excluded.collection_ids,updated_by=excluded.updated_by,updated_at=excluded.updated_at
  `).bind(JSON.stringify(selected), user.id, Math.floor(Date.now() / 1000)).run();
  return json({collectionIds: selected, maxCollections: MAX_HOMEPAGE_COLLECTIONS});
}
