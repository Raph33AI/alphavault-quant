// ============================================================
// stock-detail.js — AlphaVault Quant v3.0
// ✅ Yahoo Finance UNIQUEMENT (via yahoo-proxy Worker)
// ✅ Panel slide-in : Overview, Chart, News, Financials, Earnings
// ✅ LightweightCharts pour mini-chart
// ✅ Données : price, stats, news, EPS, calendar, profile
// ============================================================

// ════════════════════════════════════════════════════════════
// YAHOO FINANCE CLIENT — Yahoo Proxy uniquement
// ════════════════════════════════════════════════════════════
const YahooFinance = (() => {

  const PROXY  = 'https://yahoo-proxy.raphnardone.workers.dev';
  const _cache = new Map();
  const TTL    = 60_000; // 60s

  async function _fetch(path, bustCache = false) {
    const key = path;
    const now = Date.now();
    const hit = _cache.get(key);
    if (!bustCache && hit && (now - hit.ts) < TTL) return hit.data;

    try {
      const resp = await fetch(`${PROXY}${path}`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      _cache.set(key, { data, ts: now });
      return data;
    } catch(e) {
      console.warn(`YahooFinance fetch ${path}: ${e.message}`);
      if (hit?.data) return hit.data;
      return null;
    }
  }

  // ── Quote / Real-time price ──────────────────────────────
  async function getQuote(sym) {
    const data = await _fetch(`/chart/${sym}?interval=1d&range=5d`);
    if (!data?.chart?.result?.[0]) return null;
    const r     = data.chart.result[0];
    const meta  = r.meta;
    const close = r.indicators?.quote?.[0]?.close || [];
    const last  = close.filter(v => v != null).pop();
    const prev  = close.filter(v => v != null).slice(-2)[0] || last;
    const chg   = last && prev ? ((last - prev) / prev * 100) : 0;
    return {
      symbol:      meta.symbol,
      price:       last || meta.regularMarketPrice || 0,
      prev_close:  meta.previousClose || prev || 0,
      change:      last - (meta.previousClose || prev),
      change_pct:  chg,
      open:        meta.regularMarketOpen,
      high:        meta.regularMarketDayHigh,
      low:         meta.regularMarketDayLow,
      volume:      meta.regularMarketVolume,
      market_cap:  meta.marketCap,
      currency:    meta.currency || 'USD',
      exchange:    meta.exchangeName || '',
      source:      'yahoo',
    };
  }

  // ── OHLCV Chart Data ─────────────────────────────────────
  async function getChart(sym, interval = '1d', range = '1y') {
    const data = await _fetch(`/chart/${sym}?interval=${interval}&range=${range}`, true);
    if (!data?.chart?.result?.[0]) return [];
    const r          = data.chart.result[0];
    const timestamps = r.timestamp || [];
    const quotes     = r.indicators?.quote?.[0] || {};
    return timestamps.map((ts, i) => ({
      time:   ts,
      open:   parseFloat((quotes.open?.[i] || 0).toFixed(4)),
      high:   parseFloat((quotes.high?.[i] || 0).toFixed(4)),
      low:    parseFloat((quotes.low?.[i]  || 0).toFixed(4)),
      close:  parseFloat((quotes.close?.[i]|| 0).toFixed(4)),
      volume: Math.round(quotes.volume?.[i] || 0),
    })).filter(c => c.close > 0);
  }

  // ── Financial Summary ─────────────────────────────────────
  async function getFinancials(sym) {
    const data = await _fetch(`/summary/${sym}`);
    return data?.quoteSummary?.result?.[0] || null;
  }

  // ── News ──────────────────────────────────────────────────
  async function getNews(sym) {
    const data = await _fetch(`/news/${sym}`, true);
    return data?.news || [];
  }

  // ── Profile (alias for summary) ───────────────────────────
  async function getProfile(sym) {
    const fin = await getFinancials(sym);
    return fin?.assetProfile || null;
  }

  // ── Search symbols ────────────────────────────────────────
  async function search(q) {
    const data = await _fetch(`/search/${encodeURIComponent(q)}`);
    return data?.quotes || [];
  }

  return { getQuote, getChart, getFinancials, getNews, getProfile, search };

})();

window.YahooFinance = YahooFinance;

// ════════════════════════════════════════════════════════════
// STOCK DETAIL PANEL
// ════════════════════════════════════════════════════════════
const StockDetail = (() => {

  let _currentSym   = null;
  let _activeTab    = 'overview';
  let _panelChart   = null;
  let _panelSeries  = null;
  let _currentIv    = '1d';
  let _currentRange = '1y';
  let _data         = {};   // Cached data per symbol

  // ── HTML Template ────────────────────────────────────────
  function _createPanel() {
    if (document.getElementById('stock-detail-overlay')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="stock-detail-overlay" id="stock-detail-overlay"></div>
      <div class="stock-detail-panel" id="stock-detail-panel">

        <!-- Header -->
        <div class="sdp-header">
          <div>
            <div class="sdp-sym" id="sdp-sym">--</div>
            <div class="sdp-name" id="sdp-name">Loading...</div>
          </div>
          <div id="sdp-sector-badge" style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(59,130,246,0.1);color:var(--b1);border:1px solid rgba(59,130,246,0.2)">--</div>
          <button class="sdp-btn wl" id="sdp-wl-toggle" title="Toggle watchlist" style="flex:none;width:34px;height:34px;padding:0">
            <i class="fa-regular fa-star"></i>
          </button>
          <button class="sdp-close" id="sdp-close-btn">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>

        <!-- Price Header -->
        <div class="sdp-price-header">
          <div class="sdp-price" id="sdp-price">--</div>
          <div class="sdp-change" id="sdp-change">--</div>
          <div style="display:flex;flex-direction:column;gap:2px;margin-left:4px">
            <span style="font-size:10px;color:var(--txt4)" id="sdp-volume-label">Vol: --</span>
            <span style="font-size:10px;color:var(--txt4)" id="sdp-mktcap-label">Cap: --</span>
          </div>
          <div class="sdp-mkt-status" id="sdp-mkt-status" style="background:rgba(16,185,129,0.1);color:var(--g);border:1px solid rgba(16,185,129,0.25)">LIVE</div>
        </div>

        <!-- Tabs -->
        <div class="sdp-tabs">
          <button class="sdp-tab active" data-tab="overview"><i class="fa-solid fa-chart-pie"></i> Overview</button>
          <button class="sdp-tab" data-tab="chart"><i class="fa-solid fa-chart-candlestick"></i> Chart</button>
          <button class="sdp-tab" data-tab="financials"><i class="fa-solid fa-dollar-sign"></i> Financials</button>
          <button class="sdp-tab" data-tab="earnings"><i class="fa-solid fa-calendar-check"></i> Earnings</button>
          <button class="sdp-tab" data-tab="news"><i class="fa-solid fa-newspaper"></i> News</button>
        </div>

        <!-- Content -->
        <div class="sdp-content" id="sdp-content">
          <div class="sdp-loading">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size:24px;color:var(--b1)"></i>
            <span>Loading Yahoo Finance data...</span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div class="sdp-actions">
          <button class="sdp-btn buy" id="sdp-btn-buy">
            <i class="fa-solid fa-arrow-up"></i> BUY
          </button>
          <button class="sdp-btn sell" id="sdp-btn-sell">
            <i class="fa-solid fa-arrow-down"></i> SELL
          </button>
          <button class="sdp-btn chart" id="sdp-btn-mainchart">
            <i class="fa-solid fa-chart-bar"></i> Main Chart
          </button>
        </div>
      </div>`);

    // Bind static events
    document.getElementById('stock-detail-overlay')
      .addEventListener('click', close);
    document.getElementById('sdp-close-btn')
      .addEventListener('click', close);

    document.querySelectorAll('.sdp-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    document.getElementById('sdp-btn-buy').addEventListener('click', () => {
      const sel = document.getElementById('order-symbol');
      if (sel) sel.value = _currentSym;
      if (window.Terminal) window.Terminal.showSection('execution');
      close();
    });

    document.getElementById('sdp-btn-sell').addEventListener('click', () => {
      const sel = document.getElementById('order-symbol');
      if (sel) { sel.value = _currentSym; }
      if (window.Terminal) {
        window.Terminal.setSide?.('SELL');
        window.Terminal.showSection('execution');
      }
      close();
    });

    document.getElementById('sdp-btn-mainchart').addEventListener('click', () => {
      if (window.Terminal) {
        window.Terminal.loadChartSymbol?.(_currentSym);
        window.Terminal.showSection('overview');
      }
      close();
    });

    document.getElementById('sdp-wl-toggle').addEventListener('click', () => {
      if (window.WatchlistManager) {
        if (WatchlistManager.isInWatchlist(_currentSym)) {
          WatchlistManager.removeSymbol(_currentSym);
        } else {
          WatchlistManager.addSymbol(_currentSym);
        }
        _updateWLButton();
      }
    });
  }

  // ── Open Panel ───────────────────────────────────────────
  async function open(sym) {
    if (!sym) return;
    _currentSym = sym.toUpperCase();
    _activeTab  = 'overview';
    _createPanel();

    // Show panel
    const overlay = document.getElementById('stock-detail-overlay');
    const panel   = document.getElementById('stock-detail-panel');
    overlay.classList.add('open');
    panel.classList.add('open');

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Set initial header
    const meta = window.WatchlistManager?.getSymbolMeta(_currentSym);
    _setText('sdp-sym',  _currentSym);
    _setText('sdp-name', meta?.name || _currentSym);
    _setText('sdp-sector-badge', meta?.sector || '--');
    _updateWLButton();

    // Show loading
    const content = document.getElementById('sdp-content');
    if (content) content.innerHTML = `
      <div class="sdp-loading">
        <i class="fa-solid fa-circle-notch fa-spin" style="font-size:24px;color:var(--b1)"></i>
        <span>Loading Yahoo Finance data for ${_currentSym}...</span>
      </div>`;

    // Fetch all data in parallel
    await _fetchAllData(_currentSym);

    // Render first tab
    _switchTab('overview');
  }

  // ── Close Panel ──────────────────────────────────────────
  function close() {
    const overlay = document.getElementById('stock-detail-overlay');
    const panel   = document.getElementById('stock-detail-panel');
    if (overlay) overlay.classList.remove('open');
    if (panel)   panel.classList.remove('open');
    document.body.style.overflow = '';

    // Destroy panel chart
    if (_panelChart) {
      try { _panelChart.remove(); } catch(e) {}
      _panelChart = null; _panelSeries = null;
    }
  }

  // ── Fetch All Yahoo Data ─────────────────────────────────
  async function _fetchAllData(sym) {
    _data[sym] = _data[sym] || {};

    // Parallel fetch
    const [quote, summary, news] = await Promise.allSettled([
      YahooFinance.getQuote(sym),
      YahooFinance.getFinancials(sym),
      YahooFinance.getNews(sym),
    ]);

    _data[sym].quote   = quote.value   || null;
    _data[sym].summary = summary.value || null;
    _data[sym].news    = news.value    || [];

    // Update price header from quote
    const q = _data[sym].quote;
    if (q) {
      const price  = parseFloat(q.price   || 0);
      const chgPct = parseFloat(q.change_pct || 0);
      const cls    = chgPct >= 0 ? 'up' : 'down';

      _setText('sdp-price', price > 0 ? `$${price.toFixed(2)}` : '--');
      const chgEl = document.getElementById('sdp-change');
      if (chgEl) {
        chgEl.textContent = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
        chgEl.className   = `sdp-change ${cls}`;
      }
      _setText('sdp-volume-label', `Vol: ${_fmtNum(q.volume)}`);
      _setText('sdp-mktcap-label', `Cap: ${_fmtMarketCap(q.market_cap)}`);
    }
  }

  // ── Switch Tab ───────────────────────────────────────────
  function _switchTab(tab) {
    _activeTab = tab;
    document.querySelectorAll('.sdp-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });

    switch(tab) {
      case 'overview':   _renderOverview();   break;
      case 'chart':      _renderChart();      break;
      case 'financials': _renderFinancials(); break;
      case 'earnings':   _renderEarnings();   break;
      case 'news':       _renderNews();       break;
    }
  }

  // ════════════════════════════════════════════════════════
  // TAB: OVERVIEW
  // ════════════════════════════════════════════════════════
  function _renderOverview() {
    const sym     = _currentSym;
    const quote   = _data[sym]?.quote;
    const summary = _data[sym]?.summary;
    const price   = summary?.price || {};
    const detail  = summary?.summaryDetail || {};
    const stats   = summary?.defaultKeyStatistics || {};
    const finData = summary?.financialData || {};
    const profile = summary?.assetProfile || {};
    const signal  = _getSignalData(sym);

    const content = document.getElementById('sdp-content');
    if (!content) return;

    // Key stats
    const statsItems = [
      { l:'Open',           v: _fmt(quote?.open,           '$') },
      { l:'Day High',       v: _fmt(quote?.high,           '$') },
      { l:'Day Low',        v: _fmt(quote?.low,            '$') },
      { l:'Prev Close',     v: _fmt(quote?.prev_close,     '$') },
      { l:'Volume',         v: _fmtNum(quote?.volume || detail.volume?.raw) },
      { l:'Avg Volume',     v: _fmtNum(detail.averageVolume?.raw) },
      { l:'Market Cap',     v: _fmtMarketCap(price.marketCap?.raw || quote?.market_cap) },
      { l:'P/E Ratio',      v: _fmt(detail.trailingPE?.raw,    '', 2) },
      { l:'Fwd P/E',        v: _fmt(detail.forwardPE?.raw,     '', 2) },
      { l:'EPS (TTM)',      v: _fmt(stats.trailingEps?.raw,    '$', 2) },
      { l:'EPS Fwd',        v: _fmt(stats.forwardEps?.raw,     '$', 2) },
      { l:'Dividend',       v: _fmt(detail.dividendRate?.raw,  '$', 2) },
      { l:'Div Yield',      v: _fmt(detail.dividendYield?.raw, '%', 2, 100) },
      { l:'Beta',           v: _fmt(detail.beta?.raw,          '', 2) },
      { l:'52W High',       v: _fmt(detail.fiftyTwoWeekHigh?.raw, '$') },
      { l:'52W Low',        v: _fmt(detail.fiftyTwoWeekLow?.raw,  '$') },
      { l:'50D MA',         v: _fmt(detail.fiftyDayAverage?.raw,  '$') },
      { l:'200D MA',        v: _fmt(detail.twoHundredDayAverage?.raw, '$') },
      { l:'Float',          v: _fmtNum(stats.floatShares?.raw) },
      { l:'Short %',        v: _fmt(stats.shortPercentOfFloat?.raw, '%', 2, 100) },
      { l:'Profit Margin',  v: _fmt(finData.profitMargins?.raw, '%', 2, 100) },
      { l:'Gross Margin',   v: _fmt(finData.grossMargins?.raw,  '%', 2, 100) },
      { l:'ROE',            v: _fmt(finData.returnOnEquity?.raw,'%', 2, 100) },
      { l:'Debt/Equity',    v: _fmt(finData.debtToEquity?.raw,  '', 2) },
      { l:'Current Ratio',  v: _fmt(finData.currentRatio?.raw,  '', 2) },
    ];

    // Signal data (from our ML engine)
    const sigBlock = signal ? `
      <div class="card" style="margin-bottom:12px;background:var(--surf2)">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">
          <i class="fa-solid fa-robot" style="color:var(--b1)"></i> AlphaVault Signal
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          ${signal.direction === 'buy'
            ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
            : signal.direction === 'sell'
              ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
              : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i> NEUTRAL</span>`}
          <span style="font-size:12px;color:var(--txt3)">Score: <strong class="mono" style="color:var(--b1)">${parseFloat(signal.final_score||0).toFixed(3)}</strong></span>
          <span style="font-size:12px;color:var(--txt3)">Conf: <strong class="mono">${(parseFloat(signal.confidence||0)*100).toFixed(1)}%</strong></span>
          <span style="font-size:12px;color:var(--txt3)">Council: <strong style="color:${(signal.council||'').includes('execute')?'var(--g)':'var(--y)'}">${(signal.council||'wait').toUpperCase()}</strong></span>
          <span class="regime-chip">${(signal.regime||'--').replace(/_/g,' ')}</span>
        </div>
      </div>` : '';

    // Company description
    const descBlock = profile.longBusinessSummary ? `
      <div style="margin-bottom:16px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.5px">
          About ${sym}
        </div>
        <p style="font-size:12px;color:var(--txt2);line-height:1.7;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden" id="sdp-desc-text">
          ${profile.longBusinessSummary}
        </p>
        <button onclick="this.previousElementSibling.style.webkitLineClamp=this.previousElementSibling.style.webkitLineClamp?'':'4';this.textContent=this.textContent==='Show less'?'Show more':'Show less'"
          style="font-size:11px;color:var(--b1);cursor:pointer;border:none;background:none;padding:2px 0;margin-top:4px">Show more</button>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
          ${profile.sector    ? `<span class="regime-chip">${profile.sector}</span>` : ''}
          ${profile.industry  ? `<span class="regime-chip">${profile.industry}</span>` : ''}
          ${profile.country   ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profile.country}</span>` : ''}
          ${profile.fullTimeEmployees ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profile.fullTimeEmployees)} emp</span>` : ''}
        </div>
      </div>` : '';

    content.innerHTML = `
      ${sigBlock}
      ${descBlock}
      <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">
        <i class="fa-solid fa-table" style="color:var(--b1)"></i> Key Statistics
      </div>
      <div class="sdp-stats-grid">
        ${statsItems.filter(i => i.v !== '--').map(i => `
          <div class="sdp-stat">
            <div class="sdp-stat-lbl">${i.l}</div>
            <div class="sdp-stat-val">${i.v}</div>
          </div>`).join('')}
      </div>
      ${!quote && !summary ? `
        <div style="text-align:center;padding:30px;color:var(--txt4)">
          <i class="fa-solid fa-triangle-exclamation" style="font-size:24px;margin-bottom:8px;color:var(--y)"></i><br>
          Yahoo Finance data unavailable. Check if <code>yahoo-proxy</code> Worker is deployed.
        </div>` : ''}`;
  }

  // ════════════════════════════════════════════════════════
  // TAB: CHART (LightweightCharts)
  // ════════════════════════════════════════════════════════
  function _renderChart() {
    const content = document.getElementById('sdp-content');
    if (!content) return;

    const INTERVALS = [
      { l:'1D', iv:'5m',  r:'1d' },
      { l:'5D', iv:'15m', r:'5d' },
      { l:'1M', iv:'1h',  r:'1mo' },
      { l:'3M', iv:'1d',  r:'3mo' },
      { l:'6M', iv:'1d',  r:'6mo' },
      { l:'1Y', iv:'1d',  r:'1y',  active: true },
      { l:'2Y', iv:'1wk', r:'2y' },
      { l:'5Y', iv:'1wk', r:'5y' },
    ];

    content.innerHTML = `
      <div style="display:flex;gap:3px;margin-bottom:10px;flex-wrap:wrap">
        ${INTERVALS.map(i => `
          <button class="cp-itab ${i.active?'active':''} sdp-chart-iv"
            data-iv="${i.iv}" data-range="${i.r}">${i.l}</button>`).join('')}
      </div>
      <div class="sdp-chart-container" id="sdp-chart-container"></div>
      <div style="font-size:10px;color:var(--txt4);margin-top:6px;text-align:center">
        <i class="fa-brands fa-yahoo"></i> Source: Yahoo Finance
      </div>`;

    // Bind interval buttons
    content.querySelectorAll('.sdp-chart-iv').forEach(btn => {
      btn.addEventListener('click', () => {
        content.querySelectorAll('.sdp-chart-iv')
          .forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentIv    = btn.dataset.iv;
        _currentRange = btn.dataset.range;
        _loadPanelChart(_currentSym, _currentIv, _currentRange);
      });
    });

    // Init chart
    _loadPanelChart(_currentSym, _currentIv, _currentRange);
  }

  async function _loadPanelChart(sym, interval, range) {
    const container = document.getElementById('sdp-chart-container');
    if (!container || typeof LightweightCharts === 'undefined') return;

    // Show loading in container
    container.innerHTML = `<div class="sdp-loading" style="height:200px">
      <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--b1)"></i>
      <span>Loading chart data...</span>
    </div>`;

    // Fetch Yahoo data
    const candles = await YahooFinance.getChart(sym, interval, range);

    // Re-check container still exists (user might have switched tab)
    const containerCheck = document.getElementById('sdp-chart-container');
    if (!containerCheck) return;

    containerCheck.innerHTML = '';

    if (!candles.length) {
      containerCheck.innerHTML = `<div class="sdp-loading" style="height:200px;color:var(--y)">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span>No chart data available</span>
      </div>`;
      return;
    }

    try {
      // Destroy old chart
      if (_panelChart) { try { _panelChart.remove(); } catch(e) {} _panelChart = null; }

      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

      _panelChart = LightweightCharts.createChart(containerCheck, {
        width:  containerCheck.clientWidth || 460,
        height: 200,
        layout: {
          background: { color: 'transparent' },
          textColor:  isDark ? '#9db3d8' : '#3d4f7c',
          fontSize:   11,
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
          horzLines: { color: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)' },
        },
        rightPriceScale: { borderColor: 'rgba(128,128,128,0.15)', scaleMargins: { top: 0.1, bottom: 0.15 } },
        timeScale:       { borderColor: 'rgba(128,128,128,0.15)', timeVisible: true, secondsVisible: false },
        crosshair:       { mode: LightweightCharts.CrosshairMode?.Normal ?? 1 },
      });

      const v = typeof LightweightCharts.CandlestickSeries !== 'undefined' ? 4 : 3;
      _panelSeries = v === 4
        ? _panelChart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor:'#10b981', downColor:'#ef4444',
            borderUpColor:'#10b981', borderDownColor:'#ef4444',
            wickUpColor:'#10b981', wickDownColor:'#ef4444',
          })
        : _panelChart.addCandlestickSeries({
            upColor:'#10b981', downColor:'#ef4444',
            borderUpColor:'#10b981', borderDownColor:'#ef4444',
            wickUpColor:'#10b981', wickDownColor:'#ef4444',
          });

      _panelSeries.setData(candles);
      _panelChart.timeScale().fitContent();

      new ResizeObserver(entries => {
        if (_panelChart && entries[0]) {
          _panelChart.applyOptions({ width: entries[0].contentRect.width });
        }
      }).observe(containerCheck);

    } catch(err) {
      console.error('Panel chart error:', err);
      containerCheck.innerHTML = `<div class="sdp-loading" style="height:200px;color:var(--r)">
        <i class="fa-solid fa-xmark"></i><span>Chart error: ${err.message}</span>
      </div>`;
    }
  }

  // ════════════════════════════════════════════════════════
  // TAB: FINANCIALS
  // ════════════════════════════════════════════════════════
  function _renderFinancials() {
    const sym     = _currentSym;
    const summary = _data[sym]?.summary;
    const content = document.getElementById('sdp-content');
    if (!content) return;

    if (!summary) {
      content.innerHTML = `<div class="sdp-loading">
        <i class="fa-solid fa-triangle-exclamation" style="color:var(--y)"></i>
        <span>Financial data unavailable — check yahoo-proxy Worker</span>
      </div>`;
      return;
    }

    const fin    = summary.financialData          || {};
    const stats  = summary.defaultKeyStatistics   || {};
    const detail = summary.summaryDetail          || {};
    const inc    = summary.incomeStatementHistory?.incomeStatementHistory?.[0] || {};

    const sections = [
      {
        title: 'Valuation',
        icon:  'fa-scale-balanced',
        items: [
          { l:'Market Cap',          v: _fmtMarketCap(summary.price?.marketCap?.raw) },
          { l:'Enterprise Value',    v: _fmtMarketCap(stats.enterpriseValue?.raw) },
          { l:'EV/EBITDA',           v: _fmt(stats.enterpriseToEbitda?.raw, '', 2) },
          { l:'EV/Revenue',          v: _fmt(stats.enterpriseToRevenue?.raw, '', 2) },
          { l:'P/E (TTM)',           v: _fmt(detail.trailingPE?.raw, '', 2) },
          { l:'Forward P/E',         v: _fmt(detail.forwardPE?.raw, '', 2) },
          { l:'PEG Ratio',           v: _fmt(stats.pegRatio?.raw, '', 2) },
          { l:'P/S Ratio',           v: _fmt(stats.priceToSalesTrailing12Months?.raw, '', 2) },
          { l:'P/B Ratio',           v: _fmt(stats.priceToBook?.raw, '', 2) },
          { l:'EV/EBITDA',           v: _fmt(stats.enterpriseToEbitda?.raw, '', 2) },
        ],
      },
      {
        title: 'Profitability',
        icon:  'fa-chart-line',
        items: [
          { l:'Revenue (TTM)',        v: _fmtMarketCap(fin.totalRevenue?.raw) },
          { l:'Gross Profit',        v: _fmtMarketCap(inc.grossProfit?.raw) },
          { l:'EBITDA',              v: _fmtMarketCap(fin.ebitda?.raw) },
          { l:'Net Income',          v: _fmtMarketCap(inc.netIncome?.raw) },
          { l:'Gross Margin',        v: _fmt(fin.grossMargins?.raw,         '%', 2, 100) },
          { l:'Operating Margin',    v: _fmt(fin.operatingMargins?.raw,     '%', 2, 100) },
          { l:'EBITDA Margin',       v: _fmt(fin.ebitdaMargins?.raw,        '%', 2, 100) },
          { l:'Profit Margin',       v: _fmt(fin.profitMargins?.raw,        '%', 2, 100) },
          { l:'Revenue Growth',      v: _fmt(fin.revenueGrowth?.raw,        '%', 2, 100) },
          { l:'Earnings Growth',     v: _fmt(fin.earningsGrowth?.raw,       '%', 2, 100) },
        ],
      },
      {
        title: 'Balance Sheet & Cash',
        icon:  'fa-building-columns',
        items: [
          { l:'Total Cash',          v: _fmtMarketCap(fin.totalCash?.raw) },
          { l:'Cash/Share',          v: _fmt(fin.totalCashPerShare?.raw, '$', 2) },
          { l:'Total Debt',          v: _fmtMarketCap(fin.totalDebt?.raw) },
          { l:'Debt/Equity',         v: _fmt(fin.debtToEquity?.raw, '', 2) },
          { l:'Current Ratio',       v: _fmt(fin.currentRatio?.raw, '', 2) },
          { l:'Quick Ratio',         v: _fmt(fin.quickRatio?.raw, '', 2) },
          { l:'Free Cash Flow',      v: _fmtMarketCap(fin.freeCashflow?.raw) },
          { l:'Operating Cash Flow', v: _fmtMarketCap(fin.operatingCashflow?.raw) },
        ],
      },
      {
        title: 'Management & Returns',
        icon:  'fa-award',
        items: [
          { l:'Return on Assets',    v: _fmt(fin.returnOnAssets?.raw, '%', 2, 100) },
          { l:'Return on Equity',    v: _fmt(fin.returnOnEquity?.raw, '%', 2, 100) },
          { l:'Revenue/Employee',    v: _fmt(fin.revenuePerShare?.raw, '$', 2) },
          { l:'Beta',                v: _fmt(detail.beta?.raw, '', 2) },
          { l:'52W High',            v: _fmt(detail.fiftyTwoWeekHigh?.raw, '$') },
          { l:'52W Low',             v: _fmt(detail.fiftyTwoWeekLow?.raw, '$') },
          { l:'50D Avg',             v: _fmt(detail.fiftyDayAverage?.raw, '$') },
          { l:'200D Avg',            v: _fmt(detail.twoHundredDayAverage?.raw, '$') },
          { l:'Shares Outstanding',  v: _fmtNum(stats.sharesOutstanding?.raw) },
          { l:'Insider Ownership',   v: _fmt(stats.heldPercentInsiders?.raw, '%', 2, 100) },
          { l:'Institution Own.',    v: _fmt(stats.heldPercentInstitutions?.raw, '%', 2, 100) },
          { l:'Short Interest',      v: _fmt(stats.shortPercentOfFloat?.raw, '%', 2, 100) },
        ],
      },
    ];

    content.innerHTML = sections.map(sec => `
      <div style="margin-bottom:20px">
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;
             letter-spacing:0.5px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
          <i class="fa-solid ${sec.icon}" style="color:var(--b1)"></i>${sec.title}
        </div>
        <div class="sdp-stats-grid">
          ${sec.items.filter(i => i.v && i.v !== '--').map(i => `
            <div class="sdp-stat">
              <div class="sdp-stat-lbl">${i.l}</div>
              <div class="sdp-stat-val">${i.v}</div>
            </div>`).join('')}
        </div>
      </div>`).join('') + `<div style="font-size:10px;color:var(--txt4);text-align:center;padding:8px">
        <i class="fa-brands fa-yahoo"></i> Data: Yahoo Finance via yfinance
      </div>`;
  }

  // ════════════════════════════════════════════════════════
  // TAB: EARNINGS
  // ════════════════════════════════════════════════════════
  function _renderEarnings() {
    const sym     = _currentSym;
    const summary = _data[sym]?.summary;
    const content = document.getElementById('sdp-content');
    if (!content) return;

    const trend    = summary?.earningsTrend?.trend || [];
    const calendar = summary?.calendarEvents || {};
    const signal   = _getSignalData(sym);

    // Upcoming earnings date
    const earningsDate = calendar.earnings?.earningsDate?.[0]?.raw;
    const earningsDateStr = earningsDate
      ? new Date(earningsDate * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' })
      : null;

    // EPS estimates from trend
    const estimates = trend.map(t => ({
      period:   t.period === '0q' ? 'Current Qtr'
               : t.period === '+1q' ? 'Next Qtr'
               : t.period === '0y' ? 'Current Year'
               : 'Next Year',
      epsAvg:   t.earningsEstimate?.avg?.raw,
      epsPrev:  t.earningsEstimate?.yearAgoEps?.raw,
      revAvg:   t.revenueEstimate?.avg?.raw,
      revGrowth:t.revenueEstimate?.growth?.raw,
    }));

    content.innerHTML = `
      ${earningsDateStr ? `
        <div style="background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);
             border-radius:var(--r-md);padding:14px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
          <i class="fa-solid fa-calendar-check" style="color:var(--b1);font-size:20px"></i>
          <div>
            <div style="font-size:12px;font-weight:700;color:var(--txt)">Next Earnings Date</div>
            <div style="font-size:20px;font-weight:900;color:var(--b1);font-family:var(--mono)">${earningsDateStr}</div>
          </div>
        </div>` : ''}

      ${signal?.earnings?.upcoming ? `
        <div class="test-status warn" style="margin-bottom:12px">
          <i class="fa-solid fa-triangle-exclamation"></i>
          Earnings upcoming detected by AlphaVault ML engine — increased volatility expected
        </div>` : ''}

      <!-- EPS Estimates -->
      ${estimates.length ? `
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;
             letter-spacing:0.5px;margin-bottom:10px">
          <i class="fa-solid fa-chart-bar" style="color:var(--b1)"></i> EPS Estimates
        </div>
        <div class="sdp-earnings-grid">
          ${estimates.map(e => `
            <div class="sdp-earning-card">
              <div class="sdp-earning-date">${e.period}</div>
              <div class="sdp-earning-eps" style="color:var(--b1)">
                ${e.epsAvg != null ? `$${e.epsAvg.toFixed(2)}` : '--'}
              </div>
              <div class="sdp-earning-surp">
                ${e.epsPrev != null ? `Prev: $${e.epsPrev.toFixed(2)}` : ''}
                ${e.revGrowth != null
                  ? `<span class="${e.revGrowth > 0 ? 'beat' : 'miss'}">
                      Rev ${e.revGrowth > 0 ? '+' : ''}${(e.revGrowth*100).toFixed(1)}%
                    </span>` : ''}
              </div>
            </div>`).join('')}
        </div>` : ''}

      <!-- Revenue Estimates -->
      ${estimates.length ? `
        <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;
             letter-spacing:0.5px;margin:16px 0 10px">
          <i class="fa-solid fa-dollar-sign" style="color:var(--g)"></i> Revenue Estimates
        </div>
        <div class="sdp-stats-grid">
          ${estimates.filter(e => e.revAvg).map(e => `
            <div class="sdp-stat">
              <div class="sdp-stat-lbl">${e.period}</div>
              <div class="sdp-stat-val">${_fmtMarketCap(e.revAvg)}</div>
              ${e.revGrowth != null ? `
                <div style="font-size:10px;font-weight:600;margin-top:2px;
                     color:${e.revGrowth > 0 ? 'var(--g)' : 'var(--r)'}">
                  ${e.revGrowth > 0 ? '+' : ''}${(e.revGrowth*100).toFixed(1)}% YoY
                </div>` : ''}
            </div>`).join('')}
        </div>` : ''}

      ${!estimates.length && !earningsDateStr ? `
        <div class="sdp-loading" style="height:150px">
          <i class="fa-solid fa-circle-info" style="color:var(--y)"></i>
          <span>No earnings data available for ${sym} via Yahoo Finance</span>
        </div>` : ''}

      <div style="font-size:10px;color:var(--txt4);text-align:center;padding:8px;margin-top:8px">
        <i class="fa-brands fa-yahoo"></i> Source: Yahoo Finance via yfinance
      </div>`;
  }

  // ════════════════════════════════════════════════════════
  // TAB: NEWS
  // ════════════════════════════════════════════════════════
  function _renderNews() {
    const sym     = _currentSym;
    const news    = _data[sym]?.news || [];
    const content = document.getElementById('sdp-content');
    if (!content) return;

    if (!news.length) {
      content.innerHTML = `<div class="sdp-loading">
        <i class="fa-solid fa-newspaper" style="font-size:24px;color:var(--txt4)"></i>
        <span>Loading news...</span>
      </div>`;
      // Try fetching news if not loaded
      YahooFinance.getNews(sym).then(articles => {
        _data[sym].news = articles;
        if (_activeTab === 'news') _renderNews();
      });
      return;
    }

    content.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:var(--txt3);text-transform:uppercase;
           letter-spacing:0.5px;margin-bottom:12px">
        <i class="fa-solid fa-newspaper" style="color:var(--b1)"></i>
        Latest News — ${sym} (${news.length} articles)
      </div>
      ${news.map(article => {
        const pub  = article.publisher || 'Yahoo Finance';
        const time = article.providerPublishTime
          ? _timeAgo(article.providerPublishTime * 1000)
          : '';
        const thumb = article.thumbnail?.resolutions?.[0]?.url;
        const sentiment = _guessSentiment(article.title || '');

        return `<a href="${article.link || '#'}" target="_blank" rel="noopener" class="sdp-news-item">
          <div style="display:flex;gap:10px">
            ${thumb ? `<img src="${thumb}" alt="" style="width:60px;height:40px;object-fit:cover;border-radius:4px;flex-shrink:0">` : ''}
            <div>
              <div class="sdp-news-headline">${article.title || 'No title'}</div>
              <div class="sdp-news-meta">
                <span>${pub}</span>
                <span>${time}</span>
                <span class="sdp-news-sentiment ${sentiment.cls}">${sentiment.label}</span>
              </div>
            </div>
          </div>
        </a>`;
      }).join('')}
      <div style="font-size:10px;color:var(--txt4);text-align:center;padding:8px;margin-top:4px">
        <i class="fa-brands fa-yahoo"></i> Source: Yahoo Finance News
      </div>`;
  }

  // ════════════════════════════════════════════════════════
  // HELPERS
  // ════════════════════════════════════════════════════════
  function _getSignalData(sym) {
    if (!window._terminalState) return null;
    return window._terminalState?.signals?.signals?.[sym] || null;
  }

  function _updateWLButton() {
    const btn = document.getElementById('sdp-wl-toggle');
    if (!btn || !window.WatchlistManager) return;
    const inWL = WatchlistManager.isInWatchlist(_currentSym);
    btn.innerHTML = `<i class="fa-${inWL ? 'solid' : 'regular'} fa-star"></i>`;
    btn.title     = inWL ? 'Remove from watchlist' : 'Add to watchlist';
    btn.style.color = inWL ? 'var(--y)' : '';
  }

  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _fmt(val, prefix = '', decimals = 2, multiply = 1) {
    if (val == null || isNaN(val)) return '--';
    const v = parseFloat(val) * multiply;
    return `${prefix}${v.toFixed(decimals)}${prefix === '%' ? '%' : ''}`;
  }

  function _fmtNum(n) {
    if (!n) return '--';
    n = parseFloat(n);
    if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
    return n.toLocaleString();
  }

  function _fmtMarketCap(n) {
    if (!n) return '--';
    n = parseFloat(n);
    if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
    if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
    return `$${n.toLocaleString()}`;
  }

  function _timeAgo(ts) {
    const diff = Date.now() - ts;
    const m    = Math.floor(diff / 60000);
    const h    = Math.floor(m / 60);
    const d    = Math.floor(h / 24);
    if (d > 0)  return `${d}d ago`;
    if (h > 0)  return `${h}h ago`;
    if (m > 0)  return `${m}m ago`;
    return 'Just now';
  }

  function _guessSentiment(headline) {
    const h = headline.toLowerCase();
    const pos = ['beat','surges','rises','gains','up','record','growth','strong','buy','upgrade','bullish','profit','revenue'];
    const neg = ['miss','falls','drops','down','loss','cuts','crash','sell','downgrade','bearish','debt','layoff','decline'];
    const posScore = pos.filter(w => h.includes(w)).length;
    const negScore = neg.filter(w => h.includes(w)).length;
    if (posScore > negScore) return { cls: 'positive', label: '▲ Positive' };
    if (negScore > posScore) return { cls: 'negative', label: '▼ Negative' };
    return { cls: 'neutral', label: '— Neutral' };
  }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return { open, close };

})();

window.StockDetail = StockDetail;
console.log('✅ StockDetail loaded — Yahoo Finance only');