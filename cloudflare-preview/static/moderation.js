import { api, el, message, when, working } from './ui.js';

// Every contribution is rendered as text, including HTML-like names or notes.
// This is especially important on a page with administrator privileges.
export function reviewRow(item, kind, onAction) {
  const row = el('li', 'review-card');
  const context = el('a', 'review-card__photo');
  context.href = `/image/${encodeURIComponent(item.photoId)}/#${kind === 'comments' ? 'comment' : 'annotation'}-${encodeURIComponent(item.id)}`;
  if (item.photo && /^https:\/\//i.test(item.photo.imageBase)) {
    const picture = el('img');
    picture.src = `${item.photo.imageBase.replace(/\/$/, '')}/small.webp`;
    picture.alt = item.photo.title || `Photograph ${item.photoId}`;
    picture.width = item.photo.width || 240; picture.height = item.photo.height || 160; picture.loading = 'lazy';
    const frame = el('span', 'review-card__frame');
    frame.append(picture);
    if (kind === 'annotations' && [item.x, item.y, item.width, item.height].every(Number.isFinite)) {
      const area = el('span', 'review-card__area');
      area.setAttribute('aria-hidden', 'true');
      Object.assign(area.style, { left: `${item.x * 100}%`, top: `${item.y * 100}%`, width: `${item.width * 100}%`, height: `${item.height * 100}%` });
      frame.append(area);
    }
    context.append(frame);
  }
  context.append(el('span', '', item.photo ? 'Open photograph ↗' : `Photograph ${item.photoId} (not currently published)`));
  const details = el('div', 'review-card__details');
  const badges = el('div', 'review-card__badges');
  badges.append(el('span', `review-badge${item.hiddenAt ? ' is-hidden' : ''}`, item.hiddenAt ? 'Hidden' : 'Public'),
    el('span', 'review-badge', item.reviewedAt ? 'Reviewed' : 'Needs review'));
  details.append(badges, el('p', 'review-card__author', `${item.displayName || 'Archive member'} · ${item.email}`),
    el('p', 'field-help', `${when(item.createdAt)} · Photograph ${item.photoId}`));
  if (kind === 'comments') details.append(el('p', 'review-card__body', item.body));
  else {
    details.append(el('h3', 'review-card__name', item.name));
    if (item.note) details.append(el('p', 'review-card__body', item.note));
  }
  if (item.reviewedAt) details.append(el('p', 'field-help', `Reviewed ${when(item.reviewedAt)}`));
  const actions = el('div', 'review-card__actions');
  for (const [action, label] of [
    ...(!item.reviewedAt && !item.hiddenAt ? [['review', 'Mark reviewed']] : []),
    [item.hiddenAt ? 'restore' : 'hide', item.hiddenAt ? 'Restore to site' : 'Hide from site'],
  ]) {
    const button = el('button', action === 'review' ? 'button' : 'button button--light', label);
    button.type = 'button'; button.dataset.reviewAction = action;
    button.addEventListener('click', () => onAction(item, action, row));
    actions.append(button);
  }
  details.append(actions); row.append(context, details);
  return row;
}

export function mountModeration({ onChange, onError }) {
  const kind = document.querySelector('#admin-review-kind');
  const filter = document.querySelector('#admin-review-filter');
  const list = document.querySelector('#admin-review-list');
  const status = document.querySelector('#admin-review-status');
  const previous = document.querySelector('#admin-review-previous');
  const next = document.querySelector('#admin-review-next');
  const pageLabel = document.querySelector('#admin-review-page');
  const refresh = document.querySelector('#admin-review-refresh');
  let page = 1, sequence = 0, busy = false, hasMore = false;

  async function load(targetPage = 1) {
    const requestId = ++sequence;
    const selectedKind = kind.value;
    const selectedFilter = filter.value;
    previous.disabled = next.disabled = true;
    list.setAttribute('aria-busy', 'true');
    message(status, 'Loading contributions…');
    try {
      const data = await api(`/api/admin/${selectedKind}?filter=${encodeURIComponent(selectedFilter)}&page=${targetPage}`);
      if (requestId !== sequence) return;
      const items = data[selectedKind] || [];
      if (!items.length && targetPage > 1) return load(targetPage - 1);
      page = targetPage;
      hasMore = Boolean(data.hasMore);
      list.replaceChildren(...items.map(item => reviewRow(item, selectedKind, async (entry, action, row) => {
        if (busy) return;
        busy = true;
        kind.disabled = filter.disabled = refresh.disabled = previous.disabled = next.disabled = true;
        await working(row, async () => {
          try {
            await api(`/api/admin/${selectedKind}/${encodeURIComponent(entry.id)}`, { method: 'PATCH', body: { action } });
            const reloaded = await load(page);
            if (reloaded) message(status, action === 'hide' ? 'Hidden from the public site. You can restore it from the Hidden filter.'
              : action === 'restore' ? 'Restored to the public site.' : 'Marked as reviewed.');
            list.querySelector('button')?.focus({ preventScroll: true });
            await onChange();
          } catch (error) { message(status, error.message, true); onError(error); }
        });
        busy = false;
        kind.disabled = filter.disabled = refresh.disabled = false;
        previous.disabled = page === 1; next.disabled = !hasMore;
      })));
      if (!items.length) list.append(el('li', 'community-empty', selectedFilter === 'unreviewed' ? 'Everything here has been reviewed.' : 'No contributions match this filter.'));
      pageLabel.textContent = `Page ${page}`;
      previous.disabled = page === 1; next.disabled = !data.hasMore;
      message(status, `${items.length} ${selectedKind === 'comments' ? 'comments' : 'annotations'} shown.`);
      return true;
    } catch (error) {
      if (requestId !== sequence) return;
      message(status, error.message || 'Could not load contributions. Please try again.', true);
      onError(error);
      return false;
    } finally { if (requestId === sequence) list.setAttribute('aria-busy', 'false'); }
  }
  kind.addEventListener('change', () => load());
  filter.addEventListener('change', () => load());
  previous.addEventListener('click', () => { if (!busy) load(page - 1); });
  next.addEventListener('click', () => { if (!busy) load(page + 1); });
  refresh.addEventListener('click', () => { if (!busy) load(page); });
  return load();
}
