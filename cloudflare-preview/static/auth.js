import { api, initializeEmailCode, message, safeReturnTo, setAccountIndicator, working } from './ui.js';

const guest = document.querySelector('#account-guest');
const profile = document.querySelector('#account-profile');
const status = document.querySelector('#account-status');
const profileStatus = document.querySelector('#profile-status');
const profileForm = document.querySelector('#profile-form');
const returnTo = safeReturnTo();

function showUser(user) {
  setAccountIndicator(user);
  guest.hidden = Boolean(user);
  profile.hidden = !user;
  if (!user) return;
  document.querySelector('#profile-email').textContent = user.email;
  document.querySelector('#profile-name').value = user.displayName || '';
  document.querySelector('#account-admin').hidden = user.role !== 'admin';
  document.querySelector('#profile-annotation-status').textContent = user.role === 'admin'
    ? 'Administrator · You can approve annotation access and review all comments and names.'
    : user.canAnnotate ? 'Annotation access approved. You can like, comment and add names.'
      : user.annotationStatus === 'revoked' ? 'You can like and comment. Annotation access is not currently approved.'
        : 'You can like and comment. Your annotation access is awaiting administrator approval.';
  const back = document.querySelector('#account-return');
  back.hidden = !returnTo;
  if (returnTo) back.href = returnTo;
}

initializeEmailCode({
  prefix: 'account', requestPath: '/api/auth/request', verifyPath: '/api/auth/verify',
  makeBody: form => ({ email: form.elements.email.value.trim(), ...(form.elements.displayName.value.trim() ? { displayName: form.elements.displayName.value.trim() } : {}) }),
  onVerified: data => {
    showUser(data.user);
    message(profileStatus, 'You are signed in. Your email address is verified.');
    if (returnTo) location.assign(returnTo);
  },
});

profileForm.addEventListener('submit', event => {
  event.preventDefault();
  const displayName = profileForm.elements.displayName.value.trim();
  working(profileForm, async () => {
    const data = await api('/api/auth/profile', { method: 'PATCH', body: { displayName } });
    showUser(data.user);
    message(profileStatus, 'Your display name has been updated.');
  }).catch(error => message(profileStatus, error.message, true));
});
document.querySelector('#account-logout').addEventListener('click', event => {
  const button = event.currentTarget;
  button.disabled = true;
  api('/api/auth/logout', { method: 'POST', body: {} }).then(() => {
    showUser(null);
    document.querySelector('#account-request').hidden = false;
    document.querySelector('#account-verify').hidden = true;
    message(status, 'You have signed out.');
  }).catch(error => message(profileStatus, error.message, true)).finally(() => { button.disabled = false; });
});
api('/api/auth/me').then(data => showUser(data.user)).catch(error => message(status, error.message, true));
