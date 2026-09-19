import { api, setAccountIndicator } from './ui.js';

// Image and account pages already check the session and update this indicator.
// Other pages need only the account status, never a locally remembered login.
if (!document.querySelector('#community, #account-guest')) {
  api('/api/auth/me').then(data => setAccountIndicator(data.user)).catch(() => setAccountIndicator(null));
}
