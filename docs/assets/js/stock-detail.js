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
  const _sdCJ = {};          // Chart.js instances StockDetail

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
          <button class="sdp-fp-tab" data-tab="financials">
            <i class="fa-solid fa-dollar-sign"></i> Financials &amp; Earnings
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
      YahooFinance.getNews(sym, 50),
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
    _destroyAllSDCJ();
    _destroyFPChart();

    document.querySelectorAll('.sdp-fp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab)
    );

    switch(tab) {
      case 'overview':   _renderOverview();          break;
      case 'financials': _renderFinancialsEarnings(); break; // ← fusionné
      case 'news':       _renderNews();              break;
      // 'chart' et 'earnings' supprimés
    }

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

    // ── Row 1 : Signal + Mini chart côte à côte ──────────────
    const sigBg    = signal ? (signal.direction === 'buy' ? 'rgba(16,185,129,0.06)' : signal.direction === 'sell' ? 'rgba(239,68,68,0.06)' : 'var(--surf2)') : 'var(--surf2)';
    const sigBorder= signal ? (signal.direction === 'buy' ? 'rgba(16,185,129,0.25)' : signal.direction === 'sell' ? 'rgba(239,68,68,0.25)' : 'var(--bord)') : 'var(--bord)';

    const row1 = `
      <div style="display:grid;grid-template-columns:1fr 320px;gap:12px;align-items:start">

        <!-- Signal block -->
        <div class="sdp-fp-stat-section" style="background:${sigBg};border-color:${sigBorder};padding:14px">
          <div class="sdp-fp-stat-title" style="margin-bottom:10px">
            <i class="fa-solid fa-robot"></i> AlphaVault ML Signal
          </div>
          ${signal ? `
            <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
              ${signal.direction === 'buy'
                ? `<span class="dir-badge buy" style="font-size:13px;padding:5px 14px"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
                : signal.direction === 'sell'
                  ? `<span class="dir-badge sell" style="font-size:13px;padding:5px 14px"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
                  : `<span class="dir-badge neutral" style="font-size:13px;padding:5px 14px"><i class="fa-solid fa-minus"></i> NEUTRAL</span>`}
              <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;flex:1">
                <div style="background:var(--surf);border:1px solid var(--bord);border-radius:7px;padding:7px 10px">
                  <div style="font-size:9px;color:var(--txt4);margin-bottom:2px">Score</div>
                  <div style="font-size:14px;font-weight:800;font-family:var(--mono);color:var(--b1)">${parseFloat(signal.final_score||0).toFixed(3)}</div>
                </div>
                <div style="background:var(--surf);border:1px solid var(--bord);border-radius:7px;padding:7px 10px">
                  <div style="font-size:9px;color:var(--txt4);margin-bottom:2px">Confidence</div>
                  <div style="font-size:14px;font-weight:800;font-family:var(--mono)">${(parseFloat(signal.confidence||0)*100).toFixed(1)}%</div>
                </div>
                <div style="background:var(--surf);border:1px solid var(--bord);border-radius:7px;padding:7px 10px">
                  <div style="font-size:9px;color:var(--txt4);margin-bottom:2px">Buy Prob</div>
                  <div style="font-size:14px;font-weight:800;font-family:var(--mono);color:var(--g)">${(parseFloat(signal.buy_prob||0.5)*100).toFixed(1)}%</div>
                </div>
                <div style="background:var(--surf);border:1px solid var(--bord);border-radius:7px;padding:7px 10px">
                  <div style="font-size:9px;color:var(--txt4);margin-bottom:2px">Council</div>
                  <div style="font-size:12px;font-weight:800;color:${(signal.council||'').includes('execute')?'var(--g)':'var(--y)'}">${(signal.council||'wait').toUpperCase()}</div>
                </div>
              </div>
            </div>
            <div style="margin-top:8px">
              <span class="regime-chip">${(signal.regime||'--').replace(/_/g,' ')}</span>
            </div>
          ` : `<div style="color:var(--txt4);font-size:12px"><i class="fa-solid fa-clock"></i> Awaiting signal cycle...</div>`}
        </div>

        <!-- Mini chart -->
        <div class="sdp-fp-stat-section" style="padding:12px">
          <div class="sdp-fp-stat-title" style="margin-bottom:8px">
            <i class="fa-solid fa-chart-line"></i> Price Chart (1Y)
          </div>
          <div id="sdp-fp-chart-mini" class="sdp-fp-chart-mini-sm"></div>
          <div style="font-size:9px;color:var(--txt4);text-align:center;margin-top:4px">
            <i class="fa-brands fa-yahoo"></i> Yahoo Finance · Daily
          </div>
        </div>

      </div>`;

    // ── Row 2 : Company profile ───────────────────────────────
    const descBlock = profile.longBusinessSummary ? `
      <div class="sdp-fp-stat-section" style="padding:14px">
        <div class="sdp-fp-stat-title" style="margin-bottom:8px">
          <i class="fa-solid fa-building"></i> About ${sym}
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          ${profile.sector   ? `<span class="regime-chip">${profile.sector}</span>` : ''}
          ${profile.industry ? `<span class="regime-chip">${profile.industry}</span>` : ''}
          ${profile.country  ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profile.country}</span>` : ''}
          ${profile.fullTimeEmployees ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profile.fullTimeEmployees)}</span>` : ''}
        </div>
        <p id="sdp-desc-p" style="font-size:12px;color:var(--txt2);line-height:1.7;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">
          ${profile.longBusinessSummary}
        </p>
        <button class="sdp-desc-toggle" id="sdp-desc-toggle">Show more</button>
      </div>` : '';

    // ── Row 3 : Key stats grid ────────────────────────────────
    const statsBlock = `
      <div class="sdp-fp-stat-section" style="padding:14px">
        <div class="sdp-fp-stat-title" style="margin-bottom:10px">
          <i class="fa-solid fa-table"></i> Key Statistics
          ${isFallback ? `<span style="font-size:9px;color:var(--y);margin-left:8px">(partial data)</span>` : ''}
        </div>
        ${kstats.length ? `
          <div class="sdp-fp-stats">
            ${kstats.map(i => `
              <div class="sdp-fp-stat-item">
                <div class="sdp-fp-stat-lbl">${i.l}</div>
                <div class="sdp-fp-stat-val">${i.v}</div>
              </div>`).join('')}
          </div>` : `<div style="color:var(--txt4);font-size:12px;text-align:center;padding:12px">
            <i class="fa-solid fa-triangle-exclamation" style="color:var(--y)"></i>
            Yahoo Finance data unavailable.
          </div>`}
      </div>`;

    // ── Assemble en layout mono-colonne ───────────────────────
    _bodyHtml(row1 + descBlock + statsBlock, 'layout-overview-v2');

    // ── Description toggle ───────────────────────────────────
    const tog  = document.getElementById('sdp-desc-toggle');
    const para = document.getElementById('sdp-desc-p');
    if (tog && para) {
      let expanded = false;
      tog.addEventListener('click', () => {
        expanded = !expanded;
        para.style.webkitLineClamp = expanded ? 'unset' : '2';
        para.style.overflow        = expanded ? 'visible' : 'hidden';
        tog.textContent            = expanded ? 'Show less' : 'Show more';
      });
    }

    // ── Mini chart (hauteur réduite 180px) ───────────────────
    setTimeout(() => _loadMiniChart('sdp-fp-chart-mini', _sym, '1d', '1y', 180), 80);

    // ── TA Charts ────────────────────────────────────────────
    setTimeout(() => _appendSDTASection(_sym), 150);
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
  // TAB: FINANCIALS & EARNINGS (fusionné)
  // ════════════════════════════════════════════════════════
  function _renderFinancialsEarnings() {
    const sum    = _data[_sym]?.summary || {};
    const q      = _data[_sym]?.quote   || {};
    const fin    = sum.financialData          || {};
    const stats  = sum.defaultKeyStatistics   || {};
    const detail = sum.summaryDetail          || {};
    const price  = sum.price                  || {};
    const profile= sum.assetProfile           || {};
    const trend  = sum.earningsTrend?.trend   || sum.earnings?.earningsChart?.quarterly || [];
    const calendar = sum.calendarEvents?.earnings || {};
    const nextDates = (calendar.earningsDate || [])
      .map(d => new Date((d.raw || d) * 1000))
      .filter(d => d > new Date());
    const nextEarnings = nextDates[0]?.toLocaleDateString('en-US', {
      month:'long', day:'numeric', year:'numeric'
    });
    const epsFromStats = stats.trailingEps?.raw || stats.forwardEps?.raw;

    const kstats = [
      { l:'Market Cap',       v: _fmtMCap(price.marketCap?.raw || q.market_cap) },
      { l:'Price',            v: _f(q.price || detail.regularMarketPrice?.raw, '$') },
      { l:'52W High',         v: _f(q['52w_high'] || detail.fiftyTwoWeekHigh?.raw, '$') },
      { l:'52W Low',          v: _f(q['52w_low']  || detail.fiftyTwoWeekLow?.raw, '$') },
      { l:'P/E (TTM)',        v: _f(detail.trailingPE?.raw,  '', 2) },
      { l:'Forward P/E',      v: _f(detail.forwardPE?.raw,   '', 2) },
      { l:'EPS (TTM)',        v: _f(epsFromStats,             '$', 2) },
      { l:'Beta',             v: _f(detail.beta?.raw,         '', 2) },
      { l:'Div Yield',        v: _fPct(detail.dividendYield?.raw) },
      { l:'P/S Ratio',        v: _f(stats.priceToSalesTrailing12Months?.raw, '', 2) },
      { l:'P/B Ratio',        v: _f(stats.priceToBook?.raw, '', 2) },
      { l:'EV/EBITDA',        v: _f(stats.enterpriseToEbitda?.raw, '', 2) },
      { l:'PEG Ratio',        v: _f(stats.pegRatio?.raw, '', 2) },
      { l:'Revenue (TTM)',    v: _fmtMCap(fin.totalRevenue?.raw) },
      { l:'Gross Margin',     v: _fPct(fin.grossMargins?.raw) },
      { l:'Operating Margin', v: _fPct(fin.operatingMargins?.raw) },
      { l:'Profit Margin',    v: _fPct(fin.profitMargins?.raw) },
      { l:'EBITDA',           v: _fmtMCap(fin.ebitda?.raw) },
      { l:'Revenue Growth',   v: _fPct(fin.revenueGrowth?.raw) },
      { l:'Earnings Growth',  v: _fPct(fin.earningsGrowth?.raw) },
      { l:'Total Cash',       v: _fmtMCap(fin.totalCash?.raw) },
      { l:'Total Debt',       v: _fmtMCap(fin.totalDebt?.raw) },
      { l:'Debt/Equity',      v: _f(fin.debtToEquity?.raw, '', 2) },
      { l:'Free Cash Flow',   v: _fmtMCap(fin.freeCashflow?.raw) },
      { l:'Current Ratio',    v: _f(fin.currentRatio?.raw, '', 2) },
      { l:'ROE',              v: _fPct(fin.returnOnEquity?.raw) },
      { l:'ROA',              v: _fPct(fin.returnOnAssets?.raw) },
      { l:'Short % Float',    v: _fPct(stats.shortPercentOfFloat?.raw) },
      { l:'Insider Own.',     v: _fPct(stats.heldPercentInsiders?.raw) },
      { l:'Institution Own.', v: _fPct(stats.heldPercentInstitutions?.raw) },
    ].filter(i => i.v && i.v !== '--');

    const hasFull = fin.totalRevenue || stats.enterpriseValue;
    const srcBadge = hasFull
      ? `<span style="font-size:10px;color:var(--g);background:rgba(16,185,129,0.1);padding:2px 8px;border-radius:10px;border:1px solid rgba(16,185,129,0.25)"><i class="fa-solid fa-circle-check"></i> Full Data</span>`
      : `<span style="font-size:10px;color:var(--y);background:rgba(245,158,11,0.1);padding:2px 8px;border-radius:10px;border:1px solid rgba(245,158,11,0.25)"><i class="fa-solid fa-triangle-exclamation"></i> Quote Only</span>`;

    // ── Section 1 : Key Stats ─────────────────────────────────
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
          <div style="text-align:center;padding:24px;color:var(--txt4)">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:22px;color:var(--y);margin-bottom:8px;display:block"></i>
            <strong style="color:var(--txt)">Financial data unavailable</strong><br>
            <span style="font-size:11px;margin-top:4px;display:block">The Yahoo Finance proxy needs to return full quoteSummary modules.</span>
            <button onclick="StockDetail._retryFinancials()" class="btn-sm" style="margin-top:10px">
              <i class="fa-solid fa-rotate"></i> Retry
            </button>
          </div>`}
      </div>`;

    // ── Section 2 : Next Earnings Date ───────────────────────
    const calSection = nextEarnings ? `
      <div class="sdp-fp-stat-section" style="border-color:rgba(59,130,246,0.3);background:rgba(59,130,246,0.04)">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-calendar-check"></i> Next Earnings Date</div>
        <div style="font-size:24px;font-weight:900;color:var(--b1);font-family:var(--mono);margin-bottom:4px">${nextEarnings}</div>
        <div style="font-size:11px;color:var(--txt4)">Market will be watching closely</div>
      </div>` : '';

    // ── Section 3 : EPS Summary ───────────────────────────────
    const epsCard = epsFromStats ? `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-dollar-sign"></i> EPS Summary</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px">
          <div class="sdp-fp-stat-item">
            <div class="sdp-fp-stat-lbl">EPS (TTM)</div>
            <div class="sdp-fp-stat-val" style="color:${epsFromStats>0?'var(--g)':'var(--r)'}">$${epsFromStats.toFixed(2)}</div>
          </div>
          ${q.price && epsFromStats ? `
          <div class="sdp-fp-stat-item">
            <div class="sdp-fp-stat-lbl">P/E (TTM)</div>
            <div class="sdp-fp-stat-val">${(q.price / epsFromStats).toFixed(2)}</div>
          </div>` : ''}
          ${stats.forwardEps?.raw ? `
          <div class="sdp-fp-stat-item">
            <div class="sdp-fp-stat-lbl">Fwd EPS</div>
            <div class="sdp-fp-stat-val" style="color:var(--b1)">$${parseFloat(stats.forwardEps.raw).toFixed(2)}</div>
          </div>` : ''}
        </div>
      </div>` : '';

    // ── Section 4 : EPS & Revenue Estimates par période ───────
    const PERIOD_LABELS = {
      '0q':'Current Quarter', '+1q':'Next Quarter',
      '0y':'Current Year',    '+1y':'Next Year',
    };

    const epsSection = trend.length ? `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-chart-bar"></i> EPS &amp; Revenue Estimates</div>
        ${trend.map(t => {
          const epsEst  = t.earningsEstimate?.avg?.raw;
          const epsYago = t.earningsEstimate?.yearAgoEps?.raw;
          const revEst  = t.revenueEstimate?.avg?.raw;
          const revGrow = t.revenueEstimate?.growth?.raw;
          const period  = PERIOD_LABELS[t.period] || t.period;
          if (!epsEst && !revEst) return '';
          return `
            <div style="margin-bottom:14px;padding-bottom:12px;border-bottom:1px solid var(--bord)">
              <div style="font-size:12px;font-weight:700;color:var(--txt);margin-bottom:8px;display:flex;align-items:center;gap:8px">
                <span class="regime-chip">${period}</span>
                ${revGrow != null ? `<span style="font-size:11px;font-weight:600;color:${revGrow>0?'var(--g)':'var(--r)'}">Rev ${revGrow>0?'+':''}${(revGrow*100).toFixed(1)}% YoY</span>` : ''}
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">
                ${epsEst  != null ? `<div class="sdp-fp-stat-item"><div class="sdp-fp-stat-lbl">EPS Estimate</div><div class="sdp-fp-stat-val" style="color:var(--b1)">$${epsEst.toFixed(2)}</div></div>` : ''}
                ${epsYago != null ? `<div class="sdp-fp-stat-item"><div class="sdp-fp-stat-lbl">Year Ago EPS</div><div class="sdp-fp-stat-val">$${epsYago.toFixed(2)}</div></div>` : ''}
                ${revEst  != null ? `<div class="sdp-fp-stat-item"><div class="sdp-fp-stat-lbl">Rev Estimate</div><div class="sdp-fp-stat-val">${_fmtMCap(revEst)}</div></div>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>` : '';

    // ── Section 5 : Company Profile ───────────────────────────
    const profileBlock = profile.longBusinessSummary ? `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title"><i class="fa-solid fa-building"></i> About ${_sym}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
          ${profile.sector   ? `<span class="regime-chip">${profile.sector}</span>` : ''}
          ${profile.industry ? `<span class="regime-chip">${profile.industry}</span>` : ''}
          ${profile.country  ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profile.country}</span>` : ''}
          ${profile.fullTimeEmployees ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profile.fullTimeEmployees)}</span>` : ''}
        </div>
        <p id="sdp-desc-p2" style="font-size:12px;color:var(--txt2);line-height:1.7;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">
          ${profile.longBusinessSummary}
        </p>
        <button class="sdp-desc-toggle" id="sdp-desc-toggle2">Show more</button>
      </div>` : '';

    // ── Fallback si rien n'est disponible ─────────────────────
    const nothingAvailable = !kstats.length && !nextEarnings && !epsFromStats && !trend.length;
    const fallback = nothingAvailable ? `
      <div style="text-align:center;padding:40px;color:var(--txt4)">
        <i class="fa-solid fa-circle-info" style="font-size:28px;color:var(--b1);margin-bottom:12px;display:block"></i>
        <strong style="color:var(--txt)">Data not yet available for ${_sym}</strong><br>
        <span style="font-size:12px;margin-top:6px;display:block">
          ${_sym.match(/^(SPY|QQQ|IWM|DIA|VTI|GLD|TLT)$/)
            ? 'ETFs show limited financial data.'
            : 'The Yahoo proxy may need the /summary endpoint with full modules.'}
        </span>
        <button onclick="StockDetail._retryFinancials()" class="btn-sm" style="margin-top:12px">
          <i class="fa-solid fa-rotate"></i> Retry
        </button>
      </div>` : '';

    // ── Layout mono-colonne (pas de creux) ────────────────────
    _bodyHtml(
      calSection + epsCard + statsBlock + epsSection + profileBlock + fallback,
      'layout-overview-v2'
    );

    // Description toggle
    const tog2  = document.getElementById('sdp-desc-toggle2');
    const para2 = document.getElementById('sdp-desc-p2');
    if (tog2 && para2) {
      let expanded = false;
      tog2.addEventListener('click', () => {
        expanded = !expanded;
        para2.style.webkitLineClamp = expanded ? 'unset' : '3';
        para2.style.overflow        = expanded ? 'visible' : 'hidden';
        tog2.textContent            = expanded ? 'Show less' : 'Show more';
      });
    }
  }

  // ════════════════════════════════════════════════════════
  // TAB: NEWS
  // ════════════════════════════════════════════════════════
  function _renderNews() {
    const news    = _data[_sym]?.news || [];
    const MAX_NEWS = 50; // ← déjà 50

    // Si le cache a < 10 articles, force un rechargement
    if (news.length < 10) {
      YahooFinance.getNews(_sym, 50).then(articles => {
        if (_tab === 'news') {
          if (_data[_sym]) _data[_sym].news = articles;
          _renderNews();
        }
      });
      _bodyHtml(`
        <div style="text-align:center;padding:40px;color:var(--txt4)">
          <i class="fa-solid fa-circle-notch fa-spin" style="font-size:20px;color:var(--b1);margin-bottom:10px;display:block"></i>
          Loading news for ${_sym}...
        </div>`, 'layout-overview-v2');
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

  // ────────────────────────────────────────────────────────
  // Destroy all Chart.js instances créés dans StockDetail
  // ────────────────────────────────────────────────────────
  function _destroyAllSDCJ() {
    Object.keys(_sdCJ).forEach(id => {
      if (_sdCJ[id]) {
        try { _sdCJ[id].destroy(); } catch(e) {}
        delete _sdCJ[id];
      }
    });
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
  // TA CHARTS — Calculs & Rendu Chart.js pour Stock Detail
  // 100% Yahoo Finance data (getChart)
  // ════════════════════════════════════════════════════════

  // ── Helpers TA (autonomes, pas de dépendance à terminal.js) ──

  function _sdEma(arr, p) {
    if (arr.length < p) return arr.map(() => null);
    const k   = 2 / (p + 1);
    const out = Array(p - 1).fill(null);
    let v     = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out.push(v);
    for (let i = p; i < arr.length; i++) { v = arr[i] * k + v * (1 - k); out.push(v); }
    return out;
  }

  function _sdRsiCalc(closes, p = 14) {
    if (closes.length < p + 1) return closes.map(() => null);
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) {
      const d = closes[i] - closes[i - 1];
      g += Math.max(d, 0);
      l += Math.max(-d, 0);
    }
    let ag = g / p, al = l / p;
    const out = Array(p).fill(null);
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    for (let i = p + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      ag = (ag * (p - 1) + Math.max(d, 0)) / p;
      al = (al * (p - 1) + Math.max(-d, 0)) / p;
      out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return out;
  }

  function _sdMacdCalc(closes, f = 12, s = 26, sig = 9) {
    const ef  = _sdEma(closes, f);
    const es  = _sdEma(closes, s);
    const ml  = closes.map((_, i) =>
      ef[i] != null && es[i] != null ? ef[i] - es[i] : null
    );
    const valid = ml.filter(v => v != null);
    const se    = _sdEma(valid, sig);
    let si = 0;
    const sl = ml.map(v => v == null ? null : se[si++] ?? null);
    return { line: ml, signal: sl, hist: ml.map((v, i) => v != null && sl[i] != null ? v - sl[i] : null) };
  }

  function _sdIchimokuCalc(candles) {
    const n  = candles.length;
    const H  = candles.map(c => c.high);
    const L  = candles.map(c => c.low);
    const C  = candles.map(c => c.close);
    const hh = (a, i, p) => Math.max(...a.slice(Math.max(0, i - p + 1), i + 1));
    const ll = (a, i, p) => Math.min(...a.slice(Math.max(0, i - p + 1), i + 1));

    const tenkan   = candles.map((_, i) => i >= 8  ? (hh(H, i, 9)  + ll(L, i, 9))  / 2 : null);
    const kijun    = candles.map((_, i) => i >= 25 ? (hh(H, i, 26) + ll(L, i, 26)) / 2 : null);
    const senkouA  = candles.map((_, i) =>
      tenkan[i] != null && kijun[i] != null ? (tenkan[i] + kijun[i]) / 2 : null
    );
    const senkouB  = candles.map((_, i) => i >= 51 ? (hh(H, i, 52) + ll(L, i, 52)) / 2 : null);
    const chikou   = [...C.slice(26), ...Array(26).fill(null)]; // Lagging

    // Kumo twist points
    const twists = [];
    for (let i = 1; i < n; i++) {
      if (senkouA[i] != null && senkouB[i] != null && senkouA[i-1] != null && senkouB[i-1] != null) {
        if ((senkouA[i] > senkouB[i]) !== (senkouA[i-1] > senkouB[i-1])) {
          twists.push(i);
        }
      }
    }

    return { tenkan, kijun, senkouA, senkouB, chikou, price: C, twists };
  }

  function _sdFibCalc(candles) {
    const sl   = candles.slice(-Math.min(60, candles.length));
    const hi   = Math.max(...sl.map(c => c.high));
    const lo   = Math.min(...sl.map(c => c.low));
    const d    = hi - lo;
    const RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0];
    const EXTS   = [1.272, 1.618, 2.0, 2.618];
    const levels = RATIOS.map(r => ({
      pct:   r,
      label: `${(r * 100).toFixed(1)}%`,
      price: +(hi - d * r).toFixed(2),
      key:   [0.382, 0.5, 0.618].includes(r),
    }));
    const exts = EXTS.map(r => ({
      pct:   r,
      label: `${(r * 100).toFixed(1)}%`,
      price: +(lo + d * r).toFixed(2),
    }));
    return { hi, lo, d, levels, exts };
  }

  // ── Append TA section au body (appelé depuis _renderOverview) ──

  async function _appendSDTASection(sym) {
    const body = document.getElementById('sdp-fp-body');
    if (!body) return;

    // Supprime l'ancienne section si elle existe
    const old = document.getElementById('sd-ta-full');
    if (old) old.remove();

    // Créer le container full-width
    const div = document.createElement('div');
    div.id    = 'sd-ta-full';
    div.style.cssText = 'grid-column:1/-1;margin-top:4px';
    div.innerHTML = `
      <div class="sdp-fp-stat-section" style="padding:16px">
        <div class="sdp-fp-stat-title" style="margin-bottom:14px">
          <i class="fa-solid fa-chart-candlestick" style="color:var(--b1)"></i>
          Technical Analysis Charts
          <span style="margin-left:auto;font-size:10px;color:var(--txt4);font-weight:400">
            <i class="fa-brands fa-yahoo"></i> Yahoo Finance · 1Y Daily
          </span>
          <div id="sd-ta-loading" style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--txt4);font-weight:400">
            <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--b1)"></i> Loading indicators...
          </div>
        </div>

        <!-- Grid RSI + MACD -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:flex;justify-content:space-between">
              <span><i class="fa-solid fa-gauge" style="color:var(--b1)"></i> RSI (14)</span>
              <span id="sd-rsi-val" style="color:var(--txt)">--</span>
            </div>
            <div style="height:80px;position:relative;overflow:hidden;contain:strict">
              <canvas id="sd-rsi-chart"></canvas>
            </div>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:flex;justify-content:space-between">
              <span><i class="fa-solid fa-wave-square" style="color:var(--b2)"></i> MACD (12,26,9)</span>
              <span id="sd-macd-val" style="color:var(--txt)">--</span>
            </div>
            <div style="height:80px;position:relative;overflow:hidden;contain:strict">
              <canvas id="sd-macd-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Ichimoku Cloud Chart -->
        <div style="margin-bottom:12px">
          <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
            <span><i class="fa-solid fa-cloud" style="color:var(--c)"></i> Ichimoku Cloud (9,26,52)</span>
            <span id="sd-ichi-sig" style="font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px">--</span>
          </div>
          <div style="height:200px;position:relative;overflow:hidden;contain:strict">
            <canvas id="sd-ichi-chart"></canvas>
          </div>
        </div>

        <!-- Fibonacci Retracement Visualization -->
        <div>
          <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">
            <i class="fa-solid fa-layer-group" style="color:var(--b2)"></i> Fibonacci Retracement (60D)
          </div>
          <div id="sd-fib-viz">
            <div style="height:150px;position:relative;overflow:hidden;contain:strict">
              <i class="fa-solid fa-circle-notch fa-spin"></i>
            </div>
          </div>
        </div>
      </div>`;

    body.appendChild(div);

    // Charge les données et rend les graphiques
    await _renderSDTACharts(sym);
  }

  async function _renderSDTACharts(sym) {
    const loadingEl = document.getElementById('sd-ta-loading');

    try {
      // Fetch 1Y daily candles depuis Yahoo Finance
      const candles = await YahooFinance.getChart(sym, '1d', '1y');

      if (!candles || candles.length < 55) {
        if (loadingEl) loadingEl.innerHTML = '<span style="color:var(--y)"><i class="fa-solid fa-triangle-exclamation"></i> Insufficient data (min 55 bars)</span>';
        return;
      }

      if (loadingEl) loadingEl.style.display = 'none';

      const isDark  = document.documentElement.getAttribute('data-theme') === 'dark';
      const closes  = candles.map(c => c.close);
      const labels  = candles.map(c => {
        const d = new Date(c.time * 1000);
        return `${d.getMonth()+1}/${d.getDate()}`;
      });

      // ── RSI ─────────────────────────────────────────────
      const rsiArr  = _sdRsiCalc(closes, 14);
      const rsiLast = rsiArr.filter(v => v != null).at(-1) ?? 50;
      const rsiEl   = document.getElementById('sd-rsi-val');
      if (rsiEl) {
        rsiEl.textContent = rsiLast.toFixed(1);
        rsiEl.style.color = rsiLast > 70 ? 'var(--r)' : rsiLast < 30 ? 'var(--g)' : 'var(--y)';
      }
      _sdRenderRSI('sd-rsi-chart', labels, rsiArr, isDark);

      // ── MACD ────────────────────────────────────────────
      const macdData = _sdMacdCalc(closes);
      const macdLast = macdData.line.filter(v => v != null).at(-1) ?? 0;
      const sigLast  = macdData.signal.filter(v => v != null).at(-1) ?? 0;
      const macdEl   = document.getElementById('sd-macd-val');
      if (macdEl) {
        macdEl.textContent = `${macdLast > sigLast ? '▲' : '▼'} ${macdLast.toFixed(4)}`;
        macdEl.style.color = macdLast > sigLast ? 'var(--g)' : 'var(--r)';
      }
      _sdRenderMACD('sd-macd-chart', labels, macdData, isDark);

      // ── Ichimoku ─────────────────────────────────────────
      const ichi       = _sdIchimokuCalc(candles);
      const lastPrice  = closes[closes.length - 1];
      const lastA      = ichi.senkouA.filter(v => v != null).at(-1);
      const lastB      = ichi.senkouB.filter(v => v != null).at(-1);
      const cloudSig   = lastA && lastB
        ? (lastPrice > Math.max(lastA, lastB) ? 'BULLISH'
          : lastPrice < Math.min(lastA, lastB) ? 'BEARISH' : 'IN CLOUD')
        : 'N/A';
      const sigEl = document.getElementById('sd-ichi-sig');
      if (sigEl) {
        const c = cloudSig === 'BULLISH' ? 'var(--g)' : cloudSig === 'BEARISH' ? 'var(--r)' : 'var(--y)';
        sigEl.textContent  = cloudSig;
        sigEl.style.cssText= `color:${c};background:${c}18;border:1px solid ${c}40;font-size:10px;font-weight:700;padding:2px 8px;border-radius:4px`;
      }
      _sdRenderIchimoku('sd-ichi-chart', labels, ichi, isDark);

      // ── Fibonacci ────────────────────────────────────────
      const fib = _sdFibCalc(candles);
      _sdRenderFibViz('sd-fib-viz', fib, lastPrice, isDark);

    } catch (err) {
      console.error('[SD TA Charts]', err);
      if (loadingEl) loadingEl.innerHTML = `<span style="color:var(--r)"><i class="fa-solid fa-xmark"></i> Error: ${err.message}</span>`;
    }
  }

  // ── RSI Chart.js ─────────────────────────────────────────
  function _sdRenderRSI(canvasId, labels, rsiArr, isDark) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    _destroyAllSDCJ(); // handled per-chart below
    if (_sdCJ[canvasId]) { try { _sdCJ[canvasId].destroy(); } catch(e) {} }

    const txtColor  = isDark ? '#9db3d8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';

    // Slice to last 120 bars for readability
    const N   = 120;
    const rsi = rsiArr.slice(-N);
    const lbl = labels.slice(-N);

    _sdCJ[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: lbl,
        datasets: [
          {
            label:           'RSI',
            data:            rsi,
            borderColor:     '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth:     1.5,
            pointRadius:     0,
            tension:         0.4,
            spanGaps:        true,
          },
          {
            label:           'OB',
            data:            lbl.map(() => 70),
            borderColor:     'rgba(239,68,68,0.4)',
            borderWidth:     1,
            borderDash:      [4, 3],
            pointRadius:     0,
            fill:            false,
          },
          {
            label:           'OS',
            data:            lbl.map(() => 30),
            borderColor:     'rgba(16,185,129,0.4)',
            borderWidth:     1,
            borderDash:      [4, 3],
            pointRadius:     0,
            fill:            false,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0d1530' : '#fff',
            bodyColor:       txtColor,
            borderColor:     isDark ? '#1a2845' : '#dde3f0',
            borderWidth:     1,
            callbacks: {
              label: ctx => ` RSI: ${parseFloat(ctx.parsed.y).toFixed(1)}`,
              filter: item => item.datasetIndex === 0,
            },
          },
        },
        scales: {
          x: {
            ticks:  { color: txtColor, maxTicksLimit: 6, font: { size: 9 } },
            grid:   { color: gridColor },
          },
          y: {
            min:    0,
            max:    100,
            ticks:  { color: txtColor, font: { size: 9 }, callback: v => v },
            grid:   { color: gridColor },
          },
        },
      },
    });
  }

  // ── MACD Chart.js ────────────────────────────────────────
  function _sdRenderMACD(canvasId, labels, macdData, isDark) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    if (_sdCJ[canvasId]) { try { _sdCJ[canvasId].destroy(); } catch(e) {} }

    const txtColor  = isDark ? '#9db3d8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';

    const N    = 120;
    const hist = macdData.hist.slice(-N);
    const line = macdData.line.slice(-N);
    const sig  = macdData.signal.slice(-N);
    const lbl  = labels.slice(-N);

    _sdCJ[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: lbl,
        datasets: [
          {
            type:            'bar',
            label:           'Histogram',
            data:            hist,
            backgroundColor: hist.map(v =>
              v == null ? 'transparent' : v >= 0 ? 'rgba(16,185,129,0.6)' : 'rgba(239,68,68,0.6)'
            ),
            borderWidth:     0,
            borderRadius:    1,
          },
          {
            type:            'line',
            label:           'MACD Line',
            data:            line,
            borderColor:     '#3b82f6',
            borderWidth:     1.5,
            pointRadius:     0,
            tension:         0.3,
            fill:            false,
            spanGaps:        true,
          },
          {
            type:            'line',
            label:           'Signal',
            data:            sig,
            borderColor:     '#f97316',
            borderWidth:     1.5,
            pointRadius:     0,
            tension:         0.3,
            fill:            false,
            spanGaps:        true,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0d1530' : '#fff',
            bodyColor:       txtColor,
            borderColor:     isDark ? '#1a2845' : '#dde3f0',
            borderWidth:     1,
          },
        },
        scales: {
          x: {
            ticks: { color: txtColor, maxTicksLimit: 6, font: { size: 9 } },
            grid:  { color: gridColor },
          },
          y: {
            ticks: { color: txtColor, font: { size: 9 } },
            grid:  { color: gridColor },
          },
        },
      },
    });
  }

  // ── Ichimoku Cloud Chart.js ───────────────────────────────
  function _sdRenderIchimoku(canvasId, labels, ichi, isDark) {
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;
    if (_sdCJ[canvasId]) { try { _sdCJ[canvasId].destroy(); } catch(e) {} }

    const txtColor  = isDark ? '#9db3d8' : '#64748b';
    const gridColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';

    // Slice derniers 120 bars
    const N  = 120;
    const sl = (arr) => arr.slice(-N);
    const lbl = labels.slice(-N);

    _sdCJ[canvasId] = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: lbl,
        datasets: [
          {
            label:           'Senkou A',
            data:            sl(ichi.senkouA),
            borderColor:     'rgba(16,185,129,0.6)',
            backgroundColor: 'rgba(16,185,129,0.12)',
            borderWidth:     1,
            pointRadius:     0,
            fill:            '+1',   // ← cloud fill vers Senkou B
            spanGaps:        true,
            tension:         0.2,
          },
          {
            label:           'Senkou B',
            data:            sl(ichi.senkouB),
            borderColor:     'rgba(239,68,68,0.6)',
            backgroundColor: 'rgba(239,68,68,0.12)',
            borderWidth:     1,
            pointRadius:     0,
            fill:            false,
            spanGaps:        true,
            tension:         0.2,
          },
          {
            label:           'Tenkan-sen',
            data:            sl(ichi.tenkan),
            borderColor:     '#ef4444',
            backgroundColor: 'transparent',
            borderWidth:     1.5,
            pointRadius:     0,
            fill:            false,
            spanGaps:        true,
          },
          {
            label:           'Kijun-sen',
            data:            sl(ichi.kijun),
            borderColor:     '#3b82f6',
            backgroundColor: 'transparent',
            borderWidth:     1.5,
            pointRadius:     0,
            fill:            false,
            spanGaps:        true,
          },
          {
            label:           'Price',
            data:            sl(ichi.price),
            borderColor:     '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth:     2,
            pointRadius:     0,
            fill:            false,
            spanGaps:        true,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        interaction:         { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display:  true,
            position: 'bottom',
            labels:   { color: txtColor, font: { size: 9 }, padding: 8, boxWidth: 12 },
          },
          tooltip: {
            backgroundColor: isDark ? '#0d1530' : '#fff',
            bodyColor:       txtColor,
            borderColor:     isDark ? '#1a2845' : '#dde3f0',
            borderWidth:     1,
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y != null ? '$'+ctx.parsed.y.toFixed(2) : '--'}`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: txtColor, maxTicksLimit: 8, font: { size: 9 } },
            grid:  { color: gridColor },
          },
          y: {
            ticks: {
              color:    txtColor,
              font:     { size: 9 },
              callback: v => '$' + v.toFixed(0),
            },
            grid: { color: gridColor },
          },
        },
      },
    });
  }

  // ── Fibonacci HTML Visualization ─────────────────────────
  function _sdRenderFibViz(containerId, fib, currentPrice, isDark) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const range  = fib.hi - fib.lo;
    const priceBarPct = range > 0 ? Math.max(0, Math.min(100, ((fib.hi - currentPrice) / range) * 100)) : 50;

    el.innerHTML = `
      <div style="padding:4px 0">
        <!-- Price indicator bar -->
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding:8px;background:rgba(139,92,246,0.08);border-radius:8px;border:1px solid rgba(139,92,246,0.2)">
          <i class="fa-solid fa-crosshairs" style="color:var(--b2)"></i>
          <span style="font-size:11px;font-weight:700;color:var(--txt)">Current: $${currentPrice.toFixed(2)}</span>
          <span style="font-size:10px;color:var(--txt4);margin-left:auto">Range: $${fib.lo.toFixed(2)} — $${fib.hi.toFixed(2)}</span>
        </div>

        <!-- Fibonacci levels -->
        <div style="position:relative">
          ${fib.levels.map(lv => {
            const barPct  = range > 0 ? ((fib.hi - lv.price) / range) * 100 : 50;
            const isNear  = Math.abs(lv.price - currentPrice) / Math.max(currentPrice, 1) < 0.012;
            const isAbove = currentPrice >= lv.price;
            const levelColor = lv.key ? 'var(--b1)' : 'var(--txt3)';

            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 6px;margin-bottom:3px;border-radius:6px;
                                background:${isNear ? 'rgba(59,130,246,0.08)' : 'transparent'};
                                border:1px solid ${isNear ? 'rgba(59,130,246,0.2)' : 'transparent'}">
              <span style="font-size:10px;font-weight:800;color:${levelColor};min-width:38px;font-family:var(--mono)">${lv.label}</span>
              <div style="flex:1;height:6px;background:var(--surf3);border-radius:3px;overflow:hidden;position:relative">
                <div style="width:${barPct.toFixed(1)}%;height:100%;background:${isAbove ? 'var(--g)' : 'var(--surf3)'};border-radius:3px;transition:width 0.6s ease"></div>
              </div>
              <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:${levelColor};min-width:65px;text-align:right">
                $${lv.price.toFixed(2)}
              </span>
              ${lv.key ? `<span style="font-size:8px;color:var(--b2);font-weight:700;background:rgba(139,92,246,0.1);padding:1px 5px;border-radius:3px;flex-shrink:0">KEY</span>` : '<span style="min-width:32px"></span>'}
              ${isNear ? `<span style="font-size:9px;color:var(--b1);font-weight:800;flex-shrink:0">← NOW</span>` : ''}
            </div>`;
          }).join('')}

          <!-- Current price line -->
          <div style="position:relative;margin:8px 0;display:flex;align-items:center;gap:8px">
            <div style="flex:1;height:2px;background:linear-gradient(90deg,var(--b2),transparent);border-radius:1px"></div>
            <span style="font-size:10px;font-weight:800;color:var(--b2);font-family:var(--mono);white-space:nowrap">
              <i class="fa-solid fa-caret-right"></i> $${currentPrice.toFixed(2)}
            </span>
            <div style="flex:1;height:2px;background:linear-gradient(270deg,var(--b2),transparent);border-radius:1px"></div>
          </div>

          <!-- Extensions -->
          <div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--bord)">
            <div style="font-size:9px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
              Fibonacci Extensions
            </div>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              ${fib.exts.map(e => `
                <div style="background:var(--surf2);border:1px solid var(--bord);border-radius:6px;padding:4px 10px;text-align:center">
                  <div style="font-size:9px;color:var(--b2);font-weight:700">${e.label}</div>
                  <div style="font-size:11px;font-weight:800;font-family:var(--mono);color:var(--txt)">$${e.price.toFixed(2)}</div>
                </div>`).join('')}
            </div>
          </div>
        </div>
      </div>`;
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