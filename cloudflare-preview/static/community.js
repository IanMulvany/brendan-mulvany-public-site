import { api, el, message, setAccountIndicator, signin, when, working } from './ui.js';
import { editorPosition } from './annotation-layout.js';

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
const feedback = document.querySelector('#annotation-feedback');
const annotationToolbar = document.querySelector('#annotation-toolbar');
const photoSignin = document.querySelector('#photo-signin');
const annotationPermission = document.querySelector('#annotation-permission-notice');
const contributionHelp = document.querySelector('#community-contribution-help');
const areaDetails = document.querySelector('#annotation-area-details');
const noteDetails = document.querySelector('#annotation-note-details');
const preview = document.querySelector('#annotation-preview');
const previewImage = document.querySelector('#annotation-preview-image');
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
let loadSequence = 0;

function errorMessage(error) {
  message(status, error.message || 'The archive could not be reached. Please try again.', true);
  if (error.status === 401 || error.status === 403) { loadSequence++; state.user = null; renderAuth(); renderLists(); }
}

// The community endpoint only returns active, email-verified sessions. Treat
// missing or unrecognised roles as read-only, including while it is loading.
function canContribute() { return Boolean(state.user && ['member', 'admin'].includes(state.user.role)); }
function canAnnotate() { return canContribute() && state.user.canAnnotate === true; }

function renderAuth() {
  const allowed = canContribute();
  const annotationAllowed = canAnnotate();
  setAccountIndicator(allowed ? state.user : null);
  const guest = document.querySelector('#community-signin');
  guest.replaceChildren();
  guest.hidden = allowed;
  if (!allowed) guest.append(signin('Sign in or create an account to contribute'));
  photoSignin.hidden = allowed;
  annotationToolbar.hidden = !annotationAllowed;
  feedback.hidden = !annotationAllowed;
  annotationPermission.hidden = !allowed || annotationAllowed;
  annotationPermission.textContent = state.user?.annotationStatus === 'revoked'
    ? 'You can like photographs and add comments. Annotation access is not currently approved.'
    : 'You can like photographs and add comments. Your access to add names is awaiting administrator approval.';
  contributionHelp.hidden = !allowed;
  overlay.toggleAttribute('hidden', !annotationAllowed);
  commentForm.hidden = !allowed;
  begin.disabled = !annotationAllowed || !image.naturalWidth;
  document.querySelector('#annotation-manual').disabled = !annotationAllowed || !image.naturalWidth;
  like.hidden = !allowed;
  like.disabled = !allowed;
  if (!annotationAllowed) {
    annotationForm.hidden = true;
    setDrawing(false);
    setDraft(null);
    labels.replaceChildren();
    message(feedback, '');
  } else if (!draft && !drawing && !feedback.dataset.saved) {
    message(feedback, 'Recognise someone? Select Add a name, then draw around them.');
  }
}

function renderLikes() {
  like.setAttribute('aria-pressed', String(state.liked));
  like.textContent = state.liked ? '♥ Liked' : '♡ Like';
  document.querySelector('#photo-like-count').textContent = `${Number(state.likeCount).toLocaleString()} ${state.likeCount === 1 ? 'like' : 'likes'}`;
}

function deleteButton(item, type) {
  if (!canContribute() || !item.canDelete) return null;
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
  if (type === 'annotations') {
    const actions = el('div', 'form-actions');
    const search = el('a', 'quiet-button', 'Search this name');
    search.href = `/search/?q=${encodeURIComponent(item.name)}`;
    search.setAttribute('aria-label', `Search this name: ${item.name}`);
    actions.append(search);
    if (remove) actions.append(remove);
    row.append(actions);
  } else if (remove) row.append(remove);
  return row;
}

function renderLists() {
  comments.replaceChildren(...state.comments.map(item => contribution(item, 'comments')));
  annotations.replaceChildren(...state.annotations.map(item => contribution(item, 'annotations')));
  if (!state.comments.length) comments.append(el('li', 'community-empty', canContribute() ? 'No comments yet. Share a memory or a useful detail about this photograph.' : 'No comments yet.'));
  if (!state.annotations.length) annotations.append(el('li', 'community-empty', canAnnotate() ? 'Recognise someone? Add a name to a marked area of the photograph.' : 'No names have been added yet.'));
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
  begin.disabled = !canAnnotate();
  document.querySelector('#annotation-manual').disabled = !canAnnotate();
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
  saveRegion.disabled = !draft || !canAnnotate() || annotationForm.dataset.busy === 'true';
  const previewReady = draft && draft.width > 0 && draft.height > 0 && geometry;
  preview.hidden = !previewReady;
  if (previewReady) {
    const source = image.currentSrc || image.src;
    if (previewImage.src !== source) previewImage.src = source;
    const size = 64;
    const scale = Math.min(size / (draft.width * image.naturalWidth), size / (draft.height * image.naturalHeight));
    previewImage.style.width = `${image.naturalWidth * scale}px`;
    previewImage.style.height = `${image.naturalHeight * scale}px`;
    previewImage.style.left = `${(size - draft.width * image.naturalWidth * scale) / 2 - draft.x * image.naturalWidth * scale}px`;
    previewImage.style.top = `${(size - draft.height * image.naturalHeight * scale) / 2 - draft.y * image.naturalHeight * scale}px`;
  }
  positionEditor();
}

function positionEditor() {
  if (annotationForm.hidden || !geometry) return;
  const bounds = stage.getBoundingClientRect();
  const position = editorPosition(draft, geometry, bounds, { width: Math.min(320, bounds.width), height: annotationForm.offsetHeight }, window.innerWidth);
  annotationForm.classList.toggle('is-floating', Boolean(position));
  annotationForm.style.left = position ? `${position.left}px` : '';
  annotationForm.style.top = position ? `${position.top}px` : '';
}

function showEditor({ manual = false } = {}) {
  annotationForm.hidden = false;
  areaDetails.open = manual;
  paintDraft();
  const field = manual ? annotationForm.elements.x : annotationForm.elements.name;
  field.focus({ preventScroll: true });
  annotationForm.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function beginDrawing() {
  if (!canAnnotate() || annotationForm.dataset.busy === 'true') return;
  delete feedback.dataset.saved;
  annotationForm.hidden = true;
  setDraft(null);
  measure();
  setDrawing(true);
  message(feedback, 'Draw a box around one person. Their name field will open beside the selection.');
  stage.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}

function cancelAnnotation() {
  if (annotationForm.dataset.busy === 'true') return;
  setDrawing(false); setDraft(null); annotationForm.reset(); annotationForm.hidden = true;
  areaDetails.open = false; noteDetails.open = false;
  message(regionStatus, ''); message(feedback, 'Name cancelled. Select Add a name to start again.');
  begin.focus({ preventScroll: true });
}

function renderOverlay() {
  labels.replaceChildren();
  if (geometry && canAnnotate() && showNames.checked) {
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
  begin.textContent = active ? 'Cancel drawing' : 'Add a name';
  if (!active) {
    if (pointerId !== undefined && overlay.hasPointerCapture(pointerId)) overlay.releasePointerCapture(pointerId);
    startPoint = null; pointerId = undefined;
  }
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
  message(regionStatus, draft ? 'Area selected. Enter a name to save.' : 'The area must fit inside the photograph and be at least 1% wide and high.', !draft);
}

function point(event, clamp = false) {
  if (!geometry) return null;
  const x = (event.clientX - geometry.left) / geometry.width;
  const y = (event.clientY - geometry.top) / geometry.height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
}

begin.addEventListener('click', () => {
  if (drawing) cancelAnnotation();
  else beginDrawing();
});
document.querySelector('#annotation-manual').addEventListener('click', () => {
  if (!canAnnotate() || annotationForm.dataset.busy === 'true') return;
  delete feedback.dataset.saved;
  setDrawing(false);
  measure();
  readManualRegion();
  showEditor({ manual: true });
  message(feedback, 'Adjust the selected area, then enter the person’s name.');
});
overlay.addEventListener('pointerdown', event => {
  if (!drawing || !canAnnotate() || event.button !== 0 || pointerId !== undefined || event.isPrimary === false) return;
  measure();
  startPoint = point(event);
  if (!startPoint) { message(feedback, 'Start the rectangle inside the photograph.'); return; }
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
  const end = point(event, true);
  if (end && startPoint) setDraft({ x: Math.min(startPoint.x, end.x), y: Math.min(startPoint.y, end.y), width: Math.abs(end.x - startPoint.x), height: Math.abs(end.y - startPoint.y) });
  setDrawing(false);
  if (draft && draft.width >= 0.01 && draft.height >= 0.01) {
    message(regionStatus, '');
    message(feedback, 'Area selected. Add their name, or redraw the box.');
    showEditor();
  } else {
    setDraft(null);
    setDrawing(true);
    message(feedback, 'That box was too small. Draw around the person, or use area controls.', true);
  }
});
overlay.addEventListener('pointercancel', () => { setDraft(null); setDrawing(false); message(feedback, 'Drawing interrupted. Select Add a name to try again.'); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.querySelector('.image-viewer[open]') && (drawing || !annotationForm.hidden)) {
    event.preventDefault(); cancelAnnotation();
  }
});
for (const key of ['x', 'y', 'width', 'height']) annotationForm.elements[key].addEventListener('input', readManualRegion);
document.querySelector('#annotation-clear').addEventListener('click', beginDrawing);
document.querySelector('#annotation-cancel').addEventListener('click', cancelAnnotation);
annotationForm.addEventListener('invalid', event => {
  if (event.target.closest('.region-fields')) areaDetails.open = true;
}, true);
showNames.addEventListener('change', renderOverlay);
image.addEventListener('load', measure);
new ResizeObserver(measure).observe(stage);
new ResizeObserver(positionEditor).observe(annotationForm);
window.addEventListener('resize', measure);

async function load(append = false) {
  const requestId = ++loadSequence;
  const knownAnnotations = new Set(state.annotations.map(item => item.id));
  const data = await api(`${base}/community${append && state.nextCursor ? `?cursor=${encodeURIComponent(state.nextCursor)}` : ''}`).catch(error => {
    if (requestId !== loadSequence) return null;
    state.user = null; renderAuth(); renderLists();
    throw error;
  });
  if (requestId !== loadSequence || !data) return;
  const old = state;
  state = { ...data, comments: data.comments || [], annotations: data.annotations || [] };
  if (append) {
    for (const key of ['comments', 'annotations']) state[key] = [...new Map([...old[key], ...state[key]].map(item => [item.id, item])).values()];
  } else {
    // A comment refresh may have started before a name was saved. Keep those
    // newly added names even if that in-flight read has an older snapshot.
    const added = old.annotations.filter(item => !knownAnnotations.has(item.id));
    state.annotations = [...new Map([...added, ...state.annotations].map(item => [item.id, item])).values()];
  }
  renderAuth(); renderLikes(); renderLists(); measure();
}

commentForm.addEventListener('submit', event => {
  event.preventDefault();
  if (!canContribute()) return;
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
  if (!canAnnotate() || annotationForm.dataset.busy === 'true') return;
  if (!draft) { message(regionStatus, 'Select an area of the photograph first.', true); return; }
  const body = { ...draft, name: annotationForm.elements.name.value.trim(), note: annotationForm.elements.note.value.trim() };
  if (!body.name) { message(regionStatus, 'Enter the person’s name.', true); annotationForm.elements.name.focus(); return; }
  working(annotationForm, async () => {
    message(regionStatus, 'Saving name…');
    const saved = await api(`${base}/annotations`, { method: 'POST', body });
    state.annotations = [saved, ...state.annotations.filter(item => item.id !== saved.id)];
    setDrawing(false); setDraft(null); annotationForm.reset(); annotationForm.hidden = true;
    areaDetails.open = false; noteDetails.open = false;
    showNames.checked = true;
    renderLists(); renderOverlay();
    feedback.dataset.saved = 'true';
    message(feedback, `${body.name} saved. Select Add a name to identify someone else.`);
    message(status, 'The name has been added to the photograph. Saved names and notes become searchable within 30 seconds.');
    begin.focus({ preventScroll: true });
  }).catch(error => {
    if (error.status === 403) {
      // Recheck annotation approval without signing out a member who can still
      // comment and like photographs after their annotation access is revoked.
      if (state.user) state.user = { ...state.user, canAnnotate: false, annotationStatus: 'revoked' };
      renderAuth(); renderLists();
      load().catch(errorMessage);
      message(status, error.message, true);
    } else if (error.status === 401) errorMessage(error);
    else message(regionStatus, error.message || 'Could not save. Your name and selected area are kept here so you can try again.', true);
  }).finally(paintDraft);
});
like.addEventListener('click', async () => {
  if (!canContribute()) return;
  like.disabled = true;
  try { Object.assign(state, await api(`${base}/like`, { method: state.liked ? 'DELETE' : 'PUT', body: {} })); renderLikes(); }
  catch (error) { errorMessage(error); }
  finally { like.disabled = !canContribute(); }
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
renderAuth();
initialLoad();
