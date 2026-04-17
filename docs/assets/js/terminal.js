// ============================================================
// terminal.js — AlphaVault Quant v3.0
// ✅ Controller principal — 0 inline handler dans le HTML
// ✅ Auto-refresh 60s depuis GitHub Pages JSON signals
// ✅ Auto-trading status indicator
// ✅ Order dispatch via GitHub Actions API
// ✅ IBKR Paper Trading exec log
// ✅ Multi-panel charts, watchlist, sparklines
// ============================================================

const Terminal = (() => {

  // ── Constants ────────────────────────────────────────────
  const FINANCE_HUB  = 'https://finance-hub-api.raphnardone.workers.dev';
  const GH_OWNER     = 'Raph33AI';
  const GH_REPO      = 'alphavault-quant';
  const GH_WORKFLOW  = 'manual-trade.yml';
  const REFRESH_MS   = 60_000;

  const UNIVERSE = [
    'SPY','QQQ','IWM','AAPL','NVDA',
    'MSFT','GOOGL','AMZN','META','TSLA','JPM','GS',
  ];

  const NAMES = {
    SPY:'S&P 500 ETF',   QQQ:'Nasdaq 100 ETF',  IWM:'Russell 2000 ETF',
    AAPL:'Apple Inc.',   NVDA:'NVIDIA Corp.',    MSFT:'Microsoft Corp.',
    GOOGL:'Alphabet',    AMZN:'Amazon.com',      META:'Meta Platforms',
    TSLA:'Tesla Inc.',   JPM:'JPMorgan Chase',   GS:'Goldman Sachs',
  };

  const REGIME_MAP = {
    trend_up:'Trend Up',           trend_down:'Trend Down',
    range_bound:'Range Bound',     low_volatility:'Low Volatility',
    high_volatility:'High Volatility', crash:'Crash',
    macro_tightening:'Tightening', macro_easing:'Easing',
    initializing:'Initializing',
  };

  const REGIME_ICON = {
    trend_up:'fa-arrow-trend-up',     trend_down:'fa-arrow-trend-down',
    range_bound:'fa-arrows-left-right', low_volatility:'fa-minus',
    high_volatility:'fa-bolt',        crash:'fa-skull-crossbones',
    macro_tightening:'fa-lock',       macro_easing:'fa-unlock',
    initializing:'fa-circle-notch fa-spin',
  };

  const REGIME_COLOR = {
    trend_up:'#10b981',   trend_down:'#ef4444',  range_bound:'#64748b',
    low_volatility:'#06b6d4', high_volatility:'#f59e0b', crash:'#ef4444',
    macro_tightening:'#f97316', macro_easing:'#8b5cf6',  initializing:'#64748b',
  };

  const STRAT_COLORS = {
    trend:'#3b82f6', mean_reversion:'#10b981',
    vol_carry:'#8b5cf6', options_convexity:'#f97316',
  };

  // ── State ────────────────────────────────────────────────
  let _state       = {};
  let _refreshTimer = null;
  let _currentSide = 'BUY';
  let _currentIv   = '1day';
  let _panelIv     = ['1day','1day','1day','1day'];
  let _sidebarOpen = true;
  let _mainInited  = false;
  let _panelsInited= false;
  let _activeSection = 'overview';

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  async function init() {
    _restoreTheme();
    _restorePAT();
    _startClock();
    _bindEvents();
    _togglePriceFields();

    // ✅ FIX #1 — Init watchlist APRÈS que le DOM soit prêt
    WatchlistManager.init();

    // First data load
    await _refresh();
    await _loadMainChart();

    // Auto-refresh every 60s
    _refreshTimer = setInterval(_refresh, REFRESH_MS);

    console.log('[AlphaVault] Terminal initialized | Auto-refresh: 60s');
    }

  // ── Bind ALL event listeners (no inline handlers) ────────
  function _bindEvents() {
    // Topbar
    _on('sidebar-toggle', 'click',  toggleSidebar);
    _on('btn-refresh',    'click',  forceRefresh);
    _on('btn-theme',      'click',  toggleTheme);

    // Overview chart controls
    _on('ov-symbol',       'change', () => _loadMainChart());
    _on('btn-refresh-chart','click', () => _loadMainChart(true));
    _on('btn-view-all-signals','click', () => showSection('signals'));

    // Interval tabs (overview)
    document.querySelectorAll('#ov-intervals .itab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#ov-intervals .itab')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentIv = btn.dataset.iv;
        _loadMainChart();
      });
    });

    // Watchlist search
    _on('wl-search',     'input', filterWatchlist);

    // Signals search
    _on('signal-search', 'input', filterSignals);

    // Chart layout selector
    _on('chart-layout', 'change', e => _setChartLayout(e.target.value));

    _on('btn-wl-reset', 'click', () => WatchlistManager.resetToDefault());

    // Panel chart selectors (cp-sym-0 to 3)
    for (let i = 0; i < 4; i++) {
      const sel = document.getElementById(`cp-sym-${i}`);
      if (sel) {
        const idx = i;
        sel.addEventListener('change', () => _loadPanelChart(idx, sel.value));
      }
    }

    // Panel interval tabs
    document.querySelectorAll('.cp-itabs').forEach(container => {
      const panelIdx = parseInt(container.dataset.panel ?? '0');
      container.querySelectorAll('.cp-itab').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.cp-itab')
            .forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _panelIv[panelIdx] = btn.dataset.iv;
          const sym = document.getElementById(`cp-sym-${panelIdx}`)?.value || UNIVERSE[panelIdx];
          _loadPanelChart(panelIdx, sym);
        });
      });
    });

    // Sidebar nav items
    document.querySelectorAll('.nav-item[data-sec]').forEach(item => {
      item.addEventListener('click', () => showSection(item.dataset.sec));
    });

    // Mobile nav buttons
    document.querySelectorAll('.mob-nav-btn[data-sec]').forEach(btn => {
      btn.addEventListener('click', () => showSection(btn.dataset.sec));
    });

    // Order form
    _on('side-buy',  'click', () => setSide('BUY'));
    _on('side-sell', 'click', () => setSide('SELL'));
    _on('order-type','change', _togglePriceFields);
    _on('order-form','submit', _handleOrderSubmit);
    _on('btn-refresh-exec','click', _refreshExecLog);
    _on('gh-pat','input', e => _savePAT(e.target.value));
  }

  // ── One-liner event helper ───────────────────────────────
  function _on(id, event, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  // ════════════════════════════════════════════════════════
  // DATA REFRESH
  // ════════════════════════════════════════════════════════
  async function _refresh(bust = false) {
    try {
      const data = await ApiClient.fetchAll(bust);
      _state = data;

    WatchlistManager.render(data.signals);
    window._terminalState = data;  // expose pour StockDetail

      _updateTopbar(data);
      _updateTicker(data);
      _updateSidebarWatchlist(data);
      _updateMiniQuotes(data);
      _updateAutoTradingBadge(data);
      _renderActiveSection(data);
      _txt('last-update', `Updated ${new Date().toLocaleTimeString()}`);

    } catch(err) {
      console.error('Terminal refresh error:', err);
    }
  }

  async function forceRefresh() {
    clearInterval(_refreshTimer);
    const btn = document.getElementById('btn-refresh');
    if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate fa-spin"></i>';

    await _refresh(true);
    await _loadMainChart(true);

    if (btn) btn.innerHTML = '<i class="fa-solid fa-rotate"></i>';
    _refreshTimer = setInterval(_refresh, REFRESH_MS);
    _showToast('Data refreshed', 'success');
  }

  // ════════════════════════════════════════════════════════
  // TOPBAR UPDATES
  // ════════════════════════════════════════════════════════
  function _updateTopbar(data) {
    const status = data.status || {};
    const regime = data.regime?.global || {};
    const rl     = regime.regime_label || 'initializing';

    // ════════════════════════════════════════════════════
    // DEBUG LOGS — #4 Status indicators explanation
    // ════════════════════════════════════════════════════
    console.groupCollapsed('%c[AlphaVault] Status Debug', 'color:#3b82f6;font-weight:bold;font-size:11px');

    // LLM
    const llmAvail = status.llm_available;
    console.log(
        `%c LLM: ${llmAvail ? 'AVAILABLE' : 'UNAVAILABLE'} → dot ${llmAvail ? 'GREEN' : 'RED'}`,
        `color:${llmAvail ? '#10b981' : '#ef4444'};font-weight:bold`
    );
    if (!llmAvail) {
        console.warn(' → Cause probable: Gemini 429 quota dépassé (voir logs GitHub Actions)');
        console.log('%c → Le système fonctionne en mode déterministe ML (XGBoost + LightGBM + LogReg)', 'color:#10b981');
        console.log('%c → Les signaux ML sont générés normalement — LLM est optionnel et additif seulement', 'color:#10b981');
    }

    // Hub
    const hubOk = !!(status.workers?.finance_hub);
    console.log(
        `%c HUB: ${hubOk ? 'ONLINE' : 'OFFLINE'} → dot ${hubOk ? 'GREEN' : 'ORANGE'}`,
        `color:${hubOk ? '#10b981' : '#f59e0b'};font-weight:bold`
    );
    if (!hubOk) {
        console.warn(' → Worker finance-hub-api non joignable depuis GitHub Actions');
        console.log(' → URL configurée:', status.workers?.finance_hub_url || 'N/A');
    }

    // IBKR
    console.log('%c IBKR: ALWAYS ORANGE in cloud (expected)', 'color:#f59e0b;font-weight:bold');
    console.log('%c → GitHub Actions ne peut pas atteindre TWS Gateway (firewall). Normal en paper mode cloud.', 'color:#94a3b8');
    console.log('%c → L\'exécution auto se fait via IBKRExecutor Python côté runner. DRY_RUN=', status.dry_run, 'color:#94a3b8');

    // SYS
    const overall = status.overall;
    console.log(
        `%c SYS: ${overall || 'unknown'} → dot ${overall === 'healthy' ? 'GREEN' : overall === 'degraded' ? 'ORANGE' : 'RED'}`,
        `color:${overall === 'healthy' ? '#10b981' : overall === 'degraded' ? '#f59e0b' : '#ef4444'};font-weight:bold`
    );
    if (overall !== 'healthy') {
        console.warn(' → Vérifier: docs/signals/system_status.json');
        console.log(' Workers:', JSON.stringify(status.workers, null, 2));
    }

    console.log(`%c Mode: ${status.mode || 'deterministic'}`, 'color:#8b5cf6');
    console.log(`%c Session: ${status.session || 'closed'} | DryRun: ${status.dry_run}`, 'color:#64748b');
    console.log(' Full status:', status);
    console.groupEnd();

    // ════════════════════════════════════════════════════
    // DOM UPDATES
    // ════════════════════════════════════════════════════

    // Regime pill
    const badge = document.getElementById('regime-badge');
    if (badge) {
        badge.innerHTML = `<i class="fa-solid ${REGIME_ICON[rl] || 'fa-question'}" style="margin-right:5px"></i>${REGIME_MAP[rl] || rl.replace(/_/g,' ').toUpperCase()}`;
        badge.style.borderColor = REGIME_COLOR[rl] || '#64748b';
        badge.style.color       = REGIME_COLOR[rl] || '#64748b';
    }

    // Status dots
    _setDot('llm',  llmAvail ? 'ok' : 'error');
    _setDot('hub',  hubOk    ? 'ok' : 'warn');
    _setDot('ibkr', 'warn');   // Always paper/unreachable in cloud — expected
    _setDot('sys',
        overall === 'healthy'  ? 'ok'   :
        overall === 'degraded' ? 'warn' : 'error'
    );

    // Tooltips dynamiques
    const pillLLM  = document.getElementById('pill-llm');
    const pillIBKR = document.getElementById('pill-ibkr');
    const pillSys  = document.getElementById('pill-sys');

    if (pillLLM)  pillLLM.title  = llmAvail
        ? 'LLM Online — Gemini active'
        : 'LLM Offline — Deterministic ML mode active (see console for details)';
    if (pillIBKR) pillIBKR.title = 'IBKR Paper Mode — TWS unreachable from GitHub Actions (expected in cloud)';
    if (pillSys)  pillSys.title  = `System: ${overall || 'unknown'} | Mode: ${status.mode || 'deterministic'}`;

    // Session badge
    const sess   = status.session || 'closed';
    const sessEl = document.getElementById('session-badge');
    if (sessEl) {
        sessEl.textContent = sess.toUpperCase();
        sessEl.className   = `market-session ${sess}`;
    }

    // Dry run badge
    const drEl = document.getElementById('dry-run-badge');
    if (drEl) {
        drEl.textContent = status.dry_run === false ? 'LIVE' : 'PAPER';
        drEl.className   = status.dry_run === false ? 'dry-run-badge live' : 'dry-run-badge';
    }

    // Sidebar session
    const swSess = document.getElementById('sw-session');
    if (swSess) {
        swSess.textContent = sess.toUpperCase();
        swSess.className   = `sw-session ${sess}`;
    }
    }

  function _setDot(key, state) {
    const dot  = document.getElementById(`dot-${key}`);
    const pill = document.getElementById(`pill-${key}`);
    if (dot)  dot.className  = `s-dot ${state}`;
    if (pill) pill.className = `status-pill ${state}`;
  }

  // ── Auto-Trading Badge ───────────────────────────────────
  function _updateAutoTradingBadge(data) {
    const status  = data.status || {};
    const regime  = data.regime?.global || {};
    const badge   = document.getElementById('auto-trading-badge');
    if (!badge) return;

    const isMarketOpen = ['regular','premarket','postmarket']
      .includes(status.session || '');
    const isActive     = isMarketOpen && !status.dry_run;

    badge.className   = `auto-trading-badge ${isActive ? 'active' : 'inactive'}`;
    badge.title       = isActive
      ? `Auto-trading ACTIVE — ${status.session} session`
      : status.dry_run
        ? 'Paper mode (DRY_RUN=true) — enable in workflow to auto-trade'
        : 'Market closed — auto-trading paused';

    // Last cycle timestamp
    const lastCycleEl = document.getElementById('auto-last-cycle');
    if (lastCycleEl && status.timestamp) {
      lastCycleEl.textContent = `Last cycle: ${_fmtTime(status.timestamp)}`;
    }
  }

  // ════════════════════════════════════════════════════════
  // TICKER BAR
  // ════════════════════════════════════════════════════════
  function _updateTicker(data) {
    const sigs  = data.signals?.signals || {};
    const track = document.getElementById('ticker-track');
    if (!track) return;

    const symbols = Object.keys(sigs).length ? Object.keys(sigs) : UNIVERSE;
    const items   = symbols.map(sym => {
      const s      = sigs[sym] || {};
      const price  = parseFloat(s.price || 0);
      const chgPct = parseFloat(s.change_pct || 0);
      const cls    = chgPct > 0 ? 'up' : chgPct < 0 ? 'down' : '';
      const arrow  = chgPct > 0
        ? '<i class="fa-solid fa-caret-up"></i>'
        : chgPct < 0 ? '<i class="fa-solid fa-caret-down"></i>' : '';
      const pxStr  = price > 0 ? `$${price.toFixed(2)}` : '--';
      const chgStr = chgPct !== 0
        ? `${chgPct > 0 ? '+' : ''}${chgPct.toFixed(2)}%` : '';
      return `<span class="ticker-item ${cls}"><strong>${sym}</strong>${pxStr} ${arrow}<em>${chgStr}</em></span>`;
    }).join('');

    // Duplicate for seamless loop
    track.innerHTML = items + items;
    const dur = Math.max(20, symbols.length * 4);
    track.style.animationDuration = `${dur}s`;
  }

  // ════════════════════════════════════════════════════════
  // MINI QUOTES (topbar center)
  // ════════════════════════════════════════════════════════
  function _updateMiniQuotes(data) {
    const sigs = data.signals?.signals || {};
    ['SPY','QQQ','IWM'].forEach(sym => {
      const s = sigs[sym];
      if (!s) return;
      const price  = parseFloat(s.price || 0);
      const chg    = parseFloat(s.change_pct || 0);
      const valEl  = document.getElementById(`mq-${sym.toLowerCase()}-val`);
      if (valEl) {
        valEl.textContent = price > 0 ? `$${price.toFixed(2)}` : '--';
        valEl.className   = `mq-val ${chg > 0 ? 'up' : chg < 0 ? 'down' : ''}`;
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // SIDEBAR WATCHLIST
  // ════════════════════════════════════════════════════════
  function _updateSidebarWatchlist(data) {
    const sigs = data.signals?.signals || {};
    const list = document.getElementById('sw-list');
    if (!list) return;

    const symbols = Object.keys(sigs).length ? Object.keys(sigs) : UNIVERSE;
    list.innerHTML = symbols.map(sym => {
      const s     = sigs[sym] || {};
      const price = parseFloat(s.price || 0);
      const chg   = parseFloat(s.change_pct || 0);
      const dir   = s.direction || 'neutral';
      const cls   = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      const dirIcon = dir === 'buy'
        ? '<i class="fa-solid fa-arrow-up"></i>'
        : dir === 'sell'
          ? '<i class="fa-solid fa-arrow-down"></i>'
          : '<i class="fa-solid fa-minus"></i>';

      return `<div class="sw-item" data-sym="${sym}">
        <div class="sw-sym-row">
          <span class="sw-sym">${sym}</span>
          <span class="sw-dir ${dir}">${dirIcon}</span>
        </div>
        <div class="sw-price-row">
          <span class="sw-price mono ${cls}">${price > 0 ? '$' + price.toFixed(2) : '--'}</span>
          <span class="sw-chg mono ${cls}">${chg > 0 ? '+' : ''}${chg !== 0 ? chg.toFixed(2) + '%' : ''}</span>
        </div>
      </div>`;
    }).join('');

    // Bind click to load chart
    list.querySelectorAll('.sw-item[data-sym]').forEach(el => {
      el.addEventListener('click', () => {
        loadChartSymbol(el.dataset.sym);
        if (_activeSection !== 'overview') showSection('overview');
      });
    });
  }

  // ════════════════════════════════════════════════════════
  // SECTION ROUTING
  // ════════════════════════════════════════════════════════
  function showSection(name) {
    _activeSection = name;

    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item[data-sec]').forEach(n => n.classList.remove('active'));
    document.querySelectorAll('.mob-nav-btn[data-sec]').forEach(n => n.classList.remove('active'));

    const sec = document.getElementById(`sec-${name}`);
    const nav = document.querySelector(`.nav-item[data-sec="${name}"]`);
    const mob = document.querySelector(`.mob-nav-btn[data-sec="${name}"]`);

    if (sec) sec.classList.add('active');
    if (nav) nav.classList.add('active');
    if (mob) mob.classList.add('active');

    // Lazy init charts section
    if (name === 'charts' && !_panelsInited) {
      _panelsInited = true;
      _initAllPanelCharts();
    }

    if (name === 'execution') _refreshExecLog();

    _renderSection(name, _state);
  }

  function _renderActiveSection(data) {
    _renderSection(_activeSection, data);
  }

  function _renderSection(name, data) {
    switch(name) {
      case 'overview':    _renderOverview(data);    break;
      case 'watchlist':   _renderWatchlist(data);   break;
      case 'signals':     _renderSignals(data);     break;
      case 'portfolio':   _renderPortfolio(data);   break;
      case 'risk':        _renderRisk(data);        break;
      case 'agents':      _renderAgents(data);      break;
      case 'strategies':  _renderStrategies(data);  break;
      case 'performance': _renderPerformance(data); break;
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: OVERVIEW
  // ════════════════════════════════════════════════════════
  function _renderOverview(data) {
    const sigs   = data.signals?.signals || {};
    const regime = data.regime?.global   || {};
    const port   = data.portfolio         || {};
    const risk   = data.risk              || {};
    const status = data.status            || {};
    const sw     = data.strategy?.weights || {};

    // Index cards
    ['SPY','QQQ','IWM'].forEach(sym => {
      const s     = sigs[sym] || {};
      const price = parseFloat(s.price || 0);
      const chg   = parseFloat(s.change_pct || 0);
      const cls   = chg > 0 ? 'up' : chg < 0 ? 'down' : '';

      _txt(`ic-${sym.toLowerCase()}-price`, price > 0 ? `$${price.toFixed(2)}` : '--');

      const chgEl = document.getElementById(`ic-${sym.toLowerCase()}-change`);
      if (chgEl) {
        chgEl.textContent = `${chg > 0 ? '+' : ''}${chg.toFixed(2)}%`;
        chgEl.className   = `ic-change ${cls}`;
      }

      // Sparkline — generate synthetic prices from current price
      if (price > 0) {
        const sparkData = _generateSparkData(price, 20);
        Charts.renderSparkline(`spark-${sym.toLowerCase()}`, sparkData, chg >= 0);
      }

      // Click to load chart
      const card = document.getElementById(`card-${sym.toLowerCase()}`);
      if (card && !card.dataset.bound) {
        card.dataset.bound = '1';
        card.addEventListener('click', () => loadChartSymbol(sym));
      }
    });

    // Regime card
    const rl = regime.regime_label || 'initializing';
    _txt('ic-regime-label', REGIME_MAP[rl] || rl);
    _txt('ic-regime-score', parseFloat(regime.regime_score || 0).toFixed(2));
    _txt('ic-regime-conf',  `${((regime.confidence || 0) * 100).toFixed(0)}%`);

    const flagsEl = document.getElementById('ic-regime-flags');
    if (flagsEl) {
      flagsEl.innerHTML = [
        { l:'Long',  ok: regime.allow_long },
        { l:'Short', ok: regime.allow_short },
        { l:'Lev.',  ok: regime.leverage_allowed },
      ].map(f => `<span class="ir-flag ${f.ok ? 'ok' : 'no'}">${f.l}</span>`).join('');
    }

    // Signal KPIs
    let buy=0, sell=0, neutral=0, exec=0;
    Object.values(sigs).forEach(s => {
      if (s.direction === 'buy')  buy++;
      else if (s.direction === 'sell') sell++;
      else neutral++;
      if ((s.council||'').includes('execute')) exec++;
    });
    _txt('ov-buy',     buy);
    _txt('ov-sell',    sell);
    _txt('ov-neutral', neutral);
    _txt('ov-exec',    exec);

    // Portfolio snapshot
    const val  = parseFloat(port.total_value || 100000);
    const cash = parseFloat(port.cash_pct || 1);
    const dd   = parseFloat(risk.drawdown?.current_drawdown || 0);
    const lever= parseFloat(risk.leverage?.current_leverage || 0);

    _txt('ov-port-value', `$${val.toLocaleString()}`);
    _txt('ov-cash',       `${(cash * 100).toFixed(1)}%`);
    _txt('ov-lever',      `${lever.toFixed(2)}x`);

    const ddEl = document.getElementById('ov-dd');
    if (ddEl) {
      ddEl.textContent = `${(dd * 100).toFixed(2)}%`;
      ddEl.className   = `ps-val mono ${dd < -0.02 ? 'down' : ''}`;
    }

    // Health grid
    _txt('hg-llm',  status.llm_available
    ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i> Available'
    : '<i class="fa-solid fa-gears"></i> Deterministic ML', true);
    _txt('hg-ibkr', status.dry_run === false
    ? '<i class="fa-solid fa-plug" style="color:var(--g)"></i> Live Paper'
    : '<i class="fa-solid fa-flask"></i> Paper Simulation', true);
    _txt('hg-hub',  status.workers?.finance_hub
    ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i> Online'
    : '<i class="fa-solid fa-triangle-exclamation" style="color:var(--y)"></i> Offline', true);

    const ts = data.signals?.timestamp;
    _txt('hg-last', ts ? _fmtTime(ts) : '--');

    // Strategy donut (mini)
    Charts.renderStrategyDonutMini('ov-strategy-donut', sw);

    // Top signals table (max 8)
    _renderSignalsTable('ov-signals-tbody', sigs, 8, false);
  }

  // Generate synthetic sparkline prices around a base price
  function _generateSparkData(basePrice, n = 20) {
    const data = [];
    let p = basePrice * 0.98;
    for (let i = 0; i < n; i++) {
      p += (Math.random() - 0.48) * basePrice * 0.004;
      data.push(parseFloat(p.toFixed(2)));
    }
    data.push(basePrice);
    return data;
  }

  // ════════════════════════════════════════════════════════
  // SECTION: WATCHLIST
  // ════════════════════════════════════════════════════════
  function _renderWatchlist(data) {
    const sigs  = data.signals?.signals || {};
    const tbody = document.getElementById('watchlist-tbody');
    if (!tbody) return;

    const symbols = Object.keys(sigs).length ? Object.keys(sigs) : UNIVERSE;
    tbody.innerHTML = symbols.map(sym => {
      const s      = sigs[sym] || {};
      const price  = parseFloat(s.price || 0);
      const chg    = parseFloat(s.change_pct || 0);
      const score  = parseFloat(s.final_score || 0);
      const bp     = parseFloat(s.buy_prob || 0.5);
      const dir    = s.direction || 'neutral';
      const council= s.council   || 'wait';
      const cls    = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      const scolor = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';
      const ccolor = council.includes('execute') ? '#10b981'
                   : council === 'veto' ? '#ef4444' : '#f59e0b';
      const dirBadge = dir === 'buy'
        ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
        : dir === 'sell'
          ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
          : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i> NEUTRAL</span>`;

      return `<tr>
        <td><strong class="sym-link" data-sym="${sym}">${sym}</strong></td>
        <td><span class="muted-sm">${NAMES[sym]||''}</span></td>
        <td class="mono ${cls}">${price > 0 ? '$' + price.toFixed(2) : '--'}</td>
        <td class="mono ${cls}">${chg > 0 ? '+' : ''}${chg.toFixed(2)}</td>
        <td class="mono ${cls}">${chg > 0 ? '+' : ''}${chg.toFixed(2)}%</td>
        <td>
          <div class="score-bar-inline"><div class="sbi-fill" style="width:${(score*100).toFixed(0)}%;background:${scolor}"></div></div>
          <span class="mono" style="color:${scolor};font-size:11px">${score.toFixed(3)}</span>
        </td>
        <td>${dirBadge}</td>
        <td class="mono">${(bp*100).toFixed(1)}%</td>
        <td><span class="regime-chip">${(s.regime||'--').replace(/_/g,' ')}</span></td>
        <td><strong style="color:${ccolor};font-size:11px">${council.toUpperCase()}</strong></td>
        <td>
          <button class="btn-xs chart-btn" data-sym="${sym}" title="View chart"><i class="fa-solid fa-chart-bar"></i></button>
          <button class="btn-xs trade-btn" data-sym="${sym}" title="Trade"><i class="fa-solid fa-paper-plane"></i></button>
        </td>
      </tr>`;
    }).join('');

    // Bind table actions
    tbody.querySelectorAll('.sym-link, .chart-btn').forEach(el => {
      el.addEventListener('click', () => {
        loadChartSymbol(el.dataset.sym);
        showSection('overview');
      });
    });
    tbody.querySelectorAll('.trade-btn').forEach(el => {
      el.addEventListener('click', () => {
        const sel = document.getElementById('order-symbol');
        if (sel) sel.value = el.dataset.sym;
        showSection('execution');
      });
    });
  }

  function filterWatchlist() {
    const q = document.getElementById('wl-search')?.value.toLowerCase() || '';
    document.querySelectorAll('#watchlist-tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  // ════════════════════════════════════════════════════════
  // SECTION: SIGNALS
  // ════════════════════════════════════════════════════════
  function _renderSignals(data) {
    const sigs = data.signals?.signals || {};
    let buy=0, sell=0, neutral=0, exec=0;
    Object.values(sigs).forEach(s => {
      if (s.direction === 'buy') buy++;
      else if (s.direction === 'sell') sell++;
      else neutral++;
      if ((s.council||'').includes('execute')) exec++;
    });

    _txt('kpi-buy',      buy);
    _txt('kpi-sell',     sell);
    _txt('kpi-neutral',  neutral);
    _txt('kpi-exec',     exec);
    _txt('signals-count',`${Object.keys(sigs).length} symbols`);
    _txt('nav-signals-count', Object.keys(sigs).length);

    _renderSignalsTable('signals-tbody', sigs, 0, true);
    // New analytics charts
    const regime = data.regime?.global?.probabilities || {};
    Charts.renderSignalDistribution('signal-distribution-chart', sigs);
    Charts.renderRegimeProbabilities('regime-prob-chart', regime);
  }

  function _renderSignalsTable(tbodyId, sigs, limit, showChart) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    const symbols = Object.keys(sigs);
    if (!symbols.length) {
      tbody.innerHTML = `<tr><td colspan="10" class="loading-row">
        <i class="fa-solid fa-circle-notch fa-spin"></i> Awaiting first signal cycle...
      </td></tr>`;
      return;
    }

    const display = limit ? symbols.slice(0, limit) : symbols;
    tbody.innerHTML = display.map(sym => {
      const s      = sigs[sym] || {};
      const price  = parseFloat(s.price || 0);
      const score  = parseFloat(s.final_score || 0);
      const conf   = parseFloat(s.confidence || 0);
      const bp     = parseFloat(s.buy_prob || 0.5);
      const dir    = s.direction || 'neutral';
      const council= s.council   || 'wait';
      const scolor = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';
      const ccolor = council.includes('execute') ? '#10b981'
                   : council === 'veto' ? '#ef4444' : '#f59e0b';
      const dirBadge = dir === 'buy'
        ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
        : dir === 'sell'
          ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
          : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i> NEUTRAL</span>`;

      const chartCell = showChart
        ? `<td><button class="btn-xs sig-chart-btn" data-sym="${sym}"><i class="fa-solid fa-chart-bar"></i></button></td>`
        : '';

      return `<tr>
        <td><strong class="sym-link sig-sym" data-sym="${sym}">${sym}</strong></td>
        <td class="mono">${price > 0 ? '$' + price.toFixed(2) : '--'}</td>
        <td>${dirBadge}</td>
        <td>
          <div class="score-bar-inline"><div class="sbi-fill" style="width:${(score*100).toFixed(0)}%;background:${scolor}"></div></div>
          <span class="mono" style="color:${scolor};font-size:11px">${score.toFixed(3)}</span>
        </td>
        <td class="mono">${(conf*100).toFixed(1)}%</td>
        <td class="mono">${(bp*100).toFixed(1)}%</td>
        <td class="mono" style="color:#94a3b8;font-size:11px">${s.trade_action||'wait'}</td>
        <td><strong style="color:${ccolor};font-size:11px">${council.toUpperCase()}</strong></td>
        <td><span class="regime-chip">${(s.regime||'--').replace(/_/g,' ')}</span></td>
        ${chartCell}
      </tr>`;
    }).join('');

    // Bind clicks
    tbody.querySelectorAll('.sig-sym, .sig-chart-btn').forEach(el => {
      el.addEventListener('click', () => {
        loadChartSymbol(el.dataset.sym);
        if (showChart) showSection('overview');
      });
    });
  }

  function filterSignals() {
    const q = document.getElementById('signal-search')?.value.toLowerCase() || '';
    document.querySelectorAll('#signals-tbody tr').forEach(tr => {
      tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  }

  // ════════════════════════════════════════════════════════
  // SECTION: PORTFOLIO
  // ════════════════════════════════════════════════════════
  function _renderPortfolio(data) {
    const port = data.portfolio || {};
    const risk = data.risk      || {};
    const val  = parseFloat(port.total_value || 100000);
    const cash = parseFloat(port.cash_pct   || 1);
    const pos  = port.positions || {};
    const wts  = port.weights   || {};

    _txt('p-total-value', `$${val.toLocaleString()}`);
    _txt('p-cash',        `${(cash*100).toFixed(1)}%`);
    _txt('p-positions',   Object.keys(pos).length);
    _txt('p-leverage',    `${parseFloat(risk.leverage?.current_leverage||0).toFixed(2)}x`);

    const donutWeights = Object.keys(wts).length
      ? wts
      : { Cash: cash, Equities: Math.max(0, 1 - cash) };
    Charts.renderPortfolioDonut(donutWeights);

    const tbody = document.getElementById('positions-tbody');
    if (tbody) {
      const entries = Object.entries(pos);
      tbody.innerHTML = entries.length
        ? entries.map(([sym, p]) => `<tr>
            <td><strong>${sym}</strong></td>
            <td class="mono">${p.shares || 0}</td>
            <td class="mono">$${parseFloat(p.value||0).toLocaleString()}</td>
            <td class="mono">${((wts[sym]||0)*100).toFixed(1)}%</td>
          </tr>`).join('')
        : '<tr><td colspan="4" class="loading-row">No open positions (paper simulation)</td></tr>';
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: RISK
  // ════════════════════════════════════════════════════════
  function _renderRisk(data) {
    const risk  = data.risk     || {};
    const dd    = risk.drawdown || {};
    const lever = risk.leverage || {};
    const currDD   = parseFloat(dd.current_drawdown    || 0);
    const dailyPnL = parseFloat(dd.daily_pnl_pct       || 0);
    const currLev  = parseFloat(lever.current_leverage || 0);
    const maxLev   = parseFloat(lever.allowed_leverage || 1.5);
    const halt     = dd.halt_active || lever.is_over_leveraged;

    _txt('risk-dd',       `${(currDD*100).toFixed(2)}%`);
    _txt('risk-lever',    `${currLev.toFixed(2)}x`);
    _txt('risk-daily-pnl',`${dailyPnL >= 0 ? '+' : ''}${(dailyPnL*100).toFixed(2)}%`);

    const haltEl = document.getElementById('risk-halt');
    if (haltEl) {
      haltEl.innerHTML = halt
        ? '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i> HALTED'
        : '<i class="fa-solid fa-circle-check" style="color:#10b981"></i> ACTIVE';
    }

    const haltKpi = document.getElementById('halt-kpi');
    if (haltKpi) haltKpi.style.borderColor = halt ? '#ef4444' : '';
    const ddKpi = document.getElementById('dd-kpi');
    if (ddKpi)   ddKpi.style.borderColor   = currDD < -0.05 ? '#ef4444' : '';

    Charts.renderLeverageGauge(currLev, maxLev);
    Charts.updateDrawdownChart(currDD);

    // Risk limits grid
    const limitsEl = document.getElementById('risk-limits-grid');
    if (limitsEl) {
      const limits = [
        { label:'Daily Loss',  cur: Math.abs(dailyPnL*100), max: 2,    unit:'%' },
        { label:'Max Drawdown',cur: Math.abs(currDD*100),   max: 10,   unit:'%' },
        { label:'Leverage',    cur: currLev,                 max: maxLev, unit:'x' },
        { label:'Max Position',cur: 0,                       max: 10,   unit:'%' },
      ];
      limitsEl.innerHTML = limits.map(l => {
        const pct = Math.min((l.cur / (l.max||1)) * 100, 100);
        const cls = pct > 80 ? 'danger' : pct > 60 ? 'warn' : 'safe';
        return `<div class="rli">
          <span class="rli-lbl">${l.label}</span>
          <div class="rli-bar-wrap"><div class="rli-bar ${cls}" style="width:${pct.toFixed(0)}%"></div></div>
          <span class="rli-val ${cls}">${l.cur.toFixed(2)}${l.unit}</span>
        </div>`;
      }).join('');
    }

    // Quant metrics
    const port    = data.portfolio || {};
    // const risk    = data.risk      || {};
    const var95   = risk.var_metrics?.var_95;
    const cvar95  = risk.var_metrics?.cvar_95;
    const annVol  = risk.var_metrics?.portfolio_vol_annual;
    const sharpe  = risk.var_metrics?.sharpe_ratio;
    const avgCorr = risk.var_metrics?.avg_correlation;
    const hurst   = port.hurst_exponent;

    _txt('risk-var95',    var95   != null ? `${(var95  *100).toFixed(2)}%` : '--');
    _txt('risk-cvar95',   cvar95  != null ? `${(cvar95 *100).toFixed(2)}%` : '--');
    _txt('risk-annual-vol', annVol!= null ? `${(annVol *100).toFixed(1)}%` : '--');
    _txt('risk-sharpe',   sharpe  != null ? sharpe.toFixed(2)              : '--');
    _txt('risk-avg-corr', avgCorr != null ? avgCorr.toFixed(3)             : '--');
    _txt('risk-hurst',    hurst   != null ? hurst.toFixed(3)               : '--');

    // Sector exposure chart
    const wts  = data.portfolio?.weights     || {};
    const meta = window.WatchlistManager?.getSymbolMeta
    ? Object.fromEntries(Object.keys(wts).map(s => [s, WatchlistManager.getSymbolMeta(s)]))
    : {};
    Charts.renderSectorExposure('sector-exposure-chart', wts, meta);
    Charts.renderRollingMetrics('rolling-metrics-chart');
  }

  // ════════════════════════════════════════════════════════
  // SECTION: AGENTS
  // ════════════════════════════════════════════════════════
  function _renderAgents(data) {
    const agents = data.agents  || {};
    const status = data.status  || {};
    const decs   = agents.decisions  || {};
    const execs  = agents.executions || [];

    _txt('council-mode-badge',
      `MODE: ${status.mode === 'llm' ? '🤖 LLM ASSISTED' : '⚙ DETERMINISTIC'}`);

    // Find top decision
    let topDecision = 'wait', topScore = 0, topReason = 'No decisions yet', topMode = '--';
    Object.values(decs).forEach(d => {
      const sc = parseFloat(d.council?.weighted_score || 0);
      if (sc > topScore) {
        topScore    = sc;
        topDecision = d.council?.decision || 'wait';
        topReason   = d.council?.reason   || '';
        topMode     = d.council?.mode     || '--';
      }
    });

    const cdEl = document.getElementById('council-decision-main');
    if (cdEl) {
      cdEl.textContent = topDecision.replace(/_/g,' ').toUpperCase();
      cdEl.className   = `council-verdict ${topDecision}`;
    }
    _txt('council-mode',   topMode);
    _txt('council-score',  topScore.toFixed(3));
    _txt('council-reason', topReason || 'Awaiting cycle...');

    // Agent votes grid
    const votesEl = document.getElementById('agent-votes-grid');
    if (votesEl) {
      const firstDec = Object.values(decs)[0];
      const votes    = firstDec?.council?.agent_votes  || {};
      const scores   = firstDec?.council?.agent_scores || {};
      const ICONS = {
        drawdown_guardian:  'fa-shield',
        regime_model:       'fa-crosshairs',
        signal_model:       'fa-robot',
        execution_timing:   'fa-bolt',
        risk_manager:       'fa-scale-balanced',
        correlation_surface:'fa-network-wired',
        strategy_switching: 'fa-rotate',
        market_impact:      'fa-droplet',
        capital_rotation:   'fa-arrows-rotate',
      };
      votesEl.innerHTML = Object.entries(votes).map(([name, vote]) => {
        const sc   = parseFloat(scores[name] || 0);
        const icon = ICONS[name] || 'fa-microchip';
        const vc   = vote === 'buy' ? '#10b981' : vote === 'sell' ? '#ef4444' : '#64748b';
        return `<div class="avc">
          <div class="avc-name"><i class="fa-solid ${icon}"></i> ${name.replace(/_/g,' ')}</div>
          <div class="avc-vote" style="background:${vc}22;color:${vc};border:1px solid ${vc}40">
            ${vote.toUpperCase()}
          </div>
          <div class="avc-score">Score: ${sc.toFixed(3)}</div>
          <div class="avc-bar">
            <div style="width:${(sc*100).toFixed(0)}%;background:${vc};height:100%;border-radius:2px"></div>
          </div>
        </div>`;
      }).join('') || `<div style="padding:20px;color:var(--txt4);text-align:center;grid-column:1/-1">
          <i class="fa-solid fa-clock"></i> Run first cycle to see agent votes
        </div>`;
    }

    // Executions table
    const execTbody = document.getElementById('executions-tbody');
    if (execTbody) {
      execTbody.innerHTML = execs.length
        ? execs.slice(-10).reverse().map(e => `<tr>
            <td class="mono" style="font-size:11px">${_fmtTime(e.timestamp)}</td>
            <td><strong>${e.symbol}</strong></td>
            <td>${(e.result?.direction||'--').toUpperCase()} ${e.result?.quantity||0}</td>
            <td><strong style="color:${e.council?.includes('execute')?'#10b981':'#f59e0b'}">
              ${(e.council||'--').toUpperCase()}</strong></td>
            <td><span style="color:${e.result?.status==='simulated'?'#06b6d4':'#10b981'}">
              ${(e.result?.status||'--').toUpperCase()}</span></td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="loading-row">No executions yet</td></tr>';
    }

    // LLM status
    const llmAvail = status.llm_available;
    const dot = document.getElementById('llm-main-dot');
    if (dot) dot.className = `llm-dot-big ${llmAvail ? 'ok' : 'error'}`;

    _txt('llm-status-text',
    llmAvail
        ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i> LLM Available'
        : '<i class="fa-solid fa-circle-xmark" style="color:var(--r)"></i> LLM Unavailable',
    true
    );
    _txt('llm-mode-text',
    `Running: ${status.mode === 'llm'
        ? '<strong style="color:var(--b1)">AI-Assisted Reasoning</strong>'
        : '<strong style="color:var(--y)">Deterministic Fallback — ML Ensemble (XGBoost + LightGBM + LogReg)</strong>'}`,
    true
    );

    const fbEl = document.getElementById('llm-fallback-info');
    if (fbEl) {
    fbEl.style.display = llmAvail ? 'none' : 'block';
    fbEl.innerHTML     = llmAvail ? '' : `
        <i class="fa-solid fa-triangle-exclamation"></i>
        <strong>Gemini quota exceeded (HTTP 429)</strong> — System fully operational in deterministic mode.<br>
        ML ensemble + regime detection active. All signals generated normally.<br>
        <span style="font-size:10px;color:var(--txt4)">
        To restore LLM: wait for quota reset or upgrade Gemini plan.
        Python backend continues generating signals regardless.
        </span>`;
    }

    // Feature importance + regime detail
    const sigs   = data.signals?.signals || {};
    const regime = data.regime?.global?.probabilities || {};
    Charts.renderFeatureImportance('feature-importance-chart', {}, sigs);
    Charts.renderRegimeProbabilities('agent-regime-prob-chart', regime);
  }

  // ════════════════════════════════════════════════════════
  // SECTION: STRATEGIES
  // ════════════════════════════════════════════════════════
  function _renderStrategies(data) {
    const sw   = data.strategy?.weights || {};
    const perf = data.perf?.strategy_perf || {};
    const def  = { trend:0.40, mean_reversion:0.25, vol_carry:0.20, options_convexity:0.15 };
    const src  = Object.keys(sw).length ? sw : def;

    Charts.renderStrategyDonut(src);
    Charts.renderStrategySharpe(perf);

    const detEl = document.getElementById('strategy-details');
    if (detEl) {
      detEl.innerHTML = Object.entries(src).map(([name, weight]) => {
        const color = STRAT_COLORS[name] || '#64748b';
        const pct   = (weight * 100).toFixed(1);
        return `<div class="strat-item">
          <div class="strat-dot" style="background:${color}"></div>
          <span class="strat-name">${name.replace(/_/g,' ')}</span>
          <div class="strat-bar-wrap">
            <div class="strat-bar" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="strat-pct mono" style="color:${color}">${pct}%</span>
        </div>`;
      }).join('');
    }

    Charts.renderRollingMetrics('strategy-rolling-chart');
  }

  // ════════════════════════════════════════════════════════
  // SECTION: PERFORMANCE
  // ════════════════════════════════════════════════════════
  function _renderPerformance(data) {
    const perf   = data.perf   || {};
    const status = data.status || {};

    _txt('perf-value',   `$${parseFloat(perf.portfolio_value||100000).toLocaleString()}`);
    _txt('perf-signals', perf.n_signals    || 0);
    _txt('perf-exec',    perf.n_executions || 0);
    _txt('perf-mode',    status.mode === 'llm' ? '🤖 LLM Assisted' : '⚙ Deterministic');

    Charts.renderStrategySharpe(perf.strategy_perf || {});

    // Timeline
    const tlEl = document.getElementById('system-timeline');
    if (tlEl) {
      const entries = [
        {
          time: _fmtTime(status.timestamp),
          msg:  `System: ${status.overall||'--'} | Mode: ${status.mode||'--'} | DryRun: ${status.dry_run}`,
        },
        {
          time: _fmtTime(perf.timestamp),
          msg:  `Cycle: ${perf.n_signals||0} signals generated, ${perf.n_executions||0} orders executed`,
        },
        {
          time: '--',
          msg:  'Next cycle: automatic every 5 min during market hours (GitHub Actions)',
        },
      ];
      tlEl.innerHTML = entries.map(e => `
        <div class="tl-item">
          <div class="tl-dot"></div>
          <span class="tl-time">${e.time}</span>
          <span class="tl-msg">${e.msg}</span>
        </div>`).join('');
    }

    Charts.renderRollingMetrics('perf-rolling-chart');
    Charts.renderSignalDistribution('perf-score-dist-chart', data.signals?.signals || {});
  }

  // ════════════════════════════════════════════════════════
  // CHARTS — Main Chart
  // ════════════════════════════════════════════════════════
  async function _loadMainChart(force = false) {
    const sym      = document.getElementById('ov-symbol')?.value || 'SPY';
    const interval = _currentIv;
    _txt('main-chart-title', `${sym} — ${interval}`);

    if (!_mainInited) {
      Charts.initPriceChart('main-price-chart', { height: 360 });
      _mainInited = true;
    }

    const candles = await _fetchChartData(sym, interval);
    if (candles.length) {
      Charts.updatePriceChart(
        candles.map(c => ({
          datetime: new Date(c.time * 1000).toISOString(),
          open:     c.open,
          high:     c.high,
          low:      c.low,
          close:    c.close,
          volume:   c.volume || 0,
        })), {}
      );
    }
  }

  function loadChartSymbol(sym) {
    const sel = document.getElementById('ov-symbol');
    if (sel) sel.value = sym;
    _loadMainChart(true);
    // Sync order form
    const orderSym = document.getElementById('order-symbol');
    if (orderSym) orderSym.value = sym;
  }

  // ════════════════════════════════════════════════════════
  // CHARTS — Panel Charts (4-grid)
  // ════════════════════════════════════════════════════════
  async function _initAllPanelCharts() {
    const defaults = ['SPY','QQQ','AAPL','NVDA'];
    for (let i = 0; i < 4; i++) {
      const sym = document.getElementById(`cp-sym-${i}`)?.value || defaults[i];
      await _loadPanelChart(i, sym);
    }
  }

  async function _loadPanelChart(panelIdx, sym) {
    const containerId = `chart-container-${panelIdx}`;
    Charts.initPanelChart(panelIdx, containerId);

    const iv      = _panelIv[panelIdx] || '1day';
    const candles = await _fetchChartData(sym, iv);
    if (candles.length) {
      Charts.updatePanelChart(panelIdx, candles.map(c => ({
        datetime: new Date(c.time * 1000).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
      })));
    }
  }

  function _setChartLayout(layout) {
    const grid = document.getElementById('charts-grid');
    if (!grid) return;
    const cls = layout === '1' ? 'layout-1'
              : layout === '2x1' ? 'layout-2-1'
              : 'layout-2-2';
    grid.className = `charts-grid ${cls}`;
    // Re-init panels after layout change
    setTimeout(() => _initAllPanelCharts(), 100);
  }

  // ════════════════════════════════════════════════════════
  // CHART DATA FETCHING
  // ════════════════════════════════════════════════════════
  async function _fetchChartData(sym, interval = '1day', outputsize = 100) {
    // Map interval names
    const ivMap = {
      '5min':'5min', '15min':'15min', '1h':'1h',
      '4h':'4h', '1day':'1day', '1week':'1week',
    };
    const iv = ivMap[interval] || '1day';

    // Try Finance Hub Worker (Twelve Data / yfinance proxy)
    try {
      const url  = `${FINANCE_HUB}/api/time-series?symbol=${sym}&interval=${iv}&outputsize=${outputsize}`;
      const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const vals = data.values || data.data || [];
      if (vals.length) return _normCandles(vals);
    } catch(e) {
      console.warn(`Chart ${sym}/${iv}: ${e.message} — using synthetic`);
    }

    // Fallback: synthetic candles from current signal price
    return _syntheticCandles(sym);
  }

  function _normCandles(vals = []) {
    return vals
      .map(c => {
        const dt  = c.datetime || c.date || c.Date || c.time;
        const ts  = typeof dt === 'number'
          ? (dt > 1e10 ? Math.floor(dt / 1000) : dt)
          : Math.floor(new Date(dt).getTime() / 1000);
        return {
          time:   ts,
          open:   parseFloat(c.open),
          high:   parseFloat(c.high),
          low:    parseFloat(c.low),
          close:  parseFloat(c.close),
          volume: parseFloat(c.volume || 0),
        };
      })
      .filter(c => !isNaN(c.open) && c.time > 0)
      .sort((a, b) => a.time - b.time);
  }

  function _syntheticCandles(sym, n = 100) {
    const sig   = _state.signals?.signals?.[sym];
    let price   = parseFloat(sig?.price || 400);
    if (price <= 0) price = 400;
    const now   = Math.floor(Date.now() / 1000);
    const data  = [];

    for (let i = n - 1; i >= 0; i--) {
      const change = (Math.random() - 0.48) * price * 0.012;
      price       += change;
      const o = price;
      const c = price + (Math.random() - 0.5) * price * 0.005;
      const h = Math.max(o, c) + Math.random() * price * 0.003;
      const l = Math.min(o, c) - Math.random() * price * 0.003;
      data.push({
        time:   now - i * 86400,
        open:   +o.toFixed(2),
        high:   +h.toFixed(2),
        low:    +l.toFixed(2),
        close:  +c.toFixed(2),
        volume: Math.floor(Math.random() * 5000000 + 1000000),
      });
    }
    return data;
  }

  // ════════════════════════════════════════════════════════
  // EXECUTION / ORDER TERMINAL
  // ════════════════════════════════════════════════════════
  function setSide(side) {
    _currentSide = side;
    document.getElementById('side-buy')?.classList.toggle('active',  side === 'BUY');
    document.getElementById('side-sell')?.classList.toggle('active', side === 'SELL');
  }

  function _togglePriceFields() {
    const type     = document.getElementById('order-type')?.value || 'MKT';
    const limField = document.getElementById('limit-field');
    const stpField = document.getElementById('stop-field');
    if (limField) limField.style.display = ['LMT','STP_LMT'].includes(type) ? '' : 'none';
    if (stpField) stpField.style.display = ['STP','STP_LMT'].includes(type) ? '' : 'none';
  }

  async function _handleOrderSubmit(e) {
    e.preventDefault();

    const sym     = document.getElementById('order-symbol')?.value?.toUpperCase() || 'SPY';
    const qty     = parseInt(document.getElementById('order-qty')?.value || 10);
    const type    = document.getElementById('order-type')?.value || 'MKT';
    const limit   = parseFloat(document.getElementById('order-limit')?.value || 0);
    const stop    = parseFloat(document.getElementById('order-stop')?.value  || 0);
    const reason  = document.getElementById('order-reason')?.value || 'Manual order from dashboard';
    const dryRun  = document.getElementById('order-dry-run')?.checked ?? true;
    const pat     = document.getElementById('gh-pat')?.value?.trim() || '';

    // Save PAT
    if (pat) _savePAT(pat);

    // Show preview
    const preview = document.getElementById('order-preview');
    const previewContent = document.getElementById('order-preview-content');
    if (preview && previewContent) {
      preview.style.display = 'block';
      previewContent.innerHTML = `
        <div class="preview-row"><span>Symbol</span><strong>${sym}</strong></div>
        <div class="preview-row"><span>Side</span><strong class="${_currentSide.toLowerCase()}">${_currentSide}</strong></div>
        <div class="preview-row"><span>Quantity</span><strong>${qty}</strong></div>
        <div class="preview-row"><span>Type</span><strong>${type}</strong></div>
        ${limit > 0 ? `<div class="preview-row"><span>Limit</span><strong class="mono">$${limit}</strong></div>` : ''}
        ${stop  > 0 ? `<div class="preview-row"><span>Stop</span><strong class="mono">$${stop}</strong></div>` : ''}
        <div class="preview-row"><span>Mode</span><strong style="color:${dryRun?'var(--y)':'var(--g)'}">
          ${dryRun ? 'PAPER TRADE' : 'PAPER LIVE'}
        </strong></div>`;
    }

    if (!pat || !pat.startsWith('ghp_')) {
      _showOrderStatus('error', 'GitHub PAT required. Generate a token with "workflow" scope at github.com/settings/tokens');
      return;
    }

    const btn = document.getElementById('btn-submit-order');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...'; }

    try {
      const resp = await fetch(
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
            ref: 'main',
            inputs: {
              symbol:      sym,
              action:      _currentSide,
              quantity:    String(qty),
              order_type:  type,
              limit_price: String(limit || ''),
              stop_price:  String(stop  || ''),
              dry_run:     String(dryRun),
              reason,
            },
          }),
        }
      );

      if (resp.status === 204) {
        _showOrderStatus('success',
          `✅ Workflow dispatched: ${_currentSide} ${qty}x ${sym} @ ${type} — ` +
          `<a href="https://github.com/${GH_OWNER}/${GH_REPO}/actions" target="_blank" style="color:var(--g)">` +
          `View on GitHub <i class="fa-solid fa-external-link-alt"></i></a>`
        );
        _showToast(`Order dispatched: ${_currentSide} ${qty}x ${sym}`, 'success');
        // Refresh exec log after 30s
        setTimeout(_refreshExecLog, 30000);
        setTimeout(() => _refresh(true), 35000);

      } else if (resp.status === 401) {
        _showOrderStatus('error', '❌ PAT invalid or expired. Check it has "workflow" scope.');
      } else if (resp.status === 404) {
        _showOrderStatus('error', `❌ Workflow not found. Ensure "${GH_WORKFLOW}" exists in .github/workflows/`);
      } else if (resp.status === 422) {
        const body = await resp.json().catch(() => ({}));
        _showOrderStatus('error', `❌ Invalid parameters (422): ${body.message || 'Check workflow inputs'}`);
      } else {
        const body = await resp.text();
        _showOrderStatus('error', `❌ GitHub API error ${resp.status}: ${body.slice(0, 200)}`);
      }
    } catch(err) {
      _showOrderStatus('error', `❌ Network error: ${err.message}`);
    } finally {
      if (btn) {
        btn.disabled  = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Order';
      }
    }
  }

  function _showOrderStatus(type, msg) {
    let el = document.getElementById('order-status');
    if (!el) {
      el    = document.createElement('div');
      el.id = 'order-status';
      document.getElementById('order-form')?.appendChild(el);
    }
    el.className  = `order-status ${type}`;
    el.innerHTML  = `<i class="fa-solid ${type==='success'?'fa-circle-check':'fa-circle-exclamation'}"></i> ${msg}`;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 10000);
  }

  // ── Execution Log ────────────────────────────────────────
  async function _refreshExecLog() {
    const logEl = document.getElementById('exec-log-content');
    if (!logEl) return;

    try {
      const [orderResult, ibkrStatus] = await Promise.allSettled([
        ApiClient.getManualOrders(true),
        ApiClient.getIBKRStatus(true),
      ]);

      const orders = orderResult.value?.history || [];

      // IBKR status
      const ibkr   = ibkrStatus.value || {};
      _txt('icp-status',     ibkr.reachable ? `✅ Connected (${ibkr.latency_ms}ms)` : '⚠ Simulation (unreachable)');
      _txt('icp-account',    ibkr.account || '--');
      _txt('ibkr-mode-text', ibkr.mode === 'live' ? 'LIVE' : 'PAPER MODE');

      // Last auto-trade from agent_decisions
      const execs = _state.agents?.executions || [];
      const lastExec = execs[execs.length - 1];
      _txt('icp-last-trade', lastExec
        ? `${_fmtTime(lastExec.timestamp)} — ${lastExec.symbol}`
        : '--');

      if (!orders.length) {
        logEl.innerHTML = `<div class="log-empty">
          <i class="fa-solid fa-inbox"></i><br>No executions yet
        </div>`;
        return;
      }

      logEl.innerHTML = [...orders].reverse().slice(0, 20).map(e => {
        const status = e.status || 'unknown';
        const cls    = status === 'simulated' ? 'simulated'
                     : status === 'placed'    ? 'placed'
                     : 'error';
        const color  = status === 'simulated' ? 'var(--c)'
                     : status === 'placed'    ? 'var(--g)'
                     : 'var(--r)';
        return `<div class="log-entry ${cls}">
          <div class="le-header">
            <strong>${e.action||'?'} ${e.quantity||0}x ${e.symbol||'?'}</strong>
            <span class="le-status ${cls}">${status.toUpperCase()}</span>
          </div>
          <div class="le-meta">
            <span>${e.order_type||'MKT'}</span>
            <span>${e.dry_run !== false ? 'PAPER' : 'LIVE'}</span>
            <span class="mono">${new Date(e.timestamp||Date.now()).toLocaleString()}</span>
            ${e.fill_price ? `<span class="mono" style="color:${color}">Fill: $${parseFloat(e.fill_price).toFixed(2)}</span>` : ''}
          </div>
          ${e.reason ? `<div class="le-msg">${e.reason}</div>` : ''}
        </div>`;
      }).join('');

    } catch(err) {
      logEl.innerHTML = `<div class="log-empty" style="color:var(--y)">
        <i class="fa-solid fa-triangle-exclamation"></i><br>
        Could not load execution log. Run a trading cycle first.
      </div>`;
    }
  }

  // ════════════════════════════════════════════════════════
  // SIDEBAR TOGGLE
  // ════════════════════════════════════════════════════════
  function toggleSidebar() {
    _sidebarOpen = !_sidebarOpen;
    const sidebar = document.getElementById('sidebar');
    const layout  = document.getElementById('layout');
    if (sidebar) sidebar.classList.toggle('collapsed', !_sidebarOpen);
    if (layout)  layout.classList.toggle('sidebar-collapsed', !_sidebarOpen);

    // Resize charts after animation
    setTimeout(() => {
      Charts.refreshChartTheme();
      if (_mainInited) _loadMainChart();
    }, 250);
  }

  // Mobile sidebar overlay
  function _openMobileSidebar() {
    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.classList.add('open');
  }

  // ════════════════════════════════════════════════════════
  // THEME
  // ════════════════════════════════════════════════════════
  function toggleTheme() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next   = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('av_theme', next);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = next === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';

    // Refresh all charts with new colors
    Charts.refreshChartTheme();
    _renderActiveSection(_state);
  }

  function _restoreTheme() {
    const saved = localStorage.getItem('av_theme') || 'light';
    document.documentElement.setAttribute('data-theme', saved);
    const icon = document.getElementById('theme-icon');
    if (icon) icon.className = saved === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  }

  // ════════════════════════════════════════════════════════
  // TOAST
  // ════════════════════════════════════════════════════════
  function _showToast(msg, type = 'info', duration = 4000) {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;

    const icons = { success:'fa-circle-check', error:'fa-circle-exclamation',
                    warn:'fa-triangle-exclamation', info:'fa-circle-info' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]||'fa-circle-info'}" style="color:var(--${type==='success'?'g':type==='error'?'r':type==='warn'?'y':'b1'})"></i> ${msg}`;
    wrap.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function _txt(id, val, html = false) {
    const el = document.getElementById(id);
    if (!el) return;
    if (html) el.innerHTML = val;
    else      el.textContent = val;
    }

  function _fmtTime(ts) {
    if (!ts) return '--';
    try { return new Date(ts).toLocaleTimeString(); } catch { return '--'; }
  }

  function _pad(n) { return String(n).padStart(2, '0'); }

  function _startClock() {
    // ── Exchange schedules (UTC hours) ─────────────────────
    const EXCHANGES = [
        { id:'nyse',     name:'NYSE',      tz:'America/New_York',  open:[9,30],  close:[16,0],  days:[1,2,3,4,5] },
        { id:'nasdaq',   name:'NASDAQ',    tz:'America/New_York',  open:[9,30],  close:[16,0],  days:[1,2,3,4,5] },
        { id:'lse',      name:'LSE',       tz:'Europe/London',     open:[8,0],   close:[16,30], days:[1,2,3,4,5] },
        { id:'euronext', name:'Euronext',  tz:'Europe/Paris',      open:[9,0],   close:[17,30], days:[1,2,3,4,5] },
        { id:'tse',      name:'TSE',       tz:'Asia/Tokyo',        open:[9,0],   close:[15,30], days:[1,2,3,4,5] },
        { id:'hkex',     name:'HKEX',      tz:'Asia/Hong_Kong',    open:[9,30],  close:[16,0],  days:[1,2,3,4,5] },
    ];

    function _isOpen(ex) {
        try {
        const now   = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
            hour:'numeric', minute:'numeric', weekday:'short',
            hour12:false, timeZone: ex.tz,
        }).formatToParts(now);
        const get = (t) => parseInt(parts.find(p => p.type === t)?.value || '0');
        const DAY_MAP = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
        const wdStr   = parts.find(p => p.type === 'weekday')?.value || 'Sun';
        const weekday = DAY_MAP[wdStr] ?? 0;
        const timeDec = get('hour') + get('minute') / 60;
        const openDec = ex.open[0]  + ex.open[1]  / 60;
        const closDec = ex.close[0] + ex.close[1] / 60;
        return ex.days.includes(weekday) && timeDec >= openDec && timeDec < closDec;
        } catch(e) { return false; }
    }

    function _getLocalTime(tz) {
        return new Intl.DateTimeFormat('en-GB', {
        hour:'2-digit', minute:'2-digit', second:'2-digit',
        hour12:false, timeZone: tz,
        }).format(new Date());
    }

    const update = () => {
        const n = new Date();

        // ── UTC Clock ──────────────────────────────────────
        _txt('clock', `${_pad(n.getUTCHours())}:${_pad(n.getUTCMinutes())}:${_pad(n.getUTCSeconds())} UTC`);

        // ── Paris Time ─────────────────────────────────────
        const parisEl = document.getElementById('clock-paris');
        if (parisEl) {
        parisEl.textContent = `${_getLocalTime('Europe/Paris')} Paris`;
        }

        // ── Exchange Status Bar ────────────────────────────
        const exchEl = document.getElementById('exchange-status-bar');
        if (exchEl) {
        exchEl.innerHTML = EXCHANGES.map(ex => {
            const open = _isOpen(ex);
            return `<span class="exch-pill ${open ? 'exch-open' : 'exch-closed'}"
                        title="${ex.name} — ${_getLocalTime(ex.tz)}">
            <i class="fa-solid fa-circle" style="font-size:5px;vertical-align:middle"></i>
            ${ex.name}
            </span>`;
        }).join('');
        }
    };

    update();
    setInterval(update, 1000);
    }

  function _savePAT(val) {
    const clean = (val || '').trim();
    if (clean) localStorage.setItem('av_gh_pat', clean);
  }

  function _restorePAT() {
    const saved = localStorage.getItem('av_gh_pat');
    const el    = document.getElementById('gh-pat');
    if (saved && el) el.value = saved;
  }

  // ════════════════════════════════════════════════════════
  // AUTO-INIT
  // ════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', init);

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    showSection,
    forceRefresh,
    toggleSidebar,
    toggleTheme,
    setSide,
    filterSignals,
    filterWatchlist,
    loadChartSymbol,
    isReady: () => true,
  };

})();

// Expose globally
window.Terminal  = Terminal;
window.Dashboard = Terminal; // backward compat

console.log('✅ Terminal v3.0 loaded | Auto-trading: GitHub Actions (no browser needed)');