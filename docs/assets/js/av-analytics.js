// ============================================================
// av-analytics.js — AlphaVault Quant Analytics v1.0
// Controller pour analytics.html
// Sources : portfolio.json, risk_metrics.json, pnl_monitor.json,
//           rolling_history.json, learning_insights.json,
//           rebalancer_status.json, model_report.json,
//           strategy_weights.json
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  let _portfolio  = null;
  let _risk       = null;
  let _pnl        = null;
  let _history    = null;
  let _insights   = null;
  let _rebalancer = null;
  let _model      = null;
  let _weights    = null;
  let _navChart   = null;
  let _navSeries  = null;
  let _navAllData = [];
  let _currentTf  = 'ALL';
  let _stratChart = null;
  let _timers     = [];

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    AVUtils.setSidebarActive('analytics');
    _bindThemeToggle();
    _bindSidebar();
    _bindTimeframeBtns();
    _showSkeletons();
    await loadData();
    _startRefresh();
    console.log('[av-analytics] v1.0 init complete');
  }

  // ══════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════
  async function loadData() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const results = await Promise.allSettled([
      AVApi.fetchJSON(URLS.portfolio,  0),
      AVApi.fetchJSON(URLS.risk,       0),
      AVApi.fetchJSON(URLS.pnl,        0),
      AVApi.fetchJSON(URLS.history,    0),
      AVApi.fetchJSON(URLS.insights,   0),
      AVApi.fetchJSON(URLS.rebalancer, 0),
      AVApi.fetchJSON(URLS.model,      0),
      AVApi.fetchJSON(URLS.weights,    0),
    ]);
    const p = r => r.status === 'fulfilled' ? r.value : null;
    [_portfolio, _risk, _pnl, _history,
     _insights, _rebalancer, _model, _weights] = results.map(p);
    renderAll();
  }

  function renderAll() {
    renderKPIs();
    renderNavChart();
    renderPerformanceMetrics();
    renderDrawdownCard();
    renderStrategyWeights();
    renderModelPerformance();
    renderLearningInsights();
    renderRebalancerStatus();
    _updateSidebar();
  }

  // ══════════════════════════════════════════════════════════
  // KPI ROW
  // ══════════════════════════════════════════════════════════
  function renderKPIs() {
    // ── NetLiq (R1) ─────────────────────────────────────────
    const netliq = AVUtils.netliqFromPortfolio(_portfolio);
    _setKpi('anl-netliq', {
      val:      netliq !== null ? AVUtils.formatCurrencyFull(netliq) : '—',
      sub:      netliq !== null
        ? `<i class="fa-regular fa-clock"></i> Source: portfolio.json`
        : `<i class="fa-solid fa-triangle-exclamation"></i> Awaiting data`,
      valColor: null,
    });

    // ── PnL — somme positions (root = 0.0) ──────────────────
    const posArr = Object.values(_portfolio?.positions || {});
    let totalPnl = parseFloat(_portfolio?.unrealized_pnl || 0);
    if (totalPnl === 0 && posArr.length > 0) {
      totalPnl = posArr.reduce(
        (s, p) => s + parseFloat(p.unrealized_pnl ?? 0), 0
      );
    }
    if (totalPnl === 0 && parseFloat(_pnl?.total_pnl_usd || 0) !== 0) {
      totalPnl = parseFloat(_pnl.total_pnl_usd);
    }

    const pnlColor = totalPnl > 0 ? 'var(--accent-green)'
                   : totalPnl < 0 ? 'var(--accent-red)'
                   : 'var(--text-primary)';
    const pnlPct   = netliq && netliq > 0 && totalPnl !== 0
      ? (totalPnl / (netliq - totalPnl) * 100) : 0;

    // Update icon color
    const pnlIcon = document.getElementById('anl-pnl-icon');
    if (pnlIcon) pnlIcon.style.color = pnlColor;

    _setKpi('anl-pnl', {
      val: (totalPnl >= 0 ? '+' : '') + AVUtils.formatCurrencyFull(totalPnl),
      sub: pnlPct !== 0
        ? `<span style="font-weight:800;color:${pnlColor}">
             ${pnlPct > 0 ? '+' : ''}${pnlPct.toFixed(2)}%
           </span>
           &nbsp;vs. cost basis`
        : 'Unrealized P&L (positions)',
      valColor: pnlColor,
    });

    // ── Win Rate — positions EN PREMIER ─────────────────────
    const winningPos = posArr.filter(p => parseFloat(p.unrealized_pnl || 0) > 0).length;
    const losingPos  = posArr.filter(p => parseFloat(p.unrealized_pnl || 0) < 0).length;
    const winRatePos = posArr.length > 0
      ? (winningPos / posArr.length * 100) : 0;

    const winRate = parseFloat(_pnl?.win_rate) > 0
      ? parseFloat(_pnl.win_rate) : winRatePos;
    const winning = parseInt(_pnl?.winning) > 0
      ? parseInt(_pnl.winning) : winningPos;
    const losing  = parseInt(_pnl?.losing) > 0
      ? parseInt(_pnl.losing)  : losingPos;
    const wrColor = winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-orange)';

    _setKpi('anl-winrate', {
      val: `${winRate.toFixed(1)}%`,
      sub: `<span style="color:var(--accent-green);font-weight:700">W:${winning}</span>
            &nbsp;/&nbsp;
            <span style="color:var(--accent-red);font-weight:700">L:${losing}</span>
            &nbsp;&middot;&nbsp; ${posArr.length} positions`,
      valColor: wrColor,
    });

    // ── Drawdown ─────────────────────────────────────────────
    const dd      = parseFloat(AVUtils.safeGet(_risk, 'drawdown.current_drawdown', 0));
    const maxDD   = parseFloat(AVUtils.safeGet(_risk, 'drawdown.max_drawdown',     0));
    const ddThres = parseFloat(AVUtils.safeGet(_risk, 'drawdown.threshold', 0.15));
    const ddColor = dd > 0.10 ? 'var(--accent-red)'
                  : dd > 0.05 ? 'var(--accent-orange)'
                  : 'var(--accent-green)';

    _setKpi('anl-drawdown', {
      val:      `${(dd * 100).toFixed(2)}%`,
      sub:      `Max: <strong>${(maxDD * 100).toFixed(2)}%</strong>
                 &nbsp;&middot;&nbsp; Limit: ${(ddThres * 100).toFixed(0)}%`,
      valColor: ddColor,
    });
  }

  function _setKpi(id, { val, sub, valColor }) {
    const valEl = document.getElementById(`${id}-val`);
    const subEl = document.getElementById(`${id}-sub`);
    if (valEl) {
      valEl.innerHTML   = val;
      valEl.style.color = valColor || '';
    }
    if (subEl) subEl.innerHTML = sub || '';
  }

  // ══════════════════════════════════════════════════════════
  // NAV CHART — Lightweight Charts
  // ══════════════════════════════════════════════════════════
  function renderNavChart() {
    const container = document.getElementById('anl-nav-chart');
    if (!container) return;

    if (typeof LightweightCharts === 'undefined') {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;
                    justify-content:center;height:100%;color:var(--text-faint);gap:8px">
          <i class="fa-solid fa-chart-line" style="font-size:28px;opacity:0.2"></i>
          <div style="font-size:13px;font-weight:600">Lightweight Charts not loaded</div>
        </div>`;
      return;
    }

    const history   = _history?.history || [];
    const netliqNow = AVUtils.netliqFromPortfolio(_portfolio);

    _navAllData = [];
    history.forEach(pt => {
      const ts = pt.ts || pt.timestamp || null;
      const nl = parseFloat(pt.netliq || pt.net_liq || 0);
      if (!ts || nl <= 0) return;
      const t  = Math.floor(new Date(ts).getTime() / 1000);
      if (!isFinite(t) || t <= 0) return;
      _navAllData.push({
        time:      t,
        value:     nl,
        leverage:  parseFloat(pt.leverage  || 0),
        pnl:       parseFloat(pt.total_pnl || 0),
        positions: parseInt(pt.n_positions || 0),
        regime:    pt.regime   || 'NEUTRAL',
        drawdown:  parseFloat(pt.drawdown  || 0),
        win_rate:  parseFloat(pt.win_rate  || 0),
      });
    });

    // Point actuel (R1)
    if (netliqNow && netliqNow > 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      if (!_navAllData.find(p => Math.abs(p.time - nowTs) < 120)) {
        _navAllData.push({
          time:      nowTs,
          value:     netliqNow,
          leverage:  parseFloat(AVUtils.safeGet(_risk, 'leverage.current_leverage', 0)),
          pnl:       0,
          positions: Object.keys(_portfolio?.positions || {}).length,
          regime:    'BULL',
        });
      }
    }

    // Tri + dédup
    _navAllData.sort((a, b) => a.time - b.time);
    const seen = new Set();
    _navAllData = _navAllData.filter(p => {
      if (seen.has(p.time)) return false;
      seen.add(p.time);
      return true;
    });

    if (_navAllData.length === 0) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;
                    justify-content:center;height:100%;color:var(--text-faint);gap:10px;padding:20px">
          <i class="fa-solid fa-chart-area" style="font-size:32px;opacity:0.2"></i>
          <div style="font-size:13px;font-weight:700;color:var(--text-secondary)">
            History being collected
          </div>
          <div style="font-size:12px;max-width:280px;text-align:center;line-height:1.6">
            NAV chart populates as the system runs cycles.<br>
            <span style="color:var(--accent-blue);font-weight:600">
              DashboardSyncAgent pushes data every 60s.
            </span>
          </div>
          ${netliqNow ? `
          <div style="margin-top:8px;padding:10px 20px;border-radius:10px;
                      background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);
                      font-family:var(--font-mono);font-size:14px;font-weight:800;color:#6366f1">
            Current: ${AVUtils.formatCurrencyFull(netliqNow)}
          </div>` : ''}
        </div>`;

      const info = document.getElementById('anl-chart-info');
      if (info) info.textContent = 'No history points yet';
      return;
    }

    // Créer le chart
    if (!_navChart) {
      container.innerHTML = '';
      _navChart = LightweightCharts.createChart(container, {
        layout: {
          background:  { color: 'transparent' },
          textColor:   _chartTextColor(),
          fontSize:    11,
          fontFamily:  "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: 'rgba(148,163,184,0.08)' },
          horzLines: { color: 'rgba(148,163,184,0.08)' },
        },
        crosshair:       { mode: LightweightCharts.CrosshairMode?.Normal ?? 1 },
        rightPriceScale: { borderColor: 'rgba(148,163,184,0.15)', visible: true },
        timeScale: {
          borderColor:    'rgba(148,163,184,0.15)',
          timeVisible:    true,
          secondsVisible: false,
          rightOffset:    6,
          fixLeftEdge:    true,
          fixRightEdge:   true,
        },
        handleScroll: true,
        handleScale:  true,
        width:        container.clientWidth  || 800,
        height:       container.clientHeight || 340,
      });

      const fmtPrice = v => {
        const n = Math.abs(v);
        if (n >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
        if (n >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
        return `$${v.toFixed(0)}`;
      };

      _navSeries = _navChart.addAreaSeries({
        topColor:         'rgba(99,102,241,0.22)',
        bottomColor:      'rgba(99,102,241,0.02)',
        lineColor:        '#6366f1',
        lineWidth:        2,
        priceFormat:      { type: 'custom', minMove: 1, formatter: fmtPrice },
        lastValueVisible: true,
        priceLineVisible: true,
        priceLineColor:   '#6366f1',
      });

      _buildTooltip(container);

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
          if (_navChart) {
            try {
              _navChart.resize(
                container.clientWidth  || 800,
                container.clientHeight || 340
              );
            } catch (e) {}
          }
        }).observe(container);
      }
    }

    _navChart.applyOptions({ layout: { textColor: _chartTextColor() } });
    _applyTimeframe(_currentTf);

    // Chart info bar
    const info = document.getElementById('anl-chart-info');
    if (info && _navAllData.length > 0) {
      const last   = _navAllData[_navAllData.length - 1];
      const first  = _navAllData[0];
      const change = last.value - first.value;
      const pct    = first.value > 0 ? (change / first.value * 100) : 0;
      const clr    = change >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
      info.innerHTML = `
        ${_navAllData.length} pts &nbsp;·&nbsp;
        Last: <strong>${AVUtils.formatCurrencyFull(last.value)}</strong>
        &nbsp;·&nbsp;
        <span style="color:${clr};font-weight:700">
          ${change >= 0 ? '+' : ''}${AVUtils.formatCurrencyFull(change)}
          (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)
        </span>`;
    }
  }

  function _applyTimeframe(tf) {
    if (!_navSeries || _navAllData.length === 0) return;
    _currentTf = tf;

    let filtered = _navAllData;
    const now    = Math.floor(Date.now() / 1000);
    if (tf === '1D')      filtered = _navAllData.filter(p => p.time >= now - 86400);
    else if (tf === '1W') filtered = _navAllData.filter(p => p.time >= now - 604800);
    else if (tf === '1M') filtered = _navAllData.filter(p => p.time >= now - 2592000);
    if (filtered.length === 0) filtered = _navAllData.slice(-20);

    try {
      _navSeries.setData(filtered.map(p => ({ time: p.time, value: p.value })));
      _navChart.timeScale().fitContent();
      if (filtered.length >= 2) {
        const isPos = filtered[filtered.length - 1].value >= filtered[0].value;
        _navSeries.applyOptions({
          topColor:       isPos ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.18)',
          bottomColor:    isPos ? 'rgba(16,185,129,0.02)' : 'rgba(239,68,68,0.02)',
          lineColor:      isPos ? '#10b981' : '#ef4444',
          priceLineColor: isPos ? '#10b981' : '#ef4444',
        });
      }
    } catch (e) {
      console.warn('[av-analytics] Chart error:', e.message);
    }

    document.querySelectorAll('.av-timeframe-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tf === tf);
    });
  }

  function _buildTooltip(container) {
    const tt = document.createElement('div');
    tt.id = 'anl-chart-tooltip';
    tt.style.cssText = `
      position:absolute;left:12px;top:12px;pointer-events:none;
      background:var(--bg-primary);border:1px solid var(--border);
      border-radius:10px;padding:10px 14px;font-size:11px;
      color:var(--text-secondary);display:none;
      box-shadow:0 4px 20px rgba(0,0,0,0.15);
      z-index:10;min-width:190px;line-height:1.7;`;
    container.style.position = 'relative';
    container.appendChild(tt);

    if (!_navChart || !_navSeries) return;
    _navChart.subscribeCrosshairMove(param => {
      if (!param?.point || !param?.seriesData) { tt.style.display = 'none'; return; }
      const dp = param.seriesData.get(_navSeries);
      if (!dp) { tt.style.display = 'none'; return; }

      const ts  = typeof param.time === 'number' ? param.time : 0;
      const raw = _navAllData.find(p => p.time === ts);
      const d   = new Date(ts * 1000);

      const mkRow = (label, val, color = '') => `
        <div style="display:flex;justify-content:space-between;gap:14px">
          <span style="color:var(--text-faint)">${label}</span>
          <strong ${color ? `style="color:${color}"` : ''}>${val}</strong>
        </div>`;

      tt.style.display = 'block';
      tt.innerHTML = `
        <div style="font-weight:800;color:var(--text-primary);font-size:13px;margin-bottom:3px">
          ${AVUtils.formatCurrencyFull(dp.value)}
        </div>
        <div style="color:var(--text-faint);font-size:10px;margin-bottom:8px">
          ${AVUtils.formatDate(d.toISOString())}
        </div>
        ${raw ? `<div style="border-top:1px solid var(--border);padding-top:7px;display:flex;flex-direction:column;gap:3px">
          ${raw.leverage > 0 ? mkRow('Leverage', `${raw.leverage.toFixed(2)}x`) : ''}
          ${raw.pnl !== 0   ? mkRow('PnL', `${raw.pnl >= 0 ? '+' : ''}${AVUtils.formatCurrencyFull(raw.pnl)}`,
                                    raw.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)') : ''}
          ${raw.positions > 0 ? mkRow('Positions', raw.positions) : ''}
          ${raw.regime    ? mkRow('Regime', raw.regime, AVUtils.regimeColor(raw.regime).bg) : ''}
          ${raw.drawdown > 0 ? mkRow('Drawdown', `${(raw.drawdown * 100).toFixed(2)}%`,
                                     'var(--accent-orange)') : ''}
        </div>` : ''}`;
    });
  }

  // ══════════════════════════════════════════════════════════
  // PERFORMANCE METRICS (VaR, Sharpe)
  // ══════════════════════════════════════════════════════════
  function renderPerformanceMetrics() {
    const body = document.getElementById('anl-perf-body');
    if (!body) return;

    const sharpe = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.sharpe_ratio', 0));
    const var95  = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.var_95',       0));
    const var99  = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.var_99',       0));
    const vol    = parseFloat(AVUtils.safeGet(_risk, 'var_metrics.volatility',   0));
    const noData = sharpe === 0 && var95 === 0;

    const sharpeColor = noData ? 'var(--text-faint)'
                      : sharpe > 1 ? 'var(--accent-green)'
                      : sharpe > 0 ? 'var(--accent-orange)'
                      : 'var(--accent-red)';
    const varColor    = noData ? 'var(--text-faint)' : 'var(--accent-red)';

    const mkStat = (label, val, color) => `
      <div class="anl-perf-stat">
        <div class="anl-perf-lbl">${label}</div>
        <div class="anl-perf-val" style="color:${color}">${val}</div>
      </div>`;

    const sharpePct = Math.min(Math.max(sharpe, 0) / 3 * 100, 100);

    body.innerHTML = `
      ${noData ? `
        <div class="anl-insuff-badge">
          <i class="fa-solid fa-clock"></i>
          Insufficient history — requires 30+ portfolio snapshots (R5)
        </div>` : ''}

      <div class="anl-perf-grid">
        ${mkStat('Sharpe Ratio',
          noData ? 'N/A' : sharpe.toFixed(3), sharpeColor)}
        ${mkStat('VaR 95%',
          noData ? 'N/A' : `${(var95 * 100).toFixed(2)}%`, varColor)}
        ${mkStat('VaR 99%',
          noData ? 'N/A' : `${(var99 * 100).toFixed(2)}%`, varColor)}
        ${mkStat('Volatility',
          noData ? 'N/A' : `${(vol * 100).toFixed(2)}%`,
          noData ? 'var(--text-faint)' : 'var(--text-primary)')}
      </div>

      ${!noData ? `
        <div style="margin-top:18px">
          <div style="display:flex;justify-content:space-between;align-items:center;
                      font-size:11px;color:var(--text-faint);margin-bottom:6px">
            <span>Sharpe Ratio Quality</span>
            <span style="font-weight:700;color:${sharpeColor}">${sharpe.toFixed(3)}</span>
          </div>
          <div class="anl-gauge-track">
            <div class="anl-gauge-fill"
                 style="width:${sharpePct}%;background:${sharpeColor}"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:9px;
                      color:var(--text-faint);margin-top:5px;font-weight:600">
            <span>Poor (&lt;0)</span>
            <span>Good (≥1)</span>
            <span>Excellent (≥3)</span>
          </div>
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // DRAWDOWN CARD
  // ══════════════════════════════════════════════════════════
  function renderDrawdownCard() {
    const body = document.getElementById('anl-dd-body');
    if (!body) return;

    const dd       = parseFloat(AVUtils.safeGet(_risk, 'drawdown.current_drawdown', 0));
    const maxDD    = parseFloat(AVUtils.safeGet(_risk, 'drawdown.max_drawdown',     0));
    const peak     = parseFloat(AVUtils.safeGet(_risk, 'drawdown.portfolio_peak',   0));
    const thresh   = parseFloat(AVUtils.safeGet(_risk, 'drawdown.threshold', 0.15));
    const breached = AVUtils.safeGet(_risk, 'drawdown.is_breached', false);
    const ddColor  = breached ? 'var(--accent-red)'
                   : dd > 0.08 ? 'var(--accent-orange)'
                   : 'var(--accent-green)';
    const fillPct  = thresh > 0 ? Math.min((dd / thresh) * 100, 100) : 0;

    body.innerHTML = `
      <div class="anl-dd-main">
        <div class="anl-dd-circle" style="border-color:${ddColor}">
          <div class="anl-dd-circle-val" style="color:${ddColor}">
            ${(dd * 100).toFixed(2)}%
          </div>
          <div class="anl-dd-circle-lbl">Current DD</div>
        </div>
        <div class="anl-dd-stats">
          <div class="anl-dd-stat">
            <div class="anl-dd-stat-lbl">Max Drawdown</div>
            <div class="anl-dd-stat-val" style="color:var(--accent-orange)">
              ${(maxDD * 100).toFixed(2)}%
            </div>
          </div>
          <div class="anl-dd-stat">
            <div class="anl-dd-stat-lbl">Halt Threshold</div>
            <div class="anl-dd-stat-val">${(thresh * 100).toFixed(0)}%</div>
          </div>
          ${peak > 0 ? `
          <div class="anl-dd-stat">
            <div class="anl-dd-stat-lbl">Portfolio Peak</div>
            <div class="anl-dd-stat-val">${AVUtils.formatCurrency(peak)}</div>
          </div>` : ''}
          <div class="anl-dd-stat">
            <div class="anl-dd-stat-lbl">Status</div>
            <div class="anl-dd-stat-val">
              <span class="badge badge-${breached ? 'red' : 'green'}" style="font-size:10px">
                <i class="fa-solid fa-${breached ? 'hand' : 'shield-check'}"></i>
                ${breached ? 'HALTED' : 'Safe'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div style="margin-top:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    font-size:11px;color:var(--text-faint);margin-bottom:6px">
          <span>Progress to halt threshold</span>
          <span style="font-weight:700;color:${ddColor}">${fillPct.toFixed(1)}%</span>
        </div>
        <div class="anl-gauge-track" style="height:10px">
          <div class="anl-gauge-fill"
               style="width:${fillPct}%;
                      background:${breached
                        ? 'linear-gradient(135deg,#ef4444,#dc2626)'
                        : dd > 0.08
                          ? 'linear-gradient(135deg,#f59e0b,#d97706)'
                          : 'linear-gradient(135deg,#10b981,#059669)'}">
          </div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:9px;
                    color:var(--text-faint);margin-top:5px;font-weight:600">
          <span>0%</span>
          <span>Halt: ${(thresh * 100).toFixed(0)}%</span>
        </div>
      </div>

      ${breached ? `
        <div class="anl-warning-block" style="margin-top:12px">
          <i class="fa-solid fa-hand" style="flex-shrink:0"></i>
          <div>
            <div style="font-weight:700;margin-bottom:2px">DD Halt Triggered</div>
            <div style="font-size:11px">
              Trading suspended until drawdown recovers below threshold.
            </div>
          </div>
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // STRATEGY WEIGHTS
  // ══════════════════════════════════════════════════════════
  function renderStrategyWeights() {
    const body = document.getElementById('anl-strategy-body');
    if (!body) return;

    const weights = _weights?.weights || {};
    const regime  = _weights?.regime  || '—';
    const cycle   = _weights?.oracle_cycle || '—';
    const entries = Object.entries(weights);

    if (entries.length === 0) {
      body.innerHTML = `
        <div class="anl-empty-state">
          <i class="fa-solid fa-scale-balanced"></i>
          <div>
            <div style="font-size:13px;font-weight:700;margin-bottom:4px">
              Strategy weights not yet available
            </div>
            <div style="font-size:11px">SignalAgent publishes after first full cycle.</div>
          </div>
        </div>`;
      return;
    }

    const STRAT_META = {
      trend:          { label: 'Trend Following', color: '#3b82f6', icon: 'fa-arrow-trend-up'    },
      mean_reversion: { label: 'Mean Reversion',  color: '#8b5cf6', icon: 'fa-rotate'            },
      vol_carry:      { label: 'Vol Carry',        color: '#10b981', icon: 'fa-chart-column'      },
      momentum:       { label: 'Momentum',         color: '#f59e0b', icon: 'fa-bolt'              },
      arbitrage:      { label: 'Arbitrage',        color: '#06b6d4', icon: 'fa-arrows-left-right' },
    };

    const rows = entries.map(([key, val]) => {
      const m   = STRAT_META[key] || { label: key, color: '#6b7280', icon: 'fa-chart-bar' };
      const pct = (parseFloat(val) * 100).toFixed(1);
      return `
        <div class="anl-strat-row">
          <div class="anl-strat-icon" style="background:${m.color}18;color:${m.color}">
            <i class="fa-solid ${m.icon}"></i>
          </div>
          <div class="anl-strat-label">${m.label}</div>
          <div class="anl-strat-bar-wrap">
            <div class="anl-gauge-track" style="height:6px">
              <div class="anl-gauge-fill"
                   style="width:${pct}%;background:${m.color}"></div>
            </div>
          </div>
          <div class="anl-strat-pct" style="color:${m.color}">${pct}%</div>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div class="anl-strategy-layout">
        <div class="anl-strategy-chart-wrap">
          <canvas id="anl-strategy-chart"></canvas>
          <div class="anl-strategy-center-text">
            <div style="font-size:10px;color:var(--text-faint);text-align:center;line-height:1.5">
              Cycle #${cycle}<br>
              <span style="font-weight:800;color:var(--accent-blue)">${regime}</span>
            </div>
          </div>
        </div>
        <div class="anl-strategy-rows">${rows}</div>
      </div>`;

    // Init Chart.js donut
    const canvas = document.getElementById('anl-strategy-chart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (_stratChart) { try { _stratChart.destroy(); } catch (e) {} _stratChart = null; }

    const labels = entries.map(([k]) => STRAT_META[k]?.label || k);
    const vals   = entries.map(([, v]) => parseFloat(v) * 100);
    const colors = entries.map(([k]) => STRAT_META[k]?.color || '#6b7280');

    _stratChart = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data:            vals,
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor:     colors,
          borderWidth:     2,
          hoverOffset:     8,
        }],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        cutout:              '72%',
        animation:           { duration: 600, easing: 'easeInOutQuart' },
        plugins: {
          legend:  { display: false },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.label}: ${ctx.raw.toFixed(1)}%`,
            },
          },
        },
      },
    });
  }

  // ══════════════════════════════════════════════════════════
  // MODEL PERFORMANCE
  // ══════════════════════════════════════════════════════════
  function renderModelPerformance() {
    const body = document.getElementById('anl-model-body');
    if (!body) return;

    const xgbAuc    = parseFloat(_model?.xgboost_auc  || 0);
    const lgbAuc    = parseFloat(_model?.lightgbm_auc || 0);
    const logAuc    = parseFloat(_model?.logistic_auc || 0);
    const metaAuc   = parseFloat(_model?.meta_auc     || 0);
    const lookback  = parseInt(_model?.lookback_days  || 252);
    const nFeat     = parseInt(_model?.n_features     || 0);
    const trainDt   = _model?.training_date           || null;
    const metaAvail = _model?.meta_available          || false;
    const version   = _model?.model_version           || 'v5.0';

    const mkAucRow = (label, auc) => {
      const pct      = Math.min(auc * 100, 100);
      const aucColor = auc >= 0.75 ? 'var(--accent-green)'
                     : auc >= 0.60 ? 'var(--accent-blue)'
                     : auc >= 0.50 ? 'var(--accent-orange)'
                     : 'var(--text-faint)';
      const aucQual  = auc === 0 ? 'Not trained'
                     : auc >= 0.75 ? 'Excellent'
                     : auc >= 0.60 ? 'Good'
                     : auc >= 0.50 ? 'Passable'
                     : 'Poor';
      return `
        <div class="anl-model-row">
          <div class="anl-model-label">
            <span class="anl-model-dot"
                  style="background:${auc > 0 ? aucColor : 'var(--text-faint)'}"></span>
            ${label}
          </div>
          <div class="anl-model-bar-wrap">
            <div class="anl-gauge-track" style="height:8px">
              <div class="anl-gauge-fill"
                   style="width:${pct}%;
                          background:${auc > 0 ? aucColor : 'var(--text-faint)'}">
              </div>
            </div>
          </div>
          <div class="anl-model-auc" style="color:${auc > 0 ? aucColor : 'var(--text-faint)'}">
            ${auc > 0 ? auc.toFixed(4) : 'N/A'}
          </div>
          <div class="anl-model-qual" style="color:${auc > 0 ? aucColor : 'var(--text-faint)'}">
            ${aucQual}
          </div>
        </div>`;
    };

    body.innerHTML = `
      <div class="anl-model-meta">
        <span class="badge badge-blue badge-xs">
          <i class="fa-solid fa-brain"></i> ${version}
        </span>
        <span class="badge badge-gray badge-xs">
          <i class="fa-solid fa-calendar-days"></i> Lookback: ${lookback}d
        </span>
        ${nFeat > 0 ? `
        <span class="badge badge-gray badge-xs">
          <i class="fa-solid fa-list-check"></i> ${nFeat} features
        </span>` : ''}
        ${trainDt ? `
        <span class="badge badge-gray badge-xs">
          <i class="fa-solid fa-clock"></i> Trained: ${trainDt}
        </span>` : ''}
      </div>

      <div class="anl-model-auc-header">
        <span>Model</span>
        <span style="flex:1"></span>
        <span>AUC Score</span>
        <span style="min-width:70px;text-align:right">Quality</span>
      </div>

      ${mkAucRow('XGBoost',      xgbAuc)}
      ${mkAucRow('LightGBM',     lgbAuc)}
      ${mkAucRow('Logistic Reg.', logAuc)}
      ${mkAucRow(`Meta Model${!metaAvail ? ' ⚠' : ''}`, metaAuc)}

      ${!metaAvail ? `
        <div class="anl-info-block" style="margin-top:12px">
          <i class="fa-solid fa-circle-info" style="flex-shrink:0"></i>
          <div>
            <div style="font-weight:700;margin-bottom:2px">Meta model absent</div>
            <div style="font-size:11px">
              Training scheduled <strong>Monday 07:00 UTC</strong>
              (ModelTrainerAgent, Optuna 30 trials)
            </div>
          </div>
        </div>` : ''}

      <div class="anl-model-legend">
        <span style="color:var(--accent-green)">● ≥0.75 Excellent</span>
        <span style="color:var(--accent-blue)">● ≥0.60 Good</span>
        <span style="color:var(--accent-orange)">● ≥0.50 Passable</span>
        <span style="color:var(--text-faint)">● N/A Not trained</span>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // LEARNING INSIGHTS
  // ══════════════════════════════════════════════════════════
  function renderLearningInsights() {
    const body = document.getElementById('anl-insights-body');
    if (!body) return;

    const insights  = _insights?.insights    || [];
    const nTrades   = parseInt(_insights?.n_trades_analyzed || 0);
    const winRate   = parseFloat(_insights?.win_rate        || 0);
    const lookback  = parseInt(_insights?.lookback_days     || 90);
    const bestPat   = _insights?.best_patterns  || [];
    const worstPat  = _insights?.worst_patterns || [];

    if (nTrades === 0 && insights.length === 0 && bestPat.length === 0) {
      body.innerHTML = `
        <div class="anl-empty-state">
          <i class="fa-solid fa-lightbulb" style="font-size:28px"></i>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text-secondary);
                        margin-bottom:6px">
              HistoryLearner Analysis Pending
            </div>
            <div style="font-size:11px;line-height:1.6">
              Analyzes the last <strong>${lookback} days</strong> of closed trades.<br>
              Next run: <strong style="color:var(--accent-blue)">02:00 UTC daily</strong>
            </div>
          </div>
        </div>`;
      return;
    }

    const wrColor = winRate >= 50 ? 'var(--accent-green)' : 'var(--accent-orange)';

    const mkPattern = (patterns, color, icon) =>
      patterns.slice(0, 3).map(p => `
        <div style="display:flex;align-items:flex-start;gap:8px;padding:8px 12px;
                    border-radius:8px;background:${color}08;border:1px solid ${color}20;
                    font-size:12px;color:var(--text-secondary);margin-bottom:6px">
          <i class="fa-solid ${icon}" style="color:${color};font-size:10px;margin-top:2px;flex-shrink:0"></i>
          <span>${typeof p === 'string' ? p : JSON.stringify(p)}</span>
        </div>`).join('');

    body.innerHTML = `
      <div class="anl-insights-stats">
        <div class="anl-insights-stat">
          <div class="anl-insights-stat-val">${nTrades}</div>
          <div class="anl-insights-stat-lbl">Trades analyzed</div>
        </div>
        <div class="anl-insights-stat">
          <div class="anl-insights-stat-val"
               style="color:${wrColor}">${winRate.toFixed(1)}%</div>
          <div class="anl-insights-stat-lbl">Historical win rate</div>
        </div>
        <div class="anl-insights-stat">
          <div class="anl-insights-stat-val">${lookback}d</div>
          <div class="anl-insights-stat-lbl">Lookback window</div>
        </div>
      </div>

      ${insights.length > 0 ? `
        <div class="anl-section-mini-title" style="margin-top:14px">
          <i class="fa-solid fa-lightbulb" style="color:var(--accent-blue)"></i>
          Key Insights
        </div>
        ${insights.slice(0, 4).map(ins => `
          <div style="display:flex;align-items:flex-start;gap:8px;padding:9px 12px;
                      border-radius:9px;background:rgba(59,130,246,0.05);
                      border:1px solid rgba(59,130,246,0.14);margin-bottom:6px;
                      font-size:12px;color:var(--text-secondary)">
            <i class="fa-solid fa-circle-info"
               style="color:var(--accent-blue);font-size:10px;margin-top:2px;flex-shrink:0"></i>
            <span>${typeof ins === 'string' ? ins : JSON.stringify(ins)}</span>
          </div>`).join('')}` : ''}

      ${bestPat.length > 0 ? `
        <div class="anl-section-mini-title" style="margin-top:12px">
          <i class="fa-solid fa-arrow-trend-up" style="color:var(--accent-green)"></i>
          Best Patterns
        </div>
        ${mkPattern(bestPat, '#10b981', 'fa-check')}` : ''}

      ${worstPat.length > 0 ? `
        <div class="anl-section-mini-title" style="margin-top:12px">
          <i class="fa-solid fa-arrow-trend-down" style="color:var(--accent-red)"></i>
          Patterns to Avoid
        </div>
        ${mkPattern(worstPat, '#ef4444', 'fa-xmark')}` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // REBALANCER STATUS
  // ══════════════════════════════════════════════════════════
  function renderRebalancerStatus() {
    const body = document.getElementById('anl-rebalancer-body');
    if (!body) return;

    const needed   = AVUtils.safeGet(_rebalancer, 'rebalance_needed', false);
    const drift    = parseFloat(AVUtils.safeGet(_rebalancer, 'drift_threshold', 0.02));
    const maxDrift = parseFloat(AVUtils.safeGet(_rebalancer, 'max_drift',       0));
    const nRebal   = parseInt(AVUtils.safeGet(_rebalancer,  'n_rebalances',     0));
    const lastRebal= AVUtils.safeGet(_rebalancer, 'last_rebalance', null);
    const driftPct = drift > 0 ? Math.min((maxDrift / drift) * 100, 100) : 0;
    const driftClr = needed ? 'var(--accent-orange)' : 'var(--accent-green)';

    body.innerHTML = `
      <div class="anl-rebal-grid">

        <div class="anl-rebal-status ${needed ? 'needed' : 'ok'}">
          <i class="fa-solid fa-${needed ? 'rotate fa-spin' : 'circle-check'}"></i>
          <div>
            <div style="font-size:13px;font-weight:700">
              ${needed ? 'Rebalance Needed' : 'Portfolio Balanced'}
            </div>
            <div style="font-size:11px;opacity:0.8;margin-top:2px">
              ${needed
                ? 'Drift threshold exceeded — PortfolioRebalancer will act'
                : 'All positions within drift limits'}
            </div>
          </div>
        </div>

        <div class="anl-rebal-stats">
          <div class="anl-rebal-stat">
            <div class="anl-rebal-stat-lbl">Drift Threshold</div>
            <div class="anl-rebal-stat-val">${(drift * 100).toFixed(0)}%</div>
          </div>
          <div class="anl-rebal-stat">
            <div class="anl-rebal-stat-lbl">Max Current Drift</div>
            <div class="anl-rebal-stat-val" style="color:${driftClr}">
              ${maxDrift > 0 ? `${(maxDrift * 100).toFixed(2)}%` : '—'}
            </div>
          </div>
          <div class="anl-rebal-stat">
            <div class="anl-rebal-stat-lbl">Total Rebalances</div>
            <div class="anl-rebal-stat-val">${nRebal}</div>
          </div>
          <div class="anl-rebal-stat">
            <div class="anl-rebal-stat-lbl">Last Rebalance</div>
            <div class="anl-rebal-stat-val" style="font-size:12px">
              ${lastRebal ? AVUtils.formatAge(lastRebal) : '—'}
            </div>
          </div>
        </div>

      </div>

      ${maxDrift > 0 ? `
        <div style="margin-top:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;
                      font-size:11px;color:var(--text-faint);margin-bottom:6px">
            <span>Drift progress to threshold</span>
            <span style="font-weight:700;color:${driftClr}">
              ${(maxDrift * 100).toFixed(2)}% / ${(drift * 100).toFixed(0)}%
            </span>
          </div>
          <div class="anl-gauge-track" style="height:8px">
            <div class="anl-gauge-fill"
                 style="width:${driftPct}%;
                        background:${needed
                          ? 'linear-gradient(135deg,#f59e0b,#d97706)'
                          : 'linear-gradient(135deg,#10b981,#059669)'}">
            </div>
          </div>
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // SKELETONS
  // ══════════════════════════════════════════════════════════
  function _showSkeletons() {
    ['anl-netliq', 'anl-pnl', 'anl-winrate', 'anl-drawdown'].forEach(id => {
      const el = document.getElementById(`${id}-val`);
      if (el) el.innerHTML = `
        <span class="skeleton-line" style="width:110px;height:26px;display:block"></span>`;
    });
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    const URLS = AV_CONFIG.SIGNAL_URLS;

    // Fast (30s) : portfolio + risk + pnl
    _timers.push(setInterval(async () => {
      try {
        const [pRes, rRes, nRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.portfolio, 0),
          AVApi.fetchJSON(URLS.risk,      0),
          AVApi.fetchJSON(URLS.pnl,       0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _portfolio = p(pRes) || _portfolio;
        _risk      = p(rRes) || _risk;
        _pnl       = p(nRes) || _pnl;
        renderKPIs();
        renderPerformanceMetrics();
        renderDrawdownCard();
      } catch (err) {
        console.warn('[av-analytics] Refresh fast error:', err.message);
      }
    }, AV_CONFIG.REFRESH.portfolio));

    // Medium (60s) : history + weights
    _timers.push(setInterval(async () => {
      try {
        const [hRes, wRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.history, 0),
          AVApi.fetchJSON(URLS.weights, 0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _history = p(hRes) || _history;
        _weights = p(wRes) || _weights;
        renderNavChart();
        renderStrategyWeights();
      } catch (err) {
        console.warn('[av-analytics] Refresh medium error:', err.message);
      }
    }, AV_CONFIG.REFRESH.signals));

    // Slow (5min) : insights + rebalancer + model
    _timers.push(setInterval(async () => {
      try {
        const [iRes, rRes, mRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.insights,   0),
          AVApi.fetchJSON(URLS.rebalancer, 0),
          AVApi.fetchJSON(URLS.model,      0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _insights   = p(iRes) || _insights;
        _rebalancer = p(rRes) || _rebalancer;
        _model      = p(mRes) || _model;
        renderLearningInsights();
        renderRebalancerStatus();
        renderModelPerformance();
      } catch (err) {
        console.warn('[av-analytics] Refresh slow error:', err.message);
      }
    }, AV_CONFIG.REFRESH.static));
  }

  // ══════════════════════════════════════════════════════════
  // SIDEBAR
  // ══════════════════════════════════════════════════════════
  function _updateSidebar() {
    const dot   = document.getElementById('sb-ibkr-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');
    if (dot)   dot.className  = 'av-status-dot green';
    if (label) label.textContent = 'Analytics';
    if (sync)  sync.textContent  = 'Refresh 30s';
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS
  // ══════════════════════════════════════════════════════════
  function _bindThemeToggle() {
    const btn = document.getElementById('av-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      AVUtils.ThemeManager.toggle();
      if (_navChart) {
        _navChart.applyOptions({ layout: { textColor: _chartTextColor() } });
      }
      if (_stratChart) {
        try { _stratChart.destroy(); } catch (e) {}
        _stratChart = null;
        renderStrategyWeights();
      }
    });
  }

  function _bindSidebar() {
    const toggler = document.getElementById('av-hamburger');
    const sidebar = document.getElementById('av-sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    if (toggler && sidebar) {
      toggler.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        if (overlay) overlay.classList.toggle('active');
      });
    }
    if (overlay && sidebar) {
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        if (overlay) overlay.classList.remove('active');
      });
    }
  }

  function _bindTimeframeBtns() {
    document.querySelectorAll('.av-timeframe-btn').forEach(btn => {
      btn.addEventListener('click', () => _applyTimeframe(btn.dataset.tf));
    });
  }

  function _chartTextColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? '#94a3b8' : '#64748b';
  }

  // ── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._AnalyticsCtrl = {
    destroy: () => {
      _timers.forEach(clearInterval);
      if (_navChart) { try { _navChart.remove(); } catch (e) {} _navChart = null; }
      if (_stratChart) { try { _stratChart.destroy(); } catch (e) {} _stratChart = null; }
    },
    refresh: () => loadData(),
  };

})();