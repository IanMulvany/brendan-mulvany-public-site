import {api, el, message} from './ui.js';

const photo = document.querySelector('.photo-detail[data-photo-id]');
const collection = document.querySelector('#collection-cover-tools[data-collection-id]');
const admin = document.querySelector('#admin-content');

function textField(label, value, multiline) {
  const wrapper = el('label', 'editorial-label', label);
  const input = el(multiline ? 'textarea' : 'input');
  if (multiline) input.rows = 5;
  input.value = value || '';
  input.maxLength = multiline ? 3000 : 180;
  wrapper.append(input);
  return {wrapper, input};
}

async function renderQueue(target, kind, entityId) {
  const {corrections} = await api('/api/admin/corrections?status=open');
  target.replaceChildren();
  for (const row of corrections.filter(item => !kind || (item.kind === kind && item.entityId === entityId))) {
    const stage = row.status === 'pending' ? 'queued for local sync' : row.status === 'applied_local' ? 'applied locally; awaiting publication' : 'needs conflict review';
    const change = row.field === 'rotation' ? `rotate ${row.value}` : `${row.field}: “${row.value}”`;
    const item = el('li', '', `${row.kind} ${row.entityId} · ${change} — ${stage}`);
    const cancel = el('button', 'quiet-button', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await api(`/api/admin/corrections/${encodeURIComponent(row.id)}`, {method: 'DELETE'}); await renderQueue(target, kind, entityId); }
      catch (error) { cancel.disabled = false; window.alert(error.message); }
    });
    if (row.status === 'pending') item.append(' ', cancel);
    target.append(item);
  }
  if (!target.childElementCount) target.append(el('li', '', 'No queued corrections.'));
}

async function mountEditor(kind, entityId) {
  const fields = kind === 'photo' ? ['title', 'description', 'date', 'location', 'rotation'] : ['title', 'description', 'year'];
  const values = kind === 'photo'
    ? (await api(`/api/admin/corrections/photo/${encodeURIComponent(entityId)}`)).photo
    : {title: document.querySelector('.page-intro h1')?.textContent || '',
       description: document.querySelector('.page-intro__description')?.textContent || '',
       year: collection.dataset.collectionYear || ''};
  const section = el('section', 'editorial-tools');
  section.setAttribute('aria-label', 'Archive corrections');
  section.append(el('h2', '', 'Suggest an archive correction'));
  section.append(el('p', 'field-help', 'Only you can see this editor. Saved corrections stay private until reviewed and published from the local archive.'));
  const form = el('form', 'editorial-form');
  const fieldLabel = el('label', 'editorial-label', 'Field');
  const fieldSelect = el('select');
  for (const name of fields) {
    const option = el('option', '', name === 'rotation' ? 'Image rotation' : name === 'year' ? 'Collection year' : name[0].toUpperCase() + name.slice(1));
    option.value = name;
    fieldSelect.append(option);
  }
  fieldLabel.append(fieldSelect);
  const editorSlot = el('div');
  let editor;
  function showField() {
    if (fieldSelect.value === 'rotation') {
      const wrapper = el('label', 'editorial-label', 'Direction');
      const input = el('select');
      for (const [value, label] of [['left', 'Rotate 90° left'], ['right', 'Rotate 90° right']]) {
        const option = el('option', '', label);
        option.value = value;
        input.append(option);
      }
      wrapper.append(input);
      editor = {wrapper, input};
      editorSlot.replaceChildren(wrapper);
      return;
    }
    editor = textField(fieldSelect.value === 'year' ? 'Correct year (YYYY)' : 'Proposed value', values[fieldSelect.value], fieldSelect.value === 'description');
    if (fieldSelect.value === 'year') {
      editor.input.maxLength = 4;
      editor.input.inputMode = 'numeric';
      editor.input.pattern = '[0-9]{4}';
      editorSlot.replaceChildren(editor.wrapper, el('p', 'field-help', 'Also updates photographs in this collection that still use the old year. Photographs with their own dates are preserved.'));
    } else editorSlot.replaceChildren(editor.wrapper);
  }
  fieldSelect.addEventListener('change', showField);
  showField();
  const submit = el('button', 'button', 'Queue correction');
  submit.type = 'submit';
  const status = el('p', 'form-status');
  status.setAttribute('role', 'status');
  const list = el('ul', 'editorial-queue');
  form.append(fieldLabel, editorSlot, submit, status);
  section.append(form, el('h3', '', 'Queued for this item'), list);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    submit.disabled = true;
    try {
      const field = fieldSelect.value;
      await api('/api/admin/corrections', {method: 'POST', body: {
        kind, entityId, field, baseValue: field === 'rotation' ? values.imageBase : values[field] || '', value: editor.input.value,
      }});
      message(status, 'Saved to your correction queue. The public site has not changed yet.');
      await renderQueue(list, kind, entityId);
    } catch (error) { message(status, error.message, true); }
    finally { submit.disabled = false; }
  });
  if (kind === 'photo') photo.after(section);
  else collection.after(section);
  await renderQueue(list, kind, entityId);
}

async function mountAdminQueue() {
  const section = el('section', 'admin-section editorial-tools');
  section.id = 'admin-corrections-section';
  section.append(el('h2', '', 'Archive corrections'),
    el('p', 'field-help', 'These changes await local archive review and publication. Open an item to make another correction.'));
  const list = el('ul', 'editorial-queue');
  section.append(list);
  admin.append(section);
  await renderQueue(list);
}

if (photo || collection || admin) {
  api('/api/auth/me').then(async ({user}) => {
    if (user?.role !== 'admin') return;
    if (photo) await mountEditor('photo', photo.dataset.photoId);
    else if (collection) await mountEditor('collection', collection.dataset.collectionId);
    if (admin) await mountAdminQueue();
  }).catch(() => {});
}
