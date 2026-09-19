import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { swipeDirection } from '../static/image-viewer.js';

// Gesture intent matters: scrolling, holding and pinch zoom must not change the photo.
test('horizontal swipes navigate in their natural direction', () => {
  assert.equal(swipeDirection(-130, 15, 300), 1);
  assert.equal(swipeDirection(130, -15, 300), -1);
});
test('taps, diagonal scrolling, long presses and zoomed gestures do not navigate', () => {
  for (const gesture of [[20, 0, 100], [100, 120, 200], [100, 80, 200], [120, 0, 1400], [120, 0, 200, 2]]) {
    assert.equal(swipeDirection(...gesture), 0);
  }
});
test('built viewer manifests match the complete roll order, including page boundaries', async () => {
  const root = new URL('../dist/', import.meta.url);
  const catalogue = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url)));
  const first = catalogue.photos[0];
  const page = await readFile(new URL(`image/${first.id}/index.html`, root), 'utf8');
  const manifestPath = page.match(/data-viewer-src="([^"]+)"/)[1];
  const frames = JSON.parse(await readFile(new URL(manifestPath.slice(1), root)));
  const expected = catalogue.photos.filter(photo => photo.collectionId === first.collectionId);
  assert.deepEqual(frames.map(photo => photo.id), expected.map(photo => String(photo.id)));
  assert.ok(frames.every(photo => photo.src.endsWith('/large.webp') && photo.href === `/image/${photo.id}/`));
  assert.match(page, /View full screen/);
  assert.match(page, /id="annotation-overlay"/);
  assert.match(page, /id="annotation-begin"/);
  assert.match(page, /href="https:[^"]+\/original.jpg"/); // Fallback when JavaScript is unavailable.
  const lastPage = await readFile(new URL(`image/${expected.at(-1).id}/index.html`, root), 'utf8');
  assert.ok(lastPage.includes(`data-viewer-src="${manifestPath}"`));
});

test('viewer handles touch navigation, roll boundaries, pinch cancellation and closing', async t => {
  const { mountViewer } = await import('../static/image-viewer.js');
  class Element extends EventTarget {
    children = new Map(); dataset = {}; classes = new Set();
    classList = { add: name => this.classes.add(name), remove: name => this.classes.delete(name) };
    querySelector(selector) {
      if (!this.children.has(selector)) {
        const child = new Element(); child.parent = this; child.selector = selector;
        this.children.set(selector, child);
      }
      return this.children.get(selector);
    }
    setAttribute() {} append() {} setPointerCapture() {}
    focus() { document.activeElement = this; }
    replaceWith(child) { child.parent = this.parent; child.selector = this.selector; this.parent.children.set(this.selector, child); }
    showModal() { this.open = true; }
    close() { this.open = false; this.dispatchEvent(new Event('close')); }
  }
  const win = new EventTarget(); win.visualViewport = { scale: 1 };
  const doc = { createElement: () => new Element(), body: new Element(), documentElement: new Element() };
  const frames = [1, 2].map(id => ({ id: String(id), src: `/image${id}.webp`, title: `Photo ${id}`, href: `/image/${id}/`, roll: 'Test roll' }));
  const replacements = { document: doc, window: win, HTMLDialogElement: Element, Image: Element,
    location: { pathname: '/image/1/' }, history: { state: null, pushState(state) { this.state = state; }, back() { this.state = null; win.dispatchEvent(new Event('popstate')); } },
    fetch: async () => ({ ok: true, json: async () => frames }) };
  for (const [key, value] of Object.entries(replacements)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key]);
  }
  const trigger = new Element(); trigger.dataset = { photoId: '1', title: 'Photo 1', image: '/1.webp', viewerSrc: '/roll.json' };
  const { dialog, navigate, close } = mountViewer(trigger);
  const emit = (element, type, values = {}) => element.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), values));
  emit(trigger, 'click', { button: 0 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(dialog.open, true);
  assert.equal(dialog.querySelector('[data-previous]').disabled, true);
  const canvas = dialog.querySelector('.image-viewer__canvas');
  const down = { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: 200, clientY: 100 };
  emit(canvas, 'pointerdown', down);
  emit(canvas, 'pointerup', { ...down, clientX: 50 });
  assert.equal(dialog.querySelector('[data-details]').href, '/image/2/');
  assert.equal(dialog.querySelector('[data-next]').disabled, true);
  navigate(1);
  assert.equal(dialog.querySelector('[data-details]').href, '/image/2/');
  emit(canvas, 'pointerdown', down);
  emit(canvas, 'pointerdown', { ...down, pointerId: 2, isPrimary: false });
  emit(canvas, 'pointerup', { ...down, clientX: 350 });
  assert.equal(dialog.querySelector('[data-details]').href, '/image/2/');
  emit(dialog, 'keydown', { key: 'ArrowLeft' });
  assert.equal(dialog.querySelector('[data-details]').href, '/image/1/');
  close();
  assert.equal(dialog.open, false);
  assert.equal(document.activeElement, trigger);
  assert.equal(document.documentElement.classes.has('image-viewer-open'), false);
});
