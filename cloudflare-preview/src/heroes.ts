import {getCollectionHeroes} from './community';
import {DEFAULT_HOMEPAGE_COLLECTION_IDS, getHomepageCollectionIds} from './homepage-settings';

type HomepageFragment = {cardHtml: string; leadHtml: string};

async function homepageFragments(env: Env): Promise<HomepageFragment[]> {
  const [asset, selected] = await Promise.all([
    env.ASSETS.fetch(new Request(new URL('/homepage-fragments.json', env.PUBLIC_ORIGIN))),
    getHomepageCollectionIds(env),
  ]);
  if (!asset.ok || !asset.body) throw new Error('Homepage fragments unavailable');
  // Build output is capped at 1 MiB; enforce that cap while reading it too.
  const reader = asset.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let content = '';
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error('Homepage fragments exceed limit');
      }
      content += decoder.decode(value, {stream: true});
    }
    content += decoder.decode();
  } finally { reader.releaseLock(); }
  const manifest: unknown = JSON.parse(content);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid homepage fragments');
  const available = (ids: readonly string[]): HomepageFragment[] => ids.flatMap(id => {
    if (!Object.hasOwn(manifest, id)) return [];
    const fragment: unknown = (manifest as Record<string, unknown>)[id];
    if (!fragment || typeof fragment !== 'object' || !('cardHtml' in fragment) || !('leadHtml' in fragment)
      || typeof fragment.cardHtml !== 'string' || typeof fragment.leadHtml !== 'string') throw new Error('Invalid homepage fragment');
    return [{cardHtml: fragment.cardHtml, leadHtml: fragment.leadHtml}];
  });
  const fragments = available(selected);
  // An album may disappear in a later archive publication. Skip stale choices,
  // retaining the built-in selection if every saved album has disappeared.
  return fragments.length ? fragments : available(DEFAULT_HOMEPAGE_COLLECTION_IDS);
}

// Only the homepage and collection directory contain configurable cover images.
// Photograph and gallery pages retain direct static-asset serving.
export function isHeroPage(path: string): boolean {
  return path === '/' || path === '/collections/' || /^\/collections\/page\/[1-9]\d*\/$/.test(path);
}

function replaceSource(value: string, base: string): string {
  return value.replace(/https:\/\/[^\s,]+\/(thumb|small|large)\.(webp|avif)/g,
    (_match, variant: string, format: string) => `${base}/${variant}.${format}`);
}

export async function serveHeroPage(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (!isHeroPage(url.pathname) || !['GET', 'HEAD'].includes(request.method)) return env.ASSETS.fetch(request);
  const key = new Request(new URL(`/__hero-html${url.pathname}?v=${encodeURIComponent(env.CACHE_VERSION)}`, env.PUBLIC_ORIGIN));
  const cached = await caches.default.match(key);
  if (cached) {
    const response = new Response(request.method === 'HEAD' ? null : cached.body, cached);
    response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
    response.headers.set('x-hero-cache', 'HIT');
    return response;
  }
  // The HTML is identical for everyone. Do not forward cookies or conditional
  // validators to the asset binding, or cache any account-dependent response.
  const assetUrl = new URL(url.pathname, env.PUBLIC_ORIGIN);
  const [asset, heroes, fragments] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl)),
    getCollectionHeroes(env),
    url.pathname === '/' ? homepageFragments(env) : Promise.resolve([]),
  ]);
  if (asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) return asset;
  const homepage = fragments.length ? new HTMLRewriter()
    .on('#homepage-lead', {element(element) { element.setInnerContent(fragments[0].leadHtml, {html: true}); }})
    .on('#homepage-collections', {element(element) { element.setInnerContent(fragments.map(fragment => fragment.cardHtml).join(''), {html: true}); }})
    .transform(asset) : asset;
  // Inserted fragments need a second pass to receive current cover overrides.
  const rewriter = new HTMLRewriter();
  for (const hero of heroes) {
    if (!/^[a-z0-9-]+$/.test(hero.collectionId)) continue;
    const selector = `picture[data-collection-id="${hero.collectionId}"]`;
    const base = hero.imageBase.replace(/\/$/, '');
    rewriter.on(`${selector} source`, {
      element(element) {
        const srcset = element.getAttribute('srcset');
        if (srcset) element.setAttribute('srcset', replaceSource(srcset, base));
      },
    }).on(`${selector} img`, {
      element(element) {
        for (const attribute of ['src', 'srcset']) {
          const value = element.getAttribute(attribute);
          if (value) element.setAttribute(attribute, replaceSource(value, base));
        }
        element.setAttribute('alt', hero.title || 'Photograph from the archive');
        element.setAttribute('width', String(hero.width || 1500));
        element.setAttribute('height', String(hero.height || 1000));
      },
    }).on(`a[data-collection-id="${hero.collectionId}"][data-collection-hero-link]`, {
      element(element) {
        element.setAttribute('href', `/photos/${hero.photoId}/`);
        element.setAttribute('aria-label', `View photograph: ${hero.title || 'From the archive'}`);
      },
    });
  }
  const transformed = rewriter.transform(homepage);
  const response = new Response(transformed.body, transformed);
  response.headers.delete('etag');
  response.headers.delete('last-modified');
  response.headers.delete('content-length');
  response.headers.set('cache-control', 'public, max-age=60');
  response.headers.set('x-hero-cache', 'MISS');
  ctx.waitUntil(caches.default.put(key, response.clone()).catch(() => {
    console.warn(JSON.stringify({event: 'hero_cache_write_failed'}));
  }));
  response.headers.set('cache-control', 'public, max-age=0, must-revalidate');
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
