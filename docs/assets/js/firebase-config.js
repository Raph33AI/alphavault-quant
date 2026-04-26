// docs/assets/js/firebase-config.js
// Charge la config Firebase depuis Cloudflare Worker (aucun secret côté GitHub)
window.FIREBASE_CONFIG       = null;
window._firebaseConfigReady  = false;
window._firebaseConfigPromise = fetch(
  'https://alphavault-gh-proxy.raphnardone.workers.dev/firebase-config',
  { cache: 'force-cache' }
)
.then(r => {
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.text();
})
.then(js => {
  // Exécuter le JS retourné → définit window.FIREBASE_CONFIG
  // eslint-disable-next-line no-new-func
  new Function(js)();
  window._firebaseConfigReady = true;
  console.log('%c✅ Firebase config loaded from Cloudflare',
    'color:#10b981;font-weight:bold');
})
.catch(err => {
  console.error('❌ Firebase config fetch failed:', err);
  window.FIREBASE_CONFIG = null;
});