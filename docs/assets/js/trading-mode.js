// ============================================================
// trading-mode.js — AlphaVault Quant v1.1
// ✅ Toggle Paper/Live depuis le dashboard
// ✅ Sync automatique avec Oracle VM toutes les 30s
// ✅ Confirmation modale custom pour LIVE
// ✅ Clé API hardcodée (système tourne 24/7 sans navigateur)
// ✅ Mise à jour de tous les éléments UI
// ============================================================

const TradingModeManager = (() => {

  // ── Configuration ─────────────────────────────────────────
    const ORACLE_URL     = 'https://oracle-ibkr-proxy.raphnardone.workers.dev'; // ← HTTPS via Cloudflare
    const SWITCH_API_KEY = 'ALPHAVAULT_SWITCH_2026_SECRET';
    const POLL_MS        = 30_000;
    const SWITCH_TIMEOUT = 15_000;

  const MODES = {
    paper: {
      account:  'DUM895161',
      username: 'vtsdxs036',
      label:    'PAPER',
      color:    '#f59e0b',
      tooltip:  'Paper Trading — Argent virtuel | Oracle: 141.253.96.130',
    },
    live: {
      account:  'U21160314',
      username: 'raphnardone',
      label:    'LIVE',
      color:    '#ef4444',
      tooltip:  '⚠ LIVE Trading — Argent réel | Oracle: 141.253.96.130',
    },
  };

  // ── State ──────────────────────────────────────────────────
  let _mode         = 'paper';
  let _account      = 'DUM895161';
  let _connected    = false;
  let _oracleOnline = false;
  let _switching    = false;
  let _pollTimer    = null;

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', _handleToggle);
    }

    _fetchCurrentMode();
    _pollTimer = setInterval(_fetchCurrentMode, POLL_MS);

    console.log('✅ TradingModeManager | Oracle:', ORACLE_URL, '| Poll:', POLL_MS / 1000 + 's');
  }

  // ── Fetch mode depuis Oracle VM ────────────────────────────
  async function _fetchCurrentMode() {
    try {
      const res = await fetch(`${ORACLE_URL}/current-mode`, {
        signal:  AbortSignal.timeout(6000),
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data    = await res.json();
      _mode         = data.trading_mode || 'paper';
      _account      = data.account      || MODES[_mode].account;
      _connected    = data.connected    || false;
      _oracleOnline = true;

      _updateAllUI();

    } catch (e) {
      _oracleOnline = false;
      _updateOracleDot('offline');

      const wrap = document.getElementById('mode-toggle-wrap');
      if (wrap) wrap.title = `Oracle VM inaccessible — ${e.message}`;

      if (e.name !== 'AbortError') {
        console.warn('[TradingMode] Oracle offline:', e.message);
      }
    }
  }

  // ── Handler du toggle ──────────────────────────────────────
  async function _handleToggle(e) {
    if (_switching) {
      e.target.checked = _mode === 'live';
      return;
    }

    const targetMode = e.target.checked ? 'live' : 'paper';

    if (!_oracleOnline) {
      e.target.checked = _mode === 'live';
      _showToast('❌ Oracle VM inaccessible — impossible de switcher', 'error');
      return;
    }

    if (targetMode === 'live') {
      const confirmed = await _showLiveConfirmModal();
      if (!confirmed) {
        e.target.checked = false;
        return;
      }
    }

    await _doSwitch(targetMode);
  }

  // ── Switch effectif ────────────────────────────────────────
  async function _doSwitch(mode) {
    _switching = true;
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) checkbox.disabled = true;

    _setSwitchingUI();

    try {
      const res = await fetch(`${ORACLE_URL}/switch-mode`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ mode, api_key: SWITCH_API_KEY }),
        signal:  AbortSignal.timeout(SWITCH_TIMEOUT),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        _mode      = mode;
        _account   = data.account || MODES[mode].account;
        _connected = false;

        _updateAllUI();
        _showToast(
          mode === 'live'
            ? '🔴 Live Trading activé — IBeam redémarre (90s)...'
            : '🟡 Paper Trading activé — IBeam redémarre (90s)...',
          mode === 'live' ? 'warn' : 'success'
        );

        setTimeout(_fetchCurrentMode, 95_000);

      } else if (res.status === 401) {
        _showToast('❌ Clé API invalide — vérifier SWITCH_API_KEY', 'error');
        if (checkbox) checkbox.checked = _mode === 'live';

      } else {
        _showToast(`❌ Switch échoué: ${data.error || `HTTP ${res.status}`}`, 'error');
        if (checkbox) checkbox.checked = _mode === 'live';
      }

    } catch (e) {
      if (e.name === 'TimeoutError') {
        _showToast('⏳ Timeout — switch peut être en cours, vérifier dans 2 min', 'warn');
      } else {
        _showToast(`❌ Oracle inaccessible: ${e.message}`, 'error');
        if (checkbox) checkbox.checked = _mode === 'live';
      }
    } finally {
      _switching = false;
      if (checkbox) checkbox.disabled = false;
      _updateAllUI();
    }
  }

  // ── Mise à jour de TOUTE l'UI ─────────────────────────────
  function _updateAllUI() {
    const cfg = MODES[_mode];

    // 1. Wrapper
    const wrap = document.getElementById('mode-toggle-wrap');
    if (wrap) {
      wrap.dataset.mode    = _mode;
      wrap.dataset.tooltip = cfg.tooltip;
    }

    // 2. Checkbox
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox && !_switching) checkbox.checked = _mode === 'live';

    // 3. Label PAPER / LIVE
    const label = document.getElementById('mode-toggle-label');
    if (label) {
      label.textContent = cfg.label;
      label.className   = `mode-toggle-label ${_mode}`;
    }

    // 4. Account
    const accEl = document.getElementById('mode-toggle-account');
    if (accEl) accEl.textContent = _account;

    // 5. Oracle dot
    const dotState = !_oracleOnline ? 'offline'
                   : _connected     ? 'online'
                   :                  'pending';
    _updateOracleDot(dotState);

    // 6. dry-run-badge (compat terminal.js)
    const drBadge = document.getElementById('dry-run-badge');
    if (drBadge) {
      drBadge.textContent = cfg.label;
      drBadge.className   = _mode === 'live' ? 'dry-run-badge live' : 'dry-run-badge';
    }

    // 7. IBKR status pill (Execution header)
    const ibkrPill = document.getElementById('ibkr-status-pill');
    if (ibkrPill) {
      ibkrPill.className = `ibkr-status-pill ${_mode} ${_connected ? 'connected' : ''}`;
    }

    // 8. Mode text Execution
    const ibkrModeTxt = document.getElementById('ibkr-mode-text');
    if (ibkrModeTxt) {
      ibkrModeTxt.innerHTML = _mode === 'live'
        ? '<span style="color:#ef4444;font-weight:800">⚠ LIVE TRADING</span>'
        : 'PAPER MODE';
    }

    // 9. icp-status
    const icpStatus = document.getElementById('icp-status');
    if (icpStatus) {
      icpStatus.innerHTML = _oracleOnline
        ? (_connected
          ? `<span style="color:var(--g)">✅ Connected — ${_mode.toUpperCase()}</span>`
          : `<span style="color:var(--y)">⏳ ${cfg.label} — Auth pending</span>`)
        : `<span style="color:var(--r)">❌ Oracle offline</span>`;
    }

    // 10. icp-account
    const icpAccount = document.getElementById('icp-account');
    if (icpAccount) icpAccount.textContent = _account;

    // 11. hg-ibkr (System Health)
    const hgIbkr = document.getElementById('hg-ibkr');
    if (hgIbkr) {
      const icon = _oracleOnline
        ? (_connected
          ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i>'
          : '<i class="fa-solid fa-hourglass-half" style="color:var(--y)"></i>')
        : '<i class="fa-solid fa-plug-circle-xmark" style="color:var(--r)"></i>';
      hgIbkr.innerHTML = `${icon} ${cfg.label} — <span class="mono" style="font-size:10px">${_account}</span>`;
    }

    // 12. dot-ibkr + pill-ibkr (topbar)
    const dotIbkr  = document.getElementById('dot-ibkr');
    const pillIbkr = document.getElementById('pill-ibkr');
    if (_oracleOnline && _connected) {
      if (dotIbkr)  dotIbkr.className  = 's-dot ok';
      if (pillIbkr) pillIbkr.className = 'status-pill ok';
      if (pillIbkr) pillIbkr.title = `IBKR ${cfg.label} — Connected (${_account})`;
    } else if (_oracleOnline) {
      if (dotIbkr)  dotIbkr.className  = 's-dot warn';
      if (pillIbkr) pillIbkr.className = 'status-pill warn';
      if (pillIbkr) pillIbkr.title = `IBKR ${cfg.label} — IBeam auth pending`;
    } else {
      if (dotIbkr)  dotIbkr.className  = 's-dot error';
      if (pillIbkr) pillIbkr.className = 'status-pill error';
      if (pillIbkr) pillIbkr.title = 'Oracle VM inaccessible';
    }
  }

  // ── Oracle Dot ─────────────────────────────────────────────
  function _updateOracleDot(state) {
    const dot = document.getElementById('mode-oracle-dot');
    if (!dot) return;
    dot.className = `mode-oracle-dot ${state}`;
    dot.title     = state === 'online'  ? 'Oracle VM online | IBKR connecté'
                  : state === 'pending' ? 'Oracle VM online | IBeam auth pending'
                  :                       'Oracle VM offline';
  }

  // ── UI état switching ──────────────────────────────────────
  function _setSwitchingUI() {
    const label = document.getElementById('mode-toggle-label');
    if (label) {
      label.className   = 'mode-toggle-label switching';
      label.textContent = '...';
    }
    _updateOracleDot('pending');
  }

  // ════════════════════════════════════════════════════════════
  // MODAL CONFIRMATION LIVE
  // ════════════════════════════════════════════════════════════
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
            Cette action bascule vers le trading réel.<br>
            Les ordres seront exécutés avec de l'argent réel.
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
              Tous les ordres en attente exécutés en LIVE
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Retour au PAPER possible à tout moment
            </div>
          </div>
          <div class="live-confirm-input-label">
            Tape <strong>LIVE</strong> pour confirmer :
          </div>
          <input type="text"
                 class="live-confirm-input"
                 id="live-confirm-input"
                 placeholder="LIVE"
                 autocomplete="off"
                 maxlength="10">
          <div class="live-confirm-btns">
            <button class="live-confirm-cancel" id="live-confirm-cancel">
              Annuler
            </button>
            <button class="live-confirm-ok" id="live-confirm-ok">
              <i class="fa-solid fa-bolt"></i> Activer LIVE Trading
            </button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const input     = overlay.querySelector('#live-confirm-input');
      const okBtn     = overlay.querySelector('#live-confirm-ok');
      const cancelBtn = overlay.querySelector('#live-confirm-cancel');

      setTimeout(() => input?.focus(), 100);

      function _checkInput() {
        const valid = input?.value?.trim().toUpperCase() === 'LIVE';
        if (okBtn) okBtn.classList.toggle('ready', valid);
      }

      input?.addEventListener('input', _checkInput);

      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().toUpperCase() === 'LIVE') {
          _cleanup(true);
        }
        if (e.key === 'Escape') _cleanup(false);
      });

      okBtn?.addEventListener('click', () => {
        if (input?.value?.trim().toUpperCase() === 'LIVE') _cleanup(true);
      });

      cancelBtn?.addEventListener('click', () => _cleanup(false));

      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _cleanup(false);
      });

      function _cleanup(confirmed) {
        overlay.style.opacity = '0';
        overlay.style.transition = 'opacity 0.15s';
        setTimeout(() => {
          overlay.remove();
          resolve(confirmed);
        }, 150);
      }
    });
  }

  // ── Toast ──────────────────────────────────────────────────
  function _showToast(msg, type = 'info', duration = 5000) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;

    const icons = {
      success: 'fa-circle-check',
      error:   'fa-circle-exclamation',
      warn:    'fa-triangle-exclamation',
      info:    'fa-circle-info',
    };
    const colors = {
      success: 'var(--g)',
      error:   'var(--r)',
      warn:    'var(--y)',
      info:    'var(--b1)',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i class="fa-solid ${icons[type] || 'fa-circle-info'}"
         style="color:${colors[type] || 'var(--b1)'}"></i>
      ${msg}`;
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
    isOracleOnline:    () => _oracleOnline,
    refresh:           _fetchCurrentMode,
    switchMode:        _doSwitch,
  };

})();

window.TradingModeManager = TradingModeManager;
document.addEventListener('DOMContentLoaded', () => TradingModeManager.init());

console.log('✅ TradingModeManager v1.1 | Oracle: http://141.253.96.130:5000');