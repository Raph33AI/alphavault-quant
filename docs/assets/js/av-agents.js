// ============================================================
// av-agents.js — AlphaVault Quant Agents v1.0
// Controller pour agents.html
// Dépend : av-config.js, av-utils.js, av-api.js
// ============================================================

(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────
  let _health    = null;   // agent_health.json
  let _model     = null;   // model_report.json
  let _llm       = null;   // llm_stats.json
  let _system    = null;   // system_status.json
  let _decisions = null;   // agent_decisions.json

  let _timers = [];

  // ── Métadonnées des 13 agents ─────────────────────────────
  const AGENT_META = {
    market_scanner:       { icon: 'fa-magnifying-glass-chart', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',   label: 'Market Scanner'       },
    signal:               { icon: 'fa-satellite-dish',         color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)',   label: 'Signal Agent'         },
    regime_detector:      { icon: 'fa-globe',                  color: '#10b981', bg: 'rgba(16,185,129,0.12)',   label: 'Regime Detector'      },
    sentiment:            { icon: 'fa-face-smile',             color: '#f59e0b', bg: 'rgba(245,158,11,0.12)',   label: 'Sentiment'            },
    capital_allocator:    { icon: 'fa-coins',                  color: '#eab308', bg: 'rgba(234,179,8,0.12)',    label: 'Capital Allocator'    },
    risk_manager:         { icon: 'fa-shield-halved',          color: '#ef4444', bg: 'rgba(239,68,68,0.12)',    label: 'Risk Manager'         },
    pnl_monitor:          { icon: 'fa-chart-line',             color: '#f97316', bg: 'rgba(249,115,22,0.12)',   label: 'PnL Monitor'          },
    llm_council:          { icon: 'fa-brain',                  color: '#a855f7', bg: 'rgba(168,85,247,0.12)',   label: 'LLM Council'          },
    execution:            { icon: 'fa-bolt',                   color: '#10b981', bg: 'rgba(16,185,129,0.12)',   label: 'Execution Agent'      },
    portfolio_rebalancer: { icon: 'fa-scale-balanced',         color: '#06b6d4', bg: 'rgba(6,182,212,0.12)',    label: 'Portfolio Rebalancer' },
    history_learner:      { icon: 'fa-book-open',              color: '#84cc16', bg: 'rgba(132,204,22,0.12)',   label: 'History Learner'      },
    model_trainer:        { icon: 'fa-dumbbell',               color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',   label: 'Model Trainer'        },
    dashboard_sync:       { icon: 'fa-cloud-arrow-up',         color: '#6366f1', bg: 'rgba(99,102,241,0.12)',   label: 'Dashboard Sync'       },
  };

  // ── Modèles ML à afficher ─────────────────────────────────
  const ML_MODELS = [
    { key: 'xgboost',  label: 'XGBoost',              aucField: 'xgboost_auc',  activeField: 'xgboost_active'  },
    { key: 'lightgbm', label: 'LightGBM',             aucField: 'lightgbm_auc', activeField: 'lightgbm_active' },
    { key: 'logistic', label: 'Logistic Regression',  aucField: 'logistic_auc', activeField: 'logistic_active' },
    { key: 'meta',     label: 'Meta Model',           aucField: 'meta_auc',     activeField: 'meta_available'  },
  ];

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    AVUtils.ThemeManager.init();
    AVUtils.setSidebarActive('agents');
    _bindThemeToggle();
    _bindSidebar();

    _showSkeleton();
    await loadData();
    _startRefresh();

    console.log('[av-agents] v1.0 init complete');
  }

  // ══════════════════════════════════════════════════════════
  // DATA
  // ══════════════════════════════════════════════════════════
  async function loadData() {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const [hRes, mRes, lRes, sRes, dRes] = await Promise.allSettled([
      AVApi.fetchJSON(URLS.health,    0),
      AVApi.fetchJSON(URLS.model,     0),
      AVApi.fetchJSON(URLS.llm,       0),
      AVApi.fetchJSON(URLS.system,    0),
      AVApi.fetchJSON(URLS.decisions, 0),
    ]);
    const p = d => d.status === 'fulfilled' ? d.value : null;
    _health    = p(hRes);
    _model     = p(mRes);
    _llm       = p(lRes);
    _system    = p(sRes);
    _decisions = p(dRes);

    renderAll();
  }

  function renderAll() {
    renderKPIs();
    renderAgentsGrid();
    renderMLModels();
    renderLLMCouncil();
    renderSystemStatus();
    renderDecisions();
    _updateSidebarStatus();
  }

  // ══════════════════════════════════════════════════════════
  // KPIs — 4 cartes header
  // ══════════════════════════════════════════════════════════
  function renderKPIs() {
    const nAgents  = parseInt(_health?.n_agents  || 13);
    const nActive  = parseInt(_health?.n_active  || 0);
    const nErrors  = parseInt(_health?.n_errors  || 0);
    const cycle    = _system?.oracle_cycle        || _decisions?.oracle_cycle || '—';
    const session  = _system?.session             || '—';

    // Active agents
    _setHTML('agt-kpi-active', `
      <span class="agt-kpi-val" style="color:${nActive === nAgents
        ? 'var(--accent-green)'
        : 'var(--accent-orange)'}">
        ${nActive}/${nAgents}
      </span>`);

    // Errors
    _setHTML('agt-kpi-errors', `
      <span class="agt-kpi-val" style="color:${nErrors > 0
        ? 'var(--accent-red)'
        : 'var(--accent-green)'}">
        ${nErrors}
      </span>`);

    // Oracle cycle
    _setHTML('agt-kpi-cycle',
      `<span class="agt-kpi-val" style="color:var(--accent-blue)">#${cycle}</span>`);

    // Session badge
    const sessionColors = {
      us_regular:   { color: 'var(--accent-green)',  icon: 'fa-circle-play',  label: 'US Regular'   },
      us_postmarket:{ color: 'var(--accent-orange)', icon: 'fa-moon',         label: 'Post-Market'  },
      premarket:    { color: 'var(--accent-blue)',   icon: 'fa-sun',          label: 'Pre-Market'   },
      closed:       { color: 'var(--text-faint)',    icon: 'fa-circle-stop',  label: 'Market Closed'},
    };
    const sess = sessionColors[session] || sessionColors.closed;
    _setHTML('agt-kpi-session', `
      <span class="agt-kpi-val" style="font-size:13px;color:${sess.color}">
        <i class="fa-solid ${sess.icon}" style="font-size:11px"></i>
        ${sess.label}
      </span>`);
  }

  // ══════════════════════════════════════════════════════════
  // AGENTS GRID — 13 cartes
  // R2 : idle + errors === 0 → ✅ vert | errors > 0 → ❌ rouge
  // ══════════════════════════════════════════════════════════
  function renderAgentsGrid() {
    const grid = document.getElementById('agt-agents-grid');
    if (!grid) return;

    const agentsData = _health?.agents || {};

    grid.innerHTML = Object.entries(AGENT_META).map(([key, meta]) => {
      const data     = agentsData[key] || {};
      const status   = data.status     || 'idle';
      const cycles   = parseInt(data.cycles || 0);
      const errors   = parseInt(data.errors || 0);
      const lastRun  = data.last_run    || null;
      const desc     = AV_CONFIG.AGENT_DESCRIPTIONS?.[key] || '—';

      // R2 : erreurs == 0 → OK peu importe status idle/running
      const isOk      = errors === 0;
      const isRunning = status === 'running';

      return `
        <div class="agt-agent-card ${isOk ? 'ok' : 'err'}">

          <!-- Header : icône + nom + badge statut -->
          <div class="agt-agent-header">
            <div class="agt-agent-icon"
                 style="background:${meta.bg};color:${meta.color}">
              <i class="fa-solid ${meta.icon}"></i>
            </div>
            <div class="agt-agent-name-wrap">
              <div class="agt-agent-name">${meta.label}</div>
              <div class="agt-agent-key">${key}</div>
            </div>
            <div class="agt-agent-badge ${isRunning ? 'running' : isOk ? 'ok' : 'err'}">
              <i class="fa-solid ${
                isRunning ? 'fa-circle-notch fa-spin'
                : isOk    ? 'fa-circle-check'
                          : 'fa-circle-xmark'
              }" style="font-size:9px"></i>
              ${isRunning ? 'Running' : isOk ? 'OK' : 'Error'}
            </div>
          </div>

          <!-- Description -->
          <div class="agt-agent-desc">
            <i class="fa-solid fa-clock" style="font-size:9px;color:var(--text-faint)"></i>
            ${desc}
          </div>

          <!-- Métriques -->
          <div class="agt-agent-metrics">
            <div class="agt-metric-item">
              <div class="agt-metric-val">${cycles.toLocaleString()}</div>
              <div class="agt-metric-lbl">Cycles</div>
            </div>
            <div class="agt-metric-item">
              <div class="agt-metric-val ${errors > 0 ? 'err' : 'ok'}">${errors}</div>
              <div class="agt-metric-lbl">Errors</div>
            </div>
            <div class="agt-metric-item" style="flex:2;min-width:0">
              <div class="agt-metric-val" style="font-size:10px;white-space:nowrap;
                                                  overflow:hidden;text-overflow:ellipsis">
                ${lastRun ? AVUtils.formatAge(lastRun) : '—'}
              </div>
              <div class="agt-metric-lbl">Last Run</div>
            </div>
          </div>

        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // ML MODELS — AUC progress bars
  // ══════════════════════════════════════════════════════════
  function renderMLModels() {
    const body = document.getElementById('agt-models-body');
    if (!body) return;

    const r             = _model || {};
    const version       = r.model_version   || 'v5.0';
    const lookback      = r.lookback_days   || 252;
    const trainDate     = r.training_date   || '—';
    const nextTraining  = r.next_training   || '07:00 UTC (Mon)';
    const nFeatures     = r.n_features      || 67;
    const metaAvail     = r.meta_available  ?? false;

    // Méta-info
    _setHTML('agt-models-meta', `
      <span class="badge badge-blue"    style="font-size:9px">
        <i class="fa-solid fa-code-branch"></i> ${version}
      </span>
      <span class="badge badge-gray"    style="font-size:9px">
        <i class="fa-solid fa-calendar-days"></i> ${lookback}d lookback
      </span>
      <span class="badge badge-gray"    style="font-size:9px">
        <i class="fa-solid fa-puzzle-piece"></i> ${nFeatures} features
      </span>
      ${!metaAvail
        ? `<span class="badge badge-orange" style="font-size:9px">
             <i class="fa-solid fa-triangle-exclamation"></i> Meta absent
           </span>`
        : ''}`);

    body.innerHTML = ML_MODELS.map(m => {
      const auc     = parseFloat(AVUtils.safeGet(r, m.aucField, 0) || 0);
      const active  = !!(AVUtils.safeGet(r, m.activeField, false));
      const pct     = Math.min(auc * 100, 100).toFixed(1);
      const color   = _aucColor(auc);
      const label   = _aucLabel(auc);
      const trained = auc > 0;
      const isMeta  = m.key === 'meta';

      return `
        <div class="agt-model-row">
          <div class="agt-model-left">
            <div class="agt-model-name">
              ${m.label}
              ${active
                ? `<span class="badge badge-green" style="font-size:8px;margin-left:4px">
                     active
                   </span>`
                : isMeta && !metaAvail
                  ? `<span class="badge badge-orange" style="font-size:8px;margin-left:4px">
                       absent
                     </span>`
                  : `<span class="badge badge-gray" style="font-size:8px;margin-left:4px">
                       inactive
                     </span>`}
            </div>
            <div class="agt-model-sub">
              ${isMeta && !metaAvail
                ? `Next training: ${nextTraining}`
                : !trained
                  ? 'Not yet trained'
                  : `Trained: ${trainDate}`}
            </div>
          </div>
          <div class="agt-model-right">
            <div class="agt-auc-track">
              <div class="agt-auc-fill"
                   style="width:${trained ? pct : 0}%;background:${color}"></div>
            </div>
            <span class="agt-auc-val" style="color:${trained ? color : 'var(--text-faint)'}">
              ${trained ? `AUC ${auc.toFixed(4)}` : label}
            </span>
          </div>
        </div>`;
    }).join('');

    // Training schedule
    _setHTML('agt-train-schedule', `
      <div class="agt-train-row">
        <i class="fa-solid fa-rotate" style="color:var(--accent-blue);font-size:10px"></i>
        <span>Next training: <strong>${nextTraining}</strong></span>
      </div>
      <div class="agt-train-row">
        <i class="fa-solid fa-database" style="color:var(--accent-violet);font-size:10px"></i>
        <span>${nFeatures} features · ${lookback}d lookback · Optuna 30 trials</span>
      </div>`);
  }

  function _aucColor(auc) {
    if (auc >= 0.75) return 'var(--accent-green)';
    if (auc >= 0.60) return 'var(--accent-blue)';
    if (auc >= 0.50) return 'var(--accent-orange)';
    return 'var(--text-faint)';
  }

  function _aucLabel(auc) {
    if (auc >= 0.75) return 'Excellent';
    if (auc >= 0.60) return 'Good';
    if (auc >= 0.50) return 'Passable';
    return 'Not trained';
  }

  // ══════════════════════════════════════════════════════════
  // LLM COUNCIL — 3 modèles Ollama
  // ══════════════════════════════════════════════════════════
  function renderLLMCouncil() {
    const body = document.getElementById('agt-llm-body');
    if (!body) return;

    const l             = _llm || {};
    const totalCalls    = parseInt(l.total_calls    || 0);
    const councilRounds = parseInt(l.council_rounds || 0);
    const consensusRate = parseFloat(l.consensus_rate || 0);
    const models        = l.models || {};
    const waiting       = totalCalls === 0 && councilRounds === 0;

    // Stats globales
    _setHTML('agt-llm-stats', `
      <div class="agt-llm-stat-item">
        <div class="agt-llm-stat-val">${totalCalls.toLocaleString()}</div>
        <div class="agt-llm-stat-lbl">Total Calls</div>
      </div>
      <div class="agt-llm-stat-item">
        <div class="agt-llm-stat-val">${councilRounds.toLocaleString()}</div>
        <div class="agt-llm-stat-lbl">Council Rounds</div>
      </div>
      <div class="agt-llm-stat-item">
        <div class="agt-llm-stat-val" style="color:${
          consensusRate >= 0.7 ? 'var(--accent-green)'
          : consensusRate > 0  ? 'var(--accent-orange)'
          : 'var(--text-faint)'}">
          ${consensusRate > 0 ? `${(consensusRate * 100).toFixed(1)}%` : '—'}
        </div>
        <div class="agt-llm-stat-lbl">Consensus</div>
      </div>`);

    // Modèles individuels
    const llmDefs = [
      { key: 'llama3.2',  label: 'LLaMA 3.2',   icon: '🦙', color: '#f97316' },
      { key: 'qwen2.5',   label: 'Qwen 2.5',     icon: '🔮', color: '#8b5cf6' },
      { key: 'mistral',   label: 'Mistral 7B',   icon: '🌬', color: '#3b82f6' },
    ];

    if (waiting) {
      body.innerHTML = `
        <div class="agt-llm-waiting">
          <div class="agt-llm-waiting-icon">
            <i class="fa-solid fa-brain" style="color:var(--accent-violet);font-size:20px"></i>
          </div>
          <div>
            <div class="agt-llm-waiting-title">Council awaiting high-confidence signals</div>
            <div class="agt-llm-waiting-sub">
              Activates when signal confidence &gt;
              <strong>${((AV_CONFIG.THRESHOLDS?.highConf || 0.75) * 100).toFixed(0)}%</strong>
              — 3 Ollama models vote (2/3 majority)
            </div>
          </div>
        </div>
        <div class="agt-llm-models-list">
          ${llmDefs.map(m => `
            <div class="agt-llm-model-row">
              <span class="agt-llm-model-emoji">${m.icon}</span>
              <div class="agt-llm-model-name" style="color:${m.color}">${m.label}</div>
              <div style="flex:1;margin:0 10px;height:3px;border-radius:2px;
                          background:var(--border)"></div>
              <span class="badge badge-gray" style="font-size:9px">0 calls</span>
            </div>`).join('')}
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="agt-llm-models-list">
        ${llmDefs.map(m => {
          const data    = models[m.key] || {};
          const calls   = parseInt(data.calls   || 0);
          const success = parseInt(data.success  || 0);
          const rate    = calls > 0 ? (success / calls * 100).toFixed(1) : '—';
          return `
            <div class="agt-llm-model-row">
              <span class="agt-llm-model-emoji">${m.icon}</span>
              <div class="agt-llm-model-name" style="color:${m.color}">${m.label}</div>
              <div class="agt-llm-model-bar-wrap">
                <div class="agt-llm-model-bar-track">
                  <div class="agt-llm-model-bar-fill"
                       style="width:${calls > 0 ? rate : 0}%;background:${m.color}"></div>
                </div>
              </div>
              <div class="agt-llm-model-stats">
                <span style="font-size:10px;font-family:var(--font-mono);
                             color:var(--text-primary);font-weight:700">
                  ${calls} calls
                </span>
                <span class="badge ${parseFloat(rate) >= 80
                    ? 'badge-green'
                    : parseFloat(rate) >= 50
                      ? 'badge-orange'
                      : 'badge-gray'}"
                      style="font-size:9px">
                  ${rate !== '—' ? `${rate}%` : '—'}
                </span>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // SYSTEM STATUS — Workers + Session
  // ══════════════════════════════════════════════════════════
  function renderSystemStatus() {
    const body = document.getElementById('agt-system-body');
    if (!body) return;

    const s           = _system || {};
    const overall     = s.overall         || '—';
    const llmOk       = s.llm_available   ?? true;
    const ddHalt      = s.dd_halt         ?? false;
    const mode        = s.mode            || '—';
    const agentsAct   = s.agents_active   || 13;
    const workers     = s.workers         || {};

    const workerDefs = [
      { key: 'finance_hub',   label: 'Finance Hub',   icon: 'fa-server'      },
      { key: 'ai_proxy',      label: 'AI Proxy',      icon: 'fa-robot'       },
      { key: 'economic_data', label: 'Economic Data', icon: 'fa-chart-area'  },
    ];

    body.innerHTML = `
      <div class="agt-system-grid">

        <!-- Overall status -->
        <div class="agt-system-item">
          <div class="agt-system-icon" style="background:rgba(16,185,129,0.1)">
            <i class="fa-solid fa-circle-check" style="color:var(--accent-green)"></i>
          </div>
          <div class="agt-system-info">
            <div class="agt-system-label">System</div>
            <div class="agt-system-val">${overall}</div>
          </div>
        </div>

        <!-- Agents actifs -->
        <div class="agt-system-item">
          <div class="agt-system-icon" style="background:rgba(59,130,246,0.1)">
            <i class="fa-solid fa-robot" style="color:var(--accent-blue)"></i>
          </div>
          <div class="agt-system-info">
            <div class="agt-system-label">Agents</div>
            <div class="agt-system-val">${agentsAct}/13 active</div>
          </div>
        </div>

        <!-- LLM -->
        <div class="agt-system-item">
          <div class="agt-system-icon"
               style="background:rgba(${llmOk ? '168,85,247' : '239,68,68'},0.1)">
            <i class="fa-solid fa-brain"
               style="color:${llmOk ? 'var(--accent-violet)' : 'var(--accent-red)'}"></i>
          </div>
          <div class="agt-system-info">
            <div class="agt-system-label">Ollama LLM</div>
            <div class="agt-system-val" style="color:${
              llmOk ? 'var(--accent-green)' : 'var(--accent-red)'}">
              ${llmOk ? 'Available' : 'Unavailable'}
            </div>
          </div>
        </div>

        <!-- DD Halt -->
        <div class="agt-system-item">
          <div class="agt-system-icon"
               style="background:rgba(${ddHalt ? '239,68,68' : '16,185,129'},0.1)">
            <i class="fa-solid fa-${ddHalt ? 'ban' : 'shield-halved'}"
               style="color:${ddHalt ? 'var(--accent-red)' : 'var(--accent-green)'}"></i>
          </div>
          <div class="agt-system-info">
            <div class="agt-system-label">DD Halt</div>
            <div class="agt-system-val" style="color:${
              ddHalt ? 'var(--accent-red)' : 'var(--accent-green)'}">
              ${ddHalt ? '⚠ Active' : 'Inactive'}
            </div>
          </div>
        </div>

        <!-- Mode -->
        <div class="agt-system-item">
          <div class="agt-system-icon" style="background:rgba(99,102,241,0.1)">
            <i class="fa-solid fa-sliders" style="color:#6366f1"></i>
          </div>
          <div class="agt-system-info">
            <div class="agt-system-label">Exec Mode</div>
            <div class="agt-system-val">${mode}</div>
          </div>
        </div>

      </div>

      <!-- Workers -->
      <div class="agt-workers-section">
        <div class="agt-workers-title">
          <i class="fa-solid fa-plug" style="font-size:11px;color:var(--text-faint)"></i>
          Cloudflare Workers
        </div>
        <div class="agt-workers-list">
          ${workerDefs.map(w => {
            const ok = !!(workers[w.key] ?? true);
            return `
              <div class="agt-worker-item">
                <div class="av-status-dot ${ok ? 'green' : 'red'}"></div>
                <i class="fa-solid ${w.icon}"
                   style="font-size:10px;color:var(--text-faint)"></i>
                <span class="agt-worker-label">${w.label}</span>
                <span class="badge ${ok ? 'badge-green' : 'badge-red'}"
                      style="font-size:9px;margin-left:auto">
                  ${ok ? 'UP' : 'DOWN'}
                </span>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // DECISIONS — Top 10 CONFIRM
  // ══════════════════════════════════════════════════════════
  function renderDecisions() {
    const body = document.getElementById('agt-decisions-body');
    if (!body) return;

    const allDec   = _decisions?.decisions || {};
    const cycle    = _decisions?.oracle_cycle || '—';
    const nTotal   = Object.keys(allDec).length;

    _setHTML('agt-decisions-meta', `
      <span class="badge badge-blue" style="font-size:9px">
        <i class="fa-solid fa-rotate"></i> Cycle #${cycle}
      </span>
      <span class="badge badge-gray" style="font-size:9px">
        ${nTotal} symbols analyzed
      </span>`);

    if (nTotal === 0) {
      body.innerHTML = `
        <div class="agt-empty-state">
          <i class="fa-solid fa-brain" style="font-size:26px;opacity:0.15;
             display:block;margin-bottom:10px"></i>
          <div style="font-size:12px;font-weight:700;color:var(--text-secondary);
                      margin-bottom:4px">No decisions yet</div>
          <div style="font-size:11px;color:var(--text-faint)">
            LLM Council activates on signals with confidence &gt; 75%
          </div>
        </div>`;
      return;
    }

    // Filtre : CONFIRM uniquement, top 10
    const confirms = Object.entries(allDec)
      .filter(([, v]) => {
        const fd = (v?.final_decision || '').toUpperCase();
        return fd === 'CONFIRM' || v?.decision === true;
      })
      .slice(0, 10);

    if (confirms.length === 0) {
      body.innerHTML = `
        <div class="agt-empty-state">
          <div style="font-size:12px;color:var(--text-faint);padding:20px;text-align:center">
            ${nTotal} symbols analyzed — no CONFIRM decisions in current cycle
          </div>
        </div>`;
      return;
    }

    body.innerHTML = `
      <div class="av-table-wrapper" style="border:none;border-radius:0">
        <table class="av-table" style="min-width:360px">
          <thead>
            <tr>
              <th style="padding-left:14px">Symbol</th>
              <th style="text-align:center;width:90px">Decision</th>
              <th style="text-align:right">Confidence</th>
              <th style="text-align:center;width:100px">Vote</th>
            </tr>
          </thead>
          <tbody>
            ${confirms.map(([sym, v]) => {
              const fd   = v?.final_decision || (v?.decision ? 'CONFIRM' : 'REJECT');
              const conf = parseFloat(v?.confidence || 0);
              const confPct = (conf * 100).toFixed(1);
              const confColor = conf >= 0.9
                ? 'var(--accent-green)'
                : conf >= 0.75
                  ? 'var(--accent-blue)'
                  : 'var(--accent-orange)';
              return `
                <tr>
                  <td style="padding:9px 14px;font-weight:700;font-size:13px;
                             color:var(--text-primary)">
                    ${sym}
                  </td>
                  <td style="padding:9px 8px;text-align:center">
                    <span class="badge ${
                      fd === 'CONFIRM' ? 'badge-green'
                      : fd === 'REDUCE' ? 'badge-orange'
                      : 'badge-red'}" style="font-size:9px">
                      <i class="fa-solid fa-${
                        fd === 'CONFIRM' ? 'check'
                        : fd === 'REDUCE' ? 'minus'
                        : 'xmark'}"></i>
                      ${fd}
                    </span>
                  </td>
                  <td style="padding:9px 12px;text-align:right">
                    <span style="font-size:11px;font-weight:700;
                                 font-family:var(--font-mono);color:${confColor}">
                      ${conf > 0 ? `${confPct}%` : '—'}
                    </span>
                  </td>
                  <td style="padding:9px 8px;text-align:center">
                    <span style="font-size:10px;color:var(--text-faint)">
                      ${v?.llm_model || 'council'}
                    </span>
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // SKELETON
  // ══════════════════════════════════════════════════════════
  function _showSkeleton() {
    ['agt-kpi-active','agt-kpi-errors','agt-kpi-cycle','agt-kpi-session'].forEach(id => {
      _setHTML(id,
        `<span class="skeleton-line" style="width:70px;height:22px;display:block"></span>`);
    });

    const grid = document.getElementById('agt-agents-grid');
    if (grid) {
      grid.innerHTML = Array.from({ length: 13 }, () => `
        <div class="agt-agent-card ok" style="opacity:0.5">
          <div class="agt-agent-header">
            <div class="agt-agent-icon" style="background:var(--bg-secondary)">
              <span class="skeleton-line"
                    style="width:16px;height:16px;display:block;border-radius:50%"></span>
            </div>
            <div style="flex:1;min-width:0">
              <span class="skeleton-line" style="width:110px;height:13px;
                                                 display:block;margin-bottom:4px"></span>
              <span class="skeleton-line" style="width:80px;height:10px;display:block"></span>
            </div>
          </div>
          <span class="skeleton-line" style="width:90%;height:11px;display:block;
                                            margin:10px 0 6px"></span>
          <div class="agt-agent-metrics">
            ${['60px','40px','70px'].map(w =>
              `<div class="agt-metric-item">
                 <span class="skeleton-line" style="width:${w};height:16px;display:block"></span>
               </div>`).join('')}
          </div>
        </div>`).join('');
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH (30s)
  // ══════════════════════════════════════════════════════════
  function _startRefresh() {
    _timers.push(setInterval(async () => {
      try {
        const URLS = AV_CONFIG.SIGNAL_URLS;
        const [hRes, mRes, lRes, sRes, dRes] = await Promise.allSettled([
          AVApi.fetchJSON(URLS.health,    0),
          AVApi.fetchJSON(URLS.model,     0),
          AVApi.fetchJSON(URLS.llm,       0),
          AVApi.fetchJSON(URLS.system,    0),
          AVApi.fetchJSON(URLS.decisions, 0),
        ]);
        const p = d => d.status === 'fulfilled' ? d.value : null;
        _health    = p(hRes) || _health;
        _model     = p(mRes) || _model;
        _llm       = p(lRes) || _llm;
        _system    = p(sRes) || _system;
        _decisions = p(dRes) || _decisions;
        renderAll();
      } catch (err) {
        console.warn('[av-agents] Refresh error:', err.message);
      }
    }, AV_CONFIG.REFRESH.agents));
  }

  // ══════════════════════════════════════════════════════════
  // BINDINGS
  // ══════════════════════════════════════════════════════════
  function _bindThemeToggle() {
    const btn = document.getElementById('av-theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', () => AVUtils.ThemeManager.toggle());
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
        overlay.classList.remove('active');
      });
    }
  }

  function _updateSidebarStatus() {
    const dot   = document.getElementById('sb-ibkr-dot');
    const label = document.getElementById('sb-mode-label');
    const sync  = document.getElementById('sb-last-sync');
    const nErr  = parseInt(_health?.n_errors || 0);
    if (dot)   dot.className   = `av-status-dot ${nErr === 0 ? 'green' : 'red'}`;
    if (label) label.textContent = `${_health?.n_active || 13}/13 agents`;
    if (sync)  sync.textContent  = 'Refresh 30s';
  }

  // ── Helpers ────────────────────────────────────────────────
  function _setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  }
  function _setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // ── Boot ───────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window._AgentsCtrl = {
    destroy: () => _timers.forEach(clearInterval),
    refresh: () => loadData(),
  };

})();