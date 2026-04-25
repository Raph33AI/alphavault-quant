// ============================================================
// dashboard.js — AlphaVault Quant Dashboard v1.0 (PATCHED)
// Corrections : AVApi.URLS → AV_CONFIG.SIGNAL_URLS
//               ID mismatches × 9
//               formatCompact alias
//               null guards partout
// ============================================================

(function () {
  'use strict';

  let _navChart       = null;
  let _navSeries      = null;
  let _navAllData     = [];
  let _currentTf      = 'ALL';
  let _refreshTimers  = [];
  let _lastRefreshTs  = null;

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    _bindThemeToggle();
    AVUtils.setSidebarActive('dashboard');
    _bindSidebar();
    _bindTimeframeBtns();

    showLoadingState();
    const data = await AVApi.loadAll();
    _lastRefreshTs = Date.now();

    renderAll(data);
    _startRefresh();

    AVApi.checkDashboardAPI().then(ok => {
      if (!ok) console.info('[Dashboard] Dashboard API unavailable — SSH tunnel required (R10)');
    });

    console.log('[dashboard] v1.0 init complete');
  }

  function renderAll(data) {
    if (!data) return;
    renderKPIs(data);
    renderRegime(data.regime);
    renderAgentHealth(data.health);
    renderExecution(data.execution, data.mode, data.ibkr);
    renderSignals(data.signals);
    renderNavChart(data.history, data.portfolio);
    renderSystemStatus(data.system, data.ibkr, data.mode);
    renderSidebarStatus(data.mode, data.ibkr, data.signals);
    _updateTopbarMode(data.mode);
    _updateTopbarRegime(data.regime);
    _updateRefreshTime();
  }

  function showLoadingState() {
    ['kpi-netliq-val','kpi-pnl-val','kpi-leverage-val','kpi-positions-val'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = `<span class="skeleton-line" style="width:120px;height:28px;display:block"></span>`;
    });
  }

  // ══════════════════════════════════════════════════════════
  // KPI CARDS
  // ══════════════════════════════════════════════════════════
  function renderKPIs(data) {
    if (!data) return;
    const portfolio = data.portfolio;
    const risk      = data.risk;
    const pnlMon    = data.pnl;

    // ── Net Liquidation (R1) ────────────────────────────────
    const netliq = AVUtils.netliqFromPortfolio(portfolio);
    _setKpi(
      'netliq',
      netliq !== null ? AVUtils.formatCurrencyFull(netliq) : '—',
      netliq !== null
        ? `<i class="fa-regular fa-clock"></i> Source: portfolio.json`
        : `<i class="fa-solid fa-triangle-exclamation"></i> Awaiting data`,
      null,
      netliq !== null ? null : 'var(--accent-orange)'
    );

    // ── Unrealized PnL ──────────────────────────────────────
    const pnl     = parseFloat(portfolio?.unrealized_pnl ?? 0);
    const pnlFmt  = isNaN(pnl) ? '—' : (pnl >= 0 ? '+' : '') + AVUtils.formatCurrencyFull(pnl);
    const pnlClr  = pnl > 0 ? 'var(--accent-green)' : pnl < 0 ? 'var(--accent-red)' : 'var(--text-primary)';
    const winRate = parseFloat(pnlMon?.win_rate ?? 0);
    const winning = parseInt(pnlMon?.winning ?? 0);
    const losing  = parseInt(pnlMon?.losing  ?? 0);

    _setKpi(
      'pnl',
      pnlFmt,
      isNaN(pnl)
        ? '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:9px"></i> Loading...'
        : `<i class="fa-solid fa-chart-bar"></i> W:${winning} / L:${losing} &nbsp;·&nbsp; ${winRate.toFixed(1)}%`,
      null,
      pnlClr
    );

    const pnlValEl = document.getElementById('kpi-pnl-val');
    if (pnlValEl && !isNaN(pnl)) pnlValEl.style.color = pnlClr;

    // ── Leverage (R7) ───────────────────────────────────────
    const lev    = parseFloat(AVUtils.safeGet(risk, 'leverage.current_leverage', 0));
    const overLev= AVUtils.safeGet(risk, 'leverage.is_over_leveraged', false);
    const maxLev = parseFloat(AVUtils.safeGet(risk, 'leverage.max_leverage', 1.0));
    const redBy  = parseFloat(AVUtils.safeGet(risk, 'leverage.reduce_by_pct', 0));

    const levSub = overLev
      ? `<span class="badge badge-orange" style="font-size:9px">
           <i class="fa-solid fa-triangle-exclamation"></i> Over-leveraged — reduce ${(redBy*100).toFixed(0)}%
         </span>`
      : `<i class="fa-solid fa-circle-check" style="color:var(--accent-green)"></i> Within limit (max ${maxLev.toFixed(1)}x)`;

    _setKpi(
      'leverage',
      lev > 0 ? `${lev.toFixed(3)}x` : '—',
      levSub,
      null,
      overLev ? 'var(--accent-orange)' : null
    );

    // Progress bar leverage
    const leverageCard = document.getElementById('kpi-leverage');
    if (leverageCard && lev > 0) {
      let progressEl = leverageCard.querySelector('.dash-lev-progress');
      if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'dash-lev-progress';
        progressEl.innerHTML = `<div class="av-progress-track"><div class="av-progress-fill" id="lev-fill"></div></div>`;
        leverageCard.appendChild(progressEl);
      }
      const fill = document.getElementById('lev-fill');
      if (fill) {
        const pct = Math.min((lev / Math.max(maxLev, 1)) * 100, 100);
        fill.style.width      = `${pct}%`;
        fill.style.background = overLev ? 'var(--gradient-red)' : 'var(--gradient-green)';
      }
    }

    // ── Positions ───────────────────────────────────────────
    const posCount = parseInt(portfolio?.positions_count ?? 0);
    const longCt   = parseInt(portfolio?.long_count  ?? portfolio?.long_positions  ?? 0);
    const shortCt  = parseInt(portfolio?.short_count ?? portfolio?.short_positions ?? 0);

    _setKpi(
      'positions',
      posCount > 0 ? String(posCount) : '—',
      posCount > 0
        ? `<span style="color:var(--accent-green)"><i class="fa-solid fa-arrow-up"></i> ${longCt} LONG</span>
           &nbsp;·&nbsp;
           <span style="color:var(--accent-red)"><i class="fa-solid fa-arrow-down"></i> ${shortCt} SHORT</span>`
        : '<i class="fa-solid fa-circle-notch fa-spin" style="font-size:9px"></i> Loading...',
      null,
      'var(--accent-violet)'
    );

    // Signal stats badges
    const sigs = data.signals;
    if (sigs) {
      const sbBadge = document.getElementById('sidebar-signals-badge');
      if (sbBadge) sbBadge.textContent = sigs.n_signals || sigs.signals?.length || 0;
      const buysEl = document.getElementById('dash-buys-count');
      const hcEl   = document.getElementById('dash-hc-count');
      if (buysEl) buysEl.textContent = `${sigs.n_buy || 0} BUY`;
      if (hcEl)   hcEl.textContent   = `${sigs.n_high_conf || 0} High Conf`;
    }
  }

  function _setKpi(key, val, sub, color = null, valColor = null) {
    const valEl = document.getElementById(`kpi-${key}-val`);
    const subEl = document.getElementById(`kpi-${key}-sub`);
    if (valEl) {
      valEl.innerHTML = val;
      if (valColor) valEl.style.color = valColor;
    }
    if (subEl) subEl.innerHTML = sub || '';
  }

  // ══════════════════════════════════════════════════════════
  // REGIME CARD
  // ══════════════════════════════════════════════════════════
  function renderRegime(data) {
    const body = document.getElementById('dash-regime-body');
    if (!body) return;
    if (!data) { body.innerHTML = `<div class="dash-skeleton-block"></div>`; return; }

    const regime = data.regime || data.signal || data.current_regime || 'NEUTRAL';
    const conf   = parseFloat(data.confidence || 0);
    const prev   = data.previous_regime || '—';
    const dur    = data.regime_duration  || 0;
    const probas = data.probabilities   || {};
    const colors = AVUtils.regimeColor(regime);

    const regimeIcons = {
      BULL:    'fa-solid fa-arrow-trend-up',
      BEAR:    'fa-solid fa-arrow-trend-down',
      NEUTRAL: 'fa-solid fa-minus',
      CRISIS:  'fa-solid fa-triangle-exclamation',
    };

    const probaRows = ['BULL','BEAR','NEUTRAL','CRISIS'].map(r => {
      const pct  = Math.round((probas[r] || 0) * 100);
      const rClr = AVUtils.regimeColor(r);
      return `
        <div class="dash-proba-row">
          <span class="dash-proba-label">${r}</span>
          <div class="dash-proba-bar">
            <div class="dash-proba-fill" style="width:${pct}%;background:${rClr.bg}"></div>
          </div>
          <span class="dash-proba-val">${pct}%</span>
        </div>`;
    }).join('');

    body.innerHTML = `
      <div class="dash-regime-main">
        <div class="dash-regime-badge" style="background:${colors.soft};border:2px solid ${colors.bg}">
          <i class="${regimeIcons[regime] || 'fa-solid fa-circle'}"
             style="color:${colors.bg};font-size:20px"></i>
        </div>
        <div class="dash-regime-info">
          <div class="dash-regime-name" style="color:${colors.bg}">${regime}</div>
          <div class="dash-regime-conf">${(conf * 100).toFixed(0)}% confidence</div>
          ${prev !== '—' ? `
            <div style="font-size:10px;color:var(--text-faint);margin-top:2px">
              <i class="fa-solid fa-clock-rotate-left" style="font-size:9px"></i>
              Was ${prev} &middot; ${dur} cycle${dur !== 1 ? 's' : ''} ago
            </div>` : ''}
        </div>
      </div>
      <div class="dash-regime-probas">${probaRows}</div>`;
  }

  // ══════════════════════════════════════════════════════════
  // AGENT HEALTH (R2)
  // ══════════════════════════════════════════════════════════
  function renderAgentHealth(data) {
    const body = document.getElementById('dash-agents-body');
    if (!body) return;
    if (!data) { body.innerHTML = `<div class="dash-skeleton-block"></div>`; return; }

    const nAgents = parseInt(data.n_agents || 13);
    const nActive = parseInt(data.n_active || 0);
    const nErrors = parseInt(data.n_errors || 0);
    const agents  = data.agents || {};

    const summaryHTML = `
      <div class="dash-agents-summary">
        <div class="dash-agents-stat">
          <div class="dash-agents-stat-val" style="color:var(--accent-blue)">${nAgents}</div>
          <div class="dash-agents-stat-lbl">Total</div>
        </div>
        <div class="dash-agents-stat">
          <div class="dash-agents-stat-val" style="color:var(--accent-green)">${nActive}</div>
          <div class="dash-agents-stat-lbl">Active</div>
        </div>
        <div class="dash-agents-stat">
          <div class="dash-agents-stat-val"
               style="color:${nErrors > 0 ? 'var(--accent-red)' : 'var(--accent-green)'}">
            ${nErrors}
          </div>
          <div class="dash-agents-stat-lbl">Errors</div>
        </div>
      </div>`;

    const agentEntries = Object.entries(agents).slice(0, 8);
    const agentListHTML = agentEntries.length === 0
      ? `<div style="text-align:center;padding:16px;color:var(--text-faint);font-size:12px">
           <i class="fa-solid fa-circle-notch fa-spin"></i> Loading agents...
         </div>`
      : agentEntries.map(([name, ag]) => {
          const isOk    = AVUtils.isAgentOk(ag);         // R2
          const cycles  = parseInt(ag.cycles  || 0);
          const errors  = parseInt(ag.errors  || 0);
          const lastRun = ag.last_run || null;
          const label   = name.replace(/_agent$/, '').replace(/_/g, ' ');
          const dotBg   = isOk ? 'var(--accent-green)' : 'var(--accent-red)';
          const icon    = isOk
            ? `<i class="fa-solid fa-circle-check" style="color:var(--accent-green);font-size:12px" title="OK"></i>`
            : `<i class="fa-solid fa-circle-xmark" style="color:var(--accent-red);font-size:12px" title="${errors} error(s)"></i>`;

          return `
            <div class="dash-agent-row">
              <span class="dash-agent-dot" style="background:${dotBg}"></span>
              <span class="dash-agent-name">${label}</span>
              <span class="dash-agent-cycles">${cycles}x</span>
              <span class="dash-agent-age">${lastRun ? AVUtils.formatAge(lastRun) : '—'}</span>
              ${icon}
            </div>`;
        }).join('');

    body.innerHTML = summaryHTML + `
      <div class="dash-agents-list">${agentListHTML}</div>
      <a href="agents.html" class="dash-agents-link">
        <i class="fa-solid fa-arrow-right" style="font-size:10px"></i> View all 13 agents
      </a>`;
  }

  // ══════════════════════════════════════════════════════════
  // EXECUTION STATUS
  // ══════════════════════════════════════════════════════════
  function renderExecution(execData, modeData, ibkrData) {
    // FIX : ID corrigé dash-exec-body (était dash-execution-body)
    const body = document.getElementById('dash-exec-body');
    if (!body) return;

    const mode      = AVUtils.safeGet(modeData,  'mode',           'paper');
    const auto      = AVUtils.safeGet(modeData,  'auto',           false);
    const dryRun    = AVUtils.safeGet(modeData,  'dry_run',        false);
    const account   = AVUtils.safeGet(modeData,  'account',        '—');
    const ibkrConn  = AVUtils.safeGet(ibkrData,  'ibkr_connected', false);
    const ibkrAuth  = AVUtils.safeGet(ibkrData,  'authenticated',  false);
    const executed  = AVUtils.safeGet(execData,  'stats.executed', 0);
    const failed    = AVUtils.safeGet(execData,  'stats.failed',   0);
    const skipped   = AVUtils.safeGet(execData,  'stats.skipped',  0);
    const cashAvail = parseFloat(AVUtils.safeGet(execData, 'available_cash', 0));

    const modeColor = mode === 'live' ? 'var(--accent-red)' : 'var(--accent-green)';
    const modeLabel = mode === 'live' ? 'LIVE' : 'PAPER';
    const connColor = (ibkrConn && ibkrAuth) ? 'var(--accent-green)' : 'var(--accent-red)';
    const connLabel = (ibkrConn && ibkrAuth) ? 'Connected' : 'Disconnected';

    body.innerHTML = `
      <div class="dash-exec-badges">
        <span class="badge" style="background:${modeColor}20;color:${modeColor};
              border:1px solid ${modeColor}40;${mode==='live'?'animation:pulse-badge 1.5s infinite':''}">
          <i class="fa-solid fa-circle" style="font-size:7px"></i> ${modeLabel}
        </span>
        <span class="badge badge-blue">
          <i class="fa-solid fa-${auto ? 'robot' : 'hand'}" style="font-size:9px"></i>
          ${auto ? 'AUTO' : 'MANUAL'}
        </span>
        ${!dryRun ? `
          <span class="badge badge-green">
            <i class="fa-solid fa-bolt" style="font-size:9px"></i> Live Orders
          </span>` : ''}
      </div>

      <div class="dash-exec-conn">
        <span class="dash-agent-dot"
              style="background:${connColor};animation:${(ibkrConn&&ibkrAuth)?'pulse-dot 2s infinite':'none'}">
        </span>
        <span style="font-size:12px;color:var(--text-secondary);font-weight:600">
          IBeam ${connLabel}
        </span>
        <span style="font-size:10px;color:var(--text-faint);margin-left:auto">${account}</span>
      </div>

      <div class="dash-exec-stats">
        <div class="dash-exec-stat">
          <div class="dash-exec-stat-val" style="color:var(--accent-green)">${executed}</div>
          <div class="dash-exec-stat-lbl">Executed</div>
        </div>
        <div class="dash-exec-stat">
          <div class="dash-exec-stat-val"
               style="color:${failed > 0 ? 'var(--accent-red)' : 'var(--text-muted)'}">
            ${failed}
          </div>
          <div class="dash-exec-stat-lbl">Failed</div>
        </div>
        <div class="dash-exec-stat">
          <div class="dash-exec-stat-val" style="color:var(--text-muted)">${skipped}</div>
          <div class="dash-exec-stat-lbl">Skipped</div>
        </div>
      </div>

      ${cashAvail > 0 ? `
        <div class="dash-exec-capital">
          <div class="dash-exec-cap-row">
            <span style="font-size:11px;color:var(--text-faint)">
              <i class="fa-solid fa-wallet" style="font-size:9px"></i> Available Cash
            </span>
            <span style="font-size:12px;font-weight:700;font-family:var(--font-mono);
                         color:var(--accent-blue)">
              ${AVUtils.formatCurrencyFull(cashAvail)}
            </span>
          </div>
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // TOP SIGNALS TABLE
  // ══════════════════════════════════════════════════════════
  function renderSignals(data) {
    const tbody = document.getElementById('dash-signals-tbody');
    if (!tbody) return;

    if (!data) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:24px;color:var(--text-faint)">
            <i class="fa-solid fa-circle-notch fa-spin"></i> Loading signals...
          </td>
        </tr>`;
      return;
    }

    const nSignals  = data.n_signals   || data.signals?.length || 0;
    const nBuy      = data.n_buy       || 0;
    const nSell     = data.n_sell      || 0;
    const nHighConf = data.n_high_conf || 0;
    const updatedAt = data.updated_at  || null;
    const modelsAct = data.models_active || {};

    // Stats bar (si l'élément existe dans le DOM)
    const statsBar = document.getElementById('dash-signals-stats');
    if (statsBar) {
      statsBar.innerHTML = `
        <span class="badge badge-blue" style="font-size:10px">
          <i class="fa-solid fa-satellite-dish" style="font-size:9px"></i> ${nSignals} signals
        </span>
        <span class="badge badge-green" style="font-size:10px">
          <i class="fa-solid fa-arrow-up" style="font-size:9px"></i> ${nBuy} BUY
        </span>
        <span class="badge badge-red" style="font-size:10px">
          <i class="fa-solid fa-arrow-down" style="font-size:9px"></i> ${nSell} SELL
        </span>
        <span class="badge badge-gold" style="font-size:10px">
          <i class="fa-solid fa-star" style="font-size:9px"></i> ${nHighConf} High Conf
        </span>
        ${updatedAt ? `
          <span style="font-size:10px;color:var(--text-faint);margin-left:auto">
            <i class="fa-regular fa-clock" style="font-size:9px"></i> ${AVUtils.formatAge(updatedAt)}
          </span>` : ''}`;
    }

    // Models bar
    const modelsBar = document.getElementById('dash-models-bar');
    if (modelsBar) {
      modelsBar.innerHTML = Object.entries(modelsAct).map(([model, active]) => `
        <span class="badge" style="font-size:9px;padding:2px 7px;
              background:${active ? 'rgba(59,130,246,0.1)' : 'rgba(100,116,139,0.1)'};
              color:${active ? 'var(--accent-blue)' : 'var(--text-faint)'};
              border:1px solid ${active ? 'rgba(59,130,246,0.25)' : 'rgba(100,116,139,0.2)'}">
          <i class="fa-solid fa-${active ? 'check' : 'xmark'}" style="font-size:8px"></i> ${model}
        </span>`).join('');
    }

    // Update header badges
    const buysEl = document.getElementById('dash-buys-count');
    const hcEl   = document.getElementById('dash-hc-count');
    if (buysEl) buysEl.textContent = `${nBuy} BUY`;
    if (hcEl)   hcEl.textContent   = `${nHighConf} High Conf`;

    // Top 10 BUY signals
    const sigsArr = Array.isArray(data.signals) ? data.signals : [];
    const buySigs = sigsArr
      .filter(s => s.action === 'BUY')
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
      .slice(0, 10);

    if (buySigs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align:center;padding:28px;color:var(--text-faint)">
            <i class="fa-solid fa-magnifying-glass"
               style="display:block;font-size:20px;margin-bottom:8px;opacity:0.3"></i>
            No BUY signals at the moment
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = buySigs.map((sig, idx) => {
      const sym   = sig.symbol    || '—';
      const conf  = parseFloat(sig.confidence || 0);
      const price = parseFloat(sig.price      || 0);
      const score = parseFloat(sig.score || sig.meta_score || sig.final_score || conf);
      const isHC  = conf >= AV_CONFIG.THRESHOLDS.highConf;

      const logoHtml = typeof window._getLogoHtml === 'function'
        ? window._getLogoHtml(sym, 20)
        : `<span class="sym-fallback-icon"
               style="display:inline-flex;align-items:center;justify-content:center;
                      width:20px;height:20px;border-radius:5px;background:var(--gradient-brand);
                      color:#fff;font-size:10px;font-weight:800">${sym.charAt(0)}</span>`;

      const confPct   = (conf * 100).toFixed(1);
      const confColor = conf >= 0.75 ? 'var(--accent-green)'
                      : conf >= 0.55 ? 'var(--accent-blue)'
                      : 'var(--accent-orange)';

      return `
        <tr class="dash-sig-row${isHC ? ' dash-sig-hc' : ''}"
            style="cursor:pointer"
            onclick="if(window.StockDetail) StockDetail.open('${sym}')"
            title="View ${sym} detail">
          <td style="padding:8px 6px;text-align:center;font-size:10px;
                     color:var(--text-faint);font-family:var(--font-mono)">${idx + 1}</td>
          <td style="padding:8px 10px">
            <div style="display:flex;align-items:center;gap:7px">
              ${logoHtml}
              <div>
                <div style="font-weight:700;font-size:13px;color:var(--text-primary);line-height:1.2">
                  ${sym}
                </div>
                ${isHC ? `
                  <div style="font-size:9px;color:#eab308;font-weight:700;letter-spacing:0.3px">
                    <i class="fa-solid fa-star" style="font-size:8px"></i> HIGH CONF
                  </div>` : ''}
              </div>
            </div>
          </td>
          <td style="padding:8px 6px;text-align:center">
            <span class="badge badge-green" style="font-size:10px;padding:2px 8px">
              <i class="fa-solid fa-arrow-up" style="font-size:8px"></i> BUY
            </span>
          </td>
          <td style="padding:8px 10px;min-width:110px">
            <div style="display:flex;align-items:center;gap:6px">
              <div style="flex:1;height:4px;border-radius:2px;
                          background:rgba(148,163,184,0.15);overflow:hidden">
                <div style="width:${confPct}%;height:100%;background:${confColor};
                            border-radius:2px;transition:width 0.5s ease"></div>
              </div>
              <span style="font-size:10px;font-weight:700;font-family:var(--font-mono);
                           color:${confColor};min-width:36px">${confPct}%</span>
            </div>
          </td>
          <td style="padding:8px 10px;font-family:var(--font-mono);font-size:12px;
                     font-weight:600;color:var(--text-primary)">
            ${price > 0 ? AVUtils.formatCurrency(price) : '—'}
          </td>
          <td style="padding:8px 10px;font-family:var(--font-mono);font-size:11px;
                     color:${confColor};font-weight:700">
            ${score > 0 ? score.toFixed(4) : '—'}
          </td>
        </tr>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // NAV CHART — Lightweight Charts
  // ══════════════════════════════════════════════════════════
  function renderNavChart(historyData, portfolioData) {
    // FIX : ID corrigé 'dash-nav-chart' (était 'nav-chart')
    const container = document.getElementById('dash-nav-chart');
    if (!container) return;

    if (typeof LightweightCharts === 'undefined') {
      _renderNavChartFallback(portfolioData, container);
      return;
    }

    const history    = historyData?.history || [];
    const netliqNow  = AVUtils.netliqFromPortfolio(portfolioData);

    _navAllData = [];
    history.forEach(pt => {
      const ts = pt.ts || pt.timestamp || null;
      const nl = parseFloat(pt.netliq || pt.net_liq || 0);
      if (!ts || nl <= 0) return;
      const t = Math.floor(new Date(ts).getTime() / 1000);
      if (!isFinite(t) || t <= 0) return;
      _navAllData.push({
        time:      t,
        value:     nl,
        leverage:  parseFloat(pt.leverage   || 0),
        pnl:       parseFloat(pt.total_pnl  || 0),
        positions: parseInt(pt.n_positions  || 0),
        regime:    pt.regime  || 'NEUTRAL',
        drawdown:  parseFloat(pt.drawdown   || 0),
        win_rate:  parseFloat(pt.win_rate   || 0),
      });
    });

    // Point actuel depuis portfolio.json (R1)
    if (netliqNow && netliqNow > 0) {
      const nowTs = Math.floor(Date.now() / 1000);
      const existingNow = _navAllData.find(p => Math.abs(p.time - nowTs) < 120);
      if (!existingNow) {
        _navAllData.push({
          time:      nowTs,
          value:     netliqNow,
          leverage:  parseFloat(portfolioData?.leverage || 0),
          pnl:       parseFloat(portfolioData?.unrealized_pnl || 0),
          positions: parseInt(portfolioData?.positions_count  || 0),
          regime:    'BULL',
        });
      }
    }

    // Trier + dédupliquer
    _navAllData.sort((a, b) => a.time - b.time);
    const seen = new Set();
    _navAllData = _navAllData.filter(p => {
      if (seen.has(p.time)) return false;
      seen.add(p.time);
      return true;
    });

    if (_navAllData.length === 0) {
      _renderNavChartEmpty(container);
      return;
    }

    if (!_navChart) {
      container.innerHTML = '';
      _navChart = LightweightCharts.createChart(container, {
        layout: {
          background: { color: 'transparent' },
          textColor:  _chartTextColor(),
          fontSize:   11,
          fontFamily: "'Inter', sans-serif",
        },
        grid: {
          vertLines: { color: 'rgba(148,163,184,0.08)' },
          horzLines: { color: 'rgba(148,163,184,0.08)' },
        },
        crosshair: { mode: LightweightCharts.CrosshairMode?.Normal ?? 1 },
        rightPriceScale: {
          borderColor: 'rgba(148,163,184,0.15)',
          visible: true,
        },
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
        width:        container.clientWidth  || 600,
        height:       container.clientHeight || 280,
      });

      // FIX : formatCompact → formatCurrency (était AVUtils.formatCompact inexistant)
      const fmtPrice = v => {
        const n = Math.abs(v);
        if (n >= 1e6) return `$${(v/1e6).toFixed(2)}M`;
        if (n >= 1e3) return `$${(v/1e3).toFixed(1)}K`;
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

      _buildChartTooltip(container);

      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(() => {
          if (_navChart) {
            try {
              _navChart.resize(
                container.clientWidth  || 600,
                container.clientHeight || 280
              );
            } catch(e) {}
          }
        }).observe(container);
      }
    }

    _navChart.applyOptions({ layout: { textColor: _chartTextColor() } });
    _applyNavTimeframe(_currentTf);

    // Info chart
    const chartInfo = document.getElementById('dash-chart-info');
    if (chartInfo) {
      chartInfo.textContent = `${_navAllData.length} data points · Last: ${
        AVUtils.formatCurrencyFull(_navAllData[_navAllData.length - 1]?.value || 0)
      }`;
    }
  }

  function _renderNavChartFallback(portfolioData, container) {
    if (!container) return;
    const netliq = AVUtils.netliqFromPortfolio(portfolioData);
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;color:var(--text-faint);gap:8px;padding:20px;text-align:center">
        <i class="fa-solid fa-chart-line" style="font-size:28px;opacity:0.25"></i>
        <div style="font-size:13px;font-weight:600">Lightweight Charts not loaded</div>
        <div style="font-size:11px">
          Current NetLiq: <strong style="color:var(--accent-blue)">
            ${netliq ? AVUtils.formatCurrencyFull(netliq) : '—'}
          </strong>
        </div>
      </div>`;
  }

  function _renderNavChartEmpty(container) {
    if (!container) return;
    container.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                  height:100%;color:var(--text-faint);gap:8px;padding:20px;text-align:center">
        <i class="fa-solid fa-chart-area" style="font-size:28px;opacity:0.25"></i>
        <div style="font-size:13px;font-weight:600">History being collected</div>
        <div style="font-size:11px;max-width:260px">
          NAV chart populates as the system runs cycles.<br>
          <span style="color:var(--accent-blue)">DashboardSyncAgent refreshes every 60s.</span>
        </div>
      </div>`;
  }

  function _applyNavTimeframe(tf) {
    if (!_navSeries || _navAllData.length === 0) return;
    _currentTf = tf;

    let filtered = _navAllData;
    const now    = Math.floor(Date.now() / 1000);
    if (tf === '1D') filtered = _navAllData.filter(p => p.time >= now - 86400);
    else if (tf === '1W') filtered = _navAllData.filter(p => p.time >= now - 604800);
    else if (tf === '1M') filtered = _navAllData.filter(p => p.time >= now - 2592000);

    if (filtered.length === 0) filtered = _navAllData.slice(-20);

    try {
      _navSeries.setData(filtered.map(p => ({ time: p.time, value: p.value })));
      _navChart.timeScale().fitContent();

      if (filtered.length >= 2) {
        const first = filtered[0].value;
        const last  = filtered[filtered.length - 1].value;
        const isPos = last >= first;
        _navSeries.applyOptions({
          topColor:       isPos ? 'rgba(16,185,129,0.22)' : 'rgba(239,68,68,0.18)',
          bottomColor:    isPos ? 'rgba(16,185,129,0.02)' : 'rgba(239,68,68,0.02)',
          lineColor:      isPos ? '#10b981' : '#ef4444',
          priceLineColor: isPos ? '#10b981' : '#ef4444',
        });
      }
    } catch(e) {
      console.warn('[Dashboard] Chart setData error:', e.message);
    }

    // Update timeframe buttons
    document.querySelectorAll('.av-timeframe-btn').forEach(btn => {
      const active = btn.dataset.tf === tf;
      btn.classList.toggle('active', active);
    });
  }

  function _buildChartTooltip(container) {
    const tt = document.createElement('div');
    tt.id = 'nav-chart-tooltip';
    tt.style.cssText = `
      position:absolute;left:12px;top:12px;pointer-events:none;
      background:var(--bg-card);border:1px solid var(--border);
      border-radius:8px;padding:8px 12px;font-size:11px;
      color:var(--text-secondary);display:none;
      box-shadow:var(--shadow-card);z-index:10;min-width:160px;line-height:1.6;`;
    container.style.position = 'relative';
    container.appendChild(tt);

    if (_navChart && _navSeries) {
      _navChart.subscribeCrosshairMove(param => {
        if (!param?.point || !param?.seriesData) { tt.style.display = 'none'; return; }
        const dp = param.seriesData.get(_navSeries);
        if (!dp) { tt.style.display = 'none'; return; }

        const ts  = typeof param.time === 'number' ? param.time : 0;
        const raw = _navAllData.find(p => p.time === ts);
        const d   = new Date(ts * 1000);

        tt.style.display = 'block';
        tt.innerHTML = `
          <div style="font-weight:700;color:var(--text-primary);font-size:12px">
            ${AVUtils.formatCurrencyFull(dp.value)}
          </div>
          <div style="color:var(--text-faint);font-size:10px">
            ${AVUtils.formatDate(d.toISOString())}
          </div>
          ${raw ? `
            <div style="margin-top:4px;border-top:1px solid var(--border);padding-top:4px">
              ${raw.leverage > 0 ? `<div>Leverage: <strong>${raw.leverage.toFixed(2)}x</strong></div>` : ''}
              ${raw.pnl !== 0 ? `<div>PnL: <strong style="color:${raw.pnl>=0?'var(--accent-green)':'var(--accent-red)'}">
                ${raw.pnl>=0?'+':''}${AVUtils.formatCurrencyFull(raw.pnl)}</strong></div>` : ''}
              ${raw.positions > 0 ? `<div>Positions: <strong>${raw.positions}</strong></div>` : ''}
              ${raw.regime ? `<div>Regime: <strong style="color:${AVUtils.regimeColor(raw.regime).bg}">${raw.regime}</strong></div>` : ''}
            </div>` : ''}`;
      });
    }
  }

  function _chartTextColor() {
    return document.documentElement.getAttribute('data-theme') === 'dark'
      ? '#94a3b8' : '#64748b';
  }

  // ══════════════════════════════════════════════════════════
  // SYSTEM STATUS BAR
  // ══════════════════════════════════════════════════════════
  function renderSystemStatus(sysData, ibkrData, modeData) {
    const bar = document.getElementById('dash-status-bar');
    if (!bar) return;

    const session  = AVUtils.safeGet(sysData, 'session',       'closed');
    const cycle    = AVUtils.safeGet(sysData, 'oracle_cycle',  '—');
    const agActive = AVUtils.safeGet(sysData, 'agents_active', 13);
    const ddHalt   = AVUtils.safeGet(sysData, 'dd_halt',       false);
    const wFH      = AVUtils.safeGet(sysData, 'workers.finance_hub',   true);
    const wAI      = AVUtils.safeGet(sysData, 'workers.ai_proxy',      true);
    const wED      = AVUtils.safeGet(sysData, 'workers.economic_data', true);
    const ibkrConn = AVUtils.safeGet(ibkrData,'ibkr_connected', false);
    const ibkrMode = AVUtils.safeGet(ibkrData,'mode',           'paper');

    const sessionMap = {
      us_regular:    { color: 'var(--accent-green)',  label: 'US Regular'    },
      us_premarket:  { color: 'var(--accent-blue)',   label: 'Pre-Market'    },
      us_postmarket: { color: 'var(--accent-orange)', label: 'Post-Market'   },
      closed:        { color: 'var(--text-faint)',    label: 'Market Closed' },
    };
    const sess = sessionMap[session] || sessionMap.closed;

    const wDot = ok => `<span style="width:6px;height:6px;border-radius:50%;display:inline-block;
                               margin-right:3px;background:${ok?'var(--accent-green)':'var(--accent-red)'}"></span>`;

    bar.innerHTML = `
      <div class="dash-status-item">
        <span class="dash-agent-dot" style="background:${sess.color};animation:pulse-dot 2s infinite"></span>
        <span style="font-size:11px;font-weight:600;color:${sess.color}">${sess.label}</span>
      </div>
      <div class="dash-status-sep"></div>
      <div class="dash-status-item">
        <i class="fa-solid fa-robot" style="font-size:10px;color:var(--accent-blue)"></i>
        <span style="font-size:11px;color:var(--text-secondary)">${agActive}/13 agents</span>
      </div>
      <div class="dash-status-sep"></div>
      <div class="dash-status-item">
        <i class="fa-solid fa-rotate" style="font-size:10px;color:var(--text-faint)"></i>
        <span style="font-size:11px;color:var(--text-faint)">Cycle #${cycle}</span>
      </div>
      <div class="dash-status-sep"></div>
      <div class="dash-status-item">
        <i class="fa-solid fa-plug"
           style="font-size:10px;color:${ibkrConn?'var(--accent-green)':'var(--accent-red)'}"></i>
        <span style="font-size:11px;color:var(--text-secondary)">
          IBKR ${ibkrConn ? 'ON' : 'OFF'} &middot; ${ibkrMode.toUpperCase()}
        </span>
      </div>
      <div class="dash-status-sep"></div>
      <div class="dash-status-item">
        <span style="font-size:10px;color:var(--text-faint)">Workers:</span>
        ${wDot(wFH)}<span style="font-size:10px;color:var(--text-faint)">Finance</span>
        ${wDot(wAI)}<span style="font-size:10px;color:var(--text-faint)">AI</span>
        ${wDot(wED)}<span style="font-size:10px;color:var(--text-faint)">Eco</span>
      </div>
      ${ddHalt ? `
        <div class="dash-status-sep"></div>
        <div class="dash-status-item">
          <span class="badge badge-red" style="font-size:9px;animation:pulse-badge 1s infinite">
            <i class="fa-solid fa-hand"></i> DD HALT
          </span>
        </div>` : ''}`;
  }

  // ══════════════════════════════════════════════════════════
  // SIDEBAR STATUS (R2)
  // ══════════════════════════════════════════════════════════
  function renderSidebarStatus(modeData, ibkrData, signalData) {
    // FIX : IDs corrigés (sb-ibkr-dot, sb-mode-label, sb-last-sync)
    const dot   = document.getElementById('sb-ibkr-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');

    const connected = AVUtils.safeGet(ibkrData, 'ibkr_connected', false);
    const mode      = AVUtils.safeGet(modeData, 'mode', 'paper');
    const auto      = AVUtils.safeGet(modeData, 'auto', false);
    const updAt     = signalData?.updated_at || null;

    if (dot) {
      dot.className = `av-status-dot ${connected ? 'green' : 'red'}`;
      if (connected) dot.style.animation = 'pulse-dot 2s infinite';
    }
    if (label) label.textContent = `${mode.toUpperCase()} ${auto ? 'AUTO' : 'MANUAL'}`;
    if (sync && updAt) sync.textContent = AVUtils.formatAge(updAt);
  }

  // ══════════════════════════════════════════════════════════
  // TOPBAR HELPERS
  // ══════════════════════════════════════════════════════════
  function _updateTopbarMode(modeData) {
    const el = document.getElementById('topbar-mode-badge');
    if (!el || !modeData) return;

    const mode  = modeData.mode || 'paper';
    const auto  = modeData.auto || false;
    const color = mode === 'live' ? 'var(--accent-red)' : 'var(--accent-green)';

    el.innerHTML = `
      <span style="background:${color}20;color:${color};border:1px solid ${color}40;
                   font-size:10px;font-weight:700;padding:2px 9px;border-radius:20px;
                   ${mode==='live'?'animation:pulse-badge 1.5s infinite':''}">
        <i class="fa-solid fa-circle" style="font-size:7px"></i>
        ${mode.toUpperCase()} &middot; ${auto ? 'AUTO' : 'MANUAL'}
      </span>`;
  }

  function _updateTopbarRegime(regimeData) {
    const el = document.getElementById('topbar-regime-badge');
    if (!el || !regimeData) return;

    const regime = regimeData.regime || regimeData.signal || 'NEUTRAL';
    const conf   = parseFloat(regimeData.confidence || 0);
    const colors = AVUtils.regimeColor(regime);

    el.style.display = '';
    el.innerHTML = `
      <span style="background:${colors.soft};color:${colors.bg};
                   border:1px solid ${colors.bg}40;font-size:10px;font-weight:700;
                   padding:2px 9px;border-radius:20px">
        ${regime}${conf > 0 ? ' ' + (conf*100).toFixed(0) + '%' : ''}
      </span>`;
  }

  function _updateRefreshTime() {
    // FIX : ID corrigé 'topbar-refresh-time' (était 'topbar-last-refresh')
    // + update du <span> interne pour ne pas écraser l'icône
    const el = document.getElementById('topbar-refresh-time');
    if (!el || !_lastRefreshTs) return;
    const secs = Math.floor((Date.now() - _lastRefreshTs) / 1000);
    const txt  = secs < 5 ? 'Just now' : `${secs}s ago`;
    const inner = el.querySelector('span');
    if (inner) inner.textContent = txt;
    else el.childNodes[el.childNodes.length - 1].textContent = txt;
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH — CORRIGÉ (AVApi.URLS → AV_CONFIG.SIGNAL_URLS)
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    // ── Référence locale aux URLs (le vrai fix) ─────────────
    const URLS = AV_CONFIG.SIGNAL_URLS;

    // ── Timer 1 : Portfolio + Risk (30s) ─────────────────────
    _refreshTimers.push(setInterval(async () => {
      try {
        const [portfolio, risk, pnl, ibkr, exec, mode] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.portfolio, 0),
          AVApi.fetchJSON(URLS.risk,      0),
          AVApi.fetchJSON(URLS.pnl,       0),
          AVApi.fetchJSON(URLS.ibkr,      0),
          AVApi.fetchJSON(URLS.execution, 0),
          AVApi.fetchJSON(URLS.mode,      0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        renderKPIs({ portfolio: p(portfolio), risk: p(risk), pnl: p(pnl), signals: null });
        renderExecution(p(exec), p(mode), p(ibkr));
        renderSidebarStatus(p(mode), p(ibkr), null);
        _updateTopbarMode(p(mode));
        _lastRefreshTs = Date.now();
        _updateRefreshTime();
      } catch (err) {
        console.warn('[Dashboard] Refresh (portfolio) error:', err.message);
      }
    }, AV_CONFIG.REFRESH.portfolio));

    // ── Timer 2 : Signals + Regime (60s) ─────────────────────
    _refreshTimers.push(setInterval(async () => {
      try {
        const [signals, regime, history, portfolio] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.signals,   0),
          AVApi.fetchJSON(URLS.regime,    0),
          AVApi.fetchJSON(URLS.history,   0),
          AVApi.fetchJSON(URLS.portfolio, 0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        renderSignals(p(signals));
        renderRegime(p(regime));
        renderNavChart(p(history), p(portfolio));
        _updateTopbarRegime(p(regime));
      } catch (err) {
        console.warn('[Dashboard] Refresh (signals) error:', err.message);
      }
    }, AV_CONFIG.REFRESH.signals));

    // ── Timer 3 : Agents (30s) ───────────────────────────────
    _refreshTimers.push(setInterval(async () => {
      try {
        const health = await AVApi.fetchJSON(URLS.health, 0);
        renderAgentHealth(health);
      } catch (err) {
        console.warn('[Dashboard] Refresh (agents) error:', err.message);
      }
    }, AV_CONFIG.REFRESH.agents));

    // ── Timer 4 : System Status (60s) ────────────────────────
    _refreshTimers.push(setInterval(async () => {
      try {
        const [sys, ibkr] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.system, 0),
          AVApi.fetchJSON(URLS.ibkr,   0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        renderSystemStatus(p(sys), p(ibkr), null);
      } catch (err) {
        console.warn('[Dashboard] Refresh (system) error:', err.message);
      }
    }, AV_CONFIG.REFRESH.regime));

    // ── Timer 5 : Timestamp display (10s) ────────────────────
    _refreshTimers.push(setInterval(_updateRefreshTime, 10_000));
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS — IDs CORRIGÉS
  // ══════════════════════════════════════════════════════════
  function _bindThemeToggle() {
    // FIX : 'av-theme-toggle' (était 'theme-toggle')
    const btn = document.getElementById('av-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => {
      AVUtils.ThemeManager.toggle();
      // Redessine le chart avec les nouvelles couleurs
      if (_navChart) {
        _navChart.applyOptions({ layout: { textColor: _chartTextColor() } });
      }
    });
  }

  function _bindSidebar() {
    // FIX : 'av-hamburger' et 'av-sidebar' (étaient 'sidebar-toggle' et 'sidebar')
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
        overlay.classList.remove('active');
      });
    }
  }

  function _bindTimeframeBtns() {
    document.querySelectorAll('.av-timeframe-btn').forEach(btn => {
      btn.addEventListener('click', () => _applyNavTimeframe(btn.dataset.tf));
    });
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC (debug + HTML onclick)
  // ══════════════════════════════════════════════════════════
  window.setNavTf = tf => _applyNavTimeframe(tf);

  function destroy() {
    _refreshTimers.forEach(clearInterval);
    _refreshTimers = [];
    if (_navChart) {
      try { _navChart.remove(); } catch(e) {}
      _navChart = null; _navSeries = null;
    }
  }

  // ── Boot ──────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._DashboardCtrl = { destroy, renderAll, renderNavChart };

})();