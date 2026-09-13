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
const photosByCollection = new Map(collections.map(collection => [String(collection.id), []]));
for (const photo of photos) {
  const members = photosByCollection.get(String(photo.collectionId));
  if (!members) throw new Error(`Photograph ${photo.id} has no collection`);
  members.push(photo);
}
const collectionPhotos = collection => photosByCollection.get(String(collection.id)) || [];
const directoryCollections = [...collections].sort((a, b) => String(a.roll).localeCompare(String(b.roll), 'en', { numeric: true }));
const featuredIds = ['popes-visit', 'ireland-england', 'french-grand-prix'];
const featuredCollections = featuredIds.map(id => collectionById.get(id)).filter(Boolean);
if (!featuredCollections.length) featuredCollections.push(...directoryCollections.slice(0, 3));
const galleryPageSize = 48;
const directoryPageSize = 24;
const number = value => Number(value).toLocaleString('en-GB');
const directoryUrl = page => page > 1 ? `/collections/page/${page}/` : '/collections/';
const collectionUrl = (collection, page = 1) => `/collections/${encodeURIComponent(collection.id)}/${page > 1 ? `page/${page}/` : ''}`;
const directoryPages = new Map(directoryCollections.map((collection, index) => [String(collection.id), Math.floor(index / directoryPageSize) + 1]));
const paginator = (label, current, total, url) => {
  if (total <= 1) return '';
  const pages = [...new Set([1, current - 1, current, current + 1, total])].filter(page => page >= 1 && page <= total).sort((a, b) => a - b);
  const numbers = pages.map((page, index) => `${index && page - pages[index - 1] > 1 ? '<span class="pagination-gap" aria-hidden="true">…</span>' : ''}${page === current ? `<span class="page-number" aria-current="page" aria-label="Page ${page}">${page}</span>` : `<a class="page-number" href="${escape(url(page))}" aria-label="Page ${page}">${page}</a>`}`).join('');
  return `<nav class="browse-pagination" aria-label="${escape(label)}">${current > 1 ? `<a class="pagination-step" href="${escape(url(current - 1))}" rel="prev">← Previous</a>` : '<span class="pagination-step" aria-disabled="true">← Previous</span>'}<div class="pagination-pages">${numbers}</div>${current < total ? `<a class="pagination-step" href="${escape(url(current + 1))}" rel="next">Next →</a>` : '<span class="pagination-step" aria-disabled="true">Next →</span>'}</nav>`;
};
const imageOrigins = [...new Set(photos.map(photo => new URL(photo.imageBase).origin))];
const dateFormatter = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const date = value => {
  if (!value) return '';
  if (/^\d{4}$/.test(String(value))) return String(value);
  const parsed = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(parsed.valueOf()) ? String(value) : dateFormatter.format(parsed);
};
const title = photo => {
  const raw = String(photo.title || '').trim().replace(/\s*·\s*DSCF\d+.*$/i, '');
  if (raw && !/\.(?:tiff?|jpe?g|png|avif|webp)$/i.test(raw) && !/^[\d_-]+$/.test(raw)) return raw;
  return String(photo.description || collectionById.get(String(photo.collectionId))?.title || 'From the archive').split(/[\r\n]/)[0].slice(0, 160);
};
// Keep these source slots aligned with the wrapper, gaps and breakpoints in site.css.
const imageSizes = {
  photo: '(max-width: 700px) calc((100vw - 50px) / 2), (max-width: 960px) calc((100vw - 96px) / 2), (max-width: 1272px) calc((100vw - 120px) / 3), 384px',
  collection: '(max-width: 700px) calc(100vw - 36px), (max-width: 960px) calc((100vw - 112px) / 3), (max-width: 1272px) calc((100vw - 128px) / 3), 381.333333px',
  lead: '(max-width: 700px) calc(100vw - 36px), (max-width: 1272px) calc(100vw - 72px), 1200px',
  detail: '(max-width: 700px) calc(100vw - 36px), (max-width: 960px) calc(100vw - 72px), (max-width: 1272px) calc(72.222222vw - 78px), 840.666667px',
};
const image = (photo, { large = false, eager = false, highPriority = false, className = '', sizes } = {}) => {
  if (!sizes) throw new Error('Image source sizes must match its layout');
  if (!photo) throw new Error('Missing cover photograph');
  const base = escape(photo.imageBase.replace(/\/$/, ''));
  const width = Number(photo.width) || 1500;
  const height = Number(photo.height) || 1000;
  const variant = large ? 'large' : 'small';
  return `<picture${className ? ` class="${escape(className)}"` : ''}><source type="image/webp" srcset="${base}/thumb.webp 200w, ${base}/small.webp 800w${large ? `, ${base}/large.webp 1600w` : ''}" sizes="${escape(sizes)}"><source type="image/avif" srcset="${base}/thumb.avif 200w, ${base}/small.avif 800w${large ? `, ${base}/large.avif 1600w` : ''}" sizes="${escape(sizes)}"><img src="${base}/${variant}.webp" srcset="${base}/thumb.webp 200w, ${base}/small.webp 800w${large ? `, ${base}/large.webp 1600w` : ''}" sizes="${escape(sizes)}" width="${width}" height="${height}" alt="${escape(title(photo))}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${highPriority ? ' fetchpriority="high"' : ''}></picture>`;
};
const photoCard = (photo, index) => `<article class="photo-card"><a class="photo-card__link" href="/photos/${encodeURIComponent(photo.id)}/">${image(photo, { eager: index < 3, highPriority: index === 0, className: 'photo-card__image', sizes: imageSizes.photo })}<div class="photo-card__caption"><h3>${escape(title(photo))}</h3><p>${escape(photo.year || '')}</p></div></a></article>`;

const collectionCard = (collection, { index = 0, eager = false } = {}) => {
  const cover = photoById.get(String(collection.coverId)) || collectionPhotos(collection)[0];
  const description = String(collection.description || 'Photographs from the Brendan Mulvany archive.');
  const excerpt = description.length > 220 ? `${description.slice(0, 217).trimEnd()}…` : description;
  return `<article class="collection-card"><a href="${collectionUrl(collection)}">${image(cover, { eager: eager && index < 3, highPriority: eager && index === 0, className: 'collection-card__image', sizes: imageSizes.collection })}<div class="collection-card__meta"><span>Roll ${escape(collection.roll)}</span><span>${escape(String(collection.date || '').slice(0, 4))}</span></div><h3>${escape(collection.title)} <span aria-hidden="true">↗</span></h3><p>${escape(excerpt)}</p><span class="collection-card__count">${number(collectionPhotos(collection).length)} photographs · View collection</span></a></article>`;
};

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
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><meta name="description" content="${escape(description || 'Explore the Brendan Mulvany photographic archive.')}"><meta name="theme-color" content="#f6f5f1"><title>${escape(pageTitle)} — Brendan Mulvany</title><link rel="stylesheet" href="${css}">${imageOrigins.map(origin => `<link rel="preconnect" href="${escape(origin)}">`).join('')}${search ? `<script type="module" src="${js}"></script>` : ''}</head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="site-header wrapper"><a class="brand" href="/" aria-label="Brendan Mulvany archive home"><span>Brendan Mulvany</span><small>Photographic archive</small></a><nav aria-label="Main navigation"><a href="/collections/"${section === 'collections' ? ' aria-current="page"' : ''}>Collections</a><a href="/search/"${search ? ' aria-current="page"' : ''}>Search</a><a class="original-link" href="${escape(original)}">Original archive <span aria-hidden="true">↗</span></a></nav></header><div class="preview-strip wrapper"><span class="preview-badge">Archive preview</span><span>${number(collections.length)} collections · ${number(photos.length)} photographs</span></div><main id="main" class="wrapper">${content}</main><footer class="site-footer wrapper"><p>Photographs © Brendan Mulvany</p><p>The published photographic archive.</p><a href="${escape(original)}">Visit the original archive <span aria-hidden="true">↗</span></a></footer></body></html>`;
async function page(path, props) {
  const target = resolve(output, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, layout(props));
}

const leadCollection = featuredCollections[0];
const lead = photoById.get(String(leadCollection.coverId)) || collectionPhotos(leadCollection)[0];
await page('index.html', { title: 'Photographic archive', section: 'home', content: `
<section class="intro"><p class="eyebrow">The Brendan Mulvany archive</p><h1>Moments become<br><em>history.</em></h1><p class="intro__copy">On the touchline, in the crowd, beside the track. Discover Brendan Mulvany’s photographs, one frame at a time.</p><a class="text-link" href="/collections/">Explore the collections <span aria-hidden="true">↗</span></a></section>
<figure class="lead-photo"><a href="/photos/${encodeURIComponent(lead.id)}/" aria-label="View photograph: ${escape(title(lead))}">${image(lead, { large: true, eager: true, highPriority: true, className: 'lead-photo__image', sizes: imageSizes.lead })}</a><figcaption><span>${escape(leadCollection.title)}</span><span>${escape(date(leadCollection.date))}</span></figcaption></figure>
<section id="collections" class="collections-section"><div class="section-heading"><div><p class="eyebrow">Featured collections</p><h2>Start with a story.</h2></div><a class="small-text" href="/collections/">Browse all ${number(collections.length)} collections →</a></div><div class="collection-grid">${featuredCollections.map(collection => collectionCard(collection)).join('')}</div><a class="text-link" href="/collections/">Browse all ${number(collections.length)} collections <span aria-hidden="true">→</span></a></section>
<section class="search-invitation"><div><p class="eyebrow">Find a moment</p><h2>A person. A place. A memory.</h2><p>Search ${number(photos.length)} photographs from across the archive.</p></div><a class="button" href="/search/">Search the archive <span aria-hidden="true">↗</span></a></section>` });

const directoryPageCount = Math.max(1, Math.ceil(directoryCollections.length / directoryPageSize));
for (let pageNumber = 1; pageNumber <= directoryPageCount; pageNumber += 1) {
  const start = (pageNumber - 1) * directoryPageSize;
  const selected = directoryCollections.slice(start, start + directoryPageSize);
  await page(`${directoryUrl(pageNumber).slice(1)}index.html`, {
    title: `Collections${pageNumber > 1 ? ` — Page ${pageNumber}` : ''}`,
    section: 'collections',
    content: `<section class="page-intro"><p class="eyebrow">Browse the archive</p><h1>Every roll tells a story.</h1><p class="page-intro__description">Explore ${number(collections.length)} collections and ${number(photos.length)} photographs from Brendan Mulvany’s archive. Browse by roll, or search for a person, place or moment.</p><div class="collection-facts"><span>Collections ${number(start + 1)}–${number(start + selected.length)} of ${number(collections.length)}</span><span>Page ${pageNumber} of ${directoryPageCount}</span><a href="/search/">Search the archive →</a></div></section><section class="collection-grid collection-directory" aria-label="Archive collections">${selected.map((collection, index) => collectionCard(collection, { index, eager: true })).join('')}</section>${paginator('Collection directory pages', pageNumber, directoryPageCount, directoryUrl)}`,
  });
}

for (const collection of directoryCollections) {
  const selected = collectionPhotos(collection);
  const galleryPageCount = Math.max(1, Math.ceil(selected.length / galleryPageSize));
  const directoryBack = directoryUrl(directoryPages.get(String(collection.id)));
  for (let pageNumber = 1; pageNumber <= galleryPageCount; pageNumber += 1) {
    const start = (pageNumber - 1) * galleryPageSize;
    const selectedPage = selected.slice(start, start + galleryPageSize);
    await page(`${collectionUrl(collection, pageNumber).slice(1)}index.html`, {
      title: `${collection.title}${pageNumber > 1 ? ` — Page ${pageNumber}` : ''}`,
      description: collection.description,
      section: 'collections',
      content: `<section class="page-intro"><a class="back-link" href="${directoryBack}">← All collections</a><p class="eyebrow">Collection / Roll ${escape(collection.roll)}</p><h1>${escape(collection.title)}</h1><p class="page-intro__description">${escape(collection.description)}</p><div class="collection-facts"><span>${escape(date(collection.date))}</span><span>${number(selected.length)} photographs</span><a href="/search/?collection=${encodeURIComponent(collection.id)}">Search this collection →</a></div>${galleryPageCount > 1 ? `<p class="gallery-page-summary small-text">Photographs ${number(start + 1)}–${number(start + selectedPage.length)} of ${number(selected.length)} · Page ${pageNumber} of ${galleryPageCount}</p>` : ''}</section><section aria-label="Photographs in ${escape(collection.title)}" class="photo-grid">${selectedPage.map(photoCard).join('')}</section>${paginator(`Pages in ${collection.title}`, pageNumber, galleryPageCount, pageNumber => collectionUrl(collection, pageNumber))}`,
    });
  }
  for (const [index, photo] of selected.entries()) {
    const previous = selected[index - 1];
    const next = selected[index + 1];
    const galleryBack = collectionUrl(collection, Math.floor(index / galleryPageSize) + 1);
    const metadata = [['Collection', collection.title], ['Archive year', photo.year || date(photo.date)], ['Location', photo.location], ['Archive reference', `Roll ${collection.roll} / Photograph ${photo.id}`]].filter(([, value]) => value);
    await page(`photos/${photo.id}/index.html`, { title: title(photo), description: `A photograph from ${collection.title}${photo.year || collection.date ? `, ${photo.year || collection.date}` : ''}.`, content: `<div class="photo-navigation"><a class="back-link" href="${galleryBack}">← ${escape(collection.title)}</a><span>${number(index + 1)} / ${number(selected.length)}</span></div><article class="photo-detail"><figure class="photo-detail__figure">${image(photo, { large: true, eager: true, highPriority: true, className: 'photo-detail__image', sizes: imageSizes.detail })}</figure><div class="photo-detail__info"><p class="eyebrow">From the archive</p><h1>${escape(title(photo))}</h1><dl>${metadata.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>${photo.description ? `<details class="photo-description"><summary>Existing machine-generated description (may contain errors)</summary><p>${escape(photo.description)}</p></details>` : ''}${Array.isArray(photo.tags) && photo.tags.length ? `<div class="tags" aria-label="Search related subjects">${photo.tags.slice(0, 12).map(tag => `<a href="/search/?q=${encodeURIComponent(tag)}">${escape(tag)}</a>`).join('')}</div>` : ''}</div></article><nav class="frame-navigation" aria-label="Photographs in this collection">${previous ? `<a href="/photos/${previous.id}/" rel="prev">← Previous photograph</a>` : '<span>First photograph</span>'}<a href="${galleryBack}">View collection</a>${next ? `<a href="/photos/${next.id}/" rel="next">Next photograph →</a>` : '<span>Last photograph</span>'}</nav>` });
  }
}

await page('search/index.html', { title: 'Search the archive', search: true, content: `<section class="page-intro search-intro"><p class="eyebrow">Explore the details</p><h1>Find a moment.</h1><p class="page-intro__description">Search ${number(photos.length)} photographs across ${number(collections.length)} collections. Try a person, a place, a subject or a year.</p></section><form action="/search/" method="get" id="search-form" class="search-form" role="search"><div class="search-field"><label for="search-query">Search photographs</label><div class="search-input-row"><input id="search-query" type="search" name="q" placeholder="Try “Pope”, “football” or “1980”" autocomplete="off" maxlength="120" aria-describedby="search-help"><button class="button" type="submit">Search <span aria-hidden="true">↗</span></button></div></div><div class="collection-field"><label for="search-collection">Collection</label><select id="search-collection" name="collection"><option value="">All collections</option>${directoryCollections.map(collection => `<option value="${escape(collection.id)}">${escape(collection.title)} · Roll ${escape(collection.roll)}</option>`).join('')}</select></div></form><p id="search-help" class="small-text">Results update as you type. Matches every word, including word beginnings, in descriptions, places and tags.</p><noscript><div class="empty-state"><h2>Search needs JavaScript</h2><p>You can browse every photograph in the <a href="/collections/">collection directory</a> without it.</p></div></noscript><section class="search-results-section" aria-label="Search results"><div class="results-summary"><p id="search-status" role="status" aria-live="polite">Enter a search term or choose a collection.</p><p id="search-timing" class="search-timing"></p></div><div id="search-results" class="photo-grid" data-image-sizes="${escape(imageSizes.photo)}"></div><div id="search-empty" class="empty-state"><span class="empty-state__mark" aria-hidden="true">⌕</span><h2>The archive is waiting.</h2><p>Start with a subject or browse a collection above.</p></div><nav id="search-pagination" class="search-pagination" aria-label="Search result pages" hidden><button type="button" id="search-previous" class="button button--light">← Previous</button><span id="search-page"></span><button type="button" id="search-next" class="button button--light">Next →</button></nav></section>` });
await page('404.html', { title: 'Photograph not found', content: '<section class="page-intro"><p class="eyebrow">Page not found</p><h1>Another frame awaits.</h1><p class="page-intro__description">This page could not be found. Explore the collections to find your way back.</p><a class="button" href="/collections/">View collections →</a></section>' });
await writeFile(resolve(output, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
await writeFile(resolve(output, '_headers'), `/*\n  X-Robots-Tag: noindex, nofollow\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; img-src 'self' ${imageOrigins.join(' ')}; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n`);
console.log(`Built ${number(collections.length)} collections, ${number(photos.length)} photographs, ${directoryPageCount} collection directory pages, homepage and search into ${output}`);
