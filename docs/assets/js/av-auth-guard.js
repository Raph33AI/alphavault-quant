// ============================================================
// av-auth-guard.js — AlphaVault Quant v5.0.9
// Protection de toutes les pages + Sidebar user dropdown
// ============================================================
(function () {
  'use strict';

  const QUANT_USERS_COL = 'quant_users';
  const AUTH_URL        = 'auth.html';
  const ADMIN_EMAIL     = 'raphnardone@gmail.com';

  // ── 1. Overlay de chargement immédiat (évite le flash) ────
  const _overlay = document.createElement('div');
  _overlay.id = 'av-guard-overlay';
  _overlay.style.cssText = [
    'position:fixed;inset:0;z-index:99999',
    'background:#0f172a',
    'display:flex;align-items:center;justify-content:center',
    'flex-direction:column;gap:16px',
    'transition:opacity 0.25s ease',
  ].join(';');
  _overlay.innerHTML = `
    <div style="
      width:44px;height:44px;
      background:linear-gradient(135deg,#3b82f6,#8b5cf6);
      border-radius:11px;
      display:flex;align-items:center;justify-content:center;
      font-size:22px;
      box-shadow:0 8px 24px rgba(59,130,246,0.4);
      animation:_avSpin 2s ease-in-out infinite alternate;
    ">⚡</div>
    <div style="font-size:12px;color:#94a3b8;font-family:Inter,sans-serif;
                letter-spacing:0.5px">
      Verifying access…
    </div>
    <style>
      @keyframes _avSpin {
        from { transform: scale(1);   box-shadow: 0 8px 24px rgba(59,130,246,0.4); }
        to   { transform: scale(1.08);box-shadow: 0 12px 36px rgba(139,92,246,0.5); }
      }
    </style>
  `;

  // Injecter dès que le body est disponible
  function _injectOverlay() {
    if (document.body) {
      document.body.appendChild(_overlay);
    } else {
      document.addEventListener('DOMContentLoaded', () =>
        document.body.appendChild(_overlay)
      );
    }
  }
  _injectOverlay();

  // ── 2. Enlever l'overlay (fade-out) ───────────────────────
  function _removeOverlay() {
    _overlay.style.opacity = '0';
    setTimeout(() => _overlay.remove(), 260);
  }

  // ── 3. Redirection vers auth.html ─────────────────────────
  function _redirect() {
    window.location.href = AUTH_URL;
  }

  // ── 4. Init Firebase ──────────────────────────────────────
  async function _initFirebase() {
    // Attendre Cloudflare si config pas encore prête
    if (!window._firebaseConfigReady && window._firebaseConfigPromise) {
        await window._firebaseConfigPromise;
    }
    const cfg = window.FIREBASE_CONFIG;
    if (!cfg || !cfg.apiKey) {
      console.error('av-auth-guard: FIREBASE_CONFIG manquant');
      _redirect();
      return null;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(cfg);
      return { auth: firebase.auth(), db: firebase.firestore() };
    } catch (e) {
      console.error('Firebase init:', e);
      _redirect();
      return null;
    }
  }

  // ── 5. Guard principal ────────────────────────────────────
  // APRÈS — _startGuard async + await _initFirebase()
    async function _startGuard() {
        const fb = await _initFirebase();   // ← await ajouté
        if (!fb) return;
        const { auth, db } = fb;

        const safetyTimer = setTimeout(() => {
            console.warn('⚠ Auth guard timeout → redirect');
            _redirect();
        }, 8000);

        auth.onAuthStateChanged(async (user) => {
            clearTimeout(safetyTimer);

            if (!user) {
                _redirect();
                return;
            }

            try {
                const snap = await db.collection(QUANT_USERS_COL).doc(user.uid).get();

                if (!snap.exists) {
                    await auth.signOut();
                    _redirect();
                    return;
                }

                const data   = snap.data();
                const status = data.status;

                if (status === 'approved') {
                    _removeOverlay();
                    _injectUserDropdown(user, data, auth);
                    db.collection(QUANT_USERS_COL).doc(user.uid)
                        .update({ lastLoginAt: firebase.firestore.FieldValue.serverTimestamp() })
                        .catch(() => {});
                } else {
                    await auth.signOut();
                    _redirect();
                }

            } catch (e) {
                console.error('Auth guard checkAccess:', e);
                _redirect();
            }
        });
    }

  // ── 6. Injection du dropdown utilisateur dans la sidebar ──
  function _injectUserDropdown(user, data, auth) {
    const container = document.getElementById('av-sidebar-user');
    if (!container) return;

    const name     = data.displayName || user.displayName || user.email || 'User';
    const email    = user.email || '';
    const photo    = user.photoURL || '';
    const isAdmin  = email === ADMIN_EMAIL;
    const initials = _initials(name);
    const firstName = name.split(' ')[0] || name;

    container.innerHTML = `
      <div style="position:relative" id="_av_user_wrap">

        <!-- ── DROPDOWN (caché par défaut) ──────────────────── -->
        <div id="_av_dd"
             style="display:none;position:absolute;bottom:calc(100% + 6px);
                    left:0;right:0;
                    background:var(--bg-card,#1e293b);
                    border:1px solid var(--border,rgba(148,163,184,0.12));
                    border-radius:12px;
                    box-shadow:0 -12px 32px rgba(0,0,0,0.25);
                    overflow:hidden;z-index:500">

          <!-- En-tête user -->
          <div style="padding:12px 14px;
                      background:var(--bg-secondary,#0f172a);
                      border-bottom:1px solid var(--border,rgba(148,163,184,0.1))">
            <div style="font-size:12px;font-weight:700;
                        color:var(--text-primary,#f1f5f9);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${_esc(name)}
            </div>
            <div style="font-size:10px;margin-top:2px;
                        color:var(--text-faint,#475569);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${_esc(email)}
            </div>
            ${isAdmin ? `
              <div style="margin-top:6px">
                <span style="display:inline-flex;align-items:center;gap:4px;
                             font-size:9px;font-weight:700;color:#eab308;
                             background:rgba(234,179,8,0.12);
                             border:1px solid rgba(234,179,8,0.25);
                             padding:2px 8px;border-radius:10px">
                  Admin
                </span>
              </div>` : ''}
          </div>

          <!-- Items menu -->
          <div style="padding:4px 0">

            <button class="_av_dd_item"
                    onclick="window.location.href='settings.html'"
                    style="${_ddItem()}">
              <i class="fa-solid fa-gear" style="${_ddIcon()}"></i>
              Settings
            </button>

            ${isAdmin ? `
            <button class="_av_dd_item"
                    onclick="window.location.href='admin.html'"
                    style="${_ddItem('var(--accent-blue,#3b82f6)')}">
              <i class="fa-solid fa-shield-halved"
                 style="${_ddIcon('var(--accent-blue,#3b82f6)')}"></i>
              Admin Panel
            </button>` : ''}

            <div style="height:1px;background:var(--border,rgba(148,163,184,0.1));
                        margin:4px 0"></div>

            <button id="_av_logout"
                    style="${_ddItem('#ef4444')}">
              <i class="fa-solid fa-right-from-bracket"
                 style="${_ddIcon('#ef4444')}"></i>
              Sign Out
            </button>

          </div>
        </div>

        <!-- ── BOUTON TRIGGER ──────────────────────────────── -->
        <button id="_av_user_btn"
                style="width:100%;display:flex;align-items:center;gap:9px;
                       padding:8px 10px;border-radius:9px;
                       border:1px solid var(--border,rgba(148,163,184,0.12));
                       background:var(--bg-secondary,#0f172a);
                       cursor:pointer;text-align:left;
                       transition:background 0.15s ease">

          <!-- Avatar -->
          <div style="width:30px;height:30px;border-radius:50%;flex-shrink:0;
                      background:linear-gradient(135deg,#3b82f6,#8b5cf6);
                      display:flex;align-items:center;justify-content:center;
                      font-size:11px;font-weight:800;color:#fff;overflow:hidden">
            ${photo
              ? `<img src="${_esc(photo)}" alt=""
                      style="width:100%;height:100%;object-fit:cover"
                      onerror="this.parentNode.innerHTML='${initials}'">`
              : initials}
          </div>

          <!-- Nom + rôle -->
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:600;
                        color:var(--text-primary,#f1f5f9);
                        white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
              ${_esc(firstName)}
            </div>
            <div style="font-size:9px;color:var(--text-faint,#475569)">
              ${isAdmin ? 'Admin' : 'Approved'}
            </div>
          </div>

          <!-- Chevron -->
          <i id="_av_chevron" class="fa-solid fa-chevron-up"
             style="font-size:9px;color:var(--text-faint,#475569);
                    flex-shrink:0;transition:transform 0.2s ease"></i>
        </button>

      </div>
    `;

    // ── Interactions ───────────────────────────────────────
    let _open = false;
    const btn     = document.getElementById('_av_user_btn');
    const dd      = document.getElementById('_av_dd');
    const chevron = document.getElementById('_av_chevron');

    // Hover effect bouton
    btn?.addEventListener('mouseenter', () => {
      btn.style.background = 'rgba(148,163,184,0.08)';
    });
    btn?.addEventListener('mouseleave', () => {
      btn.style.background = 'var(--bg-secondary,#0f172a)';
    });

    // Hover effect items
    document.querySelectorAll('._av_dd_item').forEach(item => {
      item.addEventListener('mouseenter', () => {
        item.style.background = 'rgba(148,163,184,0.07)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = 'none';
      });
    });

    // Toggle dropdown
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      _open = !_open;
      dd.style.display       = _open ? 'block' : 'none';
      chevron.style.transform = _open ? 'rotate(180deg)' : '';
    });

    // Fermer au clic extérieur
    document.addEventListener('click', () => {
      if (_open) {
        _open = false;
        dd.style.display       = 'none';
        chevron.style.transform = '';
      }
    });

    // Logout
    document.getElementById('_av_logout')?.addEventListener('click', async () => {
      try {
        await auth.signOut();
        window.location.href = AUTH_URL;
      } catch (e) {
        console.error('Logout error:', e);
        window.location.href = AUTH_URL;
      }
    });
  }

  // ── 7. Helpers CSS ─────────────────────────────────────────
  function _ddItem(color) {
    color = color || 'var(--text-primary,#f1f5f9)';
    return [
      'width:100%;display:flex;align-items:center;gap:10px',
      'padding:9px 14px;border:none;background:none;cursor:pointer',
      `font-size:12px;font-weight:500;color:${color}`,
      'font-family:Inter,-apple-system,sans-serif;text-align:left',
    ].join(';');
  }
  function _ddIcon(color) {
    color = color || 'var(--text-faint,#475569)';
    return `width:14px;text-align:center;color:${color};font-size:12px`;
  }

  // ── 8. Helpers généraux ────────────────────────────────────
  function _initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return (parts[0] || '?')[0].toUpperCase();
  }
  function _esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ── 9. Boot ───────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _startGuard);
  } else {
    _startGuard();
  }

})();