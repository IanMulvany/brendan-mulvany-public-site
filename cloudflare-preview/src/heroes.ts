import {getCollectionHeroes} from './community';

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
  const [asset, heroes] = await Promise.all([
    env.ASSETS.fetch(new Request(assetUrl)),
    getCollectionHeroes(env),
  ]);
  if (asset.status !== 200 || !asset.headers.get('content-type')?.includes('text/html')) return asset;
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
  const transformed = rewriter.transform(asset);
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
