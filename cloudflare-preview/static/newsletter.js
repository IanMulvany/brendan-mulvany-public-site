import { api, initializeEmailCode, message, working } from './ui.js';

const guest = document.querySelector('#newsletter-guest');
const member = document.querySelector('#newsletter-member');
const status = document.querySelector('#newsletter-status');
const memberStatus = document.querySelector('#newsletter-member-status');
const form = document.querySelector('#newsletter-member-form');
const unsubscribe = document.querySelector('#newsletter-unsubscribe');

function showSubscription(state) {
  const confirmed = state.status === 'confirmed';
  form.hidden = confirmed;
  if (!confirmed) form.elements.consent.checked = false;
  unsubscribe.hidden = !confirmed;
  message(memberStatus, confirmed ? 'Your newsletter subscription is confirmed.' : state.status === 'unsubscribed' ? 'You are unsubscribed. You can join again below.' : 'Choose below if you would like to receive archive news.');
}

initializeEmailCode({
  prefix: 'newsletter', requestPath: '/api/newsletter/request', verifyPath: '/api/newsletter/verify',
  makeBody: form => ({ email: form.elements.email.value.trim(), ...(form.elements.displayName.value.trim() ? { displayName: form.elements.displayName.value.trim() } : {}), consent: form.elements.consent.checked }),
  onVerified: () => {
    document.querySelector('#newsletter-request').hidden = true;
    document.querySelector('#newsletter-verify').hidden = true;
    message(status, 'Your newsletter subscription is confirmed. Thank you for keeping in touch with the archive.');
  },
});

form.addEventListener('submit', event => {
  event.preventDefault();
  const consent = form.elements.consent.checked;
  working(form, async () => showSubscription(await api('/api/newsletter/subscribe', { method: 'POST', body: { consent } }))).catch(error => message(memberStatus, error.message, true));
});
unsubscribe.addEventListener('click', () => {
  unsubscribe.disabled = true;
  api('/api/newsletter/unsubscribe', { method: 'POST', body: {} }).then(showSubscription).catch(error => message(memberStatus, error.message, true)).finally(() => { unsubscribe.disabled = false; });
});
api('/api/auth/me').then(async ({ user }) => {
  if (!user) return;
  guest.hidden = true;
  member.hidden = false;
  document.querySelector('#newsletter-member-email').textContent = user.email;
  showSubscription(await api('/api/newsletter/status'));
}).catch(error => message(member.hidden ? status : memberStatus, error.message, true));
