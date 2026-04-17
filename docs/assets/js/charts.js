// ============================================================
// charts.js — AlphaVault Quant
// Fix: LightweightCharts v3/v4 compatibility
// ============================================================

const Charts = (() => {

    let _tvChart = null;
    let _candleSeries = null;
    let _volumeSeries = null;
    let _lineSeries = null;

    // ─── Détection version LightweightCharts ─────────────────
    function _getLWCVersion() {
        if (typeof LightweightCharts === 'undefined') return null;
        // v4+ expose createChart comme propriété de l'objet
        if (typeof LightweightCharts.CandlestickSeries !== 'undefined') return 4;
        return 3;
    }

    // ─── Création d'une série candlestick (compatible v3/v4) ──
    function _addCandlestickSeries(chart, options = {}) {
        const version = _getLWCVersion();

        const defaultOptions = {
            upColor: '#00d084',
            downColor: '#ff4757',
            borderUpColor: '#00d084',
            borderDownColor: '#ff4757',
            wickUpColor: '#00d084',
            wickDownColor: '#ff4757',
            ...options
        };

        if (version === 4) {
            // ✅ API v4+
            return chart.addSeries(LightweightCharts.CandlestickSeries, defaultOptions);
        } else if (version === 3) {
            // ✅ API v3
            return chart.addCandlestickSeries(defaultOptions);
        } else {
            console.error('❌ LightweightCharts non chargé');
            return null;
        }
    }

    // ─── Création d'une série line (compatible v3/v4) ─────────
    function _addLineSeries(chart, options = {}) {
        const version = _getLWCVersion();

        const defaultOptions = {
            color: '#667eea',
            lineWidth: 2,
            crosshairMarkerVisible: true,
            ...options
        };

        if (version === 4) {
            return chart.addSeries(LightweightCharts.LineSeries, defaultOptions);
        } else {
            return chart.addLineSeries(defaultOptions);
        }
    }

    // ─── Création d'une série volume (compatible v3/v4) ───────
    function _addHistogramSeries(chart, options = {}) {
        const version = _getLWCVersion();

        const defaultOptions = {
            color: 'rgba(102, 126, 234, 0.4)',
            priceFormat: { type: 'volume' },
            priceScaleId: 'volume',
            ...options
        };

        if (version === 4) {
            return chart.addSeries(LightweightCharts.HistogramSeries, defaultOptions);
        } else {
            return chart.addHistogramSeries(defaultOptions);
        }
    }

    // ─── Init Price Chart ─────────────────────────────────────
    function initPriceChart(containerId, options = {}) {
        const container = document.getElementById(containerId);
        if (!container) {
            console.error(`❌ Container #${containerId} introuvable`);
            return null;
        }

        if (typeof LightweightCharts === 'undefined') {
            console.error('❌ LightweightCharts non chargé — vérifiez votre CDN');
            return null;
        }

        const version = _getLWCVersion();
        console.log(`📊 LightweightCharts v${version} détecté`);

        // Destroy existing chart
        if (_tvChart) {
            _tvChart.remove();
            _tvChart = null;
        }

        const chartOptions = {
            width: container.clientWidth || 800,
            height: options.height || 400,
            layout: {
                background: { color: 'transparent' },
                textColor: getComputedStyle(document.documentElement)
                    .getPropertyValue('--text-primary').trim() || '#e2e8f0',
                fontSize: 12,
                fontFamily: "'Inter', -apple-system, sans-serif"
            },
            grid: {
                vertLines: { color: 'rgba(255, 255, 255, 0.05)' },
                horzLines: { color: 'rgba(255, 255, 255, 0.05)' }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode
                    ? LightweightCharts.CrosshairMode.Normal
                    : 1
            },
            rightPriceScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                scaleMargins: { top: 0.1, bottom: 0.3 }
            },
            timeScale: {
                borderColor: 'rgba(255, 255, 255, 0.1)',
                timeVisible: true,
                secondsVisible: false
            },
            ...options.chartOptions
        };

        try {
            _tvChart = LightweightCharts.createChart(container, chartOptions);

            // ✅ Candlestick series (compatible v3/v4)
            _candleSeries = _addCandlestickSeries(_tvChart, options.candleOptions || {});

            // ✅ Volume series (optional)
            if (options.showVolume !== false) {
                _volumeSeries = _addHistogramSeries(_tvChart, {
                    priceScaleId: 'volume',
                    ...(options.volumeOptions || {})
                });

                // Config priceScale volume (v3/v4 compatible)
                if (_tvChart.priceScale && typeof _tvChart.priceScale === 'function') {
                    try {
                        _tvChart.priceScale('volume').applyOptions({
                            scaleMargins: { top: 0.8, bottom: 0 }
                        });
                    } catch(e) {
                        // Silently ignore if not supported
                    }
                }
            }

            // Resize observer
            _setupResizeObserver(container);

            console.log('✅ Price chart initialisé avec succès');
            return { chart: _tvChart, candleSeries: _candleSeries, volumeSeries: _volumeSeries };

        } catch (err) {
            console.error('❌ Erreur création chart:', err);
            return null;
        }
    }

    // ─── Resize Observer ──────────────────────────────────────
    function _setupResizeObserver(container) {
        if (typeof ResizeObserver === 'undefined') return;

        const observer = new ResizeObserver(entries => {
            for (const entry of entries) {
                if (_tvChart) {
                    _tvChart.applyOptions({
                        width: entry.contentRect.width
                    });
                }
            }
        });
        observer.observe(container);
    }

    // ─── Mise à jour des données ──────────────────────────────
    function updatePriceData(candles = [], volumes = []) {
        if (!_candleSeries) {
            console.warn('⚠ candleSeries non initialisé');
            return;
        }

        try {
            // Format candles
            const formattedCandles = candles.map(c => ({
                time: typeof c.time === 'string'
                    ? Math.floor(new Date(c.time).getTime() / 1000)
                    : c.time,
                open:  parseFloat(c.open),
                high:  parseFloat(c.high),
                low:   parseFloat(c.low),
                close: parseFloat(c.close)
            })).filter(c => !isNaN(c.open));

            _candleSeries.setData(formattedCandles);

            // Format volumes
            if (_volumeSeries && volumes.length > 0) {
                const formattedVolumes = volumes.map((v, i) => ({
                    time: formattedCandles[i]?.time || v.time,
                    value: parseFloat(v.value || v.volume || 0),
                    color: formattedCandles[i]?.close >= formattedCandles[i]?.open
                        ? 'rgba(0, 208, 132, 0.4)'
                        : 'rgba(255, 71, 87, 0.4)'
                }));
                _volumeSeries.setData(formattedVolumes);
            }

            // Fit visible range
            if (_tvChart) _tvChart.timeScale().fitContent();

            console.log(`✅ Chart mis à jour — ${formattedCandles.length} candles`);

        } catch (err) {
            console.error('❌ Erreur updatePriceData:', err);
        }
    }

    // ─── Ajout marqueurs (signaux) ────────────────────────────
    function setMarkers(markers = []) {
        if (!_candleSeries) return;

        try {
            const formatted = markers.map(m => ({
                time: typeof m.time === 'string'
                    ? Math.floor(new Date(m.time).getTime() / 1000)
                    : m.time,
                position: m.position || 'aboveBar',
                color:    m.color || '#667eea',
                shape:    m.shape || 'arrowUp',
                text:     m.text || ''
            }));

            // API compatible v3/v4
            if (typeof _candleSeries.setMarkers === 'function') {
                _candleSeries.setMarkers(formatted);
            }
        } catch (err) {
            console.warn('⚠ setMarkers:', err.message);
        }
    }

    // ─── Ligne de prix (ex: target) ───────────────────────────
    function addPriceLine(price, color = '#f59e0b', title = '') {
        if (!_candleSeries) return null;

        try {
            return _candleSeries.createPriceLine({ price, color, lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle
                    ? LightweightCharts.LineStyle.Dashed
                    : 2,
                axisLabelVisible: true, title
            });
        } catch (err) {
            console.warn('⚠ addPriceLine:', err.message);
            return null;
        }
    }

    // ─── Destroy ──────────────────────────────────────────────
    function destroyChart() {
        if (_tvChart) {
            _tvChart.remove();
            _tvChart        = null;
            _candleSeries   = null;
            _volumeSeries   = null;
            _lineSeries     = null;
            console.log('🗑 Chart détruit');
        }
    }

    // ─── API publique ─────────────────────────────────────────
    return {
        initPriceChart,
        updatePriceData,
        setMarkers,
        addPriceLine,
        destroyChart,
        getChart:        () => _tvChart,
        getCandleSeries: () => _candleSeries,
        getVolumeSeries: () => _volumeSeries
    };

})();

window.Charts = Charts;