// ============================================================
// av-portfolio.js — AlphaVault Quant Dashboard v1.0
// Portfolio : positions, risk gauges, PnL monitor
// Dépend de : av-config.js, av-utils.js, av-api.js, av-charts.js
// Règles : R1 (NetLiq), R2 (agents), R3 (shorts), R4 (avg_cost), R5 (VaR)
// ============================================================

const AVPortfolio = (() => {

  // ── State ─────────────────────────────────────────────────
  let _positions   = {};
  let _filter      = 'ALL';   // ALL | LONG | SHORT | PNL_POS | PNL_NEG
  let _sortBy      = 'market_value';
  let _sortDir     = 'desc';
  let _page        = 1;
  const PAGE_SIZE  = 20;
  let _searchQuery = '';

  // ══════════════════════════════════════════════════════════
  // KPI RISK ROW — 4 cartes en haut de portfolio.html
  // ══════════════════════════════════════════════════════════

  /**
   * Render les 4 KPI cards (NetLiq, Leverage, Drawdown, Risk Score)
   */
  function renderKPIRow(portfolio, risk) {
    const netliq  = netliqFromPortfolio(portfolio?.raw || portfolio) || 0;
    const lev     = safeGet(risk, 'leverage.current_leverage', safeGet(risk, 'current_leverage', 0));
    const isOver  = safeGet(risk, 'leverage.is_over_leveraged', false);
    const dd      = sf(safeGet(risk, 'drawdown.current', safeGet(risk, 'drawdown.current_drawdown', 0))) * 100;
    const ddMax   = sf(safeGet(risk, 'drawdown.threshold', 0.15)) * 100;
    const score   = sf(safeGet(risk, 'risk_score', 0));
    const pnl     = sf(safeGet(portfolio, 'unrealized_pnl', 0));
    const pnlPct  = netliq > 0 ? (pnl / netliq * 100) : 0;

    const scoreColor = score <= 25 ? '#10b981' : score <= 50 ? '#3b82f6' : score <= 75 ? '#f59e0b' : '#ef4444';
    const scoreLabel = score <= 25 ? 'Low' : score <= 50 ? 'Moderate' : score <= 75 ? 'High' : 'Critical';

    const kpis = [
      {
        icon:    'fa-wallet',
        label:   'Net Liquidation',
        value:   formatCurrency(netliq, 0),
        sub:     `Cash: ${formatCurrency(safeGet(portfolio, 'cash', 0), 0)}`,
        color:   '#3b82f6',
        note:    safeGet(portfolio, 'cash_pct', 0) > 1
                 ? badgeHTML('158% Cash — Normal (Margin)', 'blue', 'fa-circle-info')
                 : '',
      },
      {
        icon:    'fa-chart-pie',
        label:   'Unrealized PnL',
        value:   formatCurrency(pnl, 0),
        sub:     `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}% of NAV`,
        color:   pnl >= 0 ? '#10b981' : '#ef4444',
        note:    '',
      },
      {
        icon:    'fa-weight-scale',
        label:   'Leverage',
        value:   `${sf(lev).toFixed(3)}x`,
        sub:     `Max: ${AV_CONFIG.THRESHOLDS.maxLeverage}x`,
        color:   isOver ? '#f59e0b' : '#10b981',
        note:    isOver
                 ? badgeHTML(`Over-leveraged — reduce ${sf(safeGet(risk, 'leverage.reduce_by_pct', 0)).toFixed(1)}%`, 'orange', 'fa-triangle-exclamation')
                 : badgeHTML('Within limits', 'green', 'fa-check'),
      },
      {
        icon:    'fa-shield-halved',
        label:   'Risk Score',
        value:   `${score.toFixed(0)}/100`,
        sub:     scoreLabel,
        color:   scoreColor,
        note:    progressBar(score, scoreColor, 5),
      },
    ];

    const container = document.getElementById('portfolio-kpi-row');
    if (!container) return;

    container.innerHTML = kpis.map(k => `
      <div class="kpi-card" style="border-top:3px solid ${k.color}">
        <div class="kpi-card-header">
          <i class="fa-solid ${k.icon}" style="color:${k.color}"></i>
          <span class="kpi-label">${k.label}</span>
        </div>
        <div class="kpi-value" style="color:${k.color}">${k.value}</div>
        <div class="kpi-sub">${k.sub}</div>
        ${k.note ? `<div style="margin-top:8px">${k.note}</div>` : ''}
      </div>`).join('');
  }

  // ══════════════════════════════════════════════════════════
  // POSITIONS TABLE — 45 positions, filtres, tri, pagination
  // ══════════════════════════════════════════════════════════

  /**
   * Initialise les filtres et la recherche
   */
  function initPositionFilters(onFilter) {
    // Boutons filtres
    document.querySelectorAll('[data-pos-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-pos-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _filter = btn.dataset.posFilter;
        _page   = 1;
        onFilter();
      });
    });

    // En-têtes de tri
    document.querySelectorAll('[data-sort-col]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = th.dataset.sortCol;
        if (_sortBy === col) {
          _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          _sortBy  = col;
          _sortDir = 'desc';
        }
        _page = 1;
        onFilter();
        // Met à jour les icônes de tri
        document.querySelectorAll('[data-sort-col]').forEach(h => {
          const icon = h.querySelector('.sort-icon');
          if (icon) {
            icon.className = `sort-icon fa-solid ${
              h.dataset.sortCol === _sortBy
                ? (_sortDir === 'desc' ? 'fa-sort-down' : 'fa-sort-up')
                : 'fa-sort'
            }`;
          }
        });
      });
    });

    // Recherche
    const searchEl = document.getElementById('pos-search');
    if (searchEl) {
      searchEl.addEventListener('input', AVUtils.debounce(() => {
        _searchQuery = searchEl.value.trim().toUpperCase();
        _page = 1;
        onFilter();
      }, 200));
    }
  }

  /**
   * Filtre + trie les positions selon l'état courant
   * @param {object} positions — normalisées via AVUtils.formatPosition
   */
  function _getFilteredPositions(positions) {
    let list = Object.values(positions);

    // Filtre par type
    switch (_filter) {
      case 'LONG':    list = list.filter(p => !p.isShort); break;
      case 'SHORT':   list = list.filter(p =>  p.isShort); break;
      case 'PNL_POS': list = list.filter(p => p.pnl > 0);  break;
      case 'PNL_NEG': list = list.filter(p => p.pnl < 0);  break;
    }

    // Recherche symbole
    if (_searchQuery) {
      list = list.filter(p => p.symbol.includes(_searchQuery));
    }

    // Tri
    list.sort((a, b) => {
      let va, vb;
      switch(_sortBy) {
        case 'market_value': va = a.market_value; vb = b.market_value; break;
        case 'pnl':          va = a.pnl;          vb = b.pnl;          break;
        case 'pnl_pct':      va = a.pnl_pct;      vb = b.pnl_pct;      break;
        case 'symbol':       va = a.symbol;        vb = b.symbol;       break;
        default:             va = a.market_value;  vb = b.market_value;
      }
      if (typeof va === 'string') return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return _sortDir === 'asc' ? va - vb : vb - va;
    });

    return list;
  }

  /**
   * Render complet du tableau de positions
   * @param {object} positions — { SYM: {normalisé} }
   * @param {object} signalsMap — optionnel pour enrichir avec signal ML
   */
  function renderPositionsTable(positions, signalsMap = {}) {
    _positions = positions || {};
    const tbody = document.getElementById('positions-tbody');
    if (!tbody) return;

    const filtered = _getFilteredPositions(_positions);
    const total    = filtered.length;
    const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _page          = Math.min(_page, pages);
    const start    = (_page - 1) * PAGE_SIZE;
    const display  = filtered.slice(start, start + PAGE_SIZE);

    // Compteur
    const counterEl = document.getElementById('pos-count');
    if (counterEl) {
      counterEl.textContent = `${total} position${total !== 1 ? 's' : ''}`;
    }

    if (!display.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">
            <i class="fa-solid fa-inbox" style="font-size:20px;margin-bottom:8px;display:block;opacity:0.4"></i>
            No positions match the current filter.
          </td>
        </tr>`;
      _renderPagination(pages, total);
      return;
    }

    tbody.innerHTML = display.map(pos => {
      const sig       = signalsMap[pos.symbol] || null;
      const pnlPos    = pos.pnl >= 0;
      const pnlColor  = pnlPos ? 'var(--accent-green)' : 'var(--accent-red)';
      const pnlArrow  = pnlPos ? 'fa-arrow-up' : 'fa-arrow-down';
      const sideColor = pos.isShort ? '#ef4444' : '#10b981';
      const sideBg    = pos.isShort ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)';

      // Signal ML optionnel
      const sigHtml = sig
        ? `<span style="font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;
                        background:${sig.action === 'BUY' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};
                        color:${sig.action === 'BUY' ? '#10b981' : '#ef4444'}">
            <i class="fa-solid ${sig.action === 'BUY' ? 'fa-arrow-up' : 'fa-arrow-down'}" style="font-size:8px"></i>
            ${sig.action} ${(sf(sig.confidence) * 100).toFixed(0)}%
           </span>`
        : '<span style="color:var(--text-muted);font-size:11px">—</span>';

      return `
        <tr class="positions-row" data-sym="${pos.symbol}"
            style="cursor:pointer;transition:background 0.15s"
            onclick="if(window.StockDetail) StockDetail.open('${pos.symbol}')">
          <td style="padding:10px 12px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="sym-badge" style="font-weight:700;color:var(--text-primary);font-size:13px">
                ${pos.symbol}
              </span>
            </div>
          </td>
          <td style="padding:10px 12px">
            <span style="font-size:11px;font-weight:700;padding:3px 8px;border-radius:5px;
                         background:${sideBg};color:${sideColor}">
              <i class="fa-solid ${pos.isShort ? 'fa-arrow-down' : 'fa-arrow-up'}" style="font-size:9px"></i>
              ${pos.side}
            </span>
          </td>
          <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                     color:var(--text-primary);text-align:right">
            ${pos.quantity.toLocaleString('en-US')}
          </td>
          <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                     color:var(--text-primary);text-align:right">
            ${formatCurrency(pos.price, 2)}
          </td>
          <td style="padding:10px 12px;font-family:var(--font-mono);font-size:13px;
                     font-weight:700;text-align:right">
            ${formatCurrency(pos.market_value, 0)}
          </td>
          <td style="padding:10px 12px;text-align:right">
            <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;
                         color:${pnlColor}">
              <i class="fa-solid ${pnlArrow}" style="font-size:9px"></i>
              ${formatCurrency(pos.pnl, 0)}
            </span>
            <div style="font-size:10px;color:${pnlColor};margin-top:1px">
              ${pos.pnl_pct >= 0 ? '+' : ''}${sf(pos.pnl_pct).toFixed(2)}%
            </div>
          </td>
          <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                     color:var(--text-muted);text-align:right">
            ${pos.avg_cost}
          </td>
          <td style="padding:10px 12px">
            ${sigHtml}
          </td>
        </tr>`;
    }).join('');

    _renderPagination(pages, total);
  }

  function _renderPagination(pages, total) {
    const container = document.getElementById('positions-pagination');
    if (!container) return;

    if (pages <= 1) {
      container.innerHTML = `
        <span style="font-size:11px;color:var(--text-muted)">
          ${total} positions · Page 1/1
        </span>`;
      return;
    }

    const start = Math.max(1, _page - 2);
    const end   = Math.min(pages, start + 4);

    container.innerHTML = `
      <button class="page-btn" data-pg="prev" ${_page <= 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      ${Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => `
        <button class="page-btn ${p === _page ? 'active' : ''}" data-pg="${p}">${p}</button>
      `).join('')}
      <button class="page-btn" data-pg="next" ${_page >= pages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:4px">
        ${total} positions · Page ${_page}/${pages}
      </span>`;

    container.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.pg;
        if (pg === 'prev') { if (_page > 1) _page--; }
        else if (pg === 'next') { if (_page < pages) _page++; }
        else _page = parseInt(pg);
        renderPositionsTable(_positions);
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // PNL MONITOR CARDS
  // ══════════════════════════════════════════════════════════

  function renderPnLMonitor(pnlData) {
    const container = document.getElementById('pnl-monitor-cards');
    if (!container || !pnlData) return;

    const totalPnl  = sf(pnlData.total_pnl);
    const winRate   = sf(pnlData.win_rate);
    const winning   = sf(pnlData.winning);
    const losing    = sf(pnlData.losing);
    const nPos      = sf(pnlData.n_positions);
    const regime    = pnlData.regime || 'NEUTRAL';

    container.innerHTML = `
      <div class="pnl-stat-card" style="border-left:3px solid ${totalPnl >= 0 ? '#10b981' : '#ef4444'}">
        <div class="pnl-stat-icon">
          <i class="fa-solid fa-dollar-sign" style="color:${totalPnl >= 0 ? '#10b981' : '#ef4444'}"></i>
        </div>
        <div>
          <div class="pnl-stat-label">Total Unrealized PnL</div>
          <div class="pnl-stat-value" style="color:${totalPnl >= 0 ? '#10b981' : '#ef4444'}">
            ${totalPnl >= 0 ? '+' : ''}${formatCurrency(totalPnl, 0)}
          </div>
        </div>
      </div>

      <div class="pnl-stat-card" style="border-left:3px solid #3b82f6">
        <div class="pnl-stat-icon">
          <i class="fa-solid fa-percent" style="color:#3b82f6"></i>
        </div>
        <div>
          <div class="pnl-stat-label">Win Rate</div>
          <div class="pnl-stat-value" style="color:#3b82f6">${winRate.toFixed(1)}%</div>
          <div style="margin-top:4px">${progressBar(winRate, '#3b82f6', 4)}</div>
        </div>
      </div>

      <div class="pnl-stat-card" style="border-left:3px solid #10b981">
        <div class="pnl-stat-icon">
          <i class="fa-solid fa-trophy" style="color:#10b981"></i>
        </div>
        <div>
          <div class="pnl-stat-label">Win / Loss</div>
          <div class="pnl-stat-value">
            <span style="color:#10b981">${winning}W</span>
            <span style="color:var(--text-muted);font-size:14px"> / </span>
            <span style="color:#ef4444">${losing}L</span>
          </div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px">
            ${nPos} positions tracked
          </div>
        </div>
      </div>

      <div class="pnl-stat-card" style="border-left:3px solid ${AV_CONFIG.REGIME_COLORS[regime]?.bg || '#6b7280'}">
        <div class="pnl-stat-icon">
          <i class="fa-solid fa-globe" style="color:${AV_CONFIG.REGIME_COLORS[regime]?.bg || '#6b7280'}"></i>
        </div>
        <div>
          <div class="pnl-stat-label">Current Regime</div>
          <div class="pnl-stat-value">${regimeBadge(regime)}</div>
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // RISK GAUGES — Leverage, Drawdown, VaR, Correlation
  // ══════════════════════════════════════════════════════════

  function renderRiskGauges(risk) {
    if (!risk) return;

    // ── Leverage ──────────────────────────────────────────
    const levEl = document.getElementById('risk-leverage');
    if (levEl) {
      const lev    = sf(safeGet(risk, 'leverage.current_leverage', 0));
      const maxLev = sf(safeGet(risk, 'leverage.max_leverage', AV_CONFIG.THRESHOLDS.maxLeverage));
      const isOver = safeGet(risk, 'leverage.is_over_leveraged', false);
      const redPct = sf(safeGet(risk, 'leverage.reduce_by_pct', 0));
      const pct    = maxLev > 0 ? Math.min((lev / maxLev) * 100, 150) : 0;
      const color  = isOver ? '#f59e0b' : '#10b981';

      levEl.innerHTML = `
        <div class="risk-gauge-header">
          <div class="risk-gauge-label">
            <i class="fa-solid fa-weight-scale" style="color:${color}"></i>
            Leverage
          </div>
          ${isOver
            ? badgeHTML(`Over by ${redPct.toFixed(1)}%`, 'orange', 'fa-triangle-exclamation')
            : badgeHTML('Within limits', 'green', 'fa-check')}
        </div>
        <div class="risk-gauge-values">
          <span class="risk-gauge-current" style="color:${color}">${lev.toFixed(3)}x</span>
          <span class="risk-gauge-max">/ ${maxLev.toFixed(1)}x max</span>
        </div>
        ${progressBar(Math.min(pct, 100), color, 8)}
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
          ${isOver ? `Reduce positions by ${redPct.toFixed(1)}% to reach target` : 'Leverage within authorized range'}
        </div>`;
    }

    // ── Drawdown ──────────────────────────────────────────
    const ddEl = document.getElementById('risk-drawdown');
    if (ddEl) {
      const dd      = sf(safeGet(risk, 'drawdown.current',    safeGet(risk, 'drawdown.current_drawdown', 0))) * 100;
      const ddMax   = sf(safeGet(risk, 'drawdown.max_drawdown', 0)) * 100;
      const thresh  = sf(safeGet(risk, 'drawdown.threshold', AV_CONFIG.THRESHOLDS.maxDrawdown)) * 100;
      const peak    = sf(safeGet(risk, 'drawdown.portfolio_peak', 0));
      const breach  = safeGet(risk, 'drawdown.is_breached', false);
      const pct     = thresh > 0 ? Math.min((dd / thresh) * 100, 100) : 0;
      const color   = breach ? '#ef4444' : dd > thresh * 0.7 ? '#f59e0b' : '#10b981';

      ddEl.innerHTML = `
        <div class="risk-gauge-header">
          <div class="risk-gauge-label">
            <i class="fa-solid fa-arrow-trend-down" style="color:${color}"></i>
            Drawdown
          </div>
          ${breach
            ? badgeHTML('Threshold breached', 'red', 'fa-xmark')
            : badgeHTML(`${dd.toFixed(3)}% / ${thresh.toFixed(0)}% limit`, 'green', 'fa-check')}
        </div>
        <div class="risk-gauge-values">
          <span class="risk-gauge-current" style="color:${color}">${dd.toFixed(3)}%</span>
          <span class="risk-gauge-max">/ ${thresh.toFixed(0)}% limit</span>
        </div>
        ${progressBar(pct, color, 8)}
        <div style="display:flex;gap:12px;margin-top:6px;font-size:10px;color:var(--text-muted)">
          <span>Max DD: ${ddMax.toFixed(3)}%</span>
          ${peak > 0 ? `<span>Peak: ${formatCurrency(peak, 0)}</span>` : ''}
        </div>`;
    }

    // ── VaR / Sharpe (R5) ─────────────────────────────────
    const varEl = document.getElementById('risk-var');
    if (varEl) {
      const var95  = sf(safeGet(risk, 'var_metrics.var_95',   0));
      const var99  = sf(safeGet(risk, 'var_metrics.var_99',   0));
      const sharpe = sf(safeGet(risk, 'var_metrics.sharpe',   safeGet(risk, 'var_metrics.sharpe_ratio', 0)));
      const vol    = sf(safeGet(risk, 'var_metrics.volatility', 0));

      const metrics = [
        { label: 'VaR 95%',    value: var95,  format: v => `${(v * 100).toFixed(2)}%` },
        { label: 'VaR 99%',    value: var99,  format: v => `${(v * 100).toFixed(2)}%` },
        { label: 'Sharpe',     value: sharpe, format: v => v.toFixed(3) },
        { label: 'Volatility', value: vol,    format: v => `${(v * 100).toFixed(2)}%` },
      ];

      varEl.innerHTML = `
        <div class="risk-gauge-header">
          <div class="risk-gauge-label">
            <i class="fa-solid fa-chart-bar" style="color:#8b5cf6"></i>
            VaR &amp; Sharpe
          </div>
          ${badgeHTML('Insufficient History', 'blue', 'fa-clock')}
        </div>
        <div class="risk-var-grid">
          ${metrics.map(m => `
            <div class="risk-var-item">
              <div class="risk-var-label">${m.label}</div>
              <div class="risk-var-value">
                ${m.value === 0 ? varDisplay(0) : m.format(m.value)}
              </div>
            </div>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--text-muted);margin-top:6px">
          <i class="fa-solid fa-circle-info" style="color:#3b82f6"></i>
          Stats available after 30+ portfolio snapshots
        </div>`;
    }

    // ── Correlation ───────────────────────────────────────
    const corrEl = document.getElementById('risk-correlation');
    if (corrEl) {
      const maxCorr = sf(safeGet(risk, 'correlation.max_correlation', 0));
      const avgCorr = sf(safeGet(risk, 'correlation.avg_correlation', 0));
      const thresh  = sf(safeGet(risk, 'correlation.threshold', AV_CONFIG.THRESHOLDS.maxCorr));
      const isHigh  = safeGet(risk, 'correlation.is_high', false);
      const color   = isHigh ? '#f59e0b' : '#10b981';
      const pct     = thresh > 0 ? Math.min((maxCorr / thresh) * 100, 130) : 0;

      corrEl.innerHTML = `
        <div class="risk-gauge-header">
          <div class="risk-gauge-label">
            <i class="fa-solid fa-link" style="color:${color}"></i>
            Correlation
          </div>
          ${isHigh
            ? badgeHTML('High correlation', 'orange', 'fa-triangle-exclamation')
            : badgeHTML('Acceptable', 'green', 'fa-check')}
        </div>
        <div class="risk-gauge-values">
          <span class="risk-gauge-current" style="color:${color}">${maxCorr.toFixed(4)}</span>
          <span class="risk-gauge-max">max / ${thresh.toFixed(2)} limit</span>
        </div>
        ${progressBar(Math.min(pct, 100), color, 8)}
        <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
          Avg correlation: ${avgCorr.toFixed(4)}
        </div>`;
    }

    // ── Alerts ────────────────────────────────────────────
    const alertsEl = document.getElementById('risk-alerts');
    if (alertsEl) {
      const alerts = safeGet(risk, 'alerts', []);
      alertsEl.innerHTML = alerts.length
        ? alerts.map(a => `
            <div class="risk-alert-item">
              <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>
              <span>${typeof a === 'string' ? a : JSON.stringify(a)}</span>
            </div>`).join('')
        : `<div style="display:flex;align-items:center;gap:8px;color:#10b981;font-size:13px">
            <i class="fa-solid fa-circle-check"></i>
            <span>No active alerts</span>
           </div>`;
    }
  }

  // ══════════════════════════════════════════════════════════
  // TOP SHORT POSITIONS — Tableau top 10
  // ══════════════════════════════════════════════════════════

  function renderTopShorts(positions) {
    const container = document.getElementById('top-shorts-table');
    if (!container) return;

    const shorts = Object.values(positions || {})
      .filter(p => p.isShort)
      .sort((a, b) => b.market_value - a.market_value)
      .slice(0, 10);

    if (!shorts.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:12px">
          <i class="fa-solid fa-inbox" style="margin-right:6px"></i>No short positions
        </div>`;
      return;
    }

    const maxMV = shorts[0]?.market_value || 1;

    container.innerHTML = shorts.map((pos, i) => {
      const barW  = (pos.market_value / maxMV * 100).toFixed(1);
      const color = pos.pnl >= 0 ? '#10b981' : '#ef4444';

      return `
        <div class="top-short-row" onclick="if(window.StockDetail) StockDetail.open('${pos.symbol}')"
             style="cursor:pointer">
          <div class="top-short-rank">#${i + 1}</div>
          <div class="top-short-sym">${pos.symbol}</div>
          <div class="top-short-bar-wrap">
            <div class="top-short-bar" style="width:${barW}%;background:rgba(239,68,68,0.35)"></div>
          </div>
          <div class="top-short-mv" style="font-family:var(--font-mono);font-size:12px;font-weight:700">
            -${formatCurrency(pos.market_value, 0)}
          </div>
          <div class="top-short-pnl" style="color:${color};font-family:var(--font-mono);font-size:11px">
            ${pos.pnl >= 0 ? '+' : ''}${sf(pos.pnl_pct).toFixed(1)}%
          </div>
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    renderKPIRow,
    initPositionFilters,
    renderPositionsTable,
    renderPnLMonitor,
    renderRiskGauges,
    renderTopShorts,
    getFilter:   () => _filter,
    getPage:     () => _page,
    resetFilter: () => { _filter = 'ALL'; _page = 1; _searchQuery = ''; },
  };

})();

window.AVPortfolio = AVPortfolio;
console.log('[av-portfolio] Loaded — Positions | Risk gauges | PnL monitor | R1-R5');