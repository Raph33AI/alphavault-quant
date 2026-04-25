// ============================================================
// av-config.js — AlphaVault Quant Dashboard v1.0
// Configuration centrale — charger EN PREMIER dans chaque page
// ============================================================

const AV_CONFIG = {

  // ── Sources de données ──────────────────────────────────
  GITHUB_BASE: 'https://raph33ai.github.io/alphavault-quant/signals',
  DASHBOARD_API: 'http://localhost:5002',  // SSH tunnel requis
  WORKERS: {
    financeHub:   'https://finance-hub-api.raphnardone.workers.dev',
    geminiProxy:  'https://gemini-ai-proxy.raphnardone.workers.dev',
    economicData: 'https://economic-data-worker.raphnardone.workers.dev',
    ghProxy:      'https://alphavault-gh-proxy.raphnardone.workers.dev',
    yahooProxy:   'https://yahoo-proxy.raphnardone.workers.dev',
  },

  // ── Intervalles de refresh (ms) ─────────────────────────
  REFRESH: {
    portfolio:  30_000,
    signals:    60_000,
    agents:     30_000,
    regime:     60_000,
    history:    60_000,
    execution:  30_000,
    static:    300_000,
  },

  // ── Seuils ───────────────────────────────────────────────
  THRESHOLDS: {
    buyConf:     0.35,
    sellConf:    0.40,
    highConf:    0.75,
    maxLeverage: 1.0,
    maxDrawdown: 0.15,
    maxCorr:     0.70,
  },

  // ── Couleurs régime ──────────────────────────────────────
  REGIME_COLORS: {
    BULL:    { bg: '#10b981', text: '#fff', border: '#059669', soft: 'rgba(16,185,129,0.12)' },
    BEAR:    { bg: '#ef4444', text: '#fff', border: '#dc2626', soft: 'rgba(239,68,68,0.12)' },
    NEUTRAL: { bg: '#6b7280', text: '#fff', border: '#4b5563', soft: 'rgba(107,114,128,0.12)' },
    CRISIS:  { bg: '#7c3aed', text: '#fff', border: '#6d28d9', soft: 'rgba(124,58,237,0.12)' },
  },

  // ── Couleurs action ──────────────────────────────────────
  ACTION_COLORS: {
    BUY:  { bg: '#10b981', soft: 'rgba(16,185,129,0.12)',  text: '#10b981' },
    SELL: { bg: '#ef4444', soft: 'rgba(239,68,68,0.12)',   text: '#ef4444' },
    HOLD: { bg: '#6b7280', soft: 'rgba(107,114,128,0.12)', text: '#6b7280' },
  },

  // ── Comptes IBKR ─────────────────────────────────────────
  ACCOUNT: {
    paper: 'DUM895161',
    live:  'U21160314',
  },

  // ── Champs portfolio (R1) ────────────────────────────────
  PORTFOLIO: {
    netliqField:   'net_liq',
    cashField:     'cash',
    leverageField: 'leverage',
    pnlField:      'unrealized_pnl',
    posField:      'positions',
  },
};

// ── URLs des 21 fichiers JSON ─────────────────────────────
const _BASE = AV_CONFIG.GITHUB_BASE;
AV_CONFIG.SIGNAL_URLS = {
  portfolio:   `${_BASE}/portfolio.json`,
  signals:     `${_BASE}/current_signals.json`,
  regime:      `${_BASE}/regime.json`,
  risk:        `${_BASE}/risk_metrics.json`,
  health:      `${_BASE}/agent_health.json`,
  execution:   `${_BASE}/execution_status.json`,
  ibkr:        `${_BASE}/ibkr_status.json`,
  mode:        `${_BASE}/execution_mode.json`,
  orders:      `${_BASE}/pending_orders.json`,
  pnl:         `${_BASE}/pnl_monitor.json`,
  history:     `${_BASE}/rolling_history.json`,
  performance: `${_BASE}/performance_metrics.json`,
  allocation:  `${_BASE}/capital_allocation.json`,
  model:       `${_BASE}/model_report.json`,
  decisions:   `${_BASE}/agent_decisions.json`,
  weights:     `${_BASE}/strategy_weights.json`,
  llm:         `${_BASE}/llm_stats.json`,
  sentiment:   `${_BASE}/sentiment_scores.json`,
  insights:    `${_BASE}/learning_insights.json`,
  rebalancer:  `${_BASE}/rebalancer_status.json`,
  system:      `${_BASE}/system_status.json`,
};

// ── Descriptions des 13 agents ───────────────────────────
AV_CONFIG.AGENT_DESCRIPTIONS = {
  market_scanner:       'OHLCV 907 symbols / 5min',
  signal:               'XGB+LGB+Meta signals / 5min',
  regime_detector:      'BULL/BEAR SPY / 15min',
  sentiment:            'FinBERT news / 30min',
  capital_allocator:    'Kelly+RP event-driven',
  risk_manager:         'VaR+DD+Corr / 5min',
  pnl_monitor:          'Exit rules / 60s',
  llm_council:          '3 Ollama vote / event',
  execution:            'IBeam REST / event',
  portfolio_rebalancer: 'drift>2% / 4h',
  history_learner:      '90d trades / 02:00 UTC',
  model_trainer:        'XGB 252d / 07:00 UTC',
  dashboard_sync:       'GitHub API / 60s',
};

window.AV_CONFIG = AV_CONFIG;
console.log('[av-config] v1.0 loaded — AlphaVault Quant Dashboard');