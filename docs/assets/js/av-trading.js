// ============================================================
// av-trading.js — AlphaVault Quant Dashboard v1.0
// Terminal ordres : form, pending orders, order locks
// Dépend de : av-config.js, av-utils.js, av-api.js
// Règle R10 : API :5002 via SSH tunnel — gracieux si absent
// ============================================================

const AVTrading = (() => {

  let _apiAvailable = false;
  let _currentMode  = 'paper';
  let _isAuto       = false;

  // ══════════════════════════════════════════════════════════
  // CONNECTION STATUS BAR
  // ══════════════════════════════════════════════════════════

  function renderConnectionStatus(execStatus, ibkrStatus, modeData) {
    const container = document.getElementById('trading-connection-bar');
    if (!container) return;

    const connected = safeGet(execStatus, 'ibkr_connected', safeGet(ibkrStatus, 'connected', false));
    const auth      = safeGet(ibkrStatus, 'authenticated', false);
    const netliq    = sf(safeGet(execStatus, 'netliq', 0));
    const cash      = sf(safeGet(execStatus, 'available_cash', 0));
    const executed  = sf(safeGet(execStatus, 'stats.executed', 0));
    const failed    = sf(safeGet(execStatus, 'stats.failed',   0));
    const skipped   = sf(safeGet(execStatus, 'stats.skipped',  0));

    _currentMode = safeGet(modeData, 'mode',  'paper');
    _isAuto      = safeGet(modeData, 'auto',  false);
    const dryRun = safeGet(modeData, 'dry_run', true);
    const account= safeGet(modeData, 'account', AV_CONFIG.ACCOUNT.paper);

    const modeColor = _currentMode === 'live' ? '#ef4444' : '#10b981';
    const modeLabel = _currentMode.toUpperCase();

    container.innerHTML = `
      <div class="connection-status-grid">

        <div class="conn-item">
          <div class="conn-dot ${connected ? 'connected' : 'disconnected'}"></div>
          <div>
            <div class="conn-label">IBKR Connection</div>
            <div class="conn-value" style="color:${connected ? '#10b981' : '#ef4444'}">
              ${connected ? 'Connected' : 'Disconnected'}
              ${auth ? '' : '<span style="color:#f59e0b;font-size:10px"> — Not auth</span>'}
            </div>
          </div>
        </div>

        <div class="conn-item">
          <i class="fa-solid fa-server" style="color:${modeColor}"></i>
          <div>
            <div class="conn-label">Trading Mode</div>
            <div style="display:flex;align-items:center;gap:6px;margin-top:2px">
              <span class="mode-badge ${_currentMode === 'live' ? 'live' : 'paper'}">${modeLabel}</span>
              ${_isAuto ? `<span class="mode-badge auto">AUTO</span>` : `<span class="mode-badge manual">MANUAL</span>`}
              ${!dryRun ? `<span class="mode-badge live-orders">LIVE ORDERS</span>` : ''}
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${account}</div>
          </div>
        </div>

        <div class="conn-item">
          <i class="fa-solid fa-wallet" style="color:#3b82f6"></i>
          <div>
            <div class="conn-label">NetLiq / Cash</div>
            <div class="conn-value">${netliq > 0 ? formatCurrency(netliq, 0) : '--'}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:1px">
              Cash: ${cash > 0 ? formatCurrency(cash, 0) : '--'}
            </div>
          </div>
        </div>

        <div class="conn-item">
          <i class="fa-solid fa-chart-bar" style="color:#10b981"></i>
          <div>
            <div class="conn-label">Execution Stats</div>
            <div style="display:flex;gap:8px;margin-top:3px">
              <span style="font-size:11px;font-weight:700;color:#10b981">
                <i class="fa-solid fa-check" style="font-size:9px"></i> ${executed}
              </span>
              <span style="font-size:11px;font-weight:700;color:#ef4444">
                <i class="fa-solid fa-xmark" style="font-size:9px"></i> ${failed}
              </span>
              <span style="font-size:11px;color:var(--text-muted)">
                <i class="fa-solid fa-forward" style="font-size:9px"></i> ${skipped} skipped
              </span>
            </div>
          </div>
        </div>

      </div>

      ${!_apiAvailable ? `
        <div class="api-tunnel-notice">
          <i class="fa-solid fa-terminal" style="color:#f59e0b"></i>
          <div>
            <strong style="color:var(--text-primary)">Dashboard API unavailable</strong> — SSH tunnel required for order submission.
            <div style="font-size:10px;margin-top:3px;color:var(--text-muted);font-family:var(--font-mono)">
              ssh -i ~/ssh-key-2026-04-18.key -L 5002:localhost:5002 ubuntu@141.253.101.68
            </div>
          </div>
          <button class="btn-sm" onclick="AVTrading.retryAPICheck()">
            <i class="fa-solid fa-rotate"></i> Retry
          </button>
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // ORDER FORM
  // ══════════════════════════════════════════════════════════

  function initOrderForm() {
    const form = document.getElementById('order-form');
    if (!form) return;

    // Toggle BUY/SELL
    document.querySelectorAll('[data-side]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-side]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const side  = btn.dataset.side;
        const label = document.getElementById('order-submit-label');
        if (label) {
          label.textContent  = side === 'BUY' ? 'Submit BUY Order' : 'Submit SELL Order';
          const submitBtn    = document.getElementById('order-submit-btn');
          if (submitBtn) submitBtn.className = `btn-order ${side === 'BUY' ? 'buy' : 'sell'}`;
        }
      });
    });

    // Toggle MKT / LMT
    document.querySelectorAll('[data-order-type]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-order-type]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const limitRow = document.getElementById('limit-price-row');
        if (limitRow) {
          limitRow.style.display = btn.dataset.orderType === 'LMT' ? 'flex' : 'none';
        }
      });
    });

    // Autocomplete symbole depuis signals
    const symInput = document.getElementById('order-symbol');
    if (symInput) {
      symInput.addEventListener('input', AVUtils.debounce(e => {
        const val = e.target.value.toUpperCase().trim();
        _updateSymbolAutocomplete(val);
      }, 150));
      symInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault();
          document.getElementById('order-submit-btn')?.click();
        }
      });
    }

    // Submit
    const submitBtn = document.getElementById('order-submit-btn');
    if (submitBtn) {
      submitBtn.addEventListener('click', _submitOrder);
    }
  }

  function _updateSymbolAutocomplete(query) {
    if (!query || query.length < 1) return;
    const list = document.getElementById('symbol-autocomplete');
    if (!list) return;

    // Cherche dans les signaux cachés
    const signals = AVApi.getCached('signals');
    const sigs    = (signals?.signals || [])
      .filter(s => (s.symbol || '').startsWith(query))
      .slice(0, 6);

    if (!sigs.length) { list.style.display = 'none'; return; }

    list.innerHTML = sigs.map(s => `
      <div class="autocomplete-item" data-sym="${s.symbol}">
        <span style="font-weight:700">${s.symbol}</span>
        ${actionBadge(s.action)}
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">
          ${(sf(s.confidence) * 100).toFixed(1)}%
        </span>
      </div>`).join('');

    list.style.display = 'block';

    list.querySelectorAll('.autocomplete-item').forEach(item => {
      item.addEventListener('click', () => {
        const symInput = document.getElementById('order-symbol');
        if (symInput) symInput.value = item.dataset.sym;
        list.style.display = 'none';
      });
    });
  }

  async function _submitOrder() {
    // Récupère les champs
    const sym  = (document.getElementById('order-symbol')?.value || '').trim().toUpperCase();
    const qty  = parseInt(document.getElementById('order-qty')?.value || '0');
    const type = document.querySelector('[data-order-type].active')?.dataset.orderType || 'MKT';
    const side = document.querySelector('[data-side].active')?.dataset.side || 'BUY';
    const limit= sf(document.getElementById('order-limit-price')?.value || 0);

    // Validations
    if (!sym)         { showToast('Please enter a symbol', 'warn');          return; }
    if (qty <= 0)     { showToast('Quantity must be greater than 0', 'warn');return; }
    if (type === 'LMT' && limit <= 0) { showToast('Enter a limit price', 'warn'); return; }

    // Vérif API
    const available = await AVApi.checkDashboardAPI();
    if (!available) {
      showToast('Dashboard API unavailable — SSH tunnel required', 'error', 5000);
      _showTunnelInstructions();
      return;
    }

    // Confirmation modal (R10)
    const account = _currentMode === 'live' ? AV_CONFIG.ACCOUNT.live : AV_CONFIG.ACCOUNT.paper;
    const body    = `
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-muted)">Symbol:</span>
          <strong style="color:var(--text-primary)">${sym}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-muted)">Side:</span>
          <strong style="color:${side === 'BUY' ? '#10b981' : '#ef4444'}">${side}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-muted)">Quantity:</span>
          <strong>${qty.toLocaleString()}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-muted)">Type:</span>
          <strong>${type}${type === 'LMT' ? ` @ ${formatCurrency(limit)}` : ''}</strong>
        </div>
        <div style="display:flex;justify-content:space-between">
          <span style="color:var(--text-muted)">Account:</span>
          <strong style="color:${_currentMode === 'live' ? '#ef4444' : '#10b981'}">${account} (${_currentMode.toUpperCase()})</strong>
        </div>
      </div>`;

    showModal({
      title:       `Confirm ${side} Order`,
      body,
      confirmText: `Submit ${side}`,
      danger:      side === 'SELL' || _currentMode === 'live',
      onConfirm:   async () => {
        await _sendOrder({ symbol: sym, side, quantity: qty, order_type: type, limit_price: limit });
      },
    });
  }

  async function _sendOrder(order) {
    const submitBtn = document.getElementById('order-submit-btn');
    if (submitBtn) {
      submitBtn.disabled   = true;
      submitBtn.innerHTML  = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
    }

    try {
      const { data, error } = await AVApi.callDashboardAPI('/orders', {
        method: 'POST',
        body:   JSON.stringify(order),
      });

      if (error || !data) throw new Error(error || 'No response from API');

      showToast(`Order submitted: ${order.side} ${order.quantity}x ${order.symbol}`, 'success');
      _clearOrderForm();

    } catch (err) {
      showToast(`Order failed: ${err.message}`, 'error', 5000);
    } finally {
      if (submitBtn) {
        submitBtn.disabled  = false;
        const side = document.querySelector('[data-side].active')?.dataset.side || 'BUY';
        submitBtn.innerHTML = `<i class="fa-solid fa-paper-plane"></i> Submit ${side} Order`;
      }
    }
  }

  function _clearOrderForm() {
    const symInput = document.getElementById('order-symbol');
    const qtyInput = document.getElementById('order-qty');
    const limInput = document.getElementById('order-limit-price');
    if (symInput) symInput.value = '';
    if (qtyInput) qtyInput.value = '';
    if (limInput) limInput.value = '';
  }

  function setSide(side) {
    document.querySelectorAll('[data-side]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.side === side);
    });
  }

  function setSymbol(sym) {
    const input = document.getElementById('order-symbol');
    if (input) input.value = sym;
  }

  // ══════════════════════════════════════════════════════════
  // PENDING ORDERS TABLE
  // ══════════════════════════════════════════════════════════

  function renderPendingOrders(ordersData) {
    const container = document.getElementById('pending-orders-section');
    if (!container) return;

    const orders    = safeGet(ordersData, 'orders',    []);
    const processed = sf(safeGet(ordersData, 'processed', 0));

    if (!orders.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">
          <i class="fa-solid fa-inbox" style="font-size:18px;margin-bottom:8px;display:block;opacity:0.4"></i>
          No pending orders
          ${processed > 0 ? `<div style="margin-top:4px;font-size:11px">${processed.toLocaleString()} orders processed total</div>` : ''}
        </div>`;
      return;
    }

    container.innerHTML = `
      <table class="av-table" style="width:100%">
        <thead>
          <tr>
            <th>Symbol</th><th>Side</th><th style="text-align:right">Qty</th>
            <th>Type</th><th>Status</th><th style="text-align:right">Time</th>
          </tr>
        </thead>
        <tbody>
          ${orders.slice(0, 20).map(o => {
            const side  = (o.side || o.action || '').toUpperCase();
            const sColor= side === 'BUY' ? '#10b981' : '#ef4444';
            return `
              <tr>
                <td style="padding:8px 12px;font-weight:700;color:var(--text-primary)">${o.symbol || '--'}</td>
                <td style="padding:8px 12px">
                  <span style="font-size:11px;font-weight:700;padding:2px 8px;border-radius:4px;
                               background:${sColor}15;color:${sColor}">${side}</span>
                </td>
                <td style="padding:8px 12px;text-align:right;font-family:var(--font-mono);font-size:12px">
                  ${sf(o.quantity || o.qty || 0).toLocaleString()}
                </td>
                <td style="padding:8px 12px;font-size:11px;color:var(--text-muted)">
                  ${o.order_type || o.type || 'MKT'}
                </td>
                <td style="padding:8px 12px">
                  ${badgeHTML(o.status || 'Pending', 'blue')}
                </td>
                <td style="padding:8px 12px;text-align:right;font-size:11px;color:var(--text-muted)">
                  ${o.created_at ? formatAge(o.created_at) : '--'}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>
      ${processed > 0 ? `
        <div style="padding:8px 12px;font-size:10px;color:var(--text-muted);border-top:1px solid var(--border)">
          ${processed.toLocaleString()} orders processed total
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // ORDER LOCKS — Symboles verrouillés
  // ══════════════════════════════════════════════════════════

  function renderOrderLocks(execStatus) {
    const container = document.getElementById('order-locks-section');
    if (!container) return;

    const locks = safeGet(execStatus, 'order_locks', {});
    const qExit = sf(safeGet(execStatus, 'exit_queue_size',    0));
    const qReg  = sf(safeGet(execStatus, 'regular_queue_size', 0));
    const entries = Object.entries(locks);

    container.innerHTML = `
      <div class="section-header" style="margin-bottom:10px">
        <i class="fa-solid fa-lock" style="color:#f59e0b"></i>
        Order Locks — Active Symbols
        <span style="margin-left:auto;display:flex;gap:6px">
          ${badgeHTML(`Exit queue: ${qExit}`, qExit > 0 ? 'orange' : 'gray')}
          ${badgeHTML(`Normal queue: ${qReg}`, qReg > 0 ? 'blue' : 'gray')}
        </span>
      </div>
      ${!entries.length ? `
        <div style="font-size:12px;color:var(--text-muted);padding:8px;text-align:center">
          <i class="fa-solid fa-unlock" style="color:#10b981"></i> No symbols locked
        </div>` : `
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${entries.slice(0, 20).map(([sym, ts]) => `
            <div style="display:flex;align-items:center;gap:5px;padding:4px 10px;
                        background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);
                        border-radius:6px;cursor:pointer"
                 onclick="if(window.StockDetail) StockDetail.open('${sym}')"
                 title="Locked since: ${formatAge(ts)}">
              <i class="fa-solid fa-lock" style="color:#f59e0b;font-size:9px"></i>
              <span style="font-size:11px;font-weight:700;color:var(--text-primary)">${sym}</span>
              <span style="font-size:9px;color:var(--text-muted)">${formatAge(ts)}</span>
            </div>`).join('')}
        </div>`}`;
  }

  // ══════════════════════════════════════════════════════════
  // TUNNEL INSTRUCTIONS — Quand API non disponible (R10)
  // ══════════════════════════════════════════════════════════

  function _showTunnelInstructions() {
    showModal({
      title: 'SSH Tunnel Required',
      body: `
        <div style="font-size:13px;color:var(--text-muted);line-height:1.7">
          The Dashboard API runs on <code style="color:var(--accent-blue)">localhost:5002</code>
          on the Oracle A1 server. To access it from your browser:
        </div>
        <div style="margin-top:12px;padding:12px;background:var(--bg-secondary);border-radius:8px;
                    font-family:var(--font-mono);font-size:11px;color:var(--text-primary);
                    border:1px solid var(--border);word-break:break-all">
          ssh -i ~/ssh-key-2026-04-18.key -L 5002:localhost:5002 ubuntu@141.253.101.68
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text-muted)">
          Then refresh this page — order submission will be enabled automatically.
        </div>`,
      confirmText: null,
    });
  }

  async function retryAPICheck() {
    AVApi.invalidate('mode');
    _apiAvailable = await AVApi.checkDashboardAPI();
    const notice = document.querySelector('.api-tunnel-notice');
    if (notice && _apiAvailable) notice.remove();
    showToast(_apiAvailable ? 'Dashboard API connected' : 'API still unavailable', _apiAvailable ? 'success' : 'error');
  }

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════

  async function init() {
    _apiAvailable = await AVApi.checkDashboardAPI();
    initOrderForm();
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    init,
    renderConnectionStatus,
    renderPendingOrders,
    renderOrderLocks,
    retryAPICheck,
    setSide,
    setSymbol,
    isApiAvailable: () => _apiAvailable,
  };

})();

window.AVTrading = AVTrading;
console.log('[av-trading] Loaded — Order form | Pending orders | Locks | API tunnel R10');