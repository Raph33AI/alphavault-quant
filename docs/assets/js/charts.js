// ============================================================
// charts.js — AlphaVault Quant v2.0
// ✅ LightweightCharts v3/v4 compatible
// ✅ Toutes méthodes Chart.js pour le dashboard
// ============================================================

const Charts = (() => {

    // ─── State ────────────────────────────────────────────────
    let _tvChart      = null;
    let _candleSeries = null;
    let _volumeSeries = null;

    // Registre des instances Chart.js (une par canvas)
    const _cjInstances = {};

    // ─── Couleurs thème ───────────────────────────────────────
    const C = {
        green:   '#10b981', red:    '#ef4444',
        blue:    '#3b82f6', purple: '#8b5cf6',
        orange:  '#f97316', yellow: '#f59e0b',
        cyan:    '#06b6d4', gray:   '#64748b',
        text:    '#e2e8f0', grid:   'rgba(255,255,255,0.06)',
        strategy: {
            trend:             '#3b82f6',
            mean_reversion:    '#10b981',
            vol_carry:         '#8b5cf6',
            options_convexity: '#f97316',
        }
    };

    // Palette tournante pour les donuts
    const PALETTE = [
        C.blue, C.green, C.purple, C.orange,
        C.cyan, C.yellow, C.gray, '#ec4899', '#14b8a6', '#a855f7'
    ];

    // ════════════════════════════════════════════════════════
    // ── UTILS ────────────────────────────────────────────────
    // ════════════════════════════════════════════════════════

    // Détruit une instance Chart.js existante sur un canvas
    function _destroyCJ(id) {
        if (_cjInstances[id]) {
            _cjInstances[id].destroy();
            delete _cjInstances[id];
        }
    }

    // Récupère le contexte 2D d'un canvas (avec log si absent)
    function _ctx(id) {
        const el = document.getElementById(id);
        if (!el) { return null; } // Canvas pas visible (section inactive) → silencieux
        return el.getContext('2d');
    }

    // Options Chart.js par défaut (thème dark)
    function _baseOpts(extra = {}) {
        return {
            responsive:          true,
            maintainAspectRatio: true,
            animation:           { duration: 500 },
            plugins: {
                legend: {
                    labels: {
                        color:  C.text,
                        font:   { family: 'Inter', size: 11 },
                        padding: 12
                    }
                }
            },
            scales: {
                x: { ticks: { color: C.text }, grid: { color: C.grid } },
                y: { ticks: { color: C.text }, grid: { color: C.grid } }
            },
            ...extra
        };
    }

    // ════════════════════════════════════════════════════════
    // ── LIGHTWEIGHT CHARTS (TradingView) ─────────────────────
    // ════════════════════════════════════════════════════════

    function _getLWCVersion() {
        if (typeof LightweightCharts === 'undefined') return null;
        return typeof LightweightCharts.CandlestickSeries !== 'undefined' ? 4 : 3;
    }

    function _addCandleSeries(chart, opts = {}) {
        const d = {
            upColor: '#00d084', downColor: '#ff4757',
            borderUpColor: '#00d084', borderDownColor: '#ff4757',
            wickUpColor: '#00d084', wickDownColor: '#ff4757',
            ...opts
        };
        return _getLWCVersion() === 4
            ? chart.addSeries(LightweightCharts.CandlestickSeries, d)
            : chart.addCandlestickSeries(d);
    }

    function _addHistoSeries(chart, opts = {}) {
        const d = {
            color: 'rgba(102,126,234,0.4)',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume', ...opts
        };
        return _getLWCVersion() === 4
            ? chart.addSeries(LightweightCharts.HistogramSeries, d)
            : chart.addHistogramSeries(d);
    }

    // ─── initPriceChart ───────────────────────────────────────
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
                    background:  { color: 'transparent' },
                    textColor:   C.text,
                    fontSize:    12,
                    fontFamily:  "'Inter', sans-serif"
                },
                grid: {
                    vertLines: { color: C.grid },
                    horzLines: { color: C.grid }
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

            _candleSeries = _addCandleSeries(_tvChart);
            _volumeSeries = _addHistoSeries(_tvChart);

            try {
                if (_tvChart.priceScale) {
                    _tvChart.priceScale('volume').applyOptions({
                        scaleMargins: { top: 0.8, bottom: 0 }
                    });
                }
            } catch(e) { /* v4 peut ignorer */ }

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

    // ─── updatePriceChart ─────────────────────────────────────
    // vals = [{datetime, open, high, low, close, volume}, ...]
    function updatePriceChart(vals = [], _signals = {}) {
        if (!_candleSeries) { console.warn('⚠ candleSeries non initialisé'); return; }
        try {
            const candles = vals
                .filter(c => c && c.open != null)
                .map(c => ({
                    time:  Math.floor(new Date(c.datetime || c.date || c.time).getTime() / 1000),
                    open:  parseFloat(c.open),
                    high:  parseFloat(c.high),
                    low:   parseFloat(c.low),
                    close: parseFloat(c.close)
                }))
                .filter(c => !isNaN(c.open) && c.time > 0)
                .sort((a, b) => a.time - b.time);

            if (!candles.length) { console.warn('⚠ Aucun candle valide'); return; }
            _candleSeries.setData(candles);

            if (_volumeSeries) {
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

        } catch(err) { console.error('❌ updatePriceChart:', err); }
    }

    // Alias (nom utilisé dans l'ancien charts.js)
    function updatePriceData(candles = [], volumes = []) {
        updatePriceChart(
            candles.map((c, i) => ({
                ...c,
                volume: volumes[i]?.volume || volumes[i]?.value || 0
            })), {}
        );
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
        if (_tvChart) {
            _tvChart.remove();
            _tvChart = null; _candleSeries = null; _volumeSeries = null;
        }
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — PORTFOLIO DONUT ────────────────────────────
    // ════════════════════════════════════════════════════════
    function renderPortfolioDonut(weights = {}) {
        const c = _ctx('portfolio-donut');
        if (!c) return;
        _destroyCJ('portfolio-donut');

        const src     = Object.keys(weights).length ? weights
            : { Cash: 1.0 };
        const labels  = Object.keys(src).map(k => k.replace(/_/g, ' '));
        const data    = Object.values(src).map(v => (parseFloat(v) * 100).toFixed(1));
        const bgs     = PALETTE.slice(0, labels.length);

        _cjInstances['portfolio-donut'] = new Chart(c, {
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
                responsive: true, cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: C.text, font: { size: 11 }, padding: 10 }
                    },
                    tooltip: {
                        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}%` }
                    }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — REGIME PROBABILITIES ──────────────────────
    // ════════════════════════════════════════════════════════
    function renderRegimeChart(probs = {}) {
        const c = _ctx('regime-chart');
        if (!c) return;
        _destroyCJ('regime-chart');

        const defaults = {
            trend_up: 0.40, trend_down: 0.10, range_bound: 0.20,
            low_volatility: 0.10, high_volatility: 0.10,
            crash: 0.05, macro_tightening: 0.025, macro_easing: 0.025
        };
        const src    = Object.keys(probs).length ? probs : defaults;
        const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));
        const data   = Object.values(src).map(v => (parseFloat(v) * 100).toFixed(1));
        const COLOR_MAP = [
            C.green, C.red, C.gray, C.cyan,
            C.yellow, '#dc2626', C.orange, C.purple
        ];
        const bgs = data.map((_, i) => COLOR_MAP[i] || C.blue);

        _cjInstances['regime-chart'] = new Chart(c, {
            type: 'bar',
            data: {
                labels,
                datasets: [{
                    label:           'Probabilité (%)',
                    data,
                    backgroundColor: bgs.map(b => b + '99'),
                    borderColor:     bgs,
                    borderWidth:     1,
                    borderRadius:    6
                }]
            },
            options: {
                responsive: true, indexAxis: 'y',
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        max: 100, min: 0,
                        ticks: { color: C.text, callback: v => v + '%' },
                        grid:  { color: C.grid }
                    },
                    y: { ticks: { color: C.text }, grid: { color: C.grid } }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — LEVERAGE GAUGE ─────────────────────────────
    // ════════════════════════════════════════════════════════
    function renderLeverageGauge(current = 0, max = 1.5) {
        const c = _ctx('leverage-gauge');
        if (!c) return;
        _destroyCJ('leverage-gauge');

        const pct   = Math.min(Math.max((current / max) * 100, 0), 100);
        const color = pct > 85 ? C.red : pct > 65 ? C.yellow : C.green;
        const cur   = parseFloat(current).toFixed(2);
        const mx    = parseFloat(max).toFixed(2);

        _cjInstances['leverage-gauge'] = new Chart(c, {
            type: 'doughnut',
            data: {
                datasets: [{
                    data:            [pct, 100 - pct],
                    backgroundColor: [color, 'rgba(255,255,255,0.07)'],
                    borderWidth:     0,
                    circumference:   270,
                    rotation:        225
                }]
            },
            options: {
                responsive: true, cutout: '78%',
                animation: { duration: 600, easing: 'easeOutQuart' },
                plugins: { legend: { display: false }, tooltip: { enabled: false } }
            },
            plugins: [{
                id: 'gaugeCenter',
                afterDraw(chart) {
                    const { ctx, chartArea: { left, top, width, height } } = chart;
                    const cx = left + width  / 2;
                    const cy = top  + height / 2 + 18;
                    ctx.save();
                    // Valeur principale
                    ctx.fillStyle  = color;
                    ctx.font       = `bold 26px Inter, sans-serif`;
                    ctx.textAlign  = 'center';
                    ctx.fillText(`${cur}x`, cx, cy);
                    // Sous-label
                    ctx.fillStyle  = C.text;
                    ctx.font       = `12px Inter, sans-serif`;
                    ctx.fillText(`/ ${mx}x max`, cx, cy + 20);
                    ctx.restore();
                }
            }]
        });

        // Met à jour les labels texte sous la gauge
        const lCur = document.getElementById('lever-current-label');
        const lMax = document.getElementById('lever-max-label');
        if (lCur) lCur.textContent = `Current: ${cur}x`;
        if (lMax) lMax.textContent = `Max: ${mx}x`;
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — DRAWDOWN MONITOR ──────────────────────────
    // ════════════════════════════════════════════════════════
    const _ddHistory  = [];
    const _DD_MAX_PTS = 60;

    function updateDrawdownChart(currentDD = 0) {
        const c = _ctx('drawdown-chart');
        if (!c) return;

        // Historique glissant
        _ddHistory.push({
            x: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            y: (currentDD * 100).toFixed(3)
        });
        if (_ddHistory.length > _DD_MAX_PTS) _ddHistory.shift();

        _destroyCJ('drawdown-chart');

        const ddPct = Math.abs(currentDD * 100);
        const color = ddPct > 5 ? C.red : ddPct > 2 ? C.yellow : C.green;

        _cjInstances['drawdown-chart'] = new Chart(c, {
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
                    pointRadius:     0,
                    pointHoverRadius: 4
                }]
            },
            options: {
                responsive: true, animation: { duration: 300 },
                plugins: { legend: { display: false } },
                scales: {
                    x: {
                        ticks: { color: C.text, maxTicksLimit: 8, maxRotation: 0 },
                        grid:  { color: C.grid }
                    },
                    y: {
                        ticks: { color: C.text, callback: v => v + '%' },
                        grid:  { color: C.grid }
                    }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — STRATEGY DONUT ─────────────────────────────
    // ════════════════════════════════════════════════════════
    function renderStrategyDonut(weights = {}) {
        const c = _ctx('strategy-donut');
        if (!c) return;
        _destroyCJ('strategy-donut');

        const defaults = {
            trend: 0.40, mean_reversion: 0.25,
            vol_carry: 0.20, options_convexity: 0.15
        };
        const src    = Object.keys(weights).length ? weights : defaults;
        const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));
        const data   = Object.values(src).map(v => (parseFloat(v) * 100).toFixed(1));
        const bgs    = Object.keys(src).map(k => C.strategy[k] || C.gray);

        _cjInstances['strategy-donut'] = new Chart(c, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data,
                    backgroundColor: bgs.map(b => b + 'cc'),
                    borderColor:     bgs,
                    borderWidth:     2,
                    hoverOffset:     10
                }]
            },
            options: {
                responsive: true, cutout: '62%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: C.text, font: { size: 11 }, padding: 10 }
                    },
                    tooltip: {
                        callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}%` }
                    }
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — STRATEGY SHARPE (dual axis) ───────────────
    // ════════════════════════════════════════════════════════
    function renderStrategySharpe(perf = {}) {
        // Rend dans les 2 canvas possibles (sections strategies + performance)
        ['strategy-perf-chart', 'strategy-sharpe-chart'].forEach(id => {
            const c = _ctx(id);
            if (!c) return;
            _destroyCJ(id);

            const defaults = {
                trend:             { sharpe: 1.2,  return_pct: 8.4  },
                mean_reversion:    { sharpe: 0.9,  return_pct: 5.1  },
                vol_carry:         { sharpe: 1.5,  return_pct: 6.8  },
                options_convexity: { sharpe: 0.7,  return_pct: 3.2  }
            };
            const src    = Object.keys(perf).length ? perf : defaults;
            const labels = Object.keys(src).map(k => k.replace(/_/g, ' '));

            const sharpe = Object.values(src).map(v =>
                parseFloat(v?.sharpe ?? v?.sharpe_ratio ?? 0).toFixed(2));
            const rets   = Object.values(src).map(v =>
                parseFloat(v?.return_pct ?? v?.returns ?? 0).toFixed(2));
            const bgs    = Object.keys(src).map(k => C.strategy[k] || C.blue);

            _cjInstances[id] = new Chart(c, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label:           'Sharpe Ratio',
                            data:            sharpe,
                            backgroundColor: bgs.map(b => b + '99'),
                            borderColor:     bgs,
                            borderWidth:     1, borderRadius: 6,
                            yAxisID:         'y'
                        },
                        {
                            label:           'Return (%)',
                            data:            rets,
                            backgroundColor: bgs.map(() => C.cyan + '66'),
                            borderColor:     C.cyan,
                            borderWidth:     1, borderRadius: 6,
                            yAxisID:         'y1'
                        }
                    ]
                },
                options: {
                    responsive: true,
                    plugins: {
                        legend: { labels: { color: C.text, font: { size: 11 } } }
                    },
                    scales: {
                        x:  { ticks: { color: C.text }, grid: { color: C.grid } },
                        y:  {
                            type: 'linear', position: 'left',
                            title: { display: true, text: 'Sharpe', color: C.text },
                            ticks: { color: C.blue }, grid: { color: C.grid }
                        },
                        y1: {
                            type: 'linear', position: 'right',
                            title: { display: true, text: 'Return %', color: C.text },
                            ticks: { color: C.cyan, callback: v => v + '%' },
                            grid:  { drawOnChartArea: false }
                        }
                    }
                }
            });
        });
    }

    // ════════════════════════════════════════════════════════
    // ── CHART.JS — EXECUTION QUALITY ─────────────────────────
    // ════════════════════════════════════════════════════════
    function renderExecQuality(decisions = {}) {
        // ── Execution quality bar chart ──────────────────────
        const c = _ctx('exec-quality-chart');
        if (c) {
            _destroyCJ('exec-quality-chart');

            const entries = Object.entries(decisions).slice(0, 12);
            const labels  = entries.map(([sym]) => sym);
            const quality = entries.map(([, d]) =>
                parseFloat(d?.exec_quality ?? d?.execution_quality ?? 0.75) * 100);
            const bgs     = quality.map(q =>
                q >= 80 ? C.green : q >= 60 ? C.yellow : C.red);

            _cjInstances['exec-quality-chart'] = new Chart(c, {
                type: 'bar',
                data: {
                    labels: labels.length ? labels : ['Waiting…'],
                    datasets: [{
                        label:           'Exec Quality (%)',
                        data:            quality.length ? quality : [0],
                        backgroundColor: bgs.map(b => b + '99'),
                        borderColor:     bgs,
                        borderWidth:     1, borderRadius: 6
                    }]
                },
                options: {
                    responsive: true,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { ticks: { color: C.text }, grid: { color: C.grid } },
                        y: {
                            min: 0, max: 100,
                            ticks: { color: C.text, callback: v => v + '%' },
                            grid: { color: C.grid }
                        }
                    }
                }
            });
        }

        // ── Order methods donut ──────────────────────────────
        const co = _ctx('order-methods-chart');
        if (co) {
            _destroyCJ('order-methods-chart');
            _cjInstances['order-methods-chart'] = new Chart(co, {
                type: 'doughnut',
                data: {
                    labels:   ['Limit', 'Market', 'TWAP', 'VWAP', 'Adaptive'],
                    datasets: [{
                        data:            [40, 20, 15, 15, 10],
                        backgroundColor: [
                            C.blue + 'cc', C.green + 'cc', C.purple + 'cc',
                            C.orange + 'cc', C.cyan + 'cc'
                        ],
                        borderWidth: 2
                    }]
                },
                options: {
                    responsive: true, cutout: '55%',
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: C.text, font: { size: 11 } }
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
        // ── LightweightCharts ──
        initPriceChart,
        updatePriceChart,       // ← utilisé par dashboard.js
        updatePriceData,        // ← alias
        setMarkers,
        destroyChart,
        getChart:           () => _tvChart,
        getCandleSeries:    () => _candleSeries,
        getVolumeSeries:    () => _volumeSeries,

        // ── Chart.js ──
        renderPortfolioDonut,   // ← portfolio section
        renderRegimeChart,      // ← regime section
        renderLeverageGauge,    // ← risk section
        updateDrawdownChart,    // ← risk section
        renderStrategyDonut,    // ← strategies section
        renderStrategySharpe,   // ← strategies + performance sections
        renderExecQuality,      // ← execution section
    };

})();

window.Charts = Charts;
console.log('✅ Charts module loaded (LightweightCharts + Chart.js)');