// ============================================================
// av-config.js — AlphaVault Quant Dashboard v1.0
// Configuration centrale — charger EN PREMIER dans chaque page
// ============================================================

const AV_CONFIG = {

  // ── Sources de données ────────────────────────────────────
  GITHUB_BASE: 'https://raph33ai.github.io/alphavault-quant/signals',
  DASHBOARD_API: 'http://localhost:5002',   // SSH tunnel requis

  WORKERS: {
    financeHub:   'https://finance-hub-api.raphnardone.workers.dev',
    geminiProxy:  'https://gemini-ai-proxy.raphnardone.workers.dev',
    economicData: 'https://economic-data-worker.raphnardone.workers.dev',
    ghProxy:      'https://alphavault-gh-proxy.raphnardone.workers.dev',
    yahooProxy:   'https://yahoo-proxy.raphnardone.workers.dev',
  },

  // ── Intervalles de refresh (ms) ──────────────────────────
  REFRESH: {
    portfolio:   30_000,   // portfolio.json, risk_metrics.json, agent_health.json
    signals:     60_000,   // current_signals.json
    agents:      30_000,   // agent_health.json
    regime:      60_000,   // regime.json
    history:     60_000,   // rolling_history.json
    execution:   30_000,   // execution_status.json, ibkr_status.json
    static:      300_000,  // model_report.json, llm_stats.json, learning_insights.json
  },

  // ── Seuils signaux (R7) ───────────────────────────────────
  THRESHOLDS: {
    buyConf:     0.35,
    sellConf:    0.40,
    highConf:    0.75,
    maxLeverage: 1.0,
    maxDrawdown: 0.15,
    maxCorr:     0.70,
  },

  // ── Couleurs régimes ──────────────────────────────────────
  REGIME_COLORS: {
    BULL:    { bg: '#10b981', text: '#fff', border: '#059669', light: 'rgba(16,185,129,0.12)' },
    BEAR:    { bg: '#ef4444', text: '#fff', border: '#dc2626', light: 'rgba(239,68,68,0.12)'  },
    NEUTRAL: { bg: '#6b7280', text: '#fff', border: '#4b5563', light: 'rgba(107,114,128,0.12)' },
    CRISIS:  { bg: '#7c3aed', text: '#fff', border: '#6d28d9', light: 'rgba(124,58,237,0.12)' },
  },

  // ── Couleurs actions ──────────────────────────────────────
  ACTION_COLORS: {
    BUY:  { bg: '#10b981', text: '#fff', light: 'rgba(16,185,129,0.12)'  },
    SELL: { bg: '#ef4444', text: '#fff', light: 'rgba(239,68,68,0.12)'   },
    HOLD: { bg: '#6b7280', text: '#fff', light: 'rgba(107,114,128,0.12)' },
  },

  // ── Comptes IBKR ──────────────────────────────────────────
  ACCOUNT: {
    paper: 'DUM895161',
    live:  'U21160314',
  },

  // ── Mapping champs Portfolio (R1) ─────────────────────────
  // JAMAIS utiliser performance_metrics.portfolio_value (= 100k seed)
  PORTFOLIO: {
    netliqFields:   ['net_liq', 'netliq', 'NetLiquidation'],
    cashFields:     ['cash', 'Cash', 'available_cash'],
    leverageFields: ['leverage', 'current_leverage'],
    pnlField:       'unrealized_pnl',
    posField:       'positions',
  },

  // ── URLs JSON GitHub Pages (21 fichiers) ─────────────────
  get SIGNAL_URLS() {
    const BASE = this.GITHUB_BASE;
    return {
      portfolio:   `${BASE}/portfolio.json`,
      signals:     `${BASE}/current_signals.json`,
      regime:      `${BASE}/regime.json`,
      risk:        `${BASE}/risk_metrics.json`,
      health:      `${BASE}/agent_health.json`,
      execution:   `${BASE}/execution_status.json`,
      ibkr:        `${BASE}/ibkr_status.json`,
      mode:        `${BASE}/execution_mode.json`,
      orders:      `${BASE}/pending_orders.json`,
      pnl:         `${BASE}/pnl_monitor.json`,
      history:     `${BASE}/rolling_history.json`,
      performance: `${BASE}/performance_metrics.json`,
      allocation:  `${BASE}/capital_allocation.json`,
      model:       `${BASE}/model_report.json`,
      decisions:   `${BASE}/agent_decisions.json`,
      weights:     `${BASE}/strategy_weights.json`,
      llm:         `${BASE}/llm_stats.json`,
      sentiment:   `${BASE}/sentiment_scores.json`,
      insights:    `${BASE}/learning_insights.json`,
      rebalancer:  `${BASE}/rebalancer_status.json`,
      system:      `${BASE}/system_status.json`,
    };
  },

  // ── Descriptions agents (pour agents.html) ────────────────
  AGENT_DESCRIPTIONS: {
    market_scanner:       { label: 'Market Scanner',      desc: 'OHLCV 907 symbols',           freq: '5min',     icon: 'fa-magnifying-glass-chart' },
    signal:               { label: 'Signal Agent',        desc: 'XGB+LGB+Meta signals',        freq: '5min',     icon: 'fa-bolt'                   },
    regime_detector:      { label: 'Regime Detector',     desc: 'BULL/BEAR SPY detection',     freq: '15min',    icon: 'fa-globe'                  },
    sentiment:            { label: 'Sentiment Agent',     desc: 'FinBERT news analysis',       freq: '30min',    icon: 'fa-face-smile'             },
    capital_allocator:    { label: 'Capital Allocator',   desc: 'Kelly + Risk Parity',         freq: 'event',    icon: 'fa-scale-balanced'         },
    risk_manager:         { label: 'Risk Manager',        desc: 'VaR + Drawdown + Corr',       freq: '5min',     icon: 'fa-shield-halved'          },
    pnl_monitor:          { label: 'PnL Monitor',         desc: '8 exit rules',                freq: '60s',      icon: 'fa-chart-line'             },
    llm_council:          { label: 'LLM Council',         desc: '3 Ollama vote (2/3)',         freq: 'event',    icon: 'fa-brain'                  },
    execution:            { label: 'Execution Agent',     desc: 'IBeam REST orders',           freq: 'event',    icon: 'fa-paper-plane'            },
    portfolio_rebalancer: { label: 'Rebalancer',          desc: 'Drift > 2% trigger',          freq: '4h',       icon: 'fa-rotate'                 },
    history_learner:      { label: 'History Learner',     desc: '90-day trade analysis',       freq: '02:00 UTC',icon: 'fa-clock-rotate-left'      },
    model_trainer:        { label: 'Model Trainer',       desc: 'XGB 252-day retraining',      freq: '07:00 UTC',icon: 'fa-dumbbell'               },
    dashboard_sync:       { label: 'Dashboard Sync',      desc: 'GitHub API batch push',       freq: '60s',      icon: 'fa-cloud-arrow-up'         },
  },

  // ── Version ───────────────────────────────────────────────
  VERSION: 'v5.0.9',
  BUILD:   '2026-04-25',
};

// Freeze pour éviter les mutations accidentelles
Object.freeze(AV_CONFIG.REFRESH);
Object.freeze(AV_CONFIG.THRESHOLDS);
Object.freeze(AV_CONFIG.REGIME_COLORS);
Object.freeze(AV_CONFIG.ACTION_COLORS);
Object.freeze(AV_CONFIG.ACCOUNT);

window.AV_CONFIG = AV_CONFIG;
console.log(`[av-config] AlphaVault Quant ${AV_CONFIG.VERSION} — Config loaded`);