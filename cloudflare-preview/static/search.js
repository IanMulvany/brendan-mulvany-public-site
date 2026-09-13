const form = document.querySelector('#search-form');
const input = document.querySelector('#search-query');
const collection = document.querySelector('#search-collection');
const results = document.querySelector('#search-results');
const status = document.querySelector('#search-status');
const timing = document.querySelector('#search-timing');
const empty = document.querySelector('#search-empty');
const section = document.querySelector('.search-results-section');
const pagination = document.querySelector('#search-pagination');
const previous = document.querySelector('#search-previous');
const next = document.querySelector('#search-next');
const pageLabel = document.querySelector('#search-page');
let controller;
let sequence = 0;
let debounce;
let currentPage = 1;

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function collectionTitle(id) {
  return [...collection.options].find(option => option.value === String(id))?.text || '';
}

function photoTitle(photo) {
  const raw = String(photo.title || '').trim().replace(/\s*·\s*DSCF\d+.*$/i, '');
  if (raw && !/\.(?:tiff?|jpe?g|png|avif|webp)$/i.test(raw) && !/^[\d_-]+$/.test(raw)) return raw;
  return String(photo.description || collectionTitle(photo.collection_id) || 'From the archive').split(/[\r\n]/)[0].slice(0, 160);
}

function card(photo, index) {
  const article = node('article', 'photo-card');
  const link = node('a', 'photo-card__link');
  link.href = `/photos/${encodeURIComponent(photo.id)}/`;
  const picture = node('picture', 'photo-card__image');
  const image = node('img');
  const source = node('source');
  const base = String(photo.image_base || '').replace(/\/$/, '');
  // Only HTTPS image URLs are accepted. The response CSP limits the host.
  if (/^https:\/\//i.test(base)) {
    source.type = 'image/avif';
    source.srcset = `${base}/thumb.avif 200w, ${base}/small.avif 800w`;
    source.sizes = '(max-width: 700px) 46vw, (max-width: 960px) 47vw, 31vw';
    image.src = `${base}/small.webp`;
  }
  image.width = Number(photo.width) || 1500;
  image.height = Number(photo.height) || 1000;
  image.alt = photoTitle(photo);
  image.loading = index < 3 ? 'eager' : 'lazy';
  image.decoding = 'async';
  picture.append(source, image);
  const caption = node('div', 'photo-card__caption');
  const detail = node('p', '', photo.year || '');
  caption.append(node('h3', '', photoTitle(photo)), detail);
  link.append(picture, caption);
  article.append(link);
  return article;
}

function reset() {
  clearTimeout(debounce);
  controller?.abort();
  sequence += 1;
  results.replaceChildren();
  timing.textContent = '';
  pagination.hidden = true;
  empty.hidden = true;
  section.setAttribute('aria-busy', 'false');
}

function emptyState(heading, description) {
  empty.replaceChildren(node('h2', '', heading), node('p', '', description));
  empty.hidden = false;
}

function params(page = 1) {
  const query = new URLSearchParams();
  if (input.value.trim()) query.set('q', input.value.trim());
  if (collection.value) query.set('collection', collection.value);
  if (page > 1) query.set('page', String(page));
  return query;
}

function updateURL(page) {
  const query = params(page).toString();
  const url = `/search/${query ? `?${query}` : ''}`;
  if (`${location.pathname}${location.search}` !== url) history.pushState({}, '', url);
}

async function search(page = 1, { history = true } = {}) {
  reset();
  currentPage = page;
  if (history) updateURL(page);
  if (!input.value.trim() && !collection.value) {
    status.textContent = 'Enter a search term or choose a collection.';
    emptyState('The archive is waiting.', 'Start with a subject or browse a collection above.');
    return;
  }
  const requestId = sequence;
  controller = new AbortController();
  section.setAttribute('aria-busy', 'true');
  status.textContent = 'Searching the archive';
  const started = performance.now();
  try {
    const query = params(page);
    query.set('page', String(page));
    const response = await fetch(`/api/search?${query}`, { cache: 'no-store', signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!response.ok) {
      const error = new Error(`Search returned ${response.status}`);
      if (response.status === 400) {
        const problem = await response.json().catch(() => null);
        error.userMessage = typeof problem?.error === 'string' ? problem.error : 'Please check your search and try again.';
      }
      throw error;
    }
    const data = await response.json();
    const requestMs = performance.now() - started;
    if (requestId !== sequence) return;
    if (!Array.isArray(data.results)) throw new Error('Invalid search response');
    results.replaceChildren(...data.results.map(card));
    const count = data.results.length;
    const from = ((data.page || page) - 1) * (data.pageSize || 24) + 1;
    const term = input.value.trim();
    status.textContent = count ? `Showing ${from}–${from + count - 1}${term ? ` for “${term}”` : ` in ${collectionTitle(collection.value)}`}` : `No photographs found${term ? ` for “${term}”` : ''}.`;
    if (!count) emptyState('No photographs found.', 'Try a broader word, another spelling or a different collection. This preview contains only three collections.');
    const cached = data.cache === 'HIT';
    const databaseMs = Number(data.timing?.databaseMs);
    timing.textContent = `${Math.round(requestMs)} ms request · ${cached ? 'Cached result' : Number.isFinite(databaseMs) ? `${databaseMs.toFixed(1)} ms database` : 'Fresh result'}`;
    timing.title = cached ? 'Time measured in your browser for this request. The database was not queried for this cached response.' : 'Request time includes the network and server response; database time measures the database query only.';
    pagination.hidden = !(page > 1 || data.hasMore);
    previous.disabled = page <= 1;
    next.disabled = !data.hasMore;
    pageLabel.textContent = `Page ${page}`;
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== sequence) return;
    status.textContent = 'Search could not be completed.';
    emptyState(error.userMessage ? 'Please check your search.' : 'Please try again.', error.userMessage || 'There was a problem loading these results. Press Search to retry, or browse the collections.');
  } finally {
    if (requestId === sequence) section.setAttribute('aria-busy', 'false');
  }
}

function schedule() {
  reset();
  currentPage = 1;
  status.textContent = input.value.trim() || collection.value ? 'Waiting for your search' : 'Enter a search term or choose a collection.';
  debounce = setTimeout(() => search(1), 180);
}

function fromURL() {
  const query = new URLSearchParams(location.search);
  input.value = (query.get('q') || '').slice(0, 120);
  collection.value = query.get('collection') || '';
  const page = Number.parseInt(query.get('page') || '1', 10);
  search(Number.isFinite(page) && page > 0 ? page : 1, { history: false });
}

input.addEventListener('input', schedule);
collection.addEventListener('change', () => search(1));
form.addEventListener('submit', event => { event.preventDefault(); search(1); });
previous.addEventListener('click', () => { search(Math.max(1, currentPage - 1)); section.scrollIntoView({ block: 'start' }); });
next.addEventListener('click', () => { search(currentPage + 1); section.scrollIntoView({ block: 'start' }); });
window.addEventListener('popstate', fromURL);
fromURL();
