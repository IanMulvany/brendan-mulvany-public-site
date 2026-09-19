const form = document.querySelector('#notebook-filter-form');
if (form) {
  const query = document.querySelector('#notebook-query');
  const book = document.querySelector('#notebook-book');
  const view = document.querySelector('#notebook-view');
  const cards = [...document.querySelectorAll('[data-notebook-card]')];
  const params = new URLSearchParams(location.search);
  query.value = (params.get('q') || '').slice(0, 120);
  if ([...book.options].some(option => option.value === params.get('book'))) book.value = params.get('book');
  if (params.get('view') === 'all') view.value = 'all';
  function filter() {
    const words = query.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      card.hidden = (book.value !== 'all' && card.dataset.book !== book.value)
        || (view.value === 'linked' && card.dataset.linked !== 'true')
        || !words.every(word => card.dataset.search.includes(word));
      if (!card.hidden) shown++;
    }
    document.querySelector('#notebook-results').textContent = `${shown} ${shown === 1 ? 'page' : 'pages'} shown${view.value === 'linked' ? ' with published photographs' : ''}.`;
    document.querySelector('#notebook-empty').hidden = shown !== 0;
    const next = new URLSearchParams();
    if (query.value.trim()) next.set('q', query.value.trim());
    if (book.value !== 'all') next.set('book', book.value);
    if (view.value === 'all') next.set('view', 'all');
    history.replaceState(null, '', `${location.pathname}${next.size ? `?${next}` : ''}`);
  }
  form.addEventListener('submit', event => { event.preventDefault(); filter(); });
  query.addEventListener('input', filter);
  book.addEventListener('change', filter);
  view.addEventListener('change', filter);
  filter();
}

const canvas = document.querySelector('#notebook-canvas');
if (canvas) {
  const viewport = document.querySelector('#notebook-viewport');
  const zoomIn = document.querySelector('#notebook-zoom-in');
  const zoomOut = document.querySelector('#notebook-zoom-out');
  const reset = document.querySelector('#notebook-zoom-reset');
  let zoom = 1;
  document.querySelector('#notebook-zoom-controls').hidden = false;
  function resize(value) {
    const centerX = (viewport.scrollLeft + viewport.clientWidth / 2) / canvas.clientWidth;
    const centerY = (viewport.scrollTop + viewport.clientHeight / 2) / canvas.clientHeight;
    zoom = Math.max(1, Math.min(3, value));
    canvas.style.width = `${zoom * 100}%`;
    viewport.scrollLeft = centerX * canvas.clientWidth - viewport.clientWidth / 2;
    viewport.scrollTop = centerY * canvas.clientHeight - viewport.clientHeight / 2;
    zoomOut.disabled = zoom === 1; zoomIn.disabled = zoom === 3;
    document.querySelector('#notebook-zoom-status').textContent = zoom === 1
      ? 'Select a highlighted row, or enlarge the page to read the handwriting.'
      : `${Math.round(zoom * 100)}% · Scroll the image to explore the page. Highlighted rows remain clickable.`;
  }
  zoomIn.addEventListener('click', () => resize(zoom + .5));
  zoomOut.addEventListener('click', () => resize(zoom - .5));
  reset.addEventListener('click', () => { resize(1); viewport.scrollTop = viewport.scrollLeft = 0; });
  const regions = [...document.querySelectorAll('[data-notebook-region]')];
  const entries = [...document.querySelectorAll('[data-notebook-entry]')];
  function highlight(id) {
    for (const item of [...regions, ...entries]) item.classList.toggle('is-selected', (item.dataset.notebookRegion || item.dataset.notebookEntry) === id);
  }
  for (const item of [...regions, ...entries]) {
    const id = item.dataset.notebookRegion || item.dataset.notebookEntry;
    item.addEventListener('pointerenter', () => highlight(id));
    item.addEventListener('focusin', () => highlight(id));
    item.addEventListener('pointerleave', () => highlight(location.hash.slice(1)));
  }
  function fromHash() {
    const id = location.hash.slice(1);
    highlight(id);
    const region = regions.find(item => item.dataset.notebookRegion === id);
    if (region && !region.getAttribute('href')?.startsWith('#')) region.scrollIntoView({block: 'center', inline: 'nearest'});
  }
  window.addEventListener('hashchange', fromHash);
  const image = canvas.querySelector('img');
  if (image.complete) fromHash(); else image.addEventListener('load', fromHash, {once:true});
  resize(1);
}
