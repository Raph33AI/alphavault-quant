// ============================================================
// stock-detail.js — AlphaVault Quant v3.1
// ✅ Full-page (plein écran) — plus de modal slide-in
// ✅ Yahoo Finance UNIQUEMENT via yahoo-proxy Worker v2
// ✅ KV cache côté Worker (TTL par route)
// ✅ Fallback v11 → v10 → chart_endpoint
// ✅ Fix chart infinite growth (height explicite + ResizeObserver)
// ✅ Tabs: Overview | Chart | Financials | Earnings | News
// ============================================================

// ════════════════════════════════════════════════════════════
// YAHOO FINANCE CLIENT — Proxy Worker v2 uniquement
// ════════════════════════════════════════════════════════════
const YahooFinance = (() => {

  const PROXY = 'https://yahoo-proxy.raphnardone.workers.dev';
  const _mem  = new Map();   // mémoire courte session (60s)
  const TTL   = 60_000;

  async function _get(path, bustCache = false) {
    const now = Date.now();
    const hit = _mem.get(path);
    if (!bustCache && hit && (now - hit.ts) < TTL) return hit.data;

    try {
      const resp = await fetch(`${PROXY}${path}`, {
        signal: AbortSignal.timeout(12_000),
      });
      if (!resp.ok) throw new Error(`Proxy HTTP ${resp.status}`);
      const data = await resp.json();
      if (data?.error) throw new Error(data.error);
      _mem.set(path, { data, ts: now });
      return data;
    } catch(e) {
      console.warn(`YahooFinance ${path}: ${e.message}`);
      if (hit?.data) return hit.data;   // stale fallback
      return null;
    }
  }

  // ── OHLCV Chart Data ──────────────────────────────────────
  async function getChart(sym, interval = '1d', range = '1y') {
    const data = await _get(`/chart/${sym}?interval=${interval}&range=${range}`, true);
    if (!data?.chart?.result?.[0]) return [];
    const r    = data.chart.result[0];
    const ts   = r.timestamp || [];
    const q    = r.indicators?.quote?.[0] || {};
    return ts
      .map((t, i) => ({
        time:   t,
        open:   +((q.open?.[i]   || 0).toFixed(4)),
        high:   +((q.high?.[i]   || 0).toFixed(4)),
        low:    +((q.low?.[i]    || 0).toFixed(4)),
        close:  +((q.close?.[i]  || 0).toFixed(4)),
        volume: Math.round(q.volume?.[i] || 0),
      }))
      .filter(c => c.close > 0);
  }

  // ── Real-time Quote ───────────────────────────────────────
  async function getQuote(sym) {
    const data = await _get(`/chart/${sym}?interval=1d&range=5d`);
    if (!data?.chart?.result?.[0]) return null;
    const meta  = data.chart.result[0].meta || {};
    const closes= (data.chart.result[0].indicators?.quote?.[0]?.close || []).filter(Boolean);
    const price = meta.regularMarketPrice || closes.at(-1) || 0;
    const prev  = meta.previousClose      || closes.at(-2) || price;
    const chgPct= prev ? ((price - prev) / prev * 100) : 0;
    return {
      symbol:    meta.symbol  || sym,
      price,
      prev_close: prev,
      change:    price - prev,
      change_pct: chgPct,
      open:      meta.regularMarketOpen,
      high:      meta.regularMarketDayHigh,
      low:       meta.regularMarketDayLow,
      volume:    meta.regularMarketVolume,
      market_cap:meta.marketCap,
      currency:  meta.currency || 'USD',
      exchange:  meta.exchangeName || '',
      '52w_high':meta.fiftyTwoWeekHigh,
      '52w_low': meta.fiftyTwoWeekLow,
      '50d_avg': meta.fiftyDayAverage,
      '200d_avg':meta.twoHundredDayAverage,
      source:    'yahoo',
    };
  }

  // ── Financial Summary ─────────────────────────────────────
  async function getFinancials(sym) {
    const data = await _get(`/summary/${sym}`);
    if (!data) return null;
    // Worker v2 retourne quoteSummary.result[0]
    const result = data?.quoteSummary?.result?.[0];
    if (result) return result;
    // fallback: data est déjà le result object
    if (data?.price || data?.financialData) return data;
    return null;
  }

  // ── News ──────────────────────────────────────────────────
  async function getNews(sym, count = 50) {
    const data = await _get(`/news/${sym}?count=${count}`, true);
    // Support plusieurs formats de réponse
    return data?.news || data?.items || data?.articles || [];
  }

  // ── Symbol Search ─────────────────────────────────────────
  async function search(q) {
    const data = await _get(`/search/${encodeURIComponent(q)}`);
    return data?.quotes || [];
  }

  return { getChart, getQuote, getFinancials, getNews, search };

})();

window.YahooFinance = YahooFinance;

// ════════════════════════════════════════════════════════════
// HELPER: Fix Chart Container Heights (empêche la croissance infinie)
// ════════════════════════════════════════════════════════════
function _fixChartHeights() {
  const rules = [
    { sel: '.chart-container', h: 360 },
    { sel: '.cp-chart',        h: 220 },
    { sel: '.sdp-fp-chart',    h: 420 },
  ];
  rules.forEach(({ sel, h }) => {
    document.querySelectorAll(sel).forEach(el => {
      el.style.height    = `${h}px`;
      el.style.minHeight = `${h}px`;
      el.style.maxHeight = `${h}px`;
      el.style.overflow  = 'hidden';
      el.style.display   = 'block';
      el.style.position  = 'relative';
    });
  });
}

// ════════════════════════════════════════════════════════════
// STOCK DETAIL — Full Page Controller
// ════════════════════════════════════════════════════════════
const StockDetail = (() => {

  // ── State ────────────────────────────────────────────────
  let _sym       = null;
  let _tab       = 'overview';
  let _iv        = '1d';
  let _range     = '1y';
  let _data      = {};     // { sym: { quote, summary, news } }
  let _fpChart   = null;   // LWC full-page chart instance
  let _fpSeries  = null;
  let _lastFPWidth = 0;

  // ────────────────────────────────────────────────────────
  // BUILD HTML (une seule fois au premier appel)
  // ────────────────────────────────────────────────────────
  function _build() {
    if (document.getElementById('sdp-fullpage')) return;

    document.body.insertAdjacentHTML('beforeend', `
      <div class="sdp-fullpage" id="sdp-fullpage">

        <!-- ── HEADER ── -->
        <div class="sdp-fp-header">
          <button class="sdp-fp-back" id="sdp-back">
            <i class="fa-solid fa-arrow-left"></i> Back
          </button>

          <div>
            <div class="sdp-fp-sym"  id="sdp-fp-sym">--</div>
            <div class="sdp-fp-name" id="sdp-fp-name">Loading...</div>
          </div>

          <div id="sdp-fp-sector" style="font-size:10px;font-weight:700;padding:2px 9px;
               border-radius:10px;background:rgba(59,130,246,0.1);color:var(--b1);
               border:1px solid rgba(59,130,246,0.2)">--</div>

          <div class="sdp-fp-price"  id="sdp-fp-price">--</div>
          <div class="sdp-fp-change" id="sdp-fp-change">--</div>

          <div style="display:flex;flex-direction:column;gap:2px;font-size:10px;color:var(--txt4)">
            <span id="sdp-fp-vol">Vol: --</span>
            <span id="sdp-fp-cap">Cap: --</span>
          </div>

          <div class="sdp-fp-actions">
            <button class="sdp-fp-action-btn buy"  id="sdp-fp-buy">
              <i class="fa-solid fa-arrow-up"></i> BUY
            </button>
            <button class="sdp-fp-action-btn sell" id="sdp-fp-sell">
              <i class="fa-solid fa-arrow-down"></i> SELL
            </button>
            <button class="sdp-fp-action-btn wl"   id="sdp-fp-wl">
              <i class="fa-regular fa-star"></i> Watchlist
            </button>
          </div>

          <div class="sdp-source-badge">
            <i class="fa-brands fa-yahoo"></i> Yahoo Finance
          </div>
        </div>

        <!-- ── TABS ── -->
        <div class="sdp-fp-tabs" id="sdp-fp-tabs">
          <button class="sdp-fp-tab active" data-tab="overview">
            <i class="fa-solid fa-chart-pie"></i> Overview
          </button>
          <button class="sdp-fp-tab" data-tab="chart">
            <i class="fa-solid fa-chart-candlestick"></i> Chart
          </button>
          <button class="sdp-fp-tab" data-tab="financials">
            <i class="fa-solid fa-dollar-sign"></i> Financials
          </button>
          <button class="sdp-fp-tab" data-tab="earnings">
            <i class="fa-solid fa-calendar-check"></i> Earnings
          </button>
          <button class="sdp-fp-tab" data-tab="news">
            <i class="fa-solid fa-newspaper"></i> News
          </button>
        </div>

        <!-- ── CONTENT ── -->
        <div class="sdp-fp-body layout-overview" id="sdp-fp-body">
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;color:var(--txt4);grid-column:1/-1">
            <i class="fa-solid fa-circle-notch fa-spin" style="font-size:22px;color:var(--b1)"></i>
            Loading data from Yahoo Finance...
          </div>
        </div>

      </div>`);

    // ── Lazy logo dans le header ─────────────────────────
    const logoContainer = document.createElement('div');
    logoContainer.id    = 'sdp-fp-logo';
    logoContainer.style.cssText = 'flex-shrink:0;margin-right:-4px';
    const headerEl = document.querySelector('#sdp-fullpage .sdp-fp-header');
    if (headerEl) {
    const backBtn = document.getElementById('sdp-back');
    if (backBtn && backBtn.nextSibling) {
        headerEl.insertBefore(logoContainer, backBtn.nextSibling);
    }
    }

    // ── Event bindings ───────────────────────────────────
    document.getElementById('sdp-back')
      .addEventListener('click', close);

    document.querySelectorAll('.sdp-fp-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    document.getElementById('sdp-fp-buy').addEventListener('click', () => {
      const sel = document.getElementById('order-symbol');
      if (sel) sel.value = _sym;
      if (window.Terminal) { window.Terminal.setSide?.('BUY'); window.Terminal.showSection('execution'); }
      close();
    });

    document.getElementById('sdp-fp-sell').addEventListener('click', () => {
      const sel = document.getElementById('order-symbol');
      if (sel) sel.value = _sym;
      if (window.Terminal) { window.Terminal.setSide?.('SELL'); window.Terminal.showSection('execution'); }
      close();
    });

    document.getElementById('sdp-fp-wl').addEventListener('click', _toggleWL);

    // ESC key
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && document.getElementById('sdp-fullpage')?.classList.contains('open')) {
        close();
      }
    });
  }

  // ────────────────────────────────────────────────────────
  // OPEN
  // ────────────────────────────────────────────────────────
  async function open(sym) {
    if (!sym) return;
    _sym  = sym.toUpperCase();
    _tab  = 'overview';
    _iv   = '1d';
    _range= '1y';

    _build();

    const fp = document.getElementById('sdp-fullpage');
    if (!fp) {
    console.error('[StockDetail] sdp-fullpage introuvable — _build() a échoué');
    return;
    }
    // Double sécurité : CSS class + style direct
    fp.classList.add('open');
    fp.style.setProperty('display', 'flex', 'important');
    fp.style.setProperty('z-index', '9999', 'important');
    document.body.style.overflow = 'hidden';
    console.log(`[StockDetail] open() → ${_sym}`);

    // Fix all chart heights immediately
    _fixChartHeights();

    // Initial header
    const meta = window.WatchlistManager?.getSymbolMeta(_sym) || { name: _sym, sector: '--' };
    _t('sdp-fp-sym',    _sym);
    _t('sdp-fp-name',   meta.name);
    _t('sdp-fp-sector', meta.sector);
    // Mise à jour du logo dans le header
    const logoSlot = document.getElementById('sdp-fp-logo');
    if (logoSlot) {
    logoSlot.innerHTML = typeof window._getLogoHtml === 'function'
        ? window._getLogoHtml(_sym, 36)
        : '';
    }
    _updateWLBtn();

    // Reset tabs UI
    document.querySelectorAll('.sdp-fp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'overview')
    );

    // Show loading
    _bodyHtml('<div style="display:flex;align-items:center;justify-content:center;gap:12px;color:var(--txt4);grid-column:1/-1;padding:60px">' +
      '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:22px;color:var(--b1)"></i>' +
      `Loading Yahoo Finance data for <strong style="color:var(--txt)">${_sym}</strong>...</div>`,
      'layout-overview');

    // Fetch all data in parallel
    await _fetchAll(_sym);

    // Render first tab
    _switchTab('overview');
  }

  // ────────────────────────────────────────────────────────
  // CLOSE
  // ────────────────────────────────────────────────────────
  function close() {
    const fp = document.getElementById('sdp-fullpage');
    if (fp) {
      fp.classList.remove('open');
      fp.style.removeProperty('display');   // ← Supprime le style inline posé par open()
      fp.style.removeProperty('z-index');
      fp.style.removeProperty('flex-direction');
    }
    document.body.style.overflow = '';
    _destroyFPChart();
  }

  // ────────────────────────────────────────────────────────
  // DATA FETCH (Yahoo only)
  // ────────────────────────────────────────────────────────
  async function _fetchAll(sym) {
    if (!_data[sym]) _data[sym] = {};

    const [quoteRes, summaryRes, newsRes] = await Promise.allSettled([
      YahooFinance.getQuote(sym),
      YahooFinance.getFinancials(sym),
      YahooFinance.getNews(sym),
    ]);

    _data[sym].quote   = quoteRes.status   === 'fulfilled' ? quoteRes.value   : null;
    _data[sym].summary = summaryRes.status === 'fulfilled' ? summaryRes.value : null;
    _data[sym].news    = newsRes.status    === 'fulfilled' ? newsRes.value    : [];

    // Update header price
    const q = _data[sym].quote;
    if (q && q.price > 0) {
      _t('sdp-fp-price', `$${q.price.toFixed(2)}`);
      const chgPct = parseFloat(q.change_pct || 0);
      const chgEl  = document.getElementById('sdp-fp-change');
      if (chgEl) {
        chgEl.textContent = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
        chgEl.className   = `sdp-fp-change ${chgPct >= 0 ? 'up' : 'down'}`;
      }
      _t('sdp-fp-vol', `Vol: ${_fmtNum(q.volume)}`);
      _t('sdp-fp-cap', `Cap: ${_fmtMCap(q.market_cap)}`);
    }
  }

  // ────────────────────────────────────────────────────────
  // SWITCH TAB
  // ────────────────────────────────────────────────────────
  function _switchTab(tab) {
    _tab = tab;
    _destroyFPChart();

    document.querySelectorAll('.sdp-fp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );

    switch(tab) {
      case 'overview':   _renderOverview();   break;
      case 'chart':      _renderChart();      break;
      case 'financials': _renderFinancials(); break;
      case 'earnings':   _renderEarnings();   break;
      case 'news':       _renderNews();       break;
    }

    // Re-apply height fix after render
    setTimeout(_fixChartHeights, 50);
  }

  // ════════════════════════════════════════════════════════
  // TAB: OVERVIEW
  // ════════════════════════════════════════════════════════
  function _renderOverview() {
    const sym     = _sym;
    const q       = _data[sym]?.quote   || {};
    const sum     = _data[sym]?.summary || {};
    const price   = sum.price            || {};
    const detail  = sum.summaryDetail    || {};
    const stats   = sum.defaultKeyStatistics || {};
    const fin     = sum.financialData    || {};
    const profile = sum.assetProfile     || {};
    const signal  = _sig(sym);
    const isFallback = sum._source === 'chart_fallback';

    // ── Key Stats ──
    const kstats = [
      { l:'Open',         v: _f(q.open || detail.open?.raw,        '$') },
      { l:'Day High',     v: _f(q.high || detail.dayHigh?.raw,     '$') },
      { l:'Day Low',      v: _f(q.low  || detail.dayLow?.raw,      '$') },
      { l:'Prev Close',   v: _f(q.prev_close || detail.previousClose?.raw, '$') },
      { l:'Volume',       v: _fmtNum(q.volume || detail.volume?.raw) },
      { l:'Avg Volume',   v: _fmtNum(detail.averageVolume?.raw) },
      { l:'Market Cap',   v: _fmtMCap(price.marketCap?.raw || q.market_cap) },
      { l:'P/E (TTM)',    v: _f(detail.trailingPE?.raw,  '', 2) },
      { l:'Fwd P/E',      v: _f(detail.forwardPE?.raw,   '', 2) },
      { l:'EPS (TTM)',    v: _f(stats.trailingEps?.raw,  '$', 2) },
      { l:'Div Yield',    v: _f(detail.dividendYield?.raw != null ? detail.dividendYield.raw * 100 : null, '', 2, '%') },
      { l:'Beta',         v: _f(detail.beta?.raw,         '', 2) },
      { l:'52W High',     v: _f(q['52w_high'] || detail.fiftyTwoWeekHigh?.raw,     '$') },
      { l:'52W Low',      v: _f(q['52w_low']  || detail.fiftyTwoWeekLow?.raw,      '$') },
      { l:'50D Avg',      v: _f(q['50d_avg']  || detail.fiftyDayAverage?.raw,      '$') },
      { l:'200D Avg',     v: _f(q['200d_avg'] || detail.twoHundredDayAverage?.raw, '$') },
      { l:'Profit Margin',v: _f(fin.profitMargins?.raw != null ? fin.profitMargins.raw * 100 : null, '', 2, '%') },
      { l:'ROE',          v: _f(fin.returnOnEquity?.raw  != null ? fin.returnOnEquity.raw  * 100 : null, '', 2, '%') },
      { l:'Debt/Equity',  v: _f(fin.debtToEquity?.raw,   '', 2) },
      { l:'Revenue (TTM)',v: _fmtMCap(fin.totalRevenue?.raw) },
      { l:'Gross Margin', v: _f(fin.grossMargins?.raw    != null ? fin.grossMargins.raw    * 100 : null, '', 2, '%') },
      { l:'Float',        v: _fmtNum(stats.floatShares?.raw) },
      { l:'Short %',      v: _f(stats.shortPercentOfFloat?.raw != null ? stats.shortPercentOfFloat.raw * 100 : null, '', 2, '%') },
    ].filter(i => i.v && i.v !== '--');

    // ── AlphaVault Signal block ──
    const sigBlock = signal ? `
      <div class="sdp-fp-stat-section" style="background:var(--grad-soft);border-color:rgba(59,130,246,0.25)">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-robot"></i> AlphaVault ML Signal
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center">
          ${signal.direction === 'buy'
            ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
            : signal.direction === 'sell'
              ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
              : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i> NEUTRAL</span>`}
          <div style="display:flex;gap:16px;flex-wrap:wrap">
            <span style="font-size:12px;color:var(--txt3)">Score <strong class="mono" style="color:var(--b1)">${parseFloat(signal.final_score||0).toFixed(3)}</strong></span>
            <span style="font-size:12px;color:var(--txt3)">Conf <strong class="mono">${(parseFloat(signal.confidence||0)*100).toFixed(1)}%</strong></span>
            <span style="font-size:12px;color:var(--txt3)">BP <strong class="mono">${(parseFloat(signal.buy_prob||0.5)*100).toFixed(1)}%</strong></span>
            <strong style="font-size:12px;color:${(signal.council||'').includes('execute')?'var(--g)':'var(--y)'}">
              ${(signal.council||'wait').toUpperCase()}
            </strong>
            <span class="regime-chip">${(signal.regime||'--').replace(/_/g,' ')}</span>
          </div>
        </div>
      </div>` : '';

    // ── Company description block ──
    const descBlock = profile.longBusinessSummary ? `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-building"></i> About ${sym}
        </div>
        ${profile.industry || profile.sector || profile.country ? `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
            ${profile.sector   ? `<span class="regime-chip">${profile.sector}</span>` : ''}
            ${profile.industry ? `<span class="regime-chip">${profile.industry}</span>` : ''}
            ${profile.country  ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profile.country}</span>` : ''}
            ${profile.fullTimeEmployees ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profile.fullTimeEmployees)}</span>` : ''}
          </div>` : ''}
        <p class="sdp-desc" id="sdp-desc-p"
          style="font-size:13px;color:var(--txt2);line-height:1.8;
                 display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">
          ${profile.longBusinessSummary}
        </p>
        <button class="sdp-desc-toggle" id="sdp-desc-toggle">Show more</button>
      </div>` : '';

    // ── Stats grid ──
    const statsBlock = `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-table"></i> Key Statistics
          ${isFallback ? `<span style="font-size:10px;color:var(--y);margin-left:8px">(partial data — proxy fallback)</span>` : ''}
        </div>
        <div class="sdp-fp-stats">
          ${kstats.map(i => `
            <div class="sdp-fp-stat-item">
              <div class="sdp-fp-stat-lbl">${i.l}</div>
              <div class="sdp-fp-stat-val">${i.v}</div>
            </div>`).join('')}
        </div>
        ${!kstats.length ? `<div style="color:var(--txt4);font-size:12px;padding:16px;text-align:center">
          <i class="fa-solid fa-triangle-exclamation" style="color:var(--y)"></i>
          Yahoo Finance data unavailable. Check yahoo-proxy Worker deployment.
        </div>` : ''}
      </div>`;

    // ── Mini chart right column ──
    const miniChartBlock = `
      <div>
        ${sigBlock}
        <div class="sdp-fp-stat-section" style="margin-top:${signal?'16px':'0'}">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-chart-line"></i> Price Chart (1Y)
          </div>
          <div class="sdp-fp-chart" id="sdp-fp-chart-mini" style="height:260px!important;min-height:260px!important;max-height:260px!important"></div>
          <div style="font-size:10px;color:var(--txt4);text-align:center;margin-top:6px">
            <i class="fa-brands fa-yahoo"></i> Yahoo Finance · Daily
          </div>
        </div>
      </div>`;

    _bodyHtml(descBlock + statsBlock, 'layout-overview', miniChartBlock);

    // Bind description toggle
    const tog = document.getElementById('sdp-desc-toggle');
    const para = document.getElementById('sdp-desc-p');
    if (tog && para) {
      let expanded = false;
      tog.addEventListener('click', () => {
        expanded = !expanded;
        para.style.webkitLineClamp = expanded ? 'unset' : '3';
        para.style.overflow        = expanded ? 'visible' : 'hidden';
        tog.textContent            = expanded ? 'Show less' : 'Show more';
      });
    }

    // Load mini chart
    setTimeout(() => _loadMiniChart('sdp-fp-chart-mini', _sym, '1d', '1y', 260), 80);
  }

  // ════════════════════════════════════════════════════════
  // TAB: CHART (full width, 420px)
  // ════════════════════════════════════════════════════════
  function _renderChart() {
    const INTERVALS = [
      { l:'1D', iv:'5m',  r:'1d' },
      { l:'5D', iv:'15m', r:'5d' },
      { l:'1M', iv:'1h',  r:'1mo' },
      { l:'3M', iv:'1d',  r:'3mo' },
      { l:'6M', iv:'1d',  r:'6mo' },
      { l:'1Y', iv:'1d',  r:'1y', active:true },
      { l:'2Y', iv:'1wk', r:'2y' },
      { l:'5Y', iv:'1wk', r:'5y' },
    ];

    const ivTabs = `
      <div class="sdp-iv-tabs">
        ${INTERVALS.map(i => `
          <button class="sdp-iv-btn ${i.active?'active':''}" data-iv="${i.iv}" data-range="${i.r}">
            ${i.l}
          </button>`).join('')}
      </div>
      <div class="sdp-fp-chart" id="sdp-fp-chart-main"></div>
      <div style="font-size:10px;color:var(--txt4);text-align:center;margin-top:8px">
        <i class="fa-brands fa-yahoo"></i> Source: Yahoo Finance — interval ${_iv}
      </div>`;

    _bodyHtml(ivTabs, 'layout-chart');

    // Bind interval buttons
    document.querySelectorAll('.sdp-iv-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sdp-iv-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _iv    = btn.dataset.iv;
        _range = btn.dataset.range;
        _destroyFPChart();
        setTimeout(() => _loadMainFPChart(), 50);
      });
    });

    setTimeout(() => _loadMainFPChart(), 80);
  }

  // ════════════════════════════════════════════════════════
  // TAB: FINANCIALS
  // ════════════════════════════════════════════════════════
  function _renderFinancials() {
    const sum    = _data[_sym]?.summary || {};
    const fin    = sum.financialData          || {};
    const stats  = sum.defaultKeyStatistics   || {};
    const detail = sum.summaryDetail          || {};
    const price  = sum.price                  || {};
    const profile= sum.assetProfile           || {};
    const q      = _data[_sym]?.quote         || {};

    // ── Fusionne les données disponibles (summary + quote) ──
    const kstats = [
      { l:'Market Cap',      v: _fmtMCap(price.marketCap?.raw || q.market_cap) },
      { l:'Price',           v: _f(q.price || detail.regularMarketPrice?.raw, '$') },
      { l:'Open',            v: _f(q.open  || detail.open?.raw, '$') },
      { l:'Day High',        v: _f(q.high  || detail.dayHigh?.raw, '$') },
      { l:'Day Low',         v: _f(q.low   || detail.dayLow?.raw, '$') },
      { l:'Prev Close',      v: _f(q.prev_close || detail.previousClose?.raw, '$') },
      { l:'Volume',          v: _fmtNum(q.volume || detail.volume?.raw) },
      { l:'Avg Volume',      v: _fmtNum(detail.averageVolume?.raw) },
      { l:'52W High',        v: _f(q['52w_high'] || detail.fiftyTwoWeekHigh?.raw, '$') },
      { l:'52W Low',         v: _f(q['52w_low']  || detail.fiftyTwoWeekLow?.raw, '$') },
      { l:'50D Avg',         v: _f(q['50d_avg']  || detail.fiftyDayAverage?.raw, '$') },
      { l:'200D Avg',        v: _f(q['200d_avg'] || detail.twoHundredDayAverage?.raw, '$') },
      { l:'P/E (TTM)',       v: _f(detail.trailingPE?.raw, '', 2) },
      { l:'Forward P/E',     v: _f(detail.forwardPE?.raw, '', 2) },
      { l:'EPS (TTM)',       v: _f(stats.trailingEps?.raw, '$', 2) },
      { l:'Beta',            v: _f(detail.beta?.raw, '', 2) },
      { l:'Div Yield',       v: _fPct(detail.dividendYield?.raw) },
      { l:'Enterprise Value',v: _fmtMCap(stats.enterpriseValue?.raw) },
      { l:'P/S Ratio',       v: _f(stats.priceToSalesTrailing12Months?.raw, '', 2) },
      { l:'P/B Ratio',       v: _f(stats.priceToBook?.raw, '', 2) },
      { l:'EV/EBITDA',       v: _f(stats.enterpriseToEbitda?.raw, '', 2) },
      { l:'PEG Ratio',       v: _f(stats.pegRatio?.raw, '', 2) },
      // Profitability
      { l:'Revenue (TTM)',   v: _fmtMCap(fin.totalRevenue?.raw) },
      { l:'Gross Margin',    v: _fPct(fin.grossMargins?.raw) },
      { l:'Operating Margin',v: _fPct(fin.operatingMargins?.raw) },
      { l:'Profit Margin',   v: _fPct(fin.profitMargins?.raw) },
      { l:'EBITDA',          v: _fmtMCap(fin.ebitda?.raw) },
      { l:'Revenue Growth',  v: _fPct(fin.revenueGrowth?.raw) },
      { l:'Earnings Growth', v: _fPct(fin.earningsGrowth?.raw) },
      // Balance Sheet
      { l:'Total Cash',      v: _fmtMCap(fin.totalCash?.raw) },
      { l:'Total Debt',      v: _fmtMCap(fin.totalDebt?.raw) },
      { l:'Debt/Equity',     v: _f(fin.debtToEquity?.raw, '', 2) },
      { l:'Free Cash Flow',  v: _fmtMCap(fin.freeCashflow?.raw) },
      { l:'Current Ratio',   v: _f(fin.currentRatio?.raw, '', 2) },
      // Returns
      { l:'ROE',             v: _fPct(fin.returnOnEquity?.raw) },
      { l:'ROA',             v: _fPct(fin.returnOnAssets?.raw) },
      { l:'Short % Float',   v: _fPct(stats.shortPercentOfFloat?.raw) },
      { l:'Insider Own.',    v: _fPct(stats.heldPercentInsiders?.raw) },
      { l:'Institution Own.',v: _fPct(stats.heldPercentInstitutions?.raw) },
    ].filter(i => i.v && i.v !== '--');

    // Source indicator
    const hasFull = fin.totalRevenue || stats.enterpriseValue;
    const srcBadge = hasFull
      ? `<span style="font-size:10px;color:var(--g);background:rgba(16,185,129,0.1);padding:2px 8px;border-radius:10px;border:1px solid rgba(16,185,129,0.25)">
          <i class="fa-solid fa-circle-check"></i> Full Data
        </span>`
      : `<span style="font-size:10px;color:var(--y);background:rgba(245,158,11,0.1);padding:2px 8px;border-radius:10px;border:1px solid rgba(245,158,11,0.25)" title="Full financials unavailable — proxy may need /summary module">
          <i class="fa-solid fa-triangle-exclamation"></i> Partial Data (quote only)
        </span>`;

    // Company profile
    const profileBlock = profile.longBusinessSummary ? `
      <div class="sdp-fp-stat-section" style="margin-bottom:16px">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-building"></i> About ${_sym}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
          ${profile.sector   ? `<span class="regime-chip">${profile.sector}</span>` : ''}
          ${profile.industry ? `<span class="regime-chip">${profile.industry}</span>` : ''}
          ${profile.country  ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profile.country}</span>` : ''}
          ${profile.fullTimeEmployees ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profile.fullTimeEmployees)}</span>` : ''}
        </div>
        <p id="sdp-desc-p" style="font-size:12px;color:var(--txt2);line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">
          ${profile.longBusinessSummary}
        </p>
        <button class="sdp-desc-toggle" id="sdp-desc-toggle">Show more</button>
      </div>` : '';

    const statsBlock = `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-table"></i> Key Statistics &amp; Financials
          <div style="margin-left:auto">${srcBadge}</div>
        </div>
        ${kstats.length ? `
          <div class="sdp-fp-stats">
            ${kstats.map(i => `
              <div class="sdp-fp-stat-item">
                <div class="sdp-fp-stat-lbl">${i.l}</div>
                <div class="sdp-fp-stat-val">${i.v}</div>
              </div>`).join('')}
          </div>` : `
          <div style="text-align:center;padding:40px;color:var(--txt4)">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:28px;color:var(--y);margin-bottom:10px;display:block"></i>
            <strong style="color:var(--txt)">Financial data unavailable</strong><br>
            <span style="font-size:12px;margin-top:6px;display:block">
              The Yahoo Finance proxy (<code>/summary/${_sym}</code>) did not return data.<br>
              Ensure the worker implements the <code>/summary/</code> endpoint with <code>quoteSummary</code> modules.
            </span>
            <button onclick="StockDetail._retryFinancials()" class="btn-sm" style="margin-top:12px">
              <i class="fa-solid fa-rotate"></i> Retry
            </button>
          </div>`}
      </div>`;

    _bodyHtml(profileBlock + statsBlock, 'layout-financials');

    // Bind description toggle
    const tog  = document.getElementById('sdp-desc-toggle');
    const para = document.getElementById('sdp-desc-p');
    if (tog && para) {
      let expanded = false;
      tog.addEventListener('click', () => {
        expanded = !expanded;
        para.style.webkitLineClamp = expanded ? 'unset' : '3';
        para.style.overflow        = expanded ? 'visible' : 'hidden';
        tog.textContent            = expanded ? 'Show less' : 'Show more';
      });
    }
  }

  // ── Retry financials (KV might have cached the crumb now) ─
  async function _retryFinancials() {
    // Clear memory cache for this sym
    if (_data[_sym]) delete _data[_sym].summary;
    // Refetch
    const sum = await YahooFinance.getFinancials(_sym);
    if (_data[_sym]) _data[_sym].summary = sum;
    _renderFinancials();
  }

  // ════════════════════════════════════════════════════════
  // TAB: EARNINGS
  // ════════════════════════════════════════════════════════
  function _renderEarnings() {
    const sum      = _data[_sym]?.summary || {};
    const q        = _data[_sym]?.quote   || {};

    // Multiple data paths
    const trend    = sum.earningsTrend?.trend
      || sum.earnings?.earningsChart?.quarterly
      || [];
    const calendar = sum.calendarEvents?.earnings || {};
    const nextDates= (calendar.earningsDate || [])
      .map(d => new Date((d.raw || d) * 1000))
      .filter(d => d > new Date());
    const nextEarnings = nextDates[0]?.toLocaleDateString('en-US', {
      month:'long', day:'numeric', year:'numeric'
    });

    // EPS from quote (if available)
    const epsFromQuote = sum.defaultKeyStatistics?.trailingEps?.raw
      || sum.defaultKeyStatistics?.forwardEps?.raw;

    const PERIOD_LABELS = {
      '0q':'Current Quarter', '+1q':'Next Quarter',
      '0y':'Current Year',    '+1y':'Next Year',
    };

    const epsSection = trend.length ? `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-chart-bar"></i> EPS &amp; Revenue Estimates
        </div>
        ${trend.map(t => {
          const epsEst  = t.earningsEstimate?.avg?.raw;
          const epsYago = t.earningsEstimate?.yearAgoEps?.raw;
          const revEst  = t.revenueEstimate?.avg?.raw;
          const revGrow = t.revenueEstimate?.growth?.raw;
          const period  = PERIOD_LABELS[t.period] || t.period;
          return `
            <div style="margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--bord)">
              <div style="font-size:13px;font-weight:700;color:var(--txt);margin-bottom:10px;display:flex;align-items:center;gap:10px">
                ${period}
                ${revGrow != null ? `<span style="font-size:11px;font-weight:600;color:${revGrow>0?'var(--g)':'var(--r)'}">
                  Rev ${revGrow>0?'+':''}${(revGrow*100).toFixed(1)}% YoY
                </span>` : ''}
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
                ${epsEst  != null ? `<div class="sdp-fp-stat-item"><div class="sdp-fp-stat-lbl">EPS Estimate</div><div class="sdp-fp-stat-val" style="color:var(--b1)">$${epsEst.toFixed(2)}</div></div>` : ''}
                ${epsYago != null ? `<div class="sdp-fp-stat-item"><div class="sdp-fp-stat-lbl">Year Ago EPS</div><div class="sdp-fp-stat-val">$${epsYago.toFixed(2)}</div></div>` : ''}
                ${revEst  != null ? `<div class="sdp-fp-stat-item"><div class="sdp-fp-stat-lbl">Rev Estimate</div><div class="sdp-fp-stat-val">${_fmtMCap(revEst)}</div></div>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>` : '';

    const calSection = nextEarnings ? `
      <div class="sdp-fp-stat-section" style="border-color:rgba(59,130,246,0.3);background:rgba(59,130,246,0.04)">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-calendar-check"></i> Next Earnings Date</div>
        <div style="font-size:28px;font-weight:900;color:var(--b1);font-family:var(--mono);margin-bottom:6px">${nextEarnings}</div>
      </div>` : '';

    const epsCard = epsFromQuote ? `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-dollar-sign"></i> EPS Summary</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
          <div class="sdp-fp-stat-item">
            <div class="sdp-fp-stat-lbl">EPS (TTM)</div>
            <div class="sdp-fp-stat-val" style="color:${epsFromQuote>0?'var(--g)':'var(--r)'}">
              $${epsFromQuote.toFixed(2)}
            </div>
          </div>
          ${q.price && epsFromQuote ? `
          <div class="sdp-fp-stat-item">
            <div class="sdp-fp-stat-lbl">P/E (TTM)</div>
            <div class="sdp-fp-stat-val">${(q.price / epsFromQuote).toFixed(2)}</div>
          </div>` : ''}
        </div>
      </div>` : '';

    const fallback = !trend.length && !nextEarnings && !epsFromQuote ? `
      <div style="grid-column:1/-1;text-align:center;padding:50px;color:var(--txt4)">
        <i class="fa-solid fa-calendar-xmark" style="font-size:32px;color:var(--txt4);margin-bottom:12px;display:block"></i>
        <strong style="color:var(--txt);font-size:14px">Earnings data unavailable for ${_sym}</strong>
        <div style="font-size:12px;margin-top:8px">
          ${_sym.match(/^(SPY|QQQ|IWM|DIA|VTI|GLD|TLT)$/)
            ? 'ETFs do not report individual earnings.'
            : 'The /summary proxy endpoint needs to include <code>earningsTrend</code> and <code>calendarEvents</code> modules.'}
        </div>
        <button onclick="StockDetail._retryFinancials()" class="btn-sm" style="margin-top:14px">
          <i class="fa-solid fa-rotate"></i> Retry
        </button>
      </div>` : '';

    _bodyHtml(calSection + epsCard + epsSection + fallback, 'layout-earnings');
  }

  // ════════════════════════════════════════════════════════
  // TAB: NEWS
  // ════════════════════════════════════════════════════════
  function _renderNews() {
    const news = _data[_sym]?.news || [];
    const MAX_NEWS = 50;

    if (!news.length) {
      YahooFinance.getNews(_sym, MAX_NEWS).then(articles => {
        if (_tab === 'news') {
          if (_data[_sym]) _data[_sym].news = articles;
          _renderNews();
        }
      });
      _bodyHtml(`
        <div style="text-align:center;padding:60px;color:var(--txt4)">
          <i class="fa-solid fa-circle-notch fa-spin" style="font-size:22px;color:var(--b1);margin-bottom:12px;display:block"></i>
          Loading news for ${_sym}...
        </div>`, 'layout-news');
      return;
    }

    const html = `
      <div style="max-width:900px;width:100%;margin:0 auto">
        <div style="font-size:13px;font-weight:700;color:var(--txt3);margin-bottom:16px;display:flex;align-items:center;gap:8px">
          <i class="fa-solid fa-newspaper" style="color:var(--b1)"></i>
          ${news.length} articles — ${_sym}
          <button onclick="StockDetail._refreshNews()" class="btn-sm" style="margin-left:auto;font-size:11px">
            <i class="fa-solid fa-rotate"></i> Refresh
          </button>
        </div>
        ${news.slice(0, MAX_NEWS).map(a => {
          const thumb = a.thumbnail?.resolutions?.find(r => r.width >= 80)?.url;
          const pub   = a.publisher || 'Yahoo Finance';
          const time  = a.providerPublishTime ? _timeAgo(a.providerPublishTime * 1000) : '';
          const sent  = _sentiment(a.title || '');
          return `
            <a href="${a.link || '#'}" target="_blank" rel="noopener" class="sdp-fp-news-item">
              ${thumb ? `<img src="${thumb}" alt="" class="sdp-fp-news-thumb" onerror="this.style.display='none'">` : ''}
              <div style="flex:1;min-width:0">
                <div class="sdp-fp-news-headline">${a.title || 'No title'}</div>
                <div class="sdp-fp-news-meta">
                  <span><i class="fa-solid fa-newspaper" style="font-size:10px"></i> ${pub}</span>
                  <span>${time}</span>
                  <span class="sdp-news-sentiment ${sent.cls}">${sent.label}</span>
                </div>
                ${a.summary ? `<div style="font-size:12px;color:var(--txt3);margin-top:4px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${a.summary}</div>` : ''}
              </div>
              <i class="fa-solid fa-arrow-up-right-from-square" style="color:var(--txt4);font-size:12px;flex-shrink:0;align-self:center"></i>
            </a>`;
        }).join('')}
        <div style="font-size:10px;color:var(--txt4);text-align:center;padding:12px">
          <i class="fa-brands fa-yahoo"></i> Source: Yahoo Finance News
        </div>
      </div>`;
    _bodyHtml(html, 'layout-news');
  }

  // ════════════════════════════════════════════════════════
  // CHART HELPERS
  // ════════════════════════════════════════════════════════
  async function _loadMainFPChart() {
    const containerId = 'sdp-fp-chart-main';
    await _loadChart(containerId, _sym, _iv, _range, 420);
  }

  async function _loadMiniChart(containerId, sym, iv, range, height = 260) {
    await _loadChart(containerId, sym, iv, range, height);
  }

  async function _loadChart(containerId, sym, iv, range, height) {
    const container = document.getElementById(containerId);
    if (!container || typeof LightweightCharts === 'undefined') return;

    // Enforce explicit height BEFORE creating chart
    container.style.height    = `${height}px`;
    container.style.minHeight = `${height}px`;
    container.style.maxHeight = `${height}px`;
    container.style.overflow  = 'hidden';
    container.style.display   = 'block';

    container.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;gap:8px;color:var(--txt4)">
      <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--b1)"></i> Loading chart...
    </div>`;

    const candles = await YahooFinance.getChart(sym, iv, range);

    // Re-check container (user might have switched tab)
    const c2 = document.getElementById(containerId);
    if (!c2) return;

    c2.innerHTML   = '';
    c2.style.height    = `${height}px`;
    c2.style.minHeight = `${height}px`;
    c2.style.maxHeight = `${height}px`;
    c2.style.overflow  = 'hidden';

    if (!candles.length) {
      c2.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--y);gap:8px">
        <i class="fa-solid fa-triangle-exclamation"></i> No chart data
      </div>`;
      return;
    }

    try {
      _destroyFPChart();
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      const w      = c2.getBoundingClientRect().width || c2.offsetWidth || 460;

      _fpChart = LightweightCharts.createChart(c2, {
        width:  w,
        height, // explicit pixel height — NEVER container.clientHeight
        layout: {
          background: { color: 'transparent' },
          textColor:  isDark ? '#9db3d8' : '#3d4f7c',
          fontSize:   11,
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
          horzLines: { color: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
        },
        rightPriceScale: {
          borderColor:  'rgba(128,128,128,0.12)',
          scaleMargins: { top: 0.08, bottom: 0.12 },
        },
        timeScale: {
          borderColor:    'rgba(128,128,128,0.12)',
          timeVisible:    true,
          secondsVisible: false,
        },
        crosshair: { mode: LightweightCharts.CrosshairMode?.Normal ?? 1 },
      });

      const v = typeof LightweightCharts.CandlestickSeries !== 'undefined' ? 4 : 3;
      const opts = { upColor:'#10b981', downColor:'#ef4444', borderUpColor:'#10b981', borderDownColor:'#ef4444', wickUpColor:'#10b981', wickDownColor:'#ef4444' };
      _fpSeries = v === 4
        ? _fpChart.addSeries(LightweightCharts.CandlestickSeries, opts)
        : _fpChart.addCandlestickSeries(opts);

      _fpSeries.setData(candles);
      _fpChart.timeScale().fitContent();

      // ResizeObserver — WIDTH only, NEVER touch height
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(entries => {
          if (!_fpChart || !entries[0]) return;
          const newW = Math.floor(entries[0].contentRect.width);
          if (newW > 0 && newW !== _lastFPWidth) {
            _lastFPWidth = newW;
            try { _fpChart.applyOptions({ width: newW }); } catch(e) {}
          }
        });
        ro.observe(c2);
      }

    } catch(err) {
      console.error('FP Chart error:', err);
      if (c2) c2.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--r);gap:8px">
        <i class="fa-solid fa-xmark"></i> Chart error: ${err.message}
      </div>`;
    }
  }

  function _destroyFPChart() {
    if (_fpChart) {
      try { _fpChart.remove(); } catch(e) {}
      _fpChart = null;
      _fpSeries = null;
      _lastFPWidth = 0;
    }
  }

  // ════════════════════════════════════════════════════════
  // UI HELPERS
  // ════════════════════════════════════════════════════════
  function _bodyHtml(leftHtml, layoutClass, rightHtml = '') {
    const body = document.getElementById('sdp-fp-body');
    if (!body) return;
    body.className = `sdp-fp-body ${layoutClass}`;
    body.innerHTML = leftHtml + (rightHtml ? rightHtml : '');
  }

  function _t(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _updateWLBtn() {
    const btn = document.getElementById('sdp-fp-wl');
    if (!btn || !window.WatchlistManager) return;
    const inWL = WatchlistManager.isInWatchlist(_sym);
    btn.innerHTML = `<i class="fa-${inWL?'solid':'regular'} fa-star"></i> ${inWL ? 'In Watchlist' : 'Add to WL'}`;
    btn.style.color = inWL ? 'var(--y)' : '';
  }

  function _toggleWL() {
    if (!window.WatchlistManager) return;
    WatchlistManager.isInWatchlist(_sym)
      ? WatchlistManager.removeSymbol(_sym)
      : WatchlistManager.addSymbol(_sym);
    _updateWLBtn();
  }

  function _sig(sym) {
    return window._terminalState?.signals?.signals?.[sym] || null;
  }

  // ── Formatters ───────────────────────────────────────────
  function _f(val, prefix = '', decimals = 2, suffix = '') {
    if (val == null || val === '' || isNaN(parseFloat(val))) return '--';
    return `${prefix}${parseFloat(val).toFixed(decimals)}${suffix}`;
  }

  function _fPct(raw) {
    if (raw == null || isNaN(raw)) return '--';
    return `${(raw * 100).toFixed(2)}%`;
  }

  function _fmtNum(n) {
    if (!n) return '--';
    n = Math.abs(parseFloat(n));
    if (n >= 1e9) return `${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n/1e3).toFixed(0)}K`;
    return n.toFixed(0);
  }

  function _fmtMCap(n) {
    if (!n) return '--';
    n = parseFloat(n);
    if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
    if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
    if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
    if (n >= 1e3)  return `$${(n/1e3).toFixed(0)}K`;
    return `$${n.toFixed(2)}`;
  }

  function _timeAgo(ts) {
    const d = Date.now() - ts;
    const m = Math.floor(d/60000), h = Math.floor(m/60), dy = Math.floor(h/24);
    return dy > 0 ? `${dy}d ago` : h > 0 ? `${h}h ago` : m > 0 ? `${m}m ago` : 'Just now';
  }

  function _sentiment(h) {
    h = h.toLowerCase();
    const p = ['beat','surges','rises','gains','record','growth','strong','upgrade','bullish','profit'];
    const n = ['miss','falls','drops','loss','cuts','crash','downgrade','bearish','decline','layoff'];
    const ps = p.filter(w => h.includes(w)).length;
    const ns = n.filter(w => h.includes(w)).length;
    if (ps > ns) return { cls:'positive', label:'▲ Positive' };
    if (ns > ps) return { cls:'negative', label:'▼ Negative' };
    return { cls:'neutral', label:'— Neutral' };
  }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    open,
    close,
    _retryFinancials,
    _refreshNews: async function() {
      if (!_sym) return;
      delete _data[_sym]?.news;
      const articles = await YahooFinance.getNews(_sym, 50);
      if (_data[_sym]) _data[_sym].news = articles;
      _renderNews();
    },
  };

})();

window.StockDetail = StockDetail;

// ════════════════════════════════════════════════════════════
// FIX GLOBAL: Appel immédiat et après DOMContentLoaded
// Empêche les charts de grandir à l'infini
// ════════════════════════════════════════════════════════════
(function applyChartHeightFix() {
  const apply = () => {
    document.querySelectorAll('.chart-container').forEach(el => {
      el.style.cssText += ';height:360px!important;min-height:360px!important;max-height:360px!important;overflow:hidden!important;contain:layout size style!important;';
    });
    document.querySelectorAll('.cp-chart').forEach(el => {
      el.style.cssText += ';height:220px!important;min-height:220px!important;max-height:220px!important;overflow:hidden!important;';
    });
  };
  apply();
  document.addEventListener('DOMContentLoaded', apply);
  // Re-apply after any section switch
  setInterval(apply, 3000);
})();

console.log('✅ StockDetail v3.1 loaded — Full-page | Yahoo Finance only | Chart height fix');