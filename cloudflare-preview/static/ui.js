export function el(tag, className = '', text) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (text !== undefined) item.textContent = text;
  return item;
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method, signal, credentials: 'same-origin', cache: 'no-store',
    headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(typeof data.error === 'string' ? data.error : 'This request could not be completed. Please try again.');
    error.status = response.status;
    throw error;
  }
  return data;
}

export function message(target, text, error = false) {
  target.textContent = text;
  target.classList.toggle('is-error', error);
}

export async function working(container, action) {
  if (container.dataset.busy === 'true') return;
  container.dataset.busy = 'true';
  container.setAttribute('aria-busy', 'true');
  const controls = [...container.querySelectorAll('button, input, textarea, select')];
  const disabled = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try { return await action(); }
  finally {
    controls.forEach((control, index) => { control.disabled = disabled[index]; });
    container.dataset.busy = 'false';
    container.setAttribute('aria-busy', 'false');
  }
}

export const when = timestamp => {
  const value = Number(timestamp);
  return value > 0 ? new Date(value * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
};

export const accountLink = () => `/account/?returnTo=${encodeURIComponent(`${location.pathname}${location.search}#community`)}`;

export function setAccountIndicator(user) {
  const link = document.querySelector('#site-account-link');
  if (!link) return;
  const signedIn = Boolean(user && ['member', 'admin'].includes(user.role));
  link.textContent = signedIn ? 'My account' : 'Sign in / create account';
  link.dataset.signedIn = String(signedIn);
  const admin = document.querySelector('#site-admin-link');
  if (admin) admin.hidden = user?.role !== 'admin';
}

export function signin(text = 'Sign in to take part') {
  const link = el('a', 'text-link', text);
  link.href = accountLink();
  return link;
}

export function safeReturnTo() {
  const value = new URLSearchParams(location.search).get('returnTo');
  if (!value || !value.startsWith('/') || value.startsWith('//')) return null;
  const target = new URL(value, location.origin);
  return target.origin === location.origin && target.pathname !== '/account/' ? `${target.pathname}${target.search}${target.hash}` : null;
}

export function initializeEmailCode({ prefix, requestPath, verifyPath, makeBody, onVerified }) {
  const requestForm = document.querySelector(`#${prefix}-request`);
  const verifyForm = document.querySelector(`#${prefix}-verify`);
  const status = document.querySelector(`#${prefix}-status`);
  const resend = document.querySelector(`#${prefix}-resend`);
  const change = document.querySelector(`#${prefix}-change`);
  let challengeId;
  let lastBody;
  let countdown;
  let resendAt = 0;
  function refreshResend() {
    const remaining = Math.max(0, Math.ceil((resendAt - Date.now()) / 1000));
    resend.disabled = remaining > 0;
    resend.textContent = remaining ? `Resend in ${remaining}s` : 'Resend code';
    if (!remaining) clearInterval(countdown);
  }
  async function request() {
    const data = await api(requestPath, { method: 'POST', body: lastBody });
    challengeId = data.challengeId;
    if (!challengeId) throw new Error('A verification code could not be requested. Please try again.');
    requestForm.hidden = true;
    verifyForm.hidden = false;
    verifyForm.elements.code.value = '';
    document.querySelector(`#${prefix}-email-label`).textContent = lastBody.email;
    message(status, data.message || 'Check your email for an eight-digit code.');
    resendAt = Date.now() + 60000;
    clearInterval(countdown);
    countdown = setInterval(refreshResend, 1000);
    refreshResend();
    verifyForm.elements.code.focus();
  }
  requestForm.addEventListener('submit', event => {
    event.preventDefault();
    lastBody = makeBody(requestForm);
    working(requestForm, request).catch(error => message(status, error.message, true));
  });
  verifyForm.addEventListener('submit', event => {
    event.preventDefault();
    const code = verifyForm.elements.code.value.trim();
    working(verifyForm, async () => {
      const data = await api(verifyPath, { method: 'POST', body: { challengeId, code } });
      clearInterval(countdown);
      await onVerified(data);
    }).catch(error => message(status, error.message, true)).finally(refreshResend);
  });
  resend.addEventListener('click', () => {
    if (Date.now() < resendAt) return;
    working(verifyForm, request).catch(error => message(status, error.message, true)).finally(refreshResend);
  });
  change.addEventListener('click', () => {
    clearInterval(countdown);
    verifyForm.hidden = true;
    requestForm.hidden = false;
    challengeId = null;
    message(status, '');
    requestForm.elements.email.focus();
  });
}
