// ============================================================
// trading-mode.js — AlphaVault Quant v2.0
// ✅ 100% gratuit — GitHub API + GitHub Pages JSON
// ✅ Zéro appel direct Oracle VM
// ✅ Switch via workflow_dispatch GitHub Actions
// ✅ Statut via ibkr_status.json (GitHub Pages)
// ============================================================

const TradingModeManager = (() => {

  // ── Configuration ─────────────────────────────────────────
  const GH_OWNER    = 'Raph33AI';
  const GH_REPO     = 'alphavault-quant';
  const GH_WORKFLOW = 'switch-mode.yml';
  const POLL_MS     = 30_000;   // Poll statut GitHub Pages 30s
  const PAT_KEY     = 'av_gh_pat'; // localStorage — même clé que terminal.js

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
  let _pollTimer  = null;
  let _switchedAt = null;

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) checkbox.addEventListener('change', _handleToggle);

    _fetchStatus();
    _pollTimer = setInterval(_fetchStatus, POLL_MS);

    console.log('✅ TradingModeManager v2.0 | GitHub-only | Poll: 30s');
  }

  // ── Lire ibkr_status.json depuis GitHub Pages ─────────────
  // Utilise ApiClient (déjà chargé)
  async function _fetchStatus() {
    try {
      const data = await ApiClient.getIBKRStatus(true); // force bust cache

      _mode      = data.trading_mode || 'paper';
      _account   = data.account      || MODES[_mode].account;
      _connected = data.ibkr_connected || false;

      // Détecter fin de switch (si switch en cours)
      if (_switching && _switchedAt) {
        const elapsed = Date.now() - _switchedAt;
        if (elapsed > 20_000) {
          // Le workflow a eu le temps de pousser le nouveau statut
          _switching  = false;
          _switchedAt = null;
          _showToast(
            `✅ Switch terminé — Mode ${MODES[_mode].label} actif`,
            'success'
          );
        }
      }

      _updateAllUI();

    } catch (e) {
      console.warn('[TradingMode] Erreur fetch statut:', e.message);
    }
  }

  // ── Handler toggle ─────────────────────────────────────────
  async function _handleToggle(e) {
    if (_switching) {
      e.target.checked = _mode === 'live';
      _showToast('⏳ Switch en cours — patiente...', 'warn');
      return;
    }

    const targetMode = e.target.checked ? 'live' : 'paper';

    // Même mode → rien à faire
    if (targetMode === _mode) return;

    // Confirmation modale LIVE
    if (targetMode === 'live') {
      const confirmed = await _showLiveConfirmModal();
      if (!confirmed) {
        e.target.checked = false;
        return;
      }
    }

    // Vérifier PAT
    const pat = _getPAT();
    if (!pat || !pat.startsWith('ghp_')) {
      e.target.checked = _mode === 'live'; // rollback
      _showNoPATModal();
      return;
    }

    await _dispatchSwitch(targetMode, pat);
  }

  // ── Dispatch workflow GitHub ───────────────────────────────
  async function _dispatchSwitch(mode, pat) {
    _switching  = true;
    _switchedAt = Date.now();

    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) checkbox.disabled = true;

    _setSwitchingUI(mode);

    try {
      const res = await fetch(
        `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`,
        {
          method:  'POST',
          headers: {
            'Authorization':        `Bearer ${pat}`,
            'Accept':               'application/vnd.github.v3+json',
            'Content-Type':         'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          body: JSON.stringify({
            ref:    'main',
            inputs: { mode },
          }),
        }
      );

      if (res.status === 204) {
        // ✅ Workflow déclenché
        _showToast(
          mode === 'live'
            ? '🔴 Switch LIVE déclenché — GitHub Actions en cours (~2 min)...'
            : '🟡 Switch PAPER déclenché — GitHub Actions en cours (~2 min)...',
          mode === 'live' ? 'warn' : 'info',
          8000
        );

        // Polling accéléré pendant le switch (toutes les 10s)
        _startFastPoll();

      } else if (res.status === 401) {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        _showToast('❌ PAT invalide ou expiré', 'error');

      } else if (res.status === 404) {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        _showToast(`❌ Workflow "${GH_WORKFLOW}" introuvable`, 'error');

      } else {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        const body = await res.text().catch(() => '');
        _showToast(`❌ GitHub API erreur ${res.status}`, 'error');
        console.error('[TradingMode] GitHub API:', res.status, body);
      }

    } catch (e) {
      _switching = false;
      if (checkbox) checkbox.checked = _mode === 'live';
      _showToast(`❌ Erreur réseau: ${e.message}`, 'error');
    } finally {
      if (checkbox) checkbox.disabled = false;
    }
  }

  // ── Poll accéléré pendant le switch (toutes les 10s) ──────
  function _startFastPoll() {
    clearInterval(_pollTimer);
    let ticks = 0;
    const MAX_TICKS = 24; // 24 × 10s = 4 minutes max

    const fastTimer = setInterval(async () => {
      ticks++;
      await _fetchStatus();

      // Arrêter le fast poll si switch terminé OU timeout
      if (!_switching || ticks >= MAX_TICKS) {
        clearInterval(fastTimer);
        _switching  = false;
        _switchedAt = null;

        // Reprendre le poll normal
        _pollTimer = setInterval(_fetchStatus, POLL_MS);

        if (ticks >= MAX_TICKS) {
          _showToast('⚠ Timeout switch — vérifie GitHub Actions', 'warn');
        }
      }
    }, 10_000);
  }

  // ── Mise à jour de TOUTE l'UI ─────────────────────────────
  function _updateAllUI() {
    const cfg = MODES[_mode] || MODES.paper;

    // 1. Checkbox
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox && !_switching) checkbox.checked = _mode === 'live';

    // 2. Label PAPER / LIVE
    const label = document.getElementById('mode-toggle-label');
    if (label && !_switching) {
      label.textContent = cfg.label;
      label.className   = `mode-toggle-label ${_mode}`;
    }

    // 3. Account
    const accEl = document.getElementById('mode-toggle-account');
    if (accEl) accEl.textContent = _account;

    // 4. Oracle dot → statut GitHub (toujours accessible)
    _updateOracleDot(_connected ? 'online' : 'pending');

    // 5. dry-run-badge (compat terminal.js)
    const drBadge = document.getElementById('dry-run-badge');
    if (drBadge) {
      drBadge.textContent = cfg.label;
      drBadge.className   = _mode === 'live' ? 'dry-run-badge live' : 'dry-run-badge';
    }

    // 6. Wrapper data-mode
    const wrap = document.getElementById('mode-toggle-wrap');
    if (wrap) wrap.dataset.mode = _mode;

    // 7. IBKR status pill (Execution)
    const ibkrPill = document.getElementById('ibkr-status-pill');
    if (ibkrPill) {
      ibkrPill.className = `ibkr-status-pill ${_mode} ${_connected ? 'connected' : ''}`;
    }

    // 8. ibkr-mode-text (Execution)
    const ibkrModeTxt = document.getElementById('ibkr-mode-text');
    if (ibkrModeTxt) {
      ibkrModeTxt.innerHTML = _mode === 'live'
        ? '<span style="color:#ef4444;font-weight:800">⚠ LIVE TRADING</span>'
        : 'PAPER MODE';
    }

    // 9. icp-status (Execution log)
    const icpStatus = document.getElementById('icp-status');
    if (icpStatus) {
      icpStatus.innerHTML = _switching
        ? `<span style="color:var(--y)">⏳ Switch en cours...</span>`
        : _connected
          ? `<span style="color:var(--g)">✅ Connected — ${cfg.label}</span>`
          : `<span style="color:var(--y)">⏳ ${cfg.label} — Auth pending</span>`;
    }

    // 10. icp-account
    const icpAccount = document.getElementById('icp-account');
    if (icpAccount) icpAccount.textContent = _account;

    // 11. hg-ibkr (System Health)
    const hgIbkr = document.getElementById('hg-ibkr');
    if (hgIbkr) {
      const icon = _switching
        ? '<i class="fa-solid fa-rotate fa-spin" style="color:var(--y)"></i>'
        : _connected
          ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i>'
          : '<i class="fa-solid fa-hourglass-half" style="color:var(--y)"></i>';
      hgIbkr.innerHTML = `${icon} ${cfg.label} — <span class="mono" style="font-size:10px">${_account}</span>`;
    }

    // 12. dot-ibkr + pill-ibkr (topbar)
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
    dot.title = state === 'online'  ? 'IBKR connecté'
              : state === 'pending' ? 'IBeam auth pending (normal sans IBEAM_KEY)'
              : 'Offline';
  }

  // ── UI état switching ──────────────────────────────────────
  function _setSwitchingUI(targetMode) {
    const label = document.getElementById('mode-toggle-label');
    if (label) {
      label.className   = 'mode-toggle-label switching';
      label.textContent = '...';
    }
    _updateOracleDot('pending');

    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) checkbox.checked = targetMode === 'live';
  }

  // ── PAT (partagé avec terminal.js) ────────────────────────
  function _getPAT() {
    return localStorage.getItem(PAT_KEY) || '';
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
            GitHub Actions va switcher vers le trading réel.<br>
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
              Tous les ordres exécutés en LIVE (argent réel)
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Retour PAPER possible à tout moment
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

      input?.addEventListener('input', () => {
        const valid = input.value.trim().toUpperCase() === 'LIVE';
        okBtn?.classList.toggle('ready', valid);
      });

      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().toUpperCase() === 'LIVE') _cleanup(true);
        if (e.key === 'Escape') _cleanup(false);
      });

      okBtn?.addEventListener('click', () => {
        if (input?.value?.trim().toUpperCase() === 'LIVE') _cleanup(true);
      });

      cancelBtn?.addEventListener('click',  () => _cleanup(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _cleanup(false);
      });

      function _cleanup(confirmed) {
        overlay.style.opacity    = '0';
        overlay.style.transition = 'opacity 0.15s';
        setTimeout(() => { overlay.remove(); resolve(confirmed); }, 150);
      }
    });
  }

  // ── Modal PAT manquant ─────────────────────────────────────
  function _showNoPATModal() {
    const overlay = document.createElement('div');
    overlay.className = 'live-confirm-overlay';
    overlay.innerHTML = `
      <div class="live-confirm-modal">
        <div class="live-confirm-icon" style="background:rgba(245,158,11,0.15);border-color:rgba(245,158,11,0.4)">
          <i class="fa-solid fa-key" style="color:#f59e0b"></i>
        </div>
        <div class="live-confirm-title" style="color:#f59e0b">GitHub PAT requis</div>
        <div class="live-confirm-subtitle">
          Le switch mode utilise GitHub Actions.<br>
          Configure ton PAT dans la section <strong>Execution → Terminal</strong>.
        </div>
        <div class="live-confirm-warning" style="border-color:rgba(245,158,11,0.3)">
          <div class="live-confirm-warning-row">
            <i class="fa-solid fa-circle-info" style="color:#f59e0b"></i>
            Génère un PAT sur <strong>github.com/settings/tokens</strong>
          </div>
          <div class="live-confirm-warning-row">
            <i class="fa-solid fa-circle-info" style="color:#f59e0b"></i>
            Scope requis : <strong>workflow</strong>
          </div>
          <div class="live-confirm-warning-row">
            <i class="fa-solid fa-circle-info" style="color:#f59e0b"></i>
            Saisis-le dans Execution → champ GitHub PAT
          </div>
        </div>
        <div class="live-confirm-btns">
          <button class="live-confirm-cancel"
                  onclick="this.closest('.live-confirm-overlay').remove()">
            Fermer
          </button>
          <a href="https://github.com/settings/tokens"
             target="_blank"
             style="flex:2;display:block;padding:10px;border-radius:10px;
                    background:#f59e0b;color:white;font-weight:700;
                    text-align:center;text-decoration:none;font-size:13px">
            <i class="fa-solid fa-external-link-alt"></i> Générer un PAT
          </a>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
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
    toast.innerHTML = `<i class="fa-solid ${icons[type]||'fa-circle-info'}" style="color:${colors[type]||'var(--b1)'}"></i> ${msg}`;
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
    switchMode:        (mode) => _dispatchSwitch(mode, _getPAT()),
  };

})();

window.TradingModeManager = TradingModeManager;
document.addEventListener('DOMContentLoaded', () => TradingModeManager.init());

console.log('✅ TradingModeManager v2.0 | GitHub-only | 100% gratuit');