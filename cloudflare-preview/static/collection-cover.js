import { api, el, message } from './ui.js';

const tools = document.querySelector('#collection-cover-tools');
const grid = document.querySelector('#collection-photos');
const toggle = document.querySelector('#collection-cover-toggle');
const status = document.querySelector('#collection-cover-status');
const currentLink = document.querySelector('#collection-cover-current');
const signin = document.querySelector('#collection-cover-signin');
const choices = [];
let editing = false;
let busy = false;
let currentPhoto;
let expired = false;

function render() {
  toggle.disabled = busy || expired;
  toggle.textContent = editing ? 'Done choosing' : 'Choose collection cover';
  toggle.setAttribute('aria-expanded', String(editing));
  grid.setAttribute('aria-busy', String(busy));
  for (const { card, button, id } of choices) {
    button.hidden = !editing;
    button.disabled = busy || expired || id === currentPhoto;
    button.textContent = id === currentPhoto ? 'Current collection cover' : 'Use as collection cover';
    button.setAttribute('aria-label', id === currentPhoto ? `Photograph ${id} is the current collection cover` : `Use photograph ${id} as the collection cover`);
    card.classList.toggle('is-collection-cover', editing && id === currentPhoto);
  }
  currentLink.hidden = !currentPhoto;
  if (currentPhoto) currentLink.href = `/image/${currentPhoto}/`;
}

function failure(error) {
  if (error.status === 401 || error.status === 403) {
    expired = true;
    editing = false;
    signin.hidden = false;
    message(status, 'Sign in with an administrator account again to change this cover.', true);
  } else message(status, error.message, true);
}

async function save(id) {
  if (busy || expired || !editing || id === currentPhoto) return;
  busy = true;
  render();
  message(status, 'Saving collection cover…');
  try {
    const saved = await api(`/api/admin/collections/${encodeURIComponent(tools.dataset.collectionId)}/hero`, {
      method: 'PUT', body: { photoId: id },
    });
    if (!saved.ok || saved.photoId !== id || saved.collectionId !== tools.dataset.collectionId) throw new Error('The cover could not be confirmed. Please try again.');
    currentPhoto = id;
    message(status, 'Cover saved. The homepage and collection directory update within a minute.');
  } catch (error) { failure(error); }
  finally { busy = false; render(); }
}

toggle.addEventListener('click', async () => {
  if (busy || expired) return;
  if (editing) {
    editing = false;
    message(status, '');
    render();
    return;
  }
  busy = true;
  render();
  message(status, 'Loading the current cover…');
  try {
    // This endpoint filters out unpublished/moved choices. Always refresh when
    // opening the picker, including choices made in another admin tab.
    const { heroes } = await api('/api/collection-heroes');
    if (!Array.isArray(heroes)) throw new Error('The current cover could not be loaded. Please try again.');
    const saved = heroes.find(hero => hero.collectionId === tools.dataset.collectionId);
    currentPhoto = Number(saved?.photoId ?? tools.dataset.defaultCoverId);
    if (!Number.isSafeInteger(currentPhoto) || currentPhoto < 1) throw new Error('The current cover could not be loaded. Please try again.');
    if (!choices.length) {
      for (const card of grid.querySelectorAll('[data-photo-id]')) {
        const id = Number(card.dataset.photoId);
        const button = el('button', 'button button--light collection-cover-choice');
        button.type = 'button';
        button.addEventListener('click', () => save(id));
        card.append(button);
        choices.push({ card, button, id });
      }
    }
    editing = true;
    message(status, 'Choose “Use as collection cover” beneath a photograph to save it.');
  } catch (error) { failure(error); }
  finally { busy = false; render(); }
});

signin.href = `/account/?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
api('/api/auth/me').then(({ user }) => {
  if (user?.role === 'admin') tools.hidden = false;
}).catch(() => {}); // An unavailable session check never interferes with browsing.
