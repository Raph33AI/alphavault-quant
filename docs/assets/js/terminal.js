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
  const WORKER_URL   = 'https://alphavault-gh-proxy.raphnardone.workers.dev';
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

  // ════════════════════════════════════════════════════════
    // LOGO FALLBACK — Fonction globale (évite les problèmes
    // d'échappement dans l'attribut onerror HTML)
    // ════════════════════════════════════════════════════════
    window._logoFallback = function(el, sym, size) {
    if (!el || !el.parentNode) return;
    const span        = document.createElement('span');
    span.className    = 'sym-initial-badge';
    span.style.width  = size + 'px';
    span.style.height = size + 'px';
    span.style.fontSize = Math.max(7, Math.floor(size * 0.42)) + 'px';
    span.style.borderRadius = '3px';
    span.title        = sym;
    // ETF badge → 2-3 lettres, stock → 1 lettre
    span.textContent  = sym.length <= 3 ? sym : sym.charAt(0);
    el.parentNode.replaceChild(span, el);
    };

    // ════════════════════════════════════════════════════════
    // LOGO HELPER — Logo.dev (supporte les tickers US)
    // ════════════════════════════════════════════════════════
    const ETF_SYMBOLS = new Set([
    'SPY','QQQ','IWM','DIA','VTI','VOO','IVV','EFA','EEM','GLD','SLV',
    'TLT','HYG','LQD','VNQ','XLF','XLK','XLE','XLV','XLI','XLP','XLU',
    'XLRE','XLC','XLB','XLY','XBI','IBB','SMH','SOXX','ARKK','ARKG',
    'SOXL','TQQQ','SPXL','SQQQ','SH','BITO','BND','AGG','BNDX',
    ]);

    const ETF_COLORS = {
    SPY:'#c0392b', QQQ:'#1a56db', IWM:'#047857', DIA:'#92400e',
    GLD:'#d97706', SLV:'#64748b', TLT:'#7c3aed', HYG:'#db2777',
    VTI:'#0891b2', XLF:'#1e40af', XLK:'#6d28d9', XLE:'#065f46',
    XLV:'#be123c', XLI:'#b45309', ARKK:'#7c3aed', TQQQ:'#1a56db',
    SOXL:'#0f766e', SMH:'#0369a1', SOXX:'#4f46e5', default:'#3b82f6',
    };

    function _getLogoHtml(sym, size) {
    size = size || 20;
    const s  = size;
    const fs = Math.max(7, Math.floor(s * 0.42));

    // ETFs → badge coloré avec initiales (pas de logo dispo)
    if (ETF_SYMBOLS.has(sym)) {
        const bg    = ETF_COLORS[sym] || ETF_COLORS.default;
        const label = sym.length <= 3 ? sym : sym.slice(0, 3);
        return '<span class="sym-initial-badge" '
        + 'style="width:' + s + 'px;height:' + s + 'px;'
        + 'background:' + bg + ';font-size:' + fs + 'px;'
        + 'border-radius:3px" title="' + sym + '">'
        + label
        + '</span>';
    }

    // Stocks → Logo.dev + fallback via _logoFallback()
    // NOTE: onerror utilise une fonction globale pour éviter
    //       les problèmes d'échappement de guillemets
    return '<img class="stock-logo"'
        + ' src="https://img.logo.dev/ticker/' + sym.toLowerCase()
        + '?token=pk_e8wNvpBBQzGz5-q6XwWGxA&size=' + (s * 2) + '&format=png"'
        + ' style="width:' + s + 'px;height:' + s + 'px;'
        + 'border-radius:3px;vertical-align:middle;background:var(--surf2)"'
        + ' onerror="_logoFallback(this,\'' + sym + '\',' + s + ')"'
        + ' loading="lazy"'
        + ' alt="' + sym + '">';
    }

    // Expose globally pour watchlist-manager.js
    window._getLogoHtml = _getLogoHtml;

  // ── State ────────────────────────────────────────────────
  let _state       = {};
  let _refreshTimer = null;
  let _currentSide = 'BUY';
  let _currentIv   = '1day';
  let _panelIv     = Array(10).fill('1day');
  const _termCJ = {}; // Chart.js instances dans le TA Panel
  let _sidebarOpen     = true;
  let _mainInited      = false;
  let _panelsInited    = false;
  let _activeSection   = 'overview';
  let _currentChartSym = 'SPY';
  let _lastStatusLog   = 0;           // ✅ FIX — Throttle Status Debug (1x/5min)

  // ════════════════════════════════════════════════════════
  // TECHNICAL ANALYSIS ENGINE — Wall Street Indicators
  // ════════════════════════════════════════════════════════

  function _ema(arr, p) {
    if (arr.length < p) return arr.map(() => null);
    const k = 2 / (p + 1);
    const out = Array(p - 1).fill(null);
    let v = arr.slice(0, p).reduce((a, b) => a + b, 0) / p;
    out.push(v);
    for (let i = p; i < arr.length; i++) { v = arr[i] * k + v * (1 - k); out.push(v); }
    return out;
  }

  function _sma(arr, p) {
    return arr.map((_, i) =>
      i < p - 1 ? null : arr.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p
    );
  }

  function _rsi(closes, p = 14) {
    if (closes.length < p + 1) return closes.map(() => null);
    let g = 0, l = 0;
    for (let i = 1; i <= p; i++) { const d = closes[i] - closes[i-1]; g += Math.max(d,0); l += Math.max(-d,0); }
    let ag = g / p, al = l / p;
    const out = Array(p).fill(null);
    out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    for (let i = p + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i-1];
      ag = (ag * (p-1) + Math.max(d,0)) / p;
      al = (al * (p-1) + Math.max(-d,0)) / p;
      out.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
    }
    return out;
  }

  function _macd(closes, f=12, s=26, sig=9) {
    const ef = _ema(closes, f), es = _ema(closes, s);
    const ml = closes.map((_, i) => ef[i] != null && es[i] != null ? ef[i] - es[i] : null);
    const valid = ml.filter(v => v != null);
    const se = _ema(valid, sig);
    let si = 0;
    const sl = ml.map(v => v == null ? null : se[si++] ?? null);
    return {
      line: ml[ml.length-1] ?? 0,
      signal: sl[sl.length-1] ?? 0,
      hist: (ml[ml.length-1] ?? 0) - (sl[sl.length-1] ?? 0),
    };
  }

  function _bollinger(closes, p=20, m=2) {
    const sma = _sma(closes, p);
    const last = closes.length - 1;
    if (sma[last] == null) return null;
    const sl = closes.slice(last - p + 1, last + 1);
    const std = Math.sqrt(sl.reduce((s, v) => s + Math.pow(v - sma[last], 2), 0) / p);
    return { upper: sma[last] + m*std, middle: sma[last], lower: sma[last] - m*std };
  }

  function _ichimoku(candles) {
    const H = candles.map(c => c.high), L = candles.map(c => c.low), C = candles.map(c => c.close);
    const hh = (a, i, p) => Math.max(...a.slice(Math.max(0, i-p+1), i+1));
    const ll = (a, i, p) => Math.min(...a.slice(Math.max(0, i-p+1), i+1));
    const n = candles.length, i = n - 1;
    const tenkan  = i >= 8  ? (hh(H,i,9)  + ll(L,i,9))  / 2 : null;
    const kijun   = i >= 25 ? (hh(H,i,26) + ll(L,i,26)) / 2 : null;
    const senkouA = tenkan && kijun ? (tenkan + kijun) / 2 : null;
    const senkouB = i >= 51 ? (hh(H,i,52) + ll(L,i,52)) / 2 : null;
    const price   = C[i];
    let cloudSig  = 'neutral';
    if (senkouA && senkouB) {
      const hi = Math.max(senkouA, senkouB), lo = Math.min(senkouA, senkouB);
      cloudSig = price > hi ? 'bullish' : price < lo ? 'bearish' : 'inside';
    }
    return { tenkan, kijun, senkouA, senkouB, price, cloudSig,
      tkCross: tenkan && kijun ? (tenkan > kijun ? 'bullish' : 'bearish') : 'neutral' };
  }

  function _fibonacci(candles) {
    const sl = candles.slice(-Math.min(60, candles.length));
    const hi = Math.max(...sl.map(c => c.high));
    const lo = Math.min(...sl.map(c => c.low));
    const d  = hi - lo;
    return {
      hi, lo,
      levels: [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map(r => ({
        pct: r, label: (r*100).toFixed(1)+'%',
        price: hi - d * r, key: [0.382,0.5,0.618].includes(r),
      })),
      exts: [1.272, 1.618, 2.0, 2.618].map(r => ({
        pct: r, label: (r*100).toFixed(1)+'%', price: lo + d * r,
      })),
    };
  }

  function _stochastic(candles, k=14, d=3) {
    const C = candles.map(c => c.close);
    const H = candles.map(c => c.high);
    const L = candles.map(c => c.low);
    const kv = [];
    for (let i = k-1; i < candles.length; i++) {
      const hh = Math.max(...H.slice(i-k+1,i+1));
      const ll = Math.min(...L.slice(i-k+1,i+1));
      kv.push(hh===ll ? 50 : (C[i]-ll)/(hh-ll)*100);
    }
    const dv = _sma(kv, d);
    return { k: kv[kv.length-1] ?? null, d: dv[dv.length-1] ?? null };
  }

  function _atr(candles, p=14) {
    if (candles.length < 2) return null;
    const trs = candles.slice(1).map((c,i) => Math.max(
      c.high - c.low,
      Math.abs(c.high  - candles[i].close),
      Math.abs(c.low   - candles[i].close)
    ));
    const a = _sma(trs, p);
    return a[a.length-1];
  }

  // ── Main analysis ──────────────────────────────────────
  function _analyzeTA(candles, sym) {
    if (!candles || candles.length < 55) return null;
    const C    = candles.map(c => c.close);
    const last = C[C.length-1];

    const rsiArr = _rsi(C, 14);
    const rsiV   = rsiArr[rsiArr.length-1] ?? 50;
    const macdV  = _macd(C);
    const bb     = _bollinger(C);
    const ema9v  = _ema(C, 9);   const e9  = ema9v[ema9v.length-1];
    const ema21v = _ema(C, 21);  const e21 = ema21v[ema21v.length-1];
    const ema50v = _ema(C, 50);  const e50 = ema50v[ema50v.length-1];
    const ema200v= _ema(C, 200); const e200= ema200v[ema200v.length-1];
    const ich    = _ichimoku(candles);
    const fib    = _fibonacci(candles);
    const stoch  = _stochastic(candles);
    const atrV   = _atr(candles, 14);

    // ── Scoring ──────────────────────────────────────────
    let bull = 0, bear = 0;
    const sigs = [];

    const add = (ind, sig, b, val) => {
      sigs.push({ ind, sig, bull: b, val });
      if (b === true) bull += (ind.includes('EMA')||ind==='Fibonacci')?1:2;
      else if (b === false) bear += (ind.includes('EMA')||ind==='Fibonacci')?1:2;
    };

    // RSI
    rsiV < 30 ? add('RSI (14)', 'Oversold — Buy Signal', true, rsiV.toFixed(1)) :
    rsiV > 70 ? add('RSI (14)', 'Overbought — Sell Signal', false, rsiV.toFixed(1)) :
    rsiV > 50 ? add('RSI (14)', 'Neutral-Bullish', null, rsiV.toFixed(1)) :
                add('RSI (14)', 'Neutral-Bearish', null, rsiV.toFixed(1));

    // MACD
    macdV.line > macdV.signal && macdV.hist > 0
      ? add('MACD', 'Bullish Crossover', true, macdV.line.toFixed(4))
      : macdV.line < macdV.signal && macdV.hist < 0
        ? add('MACD', 'Bearish Crossover', false, macdV.line.toFixed(4))
        : add('MACD', 'Neutral', null, macdV.line.toFixed(4));

    // Bollinger
    if (bb) {
      const w = bb.upper - bb.lower;
      const p = w > 0 ? (last - bb.lower) / w : 0.5;
      p > 0.85 ? add('Bollinger Bands', 'Near Upper — Resistance', false, `${(p*100).toFixed(0)}%`) :
      p < 0.15 ? add('Bollinger Bands', 'Near Lower — Support', true, `${(p*100).toFixed(0)}%`) :
                add('Bollinger Bands', 'Mid-Band Range', null, `${(p*100).toFixed(0)}%`);
    }

    // EMA
    if (e50 && e200) {
      last > e50 && e50 > e200
        ? add('EMA 50/200', 'Golden Cross — Bullish Trend', true, `$${e50.toFixed(2)}`)
        : last < e50 && e50 < e200
          ? add('EMA 50/200', 'Death Cross — Bearish Trend', false, `$${e50.toFixed(2)}`)
          : add('EMA 50/200', 'Mixed — No Clear Trend', null, `$${e50.toFixed(2)}`);
    }
    if (e9 && e21) {
      e9 > e21
        ? add('EMA 9/21', 'Short-term Bullish', true, `$${e9.toFixed(2)}`)
        : add('EMA 9/21', 'Short-term Bearish', false, `$${e9.toFixed(2)}`);
    }

    // Ichimoku
    ich.cloudSig === 'bullish' ? add('Ichimoku Cloud', 'Above Cloud — Bullish', true, `T:${ich.tenkan?.toFixed(2)}`) :
    ich.cloudSig === 'bearish' ? add('Ichimoku Cloud', 'Below Cloud — Bearish', false, `T:${ich.tenkan?.toFixed(2)}`) :
                                add('Ichimoku Cloud', 'Inside Cloud — Neutral', null, `T:${ich.tenkan?.toFixed(2)}`);
    ich.tkCross === 'bullish'  ? add('TK Cross', 'Tenkan > Kijun — Buy', true, 'Bullish') :
                                add('TK Cross', 'Tenkan < Kijun — Sell', false, 'Bearish');

    // Stochastic
    if (stoch.k != null) {
      stoch.k < 20 ? add('Stochastic %K', 'Oversold — Potential Reversal', true, stoch.k.toFixed(1)) :
      stoch.k > 80 ? add('Stochastic %K', 'Overbought — Potential Reversal', false, stoch.k.toFixed(1)) :
                    add('Stochastic %K', 'Neutral Zone', null, stoch.k.toFixed(1));
    }

    // Fibonacci
    if (fib) {
      const nearest = fib.levels.reduce((prev, cur) =>
        Math.abs(cur.price - last) < Math.abs(prev.price - last) ? cur : prev
      );
      if (Math.abs(nearest.price - last) < (atrV||last*0.01) * 0.8) {
        nearest.price < last
          ? add('Fibonacci', `Near ${nearest.label} Support ($${nearest.price.toFixed(2)})`, true, nearest.label)
          : add('Fibonacci', `Near ${nearest.label} Resistance ($${nearest.price.toFixed(2)})`, false, nearest.label);
      }
    }

    // ── Recommendation ────────────────────────────────────
    const total    = bull + bear;
    const bullRat  = total > 0 ? bull / total : 0.5;
    let rec, recCol, recIcon;
    if      (bullRat >= 0.75) { rec = 'STRONG BUY';  recCol = '#10b981'; recIcon = 'fa-arrow-trend-up'; }
    else if (bullRat >= 0.60) { rec = 'BUY';          recCol = '#34d399'; recIcon = 'fa-arrow-up'; }
    else if (bullRat >= 0.45) { rec = 'NEUTRAL';      recCol = '#f59e0b'; recIcon = 'fa-minus'; }
    else if (bullRat >= 0.30) { rec = 'SELL';         recCol = '#f87171'; recIcon = 'fa-arrow-down'; }
    else                      { rec = 'STRONG SELL';  recCol = '#ef4444'; recIcon = 'fa-arrow-trend-down'; }

    // ── Price Targets ─────────────────────────────────────
    const isBull = bullRat >= 0.5;
    const da = atrV || last * 0.015;
    const tgt1 = isBull ? last + da * 2 : last - da * 2;
    const tgt2 = isBull
      ? (fib?.exts.find(e => e.pct === 1.618)?.price || last * 1.08)
      : (fib?.levels.find(l => l.pct === 0.618)?.price || last * 0.93);
    const stop = isBull ? last - da * 1.5 : last + da * 1.5;

    return {
      sym, price: last, rec, recCol, recIcon, bullRat,
      bull, bear, sigs, rsi: rsiV, macd: macdV,
      bb, ema: { e9, e21, e50, e200 }, ich, fib, stoch, atr: atrV,
      targets: { t1: tgt1, t2: tgt2, stop },
    };
  }

  function _destroyTermCJ() {
    Object.keys(_termCJ).forEach(id => {
      if (_termCJ[id]) {
        try { _termCJ[id].destroy(); } catch(e) {}
        delete _termCJ[id];
      }
    });
  }

  // ── Render Technical Analysis ──────────────────────────
  function _renderTechnicalAnalysis(a) {
    const el = document.getElementById('ta-panel');
    if (!el || !a) return;

    const pct = (a.bullRat * 100).toFixed(0);

    // Update badge in card header
    const badge = document.getElementById('ta-rec-badge');
    if (badge) {
      badge.textContent = a.rec;
      badge.style.display = 'inline-block';
      badge.style.background = a.recCol + '20';
      badge.style.color  = a.recCol;
      badge.style.border = `1px solid ${a.recCol}40`;
    }
    const symEl = document.getElementById('ta-sym');
    if (symEl) symEl.textContent = a.sym;

    el.innerHTML = `
      <!-- ── Main Recommendation ── -->
      <div style="background:${a.recCol}10;border:1.5px solid ${a.recCol}35;border-radius:14px;padding:18px;margin-bottom:14px">
        <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="text-align:center;padding:10px 18px;background:${a.recCol}18;border-radius:10px;min-width:130px">
            <i class="fa-solid ${a.recIcon}" style="color:${a.recCol};font-size:22px;margin-bottom:5px;display:block"></i>
            <div style="font-size:16px;font-weight:900;color:${a.recCol}">${a.rec}</div>
          </div>
          <div>
            <div style="font-size:11px;color:var(--txt4);margin-bottom:4px">Signal Strength</div>
            <div style="width:160px;height:8px;background:var(--surf3);border-radius:4px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${a.recCol};transition:width 0.6s"></div>
            </div>
            <div style="font-size:10px;color:var(--txt4);margin-top:3px">${pct}% Bullish (${a.bull} vs ${a.bear} signals)</div>
          </div>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-left:auto">
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Short Target</div>
              <div style="font-size:15px;font-weight:800;color:var(--g);font-family:var(--mono)">$${a.targets.t1.toFixed(2)}</div>
              <div style="font-size:9px;color:var(--txt4)">1-2 weeks</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Medium Target</div>
              <div style="font-size:15px;font-weight:800;color:var(--b1);font-family:var(--mono)">$${a.targets.t2.toFixed(2)}</div>
              <div style="font-size:9px;color:var(--txt4)">1-3 months</div>
            </div>
            <div style="text-align:center">
              <div style="font-size:9px;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">Stop Loss</div>
              <div style="font-size:15px;font-weight:800;color:var(--r);font-family:var(--mono)">$${a.targets.stop.toFixed(2)}</div>
              <div style="font-size:9px;color:var(--txt4)">Risk management</div>
            </div>
            ${a.atr ? `<div style="text-align:center">
              <div style="font-size:9px;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:2px">ATR (14)</div>
              <div style="font-size:15px;font-weight:800;color:var(--y);font-family:var(--mono)">$${a.atr.toFixed(2)}</div>
              <div style="font-size:9px;color:var(--txt4)">Daily range</div>
            </div>` : ''}
          </div>
        </div>
      </div>

      <!-- ── Indicators Grid ── -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:14px">
        ${_taC('RSI (14)', a.rsi.toFixed(1),
          a.rsi<30?'Oversold ↑':a.rsi>70?'Overbought ↓':'Neutral',
          a.rsi<30?'var(--g)':a.rsi>70?'var(--r)':'var(--y)', 'fa-gauge')}
        ${_taC('MACD', a.macd.line.toFixed(4),
          a.macd.line>a.macd.signal?'Bullish ↑':'Bearish ↓',
          a.macd.line>a.macd.signal?'var(--g)':'var(--r)', 'fa-wave-square')}
        ${a.stoch.k != null ? _taC('Stoch %K', a.stoch.k.toFixed(1),
          a.stoch.k<20?'Oversold ↑':a.stoch.k>80?'Overbought ↓':'Neutral',
          a.stoch.k<20?'var(--g)':a.stoch.k>80?'var(--r)':'var(--y)', 'fa-chart-area') : ''}
        ${a.bb ? _taC('BB Position', a.price>a.bb.upper?'Above Upper':a.price<a.bb.lower?'Below Lower':'Mid-Band',
          `Mid: $${a.bb.middle.toFixed(2)}`,
          a.price>a.bb.upper?'var(--r)':a.price<a.bb.lower?'var(--g)':'var(--b1)', 'fa-chart-bar') : ''}
        ${a.ema.e50 ? _taC('EMA 50', `$${a.ema.e50.toFixed(2)}`,
          a.price>a.ema.e50?'Price Above ↑':'Price Below ↓',
          a.price>a.ema.e50?'var(--g)':'var(--r)', 'fa-arrow-trend-up') : ''}
        ${a.ema.e200 ? _taC('EMA 200', `$${a.ema.e200.toFixed(2)}`,
          a.price>a.ema.e200?'LT Bullish ↑':'LT Bearish ↓',
          a.price>a.ema.e200?'var(--g)':'var(--r)', 'fa-chart-line') : ''}
      </div>

      <!-- ── Ichimoku ── -->
      <div style="background:var(--surf2);border:1px solid var(--bord);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:10px">
          <i class="fa-solid fa-cloud" style="color:var(--b1)"></i> Ichimoku Cloud
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:6px;margin-bottom:10px">
          ${['Tenkan-sen','Kijun-sen','Senkou A','Senkou B'].map((n,i) => {
            const v = [a.ich.tenkan, a.ich.kijun, a.ich.senkouA, a.ich.senkouB][i];
            return `<div style="background:var(--surf);border:1px solid var(--bord);border-radius:7px;padding:7px 9px">
              <div style="font-size:9px;color:var(--txt4);margin-bottom:2px">${n}</div>
              <div style="font-size:12px;font-weight:800;font-family:var(--mono);color:var(--txt)">${v?'$'+v.toFixed(2):'--'}</div>
            </div>`;
          }).join('')}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
          ${[
            {label:'Cloud', val:a.ich.cloudSig},
            {label:'TK Cross', val:a.ich.tkCross},
          ].map(s => {
            const c = s.val==='bullish'?'var(--g)':s.val==='bearish'?'var(--r)':'var(--y)';
            const ic = s.val==='bullish'?'fa-arrow-up':s.val==='bearish'?'fa-arrow-down':'fa-minus';
            return `<div style="padding:4px 12px;border-radius:6px;font-size:11px;font-weight:700;
                    background:${c}15;color:${c}">
              <i class="fa-solid ${ic}"></i> ${s.label}: ${s.val.toUpperCase()}
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- ── Fibonacci ── -->
      <div style="background:var(--surf2);border:1px solid var(--bord);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">
          <i class="fa-solid fa-layer-group" style="color:var(--b2)"></i> Fibonacci Retracement
          <span style="font-weight:400;font-size:9px;margin-left:6px;color:var(--txt4)">
            Hi: $${a.fib.hi.toFixed(2)} · Lo: $${a.fib.lo.toFixed(2)}
          </span>
        </div>
        ${a.fib.levels.map(r => {
          const isNear = Math.abs(r.price - a.price) < (a.atr||a.price*0.01)*0.6;
          const isAbove= a.price >= r.price;
          return `<div style="display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:5px;
                  background:${isNear?'rgba(59,130,246,0.08)':'transparent'};
                  border:1px solid ${isNear?'rgba(59,130,246,0.25)':'transparent'};margin-bottom:2px">
            <span style="font-size:9px;font-weight:700;color:var(--b2);min-width:42px">${r.label}</span>
            <div style="flex:1;height:2px;background:var(--surf3);border-radius:1px;overflow:hidden">
              <div style="width:${isAbove?'100':'0'}%;height:100%;background:${isAbove?'var(--g)':'var(--r)'}"></div>
            </div>
            <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:${r.key?'var(--b1)':'var(--txt2)'}">
              $${r.price.toFixed(2)}
            </span>
            ${r.key ? '<span style="font-size:8px;color:var(--b2);font-weight:700;background:rgba(139,92,246,0.1);padding:1px 5px;border-radius:3px">KEY</span>' : ''}
            ${isNear ? '<span style="font-size:8px;color:var(--b1);font-weight:700">← NOW</span>' : ''}
          </div>`;
        }).join('')}
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--bord);display:flex;gap:6px;flex-wrap:wrap">
          <span style="font-size:9px;font-weight:700;color:var(--txt4);align-self:center">Extensions:</span>
          ${a.fib.exts.map(e => `
            <span style="background:var(--surf3);padding:2px 8px;border-radius:5px;font-size:10px">
              <span style="color:var(--b2);font-weight:700">${e.label}</span>
              <span style="color:var(--txt);font-family:var(--mono);margin-left:3px">$${e.price.toFixed(2)}</span>
            </span>`).join('')}
        </div>
      </div>

      <!-- ── All Signals ── -->
      <div style="background:var(--surf2);border:1px solid var(--bord);border-radius:12px;padding:14px">
        <div style="font-size:11px;font-weight:700;color:var(--txt3);text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px">
          <i class="fa-solid fa-satellite-dish" style="color:var(--b1)"></i> Signal Details
        </div>
        ${a.sigs.map(s => `
          <div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;
              background:var(--surf);margin-bottom:3px">
            <span style="font-size:11px;font-weight:700;color:var(--txt2);min-width:110px;flex-shrink:0">${s.ind}</span>
            <span style="flex:1;font-size:11px;color:${s.bull===true?'var(--g)':s.bull===false?'var(--r)':'var(--y)'};font-weight:500">${s.sig}</span>
            <span style="font-size:10px;font-family:var(--mono);color:var(--txt4)">${s.val}</span>
            <i class="fa-solid ${s.bull===true?'fa-circle-check':s.bull===false?'fa-circle-xmark':'fa-circle-minus'}"
              style="font-size:12px;color:${s.bull===true?'var(--g)':s.bull===false?'var(--r)':'var(--y)'}"></i>
          </div>`).join('')}
      </div>
      
      <!-- ── TA Charts Section (RSI, MACD, Ichimoku, Fibonacci) ── -->
      <div style="margin-top:16px">

        <!-- RSI + MACD en 2 colonnes -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
              <i class="fa-solid fa-gauge" style="color:var(--b1)"></i>
              RSI (14) — ${a.rsi.toFixed(1)}
              <span style="float:right;color:${a.rsi<30?'var(--g)':a.rsi>70?'var(--r)':'var(--y)'}">
                ${a.rsi<30?'Oversold':a.rsi>70?'Overbought':'Neutral'}
              </span>
            </div>
            <div style="height:100px;position:relative;overflow:hidden;contain:strict">
              <canvas id="ta-rsi-chart"></canvas>
            </div>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
              <i class="fa-solid fa-wave-square" style="color:var(--b2)"></i>
              MACD — ${a.macd.hist >= 0 ? '▲ Bullish' : '▼ Bearish'}
              <span style="float:right;color:${a.macd.hist>=0?'var(--g)':'var(--r)'}">
                ${a.macd.hist.toFixed(4)}
              </span>
            </div>
            <div style="height:100px;position:relative;overflow:hidden;contain:strict">
              <canvas id="ta-macd-chart"></canvas>
            </div>
          </div>
        </div>

        <!-- Ichimoku Chart full width -->
        <div style="margin-bottom:12px">
          <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">
            <i class="fa-solid fa-cloud" style="color:var(--c)"></i>
            Ichimoku Cloud —
            <span style="color:${a.ich.cloudSig==='bullish'?'var(--g)':a.ich.cloudSig==='bearish'?'var(--r)':'var(--y)'}">
              ${a.ich.cloudSig.toUpperCase()}
            </span>
          </div>
          <div style="height:180px;position:relative;overflow:hidden;contain:strict">
            <canvas id="ta-ichi-chart"></canvas>
          </div>
        </div>

        <!-- Fibonacci Visualization -->
        <div id="ta-fib-viz-container" style="background:var(--surf2);border:1px solid var(--bord);border-radius:12px;padding:14px">
          <div style="font-size:10px;font-weight:700;color:var(--txt4);text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px">
            <i class="fa-solid fa-layer-group" style="color:var(--b2)"></i> Fibonacci Retracement (60D)
            <span style="font-weight:400;font-size:9px;margin-left:6px;color:var(--txt4)">
              Hi: $${a.fib.hi.toFixed(2)} · Lo: $${a.fib.lo.toFixed(2)} · Range: $${(a.fib.hi-a.fib.lo).toFixed(2)}
            </span>
          </div>
          <div id="ta-fib-viz"></div>
        </div>
      </div>
    `;
    // ── Render TA Charts (différé pour laisser le DOM se stabiliser) ──
    setTimeout(() => {
      _destroyTermCJ();
      const isDark = _isDark();
      _termRenderRSI('ta-rsi-chart', isDark, a);
      _termRenderMACD('ta-macd-chart', isDark, a);
      _termRenderIchimoku('ta-ichi-chart', isDark, a);
      _termRenderFibViz('ta-fib-viz', a);
    }, 60);
  }

  // ── TA Chart renderers — TA Panel (terminal.js) ──────────

  function _isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function _termCJCreate(id, config) {
    const canvas = document.getElementById(id);
    if (!canvas || typeof Chart === 'undefined') return;
    if (_termCJ[id]) { try { _termCJ[id].destroy(); } catch(e) {} }
    try {
      _termCJ[id] = new Chart(canvas.getContext('2d'), config);
    } catch(e) { console.warn('[TermCJ]', id, e); }
  }

  function _termRenderRSI(canvasId, isDark, a) {
    // Recalcule RSI depuis les données historiques stockées dans l'analyse
    // Si pas de données historiques, on affiche juste la valeur actuelle sur une jauge
    const txtC  = isDark ? '#9db3d8' : '#64748b';
    const gridC = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const rsiV  = a.rsi;
    const color = rsiV > 70 ? '#ef4444' : rsiV < 30 ? '#10b981' : '#f59e0b';

    // Jauge simple (doughnut) si pas de série historique
    _termCJCreate(canvasId, {
      type: 'doughnut',
      data: {
        datasets: [{
          data:            [rsiV, 100 - rsiV],
          backgroundColor: [color, isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'],
          borderWidth:     0,
          circumference:   270,
          rotation:        225,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout:              '75%',
        animation:           { duration: 500 },
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [{
        id: 'rsiCenter',
        afterDraw(chart) {
          const { ctx, chartArea: { left, top, width, height } } = chart;
          const cx = left + width / 2;
          const cy = top + height / 2 + 12;
          ctx.save();
          ctx.fillStyle    = color;
          ctx.font         = `bold 18px Inter, sans-serif`;
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(rsiV.toFixed(1), cx, cy);
          ctx.fillStyle = txtC;
          ctx.font      = '9px Inter, sans-serif';
          ctx.fillText(rsiV > 70 ? 'OVERBOUGHT' : rsiV < 30 ? 'OVERSOLD' : 'NEUTRAL', cx, cy + 14);
          ctx.restore();
        },
      }],
    });
  }

  function _termRenderMACD(canvasId, isDark, a) {
    const txtC  = isDark ? '#9db3d8' : '#64748b';
    const gridC = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const hist  = a.macd.hist;
    const histColor = hist >= 0 ? 'rgba(16,185,129,0.8)' : 'rgba(239,68,68,0.8)';

    // Mini bar chart avec les 3 valeurs MACD principales
    _termCJCreate(canvasId, {
      type: 'bar',
      data: {
        labels: ['MACD Line', 'Signal Line', 'Histogram'],
        datasets: [{
          data:            [a.macd.line, a.macd.signal, hist],
          backgroundColor: [
            'rgba(59,130,246,0.7)',
            'rgba(249,115,22,0.7)',
            histColor,
          ],
          borderWidth:   0,
          borderRadius:  4,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0d1530' : '#fff',
            bodyColor:       txtC,
            borderColor:     isDark ? '#1a2845' : '#dde3f0',
            borderWidth:     1,
            callbacks: {
              label: ctx => ` ${ctx.label}: ${parseFloat(ctx.parsed.y).toFixed(5)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: txtC, font: { size: 9 } }, grid: { color: gridC } },
          y: { ticks: { color: txtC, font: { size: 9 } }, grid: { color: gridC } },
        },
      },
    });
  }

  function _termRenderIchimoku(canvasId, isDark, a) {
    const txtC  = isDark ? '#9db3d8' : '#64748b';
    const gridC = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const ich   = a.ich;
    const price = a.price;

    // Visualisation des niveaux Ichimoku clés
    const labels  = ['Chikou/Price', 'Price', 'Tenkan', 'Kijun', 'Senkou A', 'Senkou B'];
    const chikou  = price; // simplified proxy
    const values  = [chikou, price, ich.tenkan, ich.kijun, ich.senkouA, ich.senkouB]
      .map(v => v ?? price);
    const colors  = values.map(v => v > price ? '#10b981' : v < price ? '#ef4444' : '#f59e0b');

    _termCJCreate(canvasId, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data:            values,
          backgroundColor: colors.map(c => c + '55'),
          borderColor:     colors,
          borderWidth:     2,
          borderRadius:    4,
          indexAxis:       'x',
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 400 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? '#0d1530' : '#fff',
            bodyColor:       txtC,
            borderColor:     isDark ? '#1a2845' : '#dde3f0',
            borderWidth:     1,
            callbacks: {
              label: ctx => ` ${ctx.label}: $${parseFloat(ctx.parsed.y).toFixed(2)}`,
            },
          },
        },
        scales: {
          x: { ticks: { color: txtC, font: { size: 9 } }, grid: { color: gridC } },
          y: {
            ticks: {
              color:    txtC,
              font:     { size: 9 },
              callback: v => '$' + v.toFixed(0),
            },
            grid: { color: gridC },
            min:  Math.min(...values) * 0.995,
            max:  Math.max(...values) * 1.005,
          },
        },
      },
    });
  }

  function _termRenderFibViz(containerId, a) {
    const el = document.getElementById(containerId);
    if (!el || !a.fib) return;

    const fib   = a.fib;
    const price = a.price;
    const range = fib.hi - fib.lo;

    el.innerHTML = fib.levels.map(lv => {
      const isNear  = Math.abs(lv.price - price) < (a.atr || price * 0.01) * 0.8;
      const isAbove = price >= lv.price;
      const barPct  = range > 0
        ? Math.max(0, Math.min(100, ((fib.hi - lv.price) / range) * 100))
        : 50;
      const color   = lv.key ? 'var(--b1)' : 'var(--txt3)';

      return `<div style="display:flex;align-items:center;gap:8px;padding:3px 6px;margin-bottom:3px;
                          border-radius:5px;background:${isNear ? 'rgba(59,130,246,0.07)' : 'transparent'};
                          border:1px solid ${isNear ? 'rgba(59,130,246,0.2)' : 'transparent'}">
        <span style="font-size:9px;font-weight:800;color:${color};min-width:38px;font-family:var(--mono)">${lv.label}</span>
        <div style="flex:1;height:5px;background:var(--surf3);border-radius:3px;overflow:hidden">
          <div style="width:${barPct.toFixed(1)}%;height:100%;
                      background:${isAbove ? 'var(--g)' : 'var(--r)'};border-radius:3px"></div>
        </div>
        <span style="font-size:11px;font-weight:700;font-family:var(--mono);color:${color};min-width:65px;text-align:right">
          $${lv.price.toFixed(2)}
        </span>
        ${lv.key  ? '<span style="font-size:8px;color:var(--b2);font-weight:700;background:rgba(139,92,246,0.1);padding:1px 5px;border-radius:3px">KEY</span>' : '<span style="min-width:32px"></span>'}
        ${isNear  ? '<span style="font-size:9px;color:var(--b1);font-weight:800">← NOW</span>' : ''}
      </div>`;
    }).join('') + `
      <div style="margin-top:8px;padding-top:6px;border-top:1px solid var(--bord);display:flex;gap:6px;flex-wrap:wrap">
        <span style="font-size:9px;font-weight:700;color:var(--txt4);align-self:center">Extensions:</span>
        ${fib.exts.map(e => `
          <span style="background:var(--surf3);padding:2px 8px;border-radius:5px;font-size:10px">
            <span style="color:var(--b2);font-weight:700">${e.label}</span>
            <span style="color:var(--txt);font-family:var(--mono);margin-left:3px">$${e.price.toFixed(2)}</span>
          </span>`).join('')}
      </div>`;
  }

  // Helper card mini
  function _taC(title, value, sub, color, icon) {
    return `<div style="background:var(--surf2);border:1px solid var(--bord);border-radius:9px;padding:10px;border-left:3px solid ${color}">
      <div style="font-size:9px;font-weight:700;color:var(--txt4);text-transform:uppercase;margin-bottom:3px;display:flex;align-items:center;gap:3px">
        <i class="fa-solid ${icon}" style="color:${color}"></i> ${title}
      </div>
      <div style="font-size:15px;font-weight:800;font-family:var(--mono);color:${color}">${value}</div>
      <div style="font-size:9px;color:${color};font-weight:600;margin-top:2px">${sub}</div>
    </div>`;
  }

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  async function init() {
    _restoreTheme();
    _startClock();
    _bindEvents();
    _togglePriceFields();

    // ✅ FIX #1 — Init watchlist APRÈS que le DOM soit prêt
    WatchlistManager.init();

    // ── Init symbol search widgets ──────────────────────────
    setTimeout(() => {
      // ✅ FIX — Callback direct + stockage de l'API sur le DOM
      const ovApi = _createSymbolSearchWidget(
        'ov-symbol-widget-host',
        'ov-symbol',
        'SPY',
        (sym) => {                        // ← callback déclenché au pick
          _currentChartSym = sym;         // ← mise à jour variable locale
          _loadMainChart(true);           // ← reload chart immédiatement
        }
      );
      const ovHost = document.getElementById('ov-symbol-widget-host');
      if (ovHost && ovApi) ovHost._widgetApi = ovApi;   // ← stocké sur le DOM

      const orApi = _createSymbolSearchWidget(
        'order-symbol-widget-host',
        'order-symbol',
        ''
      );
      const orHost = document.getElementById('order-symbol-widget-host');
      if (orHost && orApi) orHost._widgetApi = orApi;
    }, 200);

    // First data load
    await _refresh();
    await _loadMainChart();

    // Auto-refresh every 60s
    _refreshTimer = setInterval(_refresh, REFRESH_MS);

    console.log('[AlphaVault] Terminal initialized | Auto-refresh: 60s');

    // ✅ FIX OVERVIEW CHARTS — Re-lock des sparklines toutes les 3s
    // Empêche toute reprise de la boucle infinie après un refresh
    (function _lockSparklines() {
    const SPARK_IDS = ['spark-spy', 'spark-qqq', 'spark-iwm'];
    const lock = () => {
        SPARK_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.setProperty('height',     '40px', 'important');
        el.style.setProperty('max-height', '40px', 'important');
        el.style.setProperty('min-height', '40px', 'important');
        el.style.setProperty('overflow',   'hidden','important');
        });
    };
    lock();
    setInterval(lock, 3000);
    })();
    }

  // Charts dans overview — build dynamiquement
  let _ovChartsInited = false;
  async function _buildOvCharts() {
    const grid = document.getElementById('ov-charts-grid');
    if (!grid) return;

    const countSel = document.getElementById('ov-chart-count');
    const maxN = parseInt(countSel?.value || '4');
    const wl   = window.WatchlistManager ? WatchlistManager.getWatchlist() : [];
    const syms = wl.length ? wl.slice(0, maxN) : CHART_SYMBOLS_DEFAULTS_10.slice(0, maxN);

    // Info text
    const info = document.getElementById('ov-charts-wl-info');
    if (info) info.textContent = wl.length
      ? `${syms.length} symbols from your watchlist`
      : `${syms.length} default symbols`;

    // Détermine le layout
    const layoutCls = syms.length <= 2 ? 'layout-1'
                    : syms.length <= 4 ? 'layout-2-2'
                    :                    'layout-2-3';
    grid.className = `charts-grid ${layoutCls}`;

    // Génère les panels
    grid.innerHTML = syms.map((sym, i) => {
      const logoHtml = _getLogoHtml(sym, 14);
      return `
        <div class="chart-panel">
          <div class="cp-header">
            <div class="cp-logo-sym">
              ${logoHtml}
              <span>${sym}</span>
            </div>
            <div class="cp-header-right">
              <div class="cp-itabs" data-ovpanel="${i}">
                <button class="cp-itab" data-iv="1h">1H</button>
                <button class="cp-itab active" data-iv="1day">1D</button>
                <button class="cp-itab" data-iv="1week">1W</button>
              </div>
            </div>
          </div>
          <div class="cp-chart" id="ov-chart-${i}"></div>
        </div>`;
    }).join('');

    // Bind interval tabs
    document.querySelectorAll('.cp-itabs[data-ovpanel]').forEach(container => {
      const idx = parseInt(container.dataset.ovpanel);
      container.querySelectorAll('.cp-itab').forEach(btn => {
        btn.addEventListener('click', () => {
          container.querySelectorAll('.cp-itab').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          _loadOvPanelChart(idx, syms[idx], btn.dataset.iv);
        });
      });
    });

    // Charge les graphiques
    _ovChartsInited = true;
    for (let i = 0; i < syms.length; i++) {
      await _loadOvPanelChart(i, syms[i], '1day');
    }
  }

  async function _loadOvPanelChart(idx, sym, iv = '1day') {
    const cid = `ov-chart-${idx}`;
    Charts.initPanelChart(idx + 10, cid); // offset +10 pour éviter conflits avec panels Charts
    const candles = await _fetchChartData(sym, iv);
    if (candles.length) {
      Charts.updatePanelChart(idx + 10, candles.map(c => ({
        datetime: new Date(c.time * 1000).toISOString(),
        open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
      })));
    }
  }

  // ════════════════════════════════════════════════════════════
  // SYMBOL SEARCH WIDGET
  // Remplace un <select> par un dropdown recherchable
  // ════════════════════════════════════════════════════════════
  function _createSymbolSearchWidget(hostId, hiddenSelectId, initialSym = '', onPickCallback = null) {
    const host   = document.getElementById(hostId);
    const select = document.getElementById(hiddenSelectId);
    if (!host || !select) return null;

    if (host.dataset.init) return null;
    host.dataset.init = '1';

    function _getAllSyms() {
      if (window.WatchlistManager) return WatchlistManager.getAllSymbols();
      return Object.values(UNIVERSE).flat ? Object.values(UNIVERSE).flat() : UNIVERSE;
    }

    let _open        = false;
    let _currentSym  = initialSym;
    let _highlighted = -1;

    host.innerHTML = `
      <div class="sym-widget" id="${hostId}-inner">
        <div class="sym-widget-trigger" id="${hostId}-trigger" tabindex="0" role="combobox"
             aria-expanded="false" aria-haspopup="listbox">
          <i class="fa-solid fa-magnifying-glass sym-widget-icon"></i>
          <input  class="sym-widget-input"
                  id="${hostId}-input"
                  type="text"
                  placeholder="Search symbol..."
                  autocomplete="off"
                  spellcheck="false"
                  aria-label="Symbol search"
                  role="searchbox">
          <span class="sym-widget-tag" id="${hostId}-tag"
                style="display:${_currentSym ? 'inline-flex' : 'none'}">
            ${_currentSym || ''}
          </span>
          <button class="sym-widget-clear" id="${hostId}-clear"
                  style="display:${_currentSym ? 'flex' : 'none'}"
                  title="Clear" tabindex="-1">
            <i class="fa-solid fa-xmark"></i>
          </button>
          <i class="fa-solid fa-chevron-down sym-widget-caret" id="${hostId}-caret"></i>
        </div>
        <div class="sym-widget-dropdown" id="${hostId}-dropdown"
             role="listbox" aria-label="Symbol list" style="display:none">
          <div class="sym-widget-list" id="${hostId}-list"></div>
        </div>
      </div>`;

    const inner    = document.getElementById(`${hostId}-inner`);
    const trigger  = document.getElementById(`${hostId}-trigger`);
    const input    = document.getElementById(`${hostId}-input`);
    const tag      = document.getElementById(`${hostId}-tag`);
    const clearBtn = document.getElementById(`${hostId}-clear`);
    const caret    = document.getElementById(`${hostId}-caret`);
    const dropdown = document.getElementById(`${hostId}-dropdown`);
    const list     = document.getElementById(`${hostId}-list`);

    function _renderList(q = '') {
      const allSyms = _getAllSyms();
      const qLow    = q.toLowerCase().trim();
      _highlighted  = -1;

      let filtered;
      if (!qLow) {
        const starred = window.WatchlistManager ? WatchlistManager.getStarred() : [];
        const wl      = window.WatchlistManager ? WatchlistManager.getWatchlist() : [];
        const rest    = allSyms.filter(s => !wl.includes(s));
        filtered = [...new Set([...starred, ...wl, ...rest])].slice(0, 80);
      } else {
        const startsWith = allSyms.filter(s => s.toLowerCase().startsWith(qLow));
        const contains   = allSyms.filter(s =>
          !s.toLowerCase().startsWith(qLow) &&
          (s.toLowerCase().includes(qLow) ||
           (window.WatchlistManager ? WatchlistManager.getSymbolMeta(s)?.name || '' : '').toLowerCase().includes(qLow))
        );
        filtered = [...startsWith, ...contains].slice(0, 60);
      }

      if (!filtered.length) {
        list.innerHTML = `
          <div class="sym-widget-empty">
            <i class="fa-solid fa-magnifying-glass" style="font-size:18px;margin-bottom:8px;opacity:0.4"></i>
            <div>No results for "<strong>${q}</strong>"</div>
          </div>`;
        return;
      }

      list.innerHTML = filtered.map((s, idx) => {
        const meta      = window.WatchlistManager ? WatchlistManager.getSymbolMeta(s) : { name: s, sector: '' };
        const logoHtml  = typeof _getLogoHtml === 'function' ? _getLogoHtml(s, 18) : '';
        const isActive  = s === _currentSym;
        const isStarred = window.WatchlistManager ? WatchlistManager.isStarred(s) : false;
        const name      = (meta.name || s).slice(0, 28);
        const sector    = meta.sector || '';

        return `
          <div class="sym-widget-item${isActive ? ' selected' : ''}"
               data-sym="${s}" data-idx="${idx}"
               role="option" aria-selected="${isActive}">
            <span class="sym-widget-item-logo">${logoHtml}</span>
            <div class="sym-widget-item-info">
              <span class="sym-widget-item-sym">${s}</span>
              <span class="sym-widget-item-name">${name}</span>
            </div>
            <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
              ${isStarred ? '<i class="fa-solid fa-star" style="font-size:9px;color:var(--y)"></i>' : ''}
              <span class="sym-widget-item-sector">${sector}</span>
            </div>
          </div>`;
      }).join('');

      list.querySelectorAll('.sym-widget-item').forEach(item => {
        item.addEventListener('mousedown', e => {
          e.preventDefault();
          _pick(item.dataset.sym);
        });
      });
    }

    // ════════════════════════════════════════════════════════
    // ✅ FIX CRITIQUE — _pick corrigé
    // Problème : select.value = sym ne fonctionne que si
    // l'option existe déjà dans le <select>. On l'ajoute
    // dynamiquement + on déclenche un callback direct.
    // ════════════════════════════════════════════════════════
    function _pick(sym) {
      _currentSym = sym;

      // ✅ FIX ROOT CAUSE — Ajouter l'option si elle n'existe pas
      if (sym && select) {
        if (!select.querySelector(`option[value="${sym}"]`)) {
          const opt       = document.createElement('option');
          opt.value       = sym;
          opt.textContent = sym;
          select.appendChild(opt);
        }
        select.value = sym;
      }

      tag.textContent        = sym;
      tag.style.display      = sym ? 'inline-flex' : 'none';
      clearBtn.style.display = sym ? 'flex' : 'none';
      input.value            = '';
      _close();

      // Event sur le select (compatibilité listeners existants)
      select.dispatchEvent(new Event('change', { bubbles: true }));

      // ✅ Callback direct — ne dépend PAS du select
      if (onPickCallback && sym) onPickCallback(sym);
    }

    function _openDD() {
      _open = true;
      dropdown.style.display = 'block';
      caret.style.transform  = 'rotate(180deg)';
      trigger.setAttribute('aria-expanded', 'true');
      _renderList(input.value);
      input.focus();
    }

    function _close() {
      _open = false;
      dropdown.style.display = 'none';
      caret.style.transform  = '';
      trigger.setAttribute('aria-expanded', 'false');
    }

    trigger.addEventListener('click', e => {
      if (e.target === clearBtn || clearBtn.contains(e.target)) return;
      _open ? _close() : _openDD();
    });

    input.addEventListener('click', e => e.stopPropagation());

    input.addEventListener('input', () => {
      if (!_open) _openDD();
      else _renderList(input.value);
    });

    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { _close(); return; }
      const items = list.querySelectorAll('.sym-widget-item');
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _highlighted = Math.min(_highlighted + 1, items.length - 1);
        _highlightItem(items);
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        _highlighted = Math.max(_highlighted - 1, 0);
        _highlightItem(items);
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (_highlighted >= 0 && items[_highlighted]) {
          _pick(items[_highlighted].dataset.sym);
        } else if (items[0]) {
          _pick(items[0].dataset.sym);
        }
      }
    });

    function _highlightItem(items) {
      items.forEach((el, i) => {
        el.classList.toggle('highlighted', i === _highlighted);
        if (i === _highlighted) el.scrollIntoView({ block: 'nearest' });
      });
    }

    clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      _pick('');
      input.focus();
      _openDD();
    });

    document.addEventListener('click', e => {
      if (_open && !inner.contains(e.target)) _close();
    });

    return {
      pick:     _pick,
      getValue: () => _currentSym || select.value,
      open:     _openDD,
      close:    _close,
    };
  }

  // ── Bind ALL event listeners (no inline handlers) ────────
  function _bindEvents() {
    // Topbar
    _on('sidebar-toggle', 'click',  toggleSidebar);
    _on('btn-refresh',    'click',  forceRefresh);
    _on('btn-theme',      'click',  toggleTheme);

    // Overview chart controls
    // ✅ FIX — Met à jour _currentChartSym quand le select change programmatiquement
    document.getElementById('ov-symbol')?.addEventListener('change', (e) => {
      const v = e.target.value;
      if (v && v !== _currentChartSym) {
        _currentChartSym = v;
        _loadMainChart(true);
      }
    });
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

    // Charts in Overview — bind
    _on('btn-ov-charts-refresh', 'click', _buildOvCharts);
    _on('btn-refresh-ta',         'click', () => _loadMainChart(true));
    _on('ov-chart-count', 'change', () => _buildOvCharts());

    // Panel chart selectors (cp-sym-0 to 3)
    for (let i = 0; i < 4; i++) {
      const sel = document.getElementById(`cp-sym-${i}`);
      if (sel) {
        const idx = i;
        sel.addEventListener('change', () => _loadPanelChart(idx, sel.value));
      }
    }

    // Charts section init
    if (document.getElementById('charts-grid')) {
    _buildChartPanels();
    }

    // Quant modal ESC key
    document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeQuantModal();
    });

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
    const rawStatus = data.status || {};

    // ✅ FIX #1 — dry_run depuis standalone_trader (source of truth)
    // Le top-level dry_run peut être stale depuis le dernier run GitHub Actions
    const dryRun = rawStatus.standalone_trader?.dry_run
                ?? rawStatus.dry_run
                ?? true;

    // ✅ FIX #2 — Session depuis standalone_trader si disponible
    const sess = rawStatus.standalone_trader?.session
              || rawStatus.session
              || 'closed';

    // ✅ FIX #3 — Standalone actif = système OK même si workers:{} stale
    const standaloneOk = rawStatus.standalone_trader?.active === true;

    // ── Normalisation défensive ────────────────────────────────
    const status = {
      ...rawStatus,
      workers: rawStatus.checks   !== undefined ? rawStatus.checks
            : rawStatus.workers  !== undefined ? rawStatus.workers
            : {},
      mode:    rawStatus.mode     ?? rawStatus.llm_mode ?? 'deterministic',
      session: sess,    // ← session corrigée
      dry_run: dryRun,  // ← dry_run corrigé
    };

    // ── Détermine si les workers critiques sont OK ─────────────────
    const _workersObj = status.workers;
    const _hasWorkers = Object.keys(_workersObj).length > 0;

    // ✅ FIX — Standalone actif = criticalOk même si workers:{} stale
    const _criticalOk = _hasWorkers
      ? ['finance_hub', 'ai_proxy'].every(key => {
          const w = _workersObj[key];
          return w === true || w?.ok === true;
        })
      : standaloneOk || rawStatus.required_ok === true;

    // ── Override overall ──────────────────────────────────────────
    // ✅ FIX — Inclut 'standalone_active' dans la liste des états overridables
    if (_criticalOk && (!status.overall ||
        ['degraded','initializing','unknown','warning','closed','standalone_active'].includes(status.overall)
    )) {
      status.overall = 'healthy';
    }

    const regime = data.regime?.global || {};
    const rl     = regime.regime_label || 'initializing';

    // ════════════════════════════════════════════════════
    // DEBUG LOGS — Throttled : 1x par 5 minutes max
    // ════════════════════════════════════════════════════
    const _nowLog = Date.now();
    if ((_nowLog - _lastStatusLog) > 300_000) {
      _lastStatusLog = _nowLog;

      const llmAvail = rawStatus.llm_available;
      console.groupCollapsed('%c[AlphaVault] Status Debug', 'color:#3b82f6;font-weight:bold;font-size:11px');

      // LLM
      console.log(
        `%c LLM: ${llmAvail ? 'AVAILABLE' : 'UNAVAILABLE'} → dot ${llmAvail ? 'GREEN' : 'RED'}`,
        `color:${llmAvail ? '#10b981' : '#ef4444'};font-weight:bold`
      );
      if (!llmAvail) {
        console.warn(' → Cause probable: Gemini 429 quota dépassé (voir logs GitHub Actions)');
        console.log('%c → Le système fonctionne en mode déterministe ML (XGBoost + LightGBM + LogReg)', 'color:#10b981');
        console.log('%c → Les signaux ML sont générés normalement — LLM est optionnel et additif seulement', 'color:#10b981');
      }

      // HUB — ✅ FIX : fallback sur standaloneOk
      const hubOkLog = _hasWorkers
        ? (_workersObj.finance_hub === true || _workersObj.finance_hub?.ok === true)
        : standaloneOk;
      console.log(
        `%c HUB: ${hubOkLog ? 'ONLINE' : 'OFFLINE'} → dot ${hubOkLog ? 'GREEN' : 'ORANGE'}`,
        `color:${hubOkLog ? '#10b981' : '#f59e0b'};font-weight:bold`
      );
      if (!hubOkLog) {
        console.warn(' → Worker finance-hub-api non joignable depuis GitHub Actions');
        if (standaloneOk) console.log('%c → Standalone Oracle actif — ordres exécutés via yfinance + IBKR', 'color:#10b981');
      }

      // IBKR — ✅ FIX : affiche le vrai dry_run
      console.log('%c IBKR: ALWAYS ORANGE in cloud (expected)', 'color:#f59e0b;font-weight:bold');
      console.log(
        `%c → DRY_RUN=${dryRun} | Source: standalone_trader.dry_run=${rawStatus.standalone_trader?.dry_run ?? 'N/A'} | top-level=${rawStatus.dry_run ?? 'N/A'}`,
        'color:#94a3b8'
      );

      // SYS
      const _overallLog = status.overall;
      console.log(
        `%c SYS: ${_overallLog || 'unknown'} → dot ${_overallLog === 'healthy' ? 'GREEN' : _overallLog === 'degraded' ? 'ORANGE' : 'RED'}`,
        `color:${_overallLog === 'healthy' ? '#10b981' : _overallLog === 'degraded' ? '#f59e0b' : '#ef4444'};font-weight:bold`
      );

      // Standalone
      console.log(
        `%c Standalone: active=${standaloneOk} | cycle=#${rawStatus.standalone_trader?.cycle_total ?? '?'} | session=${sess} | signals=${rawStatus.standalone_trader?.signals_count ?? '?'}`,
        'color:#8b5cf6;font-weight:bold'
      );
      console.log(`%c Mode: ${status.mode || 'deterministic'} | DryRun: ${dryRun}`, 'color:#64748b');
      console.groupEnd();
    }

    // ── Variables DOM — multi-source ─────────────────────────────
    const llmAvail = rawStatus.llm_available !== undefined
                  ? rawStatus.llm_available
                  : rawStatus.llm?.gemini_proxy === true;

    // ✅ FIX — hubOk fallback sur standaloneOk
    const hubOk = _hasWorkers
      ? (_workersObj.finance_hub === true || _workersObj.finance_hub?.ok === true)
      : standaloneOk;

    const overall = status.overall;

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
    // ✅ LLM : WARN (jamais RED) — Gemini quota ≠ erreur système
    _setDot('llm',  llmAvail ? 'ok' : 'warn');
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
    if (pillIBKR) pillIBKR.title = `IBKR Paper Mode — DRY_RUN=${dryRun} | TWS unreachable from GitHub Actions (expected in cloud)`;
    if (pillSys)  pillSys.title  = `System: ${overall || 'unknown'} | Mode: ${status.mode || 'deterministic'} | Standalone: ${standaloneOk ? 'active ✓' : 'idle'}`;

    // ✅ FIX — Session badge depuis standalone_trader
    const sessEl = document.getElementById('session-badge');
    if (sessEl) {
      sessEl.textContent = sess.toUpperCase();
      sessEl.className   = `market-session ${sess}`;
    }

    // ✅ FIX — Dry run badge depuis standalone_trader
    const drEl = document.getElementById('dry-run-badge');
    if (drEl) {
      drEl.textContent = dryRun === false ? 'LIVE' : 'PAPER';
      drEl.className   = dryRun === false ? 'dry-run-badge live' : 'dry-run-badge';
    }

    // ✅ FIX — Sidebar session depuis standalone_trader
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
  // ════════════════════════════════════════════════════════
  // _updateAutoTradingBadge — FIX dry_run stale
  // Lit depuis standalone_trader.dry_run (source of truth)
  // car le top-level dry_run peut être stale (April 20)
  // ════════════════════════════════════════════════════════
  function _updateAutoTradingBadge(data) {
    const status  = data.status || {};
    const badge   = document.getElementById('auto-trading-badge');
    if (!badge) return;

    // ✅ FIX — Priorité : standalone_trader.dry_run > top-level dry_run
    // Le top-level peut être stale depuis le dernier run GitHub Actions
    const dryRun = status.standalone_trader?.dry_run
                ?? status.dry_run
                ?? true;

    // ✅ FIX — Session depuis standalone_trader si disponible
    const session = status.standalone_trader?.session
                || status.session
                || 'closed';

    const isMarketOpen = ['us_regular','us_premarket','us_postmarket',
                          'eu_regular','asia_regular','me_regular',
                          'regular','premarket','postmarket']
                          .includes(session);

    // ✅ Standalone actif = trading actif même sans session formelle
    const standaloneActive = status.standalone_trader?.active === true;
    const isActive = (isMarketOpen || standaloneActive) && !dryRun;

    badge.className = `auto-trading-badge ${isActive ? 'active' : 'inactive'}`;
    badge.title = isActive
      ? `Auto-trading ACTIVE — ${session} | Standalone v${status.standalone_trader?.version || '4.1'}`
      : dryRun
        ? `DRY_RUN actif — vérifier system_status.json (dry_run stale depuis April 20)`
        : `Market closed — session: ${session}`;

    // Last cycle depuis standalone_trader (plus précis)
    const lastCycleEl = document.getElementById('auto-last-cycle');
    if (lastCycleEl) {
      const lastCycle = status.standalone_trader?.last_cycle || status.timestamp;
      const cycleN    = status.standalone_trader?.cycle_total || '';
      lastCycleEl.textContent = lastCycle
        ? `Last cycle: ${_fmtTime(lastCycle)}${cycleN ? ` (#${cycleN})` : ''}`
        : 'Last cycle: --';
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
  // ════════════════════════════════════════════════════════
  // SIDEBAR WATCHLIST — Utilise la vraie watchlist user
  // ════════════════════════════════════════════════════════
  function _updateSidebarWatchlist(data) {
    const sigs = data.signals?.signals || {};
    const list = document.getElementById('sw-list');
    if (!list) return;

    // ✅ Source 1 : vraie watchlist de l'utilisateur (WatchlistManager)
    const wlSymbols = window.WatchlistManager ? WatchlistManager.getWatchlist() : [];

    // ✅ Source 2 : fallback sur les signaux ML, puis UNIVERSE hardcodé
    const symbols = wlSymbols.length
      ? wlSymbols.slice(0, 35)
      : (Object.keys(sigs).length ? Object.keys(sigs) : UNIVERSE);

    if (!symbols.length) {
      list.innerHTML = `<div class="sw-loading">
        <i class="fa-solid fa-circle-info" style="color:var(--b1)"></i>
        Watchlist empty
      </div>`;
      return;
    }

    list.innerHTML = symbols.map(sym => {
      // Prix depuis signaux ML (si disponible) ou placeholder
      const s     = sigs[sym] || {};
      const price = parseFloat(s.price || 0);
      const chg   = parseFloat(s.change_pct || s.change || 0);
      const dir   = s.direction || 'neutral';
      const cls   = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      const starred = window.WatchlistManager ? WatchlistManager.isStarred(sym) : false;

      const dirIcon = dir === 'buy'
        ? '<i class="fa-solid fa-arrow-up"></i>'
        : dir === 'sell'
          ? '<i class="fa-solid fa-arrow-down"></i>'
          : '<i class="fa-solid fa-minus"></i>';

      // Logo
      const logoHtml = typeof _getLogoHtml === 'function'
        ? _getLogoHtml(sym, 16)
        : '';

      return `<div class="sw-item" data-sym="${sym}">
        <div class="sw-sym-row">
          <div style="display:flex;align-items:center;gap:5px;overflow:hidden">
            ${logoHtml}
            <span class="sw-sym" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${sym}${starred ? ' <i class="fa-solid fa-star" style="font-size:7px;color:var(--y);vertical-align:middle"></i>' : ''}
            </span>
          </div>
          <span class="sw-dir ${dir}">${dirIcon}</span>
        </div>
        <div class="sw-price-row">
          <span class="sw-price mono ${cls}">
            ${price > 0 ? '$' + price.toFixed(2) : '<span style="color:var(--txt4);font-size:10px">No signal</span>'}
          </span>
          <span class="sw-chg mono ${cls}">
            ${price > 0 && chg !== 0 ? (chg > 0 ? '+' : '') + chg.toFixed(2) + '%' : ''}
          </span>
        </div>
      </div>`;
    }).join('');

    // Bind click → load chart + switch to overview
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
    if (name === 'charts') {
        // Rebuild si watchlist a changé ou si 1er accès
        const wl = window.WatchlistManager ? WatchlistManager.getWatchlist() : [];
        const currentCount = document.querySelectorAll('#charts-grid .chart-panel').length;
        const expectedCount = Math.min(Math.max(wl.length, 1), 10);

        if (!_panelsInited || currentCount !== expectedCount) {
            _panelsInited = true;
            _buildChartPanels();
            setTimeout(() => _initAllPanelCharts(), 200);
        }
    }

    if (name === 'execution') _refreshExecLog();
    if (name === 'software')  _initSoftwareSection();

    _renderSection(name, _state);
  }

  function _renderActiveSection(data) {
    _renderSection(_activeSection, data);
  }

  function _renderSection(name, data) {
    switch(name) {
      case 'software':    _renderSoftware(data);    break;
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

    // ✅ FIX — Lire dry_run, session, cycle depuis standalone_trader
    const dryRun        = status.standalone_trader?.dry_run ?? status.dry_run ?? true;
    const session       = status.standalone_trader?.session  || status.session || 'closed';
    const cycleN        = status.standalone_trader?.cycle_total;
    const standaloneActive = status.standalone_trader?.active === true;

    // ── Index Cards ──────────────────────────────────────────────
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

      if (price > 0) {
        const sparkData = _generateSparkData(price, 20);
        Charts.renderSparkline(`spark-${sym.toLowerCase()}`, sparkData, chg >= 0);
      }

      const card = document.getElementById(`card-${sym.toLowerCase()}`);
      if (card && !card.dataset.bound) {
        card.dataset.bound = '1';
        card.addEventListener('click', () => loadChartSymbol(sym));
      }
    });

    // ── Regime Card ──────────────────────────────────────────────
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

    // ── Signal KPIs ──────────────────────────────────────────────
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

    // ── Portfolio Snapshot ───────────────────────────────────────
    // ✅ FIX — total_value || net_liquidation (champ IBKR watcher)
    const val  = parseFloat(port.total_value || port.net_liquidation || 100000);
    const cash = parseFloat(port.cash_pct   || 1);
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

    // ── Health Grid ──────────────────────────────────────────────
    // LLM
    _txt('hg-llm', status.llm_available
      ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i> Available'
      : '<i class="fa-solid fa-gears"></i> Deterministic ML', true);

    // ✅ FIX — IBKR basé sur dryRun réel (standalone_trader)
    _txt('hg-ibkr', dryRun === false
      ? '<i class="fa-solid fa-plug" style="color:var(--g)"></i> Live Paper (auto-exec)'
      : '<i class="fa-solid fa-flask"></i> Paper Simulation', true);

    // ✅ FIX — Hub fallback sur standaloneActive si workers:{}
    const _workersObj = status.workers || {};
    const _hasWorkers = Object.keys(_workersObj).length > 0;
    const _hubOnline  = _hasWorkers
      ? (_workersObj.finance_hub === true || _workersObj.finance_hub?.ok === true)
      : standaloneActive;
    _txt('hg-hub', _hubOnline
      ? '<i class="fa-solid fa-circle-check" style="color:var(--g)"></i> Online'
      : '<i class="fa-solid fa-triangle-exclamation" style="color:var(--y)"></i> Offline', true);

    // ✅ FIX — Last cycle depuis standalone_trader (plus précis + numéro de cycle)
    const lastCycleTs = status.standalone_trader?.last_cycle
                    || data.signals?.timestamp;
    const cycleLabel  = cycleN != null ? ` · cycle #${cycleN}` : '';
    _txt('hg-last', lastCycleTs ? `${_fmtTime(lastCycleTs)}${cycleLabel}` : '--');

    // ── Strategy Donut (mini) ────────────────────────────────────
    Charts.renderStrategyDonutMini('ov-strategy-donut', sw);

    // ── Top Signals Table (max 8) ────────────────────────────────
    _renderSignalsTable('ov-signals-tbody', sigs, 8, false);

    // ── Overview Charts (lazy init) ──────────────────────────────
    if (!_ovChartsInited) {
      setTimeout(_buildOvCharts, 300);
    }
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
    // ✅ FIX ROOT CAUSE — Délègue entièrement à WatchlistManager
    // WatchlistManager gère : étoiles, delete, detail, secteurs, pagination
    WatchlistManager.render(data.signals || {});

    // Update symbol count
    const wl    = WatchlistManager.getWatchlist();
    const total = WatchlistManager.getTotalCount();
    const c1    = document.getElementById('wl-sym-count');
    const c2    = document.getElementById('wl-sym-count');
    [c1, c2].forEach(el => {
        if (el) el.textContent = `${wl.length} symbols in watchlist`;
    });
    }

    function filterWatchlist() {
    // Délègue la recherche à WatchlistManager
    const q = document.getElementById('wl-search')?.value?.trim() || '';
    WatchlistManager._currentSearch = q;
    WatchlistManager._currentPage   = 1;
    WatchlistManager.render(_state.signals || {});
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
        ? `<td><button class="btn-xs sig-chart-btn" data-sym="${sym}">
                <i class="fa-solid fa-chart-bar"></i>
            </button></td>`
        : '';

        // Logo
        const logoHtml = typeof _getLogoHtml === 'function'
        ? _getLogoHtml(sym, 18)
        : `<span class="sym-initial-badge" style="width:18px;height:18px;font-size:8px">${sym.charAt(0)}</span>`;

        return `<tr>
        <td>
            <div class="sym-with-logo">
            ${logoHtml}
            <strong class="sym-link sig-sym" data-sym="${sym}">${sym}</strong>
            </div>
        </td>
        <td class="mono">${price > 0 ? '$' + price.toFixed(2) : '--'}</td>
        <td>${dirBadge}</td>
        <td>
            <div class="score-bar-inline">
            <div class="sbi-fill" style="width:${(score*100).toFixed(0)}%;background:${scolor}"></div>
            </div>
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
        signal_model:       'fa-brain',
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
    // ✅ FIX — Utilise la variable locale, pas le select (qui peut rester "SPY")
    const sym = _currentChartSym || document.getElementById('ov-symbol')?.value || 'SPY';
    const interval = _currentIv;

    // Sync UI
    _txt('main-chart-title', `${sym} — ${interval}`);
    _txt('ta-sym', sym);   // ← TA panel header synced aussi

    if (!_mainInited) {
      Charts.initPriceChart('main-price-chart', { height: 360 });
      _mainInited = true;
    }

    const candles = await _fetchChartData(sym, interval);
    if (candles.length) {
      Charts.updatePriceChart(
        candles.map(c => ({
          datetime: new Date(c.time * 1000).toISOString(),
          open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0,
        })), {}
      );

      const analysis = _analyzeTA(candles, sym);
      if (analysis) {
        _renderTechnicalAnalysis(analysis);
      }
    }
  }

  function loadChartSymbol(sym) {
    if (!sym) return;
    sym = sym.toUpperCase();

    // ✅ FIX — Mise à jour de la variable locale EN PREMIER
    _currentChartSym = sym;

    // Sync select caché (avec ajout d'option si nécessaire)
    const sel = document.getElementById('ov-symbol');
    if (sel) {
      if (!sel.querySelector(`option[value="${sym}"]`)) {
        const opt = document.createElement('option');
        opt.value = sym; opt.textContent = sym;
        sel.appendChild(opt);
      }
      sel.value = sym;
    }

    // Sync widget visuel overview
    const ovHost = document.getElementById('ov-symbol-widget-host');
    if (ovHost?._widgetApi) {
      // pick() sans déclencher le callback (évite double load)
      const tag      = ovHost.querySelector('.sym-widget-tag');
      const clearBtn = ovHost.querySelector('.sym-widget-clear');
      if (tag)      { tag.textContent = sym; tag.style.display = 'inline-flex'; }
      if (clearBtn) clearBtn.style.display = 'flex';
      // Forcer la valeur interne du widget
      ovHost._widgetApi.pick && (ovHost._widgetApi._sym = sym);
    } else {
      const tag      = document.querySelector('#ov-symbol-widget-host .sym-widget-tag');
      const clearBtn = document.querySelector('#ov-symbol-widget-host .sym-widget-clear');
      if (tag)      { tag.textContent = sym; tag.style.display = 'inline-flex'; }
      if (clearBtn) clearBtn.style.display = 'flex';
    }

    // ✅ Load du chart avec le nouveau ticker
    _loadMainChart(true);

    // ✅ Sync formulaire d'ordre (buy/sell)
    const orderSel = document.getElementById('order-symbol');
    if (orderSel) {
      if (!orderSel.querySelector(`option[value="${sym}"]`)) {
        const opt = document.createElement('option');
        opt.value = sym; opt.textContent = sym;
        orderSel.appendChild(opt);
      }
      orderSel.value = sym;
    }

    // Sync widget order form
    const orHost = document.getElementById('order-symbol-widget-host');
    if (orHost?._widgetApi) {
      const tag      = orHost.querySelector('.sym-widget-tag');
      const clearBtn = orHost.querySelector('.sym-widget-clear');
      if (tag)      { tag.textContent = sym; tag.style.display = 'inline-flex'; }
      if (clearBtn) clearBtn.style.display = 'flex';
    }

    // ✅ Sync TA panel header
    _txt('ta-sym', sym);

    // ✅ Afficher le signal ML du ticker dans un toast discret
    const sig = _state.signals?.signals?.[sym];
    if (sig) {
      const dir   = sig.direction || 'neutral';
      const score = parseFloat(sig.final_score || 0).toFixed(3);
      const price = parseFloat(sig.price || 0);
      const icon  = dir === 'buy' ? '▲' : dir === 'sell' ? '▼' : '●';
      _showToast(
        `${sym} — ${icon} ${dir.toUpperCase()} | Score: ${score} | $${price > 0 ? price.toFixed(2) : '--'}`,
        dir === 'buy' ? 'success' : dir === 'sell' ? 'error' : 'info',
        3000
      );
    }
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

      const n = _getChartSymbols().length;

      if (layout === '1') {
          grid.className = 'charts-grid layout-1';
      } else if (layout === '2x3') {
          grid.className = 'charts-grid layout-2-3';
      } else {
          // Auto : choisit selon le nombre de symboles
          grid.className = `charts-grid ${
              n <= 2 ? 'layout-1'   :
              n <= 4 ? 'layout-2-2' :
              n <= 6 ? 'layout-2-3' : 'layout-2-5'
          }`;
      }

      // ✅ FIX : utilise _getChartSymbols() au lieu de cp-sym-N inexistants
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

    const sym    = document.getElementById('order-symbol')?.value?.toUpperCase() || 'SPY';
    const qty    = parseInt(document.getElementById('order-qty')?.value    || 10);
    const type   = document.getElementById('order-type')?.value            || 'MKT';
    const limit  = parseFloat(document.getElementById('order-limit')?.value || 0);
    const stop   = parseFloat(document.getElementById('order-stop')?.value  || 0);
    const reason = document.getElementById('order-reason')?.value
                || 'Manual order from dashboard';
    const dryRun = document.getElementById('order-dry-run')?.checked ?? true;

    // ── Order Preview ─────────────────────────────────────────
    const preview        = document.getElementById('order-preview');
    const previewContent = document.getElementById('order-preview-content');
    if (preview && previewContent) {
      preview.style.display = 'block';
      previewContent.innerHTML = `
        <div class="preview-row">
          <span>Symbol</span><strong>${sym}</strong>
        </div>
        <div class="preview-row">
          <span>Side</span>
          <strong class="${_currentSide.toLowerCase()}">${_currentSide}</strong>
        </div>
        <div class="preview-row">
          <span>Quantity</span><strong>${qty}</strong>
        </div>
        <div class="preview-row">
          <span>Type</span><strong>${type}</strong>
        </div>
        ${limit > 0 ? `
          <div class="preview-row">
            <span>Limit</span><strong class="mono">$${limit}</strong>
          </div>` : ''}
        ${stop > 0 ? `
          <div class="preview-row">
            <span>Stop</span><strong class="mono">$${stop}</strong>
          </div>` : ''}
        <div class="preview-row">
          <span>Mode</span>
          <strong style="color:${dryRun ? 'var(--y)' : 'var(--g)'}">
            ${dryRun ? 'PAPER TRADE' : 'LIVE TRADE'}
          </strong>
        </div>
        <div class="preview-row">
          <span>Auth</span>
          <strong style="color:var(--g)">
            <i class="fa-solid fa-shield-halved"></i> Cloudflare Worker (secured)
          </strong>
        </div>`;
    }

    const btn = document.getElementById('btn-submit-order');
    if (btn) {
      btn.disabled  = true;
      btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Submitting...';
    }

    try {
      // ── Dispatch via Worker (PAT stocké côté Cloudflare) ──────
      const resp = await fetch(`${WORKER_URL}/dispatch-order`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          symbol:      sym,
          action:      _currentSide,
          quantity:    qty,
          order_type:  type,
          limit_price: limit || '',
          stop_price:  stop  || '',
          dry_run:     dryRun,
          reason,
        }),
        signal: AbortSignal.timeout(15000),
      });

      const result = await resp.json().catch(() => ({}));

      if (resp.ok && result.success) {
        _showOrderStatus('success',
          `✅ Order dispatched: ${_currentSide} ${qty}x ${sym} @ ${type} — ` +
          `<a href="https://github.com/${GH_OWNER}/${GH_REPO}/actions" target="_blank"
              style="color:var(--g)">` +
          `View on GitHub <i class="fa-solid fa-external-link-alt"></i></a>`
        );
        _showToast(`Order dispatched: ${_currentSide} ${qty}x ${sym}`, 'success');
        setTimeout(_refreshExecLog, 30000);
        setTimeout(() => _refresh(true), 35000);

      } else {
        // Erreurs Worker ou GitHub
        const msg = result.error || `HTTP ${resp.status}`;
        _showOrderStatus('error', `❌ ${msg}`);
        _showToast(`Order failed: ${msg}`, 'error');
      }

    } catch(err) {
      _showOrderStatus('error', `❌ Network error: ${err.message}`);
      _showToast('Network error — check your connection', 'error');
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
    // CHARTS SECTION — 6 panels dynamiques
    // ════════════════════════════════════════════════════════

    const CHART_SYMBOLS_OPTIONS = [
    { g:'ETFs',       s:['SPY','QQQ','IWM','DIA','GLD','TLT','HYG','SMH','XLF','XLK','XLE','XLV','ARKK','TQQQ','SOXL'] },
    { g:'Mega Tech',  s:['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AMD','INTC','QCOM','MU','CRM','ADBE','NOW'] },
    { g:'Financials', s:['JPM','GS','BAC','MS','V','MA','BLK','COIN','PYPL','SCHW','CME','ICE','NDAQ'] },
    { g:'Healthcare', s:['UNH','LLY','JNJ','ABBV','MRK','TMO','AMGN','GILD','VRTX','MRNA','PFE','MDT','ISRG'] },
    { g:'Energy',     s:['XOM','CVX','COP','EOG','SLB','OXY','DVN','MPC','VLO','LNG','KMI','WMB'] },
    { g:'Consumer',   s:['HD','MCD','NKE','SBUX','COST','WMT','AMZN','BKNG','TJX','ROST','CMG'] },
    { g:'Industrial', s:['HON','CAT','DE','LMT','BA','RTX','NOC','GE','EMR','UPS','FDX','NSC','UNP'] },
    { g:'Crypto',     s:['COIN','MSTR','RIOT','MARA','BTBT','HUT'] },
    ];

    const PANEL_DEFAULTS = ['SPY','QQQ','AAPL','NVDA','GS','TSLA'];

    // ── Symboles par défaut si watchlist vide ────────────────
    const CHART_SYMBOLS_DEFAULTS_10 = [
    'SPY','QQQ','IWM','AAPL','NVDA','MSFT','GOOGL','AMZN','META','TSLA'
    ];

    // ── Récupère les symboles à afficher (watchlist ou défauts) ──
    function _getChartSymbols() {
    const wl = window.WatchlistManager ? WatchlistManager.getWatchlist() : [];
    return wl.length > 0
        ? wl.slice(0, 10)
        : CHART_SYMBOLS_DEFAULTS_10;
    }

    function _buildChartPanels() {
        const grid = document.getElementById('charts-grid');
        if (!grid) return;

        const symbols = _getChartSymbols();
        const n       = symbols.length;
        const fromWL  = window.WatchlistManager && WatchlistManager.getWatchlist().length > 0;

        const layoutClass = n <= 2  ? 'layout-1'
                          : n <= 6  ? 'layout-2-2'
                          :           'layout-2-5';
        grid.className = `charts-grid ${layoutClass}`;

        const existingBanner = document.getElementById('charts-wl-banner');
        if (existingBanner) existingBanner.remove();
        const banner = document.createElement('div');
        banner.id = 'charts-wl-banner';
        banner.className = 'charts-wl-banner';
        banner.innerHTML = fromWL
            ? `<i class="fa-solid fa-list-ul"></i>
              <span>Displaying <strong>${n} symbols</strong> from your watchlist</span>
              <button class="btn-sm" id="btn-refresh-chart-panels" style="margin-left:auto;font-size:11px">
                <i class="fa-solid fa-rotate"></i> Refresh
              </button>`
            : `<i class="fa-solid fa-info-circle"></i>
              <span>Empty watchlist — <strong>10 default symbols</strong> displayed.
              Add symbols in the <em>Watchlist</em> tab.</span>
              <button class="btn-sm" id="btn-refresh-chart-panels" style="margin-left:auto;font-size:11px">
                <i class="fa-solid fa-rotate"></i> Refresh
              </button>`;
        grid.parentElement.insertBefore(banner, grid);

        grid.innerHTML = symbols.map((sym, i) => {
            const logoHtml = _getLogoHtml(sym, 18);
            return `
            <div class="chart-panel" id="chart-panel-${i}">
                <div class="cp-header">
                    <div class="cp-logo-sym">
                        ${logoHtml}
                        <span>${sym}</span>
                    </div>
                    <div class="cp-header-right">
                        <div class="cp-itabs" data-panel="${i}">
                            <button class="cp-itab" data-iv="1h">1H</button>
                            <button class="cp-itab active" data-iv="1day">1D</button>
                            <button class="cp-itab" data-iv="1week">1W</button>
                        </div>
                        <button class="btn-quant-modal" data-qmsym="${sym}" title="Analyse quantitative">
                            <i class="fa-solid fa-flask"></i>
                        </button>
                    </div>
                </div>
                <div class="cp-chart" id="chart-container-${i}"></div>
            </div>`;
        }).join('');

        // ── Bind interval tabs ──────────────────────────────────
        document.querySelectorAll('.cp-itabs').forEach(container => {
            const panelIdx = parseInt(container.dataset.panel ?? '0');
            container.querySelectorAll('.cp-itab').forEach(btn => {
                btn.addEventListener('click', () => {
                    container.querySelectorAll('.cp-itab').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    _panelIv[panelIdx] = btn.dataset.iv;
                    const sym = symbols[panelIdx] || CHART_SYMBOLS_DEFAULTS_10[0];
                    _loadPanelChart(panelIdx, sym);
                });
            });
        });

        // ── Bind quant modal buttons ────────────────────────────
        document.querySelectorAll('.btn-quant-modal').forEach(btn => {
            btn.addEventListener('click', () => openQuantModal(btn.dataset.qmsym));
        });

        // ── Bind sync all ───────────────────────────────────────
        const syncBtn = document.getElementById('btn-sync-all');
        if (syncBtn) syncBtn.onclick = () => _initAllPanelCharts();

        // ── Bind refresh banner ─────────────────────────────────
        const refreshBtn = document.getElementById('btn-refresh-chart-panels');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                _buildChartPanels();
                setTimeout(() => _initAllPanelCharts(), 100);
            });
        }

        // ✅ FIX Bug #5 — PAS de binding chart-layout ici (déjà dans _bindEvents)
    }

    function _setChartLayout(layout) {
    const grid = document.getElementById('charts-grid');
    if (!grid) return;
    grid.className = `charts-grid ${
        layout === '1'   ? 'layout-1' :
        layout === '2x3' ? 'layout-2-3' :
                        'layout-2-2'
    }`;
    setTimeout(() => {
        for (let i = 0; i < 6; i++) {
        const sym = document.getElementById(`cp-sym-${i}`)?.value || PANEL_DEFAULTS[i];
        _loadPanelChart(i, sym);
        }
    }, 100);
    }

    // Remplace l'ancienne _initAllPanelCharts
    async function _initAllPanelCharts() {
        const symbols = _getChartSymbols();
        for (let i = 0; i < symbols.length; i++) {
            await _loadPanelChart(i, symbols[i]);
        }
    }

    // ════════════════════════════════════════════════════════
    // QUANT ANALYSIS MODAL
    // ════════════════════════════════════════════════════════
    function openQuantModal(sym) {
    if (!sym) return;
    sym = sym.toUpperCase();

    const modal = document.getElementById('quant-modal');
    if (!modal) return;

    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Header
    _txt('qm-sym',  sym);
    _txt('qm-name', WatchlistManager.getSymbolMeta(sym)?.name || sym);

    // Prix depuis l'état courant
    const sigs  = _state.signals?.signals || {};
    const sig   = sigs[sym] || {};
    const price = parseFloat(sig.price || 0);
    const chg   = parseFloat(sig.change_pct || 0);

    _txt('qm-price', price > 0 ? `$${price.toFixed(2)}` : '--');
    const chgEl = document.getElementById('qm-change');
    if (chgEl) {
        chgEl.textContent = price > 0 ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '--';
        chgEl.className   = `qm-change ${chg >= 0 ? 'up' : 'down'}`;
    }

    // Init tabs
    document.querySelectorAll('.qm-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.qmtab === 'signal');
        t.addEventListener('click', () => {
        document.querySelectorAll('.qm-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        _renderQuantTab(sym, t.dataset.qmtab);
        });
    });

    // Render first tab
    _renderQuantTab(sym, 'signal');
    }

    function closeQuantModal() {
    const modal = document.getElementById('quant-modal');
    if (modal) modal.style.display = 'none';
    document.body.style.overflow = '';
    }

    function _renderQuantTab(sym, tab) {
    const body = document.getElementById('qm-body');
    if (!body) return;

    const sigs  = _state.signals?.signals || {};
    const sig   = sigs[sym] || {};
    const regime= _state.regime?.per_symbol?.[sym] || _state.regime?.global || {};
    const risk  = _state.risk || {};
    const agents= _state.agents?.decisions?.[sym] || {};

    switch(tab) {
        case 'signal':    body.innerHTML = _quantTabSignal(sym, sig, agents);    break;
        case 'technicals':body.innerHTML = _quantTabTechnicals(sym, sig);        break;
        case 'regime':    body.innerHTML = _quantTabRegime(sym, regime);         break;
        case 'risk':      body.innerHTML = _quantTabRisk(sym, sig, risk);        break;
        case 'structure': body.innerHTML = _quantTabStructure(sym, sig, agents); break;
        default:          body.innerHTML = `<div class="qm-loading">Tab not found</div>`;
    }
    }

    function _qCard(label, value, icon = 'fa-chart-line', color = 'var(--b1)', sub = '') {
    return `<div class="qm-metric-card">
        <div class="qm-metric-lbl">
        <i class="fa-solid ${icon}" style="color:${color}"></i> ${label}
        </div>
        <div class="qm-metric-val" style="color:${color}">${value}</div>
        ${sub ? `<div style="font-size:9px;color:var(--txt4);margin-top:2px">${sub}</div>` : ''}
    </div>`;
    }

    function _quantTabSignal(sym, sig, agents) {
    const score   = parseFloat(sig.final_score  || 0);
    const conf    = parseFloat(sig.confidence   || sig.adjusted_confidence || 0);
    const bp      = parseFloat(sig.buy_prob     || sig.adjusted_buy_prob  || 0.5);
    const sp      = 1 - bp;
    const dir     = sig.direction   || 'neutral';
    const council = sig.council     || agents?.council?.decision || 'wait';
    const action  = sig.trade_action || 'wait';
    const evol    = parseFloat(sig.expected_ret || 0);
    const evol_vol= parseFloat(sig.expected_vol || sig.adjusted_vol || 0.15);
    const model   = sig.model_used  || 'ensemble_ml';

    const cColor  = dir === 'buy' ? 'var(--g)' : dir === 'sell' ? 'var(--r)' : 'var(--txt3)';
    const sColor  = score > 0.65 ? 'var(--g)' : score > 0.40 ? 'var(--y)' : 'var(--txt3)';
    const cncColor= council.includes('execute') ? 'var(--g)' : council === 'veto' ? 'var(--r)' : 'var(--y)';

    const dirBadgeLarge = dir === 'buy'
        ? `<span class="dir-badge buy" style="font-size:14px;padding:6px 16px">
            <i class="fa-solid fa-arrow-up"></i> BUY
        </span>`
        : dir === 'sell'
        ? `<span class="dir-badge sell" style="font-size:14px;padding:6px 16px">
            <i class="fa-solid fa-arrow-down"></i> SELL
            </span>`
        : `<span class="dir-badge neutral" style="font-size:14px;padding:6px 16px">
            <i class="fa-solid fa-minus"></i> NEUTRAL
            </span>`;

    return `
        <div class="qm-section-title"><i class="fa-solid fa-brain"></i> ML Ensemble Signal</div>

        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;flex-wrap:wrap">
        ${dirBadgeLarge}
        <div>
            <div style="font-size:11px;color:var(--txt3);margin-bottom:3px">Council Decision</div>
            <strong style="font-size:14px;color:${cncColor};font-family:var(--mono)">
            ${council.toUpperCase()}
            </strong>
        </div>
        <div>
            <div style="font-size:11px;color:var(--txt3);margin-bottom:3px">Trade Action</div>
            <strong style="font-size:12px;color:var(--txt);font-family:var(--mono)">
            ${action.toUpperCase()}
            </strong>
        </div>
        <div style="margin-left:auto;font-size:10px;color:var(--txt4);text-align:right">
            Model: <strong>${model}</strong><br>
            Ensemble: XGBoost + LightGBM + LogReg
        </div>
        </div>

        <div class="qm-metrics-grid">
        ${_qCard('Final Score',    score.toFixed(4),             'fa-star-half-stroke', sColor, 'Composite ML score [0,1]')}
        ${_qCard('Confidence',     `${(conf*100).toFixed(1)}%`,  'fa-gauge',            conf>0.6?'var(--g)':'var(--y)', 'Signal reliability')}
        ${_qCard('Buy Probability',`${(bp*100).toFixed(1)}%`,    'fa-arrow-up',         'var(--g)', 'P(price up in 5d)')}
        ${_qCard('Sell Probability',`${(sp*100).toFixed(1)}%`,   'fa-arrow-down',       'var(--r)', 'P(price down in 5d)')}
        ${_qCard('Expected Return',`${evol>=0?'+':''}${(evol*100).toFixed(2)}%`, 'fa-chart-line', evol>=0?'var(--g)':'var(--r)', 'ML return estimate')}
        ${_qCard('Expected Vol',   `${(evol_vol*100).toFixed(1)}%`, 'fa-wave-square',   'var(--y)', 'Expected volatility')}
        </div>

        <div class="qm-section-title"><i class="fa-solid fa-gauge-high"></i> Confidence Breakdown</div>
        <div style="margin-bottom:12px">
        ${[
            { l:'Buy Prob',    v:bp,   c:'var(--g)' },
            { l:'Confidence',  v:conf, c:'var(--b1)' },
            { l:'Final Score', v:score,c:sColor },
        ].map(m => `
            <div class="qm-feat-row">
            <span class="qm-feat-name">${m.l}</span>
            <div class="qm-feat-bar-wrap">
                <div class="qm-feat-bar" style="width:${(m.v*100).toFixed(1)}%;background:${m.c}"></div>
            </div>
            <span class="qm-feat-val" style="color:${m.c}">${(m.v*100).toFixed(1)}%</span>
            </div>`).join('')}
        </div>`;
    }

    function _quantTabTechnicals(sym, sig) {
    // Features extraits du signal (si disponibles)
    const feat = sig.features || {};

    const items = [
        { l:'RSI (14)',        v:feat.rsi_14,          fmt: v => v.toFixed(1),
        color: v => v>70?'var(--r)':v<30?'var(--g)':'var(--txt)', note:'Overbought>70 / Oversold<30' },
        { l:'RSI Normalized',  v:feat.rsi_norm,        fmt: v => v.toFixed(3),
        color: v => v>0.2?'var(--g)':v<-0.2?'var(--r)':'var(--txt)', note:'[-1, 1] centered on 0' },
        { l:'RSI Divergence',  v:feat.rsi_divergence,  fmt: v => v.toFixed(1),
        color: v => v>0?'var(--g)':v<0?'var(--r)':'var(--txt)', note:'+1 bullish / -1 bearish' },
        { l:'MACD Histogram',  v:feat.macd_hist,       fmt: v => v.toFixed(4),
        color: v => v>0?'var(--g)':'var(--r)', note:'Normalized by price std' },
        { l:'MACD Acceleration',v:feat.macd_acceleration,fmt: v => v.toFixed(4),
        color: v => v>0?'var(--g)':'var(--r)', note:'2nd derivative of MACD' },
        { l:'MACD Crossover',  v:feat.macd_crossover,  fmt: v => v===1?'Bullish':v===-1?'Bearish':'None',
        color: v => v>0?'var(--g)':v<0?'var(--r)':'var(--txt)', note:'+1 bullish / -1 bearish' },
        { l:'BB Position',     v:feat.bb_position,     fmt: v => v.toFixed(3),
        color: v => v>0.5?'var(--r)':v<-0.5?'var(--g)':'var(--txt)', note:'[-1=lower, 0=mid, 1=upper]' },
        { l:'BB Squeeze',      v:feat.bb_squeeze,      fmt: v => v===1?'SQUEEZE':'Normal',
        color: v => v===1?'var(--y)':'var(--txt)', note:'Bands tight = breakout soon' },
        { l:'EMA 50 Slope',    v:feat.ema_50_slope,    fmt: v => v.toFixed(4),
        color: v => v>0?'var(--g)':'var(--r)', note:'EMA trend direction' },
        { l:'EMA 200 Slope',   v:feat.ema_200_slope,   fmt: v => v.toFixed(4),
        color: v => v>0?'var(--g)':'var(--r)', note:'Long-term trend' },
        { l:'EMA 21 Curvature',v:feat.ema21_curvature, fmt: v => v.toFixed(4),
        color: v => v>0?'var(--g)':'var(--r)', note:'Acceleration of EMA 21' },
        { l:'VWAP Deviation',  v:feat.vwap_deviation,  fmt: v => v.toFixed(4),
        color: v => v>0.1?'var(--r)':v<-0.1?'var(--g)':'var(--txt)', note:'Price vs VWAP 20D' },
        { l:'ATR % Rank',      v:feat.atr_pct_rank,    fmt: v => `${(v*100).toFixed(0)}th pct`,
        color: v => v>0.75?'var(--r)':v<0.25?'var(--g)':'var(--txt)', note:'Volatility percentile (252D)' },
        { l:'Momentum 20D',    v:feat.momentum_20d,    fmt: v => `${(v*100).toFixed(2)}%`,
        color: v => v>0?'var(--g)':'var(--r)', note:'20-day price momentum' },
        { l:'Momentum Align',  v:feat.momentum_alignment, fmt: v => v===1?'All Up':v===-1?'All Down':'Mixed',
        color: v => v>0?'var(--g)':v<0?'var(--r)':'var(--y)', note:'5D/20D/60D alignment' },
    ].filter(i => i.v != null && !isNaN(i.v));

    if (!items.length) {
        return `<div class="qm-loading" style="min-height:150px">
        <i class="fa-solid fa-circle-info" style="color:var(--b1)"></i>
        Technical features not available — run a full signal cycle with this symbol in the universe.
        </div>`;
    }

    return `
        <div class="qm-section-title"><i class="fa-solid fa-chart-line"></i> Technical Features (ML Input)</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;margin-bottom:20px">
        ${items.map(i => {
            const v     = i.v;
            const color = typeof i.color === 'function' ? i.color(v) : 'var(--txt)';
            return `<div class="qm-metric-card">
            <div class="qm-metric-lbl">${i.l}</div>
            <div class="qm-metric-val" style="font-size:14px;color:${color}">${i.fmt(v)}</div>
            <div style="font-size:9px;color:var(--txt4);margin-top:2px">${i.note}</div>
            </div>`;
        }).join('')}
        </div>

        <div class="qm-section-title"><i class="fa-solid fa-wave-square"></i> Volatility Profile</div>
        <div class="qm-metrics-grid">
        ${_qCard('RVol 5D',  feat.rvol_5d  != null ? `${(feat.rvol_5d *100).toFixed(1)}%` : '--', 'fa-bolt',        'var(--y)', 'Realized vol 5D ann.')}
        ${_qCard('RVol 21D', feat.rvol_21d != null ? `${(feat.rvol_21d*100).toFixed(1)}%` : '--', 'fa-chart-area',  'var(--b1)','Realized vol 21D ann.')}
        ${_qCard('RVol 63D', feat.rvol_63d != null ? `${(feat.rvol_63d*100).toFixed(1)}%` : '--', 'fa-chart-area',  'var(--b2)','Realized vol 63D ann.')}
        ${_qCard('Skewness', feat.skewness_21d != null ? feat.skewness_21d.toFixed(3) : '--',      'fa-wave-square', feat.skewness_21d>0?'var(--g)':'var(--r)', 'Return distribution skew')}
        ${_qCard('Kurtosis', feat.kurtosis_21d != null ? feat.kurtosis_21d.toFixed(3) : '--',      'fa-triangle-exclamation', 'var(--o)', 'Fat tails indicator')}
        </div>`;
    }

    function _quantTabRegime(sym, regime) {
    const rl    = regime.regime_label  || 'unknown';
    const rs    = parseFloat(regime.regime_score || 0);
    const conf  = parseFloat(regime.confidence   || 0);
    const probs = regime.probabilities || {};

    const regimeColors = {
        trend_up:'var(--g)', trend_down:'var(--r)', range_bound:'var(--txt3)',
        low_volatility:'var(--c)', high_volatility:'var(--y)', crash:'#dc2626',
        macro_tightening:'var(--o)', macro_easing:'var(--b2)', initializing:'var(--txt4)',
    };
    const color = regimeColors[rl] || 'var(--txt)';

    return `
        <div class="qm-section-title"><i class="fa-solid fa-crosshairs"></i> Market Regime Detection</div>

        <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px;flex-wrap:wrap">
        <div style="text-align:center;padding:16px 24px;border-radius:12px;
                    background:${color}15;border:2px solid ${color}50;min-width:160px">
            <div style="font-size:24px;font-weight:900;color:${color};font-family:var(--mono)">
            ${rl.replace(/_/g,' ').toUpperCase()}
            </div>
            <div style="font-size:11px;color:var(--txt3);margin-top:4px">Current Regime</div>
        </div>
        <div>
            <div style="font-size:11px;color:var(--txt3);margin-bottom:2px">Regime Score</div>
            <div style="font-size:22px;font-weight:800;color:${rs>=0?'var(--g)':'var(--r)'};font-family:var(--mono)">
            ${rs>=0?'+':''}${rs.toFixed(3)}
            </div>
        </div>
        <div>
            <div style="font-size:11px;color:var(--txt3);margin-bottom:2px">Confidence</div>
            <div style="font-size:22px;font-weight:800;color:var(--b1);font-family:var(--mono)">
            ${(conf*100).toFixed(0)}%
            </div>
        </div>
        </div>

        <div class="qm-metrics-grid">
        ${_qCard('Long Allowed',  regime.allow_long?'Yes':'No',  'fa-arrow-up',   regime.allow_long?'var(--g)':'var(--r)')}
        ${_qCard('Short Allowed', regime.allow_short?'Yes':'No', 'fa-arrow-down', regime.allow_short?'var(--g)':'var(--r)')}
        ${_qCard('Reduce Exp.',   regime.reduce_exposure?'Yes':'No', 'fa-compress', regime.reduce_exposure?'var(--y)':'var(--g)')}
        ${_qCard('Leverage OK',   regime.leverage_allowed?'Yes':'No','fa-chart-line', regime.leverage_allowed?'var(--g)':'var(--y)')}
        ${_qCard('Favor Options', regime.favor_options?'Yes':'No',   'fa-shapes',   'var(--b2)')}
        </div>

        ${Object.keys(probs).length ? `
        <div class="qm-section-title"><i class="fa-solid fa-chart-bar"></i> Regime Probabilities</div>
        ${Object.entries(probs).sort((a,b)=>b[1]-a[1]).map(([r, p]) => `
            <div class="qm-feat-row">
            <span class="qm-feat-name" style="font-size:11px">${r.replace(/_/g,' ')}</span>
            <div class="qm-feat-bar-wrap">
                <div class="qm-feat-bar"
                    style="width:${(parseFloat(p)*100).toFixed(1)}%;background:${regimeColors[r]||'var(--b1)'}"></div>
            </div>
            <span class="qm-feat-val" style="color:${regimeColors[r]||'var(--b1)'}">${(parseFloat(p)*100).toFixed(1)}%</span>
            </div>`).join('')}
        ` : `<div style="color:var(--txt4);font-size:12px;text-align:center;padding:20px">
        Regime probabilities not available for this symbol
        </div>`}`;
    }

    function _quantTabRisk(sym, sig, risk) {
    const feat    = sig.features || {};
    const hurst   = parseFloat(feat.hurst_exponent || 0);
    const vr      = parseFloat(feat.variance_ratio || 0);
    const atr     = parseFloat(feat.atr_pct        || 0);
    const atrRank = parseFloat(feat.atr_pct_rank   || 0.5);
    const dd      = risk.drawdown  || {};
    const lev     = risk.leverage  || {};

    const hurstColor  = hurst > 0.55 ? 'var(--g)' : hurst < 0.45 ? 'var(--r)' : 'var(--y)';
    const hurstInterp = hurst > 0.55 ? 'Trending (momentum)' : hurst < 0.45 ? 'Mean-reverting' : 'Random walk';

    const vrColor    = vr > 0.1 ? 'var(--g)' : vr < -0.1 ? 'var(--r)' : 'var(--y)';
    const vrInterp   = vr > 0.1 ? 'Momentum dominant' : vr < -0.1 ? 'Mean-reversion dominant' : 'Near random';

    return `
        <div class="qm-section-title"><i class="fa-solid fa-shield-halved"></i> Quantitative Risk Metrics</div>
        <div class="qm-metrics-grid">
        ${_qCard('Hurst Exponent', hurst>0?hurst.toFixed(3):'--', 'fa-wave-square', hurstColor, hurstInterp)}
        ${_qCard('Variance Ratio', vr!==0?`${vr>=0?'+':''}${vr.toFixed(3)}`:'--', 'fa-chart-area', vrColor, vrInterp)}
        ${_qCard('ATR %',          atr>0?`${(atr*100).toFixed(2)}%`:'--',   'fa-expand', 'var(--o)', 'Daily range / price')}
        ${_qCard('ATR Percentile', atrRank>0?`${(atrRank*100).toFixed(0)}th`:'--', 'fa-gauge', atrRank>0.75?'var(--r)':atrRank<0.25?'var(--g)':'var(--y)', '252-day lookback')}
        ${_qCard('GARCH Forecast', feat.garch_forecast>0?`${(feat.garch_forecast*100).toFixed(1)}%`:'--', 'fa-brain', 'var(--b1)', 'GARCH(1,1) vol forecast')}
        ${_qCard('IV Rank',        feat.iv_rank!=null?`${(feat.iv_rank*100).toFixed(0)}th`:'--', 'fa-bolt', feat.iv_rank>0.7?'var(--r)':'var(--b1)', 'Implied Vol rank')}
        </div>

        <div class="qm-section-title"><i class="fa-solid fa-chart-area"></i> Portfolio Risk (Global)</div>
        <div class="qm-metrics-grid">
        ${_qCard('Drawdown',    `${((parseFloat(dd.current_drawdown||0))*100).toFixed(2)}%`, 'fa-arrow-trend-down', Math.abs(parseFloat(dd.current_drawdown||0))>0.05?'var(--r)':'var(--g)', 'Current portfolio DD')}
        ${_qCard('Leverage',    `${parseFloat(lev.current_leverage||0).toFixed(2)}x`, 'fa-layer-group', 'var(--b1)', `Max: ${parseFloat(lev.allowed_leverage||1.5).toFixed(1)}x`)}
        ${_qCard('Daily P&L',   `${((parseFloat(dd.daily_pnl_pct||0))*100)>=0?'+':''}${((parseFloat(dd.daily_pnl_pct||0))*100).toFixed(2)}%`, 'fa-chart-line', parseFloat(dd.daily_pnl_pct||0)>=0?'var(--g)':'var(--r)', 'Today\'s performance')}
        ${_qCard('Trading',     dd.halt_active?'HALTED':'ACTIVE', 'fa-circle-dot', dd.halt_active?'var(--r)':'var(--g)', 'Risk engine status')}
        </div>`;
    }

    function _quantTabStructure(sym, sig, agents) {
    const feat     = sig.features || {};
    const council  = agents?.council  || {};
    const strategy = _state.strategy?.weights || {};

    return `
        <div class="qm-section-title"><i class="fa-solid fa-sliders"></i> Strategy Allocation</div>
        ${Object.keys(strategy).length ? `
        <div class="qm-metrics-grid" style="margin-bottom:16px">
            ${Object.entries(strategy).map(([k,v]) => {
            const colors = {trend:'var(--b1)',mean_reversion:'var(--g)',vol_carry:'var(--b2)',options_convexity:'var(--o)'};
            return _qCard(k.replace(/_/g,' '), `${(parseFloat(v)*100).toFixed(1)}%`, 'fa-pie-chart', colors[k]||'var(--b1)');
            }).join('')}
        </div>` : ''}

        <div class="qm-section-title"><i class="fa-solid fa-vote-yea"></i> Council Decision Detail</div>
        <div class="qm-metrics-grid" style="margin-bottom:16px">
        ${_qCard('Decision',     (council.decision||'wait').toUpperCase(), 'fa-gavel',
            council.decision?.includes('execute')?'var(--g)':council.decision==='veto'?'var(--r)':'var(--y)')}
        ${_qCard('Council Score', council.weighted_score!=null?parseFloat(council.weighted_score).toFixed(4):'--', 'fa-star', 'var(--b1)')}
        ${_qCard('Size Mult.',   council.size_multiplier!=null?`×${parseFloat(council.size_multiplier).toFixed(2)}`:'--', 'fa-expand', 'var(--c)')}
        ${_qCard('Mode',         (council.mode||'deterministic').toUpperCase(), 'fa-microchip', 'var(--b2)')}
        </div>

        ${council.reason ? `
        <div class="qm-section-title"><i class="fa-solid fa-comment-dots"></i> Council Reasoning</div>
        <div style="font-size:12px;color:var(--txt2);background:var(--surf2);padding:14px 16px;
                    border-radius:10px;border-left:3px solid var(--b1);line-height:1.7;margin-bottom:16px">
            ${council.reason}
        </div>` : ''}

        <div class="qm-section-title"><i class="fa-solid fa-layer-group"></i> Market Structure Features</div>
        <div class="qm-metrics-grid">
        ${_qCard('Intraday Mom.', feat.intraday_momentum_30m!=null?feat.intraday_momentum_30m.toFixed(3):'--', 'fa-clock', 'var(--b1)', '30-min momentum')}
        ${_qCard('Vol Spike',     feat.intraday_vol_spike!=null?feat.intraday_vol_spike.toFixed(3):'--', 'fa-bolt', 'var(--y)', 'Volume anomaly')}
        ${_qCard('Sector RS',     feat.sector_rel_strength!=null?feat.sector_rel_strength.toFixed(3):'--', 'fa-chart-bar', 'var(--b2)', 'Relative to sector')}
        ${_qCard('Sentiment',     feat.sentiment_score!=null?`${feat.sentiment_score>=0?'+':''}${feat.sentiment_score.toFixed(3)}`:'--', 'fa-face-smile', feat.sentiment_score>0?'var(--g)':feat.sentiment_score<0?'var(--r)':'var(--txt)', 'News sentiment score')}
        ${_qCard('Analyst Score', feat.analyst_score!=null?`${feat.analyst_score>=0?'+':''}${feat.analyst_score.toFixed(3)}`:'--', 'fa-user-tie', feat.analyst_score>0.2?'var(--g)':'var(--y)', 'Buy/Hold/Sell consensus')}
        ${_qCard('Earnings Risk', feat.earnings_upcoming?'UPCOMING':'Normal', 'fa-calendar', feat.earnings_upcoming?'var(--o)':'var(--g)', 'Upcoming earnings flag')}
        </div>`;
    }

    // Expose globally pour le HTML inline onclick
    window.openQuantModal  = openQuantModal;
    window.closeQuantModal = closeQuantModal;

    // ════════════════════════════════════════════════════════
    // SECTION: SOFTWARE — Architecture & Execution Mode
    // ════════════════════════════════════════════════════════

    const AGENTS_LIST = [
      { name:'MultiAgent Council',      module:'multi_agent_council',       role:'Central vote & final decision',      weight:'—',    icon:'fa-gavel',             color:'#3b82f6' },
      { name:'Drawdown Guardian',       module:'drawdown_guardian',         role:'Circuit breaker — risk halt',        weight:'0.20', icon:'fa-shield',             color:'#ef4444' },
      { name:'Regime Model',            module:'regime_model',              role:'8 market regimes + HMM',             weight:'0.15', icon:'fa-crosshairs',         color:'#8b5cf6' },
      { name:'Signal Model',            module:'signal_model',              role:'XGBoost + LightGBM + LogReg',        weight:'0.15', icon:'fa-brain',              color:'#06b6d4' },
      { name:'Execution Timing',        module:'execution_timing',          role:'Optimal order timing',               weight:'0.10', icon:'fa-bolt',               color:'#f59e0b' },
      { name:'Risk Manager',            module:'risk_manager',              role:'Kelly + VaR + CVaR',                 weight:'0.10', icon:'fa-scale-balanced',     color:'#10b981' },
      { name:'Correlation Surface',     module:'correlation_surface',       role:'HRP + cluster analysis',             weight:'0.08', icon:'fa-network-wired',      color:'#6366f1' },
      { name:'Strategy Switching',      module:'strategy_switching',        role:'Anti-whipsaw protection',            weight:'0.08', icon:'fa-rotate',             color:'#84cc16' },
      { name:'Market Impact',           module:'market_impact',             role:'Almgren-Chriss model',               weight:'0.07', icon:'fa-droplet',            color:'#f97316' },
      { name:'Capital Rotation',        module:'capital_rotation',          role:'Sector rotation optimizer',          weight:'0.07', icon:'fa-arrows-rotate',      color:'#ec4899' },
      { name:'Feature Drift',           module:'feature_drift',             role:'PSI + KS drift detection',           weight:'—',    icon:'fa-chart-area',         color:'#94a3b8' },
      { name:'Self Evaluation',         module:'self_evaluation',           role:'Sharpe/Calmar auto-assessment',      weight:'—',    icon:'fa-user-check',         color:'#a78bfa' },
      { name:'Strategy Discovery',      module:'strategy_discovery',        role:'Alpha hunting — new patterns',       weight:'—',    icon:'fa-magnifying-glass',   color:'#34d399' },
    ];

    const SETUP_CHECKLIST = [
      { id:'ibeam_key',   label:'IBEAM_KEY (TOTP Base32)',    status:'pending', priority:'#1 TOP PRIORITY',
        desc:'Received from IBKR support → activate in env.paper.list → docker restart ibeam → connected=true → real orders',
        icon:'🔑', link: null },
      { id:'groq',        label:'GROQ_API_KEY',               status:'done',    priority:'✅ Done',
        desc:'LLM fallback configured (llama3-8b-8192, 14,400 tok/min free). Add in Oracle .env + GitHub Secrets + trading-loop.yml',
        icon:'🤖', link: null },
      { id:'ollama',      label:'Ollama Local (phi3:mini)',    status:'pending', priority:'#3 Pending',
        desc:'sudo snap install ollama → ollama pull phi3:mini → LLM fallback 3 active',
        icon:'🦙', link: null },
      { id:'ml_train',    label:'ML Model Training',          status:'blocked', priority:'#4 Not trained',
        desc:'Actions → Daily Model Training → force_full_retrain → ~30 min → improves signal quality significantly',
        icon:'🧠', link: 'https://github.com/Raph33AI/alphavault-quant/actions' },
      { id:'oracle_ssh',  label:'ORACLE_SSH_KEY (GitHub Secret)', status:'done', priority:'✅ Done',
        desc:'Required for switch-mode.yml and switch-execution-mode.yml SSH steps',
        icon:'🔐', link: null },
      { id:'dry_run',     label:'DRY_RUN=false (Live orders)', status:'blocked', priority:'#6 After IBEAM_KEY',
        desc:'Only activate after IBEAM_KEY confirmed + paper validation period completed',
        icon:'⚠', link: null },
      { id:'arm_a1',      label:'Oracle ARM A1 (4 OCPU/24GB)', status:'blocked', priority:'#7 Region saturated',
        desc:'Skip or change home region — current AMD Micro handles 550+ symbols with optimized settings',
        icon:'💻', link: null },
      { id:'postgresql',  label:'PostgreSQL (trade history)',  status:'blocked', priority:'#8 After ARM A1',
        desc:'Real P&L tracking, trade history, performance analytics — depends on ARM A1 migration',
        icon:'🗄', link: null },
    ];

    let _execModeState = { mode: 'auto', pending: false };

    // ── Init software section ──────────────────────────────
    async function _initSoftwareSection() {
        await _loadExecutionModeStatus();
        _bindExecutionModeToggle();
        _bindPaperLiveToggle();
        _renderAgentGrid();
        _renderChecklist();          // ✅ FIX — était manquant
        await _loadNotifSettings();
    }

    // ── Load current execution mode — localStorage + GitHub Pages ──
    async function _loadExecutionModeStatus() {

      // ✅ FIX BUG 2 & 3 — Restauration immédiate depuis localStorage
      // Évite le flash "AUTO" sur chaque refresh même si on était en MANUAL
      const cached = localStorage.getItem('av_exec_mode');
      if (cached && ['auto', 'manual'].includes(cached)) {
        _execModeState.mode = cached;
        _updateExecModeUI(cached);
      }

      // Puis vérification réseau (GitHub Pages JSON)
      try {
        const url  = `https://raph33ai.github.io/alphavault-quant/signals/execution_mode.json?t=${Date.now()}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });

        if (resp.ok) {
          const d    = await resp.json();
          const mode = d.execution_mode || 'auto';
          _execModeState.mode = mode;
          localStorage.setItem('av_exec_mode', mode);  // persist
          _updateExecModeUI(mode);

          const updEl = document.getElementById('sw-exec-mode-badge');
          if (updEl && d.updated_at) {
            updEl.innerHTML = `<i class="fa-solid fa-clock"></i> Last switch: ${_fmtTime(d.updated_at)}`;
          }
          return;
        }

        // 404 = fichier pas encore créé → garde le localStorage ou auto
        if (resp.status === 404) {
          console.info('[Software] execution_mode.json not yet created — using localStorage or default auto');
          if (!cached) _updateExecModeUI('auto');
          return;
        }

      } catch(e) {
        console.warn('[Software] execution_mode.json fetch failed:', e.message);
        if (!cached) _updateExecModeUI('auto');
      }
    }

    // ── Update all execution mode UI elements ──────────────
    function _updateExecModeUI(mode) {
      const isManual = mode === 'manual';
      const color    = isManual ? '#f59e0b' : '#10b981';
      const label    = isManual ? 'MANUAL' : 'AUTO';
      const sublabel = isManual
        ? 'Agents continue analysis — ML orders blocked — Terminal active'
        : 'All 13 agents active — orders transmitted automatically';

      _txt('sw-exec-mode-label',    label);
      _txt('sw-exec-mode-sublabel', sublabel);

      const valEl = document.getElementById('sw-exec-mode-label');
      if (valEl) valEl.style.color = color;

      // Header badge
      const dot = document.querySelector('#sw-badge-exec .sw-badge-dot');
      const lbl = document.getElementById('sw-badge-exec-label');
      if (dot) { dot.style.background = color; dot.style.boxShadow = `0 0 6px ${color}55`; }
      if (lbl) lbl.textContent = label;

      // Accent bar
      const accent = document.getElementById('sw-accent-exec');
      if (accent) accent.style.background = isManual
        ? 'linear-gradient(90deg,#f59e0b,#ef4444)'
        : 'linear-gradient(90deg,#10b981,#3b82f6)';

      // Toggle
      const toggle = document.getElementById('sw-exec-mode-toggle');
      const track  = document.getElementById('sw-exec-track');
      if (toggle) toggle.checked = isManual;
      if (track) {
        track.style.background  = isManual ? '#f59e0b' : '';
        track.style.borderColor = isManual ? '#f59e0b' : '';
        const thumb = track.querySelector('.sw-tgl-thumb');
        if (thumb) {
          thumb.style.transform  = isManual ? 'translateX(20px)' : 'translateX(0)';
          thumb.style.background = isManual ? 'white' : '';
        }
      }

      // Mode cards
      const autoCard   = document.getElementById('sw-mode-auto');
      const manualCard = document.getElementById('sw-mode-manual');
      if (autoCard)   autoCard.className   = `sw-exec-mode ${isManual ? 'inactive' : 'active'}`;
      if (manualCard) manualCard.className = `sw-exec-mode ${isManual ? 'active-manual' : 'inactive'}`;

      _execModeState.mode = mode;
    }

    // ── Bind execution mode toggle ─────────────────────────
    function _bindExecutionModeToggle() {
      const toggle = document.getElementById('sw-exec-mode-toggle');
      if (!toggle || toggle.dataset.bound) return;
      toggle.dataset.bound = '1';

      toggle.addEventListener('change', (e) => {
        e.preventDefault();
        // Revert immediately — modal will confirm or cancel
        toggle.checked = _execModeState.mode === 'manual';
        _openExecModeModal(_execModeState.mode === 'auto' ? 'manual' : 'auto');
      });

      // Expose globally for HTML onclick
      window._swExecModalCancel = _closeExecModeModal;
      window._swExecModalConfirm = _confirmExecModeSwitch;
    }

    // ── Open execution mode confirmation modal ─────────────
    function _openExecModeModal(targetMode) {
      if (_execModeState.pending) return;

      const modal    = document.getElementById('exec-mode-modal');
      const iconEl   = document.getElementById('exec-modal-icon');
      const titleEl  = document.getElementById('exec-modal-title');
      const descEl   = document.getElementById('exec-modal-desc');
      const warnEl   = document.getElementById('exec-modal-warning');
      const inputEl  = document.getElementById('exec-modal-input');
      const wordEl   = document.getElementById('exec-modal-confirm-word');
      const confirmBtn = document.getElementById('exec-modal-confirm-btn');

      if (!modal) return;

      const isManual  = targetMode === 'manual';
      const word      = targetMode.toUpperCase();
      const color     = isManual ? '#f59e0b' : '#10b981';

      if (iconEl)  iconEl.textContent = isManual ? '✋' : '🤖';
      if (titleEl) titleEl.textContent = isManual ? 'Switch to MANUAL Mode' : 'Switch to AUTO Mode';
      if (descEl)  descEl.innerHTML = isManual
        ? `All automated order transmission will be <strong>immediately blocked</strong>.<br>
          Agents continue analyzing but NO orders will be placed.<br>
          You can place manual orders via the Trading Terminal.`
        : `Automated trading will be <strong>fully re-enabled</strong>.<br>
          All 13 agents will transmit orders every 5 minutes during market hours.<br>
          Ensure DRY_RUN settings are correct before proceeding.`;

      if (warnEl) {
        warnEl.style.borderColor  = `${color}40`;
        warnEl.style.background   = `${color}08`;
        warnEl.querySelector('div').style.color = color;
      }
      if (wordEl)   { wordEl.textContent = word; wordEl.style.color = color; }
      if (inputEl)  {
        inputEl.value = '';
        inputEl.placeholder = `Type "${word}" to confirm`;
        inputEl.style.borderColor = 'var(--bord)';
      }
      if (confirmBtn) {
        confirmBtn.style.opacity = '0.4';
        confirmBtn.disabled = true;
        confirmBtn.style.background = color;
        confirmBtn.dataset.target = targetMode;
      }

      modal.style.display = 'flex';
      inputEl?.focus();

      // Validate input as user types
      // ✅ FIX BUG 1 — Nettoyer l'ancien listener avant d'en ajouter un nouveau
      // Sans ça, après chaque ouverture du modal un listener s'accumule
      // et l'ancien cherche encore "MANUAL" quand on ouvre pour "AUTO"
      if (inputEl._execHandler) {
        inputEl.removeEventListener('input', inputEl._execHandler);
      }
      inputEl._execHandler = () => {
        const match = inputEl.value.trim().toUpperCase() === word;
        if (confirmBtn) {
          confirmBtn.disabled      = !match;
          confirmBtn.style.opacity = match ? '1' : '0.4';
        }
        inputEl.style.borderColor = inputEl.value.length
          ? (match ? color : '#ef4444')
          : 'var(--bord)';
      };
      inputEl.addEventListener('input', inputEl._execHandler);

      // ESC to close
      document.addEventListener('keydown', _execModalEsc);
    }

    function _execModalEsc(e) {
      if (e.key === 'Escape') _closeExecModeModal();
    }

    function _closeExecModeModal() {
      const modal = document.getElementById('exec-mode-modal');
      if (modal) modal.style.display = 'none';
      document.removeEventListener('keydown', _execModalEsc);
    }

    async function _confirmExecModeSwitch() {
      const confirmBtn = document.getElementById('exec-modal-confirm-btn');
      const statusEl   = document.getElementById('exec-modal-status');
      const targetMode = confirmBtn?.dataset.target || 'auto';

      if (_execModeState.pending) return;
      _execModeState.pending = true;

      if (confirmBtn) {
        confirmBtn.disabled = true;
        confirmBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Switching...';
      }
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent   = '⏳ Dispatching to GitHub Actions (~1 min)...';
      }

      try {
        const resp = await fetch(`${WORKER_URL}/switch-execution-mode`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ mode: targetMode }),
          signal:  AbortSignal.timeout(15000),
        });

        const result = await resp.json().catch(() => ({}));

        if (resp.ok && result.success) {
          if (statusEl) statusEl.textContent = '✅ Switch triggered — updating in ~1 minute...';

          // ✅ FIX BUG 3 — Persist immédiatement → résiste au refresh
          localStorage.setItem('av_exec_mode', targetMode);

          // Optimistic UI update
          _updateExecModeUI(targetMode);
          _showToast(
            `Execution mode → ${targetMode.toUpperCase()} | GitHub Actions triggered`,
            'success', 5000
          );

          // Close modal after 1.5s
          setTimeout(_closeExecModeModal, 1500);

          // Refresh after 75s to confirm
          setTimeout(async () => {
            await _loadExecutionModeStatus();
            _showToast('Execution mode status refreshed', 'info', 2000);
          }, 75000);

        } else {
          const errMsg = result.error || `HTTP ${resp.status}`;
          if (statusEl) statusEl.textContent = `❌ Error: ${errMsg}`;
          _showToast(`Switch failed: ${errMsg}`, 'error');
          if (confirmBtn) {
            confirmBtn.disabled  = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Switch';
          }
        }

      } catch(err) {
        if (statusEl) statusEl.textContent = `❌ Network error: ${err.message}`;
        _showToast(`Network error: ${err.message}`, 'error');
        if (confirmBtn) {
          confirmBtn.disabled  = false;
          confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Switch';
        }
      } finally {
        _execModeState.pending = false;
      }
    }

    // ── Bind Paper/Live toggle on software page ────────────
    function _bindPaperLiveToggle() {
      const toggle = document.getElementById('sw-paper-live-toggle');
      if (!toggle || toggle.dataset.bound) return;
      toggle.dataset.bound = '1';

      // Sync état initial depuis localStorage ou ibkr_status
      const cachedMode = localStorage.getItem('av_trading_mode') || 'paper';
      _updatePaperLiveUI(cachedMode);

      // Aussi vérifier ibkr_status.json pour l'état réel
      _loadPaperLiveModeStatus();

      toggle.addEventListener('change', () => {
        const targetMode = toggle.checked ? 'live' : 'paper';
        // Revert immédiatement — le modal confirme ou annule
        toggle.checked = (localStorage.getItem('av_trading_mode') || 'paper') === 'live';
        _openPaperLiveModal(targetMode);
      });

      // Expose globally pour onclick HTML
      window._plmCancel  = _closePaperLiveModal;
      window._plmConfirm = _confirmPaperLiveSwitch;
    }

    // ── Load Paper/Live mode from GitHub Pages ─────────────
    async function _loadPaperLiveModeStatus() {
      try {
        const url  = `https://raph33ai.github.io/alphavault-quant/signals/ibkr_status.json?t=${Date.now()}`;
        const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
          const d    = await resp.json();
          const mode = d.trading_mode || 'paper';
          localStorage.setItem('av_trading_mode', mode);
          _updatePaperLiveUI(mode);
        }
      } catch(e) {
        console.warn('[Software] ibkr_status.json fetch failed:', e.message);
      }
    }

    // ── Open Paper/Live confirmation modal ─────────────────
    let _plmPending = false;

    function _openPaperLiveModal(targetMode) {
      if (_plmPending) return;

      const modal      = document.getElementById('paper-live-modal');
      const iconEl     = document.getElementById('plm-icon');
      const titleEl    = document.getElementById('plm-title');
      const descEl     = document.getElementById('plm-desc');
      const warnEl     = document.getElementById('plm-warning');
      const warnTxtEl  = document.getElementById('plm-warning-text');
      const wordEl     = document.getElementById('plm-confirm-word');
      const inputEl    = document.getElementById('plm-input');
      const confirmBtn = document.getElementById('plm-confirm-btn');
      const statusEl   = document.getElementById('plm-status');
      if (!modal) return;

      const isLive = targetMode === 'live';
      const word   = isLive ? 'LIVE' : '';
      const color  = isLive ? '#ef4444' : '#3b82f6';

      if (iconEl)  iconEl.textContent = isLive ? '⚠' : '🔵';
      if (titleEl) titleEl.textContent = isLive
        ? 'Switch to LIVE Trading'
        : 'Switch to PAPER Trading';
      if (descEl)  descEl.innerHTML = isLive
        ? `You are switching to <strong style="color:#ef4444">LIVE Trading with real money</strong>.<br>
          IBeam will restart and connect to account <strong>U21160314</strong> (raphnardone).<br>
          Ensure IBEAM_KEY is configured and paper validation is complete.`
        : `You are switching back to <strong style="color:#3b82f6">Paper Trading</strong> (simulation).<br>
          IBeam will restart and connect to account <strong>DUM895161</strong> (vtsdxs036).<br>
          No real money at risk.`;

      if (warnEl) {
        warnEl.style.borderColor = `${color}40`;
        warnEl.style.background  = `${color}08`;
        const div = warnEl.querySelector('div');
        if (div) div.style.color = color;
      }

      if (statusEl) { statusEl.style.display = 'none'; statusEl.textContent = ''; }

      // LIVE → requiert de taper "LIVE" | PAPER → confirmation simple
      const inputWrap = inputEl?.parentElement;
      if (isLive) {
        if (inputEl)  { inputEl.style.display = ''; inputEl.value = ''; inputEl.placeholder = 'Type "LIVE" to confirm'; }
        if (wordEl)   { wordEl.textContent = 'LIVE'; wordEl.style.color = color; }
        if (warnTxtEl) warnTxtEl.innerHTML = `Type <strong id="plm-confirm-word" style="color:var(--txt);font-family:var(--mono)">LIVE</strong> below to confirm.`;
        if (confirmBtn) {
          confirmBtn.style.opacity  = '0.4';
          confirmBtn.disabled       = true;
          confirmBtn.style.background = color;
        }
      } else {
        if (inputEl)  { inputEl.style.display = 'none'; inputEl.value = ''; }
        if (warnTxtEl) warnTxtEl.innerHTML = 'Click "Confirm Switch" to switch back to Paper Trading.';
        if (confirmBtn) {
          confirmBtn.style.opacity  = '1';
          confirmBtn.disabled       = false;
          confirmBtn.style.background = color;
        }
      }

      confirmBtn.dataset.target = targetMode;

      // ✅ Nettoyer ancien listener input avant d'en ajouter un nouveau
      if (inputEl._plmHandler) {
        inputEl.removeEventListener('input', inputEl._plmHandler);
      }
      if (isLive) {
        inputEl._plmHandler = () => {
          const match = inputEl.value.trim().toUpperCase() === 'LIVE';
          if (confirmBtn) {
            confirmBtn.disabled      = !match;
            confirmBtn.style.opacity = match ? '1' : '0.4';
          }
          inputEl.style.borderColor = inputEl.value.length
            ? (match ? color : '#ef4444') : 'var(--bord)';
        };
        inputEl.addEventListener('input', inputEl._plmHandler);
      }

      modal.style.display = 'flex';
      if (isLive) setTimeout(() => inputEl?.focus(), 100);

      document.addEventListener('keydown', _plmEsc);
    }

    function _plmEsc(e) {
      if (e.key === 'Escape') _closePaperLiveModal();
    }

    function _closePaperLiveModal() {
      const modal = document.getElementById('paper-live-modal');
      if (modal) modal.style.display = 'none';
      document.removeEventListener('keydown', _plmEsc);
      _plmPending = false;

      // Resync toggle avec l'état réel
      const current = localStorage.getItem('av_trading_mode') || 'paper';
      const toggle  = document.getElementById('sw-paper-live-toggle');
      if (toggle) toggle.checked = current === 'live';
    }

    async function _confirmPaperLiveSwitch() {
      const confirmBtn = document.getElementById('plm-confirm-btn');
      const statusEl   = document.getElementById('plm-status');
      const targetMode = confirmBtn?.dataset.target || 'paper';

      if (_plmPending) return;
      _plmPending = true;

      if (confirmBtn) {
        confirmBtn.disabled   = true;
        confirmBtn.innerHTML  = '<i class="fa-solid fa-circle-notch fa-spin"></i> Switching...';
      }
      if (statusEl) {
        statusEl.style.display = 'block';
        statusEl.textContent   = '⏳ Dispatching to GitHub Actions (~2 min for IBeam restart)...';
      }

      try {
        const resp = await fetch(`${WORKER_URL}/switch-mode`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ mode: targetMode }),
          signal:  AbortSignal.timeout(15000),
        });

        const result = await resp.json().catch(() => ({}));

        if (resp.ok && result.success) {
          // ✅ Persist immédiatement
          localStorage.setItem('av_trading_mode', targetMode);

          if (statusEl) statusEl.textContent = '✅ Switch triggered — IBeam restarting (~90s)...';

          // Optimistic UI update
          _updatePaperLiveUI(targetMode);
          _showToast(
            `Trading mode → ${targetMode.toUpperCase()} | ${result.account || ''} | GitHub Actions triggered`,
            'success', 5000
          );

          // Sync topbar labels even though toggle is hidden
          const topbarLabel   = document.getElementById('mode-toggle-label');
          const topbarAccount = document.getElementById('mode-toggle-account');
          if (topbarLabel)   topbarLabel.textContent = targetMode.toUpperCase();
          if (topbarAccount) topbarAccount.textContent = targetMode === 'live' ? 'U21160314' : 'DUM895161';

          setTimeout(_closePaperLiveModal, 2000);

          // Refresh ibkr_status après 120s
          setTimeout(async () => {
            await _loadPaperLiveModeStatus();
            _showToast('Trading mode status refreshed from Oracle VM', 'info', 2000);
          }, 120000);

        } else {
          const errMsg = result.error || `HTTP ${resp.status}`;
          if (statusEl) statusEl.textContent = `❌ Error: ${errMsg}`;
          _showToast(`Switch failed: ${errMsg}`, 'error');
          if (confirmBtn) {
            confirmBtn.disabled  = false;
            confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Switch';
          }
          _plmPending = false;
        }

      } catch(err) {
        if (statusEl) statusEl.textContent = `❌ Network error: ${err.message}`;
        _showToast(`Network error: ${err.message}`, 'error');
        if (confirmBtn) {
          confirmBtn.disabled  = false;
          confirmBtn.innerHTML = '<i class="fa-solid fa-check"></i> Confirm Switch';
        }
        _plmPending = false;
      }
    }

    function _updatePaperLiveUI(mode) {
      const isLive  = mode === 'live';
      const color   = isLive ? '#ef4444' : '#3b82f6';
      const account = isLive ? 'U21160314' : 'DUM895161';
      const sub     = isLive ? 'Live trading · raphnardone' : 'Paper trading · vtsdxs036';

      _txt('sw-account-value', account);
      _txt('sw-account-sub',   sub);

      const valEl = document.getElementById('sw-account-value');
      if (valEl) valEl.style.color = color;

      // Header badge
      const dot = document.querySelector('#sw-badge-trading .sw-badge-dot');
      const lbl = document.getElementById('sw-badge-trading-label');
      if (dot) dot.style.background = color;
      if (lbl) lbl.textContent = isLive ? 'LIVE' : 'PAPER';

      // Accent bar
      const accent = document.getElementById('sw-accent-account');
      if (accent) accent.style.background = isLive
        ? 'linear-gradient(90deg,#ef4444,#f97316)'
        : 'linear-gradient(90deg,#3b82f6,#8b5cf6)';

      // Toggle
      const toggle = document.getElementById('sw-paper-live-toggle');
      const track  = document.getElementById('sw-paper-live-track');
      if (toggle) toggle.checked = isLive;
      if (track) {
        track.style.background  = isLive ? '#ef4444' : '';
        track.style.borderColor = isLive ? '#ef4444' : '';
        const thumb = track.querySelector('.sw-tgl-thumb');
        if (thumb) {
          thumb.style.transform  = isLive ? 'translateX(20px)' : 'translateX(0)';
          thumb.style.background = isLive ? 'white' : '';
        }
      }

      // Account rows
      const paperRow = document.getElementById('sw-acct-paper');
      const liveRow  = document.getElementById('sw-acct-live');
      if (paperRow) paperRow.classList.toggle('active', !isLive);
      if (liveRow)  liveRow.classList.toggle('active',   isLive);

      // Architecture nodes
      const paperNode = document.getElementById('sw-node-paper');
      const liveNode  = document.getElementById('sw-node-live');
      if (paperNode) { paperNode.classList.toggle('sw-node-active-account', !isLive); paperNode.style.opacity = isLive ? '0.6' : '1'; }
      if (liveNode)  { liveNode.classList.toggle('sw-node-active-account',   isLive); liveNode.style.opacity  = isLive ? '1' : '0.6'; }
    }

    // ── Render 13 agents grid ──────────────────────────────
    function _renderAgentGrid() {
      const grid = document.getElementById('sw-agents-grid');
      if (!grid) return;

      const WEIGHTS = {
        drawdown_guardian:'0.20', regime_model:'0.15', signal_model:'0.15',
        execution_timing:'0.10',  risk_manager:'0.10', correlation_surface:'0.08',
        strategy_switching:'0.08',market_impact:'0.07',capital_rotation:'0.07',
      };

      grid.innerHTML = AGENTS_LIST.map(a => {
        const w = WEIGHTS[a.module];
        return `<div class="sw-agent-item">
          <div class="sw-agent-name" style="border-left-color:${a.color}">${a.name}</div>
          <div class="sw-agent-role">${a.role}</div>
          ${w ? `<div class="sw-agent-weight" style="color:${a.color}">weight ${w}</div>` : ''}
        </div>`;
      }).join('');
    }

    // ── Render setup checklist ─────────────────────────────
    function _renderChecklist() {
      const el = document.getElementById('sw-checklist');
      if (!el) return;

      const done    = SETUP_CHECKLIST.filter(i => i.status === 'done').length;
      const total   = SETUP_CHECKLIST.length;
      const countEl = document.getElementById('sw-todo-count');
      if (countEl) countEl.textContent = `${done}/${total} complete`;

      el.innerHTML = SETUP_CHECKLIST.map(item => {
        const cls   = item.status === 'done' ? 'done' : item.status === 'pending' ? 'pending' : 'blocked';
        const icon  = item.status === 'done'
          ? '<i class="fa-solid fa-circle-check" style="color:#10b981;font-size:18px"></i>'
          : item.status === 'pending'
            ? '<i class="fa-solid fa-circle-exclamation" style="color:#f97316;font-size:18px"></i>'
            : '<i class="fa-solid fa-clock" style="color:#94a3b8;font-size:18px"></i>';

        const priorityColor = item.status === 'done' ? '#10b981'
          : item.status === 'pending' ? '#f97316' : '#94a3b8';

        return `<div class="sw-checklist-item ${cls}">
          <div class="sw-ci-icon">${icon}</div>
          <div class="sw-ci-body">
            <div class="sw-ci-title">
              ${item.icon} ${item.label}
              <span class="sw-ci-badge" style="margin-left:8px;background:${priorityColor}15;color:${priorityColor}">
                ${item.priority}
              </span>
            </div>
            <div class="sw-ci-desc">${item.desc}</div>
            ${item.link ? `<a href="${item.link}" target="_blank"
              style="font-size:10px;color:var(--b1);margin-top:4px;display:inline-block">
              <i class="fa-solid fa-arrow-up-right-from-square"></i> View on GitHub Actions
            </a>` : ''}
          </div>
        </div>`;
      }).join('');
    }

    // ── Main render for software section ──────────────────
    function _renderSoftware(data) {
      const status = data.status || {};
      const hubOk  = status.workers?.finance_hub === true
                  || status.workers?.finance_hub?.ok === true;

      const setDotSW = (id, cls) => {
          const el = document.getElementById(id);
          if (el) el.className = `sw-stat-dot ${cls}`;
      };

      setDotSW('sw-dot-oracle',  'sw-stat-dot sw-dot-ok');
      setDotSW('sw-dot-ibeam',   'sw-stat-dot sw-dot-warn'); // ← mis à jour async ci-dessous
      setDotSW('sw-dot-watcher', 'sw-stat-dot sw-dot-ok');
      setDotSW('sw-dot-worker',  hubOk ? 'sw-stat-dot sw-dot-ok' : 'sw-stat-dot sw-dot-warn');

      _txt('sw-val-lastcycle', status.timestamp ? _fmtTime(status.timestamp) : '--');

      // ✅ FIX : charger ibkr_status.json directement depuis GitHub Pages
      fetch(
          `https://raph33ai.github.io/alphavault-quant/signals/ibkr_status.json?t=${Date.now()}`,
          { signal: AbortSignal.timeout(5000) }
      )
      .then(r => r.ok ? r.json() : {})
      .then(d => {
          // Dot IBEAM basé sur le vrai statut Oracle watcher
          const ibkrOk = d.ibkr_connected === true;
          setDotSW('sw-dot-ibeam', ibkrOk ? 'sw-stat-dot sw-dot-ok' : 'sw-stat-dot sw-dot-warn');

          // ✅ Sync mode Paper/Live depuis ibkr_status.json (source of truth)
          const mode = d.trading_mode || localStorage.getItem('av_trading_mode') || 'paper';
          localStorage.setItem('av_trading_mode', mode);
          _updatePaperLiveUI(mode);
      })
      .catch(() => {
          // Fallback localStorage si fetch échoue
          const cachedMode = localStorage.getItem('av_trading_mode') || 'paper';
          _updatePaperLiveUI(cachedMode);
      });
  }

  // ════════════════════════════════════════════════════════
  // NOTIFICATION SETTINGS
  // ════════════════════════════════════════════════════════

  let _notifSettings = {
    emails: [],
    notify_switch_paper_live: true,
    notify_switch_exec_mode:  true,
    notify_daily_recap:       true,
    notify_weekly_recap:      true,
  };

  async function _loadNotifSettings() {
    try {
      const resp = await fetch(`${WORKER_URL}/notification-settings`, {
        signal: AbortSignal.timeout(6000),
      });
      if (resp.ok) {
        const d = await resp.json();
        _notifSettings = { ..._notifSettings, ...d };
        _renderNotifSettings();
      }
    } catch(e) {
      console.warn('[Notif] Load failed:', e.message);
    }
  }

  function _renderNotifSettings() {
    const s = _notifSettings;

    // Checkboxes
    const pl    = document.getElementById('sw-notif-pl');
    const em    = document.getElementById('sw-notif-em');
    const daily = document.getElementById('sw-notif-daily');
    const week  = document.getElementById('sw-notif-weekly');
    if (pl)    pl.checked    = s.notify_switch_paper_live !== false;
    if (em)    em.checked    = s.notify_switch_exec_mode  !== false;
    if (daily) daily.checked = s.notify_daily_recap       !== false;
    if (week)  week.checked  = s.notify_weekly_recap      !== false;

    // Email list
    _renderEmailList(s.emails || []);
  }

  function _renderEmailList(emails) {
    const list = document.getElementById('sw-email-list');
    if (!list) return;

    if (!emails.length) {
      list.innerHTML = `<div style="font-size:11px;color:var(--txt4);padding:8px 0">
        No addresses configured. Add one above.
      </div>`;
      return;
    }

    list.innerHTML = emails.map((email, i) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;
                  border:1px solid var(--bord);border-radius:8px;background:var(--surf)">
        <i class="fa-solid fa-envelope" style="color:var(--b1);font-size:11px;flex-shrink:0"></i>
        <span style="flex:1;font-size:12px;font-family:var(--mono);color:var(--txt)">${email}</span>
        <button onclick="window._swRemoveEmail(${i})"
                style="border:none;background:none;cursor:pointer;color:var(--txt4);
                       padding:2px 6px;border-radius:4px;font-size:11px;transition:color 0.15s"
                title="Remove">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>`
    ).join('');
  }

  window._swAddEmail = function() {
    const input = document.getElementById('sw-email-input');
    if (!input) return;
    const val = input.value.trim().toLowerCase();
    if (!val || !val.includes('@') || !val.includes('.')) {
      input.style.borderColor = '#ef4444';
      setTimeout(() => { input.style.borderColor = ''; }, 1500);
      return;
    }
    if (!_notifSettings.emails) _notifSettings.emails = [];
    if (_notifSettings.emails.includes(val)) {
      _showToast('Address already in list', 'warn', 2000);
      return;
    }
    _notifSettings.emails.push(val);
    _renderEmailList(_notifSettings.emails);
    input.value = '';
    input.focus();
  };

  window._swRemoveEmail = function(index) {
    if (!_notifSettings.emails) return;
    _notifSettings.emails.splice(index, 1);
    _renderEmailList(_notifSettings.emails);
  };

  window._swSaveNotifSettings = async function() {
    const btn    = document.getElementById('sw-notif-save-btn');
    const status = document.getElementById('sw-notif-status');
    if (!btn || !status) return;

    // Read current toggle values
    const pl    = document.getElementById('sw-notif-pl')?.checked    ?? true;
    const em    = document.getElementById('sw-notif-em')?.checked    ?? true;
    const daily = document.getElementById('sw-notif-daily')?.checked ?? true;
    const week  = document.getElementById('sw-notif-weekly')?.checked ?? true;

    const payload = {
      emails:                   _notifSettings.emails || [],
      notify_switch_paper_live: pl,
      notify_switch_exec_mode:  em,
      notify_daily_recap:       daily,
      notify_weekly_recap:      week,
    };

    btn.disabled  = true;
    btn.textContent = 'Saving...';
    status.textContent = '';

    try {
      const resp = await fetch(`${WORKER_URL}/notification-settings`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(15000),
      });
      const result = await resp.json().catch(() => ({}));

      if (resp.ok && result.success) {
        _notifSettings = { ...payload };
        status.innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--g)"></i> Saved — ${payload.emails.length} addresses`;
        _showToast(`Notification settings saved · ${payload.emails.length} recipients`, 'success', 4000);
      } else {
        const msg = result.error || `HTTP ${resp.status}`;
        status.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:var(--r)"></i> ${msg}`;
        _showToast(`Save failed: ${msg}`, 'error');
      }
    } catch(err) {
      status.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--y)"></i> Network error`;
      _showToast(`Network error: ${err.message}`, 'error');
    } finally {
      btn.disabled    = false;
      btn.textContent = 'Save Settings';
    }
  };

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

  // ════════════════════════════════════════════════════════
  // CLOCK + EXCHANGE BAR — UTC + Paris + 6 bourses
  // Affiche heure locale de chaque bourse + statut open/closed
  // ════════════════════════════════════════════════════════
  function _startClock() {

    // ── Définition des bourses ─────────────────────────────
    const EXCHANGES = [
      {
        id: 'nyse',     name: 'NYSE',
        label: 'New York Stock Exchange',
        tz: 'America/New_York',
        open: [9, 30], close: [16, 0], days: [1,2,3,4,5],
      },
      {
        id: 'nasdaq',   name: 'NASDAQ',
        label: 'Nasdaq — New York',
        tz: 'America/New_York',
        open: [9, 30], close: [16, 0], days: [1,2,3,4,5],
      },
      {
        id: 'lse',      name: 'LSE',
        label: 'London Stock Exchange',
        tz: 'Europe/London',
        open: [8, 0],  close: [16, 30], days: [1,2,3,4,5],
      },
      {
        id: 'euronext', name: 'Euronext',
        label: 'Euronext Paris',
        tz: 'Europe/Paris',
        open: [9, 0],  close: [17, 30], days: [1,2,3,4,5],
      },
      {
        id: 'tse',      name: 'TSE',
        label: 'Tokyo Stock Exchange',
        tz: 'Asia/Tokyo',
        open: [9, 0],  close: [15, 30], days: [1,2,3,4,5],
      },
      {
        id: 'hkex',     name: 'HKEX',
        label: 'Hong Kong Exchange',
        tz: 'Asia/Hong_Kong',
        open: [9, 30], close: [16, 0],  days: [1,2,3,4,5],
      },
    ];

    // ── Vérifie si une bourse est ouverte ─────────────────
    function _isOpen(ex) {
      try {
        const now   = new Date();
        const parts = new Intl.DateTimeFormat('en-US', {
          hour: 'numeric', minute: 'numeric', weekday: 'short',
          hour12: false, timeZone: ex.tz,
        }).formatToParts(now);

        const get     = (t) => parseInt(parts.find(p => p.type === t)?.value || '0');
        const DAY_MAP = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
        const wdStr   = parts.find(p => p.type === 'weekday')?.value || 'Sun';
        const weekday = DAY_MAP[wdStr] ?? 0;
        const timeDec = get('hour') + get('minute') / 60;
        const openDec = ex.open[0]  + ex.open[1]  / 60;
        const closDec = ex.close[0] + ex.close[1] / 60;

        return ex.days.includes(weekday) && timeDec >= openDec && timeDec < closDec;
      } catch (e) {
        return false;
      }
    }

    // ── Heure locale formatée ─────────────────────────────
    // withSec=true → HH:MM:SS | withSec=false → HH:MM
    function _getLocalTime(tz, withSec = true) {
      return new Intl.DateTimeFormat('en-GB', {
        hour:   '2-digit',
        minute: '2-digit',
        ...(withSec ? { second: '2-digit' } : {}),
        hour12:  false,
        timeZone: tz,
      }).format(new Date());
    }

    // ── Boucle de mise à jour (toutes les secondes) ───────
    const update = () => {
      const n = new Date();

      // ── Clock UTC ──────────────────────────────────────────
      _txt('clock',
        `${_pad(n.getUTCHours())}:${_pad(n.getUTCMinutes())}:${_pad(n.getUTCSeconds())} UTC`
      );

      // ── Heure Paris ────────────────────────────────────────
      const parisEl = document.getElementById('clock-paris');
      if (parisEl) {
        parisEl.textContent = `${_getLocalTime('Europe/Paris', true)} Paris`;
      }

      // ── Exchange Status Bar ────────────────────────────────
      // Chaque pill affiche : [dot] NOM HH:MM
      // Tooltip complet au hover
      const exchEl = document.getElementById('exchange-status-bar');
      if (exchEl) {
        exchEl.innerHTML = EXCHANGES.map(ex => {
          const open      = _isOpen(ex);
          const localTime = _getLocalTime(ex.tz, false); // HH:MM
          const openHHMM  = `${_pad(ex.open[0])}:${_pad(ex.open[1])}`;
          const clsHHMM   = `${_pad(ex.close[0])}:${_pad(ex.close[1])}`;
          const tooltip   = [
            ex.label,
            open ? '● OPEN' : '○ CLOSED',
            `Local: ${localTime}`,
            `Hours: ${openHHMM} – ${clsHHMM}`,
          ].join('\n');

          return `<span
            class="exch-pill ${open ? 'exch-open' : 'exch-closed'}"
            data-exch="${ex.id}"
            title="${tooltip}">
            <span class="exch-dot"></span>
            <span class="exch-name">${ex.name}</span>
            <span class="exch-time">${localTime}</span>
          </span>`;
        }).join('');
      }
    };

    // ── Lancement ──────────────────────────────────────────
    update();
    setInterval(update, 1000);
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