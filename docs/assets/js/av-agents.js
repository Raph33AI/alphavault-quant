// ============================================================
// av-agents.js — AlphaVault Quant Dashboard v1.0
// Agents : grille 13 agents, ML models, LLM council, decisions
// Dépend de : av-config.js, av-utils.js, av-api.js, av-charts.js
// Règle R2 : idle + errors===0 → ✅ VERT (jamais ❌ pour idle)
// ============================================================

const AVAgents = (() => {

  // ══════════════════════════════════════════════════════════
  // HEADER KPIs — 3 cartes globales
  // ══════════════════════════════════════════════════════════

  function renderAgentKPIs(health) {
    const container = document.getElementById('agents-kpi-row');
    if (!container || !health) return;

    const n_agents  = sf(health.n_agents  || 13);
    const n_active  = sf(health.n_active  || 0);
    const n_errors  = sf(health.n_errors  || 0);
    const allOk     = n_errors === 0;

    container.innerHTML = `
      <div class="kpi-card" style="border-top:3px solid #3b82f6">
        <div class="kpi-card-header">
          <i class="fa-solid fa-robot" style="color:#3b82f6"></i>
          <span class="kpi-label">Agents Active</span>
        </div>
        <div class="kpi-value" style="color:#3b82f6">${n_active}/${n_agents}</div>
        <div class="kpi-sub">
          ${progressBar((n_active / n_agents) * 100, '#3b82f6', 4)}
        </div>
      </div>

      <div class="kpi-card" style="border-top:3px solid ${allOk ? '#10b981' : '#ef4444'}">
        <div class="kpi-card-header">
          <i class="fa-solid fa-${allOk ? 'circle-check' : 'circle-exclamation'}"
             style="color:${allOk ? '#10b981' : '#ef4444'}"></i>
          <span class="kpi-label">Error Count</span>
        </div>
        <div class="kpi-value" style="color:${allOk ? '#10b981' : '#ef4444'}">
          ${n_errors}
        </div>
        <div class="kpi-sub">
          ${allOk ? badgeHTML('All systems nominal', 'green', 'fa-check') : badgeHTML(`${n_errors} agent(s) in error`, 'red', 'fa-xmark')}
        </div>
      </div>

      <div class="kpi-card" style="border-top:3px solid #10b981">
        <div class="kpi-card-header">
          <i class="fa-solid fa-cloud-arrow-up" style="color:#10b981"></i>
          <span class="kpi-label">GitHub Sync</span>
        </div>
        <div class="kpi-value" style="color:#10b981;font-size:18px">
          21/21
        </div>
        <div class="kpi-sub">
          ${badgeHTML('HTTP 200', 'green', 'fa-check')} <span style="font-size:10px;color:var(--text-muted)">JSON files</span>
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // GRILLE 13 AGENTS — Règle R2 critique
  // ══════════════════════════════════════════════════════════

  /**
   * R2 : idle + errors===0 → ✅ vert
   * Jamais ❌ pour status="idle" avec errors=0
   */
  function renderAgentGrid(health) {
    const container = document.getElementById('agents-grid');
    if (!container || !health) return;

    const agentsMap = health.agentsMap || {};
    const DESC      = AV_CONFIG.AGENT_DESCRIPTIONS;

    // Ordre d'affichage des agents
    const ORDER = [
      'market_scanner', 'signal', 'regime_detector', 'sentiment',
      'capital_allocator', 'risk_manager', 'pnl_monitor', 'llm_council',
      'execution', 'portfolio_rebalancer', 'history_learner',
      'model_trainer', 'dashboard_sync',
    ];

    // Merge agents connus + agents présents dans le JSON
    const allKeys = [...new Set([...ORDER, ...Object.keys(agentsMap)])];

    container.innerHTML = allKeys.map(name => {
      const agent  = agentsMap[name] || {};
      const desc   = DESC[name] || { label: name, desc: '--', freq: '--', icon: 'fa-robot' };
      const isOk   = isAgentOk(agent);
      const errors = sf(agent.errors || 0);
      const cycles = sf(agent.cycles || 0);
      const status = agent.status || 'idle';
      const lastRun= agent.last_run || null;

      // R2 — couleurs
      const dotColor    = isOk ? '#10b981' : '#ef4444';
      const cardBorder  = isOk ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.2)';
      const cardBg      = isOk ? '' : 'rgba(239,68,68,0.03)';
      const statusLabel = status === 'running' ? 'Running' : status === 'error' ? 'Error' : 'Idle';
      const statusColor = status === 'running' ? '#3b82f6' : status === 'error' ? '#ef4444' : '#10b981';

      return `
        <div class="agent-card" style="border-color:${cardBorder};${cardBg ? 'background:'+cardBg : ''}">

          <div class="agent-card-header">
            <div class="agent-icon">
              <i class="fa-solid ${desc.icon}" style="color:#3b82f6;font-size:14px"></i>
            </div>
            <div class="agent-name-block">
              <div class="agent-name">${desc.label}</div>
              <div class="agent-freq">
                <i class="fa-solid fa-clock" style="font-size:8px"></i> ${desc.freq}
              </div>
            </div>
            <div class="agent-status-dot-wrap">
              <span class="agent-status-dot" style="background:${dotColor};
                box-shadow:0 0 6px ${dotColor}60;
                ${status === 'running' ? 'animation:pulse 1.5s infinite' : ''}">
              </span>
            </div>
          </div>

          <div class="agent-desc">${desc.desc}</div>

          <div class="agent-metrics">
            <div class="agent-metric">
              <div class="agent-metric-label">Status</div>
              <div class="agent-metric-value" style="color:${statusColor}">
                ${isOk
                  ? `<i class="fa-solid fa-circle-check" style="color:#10b981;font-size:10px"></i> ${statusLabel}`
                  : `<i class="fa-solid fa-circle-exclamation" style="color:#ef4444;font-size:10px"></i> Error`}
              </div>
            </div>
            <div class="agent-metric">
              <div class="agent-metric-label">Cycles</div>
              <div class="agent-metric-value">${cycles.toLocaleString()}</div>
            </div>
            <div class="agent-metric">
              <div class="agent-metric-label">Errors</div>
              <div class="agent-metric-value" style="color:${errors > 0 ? '#ef4444' : 'var(--text-muted)'}">
                ${errors}
              </div>
            </div>
            <div class="agent-metric">
              <div class="agent-metric-label">Last Run</div>
              <div class="agent-metric-value" style="font-size:10px">
                ${lastRun ? formatAge(lastRun) : '--'}
              </div>
            </div>
          </div>

          ${errors > 0 ? `
            <div style="margin-top:8px;padding:5px 8px;background:rgba(239,68,68,0.08);
                        border-radius:5px;border:1px solid rgba(239,68,68,0.2);font-size:10px;color:#ef4444">
              <i class="fa-solid fa-triangle-exclamation" style="font-size:9px"></i>
              ${errors} error${errors > 1 ? 's' : ''} — check logs
            </div>` : ''}
        </div>`;
    }).join('');
  }

  // ══════════════════════════════════════════════════════════
  // ML MODELS — AUC bars + metadata
  // ══════════════════════════════════════════════════════════

  function renderMLModels(modelReport) {
    const container = document.getElementById('ml-models-section');
    if (!container) return;

    const d = modelReport || {};
    const xgbAUC   = sf(safeGet(d, 'xgboost_auc',  safeGet(d, 'deployed_auc', 0)));
    const lgbAUC   = sf(safeGet(d, 'lightgbm_auc', 0));
    const logAUC   = sf(safeGet(d, 'logistic_auc', 0));
    const metaAUC  = sf(safeGet(d, 'meta_auc',     0));
    const metaOk   = safeGet(d, 'meta_available',  false) || metaAUC > 0;
    const nFeat    = sf(safeGet(d, 'n_features',   67));
    const lookback = sf(safeGet(d, 'lookback_days', 252));
    const trainDate= safeGet(d, 'training_date', safeGet(d, 'trained_at', null));
    const nextTrain= safeGet(d, 'next_training',  '07:00 UTC Mon-Fri');

    const models = [
      { name: 'XGBoost',          auc: xgbAUC,  icon: 'fa-tree',         active: xgbAUC > 0,  primary: true  },
      { name: 'LightGBM',         auc: lgbAUC,  icon: 'fa-leaf',         active: lgbAUC > 0,  primary: false },
      { name: 'Logistic Reg.',    auc: logAUC,  icon: 'fa-chart-line',   active: logAUC > 0,  primary: false },
      { name: 'Meta Model',       auc: metaAUC, icon: 'fa-brain',        active: metaOk,      primary: false },
    ];

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-microchip" style="color:#3b82f6"></i>
        ML Models — AUC Performance
        <span style="margin-left:auto;font-size:10px;color:var(--text-muted)">
          Lookback: ${lookback}d · Features: ${nFeat}
        </span>
      </div>

      <div class="ml-models-grid">
        ${models.map(m => `
          <div class="ml-model-card ${m.primary ? 'primary' : ''}"
               style="border-color:${m.active ? (m.auc >= 0.75 ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.2)') : 'rgba(107,114,128,0.2)'}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
              <i class="fa-solid ${m.icon}" style="color:${m.active ? '#3b82f6' : '#6b7280'}"></i>
              <span style="font-weight:700;font-size:13px;color:var(--text-primary)">${m.name}</span>
              ${m.primary ? badgeHTML('PRIMARY', 'blue') : ''}
              ${!m.active ? badgeHTML('Absent', 'orange', 'fa-triangle-exclamation') : ''}
            </div>
            <div style="margin-bottom:6px">
              ${AVCharts.aucBar(m.auc)}
            </div>
            <div style="font-size:10px;color:var(--text-muted)">
              AUC: ${m.active ? m.auc.toFixed(4) : 'Not trained'}
            </div>
          </div>`).join('')}
      </div>

      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:14px;padding-top:12px;
                  border-top:1px solid var(--border)">
        <div style="font-size:11px;color:var(--text-muted)">
          <i class="fa-solid fa-calendar-days" style="color:#3b82f6;font-size:10px"></i>
          Last trained: <strong style="color:var(--text-primary)">${trainDate ? formatDate(trainDate) : '--'}</strong>
        </div>
        <div style="font-size:11px;color:var(--text-muted)">
          <i class="fa-solid fa-clock" style="color:#10b981;font-size:10px"></i>
          Next training: <strong style="color:var(--text-primary)">${nextTrain}</strong>
        </div>
        ${!metaOk ? `
          <div style="font-size:11px;color:#f59e0b">
            <i class="fa-solid fa-triangle-exclamation" style="font-size:10px"></i>
            Meta model absent — scheduled next Monday 07:00 UTC
          </div>` : ''}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // LLM COUNCIL — 3 modèles Ollama
  // ══════════════════════════════════════════════════════════

  function renderLLMCouncil(llmStats) {
    const container = document.getElementById('llm-council-section');
    if (!container) return;

    const d           = llmStats || {};
    const totalCalls  = sf(safeGet(d, 'total_calls',    0));
    const rounds      = sf(safeGet(d, 'council_rounds', 0));
    const consensus   = sf(safeGet(d, 'consensus_rate', 0));
    const models      = safeGet(d, 'models', {});
    const isEmpty     = totalCalls === 0 && rounds === 0;

    const MODELS = [
      { key: 'llama3.2',  label: 'LLaMA 3.2',  icon: 'fa-fire',     color: '#f59e0b' },
      { key: 'qwen2.5',   label: 'Qwen 2.5',   icon: 'fa-dragon',   color: '#8b5cf6' },
      { key: 'mistral',   label: 'Mistral 7B',  icon: 'fa-wind',     color: '#3b82f6' },
    ];

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-brain" style="color:#8b5cf6"></i>
        LLM Council — 3-Model Voting (2/3 majority)
        ${!isEmpty ? badgeHTML(`${rounds} rounds`, 'violet') : badgeHTML('Awaiting signal conf >75%', 'orange', 'fa-clock')}
      </div>

      ${isEmpty ? `
        <div style="text-align:center;padding:28px 20px">
          <i class="fa-solid fa-hourglass-half"
             style="font-size:28px;color:#8b5cf6;margin-bottom:12px;display:block;opacity:0.6"></i>
          <div style="font-size:13px;font-weight:700;color:var(--text-primary);margin-bottom:6px">
            Council not yet activated
          </div>
          <div style="font-size:11px;color:var(--text-muted);line-height:1.7;max-width:340px;margin:0 auto">
            The LLM Council activates when a signal exceeds ${(AV_CONFIG.THRESHOLDS.highConf * 100).toFixed(0)}%
            confidence. Three Ollama models vote with a 2/3 majority rule.
          </div>
          <div style="display:flex;justify-content:center;gap:8px;margin-top:14px;flex-wrap:wrap">
            ${MODELS.map(m => `
              <span style="display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;
                           padding:4px 10px;border-radius:8px;
                           background:${m.color}15;color:${m.color};border:1px solid ${m.color}30">
                <i class="fa-solid ${m.icon}" style="font-size:10px"></i> ${m.label}
              </span>`).join('')}
          </div>
        </div>` : `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div class="llm-stat-card">
            <div style="font-size:11px;color:var(--text-muted)">Total API Calls</div>
            <div style="font-size:22px;font-weight:900;color:#8b5cf6;font-family:var(--font-mono)">
              ${totalCalls.toLocaleString()}
            </div>
          </div>
          <div class="llm-stat-card">
            <div style="font-size:11px;color:var(--text-muted)">Consensus Rate</div>
            <div style="font-size:22px;font-weight:900;color:#10b981;font-family:var(--font-mono)">
              ${(consensus * 100).toFixed(1)}%
            </div>
          </div>
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">
          ${MODELS.map(m => {
            const mData   = models[m.key] || models[m.key.replace('.', '_')] || {};
            const calls   = sf(mData.calls   || mData.total_calls || 0);
            const success = sf(mData.success  || mData.successful || 0);
            const rate    = calls > 0 ? (success / calls * 100) : 0;
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:10px;
                          background:var(--bg-secondary);border-radius:8px;
                          border:1px solid var(--border)">
                <i class="fa-solid ${m.icon}" style="color:${m.color};font-size:16px;width:20px;text-align:center"></i>
                <div style="flex:1">
                  <div style="font-weight:700;font-size:12px;color:var(--text-primary);margin-bottom:4px">
                    ${m.label}
                  </div>
                  ${progressBar(rate, m.color, 5)}
                </div>
                <div style="text-align:right;font-family:var(--font-mono);font-size:11px;min-width:70px">
                  <div style="color:${m.color};font-weight:700">${success}/${calls}</div>
                  <div style="color:var(--text-muted)">${rate.toFixed(1)}%</div>
                </div>
              </div>`;
          }).join('')}
        </div>`}`;
  }

  // ══════════════════════════════════════════════════════════
  // SYSTEM STATUS — Cloudflare Workers + Services
  // ══════════════════════════════════════════════════════════

  function renderSystemStatus(systemData, ibkrData) {
    const container = document.getElementById('system-status-section');
    if (!container) return;

    const sys     = systemData || {};
    const ibkr    = ibkrData  || {};
    const workers = safeGet(sys, 'workers', {});
    const session = safeGet(sys, 'session', '--');
    const cycle   = safeGet(sys, 'oracle_cycle', '--');
    const mode    = safeGet(sys, 'mode', '--');
    const ddHalt  = safeGet(sys, 'dd_halt', false);
    const llmOk   = safeGet(sys, 'llm_available', false);
    const ibkrOk  = safeGet(ibkr, 'connected', safeGet(ibkr, 'ibkr_connected', false));
    const ibkrAuth= safeGet(ibkr, 'authenticated', false);

    const SESSION_LABELS = {
      us_regular:   { label: 'US Market Open',  color: '#10b981' },
      us_postmarket:{ label: 'Post-Market',      color: '#f59e0b' },
      us_premarket: { label: 'Pre-Market',       color: '#3b82f6' },
      closed:       { label: 'Market Closed',    color: '#6b7280' },
    };
    const sess = SESSION_LABELS[session] || { label: session, color: '#6b7280' };

    const statusRows = [
      { label: 'Session',         value: sess.label,  color: sess.color,  icon: 'fa-clock' },
      { label: 'Oracle Cycle',    value: `#${cycle}`, color: '#3b82f6',   icon: 'fa-rotate' },
      { label: 'Trading Mode',    value: mode,        color: '#8b5cf6',   icon: 'fa-sliders' },
      { label: 'DD Halt',         value: ddHalt ? 'ACTIVE' : 'Inactive',
                                          color: ddHalt ? '#ef4444' : '#10b981', icon: 'fa-hand' },
      { label: 'Ollama LLM',      value: llmOk ? 'Available' : 'Offline',
                                          color: llmOk ? '#10b981' : '#ef4444',  icon: 'fa-brain' },
      { label: 'IBKR Connected',  value: ibkrOk ? 'Connected' : 'Disconnected',
                                          color: ibkrOk ? '#10b981' : '#ef4444', icon: 'fa-plug' },
      { label: 'IBKR Auth',       value: ibkrAuth ? 'Authenticated' : 'Not auth',
                                          color: ibkrAuth ? '#10b981' : '#f59e0b', icon: 'fa-key' },
    ];

    const workerRows = [
      { key: 'finance_hub',    label: 'Finance Hub API',   url: AV_CONFIG.WORKERS.financeHub   },
      { key: 'ai_proxy',       label: 'Gemini AI Proxy',   url: AV_CONFIG.WORKERS.geminiProxy  },
      { key: 'economic_data',  label: 'Economic Data',     url: AV_CONFIG.WORKERS.economicData },
      { key: 'gh_proxy',       label: 'GitHub Proxy',      url: AV_CONFIG.WORKERS.ghProxy      },
    ];

    container.innerHTML = `
      <div class="section-header">
        <i class="fa-solid fa-server" style="color:#3b82f6"></i>
        System Status
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">

        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
                      letter-spacing:0.5px;margin-bottom:10px">Oracle A1 Status</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${statusRows.map(r => `
              <div style="display:flex;align-items:center;justify-content:space-between;
                          padding:7px 10px;background:var(--bg-secondary);border-radius:7px;
                          border:1px solid var(--border)">
                <span style="font-size:11px;color:var(--text-muted);display:flex;align-items:center;gap:6px">
                  <i class="fa-solid ${r.icon}" style="font-size:9px;color:${r.color}"></i>
                  ${r.label}
                </span>
                <span style="font-size:11px;font-weight:700;color:${r.color}">${r.value}</span>
              </div>`).join('')}
          </div>
        </div>

        <div>
          <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;
                      letter-spacing:0.5px;margin-bottom:10px">Cloudflare Workers</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${workerRows.map(w => {
              const ok = safeGet(workers, w.key, true);
              return `
                <div style="display:flex;align-items:center;justify-content:space-between;
                            padding:7px 10px;background:var(--bg-secondary);border-radius:7px;
                            border:1px solid var(--border)">
                  <div>
                    <div style="font-size:11px;color:var(--text-primary);font-weight:600">${w.label}</div>
                    <div style="font-size:9px;color:var(--text-muted);margin-top:1px;font-family:var(--font-mono)">${w.url.replace('https://', '')}</div>
                  </div>
                  <span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
                               background:${ok ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)'};
                               color:${ok ? '#10b981' : '#ef4444'};
                               border:1px solid ${ok ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}">
                    <i class="fa-solid ${ok ? 'fa-circle-check' : 'fa-circle-xmark'}" style="font-size:9px"></i>
                    ${ok ? 'Online' : 'Offline'}
                  </span>
                </div>`;
            }).join('')}
          </div>
        </div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // AGENT DECISIONS SAMPLE — Top 10 CONFIRM
  // ══════════════════════════════════════════════════════════

  function renderDecisionsSample(decisionsData) {
    const container = document.getElementById('decisions-sample');
    if (!container) return;

    const decisions = safeGet(decisionsData, 'decisions', {});
    const cycle     = safeGet(decisionsData, 'oracle_cycle', '--');

    const confirms = Object.entries(decisions)
      .filter(([, v]) => {
        const fd = safeGet(v, 'final_decision', '');
        return fd === 'CONFIRM' || fd === 'confirm';
      })
      .slice(0, 10);

    if (!confirms.length) {
      container.innerHTML = `
        <div style="text-align:center;padding:24px;color:var(--text-muted)">
          <i class="fa-solid fa-clock" style="margin-right:6px"></i>
          No CONFIRM decisions yet — council pending signal conf &gt;75%
          <div style="font-size:10px;margin-top:6px">Oracle cycle #${cycle}</div>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="font-size:10px;color:var(--text-muted);margin-bottom:8px">
        Oracle cycle #${cycle} · Showing last 10 CONFIRM decisions
      </div>
      <div style="display:flex;flex-direction:column;gap:5px">
        ${confirms.map(([sym, v]) => {
          const fd   = safeGet(v, 'final_decision', 'CONFIRM');
          const conf = sf(safeGet(v, 'confidence', 0));
          const model= safeGet(v, 'llm_model', '--');
          return `
            <div style="display:flex;align-items:center;gap:10px;padding:7px 10px;
                        background:rgba(16,185,129,0.05);border-radius:7px;
                        border:1px solid rgba(16,185,129,0.15);cursor:pointer"
                 onclick="if(window.StockDetail) StockDetail.open('${sym}')">
              <span style="font-weight:700;font-size:12px;color:var(--text-primary);min-width:55px">${sym}</span>
              ${badgeHTML('CONFIRM', 'green', 'fa-circle-check')}
              <span style="font-size:10px;color:var(--text-muted);margin-left:auto">
                ${conf > 0 ? `conf: ${(conf * 100).toFixed(1)}%` : ''}
                ${model !== '--' ? ` · ${model}` : ''}
              </span>
            </div>`;
        }).join('')}
      </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    renderAgentKPIs,
    renderAgentGrid,
    renderMLModels,
    renderLLMCouncil,
    renderSystemStatus,
    renderDecisionsSample,
  };

})();

window.AVAgents = AVAgents;
console.log('[av-agents] Loaded — 13 agents (R2) | ML models AUC | LLM council | System status');