// ============================================================
// portfolio.js — AlphaVault Quant Portfolio v1.0
// Controller pour portfolio.html
// Dépend : av-config.js, av-utils.js, av-api.js
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  let _portfolio     = null;
  let _risk          = null;
  let _pnl           = null;
  let _positions     = [];        // Array parsé depuis positions{}
  let _filtered      = [];        // Après filter + sort
  let _currentFilter = 'ALL';
  let _currentSearch = '';
  let _sortField     = 'market_value_abs';
  let _sortDir       = 'desc';
  let _currentPage   = 1;
  let _compChart     = null;      // Chart.js composition donut
  let _refreshTimers = [];

  const PAGE_SIZE = 20;

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    AVUtils.setSidebarActive('portfolio');
    _bindThemeToggle();
    _bindSidebar();
    _bindFilterTabs();
    _bindSearch();
    _bindSortHeaders();

    _showSkeletons();

    await loadData();
    _startRefresh();

    console.log('[portfolio] v1.0 init complete');
  }

  // ══════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════
  async function loadData() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const [portRes, riskRes, pnlRes] = await Promise.allSettled([
      AVApi.fetchJSON(URLS.portfolio, 0),
      AVApi.fetchJSON(URLS.risk,      0),
      AVApi.fetchJSON(URLS.pnl,       0),
    ]);

    _portfolio = portRes.status === 'fulfilled' ? portRes.value : null;
    _risk      = riskRes.status === 'fulfilled' ? riskRes.value : null;
    _pnl       = pnlRes.status  === 'fulfilled' ? pnlRes.value  : null;

    _positions = _buildPositions(_portfolio);
    _applyFiltersAndSort();
    renderAll();
  }

  function renderAll() {
    renderKPIs();
    renderPnLMonitor();
    renderCompositionChart();
    _renderPositionPage();
    renderRiskGauges();
    renderAlerts();
    _updateSidebarStatus();
    _updateFilterStats();
  }

  // ══════════════════════════════════════════════════════════
  // POSITIONS — PARSE dict → array
  // ══════════════════════════════════════════════════════════
  function _buildPositions(data) {
    if (!data?.positions) return [];
    return Object.entries(data.positions).map(([symbol, pos]) => {
      const qty  = parseFloat(pos.quantity       ?? 0);
      const mval = parseFloat(pos.market_value   ?? 0);
      const pnl  = parseFloat(pos.unrealized_pnl ?? 0);
      const pct  = parseFloat(pos.pnl_pct        ?? 0);
      const price= parseFloat(pos.current_price  ?? 0);
      const cost = parseFloat(pos.avg_cost       ?? 0);
      // R3 : side déterminé par qty si absent
      const side = pos.side || (qty < 0 ? 'SHORT' : 'LONG');

      return {
        symbol,
        side,
        quantity:         qty,
        quantity_abs:     Math.abs(qty),
        market_value:     mval,
        market_value_abs: Math.abs(mval),
        unrealized_pnl:   pnl,
        pnl_pct:          pct,
        current_price:    price,
        avg_cost:         cost,   // R4 : si 0 → N/A à l'affichage
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  // FILTER + SORT
  // ══════════════════════════════════════════════════════════
  function _applyFiltersAndSort() {
    let list = [..._positions];

    // Filtre side / pnl
    switch (_currentFilter) {
      case 'LONG':  list = list.filter(p => p.side === 'LONG');  break;
      case 'SHORT': list = list.filter(p => p.side === 'SHORT'); break;
      case 'PNL+':  list = list.filter(p => p.unrealized_pnl > 0); break;
      case 'PNL-':  list = list.filter(p => p.unrealized_pnl < 0); break;
    }

    // Filtre recherche
    if (_currentSearch) {
      const q = _currentSearch.toUpperCase().trim();
      list = list.filter(p => p.symbol.includes(q));
    }

    // Tri
    list.sort((a, b) => {
      let va = a[_sortField] ?? 0;
      let vb = b[_sortField] ?? 0;
      if (typeof va === 'string') {
        return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      }
      return _sortDir === 'asc' ? va - vb : vb - va;
    });

    _filtered    = list;
    _currentPage = 1;
  }

  // ══════════════════════════════════════════════════════════
  // KPI CARDS (4)
  // ══════════════════════════════════════════════════════════
  function renderKPIs() {
    // ── R1 NetLiq ───────────────────────────────────────────
    const netliq   = AVUtils.netliqFromPortfolio(_portfolio);
    const cash = parseFloat(
    _portfolio?.cash
    ?? _portfolio?.cash_value
    ?? _portfolio?.Cash
    ?? _portfolio?.available_cash
    ?? 0
    );
    const cashPct  = netliq > 0 ? (cash / netliq * 100) : 0;
    const isMargin = cashPct > 100;  // R6 : > 100% = marge, NORMAL

    _setKpi('port-netliq', {
      val:      netliq !== null ? AVUtils.formatCurrencyFull(netliq) : '—',
      sub:      `<i class="fa-solid fa-coins" style="color:var(--accent-blue);font-size:9px"></i>
                 Cash: ${AVUtils.formatCurrencyFull(cash)}
                 <span class="badge badge-${isMargin ? 'info' : 'blue'}" style="font-size:9px">
                   ${cashPct.toFixed(0)}%${isMargin ? ' (Margin)' : ''}
                 </span>`,
      valColor: null,
    });

    // ── Leverage (R7) ────────────────────────────────────────
    const lev    = parseFloat(AVUtils.safeGet(_risk, 'leverage.current_leverage', 0));
    const overLev= AVUtils.safeGet(_risk, 'leverage.is_over_leveraged', false);
    const maxLev = parseFloat(AVUtils.safeGet(_risk, 'leverage.max_leverage', 1.0));
    const redBy  = parseFloat(AVUtils.safeGet(_risk, 'leverage.reduce_by_pct', 0));

    _setKpi('port-leverage', {
      val:      lev > 0 ? `${lev.toFixed(3)}x` : '—',
      sub:      overLev
        ? `<span class="badge badge-orange" style="font-size:9px">
             <i class="fa-solid fa-triangle-exclamation"></i>
             Over-leveraged — reduce ${(redBy*100).toFixed(0)}%
           </span>`
        : `<i class="fa-solid fa-circle-check" style="color:var(--accent-green)"></i>
           Within limit (max ${maxLev.toFixed(1)}x)`,
      valColor: overLev ? 'var(--accent-orange)' : null,
    });

    // Barre de progression levier
    const levFill = document.getElementById('port-lev-fill');
    if (levFill && lev > 0) {
      const pct = Math.min((lev / Math.max(maxLev, 1)) * 100, 130);
      levFill.style.width      = `${Math.min(pct, 100)}%`;
      levFill.style.background = overLev ? 'var(--gradient-red)' : 'var(--gradient-green)';
    }

    // ── Drawdown ─────────────────────────────────────────────
    const dd         = parseFloat(AVUtils.safeGet(_risk, 'drawdown.current_drawdown', 0));
    const maxDD      = parseFloat(AVUtils.safeGet(_risk, 'drawdown.threshold', 0.15));
    const ddBreached = AVUtils.safeGet(_risk, 'drawdown.is_breached', false);
    const ddPct      = (dd * 100).toFixed(2);
    const ddColor    = dd > 0.10 ? 'var(--accent-red)'
                     : dd > 0.05 ? 'var(--accent-orange)'
                     : 'var(--accent-green)';

    _setKpi('port-drawdown', {
      val:      `${ddPct}%`,
      sub:      ddBreached
        ? `<span class="badge badge-red" style="font-size:9px">
             <i class="fa-solid fa-hand"></i> DD Halt triggered
           </span>`
        : `<span style="color:${ddColor};font-size:10px;font-weight:600">
             ${dd <= 0.02 ? 'Healthy' : dd <= 0.07 ? 'Normal' : 'Caution'}
           </span>
           &nbsp;&middot;&nbsp;
           <span style="color:var(--text-faint);font-size:10px">
             Limit: ${(maxDD*100).toFixed(0)}%
           </span>`,
      valColor: ddColor,
    });

    // ── Risk Score ───────────────────────────────────────────
    const rScore  = parseFloat(AVUtils.safeGet(_risk, 'risk_score', 0));
    const rsColor = rScore === 0 ? 'var(--text-faint)'
                  : rScore < 30 ? 'var(--accent-green)'
                  : rScore < 60 ? 'var(--accent-orange)'
                  : 'var(--accent-red)';
    const rsLabel = rScore < 30 ? 'Low Risk' : rScore < 60 ? 'Moderate' : 'High Risk';

    _setKpi('port-riskscore', {
      val:      rScore > 0 ? `${rScore}/100` : '—',
      sub:      rScore > 0
        ? `<span class="badge" style="font-size:9px;background:${rsColor}18;
              color:${rsColor};border:1px solid ${rsColor}30">
             ${rsLabel}
           </span>
           <div class="av-progress-track" style="margin-top:6px;height:3px">
             <div class="av-progress-fill"
                  style="width:${rScore}%;background:${rsColor}"></div>
           </div>`
        : '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:9px"></i> Loading...',
      valColor: rScore > 0 ? rsColor : null,
    });
  }

  function _setKpi(id, { val, sub, valColor }) {
    const valEl = document.getElementById(`${id}-val`);
    const subEl = document.getElementById(`${id}-sub`);
    if (valEl) {
      valEl.innerHTML = val;
      valEl.style.color = valColor || '';
    }
    if (subEl) subEl.innerHTML = sub || '';
  }

  // ══════════════════════════════════════════════════════════
  // PNL MONITOR
  // ══════════════════════════════════════════════════════════
  function renderPnLMonitor() {
    const body = document.getElementById('port-pnl-body');
    if (!body) return;

    // ── PnL — somme positions si root = 0 ──────────────────
    let totalPnl = null;

    if (_pnl?.total_pnl_usd !== undefined &&
        _pnl?.total_pnl_usd !== null &&
        parseFloat(_pnl.total_pnl_usd) !== 0) {
        totalPnl = parseFloat(_pnl.total_pnl_usd);
    }
    if ((totalPnl === null || totalPnl === 0) &&
        _portfolio?.unrealized_pnl !== undefined &&
        parseFloat(_portfolio.unrealized_pnl) !== 0) {
        totalPnl = parseFloat(_portfolio.unrealized_pnl);
    }
    if ((totalPnl === null || totalPnl === 0) && _positions.length > 0) {
        totalPnl = _positions.reduce((sum, p) => sum + p.unrealized_pnl, 0);
    }
    totalPnl = parseFloat(totalPnl ?? 0);

    // ── Win/Loss — positions EN PREMIER (source fiable) ─────
    const winningFromPos = _positions.filter(p => p.unrealized_pnl > 0).length;
    const losingFromPos  = _positions.filter(p => p.unrealized_pnl < 0).length;
    const winRateFromPos = _positions.length > 0
        ? (winningFromPos / _positions.length * 100)
        : 0;

    // pnl_monitor en renfort uniquement si données > 0
    const winRate = parseFloat(_pnl?.win_rate) > 0
        ? parseFloat(_pnl.win_rate)
        : winRateFromPos;
    const winning = parseInt(_pnl?.winning) > 0
        ? parseInt(_pnl.winning)
        : winningFromPos;
    const losing  = parseInt(_pnl?.losing) > 0
        ? parseInt(_pnl.losing)
        : losingFromPos;
    const nPos    = parseInt(_pnl?.n_positions) > 0
        ? parseInt(_pnl.n_positions)
        : _positions.length;

    const regime  = _pnl?.current_regime || 'NEUTRAL';
    const rColors = AV_CONFIG.REGIME_COLORS[regime] || AV_CONFIG.REGIME_COLORS.NEUTRAL;

    // ── Suite rendu inchangée ────────────────────────────────
    const pnlColor = totalPnl > 0 ? 'var(--accent-green)'
                    : totalPnl < 0 ? 'var(--accent-red)'
                    : 'var(--text-primary)';
    const pnlSign  = totalPnl > 0 ? '+' : '';
    const pnlIcon  = totalPnl > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down';
    const wrColor  = winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-orange)';

    body.innerHTML = `
        <div class="port-pnl-grid">

        <!-- Total PnL -->
        <div class="port-pnl-card">
            <div class="port-pnl-label">
            <i class="fa-solid fa-chart-line" style="color:${pnlColor}"></i>
            Unrealized PnL
            </div>
            <div class="port-pnl-val" style="color:${pnlColor}">
            ${pnlSign}${AVUtils.formatCurrencyFull(totalPnl)}
            </div>
            <div class="port-pnl-sub">
            <i class="fa-solid ${pnlIcon}" style="color:${pnlColor}"></i>
            ${nPos} positions tracked
            </div>
        </div>

        <!-- Win Rate -->
        <div class="port-pnl-card">
            <div class="port-pnl-label">
            <i class="fa-solid fa-bullseye" style="color:${wrColor}"></i>
            Win Rate
            </div>
            <div class="port-pnl-val" style="color:${wrColor}">
            ${winRate.toFixed(1)}%
            </div>
            <div style="margin-top:10px">
            <div class="av-progress-track" style="height:6px">
                <div class="av-progress-fill"
                    style="width:${Math.min(winRate, 100)}%;
                            background:${winRate >= 50
                            ? 'var(--gradient-green)'
                            : 'linear-gradient(135deg,#f59e0b,#d97706)'}">
                </div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:4px;
                        font-size:9px;color:var(--text-faint)">
                <span>0%</span><span>50%</span><span>100%</span>
            </div>
            </div>
        </div>

        <!-- W/L Split -->
        <div class="port-pnl-card">
            <div class="port-pnl-label">
            <i class="fa-solid fa-scale-balanced" style="color:var(--accent-blue)"></i>
            Win / Loss Split
            </div>
            <div class="port-wl-split">
            <div class="port-wl-block win">
                <div class="port-wl-num">${winning}</div>
                <div class="port-wl-lbl">Winning</div>
            </div>
            <div class="port-wl-divider"></div>
            <div class="port-wl-block loss">
                <div class="port-wl-num">${losing}</div>
                <div class="port-wl-lbl">Losing</div>
            </div>
            </div>
            <div class="port-pnl-sub" style="margin-top:10px;justify-content:center">
            <span style="font-size:10px;font-weight:700;padding:2px 10px;
                        border-radius:var(--radius-full);
                        background:${rColors.soft};color:${rColors.bg};
                        border:1px solid ${rColors.bg}40">
                <i class="fa-solid fa-circle" style="font-size:6px"></i> ${regime}
            </span>
            </div>
        </div>

        </div>`;
    }

  // ══════════════════════════════════════════════════════════
  // COMPOSITION DONUT CHART (Long vs Short)
  // ══════════════════════════════════════════════════════════
  function renderCompositionChart() {
    const canvas = document.getElementById('port-comp-chart');
    if (!canvas || typeof Chart === 'undefined') return;

    const longMV  = _positions
      .filter(p => p.side === 'LONG')
      .reduce((s, p) => s + p.market_value_abs, 0);
    const shortMV = _positions
      .filter(p => p.side === 'SHORT')
      .reduce((s, p) => s + p.market_value_abs, 0);

    const total   = longMV + shortMV;
    const longPct = total > 0 ? ((longMV / total) * 100).toFixed(1) : 0;
    const shrtPct = total > 0 ? ((shortMV / total) * 100).toFixed(1) : 0;

    // Update labels
    const lbl = document.getElementById('port-comp-labels');
    if (lbl) {
      lbl.innerHTML = `
        <div class="port-comp-label">
          <span class="port-comp-dot" style="background:#10b981"></span>
          <span>Long ${longPct}%</span>
          <span style="color:var(--text-faint);font-size:10px">
            ${AVUtils.formatCurrency(longMV)}
          </span>
        </div>
        <div class="port-comp-label">
          <span class="port-comp-dot" style="background:#ef4444"></span>
          <span>Short ${shrtPct}%</span>
          <span style="color:var(--text-faint);font-size:10px">
            ${AVUtils.formatCurrency(shortMV)}
          </span>
        </div>`;
    }

    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    if (_compChart) {
      _compChart.data.datasets[0].data = [longMV, shortMV];
      _compChart.update('none');
      return;
    }

    _compChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels:   ['Long', 'Short'],
        datasets: [{
          data:            [longMV, shortMV],
          backgroundColor: ['rgba(16,185,129,0.85)', 'rgba(239,68,68,0.85)'],
          borderColor:     ['#10b981', '#ef4444'],
          borderWidth:     2,
          hoverOffset:     8,
        }],
      },
      options: {
        responsive:       true,
        maintainAspectRatio: false,
        cutout:           '72%',
        animation:        { duration: 600, easing: 'easeInOutQuart' },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: dark ? '#1e293b' : '#fff',
            borderColor:     dark ? '#334155' : '#e2e8f0',
            borderWidth:     1,
            titleColor:      dark ? '#f1f5f9' : '#0f172a',
            bodyColor:       dark ? '#94a3b8' : '#64748b',
            callbacks: {
              label: ctx => {
                const pct = total > 0 ? ((ctx.raw / total) * 100).toFixed(1) : 0;
                return ` ${ctx.label}: ${AVUtils.formatCurrency(ctx.raw)} (${pct}%)`;
              },
            },
          },
        },
      },
    });
  }

  // ══════════════════════════════════════════════════════════
  // POSITIONS TABLE — RENDER PAGE
  // ══════════════════════════════════════════════════════════
  function _renderPositionPage() {
    const tbody     = document.getElementById('port-positions-tbody');
    const countEl   = document.getElementById('port-filtered-count');
    if (!tbody) return;

    const total     = _filtered.length;
    const pages     = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _currentPage    = Math.min(_currentPage, pages);
    const start     = (_currentPage - 1) * PAGE_SIZE;
    const slice     = _filtered.slice(start, start + PAGE_SIZE);

    if (countEl) {
      countEl.textContent = `${total} result${total !== 1 ? 's' : ''}`;
    }

    if (!_portfolio) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center;padding:32px;color:var(--text-faint)">
            <i class="fa-solid fa-circle-notch fa-spin"
               style="font-size:20px;color:var(--accent-blue)"></i>
            <div style="margin-top:10px;font-size:12px">Loading positions...</div>
          </td>
        </tr>`;
      return;
    }

    if (total === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align:center;padding:32px;color:var(--text-faint)">
            <i class="fa-solid fa-filter"
               style="font-size:24px;display:block;margin-bottom:10px;opacity:0.25"></i>
            No positions match the current filter
          </td>
        </tr>`;
      _renderPagination(1, 0);
      return;
    }

    tbody.innerHTML = slice.map(pos => _renderPositionRow(pos)).join('');
    _renderPagination(pages, total);
  }

  function _renderPositionRow(pos) {
    const {
      symbol, side, quantity_abs, market_value_abs,
      unrealized_pnl, pnl_pct, current_price, avg_cost
    } = pos;

    const isShort  = side === 'SHORT';
    const pnlColor = unrealized_pnl > 0 ? 'var(--accent-green)'
                   : unrealized_pnl < 0 ? 'var(--accent-red)'
                   : 'var(--text-muted)';
    const pnlSign  = unrealized_pnl > 0 ? '+' : '';
    const pnlIcon  = unrealized_pnl > 0 ? 'fa-arrow-trend-up'
                   : unrealized_pnl < 0 ? 'fa-arrow-trend-down'
                   : 'fa-minus';
    const pctSign  = pnl_pct > 0 ? '+' : '';

    const logoHtml = typeof window._getLogoHtml === 'function'
      ? window._getLogoHtml(symbol, 24)
      : `<span style="display:inline-flex;align-items:center;justify-content:center;
                      width:24px;height:24px;border-radius:6px;
                      background:var(--gradient-brand);color:#fff;
                      font-size:11px;font-weight:800;flex-shrink:0">
           ${symbol.charAt(0)}
         </span>`;

    return `
      <tr class="port-pos-row" data-sym="${symbol}"
          onclick="if(window.StockDetail) StockDetail.open('${symbol}')"
          title="View ${symbol} detail">

        <!-- Symbol + Logo -->
        <td style="padding:10px 14px">
          <div style="display:flex;align-items:center;gap:9px">
            ${logoHtml}
            <div>
              <div style="font-weight:700;font-size:13px;
                          color:var(--text-primary);line-height:1.2">${symbol}</div>
              <div style="font-size:9px;color:var(--text-faint)">
                <i class="fa-solid fa-chart-bar" style="font-size:8px"></i> View detail
              </div>
            </div>
          </div>
        </td>

        <!-- Side (R3) -->
        <td style="padding:10px 8px;text-align:center">
          <span class="port-side-badge ${isShort ? 'short' : 'long'}">
            <i class="fa-solid fa-arrow-${isShort ? 'down' : 'up'}"
               style="font-size:8px"></i>
            ${side}
          </span>
        </td>

        <!-- Quantity (R3: abs()) -->
        <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                   font-weight:600;color:var(--text-primary);text-align:right">
          ${quantity_abs.toLocaleString('en-US')}
        </td>

        <!-- Market Value (R3: abs()) -->
        <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                   font-weight:600;color:var(--text-primary);text-align:right">
          ${market_value_abs > 0 ? AVUtils.formatCurrencyFull(market_value_abs) : '—'}
        </td>

        <!-- PnL $ -->
        <td style="padding:10px 12px;text-align:right">
          <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px;
                      font-family:var(--font-mono);font-size:12px;font-weight:700;
                      color:${pnlColor}">
            <i class="fa-solid ${pnlIcon}" style="font-size:9px"></i>
            ${pnlSign}${AVUtils.formatCurrencyFull(unrealized_pnl)}
          </div>
        </td>

        <!-- PnL % -->
        <td style="padding:10px 12px;font-size:11px;font-weight:700;
                   color:${pnlColor};text-align:right;font-family:var(--font-mono)">
          ${pctSign}${Math.abs(pnl_pct).toFixed(2)}%
        </td>

        <!-- Current Price -->
        <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                   color:var(--text-secondary);text-align:right">
          ${current_price > 0 ? `$${current_price.toFixed(2)}` : '—'}
        </td>

        <!-- Avg Cost (R4: 0 → N/A) -->
        <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                   color:var(--text-faint);text-align:right">
          ${AVUtils.avgCostDisplay(avg_cost)}
        </td>

        <!-- Action -->
        <td style="padding:10px 8px;text-align:center">
          <button class="btn btn-secondary btn-xs"
                  title="View ${symbol} detail"
                  onclick="event.stopPropagation();
                           if(window.StockDetail) StockDetail.open('${symbol}')">
            <i class="fa-solid fa-chart-bar"></i>
          </button>
        </td>
      </tr>`;
  }

  // ── Pagination ─────────────────────────────────────────────
  function _renderPagination(pages, total) {
    const container = document.getElementById('port-pagination');
    if (!container) return;

    if (pages <= 1) {
      container.innerHTML = `
        <span style="font-size:11px;color:var(--text-faint)">
          ${total} position${total !== 1 ? 's' : ''} &middot; Page 1/1
        </span>`;
      return;
    }

    const startP = Math.max(1, _currentPage - 2);
    const endP   = Math.min(pages, startP + 4);

    container.innerHTML = `
      <button class="port-page-btn" data-pg="prev"
              ${_currentPage <= 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left" style="font-size:9px"></i>
      </button>
      ${Array.from({ length: endP - startP + 1 }, (_, i) => startP + i).map(p => `
        <button class="port-page-btn ${p === _currentPage ? 'active' : ''}"
                data-pg="${p}">${p}</button>`).join('')}
      <button class="port-page-btn" data-pg="next"
              ${_currentPage >= pages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right" style="font-size:9px"></i>
      </button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:8px">
        ${total} positions &middot; Page ${_currentPage}/${pages}
      </span>`;

    container.querySelectorAll('.port-page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.pg;
        if (pg === 'prev' && _currentPage > 1)       _currentPage--;
        else if (pg === 'next' && _currentPage < pages) _currentPage++;
        else if (!isNaN(parseInt(pg)))                _currentPage = parseInt(pg);
        _renderPositionPage();
      });
    });
  }

  // ── Filter stats ───────────────────────────────────────────
  function _updateFilterStats() {
    const longPos  = _positions.filter(p => p.side === 'LONG').length;
    const shortPos = _positions.filter(p => p.side === 'SHORT').length;

    const t = document.getElementById('port-stat-total');
    const l = document.getElementById('port-stat-long');
    const s = document.getElementById('port-stat-short');
    if (t) t.innerHTML = `<i class="fa-solid fa-layer-group" style="font-size:9px"></i> ${_positions.length} positions`;
    if (l) l.innerHTML = `<i class="fa-solid fa-arrow-up" style="font-size:9px"></i> ${longPos} Long`;
    if (s) s.innerHTML = `<i class="fa-solid fa-arrow-down" style="font-size:9px"></i> ${shortPos} Short`;
  }

  // ══════════════════════════════════════════════════════════
  // RISK GAUGES (4 cartes)
  // ══════════════════════════════════════════════════════════
  function renderRiskGauges() {
    _renderLeverageGauge();
    _renderDrawdownGauge();
    _renderVaRCard();
    _renderCorrelationCard();
  }

  function _renderLeverageGauge() {
    const card = document.getElementById('risk-lev-card');
    if (!card) return;

    const lev     = parseFloat(AVUtils.safeGet(_risk, 'leverage.current_leverage', 0));
    const maxLev  = parseFloat(AVUtils.safeGet(_risk, 'leverage.max_leverage', 1.0));
    const overLev = AVUtils.safeGet(_risk, 'leverage.is_over_leveraged', false);
    const redBy   = parseFloat(AVUtils.safeGet(_risk, 'leverage.reduce_by_pct', 0));
    const pct     = maxLev > 0 ? Math.min((lev / maxLev) * 100, 100) : 0;

    card.innerHTML = `
      <div class="port-gauge-header">
        <i class="fa-solid fa-gauge-high" style="color:var(--accent-orange)"></i>
        Leverage
        <span class="badge badge-${overLev ? 'orange' : 'green'}" style="margin-left:auto;font-size:9px">
          <i class="fa-solid fa-${overLev ? 'triangle-exclamation' : 'check'}"></i>
          ${overLev ? 'Over-leveraged' : 'OK'}
        </span>
      </div>
      <div class="port-gauge-big-val" style="color:${overLev?'var(--accent-orange)':'var(--text-primary)'}">
        ${lev > 0 ? `${lev.toFixed(3)}x` : '—'}
      </div>
      <div class="port-gauge-track-lg">
        <div class="port-gauge-fill-lg"
             style="width:${pct}%;background:${overLev?'var(--gradient-red)':'var(--gradient-green)'}">
        </div>
        <div class="port-gauge-limit" style="left:${Math.min((1/Math.max(maxLev,1))*100,100)}%">
          <div class="port-gauge-limit-line"></div>
        </div>
      </div>
      <div class="port-gauge-labels-row">
        <span>0x</span>
        <span style="color:${overLev?'var(--accent-orange)':'var(--text-faint)'}">
          Max: ${maxLev.toFixed(1)}x
        </span>
      </div>
      ${overLev && redBy > 0 ? `
        <div class="port-risk-warning">
          <i class="fa-solid fa-circle-arrow-down"></i>
          Reduce exposure by ${(redBy*100).toFixed(1)}% to normalize
        </div>` : ''}`;
  }

  function _renderDrawdownGauge() {
    const card = document.getElementById('risk-dd-card');
    if (!card) return;

    const dd       = parseFloat(AVUtils.safeGet(_risk, 'drawdown.current_drawdown', 0));
    const maxDD    = parseFloat(AVUtils.safeGet(_risk, 'drawdown.threshold', 0.15));
    const peak     = parseFloat(AVUtils.safeGet(_risk, 'drawdown.portfolio_peak', 0));
    const breached = AVUtils.safeGet(_risk, 'drawdown.is_breached', false);
    const pct      = maxDD > 0 ? Math.min((dd / maxDD) * 100, 100) : 0;
    const ddColor  = breached ? 'var(--accent-red)'
                   : dd > 0.08 ? 'var(--accent-orange)'
                   : 'var(--accent-green)';

    card.innerHTML = `
      <div class="port-gauge-header">
        <i class="fa-solid fa-arrow-trend-down" style="color:var(--accent-blue)"></i>
        Drawdown
        <span class="badge badge-${breached ? 'red' : 'green'}" style="margin-left:auto;font-size:9px">
          <i class="fa-solid fa-${breached ? 'hand' : 'check'}"></i>
          ${breached ? 'Halted' : 'Safe'}
        </span>
      </div>
      <div class="port-gauge-big-val" style="color:${ddColor}">
        ${(dd * 100).toFixed(2)}%
      </div>
      <div class="port-gauge-track-lg">
        <div class="port-gauge-fill-lg"
             style="width:${pct}%;background:${breached?'var(--gradient-red)':dd>0.05?'linear-gradient(135deg,#f59e0b,#d97706)':'var(--gradient-green)'}">
        </div>
      </div>
      <div class="port-gauge-labels-row">
        <span>0%</span>
        <span>Threshold: ${(maxDD*100).toFixed(0)}%</span>
      </div>
      ${peak > 0 ? `
        <div style="margin-top:10px;display:flex;align-items:center;gap:6px;
                    font-size:11px;color:var(--text-faint)">
          <i class="fa-solid fa-mountain-sun" style="font-size:10px"></i>
          Portfolio Peak: <strong style="color:var(--text-secondary)">
            ${AVUtils.formatCurrencyFull(peak)}
          </strong>
        </div>` : ''}`;
  }

  function _renderVaRCard() {
    const card = document.getElementById('risk-var-card');
    if (!card) return;

    const var95  = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.var_95',      0));
    const var99  = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.var_99',      0));
    const sharpe = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.sharpe_ratio',0));
    const vol    = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.volatility',  0));
    const noData = var95 === 0 && sharpe === 0;   // R5

    card.innerHTML = `
      <div class="port-gauge-header">
        <i class="fa-solid fa-shield-halved" style="color:var(--accent-violet)"></i>
        VaR &amp; Sharpe
        ${noData ? `
          <span class="badge badge-info" style="margin-left:auto;font-size:9px"
                title="Requires 30+ portfolio snapshots">
            <i class="fa-solid fa-circle-info"></i> Insuff. History
          </span>` : ''}
      </div>
      <div class="port-var-grid">
        <div class="port-var-stat">
          <div class="port-var-lbl">VaR 95%</div>
          <div class="port-var-val" style="color:${noData?'var(--text-faint)':'var(--accent-red)'}">
            ${noData ? 'N/A' : `${(var95*100).toFixed(2)}%`}
          </div>
        </div>
        <div class="port-var-stat">
          <div class="port-var-lbl">VaR 99%</div>
          <div class="port-var-val" style="color:${noData?'var(--text-faint)':'var(--accent-red)'}">
            ${noData ? 'N/A' : `${(var99*100).toFixed(2)}%`}
          </div>
        </div>
        <div class="port-var-stat">
          <div class="port-var-lbl">Sharpe Ratio</div>
          <div class="port-var-val"
               style="color:${noData?'var(--text-faint)':sharpe>1?'var(--accent-green)':sharpe>0?'var(--accent-orange)':'var(--accent-red)'}">
            ${noData ? 'N/A' : sharpe.toFixed(3)}
          </div>
        </div>
        <div class="port-var-stat">
          <div class="port-var-lbl">Volatility</div>
          <div class="port-var-val" style="color:${noData?'var(--text-faint)':'var(--text-primary)'}">
            ${noData ? 'N/A' : `${(vol*100).toFixed(2)}%`}
          </div>
        </div>
      </div>
      ${noData ? `
        <div class="port-risk-info">
          <i class="fa-solid fa-clock" style="font-size:10px"></i>
          Statistics available after 30+ daily portfolio snapshots.
          System is collecting data each cycle.
        </div>` : ''}`;
  }

  function _renderCorrelationCard() {
    const card = document.getElementById('risk-corr-card');
    if (!card) return;

    const maxCorr = parseFloat(AVUtils.safeGet(_risk, 'correlation.max_correlation', 0));
    const avgCorr = parseFloat(AVUtils.safeGet(_risk, 'correlation.avg_correlation', 0));
    const isHigh  = AVUtils.safeGet(_risk, 'correlation.is_high', false);
    const thresh  = parseFloat(AVUtils.safeGet(_risk, 'correlation.threshold', 0.70));
    const fillPct = Math.min(maxCorr * 100, 100);
    const cColor  = isHigh ? 'var(--accent-orange)' : 'var(--accent-green)';

    card.innerHTML = `
      <div class="port-gauge-header">
        <i class="fa-solid fa-diagram-project" style="color:var(--accent-cyan)"></i>
        Correlation
        <span class="badge badge-${isHigh ? 'orange' : 'green'}" style="margin-left:auto;font-size:9px">
          <i class="fa-solid fa-${isHigh ? 'triangle-exclamation' : 'check'}"></i>
          ${isHigh ? 'High' : 'Normal'}
        </span>
      </div>
      <div class="port-gauge-big-val" style="color:${cColor}">
        ${maxCorr > 0 ? maxCorr.toFixed(4) : '—'}
        <span style="font-size:12px;font-weight:600;color:var(--text-muted);margin-left:4px">max</span>
      </div>
      <div class="port-gauge-track-lg" style="margin-top:12px">
        <div class="port-gauge-fill-lg"
             style="width:${fillPct}%;background:${isHigh?'var(--gradient-red)':'var(--gradient-green)'}">
        </div>
        <div class="port-gauge-limit" style="left:${thresh*100}%">
          <div class="port-gauge-limit-line"></div>
        </div>
      </div>
      <div class="port-gauge-labels-row">
        <span>0</span>
        <span>Threshold: ${thresh.toFixed(2)}</span>
        <span>1.0</span>
      </div>
      <div style="margin-top:10px;display:flex;align-items:center;gap:8px;
                  font-size:11px;color:var(--text-faint)">
        <i class="fa-solid fa-chart-scatter" style="font-size:10px"></i>
        Avg: <strong style="color:var(--text-secondary)">${avgCorr > 0 ? avgCorr.toFixed(4) : '—'}</strong>
      </div>
      ${isHigh ? `
        <div class="port-risk-warning">
          <i class="fa-solid fa-triangle-exclamation"></i>
          High correlation — consider diversifying positions
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // ALERTS
  // ══════════════════════════════════════════════════════════
  function renderAlerts() {
    const body = document.getElementById('port-alerts-body');
    if (!body) return;

    const alerts = AVUtils.safeGet(_risk, 'alerts', []);

    if (!alerts || alerts.length === 0) {
      body.innerHTML = `
        <div class="port-no-alerts">
          <i class="fa-solid fa-shield-check"
             style="font-size:22px;color:var(--accent-green)"></i>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-primary)">
              No active risk alerts
            </div>
            <div style="font-size:11px;color:var(--text-faint);margin-top:2px">
              All risk metrics within acceptable thresholds
            </div>
          </div>
          <span class="badge badge-green" style="margin-left:auto">
            <i class="fa-solid fa-circle-check"></i> System Healthy
          </span>
        </div>`;
      return;
    }

    body.innerHTML = alerts.map(alert => `
      <div class="port-alert-row">
        <i class="fa-solid fa-triangle-exclamation"
           style="color:var(--accent-orange);font-size:14px;flex-shrink:0"></i>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:700;color:var(--text-primary)">
            ${alert.type || alert.alert_type || 'Risk Alert'}
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${alert.message || JSON.stringify(alert)}
          </div>
        </div>
        <span class="badge badge-orange" style="font-size:9px;flex-shrink:0">Active</span>
      </div>`).join('');
  }

  // ══════════════════════════════════════════════════════════
  // SKELETONS
  // ══════════════════════════════════════════════════════════
  function _showSkeletons() {
    ['port-netliq','port-leverage','port-drawdown','port-riskscore'].forEach(id => {
      const el = document.getElementById(`${id}-val`);
      if (el) el.innerHTML = `<span class="skeleton-line"
                                     style="width:110px;height:26px;display:block"></span>`;
    });
  }

  // ══════════════════════════════════════════════════════════
  // SIDEBAR STATUS
  // ══════════════════════════════════════════════════════════
  function _updateSidebarStatus() {
    const dot   = document.getElementById('sb-ibkr-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');
    const mode  = _portfolio?.mode || 'paper';
    const upd   = _portfolio?.updated_at || null;

    if (dot)   { dot.className = 'av-status-dot green'; }
    if (label) { label.textContent = `${mode.toUpperCase()} — Portfolio`; }
    if (sync && upd) sync.textContent = AVUtils.formatAge(upd);
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH (30s)
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    const URLS = AV_CONFIG.SIGNAL_URLS;

    _refreshTimers.push(setInterval(async () => {
      try {
        const [portRes, riskRes, pnlRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.portfolio, 0),
          AVApi.fetchJSON(URLS.risk,      0),
          AVApi.fetchJSON(URLS.pnl,       0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _portfolio = p(portRes) || _portfolio;
        _risk      = p(riskRes) || _risk;
        _pnl       = p(pnlRes)  || _pnl;

        _positions = _buildPositions(_portfolio);
        _applyFiltersAndSort();
        renderAll();
      } catch (err) {
        console.warn('[Portfolio] Refresh error:', err.message);
      }
    }, AV_CONFIG.REFRESH.portfolio));
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS
  // ══════════════════════════════════════════════════════════
  function _bindFilterTabs() {
    document.querySelectorAll('.port-filter-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        _currentFilter = btn.dataset.filter;
        document.querySelectorAll('.port-filter-tab').forEach(b =>
          b.classList.remove('active'));
        btn.classList.add('active');
        _applyFiltersAndSort();
        _renderPositionPage();
      });
    });
  }

  function _bindSearch() {
    const input = document.getElementById('port-search');
    if (!input) return;
    input.addEventListener('input', AVUtils.debounce(() => {
      _currentSearch = input.value.trim();
      _applyFiltersAndSort();
      _renderPositionPage();
    }, 200));
  }

  function _bindSortHeaders() {
    document.querySelectorAll('.port-sort-th').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const field = th.dataset.sort;
        if (_sortField === field) {
          _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          _sortField = field;
          _sortDir   = 'desc';
        }
        // Update sort icons
        document.querySelectorAll('.port-sort-th').forEach(h => {
          const ic = h.querySelector('.sort-icon');
          if (!ic) return;
          ic.className = `sort-icon fa-solid fa-${
            h.dataset.sort === _sortField
              ? (_sortDir === 'desc' ? 'sort-down' : 'sort-up')
              : 'sort'
          } fa-xs`;
          ic.style.opacity = h.dataset.sort === _sortField ? '1' : '0.3';
        });
        _applyFiltersAndSort();
        _renderPositionPage();
      });
    });
  }

  function _bindThemeToggle() {
    const btn = document.getElementById('av-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      AVUtils.ThemeManager.toggle();
      // Redraw donut avec nouvelles couleurs
      if (_compChart) { _compChart.destroy(); _compChart = null; }
      renderCompositionChart();
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

  // ── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._PortfolioCtrl = { destroy: () => _refreshTimers.forEach(clearInterval) };

})();