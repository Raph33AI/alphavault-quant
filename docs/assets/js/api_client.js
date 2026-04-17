// ============================================================
// ALPHAVAULT QUANT — API Client v3
// ✅ Lit depuis docs/signals/ (servi par GitHub Pages)
// ✅ Auto-détection GitHub Pages vs local
// ============================================================

const ApiClient = (() => {

  // ── Détection du BASE URL ──────────────────────────────
  const BASE = (() => {
    const { hostname, pathname } = window.location;

    // GitHub Pages : ex https://raph33ai.github.io/alphavault-quant/
    if (hostname.includes('github.io')) {
      // Extrait le nom du repo depuis le pathname
      // pathname = "/alphavault-quant/" → repoName = "alphavault-quant"
      const parts    = pathname.split('/').filter(Boolean);
      const repoName = parts[0] || '';
      const base     = repoName ? `/${repoName}/signals` : '/signals';
      console.log(`📡 GitHub Pages mode | BASE: ${base}`);
      return base;
    }

    // Développement local (Live Server, Python HTTP, etc.)
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.log('📡 Local mode | BASE: ../signals');
      return '../signals';
    }

    // Domaine custom
    console.log('📡 Custom domain mode | BASE: /signals');
    return '/signals';
  })();

  const CACHE     = new Map();
  const CACHE_TTL = 45_000; // 45 secondes

  // ── Fetch avec cache et fallback ──────────────────────
  async function fetchJSON(filename, bustCache = false) {
    const key = filename;
    const now = Date.now();
    const hit = CACHE.get(key);

    if (!bustCache && hit && (now - hit.ts) < CACHE_TTL) {
      return hit.data;
    }

    const url = `${BASE}/${filename}?_=${now}`;

    try {
      const resp = await fetch(url, {
        method:  'GET',
        cache:   'no-store',
        headers: { 'Accept': 'application/json' },
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} — ${url}`);
      }

      const data = await resp.json();
      CACHE.set(key, { data, ts: now });
      return data;

    } catch (err) {
      console.warn(`⚠ ApiClient fetch failed: ${filename} → ${err.message}`);
      // Retourne le cache périmé si disponible
      if (hit?.data) {
        console.log(`📦 Returning stale cache for ${filename}`);
        return hit.data;
      }
      return _defaultData(filename);
    }
  }

  // ── Données par défaut (évite les crashes UI) ─────────
  function _defaultData(filename) {
    const defaults = {
      'current_signals.json':    {
        timestamp: null, signals: {}, session: 'closed',
        llm_mode: 'deterministic', dry_run: true,
      },
      'system_status.json': {
        overall: 'initializing', llm_available: false,
        workers: {}, mode: 'deterministic', session: 'closed', dry_run: true,
      },
      'regime.json': {
        global: {
          regime_label: 'initializing', regime_score: 0,
          confidence: 0, allow_long: false, allow_short: false,
          reduce_exposure: true, probabilities: {},
        },
        macro: {}, per_symbol: {},
      },
      'portfolio.json': {
        total_value: 100000, weights: {}, positions: {}, cash_pct: 1.0,
      },
      'risk_metrics.json': {
        drawdown: { current_drawdown: 0, halt_active: false, daily_pnl_pct: 0 },
        leverage: { current_leverage: 0, allowed_leverage: 1.5, is_over_leveraged: false },
        var_metrics: {},
      },
      'agent_decisions.json': { decisions: {}, executions: [] },
      'strategy_weights.json': {
        weights: {
          trend: 0.40, mean_reversion: 0.25,
          vol_carry: 0.20, options_convexity: 0.15,
        },
        regime: 'initializing',
      },
      'performance_metrics.json': {
        portfolio_value: 100000, n_signals: 0,
        n_executions: 0, llm_mode: 'deterministic',
      },
    };
    return defaults[filename] || {};
  }

  // ── API publique ──────────────────────────────────────
  return {
    getSignals:      (b) => fetchJSON('current_signals.json', b),
    getPortfolio:    (b) => fetchJSON('portfolio.json', b),
    getRisk:         (b) => fetchJSON('risk_metrics.json', b),
    getRegime:       (b) => fetchJSON('regime.json', b),
    getAgents:       (b) => fetchJSON('agent_decisions.json', b),
    getStrategy:     (b) => fetchJSON('strategy_weights.json', b),
    getPerformance:  (b) => fetchJSON('performance_metrics.json', b),
    getSystemStatus: (b) => fetchJSON('system_status.json', b),

    fetchAll: async (bust = false) => {
      const results = await Promise.allSettled([
        fetchJSON('current_signals.json',    bust),
        fetchJSON('portfolio.json',          bust),
        fetchJSON('risk_metrics.json',       bust),
        fetchJSON('regime.json',             bust),
        fetchJSON('agent_decisions.json',    bust),
        fetchJSON('strategy_weights.json',   bust),
        fetchJSON('performance_metrics.json',bust),
        fetchJSON('system_status.json',      bust),
      ]);

      const [signals, portfolio, risk, regime, agents, strategy, perf, status] = results;
      return {
        signals:   signals.value   ?? _defaultData('current_signals.json'),
        portfolio: portfolio.value ?? _defaultData('portfolio.json'),
        risk:      risk.value      ?? _defaultData('risk_metrics.json'),
        regime:    regime.value    ?? _defaultData('regime.json'),
        agents:    agents.value    ?? _defaultData('agent_decisions.json'),
        strategy:  strategy.value  ?? _defaultData('strategy_weights.json'),
        perf:      perf.value      ?? _defaultData('performance_metrics.json'),
        status:    status.value    ?? _defaultData('system_status.json'),
      };
    },

    getBase: () => BASE,
  };
})();