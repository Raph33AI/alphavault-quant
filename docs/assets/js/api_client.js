// ============================================================
// api_client.js — AlphaVault Quant v3.0
// ✅ Auto-détection GitHub Pages / local / custom domain
// ✅ Cache intelligent 45s avec stale fallback
// ✅ fetchJSON exposé publiquement pour exec log
// ✅ Parallel fetch optimisé
// ============================================================

const ApiClient = (() => {

  // ── Base URL Auto-Detect ─────────────────────────────────
  const BASE = (() => {
    const { hostname, pathname } = window.location;

    // GitHub Pages: https://raph33ai.github.io/alphavault-quant/
    if (hostname.includes('github.io')) {
      const parts    = pathname.split('/').filter(Boolean);
      const repoName = parts[0] || '';
      const base     = repoName ? `/${repoName}/signals` : '/signals';
      console.log(`📡 GitHub Pages mode | BASE: ${base}`);
      return base;
    }

    // Local dev
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.log('📡 Local dev mode | BASE: ../signals');
      return '../signals';
    }

    // Custom domain (alphavault-ai.com etc.)
    console.log('📡 Custom domain mode | BASE: /signals');
    return '/signals';
  })();

  // ── Cache ────────────────────────────────────────────────
  const CACHE     = new Map();
  const CACHE_TTL = 45_000; // 45 secondes

  // ── Default Data ─────────────────────────────────────────
  const DEFAULTS = {
    'current_signals.json': {
      timestamp: null,
      session:   'closed',
      llm_mode:  'deterministic',
      dry_run:   false,
      signals:   {},
    },
    'system_status.json': {
      overall:       'initializing',
      llm_available: false,
      workers:       {},
      mode:          'deterministic',
      session:       'closed',
      dry_run:       false,
      timestamp:     null,
    },
    'regime.json': {
      global: {
        regime_label:      'initializing',
        regime_score:      0,
        confidence:        0,
        allow_long:        false,
        allow_short:       false,
        reduce_exposure:   true,
        leverage_allowed:  false,
        favor_options:     false,
        probabilities:     {},
      },
      macro:      {},
      per_symbol: {},
    },
    'portfolio.json': {
      total_value: 100000,
      weights:     {},
      positions:   {},
      cash_pct:    1.0,
      timestamp:   null,
    },
    'risk_metrics.json': {
      drawdown: {
        current_drawdown: 0,
        halt_active:      false,
        daily_pnl_pct:    0,
        hit_daily_limit:  false,
      },
      leverage: {
        current_leverage:   0,
        allowed_leverage:   1.5,
        is_over_leveraged:  false,
      },
      var_metrics: {},
      timestamp:   null,
    },
    'agent_decisions.json': {
      decisions:   {},
      executions:  [],
      timestamp:   null,
    },
    'strategy_weights.json': {
      weights: {
        trend:             0.40,
        mean_reversion:    0.25,
        vol_carry:         0.20,
        options_convexity: 0.15,
      },
      regime:    'initializing',
      timestamp: null,
    },
    'performance_metrics.json': {
      portfolio_value: 100000,
      n_signals:       0,
      n_executions:    0,
      llm_mode:        'deterministic',
      strategy_perf:   {},
      timestamp:       null,
    },
    'manual_order_result.json': {
      timestamp:    null,
      last_order:   null,
      total_manual: 0,
      history:      [],
    },
    'ibkr_status.json': {
      reachable:   false,
      mode:        'paper',
      latency_ms:  null,
      timestamp:   null,
      error:       'Not yet checked',
    },
    'debug_log.json': {
      timestamp: null,
      total:     0,
      logs:      [],
    },
  };

  // ── Core Fetch ───────────────────────────────────────────
  async function fetchJSON(filename, bustCache = false) {
    const key = filename;
    const now = Date.now();
    const hit = CACHE.get(key);

    // Retourne le cache s'il est frais
    if (!bustCache && hit && (now - hit.ts) < CACHE_TTL) {
      return hit.data;
    }

    const url = `${BASE}/${filename}?_=${now}`;

    try {
      const resp = await fetch(url, {
        method:  'GET',
        cache:   'no-store',
        headers: { 'Accept': 'application/json' },
        signal:  AbortSignal.timeout(10_000),
      });

      if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);

      const data = await resp.json();
      CACHE.set(key, { data, ts: now });
      return data;

    } catch (err) {
      // Log discret (pas de spam console)
      if (err.name !== 'AbortError') {
        console.warn(`⚠ ApiClient: ${filename} → ${err.message}`);
      }
      // Retourne le cache périmé si disponible (stale-while-revalidate)
      if (hit?.data) {
        console.log(`📦 Stale cache returned for: ${filename}`);
        return hit.data;
      }
      // Sinon valeur par défaut
      return DEFAULTS[filename] ?? {};
    }
  }

  // ── Fetch All (parallel) ─────────────────────────────────
  async function fetchAll(bust = false) {
    const files = [
      'current_signals.json',
      'portfolio.json',
      'risk_metrics.json',
      'regime.json',
      'agent_decisions.json',
      'strategy_weights.json',
      'performance_metrics.json',
      'system_status.json',
    ];

    const results = await Promise.allSettled(
      files.map(f => fetchJSON(f, bust))
    );

    const [signals, portfolio, risk, regime, agents, strategy, perf, status] = results;

    return {
      signals:   _getValue(signals,   'current_signals.json'),
      portfolio: _getValue(portfolio, 'portfolio.json'),
      risk:      _getValue(risk,      'risk_metrics.json'),
      regime:    _getValue(regime,    'regime.json'),
      agents:    _getValue(agents,    'agent_decisions.json'),
      strategy:  _getValue(strategy,  'strategy_weights.json'),
      perf:      _getValue(perf,      'performance_metrics.json'),
      status:    _getValue(status,    'system_status.json'),
    };
  }

  function _getValue(settled, filename) {
    if (settled.status === 'fulfilled' && settled.value) {
      return settled.value;
    }
    return DEFAULTS[filename] ?? {};
  }

  // ── Cache Management ─────────────────────────────────────
  function clearCache(filename = null) {
    if (filename) {
      CACHE.delete(filename);
    } else {
      CACHE.clear();
    }
  }

  function getCacheAge(filename) {
    const hit = CACHE.get(filename);
    if (!hit) return null;
    return Math.round((Date.now() - hit.ts) / 1000);
  }

  function getCacheStats() {
    const stats = {};
    CACHE.forEach((val, key) => {
      stats[key] = {
        age:   Math.round((Date.now() - val.ts) / 1000) + 's',
        fresh: (Date.now() - val.ts) < CACHE_TTL,
      };
    });
    return stats;
  }

  // ── Getters ──────────────────────────────────────────────
  return {
    // Main fetch methods
    fetchAll,
    fetchJSON,

    // Individual endpoints
    getSignals:      (b) => fetchJSON('current_signals.json',     b),
    getPortfolio:    (b) => fetchJSON('portfolio.json',           b),
    getRisk:         (b) => fetchJSON('risk_metrics.json',        b),
    getRegime:       (b) => fetchJSON('regime.json',              b),
    getAgents:       (b) => fetchJSON('agent_decisions.json',     b),
    getStrategy:     (b) => fetchJSON('strategy_weights.json',    b),
    getPerformance:  (b) => fetchJSON('performance_metrics.json', b),
    getSystemStatus: (b) => fetchJSON('system_status.json',       b),

    // Extra endpoints
    getManualOrders: (b) => fetchJSON('manual_order_result.json', b),
    getIBKRStatus:   (b) => fetchJSON('ibkr_status.json',         b),
    getDebugLog:     (b) => fetchJSON('debug_log.json',           b),

    // Cache utils
    clearCache,
    getCacheAge,
    getCacheStats,

    // Config
    getBase:     () => BASE,
    getCacheTTL: () => CACHE_TTL,
    getDefaults: () => DEFAULTS,
  };

})();

window.ApiClient = ApiClient;
console.log(`✅ ApiClient loaded | BASE: ${ApiClient.getBase()}`);