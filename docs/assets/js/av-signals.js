// ============================================================
// av-signals.js — AlphaVault Quant Dashboard v1.0
// Signaux ML : table, filtres, stats, strategy weights, allocation
// Dépend de : av-config.js, av-utils.js, av-api.js, av-charts.js
// ============================================================

const AVSignals = (() => {

  // ── State ─────────────────────────────────────────────────
  let _signals     = [];
  let _filter      = 'ALL';      // ALL | BUY | SELL | HIGH_CONF
  let _minConf     = 0;
  let _searchQuery = '';
  let _sortBy      = 'confidence';
  let _sortDir     = 'desc';
  let _page        = 1;
  const PAGE_SIZE  = 25;

  // ══════════════════════════════════════════════════════════
  // STATS BAR — Métriques globales
  // ══════════════════════════════════════════════════════════

  function renderStatsBar(meta) {
    const container = document.getElementById('signals-stats-bar');
    if (!container || !meta) return;

    const models   = meta.models || {};
    const modelArr = Object.entries(models)
      .filter(([, v]) => v)
      .map(([k]) => k.replace('_model', '').toUpperCase());

    container.innerHTML = `
      <div class="stats-bar-grid">
        <div class="stat-pill">
          <i class="fa-solid fa-wave-square" style="color:#3b82f6"></i>
          <div>
            <div class="stat-pill-value">${sf(meta.n_signals).toLocaleString()}</div>
            <div class="stat-pill-label">Total Signals</div>
          </div>
        </div>

        <div class="stat-pill">
          <i class="fa-solid fa-arrow-up" style="color:#10b981"></i>
          <div>
            <div class="stat-pill-value" style="color:#10b981">${sf(meta.n_buy)}</div>
            <div class="stat-pill-label">BUY Signals</div>
          </div>
        </div>

        <div class="stat-pill">
          <i class="fa-solid fa-arrow-down" style="color:#ef4444"></i>
          <div>
            <div class="stat-pill-value" style="color:#ef4444">${sf(meta.n_sell)}</div>
            <div class="stat-pill-label">SELL Signals</div>
          </div>
        </div>

        <div class="stat-pill">
          <i class="fa-solid fa-star" style="color:#eab308"></i>
          <div>
            <div class="stat-pill-value" style="color:#eab308">${sf(meta.n_high_conf)}</div>
            <div class="stat-pill-label">High Conf (&gt;${(AV_CONFIG.THRESHOLDS.highConf * 100).toFixed(0)}%)</div>
          </div>
        </div>

        <div class="stat-pill">
          <i class="fa-solid fa-magnifying-glass" style="color:#8b5cf6"></i>
          <div>
            <div class="stat-pill-value">${sf(meta.n_scanned || meta.universe).toLocaleString()}</div>
            <div class="stat-pill-label">Universe Scanned</div>
          </div>
        </div>

        <div class="stat-pill stat-pill-wide">
          <i class="fa-solid fa-microchip" style="color:#6b7280"></i>
          <div>
            <div class="stat-pill-label" style="margin-bottom:3px">Active Models</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              ${modelArr.length
                ? modelArr.map(m => badgeHTML(m, 'blue')).join('')
                : badgeHTML('No models', 'gray')}
              ${!models.meta ? badgeHTML('Meta: absent', 'orange', 'fa-triangle-exclamation') : ''}
            </div>
          </div>
        </div>

        <div class="stat-pill stat-pill-wide">
          <i class="fa-solid fa-sliders" style="color:#6b7280"></i>
          <div>
            <div class="stat-pill-label" style="margin-bottom:3px">Thresholds</div>
            <div style="display:flex;gap:5px;flex-wrap:wrap">
              ${badgeHTML(`Buy: >${(sf(meta.thresholds?.buy || AV_CONFIG.THRESHOLDS.buyConf) * 100).toFixed(0)}%`, 'green')}
              ${badgeHTML(`Sell: >${(sf(meta.thresholds?.sell || AV_CONFIG.THRESHOLDS.sellConf) * 100).toFixed(0)}%`, 'red')}
              ${badgeHTML(`High: >${(sf(meta.thresholds?.high_conf || AV_CONFIG.THRESHOLDS.highConf) * 100).toFixed(0)}%`, 'gold')}
            </div>
          </div>
        </div>
      </div>

      ${meta.updated_at ? `
        <div style="font-size:10px;color:var(--text-muted);text-align:right;margin-top:4px">
          <i class="fa-solid fa-clock" style="font-size:9px"></i>
          Last scan: ${formatAge(meta.updated_at)}
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // FILTRES & SORT
  // ══════════════════════════════════════════════════════════

  function initFilters(onUpdate) {
    // Boutons filtres action
    document.querySelectorAll('[data-sig-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-sig-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _filter = btn.dataset.sigFilter;
        _page   = 1;
        onUpdate();
      });
    });

    // Slider confiance minimum
    const slider = document.getElementById('sig-conf-slider');
    const sliderVal = document.getElementById('sig-conf-val');
    if (slider) {
      slider.addEventListener('input', () => {
        _minConf = parseFloat(slider.value) / 100;
        if (sliderVal) sliderVal.textContent = `${slider.value}%`;
        _page = 1;
        onUpdate();
      });
    }

    // Recherche symbole
    const searchEl = document.getElementById('sig-search');
    if (searchEl) {
      searchEl.addEventListener('input', AVUtils.debounce(() => {
        _searchQuery = searchEl.value.trim().toUpperCase();
        _page = 1;
        onUpdate();
      }, 200));
    }

    // En-têtes tri
    document.querySelectorAll('[data-sig-sort]').forEach(th => {
      th.style.cursor = 'pointer';
      th.addEventListener('click', () => {
        const col = th.dataset.sigSort;
        if (_sortBy === col) {
          _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          _sortBy  = col;
          _sortDir = 'desc';
        }
        _page = 1;
        onUpdate();
      });
    });

    // Export CSV
    const exportBtn = document.getElementById('sig-export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => exportCSV());
    }
  }

  /**
   * Filtre + trie les signaux
   */
  function _getFiltered() {
    let list = [..._signals];

    // Filtre type
    switch (_filter) {
      case 'BUY':       list = list.filter(s => s.action === 'BUY');  break;
      case 'SELL':      list = list.filter(s => s.action === 'SELL'); break;
      case 'HIGH_CONF': list = list.filter(s => sf(s.confidence) >= AV_CONFIG.THRESHOLDS.highConf); break;
    }

    // Filtre confiance minimum
    if (_minConf > 0) {
      list = list.filter(s => sf(s.confidence) >= _minConf);
    }

    // Recherche
    if (_searchQuery) {
      list = list.filter(s => (s.symbol || '').includes(_searchQuery));
    }

    // Tri
    list.sort((a, b) => {
      let va, vb;
      switch (_sortBy) {
        case 'confidence': va = sf(a.confidence); vb = sf(b.confidence); break;
        case 'price':      va = sf(a.price);       vb = sf(b.price);      break;
        case 'score':      va = sf(a.score || a.final_score || a.confidence); vb = sf(b.score || b.final_score || b.confidence); break;
        case 'symbol':     va = a.symbol || '';    vb = b.symbol || '';   break;
        default:           va = sf(a.confidence); vb = sf(b.confidence);
      }
      if (typeof va === 'string') return _sortDir === 'asc' ? va.localeCompare(vb) : vb.localeCompare(va);
      return _sortDir === 'asc' ? va - vb : vb - va;
    });

    return list;
  }

  // ══════════════════════════════════════════════════════════
  // SIGNALS TABLE
  // ══════════════════════════════════════════════════════════

  function renderSignalsTable(signals) {
    _signals = signals || [];
    const tbody = document.getElementById('signals-tbody');
    if (!tbody) return;

    const filtered = _getFiltered();
    const total    = filtered.length;
    const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _page          = Math.min(_page, pages);
    const start    = (_page - 1) * PAGE_SIZE;
    const display  = filtered.slice(start, start + PAGE_SIZE);

    // Compteur résultats
    const countEl = document.getElementById('sig-results-count');
    if (countEl) {
      countEl.textContent = `${total.toLocaleString()} signal${total !== 1 ? 's' : ''}`;
    }

    if (!display.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:40px;color:var(--text-muted)">
            <i class="fa-solid fa-filter" style="font-size:18px;margin-bottom:8px;display:block;opacity:0.4"></i>
            No signals match the current filters.
          </td>
        </tr>`;
      _renderSigPagination(pages, total);
      return;
    }

    tbody.innerHTML = display.map((sig, idx) => {
      const sym      = sig.symbol || '?';
      const action   = (sig.action || 'HOLD').toUpperCase();
      const conf     = sf(sig.confidence);
      const price    = sf(sig.price);
      const score    = sf(sig.score || sig.final_score || sig.meta_score || conf);
      const isHigh   = conf >= AV_CONFIG.THRESHOLDS.highConf;
      const rowBg    = (start + idx) % 2 === 0 ? '' : 'background:rgba(148,163,184,0.03)';

      const actionBg    = action === 'BUY'
        ? 'rgba(16,185,129,0.12)'  : action === 'SELL'
        ? 'rgba(239,68,68,0.12)'   : 'rgba(107,114,128,0.12)';
      const actionColor = action === 'BUY'
        ? '#10b981'  : action === 'SELL'
        ? '#ef4444'  : '#6b7280';
      const actionIcon  = action === 'BUY'
        ? 'fa-arrow-up' : action === 'SELL'
        ? 'fa-arrow-down' : 'fa-minus';

      const scoreColor = score >= 0.85 ? '#10b981'
                       : score >= 0.75 ? '#3b82f6'
                       : score >= 0.60 ? '#f59e0b'
                       : '#6b7280';

      return `
        <tr style="${rowBg};cursor:pointer;transition:background 0.15s"
            onclick="if(window.StockDetail) StockDetail.open('${sym}')"
            class="sig-row">
          <td style="padding:10px 12px">
            <div style="display:flex;align-items:center;gap:6px">
              <span style="font-weight:700;font-size:13px;color:var(--text-primary)">${sym}</span>
              ${isHigh
                ? `<i class="fa-solid fa-star" style="color:#eab308;font-size:10px" title="High Confidence"></i>`
                : ''}
            </div>
          </td>
          <td style="padding:10px 12px">
            <span style="font-size:11px;font-weight:700;padding:3px 9px;border-radius:5px;
                         background:${actionBg};color:${actionColor}">
              <i class="fa-solid ${actionIcon}" style="font-size:9px"></i> ${action}
            </span>
          </td>
          <td style="padding:10px 14px;min-width:140px">
            ${AVCharts.confidenceBar(conf)}
          </td>
          <td style="padding:10px 12px;font-family:var(--font-mono);font-size:12px;
                     text-align:right;color:var(--text-primary)">
            ${price > 0 ? formatCurrency(price, 2) : '<span style="color:var(--text-muted)">--</span>'}
          </td>
          <td style="padding:10px 12px;text-align:right">
            <span style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:${scoreColor}">
              ${score.toFixed(4)}
            </span>
          </td>
          <td style="padding:10px 12px">
            ${isHigh
              ? badgeHTML('HIGH CONF', 'gold', 'fa-star')
              : conf >= 0.60
                ? badgeHTML('MEDIUM', 'blue')
                : badgeHTML('LOW', 'gray')}
          </td>
        </tr>`;
    }).join('');

    _renderSigPagination(pages, total);
  }

  function _renderSigPagination(pages, total) {
    const container = document.getElementById('signals-pagination');
    if (!container) return;

    if (pages <= 1) {
      container.innerHTML = `
        <span style="font-size:11px;color:var(--text-muted)">
          ${total} signal${total !== 1 ? 's' : ''} · Page 1/1
        </span>`;
      return;
    }

    const start = Math.max(1, _page - 2);
    const end   = Math.min(pages, start + 4);

    container.innerHTML = `
      <button class="page-btn" data-spg="prev" ${_page <= 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      ${Array.from({ length: end - start + 1 }, (_, i) => start + i).map(p => `
        <button class="page-btn ${p === _page ? 'active' : ''}" data-spg="${p}">${p}</button>
      `).join('')}
      <button class="page-btn" data-spg="next" ${_page >= pages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:4px">
        ${total} signals · Page ${_page}/${pages}
      </span>`;

    container.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.spg;
        if (pg === 'prev') { if (_page > 1) _page--; }
        else if (pg === 'next') { if (_page < pages) _page++; }
        else _page = parseInt(pg);
        renderSignalsTable(_signals);
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // STRATEGY WEIGHTS
  // ══════════════════════════════════════════════════════════

  function renderStrategyWeights(weightsData) {
    const container = document.getElementById('strategy-weights-section');
    if (!container || !weightsData) return;

    const w      = safeGet(weightsData, 'weights', {});
    const regime = safeGet(weightsData, 'regime', '--');
    const cycle  = safeGet(weightsData, 'oracle_cycle', '--');

    const rows = [
      { label: 'Trend Following',  key: 'trend',           color: '#3b82f6' },
      { label: 'Mean Reversion',   key: 'mean_reversion',  color: '#10b981' },
      { label: 'Vol Carry',        key: 'vol_carry',       color: '#8b5cf6' },
    ];

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-scale-balanced" style="color:#3b82f6"></i>
        Strategy Weights
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">
          Oracle cycle #${cycle}
        </span>
      </div>

      <div style="display:grid;grid-template-columns:1fr auto;gap:20px;align-items:center">

        <div style="display:flex;flex-direction:column;gap:12px">
          ${rows.map(r => {
            const val = sf(w[r.key] || 0);
            const pct = (val * 100).toFixed(1);
            return `
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:12px;color:var(--text-primary);font-weight:600">${r.label}</span>
                  <span style="font-size:12px;font-weight:700;font-family:var(--font-mono);color:${r.color}">${pct}%</span>
                </div>
                ${progressBar(parseFloat(pct), r.color, 7)}
              </div>`;
          }).join('')}

          <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
            <span style="font-size:10px;color:var(--text-muted)">Active regime:</span>
            ${regimeBadge(regime.toUpperCase())}
          </div>
        </div>

        <div style="width:120px;height:120px">
          <canvas id="strategy-donut-canvas"></canvas>
        </div>
      </div>`;

    setTimeout(() => {
      AVCharts.renderStrategyDonut('strategy-donut-canvas', w);
    }, 50);
  }

  // ══════════════════════════════════════════════════════════
  // CAPITAL ALLOCATION
  // ══════════════════════════════════════════════════════════

  function renderCapitalAllocation(allocData) {
    const container = document.getElementById('capital-allocation-section');
    if (!container) return;

    const allocs  = safeGet(allocData, 'allocations', {});
    const method  = safeGet(allocData, 'method',       'kelly_risk_parity');
    const regime  = safeGet(allocData, 'regime',        'NEUTRAL');
    const cashPct = sf(safeGet(allocData, 'cash_reserve_pct', 0.05)) * 100;
    const nPos    = sf(safeGet(allocData, 'n_positions', 0));
    const total   = sf(safeGet(allocData, 'total_allocated', 0));
    const isEmpty = !allocs || Object.keys(allocs).length === 0;

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-coins" style="color:#10b981"></i>
        Capital Allocation
        <span style="margin-left:auto">
          ${badgeHTML(method.replace(/_/g, ' ').toUpperCase(), 'blue')}
        </span>
      </div>

      ${isEmpty ? `
        <div style="text-align:center;padding:28px 20px">
          <i class="fa-solid fa-hourglass-half" style="font-size:24px;color:#3b82f6;margin-bottom:10px;display:block;opacity:0.7"></i>
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px">
            Awaiting High-Confidence Signal
          </div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.6">
            Capital allocation activates when signal confidence &gt; ${(AV_CONFIG.THRESHOLDS.highConf * 100).toFixed(0)}%.<br>
            Currently ${sf(nPos)} positions pending.
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">
            ${badgeHTML(`Regime: ${regime}`, 'blue')}
            ${badgeHTML(`Cash reserve: ${cashPct.toFixed(0)}%`, 'gray')}
          </div>
        </div>` : `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${Object.entries(allocs).slice(0, 10).map(([sym, val]) => {
            const pct  = sf(val) * 100;
            const color= pct > 10 ? '#3b82f6' : pct > 5 ? '#10b981' : '#6b7280';
            return `
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-weight:700;font-size:12px;min-width:55px;color:var(--text-primary)">${sym}</span>
                <div style="flex:1">${progressBar(pct, color, 6)}</div>
                <span style="font-size:11px;font-weight:700;font-family:var(--font-mono);color:${color};min-width:42px;text-align:right">${pct.toFixed(1)}%</span>
              </div>`;
          }).join('')}
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
            ${badgeHTML(`${nPos} positions`, 'blue')}
            ${badgeHTML(`Total: ${(total * 100).toFixed(1)}%`, 'green')}
            ${badgeHTML(`Cash reserve: ${cashPct.toFixed(0)}%`, 'gray')}
          </div>
        </div>`}`;
  }

  // ══════════════════════════════════════════════════════════
  // EXPORT CSV
  // ══════════════════════════════════════════════════════════

  function exportCSV() {
    const filtered = _getFiltered();
    if (!filtered.length) {
      showToast('No signals to export', 'warn');
      return;
    }

    const headers = ['Symbol', 'Action', 'Confidence', 'Price', 'Score', 'Status'];
    const rows    = filtered.map(s => [
      s.symbol || '',
      s.action  || '',
      sf(s.confidence).toFixed(4),
      sf(s.price).toFixed(2),
      sf(s.score || s.final_score || s.confidence).toFixed(4),
      sf(s.confidence) >= AV_CONFIG.THRESHOLDS.highConf ? 'HIGH' : 'NORMAL',
    ]);

    const csv     = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob    = new Blob([csv], { type: 'text/csv' });
    const url     = URL.createObjectURL(blob);
    const a       = document.createElement('a');
    a.href        = url;
    a.download    = `alphavault-signals-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filtered.length} signals`, 'success');
  }

  // ══════════════════════════════════════════════════════════
  // DASHBOARD — Top BUY signals (pour dashboard.html)
  // ══════════════════════════════════════════════════════════

  function renderTopBuySignals(signals, limit = 10) {
    const container = document.getElementById('top-signals-table');
    if (!container) return;

    const buys = (signals || [])
      .filter(s => s.action === 'BUY')
      .sort((a, b) => sf(b.confidence) - sf(a.confidence))
      .slice(0, limit);

    if (!buys.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-muted);font-size:12px">
          <i class="fa-solid fa-magnifying-glass" style="margin-right:6px"></i>
          No BUY signals at current thresholds.
        </div>`;
      return;
    }

    container.innerHTML = `
      <table class="av-table" style="width:100%">
        <thead>
          <tr>
            <th>Symbol</th>
            <th>Confidence</th>
            <th style="text-align:right">Price</th>
            <th style="text-align:right">Score</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          ${buys.map(sig => {
            const conf    = sf(sig.confidence);
            const isHigh  = conf >= AV_CONFIG.THRESHOLDS.highConf;
            const score   = sf(sig.score || sig.final_score || conf);
            return `
              <tr style="cursor:pointer" onclick="if(window.StockDetail) StockDetail.open('${sig.symbol}')">
                <td style="padding:8px 12px">
                  <div style="display:flex;align-items:center;gap:6px">
                    <span style="font-weight:700;color:var(--text-primary)">${sig.symbol}</span>
                    ${isHigh ? '<i class="fa-solid fa-star" style="color:#eab308;font-size:10px"></i>' : ''}
                  </div>
                </td>
                <td style="padding:8px 12px;min-width:130px">
                  ${AVCharts.confidenceBar(conf)}
                </td>
                <td style="padding:8px 12px;text-align:right;font-family:var(--font-mono);font-size:12px">
                  ${sf(sig.price) > 0 ? formatCurrency(sig.price, 2) : '--'}
                </td>
                <td style="padding:8px 12px;text-align:right;font-family:var(--font-mono);font-size:12px;
                           font-weight:700;color:${score >= 0.75 ? '#10b981' : '#3b82f6'}">
                  ${score.toFixed(4)}
                </td>
                <td style="padding:8px 12px">
                  ${isHigh ? badgeHTML('HIGH', 'gold', 'fa-star') : badgeHTML('NORMAL', 'blue')}
                </td>
              </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    renderStatsBar,
    renderSignalsTable,
    renderStrategyWeights,
    renderCapitalAllocation,
    renderTopBuySignals,
    initFilters,
    exportCSV,
    getFilter:   () => _filter,
    resetFilter: () => { _filter = 'ALL'; _page = 1; _searchQuery = ''; _minConf = 0; },
  };

})();

window.AVSignals = AVSignals;
console.log('[av-signals] Loaded — Table 255 signals | Stats bar | Filters | Export CSV | Allocation');