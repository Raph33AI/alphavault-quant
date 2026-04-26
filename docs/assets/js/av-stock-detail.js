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

  // ── Remplace getBasicFinancials (inexistant) par /api/statistics ──
  async function getBasicFinancials(sym) {
    // Retour à l'endpoint Finnhub original (metric object natif)
    return _get(`/api/finnhub/basic-financials?symbol=${sym}&metric=all`);
  }

  async function getEarnings(sym) {
    const data = await _get(`/api/finnhub/earnings?symbol=${sym}`);
    if (!data) return [];
    // Finnhub retourne un tableau direct OU le worker peut envelopper
    if (Array.isArray(data))           return data;
    if (Array.isArray(data.earnings))  return data.earnings;
    if (Array.isArray(data.data))      return data.data;
    return [];
  }

  // ── getEarningsCalendar : endpoint inexistant dans le worker
  // Yahoo Finance summary (calendarEvents) est utilisé comme fallback
  async function getEarningsCalendar(_sym) {
    return null;  // Données disponibles via Yahoo summary.calendarEvents
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
// DYNAMIC CHART LIBS LOADER
// Charge LightweightCharts et Chart.js si absents de la page
// ════════════════════════════════════════════════════════════
async function _ensureChartLibs() {
  const tasks = [];

  if (typeof LightweightCharts === 'undefined') {
    tasks.push(new Promise((res, rej) => {
      const s   = document.createElement('script');
      s.src     = 'https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js';
      s.onload  = res;
      s.onerror = () => { console.warn('[SDP] LightweightCharts load failed'); res(); };
      document.head.appendChild(s);
    }));
  }

  if (typeof Chart === 'undefined') {
    tasks.push(new Promise((res, rej) => {
      const s   = document.createElement('script');
      s.src     = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
      s.onload  = res;
      s.onerror = () => { console.warn('[SDP] Chart.js load failed'); res(); };
      document.head.appendChild(s);
    }));
  }

  if (tasks.length > 0) {
    await Promise.all(tasks);
    console.log('[SDP] Chart libs loaded dynamically');
  }
}

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

  function _injectStyles() {
    if (document.getElementById('sdp-styles')) return;
    const style = document.createElement('style');
    style.id    = 'sdp-styles';
    style.textContent = `

      /* ══════════════════════════════════════════════════════
         BASE — Full page overlay
         ══════════════════════════════════════════════════════ */
      .sdp-fullpage {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: var(--bg-primary, #f1f5f9);
        flex-direction: column;
        overflow-y: auto;
        overflow-x: hidden;
        animation: fadeIn 0.18s ease;
        -webkit-overflow-scrolling: touch;
      }
      [data-theme="dark"] .sdp-fullpage { background: var(--bg-primary, #0f172a); }
      .sdp-fullpage.open { display: flex !important; }

      /* ══════════════════════════════════════════════════════
         HEADER
         ══════════════════════════════════════════════════════ */
      .sdp-fp-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 24px;
        background: var(--bg-card, #fff);
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.08));
        position: sticky;
        top: 0;
        z-index: 100;
        flex-wrap: nowrap;
        box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        min-height: 56px;
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
        flex-shrink: 0;
        white-space: nowrap;
      }
      .sdp-fp-back:hover { background: rgba(59,130,246,0.05); color: #3b82f6; }

      .sdp-fp-sym {
        font-size: 18px; font-weight: 900;
        color: var(--text-primary, #0f172a);
        font-family: var(--font-mono, monospace);
        white-space: nowrap;
      }
      .sdp-fp-name  { font-size: 11px; color: var(--text-muted, #64748b); white-space: nowrap; }
      .sdp-fp-price {
        font-size: 20px; font-weight: 900;
        font-family: var(--font-mono, monospace);
        color: var(--text-primary, #0f172a);
        white-space: nowrap;
      }
      .sdp-fp-change      { font-size: 13px; font-weight: 700; white-space: nowrap; }
      .sdp-fp-change.up   { color: #10b981; }
      .sdp-fp-change.down { color: #ef4444; }

      .sdp-fp-actions { display: flex; gap: 6px; margin-left: auto; flex-shrink: 0; }
      .sdp-fp-action-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 7px 14px; border-radius: 8px; border: none;
        font-size: 12px; font-weight: 700; cursor: pointer;
        transition: all 0.15s;
        font-family: var(--font-sans, 'Inter', sans-serif);
        white-space: nowrap;
      }
      .sdp-fp-action-btn.buy  { background: #10b981; color: #fff; }
      .sdp-fp-action-btn.sell { background: #ef4444; color: #fff; }
      .sdp-fp-action-btn.wl   {
        background: var(--bg-primary, #f1f5f9);
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        color: var(--text-muted, #64748b);
      }
      .sdp-fp-action-btn.buy:hover  { background: #059669; }
      .sdp-fp-action-btn.sell:hover { background: #dc2626; }
      .sdp-fp-action-btn.wl:hover   { border-color: #eab308; color: #eab308; }

      /* ══════════════════════════════════════════════════════
         TABS
         ══════════════════════════════════════════════════════ */
      .sdp-fp-tabs {
        display: flex;
        gap: 2px;
        padding: 10px 24px 0;
        background: var(--bg-card, #fff);
        border-bottom: 2px solid var(--border, rgba(0,0,0,0.08));
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        scrollbar-width: none;
        flex-shrink: 0;
      }
      .sdp-fp-tabs::-webkit-scrollbar { display: none; }
      .sdp-fp-tab {
        display: flex; align-items: center; gap: 7px;
        padding: 9px 16px; border: none; background: transparent;
        color: var(--text-muted, #64748b);
        font-size: 12px; font-weight: 600; cursor: pointer;
        border-radius: 8px 8px 0 0;
        transition: all 0.15s; position: relative;
        font-family: var(--font-sans, 'Inter', sans-serif);
        white-space: nowrap;
        flex-shrink: 0;
      }
      .sdp-fp-tab:hover  { color: #3b82f6; }
      .sdp-fp-tab.active { color: #3b82f6; background: var(--bg-primary, #f1f5f9); }
      .sdp-fp-tab.active::after {
        content: ''; position: absolute;
        bottom: -2px; left: 0; right: 0;
        height: 2px; background: #3b82f6;
      }

      /* ══════════════════════════════════════════════════════
         BODY — utilise tout l'espace sur PC
         ══════════════════════════════════════════════════════ */
      .sdp-fp-body {
        padding: 20px 28px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-width: 1440px;
        margin: 0 auto;
        width: 100%;
        box-sizing: border-box;
        flex: 1;
      }

      /* ══════════════════════════════════════════════════════
         CARDS
         ══════════════════════════════════════════════════════ */
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
        flex-wrap: wrap;
      }
      .sdp-fp-stats {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
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

      /* ══════════════════════════════════════════════════════
         CHARTS
         ══════════════════════════════════════════════════════ */
      .sdp-fp-chart-mini-sm {
        height: 200px; min-height: 200px;
        overflow: hidden; position: relative;
      }
      .sdp-fp-chart {
        height: 480px; min-height: 480px;
        overflow: hidden; position: relative;
      }

      /* ══════════════════════════════════════════════════════
         OVERVIEW GRID — signal + mini chart
         ══════════════════════════════════════════════════════ */
      .sdp-ov-grid {
        display: grid;
        grid-template-columns: 1fr 340px;
        gap: 14px;
        align-items: start;
      }

      /* ══════════════════════════════════════════════════════
         MISC COMPONENTS
         ══════════════════════════════════════════════════════ */
      .sdp-iv-tabs { display: flex; gap: 4px; padding: 10px 0 8px; flex-wrap: wrap; }
      .sdp-iv-btn {
        padding: 5px 12px; border-radius: 6px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        background: transparent; color: var(--text-muted, #64748b);
        font-size: 11px; font-weight: 600; cursor: pointer; transition: all 0.15s;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }
      .sdp-iv-btn.active {
        background: linear-gradient(135deg, #3b82f6, #8b5cf6);
        color: #fff; border-color: transparent;
      }
      .sdp-desc-toggle {
        font-size: 11px; color: #3b82f6; background: none;
        border: none; cursor: pointer; padding: 4px 0; font-weight: 600;
        font-family: var(--font-sans, 'Inter', sans-serif);
      }

      /* ══════════════════════════════════════════════════════
         NEWS TAB
         ══════════════════════════════════════════════════════ */
      .sdp-news-page   { display: flex; flex-direction: column; gap: 0; }
      .sdp-news-header { display: flex; align-items: center; justify-content: space-between;
                         padding: 0 0 12px; flex-wrap: wrap; gap: 8px; }
      .sdp-news-count  { font-size: 12px; font-weight: 700; color: var(--text-primary, #0f172a); }
      .sdp-news-refresh-btn {
        display: flex; align-items: center; gap: 5px;
        padding: 6px 12px; border-radius: 8px;
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        background: transparent; color: var(--text-muted, #64748b);
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
      .sdp-news-card-thumb img  { width: 100%; height: 100%; object-fit: cover; }
      .sdp-news-thumb-icon      { font-size: 20px; color: var(--text-muted, #94a3b8); }
      .sdp-news-card-body       { flex: 1; min-width: 0; }
      .sdp-news-card-title {
        font-size: 13px; font-weight: 700; color: var(--text-primary, #0f172a);
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
      .sdp-news-card-meta   { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .sdp-news-source      { font-size: 10px; color: #3b82f6; font-weight: 600; }
      .sdp-news-time        { font-size: 10px; color: var(--text-muted, #94a3b8); }
      .sdp-news-sent        { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
      .sdp-news-sent.positive { background: rgba(16,185,129,0.1); color: #10b981; }
      .sdp-news-sent.negative { background: rgba(239,68,68,0.1);  color: #ef4444; }
      .sdp-news-sent.neutral  { background: rgba(107,114,128,0.1);color: #6b7280; }
      .sdp-news-card-action { color: var(--text-muted, #94a3b8); font-size: 12px; flex-shrink: 0; margin-top: 4px; }
      .sdp-news-footer      { padding: 12px 0 0; font-size: 10px; color: var(--text-muted, #94a3b8); text-align: center; }

      /* ══════════════════════════════════════════════════════
         QUANT TAB — grilles
         ══════════════════════════════════════════════════════ */
      .sdp-q-grid-3 {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 14px;
      }
      .sdp-q-grid-2 {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 14px;
      }
      .sdp-q-metric {
        display: flex; align-items: center; justify-content: space-between;
        padding: 5px 0;
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.05));
      }
      .sdp-q-metric:last-child { border-bottom: none; }
      .sdp-q-lbl {
        font-size: 10px; color: var(--text-muted, #64748b); font-weight: 600;
      }
      .sdp-q-val {
        font-size: 12px; font-weight: 800;
        font-family: var(--font-mono, monospace);
        color: var(--text-primary, #0f172a);
      }

      /* ── TradingView ─────────────────────────────────── */
      .sdp-tv-container {
        height: 620px;
        min-height: 620px;
        overflow: hidden;
      }

      /* ── Hurst bar ───────────────────────────────────── */
      .sdp-hurst-bar {
        height: 8px;
        background: linear-gradient(90deg, #8b5cf6, #6b7280, #10b981);
        border-radius: 4px;
        position: relative;
        margin: 6px 0 2px;
      }
      .sdp-hurst-marker {
        position: absolute; top: -4px;
        width: 16px; height: 16px; border-radius: 50%;
        background: white; border: 2px solid #3b82f6;
        transform: translateX(-50%);
        box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      }

      /* ── Black-Scholes ───────────────────────────────── */
      .sdp-bs-form {
        display: grid;
        grid-template-columns: repeat(6, 1fr);
        gap: 10px;
        padding: 14px;
        background: var(--bg-primary, #f1f5f9);
        border-radius: 10px;
        margin-bottom: 14px;
      }
      .sdp-bs-label {
        display: block;
        font-size: 9px; font-weight: 700;
        color: var(--text-muted, #64748b);
        text-transform: uppercase; letter-spacing: 0.5px;
        margin-bottom: 4px;
      }
      .sdp-bs-input {
        width: 100%; height: 36px; padding: 0 10px;
        background: var(--bg-card, #fff);
        border: 1px solid var(--border, rgba(0,0,0,0.1));
        border-radius: 7px;
        font-size: 13px; font-weight: 600;
        color: var(--text-primary, #0f172a);
        font-family: var(--font-mono, monospace);
        outline: none; box-sizing: border-box;
        transition: border-color 0.15s, box-shadow 0.15s;
      }
      .sdp-bs-input:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 3px rgba(59,130,246,0.1);
      }

      /* ── Option Chain table ──────────────────────────── */
      .sdp-bs-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      .sdp-bs-table { width: 100%; border-collapse: collapse; font-size: 11px; }
      .sdp-bs-table th {
        padding: 7px 10px; text-align: right;
        font-size: 9px; font-weight: 700;
        color: var(--text-muted, #64748b);
        text-transform: uppercase; letter-spacing: 0.4px;
        border-bottom: 2px solid var(--border, rgba(0,0,0,0.08));
        white-space: nowrap;
      }
      .sdp-bs-table th:first-child { text-align: left; }
      .sdp-bs-table td {
        padding: 6px 10px; text-align: right;
        font-family: var(--font-mono, monospace); font-weight: 600;
        border-bottom: 1px solid var(--border, rgba(0,0,0,0.05));
        color: var(--text-primary, #0f172a);
        white-space: nowrap;
      }
      .sdp-bs-table td:first-child { text-align: left; }
      .sdp-bs-table tr:hover td { background: rgba(59,130,246,0.03); }

      /* ── Greeks grid ─────────────────────────────────── */
      .sdp-greeks-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }

      /* ── Monte Carlo ─────────────────────────────────── */
      .sdp-mc-container {
        height: 360px; min-height: 360px;
        position: relative; margin-bottom: 12px;
      }
      .sdp-mc-targets {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
        gap: 8px; margin-top: 10px;
      }

      /* ── Return Distribution ─────────────────────────── */
      .sdp-rd-container {
        height: 260px; min-height: 260px;
        position: relative;
      }

      /* ══════════════════════════════════════════════════════
         BADGES & UTILS
         ══════════════════════════════════════════════════════ */
      .regime-chip {
        display: inline-flex; align-items: center; gap: 3px;
        padding: 2px 9px; border-radius: 20px;
        font-size: 10px; font-weight: 700;
        border: 1px solid rgba(59,130,246,0.2);
        background: rgba(59,130,246,0.07);
        color: #3b82f6; white-space: nowrap;
      }
      .dir-badge {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 3px 8px; border-radius: 5px;
        font-size: 10px; font-weight: 700;
      }
      .dir-badge.buy     { background: rgba(16,185,129,0.12); color: #10b981; }
      .dir-badge.sell    { background: rgba(239,68,68,0.12);  color: #ef4444; }
      .dir-badge.neutral { background: rgba(107,114,128,0.12);color: #6b7280; }

      /* ══════════════════════════════════════════════════════
         KEYFRAMES
         ══════════════════════════════════════════════════════ */
      @keyframes fadeIn {
        from { opacity: 0; } to { opacity: 1; }
      }
      @keyframes scaleIn {
        from { opacity: 0; transform: scale(0.96); }
        to   { opacity: 1; transform: scale(1); }
      }
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(10px); }
        to   { opacity: 1; transform: translateX(0); }
      }

      /* ══════════════════════════════════════════════════════
         RESPONSIVE — 1200px (grand PC → plein écran)
         ══════════════════════════════════════════════════════ */
      @media (min-width: 1200px) {
        .sdp-fp-body     { padding: 24px 40px; }
        .sdp-tv-container{ height: 680px; min-height: 680px; }
        .sdp-mc-container{ height: 400px; min-height: 400px; }
        .sdp-rd-container{ height: 300px; min-height: 300px; }
        .sdp-fp-chart    { height: 540px; min-height: 540px; max-height: 540px; }
        .sdp-fp-chart-mini-sm { height: 220px; min-height: 220px; max-height: 220px; }
        .sdp-greeks-grid { grid-template-columns: repeat(4, 1fr); }
      }

      /* ══════════════════════════════════════════════════════
         RESPONSIVE — 1024px (laptop standard)
         ══════════════════════════════════════════════════════ */
      @media (max-width: 1024px) {
        .sdp-fp-body      { padding: 16px 20px; }
        .sdp-bs-form      { grid-template-columns: repeat(3, 1fr); }
        .sdp-greeks-grid  { grid-template-columns: repeat(4, 1fr); }
        .sdp-tv-container { height: 520px; min-height: 520px; }
        .sdp-mc-container { height: 320px; min-height: 320px; }
      }

      /* ══════════════════════════════════════════════════════
         RESPONSIVE — 900px (tablette paysage)
         ══════════════════════════════════════════════════════ */
      @media (max-width: 900px) {
        .sdp-ov-grid    { grid-template-columns: 1fr !important; }
        .sdp-q-grid-3   { grid-template-columns: 1fr 1fr; }
        .sdp-tv-container{ height: 460px; min-height: 460px; }
      }

      /* ══════════════════════════════════════════════════════
         RESPONSIVE — 768px (tablette portrait / mobile large)
         ══════════════════════════════════════════════════════ */
      @media (max-width: 768px) {
        /* Header compact */
        .sdp-fp-header   { padding: 8px 12px; gap: 6px; min-height: 48px; }
        .sdp-fp-sym      { font-size: 15px; }
        .sdp-fp-price    { font-size: 16px; }
        .sdp-fp-name     { display: none; }
        #sdp-fp-sector   { display: none; }
        #sdp-fp-vol      { display: none; }
        #sdp-fp-cap      { display: none; }
        .sdp-fp-actions  { gap: 4px; }
        .sdp-fp-action-btn { padding: 6px 9px; font-size: 11px; gap: 3px; }

        /* Tabs scroll */
        .sdp-fp-tabs  { padding: 6px 12px 0; }
        .sdp-fp-tab   { padding: 7px 10px; font-size: 11px; }

        /* Body */
        .sdp-fp-body  { padding: 10px 12px; gap: 10px; }

        /* Stats */
        .sdp-fp-stats { grid-template-columns: 1fr 1fr; gap: 6px; }
        .sdp-fp-stat-section { padding: 12px 14px; }
        .sdp-fp-stat-val     { font-size: 12px; }

        /* Charts */
        .sdp-fp-chart         { height: 320px; min-height: 320px; max-height: 320px; }
        .sdp-fp-chart-mini-sm { height: 160px; min-height: 160px; max-height: 160px; }
        .sdp-tv-container     { height: 380px; min-height: 380px; }
        .sdp-mc-container     { height: 240px; min-height: 240px; }
        .sdp-rd-container     { height: 190px; min-height: 190px; }

        /* Quant grids */
        .sdp-q-grid-3  { grid-template-columns: 1fr; }
        .sdp-q-grid-2  { grid-template-columns: 1fr; }

        /* BS form */
        .sdp-bs-form   { grid-template-columns: 1fr 1fr; }

        /* Greeks */
        .sdp-greeks-grid { grid-template-columns: repeat(2, 1fr); }

        /* MC targets */
        .sdp-mc-targets  { grid-template-columns: repeat(3, 1fr); }
      }

      /* ══════════════════════════════════════════════════════
         RESPONSIVE — 480px (smartphone standard)
         ══════════════════════════════════════════════════════ */
      @media (max-width: 480px) {
        /* Header minimal */
        .sdp-fp-header     { padding: 7px 10px; gap: 5px; }
        .sdp-fp-sym        { font-size: 14px; }
        .sdp-fp-price      { font-size: 14px; }
        .sdp-fp-change     { font-size: 11px; }
        .sdp-fp-back       { padding: 6px 8px; font-size: 11px; }
        .sdp-fp-action-btn.sell { display: none; }
        .sdp-fp-action-btn.wl   { display: none; }

        /* Logo */
        #sdp-fp-logo { display: none; }

        /* Body */
        .sdp-fp-body   { padding: 8px; gap: 8px; }

        /* Stats : 2 colonnes */
        .sdp-fp-stats  { grid-template-columns: 1fr 1fr; gap: 5px; }
        .sdp-fp-stat-item  { padding: 7px 9px; }
        .sdp-fp-stat-lbl   { font-size: 9px; }
        .sdp-fp-stat-val   { font-size: 12px; }

        /* Charts */
        .sdp-fp-chart         { height: 260px; min-height: 260px; max-height: 260px; }
        .sdp-fp-chart-mini-sm { height: 140px; min-height: 140px; max-height: 140px; }
        .sdp-tv-container     { height: 300px; min-height: 300px; }
        .sdp-mc-container     { height: 200px; min-height: 200px; }
        .sdp-rd-container     { height: 160px; min-height: 160px; }

        /* BS */
        .sdp-bs-form   { grid-template-columns: 1fr 1fr; padding: 10px; gap: 8px; }
        .sdp-bs-input  { height: 32px; font-size: 12px; }

        /* Greeks */
        .sdp-greeks-grid { grid-template-columns: repeat(2, 1fr); gap: 6px; }

        /* MC targets */
        .sdp-mc-targets { grid-template-columns: repeat(2, 1fr); }

        /* News cards */
        .sdp-news-card-thumb { width: 48px; height: 48px; }
        .sdp-news-card-title { font-size: 12px; }

        /* Tabs */
        .sdp-fp-tab { padding: 6px 9px; font-size: 10px; gap: 4px; }
        .sdp-fp-tab i { font-size: 10px; }
      }

      /* ══════════════════════════════════════════════════════
         RESPONSIVE — 375px (petits iPhones)
         ══════════════════════════════════════════════════════ */
      @media (max-width: 375px) {
        .sdp-fp-body   { padding: 6px; gap: 6px; }
        .sdp-fp-stats  { grid-template-columns: 1fr 1fr; gap: 4px; }
        .sdp-tv-container  { height: 260px; min-height: 260px; }
        .sdp-mc-container  { height: 170px; min-height: 170px; }
        .sdp-rd-container  { height: 140px; min-height: 140px; }
        .sdp-bs-form       { grid-template-columns: 1fr; }
        .sdp-greeks-grid   { grid-template-columns: 1fr 1fr; }
      }

      /* ══════════════════════════════════════════════════════
         TOUCH DEVICES — tap targets min 44px
         ══════════════════════════════════════════════════════ */
      @media (hover: none) and (pointer: coarse) {
        .sdp-fp-action-btn { min-height: 40px; min-width: 40px; }
        .sdp-fp-back       { min-height: 40px; }
        .sdp-fp-tab        { min-height: 40px; }
        .sdp-iv-btn        { min-height: 40px; padding: 0 14px; }
        .sdp-bs-input      { height: 42px; font-size: 16px; }
        .sdp-news-card:hover { transform: none; }
      }

      /* Overview top grid : Signal + Chart mini */
      .sdp-ov-top-grid {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: 12px;
        align-items: start;
      }
      @media (max-width: 768px) {
        .sdp-ov-top-grid {
          grid-template-columns: 1fr;
        }
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

        <!-- ── HEADER ──────────────────────────────────────── -->
        <div class="sdp-fp-header" id="sdp-fp-header-row">

          <button class="sdp-fp-back" id="sdp-back">
            <i class="fa-solid fa-arrow-left"></i> Back
          </button>

          <div id="sdp-fp-logo" style="flex-shrink:0"></div>

          <div style="min-width:0">
            <div class="sdp-fp-sym"  id="sdp-fp-sym">—</div>
            <div class="sdp-fp-name" id="sdp-fp-name">Loading...</div>
          </div>

          <div id="sdp-fp-sector"
               style="font-size:10px;font-weight:700;padding:2px 9px;border-radius:10px;
                      background:rgba(59,130,246,0.08);color:#3b82f6;
                      border:1px solid rgba(59,130,246,0.2);flex-shrink:0;
                      white-space:nowrap">—</div>

          <div style="display:flex;flex-direction:column;gap:1px;flex-shrink:0">
            <div class="sdp-fp-price"  id="sdp-fp-price">—</div>
            <div class="sdp-fp-change" id="sdp-fp-change">—</div>
          </div>

          <div style="display:flex;flex-direction:column;gap:2px;font-size:10px;
                      color:var(--text-muted,#64748b);flex-shrink:0">
            <span id="sdp-fp-vol">Vol: —</span>
            <span id="sdp-fp-cap">Cap: —</span>
          </div>

          <div class="sdp-fp-actions">
            <button class="sdp-fp-action-btn buy"  id="sdp-fp-buy">
              <i class="fa-solid fa-arrow-trend-up"></i> BUY
            </button>
            <button class="sdp-fp-action-btn sell" id="sdp-fp-sell">
              <i class="fa-solid fa-arrow-trend-down"></i> SELL
            </button>
            <button class="sdp-fp-action-btn wl"   id="sdp-fp-wl">
              <i class="fa-regular fa-star"></i> Watchlist
            </button>
          </div>
        </div>

        <!-- ── TABS ────────────────────────────────────────── -->
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
          <button class="sdp-fp-tab" data-tab="quant">
            <i class="fa-solid fa-square-root-variable"></i> Quant
          </button>
        </div>

        <!-- ── BODY ────────────────────────────────────────── -->
        <div class="sdp-fp-body" id="sdp-fp-body">
          <div style="display:flex;align-items:center;justify-content:center;
                      gap:12px;color:var(--text-muted,#64748b);padding:60px">
            <i class="fa-solid fa-circle-notch fa-spin"
               style="font-size:22px;color:#3b82f6"></i>
            Loading data...
          </div>
        </div>

      </div>`);

    // ── Event : Back button ───────────────────────────────
    document.getElementById('sdp-back')
      ?.addEventListener('click', close);

    // ── Event : Tab navigation ────────────────────────────
    document.querySelectorAll('.sdp-fp-tab').forEach(tab => {
      tab.addEventListener('click', () => _switchTab(tab.dataset.tab));
    });

    // ── Event : BUY button → trading.html?symbol=X&side=BUY ──
    document.getElementById('sdp-fp-buy')?.addEventListener('click', () => {
      close();
      window.location.href =
        `trading.html?symbol=${encodeURIComponent(_sym)}&side=BUY`;
    });

    // ── Event : SELL button → trading.html?symbol=X&side=SELL ─
    document.getElementById('sdp-fp-sell')?.addEventListener('click', () => {
      close();
      window.location.href =
        `trading.html?symbol=${encodeURIComponent(_sym)}&side=SELL`;
    });

    // ── Event : Watchlist toggle ──────────────────────────
    document.getElementById('sdp-fp-wl')
      ?.addEventListener('click', _toggleWL);

    // ── Event : Escape key ────────────────────────────────
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') {
        const fp = document.getElementById('sdp-fullpage');
        if (fp?.classList.contains('open')) close();
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

    // Charge LightweightCharts et Chart.js si absents (pages sans ces libs)
    await _ensureChartLibs();

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
           fhProfileRes] = await Promise.allSettled([
      YahooFinance.getQuote(sym),
      YahooFinance.getFinancials(sym),
      YahooFinance.getNews(sym, 50),
      FinanceHub.getBasicFinancials(sym),
      FinanceHub.getEarnings(sym),
      FinanceHub.getEarningsCalendar(sym),
      FinanceHub.getCompanyProfile(sym),
    ]);

    const p = r => r.status === 'fulfilled' ? r.value : null;
    _data[sym].quote      = p(quoteRes);
    _data[sym].summary    = p(summaryRes);
    _data[sym].news       = p(newsRes)    ?? [];
    _data[sym].fhBasic    = p(fhBasicRes);
    // Normalise en tableau (getEarnings renvoie déjà un array, double sécurité)
    const rawEarnings     = p(fhEarnRes);
    _data[sym].fhEarnings = Array.isArray(rawEarnings) ? rawEarnings
                          : Array.isArray(rawEarnings?.earnings) ? rawEarnings.earnings
                          : Array.isArray(rawEarnings?.data)     ? rawEarnings.data
                          : [];
    _data[sym].fhCal      = p(fhCalRes);
    _data[sym].fhProfile  = p(fhProfileRes);

    // ── Charge les signals ML (AVApi cache ou fetch direct) ──────
    try {
      let signalData = (typeof AVApi !== 'undefined')
        ? AVApi.getCached('signals') : null;

      if (!signalData && typeof AVApi !== 'undefined') {
        signalData = await AVApi.loadOne('signals', true);
      }

      const sigsArr = signalData?.signals;
      _data[sym].signal = null;

      if (Array.isArray(sigsArr)) {
        _data[sym].signal = sigsArr.find(s => s.symbol === sym) || null;
      } else if (sigsArr && typeof sigsArr === 'object') {
        _data[sym].signal = sigsArr[sym] || null;
      }
    } catch (e) {
      _data[sym].signal = null;
    }

    // ── Charge la décision LLM pour ce symbole ───────────────────
    try {
      let decData = (typeof AVApi !== 'undefined')
        ? AVApi.getCached('decisions') : null;

      if (!decData && typeof AVApi !== 'undefined') {
        decData = await AVApi.loadOne('decisions', false);
      }

      const dec = decData?.decisions?.[sym] || null;
      _data[sym].decision = dec;

      // Injecte la décision dans le signal si présent
      if (_data[sym].signal && dec) {
        const finalDec = dec.final_decision || (dec.decision === true ? 'CONFIRM'
                       : dec.decision === false ? 'REJECT' : '');
        _data[sym].signal._council = finalDec;
      }
    } catch (e) {
      _data[sym].decision = null;
    }

    // ── Met à jour le header avec les données de quote ───────────
    const q = _data[sym].quote;
    if (q?.price > 0) {
      const meta = window.WatchlistManager?.getSymbolMeta?.(_sym) || {};
      _t('sdp-fp-name',   meta.name   || _sym);
      _t('sdp-fp-sector', meta.sector || q.exchange || '—');
      _t('sdp-fp-price',  `$${q.price.toFixed(2)}`);
      _t('sdp-fp-vol',    `Vol: ${_fmtNum(q.volume)}`);
      _t('sdp-fp-cap',    `Cap: ${_fmtMCap(q.market_cap)}`);

      const chgPct = parseFloat(q.change_pct || 0);
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
      case 'quant':      _renderQuant();              break;
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

    // ── Variables de valorisation — MANQUANTES, à définir avant kstats ──
    const epsUse = _rv(stats.trailingEps?.raw,  fhM.epsNormalizedAnnual);
    const peUse  = _rv(
      detail.trailingPE?.raw,
      fhM.peBasicExclExtraTTM,
      fhM.peTTM,
      (epsUse && q.price > 0) ? q.price / sf(epsUse) : null
    );
    const fwdPE  = _rv(detail.forwardPE?.raw,   fhM.forwardPE);
    const fwdEPS = _rv(stats.forwardEps?.raw);

    // Formatage % : gère Yahoo décimal (0.42) ET Twelve Data pct (42.5)
    const perc = (raw, ...fb) => {
      const v = _rv(raw, ...fb);
      if (v == null) return '--';
      return `${(Math.abs(sf(v)) < 5 ? sf(v) * 100 : sf(v)).toFixed(2)}%`;
    };

    const kstats = [

      // ── TOUJOURS DISPONIBLES : données quote /chart ──────────────────
      // Ces champs viennent de meta.fiftyTwoWeekHigh, meta.fiftyDayAverage, etc.
      // Garantis si le graphique s'affiche (même endpoint Yahoo)
      { l:'52W High',        v: _f(q['52w_high'] || fhM['52WeekHigh'],           '$') },
      { l:'52W Low',         v: _f(q['52w_low']  || fhM['52WeekLow'],            '$') },
      { l:'50D Avg',         v: _f(q['50d_avg']  || detail.fiftyDayAverage?.raw, '$') },
      { l:'200D Avg',        v: _f(q['200d_avg'] || detail.twoHundredDayAverage?.raw, '$') },
      { l:'Volume',          v: _fmtNum(q.volume || detail.volume?.raw) },
      { l:'Market Cap',      v: _fmtMCap(q.market_cap || _rv(stats.marketCap)) },

      // ── VALORISATION (Yahoo summary + Twelve Data fallback) ──────────
      { l:'P/E (TTM)',       v: peUse    != null ? sf(peUse).toFixed(2)             : '--' },
      { l:'Forward P/E',     v: fwdPE    != null ? sf(fwdPE).toFixed(2)             : '--' },
      { l:'EPS (TTM)',       v: epsUse   != null ? `$${sf(epsUse).toFixed(2)}`       : '--' },
      { l:'Forward EPS',     v: fwdEPS   != null ? `$${sf(fwdEPS).toFixed(2)}`       : '--' },
      { l:'Beta',            v: _rv(detail.beta?.raw, fhM.beta) != null
                                ? sf(_rv(detail.beta?.raw, fhM.beta)).toFixed(2)      : '--' },

      // ── MARGES & RENTABILITÉ (Yahoo summary + fhM Twelve Data) ───────
      { l:'Revenue (TTM)',   v: _fmtMCap(_rv(fin.totalRevenue?.raw,    fhM.revenueAnnual))   },
      { l:'Gross Margin',    v: perc(fin.grossMargins?.raw,    fhM.grossMarginAnnual)         },
      { l:'Op. Margin',      v: perc(fin.operatingMargins?.raw,fhM.operatingMarginAnnual)     },
      { l:'Profit Margin',   v: perc(fin.profitMargins?.raw,   fhM.netMarginAnnual)           },
      { l:'ROE',             v: perc(fin.returnOnEquity?.raw,
                                fhM.roeTTM  ? fhM.roeTTM  / 100 : null)                      },
      { l:'ROA',             v: perc(fin.returnOnAssets?.raw,
                                fhM.roaRfy  ? fhM.roaRfy  / 100 : null)                      },

      // ── BILAN (Yahoo summary + fhM Twelve Data) ───────────────────────
      { l:'Total Cash',      v: _fmtMCap(_rv(fin.totalCash?.raw,    fhM.cashAndEquivalents))  },
      { l:'Total Debt',      v: _fmtMCap(_rv(fin.totalDebt?.raw,    fhM.totalDebt))           },
      { l:'Free Cash Flow',  v: _fmtMCap(_rv(fin.freeCashflow?.raw, fhM.freeCashFlowAnnual))  },
      { l:'Debt/Equity',     v: _rv(fin.debtToEquity?.raw)  != null
                                ? sf(_rv(fin.debtToEquity?.raw)).toFixed(2)                    : '--' },
      { l:'Current Ratio',   v: _rv(fin.currentRatio?.raw)  != null
                                ? sf(_rv(fin.currentRatio?.raw)).toFixed(2)                    : '--' },

      // ── STRUCTURE ACTIONNARIAT (Yahoo summary uniquement) ─────────────
      { l:'Short % Float',   v: perc(stats.shortPercentOfFloat?.raw)                           },
      { l:'Insider Own.',    v: _rv(stats.heldPercentInsiders?.raw) != null
                                ? `${(sf(_rv(stats.heldPercentInsiders?.raw)) * 100).toFixed(2)}%`    : '--' },
      { l:'Institution Own.',v: _rv(stats.heldPercentInstitutions?.raw) != null
                                ? `${(sf(_rv(stats.heldPercentInstitutions?.raw)) * 100).toFixed(2)}%`: '--' },

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
      <!-- ── Signal ML + Mini Chart ──────────────────────── -->
      <div class="sdp-ov-top-grid">

        <div class="sdp-fp-stat-section"
             style="background:${sigBg};border-color:${sigBorder}">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-brain" style="color:#3b82f6"></i>
            AlphaVault ML Signal
          </div>
          ${signal ? _renderSignalBlock(signal) : `
            <div style="color:var(--text-muted,#64748b);font-size:13px;
                        display:flex;align-items:center;gap:8px;padding:8px 0">
              <i class="fa-solid fa-clock" style="color:#f59e0b"></i>
              Awaiting next signal cycle...
            </div>`}
        </div>

        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title" style="margin-bottom:8px">
            <i class="fa-solid fa-chart-candlestick" style="color:#3b82f6"></i>
            Price Chart — 1Y
          </div>
          <div id="sdp-fp-chart-mini" class="sdp-fp-chart-mini-sm"></div>
        </div>
      </div>

      <!-- ── About ──────────────────────────────────────────── -->
      ${(profSector || profDesc || profCountry || profEmp) ? `
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-building" style="color:#6b7280"></i>
            About ${sym}
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${profDesc ? '10px' : '0'}">
            ${profSector  ? `<span class="regime-chip">
                               <i class="fa-solid fa-industry" style="font-size:8px"></i>
                               ${profSector}
                             </span>` : ''}
            ${profCountry ? `<span class="regime-chip">
                               <i class="fa-solid fa-globe" style="font-size:8px"></i>
                               ${profCountry}
                             </span>` : ''}
            ${profEmp     ? `<span class="regime-chip">
                               <i class="fa-solid fa-users" style="font-size:8px"></i>
                               ${_fmtNum(profEmp)} employees
                             </span>` : ''}
          </div>
          ${profDesc ? `
            <p id="sdp-desc-p"
               style="font-size:12px;color:var(--text-muted,#64748b);line-height:1.75;
                      margin:0 0 6px;
                      display:-webkit-box;-webkit-line-clamp:3;
                      -webkit-box-orient:vertical;overflow:hidden">
              ${profDesc}
            </p>
            <button class="sdp-desc-toggle" id="sdp-desc-toggle">
              <i class="fa-solid fa-chevron-down" style="font-size:9px"></i> Show more
            </button>` : ''}
        </div>` : ''}

      <!-- ── Key Statistics ─────────────────────────────────── -->
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-table-cells" style="color:#3b82f6"></i>
          Key Statistics
          <div style="margin-left:auto">
            ${kstats.length >= 12
              ? `<span class="badge badge-green" style="font-size:10px">
                   <i class="fa-solid fa-circle-check"></i> Full
                 </span>`
              : kstats.length >= 5
              ? `<span class="badge badge-blue" style="font-size:10px">
                   <i class="fa-solid fa-circle-half-stroke"></i> Partial
                 </span>`
              : kstats.length > 0
              ? `<span class="badge badge-orange" style="font-size:10px">
                   <i class="fa-solid fa-triangle-exclamation"></i> Limited
                 </span>`
              : ''}
          </div>
        </div>

        ${kstats.length > 0 ? `
          <div class="sdp-fp-stats">
            ${kstats.map(i => `
              <div class="sdp-fp-stat-item">
                <div class="sdp-fp-stat-lbl">${i.l}</div>
                <div class="sdp-fp-stat-val">${i.v}</div>
              </div>`).join('')}
          </div>` : `
          <div style="text-align:center;padding:24px 20px;color:var(--text-muted,#64748b)">
            <i class="fa-solid fa-triangle-exclamation"
               style="color:#f59e0b;font-size:20px;display:block;margin-bottom:8px"></i>
            <div style="font-size:13px;margin-bottom:10px">
              Financial data unavailable for <strong>${sym}</strong>
            </div>
            <button onclick="StockDetail._retryFinancials()"
                    style="padding:6px 16px;border-radius:8px;border:1px solid var(--border);
                           background:transparent;color:var(--accent-blue,#3b82f6);
                           font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">
              <i class="fa-solid fa-rotate"></i> Retry
            </button>
          </div>`}
      </div>`);

    // ── Post-render : toggle description ──────────────────
    const tog  = document.getElementById('sdp-desc-toggle');
    const para = document.getElementById('sdp-desc-p');
    if (tog && para) {
      let expanded = false;
      tog.addEventListener('click', () => {
        expanded = !expanded;
        para.style.webkitLineClamp = expanded ? 'unset' : '3';
        para.style.overflow        = expanded ? 'visible' : 'hidden';
        tog.innerHTML = expanded
          ? '<i class="fa-solid fa-chevron-up" style="font-size:9px"></i> Show less'
          : '<i class="fa-solid fa-chevron-down" style="font-size:9px"></i> Show more';
      });
    }

    // ── Post-render : mini chart + TA ─────────────────────
    setTimeout(() => _loadMiniChart('sdp-fp-chart-mini', sym, '1d', '1y', 180), 80);
    setTimeout(() => _appendTASection(sym), 150);
  }

  function _renderSignalBlock(signal) {
    const action  = (signal.action || '').toUpperCase();
    const conf    = parseFloat(signal.confidence || 0);
    const score   = parseFloat(signal.score || signal.meta_score || signal.final_score || conf || 0);

    // Buy prob : confidence si BUY, inverse si SELL
    const bp = action === 'BUY'  ? conf
             : action === 'SELL' ? Math.max(0, 1 - conf)
             : 0.5;

    // Council : depuis signal._council (injecté par _fetchAll) ou decision
    const dec     = _data[_sym]?.decision;
    let council   = signal._council || '';
    if (!council && dec) {
      council = dec.final_decision || (dec.decision === true ? 'CONFIRM'
              : dec.decision === false ? 'REJECT' : '');
    }

    // Regime depuis signal
    const regime  = (signal.regime_at_signal || signal.regime || '').replace(/_/g, ' ').toUpperCase();

    const ac = action === 'BUY'  ? '#10b981'
             : action === 'SELL' ? '#ef4444' : '#6b7280';
    const ai = action === 'BUY'  ? 'fa-arrow-up'
             : action === 'SELL' ? 'fa-arrow-down' : 'fa-minus';

    const councilColor = council === 'CONFIRM' ? '#10b981'
                       : council === 'REJECT'  ? '#ef4444'
                       : council === 'REDUCE'  ? '#f59e0b' : '#94a3b8';

    return `
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <span style="font-size:14px;font-weight:800;padding:6px 14px;border-radius:6px;
                     background:${ac}18;color:${ac};border:1px solid ${ac}35">
          <i class="fa-solid ${ai}" style="font-size:10px"></i> ${action || 'NEUTRAL'}
        </span>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;flex:1;min-width:200px">
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);
                        text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Score</div>
            <div style="font-size:14px;font-weight:800;font-family:var(--font-mono,monospace);
                        color:#3b82f6">${score.toFixed(3)}</div>
          </div>
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);
                        text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Confidence</div>
            <div style="font-size:14px;font-weight:800;font-family:var(--font-mono,monospace)">
              ${(conf * 100).toFixed(1)}%
            </div>
          </div>
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);
                        text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Buy Prob</div>
            <div style="font-size:14px;font-weight:800;font-family:var(--font-mono,monospace);
                        color:#10b981">${(bp * 100).toFixed(1)}%</div>
          </div>
          <div style="background:var(--bg-card,#fff);border:1px solid var(--border,rgba(0,0,0,0.08));
                      border-radius:7px;padding:7px 10px">
            <div style="font-size:9px;color:var(--text-muted,#64748b);
                        text-transform:uppercase;letter-spacing:0.4px;margin-bottom:2px">Council</div>
            <div style="font-size:12px;font-weight:800;color:${councilColor}">
              ${council || '—'}
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
            ${kstats.length >= 15
              ? '<span class="badge badge-green" style="font-size:10px"><i class="fa-solid fa-circle-check"></i> Full Data</span>'
              : kstats.length >= 6
              ? '<span class="badge badge-blue" style="font-size:10px"><i class="fa-solid fa-circle-half-stroke"></i> Partial</span>'
              : kstats.length >= 1
              ? '<span class="badge badge-orange" style="font-size:10px"><i class="fa-solid fa-triangle-exclamation"></i> Quote Data Only</span>'
              : '<span class="badge badge-red" style="font-size:10px"><i class="fa-solid fa-xmark"></i> No Data</span>'
            }
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

        <div class="sdp-ta-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
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
  // QUANTITATIVE FINANCE LIBRARY — _QF
  // ════════════════════════════════════════════════════════
  const _QF = {

    simpleReturns: prices => {
      const r = [];
      for (let i = 1; i < prices.length; i++)
        r.push((prices[i] - prices[i-1]) / prices[i-1]);
      return r;
    },

    logReturns: prices => {
      const r = [];
      for (let i = 1; i < prices.length; i++)
        r.push(Math.log(prices[i] / prices[i-1]));
      return r;
    },

    normCDF: x => {
      const a1=0.254829592,a2=-0.284496736,a3=1.421413741,
            a4=-1.453152027,a5=1.061405429,p=0.3275911;
      const sign = x < 0 ? -1 : 1;
      const t    = 1 / (1 + p * Math.abs(x));
      const y    = 1-(((((a5*t+a4)*t)+a3)*t+a2)*t+a1)*t*Math.exp(-x*x/2);
      return 0.5 * (1 + sign * y);
    },

    normPDF: x => Math.exp(-0.5*x*x) / Math.sqrt(2*Math.PI),

    pct: (arr, p) => {
      if (!arr || arr.length === 0) return null;
      const sorted = [...arr].sort((a,b) => a-b);
      const idx    = (p/100) * (sorted.length-1);
      const lo = Math.floor(idx), hi = Math.ceil(idx);
      return sorted[lo] + (sorted[hi]-sorted[lo]) * (idx-lo);
    },

    _mean: arr => arr.reduce((a,b) => a+b, 0) / arr.length,

    _std: (arr, mu) => {
      const m = mu ?? arr.reduce((a,b)=>a+b,0)/arr.length;
      return Math.sqrt(arr.reduce((a,b)=>a+(b-m)**2,0)/arr.length);
    },

    _randNorm: () => {
      let u=0,v=0;
      while(u===0) u=Math.random();
      while(v===0) v=Math.random();
      return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);
    },

    // ── Risk Metrics ─────────────────────────────────────
    riskMetrics: (prices, returns) => {
      const n   = returns.length;
      const mu  = _QF._mean(returns);
      const sig = _QF._std(returns, mu);
      const annVol  = sig * Math.sqrt(252);
      const years   = n / 252;
      const totRet  = (prices[prices.length-1] - prices[0]) / prices[0];
      const annRet  = years > 0 ? Math.pow(1+totRet, 1/years)-1 : totRet;

      // Period volatilities
      const pVol = d => {
        if (returns.length < d) return null;
        const sl = returns.slice(-d);
        return _QF._std(sl, _QF._mean(sl)) * Math.sqrt(252);
      };

      // VaR / CVaR
      const sorted = [...returns].sort((a,b)=>a-b);
      const varH95  = _QF.pct(returns, 5);
      const varH99  = _QF.pct(returns, 1);
      const varP95  = -(mu - 1.645*sig);
      const n95     = Math.max(1, Math.floor(n*0.05));
      const n99     = Math.max(1, Math.floor(n*0.01));
      const cvar95  = sorted.slice(0,n95).reduce((a,b)=>a+b,0)/n95;
      const cvar99  = sorted.slice(0,n99).reduce((a,b)=>a+b,0)/n99;

      // Max Drawdown
      let peak=prices[0], maxDD=0, ddDays=0, ddStart=0, tmpStart=0;
      for (let i=1;i<prices.length;i++) {
        if (prices[i]>peak) { peak=prices[i]; tmpStart=i; }
        const dd=(prices[i]-peak)/peak;
        if (dd<maxDD) { maxDD=dd; ddDays=i-tmpStart; }
      }

      return {
        annRet, annVol, volFull: annVol,
        vol1m: pVol(21), vol3m: pVol(63),
        vol6m: pVol(126), vol1y: pVol(252),
        varH95, varH99, varP95, cvar95, cvar99,
        maxDD, ddDays,
      };
    },

    // ── Performance Ratios ───────────────────────────────
    performance: (prices, returns) => {
      const n      = returns.length;
      const mu     = _QF._mean(returns);
      const sig    = _QF._std(returns, mu);
      const annVol = sig * Math.sqrt(252);
      const years  = n/252;
      const totRet = (prices[prices.length-1]-prices[0])/prices[0];
      const annRet = years > 0 ? Math.pow(1+totRet,1/years)-1 : totRet;
      const rf     = 0.0525;
      const sharpe = annVol>0 ? (annRet-rf)/annVol : null;

      const downRet = returns.filter(r=>r<0);
      const downDev = downRet.length>0
        ? Math.sqrt(downRet.reduce((a,b)=>a+b*b,0)/downRet.length)*Math.sqrt(252)
        : annVol;
      const sortino = downDev>0 ? (annRet-rf)/downDev : null;

      let peak2=prices[0], mdd2=0;
      for (let i=1;i<prices.length;i++) {
        if(prices[i]>peak2) peak2=prices[i];
        const dd=(prices[i]-peak2)/peak2;
        if(dd<mdd2) mdd2=dd;
      }
      const calmar = mdd2<0 ? annRet/Math.abs(mdd2) : null;

      const gains  = returns.filter(r=>r>0).reduce((a,b)=>a+b,0);
      const losses = Math.abs(returns.filter(r=>r<0).reduce((a,b)=>a+b,0));
      const omega  = losses>0 ? gains/losses : gains>0 ? 999 : 1;

      const hitRate = returns.filter(r=>r>0).length/n;
      const posRet  = returns.filter(r=>r>0);
      const negRet  = returns.filter(r=>r<0);
      const avgGain = posRet.length ? posRet.reduce((a,b)=>a+b,0)/posRet.length*100 : 0;
      const avgLoss = negRet.length ? Math.abs(negRet.reduce((a,b)=>a+b,0)/negRet.length)*100 : 0;

      let num=0,den=0;
      for(let i=1;i<n;i++) num+=(returns[i]-mu)*(returns[i-1]-mu);
      for(let i=0;i<n;i++) den+=(returns[i]-mu)**2;
      const autocorr1 = den>0?num/den:0;

      return { sharpe, sortino, calmar, omega, annVol, hitRate, avgGain, avgLoss, autocorr1 };
    },

    // ── Statistics ───────────────────────────────────────
    statistics: returns => {
      const n = returns.length;
      if (n<4) return {sk:0,ku:0,jb:0,normal:true,ac1:0,ac5:0,ac21:0};
      const mu  = _QF._mean(returns);
      const sig = _QF._std(returns, mu);
      const sk  = returns.reduce((a,b)=>a+((b-mu)/sig)**3,0)/n;
      const ku  = returns.reduce((a,b)=>a+((b-mu)/sig)**4,0)/n - 3;
      const jb  = n/6*(sk**2 + ku**2/4);
      const acf = lag => {
        let num=0,den=0;
        for(let i=lag;i<n;i++) num+=(returns[i]-mu)*(returns[i-lag]-mu);
        for(let i=0;i<n;i++) den+=(returns[i]-mu)**2;
        return den>0?num/den:0;
      };
      return { sk, ku, jb, normal: jb<5.991, ac1:acf(1), ac5:acf(5), ac21:acf(21) };
    },

    // ── Hurst Exponent (R/S) ─────────────────────────────
    hurst: prices => {
      if (prices.length<20) return 0.5;
      const logP = prices.map(p=>Math.log(p));
      const n    = logP.length;
      const res  = [];
      for (const size of [8,16,32,64,128].filter(s=>s<n/2)) {
        const chunks = Math.floor(n/size);
        let RSsum=0, cnt=0;
        for (let c=0;c<chunks;c++) {
          const chunk = logP.slice(c*size,(c+1)*size);
          const m     = _QF._mean(chunk);
          const cumDev = chunk.map((_,i)=>chunk.slice(0,i+1).reduce((a,b)=>a+(b-m),0));
          const R = Math.max(...cumDev)-Math.min(...cumDev);
          const S = _QF._std(chunk,m);
          if(S>0){RSsum+=R/S;cnt++;}
        }
        if(cnt>0) res.push([Math.log(size),Math.log(RSsum/cnt)]);
      }
      if(res.length<2) return 0.5;
      const sx=_QF._mean(res.map(([x])=>x));
      const sy=_QF._mean(res.map(([,y])=>y));
      let num=0,den=0;
      for(const [x,y] of res){num+=(x-sx)*(y-sy);den+=(x-sx)**2;}
      return Math.min(Math.max(den>0?num/den:0.5, 0.1), 0.9);
    },

    // ── Ornstein-Uhlenbeck Calibration ───────────────────
    ornsteinUhlenbeck: prices => {
      if (prices.length<30) return null;
      const x  = prices.slice(0,-1);
      const y  = prices.slice(1);
      const mx = _QF._mean(x), my = _QF._mean(y);
      let cov=0,varX=0;
      for(let i=0;i<x.length;i++){cov+=(x[i]-mx)*(y[i]-my);varX+=(x[i]-mx)**2;}
      const b     = varX>0?cov/varX:0;
      const a     = my-b*mx;
      const kappa = -Math.log(Math.max(b,1e-10))*252;
      const theta = (1-b)>1e-10 ? a/(1-b) : mx;
      const resid = y.map((yi,i)=>yi-(a+b*x[i]));
      const sigma = _QF._std(resid,0)*Math.sqrt(252);
      const halfLife = Math.log(2)/Math.max(kappa,0.001)*252;
      const lastP  = prices[prices.length-1];
      const zScore = sigma>0 ? (lastP-theta)/(sigma/Math.sqrt(Math.max(kappa,0.001)*252)) : 0;
      return { kappa, theta, sigma, halfLife, zScore };
    },

    // ── Momentum ─────────────────────────────────────────
    momentum: prices => {
      const last = prices[prices.length-1];
      const ret  = d => {
        if(prices.length<=d) return null;
        const s = prices[prices.length-1-d];
        return s>0?(last/s-1)*100:null;
      };
      const m12m = ret(252), m1m = ret(21);
      const end12  = prices[Math.max(0,prices.length-1-21)];
      const sta12  = prices[Math.max(0,prices.length-1-252)];
      const jt = sta12>0&&end12>0?(end12/sta12-1)*100:null;
      return { m1m, m3m:ret(63), m6m:ret(126), m12m, jt };
    },

    // ── Black-Scholes Option Chain ────────────────────────
    blackScholesAll: (S, vol) => {
      const r       = 0.0525;
      const strikes = [-0.15,-0.10,-0.05,0,0.05,0.10,0.15].map(d=>Math.round(S*(1+d)));
      const expiries = [
        {label:'1M',T:30/365},{label:'3M',T:90/365},
        {label:'6M',T:180/365},{label:'1Y',T:365/365},
      ];
      const NC=_QF.normCDF, NP=_QF.normPDF;
      return expiries.map(({label,T})=>({
        label, T,
        rows: strikes.map(K=>{
          if(T<=0||vol<=0||S<=0||K<=0) return null;
          const d1=(Math.log(S/K)+(r+0.5*vol**2)*T)/(vol*Math.sqrt(T));
          const d2=d1-vol*Math.sqrt(T);
          const eRT=Math.exp(-r*T), nd1=NP(d1);
          return {
            K,
            moneyness: ((K-S)/S*100).toFixed(1),
            call:      S*NC(d1)-K*eRT*NC(d2),
            put:       K*eRT*NC(-d2)-S*NC(-d1),
            delta_c:   NC(d1),
            delta_p:   NC(d1)-1,
            gamma:     nd1/(S*vol*Math.sqrt(T)),
            theta_c:   (-S*nd1*vol/(2*Math.sqrt(T))-r*K*eRT*NC(d2))/365,
            vega:      S*nd1*Math.sqrt(T)/100,
          };
        }).filter(Boolean),
      }));
    },

    // ── Monte Carlo GBM ──────────────────────────────────
    monteCarlo: (S0, mu, sigma, days, paths) => {
      const dt      = 1/252;
      const sampled = [0,21,63,126,189,252].filter(d=>d<=days);
      const bands   = [5,25,50,75,95].map(p=>({p,vals:[]}));
      const allFinal = [];

      const allPaths = Array.from({length:paths},()=>{
        let price=S0;
        const path=[S0];
        for(let d=1;d<=days;d++){
          price*=Math.exp((mu-0.5*sigma**2)*dt+sigma*Math.sqrt(dt)*_QF._randNorm());
          if(sampled.includes(d)) path.push(price);
        }
        allFinal.push(price);
        return path;
      });

      sampled.forEach((_,idx)=>{
        const vals=allPaths.map(p=>p[idx]??S0);
        bands.forEach(band=>band.vals.push(_QF.pct(vals,band.p)));
      });

      const targets=[0.8,0.9,1.0,1.1,1.2,1.3].map(mult=>{
        const price=(S0*mult).toFixed(0);
        const probUp=((allFinal.filter(f=>f>=parseFloat(price)).length/paths)*100).toFixed(1);
        return {price,probUp};
      });

      return {bands,daysSampled:sampled,targets};
    },

    // ── Histogram ────────────────────────────────────────
    histogram: (returns, bins) => {
      if(!returns.length) return {bins:[],mu:0,sg:0};
      const mu  = _QF._mean(returns);
      const sg  = _QF._std(returns,mu);
      const min = Math.min(...returns), max = Math.max(...returns);
      const w   = (max-min)/bins;
      const counts = Array(bins).fill(0);
      returns.forEach(r=>{
        const idx=Math.min(bins-1,Math.floor((r-min)/w));
        if(idx>=0) counts[idx]++;
      });
      return {
        bins: Array.from({length:bins},(_,i)=>({
          x:    min+(i+0.5)*w,
          y:    counts[i],
          y_density: counts[i]/(returns.length*w),
        })),
        mu, sg,
      };
    },
  };

  // ════════════════════════════════════════════════════════
  // QUANT TAB — TradingView + Quantitative Analytics
  // ════════════════════════════════════════════════════════

  function _tvExchange(ex) {
    ex=(ex||'').toLowerCase();
    if(ex.includes('nasdaq'))                        return 'NASDAQ';
    if(ex.includes('nyse')||ex.includes('new york')) return 'NYSE';
    if(ex.includes('amex')||ex.includes('american')) return 'AMEX';
    if(ex.includes('bats')||ex.includes('cboe'))     return 'CBOE';
    if(ex.includes('tsx')||ex.includes('toronto'))   return 'TSX';
    if(ex.includes('lse')||ex.includes('london'))    return 'LSE';
    return '';
  }

  async function _loadTVWidget(containerId, sym, exchange) {
    const ex   = _tvExchange(exchange);
    const tvSym = ex ? `${ex}:${sym}` : sym;
    const dark  = document.documentElement.getAttribute('data-theme') === 'dark';

    if (!window.TradingView) {
      await new Promise(res => {
        const s  = document.createElement('script');
        s.src    = 'https://s3.tradingview.com/tv.js';
        s.onload = res; s.onerror = res;
        document.head.appendChild(s);
      });
    }

    const el = document.getElementById(containerId);
    if (!el) return;

    if (!window.TradingView) {
      el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;
        height:100%;gap:8px;color:var(--text-muted,#64748b);font-size:12px">
        <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b"></i>
        TradingView unavailable
      </div>`;
      return;
    }

    try {
      new TradingView.widget({
        autosize:            true,
        symbol:              tvSym,
        interval:            'D',
        timezone:            'America/New_York',
        theme:               dark ? 'dark' : 'light',
        style:               '1',
        locale:              'en',
        toolbar_bg:          dark ? '#1e293b' : '#f8fafc',
        enable_publishing:   false,
        allow_symbol_change: false,
        save_image:          true,
        container_id:        containerId,
        studies: ['RSI@tv-basicstudies','MACD@tv-basicstudies','BB@tv-basicstudies'],
        withdateranges:      true,
        hide_side_toolbar:   false,
      });
    } catch(e) {
      console.warn('[SDP] TradingView:', e.message);
    }
  }

  // ── Render Quant Tab ─────────────────────────────────────
  async function _renderQuant() {
    const sym  = _sym;
    const q    = _data[sym]?.quote || {};
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';

    _bodyHtml(`
      <!-- TradingView -->
      <div class="sdp-fp-stat-section" style="padding:0;overflow:hidden;border-radius:12px">
        <div class="sdp-fp-stat-title"
             style="padding:14px 20px;margin-bottom:0;
                    border-bottom:1px solid var(--border,rgba(0,0,0,0.08))">
          <i class="fa-solid fa-chart-candlestick" style="color:#3b82f6"></i>
          TradingView Advanced Chart
          <span style="margin-left:auto;font-size:10px;font-weight:400;color:var(--text-muted)">
            RSI · MACD · Bollinger Bands
          </span>
        </div>
        <div class="sdp-tv-container" id="sdp-tv-widget"></div>
      </div>

      <div id="sdp-q-loading"
           style="text-align:center;padding:40px 20px;color:var(--text-muted,#64748b)">
        <i class="fa-solid fa-circle-notch fa-spin"
           style="color:#3b82f6;font-size:24px;display:block;margin-bottom:14px"></i>
        <div style="font-size:13px;font-weight:600">
          Computing quantitative analytics for
          <span style="color:#3b82f6">${sym}</span>
        </div>
        <div style="font-size:11px;margin-top:6px;opacity:0.7">
          Monte Carlo GBM · Black-Scholes Greeks · Hurst Exponent ·
          Ornstein-Uhlenbeck · VaR/CVaR · Risk-Adjusted Performance
        </div>
      </div>

      <div id="sdp-q-content" style="display:none;flex-direction:column;gap:16px"></div>
    `);

    _loadTVWidget('sdp-tv-widget', sym, q.exchange || '');

    const candles = await YahooFinance.getChart(sym, '1d', '2y');
    const loadEl  = document.getElementById('sdp-q-loading');
    const contEl  = document.getElementById('sdp-q-content');
    if (!contEl) return;

    if (!candles || candles.length < 60) {
      if (loadEl) loadEl.innerHTML = `
        <i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;font-size:20px"></i>
        <div style="margin-top:8px;font-size:13px">
          Insufficient data (need 60+ daily bars)
        </div>`;
      return;
    }

    const prices  = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const returns = _QF.simpleReturns(prices);
    const logRet  = _QF.logReturns(prices);
    const S       = prices[prices.length - 1];

    const risk  = _QF.riskMetrics(prices, returns);
    const perf  = _QF.performance(prices, returns);
    const stats = _QF.statistics(returns);
    const H     = _QF.hurst(prices);
    const ou    = _QF.ornsteinUhlenbeck(prices);
    const mom   = _QF.momentum(prices);
    const bs    = _QF.blackScholesAll(S, risk.volFull);
    const mc    = _QF.monteCarlo(S, risk.annRet, risk.volFull, 252, 400);
    const hist  = _QF.histogram(returns, 35);

    if (loadEl) loadEl.style.display = 'none';
    contEl.style.display = 'flex';

    const fP  = (v,d=2) => v!=null&&!isNaN(v)?`${v>=0?'+':''}${(v*100).toFixed(d)}%`:'—';
    const fR  = (v,d=3) => v!=null&&!isNaN(v)?v.toFixed(d):'—';
    const fC  = v       => v!=null&&!isNaN(v)?`$${Math.abs(v).toFixed(2)}`:'—';
    const clr = (v,inv=false) => {
      if(v==null||isNaN(v)) return 'var(--text-muted)';
      return (inv?v<0:v>0)?'#10b981':'#ef4444';
    };

    const hLabel = H>0.6 ? {txt:'Trending (persistent)',c:'#10b981'}
                 : H<0.4 ? {txt:'Mean-reverting (anti-persistent)',c:'#8b5cf6'}
                 :          {txt:'Random Walk (efficient)',c:'#6b7280'};
    const hPct = Math.min(95, Math.max(5, Math.round(H*100)));

    contEl.innerHTML = `

      <!-- ── ROW 1 : Risk + Performance + Statistics ── -->
      <div class="sdp-q-grid-3">

        <!-- Risk -->
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-shield-halved" style="color:#ef4444"></i>
            Risk Analytics
          </div>
          <div style="margin-bottom:10px">
            <div style="font-size:9px;font-weight:700;color:var(--text-muted);
                        text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
              Historical Volatility (annualized)
            </div>
            ${[['1M',risk.vol1m],['3M',risk.vol3m],['6M',risk.vol6m],['1Y',risk.vol1y]]
              .map(([l,v])=>`
              <div class="sdp-q-metric">
                <span class="sdp-q-lbl">σ ${l}</span>
                <span class="sdp-q-val"
                      style="color:${v?v>0.4?'#ef4444':v>0.25?'#f59e0b':'#10b981':'var(--text-muted)'}">
                  ${v?`${(v*100).toFixed(1)}%`:'—'}
                </span>
              </div>`).join('')}
          </div>
          <div style="font-size:9px;font-weight:700;color:var(--text-muted);
                      text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
            Value at Risk (1-day)
          </div>
          ${[
            ['VaR 95% Hist.', risk.varH95,true],
            ['VaR 99% Hist.', risk.varH99,true],
            ['VaR 95% Param.',risk.varP95,true],
            ['CVaR 95%',      risk.cvar95,true],
            ['CVaR 99%',      risk.cvar99,true],
          ].map(([l,v,inv])=>`
            <div class="sdp-q-metric">
              <span class="sdp-q-lbl">${l}</span>
              <span class="sdp-q-val" style="color:${clr(v,inv)}">${fP(v)}</span>
            </div>`).join('')}
          <div class="sdp-q-metric" style="margin-top:8px">
            <span class="sdp-q-lbl">Max Drawdown</span>
            <span class="sdp-q-val" style="color:#ef4444">${fP(risk.maxDD)}</span>
          </div>
          <div class="sdp-q-metric">
            <span class="sdp-q-lbl">DD Duration</span>
            <span class="sdp-q-val">${risk.ddDays} days</span>
          </div>
          <div class="sdp-q-metric">
            <span class="sdp-q-lbl">Ann. Return</span>
            <span class="sdp-q-val" style="color:${clr(risk.annRet)}">${fP(risk.annRet)}</span>
          </div>
        </div>

        <!-- Performance -->
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-trophy" style="color:#f59e0b"></i>
            Performance Analytics
            <span style="font-size:9px;font-weight:400;margin-left:auto;color:var(--text-muted)">
              Rf=5.25%
            </span>
          </div>
          ${[
            ['Sharpe Ratio', perf.sharpe,
              perf.sharpe>1.5?'Excellent':perf.sharpe>1?'Good':perf.sharpe>0.5?'Fair':'Poor',
              perf.sharpe>1?'#10b981':perf.sharpe>0.5?'#f59e0b':'#ef4444'],
            ['Sortino Ratio',perf.sortino,
              perf.sortino>2?'Excellent':perf.sortino>1?'Good':perf.sortino>0.5?'Fair':'Poor',
              perf.sortino>1?'#10b981':perf.sortino>0.5?'#f59e0b':'#ef4444'],
            ['Calmar Ratio', perf.calmar,
              perf.calmar>1?'Good':perf.calmar>0.5?'Fair':'Poor',
              perf.calmar>0.5?'#10b981':'#ef4444'],
            ['Omega Ratio',  perf.omega,
              perf.omega>2?'Excellent':perf.omega>1.5?'Good':'Fair',
              perf.omega>1.5?'#10b981':perf.omega>1?'#f59e0b':'#ef4444'],
          ].map(([lbl,v,txt,c])=>`
            <div class="sdp-q-metric">
              <span class="sdp-q-lbl">${lbl}</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:10px;padding:1px 6px;border-radius:4px;
                             background:${c}18;color:${c};font-weight:700">${txt}</span>
                <span class="sdp-q-val" style="color:${c}">${fR(v)}</span>
              </div>
            </div>`).join('')}
          <div style="height:1px;background:var(--border,rgba(0,0,0,0.06));margin:10px 0"></div>
          ${[
            ['Ann. Volatility', perf.annVol!=null?perf.annVol*100:null,'%'],
            ['Hit Rate',        perf.hitRate!=null?perf.hitRate*100:null,'%'],
            ['Avg Daily Gain',  perf.avgGain,  '%'],
            ['Avg Daily Loss',  perf.avgLoss,  '%'],
            ['Autocorr Lag-1',  perf.autocorr1,''],
          ].map(([lbl,v,sfx])=>`
            <div class="sdp-q-metric">
              <span class="sdp-q-lbl">${lbl}</span>
              <span class="sdp-q-val"
                    style="color:${lbl==='Avg Daily Loss'?'#ef4444':
                                   lbl==='Avg Daily Gain'?'#10b981':'var(--text-primary)'}">
                ${v!=null?`${v.toFixed(2)}${sfx}`:'—'}
              </span>
            </div>`).join('')}
        </div>

        <!-- Statistics -->
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-wave-square" style="color:#8b5cf6"></i>
            Statistical Properties
          </div>
          <div style="margin-bottom:14px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:11px;font-weight:700;color:var(--text-primary)">
                Hurst Exponent
              </span>
              <span style="font-size:13px;font-weight:900;
                           font-family:var(--font-mono);color:${hLabel.c}">
                ${H.toFixed(3)}
              </span>
            </div>
            <div class="sdp-hurst-bar">
              <div class="sdp-hurst-marker" style="left:${hPct}%"></div>
            </div>
            <div style="display:flex;justify-content:space-between;
                        font-size:9px;color:var(--text-muted);margin-top:4px">
              <span>Mean Rev.</span><span>Random</span><span>Trending</span>
            </div>
            <div style="text-align:center;font-size:10px;font-weight:700;
                        color:${hLabel.c};margin-top:4px">
              ${hLabel.txt}
            </div>
          </div>
          ${[
            ['Skewness',    stats.sk, stats.sk>0?'Right tail':'Left tail',
              Math.abs(stats.sk)>1?'#ef4444':'#6b7280'],
            ['Exc. Kurtosis',stats.ku,stats.ku>0?'Leptokurtic':'Platykurtic',
              stats.ku>3?'#ef4444':stats.ku>1?'#f59e0b':'#10b981'],
            ['Jarque-Bera', stats.jb,stats.normal?'Normal (p>5%)':'Non-normal (p<5%)',
              stats.normal?'#10b981':'#ef4444'],
          ].map(([lbl,v,txt,c])=>`
            <div class="sdp-q-metric">
              <span class="sdp-q-lbl">${lbl}</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-size:9px;padding:1px 5px;border-radius:3px;
                             background:${c}18;color:${c};font-weight:700">${txt}</span>
                <span class="sdp-q-val">${fR(v)}</span>
              </div>
            </div>`).join('')}
          <div style="font-size:9px;font-weight:700;color:var(--text-muted);
                      text-transform:uppercase;letter-spacing:0.5px;margin:10px 0 6px">
            Autocorrelation
          </div>
          ${[['Lag 1d',stats.ac1],['Lag 5d',stats.ac5],['Lag 21d',stats.ac21]]
            .map(([lbl,v])=>`
            <div class="sdp-q-metric">
              <span class="sdp-q-lbl">${lbl}</span>
              <div style="display:flex;align-items:center;gap:6px;flex:1;justify-content:flex-end">
                <div style="width:60px;height:5px;background:rgba(148,163,184,0.2);
                            border-radius:3px;overflow:hidden">
                  <div style="width:${Math.min(100,Math.abs(v||0)*300)}%;height:100%;
                              background:${Math.abs(v||0)>0.1?'#f59e0b':'#6b7280'};
                              border-radius:3px"></div>
                </div>
                <span class="sdp-q-val">${fR(v)}</span>
              </div>
            </div>`).join('')}
          <div class="sdp-q-metric" style="margin-top:8px">
            <span class="sdp-q-lbl">N observations</span>
            <span class="sdp-q-val">${returns.length}d</span>
          </div>
        </div>
      </div>

      <!-- ── ROW 2 : Mean Reversion + Momentum ── -->
      <div class="sdp-q-grid-2">

        <!-- Ornstein-Uhlenbeck -->
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-rotate" style="color:#8b5cf6"></i>
            Ornstein-Uhlenbeck Process
            <span style="font-size:9px;margin-left:4px;font-weight:400;color:var(--text-muted)">
              Mean Reversion
            </span>
          </div>
          ${ou ? `
            <div style="background:rgba(139,92,246,0.06);border:1px solid rgba(139,92,246,0.2);
                        border-radius:8px;padding:12px;margin-bottom:12px">
              <div style="font-size:11px;font-weight:700;color:#8b5cf6;margin-bottom:8px">
                dP = κ(θ−P)dt + σdW
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${[
                  ['κ (Speed)',   ou.kappa.toFixed(2)+'/yr','#3b82f6'],
                  ['θ (Mean)',   '$'+ou.theta.toFixed(2),   '#6b7280'],
                  ['Half-Life',  ou.halfLife.toFixed(1)+' days','#f59e0b'],
                  ['σ (Noise)',  '$'+ou.sigma.toFixed(3),   '#6b7280'],
                ].map(([l,v,c])=>`
                  <div style="background:var(--bg-card,#fff);border:1px solid var(--border);
                              border-radius:6px;padding:6px 10px">
                    <div style="font-size:9px;color:var(--text-muted);
                                font-weight:700;margin-bottom:2px">${l}</div>
                    <div style="font-size:14px;font-weight:800;
                                font-family:var(--font-mono);color:${c}">${v}</div>
                  </div>`).join('')}
              </div>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:6px">
                <span style="font-size:11px;font-weight:700;color:var(--text-primary)">
                  Z-Score vs Long-term Mean
                </span>
                <span style="font-size:14px;font-weight:900;font-family:var(--font-mono);
                             color:${Math.abs(ou.zScore)>2?'#ef4444':
                                    Math.abs(ou.zScore)>1?'#f59e0b':'#10b981'}">
                  ${ou.zScore.toFixed(2)}σ
                </span>
              </div>
              <div style="height:8px;background:linear-gradient(90deg,#ef4444,#f59e0b,#10b981,#f59e0b,#ef4444);
                          border-radius:4px;position:relative;margin-bottom:4px">
                <div style="position:absolute;top:-4px;width:16px;height:16px;border-radius:50%;
                            background:white;border:2px solid #3b82f6;
                            transform:translateX(-50%);box-shadow:0 2px 6px rgba(0,0,0,0.2);
                            left:${Math.min(95,Math.max(5,50+ou.zScore*12))}%"></div>
              </div>
              <div style="display:flex;justify-content:space-between;
                          font-size:9px;color:var(--text-muted)">
                <span>−3σ</span><span>−1σ</span><span>Mean</span><span>+1σ</span><span>+3σ</span>
              </div>
              <div style="margin-top:8px;font-size:11px;color:var(--text-muted);line-height:1.5">
                ${Math.abs(ou.zScore)>2
                  ? `<span style="color:#ef4444;font-weight:700">
                       ⚠ Strong ${ou.zScore>0?'overvalued':'undervalued'} signal
                     </span> — price ${Math.abs(ou.zScore).toFixed(1)}σ from $${ou.theta.toFixed(2)}`
                  : Math.abs(ou.zScore)>1
                  ? `<span style="color:#f59e0b;font-weight:700">
                       Mild ${ou.zScore>0?'overvalued':'undervalued'}
                     </span> — model suggests reversion toward $${ou.theta.toFixed(2)}`
                  : `<span style="color:#10b981;font-weight:700">Near fair value</span>
                     — price close to long-term mean $${ou.theta.toFixed(2)}`}
              </div>
            </div>
          ` : '<div style="color:var(--text-muted);font-size:12px">Insufficient data for OU calibration</div>'}
        </div>

        <!-- Momentum -->
        <div class="sdp-fp-stat-section">
          <div class="sdp-fp-stat-title">
            <i class="fa-solid fa-arrow-trend-up" style="color:#10b981"></i>
            Momentum Analysis
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:14px">
            ${[
              ['1 Month',   mom.m1m,   21],
              ['3 Months',  mom.m3m,   63],
              ['6 Months',  mom.m6m,  126],
              ['12 Months', mom.m12m, 252],
            ].map(([lbl,v])=>{
              const pctW = v!=null?Math.min(100,Math.abs(v)*3):0;
              const c    = v!=null?v>0?'#10b981':'#ef4444':'#6b7280';
              return `
              <div>
                <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                  <span style="font-size:11px;font-weight:600;color:var(--text-muted)">${lbl}</span>
                  <span style="font-size:12px;font-weight:800;
                               font-family:var(--font-mono);color:${c}">
                    ${v!=null?`${v>=0?'+':''}${v.toFixed(2)}%`:'—'}
                  </span>
                </div>
                <div style="height:6px;background:rgba(148,163,184,0.15);border-radius:3px;overflow:hidden">
                  <div style="width:${pctW}%;height:100%;background:${c};
                              border-radius:3px;transition:width 0.5s ease;
                              margin-left:${v!=null&&v<0?`${100-pctW}%`:'0'}"></div>
                </div>
              </div>`;
            }).join('')}
          </div>
          <div style="background:rgba(59,130,246,0.06);border:1px solid rgba(59,130,246,0.2);
                      border-radius:8px;padding:12px;margin-bottom:12px">
            <div style="font-size:10px;font-weight:700;color:#3b82f6;margin-bottom:4px">
              Jegadeesh-Titman (12-1 Month)
            </div>
            <div style="font-size:18px;font-weight:900;font-family:var(--font-mono);
                        color:${mom.jt!=null?mom.jt>0?'#10b981':'#ef4444':'#6b7280'}">
              ${mom.jt!=null?`${mom.jt>=0?'+':''}${mom.jt.toFixed(2)}%`:'—'}
            </div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">
              11-month return lagged 1 month — institutional momentum factor
            </div>
          </div>
          ${(()=>{
            const sc = [mom.m1m,mom.m3m,mom.m6m,mom.m12m].filter(v=>v!=null);
            const pos = sc.filter(v=>v>0).length;
            const tot = sc.length||1;
            const score = pos/tot;
            const label = score>=0.75?'Strong Bullish':score>=0.5?'Mild Bullish':
                          score<=0.25?'Strong Bearish':'Mixed / Neutral';
            const c = score>=0.5?'#10b981':'#ef4444';
            return `
              <div>
                <div style="font-size:10px;font-weight:700;color:var(--text-muted);
                            text-transform:uppercase;letter-spacing:0.4px;margin-bottom:6px">
                  Momentum Score
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  <div style="flex:1;height:8px;background:rgba(148,163,184,0.15);
                              border-radius:4px;overflow:hidden">
                    <div style="width:${score*100}%;height:100%;background:${c};border-radius:4px"></div>
                  </div>
                  <span style="font-size:11px;font-weight:700;color:${c};white-space:nowrap">
                    ${pos}/${tot} — ${label}
                  </span>
                </div>
              </div>`;
          })()}
        </div>
      </div>

      <!-- ── BLACK-SCHOLES ── -->
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-function" style="color:#3b82f6"></i>
          Black-Scholes Option Pricing
          <span style="font-size:9px;margin-left:4px;font-weight:400;color:var(--text-muted)">
            European · Continuous dividends=0
          </span>
          <div style="margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:400">
            Spot: <strong style="color:var(--text-primary)">${fC(S)}</strong> ·
            σ: <strong style="color:#3b82f6">${(risk.volFull*100).toFixed(1)}%</strong> ·
            Rf: <strong>5.25%</strong>
          </div>
        </div>

        <div class="sdp-bs-form" id="sdp-bs-form">
          <div>
            <label class="sdp-bs-label">Spot Price ($)</label>
            <input class="sdp-bs-input" id="sdp-bs-spot" type="number"
                   value="${S.toFixed(2)}" step="0.01" min="0.01">
          </div>
          <div>
            <label class="sdp-bs-label">Implied Vol (σ %)</label>
            <input class="sdp-bs-input" id="sdp-bs-vol" type="number"
                   value="${(risk.volFull*100).toFixed(1)}" step="0.5" min="1" max="500">
          </div>
          <div>
            <label class="sdp-bs-label">Risk-Free Rate (%)</label>
            <input class="sdp-bs-input" id="sdp-bs-rfr" type="number"
                   value="5.25" step="0.25" min="0" max="20">
          </div>
          <div>
            <label class="sdp-bs-label">Expiry (days)</label>
            <input class="sdp-bs-input" id="sdp-bs-expiry" type="number"
                   value="30" step="1" min="1" max="730">
          </div>
          <div>
            <label class="sdp-bs-label">Strike ($)</label>
            <input class="sdp-bs-input" id="sdp-bs-strike" type="number"
                   value="${Math.round(S)}" step="0.5" min="0.01">
          </div>
          <div style="display:flex;align-items:flex-end">
            <button id="sdp-bs-calc"
                    style="width:100%;height:36px;
                           background:linear-gradient(135deg,#3b82f6,#8b5cf6);
                           color:white;border:none;border-radius:8px;
                           font-weight:700;font-size:12px;cursor:pointer;
                           font-family:var(--font-sans,'Inter',sans-serif)">
              <i class="fa-solid fa-calculator"></i> Calculate
            </button>
          </div>
        </div>

        <div id="sdp-bs-results">
          ${_buildBSResults(S, risk.volFull, 0.0525, 30/365, Math.round(S))}
        </div>

        <!-- Option Chain -->
        <div style="margin-top:16px">
          <div style="font-size:11px;font-weight:700;color:var(--text-primary);margin-bottom:10px">
            <i class="fa-solid fa-table" style="color:#8b5cf6;margin-right:6px"></i>
            Option Chain — ATM ± 15% (Historical Vol)
          </div>
          ${bs.map(exp=>`
            <div style="margin-bottom:12px">
              <div style="font-size:10px;font-weight:700;color:#8b5cf6;margin-bottom:6px;
                          text-transform:uppercase;letter-spacing:0.5px">
                ${exp.label} (T=${exp.T.toFixed(4)}y)
              </div>
              <table class="sdp-bs-table">
                <thead>
                  <tr>
                    <th>Strike</th><th>Moneyness</th>
                    <th>Call</th><th>Put</th>
                    <th>Δ Call</th><th>Δ Put</th>
                    <th>Γ</th><th>Θ/day</th><th>Vega/1%</th>
                  </tr>
                </thead>
                <tbody>
                  ${exp.rows.map(row=>`
                    <tr style="${Math.abs(row.K-S)/S<0.01?
                        'background:rgba(59,130,246,0.08);font-weight:800':''}">
                      <td>${fC(row.K)}</td>
                      <td style="color:${parseFloat(row.moneyness)>0?'#10b981':'#ef4444'}">
                        ${row.moneyness}%
                      </td>
                      <td style="color:#10b981">${fC(row.call)}</td>
                      <td style="color:#ef4444">${fC(row.put)}</td>
                      <td>${row.delta_c.toFixed(3)}</td>
                      <td style="color:#ef4444">${row.delta_p.toFixed(3)}</td>
                      <td>${row.gamma.toFixed(5)}</td>
                      <td style="color:#ef4444">${row.theta_c.toFixed(4)}</td>
                      <td>${row.vega.toFixed(4)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>`).join('')}
        </div>

        <!-- Greeks -->
        <div style="margin-top:14px">
          <div style="font-size:11px;font-weight:700;color:var(--text-primary);margin-bottom:8px">
            <i class="fa-solid fa-atom" style="color:#3b82f6;margin-right:4px"></i>
            Greeks — ATM ${fC(Math.round(S))} · 1M
          </div>
          <div class="sdp-greeks-grid" id="sdp-greeks-grid">
            ${_buildGreeksHTML(S, risk.volFull, 0.0525, 30/365, Math.round(S))}
          </div>
        </div>
      </div>

      <!-- ── MONTE CARLO ── -->
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-dice" style="color:#3b82f6"></i>
          Monte Carlo Simulation — GBM (400 paths, 1Y horizon)
          <span style="margin-left:auto;font-size:9px;font-weight:400;color:var(--text-muted)">
            μ=${(risk.annRet*100).toFixed(1)}% · σ=${(risk.volFull*100).toFixed(1)}%
          </span>
        </div>
        <div class="sdp-mc-container">
          <canvas id="sdp-mc-canvas"></canvas>
        </div>
        <div class="sdp-mc-targets">
          ${mc.targets.map(t=>`
            <div style="background:var(--bg-primary,#f1f5f9);border-radius:8px;
                        padding:8px 10px;text-align:center">
              <div style="font-size:9px;color:var(--text-muted);font-weight:700;margin-bottom:2px">
                P(≥$${t.price})
              </div>
              <div style="font-size:14px;font-weight:900;font-family:var(--font-mono);
                          color:${parseFloat(t.probUp)>50?'#10b981':'#ef4444'}">
                ${t.probUp}%
              </div>
              <div style="font-size:9px;color:var(--text-muted);margin-top:1px">
                ${parseFloat(t.price)>S?'↑ target':'↓ floor'}
              </div>
            </div>`).join('')}
        </div>
        <div style="margin-top:10px;font-size:10px;color:var(--text-muted);line-height:1.6">
          <strong>GBM:</strong> dS = μS dt + σS dW —
          Percentile bands: P5 (dark red) · P25 (orange) · P50 median (blue) ·
          P75 (light green) · P95 (dark green)
        </div>
      </div>

      <!-- ── RETURN DISTRIBUTION ── -->
      <div class="sdp-fp-stat-section">
        <div class="sdp-fp-stat-title">
          <i class="fa-solid fa-chart-bar" style="color:#8b5cf6"></i>
          Daily Return Distribution
          <span style="margin-left:auto;font-size:9px;font-weight:400;color:var(--text-muted)">
            μ=${(hist.mu*100).toFixed(3)}% · σ=${(hist.sg*100).toFixed(3)}%
          </span>
        </div>
        <div class="sdp-rd-container">
          <canvas id="sdp-rd-canvas"></canvas>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">
          ${[
            ['Skewness',     stats.sk.toFixed(3), Math.abs(stats.sk)>0.5?'Asymmetric':'Near symmetric',
              Math.abs(stats.sk)>1?'#ef4444':Math.abs(stats.sk)>0.5?'#f59e0b':'#10b981'],
            ['Exc. Kurtosis',stats.ku.toFixed(3), stats.ku>0?'Fat tails (leptokurtic)':'Thin tails',
              stats.ku>3?'#ef4444':stats.ku>1?'#f59e0b':'#10b981'],
            ['Normality (JB)',stats.jb.toFixed(1), stats.normal?'H0: Normal':'H1: Non-normal',
              stats.normal?'#10b981':'#ef4444'],
            ['Best day',  `+${(_QF.pct(returns, 99) * 100).toFixed(2)}%`, 'P99', '#10b981'],
            ['Worst day', `${(_QF.pct(returns, 1)   * 100).toFixed(2)}%`, 'P01', '#ef4444'],
          ].map(([lbl, v, txt, c]) => `
            <div style="background:var(--bg-primary,#f1f5f9);border-radius:8px;padding:8px 10px">
              <div style="font-size:9px;color:var(--text-muted);font-weight:600;margin-bottom:2px">
                ${lbl}
              </div>
              <div style="font-size:13px;font-weight:900;font-family:var(--font-mono);color:${c}">
                ${v}
              </div>
              <div style="font-size:9px;color:${c};font-weight:700">${txt}</div>
            </div>`).join('')}
        </div>
      </div>
    `;  // ← fermeture de contEl.innerHTML

    // ── Monte Carlo Canvas ────────────────────────────────
    setTimeout(() => {
      const mcCanvas = document.getElementById('sdp-mc-canvas');
      if (!mcCanvas || typeof Chart === 'undefined') return;
      if (_sdCJ['sdp-mc']) { try { _sdCJ['sdp-mc'].destroy(); } catch(e) {} }

      const dayLabels   = mc.daysSampled.map(d => `${d}d`);
      const bandColors  = [
        'rgba(239,68,68,0.9)',
        'rgba(249,115,22,0.8)',
        'rgba(59,130,246,1)',
        'rgba(34,197,94,0.8)',
        'rgba(16,185,129,0.9)',
      ];
      const bandWidths  = [1.5, 1.5, 2.5, 1.5, 1.5];
      const tc = dark ? '#9db3d8' : '#64748b';
      const gc = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';

      _sdCJ['sdp-mc'] = new Chart(mcCanvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: dayLabels,
          datasets: mc.bands.map((band, i) => ({
            label:           `P${band.p}`,
            data:            band.vals,
            borderColor:     bandColors[i],
            backgroundColor: 'transparent',
            borderWidth:     bandWidths[i],
            pointRadius:     3,
            pointHoverRadius:5,
            tension:         0.35,
          })),
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: true, position: 'top',
                      labels: { boxWidth: 12, font: { size: 10 }, color: tc } },
            tooltip: {
              backgroundColor: dark ? '#0f172a' : '#fff', bodyColor: tc,
              borderColor: dark ? '#1e293b' : '#dde3f0', borderWidth: 1,
              callbacks: {
                label: ctx =>
                  ` P${mc.bands[ctx.datasetIndex].p}: $${(ctx.parsed.y ?? 0).toFixed(2)}`,
              },
            },
          },
          scales: {
            x: { ticks: { color: tc, font: { size: 9 } }, grid: { color: gc } },
            y: {
              ticks: { color: tc, font: { size: 9 },
                       callback: v => `$${parseFloat(v).toFixed(0)}` },
              grid: { color: gc },
            },
          },
        },
      });
    }, 120);

    // ── Return Distribution Canvas ────────────────────────
    setTimeout(() => {
      const rdCanvas = document.getElementById('sdp-rd-canvas');
      if (!rdCanvas || typeof Chart === 'undefined') return;
      if (_sdCJ['sdp-rd']) { try { _sdCJ['sdp-rd'].destroy(); } catch(e) {} }

      const tc = dark ? '#9db3d8' : '#64748b';
      const gc = dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)';

      const normalY = hist.bins.map(b => {
        const z = (b.x - hist.mu) / Math.max(hist.sg, 1e-10);
        return _QF.normPDF(z) / Math.max(hist.sg, 1e-10);
      });

      _sdCJ['sdp-rd'] = new Chart(rdCanvas.getContext('2d'), {
        type: 'bar',
        data: {
          labels: hist.bins.map(b => `${(b.x * 100).toFixed(2)}%`),
          datasets: [
            {
              type: 'bar', label: 'Observed',
              data: hist.bins.map(b => b.y_density),
              backgroundColor: hist.bins.map(b =>
                b.x < 0 ? 'rgba(239,68,68,0.55)' : 'rgba(16,185,129,0.55)'),
              borderWidth: 0, borderRadius: 2,
            },
            {
              type: 'line', label: 'Normal fit',
              data: normalY,
              borderColor: '#3b82f6', backgroundColor: 'transparent',
              borderWidth: 2, pointRadius: 0, tension: 0.4,
            },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false, animation: false,
          plugins: {
            legend: { display: true, position: 'top',
                      labels: { boxWidth: 12, font: { size: 10 }, color: tc } },
            tooltip: {
              backgroundColor: dark ? '#0f172a' : '#fff', bodyColor: tc,
              borderColor: dark ? '#1e293b' : '#dde3f0', borderWidth: 1,
            },
          },
          scales: {
            x: { ticks: { color: tc, font: { size: 8 }, maxTicksLimit: 10 },
                 grid: { display: false } },
            y: { ticks: { color: tc, font: { size: 9 } }, grid: { color: gc } },
          },
        },
      });
    }, 160);

    // ── Black-Scholes Calculator binding ──────────────────
    setTimeout(() => {
      document.getElementById('sdp-bs-calc')?.addEventListener('click', () => {
        const spot   = parseFloat(document.getElementById('sdp-bs-spot')?.value   || S);
        const volPct = parseFloat(document.getElementById('sdp-bs-vol')?.value    || risk.volFull * 100);
        const rfrPct = parseFloat(document.getElementById('sdp-bs-rfr')?.value    || 5.25);
        const days   = parseFloat(document.getElementById('sdp-bs-expiry')?.value || 30);
        const strike = parseFloat(document.getElementById('sdp-bs-strike')?.value || Math.round(S));
        const vol    = volPct / 100;
        const r      = rfrPct / 100;
        const T      = days / 365;

        const resEl  = document.getElementById('sdp-bs-results');
        const grkEl  = document.getElementById('sdp-greeks-grid');
        if (resEl) resEl.innerHTML = _buildBSResults(spot, vol, r, T, strike);
        if (grkEl) grkEl.innerHTML = _buildGreeksHTML(spot, vol, r, T, strike);
      });
    }, 200);
  }

  // ══════════════════════════════════════════════════════
  // BS RESULTS BUILDER
  // ══════════════════════════════════════════════════════
  function _buildBSResults(S, vol, r, T, K) {
    if (T <= 0 || vol <= 0 || S <= 0 || K <= 0)
      return '<div style="color:#f59e0b;font-size:12px;padding:10px">Invalid parameters</div>';

    const NC  = _QF.normCDF;
    const NP  = _QF.normPDF;
    const sqT = Math.sqrt(T);
    const d1  = (Math.log(S / K) + (r + 0.5 * vol ** 2) * T) / (vol * sqT);
    const d2  = d1 - vol * sqT;
    const eRT = Math.exp(-r * T);

    const call = S * NC(d1) - K * eRT * NC(d2);
    const put  = K * eRT * NC(-d2) - S * NC(-d1);

    return `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:12px">
        <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.3);
                    border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:10px;font-weight:700;color:#10b981;margin-bottom:6px;
                      text-transform:uppercase;letter-spacing:0.5px">
            <i class="fa-solid fa-arrow-up"></i> Call Option
          </div>
          <div style="font-size:30px;font-weight:900;font-family:var(--font-mono);color:#10b981">
            $${call.toFixed(3)}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
            Δ = ${NC(d1).toFixed(4)} · Intrinsic = $${Math.max(0, S - K).toFixed(2)}
          </div>
        </div>
        <div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.3);
                    border-radius:10px;padding:16px;text-align:center">
          <div style="font-size:10px;font-weight:700;color:#ef4444;margin-bottom:6px;
                      text-transform:uppercase;letter-spacing:0.5px">
            <i class="fa-solid fa-arrow-down"></i> Put Option
          </div>
          <div style="font-size:30px;font-weight:900;font-family:var(--font-mono);color:#ef4444">
            $${put.toFixed(3)}
          </div>
          <div style="font-size:10px;color:var(--text-muted);margin-top:4px">
            Δ = ${(NC(d1) - 1).toFixed(4)} · Intrinsic = $${Math.max(0, K - S).toFixed(2)}
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px">
        ${[
          ['d₁', d1.toFixed(4),    '#3b82f6'],
          ['d₂', d2.toFixed(4),    '#8b5cf6'],
          ['N(d₁)', NC(d1).toFixed(4),'#10b981'],
          ['N(d₂)', NC(d2).toFixed(4),'#6b7280'],
        ].map(([l, v, c]) => `
          <div style="background:var(--bg-primary,#f1f5f9);border-radius:7px;
                      padding:6px 8px;text-align:center">
            <div style="font-size:9px;color:var(--text-muted);margin-bottom:2px">${l}</div>
            <div style="font-size:11px;font-weight:800;font-family:var(--font-mono);
                        color:${c}">${v}</div>
          </div>`).join('')}
      </div>`;
  }

  // ══════════════════════════════════════════════════════
  // GREEKS BUILDER
  // ══════════════════════════════════════════════════════
  function _buildGreeksHTML(S, vol, r, T, K) {
    if (T <= 0 || vol <= 0 || S <= 0 || K <= 0) return '';

    const NC  = _QF.normCDF;
    const NP  = _QF.normPDF;
    const sqT = Math.sqrt(T);
    const d1  = (Math.log(S / K) + (r + 0.5 * vol ** 2) * T) / (vol * sqT);
    const d2  = d1 - vol * sqT;
    const eRT = Math.exp(-r * T);
    const nd1 = NP(d1);

    const delta_c =  NC(d1);
    const delta_p =  NC(d1) - 1;
    const gamma   =  nd1 / (S * vol * sqT);
    const theta_c = (-S * nd1 * vol / (2 * sqT) - r * K * eRT * NC(d2))  / 365;
    const theta_p = (-S * nd1 * vol / (2 * sqT) + r * K * eRT * NC(-d2)) / 365;
    const vega    =  S * nd1 * sqT / 100;
    const rho_c   =  K * T * eRT * NC(d2)  / 100;
    const rho_p   = -K * T * eRT * NC(-d2) / 100;

    return [
      { n:'Δ Delta Call',  v:delta_c, d:'Change per $1 spot',     c:'#10b981', i:'fa-arrow-up'       },
      { n:'Δ Delta Put',   v:delta_p, d:'Change per $1 spot',     c:'#ef4444', i:'fa-arrow-down'     },
      { n:'Γ Gamma',       v:gamma,   d:'Δ change per $1 spot',   c:'#3b82f6', i:'fa-arrows-up-down' },
      { n:'Θ Theta Call',  v:theta_c, d:'Time decay per day ($)', c:'#f59e0b', i:'fa-clock'          },
      { n:'Θ Theta Put',   v:theta_p, d:'Time decay per day ($)', c:'#f59e0b', i:'fa-clock'          },
      { n:'V Vega',        v:vega,    d:'Change per 1% vol',      c:'#8b5cf6', i:'fa-wave-square'    },
      { n:'ρ Rho Call',    v:rho_c,   d:'Change per 1% rate',     c:'#06b6d4', i:'fa-percent'        },
      { n:'ρ Rho Put',     v:rho_p,   d:'Change per 1% rate',     c:'#06b6d4', i:'fa-percent'        },
    ].map(g => `
      <div style="background:var(--bg-primary,#f1f5f9);border-radius:8px;padding:10px 12px">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
          <i class="fa-solid ${g.i}" style="color:${g.c};font-size:9px"></i>
          <span style="font-size:10px;font-weight:700;color:${g.c}">${g.n}</span>
        </div>
        <div style="font-size:17px;font-weight:900;font-family:var(--font-mono);
                    color:var(--text-primary)">${g.v.toFixed(4)}</div>
        <div style="font-size:9px;color:var(--text-muted);margin-top:2px">${g.d}</div>
      </div>`).join('');
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
    // 1. Priorité : données chargées dans _fetchAll()
    if (_data[sym] && _data[sym].signal !== undefined) {
      return _data[sym].signal;
    }

    // 2. Fallback : cache AVApi
    if (typeof AVApi !== 'undefined') {
      const cached = AVApi.getCached('signals');
      if (cached?.signals) {
        if (Array.isArray(cached.signals)) {
          return cached.signals.find(s => s.symbol === sym) || null;
        }
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

  // ── Safe value picker — Yahoo .raw wrapper + fallbacks (null/0 ignorés) ──
  // Utilisé par _renderOverview ET _renderFinancialsEarnings
  function _rv(y, ...fb) {
    const v = y?.raw ?? y;
    if (v != null && !isNaN(parseFloat(v)) && v !== 0) return v;
    for (const f of fb) {
      const fv = f?.raw ?? f;
      if (fv != null && !isNaN(parseFloat(fv)) && fv !== 0) return fv;
    }
    return null;
  }

  // ── Safe number depuis plusieurs sources (skip NaN/0) ────────────────────
  // Utilisé par _renderFinancialsEarnings
  function _n(...vals) {
    for (const v of vals) {
      const n = parseFloat(v?.raw ?? v);
      if (!isNaN(n) && n !== 0) return n;
    }
    return null;
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