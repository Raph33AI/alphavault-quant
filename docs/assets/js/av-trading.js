// ============================================================
// av-trading.js — AlphaVault Quant Trading Terminal v1.0
// Controller pour trading.html
// Dépend : av-config.js, av-utils.js, av-api.js
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  let _mode      = null;   // execution_mode.json
  let _execution = null;   // execution_status.json
  let _ibkr      = null;   // ibkr_status.json
  let _orders    = null;   // pending_orders.json
  let _portfolio = null;   // portfolio.json

  let _selectedSide = 'BUY';
  let _selectedType = 'MKT';
  let _apiAvail     = null;   // null=unknown | true | false
  let _timers       = [];

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    AVUtils.setSidebarActive('trading');
    _bindThemeToggle();
    _bindSidebar();
    _bindOrderForm();
    _bindControls();

    _showSkeleton();

    // Vérifie si le Dashboard API :5002 est joignable (SSH tunnel)
    _apiAvail = await AVApi.checkDashboardAPI();

    await loadData();
    _startRefresh();

    // ── Pré-remplit le formulaire depuis ?symbol=AAPL ──────────
    _prefillFromURL();

    console.log('[av-trading] v1.0 init complete — API available:', _apiAvail);
  }

  // ══════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════
  async function loadData() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const [modeRes, execRes, ibkrRes, ordRes, portRes] = await Promise.allSettled([
      AVApi.fetchJSON(URLS.mode,      0),
      AVApi.fetchJSON(URLS.execution, 0),
      AVApi.fetchJSON(URLS.ibkr,      0),
      AVApi.fetchJSON(URLS.orders,    0),
      AVApi.fetchJSON(URLS.portfolio, 0),
    ]);
    const p = d => d.status === 'fulfilled' ? d.value : null;
    _mode      = p(modeRes);
    _execution = p(execRes);
    _ibkr      = p(ibkrRes);
    _orders    = p(ordRes);
    _portfolio = p(portRes);

    renderAll();
  }

  function renderAll() {
    renderModeBanner();
    renderKPIs();
    renderSSHWarning();
    renderControls();
    renderPendingOrders();
    renderOrderLocks();
    renderQueueStatus();
    renderSessionStats();
    _updateSidebarStatus();
  }

  // ══════════════════════════════════════════════════════════
  // MODE BANNER
  // ══════════════════════════════════════════════════════════
  function renderModeBanner() {
    const mode    = _mode?.mode             || 'paper';
    const auto    = _mode?.auto             ?? true;
    const dryRun  = _mode?.dry_run          ?? true;
    const account = _mode?.account          || AV_CONFIG.ACCOUNT.paper;
    const label   = _mode?.label            || `${auto ? 'AUTO' : 'MANUAL'} — ${mode} trading`;
    const blocked = _mode?.orders_blocked   ?? false;
    const isLive  = mode === 'live';
    const isAuto  = !!auto;

    // Badge principal mode
    _setHTML('trd-mode-badge', isLive
      ? `<span class="trd-badge-live">
           <i class="fa-solid fa-circle trd-pulse"></i> LIVE
         </span>`
      : `<span class="trd-badge-paper">
           <i class="fa-solid fa-circle"></i> PAPER
         </span>`);

    _setText('trd-mode-label',   label);
    _setText('trd-mode-account', `Account: ${account}`);

    // Badges secondaires
    _setHTML('trd-mode-badges', `
      <span class="badge ${isAuto ? 'badge-green' : 'badge-orange'}" style="font-size:11px">
        <i class="fa-solid fa-${isAuto ? 'play' : 'pause'}"></i>
        ${isAuto ? 'AUTO' : 'MANUAL'}
      </span>
      <span class="badge ${dryRun ? 'badge-blue' : 'badge-red'}" style="font-size:11px">
        <i class="fa-solid fa-${dryRun ? 'eye' : 'bolt'}"></i>
        ${dryRun ? 'DRY RUN' : 'LIVE ORDERS'}
      </span>
      ${blocked
        ? `<span class="badge badge-red" style="font-size:11px">
             <i class="fa-solid fa-ban"></i> ORDERS BLOCKED
           </span>`
        : ''}
    `);

    // Connexion IBKR
    const connected = _execution?.ibkr_connected ?? _ibkr?.authenticated ?? false;
    const authOk    = _ibkr?.authenticated ?? false;

    _setHTML('trd-conn-status', `
      <div class="trd-conn-row">
        <div class="av-status-dot ${connected ? 'green' : 'red'}"></div>
        <span class="trd-conn-label">
          IBKR ${connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <div class="trd-conn-row" style="margin-top:4px">
        <div class="av-status-dot ${authOk ? 'green' : 'gray'}"></div>
        <span style="font-size:10px;color:var(--text-faint)">
          ${authOk ? 'Authenticated' : 'Not authenticated'}
        </span>
      </div>`);

    _refreshSubmitBtn();
  }

  // ══════════════════════════════════════════════════════════
  // KPIs (4 cartes)
  // ══════════════════════════════════════════════════════════
  function renderKPIs() {
    // R1 : NetLiq TOUJOURS depuis portfolio.json
    const netliq   = AVUtils.netliqFromPortfolio(_portfolio);
    const cash     = parseFloat(
      _execution?.available_cash || AVUtils.safeGet(_portfolio, 'cash', 0)
    );
    const executed = parseInt(_execution?.stats?.executed || 0);
    const failed   = parseInt(_execution?.stats?.failed   || 0);

    _setHTML('trd-kpi-netliq', netliq
      ? `<span class="trd-kpi-val">${AVUtils.formatCurrency(netliq)}</span>`
      : `<span class="trd-kpi-val">—</span>`);

    _setHTML('trd-kpi-cash', cash > 0
      ? `<span class="trd-kpi-val">${AVUtils.formatCurrency(cash)}</span>`
      : `<span class="trd-kpi-val">—</span>`);

    _setHTML('trd-kpi-executed',
      `<span class="trd-kpi-val" style="color:var(--accent-green)">
         ${executed.toLocaleString()}
       </span>`);

    _setHTML('trd-kpi-failed',
      `<span class="trd-kpi-val" style="color:${failed > 0
          ? 'var(--accent-red)'
          : 'var(--accent-green)'}">
         ${failed.toLocaleString()}
       </span>`);
  }

  // ══════════════════════════════════════════════════════════
  // SSH WARNING BANNER
  // ══════════════════════════════════════════════════════════
  function renderSSHWarning() {
    const banner = document.getElementById('trd-ssh-banner');
    if (!banner) return;

    if (_apiAvail === false) {
      banner.style.display = 'flex';
      banner.innerHTML = `
        <i class="fa-solid fa-terminal"
           style="color:var(--accent-orange);font-size:16px;flex-shrink:0;margin-top:2px"></i>
        <div style="flex:1;min-width:0">
          <div class="trd-ssh-title">
            
          </div>
          <code class="trd-ssh-code">
             
          </code>
          <div class="trd-ssh-hint">
            Run this command locally, then reload the page to enable order submission.
          </div>
        </div>`;
    } else if (_apiAvail === true) {
      banner.style.display = 'none';
    }
  }

  // ══════════════════════════════════════════════════════════
  // CONTROLS SECTION
  // ══════════════════════════════════════════════════════════
  function renderControls() {
    const mode   = _mode?.mode || 'paper';
    const auto   = _mode?.auto ?? true;
    const isLive = mode === 'live';
    const isAuto = !!auto;

    // Badge état actuel Paper / Live
    _setHTML('trd-ctrl-mode-status', isLive
      ? `<span class="trd-badge-live" style="font-size:11px">
           <i class="fa-solid fa-circle trd-pulse"></i> LIVE
         </span>`
      : `<span class="trd-badge-paper" style="font-size:11px">
           <i class="fa-solid fa-circle"></i> PAPER
         </span>`);

    // Badge état actuel Auto / Manual
    _setHTML('trd-ctrl-auto-status', isAuto
      ? `<span class="badge badge-green" style="font-size:11px">
           <i class="fa-solid fa-play"></i> AUTO
         </span>`
      : `<span class="badge badge-orange" style="font-size:11px">
           <i class="fa-solid fa-pause"></i> MANUAL
         </span>`);

    // Bouton switch Paper ↔ Live
    const switchBtn = document.getElementById('trd-switch-mode-btn');
    if (switchBtn) {
      const targetLabel = isLive ? 'Paper' : 'Live';
      switchBtn.className = `trd-ctrl-btn ${isLive ? 'to-paper' : 'to-live'}`;
      switchBtn.innerHTML = `
        <i class="fa-solid fa-right-left"></i>
        Switch to ${targetLabel}`;
      switchBtn.disabled = (_apiAvail === false);
      switchBtn.title    = _apiAvail === false ? 'SSH tunnel required' : '';
    }

    // Bouton Auto ↔ Manual
    const autoBtn = document.getElementById('trd-auto-manual-btn');
    if (autoBtn) {
      autoBtn.className = `trd-ctrl-btn ${isAuto ? 'to-manual' : 'to-auto'}`;
      autoBtn.innerHTML = isAuto
        ? `<i class="fa-solid fa-pause"></i> Pause Trading (→ Manual)`
        : `<i class="fa-solid fa-play"></i> Resume Trading (→ Auto)`;
      autoBtn.disabled = (_apiAvail === false);
      autoBtn.title    = _apiAvail === false ? 'SSH tunnel required' : '';
    }
  }

  // ══════════════════════════════════════════════════════════
  // PENDING ORDERS TABLE
  // ══════════════════════════════════════════════════════════
  function renderPendingOrders() {
    const body = document.getElementById('trd-orders-body');
    if (!body) return;

    const orders    = _orders?.orders    || [];
    const processed = parseInt(_orders?.processed || 0);

    _setHTML('trd-orders-badge', `
      <span class="badge badge-blue" style="font-size:10px">
        ${orders.length} active
      </span>
      <span class="badge badge-gray" style="font-size:10px;margin-left:4px">
        ${processed.toLocaleString()} processed
      </span>`);

    if (orders.length === 0) {
      body.innerHTML = `
        <div class="trd-empty-state">
          <i class="fa-solid fa-list-check trd-empty-icon"></i>
          <div class="trd-empty-title">No pending orders</div>
          <div class="trd-empty-sub">
            Orders submitted via the form will appear here
          </div>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="av-table-wrapper" style="border:none;border-radius:0">
        <table class="av-table">
          <thead>
            <tr>
              <th style="padding-left:14px">Symbol</th>
              <th style="text-align:center;width:80px">Side</th>
              <th style="text-align:right">Qty</th>
              <th style="text-align:center;width:70px">Type</th>
              <th style="text-align:right">Price</th>
              <th style="text-align:center;width:90px">Status</th>
            </tr>
          </thead>
          <tbody>
            ${orders.map(o => {
              const sym    = o.symbol || '—';
              const side   = (o.side || o.action || 'BUY').toUpperCase();
              const qty    = parseInt(o.quantity || 0);
              const type   = o.order_type || 'MKT';
              const price  = parseFloat(o.price || 0);
              const status = o.status || 'PENDING';
              const isBuy  = side === 'BUY';
              return `
                <tr>
                  <td style="padding:10px 14px;font-weight:700;font-size:13px;
                             color:var(--text-primary)">${sym}</td>
                  <td style="padding:10px 8px;text-align:center">
                    <span class="sig-action-badge ${isBuy ? 'buy' : 'sell'}">
                      <i class="fa-solid fa-arrow-${isBuy ? 'up' : 'down'}"
                         style="font-size:8px"></i>
                      ${side}
                    </span>
                  </td>
                  <td style="padding:10px 12px;text-align:right;font-family:var(--font-mono);
                             font-size:12px;font-weight:600;color:var(--text-primary)">
                    ${qty.toLocaleString()}
                  </td>
                  <td style="padding:10px 8px;text-align:center">
                    <span class="badge badge-gray" style="font-size:9px">${type}</span>
                  </td>
                  <td style="padding:10px 12px;text-align:right;font-family:var(--font-mono);
                             font-size:12px;color:var(--text-secondary)">
                    ${price > 0 ? `$${price.toFixed(2)}` : 'MKT'}
                  </td>
                  <td style="padding:10px 8px;text-align:center">
                    <span class="badge ${status === 'FILLED' ? 'badge-green'
                                        : status === 'FAILED' ? 'badge-red'
                                        : 'badge-orange'}"
                          style="font-size:9px">${status}</span>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // ORDER LOCKS
  // ══════════════════════════════════════════════════════════
  function renderOrderLocks() {
    const body    = document.getElementById('trd-locks-body');
    if (!body) return;

    const locks   = _execution?.order_locks || {};
    const entries = Object.entries(locks);

    _setHTML('trd-locks-count',
      `<span class="badge badge-orange" style="font-size:10px">
         <i class="fa-solid fa-lock" style="font-size:8px"></i>
         ${entries.length} locked
       </span>`);

    if (entries.length === 0) {
      body.innerHTML = `
        <div class="trd-empty-state trd-empty-sm">
          <i class="fa-solid fa-lock-open"
             style="font-size:20px;opacity:0.2;display:block;margin-bottom:6px"></i>
          <span style="font-size:11px;color:var(--text-faint)">No symbols currently locked</span>
        </div>`;
      return;
    }

    const top = entries.slice(0, 12);
    body.innerHTML = `
      <div class="trd-locks-grid">
        ${top.map(([sym, price]) => {
          const p = parseFloat(price);
          return `
            <div class="trd-lock-chip">
              <div class="trd-lock-sym">${sym}</div>
              <div class="trd-lock-price">
                ${p > 0 ? `$${p.toFixed(2)}` : '—'}
              </div>
            </div>`;
        }).join('')}
      </div>
      ${entries.length > 12
        ? `<div style="text-align:center;font-size:10px;color:var(--text-faint);
                       margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
             +${entries.length - 12} more locked
           </div>`
        : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // QUEUE STATUS
  // ══════════════════════════════════════════════════════════
  function renderQueueStatus() {
    const body     = document.getElementById('trd-queue-body');
    if (!body) return;

    const exitQ    = parseInt(_execution?.exit_queue_size    || 0);
    const regularQ = parseInt(_execution?.regular_queue_size || 0);

    body.innerHTML = `
      <div class="trd-queue-row">
        <div class="trd-queue-label">
          <i class="fa-solid fa-arrow-right-from-bracket"
             style="color:var(--accent-red);font-size:11px"></i>
          Exit Queue
        </div>
        <div class="trd-queue-val">
          ${exitQ > 0
            ? `<span class="badge badge-orange" style="font-size:10px">
                 ${exitQ} waiting
               </span>`
            : `<span class="badge badge-green" style="font-size:10px">Empty</span>`}
        </div>
      </div>
      <div class="trd-queue-row">
        <div class="trd-queue-label">
          <i class="fa-solid fa-arrow-right-to-bracket"
             style="color:var(--accent-blue);font-size:11px"></i>
          Regular Queue
        </div>
        <div class="trd-queue-val">
          ${regularQ > 0
            ? `<span class="badge badge-orange" style="font-size:10px">
                 ${regularQ} waiting
               </span>`
            : `<span class="badge badge-green" style="font-size:10px">Empty</span>`}
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // SESSION STATS
  // ══════════════════════════════════════════════════════════
  function renderSessionStats() {
    const body     = document.getElementById('trd-stats-body');
    if (!body) return;

    const stats    = _execution?.stats || {};
    const executed = parseInt(stats.executed || 0);
    const failed   = parseInt(stats.failed   || 0);
    const skipped  = parseInt(stats.skipped  || 0);
    const total    = executed + failed;
    const rate     = total > 0 ? `${(executed / total * 100).toFixed(1)}%` : '—';

    body.innerHTML = `
      <div class="trd-stats-grid">
        <div class="trd-stat-item">
          <div class="trd-stat-icon" style="background:rgba(16,185,129,0.1)">
            <i class="fa-solid fa-circle-check" style="color:var(--accent-green)"></i>
          </div>
          <div class="trd-stat-val" style="color:var(--accent-green)">
            ${executed.toLocaleString()}
          </div>
          <div class="trd-stat-lbl">Executed</div>
        </div>
        <div class="trd-stat-item">
          <div class="trd-stat-icon" style="background:rgba(239,68,68,0.1)">
            <i class="fa-solid fa-circle-xmark"
               style="color:${failed > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}"></i>
          </div>
          <div class="trd-stat-val"
               style="color:${failed > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">
            ${failed.toLocaleString()}
          </div>
          <div class="trd-stat-lbl">Failed</div>
        </div>
        <div class="trd-stat-item">
          <div class="trd-stat-icon" style="background:rgba(148,163,184,0.08)">
            <i class="fa-solid fa-forward" style="color:var(--text-muted)"></i>
          </div>
          <div class="trd-stat-val" style="color:var(--text-secondary)">
            ${skipped.toLocaleString()}
          </div>
          <div class="trd-stat-lbl">Skipped</div>
        </div>
        <div class="trd-stat-item">
          <div class="trd-stat-icon" style="background:rgba(59,130,246,0.1)">
            <i class="fa-solid fa-chart-pie" style="color:var(--accent-blue)"></i>
          </div>
          <div class="trd-stat-val" style="color:var(--accent-blue)">${rate}</div>
          <div class="trd-stat-lbl">Success Rate</div>
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // ORDER FORM — BINDINGS & LOGIC
  // ══════════════════════════════════════════════════════════
  function _bindOrderForm() {
    // BUY / SELL toggle
    document.querySelectorAll('.trd-side-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectedSide = btn.dataset.side;
        document.querySelectorAll('.trd-side-btn').forEach(b =>
          b.classList.remove('active'));
        btn.classList.add('active');
        _refreshSubmitBtn();
      });
    });

    // MKT / LMT toggle
    document.querySelectorAll('.trd-type-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _selectedType = btn.dataset.type;
        document.querySelectorAll('.trd-type-tab').forEach(b =>
          b.classList.remove('active'));
        btn.classList.add('active');
        const limRow = document.getElementById('trd-limit-row');
        if (limRow) {
          limRow.style.display = _selectedType === 'LMT' ? 'block' : 'none';
        }
      });
    });

    // Submit
    const form = document.getElementById('trd-order-form');
    if (form) {
      form.addEventListener('submit', e => {
        e.preventDefault();
        _submitOrder();
      });
    }

    // Symbol input: uppercase on input
    const symEl = document.getElementById('trd-sym-input');
    if (symEl) {
      symEl.addEventListener('input', () => {
        symEl.value = symEl.value.toUpperCase();
      });
    }
  }

  function _refreshSubmitBtn() {
    const btn    = document.getElementById('trd-submit-btn');
    if (!btn) return;
    const isBuy  = _selectedSide === 'BUY';
    btn.className = `trd-submit-btn ${isBuy ? 'buy' : 'sell'}`;
    btn.innerHTML = `
      <i class="fa-solid fa-${isBuy ? 'arrow-trend-up' : 'arrow-trend-down'}"></i>
      ${isBuy ? 'Submit Buy Order' : 'Submit Sell Order'}`;
    btn.disabled  = (_apiAvail === false);
  }

  async function _submitOrder() {
    const symEl = document.getElementById('trd-sym-input');
    const qtyEl = document.getElementById('trd-qty-input');
    const limEl = document.getElementById('trd-lim-input');

    const symbol   = (symEl?.value || '').trim().toUpperCase();
    const quantity = parseInt(qtyEl?.value || 0);
    const limitPx  = _selectedType === 'LMT' ? parseFloat(limEl?.value || 0) : null;

    // Validation
    if (!symbol) {
      AVUtils.showToast('Please enter a symbol', 'warn');
      symEl?.focus();
      return;
    }
    if (!quantity || quantity <= 0) {
      AVUtils.showToast('Please enter a valid quantity (> 0)', 'warn');
      qtyEl?.focus();
      return;
    }
    if (_selectedType === 'LMT' && (!limitPx || limitPx <= 0)) {
      AVUtils.showToast('Please enter a valid limit price', 'warn');
      limEl?.focus();
      return;
    }

    const account = _mode?.account || AV_CONFIG.ACCOUNT.paper;
    const isPaper = (_mode?.mode || 'paper') === 'paper';

    AVUtils.showModal({
      title: `Confirm ${_selectedSide} Order`,
      body: `
        <div class="trd-confirm-grid">
          <div class="trd-confirm-row">
            <span class="trd-confirm-lbl">Symbol</span>
            <strong class="trd-confirm-val">${symbol}</strong>
          </div>
          <div class="trd-confirm-row">
            <span class="trd-confirm-lbl">Side</span>
            <strong class="trd-confirm-val"
                    style="color:${_selectedSide === 'BUY'
                      ? 'var(--accent-green)'
                      : 'var(--accent-red)'}">
              ${_selectedSide}
            </strong>
          </div>
          <div class="trd-confirm-row">
            <span class="trd-confirm-lbl">Quantity</span>
            <strong class="trd-confirm-val">${quantity.toLocaleString()} shares</strong>
          </div>
          <div class="trd-confirm-row">
            <span class="trd-confirm-lbl">Type</span>
            <strong class="trd-confirm-val">
              ${_selectedType}${limitPx ? ` @ $${limitPx.toFixed(2)}` : ''}
            </strong>
          </div>
          <div class="trd-confirm-row">
            <span class="trd-confirm-lbl">Account</span>
            <strong class="trd-confirm-val">
              ${account}
              <span class="badge ${isPaper ? 'badge-green' : 'badge-red'}"
                    style="font-size:9px;margin-left:4px">
                ${isPaper ? 'PAPER' : '⚠ LIVE'}
              </span>
            </strong>
          </div>
        </div>`,
      confirmText: `${_selectedSide} ${quantity.toLocaleString()}x ${symbol}`,
      cancelText:  'Cancel',
      danger:      !isPaper,
      onConfirm:   () => _executeOrder({ symbol, quantity, limitPx }),
    });
  }

  async function _executeOrder({ symbol, quantity, limitPx }) {
    const btn = document.getElementById('trd-submit-btn');
    if (btn) {
      btn.disabled  = true;
      btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...`;
    }

    const payload = {
      symbol,
      action:     _selectedSide,
      quantity,
      order_type: _selectedType,
      ...(limitPx != null ? { limit_price: limitPx } : {}),
    };

    const result = await AVApi.callDashboardAPI('/orders', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });

    _refreshSubmitBtn();

    if (result?.ssh || result?.error) {
      AVUtils.showToast(
        result.ssh ? 'SSH tunnel required — order not sent' : `Error: ${result.error}`,
        'error'
      );
    } else {
      AVUtils.showToast(
        `✓ ${_selectedSide} ${quantity}x ${symbol} submitted`,
        'success'
      );
      // Reset form
      const symEl = document.getElementById('trd-sym-input');
      const qtyEl = document.getElementById('trd-qty-input');
      const limEl = document.getElementById('trd-lim-input');
      if (symEl) symEl.value = '';
      if (qtyEl) qtyEl.value = '';
      if (limEl) limEl.value = '';
      setTimeout(() => loadData(), 2_000);
    }
  }

  // ══════════════════════════════════════════════════════════
  // CONTROLS — Paper ↔ Live / Auto ↔ Manual
  // ══════════════════════════════════════════════════════════
  function _bindControls() {
    const switchBtn = document.getElementById('trd-switch-mode-btn');
    if (switchBtn) switchBtn.addEventListener('click', _handleSwitchMode);

    const autoBtn = document.getElementById('trd-auto-manual-btn');
    if (autoBtn)   autoBtn.addEventListener('click', _handleAutoManual);
  }

  function _handleSwitchMode() {
    if (_apiAvail === false) {
      AVUtils.showToast('SSH tunnel required to switch mode', 'warn');
      return;
    }

    const currentMode = _mode?.mode || 'paper';
    const isGoingLive = currentMode === 'paper';

    if (!isGoingLive) {
      // Live → Paper : 1 confirmation
      AVUtils.showModal({
        title:       'Switch to Paper Mode',
        body:        'Switch back to Paper Trading? Orders will be simulated only.',
        confirmText: '→ Switch to Paper',
        onConfirm:   () => _callSwitchMode('paper'),
      });
      return;
    }

    // Paper → Live : TRIPLE confirmation (R10 — argent réel)
    AVUtils.showModal({
      title:   '⚠ Switch to LIVE Trading',
      body:    `<div style="color:var(--accent-red);font-weight:700;font-size:14px;
                            margin-bottom:10px">
                  WARNING: Real money on account U21160314
                </div>
                <p style="font-size:13px;color:var(--text-secondary);margin:0">
                  All subsequent orders will be executed on the live IBKR account
                  with real funds. This cannot be undone instantly.
                </p>`,
      confirmText: 'I understand — Continue',
      cancelText:  'Cancel',
      danger:      true,
      onConfirm:   () => {
        // 2nd confirmation
        AVUtils.showModal({
          title:   '⚠ Second Confirmation — LIVE Mode',
          body:    `<p style="font-size:13px;color:var(--text-secondary);margin:0">
                     You are switching to <strong>LIVE trading</strong> on account
                     <strong>U21160314</strong>. Real money will be at risk.
                     Are you absolutely sure?
                   </p>`,
          confirmText: 'Yes, I am sure',
          cancelText:  'No, cancel',
          danger:      true,
          onConfirm:   () => {
            // 3rd and final confirmation
            AVUtils.showModal({
              title:   '🔴 Final Confirmation',
              body:    `<p style="font-size:13px;color:var(--text-secondary);margin:0">
                         <strong>This is your last chance to cancel.</strong><br><br>
                         Press "GO LIVE" to activate live trading with real funds.
                       </p>`,
              confirmText: '🔴 GO LIVE NOW',
              cancelText:  'Cancel',
              danger:      true,
              onConfirm:   () => _callSwitchMode('live'),
            });
          },
        });
      },
    });
  }

  async function _callSwitchMode(targetMode) {
    const btn = document.getElementById('trd-switch-mode-btn');
    if (btn) btn.disabled = true;

    const result = await AVApi.callDashboardAPI('/switch-mode', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'ALPHAVAULT_SWITCH_2026_SECRET',
      },
      body: JSON.stringify({ mode: targetMode, confirm: true }),
    });

    if (btn) btn.disabled = false;

    if (result?.error || result?.ssh) {
      AVUtils.showToast(`Switch failed: ${result.error || 'SSH required'}`, 'error');
    } else {
      AVUtils.showToast(`✓ Switched to ${targetMode.toUpperCase()} mode`, 'success');
      await loadData();
    }
  }

  async function _handleAutoManual() {
    if (_apiAvail === false) {
      AVUtils.showToast('SSH tunnel required to change trading mode', 'warn');
      return;
    }

    const isAuto    = _mode?.auto ?? true;
    const endpoint  = isAuto ? '/pause' : '/resume';
    const targetLbl = isAuto ? 'Manual (Pause)' : 'Auto (Resume)';

    AVUtils.showModal({
      title:       `Switch to ${targetLbl}`,
      body:        isAuto
        ? 'Pause automatic trading? The agent will stop placing new orders.'
        : 'Resume automatic trading? The agent will start placing orders again.',
      confirmText: `Switch to ${targetLbl}`,
      cancelText:  'Cancel',
      onConfirm:   async () => {
        const result = await AVApi.callDashboardAPI(endpoint, { method: 'POST' });
        if (result?.error) {
          AVUtils.showToast(`Failed: ${result.error}`, 'error');
        } else {
          AVUtils.showToast(`✓ Trading ${isAuto ? 'paused' : 'resumed'}`, 'success');
          await loadData();
        }
      },
    });
  }

  // ══════════════════════════════════════════════════════════
  // SKELETON
  // ══════════════════════════════════════════════════════════
  function _showSkeleton() {
    ['trd-kpi-netliq','trd-kpi-cash','trd-kpi-executed','trd-kpi-failed'].forEach(id => {
      _setHTML(id,
        `<span class="skeleton-line" style="width:90px;height:24px;display:block"></span>`);
    });

    const ordersBody = document.getElementById('trd-orders-body');
    if (ordersBody) {
      ordersBody.innerHTML = `
        <div class="trd-empty-state">
          <i class="fa-solid fa-circle-notch fa-spin"
             style="font-size:20px;color:var(--accent-blue);display:block;
                    margin-bottom:10px"></i>
          <div style="font-size:12px;color:var(--text-faint)">Loading orders...</div>
        </div>`;
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH (30s)
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    _timers.push(setInterval(async () => {
      try {
        const URLS = AV_CONFIG.SIGNAL_URLS;
        const [modeRes, execRes, ibkrRes, ordRes, portRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.mode,      0),
          AVApi.fetchJSON(URLS.execution, 0),
          AVApi.fetchJSON(URLS.ibkr,      0),
          AVApi.fetchJSON(URLS.orders,    0),
          AVApi.fetchJSON(URLS.portfolio, 0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _mode      = p(modeRes)  || _mode;
        _execution = p(execRes)  || _execution;
        _ibkr      = p(ibkrRes)  || _ibkr;
        _orders    = p(ordRes)   || _orders;
        _portfolio = p(portRes)  || _portfolio;
        renderAll();
      } catch (err) {
        console.warn('[av-trading] Refresh error:', err.message);
      }
    }, AV_CONFIG.REFRESH.execution));
  }

  // ══════════════════════════════════════════════════════════
  // PRE-FILL FROM URL — ?symbol=AAPL (depuis watchlist)
  // ══════════════════════════════════════════════════════════
  function _prefillFromURL() {
    try {
      const params = new URLSearchParams(window.location.search);
      const sym    = (params.get('symbol') || '').trim().toUpperCase();
      const side   = (params.get('side')   || 'BUY').toUpperCase();
      if (!sym) return;

      // Pré-remplit le symbole
      const symEl = document.getElementById('trd-sym-input');
      if (!symEl) return;
      symEl.value = sym;

      // Sélectionne BUY ou SELL
      const validSide = (side === 'SELL') ? 'SELL' : 'BUY';
      _selectedSide   = validSide;
      document.querySelectorAll('.trd-side-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.side === _selectedSide);
      });
      _refreshSubmitBtn();

      // Focus sur la quantité
      const qtyEl = document.getElementById('trd-qty-input');
      if (qtyEl) { qtyEl.focus(); qtyEl.select(); }

      // Toast informatif
      const sideColor = validSide === 'BUY' ? '#10b981' : '#ef4444';
      AVUtils.showToast(
        `<span style="color:${sideColor};font-weight:800">${validSide}</span>
         order pre-filled: <strong>${sym}</strong>`,
        'info',
        4500
      );

      // Nettoie l'URL pour éviter le re-prefill au refresh
      window.history.replaceState({}, '', window.location.pathname);
    } catch (e) {
      console.warn('[av-trading] _prefillFromURL error:', e.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS COMMUNS
  // ══════════════════════════════════════════════════════════
  function _bindThemeToggle() {
    const btn = document.getElementById('av-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => AVUtils.ThemeManager.toggle());
  }

  function _bindSidebar() {
    const toggler = document.getElementById('av-hamburger');
    const sidebar = document.getElementById('av-sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (toggler && sidebar) {
      toggler.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
      });
    }
    if (overlay && sidebar) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
      });
    }
  }

  function _updateSidebarStatus() {
    const dot   = document.getElementById('sb-ibkr-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');

    const connected = _execution?.ibkr_connected ?? false;
    const mode      = (_mode?.mode || 'paper').toUpperCase();
    const auto      = _mode?.auto ?? true;

    if (dot)   dot.className   = `av-status-dot ${connected ? 'green' : 'red'}`;
    if (label) label.textContent = `${mode} ${auto ? 'AUTO' : 'MANUAL'}`;
    if (sync && _execution?.timestamp) {
      sync.textContent = AVUtils.formatAge(_execution.timestamp);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._TradingCtrl = {
    destroy: () => _timers.forEach(clearInterval),
    refresh: () => loadData(),
  };

})();