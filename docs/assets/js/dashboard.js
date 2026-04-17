// ============================================================
// ALPHAVAULT QUANT — Dashboard Main Controller
// Auto-refresh toutes les 60s depuis les JSON signals
// ============================================================

const Dashboard = (() => {

  // ── État global ─────────────────────────────────────────
  let _state    = {};
  let _interval = null;
  const REFRESH_MS = 60_000;  // 60 secondes

  // ── Regime Config ───────────────────────────────────────
  const REGIME_CONFIG = {
    trend_up:          { icon: '🚀', color: '#10b981', label: 'TREND UP' },
    trend_down:        { icon: '📉', color: '#ef4444', label: 'TREND DOWN' },
    range_bound:       { icon: '↔', color: '#64748b', label: 'RANGE BOUND' },
    low_volatility:    { icon: '😴', color: '#06b6d4', label: 'LOW VOLATILITY' },
    high_volatility:   { icon: '⚡', color: '#f59e0b', label: 'HIGH VOLATILITY' },
    crash:             { icon: '💥', color: '#ef4444', label: 'CRASH' },
    macro_tightening:  { icon: '🔒', color: '#f97316', label: 'TIGHTENING' },
    macro_easing:      { icon: '🌊', color: '#8b5cf6', label: 'EASING' },
    initializing:      { icon: '⏳', color: '#64748b', label: 'INITIALIZING' },
  };

  const STRATEGY_COLORS = {
    trend:             '#3b82f6',
    mean_reversion:    '#10b981',
    vol_carry:         '#8b5cf6',
    options_convexity: '#f97316',
  };

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  function init() {
    startClock();
    Charts.initPriceChart('price-chart');
    refresh().then(() => {
      _interval = setInterval(refresh, REFRESH_MS);
    });
  }

  async function refresh() {
    try {
      const data = await ApiClient.fetchAll();
      _state = data;

      updateTopbar(data);
      updateActiveSection(data);
      updateLastUpdate();
    } catch (err) {
      console.error('Dashboard refresh error:', err);
    }
  }

  async function forceRefresh() {
    clearInterval(_interval);
    await ApiClient.fetchAll(true).then(data => {
      _state = data;
      updateTopbar(data);
      updateActiveSection(data);
      updateLastUpdate();
    });
    _interval = setInterval(refresh, REFRESH_MS);
  }

  // ════════════════════════════════════════════════════════
  // TOPBAR
  // ════════════════════════════════════════════════════════
  function updateTopbar(data) {
    const status  = data.status  || {};
    const regime  = data.regime  || {};
    const global  = regime.global || {};

    // Régime badge
    const rc = REGIME_CONFIG[global.regime_label] || REGIME_CONFIG.initializing;
    const badge = document.getElementById('regime-badge');
    if (badge) {
      badge.textContent   = `${rc.icon} ${rc.label}`;
      badge.style.color   = rc.color;
      badge.style.borderColor = rc.color;
    }

    // Status dots
    setDot('dot-llm', status.llm_available ? 'ok' : 'error');
    setDot('dot-hub', status.workers?.finance_hub ? 'ok' : 'warn');
    setDot('dot-sys', status.overall === 'healthy' ? 'ok' :
                      status.overall === 'degraded' ? 'warn' : 'error');

    // Session
    const sess = status.session || 'closed';
    const sessEl = document.getElementById('session-badge');
    if (sessEl) {
      sessEl.textContent = sess.toUpperCase();
      sessEl.className   = `session-badge ${sess}`;
    }

    // Dry run
    const drEl = document.getElementById('dry-run-badge');
    if (drEl) {
      drEl.textContent  = status.dry_run === false ? 'LIVE' : 'DRY RUN';
      drEl.className    = status.dry_run === false ? 'dry-run-badge live' : 'dry-run-badge';
    }
  }

  function setDot(id, state) {
    const el = document.getElementById(id);
    if (el) el.className = `status-dot ${state}`;
  }

  // ════════════════════════════════════════════════════════
  // SECTION ROUTING
  // ════════════════════════════════════════════════════════
  function showSection(name) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

    const sec = document.getElementById(`sec-${name}`);
    const nav = document.querySelector(`[data-sec="${name}"]`);
    if (sec) sec.classList.add('active');
    if (nav) nav.classList.add('active');

    // Rend la section courante
    renderSection(name, _state);
  }

  function updateActiveSection(data) {
    const active = document.querySelector('.section.active');
    if (!active) return;
    const name = active.id.replace('sec-', '');
    renderSection(name, data);
  }

  function renderSection(name, data) {
    switch (name) {
      case 'signals':     renderSignals(data);     break;
      case 'portfolio':   renderPortfolio(data);   break;
      case 'regime':      renderRegime(data);      break;
      case 'risk':        renderRisk(data);        break;
      case 'agents':      renderAgents(data);      break;
      case 'strategies':  renderStrategies(data);  break;
      case 'execution':   renderExecution(data);   break;
      case 'performance': renderPerformance(data); break;
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: SIGNALS
  // ════════════════════════════════════════════════════════
  function renderSignals(data) {
    const sigs = data.signals?.signals || {};
    const symbols = Object.keys(sigs);

    // Mise à jour selector de chart
    const sel = document.getElementById('chart-symbol');
    if (sel && sel.options.length < symbols.length) {
      sel.innerHTML = symbols.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    el('signals-count', `${symbols.length} symbols`);

    // KPIs
    let buy = 0, sell = 0, neutral = 0, exec = 0;
    symbols.forEach(sym => {
      const s = sigs[sym];
      if (s.direction === 'buy')     buy++;
      else if (s.direction === 'sell') sell++;
      else neutral++;
      if (s.council === 'execute' || s.council === 'execute_strong') exec++;
    });

    el('kpi-buy',     buy);
    el('kpi-sell',    sell);
    el('kpi-neutral', neutral);
    el('kpi-exec',    exec);

    // Table
    const tbody = document.getElementById('signals-tbody');
    if (!tbody) return;

    if (!symbols.length) {
      tbody.innerHTML = `<tr><td colspan="9" class="loading-row">⏳ Awaiting first signal cycle...</td></tr>`;
      return;
    }

    tbody.innerHTML = symbols.map(sym => {
      const s     = sigs[sym];
      const dir   = s.direction || 'neutral';
      const score = parseFloat(s.final_score || 0);
      const conf  = parseFloat(s.confidence  || 0);
      const bp    = parseFloat(s.buy_prob    || 0.5);
      const council = s.council || 'wait';
      const councilColor = council.includes('execute') ? '#10b981' :
                           council === 'veto' ? '#ef4444' : '#f59e0b';
      const scoreColor = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';

      return `<tr>
        <td><strong>${sym}</strong></td>
        <td>$${parseFloat(s.price || 0).toFixed(2)}</td>
        <td><span class="dir-badge ${dir}">${dir === 'buy' ? '▲ BUY' : dir === 'sell' ? '▼ SELL' : '— NEUTRAL'}</span></td>
        <td>
          <div class="score-bar-cell">
            <div class="score-mini-bar">
              <div class="score-mini-fill" style="width:${(score*100).toFixed(0)}%;background:${scoreColor}"></div>
            </div>
            <span class="score-val" style="color:${scoreColor}">${score.toFixed(2)}</span>
          </div>
        </td>
        <td>${(conf * 100).toFixed(1)}%</td>
        <td>${(bp * 100).toFixed(1)}%</td>
        <td><code style="font-size:11px;color:#94a3b8">${s.trade_action || 'wait'}</code></td>
        <td><strong style="color:${councilColor}">${council.toUpperCase()}</strong></td>
        <td><span style="font-size:11px;color:#64748b">${(s.regime || 'unknown').replace(/_/g,' ')}</span></td>
      </tr>`;
    }).join('');
  }

  function filterSignals() {
    const q = document.getElementById('signal-search')?.value.toLowerCase() || '';
    document.querySelectorAll('#signals-tbody tr').forEach(tr => {
      const sym = tr.querySelector('td')?.textContent?.toLowerCase() || '';
      tr.style.display = sym.includes(q) ? '' : 'none';
    });
  }

  async function loadChart() {
    const sym      = document.getElementById('chart-symbol')?.value || 'SPY';
    const interval = document.getElementById('chart-interval')?.value || '1day';
    el('chart-title', `${sym} — ${interval}`);

    try {
      const url  = `${_state.signals?.signals?.[sym] ? '' : ''}`;
      const resp = await fetch(
        `https://finance-hub-api.raphnardone.workers.dev/api/time-series` +
        `?symbol=${sym}&interval=${interval}&outputsize=100`
      );
      if (!resp.ok) throw new Error('fetch failed');
      const raw  = await resp.json();
      const vals = raw.values || raw.data || [];
      Charts.updatePriceChart(vals, {});
    } catch (e) {
      console.warn('Chart load failed:', e.message);
      // Affichage données placeholder
      const fakeData = generateFakeCandleData(sym);
      Charts.updatePriceChart(fakeData, {});
    }
  }

  function generateFakeCandleData(sym) {
    const data = []; let price = 400;
    const now  = Date.now();
    for (let i = 99; i >= 0; i--) {
      const change = (Math.random() - 0.48) * 3;
      price       += change;
      const open   = price;
      const close  = price + (Math.random() - 0.5) * 2;
      data.push({
        datetime: new Date(now - i * 86400000).toISOString().split('T')[0],
        open: open.toFixed(2), high: (Math.max(open, close) + Math.random()).toFixed(2),
        low:  (Math.min(open, close) - Math.random()).toFixed(2), close: close.toFixed(2),
      });
    }
    return data;
  }

  // ════════════════════════════════════════════════════════
  // SECTION: PORTFOLIO
  // ════════════════════════════════════════════════════════
  function renderPortfolio(data) {
    const port = data.portfolio || {};
    const val  = parseFloat(port.total_value || 100000);
    const cash = parseFloat(port.cash_pct   || 1);
    const pos  = port.positions || {};
    const wts  = port.weights   || {};

    el('p-total-value',         `$${val.toLocaleString()}`);
    el('portfolio-value-header', `$${val.toLocaleString()}`);
    el('p-cash',                 `${(cash*100).toFixed(1)}%`);
    el('p-positions',            Object.keys(pos).length);

    const risk = data.risk || {};
    const lever= parseFloat(risk.leverage?.current_leverage || 0);
    el('p-leverage', `${lever.toFixed(2)}x`);

    // Donut
    const dispWeights = Object.keys(wts).length
      ? wts
      : { Cash: cash, Positions: 1 - cash };
    Charts.renderPortfolioDonut(dispWeights);

    // Positions table
    const tbody = document.getElementById('positions-tbody');
    if (!tbody) return;
    const posEntries = Object.entries(pos);
    if (!posEntries.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="loading-row">No open positions (dry run)</td></tr>`;
    } else {
      tbody.innerHTML = posEntries.map(([sym, p]) => `<tr>
        <td><strong>${sym}</strong></td>
        <td>${p.shares || 0}</td>
        <td>$${(parseFloat(p.value || 0)).toLocaleString()}</td>
        <td>${((wts[sym] || 0) * 100).toFixed(1)}%</td>
      </tr>`).join('');
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: REGIME
  // ════════════════════════════════════════════════════════
  function renderRegime(data) {
    const reg    = data.regime?.global || {};
    const macro  = data.regime?.macro  || {};
    const perSym = data.regime?.per_symbol || {};
    const label  = reg.regime_label || 'initializing';
    const rc     = REGIME_CONFIG[label] || REGIME_CONFIG.initializing;

    // Icon & label
    el('regime-icon',      rc.icon);
    el('regime-label-big', rc.label);
    el('regime-score-val', parseFloat(reg.regime_score || 0).toFixed(2));
    el('regime-conf-val',  `${((reg.confidence || 0) * 100).toFixed(1)}%`);
    el('regime-next-val',  (reg.next_regime || '—').replace(/_/g, ' '));

    // Score bar (offset 50% pour scores négatifs)
    const score = parseFloat(reg.regime_score || 0);
    const pct   = ((score + 1) / 2 * 100).toFixed(1);
    const bar   = document.getElementById('regime-score-bar');
    if (bar) { bar.style.width = `${pct}%`; }

    // Flags
    const flagsEl = document.getElementById('regime-flags');
    if (flagsEl) {
      flagsEl.innerHTML = [
        { label: '▲ Long',   ok: reg.allow_long      },
        { label: '▼ Short',  ok: reg.allow_short     },
        { label: '⚡ Leverage', ok: reg.leverage_allowed },
        { label: '🛡 Full Exp', ok: !reg.reduce_exposure },
        { label: '📊 Options', ok: reg.favor_options  },
      ].map(f => `<div class="regime-flag ${f.ok ? 'ok' : 'bad'}">${f.label}</div>`).join('');
    }

    // Régime badge topbar aussi
    const topBadge = document.getElementById('regime-badge');
    if (topBadge) {
      topBadge.textContent = `${rc.icon} ${rc.label}`;
      topBadge.style.color = rc.color;
    }

    // Probabilities
    Charts.renderRegimeChart(data.regime?.global?.probabilities || {});

    // Macro grid
    const MACRO_LABELS = {
      DFF:     'Fed Funds Rate', T10Y2Y: 'Yield Curve 10Y-2Y',
      VIXCLS:  'VIX',           BAMLH0A0HYM2: 'HY Spread (bps)',
      DTWEXBGS:'USD Index',     CPIAUCSL: 'CPI', UNRATE: 'Unemployment',
    };
    const macroEl = document.getElementById('macro-grid');
    if (macroEl) {
      const entries = Object.entries(macro).filter(([k]) => MACRO_LABELS[k]);
      macroEl.innerHTML = entries.length
        ? entries.map(([k, v]) => `
          <div class="macro-item">
            <span class="macro-label">${MACRO_LABELS[k] || k}</span>
            <span class="macro-val">${v !== null && v !== undefined ? parseFloat(v).toFixed(2) : 'N/A'}</span>
          </div>`).join('')
        : '<div class="macro-item" style="grid-column:1/-1"><span class="macro-label">Macro data unavailable</span></div>';
    }

    // Per-symbol
    const psr = document.getElementById('per-symbol-regime');
    if (psr) {
      psr.innerHTML = Object.entries(perSym).slice(0, 24).map(([sym, r]) => {
        const src = REGIME_CONFIG[r?.regime_label] || REGIME_CONFIG.initializing;
        return `<div class="sym-regime-chip" style="border-color:${src.color}40">
          <span class="sym">${sym}</span>
          <span style="color:${src.color}">${src.icon}</span>
          <span class="reg">${(r?.regime_label || '?').replace(/_/g,' ')}</span>
        </div>`;
      }).join('');
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: RISK
  // ════════════════════════════════════════════════════════
  function renderRisk(data) {
    const risk   = data.risk     || {};
    const dd     = risk.drawdown || {};
    const lever  = risk.leverage || {};

    const currDD   = parseFloat(dd.current_drawdown || 0);
    const dailyPnL = parseFloat(dd.daily_pnl_pct   || 0);
    const currLev  = parseFloat(lever.current_leverage || 0);
    const maxLev   = parseFloat(lever.allowed_leverage || 1.5);
    const halt     = dd.halt_active || lever.is_over_leveraged;

    el('risk-dd',       `${(currDD * 100).toFixed(2)}%`);
    el('risk-lever',    `${currLev.toFixed(2)}x`);
    el('risk-daily-pnl',`${(dailyPnL >= 0 ? '+' : '')}${(dailyPnL * 100).toFixed(2)}%`);
    el('risk-halt',     halt ? '🚨 HALTED' : '✅ ACTIVE');

    const haltKpi = document.getElementById('halt-kpi');
    if (haltKpi) haltKpi.style.borderColor = halt ? '#ef4444' : '#10b981';

    const ddKpi = document.getElementById('dd-kpi');
    if (ddKpi) ddKpi.style.borderColor = currDD < -0.05 ? '#ef4444' : '#10b981';

    // Gauge
    Charts.renderLeverageGauge(currLev, maxLev);
    el('lever-current-label', `Current: ${currLev.toFixed(2)}x`);
    el('lever-max-label',     `Max: ${maxLev.toFixed(2)}x`);

    // Risk limits grid
    const limitsEl = document.getElementById('risk-limits-grid');
    if (limitsEl) {
      const limits = [
        { label: 'Daily Loss Limit',  cur: Math.abs(dailyPnL * 100), max: 2,   unit: '%' },
        { label: 'Max Drawdown',      cur: Math.abs(currDD * 100),   max: 10,  unit: '%' },
        { label: 'Portfolio Leverage',cur: currLev,                   max: maxLev, unit: 'x' },
        { label: 'Max Position',      cur: 0,                         max: 10,  unit: '%' },
      ];
      limitsEl.innerHTML = limits.map(l => {
        const pct   = Math.min((l.cur / l.max) * 100, 100);
        const cls   = pct > 80 ? 'danger' : pct > 60 ? 'warn' : 'safe';
        return `<div class="risk-limit-item">
          <span class="risk-limit-label">${l.label}</span>
          <div class="risk-limit-bar-wrap">
            <div class="risk-limit-bar ${cls}" style="width:${pct.toFixed(0)}%"></div>
          </div>
          <span class="risk-limit-val" style="color:${cls==='danger'?'#ef4444':cls==='warn'?'#f59e0b':'#10b981'}">
            ${l.cur.toFixed(2)}${l.unit}
          </span>
        </div>`;
      }).join('');
    }

    // Drawdown chart
    Charts.updateDrawdownChart(currDD);
  }

  // ════════════════════════════════════════════════════════
  // SECTION: AGENTS
  // ════════════════════════════════════════════════════════
  function renderAgents(data) {
    const agents   = data.agents  || {};
    const status   = data.status  || {};
    const decisions= agents.decisions || {};
    const execs    = agents.executions || [];

    // Council mode badge
    el('council-mode-badge', `MODE: ${status.mode === 'llm' ? '🤖 LLM ASSISTED' : '⚙ DETERMINISTIC'}`);

    // Trouver la décision council dominante
    let topDecision = 'wait', topScore = 0, topReason = 'No decisions yet', topMode = '—';
    Object.values(decisions).forEach(d => {
      const sc = parseFloat(d.council?.weighted_score || 0);
      if (sc > topScore) {
        topScore   = sc;
        topDecision= d.council?.decision || 'wait';
        topReason  = d.council?.reason   || '';
        topMode    = d.council?.mode     || '—';
      }
    });

    const cdEl = document.getElementById('council-decision-main');
    if (cdEl) {
      cdEl.textContent = topDecision.replace('_', ' ').toUpperCase();
      cdEl.className   = `council-decision ${topDecision}`;
    }
    el('council-mode',   topMode);
    el('council-score',  topScore.toFixed(3));
    el('council-reason', topReason || 'Awaiting cycle...');

    // Agent votes grid (prend le premier symbole avec votes)
    const agentVotesEl = document.getElementById('agent-votes-grid');
    if (agentVotesEl) {
      const firstDec = Object.values(decisions)[0];
      const votes    = firstDec?.council?.agent_votes   || {};
      const scores   = firstDec?.council?.agent_scores  || {};
      const AGENT_ICONS = {
        drawdown_guardian:  '🛡', regime_model: '🎯',
        signal_model:       '🤖', execution_timing: '⚡',
        risk_manager:       '⚖', correlation_surface: '🕸',
        strategy_switching: '🔄', market_impact: '💧',
        capital_rotation:   '🌀',
      };
      agentVotesEl.innerHTML = Object.entries(votes).map(([name, vote]) => {
        const sc   = parseFloat(scores[name] || 0);
        const icon = AGENT_ICONS[name] || '🤖';
        const vc   = vote === 'buy' ? '#10b981' : vote === 'sell' ? '#ef4444' : '#64748b';
        return `<div class="agent-vote-card">
          <div class="agent-name">${icon} ${name.replace(/_/g,' ')}</div>
          <div class="agent-vote-badge" style="background:${vc}22;color:${vc};border:1px solid ${vc}">
            ${vote.toUpperCase()}
          </div>
          <div style="font-size:11px;color:#94a3b8">Score: ${sc.toFixed(3)}</div>
          <div class="agent-score-bar">
            <div class="agent-score-fill" style="width:${(sc*100).toFixed(0)}%;background:${vc}"></div>
          </div>
        </div>`;
      }).join('') || '<div style="padding:16px;color:#64748b">Run first cycle to see agent votes</div>';
    }

    // Executions table
    const execTbody = document.getElementById('executions-tbody');
    if (execTbody) {
      execTbody.innerHTML = execs.length
        ? execs.slice(-10).reverse().map(e => `<tr>
            <td style="font-size:11px;color:#64748b">${new Date(e.timestamp).toLocaleTimeString()}</td>
            <td><strong>${e.symbol}</strong></td>
            <td>${e.result?.direction?.toUpperCase() || '—'} ${e.result?.quantity || 0}</td>
            <td><strong style="color:${e.council?.includes('execute')?'#10b981':'#f59e0b'}">${e.council?.toUpperCase()}</strong></td>
            <td><span style="color:${e.result?.status==='simulated'?'#06b6d4':'#10b981'}">${e.result?.status?.toUpperCase()}</span></td>
          </tr>`).join('')
        : '<tr><td colspan="5" class="loading-row">No executions yet</td></tr>';
    }

    // LLM Status
    const llmAvail = status.llm_available;
    const llmDot   = document.getElementById('llm-main-dot');
    if (llmDot) llmDot.className = `llm-dot ${llmAvail ? 'available' : 'unavailable'}`;
    el('llm-status-text', llmAvail ? '✅ LLM Available' : '❌ LLM Unavailable');
    el('llm-mode-text',   `Mode: ${status.mode === 'llm' ? 'AI-Assisted' : 'Deterministic Fallback'}`);

    const fallbackEl = document.getElementById('llm-fallback-info');
    if (fallbackEl) {
      fallbackEl.style.display = llmAvail ? 'none' : 'block';
      fallbackEl.innerHTML     = llmAvail ? '' :
        `⚙ Running in deterministic fallback mode.<br>
         All engines (ML ensemble, regime detection, risk manager, execution alpha) are fully operational.<br>
         LLM arbitration layer disabled — council uses weighted voting.`;
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: STRATEGIES
  // ════════════════════════════════════════════════════════
  function renderStrategies(data) {
    const sw   = data.strategy?.weights || { trend: 0.40, mean_reversion: 0.25, vol_carry: 0.20, options_convexity: 0.15 };
    const perf = data.perf?.strategy_perf || {};

    Charts.renderStrategyDonut(sw);

    const detailsEl = document.getElementById('strategy-details');
    if (detailsEl) {
      detailsEl.innerHTML = Object.entries(sw).map(([name, weight]) => {
        const color = STRATEGY_COLORS[name] || '#64748b';
        const pct   = (weight * 100).toFixed(1);
        return `<div class="strategy-item">
          <div class="strategy-color-dot" style="background:${color}"></div>
          <span class="strategy-name">${name.replace(/_/g,' ')}</span>
          <div class="strategy-bar-wrap">
            <div class="strategy-bar" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="strategy-pct" style="color:${color}">${pct}%</span>
        </div>`;
      }).join('');
    }

    Charts.renderStrategySharpe(perf);
  }

  // ════════════════════════════════════════════════════════
  // SECTION: EXECUTION
  // ════════════════════════════════════════════════════════
  function renderExecution(data) {
    const decisions = data.agents?.decisions || {};

    Charts.renderExecQuality(decisions);

    // Slippage grid
    const slipEl = document.getElementById('slippage-grid');
    if (slipEl) {
      const entries = Object.entries(decisions).slice(0, 6);
      slipEl.innerHTML = entries.length
        ? entries.map(([sym, d]) => `<div class="slippage-item">
            <span class="label">${sym}</span>
            <span class="val">${d.exec_quality ? (d.exec_quality * 100).toFixed(1) + '% quality' : 'N/A'}</span>
          </div>`).join('')
        : '<div class="slippage-item"><span class="label">No data yet</span></div>';
    }

    // Timing grid
    const timingEl = document.getElementById('timing-grid');
    if (timingEl) {
      const now = new Date();
      const utcH = now.getUTCHours();
      const utcM = now.getUTCMinutes();
      const timeDec = utcH + utcM / 60;
      const isOptimal = (15 <= timeDec && timeDec <= 17) || (17.5 <= timeDec && timeDec <= 19.5);
      const isOpen    = 14.5 <= timeDec && timeDec <= 21;

      timingEl.innerHTML = [
        { label: 'Market Open (EST 9:30)', val: isOpen ? '✅ YES' : '❌ NO' },
        { label: 'Optimal Window',         val: isOptimal ? '✅ YES' : '⚠ NO' },
        { label: 'UTC Time',               val: `${String(utcH).padStart(2,'0')}:${String(utcM).padStart(2,'0')}` },
        { label: 'Next Open (UTC)',         val: '14:30' },
        { label: 'Latency Penalty Est.',    val: '~1.5 bps' },
      ].map(t => `<div class="timing-item">
        <span class="label">${t.label}</span>
        <span class="val">${t.val}</span>
      </div>`).join('');
    }
  }

  // ════════════════════════════════════════════════════════
  // SECTION: PERFORMANCE
  // ════════════════════════════════════════════════════════
  function renderPerformance(data) {
    const perf   = data.perf   || {};
    const status = data.status || {};

    el('perf-value',   `$${parseFloat(perf.portfolio_value || 100000).toLocaleString()}`);
    el('perf-signals', perf.n_signals   || 0);
    el('perf-exec',    perf.n_executions|| 0);
    el('perf-mode',    status.mode === 'llm' ? '🤖 LLM' : '⚙ DET.');

    Charts.renderStrategySharpe(perf.strategy_perf || {});

    // Timeline
    const timelineEl = document.getElementById('system-timeline');
    if (timelineEl) {
      const entries = [
        { time: formatTime(status.timestamp), msg: `System ${status.overall || '—'} | Mode: ${status.mode || '—'}` },
        { time: formatTime(perf.timestamp),   msg: `Cycle: ${perf.n_signals || 0} signals, ${perf.n_executions || 0} executions` },
      ];
      timelineEl.innerHTML = entries.map(e => `<div class="timeline-entry">
        <div class="timeline-dot"></div>
        <span class="timeline-time">${e.time}</span>
        <span class="timeline-msg">${e.msg}</span>
      </div>`).join('');
    }
  }

  // ════════════════════════════════════════════════════════
  // CLOCK
  // ════════════════════════════════════════════════════════
  function startClock() {
    const update = () => {
      const now = new Date();
      const utc = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
      el('clock', utc);
    };
    update();
    setInterval(update, 1000);
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function el(id, val) {
    const e = document.getElementById(id);
    if (e) e.textContent = val;
  }
  function pad(n) { return String(n).padStart(2, '0'); }
  function formatTime(ts) {
    if (!ts) return '--:--';
    try { return new Date(ts).toLocaleTimeString(); } catch { return '--'; }
  }
  function updateLastUpdate() {
    el('last-update', `Updated ${new Date().toLocaleTimeString()}`);
  }

  // ── Auto-init ─────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);

  return { showSection, forceRefresh, filterSignals, loadChart };
    window.Dashboard = Dashboard;

    console.log('✅ Dashboard controller loaded');
    console.log('📡 API Base:', ApiClient.getBase());
})();