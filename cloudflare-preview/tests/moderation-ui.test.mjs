import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mountModeration, reviewRow } from '../static/moderation.js';

const settle = () => new Promise(resolve => setImmediate(resolve));

function mountDOM(t) {
  let document;
  class Element extends EventTarget {
    children = []; dataset = {}; style = {}; attributes = new Map(); classes = new Set();
    disabled = false; value = ''; textContent = ''; className = '';
    classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
    constructor(tagName = 'div') { super(); this.tagName = tagName; }
    set innerHTML(_) { throw new Error('User contributions must never be parsed as HTML'); }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    querySelectorAll(selector) {
      const tags = selector.split(',').map(tag => tag.trim());
      return this.children.flatMap(child => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    focus() { document.activeElement = this; }
  }
  const selectors = ['kind', 'filter', 'list', 'status', 'previous', 'next', 'page', 'refresh'];
  const nodes = new Map(selectors.map(name => [`#admin-review-${name}`, new Element()]));
  document = { createElement: tag => new Element(tag), querySelector: selector => nodes.get(selector) || null };
  const replaceGlobal = (key, value) => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  };
  replaceGlobal('document', document);
  const get = name => nodes.get(`#admin-review-${name}`);
  get('kind').value = 'comments'; get('filter').value = 'all';
  const emit = (element, type = 'click') => element.dispatchEvent(new Event(type, { cancelable: true }));
  const walk = element => [element, ...element.children.flatMap(walk)];
  const action = name => get('list').querySelectorAll('button').find(button => button.dataset.reviewAction === name);
  return { get, emit, walk, action, document, setFetch: fn => replaceGlobal('fetch', fn) };
}

const fixture = (extra = {}) => ({
  id: 'contribution-1', photoId: 'photo-1', displayName: 'Archive member', email: 'member@example.test',
  createdAt: 1_700_000_000, body: 'A memory of this photograph', name: 'Bill Harvey', note: 'At home',
  photo: { imageBase: 'https://cdn.example.test/photo-1', title: 'At home' }, ...extra,
});
const response = data => ({ ok: true, json: async () => data });

test('review cards render malicious comment, name, note and author strings as literal text', t => {
  const app = mountDOM(t);
  const malicious = '<img src=x onerror="globalThis.pwned=true"><script>alert(1)</script>';
  for (const kind of ['comments', 'annotations']) {
    const row = reviewRow(fixture({
      id: 'id/"?#', photoId: 'photo/"?#', displayName: malicious, email: malicious,
      body: malicious, name: malicious, note: malicious,
      photo: { imageBase: 'javascript:alert(1)', title: malicious },
    }), kind, () => {});
    const nodes = app.walk(row);
    assert.equal(nodes.filter(node => node.tagName === 'script' || node.tagName === 'img').length, 0);
    assert.ok(nodes.some(node => node.className === 'review-card__author' && node.textContent === `${malicious} · ${malicious}`));
    assert.ok(nodes.some(node => node.className === 'review-card__body' && node.textContent === malicious));
    if (kind === 'annotations') assert.ok(nodes.some(node => node.className === 'review-card__name' && node.textContent === malicious));
    const link = nodes.find(node => node.tagName === 'a');
    assert.equal(link.href, `/image/photo%2F%22%3F%23/#${kind === 'comments' ? 'comment' : 'annotation'}-id%2F%22%3F%23`);
  }
});

test('annotation review thumbnails mark the named region relative to the uncropped photograph', t => {
  const app = mountDOM(t);
  const area = { x: 0.125, y: 0.25, width: 0.5, height: 0.375 };
  const photo = { imageBase: 'https://cdn.example.test/portrait/', title: 'A portrait', width: 800, height: 1200 };
  const row = reviewRow(fixture({ ...area, photo }), 'annotations', () => {});
  const frame = app.walk(row).find(node => node.className === 'review-card__frame');
  assert.equal(frame.children.length, 2);
  const [picture, highlight] = frame.children;
  assert.equal(picture.tagName, 'img');
  assert.equal(picture.src, 'https://cdn.example.test/portrait/small.webp');
  assert.equal(picture.width, 800);
  assert.equal(picture.height, 1200);
  assert.equal(highlight.className, 'review-card__area');
  assert.equal(highlight.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(highlight.style, { left: '12.5%', top: '25%', width: '50%', height: '37.5%' });
  for (const [kind, fields] of [
    ['comments', area], ['annotations', {}], ['annotations', { ...area, x: NaN }], ['annotations', { ...area, height: Infinity }],
  ]) {
    const other = reviewRow(fixture({ ...fields, photo }), kind, () => {});
    assert.equal(app.walk(other).some(node => node.className === 'review-card__area'), false,
      'comments and annotations without a finite region must not show a misleading highlight');
  }
});

for (const kind of ['comments', 'annotations']) {
  test(`${kind} can be reviewed, hidden and restored through authenticated PATCH requests`, async t => {
    const app = mountDOM(t);
    app.get('kind').value = kind;
    let item = fixture({ id: 'entry/1' });
    const calls = [], errors = [];
    let changes = 0;
    app.setFetch(async (path, options) => {
      calls.push({ path, ...options });
      assert.equal(options.credentials, 'same-origin');
      assert.equal(options.cache, 'no-store');
      if (options.method === 'PATCH') {
        assert.equal(path, `/api/admin/${kind}/entry%2F1`);
        assert.equal(options.headers['Content-Type'], 'application/json');
        const { action } = JSON.parse(options.body);
        item = { ...item, reviewedAt: 1_700_000_100, hiddenAt: action === 'hide' ? 1_700_000_100 : null };
        return response({ ok: true });
      }
      assert.equal(path, `/api/admin/${kind}?filter=all&page=1`);
      return response({ [kind]: [item], hasMore: false });
    });
    await mountModeration({ onChange: () => { changes++; }, onError: error => errors.push(error) });
    assert.ok(app.action('review'));
    app.emit(app.action('review'));
    await settle();
    assert.equal(app.action('review'), undefined);
    assert.match(app.get('status').textContent, /Marked as reviewed/);
    app.emit(app.action('hide'));
    await settle();
    assert.ok(app.action('restore'));
    assert.equal(app.action('hide'), undefined);
    assert.match(app.get('status').textContent, /Hidden from the public site/);
    app.emit(app.action('restore'));
    await settle();
    assert.ok(app.action('hide'));
    assert.match(app.get('status').textContent, /Restored to the public site/);
    assert.equal(changes, 3);
    assert.deepEqual(errors, []);
    assert.deepEqual(calls.filter(call => call.method === 'PATCH').map(call => JSON.parse(call.body)), [
      { action: 'review' }, { action: 'hide' }, { action: 'restore' },
    ]);
    assert.equal(app.get('list').getAttribute('aria-busy'), 'false');
  });
}

test('moderation prevents duplicate actions and keeps failures retryable without losing the contribution', async t => {
  const app = mountDOM(t);
  const errors = [];
  let finish, patches = 0, changes = 0;
  app.setFetch(async (_path, options) => {
    if (options.method !== 'PATCH') return response({ comments: [fixture()], hasMore: false });
    patches++;
    return new Promise(resolve => { finish = resolve; });
  });
  await mountModeration({ onChange: () => { changes++; }, onError: error => errors.push(error) });
  const hide = app.action('hide');
  app.emit(hide); app.emit(hide);
  assert.equal(patches, 1);
  assert.equal(hide.disabled, true);
  assert.equal(app.get('kind').disabled, true);
  assert.equal(app.get('filter').disabled, true);
  finish({ ok: false, status: 503, json: async () => ({ error: 'Temporary failure. Please retry.' }) });
  await settle();
  assert.equal(changes, 0);
  assert.equal(errors[0].status, 503);
  assert.match(app.get('status').textContent, /Temporary failure/);
  assert.equal(app.get('list').children.length, 1);
  assert.equal(hide.disabled, false);
  assert.equal(app.get('kind').disabled, false);
  assert.equal(app.get('filter').disabled, false);
  app.emit(hide);
  assert.equal(patches, 2, 'the failed action can be retried');
  finish(response({ ok: true }));
  await settle();
  assert.equal(changes, 1);
});

test('changing the review category ignores a stale response for the previous category', async t => {
  const app = mountDOM(t);
  let resolveComments;
  app.setFetch(async path => {
    if (path.includes('/comments?')) return new Promise(resolve => { resolveComments = resolve; });
    assert.equal(path, '/api/admin/annotations?filter=hidden&page=1');
    return response({ annotations: [fixture({ name: 'The current annotation', hiddenAt: 1_700_000_100 })], hasMore: true });
  });
  const loading = mountModeration({ onChange() {}, onError: error => { throw error; } });
  app.get('kind').value = 'annotations';
  app.get('filter').value = 'hidden';
  app.emit(app.get('kind'), 'change');
  await settle();
  resolveComments(response({ comments: [fixture({ body: 'Stale comment' })], hasMore: false }));
  await loading;
  const texts = app.walk(app.get('list')).map(node => node.textContent);
  assert.ok(texts.includes('The current annotation'));
  assert.ok(!texts.includes('Stale comment'));
  assert.equal(app.get('next').disabled, false);
  assert.equal(app.get('previous').disabled, true);
});

test('a failed moderation action on page two restores both pagination controls', async t => {
  const app = mountDOM(t);
  const errors = [], readPages = [];
  let finishPatch;
  app.setFetch(async (path, options) => {
    if (options.method === 'PATCH') return new Promise(resolve => { finishPatch = resolve; });
    const page = Number(new URL(path, 'https://archive.example.test').searchParams.get('page'));
    readPages.push(page);
    return response({ comments: [fixture({ id: `entry-page-${page}` })], hasMore: true });
  });
  await mountModeration({ onChange() {}, onError: error => errors.push(error) });
  app.emit(app.get('next'));
  await settle();
  assert.equal(app.get('page').textContent, 'Page 2');
  assert.equal(app.get('previous').disabled, false);
  assert.equal(app.get('next').disabled, false);
  app.emit(app.action('hide'));
  assert.equal(app.get('previous').disabled, true);
  assert.equal(app.get('next').disabled, true);
  assert.equal(app.get('refresh').disabled, true);
  app.emit(app.get('previous')); app.emit(app.get('next')); app.emit(app.get('refresh'));
  assert.deepEqual(readPages, [1, 2], 'pagination and refresh must not race an in-flight moderation action');
  finishPatch({ ok: false, status: 503, json: async () => ({ error: 'Please retry this action.' }) });
  await settle();
  assert.equal(errors[0].status, 503);
  assert.equal(app.get('previous').disabled, false);
  assert.equal(app.get('next').disabled, false);
  assert.equal(app.get('refresh').disabled, false);
  assert.equal(app.get('page').textContent, 'Page 2');
  app.emit(app.get('previous'));
  await settle();
  assert.equal(app.get('page').textContent, 'Page 1');
  assert.equal(app.get('previous').disabled, true);
  assert.equal(app.get('next').disabled, false);
});
