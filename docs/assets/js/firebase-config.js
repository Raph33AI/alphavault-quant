// docs/assets/js/firebase-config.js  v2.0
// Double cache : ServiceWorker Cache API + mémoire
// → 0 requête Worker si déjà chargé dans la session

window.FIREBASE_CONFIG        = null;
window._firebaseConfigReady   = false;
window._firebaseConfigPromise = null;

(function () {
  'use strict';

  const WORKER_URL    = 'https://alphavault-gh-proxy.raphnardone.workers.dev/firebase-config';
  const SESSION_KEY   = '__av_fbc__';
  const MAX_AGE_MS    = 60 * 60 * 1000; // 1h

  // ── 1. Vérifier sessionStorage d'abord (0 réseau) ─────────
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) {
      const { ts, cfg } = JSON.parse(raw);
      if (Date.now() - ts < MAX_AGE_MS && cfg && cfg.apiKey) {
        window.FIREBASE_CONFIG      = cfg;
        window._firebaseConfigReady = true;
        window._firebaseConfigPromise = Promise.resolve();
        console.log('%c✅ Firebase config loaded from sessionStorage (0 network)',
          'color:#10b981;font-weight:bold');
        return; // Sortie immédiate — aucun fetch
      }
    }
  } catch (_) {}

  // ── 2. Fetch Worker (avec cache HTTP navigateur) ───────────
  window._firebaseConfigPromise = fetch(WORKER_URL, {
    // Le Worker renvoie Cache-Control: public, max-age=3600
    // Le navigateur cachera lui-même la réponse
    cache: 'default',
  })
  .then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  })
  .then(js => {
    // eslint-disable-next-line no-new-func
    new Function(js)();

    // ── 3. Sauvegarder dans sessionStorage ────────────────
    if (window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey) {
      try {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
          ts:  Date.now(),
          cfg: window.FIREBASE_CONFIG,
        }));
      } catch (_) {}
    }

    window._firebaseConfigReady = true;
    console.log('%c✅ Firebase config loaded from Cloudflare Worker',
      'color:#10b981;font-weight:bold');
  })
  .catch(err => {
    console.error('❌ Firebase config fetch failed:', err);
    window.FIREBASE_CONFIG = null;
  });

})();