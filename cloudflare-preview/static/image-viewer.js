// The viewer stays separate from the annotation stage and its pointer controls.
export function swipeDirection(dx, dy, elapsed, scale = 1) {
  if (scale !== 1 || elapsed > 1000 || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  return dx < 0 ? 1 : -1;
}

export function mountViewer(trigger) {
  if (!trigger || typeof HTMLDialogElement === 'undefined') return;
  const dialog = document.createElement('dialog');
  dialog.className = 'image-viewer';
  dialog.setAttribute('aria-label', 'Full-screen photograph viewer');
  dialog.innerHTML = `<header class="image-viewer__bar"><p class="image-viewer__position" aria-live="polite"></p><button type="button" data-close aria-label="Close full-screen viewer">Close <span aria-hidden="true">×</span></button></header><div class="image-viewer__stage"><button type="button" data-previous aria-label="Previous photograph">←</button><div class="image-viewer__canvas"><img alt="" draggable="false"><p class="image-viewer__status" role="status"></p></div><button type="button" data-next aria-label="Next photograph">→</button></div><footer class="image-viewer__bar"><div><p class="image-viewer__title"></p><p class="image-viewer__hint">Swipe or use ← → to explore this roll · Esc to close</p></div><a data-details>View image page ↗</a></footer>`;
  document.body.append(dialog);
  const select = selector => dialog.querySelector(selector);
  const previous = select('[data-previous]');
  const next = select('[data-next]');
  const canvas = select('.image-viewer__canvas');
  const status = select('.image-viewer__status');
  const position = select('.image-viewer__position');
  const caption = select('.image-viewer__title');
  const details = select('[data-details]');
  let photos = [], index = -1, gesture, request, generation = 0;
  const initialId = String(trigger.dataset.photoId);
  let ownsHistory = false;
  function show(photo, current = -1) {
    const version = ++generation;
    status.textContent = 'Loading photograph…';
    const image = new Image();
    image.alt = photo.title;
    image.draggable = false;
    image.onload = () => { if (version === generation) status.textContent = ''; };
    image.onerror = () => { if (version === generation) status.textContent = 'This photograph could not load. Try its image page, or move to another photograph.'; };
    canvas.querySelector('img').replaceWith(image);
    image.src = photo.src;
    caption.textContent = photo.title;
    details.href = photo.href;
    position.textContent = current < 0 ? 'Photograph' : `${current + 1} / ${photos.length} · ${photo.roll}`;
    previous.disabled = current <= 0;
    next.disabled = current < 0 || current >= photos.length - 1;
  }
  function navigate(delta) {
    if (!dialog.open || index < 0) return;
    const destination = index + delta;
    if (destination < 0 || destination >= photos.length) return;
    index = destination;
    show(photos[index], index);
  }
  function finish() {
    request?.abort();
    gesture = null;
    generation++;
    document.documentElement.classList.remove('image-viewer-open');
    trigger.focus({ preventScroll: true });
  }
  function close() {
    if (!dialog.open) return;
    dialog.close();
    if (ownsHistory && history.state?.imageViewer) {
      ownsHistory = false;
      history.back();
    }
  }
  window.addEventListener('popstate', () => {
    ownsHistory = false;
    if (dialog.open) dialog.close();
  });
  dialog.addEventListener('close', finish);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  select('[data-close]').addEventListener('click', close);
  previous.addEventListener('click', () => navigate(-1));
  next.addEventListener('click', () => navigate(1));
  dialog.addEventListener('keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      navigate(event.key === 'ArrowLeft' ? -1 : 1);
    }
  });
  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' || !event.isPrimary) { gesture = null; return; }
    if ((window.visualViewport?.scale || 1) !== 1) return;
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now() };
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { gesture = null; });
  canvas.addEventListener('pointerup', event => {
    if (!gesture || gesture.id !== event.pointerId) return;
    const direction = swipeDirection(event.clientX - gesture.x, event.clientY - gesture.y,
      performance.now() - gesture.time, window.visualViewport?.scale || 1);
    gesture = null;
    if (direction) navigate(direction);
  });
  trigger.addEventListener('click', async event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (dialog.open) return;
    index = -1;
    dialog.showModal();
    document.documentElement.classList.add('image-viewer-open');
    history.pushState({ ...history.state, imageViewer: true }, '', '#viewer');
    ownsHistory = true;
    show({ title: trigger.dataset.title, src: trigger.dataset.image, href: location.pathname });
    select('[data-close]').focus();
    request?.abort();
    const controller = new AbortController();
    request = controller;
    try {
      if (!photos.length) {
        const response = await fetch(trigger.dataset.viewerSrc, { signal: controller.signal });
        if (!response.ok) throw new Error('Collection unavailable');
        const data = await response.json();
        if (!Array.isArray(data) || !data.length) throw new Error('Empty collection');
        photos = data;
      }
      if (!dialog.open || controller.signal.aborted) return;
      index = photos.findIndex(photo => String(photo.id) === initialId);
      if (index < 0) throw new Error('Photograph not in collection');
      show(photos[index], index);
    } catch (error) {
      if (error.name !== 'AbortError' && dialog.open) {
        position.textContent = 'Collection navigation unavailable. Close and reopen to retry.';
      }
    }
  });
  return { dialog, navigate, close };
}

if (typeof document !== 'undefined') mountViewer(document.querySelector('[data-image-viewer]'));
