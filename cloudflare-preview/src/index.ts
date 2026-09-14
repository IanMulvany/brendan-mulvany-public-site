import {InvalidSearch, PAGE_SIZE, parseSearch, searchStatement} from './search';
import {handleAuth, cleanupAuth} from './auth';
import {handleCommunity} from './community';
import {HttpError, json} from './http';
import {isHeroPage, serveHeroPage} from './heroes';
import {handleHomepageSettings} from './homepage-settings';

const baseHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-store',
};

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      if (isHeroPage(url.pathname)) {
        try { return await serveHeroPage(request, env, ctx); }
        catch (error) {
          console.error(JSON.stringify({event: 'hero_render_failed', type: error instanceof Error ? error.name : 'unknown'}));
          // Browsing remains available if the independent community DB is down.
          return env.ASSETS.fetch(request);
        }
      }
      return env.ASSETS.fetch(request);
    }
    if (url.pathname !== '/api/search') {
      try {
        return await handleAuth(request, env) ?? await handleHomepageSettings(request, env) ?? await handleCommunity(request, env) ?? json({error: 'Not found.'}, 404);
      } catch (error) {
        if (error instanceof HttpError) return json({error: error.message}, error.status);
        // Never log request bodies, email addresses, codes, cookies, or SQL errors.
        console.error(JSON.stringify({event: 'community_request_failed', type: error instanceof Error ? error.name : 'unknown'}));
        return json({error: 'This service is temporarily unavailable. Please try again.'}, 503);
      }
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      return Response.json({error: 'Method not allowed.'}, {status: 405, headers: {...baseHeaders, allow: 'GET, HEAD'}});
    }
    if (url.pathname !== '/api/search') return Response.json({error: 'Not found.'}, {status: 404, headers: baseHeaders});
    const started = performance.now();
    try {
      const input = parseSearch(url);
      const cacheUrl = new URL('/api/search', url.origin);
      cacheUrl.search = new URLSearchParams({q: input.query, collection: input.collection, page: String(input.page), v: env.CACHE_VERSION}).toString();
      const cacheKey = new Request(cacheUrl);
      const cached = await caches.default.match(cacheKey);
      if (cached) {
        const response = new Response(request.method === 'HEAD' ? null : cached.body, cached);
        response.headers.set('cache-control', 'public, max-age=60');
        response.headers.set('x-search-cache', 'HIT');
        response.headers.set('server-timing', `cache;desc="HIT", worker;dur=${(performance.now() - started).toFixed(2)}`);
        return response;
      }
      const {sql, args} = searchStatement(input);
      // Read-only snapshot: replicas are safe once enabled for this D1 database.
      const db = env.DB.withSession('first-unconstrained');
      const result = await db.prepare(sql).bind(...args).all();
      const payload = {
        query: input.query, collection: input.collection, page: input.page,
        pageSize: PAGE_SIZE, hasMore: result.results.length > PAGE_SIZE,
        results: result.results.slice(0, PAGE_SIZE),
        timing: {databaseMs: result.meta.duration, workerMs: Number((performance.now() - started).toFixed(2))},
        cache: 'MISS',
      };
      const headers = {...baseHeaders,
        'cache-control': 'public, max-age=60',
        'x-search-cache': 'MISS',
        'server-timing': `d1;dur=${result.meta.duration}, worker;dur=${payload.timing.workerMs}, cache;desc="MISS"`,
      };
      const response = Response.json(payload, {headers});
      // Give the cached representation an explicit cache label; DB duration is the
      // original computation and the frontend must not report it as fresh work.
      const toCache = Response.json({...payload, cache: 'HIT'}, {
        headers: {...headers, 'cache-control': 'public, max-age=300', 'x-search-cache': 'HIT'},
      });
      ctx.waitUntil(caches.default.put(cacheKey, toCache).catch(() => {
        console.warn(JSON.stringify({event: 'search_cache_write_failed'}));
      }));
      return request.method === 'HEAD' ? new Response(null, {headers}) : response;
    } catch (error) {
      const isInputError = error instanceof InvalidSearch;
      if (!isInputError) console.error(JSON.stringify({event: 'search_failed', type: error instanceof Error ? error.name : 'unknown'}));
      return Response.json({error: isInputError ? error.message : 'Search is temporarily unavailable. Please try again.'}, {
        status: isInputError ? 400 : 503, headers: baseHeaders,
      });
    }
  },
  async scheduled(_event, env): Promise<void> {
    await cleanupAuth(env);
  },
} satisfies ExportedHandler<Env>;
