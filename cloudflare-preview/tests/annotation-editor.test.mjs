import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { editorPosition } from '../static/annotation-layout.js';

const stage = { width: 1000, height: 700 };
const image = { x: 0, y: 0, ...stage };
const card = { width: 320, height: 200 };

function assertSeparate(position, region, picture = image, bounds = stage, editor = card) {
  assert.ok(position, 'an editor position should fit');
  assert.ok(position.left >= 8 && position.top >= 8);
  assert.ok(position.left + editor.width <= bounds.width - 8);
  assert.ok(position.top + editor.height <= bounds.height - 8);
  const left = picture.x + region.x * picture.width;
  const top = picture.y + region.y * picture.height;
  const right = left + region.width * picture.width;
  const bottom = top + region.height * picture.height;
  assert.ok(position.left >= right + 12 || position.left + editor.width <= left - 12 ||
    position.top >= bottom + 12 || position.top + editor.height <= top - 12,
  'the name editor must leave the selected person visible');
}

test('editor can sit right, left, below or above the selected person', () => {
  const cases = [
    [{ x: 0.1, y: 0.2, width: 0.1, height: 0.2 }, { left: 212, top: 140 }],
    [{ x: 0.8, y: 0.2, width: 0.1, height: 0.2 }, { left: 468, top: 140 }],
    [{ x: 0.2, y: 0.1, width: 0.6, height: 0.2 }, { left: 200, top: 222 }],
    [{ x: 0.2, y: 0.6, width: 0.6, height: 0.3 }, { left: 200, top: 208 }],
  ];
  for (const [region, expected] of cases) {
    const position = editorPosition(region, image, stage, card, 1280);
    assert.deepEqual(position, expected);
    assertSeparate(position, region);
  }
});

test('editor stays inside the stage and clear of selections near every edge, including letterboxed photos', () => {
  for (const picture of [image, { x: 275, y: 0, width: 450, height: 700 }, { x: 0, y: 200, width: 1000, height: 300 }]) {
    for (const x of [0, 0.01, 0.45, 0.8, 0.9]) {
      for (const y of [0, 0.01, 0.45, 0.8, 0.9]) {
        const region = { x, y, width: 0.1, height: 0.1 };
        assertSeparate(editorPosition(region, picture, stage, card, 1280), region, picture);
      }
    }
  }
});

test('small screens, large selections and expanded editors use the below-image fallback', () => {
  const small = { x: 0.1, y: 0.1, width: 0.1, height: 0.1 };
  assert.equal(editorPosition(null, image, stage, card, 1280), null);
  assert.equal(editorPosition(small, image, stage, card, 739), null);
  assert.ok(editorPosition(small, image, stage, card, 740));
  assert.equal(editorPosition({ x: 0, y: 0, width: 1, height: 1 }, image, stage, card, 1280), null);
  assert.equal(editorPosition(small, image, stage, { width: 1001, height: 200 }, 1280), null);
  assert.equal(editorPosition(small, image, stage, { width: 320, height: 701 }, 1280), null);
  // The card nominally fits, but there is no space for its required edge inset.
  assert.equal(editorPosition(small, image, stage, { width: 320, height: 700 }, 1280), null);
});

test('built image pages place the name editor beside the photograph with a keyboard-accessible alternative', async () => {
  const catalogue = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url)));
  const page = await readFile(new URL(`../dist/image/${catalogue.photos[0].id}/index.html`, import.meta.url), 'utf8');
  const workspace = page.indexOf('class="annotation-workspace"');
  const editor = page.indexOf('id="annotation-form"');
  const metadata = page.indexOf('class="photo-detail__info"');
  const community = page.indexOf('id="community"');
  assert.ok(workspace >= 0 && workspace < editor && editor < metadata && metadata < community);
  assert.equal(page.match(/id="annotation-form"/g).length, 1);
  assert.match(page, /id="annotation-manual"[^>]*>Use area controls/);
  assert.match(page, /id="annotation-name"[^>]*required/);
  assert.match(page, /id="annotation-status"[^>]*role="status"[^>]*aria-live="polite"/);
});

test('built image pages hide annotation tools before authentication and offer a clear account entry point', async () => {
  const catalogue = JSON.parse(await readFile(new URL('../data/sample.json', import.meta.url)));
  const page = await readFile(new URL(`../dist/image/${catalogue.photos[0].id}/index.html`, import.meta.url), 'utf8');
  for (const id of ['annotation-toolbar', 'annotation-feedback', 'annotation-overlay', 'annotation-form']) {
    const tag = page.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0];
    assert.ok(tag, `${id} must exist`);
    assert.match(tag, /\bhidden(?:[\s=>])/, `${id} must be hidden without JavaScript or while auth is loading`);
  }
  assert.doesNotMatch(page, /id="photo-signin"/);
  assert.match(page, /id="site-account-link"[^>]*>Sign in \/ create account/);
});

const settle = () => new Promise(resolve => setImmediate(resolve));
let instance = 0;

// Run the real event handlers and API helper. The DOM double supplies browser
// primitives only; it does not reproduce drawing, validation or save logic.
async function mountEditor(t, { user = { id: 'member-1', role: 'member', canAnnotate: true, annotationStatus: 'approved' }, naturalWidth = 1000, naturalHeight = 700, initialLoad, annotations = [] } = {}) {
  let doc;
  class Element extends EventTarget {
    dataset = {}; style = {}; attributes = new Map(); children = []; classes = new Set();
    hidden = false; disabled = false; checked = false; open = false; value = ''; textContent = '';
    offsetHeight = 200;
    classList = {
      add: name => this.classes.add(name),
      remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, force) => {
        const on = force === undefined ? !this.classes.has(name) : force;
        on ? this.classes.add(name) : this.classes.delete(name);
        return on;
      },
    };
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    toggleAttribute(name, force) {
      const present = force === undefined ? !this.attributes.has(name) : force;
      if (present) this.setAttribute(name, ''); else this.removeAttribute(name);
      return present;
    }
    append(...children) { children.forEach(child => { child.parent = this; }); this.children.push(...children); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    focus() { doc.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return { left: 20, top: 60, width: 1000, height: 700 }; }
    setPointerCapture(id) { this.captured = id; }
    hasPointerCapture(id) { return this.captured === id; }
    releasePointerCapture() { this.captured = undefined; }
    querySelectorAll() { return this.controls || []; }
    closest(selector) { return selector === '.region-fields' && this.isCoordinate ? this.parent : null; }
    reset() { Object.values(this.elements || {}).forEach(field => { field.value = field.defaultValue || ''; }); }
    after() {} remove() {}
  }
  const selectors = [
    '#community', '#community-status', '#community-comments', '#community-annotations', '#comment-form',
    '#annotation-form', '#photo-like', '#community-more', '#annotation-begin', '.photo-detail__image img',
    '.annotation-stage', '#annotation-overlay', '#annotation-visible', '#annotation-status', '#annotation-save',
    '#annotation-feedback', '#annotation-area-details', '#annotation-note-details', '#annotation-preview',
    '#annotation-preview-image', '#community-signin', '#annotation-manual', '#photo-like-count',
    '#annotation-clear', '#annotation-cancel', '#annotation-toolbar', '#community-contribution-help',
    '#annotation-permission-notice',
  ];
  const nodes = new Map(selectors.map(selector => [selector, new Element()]));
  const get = selector => nodes.get(selector) || null;
  doc = Object.assign(new EventTarget(), {
    querySelector: get, getElementById: id => get(`#${id}`),
    createElement: () => new Element(), createElementNS: () => new Element(),
  });
  const form = get('#annotation-form');
  form.hidden = true;
  for (const selector of ['#annotation-toolbar', '#annotation-feedback', '#annotation-overlay']) get(selector).hidden = true;
  get('#annotation-overlay').setAttribute('hidden', '');
  form.elements = Object.fromEntries(Object.entries({ name: '', note: '', x: '10', y: '10', width: '20', height: '20' }).map(([key, value]) => {
    const field = new Element(); field.value = field.defaultValue = value;
    field.isCoordinate = !['name', 'note'].includes(key); field.parent = get('#annotation-area-details');
    return [key, field];
  }));
  form.controls = [...Object.values(form.elements), get('#annotation-save'), get('#annotation-clear'), get('#annotation-cancel')];
  const commentForm = get('#comment-form');
  commentForm.elements = { body: new Element() };
  commentForm.controls = [commentForm.elements.body];
  get('#annotation-save').disabled = true;
  get('#community').dataset.photoId = 'test-photo';
  get('#annotation-visible').checked = true;
  Object.assign(get('.photo-detail__image img'), { naturalWidth, naturalHeight, src: '/photo.webp', currentSrc: '/photo.webp' });
  const requests = [];
  const contributionRequests = [];
  let save = async body => ({ ok: true, json: async () => ({ ...body, id: 'saved-1', displayName: 'Test member' }) });
  const communityResponse = (annotations = [], currentUser = user) => ({ ok: true, json: async () => ({ user: currentUser, likeCount: 0, liked: false, comments: [], annotations }) });
  let load = initialLoad || (async () => communityResponse(annotations));
  const globals = {
    document: doc, window: Object.assign(new EventTarget(), { innerWidth: 1280 }),
    location: { hash: '', pathname: '/image/test-photo/', search: '' },
    ResizeObserver: class { observe() {} },
    fetch: async (url, options) => {
      if (url.endsWith('/community')) return load();
      if (url.endsWith('/comments')) {
        assert.equal(options.method, 'POST');
        contributionRequests.push({ url, method: options.method, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ id: 'comment-1', body: JSON.parse(options.body).body }) };
      }
      if (url.endsWith('/like')) {
        assert.ok(['PUT', 'DELETE'].includes(options.method));
        contributionRequests.push({ url, method: options.method, body: JSON.parse(options.body) });
        return { ok: true, json: async () => ({ liked: options.method === 'PUT', likeCount: options.method === 'PUT' ? 1 : 0 }) };
      }
      assert.equal(url, '/api/photos/test-photo/annotations');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body); requests.push(body);
      return save(body);
    },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { value, configurable: true });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  await import(`../static/community.js?annotation-test=${++instance}`);
  await settle();
  const emit = (element, type, values = {}) => element.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), values));
  const click = selector => emit(get(selector), 'click');
  const draw = (start = { clientX: 120, clientY: 130 }, end = { clientX: 220, clientY: 270 }) => {
    const overlay = get('#annotation-overlay');
    const pointer = { button: 0, pointerId: 7, isPrimary: true };
    emit(overlay, 'pointerdown', { ...pointer, ...start });
    emit(overlay, 'pointermove', { ...pointer, ...end });
    emit(overlay, 'pointerup', { ...pointer, ...end });
  };
  return { get, doc, form, requests, contributionRequests, emit, click, draw, communityResponse,
    setSave: handler => { save = handler; }, setLoad: handler => { load = handler; } };
}

test('drawing opens and focuses the nearby name field; redraw keeps text and cancel clears the draft', async t => {
  const app = await mountEditor(t);
  const { get, form, doc, click, draw, emit } = app;
  click('#annotation-begin'); draw();
  assert.equal(form.hidden, false);
  assert.equal(doc.activeElement, form.elements.name);
  assert.equal(form.classList.contains('is-floating'), true);
  assert.equal(get('#annotation-preview').hidden, false);
  assert.equal(get('#annotation-save').disabled, false);
  assert.equal(form.elements.x.value, 10);
  assert.equal(form.elements.width.value, 10);
  form.elements.name.value = 'Bill Harvey';
  form.elements.note.value = 'At home';
  click('#annotation-clear');
  assert.equal(form.hidden, true);
  draw({ clientX: 720, clientY: 130 }, { clientX: 820, clientY: 270 });
  assert.equal(form.elements.name.value, 'Bill Harvey');
  assert.equal(form.elements.note.value, 'At home');
  assert.equal(form.elements.x.value, 70);
  assert.equal(doc.activeElement, form.elements.name);
  emit(doc, 'keydown', { key: 'Escape' });
  assert.equal(form.hidden, true);
  assert.equal(form.elements.name.value, '');
  assert.equal(form.elements.note.value, '');
  assert.equal(get('#annotation-preview').hidden, true);
  assert.equal(get('#annotation-save').disabled, true);
  assert.equal(doc.activeElement, get('#annotation-begin'));
});

test('a pending save is sent once, and a failed save keeps the name, note and selected area for retry', async t => {
  const app = await mountEditor(t);
  const { get, form, doc, click, draw, emit, requests } = app;
  click('#annotation-begin'); draw();
  form.elements.name.value = '  Bill Harvey  ';
  form.elements.note.value = '  At home  ';
  let fail;
  app.setSave(() => new Promise(resolve => { fail = resolve; }));
  emit(form, 'submit'); emit(form, 'submit');
  assert.equal(requests.length, 1);
  assert.equal(form.dataset.busy, 'true');
  assert.equal(get('#annotation-save').disabled, true);
  assert.equal(form.elements.name.disabled, true);
  click('#annotation-cancel');
  assert.equal(form.hidden, false, 'an in-flight save must not lose its editor');
  fail({ ok: false, status: 503, json: async () => ({ error: 'Temporary failure. Please retry.' }) });
  await settle();
  assert.equal(form.dataset.busy, 'false');
  assert.equal(form.hidden, false);
  assert.equal(form.elements.name.value, '  Bill Harvey  ');
  assert.equal(form.elements.note.value, '  At home  ');
  assert.equal(get('#annotation-preview').hidden, false);
  assert.equal(get('#annotation-save').disabled, false);
  assert.match(get('#annotation-status').textContent, /Temporary failure/);
  assert.equal(get('#annotation-status').classList.contains('is-error'), true);
  app.setSave(async body => ({ ok: true, json: async () => ({ ...body, id: 'saved-1', displayName: 'Test member' }) }));
  emit(form, 'submit');
  await settle();
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1], requests[0], 'retry sends the same selected area and text');
  for (const [key, expected] of Object.entries({ x: 0.1, y: 0.1, width: 0.1, height: 0.2 })) {
    assert.ok(Math.abs(requests[1][key] - expected) < 1e-10);
  }
  assert.equal(requests[1].name, 'Bill Harvey');
  assert.equal(requests[1].note, 'At home');
  assert.equal(form.hidden, true);
  assert.equal(form.elements.name.value, '');
  assert.equal(get('#annotation-preview').hidden, true);
  assert.equal(get('#annotation-save').disabled, true);
  assert.match(get('#annotation-feedback').textContent, /Bill Harvey saved/);
  assert.equal(get('#community-annotations').children.length, 1);
  assert.equal(doc.activeElement, get('#annotation-begin'));
});

test('area controls reject out-of-bounds and tiny boxes and name is required before saving', async t => {
  const { get, form, doc, click, emit, requests } = await mountEditor(t);
  click('#annotation-manual');
  assert.equal(get('#annotation-area-details').open, true);
  assert.equal(doc.activeElement, form.elements.x);
  const setRegion = region => {
    for (const [key, value] of Object.entries(region)) form.elements[key].value = String(value);
    emit(form.elements.width, 'input');
  };
  for (const region of [
    { x: 95, y: 10, width: 20, height: 20 },
    { x: -1, y: 10, width: 20, height: 20 },
    { x: 10, y: 10, width: 0.5, height: 20 },
    { x: 10, y: 99, width: 20, height: 2 },
  ]) {
    setRegion(region);
    assert.equal(get('#annotation-save').disabled, true);
    assert.equal(get('#annotation-preview').hidden, true);
    emit(form, 'submit');
    assert.equal(requests.length, 0);
  }
  setRegion({ x: 99, y: 99, width: 1, height: 1 });
  assert.equal(get('#annotation-save').disabled, false);
  emit(form, 'submit');
  assert.equal(requests.length, 0);
  assert.equal(doc.activeElement, form.elements.name);
  assert.match(get('#annotation-status').textContent, /Enter the person/);
});

test('a comment refresh started before a name save cannot erase the saved name or box', async t => {
  const app = await mountEditor(t);
  const { get, form, click, draw, emit } = app;
  let finishRefresh;
  app.setLoad(() => new Promise(resolve => { finishRefresh = resolve; }));
  get('#comment-form').elements.body.value = 'A memory of this photograph';
  emit(get('#comment-form'), 'submit');
  await settle();
  assert.equal(typeof finishRefresh, 'function', 'the refresh must be pending before saving a name');
  click('#annotation-begin'); draw();
  form.elements.name.value = 'Bill Harvey';
  emit(form, 'submit');
  await settle();
  assert.equal(get('#community-annotations').children[0].id, 'annotation-saved-1');
  // This response was read before the save, so it has no annotation yet.
  finishRefresh(app.communityResponse());
  await settle();
  assert.deepEqual(get('#community-annotations').children.map(row => row.id), ['annotation-saved-1']);
  const labels = get('#annotation-overlay').children[0].children;
  assert.equal(labels.length, 2, 'one saved rectangle and one label remain on the photograph');
  assert.equal(labels[1].textContent, 'Bill Harvey');
});

test('a refresh which already contains a saved name cannot duplicate it when the save response arrives', async t => {
  const app = await mountEditor(t);
  const { get, form, click, draw, emit } = app;
  let finishSave, saved;
  app.setSave(body => new Promise(resolve => {
    saved = { ...body, id: 'saved-1', displayName: 'Test member' };
    finishSave = () => resolve({ ok: true, json: async () => saved });
  }));
  click('#annotation-begin'); draw();
  form.elements.name.value = 'Bill Harvey';
  emit(form, 'submit');
  assert.equal(form.dataset.busy, 'true');
  // The server has committed the annotation, but its POST response is delayed.
  app.setLoad(async () => app.communityResponse([saved]));
  get('#comment-form').elements.body.value = 'A memory of this photograph';
  emit(get('#comment-form'), 'submit');
  await settle();
  assert.deepEqual(get('#community-annotations').children.map(row => row.id), ['annotation-saved-1']);
  finishSave();
  await settle();
  assert.deepEqual(get('#community-annotations').children.map(row => row.id), ['annotation-saved-1']);
  const labels = get('#annotation-overlay').children[0].children;
  assert.equal(labels.length, 2, 'the photograph has exactly one saved rectangle and one label');
  assert.equal(labels[1].textContent, 'Bill Harvey');
  assert.equal(form.hidden, true);
});

test('drawing uses the actual photograph bounds, rejects tiny boxes and allows another attempt', async t => {
  const { get, form, click, draw } = await mountEditor(t, { naturalWidth: 700, naturalHeight: 1000 });
  click('#annotation-begin');
  // The portrait occupies x=275..765 inside the 1000px-wide image element.
  draw({ clientX: 120, clientY: 130 }, { clientX: 220, clientY: 270 });
  assert.equal(form.hidden, true);
  assert.equal(get('#annotation-overlay').classList.contains('is-drawing'), true);
  draw({ clientX: 373, clientY: 130 }, { clientX: 374, clientY: 131 });
  assert.equal(form.hidden, true);
  assert.equal(get('#annotation-save').disabled, true);
  draw({ clientX: 373, clientY: 130 }, { clientX: 471, clientY: 270 });
  assert.equal(form.hidden, false);
  assert.equal(form.elements.x.value, 20);
  assert.equal(form.elements.width.value, 20);
  assert.equal(get('#annotation-save').disabled, false);
});

function assertAnnotationAccess(app, allowed, signedIn = allowed) {
  for (const selector of ['#annotation-toolbar', '#annotation-feedback']) {
    assert.equal(app.get(selector).hidden, !allowed, `${selector} visibility must follow annotation permission`);
  }
  assert.equal(app.get('#annotation-overlay').getAttribute('hidden') !== null, !allowed, 'SVG overlay visibility must follow annotation permission');
  assert.equal(app.get('#annotation-begin').disabled, !allowed);
  assert.equal(app.get('#annotation-manual').disabled, !allowed);
  assert.equal(app.get('#community-contribution-help').hidden, !signedIn);
  assert.equal(app.get('#annotation-permission-notice').hidden, !signedIn || allowed);
  if (!allowed) {
    assert.equal(app.form.hidden, true);
    assert.equal(app.get('#annotation-overlay').classList.contains('is-drawing'), false);
    assert.equal(app.get('#annotation-overlay').children[0].children.length, 0, 'no name rectangles or labels may be painted without annotation permission');
    assert.equal(app.get('#annotation-save').disabled, true);
  }
}

const existingName = { id: 'existing-1', name: 'Bill Harvey', displayName: 'Archive member', x: 0.1, y: 0.1, width: 0.2, height: 0.2 };

test('guests cannot see annotation tools or painted names, while existing names remain readable', async t => {
  const app = await mountEditor(t, { user: null, annotations: [existingName] });
  assertAnnotationAccess(app, false);
  assert.equal(app.get('#community-annotations').children[0].id, 'annotation-existing-1');
  assert.ok(app.get('#community-annotations').children[0].children.some(child => child.textContent === 'Bill Harvey'));
  app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
  app.emit(app.get('#annotation-visible'), 'change');
  assertAnnotationAccess(app, false);
});

test('annotation controls stay hidden while authentication is pending, then appear for an approved member', async t => {
  let finishLoad;
  const app = await mountEditor(t, { initialLoad: () => new Promise(resolve => { finishLoad = resolve; }) });
  assert.equal(typeof finishLoad, 'function');
  assertAnnotationAccess(app, false);
  app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
  assertAnnotationAccess(app, false);
  finishLoad(app.communityResponse([existingName]));
  await settle();
  assertAnnotationAccess(app, true);
  assert.equal(app.get('#annotation-overlay').children[0].children.length, 2);
});

test('a failed authentication lookup leaves annotation tools hidden', async t => {
  const app = await mountEditor(t, { initialLoad: async () => { throw new Error('Network unavailable'); } });
  assertAnnotationAccess(app, false);
  assert.match(app.get('#community-status').textContent, /Network unavailable/);
});

test('a failed permissions refresh withdraws annotation controls without losing public names', async t => {
  const app = await mountEditor(t, { annotations: [existingName] });
  app.click('#annotation-begin'); app.draw();
  assert.equal(app.form.hidden, false);
  app.setLoad(async () => { throw new Error('Permissions could not be checked'); });
  app.get('#comment-form').elements.body.value = 'A memory';
  app.emit(app.get('#comment-form'), 'submit');
  await settle();
  assertAnnotationAccess(app, false);
  assert.equal(app.get('#community-annotations').children[0].id, 'annotation-existing-1');
  assert.match(app.get('#community-status').textContent, /Permissions could not be checked/);
});

test('administrators can annotate, while an unexpected role cannot expose the annotation tools', async t => {
  await t.test('administrator', async sub => {
    const app = await mountEditor(sub, { user: { id: 'admin-1', role: 'admin', canAnnotate: true, annotationStatus: 'approved' } });
    assertAnnotationAccess(app, true);
    app.click('#annotation-begin'); app.draw();
    assert.equal(app.form.hidden, false);
  });
  await t.test('unexpected role', async sub => {
    const app = await mountEditor(sub, { user: { id: 'reader-1', role: 'reader' }, annotations: [existingName] });
    assertAnnotationAccess(app, false);
    app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
    assertAnnotationAccess(app, false);
  });
});

for (const status of [401, 403]) {
  test(`a ${status} save response removes annotation access${status === 401 ? ' and requires signing in again' : ' while retaining commenting and likes'}`, async t => {
    const app = await mountEditor(t, { annotations: [existingName] });
    app.click('#annotation-begin'); app.draw();
    app.form.elements.name.value = 'Another person';
    if (status === 403) app.setLoad(async () => app.communityResponse([existingName], {
      id: 'member-1', role: 'member', canAnnotate: false, annotationStatus: 'revoked',
    }));
    app.setSave(async () => ({ ok: false, status, json: async () => ({ error: 'Your session cannot add names.' }) }));
    app.emit(app.form, 'submit');
    await settle();
    assert.equal(app.requests.length, 1);
    assertAnnotationAccess(app, false, status === 403);
    app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
    app.emit(app.form, 'submit');
    await settle();
    assert.equal(app.requests.length, 1, 'stale controls must not submit another annotation');
    assertAnnotationAccess(app, false, status === 403);
    assert.equal(app.get('#community-annotations').children[0].id, 'annotation-existing-1');
  });
}

for (const annotationStatus of ['pending', 'revoked']) {
  test(`${annotationStatus} members can like and comment but cannot draw or submit annotations`, async t => {
    const app = await mountEditor(t, { user: { id: 'member-1', role: 'member', canAnnotate: false, annotationStatus }, annotations: [existingName] });
    assertAnnotationAccess(app, false, true);
    assert.match(app.get('#annotation-permission-notice').textContent, annotationStatus === 'pending' ? /awaiting administrator approval/ : /not currently approved/);
    assert.equal(app.get('#comment-form').hidden, false);
    assert.equal(app.get('#photo-like').hidden, false);
    assert.equal(app.get('#photo-like').disabled, false);
    app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
    app.form.elements.name.value = 'Not approved';
    app.emit(app.form, 'submit');
    assert.equal(app.requests.length, 0, 'hidden controls cannot bypass the annotation gate');
    assertAnnotationAccess(app, false, true);
    app.click('#photo-like');
    await settle();
    assert.equal(app.get('#photo-like').getAttribute('aria-pressed'), 'true');
    app.click('#photo-like');
    await settle();
    assert.equal(app.get('#photo-like').getAttribute('aria-pressed'), 'false');
    app.get('#comment-form').elements.body.value = 'A memory of this photograph';
    app.emit(app.get('#comment-form'), 'submit');
    await settle();
    assert.deepEqual(app.contributionRequests.map(({ method, url }) => [method, url]), [
      ['PUT', '/api/photos/test-photo/like'], ['DELETE', '/api/photos/test-photo/like'], ['POST', '/api/photos/test-photo/comments'],
    ]);
    assert.equal(app.contributionRequests[2].body.body, 'A memory of this photograph');
    assert.match(app.get('#community-status').textContent, /Your comment has been added/);
    assertAnnotationAccess(app, false, true);
  });
}

test('a rejected annotation disables controls immediately and an older approved refresh cannot restore access', async t => {
  const app = await mountEditor(t, { annotations: [existingName] });
  let finishOlderRefresh, finishPermissionRefresh;
  app.setLoad(() => new Promise(resolve => { finishOlderRefresh = resolve; }));
  app.get('#comment-form').elements.body.value = 'This starts a slower refresh';
  app.emit(app.get('#comment-form'), 'submit');
  await settle();
  assert.equal(typeof finishOlderRefresh, 'function');
  app.click('#annotation-begin'); app.draw();
  app.form.elements.name.value = 'A second name';
  app.setLoad(() => new Promise(resolve => { finishPermissionRefresh = resolve; }));
  app.setSave(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Annotation approval has been revoked.' }) }));
  app.emit(app.form, 'submit');
  await settle();
  assert.equal(typeof finishPermissionRefresh, 'function');
  assertAnnotationAccess(app, false, true);
  assert.equal(app.get('#photo-like').disabled, false);
  assert.equal(app.get('#comment-form').hidden, false);
  app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
  app.emit(app.form, 'submit');
  assert.equal(app.requests.length, 1, 'no further names can be submitted while approval is being rechecked');
  finishPermissionRefresh(app.communityResponse([existingName], {
    id: 'member-1', role: 'member', canAnnotate: false, annotationStatus: 'revoked',
  }));
  await settle();
  assertAnnotationAccess(app, false, true);
  finishOlderRefresh(app.communityResponse([existingName]));
  await settle();
  assertAnnotationAccess(app, false, true);
  assert.match(app.get('#annotation-permission-notice').textContent, /not currently approved/);
  app.click('#annotation-begin'); app.draw(); app.emit(app.form, 'submit');
  assert.equal(app.requests.length, 1, 'a stale approved response must never restore annotation privileges');
});

test('roles or approval labels alone do not enable annotations: an explicit boolean grant is required', async t => {
  for (const role of ['member', 'admin']) {
    for (const canAnnotate of [undefined, false, 'true', 1]) {
      await t.test(`${role} with canAnnotate=${String(canAnnotate)} (${typeof canAnnotate})`, async sub => {
        const app = await mountEditor(sub, { user: { id: 'user-1', role, annotationStatus: 'approved', canAnnotate } });
        assertAnnotationAccess(app, false, true);
        app.click('#annotation-begin'); app.draw(); app.click('#annotation-manual');
        app.emit(app.form, 'submit');
        assert.equal(app.requests.length, 0);
      });
    }
  }
});
