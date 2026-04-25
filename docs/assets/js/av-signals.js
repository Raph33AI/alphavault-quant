// ============================================================
// av-signals.js — AlphaVault Quant Signals v1.0
// Controller pour signals.html
// Dépend : av-config.js, av-utils.js, av-api.js
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  let _signals    = null;   // current_signals.json
  let _weights    = null;   // strategy_weights.json
  let _allocation = null;   // capital_allocation.json
  let _regime     = null;   // regime.json

  let _allSigs      = [];   // Array normalisé
  let _filtered     = [];   // Après filter + sort
  let _currentFilter= 'ALL';
  let _highConfOnly = false;
  let _minConf      = 0;
  let _search       = '';
  let _sortField    = '_conf';
  let _sortDir      = 'desc';
  let _page         = 1;
  let _weightsChart = null;
  let _timers       = [];

  const PAGE_SIZE = 25;

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    AVUtils.setSidebarActive('signals');
    _bindThemeToggle();
    _bindSidebar();
    _bindFilters();
    _bindSortHeaders();

    _showSkeleton();
    await loadData();
    _startRefresh();

    console.log('[av-signals] v1.0 init complete');
  }

  // ══════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════
  async function loadData() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const [sigRes, wRes, allocRes, regRes] = await Promise.allSettled([
      AVApi.fetchJSON(URLS.signals,    0),
      AVApi.fetchJSON(URLS.weights,    0),
      AVApi.fetchJSON(URLS.allocation, 0),
      AVApi.fetchJSON(URLS.regime,     0),
    ]);
    const p = d => d.status === 'fulfilled' ? d.value : null;
    _signals    = p(sigRes);
    _weights    = p(wRes);
    _allocation = p(allocRes);
    _regime     = p(regRes);

    _allSigs = _buildSigs(_signals);
    _applyFilters();
    renderAll();
  }

  // Normalise les signaux pour uniformiser les champs
  function _buildSigs(data) {
    if (!Array.isArray(data?.signals)) return [];
    return data.signals.map(s => ({
      ...s,
      _conf:  parseFloat(s.confidence || 0),
      _price: parseFloat(s.price      || 0),
      _score: parseFloat(s.score || s.meta_score || s.final_score || s.confidence || 0),
    }));
  }

  function renderAll() {
    renderStatsBar();
    renderModelsBar();
    _renderPage();
    renderStrategyWeights();
    renderCapitalAllocation();
    _updateSidebarStatus();
  }

  // ══════════════════════════════════════════════════════════
  // STATS BAR
  // ══════════════════════════════════════════════════════════
  function renderStatsBar() {
    const nSigs    = _signals?.n_signals    || _allSigs.length || 0;
    const nBuy     = _signals?.n_buy        || 0;
    const nSell    = _signals?.n_sell       || 0;
    const nHC      = _signals?.n_high_conf  || 0;
    const nScanned = _signals?.n_scanned    || 0;
    const universe = _signals?.universe_size|| 0;
    const updAt    = _signals?.updated_at   || null;
    const buyT     = _signals?.buy_threshold   || 0.35;
    const sellT    = _signals?.sell_threshold  || 0.40;
    const hcGate   = _signals?.high_conf_gate  || 0.75;

    // Stat numbers
    _setText('sig-n-total',   nSigs.toLocaleString());
    _setText('sig-n-buy',     nBuy.toLocaleString());
    _setText('sig-n-sell',    nSell.toLocaleString());
    _setText('sig-n-hc',      nHC.toLocaleString());
    _setText('sig-n-scanned', nScanned > 0 ? `${nScanned} / ${universe}` : '—');

    // Last update
    _setHTML('sig-updated-at', updAt
      ? `<i class="fa-regular fa-clock" style="font-size:10px"></i> ${AVUtils.formatAge(updAt)}`
      : '—');

    // Thresholds badges
    _setHTML('sig-thresholds', `
      <span class="badge badge-green" style="font-size:9px">
        <i class="fa-solid fa-arrow-up" style="font-size:8px"></i> BUY &gt; ${buyT}
      </span>
      <span class="badge badge-red" style="font-size:9px">
        <i class="fa-solid fa-arrow-down" style="font-size:8px"></i> SELL &gt; ${sellT}
      </span>
      <span class="badge badge-gold" style="font-size:9px">
        <i class="fa-solid fa-star" style="font-size:8px"></i> HC &gt; ${hcGate}
      </span>`);

    // Regime badge
    const regime  = _regime?.regime || _regime?.signal || 'NEUTRAL';
    const rColors = AV_CONFIG.REGIME_COLORS[regime] || AV_CONFIG.REGIME_COLORS.NEUTRAL;
    _setHTML('sig-regime-badge', `
      <span style="font-size:10px;font-weight:700;padding:3px 10px;border-radius:var(--radius-full);
                   background:${rColors.soft};color:${rColors.bg};border:1px solid ${rColors.bg}40">
        <i class="fa-solid fa-circle" style="font-size:6px"></i> ${regime}
      </span>`);

    // Filtered count
    _setText('sig-filtered-count', `${_filtered.length} result${_filtered.length !== 1 ? 's' : ''}`);
  }

  function renderModelsBar() {
    const models = _signals?.models_active || {};
    const body   = document.getElementById('sig-models-bar');
    if (!body) return;

    const modelDefs = [
      { key: 'xgboost',  label: 'XGBoost',   auc: 0.7588 },
      { key: 'lightgbm', label: 'LightGBM',  auc: null   },
      { key: 'logistic', label: 'Logistic',  auc: null   },
      { key: 'meta',     label: 'Meta',      auc: null   },
    ];

    body.innerHTML = modelDefs.map(m => {
      const active = !!models[m.key];
      return `
        <div class="sig-model-chip ${active ? 'active' : 'inactive'}">
          <i class="fa-solid fa-${active ? 'circle-check' : 'circle-xmark'}"
             style="color:${active ? 'var(--accent-green)' : 'var(--text-faint)'}"></i>
          ${m.label}
          ${m.auc && active
            ? `<span style="font-size:9px;color:var(--accent-blue);font-weight:700">
                 AUC ${m.auc}
               </span>`
            : ''}
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // FILTER + SORT
  // ══════════════════════════════════════════════════════════
  function _applyFilters() {
    let list = [..._allSigs];

    // Action filter
    if (_currentFilter === 'BUY')  list = list.filter(s => s.action === 'BUY');
    if (_currentFilter === 'SELL') list = list.filter(s => s.action === 'SELL');

    // High conf toggle
    const hcGate = parseFloat(_signals?.high_conf_gate || 0.75);
    if (_highConfOnly) list = list.filter(s => s._conf >= hcGate);

    // Min conf slider
    if (_minConf > 0) list = list.filter(s => s._conf >= _minConf / 100);

    // Search symbol
    if (_search) {
      const q = _search.toUpperCase().trim();
      list = list.filter(s => (s.symbol || '').toUpperCase().includes(q));
    }

    // Sort
    list.sort((a, b) => {
      let va = a[_sortField];
      let vb = b[_sortField];
      if (typeof va === 'string') {
        return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      va = parseFloat(va || 0);
      vb = parseFloat(vb || 0);
      return _sortDir === 'asc' ? va - vb : vb - va;
    });

    _filtered = list;
    _page     = 1;
  }

  // ══════════════════════════════════════════════════════════
  // TABLE — RENDER PAGE
  // ══════════════════════════════════════════════════════════
  function _renderPage() {
    const tbody = document.getElementById('sig-tbody');
    if (!tbody) return;

    // Update count badge
    _setText('sig-filtered-count',
      `${_filtered.length} signal${_filtered.length !== 1 ? 's' : ''}`);

    const total = _filtered.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _page       = Math.min(_page, pages);
    const start = (_page - 1) * PAGE_SIZE;
    const slice = _filtered.slice(start, start + PAGE_SIZE);

    // Loading state
    if (!_signals) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:48px;color:var(--text-faint)">
            <i class="fa-solid fa-circle-notch fa-spin"
               style="font-size:22px;color:var(--accent-blue)"></i>
            <div style="margin-top:12px;font-size:12px">Loading signals...</div>
          </td>
        </tr>`;
      return;
    }

    // Empty state
    if (total === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center;padding:48px;color:var(--text-faint)">
            <i class="fa-solid fa-satellite-dish"
               style="font-size:28px;display:block;margin-bottom:12px;opacity:0.2"></i>
            No signals match the current filters
            <div style="margin-top:8px">
              <button class="btn btn-secondary btn-sm" onclick="window._SignalsCtrl.resetFilters()">
                <i class="fa-solid fa-rotate-left"></i> Reset filters
              </button>
            </div>
          </td>
        </tr>`;
      _renderPagination(1, 0);
      return;
    }

    const hcGate = parseFloat(_signals?.high_conf_gate || 0.75);

    tbody.innerHTML = slice
      .map((sig, i) => _renderRow(sig, start + i + 1, hcGate))
      .join('');

    _renderPagination(pages, total);
  }

  function _renderRow(sig, rowNum, hcGate) {
    const sym    = sig.symbol || '—';
    const action = sig.action || 'HOLD';
    const conf   = sig._conf;
    const price  = sig._price;
    const score  = sig._score;
    const isHC   = conf >= hcGate;
    const isBuy  = action === 'BUY';

    const confPct   = (conf * 100).toFixed(1);
    const confColor = conf >= 0.75 ? 'var(--accent-green)'
                    : conf >= 0.55 ? 'var(--accent-blue)'
                    : 'var(--accent-orange)';

    const logoHtml = typeof window._getLogoHtml === 'function'
      ? window._getLogoHtml(sym, 22)
      : `<span style="display:inline-flex;align-items:center;justify-content:center;
                      width:22px;height:22px;border-radius:5px;
                      background:var(--gradient-brand);color:#fff;
                      font-size:10px;font-weight:800;flex-shrink:0">
           ${sym.charAt(0)}
         </span>`;

    return `
      <tr class="sig-row${isHC ? ' sig-row-hc' : ''}"
          onclick="if(window.StockDetail) StockDetail.open('${sym}')"
          title="Open ${sym} detail">

        <!-- # -->
        <td style="padding:10px 8px;text-align:center;font-size:10px;
                   color:var(--text-faint);font-family:var(--font-mono);
                   width:40px">${rowNum}</td>

        <!-- Symbol + Logo -->
        <td style="padding:10px 14px">
          <div style="display:flex;align-items:center;gap:8px">
            ${logoHtml}
            <div>
              <div style="font-weight:700;font-size:13px;
                          color:var(--text-primary);line-height:1.2">${sym}</div>
              ${isHC
                ? `<div style="font-size:9px;color:#eab308;font-weight:700;letter-spacing:0.3px">
                     <i class="fa-solid fa-star" style="font-size:8px"></i> HIGH CONF
                   </div>`
                : `<div style="font-size:9px;color:var(--text-faint)">
                     <i class="fa-solid fa-chart-bar" style="font-size:8px"></i> Click detail
                   </div>`}
            </div>
          </div>
        </td>

        <!-- Action -->
        <td style="padding:10px 8px;text-align:center;width:80px">
          <span class="sig-action-badge ${isBuy ? 'buy' : 'sell'}">
            <i class="fa-solid fa-arrow-${isBuy ? 'up' : 'down'}" style="font-size:8px"></i>
            ${action}
          </span>
        </td>

        <!-- Confidence (progress bar) -->
        <td style="padding:10px 14px;min-width:150px">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="sig-conf-track">
              <div class="sig-conf-fill"
                   style="width:${confPct}%;background:${confColor}"></div>
            </div>
            <span style="font-size:11px;font-weight:700;font-family:var(--font-mono);
                         color:${confColor};min-width:38px;text-align:right">
              ${confPct}%
            </span>
          </div>
        </td>

        <!-- Price -->
        <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                   font-weight:600;color:var(--text-primary);text-align:right;white-space:nowrap">
          ${price > 0 ? `$${price.toFixed(2)}` : '—'}
        </td>

        <!-- Score -->
        <td style="padding:10px 12px;font-family:var(--font-mono);font-size:11px;
                   color:${confColor};font-weight:700;text-align:right">
          ${score > 0 ? score.toFixed(4) : '—'}
        </td>

        <!-- Status -->
        <td style="padding:10px 10px;text-align:center;width:70px">
          ${isHC
            ? `<span class="badge badge-gold" style="font-size:9px">
                 <i class="fa-solid fa-star" style="font-size:8px"></i> HIGH
               </span>`
            : `<span style="color:var(--text-faint);font-size:11px">—</span>`}
        </td>
      </tr>`;
  }

  // ══════════════════════════════════════════════════════════
  // PAGINATION
  // ══════════════════════════════════════════════════════════
  function _renderPagination(pages, total) {
    const container = document.getElementById('sig-pagination');
    if (!container) return;

    if (pages <= 1) {
      container.innerHTML = `
        <span style="font-size:11px;color:var(--text-faint)">
          ${total} signal${total !== 1 ? 's' : ''} &middot; Page 1/1
        </span>`;
      return;
    }

    const startP = Math.max(1, _page - 2);
    const endP   = Math.min(pages, startP + 4);

    container.innerHTML = `
      <button class="sig-page-btn" data-pg="prev" ${_page <= 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left" style="font-size:9px"></i>
      </button>
      ${Array.from({ length: endP - startP + 1 }, (_, i) => startP + i).map(p => `
        <button class="sig-page-btn ${p === _page ? 'active' : ''}"
                data-pg="${p}">${p}</button>`).join('')}
      <button class="sig-page-btn" data-pg="next" ${_page >= pages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right" style="font-size:9px"></i>
      </button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:8px">
        ${total} signals &middot; Page ${_page}/${pages}
      </span>`;

    container.querySelectorAll('.sig-page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.pg;
        if (pg === 'prev' && _page > 1)          _page--;
        else if (pg === 'next' && _page < pages) _page++;
        else if (!isNaN(parseInt(pg)))           _page = parseInt(pg);
        _renderPage();
        document.getElementById('sig-table-card')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // STRATEGY WEIGHTS CHART
  // ══════════════════════════════════════════════════════════
  function renderStrategyWeights() {
    const canvas = document.getElementById('sig-weights-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const w     = _weights?.weights || {};
    const trend = parseFloat(w.trend          || 0.55);
    const mr    = parseFloat(w.mean_reversion || 0.20);
    const vc    = parseFloat(w.vol_carry      || 0.15);
    const other = Math.max(0, parseFloat((1 - trend - mr - vc).toFixed(4)));

    const cycle  = _weights?.oracle_cycle || '—';
    const regime = _weights?.regime       || '—';

    _setHTML('sig-weights-meta', `
      <span class="badge badge-blue" style="font-size:9px">
        <i class="fa-solid fa-rotate" style="font-size:8px"></i> Cycle #${cycle}
      </span>
      <span class="badge badge-gray" style="font-size:9px">${regime}</span>`);

    const dark   = document.documentElement.getAttribute('data-theme') === 'dark';
    const colors = ['#3b82f6','#8b5cf6','#10b981','#94a3b8'];
    const labels = ['Trend', 'Mean Rev.', 'Vol Carry', 'Other'];
    const vals   = [trend, mr, vc, other];
    const data   = vals.map(v => Math.round(v * 100));

    if (_weightsChart) {
      _weightsChart.data.datasets[0].data = data;
      _weightsChart.update('none');
    } else {
      _weightsChart = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels,
          datasets: [{
            data,
            backgroundColor: colors.map(c => c + 'cc'),
            borderColor:     colors,
            borderWidth:     2,
            hoverOffset:     8,
          }],
        },
        options: {
          responsive:          true,
          maintainAspectRatio: false,
          cutout:              '68%',
          animation:           { duration: 600, easing: 'easeInOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: {
              backgroundColor: dark ? '#1e293b' : '#fff',
              borderColor:     dark ? '#334155' : '#e2e8f0',
              borderWidth:     1,
              titleColor:      dark ? '#f1f5f9' : '#0f172a',
              bodyColor:       dark ? '#94a3b8' : '#64748b',
              callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}%` },
            },
          },
        },
      });
    }

    // Légende
    const legendEl = document.getElementById('sig-weights-legend');
    if (legendEl) {
      legendEl.innerHTML = labels.map((l, i) => `
        <div class="sig-weight-item">
          <span class="sig-weight-dot" style="background:${colors[i]}"></span>
          <span class="sig-weight-label">${l}</span>
          <span class="sig-weight-pct">${data[i]}%</span>
        </div>`).join('');
    }
  }

  // ══════════════════════════════════════════════════════════
  // CAPITAL ALLOCATION
  // ══════════════════════════════════════════════════════════
  function renderCapitalAllocation() {
    const body = document.getElementById('sig-alloc-body');
    if (!body) return;

    const allocs  = _allocation?.allocations    || {};
    const nPos    = parseInt(_allocation?.n_positions       || 0);
    const total   = parseFloat(_allocation?.total_allocated || 0);
    const method  = _allocation?.method          || 'kelly_risk_parity';
    const hcGate  = parseFloat(_allocation?.high_conf_threshold || 0.75);
    const cashRes = parseFloat(_allocation?.cash_reserve_pct    || 5);
    const regime  = _allocation?.regime          || '—';
    const isEmpty = !allocs || Object.keys(allocs).length === 0;

    if (isEmpty) {
        body.innerHTML = `
        <div class="sig-alloc-empty">
            <div class="sig-alloc-empty-icon">
            <i class="fa-solid fa-clock" style="color:var(--accent-blue);font-size:20px"></i>
            </div>
            <div>
            <div class="sig-alloc-empty-title">Awaiting High Confidence Signals</div>
            <div class="sig-alloc-empty-sub">
                Activates when signal confidence &gt;
                <strong>${(hcGate * 100).toFixed(0)}%</strong>
            </div>
            </div>
        </div>
        <div class="sig-alloc-footer">
            <span class="badge badge-blue" style="font-size:9px">
            <i class="fa-solid fa-gear"></i> ${method.replace(/_/g, ' ')}
            </span>
            <span class="badge badge-gray" style="font-size:9px">
            <i class="fa-solid fa-piggy-bank"></i> Cash reserve: ${cashRes}%
            </span>
            <span class="badge badge-gray" style="font-size:9px">${regime}</span>
        </div>`;
        return;
    }

    // ── Parse les entrées depuis la structure réelle ──────────
    const entries = Object.entries(allocs)
        .map(([sym, raw]) => {
        const obj = (typeof raw === 'object' && raw !== null) ? raw : {};
        return {
            sym,
            action:        obj.action        || 'BUY',
            confidence:    parseFloat(obj.confidence    || 0),
            allocated_usd: parseFloat(obj.allocated_usd || 0),
            quantity:      parseInt(obj.quantity        || 0),
            price:         parseFloat(obj.price         || 0),
            kelly_fraction:parseFloat(obj.kelly_fraction|| 0),
            rp_weight:     parseFloat(obj.rp_weight     || 0),
        };
        })
        .filter(e => e.confidence > 0 || e.allocated_usd > 0)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 10);

    if (entries.length === 0) {
        body.innerHTML = `
        <div style="text-align:center;padding:20px;color:var(--text-faint);font-size:12px">
            No allocation data
        </div>`;
        return;
    }

    const fmtTotal = total > 0 ? AVUtils.formatCurrency(total) : '—';

    body.innerHTML = `
        <div class="sig-alloc-header-row">
        <span class="badge badge-green" style="font-size:10px">
            <i class="fa-solid fa-circle-check"></i>
            ${nPos || entries.length} allocated
        </span>
        <span class="badge badge-blue" style="font-size:10px">
            <i class="fa-solid fa-dollar-sign" style="font-size:9px"></i>
            ${fmtTotal}
        </span>
        <span class="badge badge-gray" style="font-size:9px;margin-left:auto">
            ${method.replace(/_/g, ' ')}
        </span>
        </div>

        <div class="sig-alloc-list">
        ${entries.map(e => {
            const { sym, action, confidence, allocated_usd, quantity, price, rp_weight } = e;

            const logoH = typeof window._getLogoHtml === 'function'
            ? window._getLogoHtml(sym, 22)
            : `<span style="display:inline-flex;align-items:center;justify-content:center;
                            width:22px;height:22px;border-radius:5px;background:var(--gradient-brand);
                            color:#fff;font-size:10px;font-weight:800;flex-shrink:0">
                ${sym.charAt(0)}
                </span>`;

            const confPct   = (confidence * 100).toFixed(1);
            const confColor = confidence >= 0.92 ? 'var(--accent-green)'
                            : confidence >= 0.80 ? 'var(--accent-blue)'
                            : 'var(--accent-orange)';

            const isBuy = (action || '').toUpperCase() === 'BUY';

            return `
            <div class="sig-alloc-entry">

                <!-- Col 1 : Logo + Symbole + Action -->
                <div class="sig-alloc-col-sym">
                ${logoH}
                <div style="min-width:0">
                    <div style="font-size:12px;font-weight:700;
                                color:var(--text-primary);line-height:1.2">${sym}</div>
                    <span class="sig-action-badge ${isBuy ? 'buy' : 'sell'}"
                        style="padding:1px 5px;font-size:9px;margin-top:2px">
                    <i class="fa-solid fa-arrow-${isBuy ? 'up' : 'down'}"
                        style="font-size:7px"></i> ${action}
                    </span>
                </div>
                </div>

                <!-- Col 2 : Confidence (barre) -->
                <div class="sig-alloc-col-conf">
                <div style="display:flex;align-items:center;gap:6px">
                    <div style="flex:1;height:4px;border-radius:2px;
                                background:rgba(148,163,184,0.15);overflow:hidden">
                    <div style="width:${confPct}%;height:100%;background:${confColor};
                                border-radius:2px;transition:width 0.4s ease"></div>
                    </div>
                    <span style="font-size:10px;font-weight:700;font-family:var(--font-mono);
                                color:${confColor};min-width:34px">${confPct}%</span>
                </div>
                <div style="font-size:9px;color:var(--text-faint);margin-top:2px">
                    Confidence
                </div>
                </div>

                <!-- Col 3 : Montant $ + Qty × Prix -->
                <div class="sig-alloc-col-usd">
                <div style="font-size:12px;font-weight:700;font-family:var(--font-mono);
                            color:var(--text-primary)">
                    ${allocated_usd > 0 ? AVUtils.formatCurrency(allocated_usd) : '—'}
                </div>
                <div style="font-size:9px;color:var(--text-faint);margin-top:2px;
                            white-space:nowrap">
                    ${quantity > 0
                    ? `${quantity.toLocaleString('en-US')} × $${price > 0 ? price.toFixed(2) : '—'}`
                    : '—'}
                </div>
                </div>

                <!-- Col 4 : RP Weight -->
                <div class="sig-alloc-col-rp">
                <div style="font-size:11px;font-weight:700;font-family:var(--font-mono);
                            color:var(--accent-violet)">
                    ${rp_weight > 0 ? `${(rp_weight * 100).toFixed(2)}%` : '—'}
                </div>
                <div style="font-size:9px;color:var(--text-faint);margin-top:2px">
                    RP Weight
                </div>
                </div>

            </div>`;
        }).join('')}
        </div>

        <div class="sig-alloc-footer">
        <span class="badge badge-gray" style="font-size:9px">
            <i class="fa-solid fa-piggy-bank"></i> Cash reserve: ${cashRes}%
        </span>
        <span class="badge badge-gray" style="font-size:9px">
            <i class="fa-solid fa-globe"></i> ${regime}
        </span>
        </div>`;
    }

  // ══════════════════════════════════════════════════════════
  // CSV EXPORT
  // ══════════════════════════════════════════════════════════
  function _exportCSV() {
    if (_filtered.length === 0) {
      AVUtils.showToast('No signals to export', 'warn');
      return;
    }
    const hcGate  = parseFloat(_signals?.high_conf_gate || 0.75);
    const headers = ['Symbol','Action','Confidence','Price','Score','High Conf'];
    const rows    = _filtered.map(s => [
      s.symbol || '',
      s.action || '',
      `${(s._conf * 100).toFixed(2)}%`,
      s._price > 0 ? s._price.toFixed(2) : '',
      s._score > 0 ? s._score.toFixed(4) : '',
      s._conf >= hcGate ? 'YES' : 'NO',
    ]);
    const csv  = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `alphavault-signals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    AVUtils.showToast(`Exported ${_filtered.length} signals`, 'success');
  }

  // ══════════════════════════════════════════════════════════
  // SKELETON
  // ══════════════════════════════════════════════════════════
  function _showSkeleton() {
    ['sig-n-total','sig-n-buy','sig-n-sell','sig-n-hc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<span class="skeleton-line"
                                     style="width:40px;height:24px;display:block"></span>`;
    });
    const tbody = document.getElementById('sig-tbody');
    if (tbody) {
      tbody.innerHTML = Array.from({ length: 8 }, () => `
        <tr>
          ${Array.from({ length: 7 }, () =>
            `<td style="padding:10px 14px">
               <span class="skeleton-line" style="height:14px;display:block;border-radius:4px"></span>
             </td>`).join('')}
        </tr>`).join('');
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH (60s)
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    _timers.push(setInterval(async () => {
      try {
        const [sigRes, wRes, allocRes, regRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.signals,    0),
          AVApi.fetchJSON(URLS.weights,    0),
          AVApi.fetchJSON(URLS.allocation, 0),
          AVApi.fetchJSON(URLS.regime,     0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _signals    = p(sigRes)    || _signals;
        _weights    = p(wRes)      || _weights;
        _allocation = p(allocRes)  || _allocation;
        _regime     = p(regRes)    || _regime;
        _allSigs    = _buildSigs(_signals);
        _applyFilters();
        renderAll();
      } catch (err) {
        console.warn('[av-signals] Refresh error:', err.message);
      }
    }, AV_CONFIG.REFRESH.signals));
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS
  // ══════════════════════════════════════════════════════════
  function _bindFilters() {
    // Tabs ALL / BUY / SELL
    document.querySelectorAll('.sig-filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _currentFilter = btn.dataset.filter;
        document.querySelectorAll('.sig-filter-tab').forEach(b =>
          b.classList.remove('active'));
        btn.classList.add('active');
        _applyFilters();
        _renderPage();
      });
    });

    // High conf toggle
    const hcBtn = document.getElementById('sig-hc-btn');
    if (hcBtn) {
      hcBtn.addEventListener('click', () => {
        _highConfOnly = !_highConfOnly;
        hcBtn.classList.toggle('active', _highConfOnly);
        _applyFilters();
        _renderPage();
      });
    }

    // Search
    const searchEl = document.getElementById('sig-search');
    if (searchEl) {
      searchEl.addEventListener('input', AVUtils.debounce(() => {
        _search = searchEl.value.trim();
        _applyFilters();
        _renderPage();
      }, 200));
    }

    // Slider confidence
    const slider    = document.getElementById('sig-conf-slider');
    const sliderLbl = document.getElementById('sig-slider-val');
    if (slider) {
      slider.addEventListener('input', () => {
        _minConf = parseInt(slider.value);
        if (sliderLbl) sliderLbl.textContent = _minConf === 0 ? 'All' : `${_minConf}%`;
        _applyFilters();
        _renderPage();
      });
    }

    // Sort select
    const sortSel = document.getElementById('sig-sort-sel');
    if (sortSel) {
      sortSel.addEventListener('change', () => {
        const val = sortSel.value;
        const map = {
          'conf_desc':  { f: '_conf',   d: 'desc' },
          'conf_asc':   { f: '_conf',   d: 'asc'  },
          'score_desc': { f: '_score',  d: 'desc' },
          'price_desc': { f: '_price',  d: 'desc' },
          'price_asc':  { f: '_price',  d: 'asc'  },
          'symbol_asc': { f: 'symbol',  d: 'asc'  },
        };
        const opt = map[val] || map['conf_desc'];
        _sortField = opt.f;
        _sortDir   = opt.d;
        _applyFilters();
        _renderPage();
      });
    }

    // Export
    const exportBtn = document.getElementById('sig-export-btn');
    if (exportBtn) exportBtn.addEventListener('click', _exportCSV);
  }

  function _bindSortHeaders() {
    document.querySelectorAll('.sig-sort-th').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (_sortField === field) {
          _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          _sortField = field;
          _sortDir   = 'desc';
        }
        document.querySelectorAll('.sig-sort-th').forEach(h => {
          const ic = h.querySelector('.sort-icon');
          if (!ic) return;
          const isCurrent = h.dataset.sort === _sortField;
          ic.className = `sort-icon fa-solid fa-${
            isCurrent ? (_sortDir === 'desc' ? 'sort-down' : 'sort-up') : 'sort'
          } fa-xs`;
          ic.style.opacity = isCurrent ? '1' : '0.3';
        });
        _applyFilters();
        _renderPage();
      });
    });
  }

  function _bindThemeToggle() {
    const btn = document.getElementById('av-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      AVUtils.ThemeManager.toggle();
      if (_weightsChart) { _weightsChart.destroy(); _weightsChart = null; }
      renderStrategyWeights();
    });
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
        if (overlay) overlay.classList.remove('active');
      });
    }
  }

  // ── Sidebar status ─────────────────────────────────────────
  function _updateSidebarStatus() {
    const dot   = document.getElementById('sb-ibkr-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');
    if (dot)   dot.className = 'av-status-dot green';
    if (label) label.textContent = `${_allSigs.length} signals`;
    if (sync && _signals?.updated_at) {
      sync.textContent = AVUtils.formatAge(_signals.updated_at);
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

  window._SignalsCtrl = {
    destroy:      () => _timers.forEach(clearInterval),
    resetFilters: () => {
      _currentFilter = 'ALL';
      _highConfOnly  = false;
      _minConf       = 0;
      _search        = '';
      document.querySelectorAll('.sig-filter-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === 'ALL'));
      const hcBtn = document.getElementById('sig-hc-btn');
      if (hcBtn) hcBtn.classList.remove('active');
      const slider = document.getElementById('sig-conf-slider');
      if (slider) slider.value = 0;
      const sliderLbl = document.getElementById('sig-slider-val');
      if (sliderLbl) sliderLbl.textContent = 'All';
      const search = document.getElementById('sig-search');
      if (search) search.value = '';
      _applyFilters();
      _renderPage();
    },
  };

})();