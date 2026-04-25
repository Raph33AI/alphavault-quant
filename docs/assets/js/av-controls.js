// ============================================================
// av-controls.js — AlphaVault Quant Dashboard v1.0
// Contrôles : Paper/Live switch, Auto/Manual, mode badges
// Dépend de : av-config.js, av-utils.js, av-api.js
// Règle R10 : SSH tunnel requis — triple confirmation LIVE
// ============================================================

const AVControls = (() => {

  let _mode     = 'paper';
  let _auto     = false;
  let _paused   = false;

  // ══════════════════════════════════════════════════════════
  // MODE BADGE — Header & Sidebar
  // ══════════════════════════════════════════════════════════

  function updateModeBadge(modeData) {
    if (!modeData) return;

    _mode   = safeGet(modeData, 'mode',  'paper');
    _auto   = safeGet(modeData, 'auto',  false);
    _paused = safeGet(modeData, 'trading_paused', false);

    const isLive   = _mode === 'live';
    const modeText = `${_auto ? 'AUTO' : 'MANUAL'} ${_mode.toUpperCase()}`;
    const color    = isLive ? '#ef4444' : '#10b981';

    // Header badge
    const headerBadge = document.getElementById('mode-badge-header');
    if (headerBadge) {
      headerBadge.innerHTML = `
        <span class="mode-badge-main ${isLive ? 'live' : 'paper'}"
              style="background:${color}15;color:${color};border:1px solid ${color}40;
                     padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700;
                     display:flex;align-items:center;gap:6px">
          <span class="mode-dot" style="width:7px;height:7px;border-radius:50%;background:${color};
                ${isLive ? 'animation:pulse-dot 1.2s infinite' : ''}"></span>
          ${modeText}
          ${_paused ? '<span style="color:#f59e0b;font-size:10px">(PAUSED)</span>' : ''}
        </span>`;
    }

    // Sidebar label
    const sidebarLabel = document.getElementById('mode-label');
    if (sidebarLabel) {
      sidebarLabel.textContent = modeText;
      sidebarLabel.style.color = color;
    }

    // Sync toggles dans les pages settings/trading
    _syncToggleUI();
  }

  function _syncToggleUI() {
    // Toggle Paper/Live
    const paperBtn = document.getElementById('toggle-paper-btn');
    const liveBtn  = document.getElementById('toggle-live-btn');
    if (paperBtn && liveBtn) {
      paperBtn.classList.toggle('active', _mode === 'paper');
      liveBtn.classList.toggle('active',  _mode === 'live');
    }

    // Toggle Auto/Manual
    const autoBtn   = document.getElementById('toggle-auto-btn');
    const manualBtn = document.getElementById('toggle-manual-btn');
    if (autoBtn && manualBtn) {
      autoBtn.classList.toggle('active',   _auto);
      manualBtn.classList.toggle('active', !_auto);
    }

    // Pause/Resume
    const pauseBtn  = document.getElementById('toggle-pause-btn');
    const resumeBtn = document.getElementById('toggle-resume-btn');
    if (pauseBtn && resumeBtn) {
      pauseBtn.style.display  = _paused ? 'none' : '';
      resumeBtn.style.display = _paused ? ''     : 'none';
    }
  }

  // ══════════════════════════════════════════════════════════
  // PAPER ↔ LIVE SWITCH (R10 — triple confirmation pour LIVE)
  // ══════════════════════════════════════════════════════════

  function initPaperLiveSwitch() {
    const paperBtn = document.getElementById('toggle-paper-btn');
    const liveBtn  = document.getElementById('toggle-live-btn');

    paperBtn?.addEventListener('click', async () => {
      if (_mode === 'paper') return;  // déjà en paper

      showModal({
        title: 'Switch to Paper Trading',
        body:  `
          <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
            Switch from <strong style="color:#ef4444">LIVE</strong> to
            <strong style="color:#10b981">PAPER</strong> trading mode.<br>
            No real orders will be submitted.
          </div>`,
        confirmText: 'Switch to Paper',
        danger: false,
        onConfirm: () => _switchMode('paper'),
      });
    });

    liveBtn?.addEventListener('click', async () => {
      if (_mode === 'live') return;

      // Étape 1 — Avertissement
      showModal({
        title: 'Switch to LIVE Trading — Step 1/3',
        body: `
          <div style="text-align:center;padding:8px">
            <i class="fa-solid fa-triangle-exclamation"
               style="font-size:36px;color:#ef4444;margin-bottom:12px;display:block"></i>
            <div style="font-size:15px;font-weight:700;color:#ef4444;margin-bottom:10px">
              WARNING: Real Money at Risk
            </div>
            <div style="font-size:12px;color:var(--text-muted);line-height:1.7">
              Switching to LIVE mode will submit real orders to IBKR account
              <strong style="color:var(--text-primary)">${AV_CONFIG.ACCOUNT.live}</strong>.<br>
              All positions will be executed with real capital.
            </div>
          </div>`,
        confirmText: 'I understand — Continue',
        danger: true,
        onConfirm: () => _liveSwitchStep2(),
      });
    });
  }

  function _liveSwitchStep2() {
    showModal({
      title: 'Switch to LIVE Trading — Step 2/3',
      body: `
        <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
          <div style="margin-bottom:12px">Please verify the following before continuing:</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="live-check-1" style="width:16px;height:16px">
              <span>I have reviewed all open positions (${AV_CONFIG.ACCOUNT.live})</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="live-check-2" style="width:16px;height:16px">
              <span>I understand this account uses <strong>real capital</strong></span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" id="live-check-3" style="width:16px;height:16px">
              <span>Risk limits have been verified</span>
            </label>
          </div>
        </div>`,
      confirmText: 'All confirmed — Next',
      danger: true,
      onConfirm: () => {
        const c1 = document.getElementById('live-check-1')?.checked;
        const c2 = document.getElementById('live-check-2')?.checked;
        const c3 = document.getElementById('live-check-3')?.checked;
        if (!c1 || !c2 || !c3) {
          showToast('Please confirm all checkboxes', 'warn');
          setTimeout(() => _liveSwitchStep2(), 100);
          return;
        }
        _liveSwitchStep3();
      },
    });
  }

  function _liveSwitchStep3() {
    showModal({
      title: 'Switch to LIVE Trading — Final Confirmation',
      body: `
        <div style="font-size:13px;line-height:1.7">
          <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);
                      border-radius:8px;padding:14px;margin-bottom:12px">
            <div style="font-weight:700;color:#ef4444;margin-bottom:6px">
              <i class="fa-solid fa-circle-exclamation"></i> Final Warning
            </div>
            <div style="font-size:12px;color:var(--text-muted)">
              Account: <strong style="color:var(--text-primary)">${AV_CONFIG.ACCOUNT.live}</strong> (U21160314)<br>
              This action cannot be undone automatically.<br>
              Orders will execute immediately on market open.
            </div>
          </div>
          <div style="font-size:12px;color:var(--text-muted)">
            Type <strong style="color:var(--text-primary)">LIVE</strong> to confirm:
            <input id="live-confirm-input" type="text"
                   style="margin-top:8px;width:100%;padding:8px 12px;border-radius:6px;
                          border:1px solid var(--border);background:var(--bg-secondary);
                          color:var(--text-primary);font-family:var(--font-mono);font-size:14px;
                          letter-spacing:2px;text-align:center;text-transform:uppercase;box-sizing:border-box"
                   placeholder="Type LIVE to confirm" autocomplete="off">
          </div>
        </div>`,
      confirmText: 'Switch to LIVE NOW',
      danger: true,
      onConfirm: async () => {
        const val = (document.getElementById('live-confirm-input')?.value || '').trim().toUpperCase();
        if (val !== 'LIVE') {
          showToast('You must type LIVE to confirm', 'error');
          return;
        }
        await _switchMode('live');
      },
    });
  }

  // ══════════════════════════════════════════════════════════
  // AUTO ↔ MANUAL
  // ══════════════════════════════════════════════════════════

  function initAutoManualSwitch() {
    const autoBtn   = document.getElementById('toggle-auto-btn');
    const manualBtn = document.getElementById('toggle-manual-btn');

    autoBtn?.addEventListener('click', async () => {
      if (_auto) return;
      const available = await AVApi.checkDashboardAPI();
      if (!available) { _showAPIRequired('resume trading'); return; }

      showModal({
        title: 'Enable Auto Trading',
        body: `
          <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
            Resume <strong style="color:#10b981">automatic</strong> trading execution.<br>
            The system will process signals and submit orders automatically.
          </div>`,
        confirmText: 'Enable Auto',
        onConfirm: () => _setAutoMode(true),
      });
    });

    manualBtn?.addEventListener('click', async () => {
      if (!_auto) return;
      const available = await AVApi.checkDashboardAPI();
      if (!available) { _showAPIRequired('pause trading'); return; }

      showModal({
        title: 'Switch to Manual Mode',
        body: `
          <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
            Pause automatic order execution.<br>
            The system will continue scanning signals but
            <strong style="color:var(--text-primary)">will not submit orders</strong>.
          </div>`,
        confirmText: 'Pause Auto Trading',
        danger: true,
        onConfirm: () => _setAutoMode(false),
      });
    });

    // Boutons Pause/Resume alternatifs
    document.getElementById('toggle-pause-btn')?.addEventListener('click', async () => {
      const available = await AVApi.checkDashboardAPI();
      if (!available) { _showAPIRequired('pause'); return; }
      await AVApi.callDashboardAPI('/pause', { method: 'POST' });
      _paused = true;
      _syncToggleUI();
      showToast('Trading paused', 'warn');
    });

    document.getElementById('toggle-resume-btn')?.addEventListener('click', async () => {
      const available = await AVApi.checkDashboardAPI();
      if (!available) { _showAPIRequired('resume'); return; }
      await AVApi.callDashboardAPI('/resume', { method: 'POST' });
      _paused = false;
      _syncToggleUI();
      showToast('Trading resumed', 'success');
    });
  }

  // ══════════════════════════════════════════════════════════
  // API CALLS
  // ══════════════════════════════════════════════════════════

  async function _switchMode(targetMode) {
    const available = await AVApi.checkDashboardAPI();
    if (!available) {
      _showAPIRequired(`switch to ${targetMode}`);
      return;
    }

    const btn = document.getElementById(`toggle-${targetMode}-btn`);
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>'; }

    try {
      const { data, error } = await AVApi.callDashboardAPI('/switch-mode', {
        method:  'POST',
        headers: { 'Authorization': 'ALPHAVAULT_SWITCH_2026_SECRET' },
        body:    JSON.stringify({ mode: targetMode, confirm: true }),
      });

      if (error) throw new Error(error);

      _mode = targetMode;
      _syncToggleUI();
      updateModeBadge({ mode: _mode, auto: _auto });

      showToast(
        `Switched to ${targetMode.toUpperCase()} mode — ${targetMode === 'live' ? AV_CONFIG.ACCOUNT.live : AV_CONFIG.ACCOUNT.paper}`,
        targetMode === 'live' ? 'warn' : 'success',
        5000
      );

      // Invalide le cache mode
      AVApi.invalidate('mode');
      AVApi.invalidate('execution');

    } catch (err) {
      showToast(`Switch failed: ${err.message}`, 'error', 5000);
      console.error('[AVControls] switchMode error:', err);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = targetMode === 'paper' ? 'Paper' : 'Live';
      }
    }
  }

  async function _setAutoMode(enable) {
    const endpoint = enable ? '/resume' : '/pause';
    const { error } = await AVApi.callDashboardAPI(endpoint, { method: 'POST' });
    if (error) { showToast(`Failed: ${error}`, 'error'); return; }

    _auto   = enable;
    _paused = !enable;
    _syncToggleUI();
    updateModeBadge({ mode: _mode, auto: _auto });
    showToast(enable ? 'Auto trading enabled' : 'Manual mode — auto trading paused', enable ? 'success' : 'warn');
    AVApi.invalidate('mode');
  }

  function _showAPIRequired(action) {
    showModal({
      title: 'SSH Tunnel Required',
      body:  `
        <div style="font-size:13px;color:var(--text-muted);line-height:1.7;margin-bottom:12px">
          To <strong style="color:var(--text-primary)">${action}</strong>, the Dashboard API
          must be accessible via SSH tunnel:
        </div>
        <div style="padding:10px 14px;background:var(--bg-secondary);border-radius:8px;
                    font-family:var(--font-mono);font-size:11px;color:var(--text-primary);
                    border:1px solid var(--border);word-break:break-all">
          ssh -i ~/ssh-key-2026-04-18.key -L 5002:localhost:5002 ubuntu@141.253.101.68
        </div>`,
    });
  }

  // ══════════════════════════════════════════════════════════
  // SYNC STATUS — Pour settings.html
  // ══════════════════════════════════════════════════════════

  function renderSyncStatus(systemData) {
    const container = document.getElementById('sync-status-section');
    if (!container) return;

    const sync       = safeGet(systemData, 'dashboard_sync', {});
    const isActive   = safeGet(sync, 'active', true);
    const nFiles     = sf(safeGet(sync, 'watcher_managed_files', 21));
    const stats      = safeGet(sync, 'sync_stats', {});
    const pushed     = sf(safeGet(stats, 'pushed',  0));
    const failed     = sf(safeGet(stats, 'failed',  0));
    const skipped    = sf(safeGet(stats, 'skipped', 0));

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-cloud-arrow-up" style="color:#10b981"></i>
        GitHub Sync Status
        ${isActive ? badgeHTML('Active', 'green', 'fa-check') : badgeHTML('Inactive', 'red', 'fa-xmark')}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:14px">
        <div class="sync-stat">
          <div class="sync-stat-label">Files Managed</div>
          <div class="sync-stat-value" style="color:#3b82f6">${nFiles}/21</div>
        </div>
        <div class="sync-stat">
          <div class="sync-stat-label">Pushed</div>
          <div class="sync-stat-value" style="color:#10b981">${pushed.toLocaleString()}</div>
        </div>
        <div class="sync-stat">
          <div class="sync-stat-label">Failed</div>
          <div class="sync-stat-value" style="color:${failed > 0 ? '#ef4444' : 'var(--text-muted)'}">
            ${failed}
          </div>
        </div>
        <div class="sync-stat">
          <div class="sync-stat-label">Skipped</div>
          <div class="sync-stat-value" style="color:var(--text-muted)">${skipped}</div>
        </div>
      </div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${badgeHTML('ibkr_watcher: 10 files / 30s', 'blue',   'fa-eye')}
        ${badgeHTML('dashboard_sync: 11 files / 60s', 'violet', 'fa-rotate')}
        ${badgeHTML('Git Data API — batch commit', 'gray', 'fa-code-branch')}
        ${failed === 0 ? badgeHTML('0 race conditions', 'green', 'fa-check') : badgeHTML(`${failed} errors`, 'red', 'fa-xmark')}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // THRESHOLDS READ-ONLY — Pour settings.html
  // ══════════════════════════════════════════════════════════

  function renderThresholds(signalsMeta) {
    const container = document.getElementById('thresholds-section');
    if (!container) return;

    const t = AV_CONFIG.THRESHOLDS;
    const m = signalsMeta?.thresholds || {};

    const items = [
      { label: 'Buy Threshold',        value: sf(m.buy       || t.buyConf)     * 100, unit: '%', color: '#10b981' },
      { label: 'Sell Threshold',       value: sf(m.sell      || t.sellConf)    * 100, unit: '%', color: '#ef4444' },
      { label: 'High Conf Gate',       value: sf(m.high_conf || t.highConf)    * 100, unit: '%', color: '#eab308' },
      { label: 'Max Leverage',         value: t.maxLeverage,                          unit: 'x', color: '#f59e0b' },
      { label: 'Max Drawdown',         value: t.maxDrawdown * 100,                    unit: '%', color: '#ef4444' },
      { label: 'Max Correlation',      value: t.maxCorr * 100,                        unit: '%', color: '#8b5cf6' },
    ];

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-sliders" style="color:#3b82f6"></i>
        Signal Thresholds
        ${badgeHTML('Read-only — edit via Oracle config.py', 'gray', 'fa-lock')}
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">
        ${items.map(item => `
          <div style="padding:12px;background:var(--bg-secondary);border-radius:8px;
                      border:1px solid var(--border)">
            <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;
                        letter-spacing:0.5px;margin-bottom:5px">${item.label}</div>
            <div style="font-size:20px;font-weight:900;font-family:var(--font-mono);color:${item.color}">
              ${item.value.toFixed(item.unit === 'x' ? 1 : 0)}${item.unit}
            </div>
          </div>`).join('')}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════

  function init() {
    initPaperLiveSwitch();
    initAutoManualSwitch();
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    init,
    updateModeBadge,
    renderSyncStatus,
    renderThresholds,
    getMode:    () => _mode,
    isAuto:     () => _auto,
    isPaused:   () => _paused,
  };

})();

window.AVControls = AVControls;
console.log('[av-controls] Loaded — Paper/Live (triple confirm R10) | Auto/Manual | Sync status');