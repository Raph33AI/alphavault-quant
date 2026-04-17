// ============================================================
// ALPHAVAULT QUANT — API Client v2
// Lit les JSON depuis docs/signals/ (copié par le workflow)
// Compatible GitHub Pages + développement local
// ============================================================

const ApiClient = (() => {

  // Détection automatique de l'environnement
  const BASE = (() => {
    const isGHPages = window.location.hostname.includes('github.io');
    const isLocal   = window.location.hostname === 'localhost' ||
                      window.location.hostname === '127.0.0.1';

    if (isGHPages) {
      // GitHub Pages : les signaux sont dans docs/signals/
      const repoName = window.location.pathname.split('/')[1];
      return repoName ? `/${repoName}/signals` : '/signals';
    }
    if (isLocal) {
      return '../signals';  // développement local
    }
    return './signals';
  })();

  console.log(`📡 ApiClient initialized | BASE: ${BASE}`);

  const CACHE = new Map();
  const CACHE_TTL = 45_000; // 45 secondes

  async function fetchJSON(filename, bustCache = false) {
    const cacheKey = filename;
    const now      = Date.now();
    const cached   = CACHE.get(cacheKey);

    if (!bustCache && cached && (now - cached.ts) < CACHE_TTL) {
      return cached.data;
    }

    const url = `${BASE}/${filename}?_=${now}`;
    try {
      const resp = await fetch(url, {
        method:  'GET',
        cache:   'no-store',
        headers: { 'Accept': 'application/json' },
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status} on ${url}`);

      const data = await resp.json();
      CACHE.set(cacheKey, { data, ts: now });
      return data;

    } catch (err) {
      console.warn(`⚠ ApiClient: ${filename} → ${err.message}`);
      // Retourne le cache périmé plutôt qu'une erreur
      return cached?.data || getDefaultData(filename);
    }
  }

  // Données par défaut si fichier absent
  function getDefaultData(filename) {
    const defaults = {
      'current_signals.json':    { timestamp: null, signals: {}, session: 'closed', llm_mode: 'deterministic', dry_run: true },
      'system_status.json':      { overall: 'initializing', llm_available: false, workers: {}, mode: 'deterministic', session: 'closed' },
      'regime.json':             { global: { regime_label: 'initializing', regime_score: 0, confidence: 0 }, macro: {}, per_symbol: {} },
      'portfolio.json':          { total_value: 100000, weights: {}, positions: {}, cash_pct: 1.0 },
      'risk_metrics.json':       { drawdown: { current_drawdown: 0 }, leverage: { current_leverage: 0, allowed_leverage: 1.5 } },
      'agent_decisions.json':    { decisions: {}, executions: [] },
      'strategy_weights.json':   { weights: { trend: 0.40, mean_reversion: 0.25, vol_carry: 0.20, options_convexity: 0.15 } },
      'performance_metrics.json':{ portfolio_value: 100000, n_signals: 0, n_executions: 0 },
    };
    return defaults[filename] || {};
  }

  return {
    getSignals:       (b) => fetchJSON('current_signals.json', b),
    getPortfolio:     (b) => fetchJSON('portfolio.json', b),
    getRisk:          (b) => fetchJSON('risk_metrics.json', b),
    getRegime:        (b) => fetchJSON('regime.json', b),
    getAgents:        (b) => fetchJSON('agent_decisions.json', b),
    getStrategy:      (b) => fetchJSON('strategy_weights.json', b),
    getPerformance:   (b) => fetchJSON('performance_metrics.json', b),
    getSystemStatus:  (b) => fetchJSON('system_status.json', b),

    fetchAll: async (bust = false) => {
      const [signals, portfolio, risk, regime, agents, strategy, perf, status] =
        await Promise.allSettled([
          fetchJSON('current_signals.json',    bust),
          fetchJSON('portfolio.json',          bust),
          fetchJSON('risk_metrics.json',       bust),
          fetchJSON('regime.json',             bust),
          fetchJSON('agent_decisions.json',    bust),
          fetchJSON('strategy_weights.json',   bust),
          fetchJSON('performance_metrics.json',bust),
          fetchJSON('system_status.json',      bust),
        ]);

      return {
        signals:   signals.value   || getDefaultData('current_signals.json'),
        portfolio: portfolio.value || getDefaultData('portfolio.json'),
        risk:      risk.value      || getDefaultData('risk_metrics.json'),
        regime:    regime.value    || getDefaultData('regime.json'),
        agents:    agents.value    || getDefaultData('agent_decisions.json'),
        strategy:  strategy.value  || getDefaultData('strategy_weights.json'),
        perf:      perf.value      || getDefaultData('performance_metrics.json'),
        status:    status.value    || getDefaultData('system_status.json'),
      };
    },
  };
})();