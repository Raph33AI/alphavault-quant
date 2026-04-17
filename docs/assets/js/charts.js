// ============================================================
// charts.js — AlphaVault Quant v3.0
// ✅ LightweightCharts v3/v4 compatible (auto-detect)
// ✅ Chart.js — tous les graphiques dashboard
// ✅ Sparklines index cards
// ✅ Panel charts 4-grid
// ✅ Gauge leverage, drawdown monitor, execution quality
// ============================================================

const Charts = (() => {

  // ── Theme Colors ────────────────────────────────────────
  const C = {
    green:  '#10b981',
    red:    '#ef4444',
    blue:   '#3b82f6',
    purple: '#8b5cf6',
    orange: '#f97316',
    yellow: '#f59e0b',
    cyan:   '#06b6d4',
    gray:   '#64748b',
    grid:   () => _isDark() ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    text:   () => _isDark() ? '#9db3d8' : '#3d4f7c',
    surf:   () => _isDark() ? '#111e3a' : '#f8faff',
    strategy: {
      trend:             '#3b82f6',
      mean_reversion:    '#10b981',
      vol_carry:         '#8b5cf6',
      options_convexity: '#f97316',
    },
  };

  const PALETTE = [
    '#3b82f6','#10b981','#8b5cf6','#f97316',
    '#06b6d4','#f59e0b','#64748b','#ec4899',
    '#14b8a6','#a855f7','#ef4444','#84cc16',
  ];

  // ── State ────────────────────────────────────────────────
  const _cj   = {};           // Chart.js instances { canvasId: Chart }
  let _mainChart    = null;   // LWC main chart instance
  let _mainCandle   = null;   // LWC candle series
  let _mainVolume   = null;   // LWC volume series
  const _panels     = {};     // LWC panel instances { idx: { chart, series } }
  const _sparks     = {};     // Sparkline Chart.js { sym: Chart }
  const _ddHistory  = [];     // Drawdown history rolling window
  const DD_MAX      = 80;     // Max drawdown points

  // ── Helpers ──────────────────────────────────────────────
  function _isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function _destroyCJ(id) {
    if (_cj[id]) { try { _cj[id].destroy(); } catch(e) {} delete _cj[id]; }
  }

  function _ctx(id) {
    const el = document.getElementById(id);
    if (!el) return null;
    return el.getContext('2d');
  }

  function _baseOpts(extra = {}) {
    return {
      responsive:          true,
      maintainAspectRatio: true,
      animation:           { duration: 400 },
      plugins: {
        legend: {
          labels: {
            color:   C.text(),
            font:    { family: 'Inter', size: 11 },
            padding: 12,
          },
        },
        tooltip: {
          backgroundColor: _isDark() ? '#0d1530' : '#fff',
          titleColor:      C.text(),
          bodyColor:       C.text(),
          borderColor:     _isDark() ? '#1a2845' : '#dde3f0',
          borderWidth:     1,
        },
      },
      scales: {
        x: {
          ticks: { color: C.text(), font: { size: 10 } },
          grid:  { color: C.grid() },
        },
        y: {
          ticks: { color: C.text(), font: { size: 10 } },
          grid:  { color: C.grid() },
        },
      },
      ...extra,
    };
  }

  // ════════════════════════════════════════════════════════
  // LightweightCharts — Version Detection
  // ════════════════════════════════════════════════════════
  function _getLWCVersion() {
    if (typeof LightweightCharts === 'undefined') return null;
    return typeof LightweightCharts.CandlestickSeries !== 'undefined' ? 4 : 3;
  }

  function _addCandleSeries(chart) {
    const opts = {
      upColor:          '#10b981',
      downColor:        '#ef4444',
      borderUpColor:    '#10b981',
      borderDownColor:  '#ef4444',
      wickUpColor:      '#10b981',
      wickDownColor:    '#ef4444',
    };
    const v = _getLWCVersion();
    return v === 4
      ? chart.addSeries(LightweightCharts.CandlestickSeries, opts)
      : chart.addCandlestickSeries(opts);
  }

  function _addHistoSeries(chart) {
    const opts = {
      color:        'rgba(59,130,246,0.35)',
      priceFormat:  { type: 'volume' },
      priceScaleId: 'volume',
    };
    const v = _getLWCVersion();
    return v === 4
      ? chart.addSeries(LightweightCharts.HistogramSeries, opts)
      : chart.addHistogramSeries(opts);
  }

  function _lwcChartOptions(container, height = 360) {
    return {
      width:  container.clientWidth || 800,
      height,
      layout: {
        background: { color: 'transparent' },
        textColor:  C.text(),
        fontSize:   11,
        fontFamily: "'Inter', sans-serif",
      },
      grid: {
        vertLines: { color: C.grid() },
        horzLines: { color: C.grid() },
      },
      crosshair: {
        mode: (LightweightCharts.CrosshairMode?.Normal ?? 1),
      },
      rightPriceScale: {
        borderColor:  'rgba(128,128,128,0.15)',
        scaleMargins: { top: 0.08, bottom: 0.28 },
      },
      timeScale: {
        borderColor:     'rgba(128,128,128,0.15)',
        timeVisible:     true,
        secondsVisible:  false,
      },
    };
  }

  // ════════════════════════════════════════════════════════
  // MAIN PRICE CHART (LightweightCharts)
  // ════════════════════════════════════════════════════════
  function initPriceChart(containerId, options = {}) {
    const container = document.getElementById(containerId);
    if (!container) { console.error(`❌ #${containerId} not found`); return null; }
    if (typeof LightweightCharts === 'undefined') {
      console.error('❌ LightweightCharts not loaded'); return null;
    }

    const v = _getLWCVersion();
    console.log(`📊 LightweightCharts v${v} detected`);

    // Destroy existing
    if (_mainChart) { try { _mainChart.remove(); } catch(e) {} _mainChart = null; }

    try {
      const opts = _lwcChartOptions(container, options.height || 360);
      _mainChart  = LightweightCharts.createChart(container, opts);
      _mainCandle = _addCandleSeries(_mainChart);
      _mainVolume = _addHistoSeries(_mainChart);

      // Volume scale
      try {
        _mainChart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
        });
      } catch(e) { /* v4 fallback */ }

      // Resize observer
      if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(entries => {
          if (_mainChart && entries[0]) {
            _mainChart.applyOptions({ width: entries[0].contentRect.width });
          }
        });
        ro.observe(container);
      }

      console.log('✅ Main price chart initialized');
      return { chart: _mainChart, candleSeries: _mainCandle };

    } catch(err) {
      console.error('❌ initPriceChart:', err);
      return null;
    }
  }

  // Update main chart with OHLCV data array
  // vals = [{ datetime|date|time, open, high, low, close, volume? }]
  function updatePriceChart(vals = [], _signals = {}) {
    if (!_mainCandle) {
      console.warn('⚠ candleSeries not initialized');
      return;
    }
    try {
      const candles = _parseCandles(vals);
      if (!candles.length) { console.warn('⚠ No valid candles'); return; }

      _mainCandle.setData(candles);

      if (_mainVolume) {
        const vols = candles.map((c, i) => ({
          time:  c.time,
          value: parseFloat(vals[i]?.volume || 0),
          color: c.close >= c.open
            ? 'rgba(16,185,129,0.4)'
            : 'rgba(239,68,68,0.4)',
        }));
        _mainVolume.setData(vols);
      }

      if (_mainChart) _mainChart.timeScale().fitContent();
      console.log(`✅ Chart updated — ${candles.length} candles`);

    } catch(err) { console.error('❌ updatePriceChart:', err); }
  }

  // Parse raw candle array → LWC format
  function _parseCandles(vals = []) {
    return vals
      .filter(c => c && (c.open != null || c.close != null))
      .map(c => {
        const dt  = c.datetime || c.date || c.time || c.Date;
        const ts  = typeof dt === 'number'
          ? (dt > 1e10 ? Math.floor(dt / 1000) : dt)
          : Math.floor(new Date(dt).getTime() / 1000);
        return {
          time:  ts,
          open:  parseFloat(c.open),
          high:  parseFloat(c.high),
          low:   parseFloat(c.low),
          close: parseFloat(c.close),
        };
      })
      .filter(c => !isNaN(c.open) && c.time > 0)
      .sort((a, b) => a.time - b.time);
  }

  function setMarkers(markers = []) {
    if (!_mainCandle || !markers.length) return;
    try {
      const fmt = markers.map(m => ({
        time:     typeof m.time === 'string'
          ? Math.floor(new Date(m.time).getTime() / 1000) : m.time,
        position: m.position || 'aboveBar',
        color:    m.color    || '#3b82f6',
        shape:    m.shape    || 'arrowUp',
        text:     m.text     || '',
      }));
      if (typeof _mainCandle.setMarkers === 'function') {
        _mainCandle.setMarkers(fmt);
      }
    } catch(e) { console.warn('⚠ setMarkers:', e.message); }
  }

  function destroyMainChart() {
    if (_mainChart) {
      try { _mainChart.remove(); } catch(e) {}
      _mainChart = null;
      _mainCandle = null;
      _mainVolume = null;
    }
  }

  // Refresh chart theme (called on theme toggle)
  function refreshChartTheme() {
    if (_mainChart) {
      try {
        _mainChart.applyOptions({
          layout: { background: { color: 'transparent' }, textColor: C.text() },
          grid:   { vertLines: { color: C.grid() }, horzLines: { color: C.grid() } },
        });
      } catch(e) {}
    }
    Object.values(_panels).forEach(p => {
      if (p?.chart) {
        try {
          p.chart.applyOptions({
            layout: { background: { color: 'transparent' }, textColor: C.text() },
            grid:   { vertLines: { color: C.grid() }, horzLines: { color: C.grid() } },
          });
        } catch(e) {}
      }
    });
  }

  // ════════════════════════════════════════════════════════
  // PANEL CHARTS (4-grid section)
  // ════════════════════════════════════════════════════════
  function initPanelChart(panelIdx, containerId) {
    if (_panels[panelIdx]?.chart) return _panels[panelIdx];

    const container = document.getElementById(containerId);
    if (!container || typeof LightweightCharts === 'undefined') return null;

    try {
      const chart = LightweightCharts.createChart(container, {
        ..._lwcChartOptions(container, 220),
      });

      const series = _addCandleSeries(chart);

      // Volume for panels
      const volSeries = _addHistoSeries(chart);
      try {
        chart.priceScale('volume').applyOptions({
          scaleMargins: { top: 0.85, bottom: 0 },
        });
      } catch(e) {}

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(entries => {
          if (chart && entries[0]) {
            chart.applyOptions({ width: entries[0].contentRect.width });
          }
        }).observe(container);
      }

      _panels[panelIdx] = { chart, series, volSeries };
      return _panels[panelIdx];

    } catch(err) {
      console.warn(`❌ Panel chart ${panelIdx}:`, err);
      return null;
    }
  }

  function updatePanelChart(panelIdx, vals = []) {
    const p = _panels[panelIdx];
    if (!p?.series) return;

    try {
      const candles = _parseCandles(vals);
      if (!candles.length) return;

      p.series.setData(candles);

      if (p.volSeries) {
        p.volSeries.setData(candles.map((c, i) => ({
          time:  c.time,
          value: parseFloat(vals[i]?.volume || 0),
          color: c.close >= c.open
            ? 'rgba(16,185,129,0.35)'
            : 'rgba(239,68,68,0.35)',
        })));
      }

      p.chart.timeScale().fitContent();
    } catch(err) { console.warn(`⚠ Panel ${panelIdx} update:`, err); }
  }

  function destroyPanelChart(panelIdx) {
    if (_panels[panelIdx]?.chart) {
      try { _panels[panelIdx].chart.remove(); } catch(e) {}
      delete _panels[panelIdx];
    }
  }

  // ════════════════════════════════════════════════════════
  // SPARKLINES (Index Cards)
  // ════════════════════════════════════════════════════════
  function renderSparkline(canvasId, priceData = [], isPositive = null) {
    const c = _ctx(canvasId);
    if (!c) return;

    _destroyCJ(canvasId);
    if (!priceData.length) return;

    const first   = priceData[0];
    const last    = priceData[priceData.length - 1];
    const isUp    = isPositive !== null ? isPositive : (last >= first);
    const color   = isUp ? C.green : C.red;

    _cj[canvasId] = new Chart(c, {
      type: 'line',
      data: {
        labels:   priceData.map(() => ''),
        datasets: [{
          data:            priceData,
          borderColor:     color,
          backgroundColor: color + '18',
          borderWidth:     1.5,
          fill:            true,
          tension:         0.3,
          pointRadius:     0,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false },
        },
      },
    });
  }

  // ════════════════════════════════════════════════════════
  // PORTFOLIO DONUT (Chart.js)
  // ════════════════════════════════════════════════════════
  function renderPortfolioDonut(weights = {}) {
    const c = _ctx('portfolio-donut');
    if (!c || typeof Chart === 'undefined') return;
    _destroyCJ('portfolio-donut');

    const src    = Object.keys(weights).length ? weights : { Cash: 1.0 };
    const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));
    const data   = Object.values(src).map(v => Math.max(0, parseFloat(v) * 100));
    const bgs    = PALETTE.slice(0, labels.length);

    _cj['portfolio-donut'] = new Chart(c, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgs.map(b => b + 'cc'),
          borderColor:     bgs,
          borderWidth:     2,
          hoverOffset:     8,
        }],
      },
      options: {
        responsive:  true,
        cutout:      '65%',
        animation:   { duration: 500 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color:   C.text(),
              font:    { size: 11 },
              padding: 10,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${parseFloat(ctx.parsed).toFixed(1)}%`,
            },
          },
        },
      },
    });
  }

  // ════════════════════════════════════════════════════════
  // OVERVIEW STRATEGY DONUT (mini version)
  // ════════════════════════════════════════════════════════
  function renderStrategyDonutMini(canvasId, weights = {}) {
    const c = _ctx(canvasId);
    if (!c || typeof Chart === 'undefined') return;
    _destroyCJ(canvasId);

    const def = { trend: 0.40, mean_reversion: 0.25, vol_carry: 0.20, options_convexity: 0.15 };
    const src  = Object.keys(weights).length ? weights : def;
    const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));
    const data   = Object.values(src).map(v => (parseFloat(v) * 100).toFixed(1));
    const bgs    = Object.keys(src).map(k => C.strategy[k] || C.gray);

    _cj[canvasId] = new Chart(c, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: bgs.map(b => b + 'cc'),
          borderColor:     bgs,
          borderWidth:     2,
          hoverOffset:     6,
        }],
      },
      options: {
        responsive:  true,
        cutout:      '68%',
        animation:   { duration: 400 },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color:   C.text(),
              font:    { size: 10 },
              padding: 6,
            },
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.parsed}%`,
            },
          },
        },
      },
    });
  }

  // ════════════════════════════════════════════════════════
  // STRATEGY DONUT (strategies section)
  // ════════════════════════════════════════════════════════
  function renderStrategyDonut(weights = {}) {
    renderStrategyDonutMini('strategy-donut', weights);
    // Also update overview mini if visible
    if (document.getElementById('ov-strategy-donut')) {
      renderStrategyDonutMini('ov-strategy-donut', weights);
    }
  }

  // ════════════════════════════════════════════════════════
  // REGIME CHART (horizontal bar)
  // ════════════════════════════════════════════════════════
  function renderRegimeChart(probs = {}) {
    const c = _ctx('regime-chart');
    if (!c || typeof Chart === 'undefined') return;
    _destroyCJ('regime-chart');

    const DEFAULTS_PROBS = {
      trend_up:         0.40,
      trend_down:       0.10,
      range_bound:      0.15,
      low_volatility:   0.10,
      high_volatility:  0.10,
      crash:            0.05,
      macro_tightening: 0.05,
      macro_easing:     0.05,
    };
    const src    = Object.keys(probs).length ? probs : DEFAULTS_PROBS;
    const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));
    const data   = Object.values(src).map(v => (parseFloat(v) * 100).toFixed(1));

    const COLOR_MAP = {
      trend_up:         C.green,
      trend_down:       C.red,
      range_bound:      C.gray,
      low_volatility:   C.cyan,
      high_volatility:  C.yellow,
      crash:            '#dc2626',
      macro_tightening: C.orange,
      macro_easing:     C.purple,
    };
    const bgs = Object.keys(src).map(k => COLOR_MAP[k] || C.blue);

    _cj['regime-chart'] = new Chart(c, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Probability (%)',
          data,
          backgroundColor: bgs.map(b => b + '99'),
          borderColor:     bgs,
          borderWidth:     1,
          borderRadius:    4,
        }],
      },
      options: {
        ..._baseOpts({
          indexAxis: 'y',
          plugins:   { legend: { display: false } },
          scales: {
            x: {
              min:   0,
              max:   100,
              ticks: { color: C.text(), callback: v => v + '%', font: { size: 10 } },
              grid:  { color: C.grid() },
            },
            y: {
              ticks: { color: C.text(), font: { size: 10 } },
              grid:  { color: C.grid() },
            },
          },
        }),
      },
    });
  }

  // ════════════════════════════════════════════════════════
  // LEVERAGE GAUGE (doughnut)
  // ════════════════════════════════════════════════════════
  function renderLeverageGauge(current = 0, max = 1.5) {
    const c = _ctx('leverage-gauge');
    if (!c || typeof Chart === 'undefined') return;
    _destroyCJ('leverage-gauge');

    const pct   = Math.min(Math.max((current / (max || 1.5)) * 100, 0), 100);
    const color = pct > 85 ? C.red : pct > 65 ? C.yellow : C.green;
    const cur   = parseFloat(current).toFixed(2);
    const mx    = parseFloat(max).toFixed(2);

    _cj['leverage-gauge'] = new Chart(c, {
      type: 'doughnut',
      data: {
        datasets: [{
          data:            [pct, 100 - pct],
          backgroundColor: [color, _isDark() ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'],
          borderWidth:     0,
          circumference:   270,
          rotation:        225,
        }],
      },
      options: {
        responsive:  true,
        cutout:      '78%',
        animation:   { duration: 600, easing: 'easeOutQuart' },
        plugins: {
          legend:  { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [{
        id: 'gaugeCenter',
        afterDraw(chart) {
          const { ctx, chartArea: { left, top, width, height } } = chart;
          const cx = left + width  / 2;
          const cy = top  + height / 2 + 16;
          ctx.save();
          ctx.fillStyle   = color;
          ctx.font        = `bold 24px Inter, sans-serif`;
          ctx.textAlign   = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`${cur}x`, cx, cy);
          ctx.fillStyle   = C.text();
          ctx.font        = `11px Inter, sans-serif`;
          ctx.fillText(`/ ${mx}x max`, cx, cy + 20);
          ctx.restore();
        },
      }],
    });

    // Update labels
    _txt('lever-current-label', `Current: ${cur}x`);
    _txt('lever-max-label',     `Max: ${mx}x`);
  }

  // ════════════════════════════════════════════════════════
  // DRAWDOWN CHART (rolling line)
  // ════════════════════════════════════════════════════════
  function updateDrawdownChart(currentDD = 0) {
    const c = _ctx('drawdown-chart');
    if (!c || typeof Chart === 'undefined') return;

    const now   = new Date();
    const label = `${_pad(now.getHours())}:${_pad(now.getMinutes())}`;
    const pct   = (currentDD * 100);

    _ddHistory.push({ x: label, y: pct.toFixed(3) });
    if (_ddHistory.length > DD_MAX) _ddHistory.shift();

    _destroyCJ('drawdown-chart');

    const absPct = Math.abs(pct);
    const color  = absPct > 5 ? C.red : absPct > 2 ? C.yellow : C.green;

    _cj['drawdown-chart'] = new Chart(c, {
      type: 'line',
      data: {
        labels:   _ddHistory.map(d => d.x),
        datasets: [{
          label:            'Drawdown (%)',
          data:             _ddHistory.map(d => d.y),
          borderColor:      color,
          backgroundColor:  color + '20',
          borderWidth:      2,
          fill:             true,
          tension:          0.4,
          pointRadius:      0,
          pointHoverRadius: 4,
        }],
      },
      options: {
        ..._baseOpts({
          animation: { duration: 300 },
          plugins:   { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: C.text(), maxTicksLimit: 10, maxRotation: 0, font: { size: 10 } },
              grid:  { color: C.grid() },
            },
            y: {
              ticks: { color: C.text(), callback: v => v + '%', font: { size: 10 } },
              grid:  { color: C.grid() },
            },
          },
        }),
      },
    });
  }

  // ════════════════════════════════════════════════════════
  // STRATEGY SHARPE (dual axis bar)
  // ════════════════════════════════════════════════════════
  function renderStrategySharpe(perf = {}) {
    ['strategy-perf-chart', 'strategy-sharpe-chart'].forEach(id => {
      const c = _ctx(id);
      if (!c || typeof Chart === 'undefined') return;
      _destroyCJ(id);

      const DEFAULTS_PERF = {
        trend:             { sharpe: 1.2,  return_pct: 8.4 },
        mean_reversion:    { sharpe: 0.9,  return_pct: 5.1 },
        vol_carry:         { sharpe: 1.5,  return_pct: 6.8 },
        options_convexity: { sharpe: 0.7,  return_pct: 3.2 },
      };
      const src    = Object.keys(perf).length ? perf : DEFAULTS_PERF;
      const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));
      const sharpe = Object.values(src).map(v =>
        parseFloat(v?.sharpe ?? v?.sharpe_ratio ?? 0).toFixed(2));
      const rets   = Object.values(src).map(v =>
        parseFloat(v?.return_pct ?? v?.returns ?? 0).toFixed(2));
      const bgs    = Object.keys(src).map(k => C.strategy[k] || C.blue);

      _cj[id] = new Chart(c, {
        type: 'bar',
        data: {
          labels,
          datasets: [
            {
              label:           'Sharpe Ratio',
              data:            sharpe,
              backgroundColor: bgs.map(b => b + '99'),
              borderColor:     bgs,
              borderWidth:     1,
              borderRadius:    5,
              yAxisID:         'y',
            },
            {
              label:           'Return (%)',
              data:            rets,
              backgroundColor: bgs.map(() => C.cyan + '55'),
              borderColor:     C.cyan,
              borderWidth:     1,
              borderRadius:    5,
              yAxisID:         'y1',
            },
          ],
        },
        options: {
          responsive: true,
          animation:  { duration: 400 },
          plugins: {
            legend: {
              labels: { color: C.text(), font: { size: 11 } },
            },
          },
          scales: {
            x: {
              ticks: { color: C.text(), font: { size: 10 } },
              grid:  { color: C.grid() },
            },
            y: {
              type:     'linear',
              position: 'left',
              title:    { display: true, text: 'Sharpe', color: C.text(), font: { size: 10 } },
              ticks:    { color: C.blue, font: { size: 10 } },
              grid:     { color: C.grid() },
            },
            y1: {
              type:     'linear',
              position: 'right',
              title:    { display: true, text: 'Return %', color: C.text(), font: { size: 10 } },
              ticks:    { color: C.cyan, callback: v => v + '%', font: { size: 10 } },
              grid:     { drawOnChartArea: false },
            },
          },
        },
      });
    });
  }

  // ════════════════════════════════════════════════════════
  // EXECUTION QUALITY (bar + order methods donut)
  // ════════════════════════════════════════════════════════
  function renderExecQuality(decisions = {}) {
    // ── Quality Bar Chart ──
    const cBar = _ctx('exec-quality-chart');
    if (cBar && typeof Chart !== 'undefined') {
      _destroyCJ('exec-quality-chart');

      const entries = Object.entries(decisions).slice(0, 12);
      const labels  = entries.length ? entries.map(([sym]) => sym) : ['Waiting...'];
      const quality = entries.length
        ? entries.map(([, d]) => parseFloat(d?.exec_quality ?? d?.execution_quality ?? 0.75) * 100)
        : [0];
      const bgs = quality.map(q => q >= 80 ? C.green : q >= 60 ? C.yellow : C.red);

      _cj['exec-quality-chart'] = new Chart(cBar, {
        type: 'bar',
        data: {
          labels,
          datasets: [{
            label:           'Exec Quality (%)',
            data:            quality,
            backgroundColor: bgs.map(b => b + '99'),
            borderColor:     bgs,
            borderWidth:     1,
            borderRadius:    5,
          }],
        },
        options: {
          ..._baseOpts({
            plugins: { legend: { display: false } },
            scales: {
              x: {
                ticks: { color: C.text(), font: { size: 10 } },
                grid:  { color: C.grid() },
              },
              y: {
                min:   0,
                max:   100,
                ticks: { color: C.text(), callback: v => v + '%', font: { size: 10 } },
                grid:  { color: C.grid() },
              },
            },
          }),
        },
      });
    }
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function _txt(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  function _pad(n) { return String(n).padStart(2, '0'); }

  // Destroy all Chart.js instances (theme refresh)
  function destroyAllCJ() {
    Object.keys(_cj).forEach(id => _destroyCJ(id));
  }

  // Get existing Chart.js instance
  function getCJ(id) { return _cj[id] || null; }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    // ── LightweightCharts ──
    initPriceChart,
    updatePriceChart,
    setMarkers,
    destroyMainChart,
    refreshChartTheme,
    getMainChart:   () => _mainChart,
    getCandleSeries: () => _mainCandle,

    // ── Panel Charts ──
    initPanelChart,
    updatePanelChart,
    destroyPanelChart,
    getPanels:      () => _panels,

    // ── Sparklines ──
    renderSparkline,

    // ── Chart.js ──
    renderPortfolioDonut,
    renderStrategyDonut,
    renderStrategyDonutMini,
    renderRegimeChart,
    renderLeverageGauge,
    updateDrawdownChart,
    renderStrategySharpe,
    renderExecQuality,

    // ── Utils ──
    destroyAllCJ,
    getCJ,
    parseCandles:   _parseCandles,
    isDark:         _isDark,
  };

})();

window.Charts = Charts;
console.log('✅ Charts module loaded (LightweightCharts + Chart.js v3.0)');