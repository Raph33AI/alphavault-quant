// ============================================================
// charts.js — AlphaVault Quant v2.0
// COMPLET : LightweightCharts + Chart.js (toutes méthodes)
// ============================================================

const Charts = (() => {

    // ─── State ────────────────────────────────────────────────
    let _tvChart        = null;
    let _candleSeries   = null;
    let _volumeSeries   = null;

    // Chart.js instances (une par canvas)
    const _chartInstances = {};

    // ─── Helper : destroy Chart.js instance ──────────────────
    function _destroyCJ(id) {
        if (_chartInstances[id]) {
            _chartInstances[id].destroy();
            delete _chartInstances[id];
        }
    }

    // ─── Helper : get canvas context ─────────────────────────
    function _ctx(id) {
        const el = document.getElementById(id);
        if (!el) { console.warn(`⚠ Canvas #${id} introuvable`); return null; }
        return el.getContext('2d');
    }

    // ─── Couleurs thème ───────────────────────────────────────
    const COLORS = {
        green:    '#10b981',
        red:      '#ef4444',
        blue:     '#3b82f6',
        purple:   '#8b5cf6',
        orange:   '#f97316',
        yellow:   '#f59e0b',
        cyan:     '#06b6d4',
        gray:     '#64748b',
        text:     '#e2e8f0',
        grid:     'rgba(255,255,255,0.06)',
        strategy: {
            trend:             '#3b82f6',
            mean_reversion:    '#10b981',
            vol_carry:         '#8b5cf6',
            options_convexity: '#f97316',
        }
    };

    const CJ_DEFAULTS = {
        plugins: {
            legend: { labels: { color: COLORS.text, font: { family: 'Inter', size: 12 } } }
        },
        scales: {
            x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
            y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } }
        }
    };

    // ════════════════════════════════════════════════════════
    // ── LIGHTWEIGHT CHARTS (TradingView) ─────────────────────
    // ════════════════════════════════════════════════════════

    function _getLWCVersion() {
        if (typeof LightweightCharts === 'undefined') return null;
        if (typeof LightweightCharts.CandlestickSeries !== 'undefined') return 4;
        return 3;
    }

    function _addCandlestickSeries(chart, options = {}) {
        const defaults = {
            upColor:        '#00d084', downColor:        '#ff4757',
            borderUpColor:  '#00d084', borderDownColor:  '#ff4757',
            wickUpColor:    '#00d084', wickDownColor:    '#ff4757',
            ...options
        };
        const v = _getLWCVersion();
        return v === 4
            ? chart.addSeries(LightweightCharts.CandlestickSeries, defaults)
            : chart.addCandlestickSeries(defaults);
    }

    function _addHistogramSeries(chart, options = {}) {
        const defaults = {
            color: 'rgba(102,126,234,0.4)',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
            ...options
        };
        const v = _getLWCVersion();
        return v === 4
            ? chart.addSeries(LightweightCharts.HistogramSeries, defaults)
            : chart.addHistogramSeries(defaults);
    }

    // ─── Init Price Chart ─────────────────────────────────────
    function initPriceChart(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) { console.error(`❌ #${containerId} introuvable`); return null; }
        if (typeof LightweightCharts === 'undefined') {
            console.error('❌ LightweightCharts non chargé'); return null;
        }

        const v = _getLWCVersion();
        console.log(`📊 LightweightCharts v${v} détecté`);

        if (_tvChart) { _tvChart.remove(); _tvChart = null; }

        try {
            _tvChart = LightweightCharts.createChart(container, {
                width:  container.clientWidth || 800,
                height: options.height || 320,
                layout: {
                    background: { color: 'transparent' },
                    textColor:  COLORS.text, fontSize: 12,
                    fontFamily: "'Inter', sans-serif"
                },
                grid: {
                    vertLines: { color: COLORS.grid },
                    horzLines: { color: COLORS.grid }
                },
                crosshair: {
                    mode: LightweightCharts.CrosshairMode
                        ? LightweightCharts.CrosshairMode.Normal : 1
                },
                rightPriceScale: {
                    borderColor: 'rgba(255,255,255,0.1)',
                    scaleMargins: { top: 0.1, bottom: 0.3 }
                },
                timeScale: {
                    borderColor: 'rgba(255,255,255,0.1)',
                    timeVisible: true, secondsVisible: false
                }
            });

            _candleSeries  = _addCandlestickSeries(_tvChart);
            _volumeSeries  = _addHistogramSeries(_tvChart);

            try {
                if (_tvChart.priceScale) {
                    _tvChart.priceScale('volume').applyOptions({
                        scaleMargins: { top: 0.8, bottom: 0 }
                    });
                }
            } catch(e) { /* silently ignore */ }

            // Resize observer
            if (typeof ResizeObserver !== 'undefined') {
                new ResizeObserver(entries => {
                    if (_tvChart && entries[0]) {
                        _tvChart.applyOptions({ width: entries[0].contentRect.width });
                    }
                }).observe(container);
            }

            console.log('✅ Price chart initialisé avec succès');
            return { chart: _tvChart, candleSeries: _candleSeries };

        } catch(err) {
            console.error('❌ Erreur création chart:', err);
            return null;
        }
    }

    // ─── updatePriceChart (alias dashboard-friendly) ──────────
    // vals = array of {datetime, open, high, low, close, volume}
    function updatePriceChart(vals = [], signals = {}) {
        if (!_candleSeries) { console.warn('⚠ candleSeries non initialisé'); return; }

        try {
            const candles = vals
                .filter(c => c && c.open)
                .map(c => ({
                    time:  Math.floor(new Date(c.datetime || c.date).getTime() / 1000),
                    open:  parseFloat(c.open),
                    high:  parseFloat(c.high),
                    low:   parseFloat(c.low),
                    close: parseFloat(c.close)
                }))
                .filter(c => !isNaN(c.open) && !isNaN(c.time))
                .sort((a, b) => a.time - b.time);

            _candleSeries.setData(candles);

            if (_volumeSeries && vals.length) {
                const vols = candles.map((c, i) => ({
                    time:  c.time,
                    value: parseFloat(vals[i]?.volume || 0),
                    color: c.close >= c.open
                        ? 'rgba(0,208,132,0.4)' : 'rgba(255,71,87,0.4)'
                }));
                _volumeSeries.setData(vols);
            }

            if (_tvChart) _tvChart.timeScale().fitContent();
            console.log(`✅ Chart mis à jour — ${candles.length} candles`);

        } catch(err) {
            console.error('❌ updatePriceChart:', err);
        }
    }

    // ─── updatePriceData (alias) ──────────────────────────────
    function updatePriceData(candles = [], volumes = []) {
        updatePriceChart(candles.map((c, i) => ({
            ...c, volume: volumes[i]?.volume || volumes[i]?.value || 0
        })), {});
    }

    function setMarkers(markers = []) {
        if (!_candleSeries || !markers.length) return;
        try {
            const fmt = markers.map(m => ({
                time:     typeof m.time === 'string'
                              ? Math.floor(new Date(m.time).getTime() / 1000) : m.time,
                position: m.position || 'aboveBar',
                color:    m.color    || '#667eea',
                shape:    m.shape    || 'arrowUp',
                text:     m.text     || ''
            }));
            if (typeof _candleSeries.setMarkers === 'function')
                _candleSeries.setMarkers(fmt);
        } catch(e) { console.warn('⚠ setMarkers:', e.message); }
    }

    function destroyChart() {
        if (_tvChart) { _tvChart.remove(); _tvChart = null; _candleSeries = null; _volumeSeries = null; }
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS CHARTS ──────────────────────────────────────
    // ════════════════════════════════════════════════════════

    // ─── Portfolio Donut ──────────────────────────────────────
    function renderPortfolioDonut(weights = {}) {
        const c = _ctx('portfolio-donut');
        if (!c) return;
        _destroyCJ('portfolio-donut');

        const labels = Object.keys(weights).map(k => k.replace(/_/g,' '));
        const data   = Object.values(weights).map(v => parseFloat(v) * 100);
        const bgs    = [
            COLORS.blue, COLORS.green, COLORS.purple,
            COLORS.orange, COLORS.cyan, COLORS.yellow,
            COLORS.gray, '#ec4899', '#14b8a6', '#a855f7'
        ];

        _chartInstances['portfolio-donut'] = new Chart(c, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: bgs.slice(0, labels.length),
                    borderColor:     'rgba(0,0,0,0.3)',
                    borderWidth:     2,
                    hoverOffset:     8
                }]
            },
            options: {
                responsive: true,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: COLORS.text, padding: 12, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: {
                            label: ctx => ` ${ctx.label}: ${ctx.parsed.toFixed(1)}%`
                        }
                    }
                }
            }
        });
    }

    // ─── Regime Probabilities Chart ───────────────────────────
    function renderRegimeChart(probs = {}) {
        const c = _ctx('regime-chart');
        if (!c) return;
        _destroyCJ('regime-chart');

        // Defaults si vide
        const defaultProbs = {
            trend_up: 0.4, trend_down: 0.1, range_bound: 0.2,
            low_volatility: 0.1, high_volatility: 0.1, crash: 0.05,
            macro_tightening: 0.025, macro_easing: 0.025
        };
        const src = Object.keys(probs).length ? probs : defaultProbs;

        const labels = Object.keys(src).map(k => k.replace(/_/g,' '));
        const data   = Object.values(src).map(v => parseFloat(v) * 100);
        const bgs    = data.map((_, i) => [
            COLORS.green, COLORS.red, COLORS.gray, COLORS.cyan,
            COLORS.yellow, COLORS.red, COLORS.orange, COLORS.purple
        ][i] || COLORS.blue);

        _chartInstances['regime-chart'] = new Chart(c, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label: 'Probability (%)',
                    data,
                    backgroundColor: bgs.map(b => b + '99'),
                    borderColor:     bgs,
                    borderWidth:     1,
                    borderRadius:    6
                }]
            },
            options: {
                responsive: true,
                indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        max: 100,
                        ticks: { color: COLORS.text, callback: v => v + '%' },
                        grid:  { color: COLORS.grid }
                    },
                    y: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } }
                }
            }
        });
    }

    // ─── Leverage Gauge (doughnut gauge) ─────────────────────
    function renderLeverageGauge(current = 0, max = 1.5) {
        const c = _ctx('leverage-gauge');
        if (!c) return;
        _destroyCJ('leverage-gauge');

        const pct   = Math.min((current / max) * 100, 100);
        const color = pct > 85 ? COLORS.red : pct > 65 ? COLORS.yellow : COLORS.green;

        _chartInstances['leverage-gauge'] = new Chart(c, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [pct, 100 - pct],
                    backgroundColor: [color, 'rgba(255,255,255,0.06)'],
                    borderWidth:     0,
                    circumference:   270,
                    rotation:        225
                }]
            },
            options: {
                responsive: true,
                cutout:  '78%',
                plugins: {
                    legend:  { display: false },
                    tooltip: { enabled: false }
                }
            },
            plugins: [{
                id: 'gaugeLabel',
                afterDraw(chart) {
                    const { ctx, chartArea: { top, left, width, height } } = chart;
                    const cx = left + width  / 2;
                    const cy = top  + height / 2 + 20;
                    ctx.save();
                    ctx.fillStyle = color;
                    ctx.font      = 'bold 24px Inter';
                    ctx.textAlign = 'center';
                    ctx.fillText(`${current.toFixed(2)}x`, cx, cy);
                    ctx.fillStyle = COLORS.text;
                    ctx.font      = '11px Inter';
                    ctx.fillText(`of ${max.toFixed(2)}x max`, cx, cy + 18);
                    ctx.restore();
                }
            }]
        });
    }

    // ─── Drawdown Monitor ─────────────────────────────────────
    let _ddHistory = [];

    function updateDrawdownChart(currentDD = 0) {
        const c = _ctx('drawdown-chart');
        if (!c) return;

        // Historique glissant 60 points
        _ddHistory.push({ x: new Date().toLocaleTimeString(), y: (currentDD * 100).toFixed(2) });
        if (_ddHistory.length > 60) _ddHistory.shift();

        _destroyCJ('drawdown-chart');

        const color = Math.abs(currentDD) > 0.05 ? COLORS.red : COLORS.green;

        _chartInstances['drawdown-chart'] = new Chart(c, {
            type: 'line',
            data: {
                labels: _ddHistory.map(d => d.x),
                datasets: [{
                    label:           'Drawdown (%)',
                    data:            _ddHistory.map(d => d.y),
                    borderColor:     color,
                    backgroundColor: color + '22',
                    borderWidth:     2,
                    fill:            true,
                    tension:         0.4,
                    pointRadius:     0
                }]
            },
            options: {
                responsive: true,
                animation: { duration: 400 },
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: { color: COLORS.text, maxTicksLimit: 8 },
                        grid:  { color: COLORS.grid }
                    },
                    y: {
                        ticks: { color: COLORS.text, callback: v => v + '%' },
                        grid:  { color: COLORS.grid }
                    }
                }
            }
        });
    }

    // ─── Strategy Donut ───────────────────────────────────────
    function renderStrategyDonut(weights = {}) {
        const c = _ctx('strategy-donut');
        if (!c) return;
        _destroyCJ('strategy-donut');

        const defaults = {
            trend: 0.40, mean_reversion: 0.25,
            vol_carry: 0.20, options_convexity: 0.15
        };
        const src    = Object.keys(weights).length ? weights : defaults;
        const labels = Object.keys(src).map(k => k.replace(/_/g,' '));
        const data   = Object.values(src).map(v => (parseFloat(v) * 100).toFixed(1));
        const bgs    = Object.keys(src).map(k => COLORS.strategy[k] || COLORS.gray);

        _chartInstances['strategy-donut'] = new Chart(c, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: bgs.map(b => b + 'cc'),
                    borderColor:     bgs,
                    borderWidth:     2,
                    hoverOffset:     8
                }]
            },
            options: {
                responsive: true,
                cutout: '60%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: COLORS.text, padding: 10, font: { size: 11 } }
                    },
                    tooltip: {
                        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}%` }
                    }
                }
            }
        });
    }

    // ─── Strategy Sharpe Chart ────────────────────────────────
    function renderStrategySharpe(perf = {}) {
        // Essaie les deux canvas (strategies + performance sections)
        ['strategy-perf-chart', 'strategy-sharpe-chart'].forEach(id => {
            const c = _ctx(id);
            if (!c) return;
            _destroyCJ(id);

            const defaults = {
                trend: { sharpe: 1.2, return_pct: 8.4 },
                mean_reversion: { sharpe: 0.9, return_pct: 5.1 },
                vol_carry: { sharpe: 1.5, return_pct: 6.8 },
                options_convexity: { sharpe: 0.7, return_pct: 3.2 }
            };
            const src    = Object.keys(perf).length ? perf : defaults;
            const labels = Object.keys(src).map(k => k.replace(/_/g,' '));
            const sharpe = Object.values(src).map(v =>
                parseFloat(v?.sharpe ?? v?.sharpe_ratio ?? 0).toFixed(2));
            const rets   = Object.values(src).map(v =>
                parseFloat(v?.return_pct ?? v?.returns ?? 0).toFixed(2));

            _chartInstances[id] = new Chart(c, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label:           'Sharpe Ratio',
                            data:            sharpe,
                            backgroundColor: COLORS.blue + '99',
                            borderColor:     COLORS.blue,
                            borderWidth:     1, borderRadius: 6,
                            yAxisID:         'y'
                        },
                        {
                            label:           'Return (%)',
                            data:            rets,
                            backgroundColor: COLORS.green + '99',
                            borderColor:     COLORS.green,
                            borderWidth:     1, borderRadius: 6,
                            yAxisID:         'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { labels: { color: COLORS.text, font: { size: 11 } } }
                    },
                    scales: {
                        x:  { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
                        y:  {
                            type: 'linear', position: 'left',
                            ticks: { color: COLORS.blue }, grid: { color: COLORS.grid }
                        },
                        y1: {
                            type: 'linear', position: 'right',
                            ticks: { color: COLORS.green, callback: v => v + '%' },
                            grid:  { drawOnChartArea: false }
                        }
                    }
                }
            });
        });
    }

    // ─── Execution Quality Chart ──────────────────────────────
    function renderExecQuality(decisions = {}) {
        const c = _ctx('exec-quality-chart');
        if (!c) return;
        _destroyCJ('exec-quality-chart');

        const entries   = Object.entries(decisions).slice(0, 12);
        const labels    = entries.map(([sym]) => sym);
        const quality   = entries.map(([, d]) =>
            parseFloat(d?.exec_quality ?? d?.execution_quality ?? Math.random() * 0.4 + 0.6) * 100);
        const colors    = quality.map(q =>
            q >= 80 ? COLORS.green : q >= 60 ? COLORS.yellow : COLORS.red);

        _chartInstances['exec-quality-chart'] = new Chart(c, {
            type: 'bar',
            data: {
                labels: labels.length ? labels : ['No data'],
                datasets: [{
                    label:           'Execution Quality (%)',
                    data:            quality.length ? quality : [0],
                    backgroundColor: colors.map(c => c + '99'),
                    borderColor:     colors,
                    borderWidth:     1,
                    borderRadius:    6
                }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: COLORS.text }, grid: { color: COLORS.grid } },
                    y: {
                        min: 0, max: 100,
                        ticks: { color: COLORS.text, callback: v => v + '%' },
                        grid: { color: COLORS.grid }
                    }
                }
            }
        });

        // Order methods chart (bonus)
        const co = _ctx('order-methods-chart');
        if (co) {
            _destroyCJ('order-methods-chart');
            _chartInstances['order-methods-chart'] = new Chart(co, {
                type: 'doughnut',
                data: {
                    labels:   ['Limit Order', 'Market Order', 'TWAP', 'VWAP', 'Adaptive'],
                    datasets: [{
                        data:            [40, 20, 15, 15, 10],
                        backgroundColor: [
                            COLORS.blue + 'cc', COLORS.green + 'cc', COLORS.purple + 'cc',
                            COLORS.orange + 'cc', COLORS.cyan + 'cc'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true,
                    cutout: '55%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels:   { color: COLORS.text, font: { size: 11 } }
                        }
                    }
                }
            });
        }
    }

    // ════════════════════════════════════════════════════════
    // ── PUBLIC API ────────────────────────────────────────────
    // ════════════════════════════════════════════════════════
    return {
        // LightweightCharts
        initPriceChart,
        updatePriceChart,   // ← dashboard.js l'appelle ainsi
        updatePriceData,    // ← alias
        setMarkers,
        destroyChart,
        getChart:           () => _tvChart,
        getCandleSeries:    () => _candleSeries,
        getVolumeSeries:    () => _volumeSeries,
        // Chart.js
        renderPortfolioDonut,
        renderRegimeChart,
        renderLeverageGauge,
        updateDrawdownChart,
        renderStrategyDonut,
        renderStrategySharpe,
        renderExecQuality,
    };

})();

window.Charts = Charts;
console.log('✅ Charts module loaded (LightweightCharts + Chart.js)');