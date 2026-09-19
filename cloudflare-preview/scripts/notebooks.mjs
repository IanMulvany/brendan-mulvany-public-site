import {createHash} from 'node:crypto';
import {copyFile, mkdir, readFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const pageUrl = page => `/notebooks/${page.id}/`;
const rollUrl = collection => `/roll/${encodeURIComponent(collection.roll)}/`;
const mediaPath = value => typeof value === 'string' && /^\/notebooks\/media\/[a-f0-9]{16,64}(?:-thumb)?\.webp$/.test(value);
function validPolygon(polygon) {
  if (polygon === null) return true;
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 12
    || !polygon.every(point => Array.isArray(point) && point.length === 2 && point.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1))) return false;
  const area = polygon.reduce((sum, [x, y], index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + x * next[1] - y * next[0];
  }, 0);
  return Math.abs(area) > .000001;
}

export function notebookModel(data, collections) {
  if (data.version !== 1 || !Array.isArray(data.pages)) throw new Error('Unsupported notebook index');
  const collectionByRoll = new Map(collections.map(collection => [String(collection.roll), collection]));
  const ids = new Set(), backlinks = new Map();
  const pages = data.pages.map(source => {
    if (!/^img-\d{4,8}$/.test(source.id) || ids.has(source.id) || !/^IMG_\d{4,8}\.jpeg$/i.test(source.sourceImage)
      || !mediaPath(source.image) || !mediaPath(source.thumbnail)
      || !Number.isSafeInteger(source.width) || !Number.isSafeInteger(source.height) || source.width < 1 || source.height < 1
      || !Array.isArray(source.entries)) throw new Error(`Invalid notebook page: ${source.id}`);
    ids.add(source.id);
    const groups = new Map();
    for (const entry of source.entries) {
      if (typeof entry.id !== 'string' || !Array.isArray(entry.rolls) || !entry.rolls.every(roll => typeof roll === 'string')
        || entry.method !== 'verified' || !validPolygon(entry.polygon)) throw new Error(`Invalid reviewed notebook entry on ${source.id}`);
      const targets = entry.rolls.map(roll => collectionByRoll.get(roll)).filter(Boolean);
      if (!targets.length) continue;
      // Shared physical rows get one hotspot and a choice of collections,
      // rather than overlapping links that make only one roll reachable.
      const key = entry.polygon ? JSON.stringify(entry.polygon) : `entry:${entry.id}`;
      if (!groups.has(key)) groups.set(key, {id: `entry-${createHash('sha256').update(source.id + key).digest('hex').slice(0, 12)}`,
        polygon: entry.polygon, targets: [], notes: []});
      const group = groups.get(key);
      if (typeof entry.note === 'string' && entry.note && !group.notes.includes(entry.note)) group.notes.push(entry.note);
      for (const target of targets) if (!group.targets.some(item => item.roll === target.roll)) group.targets.push(target);
    }
    const orderedGroups = [...groups.values()].sort((a, b) =>
      (a.polygon ? Math.min(...a.polygon.map(point => point[1])) : 2)
      - (b.polygon ? Math.min(...b.polygon.map(point => point[1])) : 2));
    const page = {...source, book: String(source.book || 'unassigned'), groups: orderedGroups};
    page.targets = [...new Map(page.groups.flatMap(group => group.targets).map(collection => [collection.roll, collection])).values()];
    for (const group of page.groups) for (const collection of group.targets) {
      if (!backlinks.has(collection.roll)) backlinks.set(collection.roll, []);
      backlinks.get(collection.roll).push({page, group});
    }
    return page;
  });
  const books = [...new Set(pages.map(page => page.book))];
  return {pages, books, backlinks, linkedPages: pages.filter(page => page.targets.length), linkedRolls: backlinks.size};
}

export async function loadNotebooks(root, collections, output) {
  let data;
  try { data = JSON.parse(await readFile(resolve(root, 'static/notebooks/index.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  const model = notebookModel(data, collections);
  const files = new Set(model.pages.flatMap(page => [page.image, page.thumbnail]));
  for (const file of files) {
    const target = resolve(output, file.slice(1));
    await mkdir(dirname(target), {recursive: true});
    await copyFile(resolve(root, 'static', file.slice(1)), target);
  }
  return model;
}

const bookLabel = book => /^\d+$/.test(book) ? `Notebook ${book}` : 'Covers and notes';
const countLabel = page => page.targets.length ? `${page.targets.length} published ${page.targets.length === 1 ? 'roll' : 'rolls'}` : 'No published rolls linked yet';
const thumbnail = page => `<img src="${escape(page.thumbnail)}" width="${page.width}" height="${page.height}" alt="${escape(page.title)}" loading="lazy" decoding="async">`;
const card = page => `<article class="notebook-card" data-notebook-card data-book="${escape(page.book)}" data-linked="${page.targets.length ? 'true' : 'false'}" data-search="${escape([page.sourceImage, page.title, ...page.targets.flatMap(c => [c.roll, c.title])].join(' ').toLowerCase())}"><a href="${pageUrl(page)}"><div class="notebook-card__image">${thumbnail(page)}<span class="notebook-card__badge${page.targets.length ? ' is-linked' : ''}">${escape(countLabel(page))}</span></div><p class="eyebrow">${escape(bookLabel(page.book))}</p><h2>${escape(page.sourceImage.replace(/\.jpeg$/i, ''))} <span aria-hidden="true">↗</span></h2>${page.targets.length ? `<p class="notebook-card__rolls">Rolls ${page.targets.map(c => escape(c.roll)).join(' · ')}</p>` : '<p class="notebook-card__rolls">Explore the original page</p>'}</a></article>`;

export function notebookDirectory(model) {
  const selected = [...model.linkedPages, ...model.pages.filter(page => !page.targets.length)];
  return `<section class="page-intro notebook-intro"><a class="back-link" href="/collections/">← All collections</a><p class="eyebrow">A special collection · The roll notebooks</p><h1>Every photograph<br>began with a note.</h1><p class="page-intro__description">Browse Brendan’s handwritten index. Highlighted rows open the photographs published from that roll. Follow the same link back from a collection to see its original notebook entry.</p><div class="notebook-totals"><span><strong>${model.pages.length}</strong> notebook photographs</span><span><strong>${model.linkedPages.length}</strong> pages with linked rolls</span><span><strong>${model.linkedRolls}</strong> collections connected</span></div></section>
  <form class="notebook-filters" id="notebook-filter-form" role="search"><label for="notebook-query">Find a published roll or page<input type="search" id="notebook-query" placeholder="Try 3071, Pope or IMG_6238" maxlength="120" autocomplete="off"></label><label for="notebook-book">Notebook<select id="notebook-book"><option value="all">All notebooks</option>${model.books.map(book => `<option value="${escape(book)}">${escape(bookLabel(book))}</option>`).join('')}</select></label><label for="notebook-view">Show<select id="notebook-view"><option value="linked">Pages with published rolls</option><option value="all">All notebook photographs</option></select></label></form>
  <p class="notebook-results small-text" id="notebook-results" role="status" aria-live="polite">${model.pages.length} notebook photographs. Pages with published rolls are shown first.</p><noscript><p class="small-text">All notebook photographs are shown below. Page links and highlighted rows work without JavaScript.</p></noscript><section class="notebook-grid" aria-label="Notebook photographs">${selected.map(card).join('')}</section><p id="notebook-empty" class="empty-state" hidden>No pages match. Try another roll or choose all notebook photographs.</p>`;
}

export function notebookBacklinks(model, collection) {
  const links = model?.backlinks.get(collection.roll) || [];
  if (!links.length) return '';
  return `<aside class="notebook-backlink" aria-label="Original notebook entry"><a href="${pageUrl(links[0].page)}#${links[0].group.id}">${thumbnail(links[0].page)}<span><span class="eyebrow">From the original notebook</span><strong>See roll ${escape(collection.roll)} in Brendan’s index <span aria-hidden="true">↗</span></strong><span>${escape(bookLabel(links[0].page.book))} · ${escape(links[0].page.sourceImage)}</span></span></a>${links.length > 1 ? `<div class="notebook-other-sources">Other notebook entries: ${links.slice(1).map(link => `<a href="${pageUrl(link.page)}#${link.group.id}">${escape(link.page.sourceImage)}</a>`).join(' · ')}</div>` : ''}</aside>`;
}

export function notebookInvitation(model) {
  if (!model?.pages.length) return '';
  const cover = model.linkedPages.find(page => page.id === 'img-6238') || model.linkedPages[0] || model.pages[0];
  return `<aside class="notebook-invitation"><a href="/notebooks/">${thumbnail(cover)}<span><span class="eyebrow">A special collection</span><strong>The roll notebooks</strong><span>Explore the handwritten index and follow highlighted rows to the photographs.</span></span><span aria-hidden="true">↗</span></a></aside>`;
}

export function notebookPage(page, model) {
  const index = model.pages.indexOf(page), previous = model.pages[index - 1], next = model.pages[index + 1];
  const regions = page.groups.filter(group => group.polygon).map(group => {
    const label = group.targets.length === 1 ? `Open roll ${group.targets[0].roll}: ${group.targets[0].title}` : `Choose from rolls ${group.targets.map(c => c.roll).join(', ')}`;
    const href = group.targets.length === 1 ? rollUrl(group.targets[0]) : `#${group.id}`;
    return `<a href="${escape(href)}" class="notebook-region" data-notebook-region="${group.id}" tabindex="0" role="link" aria-label="${escape(label)}"><title>${escape(label)}</title><polygon points="${group.polygon.map(([x, y]) => `${(x * 1000).toFixed(3)},${(y * 1000).toFixed(3)}`).join(' ')}"/></a>`;
  }).join('');
  const entries = page.groups.map(group => `<li class="notebook-entry" id="${group.id}" data-notebook-entry="${group.id}"><span class="notebook-entry__status">${group.polygon ? 'Highlighted in the notebook' : 'Recorded source page'}</span>${group.targets.map(collection => `<a href="${rollUrl(collection)}"><span class="notebook-entry__roll">Roll ${escape(collection.roll)} <span aria-hidden="true">↗</span></span><strong>${escape(collection.title)}</strong></a>`).join('')}${group.notes.map(note => `<p class="notebook-entry__note">${escape(note)}</p>`).join('')}</li>`).join('');
  return `<nav class="photo-navigation" aria-label="Notebook pages"><a class="back-link" href="/notebooks/">← The roll notebooks</a><span>${index + 1} / ${model.pages.length}</span></nav><section class="notebook-page-intro"><div><p class="eyebrow">${escape(bookLabel(page.book))} · Original index</p><h1>${escape(page.sourceImage.replace(/\.jpeg$/i, ''))}</h1></div><p>${page.targets.length ? 'Select a highlighted row to open its photographs.' : 'No published rolls have been linked to this page yet.'}</p></section>
  <div class="notebook-workspace"><section class="notebook-photo" aria-label="Notebook photograph with linked rows"><div class="notebook-image-tools"><span class="notebook-legend"><i aria-hidden="true"></i> Published photographs</span><div id="notebook-zoom-controls" hidden><button type="button" id="notebook-zoom-out" aria-label="Zoom out">−</button><button type="button" id="notebook-zoom-reset">Fit page</button><button type="button" id="notebook-zoom-in" aria-label="Zoom in">+</button></div><a href="${escape(page.image)}" target="_blank" rel="noopener">Open large image ↗</a></div><p class="small-text notebook-zoom-help" id="notebook-zoom-status" role="status" aria-live="polite">Use the collection links below if a row is hard to select.</p><div class="notebook-viewport" id="notebook-viewport" tabindex="0" aria-label="Notebook image. Scroll to read the enlarged page."><figure class="notebook-canvas" id="notebook-canvas"><img src="${escape(page.image)}" width="${page.width}" height="${page.height}" alt="${escape(page.title)}. Highlighted rows link to published collections." fetchpriority="high" decoding="async"><svg class="notebook-regions" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label="Published rolls on this notebook page">${regions}</svg></figure></div></section><aside class="notebook-linked"><h2>From this page</h2><p>${escape(countLabel(page))}.</p>${entries ? `<ul class="notebook-entries">${entries}</ul>` : '<p class="notebook-unlinked">This notebook photograph is part of the archive. A link will appear when a published roll has a confirmed entry here.</p>'}<p class="notebook-match-note">Links follow the recorded roll numbers. Notebook wording and dates may differ from later collection metadata. Unmarked rows may still await scanning or a confirmed link.</p></aside></div><nav class="frame-navigation" aria-label="Browse notebook photographs">${previous ? `<a href="${pageUrl(previous)}" rel="prev">← Previous page</a>` : '<span>First page</span>'}<a href="/notebooks/">All notebook photographs</a>${next ? `<a href="${pageUrl(next)}" rel="next">Next page →</a>` : '<span>Last page</span>'}</nav>`;
}
