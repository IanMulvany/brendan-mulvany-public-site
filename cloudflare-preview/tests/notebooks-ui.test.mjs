import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../static/notebooks.js', import.meta.url), 'utf8');

// A small DOM surface executes the shipped script and its event handlers.
// Geometry is supplied as browser measurements, not copied application logic.
class Element {
  dataset = {}; attributes = new Map(); handlers = new Map(); classes = new Set();
  value = ''; hidden = false; disabled = false; textContent = ''; style = {};
  scrolled = [];
  classList = {
    toggle: (name, force) => force ? this.classes.add(name) : this.classes.delete(name),
    contains: name => this.classes.has(name),
  };
  addEventListener(name, callback) {
    const handlers = this.handlers.get(name) || [];
    handlers.push(callback); this.handlers.set(name, handlers);
  }
  fire(name, event = {}) { for (const callback of this.handlers.get(name) || []) callback(event); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  scrollIntoView(options) { this.scrolled.push(options); }
  set innerHTML(_value) { throw new Error('Notebook UI must not insert query/hash text as HTML'); }
}

function directory(search = '') {
  const selectors = ['notebook-filter-form', 'notebook-query', 'notebook-book', 'notebook-view', 'notebook-results', 'notebook-empty'];
  const nodes = Object.fromEntries(selectors.map(id => [id, new Element()]));
  nodes['notebook-book'].value = 'all';
  nodes['notebook-book'].options = ['all', '1', '2', 'unassigned'].map(value => ({ value }));
  nodes['notebook-view'].value = 'linked';
  const cards = [
    { book: '2', linked: 'true', search: 'img_6238.jpeg pope visit 3071' },
    { book: '1', linked: 'true', search: 'img_6100.jpeg family 100' },
    { book: '2', linked: 'false', search: 'img_6254.jpeg notebook 2' },
  ].map(dataset => Object.assign(new Element(), { dataset }));
  const urls = [];
  runInNewContext(source, {
    document: { querySelector: selector => nodes[selector.slice(1)] || null, querySelectorAll: () => cards },
    location: { search, pathname: '/notebooks/', hash: '' }, URLSearchParams,
    history: { replaceState: (_state, _unused, url) => urls.push(url) },
  });
  return { nodes, cards, urls };
}

function page({ hash = '', complete = true } = {}) {
  const ids = ['notebook-canvas', 'notebook-viewport', 'notebook-zoom-in', 'notebook-zoom-out',
    'notebook-zoom-reset', 'notebook-zoom-controls', 'notebook-zoom-status'];
  const nodes = Object.fromEntries(ids.map(id => [id, new Element()]));
  const viewport = nodes['notebook-viewport'];
  Object.assign(viewport, { clientWidth: 360, clientHeight: 480, scrollLeft: 0, scrollTop: 0 });
  const canvas = nodes['notebook-canvas'];
  canvas.style.width = '100%';
  Object.defineProperties(canvas, {
    clientWidth: { get: () => parseFloat(canvas.style.width) / 100 * 360 },
    clientHeight: { get: () => parseFloat(canvas.style.width) / 100 * 480 },
  });
  const image = Object.assign(new Element(), { complete });
  canvas.querySelector = selector => selector === 'img' ? image : null;
  const regions = ['entry-a', 'entry-b', 'entry-shared'].map((id, index) => {
    const region = new Element(); region.dataset.notebookRegion = id;
    region.attributes.set('href', index === 2 ? '#entry-shared' : `/roll/${3071 + index}/`);
    return region;
  });
  const entries = ['entry-a', 'entry-b', 'entry-shared'].map(id => {
    const entry = new Element(); entry.dataset.notebookEntry = id; return entry;
  });
  const window = new Element();
  const location = { search: '', pathname: '/notebooks/img-6238/', hash };
  runInNewContext(source, {
    document: {
      querySelector: selector => nodes[selector.slice(1)] || null,
      querySelectorAll: selector => selector === '[data-notebook-region]' ? regions : entries,
    }, window, location,
  });
  return { nodes, regions, entries, location, window, image, canvas, viewport };
}

test('notebook directory defaults to linked pages and filters query, book and all-pages together', () => {
  const { nodes, cards, urls } = directory();
  assert.deepEqual(cards.map(card => card.hidden), [false, false, true]);
  assert.match(nodes['notebook-results'].textContent, /^2 pages shown with published photographs/);
  nodes['notebook-query'].value = '  POPE 3071 ';
  nodes['notebook-query'].fire('input');
  assert.deepEqual(cards.map(card => card.hidden), [false, true, true]);
  assert.match(nodes['notebook-results'].textContent, /^1 page shown/);
  nodes['notebook-book'].value = '1'; nodes['notebook-book'].fire('change');
  assert.ok(cards.every(card => card.hidden));
  assert.equal(nodes['notebook-empty'].hidden, false);
  nodes['notebook-query'].value = 'IMG_6254'; nodes['notebook-book'].value = '2';
  nodes['notebook-view'].value = 'all'; nodes['notebook-view'].fire('change');
  assert.deepEqual(cards.map(card => card.hidden), [true, true, false]);
  assert.equal(nodes['notebook-empty'].hidden, true);
  assert.equal(urls.at(-1), '/notebooks/?q=IMG_6254&book=2&view=all');
  let prevented = false;
  nodes['notebook-filter-form'].fire('submit', { preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
});

test('directory restores valid URL filters while treating unknown and hostile query values as text', () => {
  const restored = directory('?q=6254&book=2&view=all');
  assert.deepEqual(restored.cards.map(card => card.hidden), [true, true, false]);
  const hostile = directory('?q=%3Cimg%20onerror%3Dalert(1)%3E&book=evil&view=evil');
  assert.equal(hostile.nodes['notebook-book'].value, 'all');
  assert.equal(hostile.nodes['notebook-view'].value, 'linked');
  assert.ok(hostile.cards.every(card => card.hidden));
  assert.match(hostile.urls.at(-1), /^\/notebooks\/\?q=%3Cimg/);
  assert.equal(directory('?q=' + 'a'.repeat(300)).nodes['notebook-query'].value.length, 120);
});

test('collection backlinks select the matching notebook row and wait for image load before scrolling', () => {
  const state = page({ hash: '#entry-b', complete: false });
  assert.equal(state.regions[1].scrolled.length, 0);
  state.image.fire('load');
  assert.equal(state.regions[1].scrolled.length, 1);
  assert.equal(state.regions[1].classes.has('is-selected'), true);
  assert.equal(state.entries[1].classes.has('is-selected'), true);
  assert.equal(state.regions[0].classes.has('is-selected'), false);
  state.location.hash = '#entry-a'; state.window.fire('hashchange');
  assert.equal(state.regions[0].classes.has('is-selected'), true);
  assert.equal(state.regions[1].classes.has('is-selected'), false);
  state.location.hash = '#<img onerror=alert(1)>'; state.window.fire('hashchange');
  assert.ok(state.regions.every(region => !region.classes.has('is-selected')));
});

test('keyboard focus and pointer hover connect entries with hotspots and retain the backlink selection', () => {
  const state = page({ hash: '#entry-a' });
  state.entries[1].fire('focusin');
  assert.equal(state.regions[1].classes.has('is-selected'), true);
  assert.equal(state.entries[1].classes.has('is-selected'), true);
  state.regions[1].fire('pointerleave');
  assert.equal(state.regions[0].classes.has('is-selected'), true);
  state.regions[1].fire('pointerenter');
  assert.equal(state.entries[1].classes.has('is-selected'), true);
});

test('zoom preserves the viewed center, reaches bounded magnification and resets scroll position', () => {
  const { nodes, canvas, viewport } = page();
  assert.equal(nodes['notebook-zoom-controls'].hidden, false);
  assert.equal(nodes['notebook-zoom-out'].disabled, true);
  nodes['notebook-zoom-in'].fire('click');
  assert.equal(canvas.style.width, '150%');
  assert.equal(viewport.scrollLeft, 90);
  assert.equal(viewport.scrollTop, 120);
  assert.match(nodes['notebook-zoom-status'].textContent, /^150%/);
  for (let count = 0; count < 6; count++) nodes['notebook-zoom-in'].fire('click');
  assert.equal(canvas.style.width, '300%');
  assert.equal(nodes['notebook-zoom-in'].disabled, true);
  nodes['notebook-zoom-reset'].fire('click');
  assert.equal(canvas.style.width, '100%');
  assert.equal(viewport.scrollTop, 0); assert.equal(viewport.scrollLeft, 0);
  assert.equal(nodes['notebook-zoom-out'].disabled, true);
  assert.equal(nodes['notebook-zoom-in'].disabled, false);
});

test('a shared-row hash leaves its collection choices in view instead of scrolling back to the image', () => {
  const state = page({ hash: '#entry-shared' });
  assert.equal(state.regions[2].classes.has('is-selected'), true);
  assert.equal(state.entries[2].classes.has('is-selected'), true);
  assert.equal(state.regions[2].scrolled.length, 0);
  state.location.hash = '#entry-a'; state.window.fire('hashchange');
  state.location.hash = '#entry-shared'; state.window.fire('hashchange');
  assert.equal(state.regions[2].scrolled.length, 0);
});
