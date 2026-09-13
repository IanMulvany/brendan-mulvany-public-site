import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const data = JSON.parse(await readFile(resolve(root, 'data/sample.json'), 'utf8'));
const { collections, photos } = data;
const original = data.sourceUrl || 'https://brendan-mulvany-photography.com';
const escape = (value = '') => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const photoById = new Map(photos.map(photo => [String(photo.id), photo]));
const collectionById = new Map(collections.map(collection => [String(collection.id), collection]));
const collectionPhotos = collection => photos.filter(photo => String(photo.collectionId) === String(collection.id));
const imageOrigins = [...new Set(photos.map(photo => new URL(photo.imageBase).origin))];
const date = value => {
  if (!value) return '';
  if (/^\d{4}$/.test(String(value))) return String(value);
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? String(value) : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(parsed);
};
const title = photo => {
  const raw = String(photo.title || '').trim().replace(/\s*·\s*DSCF\d+.*$/i, '');
  if (raw && !/\.(?:tiff?|jpe?g|png|avif|webp)$/i.test(raw) && !/^[\d_-]+$/.test(raw)) return raw;
  return String(photo.description || collectionById.get(String(photo.collectionId))?.title || 'From the archive').split(/[\r\n]/)[0].slice(0, 160);
};
const image = (photo, { large = false, eager = false, className = '', sizes = '(max-width: 640px) 100vw, (max-width: 960px) 50vw, 33vw' } = {}) => {
  if (!photo) throw new Error('Missing cover photograph');
  const base = escape(photo.imageBase.replace(/\/$/, ''));
  const width = Number(photo.width) || 1500;
  const height = Number(photo.height) || 1000;
  const variant = large ? 'large' : 'small';
  return `<picture${className ? ` class="${escape(className)}"` : ''}><source type="image/avif" srcset="${base}/thumb.avif 200w, ${base}/small.avif 800w${large ? `, ${base}/large.avif 1600w` : ''}" sizes="${escape(sizes)}"><img src="${base}/${variant}.webp" srcset="${base}/small.webp 800w${large ? `, ${base}/large.webp 1600w` : ''}" sizes="${escape(sizes)}" width="${width}" height="${height}" alt="${escape(title(photo))}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${eager ? ' fetchpriority="high"' : ''}></picture>`;
};
const photoCard = (photo, index) => `<article class="photo-card"><a class="photo-card__link" href="/photos/${encodeURIComponent(photo.id)}/">${image(photo, { eager: index < 3, className: 'photo-card__image' })}<div class="photo-card__caption"><h3>${escape(title(photo))}</h3><p>${escape(photo.year || '')}</p></div></a></article>`;

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
async function asset(filename) {
  const content = await readFile(resolve(root, 'static', filename));
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const [name, extension] = filename.split('.');
  const path = `/assets/${name}.${hash}.${extension}`;
  await writeFile(resolve(output, path.slice(1)), content);
  return path;
}
const css = await asset('site.css');
const js = await asset('search.js');
const layout = ({ title: pageTitle, description, content, search = false, section = '' }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="description" content="${escape(description || 'Selected photographs from the Brendan Mulvany archive.')}"><meta name="theme-color" content="#f6f5f1"><title>${escape(pageTitle)} — Brendan Mulvany</title><link rel="stylesheet" href="${css}">${imageOrigins.map(origin => `<link rel="preconnect" href="${escape(origin)}">`).join('')}${search ? `<script type="module" src="${js}"></script>` : ''}</head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="site-header wrapper"><a class="brand" href="/" aria-label="Brendan Mulvany archive home"><span>Brendan Mulvany</span><small>Photographic archive</small></a><nav aria-label="Main navigation"><a href="/#collections"${section === 'collections' ? ' aria-current="page"' : ''}>Collections</a><a href="/search/"${search ? ' aria-current="page"' : ''}>Search</a><a class="original-link" href="${escape(original)}">Original archive <span aria-hidden="true">↗</span></a></nav></header><div class="preview-strip wrapper"><span class="preview-badge">Archive preview</span><span>${collections.length} collections · ${photos.length} photographs</span></div><main id="main" class="wrapper">${content}</main><footer class="site-footer wrapper"><p>Photographs © Brendan Mulvany</p><p>A selection from the archive, 1979–1986.</p><a href="${escape(original)}">Explore the full archive <span aria-hidden="true">↗</span></a></footer></body></html>`;
async function page(path, props) {
  const target = resolve(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, layout(props));
}

const leadCollection = collections[0];
const lead = photoById.get(String(leadCollection.coverId)) || collectionPhotos(leadCollection)[0];
await page('index.html', { title: 'Selected collections', section: 'collections', content: `
<section class="intro"><p class="eyebrow">The Brendan Mulvany archive / Selected collections</p><h1>Moments become<br><em>history.</em></h1><p class="intro__copy">On the touchline, in the crowd, beside the track. Discover a selection of Brendan Mulvany’s photographs, one frame at a time.</p><a class="text-link" href="#collections">Explore the collections <span aria-hidden="true">↓</span></a></section>
<figure class="lead-photo"><a href="/photos/${encodeURIComponent(lead.id)}/" aria-label="View photograph: ${escape(title(lead))}">${image(lead, { large: true, eager: true, className: 'lead-photo__image', sizes: '(max-width: 1280px) 94vw, 1200px' })}</a><figcaption><span>${escape(leadCollection.title)}</span><span>${escape(date(leadCollection.date))}</span></figcaption></figure>
<section id="collections" class="collections-section"><div class="section-heading"><div><p class="eyebrow">Browse the archive</p><h2>Three stories. Many perspectives.</h2></div><span class="small-text">${photos.length} photographs</span></div><div class="collection-grid">${collections.map((collection, index) => { const cover = photoById.get(String(collection.coverId)) || collectionPhotos(collection)[0]; return `<article class="collection-card"><a href="/collections/${encodeURIComponent(collection.id)}/">${image(cover, { className: 'collection-card__image' })}<div class="collection-card__meta"><span>Collection ${String(index + 1).padStart(2, '0')}</span><span>${escape(String(collection.date || '').slice(0, 4))}</span></div><h3>${escape(collection.title)} <span aria-hidden="true">↗</span></h3><p>${escape(collection.description)}</p><span class="collection-card__count">${collectionPhotos(collection).length} photographs · View collection</span></a></article>`; }).join('')}</div></section>
<section class="search-invitation"><div><p class="eyebrow">Find a moment</p><h2>A person. A place. A memory.</h2><p>Search the photographs in these three collections.</p></div><a class="button" href="/search/">Search the archive <span aria-hidden="true">↗</span></a></section>` });

for (const collection of collections) {
  const selected = collectionPhotos(collection);
  await page(`collections/${collection.id}/index.html`, { title: collection.title, description: collection.description, section: 'collections', content: `<section class="page-intro"><a class="back-link" href="/#collections">← All collections</a><p class="eyebrow">Collection / Roll ${escape(collection.roll)}</p><h1>${escape(collection.title)}</h1><p class="page-intro__description">${escape(collection.description)}</p><div class="collection-facts"><span>${escape(date(collection.date))}</span><span>${selected.length} photographs</span><a href="/search/?collection=${encodeURIComponent(collection.id)}">Search this collection →</a></div></section><section aria-label="Photographs in ${escape(collection.title)}" class="photo-grid">${selected.map(photoCard).join('')}</section>` });
  for (const [index, photo] of selected.entries()) {
    const previous = selected[index - 1];
    const next = selected[index + 1];
    const metadata = [['Collection', collection.title], ['Archive year', photo.year || date(photo.date)], ['Location', photo.location], ['Archive reference', `Roll ${collection.roll} / Photograph ${photo.id}`]].filter(([, value]) => value);
    await page(`photos/${photo.id}/index.html`, { title: title(photo), description: `A photograph from ${collection.title}, ${photo.year || collection.date}.`, content: `<div class="photo-navigation"><a class="back-link" href="/collections/${encodeURIComponent(collection.id)}/">← ${escape(collection.title)}</a><span>${index + 1} / ${selected.length}</span></div><article class="photo-detail"><figure class="photo-detail__figure">${image(photo, { large: true, eager: true, className: 'photo-detail__image', sizes: '(max-width: 900px) 94vw, 72vw' })}</figure><div class="photo-detail__info"><p class="eyebrow">From the archive</p><h1>${escape(title(photo))}</h1><dl>${metadata.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>${photo.description ? `<details class="photo-description"><summary>Existing machine-generated description (may contain errors)</summary><p>${escape(photo.description)}</p></details>` : ''}${Array.isArray(photo.tags) && photo.tags.length ? `<div class="tags" aria-label="Search related subjects">${photo.tags.slice(0, 12).map(tag => `<a href="/search/?q=${encodeURIComponent(tag)}">${escape(tag)}</a>`).join('')}</div>` : ''}</div></article><nav class="frame-navigation" aria-label="Photographs in this collection">${previous ? `<a href="/photos/${previous.id}/" rel="prev">← Previous photograph</a>` : '<span>First photograph</span>'}<a href="/collections/${encodeURIComponent(collection.id)}/">View collection</a>${next ? `<a href="/photos/${next.id}/" rel="next">Next photograph →</a>` : '<span>Last photograph</span>'}</nav>` });
  }
}

await page('search/index.html', { title: 'Search the archive', search: true, content: `<section class="page-intro search-intro"><p class="eyebrow">Explore the details</p><h1>Find a moment.</h1><p class="page-intro__description">Search ${photos.length} photographs across the selected collections. Try a person, a place, a subject or a year.</p></section><form action="/search/" method="get" id="search-form" class="search-form" role="search"><div class="search-field"><label for="search-query">Search photographs</label><div class="search-input-row"><input id="search-query" type="search" name="q" placeholder="Try “Pope”, “football” or “1980”" autocomplete="off" maxlength="120" aria-describedby="search-help"><button class="button" type="submit">Search <span aria-hidden="true">↗</span></button></div></div><div class="collection-field"><label for="search-collection">Collection</label><select id="search-collection" name="collection"><option value="">All collections</option>${collections.map(collection => `<option value="${escape(collection.id)}">${escape(collection.title)}</option>`).join('')}</select></div></form><p id="search-help" class="small-text">Results update as you type. Matches every word, including word beginnings, in descriptions, places and tags.</p><noscript><div class="empty-state"><h2>Search needs JavaScript</h2><p>You can browse every photograph in the <a href="/#collections">three collections</a> without it.</p></div></noscript><section class="search-results-section" aria-label="Search results"><div class="results-summary"><p id="search-status" role="status" aria-live="polite">Enter a search term or choose a collection.</p><p id="search-timing" class="search-timing"></p></div><div id="search-results" class="photo-grid"></div><div id="search-empty" class="empty-state"><span class="empty-state__mark" aria-hidden="true">⌕</span><h2>The archive is waiting.</h2><p>Start with a subject or browse a collection above.</p></div><nav id="search-pagination" class="search-pagination" aria-label="Search result pages" hidden><button type="button" id="search-previous" class="button button--light">← Previous</button><span id="search-page"></span><button type="button" id="search-next" class="button button--light">Next →</button></nav></section>` });
await page('404.html', { title: 'Photograph not found', content: '<section class="page-intro"><p class="eyebrow">Page not found</p><h1>Another frame awaits.</h1><p class="page-intro__description">This page is not part of the preview. Explore the selected collections to find your way back.</p><a class="button" href="/">View collections →</a></section>' });
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(resolve(output, '_headers'), `/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; img-src 'self' ${imageOrigins.join(' ')}; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n  Cache-Control: public, max-age=0, must-revalidate\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
console.log(`Built ${collections.length} collections, ${photos.length} photographs, homepage and search into ${output}`);
