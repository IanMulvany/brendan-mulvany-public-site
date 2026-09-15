import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRedirects } from './redirects.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = resolve(root, 'dist');
const config = JSON.parse(await readFile(resolve(root, 'wrangler.jsonc'), 'utf8'));
const configuredOrigin = config.vars?.PUBLIC_ORIGIN;
if (typeof configuredOrigin !== 'string') throw new Error('Configure PUBLIC_ORIGIN before building the public site');
const originUrl = new URL(configuredOrigin);
if (!['http:', 'https:'].includes(originUrl.protocol) || originUrl.pathname !== '/' || originUrl.search || originUrl.hash || originUrl.username || originUrl.password) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without a path, query, fragment or credentials');
const publicOrigin = originUrl.origin;
const data = JSON.parse(await readFile(resolve(root, 'data/sample.json'), 'utf8'));
const { collections, photos } = data;
const rollPaths = new Set();
for (const collection of collections) {
  const roll = collection.roll;
  if (typeof roll !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(roll) || rollPaths.has(roll)) throw new Error('Collection roll paths must be valid and unique');
  rollPaths.add(roll);
}
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
const collectionByRoll = new Map(collections.map(collection => [collection.roll, collection]));
const photosByYear = new Map();
for (const photo of photos) {
  if (!/^\d{4}$/.test(photo.year)) continue;
  if (!photosByYear.has(photo.year)) photosByYear.set(photo.year, []);
  photosByYear.get(photo.year).push(photo);
}
const years = [...photosByYear.keys()].sort();
const batchHtml = await readFile(resolve(root, '..', 'public/batches/index.html'), 'utf8');
const batchMatch = batchHtml.match(/window\.__STATIC_DATA__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
if (!batchMatch) throw new Error('Published batch inventory is missing');
const batches = JSON.parse(batchMatch[1]).batches;
if (!Array.isArray(batches) || batches.some(batch => typeof batch.batch_name !== 'string' || !collectionByRoll.has(String(batch.roll_number)) || !Number.isSafeInteger(batch.count) || batch.count < 1)) throw new Error('Published batch inventory does not match the archive');
const featuredIds = ['popes-visit', 'ireland-england', 'french-grand-prix'];
const featuredCollections = featuredIds.map(id => collectionById.get(id)).filter(Boolean);
if (!featuredCollections.length) featuredCollections.push(...directoryCollections.slice(0, 3));
const galleryPageSize = 48;
const directoryPageSize = 24;
const number = value => Number(value).toLocaleString('en-GB');
const directoryUrl = page => page > 1 ? `/collections/page/${page}/` : '/collections/';
const collectionUrl = (collection, page = 1) => `/roll/${encodeURIComponent(collection.roll)}/${page > 1 ? `page/${page}/` : ''}`;
const yearUrl = (year, page = 1) => `/year/${year}/${page > 1 ? `page/${page}/` : ''}`;
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
const image = (photo, { large = false, eager = false, highPriority = false, className = '', sizes, collectionId } = {}) => {
  if (!sizes) throw new Error('Image source sizes must match its layout');
  if (!photo) throw new Error('Missing cover photograph');
  const base = escape(photo.imageBase.replace(/\/$/, ''));
  const width = Number(photo.width) || 1500;
  const height = Number(photo.height) || 1000;
  const variant = large ? 'large' : 'small';
  return `<picture${collectionId ? ` data-collection-id="${escape(collectionId)}"` : ''}${className ? ` class="${escape(className)}"` : ''}><source type="image/webp" srcset="${base}/thumb.webp 200w, ${base}/small.webp 800w${large ? `, ${base}/large.webp 1600w` : ''}" sizes="${escape(sizes)}"><source type="image/avif" srcset="${base}/thumb.avif 200w, ${base}/small.avif 800w${large ? `, ${base}/large.avif 1600w` : ''}" sizes="${escape(sizes)}"><img src="${base}/${variant}.webp" srcset="${base}/thumb.webp 200w, ${base}/small.webp 800w${large ? `, ${base}/large.webp 1600w` : ''}" sizes="${escape(sizes)}" width="${width}" height="${height}" alt="${escape(title(photo))}" loading="${eager ? 'eager' : 'lazy'}" decoding="async"${highPriority ? ' fetchpriority="high"' : ''}></picture>`;
};
const photoCard = (photo, index) => `<article class="photo-card"><a class="photo-card__link" href="/image/${encodeURIComponent(photo.id)}/">${image(photo, { eager: index < 3, highPriority: index === 0, className: 'photo-card__image', sizes: imageSizes.photo })}<div class="photo-card__caption"><h3>${escape(title(photo))}</h3><p>${escape(photo.year || '')}</p></div></a></article>`;

const collectionCard = (collection, { index = 0, eager = false } = {}) => {
  const cover = photoById.get(String(collection.coverId)) || collectionPhotos(collection)[0];
  const description = String(collection.description || 'Photographs from the Brendan Mulvany archive.');
  const excerpt = description.length > 220 ? `${description.slice(0, 217).trimEnd()}…` : description;
  return `<article class="collection-card"><a data-collection-id="${escape(collection.id)}" href="${collectionUrl(collection)}">${image(cover, { eager: eager && index < 3, highPriority: eager && index === 0, className: 'collection-card__image', sizes: imageSizes.collection, collectionId: collection.id })}<div class="collection-card__meta"><span>Roll ${escape(collection.roll)}</span><span>${escape(String(collection.date || '').slice(0, 4))}</span></div><h3>${escape(collection.title)} <span aria-hidden="true">↗</span></h3><p>${escape(excerpt)}</p><span class="collection-card__count">${number(collectionPhotos(collection).length)} photographs · View collection</span></a></article>`;
};
const leadFigure = collection => {
  const cover = photoById.get(String(collection.coverId)) || collectionPhotos(collection)[0];
  return `<figure class="lead-photo"><a data-collection-id="${escape(collection.id)}" data-collection-hero-link href="/image/${encodeURIComponent(cover.id)}/" aria-label="View photograph: ${escape(title(cover))}">${image(cover, { large: true, eager: true, highPriority: true, className: 'lead-photo__image', sizes: imageSizes.lead, collectionId: collection.id })}</a><figcaption><span>${escape(collection.title)}</span><span>${escape(date(collection.date))}</span></figcaption></figure>`;
};

await rm(output, { recursive: true, force: true });
await mkdir(resolve(output, 'assets'), { recursive: true });
async function asset(filename, replacements = {}) {
  let content = await readFile(resolve(root, 'static', filename), 'utf8');
  for (const [from, to] of Object.entries(replacements)) content = content.replaceAll(from, to);
  const hash = createHash('sha256').update(content).digest('hex').slice(0, 12);
  const [name, extension] = filename.split('.');
  const path = `/assets/${name}.${hash}.${extension}`;
  await writeFile(resolve(output, path.slice(1)), content);
  return path;
}
const css = await asset('site.css');
const js = await asset('search.js');
const interactiveCss = await asset('community.css');
const uiJs = await asset('ui.js');
const enhancements = {};
for (const module of ['auth', 'newsletter', 'community', 'admin']) enhancements[module] = await asset(`${module}.js`, { './ui.js': uiJs });
const catalog = JSON.stringify(directoryCollections.map(collection => {
  const cover = photoById.get(String(collection.coverId)) || collectionPhotos(collection)[0];
  return { id: collection.id, title: collection.title, roll: collection.roll, count: collectionPhotos(collection).length, coverId: cover.id, imageBase: cover.imageBase };
}));
const catalogPath = `/assets/collections.${createHash('sha256').update(catalog).digest('hex').slice(0, 12)}.json`;
await writeFile(resolve(output, catalogPath.slice(1)), catalog);
const homepageFragments = JSON.stringify(Object.fromEntries(collections.map(collection => [collection.id, { cardHtml: collectionCard(collection), leadHtml: leadFigure(collection) }])));
if (Buffer.byteLength(homepageFragments) > 1024 * 1024) throw new Error('Homepage fragment manifest exceeds 1 MiB');
await writeFile(resolve(output, 'homepage-fragments.json'), homepageFragments);
const layout = ({ title: pageTitle, description, content, canonical, noindex, socialPhoto, search = false, section = '', enhance = [] }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}<meta name="description" content="${escape(description || 'Explore the Brendan Mulvany photographic archive.')}"><meta name="theme-color" content="#f6f5f1"><title>${escape(pageTitle)} — Brendan Mulvany</title><link rel="canonical" href="${escape(canonical)}"><meta property="og:type" content="website"><meta property="og:site_name" content="Brendan Mulvany Photographic Archive"><meta property="og:title" content="${escape(pageTitle)} — Brendan Mulvany"><meta property="og:url" content="${escape(canonical)}"><meta property="og:description" content="${escape(description || 'Explore the Brendan Mulvany photographic archive.')}">${socialPhoto ? `<meta property="og:image" content="${escape(socialPhoto.imageBase.replace(/\/$/, ''))}/large.webp"><meta property="og:image:alt" content="${escape(title(socialPhoto))}">` : ''}<link rel="stylesheet" href="${css}">${enhance.length ? `<link rel="stylesheet" href="${interactiveCss}">` : ''}${imageOrigins.map(origin => `<link rel="preconnect" href="${escape(origin)}">`).join('')}${search ? `<script type="module" src="${js}"></script>` : ''}${enhance.map(module => `<script type="module" src="${enhancements[module]}"></script>`).join('')}</head>
<body><a class="skip-link" href="#main">Skip to content</a><header class="site-header wrapper"><a class="brand" href="/" aria-label="Brendan Mulvany archive home"><span>Brendan Mulvany</span><small>Photographic archive</small></a><nav aria-label="Main navigation"><a href="/collections/"${section === 'collections' ? ' aria-current="page"' : ''}>Collections</a><a href="/search/"${search ? ' aria-current="page"' : ''}>Search</a><a href="/account/"${section === 'account' ? ' aria-current="page"' : ''}>Account</a></nav></header><div class="archive-count wrapper">${number(collections.length)} collections · ${number(photos.length)} photographs</div><main id="main" class="wrapper">${content}</main><footer class="site-footer wrapper"><p>Photographs © Brendan Mulvany</p><p>The published photographic archive.</p><a href="/years/">Years</a><a href="/batches/">Scan batches</a><a href="/about/">About</a><a href="/newsletter/">Newsletter</a></footer></body></html>`;
const utilityPages = new Set(['/account/', '/admin/', '/search/', '/newsletter/', '/404.html']);
const sitemapUrls = [];
async function page(path, props) {
  const target = resolve(output, path);
  await mkdir(dirname(target), { recursive: true });
  const pathname = `/${path.replace(/index\.html$/, '')}`;
  const canonical = new URL(pathname, publicOrigin).href;
  const noindex = utilityPages.has(pathname);
  if (!noindex) sitemapUrls.push(canonical);
  const photoId = pathname.match(/^\/image\/(\d+)\//)?.[1];
  const roll = pathname.match(/^\/roll\/([^/]+)\//)?.[1];
  const year = pathname.match(/^\/year\/(\d{4})\//)?.[1];
  const collection = roll ? collectionByRoll.get(decodeURIComponent(roll)) : featuredCollections[0];
  const socialPhoto = photoId ? photoById.get(photoId) : year ? photosByYear.get(year)?.[0] : photoById.get(String(collection?.coverId)) || collectionPhotos(collection)[0];
  await writeFile(target, layout({ ...props, canonical, noindex, socialPhoto }));
}


function communityMarkup(photoId) {
  return `<section id="community" class="community-section" data-photo-id="${escape(photoId)}"><div class="community-topline"><div><p class="eyebrow">The people behind the photograph</p><h2>Memories and names.</h2></div><div class="like-control"><button type="button" id="photo-like" class="button button--light" aria-pressed="false" disabled>♡ Like</button><span id="photo-like-count" class="like-count">Loading likes…</span></div></div><p id="community-signin"><a class="text-link" href="/account/?returnTo=${encodeURIComponent(`/image/${photoId}/#community`)}">Sign in to like, comment or add a name</a></p><p class="field-help">Comments, names and notes are shared with other visitors. Saved names and notes become searchable within 30 seconds.</p><p id="community-status" class="form-status" role="status" aria-live="polite"></p><div class="community-columns"><section aria-labelledby="comments-heading"><h3 id="comments-heading">Comments</h3><form id="comment-form" class="community-form" hidden><label for="comment-body">Share a memory or a detail<textarea id="comment-body" name="body" maxlength="2000" rows="4" required></textarea></label><button class="button" type="submit">Post comment</button></form><ol id="community-comments" class="community-list"><li class="community-empty">Loading comments…</li></ol></section><section aria-labelledby="annotations-heading"><h3 id="annotations-heading">Names in this photograph</h3><form id="annotation-form" class="community-form" hidden><p class="annotation-instructions">Draw around a person above, or use the area controls. Positions are measured from the top-left of the photograph.</p><fieldset class="region-fields"><legend>Area in percent of the photograph</legend><label>Left (%)<input type="number" name="x" value="10" min="0" max="99" step="0.01" required></label><label>Top (%)<input type="number" name="y" value="10" min="0" max="99" step="0.01" required></label><label>Width (%)<input type="number" name="width" value="20" min="1" max="100" step="0.01" required></label><label>Height (%)<input type="number" name="height" value="20" min="1" max="100" step="0.01" required></label></fieldset><label for="annotation-name">Person’s name<input id="annotation-name" name="name" maxlength="120" required></label><label for="annotation-note">A note (optional)<textarea id="annotation-note" name="note" maxlength="500" rows="3"></textarea></label><p id="annotation-status" class="form-status" role="status" aria-live="polite"></p><div class="form-actions"><button type="submit" id="annotation-save" class="button" disabled>Save name</button><button type="button" id="annotation-clear" class="quiet-button">Clear area</button><button type="button" id="annotation-cancel" class="quiet-button">Cancel</button></div></form><ol id="community-annotations" class="community-list"><li class="community-empty">Loading names…</li></ol></section></div><button id="community-more" class="button button--light" type="button" hidden>Load more contributions</button><noscript><p class="community-noscript">JavaScript is needed for likes, comments and named areas. You can continue browsing every photograph without it.</p></noscript></section>`;
}
function codeForm(prefix) {
  return `<form id="${prefix}-verify" class="member-form" hidden><p class="field-help">Enter the code sent to <span id="${prefix}-email-label" class="verification-email"></span>. Codes expire after 15 minutes.</p><label for="${prefix}-code">Eight-digit verification code<input id="${prefix}-code" name="code" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" minlength="8" maxlength="8" required></label><button class="button" type="submit">Verify email</button><div class="form-actions"><button id="${prefix}-resend" type="button" class="quiet-button" disabled>Resend code</button><button id="${prefix}-change" type="button" class="quiet-button">Use a different email</button></div></form>`;
}
const consentLabel = '<label class="check-label"><input type="checkbox" name="consent" required><span>I would like to receive news and stories from the Brendan Mulvany archive by email. I can unsubscribe at any time.</span></label>';

await page('index.html', { title: 'Photographic archive', section: 'home', content: `
<section class="intro"><p class="eyebrow">The Brendan Mulvany archive</p><h1>Moments become<br><em>history.</em></h1><p class="intro__copy">On the touchline, in the crowd, beside the track. Discover Brendan Mulvany’s photographs, one frame at a time.</p><a class="text-link" href="/collections/">Explore the collections <span aria-hidden="true">↗</span></a></section>
<div id="homepage-lead">${leadFigure(featuredCollections[0])}</div>
<section id="collections" class="collections-section"><div class="section-heading"><div><p class="eyebrow">Featured collections</p><h2>Start with a story.</h2></div><a class="small-text" href="/collections/">Browse all ${number(collections.length)} collections →</a></div><div id="homepage-collections" class="collection-grid">${featuredCollections.map(collection => collectionCard(collection)).join('')}</div><a class="text-link" href="/collections/">Browse all ${number(collections.length)} collections <span aria-hidden="true">→</span></a></section>
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
    await page(`image/${photo.id}/index.html`, { enhance: ['community'], title: title(photo), description: `A photograph from ${collection.title}${photo.year || collection.date ? `, ${photo.year || collection.date}` : ''}.`, content: `<div class="photo-navigation"><a class="back-link" href="${galleryBack}">← ${escape(collection.title)}</a><span>${number(index + 1)} / ${number(selected.length)}</span></div><article class="photo-detail" data-photo-id="${escape(photo.id)}"><figure class="photo-detail__figure"><div class="annotation-stage">${image(photo, { large: true, eager: true, highPriority: true, className: 'photo-detail__image', sizes: imageSizes.detail })}<svg id="annotation-overlay" class="annotation-overlay" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="annotation-toolbar"><button type="button" id="annotation-begin" class="button button--light" aria-pressed="false" disabled>Draw an area and add a name</button><button type="button" id="annotation-manual" class="quiet-button" disabled>Use area controls</button><label><input id="annotation-visible" type="checkbox" checked> Show names</label></div></figure><div class="photo-detail__info"><p class="eyebrow">From the archive</p><h1>${escape(title(photo))}</h1><dl>${metadata.map(([key, value]) => `<div><dt>${escape(key)}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>${photo.description ? `<details class="photo-description"><summary>Existing machine-generated description (may contain errors)</summary><p>${escape(photo.description)}</p></details>` : ''}${Array.isArray(photo.tags) && photo.tags.length ? `<div class="tags" aria-label="Search related subjects">${photo.tags.slice(0, 12).map(tag => `<a href="/search/?q=${encodeURIComponent(tag)}">${escape(tag)}</a>`).join('')}</div>` : ''}</div></article><nav class="frame-navigation" aria-label="Photographs in this collection">${previous ? `<a href="/image/${previous.id}/" rel="prev">← Previous photograph</a>` : '<span>First photograph</span>'}<a href="${galleryBack}">View collection</a>${next ? `<a href="/image/${next.id}/" rel="next">Next photograph →</a>` : '<span>Last photograph</span>'}</nav>${communityMarkup(photo.id)}` });
  }
}

await page('years/index.html', { title: 'Browse by year', content: `<section class="page-intro"><p class="eyebrow">Through the years</p><h1>A year at a time.</h1><p class="page-intro__description">Explore photographs by their recorded archive year. Dates follow the published catalogue and may contain errors.</p></section><section class="collection-grid" aria-label="Archive years">${years.map((year, index) => {
  const members = photosByYear.get(year);
  return `<article class="collection-card"><a href="${yearUrl(year)}">${image(members[0], { eager: index < 3, highPriority: index === 0, className: 'collection-card__image', sizes: imageSizes.collection })}<h3>${escape(year)} <span aria-hidden="true">↗</span></h3><span class="collection-card__count">${number(members.length)} photographs · View year</span></a></article>`;
}).join('')}</section>` });
for (const year of years) {
  const members = photosByYear.get(year);
  const pageCount = Math.ceil(members.length / galleryPageSize);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const start = (pageNumber - 1) * galleryPageSize;
    const selectedPage = members.slice(start, start + galleryPageSize);
    await page(`${yearUrl(year, pageNumber).slice(1)}index.html`, { title: `${year} photographs${pageNumber > 1 ? ` — Page ${pageNumber}` : ''}`, content: `<section class="page-intro"><a class="back-link" href="/years/">← All years</a><p class="eyebrow">From the archive</p><h1>${escape(year)}</h1><p class="page-intro__description">${number(members.length)} photographs catalogued under ${escape(year)}. Dates follow the published archive and may contain errors.</p><p class="gallery-page-summary small-text">Photographs ${number(start + 1)}–${number(start + selectedPage.length)} of ${number(members.length)} · Page ${pageNumber} of ${pageCount}</p></section><section class="photo-grid" aria-label="Photographs catalogued under ${escape(year)}">${selectedPage.map(photoCard).join('')}</section>${paginator(`Photographs from ${year}`, pageNumber, pageCount, pageNumber => yearUrl(year, pageNumber))}` });
  }
}
await page('batches/index.html', { title: 'Scan batches', content: `<section class="page-intro"><p class="eyebrow">The archive on film</p><h1>From scan to collection.</h1><p class="page-intro__description">Browse ${number(batches.length)} published scan batches. Each batch links to its associated roll.</p></section><section class="collection-grid" aria-label="Published scan batches">${batches.map(batch => {
  const collection = collectionByRoll.get(String(batch.roll_number));
  return `<article class="collection-card"><a href="${collectionUrl(collection)}"><h3>${escape(batch.batch_name)} <span aria-hidden="true">↗</span></h3><p>${escape(collection.title)}</p><span class="collection-card__count">Roll ${escape(batch.roll_number)} · ${number(batch.count)} photographs in this batch</span></a></article>`;
}).join('')}</section>` });
await page('about/index.html', { title: 'About the archive', content: `<section class="page-intro"><p class="eyebrow">Brendan Mulvany</p><h1>About this archive.</h1><p class="page-intro__description">This is the Brendan Mulvany Photo Archive. Explore the photographs by collection, year or scan batch.</p><div class="collection-facts"><a href="/collections/">Browse collections →</a><a href="/years/">Browse years →</a><a href="/batches/">Browse scan batches →</a></div></section>` });

await page('search/index.html', { title: 'Search the archive', search: true, content: `<section class="page-intro search-intro"><p class="eyebrow">Explore the details</p><h1>Find a moment.</h1><p class="page-intro__description">Search ${number(photos.length)} photographs across ${number(collections.length)} collections. Try a person, a place, a subject or a year.</p></section><form action="/search/" method="get" id="search-form" class="search-form" role="search"><div class="search-field"><label for="search-query">Search photographs</label><div class="search-input-row"><input id="search-query" type="search" name="q" placeholder="Try “Pope”, “football” or “1980”" autocomplete="off" maxlength="120" aria-describedby="search-help"><button class="button" type="submit">Search <span aria-hidden="true">↗</span></button></div></div><div class="collection-field"><label for="search-collection">Collection</label><select id="search-collection" name="collection"><option value="">All collections</option>${directoryCollections.map(collection => `<option value="${escape(collection.id)}">${escape(collection.title)} · Roll ${escape(collection.roll)}</option>`).join('')}</select></div></form><p id="search-help" class="small-text">Results update as you type. Matches every word, including word beginnings, in archive descriptions, places, tags, and names and notes added by visitors.</p><noscript><div class="empty-state"><h2>Search needs JavaScript</h2><p>You can browse every photograph in the <a href="/collections/">collection directory</a> without it.</p></div></noscript><section class="search-results-section" aria-label="Search results"><div class="results-summary"><p id="search-status" role="status" aria-live="polite">Enter a search term or choose a collection.</p><p id="search-timing" class="search-timing"></p></div><div id="search-results" class="photo-grid" data-image-sizes="${escape(imageSizes.photo)}"></div><div id="search-empty" class="empty-state"><span class="empty-state__mark" aria-hidden="true">⌕</span><h2>The archive is waiting.</h2><p>Start with a subject or browse a collection above.</p></div><nav id="search-pagination" class="search-pagination" aria-label="Search result pages" hidden><button type="button" id="search-previous" class="button button--light">← Previous</button><span id="search-page"></span><button type="button" id="search-next" class="button button--light">Next →</button></nav></section>` });
await page('account/index.html', { title: 'Your account', section: 'account', enhance: ['auth'], content: `<div class="member-page"><section class="page-intro"><p class="eyebrow">A shared history</p><h1>Your place in the archive.</h1><p class="page-intro__description">Sign in or create an account to share memories, like photographs and add the names you recognise.</p></section><section id="account-guest" class="member-card"><h2>Sign in with your email.</h2><p>We’ll send a code to verify your address. No password to remember.</p><form id="account-request" class="member-form"><label for="account-email">Email address<input id="account-email" type="email" name="email" autocomplete="email" maxlength="254" required></label><label for="account-display-name">Display name (for a new account)<input id="account-display-name" name="displayName" autocomplete="nickname" maxlength="80"><span class="field-help">This name appears beside your comments and contributions.</span></label><button class="button" type="submit">Send verification code</button></form>${codeForm('account')}<p id="account-status" class="form-status" role="status" aria-live="polite"></p></section><section id="account-profile" class="member-card" hidden><h2>Your account</h2><p id="profile-email" class="member-email"></p><form id="profile-form" class="member-form"><label for="profile-name">Your public display name<input id="profile-name" name="displayName" maxlength="80" required autocomplete="nickname"></label><button type="submit" class="button">Save display name</button></form><p id="profile-status" class="form-status" role="status" aria-live="polite"></p><div class="member-actions"><a id="account-return" class="text-link" href="/" hidden>Return to the photograph →</a><a id="account-admin" class="text-link" href="/admin/" hidden>Administration →</a><a class="text-link" href="/newsletter/">Newsletter preferences →</a><button id="account-logout" class="quiet-button" type="button">Sign out</button></div></section><noscript><p class="community-noscript">JavaScript is needed to sign in and manage your account. Browsing the archive remains available without an account.</p></noscript></div>` });
await page('newsletter/index.html', { title: 'Archive newsletter', enhance: ['newsletter'], content: `<div class="member-page"><section class="page-intro"><p class="eyebrow">Keep in touch</p><h1>Stories worth returning to.</h1><p class="page-intro__description">Receive news and stories from the Brendan Mulvany photographic archive.</p></section><section id="newsletter-guest" class="member-card"><h2>Join the newsletter.</h2><p>Confirm your email address with a code. Joining the newsletter does not create an archive account.</p><form id="newsletter-request" class="member-form"><label for="newsletter-email">Email address<input id="newsletter-email" type="email" name="email" autocomplete="email" maxlength="254" required></label><label for="newsletter-name">Your name (optional)<input id="newsletter-name" name="displayName" autocomplete="name" maxlength="80"></label>${consentLabel}<button type="submit" class="button">Confirm my email</button></form>${codeForm('newsletter')}<p id="newsletter-status" class="form-status" role="status" aria-live="polite"></p></section><section id="newsletter-member" class="member-card" hidden><h2>Your newsletter preferences</h2><p id="newsletter-member-email" class="member-email"></p><p id="newsletter-member-status" class="form-status" role="status" aria-live="polite"></p><form id="newsletter-member-form" class="member-form">${consentLabel}<button class="button" type="submit">Subscribe to archive news</button></form><button id="newsletter-unsubscribe" type="button" class="quiet-button" hidden>Unsubscribe from the newsletter</button></section><noscript><p class="community-noscript">JavaScript is needed to confirm and manage a newsletter subscription.</p></noscript></div>` });
await page('admin/index.html', { title: 'Archive administration', enhance: ['admin'], content: `<section class="page-intro"><p class="eyebrow">Archive administration</p><h1>Care for the archive.</h1><p id="admin-access" class="page-intro__description">Checking your account…</p><a id="admin-signin" class="text-link" href="/account/?returnTo=%2Fadmin%2F">Sign in →</a><p id="admin-status" class="form-status" role="status" aria-live="polite"></p></section><div id="admin-content" data-collections="${catalogPath}" hidden><nav class="admin-tabs" aria-label="Administration sections"><a href="#admin-users-section">Members</a><a href="#admin-activity-section">Activity</a><a href="#admin-homepage-section">Homepage albums</a><a href="#admin-covers-section">Collection covers</a><a href="#admin-newsletter-section">Newsletter</a></nav><section id="admin-summary" class="admin-summary" aria-label="Archive activity summary"></section><section id="admin-users-section" class="admin-section"><h2>Members</h2><p>Suspended members cannot sign in or add contributions. Existing comments and names can be reviewed on their photograph pages.</p><ul id="admin-users" class="admin-list"></ul><button id="admin-users-more" class="button button--light" type="button" hidden>Load more members</button></section><section id="admin-activity-section" class="admin-section"><h2>Recent activity</h2><p>Open a photograph to review a contribution in context. Administrators can hide comments and names beside the contribution.</p><ul id="admin-activity" class="admin-list"></ul><button id="admin-activity-more" class="button button--light" type="button" hidden>Load more activity</button></section><section id="admin-homepage-section" class="admin-section"><h2>Homepage albums</h2><p>Choose up to six albums and put them in the order visitors will see them. The first album supplies the large homepage photograph, using its collection cover.</p><div class="homepage-picker"><label class="admin-label" for="admin-homepage-collection">Album to add<select id="admin-homepage-collection" class="admin-select" disabled><option value="">Choose an album</option></select></label><button id="admin-homepage-add" class="button button--light" type="button" disabled>Add album</button></div><p id="admin-homepage-count" class="field-help"></p><ol id="admin-homepage-list" class="homepage-albums" aria-label="Selected homepage albums"></ol><button id="admin-homepage-save" class="button" type="button" disabled>Save homepage albums</button><p id="admin-homepage-status" class="form-status" role="status" aria-live="polite">Loading homepage albums…</p></section><section id="admin-covers-section" class="admin-section"><h2>Collection covers</h2><p>Choose a photograph from the collection, then save it as the cover.</p><label class="admin-label" for="admin-collection">Collection<select id="admin-collection" class="admin-select"><option value="">Choose a collection</option></select></label><p id="admin-hero-status" class="form-status" role="status" aria-live="polite"></p><div id="admin-hero-grid" class="hero-grid"></div><button id="admin-hero-save" class="button" type="button" disabled>Save collection cover</button></section><section id="admin-newsletter-section" class="admin-section"><h2>Newsletter subscribers</h2><p class="admin-integration">Email delivery integration is not connected yet. Confirmed subscriptions and consent are saved here.</p><ul id="admin-subscribers" class="admin-list"></ul><button id="admin-subscribers-more" class="button button--light" type="button" hidden>Load more subscribers</button></section></div><noscript><p class="community-noscript">JavaScript and an administrator account are needed to manage the archive.</p></noscript>` });

await page('404.html', { title: 'Photograph not found', content: '<section class="page-intro"><p class="eyebrow">Page not found</p><h1>Another frame awaits.</h1><p class="page-intro__description">This page could not be found. Explore the collections to find your way back.</p><a class="button" href="/collections/">View collections →</a></section>' });
await writeFile(resolve(output, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.map(url => `  <url><loc>${escape(url)}</loc></url>`).join('\n')}\n</urlset>\n`);
await writeFile(resolve(output, 'robots.txt'), `User-agent: *\nAllow: /\n${['/api/', '/account/', '/admin/', '/search/', '/newsletter/', '/homepage-fragments.json'].map(path => `Disallow: ${path}`).join('\n')}\n\nSitemap: ${publicOrigin}/sitemap.xml\n`);
await writeFile(resolve(output, '_redirects'), buildRedirects(collections, photos, galleryPageSize));
await writeFile(resolve(output, '_headers'), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=()\n  Content-Security-Policy: default-src 'self'; img-src 'self' ${imageOrigins.join(' ')}; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n${[...utilityPages].map(path => `${path.endsWith('/') ? `${path}*` : path}\n  X-Robots-Tag: noindex, nofollow`).join('\n\n')}\n\n/api/*\n  X-Robots-Tag: noindex, nofollow\n\n/homepage-fragments.json\n  X-Robots-Tag: noindex, nofollow\n`);
console.log(`Built ${number(collections.length)} collections, ${number(photos.length)} photographs, ${directoryPageCount} collection directory pages, homepage and search into ${output}`);
