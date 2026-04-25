// ============================================================
// av-charts.js — AlphaVault Quant Dashboard v1.0
// Charts : LightweightCharts (NAV/candles) + Chart.js (indicateurs)
// Dépend de : av-config.js, av-utils.js, av-api.js
// ============================================================

const AVCharts = (() => {

  // ── Registry — pour cleanup propre ───────────────────────
  const _lwcInstances = new Map();   // id → LWC chart instance
  const _cjsInstances = new Map();   // id → Chart.js instance
  const _observers    = new Map();   // id → ResizeObserver

  // ══════════════════════════════════════════════════════════
  // THEME HELPERS
  // ══════════════════════════════════════════════════════════

  function _theme() {
    const dark = isDark();
    return {
      dark,
      bg:         'transparent',
      text:       dark ? '#94a3b8' : '#64748b',
      textPrimary:dark ? '#e2e8f0' : '#1e293b',
      grid:       dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
      border:     dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
      tooltip:    dark ? '#0f172a' : '#ffffff',
      tooltipBorder: dark ? '#1e293b' : '#e2e8f0',
      accent:     '#3b82f6',
      green:      '#10b981',
      red:        '#ef4444',
      orange:     '#f59e0b',
      violet:     '#8b5cf6',
      font:       "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
      mono:       "'JetBrains Mono', 'Fira Code', monospace",
    };
  }

  // ══════════════════════════════════════════════════════════
  // CLEANUP HELPERS
  // ══════════════════════════════════════════════════════════

  function destroyLWC(id) {
    const chart = _lwcInstances.get(id);
    if (chart) {
      try { chart.remove(); } catch(e) {}
      _lwcInstances.delete(id);
    }
    const obs = _observers.get(id);
    if (obs) {
      try { obs.disconnect(); } catch(e) {}
      _observers.delete(id);
    }
  }

  function destroyCJS(id) {
    const chart = _cjsInstances.get(id);
    if (chart) {
      try { chart.destroy(); } catch(e) {}
      _cjsInstances.delete(id);
    }
  }

  function destroyAll() {
    [..._lwcInstances.keys()].forEach(destroyLWC);
    [..._cjsInstances.keys()].forEach(destroyCJS);
  }

  // ══════════════════════════════════════════════════════════
  // ÉTAT CHARGEMENT
  // ══════════════════════════════════════════════════════════

  function _setLoading(el, msg = 'Loading chart...') {
    if (!el) return;
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;
                  height:100%;gap:10px;color:var(--text-muted)">
        <i class="fa-solid fa-circle-notch fa-spin" style="color:var(--accent-blue);font-size:16px"></i>
        <span style="font-size:13px">${msg}</span>
      </div>`;
  }

  function _setEmpty(el, msg = 'No data available') {
    if (!el) return;
    el.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;
                  justify-content:center;height:100%;gap:8px;color:var(--text-muted)">
        <i class="fa-solid fa-chart-simple" style="font-size:22px;opacity:0.3"></i>
        <span style="font-size:12px">${msg}</span>
      </div>`;
  }

  function _setError(el, msg = 'Chart error') {
    if (!el) return;
    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;
                  height:100%;gap:8px;color:var(--accent-red)">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <span style="font-size:12px">${msg}</span>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // NAV LINE CHART — LightweightCharts
  // Pour dashboard.html et analytics.html
  // ══════════════════════════════════════════════════════════

  /**
   * Trace la courbe NAV depuis rolling_history
   * @param {string}   containerId
   * @param {Array}    historyPoints  — depuis AVApi.getRollingHistory()
   * @param {object}   opts
   *   height, showLeverage, timeframe ('1D'|'1W'|'1M'|'ALL')
   */
  async function renderNAVChart(containerId, historyPoints, opts = {}) {
    const el = document.getElementById(containerId);
    if (!el) return;

    destroyLWC(containerId);

    const {
      height      = 300,
      showLeverage = false,
      timeframe   = 'ALL',
      currentNetliq = null,
    } = opts;

    el.style.height    = `${height}px`;
    el.style.minHeight = `${height}px`;
    el.style.overflow  = 'hidden';
    el.style.position  = 'relative';

    // Filtre timeframe
    let points = [...(historyPoints || [])];
    if (timeframe !== 'ALL' && points.length > 0) {
      const now    = Date.now();
      const cutoff = {
        '1D': now - 86_400_000,
        '1W': now - 7  * 86_400_000,
        '1M': now - 30 * 86_400_000,
      }[timeframe] || 0;
      points = points.filter(p => new Date(p.ts).getTime() >= cutoff);
    }

    // Ajoute le point live actuel si netliq disponible
    if (currentNetliq && currentNetliq > 0) {
      const last = points.at(-1);
      const now  = new Date().toISOString();
      if (!last || Math.abs(sf(last.netliq) - currentNetliq) > 10) {
        points.push({ ts: now, netliq: currentNetliq, leverage: last?.leverage || 0, regime: last?.regime || 'BULL' });
      }
    }

    if (!points.length || typeof LightweightCharts === 'undefined') {
      _setEmpty(el, points.length ? 'LightweightCharts not loaded' : 'Collecting history...');
      return;
    }

    _setLoading(el);

    try {
      const t   = _theme();
      const w   = el.getBoundingClientRect().width || el.offsetWidth || 600;

      const chart = LightweightCharts.createChart(el, {
        width:  w,
        height,
        layout: {
          background:  { color: t.bg },
          textColor:   t.text,
          fontSize:    11,
          fontFamily:  t.font,
        },
        grid: {
          vertLines: { color: t.grid },
          horzLines: { color: t.grid },
        },
        rightPriceScale: {
          borderColor:  t.border,
          scaleMargins: { top: 0.08, bottom: showLeverage ? 0.35 : 0.1 },
        },
        timeScale: {
          borderColor:     t.border,
          timeVisible:     true,
          secondsVisible:  false,
          rightOffset:     5,
        },
        crosshair: {
          mode:       LightweightCharts.CrosshairMode?.Normal ?? 1,
          vertLine:   { color: t.accent + '60', labelBackgroundColor: t.accent },
          horzLine:   { color: t.accent + '60', labelBackgroundColor: t.accent },
        },
        handleScroll: true,
        handleScale:  true,
      });

      // ── Série NAV principale ────────────────────────────
      const isV4    = typeof LightweightCharts.LineSeries !== 'undefined';
      const navSeries = isV4
        ? chart.addSeries(LightweightCharts.LineSeries, {
            color:           t.accent,
            lineWidth:       2,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius:  5,
            priceFormat:     { type: 'price', precision: 0, minMove: 1 },
            lastValueVisible: true,
            priceLineVisible: true,
          })
        : chart.addLineSeries({
            color:      t.accent,
            lineWidth:  2,
            priceFormat:{ type: 'price', precision: 0, minMove: 1 },
          });

      // ── Série Area sous NAV ──────────────────────────────
      const areaSeries = isV4
        ? chart.addSeries(LightweightCharts.AreaSeries, {
            topColor:    t.accent + '25',
            bottomColor: t.accent + '00',
            lineColor:   'transparent',
            lineWidth:   1,
            priceScaleId: 'right',
          })
        : chart.addAreaSeries({
            topColor:    t.accent + '25',
            bottomColor: t.accent + '00',
            lineColor:   'transparent',
          });

      // ── Données NAV ──────────────────────────────────────
      const navData = points
        .filter(p => p.ts && p.netliq > 0)
        .map(p => ({
          time:  Math.floor(new Date(p.ts).getTime() / 1000),
          value: Math.round(p.netliq),
        }))
        .filter((d, i, arr) => i === 0 || d.time !== arr[i - 1].time)
        .sort((a, b) => a.time - b.time);

      if (!navData.length) {
        chart.remove();
        _setEmpty(el, 'No valid NAV data points');
        return;
      }

      navSeries.setData(navData);
      areaSeries.setData(navData);

      // ── Série Leverage (optionnel) ───────────────────────
      if (showLeverage) {
        const leverageSeries = isV4
          ? chart.addSeries(LightweightCharts.LineSeries, {
              color:        t.orange,
              lineWidth:    1,
              lineStyle:    1,  // dashed
              priceScaleId: 'leverage',
              lastValueVisible: true,
            })
          : chart.addLineSeries({
              color:        t.orange,
              lineWidth:    1,
              priceScaleId: 'leverage',
            });

        chart.priceScale('leverage').applyOptions({
          scaleMargins:    { top: 0.75, bottom: 0.0 },
          borderColor:     t.border,
          entireTextOnly:  true,
        });

        const levData = points
          .filter(p => p.ts && p.leverage > 0)
          .map(p => ({
            time:  Math.floor(new Date(p.ts).getTime() / 1000),
            value: sf(p.leverage),
          }))
          .filter((d, i, arr) => i === 0 || d.time !== arr[i - 1].time)
          .sort((a, b) => a.time - b.time);

        if (levData.length) leverageSeries.setData(levData);
      }

      // ── Markers régime ───────────────────────────────────
      const markers = [];
      let lastRegime = null;
      points.forEach(p => {
        if (p.regime && p.regime !== lastRegime && p.ts) {
          const COLOR = AV_CONFIG.REGIME_COLORS[p.regime]?.bg || '#6b7280';
          markers.push({
            time:     Math.floor(new Date(p.ts).getTime() / 1000),
            position: 'belowBar',
            color:    COLOR,
            shape:    'circle',
            size:     0.5,
            text:     p.regime,
          });
          lastRegime = p.regime;
        }
      });
      if (markers.length) {
        try { navSeries.setMarkers(markers); } catch(e) {}
      }

      chart.timeScale().fitContent();

      // ── ResizeObserver ───────────────────────────────────
      if (typeof ResizeObserver !== 'undefined') {
        let lastW = w;
        const ro  = new ResizeObserver(entries => {
          if (!entries[0]) return;
          const newW = Math.floor(entries[0].contentRect.width);
          if (newW > 0 && Math.abs(newW - lastW) > 4) {
            lastW = newW;
            try { chart.applyOptions({ width: newW }); } catch(e) {}
          }
        });
        ro.observe(el);
        _observers.set(containerId, ro);
      }

      _lwcInstances.set(containerId, chart);
      return chart;

    } catch (err) {
      console.error(`[AVCharts] NAV chart error (${containerId}):`, err);
      _setError(el, `Chart error: ${err.message}`);
    }
  }

  // ══════════════════════════════════════════════════════════
  // DONUT CHART — Chart.js
  // Pour régime probabilities, strategy weights
  // ══════════════════════════════════════════════════════════

  /**
   * @param {string} canvasId
   * @param {object} data      — { labels[], values[], colors[] }
   * @param {object} opts      — { title, cutout, legend }
   */
  function renderDonut(canvasId, data, opts = {}) {
    destroyCJS(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const t = _theme();
    const { title = '', cutout = '70%', legend = true } = opts;

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels:   data.labels  || [],
        datasets: [{
          data:            data.values || [],
          backgroundColor: data.colors || [t.accent, t.green, t.orange, t.red, t.violet],
          borderColor:     t.tooltip,
          borderWidth:     2,
          hoverBorderWidth: 3,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout,
        animation: { duration: 600, easing: 'easeInOutQuart' },
        plugins: {
          legend: {
            display:  legend,
            position: 'bottom',
            labels: {
              color:     t.text,
              font:      { size: 11, family: t.font },
              padding:   10,
              boxWidth:  12,
              boxHeight: 12,
            },
          },
          tooltip: {
            backgroundColor: t.tooltip,
            titleColor:      t.textPrimary,
            bodyColor:       t.text,
            borderColor:     t.tooltipBorder,
            borderWidth:     1,
            padding:         10,
            callbacks: {
              label: ctx => {
                const v = ctx.parsed || 0;
                return ` ${ctx.label}: ${(v * (v <= 1 ? 100 : 1)).toFixed(1)}%`;
              },
            },
          },
          ...(title ? {
            title: {
              display:  true,
              text:     title,
              color:    t.textPrimary,
              font:     { size: 12, weight: '700', family: t.font },
              padding:  { bottom: 8 },
            },
          } : {}),
        },
      },
    });

    _cjsInstances.set(canvasId, chart);
    return chart;
  }

  // ══════════════════════════════════════════════════════════
  // BAR CHART — Chart.js
  // Pour distributions, signaux, AUC scores
  // ══════════════════════════════════════════════════════════

  /**
   * @param {string} canvasId
   * @param {object} data      — { labels[], datasets[] }
   * @param {object} opts      — { horizontal, stacked, yMax }
   */
  function renderBar(canvasId, data, opts = {}) {
    destroyCJS(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const t = _theme();
    const { horizontal = false, stacked = false, yMax = null, yLabel = '' } = opts;

    const chart = new Chart(canvas.getContext('2d'), {
      type: horizontal ? 'bar' : 'bar',
      data,
      options: {
        indexAxis:           horizontal ? 'y' : 'x',
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 500 },
        plugins: {
          legend: {
            display:  data.datasets?.length > 1,
            labels:   { color: t.text, font: { size: 11, family: t.font }, padding: 10, boxWidth: 12 },
          },
          tooltip: {
            backgroundColor: t.tooltip,
            titleColor:      t.textPrimary,
            bodyColor:       t.text,
            borderColor:     t.tooltipBorder,
            borderWidth:     1,
            padding:         10,
          },
        },
        scales: {
          x: {
            stacked,
            grid:   { color: t.grid },
            ticks:  { color: t.text, font: { size: 10, family: t.font }, maxTicksLimit: 8 },
            border: { color: t.border },
          },
          y: {
            stacked,
            max:    yMax,
            grid:   { color: t.grid },
            ticks:  { color: t.text, font: { size: 10, family: t.font } },
            border: { color: t.border },
            ...(yLabel ? { title: { display: true, text: yLabel, color: t.text, font: { size: 10 } } } : {}),
          },
        },
      },
    });

    _cjsInstances.set(canvasId, chart);
    return chart;
  }

  // ══════════════════════════════════════════════════════════
  // LINE CHART — Chart.js
  // Pour AUC history, RSI, MACD, etc.
  // ══════════════════════════════════════════════════════════

  function renderLine(canvasId, data, opts = {}) {
    destroyCJS(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined') return;

    const t = _theme();
    const { yMin, yMax, yLabel = '', xLabel = '', tension = 0.4, fill = false } = opts;

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data,
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           { duration: 500 },
        interaction:         { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: data.datasets?.length > 1,
            labels:  { color: t.text, font: { size: 11, family: t.font }, padding: 10, boxWidth: 12 },
          },
          tooltip: {
            backgroundColor: t.tooltip,
            titleColor:      t.textPrimary,
            bodyColor:       t.text,
            borderColor:     t.tooltipBorder,
            borderWidth:     1,
            padding:         10,
          },
        },
        scales: {
          x: {
            grid:   { color: t.grid },
            ticks:  { color: t.text, font: { size: 10, family: t.font }, maxTicksLimit: 8 },
            border: { color: t.border },
            ...(xLabel ? { title: { display: true, text: xLabel, color: t.text } } : {}),
          },
          y: {
            min:    yMin,
            max:    yMax,
            grid:   { color: t.grid },
            ticks:  { color: t.text, font: { size: 10, family: t.font } },
            border: { color: t.border },
            ...(yLabel ? { title: { display: true, text: yLabel, color: t.text, font: { size: 10 } } } : {}),
          },
        },
      },
    });

    _cjsInstances.set(canvasId, chart);
    return chart;
  }

  // ══════════════════════════════════════════════════════════
  // SPARKLINE — Mini chart inline dans les KPI cards
  // ══════════════════════════════════════════════════════════

  /**
   * Trace une sparkline minimaliste dans un canvas
   * @param {string} canvasId
   * @param {number[]} values
   * @param {object} opts — { color, height, fill }
   */
  function renderSparkline(canvasId, values, opts = {}) {
    destroyCJS(canvasId);
    const canvas = document.getElementById(canvasId);
    if (!canvas || typeof Chart === 'undefined' || !values?.length) return;

    const t = _theme();
    const { color = t.accent, fill = true } = opts;
    const trend = (values.at(-1) || 0) >= (values[0] || 0);
    const c     = trend ? t.green : t.red;
    const useColor = color === 'auto' ? c : color;

    const chart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels:   values.map((_, i) => i),
        datasets: [{
          data:            values,
          borderColor:     useColor,
          backgroundColor: fill ? useColor + '20' : 'transparent',
          borderWidth:     1.5,
          pointRadius:     0,
          fill,
          tension:         0.4,
          spanGaps:        true,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation:           false,
        plugins:  { legend: { display: false }, tooltip: { enabled: false } },
        scales:   {
          x: { display: false },
          y: { display: false },
        },
        elements: { line: { borderCapStyle: 'round' } },
      },
    });

    _cjsInstances.set(canvasId, chart);
    return chart;
  }

  // ══════════════════════════════════════════════════════════
  // REGIME PROBABILITY DONUT — Spécialisé pour regime.html
  // ══════════════════════════════════════════════════════════

  function renderRegimeDonut(canvasId, probabilities = {}) {
    const REGIMES = ['BULL', 'BEAR', 'NEUTRAL', 'CRISIS'];
    const labels  = REGIMES;
    const values  = REGIMES.map(r => sf(probabilities[r] || 0) * 100);
    const colors  = REGIMES.map(r => AV_CONFIG.REGIME_COLORS[r]?.bg || '#6b7280');

    return renderDonut(canvasId, { labels, values, colors }, {
      cutout: '68%',
      legend: true,
    });
  }

  // ══════════════════════════════════════════════════════════
  // STRATEGY WEIGHTS DONUT — Spécialisé pour signals.html
  // ══════════════════════════════════════════════════════════

  function renderStrategyDonut(canvasId, weights = {}) {
    const labels = ['Trend', 'Mean Reversion', 'Vol Carry'];
    const keys   = ['trend', 'mean_reversion', 'vol_carry'];
    const values = keys.map(k => sf(weights[k] || 0) * 100);
    const colors = ['#3b82f6', '#10b981', '#8b5cf6'];

    return renderDonut(canvasId, { labels, values, colors }, {
      cutout: '65%',
      legend: true,
    });
  }

  // ══════════════════════════════════════════════════════════
  // AUC PROGRESS BARS — Pour agents.html (pas Chart.js)
  // ══════════════════════════════════════════════════════════

  /**
   * Génère le HTML d'une barre AUC colorée
   * @param {number} auc  — 0.0 à 1.0
   * @param {string} label
   */
  function aucBar(auc, label = '') {
    const v   = sf(auc);
    const pct = (v * 100).toFixed(1);

    if (v === 0) {
      return `<div style="display:flex;align-items:center;gap:10px">
        <div style="flex:1">${progressBar(0, '#6b7280')}</div>
        <span style="font-size:11px;color:var(--text-muted);min-width:60px">Not trained</span>
      </div>`;
    }

    const color = v >= 0.75 ? '#10b981'
                : v >= 0.60 ? '#3b82f6'
                : v >= 0.50 ? '#f59e0b'
                : '#ef4444';

    const grade = v >= 0.75 ? 'Excellent'
                : v >= 0.60 ? 'Good'
                : v >= 0.50 ? 'Fair'
                : 'Poor';

    return `<div style="display:flex;align-items:center;gap:10px">
      <div style="flex:1">${progressBar(pct, color)}</div>
      <span style="font-size:12px;font-weight:700;color:${color};font-family:var(--font-mono);min-width:45px">${pct}%</span>
      <span style="font-size:10px;color:var(--text-muted);min-width:55px">${grade}</span>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // SIGNALS DISTRIBUTION — Bar chart BUY/SELL
  // ══════════════════════════════════════════════════════════

  function renderSignalsDistribution(canvasId, signalsMeta) {
    const t = _theme();
    return renderBar(canvasId, {
      labels: ['BUY', 'SELL', 'High Conf'],
      datasets: [{
        data: [
          sf(signalsMeta?.n_buy       || 0),
          sf(signalsMeta?.n_sell      || 0),
          sf(signalsMeta?.n_high_conf || 0),
        ],
        backgroundColor: [
          t.green  + 'CC',
          t.red    + 'CC',
          '#eab308CC',
        ],
        borderColor: [t.green, t.red, '#eab308'],
        borderWidth: 1,
        borderRadius: 6,
      }],
    }, { yLabel: 'Signals' });
  }

  // ══════════════════════════════════════════════════════════
  // TIMEFRAME SELECTOR — HTML helper
  // ══════════════════════════════════════════════════════════

  /**
   * Génère le HTML d'un sélecteur de timeframe
   * @param {string}   activeFrame  — '1D'|'1W'|'1M'|'ALL'
   * @param {string}   onClickAttr — attribut onclick ou data-* à injecter
   * @param {string[]} frames
   */
  function timeframeSelector(activeFrame = 'ALL', idPrefix = 'tf', frames = ['1D', '1W', '1M', 'ALL']) {
    return `<div class="chart-timeframes" id="${idPrefix}-selector">
      ${frames.map(f => `
        <button class="tf-btn ${f === activeFrame ? 'active' : ''}"
                data-tf="${f}" data-prefix="${idPrefix}">
          ${f}
        </button>`).join('')}
    </div>`;
  }

  /**
   * Bind les événements d'un timeframe selector
   * @param {string} idPrefix  — même que celui passé à timeframeSelector()
   * @param {function} onChange — (frame) => void
   */
  function bindTimeframeSelector(idPrefix, onChange) {
    const sel = document.getElementById(`${idPrefix}-selector`);
    if (!sel) return;
    sel.addEventListener('click', e => {
      const btn = e.target.closest('.tf-btn');
      if (!btn) return;
      sel.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(btn.dataset.tf);
    });
  }

  // ══════════════════════════════════════════════════════════
  // CHART HEADER — Helper HTML standard
  // ══════════════════════════════════════════════════════════

  /**
   * Génère le header standard d'une carte graphique
   */
  function chartHeader({
    title      = '',
    subtitle   = '',
    icon       = 'fa-chart-line',
    timeframes = null,    // null = pas de selector
    tfPrefix   = 'tf',
    activeTf   = 'ALL',
    exportId   = null,
    id         = '',
  } = {}) {
    return `
      <div class="chart-header" ${id ? `id="${id}"` : ''}>
        <div class="chart-header-left">
          <i class="fa-solid ${icon}" style="color:var(--accent-blue)"></i>
          <div>
            <div class="chart-title">${title}</div>
            ${subtitle ? `<div class="chart-subtitle">${subtitle}</div>` : ''}
          </div>
        </div>
        <div class="chart-header-right">
          ${timeframes ? timeframeSelector(activeTf, tfPrefix, timeframes) : ''}
          ${exportId ? `
            <button class="btn-icon" id="${exportId}" title="Export chart">
              <i class="fa-solid fa-download"></i>
            </button>` : ''}
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // NAV CHART CARD — Composite (header + chart + selector)
  // ══════════════════════════════════════════════════════════

  /**
   * Render complet du NAV chart avec timeframe selector
   * Utilisé dans dashboard.html et analytics.html
   */
  async function renderNAVCard(cardContainerId, historyPoints, currentNetliq, opts = {}) {
    const container = document.getElementById(cardContainerId);
    if (!container) return;

    const { height = 300, showLeverage = false } = opts;
    let currentTf = 'ALL';

    const chartId = `${cardContainerId}-lwc`;

    container.innerHTML = `
      ${chartHeader({
        title:      'Portfolio NAV',
        subtitle:   `${historyPoints?.length || 0} data points`,
        icon:       'fa-chart-area',
        timeframes: ['1D', '1W', '1M', 'ALL'],
        tfPrefix:   `${cardContainerId}-tf`,
        activeTf:   currentTf,
      })}
      <div id="${chartId}" style="height:${height}px;min-height:${height}px;overflow:hidden;position:relative"></div>
      <div class="chart-legend" style="padding:8px 16px;font-size:11px;color:var(--text-muted);display:flex;gap:16px">
        <span><i class="fa-solid fa-circle" style="color:#3b82f6;font-size:8px"></i> NAV ($)</span>
        ${showLeverage ? `<span><i class="fa-solid fa-circle" style="color:#f59e0b;font-size:8px"></i> Leverage (x)</span>` : ''}
        <span style="margin-left:auto">Source: rolling_history.json · Refresh: 60s</span>
      </div>`;

    // Render initial
    await renderNAVChart(chartId, historyPoints, { height, showLeverage, timeframe: currentTf, currentNetliq });

    // Bind timeframe selector
    bindTimeframeSelector(`${cardContainerId}-tf`, async (tf) => {
      currentTf = tf;
      destroyLWC(chartId);
      await renderNAVChart(chartId, historyPoints, {
        height, showLeverage, timeframe: tf, currentNetliq,
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // CONFIDENCE PROGRESS BAR — inline dans les tables
  // ══════════════════════════════════════════════════════════

  /**
   * Génère une mini progress bar + valeur pour la confidence ML
   */
  function confidenceBar(confidence) {
    const pct   = sf(confidence) * 100;
    const isHigh = pct >= AV_CONFIG.THRESHOLDS.highConf * 100;
    const color  = pct >= 85 ? '#10b981'
                 : pct >= 75 ? '#3b82f6'
                 : pct >= 60 ? '#f59e0b'
                 : '#6b7280';

    return `<div style="display:flex;align-items:center;gap:6px;min-width:100px">
      <div style="flex:1;height:5px;border-radius:3px;background:rgba(148,163,184,0.15);overflow:hidden">
        <div style="width:${pct.toFixed(1)}%;height:100%;background:${color};border-radius:3px;transition:width 0.4s ease"></div>
      </div>
      <span style="font-size:11px;font-weight:700;font-family:var(--font-mono);color:${color};min-width:38px">
        ${pct.toFixed(1)}%${isHigh ? ' <i class="fa-solid fa-star" style="font-size:8px;color:#eab308"></i>' : ''}
      </span>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // REFRESH ON THEME CHANGE — Re-render tous les charts
  // ══════════════════════════════════════════════════════════

  function onThemeChange(callbacks = []) {
    const observer = new MutationObserver(mutations => {
      mutations.forEach(m => {
        if (m.attributeName === 'data-theme') {
          callbacks.forEach(cb => { try { cb(); } catch(e) {} });
        }
      });
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => observer.disconnect();
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    // LightweightCharts
    renderNAVChart,
    renderNAVCard,

    // Chart.js
    renderDonut,
    renderBar,
    renderLine,
    renderSparkline,

    // Spécialisés
    renderRegimeDonut,
    renderStrategyDonut,
    renderSignalsDistribution,
    confidenceBar,
    aucBar,

    // Helpers HTML
    timeframeSelector,
    bindTimeframeSelector,
    chartHeader,

    // Theme
    onThemeChange,

    // Cleanup
    destroyLWC,
    destroyCJS,
    destroyAll,

    // État
    _setLoading,
    _setEmpty,
    _setError,
  };

})();

window.AVCharts = AVCharts;
console.log('[av-charts] Loaded — LWC NAV chart | Chart.js donut/bar/line/sparkline | Timeframe selector');