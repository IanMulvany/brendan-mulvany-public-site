import { api, el, message, setAccountIndicator, when, working } from './ui.js';
import { mountModeration } from './moderation.js';

const access = document.querySelector('#admin-access');
const content = document.querySelector('#admin-content');
const status = document.querySelector('#admin-status');
const collectionSelect = document.querySelector('#admin-collection');
const heroGrid = document.querySelector('#admin-hero-grid');
const heroSave = document.querySelector('#admin-hero-save');
const heroStatus = document.querySelector('#admin-hero-status');
const homepageSelect = document.querySelector('#admin-homepage-collection');
const homepageList = document.querySelector('#admin-homepage-list');
const homepageAdd = document.querySelector('#admin-homepage-add');
const homepageSave = document.querySelector('#admin-homepage-save');
const homepageStatus = document.querySelector('#admin-homepage-status');
let user;
let heroes = new Map();
let collectionCatalog = new Map();
let heroImages = new Map();
let photoImages = new Map();
let homepageIds = [];
let savedHomepageIds = [];
let maxHomepageAlbums = 6;
let homepageReady = false;
let homepageBusy = false;
let selectedPhoto;
let heroRequest = 0;
let memberPage = 1, memberRequest = 0;
const memberFilter = document.querySelector('#admin-users-filter');
const memberStatus = document.querySelector('#admin-users-status');

function failure(error) {
  message(status, error.message || 'The administration data could not be loaded.', true);
  if (error.status === 401 || error.status === 403) {
    content.hidden = true; access.hidden = false;
    document.querySelector('#admin-signin').hidden = false;
    message(access, 'Administrator access could not be confirmed. Sign in again to continue.');
  }
}

async function summary() {
  const data = await api('/api/admin/summary');
  const labels = { pendingAnnotationUsers: 'Awaiting annotation approval', unreviewedComments: 'Comments to review', unreviewedAnnotations: 'Annotations to review', users: 'Members', comments: 'Visible comments', annotations: 'Visible annotations', likes: 'Photo likes', subscribers: 'Confirmed subscribers' };
  document.querySelector('#admin-summary').replaceChildren(...Object.entries(labels).map(([key, label]) => {
    const item = el('div', 'admin-stat');
    item.append(el('strong', '', Number(data[key] || 0).toLocaleString()), el('span', '', label));
    return item;
  }));
}

function userRow(item) {
  const row = el('li', 'admin-row');
  const details = el('div');
  details.append(el('strong', '', item.displayName), el('p', '', item.email), el('p', '', `${item.role} · ${item.status} · Joined ${when(item.createdAt)}`));
  details.append(el('p', 'member-permission', item.role === 'admin' ? 'Administrator · Full annotation access'
    : `Annotation access: ${{pending: 'awaiting approval', approved: 'approved', revoked: 'revoked'}[item.annotationStatus] || 'awaiting approval'}`));
  if (!item.verifiedAt) details.append(el('p', 'field-help', 'Email verification required before annotation access can be approved.'));
  if (item.lastLoginAt) details.append(el('p', '', `Last sign-in ${when(item.lastLoginAt)}`));
  row.append(details);
  if (item.id !== user.id && item.role !== 'admin') {
    const actions = el('div', 'member-actions');
    const options = item.annotationStatus === 'approved'
      ? [['Revoke annotation access', {annotationStatus: 'revoked'}, false]]
      : [['Approve annotations', {annotationStatus: 'approved'}, !item.verifiedAt || item.status !== 'active'],
        ...(item.annotationStatus === 'pending' ? [['Decline annotations', {annotationStatus: 'revoked'}, false]] : [])];
    options.push([item.status === 'suspended' ? 'Reactivate account' : 'Suspend account', { status: item.status === 'suspended' ? 'active' : 'suspended' }, false]);
    for (const [label, body, disabled] of options) {
      const button = el('button', body.annotationStatus === 'approved' ? 'button' : 'button button--light', label);
      button.type = 'button'; button.disabled = disabled;
      button.addEventListener('click', () => working(row, async () => {
        try {
          await api(`/api/admin/users/${encodeURIComponent(item.id)}`, { method: 'PATCH', body });
          const reloaded = await loadMembers(memberPage);
          if (reloaded) message(memberStatus, `${item.displayName}: ${body.annotationStatus ? `annotation access ${body.annotationStatus}` : `account ${body.status}`}.`);
          await summary();
        } catch (error) { message(memberStatus, error.message, true); failure(error); }
      }));
      actions.append(button);
    }
    row.append(actions);
  }
  return row;
}

async function loadMembers(targetPage = 1) {
  const requestId = ++memberRequest;
  const previous = document.querySelector('#admin-users-previous');
  const next = document.querySelector('#admin-users-next');
  previous.disabled = next.disabled = true;
  message(memberStatus, 'Loading members…');
  try {
    const data = await api(`/api/admin/users?annotationStatus=${encodeURIComponent(memberFilter.value)}&page=${targetPage}`);
    if (requestId !== memberRequest) return;
    if (!data.users.length && targetPage > 1) return loadMembers(targetPage - 1);
    memberPage = targetPage;
    const list = document.querySelector('#admin-users');
    list.replaceChildren(...data.users.map(userRow));
    if (!data.users.length) list.append(el('li', 'community-empty', memberFilter.value === 'pending' ? 'No members are waiting for annotation approval.' : 'No members match this filter.'));
    previous.disabled = memberPage === 1; next.disabled = !data.hasMore;
    document.querySelector('#admin-users-page').textContent = `Page ${memberPage}`;
    message(memberStatus, `${data.users.length} members shown.`);
    return true;
  } catch (error) { if (requestId === memberRequest) { message(memberStatus, error.message, true); failure(error); } }
}
memberFilter.addEventListener('change', () => loadMembers());
document.querySelector('#admin-users-refresh').addEventListener('click', () => loadMembers(memberPage));
document.querySelector('#admin-users-previous').addEventListener('click', () => loadMembers(memberPage - 1));
document.querySelector('#admin-users-next').addEventListener('click', () => loadMembers(memberPage + 1));

function activityRow(item) {
  const descriptions = { 'comment.created': 'Added a comment', 'comment.hidden': 'Hid a comment', 'comment.reviewed': 'Reviewed a comment', 'comment.restored': 'Restored a comment', 'annotation.created': 'Added a name', 'annotation.hidden': 'Hid a name', 'annotation.reviewed': 'Reviewed a name', 'annotation.restored': 'Restored a name', 'user.annotations_approved': 'Approved annotation access', 'user.annotations_revoked': 'Revoked annotation access', 'like.added': 'Liked a photograph', 'like.removed': 'Removed a like', 'collection.hero_changed': 'Changed a collection cover', 'user.status_changed': 'Changed a member’s status' };
  const row = el('li', 'admin-row');
  const details = el('div');
  details.append(el('strong', '', item.displayName || 'Archive member'), el('p', '', descriptions[item.action] || item.action), el('p', '', when(item.createdAt)));
  row.append(details);
  if (item.photoId) {
    const review = el('a', 'quiet-button', 'Review photograph');
    const type = item.action.startsWith('comment.') ? 'comment' : item.action.startsWith('annotation.') ? 'annotation' : null;
    review.href = `/image/${encodeURIComponent(item.photoId)}/${type && item.targetId ? `#${type}-${encodeURIComponent(item.targetId)}` : '#community'}`;
    row.append(review);
  }
  return row;
}

function subscriberRow(item) {
  const row = el('li', 'admin-row');
  const details = el('div');
  details.append(el('strong', '', item.displayName || item.email), el('p', '', item.email), el('p', '', `${item.status} · Consent recorded ${when(item.consentAt)}`));
  if (item.confirmedAt) details.append(el('p', '', `Email confirmed ${when(item.confirmedAt)}`));
  if (item.unsubscribedAt) details.append(el('p', '', `Unsubscribed ${when(item.unsubscribedAt)}`));
  row.append(details);
  return row;
}

function pagedSection(kind, createRow) {
  const list = document.querySelector(`#admin-${kind}`);
  const more = document.querySelector(`#admin-${kind}-more`);
  let page = 0;
  async function load() {
    more.disabled = true;
    try {
      const data = await api(`/api/admin/${kind}?page=${page + 1}`);
      page += 1;
      const items = data[kind] || [];
      if (!page || page === 1) list.replaceChildren();
      list.append(...items.map(createRow));
      if (page === 1 && !items.length) list.append(el('li', 'community-empty', `No ${kind} to show yet.`));
      more.hidden = !data.hasMore;
    } catch (error) { failure(error); }
    finally { more.disabled = false; }
  }
  more.addEventListener('click', load);
  return load();
}

function updateHeroSelection() {
  for (const button of heroGrid.querySelectorAll('button')) button.setAttribute('aria-pressed', String(Number(button.dataset.photoId) === selectedPhoto));
  heroSave.disabled = !selectedPhoto || selectedPhoto === heroes.get(collectionSelect.value);
}

function updateHomepageControls() {
  for (const option of homepageSelect.options) option.disabled = homepageIds.includes(option.value);
  homepageSelect.disabled = !homepageReady || homepageBusy || homepageIds.length >= maxHomepageAlbums;
  homepageAdd.disabled = homepageSelect.disabled || !homepageSelect.value || homepageIds.includes(homepageSelect.value);
  homepageSave.disabled = !homepageReady || homepageBusy || !homepageIds.length || JSON.stringify(homepageIds) === JSON.stringify(savedHomepageIds);
  document.querySelector('#admin-homepage-count').textContent = homepageReady ? `${homepageIds.length} of ${maxHomepageAlbums} albums selected. Keep at least one album.` : '';
}

function renderHomepage(focusId, focusAction) {
  homepageList.replaceChildren(...homepageIds.map((id, index) => {
    const collection = collectionCatalog.get(id);
    const row = el('li', 'homepage-album');
    const image = el('img', 'homepage-album__image');
    const base = heroImages.get(id) || collection.imageBase;
    if (/^https:\/\//i.test(base)) image.src = `${base.replace(/\/$/, '')}/thumb.webp`;
    image.width = 200; image.height = 133; image.alt = ''; image.loading = 'lazy';
    const details = el('div', 'homepage-album__details');
    details.append(el('strong', '', `${index + 1}. ${collection.title}`), el('p', '', `Roll ${collection.roll}${index === 0 ? ' · Large homepage photograph' : ''}`));
    const controls = el('div', 'homepage-album__actions');
    for (const [action, label, disabled] of [['up', 'Move up', index === 0], ['down', 'Move down', index === homepageIds.length - 1], ['remove', 'Remove', homepageIds.length === 1]]) {
      const button = el('button', 'quiet-button', label);
      button.type = 'button'; button.disabled = disabled || homepageBusy;
      button.dataset.collectionId = id; button.dataset.action = action;
      button.setAttribute('aria-label', `${label}: ${collection.title}`);
      button.addEventListener('click', () => {
        if (homepageBusy) return;
        if (action === 'remove') homepageIds.splice(index, 1);
        else {
          const next = action === 'up' ? index - 1 : index + 1;
          [homepageIds[index], homepageIds[next]] = [homepageIds[next], homepageIds[index]];
        }
        renderHomepage(action === 'remove' ? homepageIds[Math.min(index, homepageIds.length - 1)] : id, action);
        message(homepageStatus, 'Changes are ready to save.');
      });
      controls.append(button);
    }
    row.append(image, details, controls);
    return row;
  }));
  updateHomepageControls();
  if (focusId) {
    const buttons = [...homepageList.querySelectorAll('button')];
    const target = buttons.find(button => button.dataset.collectionId === focusId && button.dataset.action === focusAction && !button.disabled)
      || buttons.find(button => button.dataset.collectionId === focusId && !button.disabled);
    (target || homepageSelect).focus();
  }
}

async function loadHomepage() {
  try {
    const data = await api('/api/admin/homepage');
    if (!Array.isArray(data.collectionIds)) throw new Error('The saved homepage albums could not be loaded. Please try again.');
    maxHomepageAlbums = Math.min(6, Number(data.maxCollections) || 6);
    savedHomepageIds = [...data.collectionIds];
    homepageIds = data.collectionIds.filter(id => collectionCatalog.has(id));
    const unavailableCount = savedHomepageIds.length - homepageIds.length;
    homepageReady = true;
    renderHomepage();
    message(homepageStatus, unavailableCount
      ? `${unavailableCount} saved ${unavailableCount === 1 ? 'album is' : 'albums are'} no longer available and ${unavailableCount === 1 ? 'has' : 'have'} been left out of this draft. ${homepageIds.length ? 'Review the remaining albums' : 'Add at least one album'}, then save to update the homepage.`
      : 'The published album order is shown above. Public changes appear within a minute of saving.');
    document.querySelector('#admin-homepage-retry')?.remove();
  } catch (error) {
    message(homepageStatus, error.message, true);
    if (!document.querySelector('#admin-homepage-retry')) {
      const retry = el('button', 'quiet-button', 'Try loading homepage albums again');
      retry.id = 'admin-homepage-retry'; retry.type = 'button';
      retry.addEventListener('click', async () => { retry.disabled = true; await loadHomepage(); retry.disabled = false; });
      homepageStatus.after(retry);
    }
  }
}

homepageSelect.addEventListener('change', updateHomepageControls);
homepageAdd.addEventListener('click', () => {
  const id = homepageSelect.value;
  if (!homepageReady || homepageBusy || homepageIds.length >= maxHomepageAlbums || !collectionCatalog.has(id) || homepageIds.includes(id)) return;
  homepageIds.push(id); homepageSelect.value = '';
  renderHomepage(id, 'up');
  message(homepageStatus, 'Album added. Save the homepage albums to publish this choice.');
});
homepageSave.addEventListener('click', async () => {
  if (!homepageReady || homepageBusy || !homepageIds.length || homepageIds.length > maxHomepageAlbums) return;
  homepageBusy = true; renderHomepage();
  try {
    const data = await api('/api/admin/homepage', { method: 'PUT', body: { collectionIds: [...homepageIds] } });
    homepageIds = [...data.collectionIds]; savedHomepageIds = [...data.collectionIds];
    message(homepageStatus, 'Homepage albums saved. Public pages update within a minute.');
  } catch (error) { message(homepageStatus, error.message, true); }
  finally { homepageBusy = false; renderHomepage(); }
});

collectionSelect.addEventListener('change', async () => {
  const requestId = ++heroRequest;
  selectedPhoto = null;
  heroSave.disabled = true;
  heroGrid.replaceChildren();
  const collectionId = collectionSelect.value;
  if (!collectionId) { message(heroStatus, 'Choose a collection to select its cover.'); return; }
  message(heroStatus, 'Loading photographs…');
  try {
    const data = await api(`/api/admin/collections/${encodeURIComponent(collectionId)}/photos`);
    if (requestId !== heroRequest) return;
    selectedPhoto = heroes.get(collectionId) || null;
    for (const photo of data.photos || []) {
      photoImages.set(Number(photo.id), photo.image_base);
      const button = el('button', 'hero-choice');
      button.type = 'button';
      button.dataset.photoId = photo.id;
      button.setAttribute('aria-label', `Select photograph ${photo.id} as the cover`);
      const image = el('img');
      image.alt = photo.title || 'Archive photograph';
      image.width = Number(photo.width) || 300;
      image.height = Number(photo.height) || 200;
      image.loading = 'lazy';
      if (/^https:\/\//i.test(photo.image_base)) image.src = `${photo.image_base.replace(/\/$/, '')}/thumb.webp`;
      button.append(image, el('span', '', `Photograph ${photo.id}`));
      button.addEventListener('click', () => { selectedPhoto = Number(photo.id); updateHeroSelection(); message(heroStatus, 'Photograph selected. Save the cover to publish this choice.'); });
      heroGrid.append(button);
    }
    updateHeroSelection();
    message(heroStatus, selectedPhoto ? 'The current custom cover is selected.' : 'Choose a photograph for this collection’s cover.');
  } catch (error) { if (requestId === heroRequest) message(heroStatus, error.message, true); }
});
heroSave.addEventListener('click', async () => {
  if (!selectedPhoto || !collectionSelect.value) return;
  const collectionId = collectionSelect.value;
  const photoId = selectedPhoto;
  heroSave.disabled = true;
  collectionSelect.disabled = true;
  try {
    await api(`/api/admin/collections/${encodeURIComponent(collectionId)}/hero`, { method: 'PUT', body: { photoId } });
    heroes.set(collectionId, photoId);
    if (photoImages.has(photoId)) { heroImages.set(collectionId, photoImages.get(photoId)); renderHomepage(); }
    updateHeroSelection();
    message(heroStatus, 'Cover saved. Public pages update within a minute.');
    await summary();
  } catch (error) { heroSave.disabled = false; message(heroStatus, error.message, true); }
  finally { collectionSelect.disabled = false; }
});

async function start() {
  ({ user } = await api('/api/auth/me'));
  setAccountIndicator(user);
  if (!user || user.role !== 'admin') {
    message(access, user ? 'Your account does not have administrator access.' : 'Sign in with an administrator account to continue.');
    return;
  }
  access.hidden = true;
  document.querySelector('#admin-signin').hidden = true;
  content.hidden = false;
  // Moderation remains usable even if the independent album tools fail to load.
  const reviewWork = Promise.allSettled([summary().catch(failure), loadMembers(),
    mountModeration({ onChange: () => summary().catch(failure), onError: failure }),
    pagedSection('activity', activityRow), pagedSection('subscribers', subscriberRow)]);
  const catalogPath = content.dataset.collections;
  const catalog = await fetch(catalogPath).then(response => { if (!response.ok) throw new Error('The collection list could not be loaded.'); return response.json(); });
  collectionCatalog = new Map(catalog.map(collection => [collection.id, collection]));
  const current = await api('/api/admin/collections');
  heroes = new Map(current.collections.map(item => [item.id, item.heroPhotoId]));
  for (const collection of catalog) {
    const option = el('option', '', `${collection.title} · Roll ${collection.roll}`);
    option.value = collection.id;
    collectionSelect.append(option);
    const homepageOption = el('option', '', `${collection.title} · Roll ${collection.roll}`);
    homepageOption.value = collection.id;
    homepageSelect.append(homepageOption);
  }
  await Promise.all([loadHomepage(), api('/api/collection-heroes').then(data => {
    for (const hero of data.heroes || []) if (collectionCatalog.has(hero.collectionId)) heroImages.set(hero.collectionId, hero.imageBase);
    if (homepageReady) renderHomepage();
  }).catch(() => {}), reviewWork]);
}
start().catch(failure);
