// ============================================================
// av-stock-detail.js — AlphaVault Quant v3.3
// Adapté pour l'architecture AlphaVault Dashboard
// Utilise : AV_CONFIG, AVUtils globals, AVApi cache for signals
// ============================================================

// ════════════════════════════════════════════════════════════
// YAHOO FINANCE CLIENT
// Source : AV_CONFIG.WORKERS.yahooProxy
// ════════════════════════════════════════════════════════════
const YahooFinance = (() => {

  const PROXY = (typeof AV_CONFIG !== 'undefined' && AV_CONFIG.WORKERS?.yahooProxy)
    ? AV_CONFIG.WORKERS.yahooProxy
    : 'https://yahoo-proxy.raphnardone.workers.dev';

  const _mem = new Map();
  const TTL  = 60_000;

  async function _get(path, bustCache = false) {
    const now = Date.now();
    const hit = _mem.get(path);
    if (!bustCache && hit && (now - hit.ts) < TTL) return hit.data;
    try {
      const ctrl = new AbortController();
      const t    = setTimeout(() => ctrl.abort(), 12_000);
      const resp = await fetch(`${PROXY}${path}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data?.error) throw new Error(data.error);
      _mem.set(path, { data, ts: now });
      return data;
    } catch (e) {
      console.warn(`[YahooFinance] ${path}: ${e.message}`);
      if (hit?.data) return hit.data;
      return null;
    }
  }

  async function getChart(sym, interval = '1d', range = '1y') {
    const data = await _get(`/chart/${sym}?interval=${interval}&range=${range}`, true);
    if (!data?.chart?.result?.[0]) return [];
    const r  = data.chart.result[0];
    const ts = r.timestamp || [];
    const q  = r.indicators?.quote?.[0] || {};
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

  async function getQuote(sym) {
    const data = await _get(`/chart/${sym}?interval=1d&range=5d`);
    if (!data?.chart?.result?.[0]) return null;
    const meta   = data.chart.result[0].meta || {};
    const closes = (data.chart.result[0].indicators?.quote?.[0]?.close || []).filter(Boolean);
    const price  = meta.regularMarketPrice || closes.at(-1) || 0;
    const prev   = meta.previousClose      || closes.at(-2) || price;
    return {
      symbol:     meta.symbol || sym,
      price,
      prev_close: prev,
      change:     price - prev,
      change_pct: prev ? ((price - prev) / prev * 100) : 0,
      open:       meta.regularMarketOpen,
      high:       meta.regularMarketDayHigh,
      low:        meta.regularMarketDayLow,
      volume:     meta.regularMarketVolume,
      market_cap: meta.marketCap,
      currency:   meta.currency || 'USD',
      exchange:   meta.exchangeName || '',
      '52w_high': meta.fiftyTwoWeekHigh,
      '52w_low':  meta.fiftyTwoWeekLow,
      '50d_avg':  meta.fiftyDayAverage,
      '200d_avg': meta.twoHundredDayAverage,
      source:     'chart',
    };
  }

  async function getFinancials(sym) {
    const data = await _get(`/summary/${sym}`);
    if (!data) return null;
    const result = data?.quoteSummary?.result?.[0];
    if (result) return result;
    if (data?.price || data?.financialData) return data;
    return null;
  }

  async function getNews(sym, count = 50) {
    const data = await _get(`/news/${sym}?count=${count}`, true);
    return data?.news || data?.items || data?.articles || [];
  }

  async function search(q) {
    const data = await _get(`/search/${encodeURIComponent(q)}`);
    return data?.quotes || [];
  }

  return { getChart, getQuote, getFinancials, getNews, search };
})();

window.YahooFinance = YahooFinance;

// ════════════════════════════════════════════════════════════
// FINANCE HUB CLIENT
// Source : AV_CONFIG.WORKERS.financeHub
// ════════════════════════════════════════════════════════════
const FinanceHub = (() => {

  const BASE = (typeof AV_CONFIG !== 'undefined' && AV_CONFIG.WORKERS?.financeHub)
    ? AV_CONFIG.WORKERS.financeHub
    : 'https://finance-hub-api.raphnardone.workers.dev';

  const _mem = new Map();
  const TTL  = 300_000;

  async function _get(path) {
    const now = Date.now();
    const hit = _mem.get(path);
    if (hit && (now - hit.ts) < TTL) return hit.data;
    try {
      const ctrl = new AbortController();
      const t    = setTimeout(() => ctrl.abort(), 10_000);
      const resp = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
      clearTimeout(t);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      if (data?.error) throw new Error(data.error);
      _mem.set(path, { data, ts: now });
      return data;
    } catch (e) {
      console.warn(`[FinanceHub] ${path}: ${e.message}`);
      return null;
    }
  }

  async function getBasicFinancials(sym) {
    return _get(`/api/finnhub/basic-financials?symbol=${sym}&metric=all`);
  }
  async function getEarnings(sym) {
    return _get(`/api/finnhub/earnings?symbol=${sym}`);
  }
  async function getEarningsCalendar(sym) {
    const from = new Date().toISOString().split('T')[0];
    const to   = new Date(Date.now() + 180 * 864e5).toISOString().split('T')[0];
    return _get(`/api/finnhub/earnings-calendar?symbol=${sym}&from=${from}&to=${to}`);
  }
  async function getCompanyProfile(sym) {
    return _get(`/api/finnhub/company-profile?symbol=${sym}`);
  }
  async function getStatistics(sym) {
    return _get(`/api/statistics?symbol=${sym}`);
  }
  function clearCache(sym) {
    for (const key of _mem.keys()) {
      if (key.includes(sym)) _mem.delete(key);
    }
  }

  return {
    getBasicFinancials, getEarnings, getEarningsCalendar,
    getCompanyProfile, getStatistics, clearCache,
  };
})();

window.FinanceHub = FinanceHub;

// ════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════
function _fixChartHeights() {
  [{ sel:'.chart-container', h:360 }, { sel:'.cp-chart', h:220 }, { sel:'.sdp-fp-chart', h:420 }]
    .forEach(({ sel, h }) => {
      document.querySelectorAll(sel).forEach(el => {
        el.style.height = el.style.minHeight = el.style.maxHeight = `${h}px`;
        el.style.overflow = 'hidden';
        el.style.display  = 'block';
        el.style.position = 'relative';
      });
    });
}

// ════════════════════════════════════════════════════════════
// STOCK DETAIL — Full Page Controller
// ════════════════════════════════════════════════════════════
const StockDetail = (() => {

  let _sym      = null;
  let _tab      = 'overview';
  let _iv       = '1d';
  let _range    = '1y';
  let _data     = {};
  let _fpChart  = null;
  let _fpSeries = null;
  let _lastFPW  = 0;
  const _sdCJ   = {};

  // ── Styles ─────────────────────────────────────────────
  function _injectStyles() {
    if (document.getElementById('sdp-styles')) return;
    const style = document.createElement('style');
    style.id    = 'sdp-styles';
    style.textContent = `
      .sdp-fullpage {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: var(--bg-primary, #f1f5f9);
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
        animation: fadeIn 0.2s ease;
      }
      [data-theme="dark"] .sdp-fullpage {
        background: var(--bg-primary, #0f172a);
      }
      .sdp-fullpage.open { display: flex !important; }

      .sdp-fp-header {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 14px 20px;
        background: var(--bg-card, #fff);
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
        position: sticky;
        top: 0;
        z-index: 10;
        flex-wrap: wrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06);
      }
      .sdp-fp-back {
        display: flex; align-items: center; gap: 6px;
        padding: 7px 12px; border-radius: 8px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        background: transparent;
        color: var(--text-muted, #64748b);
        font-size: 12px; font-weight: 600;
        cursor: pointer; transition: all 0.15s;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }
      .sdp-fp-back:hover {
        background: var(--bg-hover, rgba(59,130,246,0.05));
        color: var(--accent-blue, #3b82f6);
      }
      .sdp-fp-sym {
        font-size: 18px; font-weight: 900;
        color: var(--text-primary, #0f172a);
        font-family: var(--font-mono, monospace);
      }
      .sdp-fp-name {
        font-size: 11px; color: var(--text-muted, #64748b);
      }
      .sdp-fp-price {
        font-size: 22px; font-weight: 900;
        font-family: var(--font-mono, monospace);
        color: var(--text-primary, #0f172a);
      }
      .sdp-fp-change { font-size: 13px; font-weight: 700; }
      .sdp-fp-change.up   { color: #10b981; }
      .sdp-fp-change.down { color: #ef4444; }

      .sdp-fp-actions { display: flex; gap: 6px; margin-left: auto; flex-wrap: wrap; }
      .sdp-fp-action-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 7px 14px; border-radius: 8px; border: none;
        font-size: 12px; font-weight: 700; cursor: pointer;
        transition: all 0.15s;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }
      .sdp-fp-action-btn.buy  { background: #10b981; color: #fff; }
      .sdp-fp-action-btn.sell { background: #ef4444; color: #fff; }
      .sdp-fp-action-btn.wl {
        background: var(--bg-primary, #f1f5f9);
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        color: var(--text-muted, #64748b);
      }
      .sdp-fp-action-btn.buy:hover  { background: #059669; }
      .sdp-fp-action-btn.sell:hover { background: #dc2626; }
      .sdp-fp-action-btn.wl:hover   { border-color: #eab308; color: #eab308; }

      .sdp-fp-tabs {
        display: flex; gap: 2px; padding: 10px 20px 0;
        background: var(--bg-card, #fff);
        border-bottom: 2px solid var(--border, rgba(0,0,0,0.08));
        flex-wrap: wrap;
      }
      .sdp-fp-tab {
        display: flex; align-items: center; gap: 7px;
        padding: 9px 16px; border: none; background: transparent;
        color: var(--text-muted, #64748b);
        font-size: 12px; font-weight: 600; cursor: pointer;
        border-radius: 8px 8px 0 0;
        transition: all 0.15s; position: relative;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }
      .sdp-fp-tab:hover   { color: var(--accent-blue, #3b82f6); }
      .sdp-fp-tab.active  {
        color: var(--accent-blue, #3b82f6);
        background: var(--bg-primary, #f1f5f9);
      }
      .sdp-fp-tab.active::after {
        content: ''; position: absolute; bottom: -2px;
        left: 0; right: 0; height: 2px;
        background: var(--accent-blue, #3b82f6);
      }

      .sdp-fp-body {
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 1200px;
        margin: 0 auto;
        width: 100%;
      }

      .sdp-fp-stat-section {
        background: var(--bg-card, #fff);
        border: 1px solid var(--border, rgba(0,0,0,0.08));
        border-radius: 12px;
        padding: 18px 20px;
        box-shadow: 0 2px 6px rgba(0,0,0,0.04);
      }
      .sdp-fp-stat-title {
        display: flex; align-items: center; gap: 8px;
        font-size: 13px; font-weight: 700;
        color: var(--text-primary, #0f172a);
        margin-bottom: 14px;
        padding-bottom: 10px;
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.06));
      }

      .sdp-fp-stats {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
        gap: 8px;
      }
      .sdp-fp-stat-item {
        background: var(--bg-primary, #f1f5f9);
        border-radius: 8px; padding: 8px 12px;
      }
      .sdp-fp-stat-lbl {
        font-size: 10px; color: var(--text-muted, #64748b);
        text-transform: uppercase; letter-spacing: 0.4px;
        margin-bottom: 3px;
      }
      .sdp-fp-stat-val {
        font-size: 13px; font-weight: 700;
        color: var(--text-primary, #0f172a);
        font-family: var(--font-mono, monospace);
      }

      .sdp-fp-chart-mini-sm {
        height: 180px; min-height: 180px; max-height: 180px;
        overflow: hidden; position: relative;
      }

      .sdp-fp-chart {
        height: 420px; min-height: 420px; max-height: 420px;
        overflow: hidden; position: relative;
      }

      .sdp-iv-tabs {
        display: flex; gap: 3px; padding: 10px 0 8px;
        flex-wrap: wrap;
      }
      .sdp-iv-btn {
        padding: 5px 12px; border-radius: 6px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        background: transparent;
        color: var(--text-muted, #64748b);
        font-size: 11px; font-weight: 600; cursor: pointer;
        transition: all 0.15s;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }
      .sdp-iv-btn.active {
        background: linear-gradient(135deg, #3b82f6, #8b5cf6);
        color: #fff; border-color: transparent;
      }

      .sdp-desc-toggle {
        font-size: 11px; color: var(--accent-blue, #3b82f6);
        background: none; border: none; cursor: pointer; padding: 4px 0;
        font-weight: 600; font-family: var(--font-sans, 'Inter', sans-serif);
      }

      /* News tab */
      .sdp-news-page { display: flex; flex-direction: column; gap: 0; }
      .sdp-news-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 0 0 12px; flex-wrap: wrap; gap: 8px;
      }
      .sdp-news-count {
        font-size: 12px; font-weight: 700;
        color: var(--text-primary, #0f172a);
      }
      .sdp-news-refresh-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 6px 12px; border-radius: 8px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        background: transparent;
        color: var(--text-muted, #64748b);
        font-size: 11px; font-weight: 600; cursor: pointer;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }
      .sdp-news-list { display: flex; flex-direction: column; gap: 8px; }
      .sdp-news-card {
        display: flex; align-items: flex-start; gap: 12px;
        padding: 14px; background: var(--bg-card, #fff);
        border: 1px solid var(--border, rgba(0,0,0,0.07));
        border-radius: 10px; text-decoration: none;
        transition: all 0.15s; cursor: pointer;
        animation: slideInRight 0.2s ease both;
      }
      .sdp-news-card:hover {
        border-color: rgba(59,130,246,0.2);
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
        transform: translateX(2px);
      }
      .sdp-news-card-thumb {
        width: 64px; height: 64px; border-radius: 8px;
        overflow: hidden; flex-shrink: 0;
        background: var(--bg-primary, #f1f5f9);
        display: flex; align-items: center; justify-content: center;
      }
      .sdp-news-card-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .sdp-news-thumb-icon { font-size: 20px; color: var(--text-muted, #94a3b8); }
      .sdp-news-card-body { flex: 1; min-width: 0; }
      .sdp-news-card-title {
        font-size: 13px; font-weight: 700;
        color: var(--text-primary, #0f172a);
        line-height: 1.4; margin-bottom: 5px;
        display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden;
      }
      .sdp-news-card-summary {
        font-size: 11px; color: var(--text-muted, #64748b);
        line-height: 1.5; margin-bottom: 6px;
        display: -webkit-box; -webkit-line-clamp: 2;
        -webkit-box-orient: vertical; overflow: hidden;
      }
      .sdp-news-card-meta {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      }
      .sdp-news-source { font-size: 10px; color: var(--accent-blue, #3b82f6); font-weight: 600; }
      .sdp-news-time   { font-size: 10px; color: var(--text-muted, #94a3b8); }
      .sdp-news-sent   { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
      .sdp-news-sent.positive { background:rgba(16,185,129,0.1); color:#10b981; }
      .sdp-news-sent.negative { background:rgba(239,68,68,0.1);  color:#ef4444; }
      .sdp-news-sent.neutral  { background:rgba(107,114,128,0.1);color:#6b7280; }
      .sdp-news-card-action { color: var(--text-muted, #94a3b8); font-size: 12px; flex-shrink: 0; margin-top: 4px; }
      .sdp-news-footer { padding: 12px 0 0; font-size: 10px; color: var(--text-muted, #94a3b8); text-align: center; }

      @keyframes slideInRight {
        from { opacity:0; transform:translateX(10px); }
        to   { opacity:1; transform:translateX(0); }
      }

      /* Dir badges */
      .dir-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 8px; border-radius: 5px;
        font-size: 10px; font-weight: 700;
      }
      .dir-badge.buy     { background:rgba(16,185,129,0.12); color:#10b981; }
      .dir-badge.sell    { background:rgba(239,68,68,0.12);  color:#ef4444; }
      .dir-badge.neutral { background:rgba(107,114,128,0.12);color:#6b7280; }

      /* Symbol initial badge */
      .sym-initial-badge {
        display: inline-flex; align-items: center; justify-content: center;
        border-radius: 50%; background: linear-gradient(135deg,#3b82f6,#8b5cf6);
        color: #fff; font-weight: 800; flex-shrink: 0;
      }

      @media (max-width: 768px) {
        .sdp-fp-header  { padding: 10px 14px; gap: 8px; }
        .sdp-fp-body    { padding: 12px; }
        .sdp-fp-stats   { grid-template-columns: 1fr 1fr; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── BUILD HTML ──────────────────────────────────────────
  function _build() {
    if (document.getElementById('sdp-fullpage')) return;
    _injectStyles();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="sdp-fullpage" id="sdp-fullpage">

        <div class="sdp-fp-header" id="sdp-fp-header-row">
          <button class="sdp-fp-back" id="sdp-back">
            <i class="fa-solid fa-arrow-left"></i> Back
          </button>
          <div id="sdp-fp-logo" style="flex-shrink:0"></div>
          <div>
            <div class="sdp-fp-sym"  id="sdp-fp-sym">—</div>
            <div class="sdp-fp-name" id="sdp-fp-name">Loading...</div>
          </div>
          <div id="sdp-fp-sector"
               style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;
                      background:rgba(59,130,246,0.08);color:#3b82f6;
                      border:1px solid rgba(59,130,246,0.2);flex-shrink:0">—</div>
          <div class="sdp-fp-price"  id="sdp-fp-price">—</div>
          <div class="sdp-fp-change" id="sdp-fp-change">—</div>
          <div style="display:flex;flex-direction:column;gap:2px;font-size:10px;
                      color:var(--text-muted,#64748b)">
            <span id="sdp-fp-vol">Vol: —</span>
            <span id="sdp-fp-cap">Cap: —</span>
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
        </div>

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

        <div class="sdp-fp-body" id="sdp-fp-body">
          <div style="display:flex;align-items:center;justify-content:center;
                      gap:12px;color:var(--text-muted,#64748b);padding:60px">
            <i class="fa-solid fa-circle-notch fa-spin"
               style="font-size:22px;color:#3b82f6"></i>
            Loading data...
          </div>
        </div>

      </div>`);

    document.getElementById('sdp-back')?.addEventListener('click', close);

    document.querySelectorAll('.sdp-fp-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    document.getElementById('sdp-fp-buy')?.addEventListener('click', () => {
      if (window.AVTrading) { AVTrading.setSymbol(_sym); AVTrading.setSide('BUY'); }
      const sel = document.getElementById('order-symbol');
      if (sel) sel.value = _sym;
      close();
      if (window.location.pathname.includes('trading')) return;
      window.location.href = 'trading.html';
    });

    document.getElementById('sdp-fp-sell')?.addEventListener('click', () => {
      if (window.AVTrading) { AVTrading.setSymbol(_sym); AVTrading.setSide('SELL'); }
      const sel = document.getElementById('order-symbol');
      if (sel) sel.value = _sym;
      close();
      if (window.location.pathname.includes('trading')) return;
      window.location.href = 'trading.html';
    });

    document.getElementById('sdp-fp-wl')?.addEventListener('click', _toggleWL);

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' &&
          document.getElementById('sdp-fullpage')?.classList.contains('open')) {
        close();
      }
    });
  }

  // ── OPEN ───────────────────────────────────────────────
  async function open(sym) {
    if (!sym) return;
    _sym   = sym.toUpperCase();
    _tab   = 'overview';
    _iv    = '1d';
    _range = '1y';

    _build();

    const fp = document.getElementById('sdp-fullpage');
    if (!fp) return;
    fp.classList.add('open');
    fp.style.setProperty('display', 'flex', 'important');
    fp.style.setProperty('z-index', '9999', 'important');
    document.body.style.overflow = 'hidden';
    _fixChartHeights();

    // Header info
    _t('sdp-fp-sym',    _sym);
    _t('sdp-fp-name',   'Loading...');
    _t('sdp-fp-sector', '—');
    _t('sdp-fp-price',  '—');

    const logoSlot = document.getElementById('sdp-fp-logo');
    if (logoSlot) {
      logoSlot.innerHTML = typeof window._getLogoHtml === 'function'
        ? window._getLogoHtml(_sym, 36) : '';
    }
    _updateWLBtn();

    document.querySelectorAll('.sdp-fp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === 'overview'));

    _bodyHtml(
      `<div style="display:flex;align-items:center;justify-content:center;
                   gap:12px;color:var(--text-muted,#64748b);padding:60px">
         <i class="fa-solid fa-circle-notch fa-spin" style="font-size:22px;color:#3b82f6"></i>
         Loading data for <strong style="color:var(--text-primary,#0f172a)">${_sym}</strong>...
       </div>`
    );

    await _fetchAll(_sym);
    _switchTab('overview');
  }

  // ── CLOSE ──────────────────────────────────────────────
  function close() {
    const fp = document.getElementById('sdp-fullpage');
    if (fp) {
      fp.classList.remove('open');
      fp.style.removeProperty('display');
      fp.style.removeProperty('z-index');
    }
    document.body.style.overflow = '';
    _destroyFPChart();
  }

  // ── FETCH ALL ──────────────────────────────────────────
  async function _fetchAll(sym) {
    if (!_data[sym]) _data[sym] = {};

    const [quoteRes, summaryRes, newsRes,
           fhBasicRes, fhEarnRes, fhCalRes,
           fhProfileRes, fhStatsRes] = await Promise.allSettled([
      YahooFinance.getQuote(sym),
      YahooFinance.getFinancials(sym),
      YahooFinance.getNews(sym, 50),
      FinanceHub.getBasicFinancials(sym),
      FinanceHub.getEarnings(sym),
      FinanceHub.getEarningsCalendar(sym),
      FinanceHub.getCompanyProfile(sym),
      FinanceHub.getStatistics(sym),
    ]);

    _data[sym].quote      = quoteRes.status      === 'fulfilled' ? quoteRes.value      : null;
    _data[sym].summary    = summaryRes.status     === 'fulfilled' ? summaryRes.value    : null;
    _data[sym].news       = newsRes.status        === 'fulfilled' ? newsRes.value       : [];
    _data[sym].fhBasic    = fhBasicRes.status     === 'fulfilled' ? fhBasicRes.value    : null;
    _data[sym].fhEarnings = fhEarnRes.status      === 'fulfilled' ? fhEarnRes.value     : null;
    _data[sym].fhCal      = fhCalRes.status       === 'fulfilled' ? fhCalRes.value      : null;
    _data[sym].fhProfile  = fhProfileRes.status   === 'fulfilled' ? fhProfileRes.value  : null;
    _data[sym].fhStats    = fhStatsRes.status     === 'fulfilled' ? fhStatsRes.value    : null;

    const q = _data[sym].quote;
    if (q?.price > 0) {
      // Symbol meta from WatchlistManager
      const meta = window.WatchlistManager?.getSymbolMeta?.(_sym) || { name: _sym, sector: '—' };
      _t('sdp-fp-name',   meta.name    || _sym);
      _t('sdp-fp-sector', meta.sector  || '—');
      _t('sdp-fp-price',  `$${q.price.toFixed(2)}`);
      _t('sdp-fp-vol',    `Vol: ${_fmtNum(q.volume)}`);
      _t('sdp-fp-cap',    `Cap: ${_fmtMCap(q.market_cap)}`);

      const chgPct = sf(q.change_pct || 0);
      const chgEl  = document.getElementById('sdp-fp-change');
      if (chgEl) {
        chgEl.textContent = `${chgPct >= 0 ? '+' : ''}${chgPct.toFixed(2)}%`;
        chgEl.className   = `sdp-fp-change ${chgPct >= 0 ? 'up' : 'down'}`;
      }
    }
  }

  // ── SWITCH TAB ─────────────────────────────────────────
  function _switchTab(tab) {
    _tab = tab;
    _destroyAllSDCJ();
    _destroyFPChart();

    document.querySelectorAll('.sdp-fp-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.tab === tab));

    switch (tab) {
      case 'overview':   _renderOverview();           break;
      case 'financials': _renderFinancialsEarnings();  break;
      case 'news':       _renderNews();               break;
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
    const detail  = sum.summaryDetail        || {};
    const stats   = sum.defaultKeyStatistics || {};
    const fin     = sum.financialData        || {};
    const profile = sum.assetProfile         || {};
    const fhM     = _data[sym]?.fhBasic?.metric || {};
    const fhProf  = _data[sym]?.fhProfile       || {};
    const signal  = _sig(sym);

    const kstats = [
      { l:'Open',         v: _f(q.open   || detail.open?.raw,     '$') },
      { l:'Day High',     v: _f(q.high   || detail.dayHigh?.raw,  '$') },
      { l:'Day Low',      v: _f(q.low    || detail.dayLow?.raw,   '$') },
      { l:'Prev Close',   v: _f(q.prev_close || detail.previousClose?.raw, '$') },
      { l:'Volume',       v: _fmtNum(q.volume || detail.volume?.raw) },
      { l:'Market Cap',   v: _fmtMCap(q.market_cap || fhM.marketCapitalization * 1e6) },
      { l:'P/E (TTM)',    v: _f(detail.trailingPE?.raw || fhM.peBasicExclExtraTTM, '', 2) },
      { l:'Fwd P/E',      v: _f(detail.forwardPE?.raw  || fhM.forwardPE,           '', 2) },
      { l:'EPS (TTM)',    v: _f(stats.trailingEps?.raw  || fhM.epsNormalizedAnnual, '$', 2) },
      { l:'Beta',         v: _f(detail.beta?.raw        || fhM.beta,                '', 2) },
      { l:'52W High',     v: _f(q['52w_high'] || fhM['52WeekHigh'], '$') },
      { l:'52W Low',      v: _f(q['52w_low']  || fhM['52WeekLow'],  '$') },
      { l:'50D Avg',      v: _f(q['50d_avg']  || detail.fiftyDayAverage?.raw,      '$') },
      { l:'200D Avg',     v: _f(q['200d_avg'] || detail.twoHundredDayAverage?.raw, '$') },
      { l:'Profit Margin',v: _f(fin.profitMargins?.raw != null
                                  ? fin.profitMargins.raw * 100
                                  : fhM.netMarginAnnual, '', 2, '%') },
      { l:'ROE',          v: _f(fin.returnOnEquity?.raw != null
                                  ? fin.returnOnEquity.raw * 100
                                  : fhM.roeTTM, '', 2, '%') },
      { l:'Revenue (TTM)',v: _fmtMCap(fin.totalRevenue?.raw) },
    ].filter(i => i.v && i.v !== '--');

    const sigBg = signal
      ? (signal.action === 'BUY' || signal.direction === 'buy'
          ? 'rgba(16,185,129,0.06)' : 'rgba(239,68,68,0.06)')
      : 'var(--bg-primary,#f1f5f9)';
    const sigBorder = signal
      ? (signal.action === 'BUY' || signal.direction === 'buy'
          ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)')
      : 'var(--border,rgba(0,0,0,0.08))';

    const profDesc    = profile.longBusinessSummary || '';
    const profSector  = profile.sector   || fhProf.finnhubIndustry || '';
    const profCountry = profile.country  || fhProf.country || '';
    const profEmp     = profile.fullTimeEmployees || null;

    _bodyHtml(`
      <!-- ML Signal + Mini chart -->
      <div style="display:grid;grid-template-columns:1fr 300px;gap:12px;align-items:start">

        <div class="sdp-fp-stat-section"
             style="background:${sigBg};border-color:${sigBorder}">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-brain" style="color:#3b82f6"></i>
            AlphaVault ML Signal
          </div>
          ${signal ? _renderSignalBlock(signal) : `
            <div style="color:var(--text-muted,#64748b);font-size:12px">
              <i class="fa-solid fa-clock"></i> Awaiting signal cycle...
            </div>`}
        </div>

        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title" style="margin-bottom:8px">
            <i class="fa-solid fa-chart-line" style="color:#3b82f6"></i>
            Price Chart (1Y)
          </div>
          <div id="sdp-fp-chart-mini" class="sdp-fp-chart-mini-sm"></div>
        </div>
      </div>

      <!-- About -->
      ${(profSector || profDesc) ? `
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-building" style="color:#6b7280"></i> About ${sym}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
            ${profSector   ? `<span class="regime-chip">${profSector}</span>` : ''}
            ${profCountry  ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profCountry}</span>` : ''}
            ${profEmp      ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profEmp)}</span>` : ''}
          </div>
          ${profDesc ? `
            <p id="sdp-desc-p"
               style="font-size:12px;color:var(--text-muted,#64748b);line-height:1.7;
                      display:-webkit-box;-webkit-line-clamp:3;
                      -webkit-box-orient:vertical;overflow:hidden">
              ${profDesc}
            </p>
            <button class="sdp-desc-toggle" id="sdp-desc-toggle">Show more</button>` : ''}
        </div>` : ''}

      <!-- Key Statistics -->
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-table" style="color:#3b82f6"></i> Key Statistics
        </div>
        ${kstats.length ? `
          <div class="sdp-fp-stats">
            ${kstats.map(i => `
              <div class="sdp-fp-stat-item">
                <div class="sdp-fp-stat-lbl">${i.l}</div>
                <div class="sdp-fp-stat-val">${i.v}</div>
              </div>`).join('')}
          </div>` : `
          <div style="text-align:center;padding:20px;color:var(--text-muted,#64748b);font-size:12px">
            <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>
            Financial data unavailable.
            <button onclick="StockDetail._retryFinancials()" class="sdp-desc-toggle" style="margin-left:8px">
              <i class="fa-solid fa-rotate"></i> Retry
            </button>
          </div>`}
      </div>`);

    // Toggle desc
    const tog  = document.getElementById('sdp-desc-toggle');
    const para = document.getElementById('sdp-desc-p');
    if (tog && para) {
      let ex = false;
      tog.addEventListener('click', () => {
        ex = !ex;
        para.style.webkitLineClamp = ex ? 'unset' : '3';
        para.style.overflow        = ex ? 'visible' : 'hidden';
        tog.textContent            = ex ? 'Show less' : 'Show more';
      });
    }

    setTimeout(() => _loadMiniChart('sdp-fp-chart-mini', sym, '1d', '1y', 180), 80);
    setTimeout(() => _appendTASection(sym), 150);
  }

  function _renderSignalBlock(signal) {
    const action  = signal.action || (signal.direction === 'buy' ? 'BUY' : signal.direction === 'sell' ? 'SELL' : 'NEUTRAL');
    const conf    = sf(signal.confidence || 0);
    const score   = sf(signal.score || signal.final_score || conf);
    const bp      = sf(signal.buy_prob || 0.5);
    const council = signal.council || 'wait';
    const regime  = (signal.regime || '').replace(/_/g, ' ');

    const ac = action === 'BUY' ? '#10b981' : action === 'SELL' ? '#ef4444' : '#6b7280';
    const ai = action === 'BUY' ? 'fa-arrow-up' : action === 'SELL' ? 'fa-arrow-down' : 'fa-minus';

    return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-size:14px;font-weight:800;padding:6px 14px;border-radius:6px;
                     background:${ac}15;color:${ac};border:1px solid ${ac}30">
          <i class="fa-solid ${ai}" style="font-size:10px"></i> ${action}
        </span>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:1;min-width:200px">
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);margin-bottom:2px">Score</div>
            <div style="font-size:14px;font-weight:800;font-family:var(--font-mono,monospace);
                        color:#3b82f6">${score.toFixed(3)}</div>
          </div>
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);margin-bottom:2px">Confidence</div>
            <div style="font-size:14px;font-weight:800;font-family:var(--font-mono,monospace)">
              ${(conf * 100).toFixed(1)}%
            </div>
          </div>
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);margin-bottom:2px">Buy Prob</div>
            <div style="font-size:14px;font-weight:800;font-family:var(--font-mono,monospace);
                        color:#10b981">${(bp * 100).toFixed(1)}%</div>
          </div>
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);margin-bottom:2px">Council</div>
            <div style="font-size:12px;font-weight:800;
                        color:${council.includes('execute') ? '#10b981' : '#f59e0b'}">
              ${council.toUpperCase()}
            </div>
          </div>
        </div>
      </div>
      ${regime ? `<div style="margin-top:8px">
        <span class="regime-chip">${regime}</span>
      </div>` : ''}`;
  }

  // ════════════════════════════════════════════════════════
  // TAB: FINANCIALS & EARNINGS
  // ════════════════════════════════════════════════════════
  function _renderFinancialsEarnings() {
    const sym    = _sym;
    const sum    = _data[sym]?.summary || {};
    const q      = _data[sym]?.quote   || {};
    const fin    = sum.financialData          || {};
    const stats  = sum.defaultKeyStatistics   || {};
    const detail = sum.summaryDetail          || {};
    const fhM    = _data[sym]?.fhBasic?.metric || {};
    const fhEarr = Array.isArray(_data[sym]?.fhEarnings) ? _data[sym].fhEarnings : [];
    const fhCalArr = _data[sym]?.fhCal?.earningsCalendar || [];
    const fhProf = _data[sym]?.fhProfile || {};
    const profile= sum.assetProfile || {};
    const yahCal = sum.calendarEvents?.earnings || {};
    const yahTrend = sum.earningsTrend?.trend   || [];

    const _rv = (y, ...fb) => {
      const v = y?.raw ?? y;
      if (v != null && !isNaN(parseFloat(v)) && v !== 0) return v;
      for (const f of fb) if (f != null && !isNaN(parseFloat(f)) && f !== 0) return f;
      return null;
    };

    const price   = sf(q.price || detail.regularMarketPrice?.raw || 0);
    const epsUse  = _rv(stats.trailingEps?.raw, fhM.epsNormalizedAnnual);
    const peUse   = _rv(detail.trailingPE?.raw, fhM.peTTM,
                        epsUse && price ? price / sf(epsUse) : null);
    const fwdPE   = _rv(detail.forwardPE?.raw,  fhM.forwardPE);
    const fwdEPS  = _rv(stats.forwardEps?.raw);
    const perc    = (raw, ...fb) => {
      const v = _rv(raw, ...fb);
      if (v == null) return '--';
      return `${(Math.abs(sf(v)) < 5 ? sf(v) * 100 : sf(v)).toFixed(2)}%`;
    };

    const kstats = [
      { l:'Market Cap',      v: _fmtMCap(_rv(q.market_cap, fhM.marketCapitalization * 1e6)) },
      { l:'P/E (TTM)',       v: peUse    != null ? sf(peUse).toFixed(2)    : '--' },
      { l:'Forward P/E',     v: fwdPE    != null ? sf(fwdPE).toFixed(2)    : '--' },
      { l:'EPS (TTM)',       v: epsUse   != null ? `$${sf(epsUse).toFixed(2)}` : '--' },
      { l:'Forward EPS',     v: fwdEPS   != null ? `$${sf(fwdEPS).toFixed(2)}` : '--' },
      { l:'Revenue (TTM)',   v: _fmtMCap(_rv(fin.totalRevenue?.raw)) },
      { l:'Gross Margin',    v: perc(fin.grossMargins?.raw,   fhM.grossMarginAnnual)    },
      { l:'Op. Margin',      v: perc(fin.operatingMargins?.raw, fhM.operatingMarginAnnual) },
      { l:'Profit Margin',   v: perc(fin.profitMargins?.raw,  fhM.netMarginAnnual)      },
      { l:'ROE',             v: perc(fin.returnOnEquity?.raw, fhM.roeTTM ? fhM.roeTTM/100 : null) },
      { l:'ROA',             v: perc(fin.returnOnAssets?.raw, fhM.roaRfy  ? fhM.roaRfy/100  : null) },
      { l:'Total Cash',      v: _fmtMCap(_rv(fin.totalCash?.raw)) },
      { l:'Total Debt',      v: _fmtMCap(_rv(fin.totalDebt?.raw)) },
      { l:'Free Cash Flow',  v: _fmtMCap(_rv(fin.freeCashflow?.raw)) },
      { l:'Debt/Equity',     v: _rv(fin.debtToEquity?.raw) != null
                                  ? sf(_rv(fin.debtToEquity?.raw)).toFixed(2) : '--' },
      { l:'Current Ratio',   v: _rv(fin.currentRatio?.raw) != null
                                  ? sf(_rv(fin.currentRatio?.raw)).toFixed(2) : '--' },
      { l:'Beta',            v: _rv(detail.beta?.raw, fhM.beta) != null
                                  ? sf(_rv(detail.beta?.raw, fhM.beta)).toFixed(2) : '--' },
      { l:'Short % Float',   v: perc(stats.shortPercentOfFloat?.raw) },
      { l:'Insider Own.',    v: _rv(stats.heldPercentInsiders?.raw)   != null
                                  ? `${(sf(_rv(stats.heldPercentInsiders?.raw)) * 100).toFixed(2)}%` : '--' },
      { l:'Institution Own.',v: _rv(stats.heldPercentInstitutions?.raw) != null
                                  ? `${(sf(_rv(stats.heldPercentInstitutions?.raw)) * 100).toFixed(2)}%` : '--' },
    ].filter(i => i.v && i.v !== '--');

    // Next earnings
    const now     = new Date();
    const nextFH  = fhCalArr
      .filter(e => e.symbol === sym && new Date(e.date) > now)
      .sort((a, b) => new Date(a.date) - new Date(b.date))[0];
    const yahDates = (yahCal.earningsDate || [])
      .map(d => new Date((d.raw || d) * 1000)).filter(d => d > now);
    const nextDate = nextFH?.date
      ? new Date(nextFH.date).toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' })
      : yahDates[0]?.toLocaleDateString('en-US', { month:'long', day:'numeric', year:'numeric' });

    // Profile
    const profDesc    = profile.longBusinessSummary || '';
    const profSector  = profile.sector   || fhProf.finnhubIndustry || '';
    const profCountry = profile.country  || fhProf.country || '';
    const profEmp     = profile.fullTimeEmployees || null;
    const profWeb     = profile.website  || fhProf.weburl || '';

    _bodyHtml(`
      ${nextDate ? `
        <div class="sdp-fp-stat-section" style="border-color:rgba(59,130,246,0.3);background:rgba(59,130,246,0.04)">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-calendar-check" style="color:#3b82f6"></i> Next Earnings Date
          </div>
          <div style="font-size:24px;font-weight:900;color:#3b82f6;font-family:var(--font-mono,monospace);margin-bottom:6px">
            ${nextDate}
          </div>
          ${nextFH ? `<div style="display:flex;gap:12px;flex-wrap:wrap">
            ${nextFH.epsEstimate != null ? `<div class="sdp-fp-stat-item" style="min-width:120px">
              <div class="sdp-fp-stat-lbl">EPS Estimate</div>
              <div class="sdp-fp-stat-val" style="color:#3b82f6">$${sf(nextFH.epsEstimate).toFixed(2)}</div>
            </div>` : ''}
            ${nextFH.hour ? `<div class="sdp-fp-stat-item" style="min-width:120px">
              <div class="sdp-fp-stat-lbl">Release</div>
              <div class="sdp-fp-stat-val">
                ${nextFH.hour === 'bmo' ? '<i class="fa-solid fa-sun" style="color:#f59e0b"></i> Before Open'
                : nextFH.hour === 'amc' ? '<i class="fa-solid fa-moon" style="color:#8b5cf6"></i> After Close'
                : nextFH.hour}
              </div>
            </div>` : ''}
          </div>` : ''}
        </div>` : ''}

      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-table" style="color:#3b82f6"></i> Key Statistics &amp; Financials
          <div style="margin-left:auto">
            ${kstats.length > 10
              ? '<span class="badge badge-green"><i class="fa-solid fa-circle-check"></i> Full Data</span>'
              : kstats.length > 3
              ? '<span class="badge badge-blue"><i class="fa-solid fa-circle-half-stroke"></i> Partial</span>'
              : '<span class="badge badge-orange"><i class="fa-solid fa-triangle-exclamation"></i> Limited</span>'}
          </div>
        </div>
        ${kstats.length ? `
          <div class="sdp-fp-stats">
            ${kstats.map(i => `
              <div class="sdp-fp-stat-item">
                <div class="sdp-fp-stat-lbl">${i.l}</div>
                <div class="sdp-fp-stat-val">${i.v}</div>
              </div>`).join('')}
          </div>` : `
          <div style="text-align:center;padding:20px;color:var(--text-muted,#64748b);font-size:12px">
            <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>
            Data unavailable —
            <button onclick="StockDetail._retryFinancials()" class="sdp-desc-toggle">
              <i class="fa-solid fa-rotate"></i> Retry
            </button>
          </div>`}
      </div>

      ${fhEarr.length ? `
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-chart-bar" style="color:#8b5cf6"></i>
            Earnings History — Actual vs Estimated
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;font-size:12px">
              <thead>
                <tr style="border-bottom:2px solid var(--border,rgba(0,0,0,0.08))">
                  <th style="padding:8px 10px;text-align:left;font-size:10px;font-weight:700;
                             color:var(--text-muted,#64748b);text-transform:uppercase;letter-spacing:0.5px">Period</th>
                  <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;
                             color:var(--text-muted,#64748b);text-transform:uppercase">Estimated</th>
                  <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;
                             color:var(--text-muted,#64748b);text-transform:uppercase">Actual</th>
                  <th style="padding:8px 10px;text-align:right;font-size:10px;font-weight:700;
                             color:var(--text-muted,#64748b);text-transform:uppercase">Surprise</th>
                  <th style="padding:8px 10px;text-align:center;font-size:10px;font-weight:700;
                             color:var(--text-muted,#64748b);text-transform:uppercase">Result</th>
                </tr>
              </thead>
              <tbody>
                ${fhEarr.slice(0, 8).map((e, idx) => {
                  const beat = e.actual != null && e.estimate != null && e.actual > e.estimate;
                  const miss = e.actual != null && e.estimate != null && e.actual < e.estimate;
                  const bg   = idx % 2 === 0 ? 'var(--bg-primary,#f1f5f9)' : 'transparent';
                  return `
                    <tr style="background:${bg};border-bottom:1px solid var(--border,rgba(0,0,0,0.06))">
                      <td style="padding:8px 10px;font-family:var(--font-mono,monospace);font-size:11px">
                        ${e.period}
                        <span style="color:var(--text-muted,#64748b);font-size:10px;margin-left:4px">
                          Q${e.quarter} ${e.year}
                        </span>
                      </td>
                      <td style="padding:8px 10px;text-align:right;font-family:var(--font-mono,monospace);
                                 color:var(--text-muted,#64748b)">
                        ${e.estimate != null ? `$${sf(e.estimate).toFixed(2)}` : '--'}
                      </td>
                      <td style="padding:8px 10px;text-align:right;font-family:var(--font-mono,monospace);
                                 font-weight:700;color:${beat?'#10b981':miss?'#ef4444':'var(--text-primary,#0f172a)'}">
                        ${e.actual != null ? `$${sf(e.actual).toFixed(2)}` : '--'}
                      </td>
                      <td style="padding:8px 10px;text-align:right;font-family:var(--font-mono,monospace);
                                 color:${e.surprisePercent > 0 ? '#10b981' : e.surprisePercent < 0 ? '#ef4444' : 'var(--text-muted,#64748b)'}">
                        ${e.surprisePercent != null
                          ? `${e.surprisePercent > 0 ? '+' : ''}${sf(e.surprisePercent).toFixed(2)}%`
                          : '--'}
                      </td>
                      <td style="padding:8px 10px;text-align:center">
                        ${e.actual == null ? '<span style="color:var(--text-muted)">—</span>'
                         : beat ? '<i class="fa-solid fa-circle-check" style="color:#10b981"></i>'
                         : miss ? '<i class="fa-solid fa-circle-xmark" style="color:#ef4444"></i>'
                         :        '<i class="fa-solid fa-minus" style="color:#f59e0b"></i>'}
                      </td>
                    </tr>`;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>` : ''}

      ${(profSector || profDesc) ? `
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-building" style="color:#6b7280"></i> About ${sym}
          </div>
          <div style="display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px">
            ${profSector  ? `<span class="regime-chip">${profSector}</span>` : ''}
            ${profCountry ? `<span class="regime-chip"><i class="fa-solid fa-globe" style="font-size:9px"></i> ${profCountry}</span>` : ''}
            ${profEmp     ? `<span class="regime-chip"><i class="fa-solid fa-users" style="font-size:9px"></i> ${_fmtNum(profEmp)}</span>` : ''}
            ${profWeb     ? `<a href="${profWeb}" target="_blank" class="regime-chip"
                               style="color:#3b82f6;text-decoration:none">
                               <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:8px"></i> Website
                             </a>` : ''}
          </div>
          ${profDesc ? `
            <p id="sdp-desc-p2"
               style="font-size:12px;color:var(--text-muted,#64748b);line-height:1.7;
                      display:-webkit-box;-webkit-line-clamp:3;
                      -webkit-box-orient:vertical;overflow:hidden">${profDesc}</p>
            <button class="sdp-desc-toggle" id="sdp-desc-toggle2">Show more</button>` : ''}
        </div>` : ''}`);

    const t2 = document.getElementById('sdp-desc-toggle2');
    const p2 = document.getElementById('sdp-desc-p2');
    if (t2 && p2) {
      let ex = false;
      t2.addEventListener('click', () => {
        ex = !ex;
        p2.style.webkitLineClamp = ex ? 'unset' : '3';
        p2.style.overflow        = ex ? 'visible' : 'hidden';
        t2.textContent           = ex ? 'Show less' : 'Show more';
      });
    }
  }

  async function _retryFinancials() {
    if (!_sym) return;
    delete _data[_sym]?.summary;
    delete _data[_sym]?.fhBasic;
    delete _data[_sym]?.fhEarnings;
    delete _data[_sym]?.fhCal;
    delete _data[_sym]?.fhProfile;
    delete _data[_sym]?.fhStats;
    FinanceHub.clearCache(_sym);
    await _fetchAll(_sym);
    _renderFinancialsEarnings();
  }

  // ════════════════════════════════════════════════════════
  // TAB: NEWS
  // ════════════════════════════════════════════════════════
  function _renderNews() {
    const news = _data[_sym]?.news || [];
    const MAX  = 50;

    if (news.length < 5) {
      YahooFinance.getNews(_sym, 50).then(articles => {
        if (_tab === 'news') {
          if (_data[_sym]) _data[_sym].news = articles;
          _renderNews();
        }
      });
      _bodyHtml(`<div style="text-align:center;padding:48px;color:var(--text-muted,#64748b)">
        <i class="fa-solid fa-circle-notch fa-spin" style="color:#3b82f6;font-size:20px"></i>
        <div style="margin-top:10px;font-size:13px">Loading news for <strong>${_sym}</strong>...</div>
      </div>`);
      return;
    }

    _bodyHtml(`
      <div class="sdp-news-page">
        <div class="sdp-news-header">
          <div style="display:flex;align-items:center;gap:8px">
            <i class="fa-solid fa-newspaper" style="color:#3b82f6"></i>
            <span class="sdp-news-count">${news.slice(0, MAX).length} articles</span>
            <span style="color:var(--border,rgba(0,0,0,0.1))">·</span>
            <span style="font-size:13px;font-weight:700;color:#3b82f6;
                         font-family:var(--font-mono,monospace)">${_sym}</span>
          </div>
          <button class="sdp-news-refresh-btn" id="sd-news-refresh">
            <i class="fa-solid fa-rotate"></i> Refresh
          </button>
        </div>

        <div class="sdp-news-list">
          ${news.slice(0, MAX).map((a, idx) => {
            const thumb = a.thumbnail?.resolutions
              ?.sort((x, y) => (y.width||0) - (x.width||0))
              ?.find(r => r.url && (r.width||0) >= 60)?.url;
            const pub   = a.publisher || 'Market News';
            const time  = a.providerPublishTime ? _timeAgo(a.providerPublishTime * 1000) : '';
            const sent  = _sentiment(a.title || '');
            return `
              <a href="${a.link||'#'}" target="_blank" rel="noopener noreferrer"
                 class="sdp-news-card" style="animation-delay:${idx * 0.02}s">
                <div class="sdp-news-card-thumb">
                  ${thumb
                    ? `<img src="${thumb}" alt="" loading="lazy"
                            onerror="this.parentNode.innerHTML='<i class=\\'fa-solid fa-newspaper sdp-news-thumb-icon\\'></i>'">`
                    : '<i class="fa-solid fa-newspaper sdp-news-thumb-icon"></i>'}
                </div>
                <div class="sdp-news-card-body">
                  <div class="sdp-news-card-title">${a.title || '—'}</div>
                  ${a.summary ? `<div class="sdp-news-card-summary">${a.summary}</div>` : ''}
                  <div class="sdp-news-card-meta">
                    <span class="sdp-news-source">
                      <i class="fa-solid fa-circle" style="font-size:4px;color:#3b82f6;vertical-align:middle"></i>
                      ${pub}
                    </span>
                    ${time ? `<span class="sdp-news-time">${time}</span>` : ''}
                    <span class="sdp-news-sent ${sent.cls}">${sent.label}</span>
                  </div>
                </div>
                <div class="sdp-news-card-action">
                  <i class="fa-solid fa-arrow-up-right-from-square"></i>
                </div>
              </a>`;
          }).join('')}
        </div>

        <div class="sdp-news-footer">
          <i class="fa-solid fa-newspaper" style="font-size:10px"></i>
          ${Math.min(news.length, MAX)} articles loaded
        </div>
      </div>`);

    document.getElementById('sd-news-refresh')?.addEventListener('click', async () => {
      const btn = document.getElementById('sd-news-refresh');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      if (_data[_sym]) delete _data[_sym].news;
      _data[_sym].news = await YahooFinance.getNews(_sym, 50);
      _renderNews();
    });
  }

  // ════════════════════════════════════════════════════════
  // CHART HELPERS
  // ════════════════════════════════════════════════════════
  async function _loadMiniChart(id, sym, iv, range, h = 180) {
    await _loadChart(id, sym, iv, range, h);
  }

  async function _loadChart(id, sym, iv, range, h) {
    const el = document.getElementById(id);
    if (!el || typeof LightweightCharts === 'undefined') return;

    el.style.cssText = `height:${h}px;min-height:${h}px;max-height:${h}px;overflow:hidden;position:relative`;
    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;
                               gap:8px;color:var(--text-muted,#64748b)">
      <i class="fa-solid fa-circle-notch fa-spin" style="color:#3b82f6"></i> Loading chart...
    </div>`;

    const candles = await YahooFinance.getChart(sym, iv, range);
    const c2      = document.getElementById(id);
    if (!c2) return;

    c2.innerHTML = '';
    c2.style.cssText = `height:${h}px;min-height:${h}px;max-height:${h}px;overflow:hidden;position:relative`;

    if (!candles.length) {
      c2.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100%;
                                  color:#f59e0b;gap:8px;font-size:12px">
        <i class="fa-solid fa-triangle-exclamation"></i> No chart data
      </div>`;
      return;
    }

    try {
      _destroyFPChart();
      const dark = document.documentElement.getAttribute('data-theme') === 'dark';
      const w    = c2.getBoundingClientRect().width || c2.offsetWidth || 460;

      _fpChart = LightweightCharts.createChart(c2, {
        width:  w, height: h,
        layout: {
          background: { color: 'transparent' },
          textColor:  dark ? '#9db3d8' : '#64748b',
          fontSize:   11,
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
          horzLines: { color: dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' },
        },
        rightPriceScale: { borderColor: 'rgba(128,128,128,0.12)', scaleMargins: { top: 0.08, bottom: 0.12 } },
        timeScale:       { borderColor: 'rgba(128,128,128,0.12)', timeVisible: true, secondsVisible: false },
        crosshair:       { mode: LightweightCharts.CrosshairMode?.Normal ?? 1 },
      });

      const isV4  = typeof LightweightCharts.CandlestickSeries !== 'undefined';
      const opts  = {
        upColor:'#10b981', downColor:'#ef4444',
        borderUpColor:'#10b981', borderDownColor:'#ef4444',
        wickUpColor:'#10b981',   wickDownColor:'#ef4444',
      };
      _fpSeries = isV4
        ? _fpChart.addSeries(LightweightCharts.CandlestickSeries, opts)
        : _fpChart.addCandlestickSeries(opts);

      _fpSeries.setData(candles);
      _fpChart.timeScale().fitContent();

      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(entries => {
          if (!_fpChart || !entries[0]) return;
          const nw = Math.floor(entries[0].contentRect.width);
          if (nw > 0 && Math.abs(nw - _lastFPW) > 4) {
            _lastFPW = nw;
            try { _fpChart.applyOptions({ width: nw }); } catch(e) {}
          }
        });
        ro.observe(c2);
      }
    } catch (err) {
      console.error('[SDP] Chart error:', err);
      if (c2) c2.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
                                           height:100%;color:#ef4444;gap:8px;font-size:12px">
        <i class="fa-solid fa-xmark"></i> ${err.message}
      </div>`;
    }
  }

  // ════════════════════════════════════════════════════════
  // TA SECTION — RSI, MACD, Ichimoku, Fibonacci
  // ════════════════════════════════════════════════════════
  function _ema(arr, p) {
    if (arr.length < p) return arr.map(() => null);
    const k   = 2 / (p + 1);
    const out  = Array(p - 1).fill(null);
    let v      = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out.push(v);
    for (let i = p; i < arr.length; i++) { v = arr[i] * k + v * (1 - k); out.push(v); }
    return out;
  }

  function _rsiCalc(closes, p = 14) {
    if (closes.length < p + 1) return closes.map(() => null);
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) {
      const d = closes[i] - closes[i - 1];
      g += Math.max(d, 0); l += Math.max(-d, 0);
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

  function _macdCalc(closes, f = 12, s = 26, sig = 9) {
    const ef   = _ema(closes, f);
    const es   = _ema(closes, s);
    const ml   = closes.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
    const valid = ml.filter(v => v != null);
    const se   = _ema(valid, sig);
    let si = 0;
    const sl = ml.map(v => v == null ? null : se[si++] ?? null);
    return { line: ml, signal: sl, hist: ml.map((v, i) => v != null && sl[i] != null ? v - sl[i] : null) };
  }

  function _fibCalc(candles) {
    const sl = candles.slice(-Math.min(60, candles.length));
    const hi = Math.max(...sl.map(c => c.high));
    const lo = Math.min(...sl.map(c => c.low));
    const d  = hi - lo;
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0].map(r => ({
      pct: r, label: `${(r * 100).toFixed(1)}%`,
      price: +(hi - d * r).toFixed(2),
      key: [0.382, 0.5, 0.618].includes(r),
    }));
    const exts = [1.272, 1.618, 2.0, 2.618].map(r => ({
      pct: r, label: `${(r * 100).toFixed(1)}%`,
      price: +(lo + d * r).toFixed(2),
    }));
    return { hi, lo, d, levels, exts };
  }

  async function _appendTASection(sym) {
    const body = document.getElementById('sdp-fp-body');
    if (!body) return;
    const old = document.getElementById('sdp-ta-section');
    if (old) old.remove();

    const div = document.createElement('div');
    div.id    = 'sdp-ta-section';
    div.innerHTML = `
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-chart-candlestick" style="color:#3b82f6"></i>
          Technical Analysis
          <span style="margin-left:auto;font-size:10px;color:var(--text-muted,#64748b);font-weight:400">
            1Y · Daily
          </span>
          <div id="sdp-ta-loading"
               style="display:flex;align-items:center;gap:6px;font-size:11px;
                      color:var(--text-muted,#64748b);font-weight:400">
            <i class="fa-solid fa-circle-notch fa-spin" style="color:#3b82f6"></i>
            Loading indicators...
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted,#64748b);
                        text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;
                        display:flex;justify-content:space-between">
              <span><i class="fa-solid fa-gauge" style="color:#3b82f6"></i> RSI (14)</span>
              <span id="sdp-rsi-val">—</span>
            </div>
            <div style="height:80px;position:relative;overflow:hidden">
              <canvas id="sdp-rsi-canvas"></canvas>
            </div>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--text-muted,#64748b);
                        text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;
                        display:flex;justify-content:space-between">
              <span><i class="fa-solid fa-wave-square" style="color:#8b5cf6"></i> MACD (12,26,9)</span>
              <span id="sdp-macd-val">—</span>
            </div>
            <div style="height:80px;position:relative;overflow:hidden">
              <canvas id="sdp-macd-canvas"></canvas>
            </div>
          </div>
        </div>

        <div style="margin-bottom:12px">
          <div style="font-size:10px;font-weight:700;color:var(--text-muted,#64748b);
                      text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;
                      display:flex;justify-content:space-between;align-items:center">
            <span><i class="fa-solid fa-cloud" style="color:#10b981"></i> Fibonacci Retracement (60D)</span>
          </div>
          <div id="sdp-fib-viz">
            <div style="height:60px;display:flex;align-items:center;justify-content:center;
                        color:var(--text-muted,#64748b)">
              <i class="fa-solid fa-circle-notch fa-spin"></i>
            </div>
          </div>
        </div>
      </div>`;

    body.appendChild(div);

    try {
      const candles = await YahooFinance.getChart(sym, '1d', '1y');
      if (!candles || candles.length < 55) {
        const el = document.getElementById('sdp-ta-loading');
        if (el) el.innerHTML = '<span style="color:#f59e0b"><i class="fa-solid fa-triangle-exclamation"></i> Insufficient data</span>';
        return;
      }
      const loadEl = document.getElementById('sdp-ta-loading');
      if (loadEl) loadEl.style.display = 'none';

      const dark   = document.documentElement.getAttribute('data-theme') === 'dark';
      const closes = candles.map(c => c.close);
      const labels = candles.map(c => {
        const d = new Date(c.time * 1000);
        return `${d.getMonth()+1}/${d.getDate()}`;
      });

      // RSI
      const rsiArr  = _rsiCalc(closes, 14);
      const rsiLast = rsiArr.filter(v => v != null).at(-1) ?? 50;
      const rsiEl   = document.getElementById('sdp-rsi-val');
      if (rsiEl) {
        rsiEl.textContent = rsiLast.toFixed(1);
        rsiEl.style.color = rsiLast > 70 ? '#ef4444' : rsiLast < 30 ? '#10b981' : '#f59e0b';
      }

      const tc   = dark ? '#9db3d8' : '#64748b';
      const gc   = dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
      const N    = 120;
      const lbl  = labels.slice(-N);
      const tt   = { backgroundColor: dark ? '#0f172a' : '#fff', bodyColor: tc,
                     borderColor: dark ? '#1e293b' : '#dde3f0', borderWidth: 1 };

      if (typeof Chart !== 'undefined') {
        const rsiCanvas = document.getElementById('sdp-rsi-canvas');
        if (rsiCanvas) {
          if (_sdCJ['sdp-rsi']) { try { _sdCJ['sdp-rsi'].destroy(); } catch(e) {} }
          _sdCJ['sdp-rsi'] = new Chart(rsiCanvas.getContext('2d'), {
            type: 'line',
            data: {
              labels: lbl,
              datasets: [
                { data: rsiArr.slice(-N), borderColor:'#8b5cf6', backgroundColor:'transparent', borderWidth:1.5, pointRadius:0, tension:0.4, spanGaps:true },
                { data: lbl.map(()=>70), borderColor:'rgba(239,68,68,0.4)', borderWidth:1, borderDash:[4,3], pointRadius:0, fill:false },
                { data: lbl.map(()=>30), borderColor:'rgba(16,185,129,0.4)', borderWidth:1, borderDash:[4,3], pointRadius:0, fill:false },
              ],
            },
            options: {
              responsive:true, maintainAspectRatio:false, animation:false,
              plugins: { legend:{display:false}, tooltip:{...tt, callbacks:{
                label:c=>` RSI: ${sf(c.parsed.y).toFixed(1)}`, filter:i=>i.datasetIndex===0,
              }}},
              scales: {
                x:{ ticks:{color:tc,maxTicksLimit:6,font:{size:9}}, grid:{color:gc} },
                y:{ min:0, max:100, ticks:{color:tc,font:{size:9}}, grid:{color:gc} },
              },
            },
          });
        }

        // MACD
        const macd    = _macdCalc(closes);
        const macdL   = macd.line.filter(v => v != null).at(-1) ?? 0;
        const sigL    = macd.signal.filter(v => v != null).at(-1) ?? 0;
        const macdEl  = document.getElementById('sdp-macd-val');
        if (macdEl) {
          macdEl.textContent = `${macdL > sigL ? 'BULL' : 'BEAR'} ${macdL.toFixed(4)}`;
          macdEl.style.color = macdL > sigL ? '#10b981' : '#ef4444';
        }
        const macdCanvas = document.getElementById('sdp-macd-canvas');
        if (macdCanvas) {
          if (_sdCJ['sdp-macd']) { try { _sdCJ['sdp-macd'].destroy(); } catch(e) {} }
          const hist = macd.hist.slice(-N);
          _sdCJ['sdp-macd'] = new Chart(macdCanvas.getContext('2d'), {
            type: 'bar',
            data: {
              labels: lbl,
              datasets: [
                { type:'bar',  data:hist, backgroundColor:hist.map(v=>v==null?'transparent':v>=0?'rgba(16,185,129,0.6)':'rgba(239,68,68,0.6)'), borderWidth:0, borderRadius:1 },
                { type:'line', data:macd.line.slice(-N), borderColor:'#3b82f6', borderWidth:1.5, pointRadius:0, fill:false, spanGaps:true },
                { type:'line', data:macd.signal.slice(-N), borderColor:'#f97316', borderWidth:1.5, pointRadius:0, fill:false, spanGaps:true },
              ],
            },
            options: {
              responsive:true, maintainAspectRatio:false, animation:false,
              plugins:{ legend:{display:false}, tooltip:tt },
              scales:{
                x:{ ticks:{color:tc,maxTicksLimit:6,font:{size:9}}, grid:{color:gc} },
                y:{ ticks:{color:tc,font:{size:9}}, grid:{color:gc} },
              },
            },
          });
        }
      }

      // Fibonacci
      const fib      = _fibCalc(candles);
      const lastPrice= closes[closes.length - 1];
      const fibEl    = document.getElementById('sdp-fib-viz');
      if (fibEl) {
        fibEl.innerHTML = `
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;padding:8px;
                      background:rgba(139,92,246,0.06);border-radius:8px">
            <span style="font-size:11px;font-weight:700;color:var(--text-primary,#0f172a)">
              Current: $${lastPrice.toFixed(2)}
            </span>
            <span style="font-size:10px;color:var(--text-muted,#64748b);margin-left:auto">
              Range: $${fib.lo.toFixed(2)} — $${fib.hi.toFixed(2)}
            </span>
          </div>
          <div style="display:flex;flex-direction:column;gap:4px">
            ${fib.levels.map(lv => {
              const barPct = fib.d > 0 ? ((fib.hi - lv.price) / fib.d * 100).toFixed(1) : 50;
              const isNear = Math.abs(lv.price - lastPrice) / Math.max(lastPrice, 1) < 0.012;
              const c      = lv.key ? '#3b82f6' : 'var(--text-muted,#64748b)';
              return `
                <div style="display:flex;align-items:center;gap:8px;padding:3px 6px;border-radius:5px;
                            ${isNear ? 'background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.15)' : ''}">
                  <span style="font-size:10px;font-weight:800;color:${c};min-width:36px;
                               font-family:var(--font-mono,monospace)">${lv.label}</span>
                  <div style="flex:1;height:5px;background:rgba(148,163,184,0.15);border-radius:3px;overflow:hidden">
                    <div style="width:${barPct}%;height:100%;background:${lastPrice >= lv.price ? '#10b981':'rgba(148,163,184,0.3)'};border-radius:3px"></div>
                  </div>
                  <span style="font-size:11px;font-weight:700;font-family:var(--font-mono,monospace);color:${c};min-width:62px;text-align:right">
                    $${lv.price.toFixed(2)}
                  </span>
                  ${lv.key ? '<span style="font-size:8px;color:#8b5cf6;font-weight:700;background:rgba(139,92,246,0.1);padding:1px 5px;border-radius:3px">KEY</span>' : '<span style="min-width:30px"></span>'}
                  ${isNear ? '<span style="font-size:9px;color:#3b82f6;font-weight:800"><i class="fa-solid fa-caret-left"></i> NOW</span>' : ''}
                </div>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;padding-top:8px;
                      border-top:1px solid var(--border,rgba(0,0,0,0.06))">
            <span style="font-size:10px;font-weight:700;color:var(--text-muted,#64748b)">Extensions:</span>
            ${fib.exts.map(e => `
              <div style="background:var(--bg-primary,#f1f5f9);border:1px solid var(--border,rgba(0,0,0,0.08));
                          border-radius:6px;padding:3px 10px;text-align:center">
                <div style="font-size:9px;color:#8b5cf6;font-weight:700">${e.label}</div>
                <div style="font-size:11px;font-weight:800;font-family:var(--font-mono,monospace)">$${e.price.toFixed(2)}</div>
              </div>`).join('')}
          </div>`;
      }
    } catch (err) {
      console.error('[SDP] TA error:', err);
      const el = document.getElementById('sdp-ta-loading');
      if (el) el.innerHTML = `<span style="color:#ef4444"><i class="fa-solid fa-xmark"></i> ${err.message}</span>`;
    }
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function _bodyHtml(html) {
    const b = document.getElementById('sdp-fp-body');
    if (b) b.innerHTML = html;
  }

  function _t(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  // ── R1 — Signal from AVApi cache ────────────────────────
  function _sig(sym) {
    // Use AVApi cache if available (new architecture)
    if (typeof AVApi !== 'undefined') {
      const cached = AVApi.getCached('signals');
      if (cached?.signals) {
        if (Array.isArray(cached.signals)) {
          return cached.signals.find(s => s.symbol === sym) || null;
        }
        // If object/dict keyed by symbol
        return cached.signals[sym] || null;
      }
    }
    return null;
  }

  function _updateWLBtn() {
    const btn = document.getElementById('sdp-fp-wl');
    if (!btn) return;
    const inWL = window.WatchlistManager?.isInWatchlist?.(_sym);
    btn.innerHTML = `<i class="${inWL ? 'fa-solid' : 'fa-regular'} fa-star"></i> ${inWL ? 'In Watchlist' : 'Add to WL'}`;
    btn.style.color = inWL ? '#eab308' : '';
  }

  function _toggleWL() {
    if (!window.WatchlistManager) return;
    if (WatchlistManager.isInWatchlist(_sym)) {
      WatchlistManager.removeSymbol(_sym);
    } else {
      WatchlistManager.addSymbol(_sym);
    }
    _updateWLBtn();
  }

  function _f(val, prefix = '', dec = 2, suffix = '') {
    if (val == null || val === '' || isNaN(parseFloat(val))) return '--';
    return `${prefix}${parseFloat(val).toFixed(dec)}${suffix}`;
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
    const d  = Date.now() - ts;
    const m  = Math.floor(d / 60000);
    const h  = Math.floor(m / 60);
    const dy = Math.floor(h / 24);
    return dy > 0 ? `${dy}d ago` : h > 0 ? `${h}h ago` : m > 0 ? `${m}m ago` : 'Just now';
  }

  function _sentiment(h) {
    h = h.toLowerCase();
    const p = ['beat','surges','rises','gains','record','growth','strong','upgrade','bullish'].filter(w=>h.includes(w)).length;
    const n = ['miss','falls','drops','loss','crash','downgrade','bearish','decline'].filter(w=>h.includes(w)).length;
    if (p > n) return { cls:'positive', label:'<i class="fa-solid fa-arrow-up" style="font-size:9px"></i> Positive' };
    if (n > p) return { cls:'negative', label:'<i class="fa-solid fa-arrow-down" style="font-size:9px"></i> Negative' };
    return { cls:'neutral', label:'<i class="fa-solid fa-minus" style="font-size:9px"></i> Neutral' };
  }

  function sf(v, d = 0) {
    const p = parseFloat(v);
    return isNaN(p) ? d : p;
  }

  function _destroyAllSDCJ() {
    Object.keys(_sdCJ).forEach(id => {
      if (_sdCJ[id]) { try { _sdCJ[id].destroy(); } catch(e) {} delete _sdCJ[id]; }
    });
  }

  function _destroyFPChart() {
    if (_fpChart) {
      try { _fpChart.remove(); } catch(e) {}
      _fpChart = null; _fpSeries = null; _lastFPW = 0;
    }
  }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    open,
    close,
    _retryFinancials,
  };

})();

window.StockDetail = StockDetail;

// Fix anti-growth loop
(function() {
  const fix = () => {
    document.querySelectorAll('.chart-container').forEach(el => {
      el.style.cssText += ';height:360px!important;min-height:360px!important;max-height:360px!important;overflow:hidden!important';
    });
  };
  fix();
  document.addEventListener('DOMContentLoaded', fix);
  setInterval(fix, 3000);
})();

console.log('[av-stock-detail] v3.3 loaded — Uses AV_CONFIG.WORKERS | AVApi signals cache');