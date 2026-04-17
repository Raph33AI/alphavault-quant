// ============================================================
// ALPHAVAULT QUANT — Charts Engine
// TradingView Lightweight Charts + Chart.js
// ============================================================

const Charts = (() => {

  // Palette de couleurs
  const C = {
    green:  '#10b981', red:    '#ef4444', blue:   '#3b82f6',
    purple: '#8b5cf6', yellow: '#f59e0b', cyan:   '#06b6d4',
    orange: '#f97316', text:   '#e2e8f0', muted:  '#64748b',
    bg:     '#111827', bg2:    '#1a2235', border: '#1e2d45',
  };

  // Instances Chart.js actives (pour destroy avant recréation)
  const _instances = {};

  function destroyChart(id) {
    if (_instances[id]) {
      _instances[id].destroy();
      delete _instances[id];
    }
  }

  function getCtx(id) {
    return document.getElementById(id)?.getContext('2d');
  }

  // ── TradingView Lightweight Price Chart ───────────────
  let _tvChart = null;
  let _candleSeries = null;

  function initPriceChart(containerId) {
    const el = document.getElementById(containerId);
    if (!el) return;

    if (_tvChart) { _tvChart.remove(); _tvChart = null; }

    _tvChart = LightweightCharts.createChart(el, {
      width:  el.clientWidth,
      height: 320,
      layout: {
        background:  { color: '#111827' },
        textColor:   C.text,
        fontSize:    11,
        fontFamily:  'Inter, sans-serif',
      },
      grid: {
        vertLines:   { color: '#1e2d45' },
        horzLines:   { color: '#1e2d45' },
      },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#1e2d45' },
      timeScale: { borderColor: '#1e2d45', timeVisible: true },
    });

    _candleSeries = _tvChart.addCandlestickSeries({
      upColor:        C.green, downColor: C.red,
      borderUpColor:  C.green, borderDownColor: C.red,
      wickUpColor:    C.green, wickDownColor: C.red,
    });

    // Responsive
    const ro = new ResizeObserver(() => {
      _tvChart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    return _tvChart;
  }

  function updatePriceChart(ohlcvData, signals) {
    if (!_candleSeries || !ohlcvData || !ohlcvData.length) return;

    const candles = ohlcvData.map(d => ({
      time:  Math.floor(new Date(d.datetime || d.timestamp).getTime() / 1000),
      open:  parseFloat(d.open),
      high:  parseFloat(d.high),
      low:   parseFloat(d.low),
      close: parseFloat(d.close),
    })).filter(d => d.time && !isNaN(d.close)).sort((a, b) => a.time - b.time);

    _candleSeries.setData(candles);

    if (_tvChart && candles.length > 0) {
      _tvChart.timeScale().fitContent();
    }
  }

  // ── Portfolio Donut ───────────────────────────────────
  function renderPortfolioDonut(weights) {
    destroyChart('portfolio-donut');
    const ctx = getCtx('portfolio-donut');
    if (!ctx) return;

    const labels = Object.keys(weights);
    const vals   = Object.values(weights).map(v => (v * 100).toFixed(1));
    const colors = [C.blue, C.green, C.purple, C.yellow, C.cyan, C.orange,
                    C.red, '#a78bfa', '#34d399', '#fbbf24'];

    _instances['portfolio-donut'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:            vals,
          backgroundColor: colors.slice(0, labels.length),
          borderColor:     '#111827',
          borderWidth:     2,
          hoverBorderWidth:3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '65%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: C.text, font: { size: 11 }, padding: 12 },
          },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.label}: ${ctx.raw}%` },
          },
        },
      },
    });
  }

  // ── Regime Probabilities Bar Chart ───────────────────
  function renderRegimeChart(probabilities) {
    destroyChart('regime-chart');
    const ctx = getCtx('regime-chart');
    if (!ctx || !probabilities) return;

    const sorted = Object.entries(probabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const labels = sorted.map(([k]) => k.replace(/_/g, ' ').toUpperCase());
    const vals   = sorted.map(([, v]) => (v * 100).toFixed(1));
    const colors = sorted.map(([k, v]) => {
      if (k.includes('trend_up') || k.includes('easing') || k.includes('low_vol')) return C.green;
      if (k.includes('crash') || k.includes('trend_down')) return C.red;
      if (k.includes('high_vol') || k.includes('tight')) return C.yellow;
      return C.blue;
    });

    _instances['regime-chart'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Probability %',
          data:            vals,
          backgroundColor: colors.map(c => c + '99'),
          borderColor:     colors,
          borderWidth:     1,
          borderRadius:    4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: { label: ctx => ` ${ctx.raw}%` },
          },
        },
        scales: {
          x: {
            grid: { color: C.border },
            ticks: { color: C.muted, font: { size: 10 } },
            max: 100,
          },
          y: { ticks: { color: C.text, font: { size: 10 } }, grid: { display: false } },
        },
      },
    });
  }

  // ── Leverage Gauge ────────────────────────────────────
  function renderLeverageGauge(current, max) {
    destroyChart('leverage-gauge');
    const ctx = getCtx('leverage-gauge');
    if (!ctx) return;

    const pct   = Math.min((current / max) * 100, 100);
    const color = pct > 85 ? C.red : pct > 60 ? C.yellow : C.green;

    _instances['leverage-gauge'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        datasets: [{
          data:            [pct, 100 - pct],
          backgroundColor: [color, '#1e2d45'],
          borderWidth:     0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        circumference: 180, rotation: 270, cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false },
        },
      },
      plugins: [{
        id: 'center-text',
        beforeDraw(chart) {
          const { ctx: c, chartArea: { width, height, top } } = chart;
          c.save();
          c.font        = 'bold 18px Inter';
          c.fillStyle   = color;
          c.textAlign   = 'center';
          c.textBaseline= 'middle';
          c.fillText(`${current.toFixed(2)}x`, width / 2, top + height * 0.75);
          c.restore();
        },
      }],
    });
  }

  // ── Strategy Donut ────────────────────────────────────
  function renderStrategyDonut(weights) {
    destroyChart('strategy-donut');
    const ctx = getCtx('strategy-donut');
    if (!ctx || !weights) return;

    const STRATEGY_COLORS = {
      trend:             C.blue,
      mean_reversion:    C.green,
      vol_carry:         C.purple,
      options_convexity: C.orange,
    };

    const labels = Object.keys(weights).map(k => k.replace(/_/g, ' ').toUpperCase());
    const vals   = Object.values(weights).map(v => (v * 100).toFixed(1));
    const colors = Object.keys(weights).map(k => STRATEGY_COLORS[k] || C.cyan);

    _instances['strategy-donut'] = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:            vals,
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor:     colors,
          borderWidth:     2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '60%',
        plugins: {
          legend: { position: 'bottom', labels: { color: C.text, font: { size: 11 } } },
        },
      },
    });
  }

  // ── Strategy Sharpe Chart ─────────────────────────────
  function renderStrategySharpe(perfData) {
    destroyChart('strategy-sharpe-chart');
    const ctx = getCtx('strategy-sharpe-chart');
    if (!ctx || !perfData) return;

    const labels = Object.keys(perfData).map(k => k.replace(/_/g, ' ').toUpperCase());
    const sharpes= Object.values(perfData).map(v => parseFloat(v.sharpe_5d || 0).toFixed(2));
    const colors = sharpes.map(s => parseFloat(s) >= 0 ? C.green + 'cc' : C.red + 'cc');

    _instances['strategy-sharpe-chart'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label:           'Sharpe (5d)',
          data:            sharpes,
          backgroundColor: colors,
          borderRadius:    4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: C.text }, grid: { color: C.border } },
          y: { ticks: { color: C.muted }, grid: { color: C.border } },
        },
      },
    });
  }

  // ── Execution Quality Chart ───────────────────────────
  function renderExecQuality(decisions) {
    destroyChart('exec-quality-chart');
    const ctx = getCtx('exec-quality-chart');
    if (!ctx || !decisions) return;

    const symbols  = Object.keys(decisions).slice(0, 10);
    const qualities= symbols.map(s => ((decisions[s]?.exec_quality || 0) * 100).toFixed(1));
    const colors   = qualities.map(q => parseFloat(q) > 70 ? C.green + 'cc'
                                      : parseFloat(q) > 40 ? C.yellow + 'cc' : C.red + 'cc');

    _instances['exec-quality-chart'] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: symbols,
        datasets: [{
          label:           'Execution Quality %',
          data:            qualities,
          backgroundColor: colors,
          borderRadius:    4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: C.text, font: { size: 10 } }, grid: { display: false } },
          y: { ticks: { color: C.muted }, grid: { color: C.border }, max: 100 },
        },
      },
    });
  }

  // ── Drawdown Chart ────────────────────────────────────
  let _ddHistory = [];

  function updateDrawdownChart(currentDD) {
    _ddHistory.push({ x: new Date().toLocaleTimeString(), y: (currentDD * 100).toFixed(2) });
    if (_ddHistory.length > 50) _ddHistory.shift();

    destroyChart('drawdown-chart');
    const ctx = getCtx('drawdown-chart');
    if (!ctx) return;

    _instances['drawdown-chart'] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: _ddHistory.map(d => d.x),
        datasets: [{
          label:           'Drawdown %',
          data:            _ddHistory.map(d => d.y),
          borderColor:     C.red,
          backgroundColor: C.red + '22',
          fill:            true,
          tension:         0.3,
          borderWidth:     2,
          pointRadius:     0,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: C.muted, font: { size: 9 } }, grid: { display: false } },
          y: { ticks: { color: C.muted }, grid: { color: C.border } },
        },
      },
    });
  }

  return {
    initPriceChart, updatePriceChart, renderPortfolioDonut,
    renderRegimeChart, renderLeverageGauge, renderStrategyDonut,
    renderStrategySharpe, renderExecQuality, updateDrawdownChart,
    destroyChart,
  };
})();