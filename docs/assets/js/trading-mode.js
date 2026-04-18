// ============================================================
// trading-mode.js — AlphaVault Quant v2.2
// 100% free — Cloudflare Worker + GitHub Pages JSON
// PAT stored as Cloudflare secret (never in code)
// No manual input — runs 24/7
// Switch via alphavault-gh-proxy Worker
// Status via ibkr_status.json (GitHub Pages)
// ============================================================

const TradingModeManager = (() => {

  // ── Configuration ─────────────────────────────────────────
  const WORKER_URL = 'https://alphavault-gh-proxy.raphnardone.workers.dev';
  const POLL_MS    = 30_000;

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
  let _mode        = 'paper';
  let _account     = 'DUM895161';
  let _connected   = false;
  let _switching   = false;
  let _switchedAt  = null;
  let _pollTimer   = null;
  let _fastPollTimer = null;

  // ── Tooltip state ──────────────────────────────────────────
  let _tooltipEl   = null;
  let _tooltipTimeout = null;

  // ── Init ───────────────────────────────────────────────────
  function init() {
    const checkbox = document.getElementById('mode-toggle-checkbox');
    if (checkbox) {
      checkbox.addEventListener('change', _handleToggle);
    }

    _initHoverTooltip();

    _fetchStatus();
    _pollTimer = setInterval(_fetchStatus, POLL_MS);

    console.log('[TradingMode] v2.2 initialized | Worker:', WORKER_URL);
  }

  // ── Hover tooltip — fixed positioning ─────────────────────
  function _initHoverTooltip() {
    const wrap = document.getElementById('mode-toggle-wrap');
    if (!wrap) return;

    wrap.addEventListener('mouseenter', _showHoverTooltip);
    wrap.addEventListener('mouseleave', _hideHoverTooltip);
    wrap.addEventListener('mousemove',  _positionTooltip);
  }

  function _buildTooltipContent() {
    const cfg = MODES[_mode] || MODES.paper;

    if (_switching) {
      return [
        '<div class="tm-tooltip-title">Switch in progress</div>',
        '<div class="tm-tooltip-row">GitHub Actions is running (~2 min)</div>',
        '<div class="tm-tooltip-row">Polling every 10s for update</div>',
      ].join('');
    }

    const statusText = _connected ? 'Connected' : 'Auth pending (IBeam)';
    const statusColor = _connected ? '#4ade80' : '#f59e0b';

    return [
      `<div class="tm-tooltip-title">${cfg.label} MODE</div>`,
      `<div class="tm-tooltip-row">Account &nbsp;<strong>${_account}</strong></div>`,
      `<div class="tm-tooltip-row">Username &nbsp;<strong>${cfg.username}</strong></div>`,
      `<div class="tm-tooltip-row">IBKR &nbsp;<span style="color:${statusColor}">${statusText}</span></div>`,
      _mode === 'live'
        ? '<div class="tm-tooltip-warn">Real money — trade with caution</div>'
        : '<div class="tm-tooltip-info">Virtual money — safe to test</div>',
      '<div class="tm-tooltip-hint">Click toggle to switch mode</div>',
    ].join('');
  }

  function _createTooltipEl() {
    if (_tooltipEl) return _tooltipEl;

    const el = document.createElement('div');
    el.id        = 'tm-tooltip';
    el.className = 'tm-tooltip';
    el.setAttribute('role', 'tooltip');

    // Inline base styles — ensures it works even if CSS is missing
    Object.assign(el.style, {
      position:      'fixed',
      zIndex:        '99999',
      pointerEvents: 'none',
      opacity:       '0',
      transition:    'opacity 0.15s ease',
      background:    'rgba(15, 23, 42, 0.97)',
      border:        '1px solid rgba(255,255,255,0.12)',
      borderRadius:  '10px',
      padding:       '12px 16px',
      minWidth:      '220px',
      maxWidth:      '280px',
      boxShadow:     '0 8px 32px rgba(0,0,0,0.5)',
      fontSize:      '12px',
      lineHeight:    '1.6',
      color:         '#e2e8f0',
      backdropFilter:'blur(12px)',
    });

    // Inject scoped styles once
    if (!document.getElementById('tm-tooltip-styles')) {
      const style = document.createElement('style');
      style.id = 'tm-tooltip-styles';
      style.textContent = `
        .tm-tooltip-title {
          font-size: 13px;
          font-weight: 700;
          color: #f8fafc;
          margin-bottom: 8px;
          padding-bottom: 6px;
          border-bottom: 1px solid rgba(255,255,255,0.1);
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .tm-tooltip-row {
          font-size: 11.5px;
          color: #94a3b8;
          margin-bottom: 4px;
        }
        .tm-tooltip-row strong {
          color: #e2e8f0;
        }
        .tm-tooltip-warn {
          margin-top: 8px;
          padding: 5px 8px;
          background: rgba(239,68,68,0.15);
          border-left: 3px solid #ef4444;
          border-radius: 4px;
          font-size: 11px;
          color: #fca5a5;
        }
        .tm-tooltip-info {
          margin-top: 8px;
          padding: 5px 8px;
          background: rgba(245,158,11,0.12);
          border-left: 3px solid #f59e0b;
          border-radius: 4px;
          font-size: 11px;
          color: #fcd34d;
        }
        .tm-tooltip-hint {
          margin-top: 8px;
          font-size: 10.5px;
          color: #475569;
          font-style: italic;
        }
      `;
      document.head.appendChild(style);
    }

    document.body.appendChild(el);
    _tooltipEl = el;
    return el;
  }

  function _showHoverTooltip(e) {
    clearTimeout(_tooltipTimeout);

    _tooltipTimeout = setTimeout(() => {
      const el = _createTooltipEl();
      el.innerHTML = _buildTooltipContent();

      // Make visible (off-screen first to measure)
      el.style.opacity    = '0';
      el.style.visibility = 'hidden';
      el.style.display    = 'block';

      _positionTooltipAt(e.clientX, e.clientY);

      el.style.visibility = 'visible';
      requestAnimationFrame(() => { el.style.opacity = '1'; });

    }, 200);
  }

  function _hideHoverTooltip() {
    clearTimeout(_tooltipTimeout);

    if (_tooltipEl) {
      _tooltipEl.style.opacity = '0';
      _tooltipTimeout = setTimeout(() => {
        if (_tooltipEl) {
          _tooltipEl.style.display = 'none';
        }
      }, 150);
    }
  }

  function _positionTooltip(e) {
    if (!_tooltipEl || _tooltipEl.style.opacity === '0') return;
    _positionTooltipAt(e.clientX, e.clientY);
  }

  // ── Core positioning — always inside viewport ──────────────
  function _positionTooltipAt(mouseX, mouseY) {
    const el = _tooltipEl;
    if (!el) return;

    const GAP      = 14; // px gap between cursor and tooltip
    const margin   = 8;  // minimum margin from viewport edge

    const vw       = window.innerWidth;
    const vh       = window.innerHeight;
    const rect     = el.getBoundingClientRect();
    const tw       = rect.width  || 240;
    const th       = rect.height || 140;

    // Default: tooltip appears to the right and below cursor
    let left = mouseX + GAP;
    let top  = mouseY + GAP;

    // Flip horizontally if overflows right edge
    if (left + tw + margin > vw) {
      left = mouseX - tw - GAP;
    }

    // Flip vertically if overflows bottom edge
    if (top + th + margin > vh) {
      top = mouseY - th - GAP;
    }

    // Hard clamp to viewport bounds
    left = Math.max(margin, Math.min(left, vw - tw - margin));
    top  = Math.max(margin, Math.min(top,  vh - th - margin));

    el.style.left = `${Math.round(left)}px`;
    el.style.top  = `${Math.round(top)}px`;
  }

  // ── Fetch ibkr_status.json from GitHub Pages ──────────────
  async function _fetchStatus() {
    try {
      const data = await ApiClient.getIBKRStatus(true);

      const prevMode = _mode;
      _mode      = data.trading_mode   || 'paper';
      _account   = data.account        || MODES[_mode].account;
      _connected = data.ibkr_connected || false;

      // Detect switch completion
      if (_switching && _switchedAt && prevMode !== _mode) {
        _switching  = false;
        _switchedAt = null;
        clearInterval(_fastPollTimer);
        _pollTimer = setInterval(_fetchStatus, POLL_MS);
        _showToast(
          `Switch complete — ${MODES[_mode].label} mode active (${_account})`,
          'success', 6000
        );

      } else if (_switching && _switchedAt) {
        const elapsed = Date.now() - _switchedAt;
        if (elapsed > 240_000) { // 4 min timeout
          _switching  = false;
          _switchedAt = null;
          clearInterval(_fastPollTimer);
          _pollTimer = setInterval(_fetchStatus, POLL_MS);
          _showToast('Switch timeout — check GitHub Actions', 'warn');
        }
      }

      _updateAllUI();

    } catch (e) {
      console.warn('[TradingMode] Status fetch error:', e.message);
    }
  }

  // ── Accelerated polling during switch ─────────────────────
  function _startFastPoll() {
    clearInterval(_pollTimer);
    clearInterval(_fastPollTimer);
    _fastPollTimer = setInterval(_fetchStatus, 10_000);
  }

  // ── Toggle handler ─────────────────────────────────────────
  async function _handleToggle(e) {
    if (_switching) {
      e.target.checked = _mode === 'live';
      _showToast('Switch in progress — please wait...', 'warn');
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
            ? 'LIVE switch triggered — GitHub Actions running (~2 min)...'
            : 'PAPER switch triggered — GitHub Actions running (~2 min)...',
          mode === 'live' ? 'warn' : 'info',
          8000
        );
        _startFastPoll();

      } else if (res.status === 401) {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        _showToast(
          'PAT expired — update the secret in Cloudflare Workers',
          'error', 8000
        );

      } else {
        _switching = false;
        if (checkbox) checkbox.checked = _mode === 'live';
        _showToast(`Switch error: ${data.error || res.status}`, 'error');
      }

    } catch (e) {
      _switching = false;
      if (checkbox) checkbox.checked = _mode === 'live';
      if (e.name === 'TimeoutError') {
        _showToast('Worker slow — switch may still be in progress', 'warn');
      } else {
        _showToast(`Worker unreachable: ${e.message}`, 'error');
      }
    } finally {
      if (checkbox) checkbox.disabled = false;
      _updateAllUI();
    }
  }

  // ── Full UI update ─────────────────────────────────────────
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

    // dry-run-badge (terminal.js compat)
    const badge = document.getElementById('dry-run-badge');
    if (badge) {
      badge.textContent = cfg.label;
      badge.className   = _mode === 'live' ? 'dry-run-badge live' : 'dry-run-badge';
    }

    // Wrapper data-mode attribute
    const wrap = document.getElementById('mode-toggle-wrap');
    if (wrap) wrap.dataset.mode = _mode;

    // IBKR status pill
    const pill = document.getElementById('ibkr-status-pill');
    if (pill) {
      pill.className = `ibkr-status-pill ${_mode} ${_connected ? 'connected' : ''}`;
    }

    // ibkr-mode-text
    const modeText = document.getElementById('ibkr-mode-text');
    if (modeText) {
      modeText.innerHTML = _mode === 'live'
        ? '<span style="color:#ef4444;font-weight:800">LIVE TRADING</span>'
        : 'PAPER MODE';
    }

    // icp-status
    const icpStatus = document.getElementById('icp-status');
    if (icpStatus) {
      icpStatus.innerHTML = _switching
        ? `<span style="color:var(--y)">Switch in progress (GitHub Actions)...</span>`
        : _connected
          ? `<span style="color:var(--g)">Connected — ${cfg.label}</span>`
          : `<span style="color:var(--y)">${cfg.label} — Auth pending</span>`;
    }

    // icp-account
    const icpAcc = document.getElementById('icp-account');
    if (icpAcc) icpAcc.textContent = _account;

    // hg-ibkr (System Health grid)
    const hgIbkr = document.getElementById('hg-ibkr');
    if (hgIbkr) {
      const icon = _switching
        ? '<i class="fa-solid fa-rotate fa-spin" style="color:var(--y)"></i>'
        : _connected
          ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i>'
          : '<i class="fa-solid fa-hourglass-half" style="color:var(--y)"></i>';
      hgIbkr.innerHTML = `${icon} ${cfg.label} — <span class="mono" style="font-size:10px">${_account}</span>`;
    }

    // dot-ibkr + pill-ibkr (topbar cluster)
    const dotIbkr  = document.getElementById('dot-ibkr');
    const pillIbkr = document.getElementById('pill-ibkr');
    const state    = _connected ? 'ok' : 'warn';
    if (dotIbkr)  dotIbkr.className  = `s-dot ${state}`;
    if (pillIbkr) {
      pillIbkr.className = `status-pill ${state}`;
      pillIbkr.title     = `IBKR ${cfg.label} — ${_account}`;
    }

    // Refresh tooltip content if visible
    if (_tooltipEl && parseFloat(_tooltipEl.style.opacity) > 0) {
      _tooltipEl.innerHTML = _buildTooltipContent();
    }
  }

  // ── Oracle dot ─────────────────────────────────────────────
  function _updateOracleDot(state) {
    const dot = document.getElementById('mode-oracle-dot');
    if (!dot) return;
    dot.className = `mode-oracle-dot ${state}`;
    dot.title     = state === 'online'  ? 'IBKR connected'
                  : state === 'pending' ? 'IBeam auth pending'
                  :                       'Offline';
  }

  // ── Switching UI state ─────────────────────────────────────
  function _setSwitchingUI(targetMode) {
    const label = document.getElementById('mode-toggle-label');
    if (label) {
      label.className   = 'mode-toggle-label switching';
      label.textContent = 'Switching...';
    }
    const cb = document.getElementById('mode-toggle-checkbox');
    if (cb) cb.checked = targetMode === 'live';
    _updateOracleDot('pending');
  }

  // ── Live confirmation modal ────────────────────────────────
  function _showLiveConfirmModal() {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'live-confirm-overlay';

      overlay.innerHTML = `
        <div class="live-confirm-modal">
          <div class="live-confirm-icon">
            <i class="fa-solid fa-triangle-exclamation"></i>
          </div>
          <div class="live-confirm-title">Live Trading — Confirmation Required</div>
          <div class="live-confirm-subtitle">
            GitHub Actions will switch to real-money trading.<br>
            Allow approximately <strong>2 minutes</strong> for the switch to take effect.
          </div>
          <div class="live-confirm-warning">
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Live account: <strong>U21160314 (raphnardone)</strong>
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              IBeam restarts (~90s interruption)
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              Orders will be executed with real money
            </div>
            <div class="live-confirm-warning-row">
              <i class="fa-solid fa-circle-dot"></i>
              You can switch back to Paper at any time
            </div>
          </div>
          <div class="live-confirm-input-label">
            Type <strong>LIVE</strong> to confirm:
          </div>
          <input
            type="text"
            class="live-confirm-input"
            id="live-confirm-input"
            placeholder="LIVE"
            autocomplete="off"
            maxlength="10"
          >
          <div class="live-confirm-btns">
            <button class="live-confirm-cancel" id="lc-cancel">Cancel</button>
            <button class="live-confirm-ok" id="lc-ok">
              <i class="fa-solid fa-bolt"></i> Enable Live Trading
            </button>
          </div>
        </div>`;

      document.body.appendChild(overlay);

      const input = overlay.querySelector('#live-confirm-input');
      const okBtn = overlay.querySelector('#lc-ok');

      setTimeout(() => input?.focus(), 100);

      input?.addEventListener('input', () => {
        okBtn?.classList.toggle(
          'ready',
          input.value.trim().toUpperCase() === 'LIVE'
        );
      });

      input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && input.value.trim().toUpperCase() === 'LIVE') {
          _done(true);
        }
        if (e.key === 'Escape') {
          _done(false);
        }
      });

      okBtn?.addEventListener('click', () => {
        if (input?.value?.trim().toUpperCase() === 'LIVE') _done(true);
      });

      overlay.querySelector('#lc-cancel')?.addEventListener('click', () => _done(false));
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) _done(false);
      });

      function _done(confirmed) {
        overlay.style.opacity    = '0';
        overlay.style.transition = 'opacity 0.15s';
        setTimeout(() => { overlay.remove(); resolve(confirmed); }, 150);
      }
    });
  }

  // ── Toast notification ─────────────────────────────────────
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
      <i class="fa-solid ${icons[type]}" style="color:${colors[type]}"></i>
      ${msg}
    `;
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

console.log('[TradingMode] v2.2 loaded | Worker + GitHub Pages | 100% free');