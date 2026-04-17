// ============================================================
// ALPHAVAULT QUANT — API Client (Dashboard)
// Lit les fichiers JSON depuis /signals/ sur GitHub Pages
// ============================================================

const ApiClient = (() => {

  // Base URL : adaptation automatique local vs GitHub Pages
  const BASE = (() => {
    const loc = window.location.href;
    if (loc.includes('github.io') || loc.includes('alphavault')) {
      // GitHub Pages — les signaux sont à la racine du repo
      return '../signals';
    }
    // Développement local
    return '../signals';
  })();

  const CACHE = {};
  const CACHE_TTL = 30_000; // 30 secondes

  async function fetchJSON(filename, bustCache = false) {
    const url       = `${BASE}/${filename}`;
    const cacheKey  = filename;
    const now       = Date.now();

    if (!bustCache && CACHE[cacheKey] && (now - CACHE[cacheKey].ts) < CACHE_TTL) {
      return CACHE[cacheKey].data;
    }

    try {
      const resp = await fetch(`${url}?t=${now}`, {
        cache: 'no-store',
        headers: { 'Accept': 'application/json' },
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const data = await resp.json();
      CACHE[cacheKey] = { data, ts: now };
      return data;

    } catch (err) {
      console.warn(`ApiClient: Failed to fetch ${filename}:`, err.message);
      // Retourne le cache périmé si disponible
      return CACHE[cacheKey]?.data || null;
    }
  }

  // ── Endpoints ──────────────────────────────────────────
  return {
    getSignals:      () => fetchJSON('current_signals.json'),
    getPortfolio:    () => fetchJSON('portfolio.json'),
    getRisk:         () => fetchJSON('risk_metrics.json'),
    getRegime:       () => fetchJSON('regime.json'),
    getAgents:       () => fetchJSON('agent_decisions.json'),
    getStrategy:     () => fetchJSON('strategy_weights.json'),
    getPerformance:  () => fetchJSON('performance_metrics.json'),
    getSystemStatus: () => fetchJSON('system_status.json'),

    fetchAll: async (bust = false) => {
      const [signals, portfolio, risk, regime, agents, strategy, perf, status] =
        await Promise.all([
          fetchJSON('current_signals.json',    bust),
          fetchJSON('portfolio.json',          bust),
          fetchJSON('risk_metrics.json',       bust),
          fetchJSON('regime.json',             bust),
          fetchJSON('agent_decisions.json',    bust),
          fetchJSON('strategy_weights.json',   bust),
          fetchJSON('performance_metrics.json',bust),
          fetchJSON('system_status.json',      bust),
        ]);
      return { signals, portfolio, risk, regime, agents, strategy, perf, status };
    },
  };
})();