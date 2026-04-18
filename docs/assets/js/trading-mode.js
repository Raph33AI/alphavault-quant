// ============================================================
// trading-mode.js — AlphaVault Quant v2.1
// ✅ 100% gratuit — Cloudflare Worker + GitHub Pages JSON
// ✅ PAT stocké en secret Cloudflare (jamais dans le code)
// ✅ Zéro saisie manuelle — fonctionne 24/7
// ✅ Switch via alphavault-gh-proxy Worker
// ✅ Statut via ibkr_status.json (GitHub Pages)
// ============================================================

const TradingModeManager = (() => {

  // ── Configuration ─────────────────────────────────────────
  const WORKER_URL  = 'https://alphavault-gh-proxy.raphnardone.workers.dev';
  const POLL_MS     = 30_000;

  const MODES = {
    paper: {
      account:  'DUM895161',
      username: 'vtsdxs036',
      label:    'PAPER',
      color:    '#f59e0b',
    },
    live: {
      account:  'U21160314',
      username: 'raphnardone',
      label:    'LIVE',
      color:    '#ef4444',
    },
  };

  // ── State ──────────────────────────────────────────────────
  let _mode       = 'paper';
  let _account    = 'DUM895161';
  let _connected  = false;
  let _switching  = false;
  let _switchedAt = null;
  let _pollTimer  = null;

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) checkbox.addEventListener('change', _handleToggle);

    _fetchStatus();
    _pollTimer = setInterval(_fetchStatus, POLL_MS);

    console.log('✅ TradingModeManager v2.1 | Worker:', WORKER_URL);
  }

  // ── Lire ibkr_status.json depuis GitHub Pages ─────────────
  async function _fetchStatus() {
    try {
      const data = await ApiClient.getIBKRStatus(true);

      const prevMode = _mode;
      _mode      = data.trading_mode    || 'paper';
      _account   = data.account         || MODES[_mode].account;
      _connected = data.ibkr_connected  || false;

      // Détecter fin de switch
      if (_switching && _switchedAt && prevMode !== _mode) {
        _switching  = false;
        _switchedAt = null;
        clearInterval(_fastPollTimer);
        _pollTimer = setInterval(_fetchStatus, POLL_MS);
        _showToast(
          `✅ Switch terminé — Mode ${MODES[_mode].label} actif (${_account})`,
          'success', 6000
        );
      } else if (_switching && _switchedAt) {
        const elapsed = Date.now() - _switchedAt;
        if (elapsed > 240_000) { // 4 min timeout
          _switching  = false;
          _switchedAt = null;
          clearInterval(_fastPollTimer);
          _pollTimer = setInterval(_fetchStatus, POLL_MS);
          _showToast('⚠ Timeout switch — vérifie GitHub Actions', 'warn');
        }
      }

      _updateAllUI();

    } catch (e) {
      console.warn('[TradingMode] Fetch statut:', e.message);
    }
  }

  let _fastPollTimer = null;

  // ── Poll accéléré pendant le switch ───────────────────────
  function _startFastPoll() {
    clearInterval(_pollTimer);
    clearInterval(_fastPollTimer);
    _fastPollTimer = setInterval(_fetchStatus, 10_000);
  }

  // ── Handler toggle ─────────────────────────────────────────
  async function _handleToggle(e) {
    if (_switching) {
      e.target.checked = _mode === 'live';
      _showToast('⏳ Switch en cours — patiente...', 'warn');
      return;
    }

    const targetMode = e.target.checked ? 'live' : 'paper';
    if (targetMode === _mode) return;

    if (targetMode === 'live') {
      const confirmed = await _showLiveConfirmModal();
      if (!confirmed) {
        e.target.checked = false;
        return;
      }
    }

    await _doSwitch(targetMode);
  }

  // ── Switch via Cloudflare Worker ───────────────────────────
  async function _doSwitch(mode) {
    _switching  = true;
    _switchedAt = Date.now();

    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) checkbox.disabled = true;
    _setSwitchingUI(mode);

    try {
      const res = await fetch(`${WORKER_URL}/switch-mode`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode }),
        signal:  AbortSignal.timeout(15_000),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        _showToast(
          mode === 'live'
            ? '🔴 Switch LIVE lancé — GitHub Actions (~2 min)...'
            : '🟡 Switch PAPER lancé — GitHub Actions (~2 min)...',
          mode === 'live' ? 'warn' : 'info',
          8000
        );
        _startFastPoll();

      } else if (res.status === 401) {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        _showToast(
          '❌ PAT expiré — Mets à jour le secret dans Cloudflare Workers',
          'error', 8000
        );

      } else {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        _showToast(`❌ Erreur: ${data.error || res.status}`, 'error');
      }

    } catch (e) {
      _switching = false;
      if (checkbox) checkbox.checked = _mode === 'live';
      if (e.name === 'TimeoutError') {
        _showToast('⏳ Worker lent — switch peut être en cours', 'warn');
      } else {
        _showToast(`❌ Worker inaccessible: ${e.message}`, 'error');
      }
    } finally {
      if (checkbox) checkbox.disabled = false;
      _updateAllUI();
    }
  }

  // ── Mise à jour UI complète ────────────────────────────────
  function _updateAllUI() {
    const cfg = MODES[_mode] || MODES.paper;

    // Checkbox
    const cb = document.getElementById('mode-toggle-checkbox');
    if (cb && !_switching) cb.checked = _mode === 'live';

    // Label
    const label = document.getElementById('mode-toggle-label');
    if (label && !_switching) {
      label.textContent = cfg.label;
      label.className   = `mode-toggle-label ${_mode}`;
    }

    // Account
    const acc = document.getElementById('mode-toggle-account');
    if (acc) acc.textContent = _account;

    // Oracle dot
    _updateOracleDot(_connected ? 'online' : 'pending');

    // dry-run-badge (compat terminal.js)
    const badge = document.getElementById('dry-run-badge');
    if (badge) {
      badge.textContent = cfg.label;
      badge.className   = _mode === 'live' ? 'dry-run-badge live' : 'dry-run-badge';
    }

    // Wrapper
    const wrap = document.getElementById('mode-toggle-wrap');
    if (wrap) wrap.dataset.mode = _mode;

    // IBKR status pill
    const pill = document.getElementById('ibkr-status-pill');
    if (pill) pill.className = `ibkr-status-pill ${_mode} ${_connected ? 'connected' : ''}`;

    // ibkr-mode-text
    const modeText = document.getElementById('ibkr-mode-text');
    if (modeText) {
      modeText.innerHTML = _mode === 'live'
        ? '<span style="color:#ef4444;font-weight:800">⚠ LIVE TRADING</span>'
        : 'PAPER MODE';
    }

    // icp-status
    const icpStatus = document.getElementById('icp-status');
    if (icpStatus) {
      icpStatus.innerHTML = _switching
        ? `<span style="color:var(--y)">⏳ Switch en cours (GitHub Actions)...</span>`
        : _connected
          ? `<span style="color:var(--g)">✅ Connected — ${cfg.label}</span>`
          : `<span style="color:var(--y)">⏳ ${cfg.label} — Auth pending</span>`;
    }

    // icp-account
    const icpAcc = document.getElementById('icp-account');
    if (icpAcc) icpAcc.textContent = _account;

    // hg-ibkr (System Health)
    const hgIbkr = document.getElementById('hg-ibkr');
    if (hgIbkr) {
      const icon = _switching
        ? '<i class="fa-solid fa-rotate fa-spin" style="color:var(--y)"></i>'
        : _connected
          ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i>'
          : '<i class="fa-solid fa-hourglass-half" style="color:var(--y)"></i>';
      hgIbkr.innerHTML = `${icon} ${cfg.label} — <span class="mono" style="font-size:10px">${_account}</span>`;
    }

    // dot-ibkr + pill-ibkr (topbar)
    const dotIbkr  = document.getElementById('dot-ibkr');
    const pillIbkr = document.getElementById('pill-ibkr');
    const state    = _connected ? 'ok' : 'warn';
    if (dotIbkr)  dotIbkr.className  = `s-dot ${state}`;
    if (pillIbkr) {
      pillIbkr.className = `status-pill ${state}`;
      pillIbkr.title     = `IBKR ${cfg.label} — ${_account}`;
    }
  }

  // ── Oracle Dot ─────────────────────────────────────────────
  function _updateOracleDot(state) {
    const dot = document.getElementById('mode-oracle-dot');
    if (!dot) return;
    dot.className = `mode-oracle-dot ${state}`;
    dot.title     = state === 'online'  ? 'IBKR connecté'
                  : state === 'pending' ? 'IBeam auth pending'
                  :                       'Offline';
  }

  // ── UI état switching ──────────────────────────────────────
  function _setSwitchingUI(targetMode) {
    const label = document.getElementById('mode-toggle-label');
    if (label) {
      label.className   = 'mode-toggle-label switching';
      label.textContent = '...';
    }
    const cb = document.getElementById('mode-toggle-checkbox');
    if (cb) cb.checked = targetMode === 'live';
    _updateOracleDot('pending');
  }

  // ── Modal LIVE confirm ─────────────────────────────────────
  function _showLiveConfirmModal() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'live-confirm-overlay';
      overlay.innerHTML = `
        <div class="live-confirm-modal">
          <div class="live-confirm-icon">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div class="live-confirm-title">Live Trading — Confirmation</div>
          <div class="live-confirm-subtitle">
            GitHub Actions va basculer vers le trading réel.<br>
            <strong>~2 minutes</strong> pour que le switch soit effectif.
          </div>
          <div class="live-confirm-warning">
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Compte LIVE : <strong>U21160314 (raphnardone)</strong>
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              IBeam redémarre (~90s d'interruption)
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Ordres exécutés avec argent réel
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Retour PAPER possible à tout moment
            </div>
          </div>
          <div class="live-confirm-input-label">
            Tape <strong>LIVE</strong> pour confirmer :
          </div>
          <input type="text" class="live-confirm-input"
                 id="live-confirm-input" placeholder="LIVE"
                 autocomplete="off" maxlength="10">
          <div class="live-confirm-btns">
            <button class="live-confirm-cancel" id="lc-cancel">Annuler</button>
            <button class="live-confirm-ok"     id="lc-ok">
              <i class="fa-solid fa-bolt"></i> Activer LIVE
            </button>
          </div>
        </div>`;

      document.body.appendChild(overlay);
      const input = overlay.querySelector('#live-confirm-input');
      const okBtn = overlay.querySelector('#lc-ok');

      setTimeout(() => input?.focus(), 100);

      input?.addEventListener('input', () => {
        okBtn?.classList.toggle('ready', input.value.trim().toUpperCase() === 'LIVE');
      });

      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().toUpperCase() === 'LIVE') _done(true);
        if (e.key === 'Escape') _done(false);
      });

      okBtn?.addEventListener('click', () => {
        if (input?.value?.trim().toUpperCase() === 'LIVE') _done(true);
      });

      overlay.querySelector('#lc-cancel')?.addEventListener('click', () => _done(false));
      overlay.addEventListener('click', (e) => { if (e.target === overlay) _done(false); });

      function _done(confirmed) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s';
        setTimeout(() => { overlay.remove(); resolve(confirmed); }, 150);
      }
    });
  }

  // ── Toast ──────────────────────────────────────────────────
  function _showToast(msg, type = 'info', duration = 5000) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const icons  = { success:'fa-circle-check', error:'fa-circle-exclamation', warn:'fa-triangle-exclamation', info:'fa-circle-info' };
    const colors = { success:'var(--g)', error:'var(--r)', warn:'var(--y)', info:'var(--b1)' };
    const toast  = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]}" style="color:${colors[type]}"></i> ${msg}`;
    wrap.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = 'opacity 0.3s';
      toast.style.opacity    = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ── Public API ─────────────────────────────────────────────
  return {
    init,
    getCurrentMode:    () => _mode,
    getCurrentAccount: () => _account,
    isConnected:       () => _connected,
    isSwitching:       () => _switching,
    refresh:           _fetchStatus,
  };

})();

window.TradingModeManager = TradingModeManager;
document.addEventListener('DOMContentLoaded', () => TradingModeManager.init());

console.log('✅ TradingModeManager v2.1 | Worker + GitHub Pages | 100% gratuit');