import { api, el, message, signin, when, working } from './ui.js';

const community = document.querySelector('#community');
const photoId = community.dataset.photoId;
const base = `/api/photos/${encodeURIComponent(photoId)}`;
const status = document.querySelector('#community-status');
const comments = document.querySelector('#community-comments');
const annotations = document.querySelector('#community-annotations');
const commentForm = document.querySelector('#comment-form');
const annotationForm = document.querySelector('#annotation-form');
const like = document.querySelector('#photo-like');
const more = document.querySelector('#community-more');
const begin = document.querySelector('#annotation-begin');
const image = document.querySelector('.photo-detail__image img');
const stage = document.querySelector('.annotation-stage');
const overlay = document.querySelector('#annotation-overlay');
const showNames = document.querySelector('#annotation-visible');
const regionStatus = document.querySelector('#annotation-status');
const saveRegion = document.querySelector('#annotation-save');
const svgNS = 'http://www.w3.org/2000/svg';
const labels = document.createElementNS(svgNS, 'g');
const draftShape = document.createElementNS(svgNS, 'rect');
draftShape.setAttribute('class', 'annotation-region is-draft');
draftShape.setAttribute('visibility', 'hidden');
overlay.append(labels, draftShape);
let state = { user: null, likeCount: 0, liked: false, comments: [], annotations: [] };
let geometry;
let draft;
let drawing = false;
let startPoint;
let pointerId;
let followedAnchor = false;

function errorMessage(error) {
  message(status, error.message || 'The archive could not be reached. Please try again.', true);
  if (error.status === 401) { state.user = null; renderAuth(); }
}

function renderAuth() {
  const guest = document.querySelector('#community-signin');
  guest.replaceChildren();
  guest.hidden = Boolean(state.user);
  if (!state.user) guest.append(signin('Sign in to like, comment or add a name'));
  commentForm.hidden = !state.user;
  begin.disabled = !state.user || !image.naturalWidth;
  document.querySelector('#annotation-manual').disabled = !state.user || !image.naturalWidth;
  like.disabled = !state.user;
  if (!state.user) {
    annotationForm.hidden = true;
    setDrawing(false);
  }
}

function renderLikes() {
  like.setAttribute('aria-pressed', String(state.liked));
  like.textContent = state.liked ? '♥ Liked' : '♡ Like';
  document.querySelector('#photo-like-count').textContent = `${Number(state.likeCount).toLocaleString()} ${state.likeCount === 1 ? 'like' : 'likes'}`;
}

function deleteButton(item, type) {
  if (!item.canDelete) return null;
  const button = el('button', 'quiet-button', state.user?.role === 'admin' && item.userId !== state.user.id ? 'Hide' : 'Delete');
  button.type = 'button';
  button.setAttribute('aria-label', `${button.textContent} ${type === 'comments' ? 'comment' : `name ${item.name}`}`);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api(`/api/${type}/${encodeURIComponent(item.id)}`, { method: 'DELETE', body: {} });
      state[type] = state[type].filter(entry => entry.id !== item.id);
      renderLists();
      renderOverlay();
      message(status, type === 'comments' ? 'The comment has been removed.' : 'The name has been removed.');
    } catch (error) { button.disabled = false; errorMessage(error); }
  });
  return button;
}

function contribution(item, type) {
  const row = el('li', 'community-item');
  row.id = `${type === 'comments' ? 'comment' : 'annotation'}-${item.id}`;
  const meta = el('div', 'community-item__meta');
  meta.append(el('strong', '', item.displayName || 'Archive member'), el('span', '', when(item.createdAt)));
  row.append(meta);
  if (type === 'annotations') row.append(el('p', 'community-item__name', item.name));
  if (type === 'comments' || item.note) row.append(el('p', 'community-item__body', type === 'comments' ? item.body : item.note));
  const remove = deleteButton(item, type);
  if (remove) row.append(remove);
  return row;
}

function renderLists() {
  comments.replaceChildren(...state.comments.map(item => contribution(item, 'comments')));
  annotations.replaceChildren(...state.annotations.map(item => contribution(item, 'annotations')));
  if (!state.comments.length) comments.append(el('li', 'community-empty', 'No comments yet. Share a memory or a useful detail about this photograph.'));
  if (!state.annotations.length) annotations.append(el('li', 'community-empty', 'Recognise someone? Add a name to a marked area of the photograph.'));
  more.hidden = !state.nextCursor;
  if (!followedAnchor && /^#(?:comment|annotation)-[\w-]+$/.test(location.hash)) {
    const target = document.getElementById(location.hash.slice(1));
    if (target) {
      followedAnchor = true;
      target.classList.add('contribution-highlight');
      target.scrollIntoView({ block: 'center' });
    }
  }
}

function measure() {
  const box = image.getBoundingClientRect();
  const container = stage.getBoundingClientRect();
  if (!image.naturalWidth || !image.naturalHeight || !box.width || !box.height) return;
  const scale = Math.min(box.width / image.naturalWidth, box.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  geometry = {
    x: box.left - container.left + (box.width - width) / 2,
    y: box.top - container.top + (box.height - height) / 2,
    left: box.left + (box.width - width) / 2,
    top: box.top + (box.height - height) / 2,
    width, height,
  };
  overlay.setAttribute('viewBox', `0 0 ${container.width} ${container.height}`);
  renderOverlay();
  begin.disabled = !state.user;
  document.querySelector('#annotation-manual').disabled = !state.user;
}

function shapeAttributes(shape, region) {
  shape.setAttribute('x', geometry.x + region.x * geometry.width);
  shape.setAttribute('y', geometry.y + region.y * geometry.height);
  shape.setAttribute('width', region.width * geometry.width);
  shape.setAttribute('height', region.height * geometry.height);
}

function paintDraft() {
  draftShape.setAttribute('visibility', draft && geometry ? 'visible' : 'hidden');
  if (draft && geometry) shapeAttributes(draftShape, draft);
  saveRegion.disabled = !draft || !state.user;
}

function renderOverlay() {
  labels.replaceChildren();
  if (geometry && showNames.checked) {
    for (const region of state.annotations) {
      const rect = document.createElementNS(svgNS, 'rect');
      rect.setAttribute('class', 'annotation-region');
      shapeAttributes(rect, region);
      const label = document.createElementNS(svgNS, 'text');
      label.setAttribute('class', 'annotation-label');
      label.setAttribute('x', geometry.x + region.x * geometry.width + 3);
      label.setAttribute('y', Math.max(geometry.y + 14, geometry.y + region.y * geometry.height - 5));
      label.textContent = region.name;
      labels.append(rect, label);
    }
  }
  paintDraft();
}

function setDrawing(active) {
  drawing = active;
  overlay.classList.toggle('is-drawing', active);
  begin.setAttribute('aria-pressed', String(active));
  begin.textContent = active ? 'Drawing is active' : 'Draw an area and add a name';
  if (!active) { startPoint = null; pointerId = undefined; }
}

function setDraft(region) {
  if (region) region = { ...region, width: Math.min(region.width, 1 - region.x), height: Math.min(region.height, 1 - region.y) };
  draft = region;
  if (region) {
    for (const key of ['x', 'y', 'width', 'height']) annotationForm.elements[key].value = Number((region[key] * 100).toFixed(2));
  }
  paintDraft();
}

function readManualRegion() {
  const region = Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, Number(annotationForm.elements[key].value) / 100]));
  const valid = Object.values(region).every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width >= 0.01 && region.height >= 0.01 && region.x + region.width <= 1.00000001 && region.y + region.height <= 1.00000001;
  if (valid) {
    region.width = Math.min(region.width, 1 - region.x);
    region.height = Math.min(region.height, 1 - region.y);
  }
  draft = valid && region.width >= 0.01 && region.height >= 0.01 ? region : null;
  paintDraft();
  message(regionStatus, draft ? 'Area ready. Add a name and save it below.' : 'The area must fit inside the photograph and be at least 1% wide and high.', !draft);
}

function point(event, clamp = false) {
  if (!geometry) return null;
  const x = (event.clientX - geometry.left) / geometry.width;
  const y = (event.clientY - geometry.top) / geometry.height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

begin.addEventListener('click', () => {
  if (!state.user) return;
  annotationForm.hidden = false;
  measure();
  setDrawing(!drawing);
  message(regionStatus, drawing ? 'Drag a rectangle on the photograph, or enter an area using the controls below.' : 'Drawing paused. You can still use the area controls below.');
});
document.querySelector('#annotation-manual').addEventListener('click', () => {
  if (!state.user) return;
  annotationForm.hidden = false;
  setDrawing(false);
  readManualRegion();
  annotationForm.elements.x.focus();
});
overlay.addEventListener('pointerdown', event => {
  if (!drawing || !state.user || event.button !== 0) return;
  measure();
  startPoint = point(event);
  if (!startPoint) { message(regionStatus, 'Start the rectangle inside the photograph.'); return; }
  pointerId = event.pointerId;
  overlay.setPointerCapture(pointerId);
  event.preventDefault();
  setDraft(null);
});
overlay.addEventListener('pointermove', event => {
  if (!startPoint || event.pointerId !== pointerId) return;
  const end = point(event, true);
  setDraft({ x: Math.min(startPoint.x, end.x), y: Math.min(startPoint.y, end.y), width: Math.abs(end.x - startPoint.x), height: Math.abs(end.y - startPoint.y) });
});
overlay.addEventListener('pointerup', event => {
  if (event.pointerId !== pointerId) return;
  if (draft && draft.width >= 0.01 && draft.height >= 0.01) {
    message(regionStatus, 'Area selected. Add a name and save it below.');
  } else {
    setDraft(null);
    message(regionStatus, 'Draw a larger area, at least 1% of the photograph in each direction.', true);
  }
  setDrawing(false);
});
overlay.addEventListener('pointercancel', () => { setDraft(null); setDrawing(false); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && drawing) { setDrawing(false); setDraft(null); message(regionStatus, 'Drawing cancelled.'); }
});
for (const key of ['x', 'y', 'width', 'height']) annotationForm.elements[key].addEventListener('input', readManualRegion);
document.querySelector('#annotation-clear').addEventListener('click', () => { setDraft(null); message(regionStatus, 'Area cleared. Draw another area or use the controls below.'); });
document.querySelector('#annotation-cancel').addEventListener('click', () => {
  setDrawing(false); setDraft(null); annotationForm.reset(); annotationForm.hidden = true; message(regionStatus, ''); begin.focus();
});
showNames.addEventListener('change', renderOverlay);
image.addEventListener('load', measure);
new ResizeObserver(measure).observe(stage);

async function load(append = false) {
  const data = await api(`${base}/community${append && state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : ''}`);
  const old = state;
  state = { ...data, comments: data.comments || [], annotations: data.annotations || [] };
  if (append) {
    for (const key of ['comments', 'annotations']) state[key] = [...new Map([...old[key], ...state[key]].map(item => [item.id, item])).values()];
  }
  renderAuth(); renderLikes(); renderLists(); measure();
}

commentForm.addEventListener('submit', event => {
  event.preventDefault();
  const body = commentForm.elements.body.value.trim();
  if (!body) return;
  working(commentForm, async () => {
    await api(`${base}/comments`, { method: 'POST', body: { body } });
    commentForm.reset();
    await load();
    message(status, 'Your comment has been added.');
  }).catch(errorMessage);
});
annotationForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!draft) { message(regionStatus, 'Select an area of the photograph first.', true); return; }
  const body = { ...draft, name: annotationForm.elements.name.value.trim(), note: annotationForm.elements.note.value.trim() };
  working(annotationForm, async () => {
    await api(`${base}/annotations`, { method: 'POST', body });
    setDrawing(false); setDraft(null); annotationForm.reset(); annotationForm.hidden = true;
    await load();
    message(status, 'The name has been added to the photograph.');
  }).catch(error => message(regionStatus, error.message, true));
});
like.addEventListener('click', async () => {
  if (!state.user) return;
  like.disabled = true;
  try { Object.assign(state, await api(`${base}/like`, { method: state.liked ? 'DELETE' : 'PUT', body: {} })); renderLikes(); }
  catch (error) { errorMessage(error); }
  finally { like.disabled = !state.user; }
});
more.addEventListener('click', async () => {
  more.disabled = true;
  try { await load(true); }
  catch (error) { errorMessage(error); }
  finally { more.disabled = false; }
});
async function initialLoad() {
  const retry = document.querySelector('#community-retry');
  if (retry) retry.disabled = true;
  try {
    await load();
    retry?.remove();
    message(status, '');
  } catch (error) {
    comments.replaceChildren(el('li', 'community-empty', 'Could not load comments.'));
    annotations.replaceChildren(el('li', 'community-empty', 'Could not load names.'));
    document.querySelector('#photo-like-count').textContent = 'Could not load likes.';
    errorMessage(error);
    if (retry) retry.disabled = false;
    else {
      const button = el('button', 'button button--light', 'Try loading contributions again');
      button.type = 'button';
      button.id = 'community-retry';
      button.addEventListener('click', initialLoad);
      status.after(button);
    }
  }
}
initialLoad();
