// ============================================================
// av-regime.js — AlphaVault Quant Market Regime v1.0
// Controller pour regime.html
// Dépend : av-config.js, av-utils.js, av-api.js
// Sources : system_status.json, agent_decisions.json,
//           agents_health.json
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  let _system    = null;
  let _decisions = null;
  let _health    = null;
  let _timers    = [];

  // ── Régimes possibles ─────────────────────────────────────
  const REGIME_META = {
    trend_up: {
      key:      'trend_up',
      label:    'Trend Up',
      short:    'BULL',
      iconClass: 'fa-arrow-trend-up',
      bannerCls: 'rgm-banner-bull',
      iconCls:   'rgm-banner-icon-bull',
      dotCls:    'rgm-color-up',
      chipCls:   'rgm-chip-up',
      tickerCls: 'rgm-chip-ticker-up',
      cardCls:   'rgm-sector-card-bull',
      badgeCls:  'rgm-sector-badge-bull',
      dotClass:  'rgm-dot-up',
      desc: 'Markets are in a confirmed uptrend. Momentum is positive across the majority of monitored assets. The system favors long positions with higher size multipliers and increased risk tolerance.',
      color: 'var(--accent-green)',
      colorHex: '#10b981',
    },
    trend_down: {
      key:      'trend_down',
      label:    'Trend Down',
      short:    'BEAR',
      iconClass: 'fa-arrow-trend-down',
      bannerCls: 'rgm-banner-bear',
      iconCls:   'rgm-banner-icon-bear',
      dotCls:    'rgm-color-down',
      chipCls:   'rgm-chip-down',
      tickerCls: 'rgm-chip-ticker-down',
      cardCls:   'rgm-sector-card-bear',
      badgeCls:  'rgm-sector-badge-bear',
      dotClass:  'rgm-dot-down',
      desc: 'Markets are in a confirmed downtrend. Bearish pressure is dominant. The system reduces position sizes, tightens stop-losses, and increases short exposure where allowed.',
      color: 'var(--accent-red)',
      colorHex: '#ef4444',
    },
    NEUTRAL: {
      key:      'NEUTRAL',
      label:    'Neutral',
      short:    'NEUTRAL',
      iconClass: 'fa-minus',
      bannerCls: 'rgm-banner-neutral',
      iconCls:   'rgm-banner-icon-neutral',
      dotCls:    'rgm-color-neutral',
      chipCls:   'rgm-chip-neutral',
      tickerCls: 'rgm-chip-ticker-neutral',
      cardCls:   'rgm-sector-card-neutral',
      badgeCls:  'rgm-sector-badge-neutral',
      dotClass:  'rgm-dot-neutral',
      desc: 'Markets are in a consolidation or indecision phase. No clear directional bias. The system uses conservative sizing and prioritizes risk management over return generation.',
      color: 'var(--accent-blue)',
      colorHex: '#3b82f6',
    },
    BULL: {
      key:      'BULL',
      label:    'Bull Market',
      short:    'BULL',
      iconClass: 'fa-arrow-trend-up',
      bannerCls: 'rgm-banner-bull',
      iconCls:   'rgm-banner-icon-bull',
      dotCls:    'rgm-color-up',
      chipCls:   'rgm-chip-up',
      tickerCls: 'rgm-chip-ticker-up',
      cardCls:   'rgm-sector-card-bull',
      badgeCls:  'rgm-sector-badge-bull',
      dotClass:  'rgm-dot-up',
      desc: 'Sustained bull market conditions. Strong breadth and momentum. System operates at full capacity with elevated position sizing.',
      color: 'var(--accent-green)',
      colorHex: '#10b981',
    },
    BEAR: {
      key:      'BEAR',
      label:    'Bear Market',
      short:    'BEAR',
      iconClass: 'fa-arrow-trend-down',
      bannerCls: 'rgm-banner-bear',
      iconCls:   'rgm-banner-icon-bear',
      dotCls:    'rgm-color-down',
      chipCls:   'rgm-chip-down',
      tickerCls: 'rgm-chip-ticker-down',
      cardCls:   'rgm-sector-card-bear',
      badgeCls:  'rgm-sector-badge-bear',
      dotClass:  'rgm-dot-down',
      desc: 'Bear market conditions confirmed. Defensive posture adopted. System reduces gross exposure and tightens all risk controls.',
      color: 'var(--accent-red)',
      colorHex: '#ef4444',
    },
    CRISIS: {
      key:      'CRISIS',
      label:    'Crisis',
      short:    'CRISIS',
      iconClass: 'fa-triangle-exclamation',
      bannerCls: 'rgm-banner-crisis',
      iconCls:   'rgm-banner-icon-crisis',
      dotCls:    'rgm-color-crisis',
      chipCls:   'rgm-chip-crisis',
      tickerCls: 'rgm-chip-ticker-crisis',
      cardCls:   'rgm-sector-card-crisis',
      badgeCls:  'rgm-sector-badge-crisis',
      dotClass:  'rgm-dot-crisis',
      desc: 'Crisis conditions detected. Extreme volatility and drawdown risk. All trading may be halted via DD Halt mechanism. Maximum defensive posture active.',
      color: 'var(--accent-orange)',
      colorHex: '#f59e0b',
    },
  };

  const REGIME_FALLBACK = {
    key:      'unknown',
    label:    'Unknown',
    short:    '—',
    iconClass: 'fa-circle-question',
    bannerCls: 'rgm-banner-neutral',
    iconCls:   'rgm-banner-icon-neutral',
    dotCls:    'rgm-color-unknown',
    chipCls:   'rgm-chip-unknown',
    tickerCls: '',
    cardCls:   '',
    badgeCls:  'rgm-sector-badge-unknown',
    desc:      'Regime data not yet available. Waiting for regime_detector to complete a full cycle.',
    color:     'var(--text-faint)',
    colorHex:  '#6b7280',
  };

  // ── Sectors SPDR ETFs ─────────────────────────────────────
  const SECTOR_ETFS = [
    { ticker: 'XLK',  name: 'Technology'       },
    { ticker: 'XLF',  name: 'Financials'       },
    { ticker: 'XLV',  name: 'Health Care'      },
    { ticker: 'XLE',  name: 'Energy'           },
    { ticker: 'XLY',  name: 'Consumer Discr.'  },
    { ticker: 'XLP',  name: 'Consumer Staples' },
    { ticker: 'XLI',  name: 'Industrials'      },
    { ticker: 'XLB',  name: 'Materials'        },
    { ticker: 'XLU',  name: 'Utilities'        },
    { ticker: 'XLRE', name: 'Real Estate'      },
    { ticker: 'XLC',  name: 'Comm. Services'   },
    { ticker: 'GLD',  name: 'Gold'             },
    { ticker: 'TLT',  name: 'Bonds 20Y+'       },
    { ticker: 'USO',  name: 'Crude Oil'        },
  ];

  // ── Adaptations agents selon régime ──────────────────────
  const AGENT_ADAPTATIONS = {
    trend_up: {
      capital_allocator:    { 'Kelly fraction':  '0.20–0.35', 'Max position':  '15%', 'Leverage':    '1.2×' },
      risk_manager:         { 'Stop-loss':       '-8%',       'VaR limit':     '2.5%', 'Drawdown halt': '15%' },
      execution:            { 'Slippage tol.':   'medium',    'Order type':    'MKT/LMT', 'Retry':   '3×' },
      signal:               { 'Conf. threshold': '0.55',      'Min score':     '0.08',  'Horizon':  '5min' },
      portfolio_rebalancer: { 'Drift trigger':   '5%',        'Rebal. freq.':  '5×/day', 'Sector limit': '25%' },
      pnl_monitor:          { 'Trailing stop':   'Active',    'Exit rules':    '8',      'Check freq.': '60s' },
    },
    trend_down: {
      capital_allocator:    { 'Kelly fraction':  '0.05–0.15', 'Max position':  '8%',  'Leverage':    '0.6×' },
      risk_manager:         { 'Stop-loss':       '-5%',       'VaR limit':     '1.5%', 'Drawdown halt': '10%' },
      execution:            { 'Slippage tol.':   'low',       'Order type':    'LMT',  'Retry':       '2×' },
      signal:               { 'Conf. threshold': '0.70',      'Min score':     '0.15', 'Horizon':     '5min' },
      portfolio_rebalancer: { 'Drift trigger':   '3%',        'Rebal. freq.':  '3×/day', 'Sector limit': '15%' },
      pnl_monitor:          { 'Trailing stop':   'Tight',     'Exit rules':    '8',    'Check freq.': '60s' },
    },
    NEUTRAL: {
      capital_allocator:    { 'Kelly fraction':  '0.10–0.20', 'Max position':  '10%', 'Leverage':    '0.9×' },
      risk_manager:         { 'Stop-loss':       '-6%',       'VaR limit':     '2.0%', 'Drawdown halt': '12%' },
      execution:            { 'Slippage tol.':   'medium',    'Order type':    'LMT',  'Retry':       '2×' },
      signal:               { 'Conf. threshold': '0.65',      'Min score':     '0.10', 'Horizon':     '5min' },
      portfolio_rebalancer: { 'Drift trigger':   '4%',        'Rebal. freq.':  '4×/day', 'Sector limit': '20%' },
      pnl_monitor:          { 'Trailing stop':   'Active',    'Exit rules':    '8',    'Check freq.': '60s' },
    },
    CRISIS: {
      capital_allocator:    { 'Kelly fraction':  '0.00',      'Max position':  '0%',  'Leverage':    '0×' },
      risk_manager:         { 'Stop-loss':       '-3%',       'VaR limit':     '0.5%', 'Drawdown halt': 'Active' },
      execution:            { 'Slippage tol.':   'none',      'Order type':    'Halt', 'Retry':       '0×' },
      signal:               { 'Conf. threshold': '0.90',      'Min score':     '0.30', 'Horizon':     '5min' },
      portfolio_rebalancer: { 'Drift trigger':   '1%',        'Rebal. freq.':  '1×/day', 'Sector limit': '5%' },
      pnl_monitor:          { 'Trailing stop':   'Emergency', 'Exit rules':    '8',    'Check freq.': '15s' },
    },
  };

  const ADAPT_AGENT_META = {
    capital_allocator:    { label: 'Capital Allocator',    iconCls: 'fa-coins',          bg: 'rgba(234,179,8,0.12)',   color: '#eab308' },
    risk_manager:         { label: 'Risk Manager',         iconCls: 'fa-shield-halved',  bg: 'rgba(239,68,68,0.12)',   color: '#ef4444' },
    execution:            { label: 'Execution Agent',      iconCls: 'fa-bolt',           bg: 'rgba(16,185,129,0.12)',  color: '#10b981' },
    signal:               { label: 'Signal Agent',         iconCls: 'fa-satellite-dish', bg: 'rgba(139,92,246,0.12)', color: '#8b5cf6' },
    portfolio_rebalancer: { label: 'Portfolio Rebalancer', iconCls: 'fa-scale-balanced', bg: 'rgba(6,182,212,0.12)',  color: '#06b6d4' },
    pnl_monitor:          { label: 'PnL Monitor',          iconCls: 'fa-chart-line',     bg: 'rgba(249,115,22,0.12)', color: '#f97316' },
  };

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    AVUtils.setSidebarActive('regime');
    _bindThemeToggle();
    _bindSidebar();
    _showSkeleton();
    await loadData();
    _startRefresh();
    console.log('[av-regime] v1.0 init complete');
  }

  // ══════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════
  async function loadData() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const [sRes, dRes, hRes] = await Promise.allSettled([
      AVApi.fetchJSON(URLS.system,    0),
      AVApi.fetchJSON(URLS.decisions, 0),
      AVApi.fetchJSON(URLS.health,    0),
    ]);
    const p = r => r.status === 'fulfilled' ? r.value : null;
    _system    = p(sRes);
    _decisions = p(dRes);
    _health    = p(hRes);
    renderAll();
  }

  function renderAll() {
    const parsed = _parseRegimeData();
    renderKPIs(parsed);
    renderBanner(parsed);
    renderDistribution(parsed);
    renderSectors(parsed);
    renderHeatmap(parsed);
    renderAdaptations(parsed);
    renderDetectorStatus();
    _updateSidebar(parsed);
  }

  // ══════════════════════════════════════════════════════════
  // DATA PARSING
  // Extrait le régime de chaque symbole depuis agent_decisions
  // ══════════════════════════════════════════════════════════
  function _parseRegimeData() {
    const allDec = _decisions?.decisions || {};
    const symbolRegimes = {};

    for (const [ticker, data] of Object.entries(allDec)) {
      const council = data.council;
      if (!council) continue;

      // Extraire le régime du champ reason
      let regime = 'unknown';
      const reason = council.reason || '';
      const match  = reason.match(/regime=(\S+)/);
      if (match) regime = match[1];

      // Extraire la confiance composite
      let conf = 0;
      const confMatch = reason.match(/conf=([\d.]+)/);
      if (confMatch) conf = parseFloat(confMatch[1]);

      symbolRegimes[ticker] = {
        regime,
        confidence: council.confidence || conf,
        weightedScore: parseFloat(council.weighted_score || 0),
        decision: council.decision || 'wait',
      };
    }

    // Régime global = régime de SPY (référence du marché)
    const spyData      = symbolRegimes['SPY'];
    const globalRegime = spyData?.regime || 'unknown';
    const globalConf   = spyData?.confidence || 0;

    // Comptage par type de régime
    const counts = {};
    for (const { regime } of Object.values(symbolRegimes)) {
      counts[regime] = (counts[regime] || 0) + 1;
    }

    const total    = Object.values(symbolRegimes).length;
    const upCount  = counts['trend_up']   || 0;
    const downCount = counts['trend_down'] || 0;
    const neutral  = counts['NEUTRAL']    || 0;
    const crisis   = counts['CRISIS']     || 0;

    return {
      globalRegime,
      globalConf,
      symbolRegimes,
      counts,
      total,
      upCount,
      downCount,
      neutral,
      crisis,
      timestamp: _decisions?.timestamp || null,
    };
  }

  function _getRegimeMeta(regimeKey) {
    return REGIME_META[regimeKey] || REGIME_FALLBACK;
  }

  // ══════════════════════════════════════════════════════════
  // KPIs
  // ══════════════════════════════════════════════════════════
  function renderKPIs(p) {
    const meta     = _getRegimeMeta(p.globalRegime);
    const confPct  = p.globalConf > 0 ? (p.globalConf * 100).toFixed(1) + '%' : '—';
    const bullPct  = p.total > 0 ? (p.upCount   / p.total * 100).toFixed(0) : 0;
    const bearPct  = p.total > 0 ? (p.downCount / p.total * 100).toFixed(0) : 0;

    // Regime badge
    _setHTML('rgm-kpi-regime', `
      <div class="rgm-kpi-val" style="color:${meta.colorHex}">
        ${meta.label}
      </div>
      <div class="rgm-kpi-sub">${meta.short}</div>`);

    // Confidence
    _setHTML('rgm-kpi-conf', `
      <div class="rgm-kpi-val">${confPct}</div>
      <div class="rgm-kpi-sub">SPY signal</div>`);

    // Trend Up
    _setHTML('rgm-kpi-up', `
      <div class="rgm-kpi-val" style="color:var(--accent-green)">
        ${p.upCount}
      </div>
      <div class="rgm-kpi-sub">${bullPct}% of universe</div>`);

    // Trend Down
    _setHTML('rgm-kpi-down', `
      <div class="rgm-kpi-val" style="color:var(--accent-red)">
        ${p.downCount}
      </div>
      <div class="rgm-kpi-sub">${bearPct}% of universe</div>`);
  }

  // ══════════════════════════════════════════════════════════
  // REGIME BANNER
  // ══════════════════════════════════════════════════════════
  function renderBanner(p) {
    const body = document.getElementById('rgm-banner-body');
    if (!body) return;

    const meta    = _getRegimeMeta(p.globalRegime);
    const confPct = p.globalConf > 0 ? (p.globalConf * 100).toFixed(1) : '—';
    const ts      = p.timestamp
      ? new Date(p.timestamp).toLocaleString('fr-FR', {
          day: '2-digit', month: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
      : '—';

    const bullPct = p.total > 0
      ? (p.upCount / p.total * 100).toFixed(1)
      : 0;

    // Meta header
    _setHTML('rgm-banner-meta', `
      <span class="badge badge-gray badge-xs">
        <i class="fa-solid fa-clock"></i> ${ts}
      </span>
      <span class="badge badge-gray badge-xs">
        ${p.total} symbols analyzed
      </span>`);

    body.innerHTML = `
      <div class="rgm-banner ${meta.bannerCls}">

        <!-- Icon -->
        <div class="rgm-banner-icon-wrap ${meta.iconCls}">
          <i class="fa-solid ${meta.iconClass}"></i>
        </div>

        <!-- Info -->
        <div class="rgm-banner-info">
          <div class="rgm-banner-label">
            <i class="fa-solid fa-globe"></i>
            Market Regime — SPY Reference
          </div>
          <div class="rgm-banner-title">${meta.label}</div>
          <div class="rgm-banner-desc">${meta.desc}</div>

          <!-- Confidence bar -->
          <div class="rgm-conf-bar-wrap">
            <div class="rgm-conf-bar-track">
              <div class="rgm-conf-bar-fill"
                   style="width:${confPct !== '—' ? confPct : 0}%;
                          background:${meta.colorHex}">
              </div>
            </div>
            <span class="rgm-conf-bar-val"
                  style="color:${meta.colorHex}">
              ${confPct !== '—' ? confPct + '%' : '—'}
            </span>
          </div>
        </div>

        <!-- Stat boxes -->
        <div class="rgm-banner-stats">
          <div class="rgm-banner-stat">
            <div class="rgm-banner-stat-lbl">Bull Ratio</div>
            <div class="rgm-banner-stat-val"
                 style="color:var(--accent-green)">
              ${bullPct}%
            </div>
          </div>
          <div class="rgm-banner-stat">
            <div class="rgm-banner-stat-lbl">Bear Ratio</div>
            <div class="rgm-banner-stat-val"
                 style="color:var(--accent-red)">
              ${p.total > 0
                ? (p.downCount / p.total * 100).toFixed(1) + '%'
                : '—'}
            </div>
          </div>
          <div class="rgm-banner-stat">
            <div class="rgm-banner-stat-lbl">DD Halt</div>
            <div class="rgm-banner-stat-val"
                 style="color:${_system?.dd_halt
                   ? 'var(--accent-red)'
                   : 'var(--accent-green)'}">
              ${_system?.dd_halt ? 'Active' : 'Inactive'}
            </div>
          </div>
        </div>

      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // DISTRIBUTION
  // ══════════════════════════════════════════════════════════
  function renderDistribution(p) {
    const body = document.getElementById('rgm-dist-body');
    if (!body) return;

    const items = [
      { key: 'trend_up',   label: 'Trend Up',   count: p.upCount,   dotCls: 'rgm-color-up',      fillHex: '#10b981' },
      { key: 'trend_down', label: 'Trend Down',  count: p.downCount, dotCls: 'rgm-color-down',    fillHex: '#ef4444' },
      { key: 'NEUTRAL',    label: 'Neutral',     count: p.neutral,   dotCls: 'rgm-color-neutral',  fillHex: '#3b82f6' },
      { key: 'CRISIS',     label: 'Crisis',      count: p.crisis,    dotCls: 'rgm-color-crisis',   fillHex: '#f59e0b' },
    ].filter(i => i.count > 0 || i.key === 'trend_up' || i.key === 'trend_down');

    // Mise à jour meta
    _setHTML('rgm-dist-meta', `
      <span class="badge badge-gray badge-xs">${p.total} total</span>`);

    const rows = items.map(item => {
      const pct = p.total > 0
        ? (item.count / p.total * 100).toFixed(1)
        : 0;
      return `
        <div class="rgm-dist-item">
          <div class="rgm-dist-item-header">
            <div class="rgm-dist-item-label">
              <div class="rgm-dist-item-dot ${item.dotCls}"></div>
              ${item.label}
            </div>
            <div class="rgm-dist-item-count">${item.count} symbols</div>
          </div>
          <div class="rgm-dist-bar-track">
            <div class="rgm-dist-bar-fill"
                 style="width:${pct}%;background:${item.fillHex}"></div>
          </div>
          <div class="rgm-dist-pct">${pct}%</div>
        </div>`;
    }).join('');

    const unknownCount = p.total - p.upCount - p.downCount - p.neutral - p.crisis;

    body.innerHTML = `
      <div class="rgm-dist-list">
        ${rows}
      </div>
      <div class="rgm-dist-total">
        <span>Universe analyzed</span>
        <strong>${p.total} symbols</strong>
      </div>
      ${unknownCount > 0 ? `
        <div style="margin-top:8px;font-size:10px;color:var(--text-faint)">
          <i class="fa-solid fa-circle-info"></i>
          ${unknownCount} symbols without regime data
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // SECTORS
  // ══════════════════════════════════════════════════════════
  function renderSectors(p) {
    const body = document.getElementById('rgm-sector-body');
    if (!body) return;

    const cards = SECTOR_ETFS.map(etf => {
      const data   = p.symbolRegimes[etf.ticker];
      const regime = data?.regime || 'unknown';
      const conf   = data?.confidence || 0;
      const meta   = _getRegimeMeta(regime);
      const confStr = conf > 0
        ? (conf * 100).toFixed(0) + '%'
        : '—';

      return `
        <div class="rgm-sector-card ${meta.cardCls}">
          <div class="rgm-sector-ticker">${etf.ticker}</div>
          <div class="rgm-sector-name">${etf.name}</div>
          <span class="rgm-sector-badge ${meta.badgeCls}">${meta.short}</span>
          <div class="rgm-sector-conf">${confStr}</div>
        </div>`;
    }).join('');

    body.innerHTML = `<div class="rgm-sector-list">${cards}</div>`;
  }

  // ══════════════════════════════════════════════════════════════
// HEATMAP — tous les symboles
// ══════════════════════════════════════════════════════════════
function renderHeatmap(p) {
    const body = document.getElementById('rgm-heatmap-body');
    if (!body) return;

    _setHTML('rgm-heatmap-meta', `
      <span class="badge badge-gray badge-xs">${Object.keys(p.symbolRegimes).length} symbols</span>
      <span class="badge badge-xs" style="font-size:9px;color:var(--text-faint)">
        Click to analyze
      </span>`);

    const chips = Object.entries(p.symbolRegimes)
      .sort((a, b) => {
        const order = { trend_up: 0, trend_down: 1, BULL: 2, BEAR: 3, NEUTRAL: 4, CRISIS: 5 };
        return (order[a[1].regime] ?? 9) - (order[b[1].regime] ?? 9);
      })
      .map(([ticker, data]) => {
        const meta    = _getRegimeMeta(data.regime);
        const confPct = data.confidence > 0
          ? (data.confidence * 100).toFixed(0) + '%'
          : '—';
        const isEtf   = SECTOR_ETFS.some(e => e.ticker === ticker);

        // ✅ CORRECTION 3 — stock-detail au lieu d'advanced-analysis
        const url     = `stock-detail.html?symbol=${encodeURIComponent(ticker)}`;

        // ✅ CORRECTION 1 — logo 20px via AVUtils
        const logoHtml = AVUtils._getLogoHtml(ticker, 20);

        return `
          <a href="${url}"
             class="rgm-chip ${meta.chipCls} ${isEtf ? 'rgm-chip-etf' : ''}"
             title="${ticker} — ${meta.label} (${confPct})">
            <div class="rgm-chip-logo">${logoHtml}</div>
            <span class="rgm-chip-ticker ${meta.tickerCls}">${ticker}</span>
            <span class="rgm-chip-conf">${confPct}</span>
          </a>`;
      }).join('');

    body.innerHTML = chips || `
      <div class="rgm-loading-state">
        <i class="fa-solid fa-circle-question"></i>
        <span>No symbol data available</span>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // AGENT ADAPTATIONS
  // ══════════════════════════════════════════════════════════
  function renderAdaptations(p) {
    const body = document.getElementById('rgm-adapt-body');
    if (!body) return;

    // Normaliser la clé de régime pour les adaptations
    const regimeKey = p.globalRegime === 'trend_up'   ? 'trend_up'
                    : p.globalRegime === 'BULL'        ? 'trend_up'
                    : p.globalRegime === 'trend_down'  ? 'trend_down'
                    : p.globalRegime === 'BEAR'        ? 'trend_down'
                    : p.globalRegime === 'CRISIS'      ? 'CRISIS'
                    : 'NEUTRAL';

    const adaptParams = AGENT_ADAPTATIONS[regimeKey] || AGENT_ADAPTATIONS['NEUTRAL'];
    const meta        = _getRegimeMeta(p.globalRegime);

    const cards = Object.entries(ADAPT_AGENT_META).map(([agentKey, agentMeta]) => {
      const params = adaptParams[agentKey] || {};
      const rows   = Object.entries(params).map(([name, val]) => `
        <div class="rgm-adapt-param">
          <span class="rgm-adapt-param-name">${name}</span>
          <span class="rgm-adapt-param-val"
                style="color:${meta.colorHex}">${val}</span>
        </div>`).join('');

      return `
        <div class="rgm-adapt-card">
          <div class="rgm-adapt-header">
            <div class="rgm-adapt-icon"
                 style="background:${agentMeta.bg};color:${agentMeta.color}">
              <i class="fa-solid ${agentMeta.iconCls}"></i>
            </div>
            <div>
              <div class="rgm-adapt-agent">${agentMeta.label}</div>
              <div class="rgm-adapt-key">${agentKey}</div>
            </div>
          </div>
          <div class="rgm-adapt-params">${rows}</div>
        </div>`;
    }).join('');

    body.innerHTML = cards;
  }

  // ══════════════════════════════════════════════════════════
  // DETECTOR STATUS
  // ══════════════════════════════════════════════════════════
  function renderDetectorStatus() {
    const body = document.getElementById('rgm-history-body');
    if (!body) return;

    const agentData = _health?.agents?.regime_detector || {};
    const cycles    = parseInt(agentData.cycles   || 0);
    const errors    = parseInt(agentData.errors   || 0);
    const lastRun   = agentData.last_run            || null;
    const uptime    = parseFloat(agentData.uptime_h || 0);
    const duration  = parseFloat(agentData.metrics?.duration_s || 0);
    const paused    = agentData.paused              || false;
    const lastError = agentData.last_error          || null;

    // Meta header
    _setHTML('rgm-history-meta', `
      <span class="badge ${errors === 0 ? 'badge-green' : 'badge-red'} badge-xs">
        <i class="fa-solid ${errors === 0 ? 'fa-circle-check' : 'fa-circle-xmark'}"></i>
        ${errors === 0 ? 'OK' : `${errors} errors`}
      </span>`);

    const statsGrid = `
      <div class="rgm-detector-grid">
        <div class="rgm-detector-stat">
          <div class="rgm-detector-stat-val">${cycles.toLocaleString()}</div>
          <div class="rgm-detector-stat-lbl">Cycles run</div>
        </div>
        <div class="rgm-detector-stat">
          <div class="rgm-detector-stat-val"
               style="color:${errors > 0
                 ? 'var(--accent-red)'
                 : 'var(--accent-green)'}">
            ${errors}
          </div>
          <div class="rgm-detector-stat-lbl">Errors</div>
        </div>
        <div class="rgm-detector-stat">
          <div class="rgm-detector-stat-val">${uptime.toFixed(1)}h</div>
          <div class="rgm-detector-stat-lbl">Uptime</div>
        </div>
        <div class="rgm-detector-stat">
          <div class="rgm-detector-stat-val">${duration.toFixed(2)}s</div>
          <div class="rgm-detector-stat-lbl">Duration</div>
        </div>
      </div>`;

    const lastRunStr = lastRun
      ? `<div class="rgm-detector-ok">
           <i class="fa-solid fa-clock"></i>
           Last run: <strong>${AVUtils.formatAge(lastRun)}</strong>
           &nbsp;—&nbsp;${new Date(lastRun).toLocaleString('fr-FR')}
         </div>`
      : `<div class="rgm-detector-ok" style="color:var(--text-faint)">
           <i class="fa-solid fa-circle-question"></i>
           No run recorded yet
         </div>`;

    const errorBlock = lastError
      ? `<div class="rgm-detector-error" style="margin-top:12px">
           <i class="fa-solid fa-triangle-exclamation"></i>
           <div>
             <div style="font-weight:700;margin-bottom:3px">Last error</div>
             <div style="font-size:11px;font-family:var(--font-mono)">${lastError}</div>
           </div>
         </div>`
      : '';

    const pausedBlock = paused
      ? `<div class="rgm-detector-error" style="margin-top:12px">
           <i class="fa-solid fa-pause"></i>
           <div>Agent is currently <strong>paused</strong></div>
         </div>`
      : '';

    body.innerHTML = statsGrid + lastRunStr + errorBlock + pausedBlock;
  }

  // ══════════════════════════════════════════════════════════
  // SKELETON
  // ══════════════════════════════════════════════════════════
  function _showSkeleton() {
    ['rgm-kpi-regime', 'rgm-kpi-conf', 'rgm-kpi-up', 'rgm-kpi-down'].forEach(id => {
      _setHTML(id,
        `<span class="skeleton-line rgm-skel-kpi"></span>`);
    });

    const heatmap = document.getElementById('rgm-heatmap-body');
    if (heatmap) {
      heatmap.innerHTML = Array.from({ length: 20 }, () =>
        `<span class="skeleton-line" style="width:64px;height:44px;
          display:inline-block;border-radius:9px;margin:3px"></span>`
      ).join('');
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH (30s)
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    _timers.push(setInterval(async () => {
      try {
        const URLS = AV_CONFIG.SIGNAL_URLS;
        const [sRes, dRes, hRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.system,    0),
          AVApi.fetchJSON(URLS.decisions, 0),
          AVApi.fetchJSON(URLS.health,    0),
        ]);
        const p = r => r.status === 'fulfilled' ? r.value : null;
        _system    = p(sRes) || _system;
        _decisions = p(dRes) || _decisions;
        _health    = p(hRes) || _health;
        renderAll();
      } catch (err) {
        console.warn('[av-regime] Refresh error:', err.message);
      }
    }, AV_CONFIG.REFRESH.agents || 30000));
  }

  // ══════════════════════════════════════════════════════════
  // SIDEBAR
  // ══════════════════════════════════════════════════════════
  function _updateSidebar(p) {
    const dot   = document.getElementById('sb-regime-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');
    const meta  = _getRegimeMeta(p.globalRegime);
    if (dot)   dot.className     = `av-status-dot ${
      p.globalRegime === 'trend_up' || p.globalRegime === 'BULL'
        ? 'green'
        : p.globalRegime === 'CRISIS' ? 'red' : 'orange'}`;
    if (label) label.textContent = meta.label;
    if (sync)  sync.textContent  = 'Refresh 30s';
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS
  // ══════════════════════════════════════════════════════════
  function _bindThemeToggle() {
    const btn = document.getElementById('av-theme-toggle');
    if (btn) btn.addEventListener('click', () => AVUtils.ThemeManager.toggle());
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

  // ── Helpers ────────────────────────────────────────────────
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

  window._RegimeCtrl = {
    destroy: () => _timers.forEach(clearInterval),
    refresh: () => loadData(),
  };

})();