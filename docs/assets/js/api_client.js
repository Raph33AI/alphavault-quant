// ============================================================
// api_client.js — AlphaVault Quant v3.1
// ✅ Auto-détection GitHub Pages / local / custom domain
// ✅ NaN-safe JSON parsing (NaN/Infinity → null avant parse)
// ✅ Cache intelligent 45s avec stale fallback
// ✅ portfolio.json — vraies positions IBKR Paper/Live
// ✅ ibkr_status.json — champs enrichis v3.4 (trading_mode, aliases)
// ============================================================

const ApiClient = (() => {

  // ── Base URL Auto-Detect ─────────────────────────────────
  const BASE = (() => {
    const { hostname, pathname } = window.location;
    if (hostname.includes('github.io')) {
      const parts    = pathname.split('/').filter(Boolean);
      const repoName = parts[0] || '';
      const base     = repoName ? `/${repoName}/signals` : '/signals';
      console.log(`📡 GitHub Pages mode | BASE: ${base}`);
      return base;
    }
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      console.log('📡 Local dev mode | BASE: ../signals');
      return '../signals';
    }
    console.log('📡 Custom domain mode | BASE: /signals');
    return '/signals';
  })();

  // ── Cache ────────────────────────────────────────────────
  const CACHE     = new Map();
  const CACHE_TTL = 45_000;

  // ── NaN-safe JSON parser ─────────────────────────────────
  // Python json.dumps écrit NaN/Infinity qui sont invalides en JSON standard.
  // Cette fonction nettoie le texte brut avant JSON.parse().
  function _parseJSON(text) {
    try {
      // Remplace NaN, Infinity, -Infinity par null (valide en JSON)
      const cleaned = text
        .replace(/:\s*NaN/g,       ': null')
        .replace(/:\s*Infinity/g,  ': null')
        .replace(/:\s*-Infinity/g, ': null');
      return JSON.parse(cleaned);
    } catch (e) {
      // Si le nettoyage ne suffit pas → erreur claire sans boucle
      throw new Error(`JSON parse failed: ${e.message}`);
    }
  }

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
        regime_label:     'initializing',
        regime_score:     0,
        confidence:       0,
        allow_long:       false,
        allow_short:      false,
        reduce_exposure:  true,
        leverage_allowed: false,
        favor_options:    false,
        probabilities:    {},
      },
      macro:      {},
      per_symbol: {},
    },
    'portfolio.json': {
      // Valeurs par défaut — remplacées par les vraies positions IBKR (ibkr_watcher v3.4)
      account:        'DUM895161',
      trading_mode:   'paper',
      total_value:    100000,
      cash_value:     100000,
      cash_pct:       1.0,
      buying_power:   100000,
      unrealized_pnl: 0,
      realized_pnl:   0,
      n_positions:    0,
      weights:        {},
      positions:      {},
      timestamp:      null,
      source:         'default',
    },
    'risk_metrics.json': {
      drawdown: {
        current_drawdown: 0,
        halt_active:      false,
        daily_pnl_pct:    0,
        hit_daily_limit:  false,
      },
      leverage: {
        current_leverage:  0,
        allowed_leverage:  1.5,
        is_over_leveraged: false,
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
      // NaN remplacé par null au parse — valeurs null affichées comme "--" dans l'UI
      portfolio_value: 100000,
      n_signals:       0,
      n_executions:    0,
      llm_mode:        'deterministic',
      strategy_perf:   {},
      models:          [],
      ensemble:        { weights: {}, ensemble_auc: null, walk_forward_auc: null },
      timestamp:       null,
    },
    'manual_order_result.json': {
      timestamp:    null,
      last_order:   null,
      total_manual: 0,
      history:      [],
    },
    'ibkr_status.json': {
      // Champs normalisés — watcher v3.4 écrit tous ces champs
      ibkr_connected:  false,
      authenticated:   false,
      account:         'DUM895161',
      trading_mode:    'paper',   // clé principale
      mode:            'paper',   // alias rétro-compat
      paper_trading:   true,
      paper_account:   'DUM895161',
      live_account:    'U21160314',
      net_liquidation: 0,
      available_funds: 0,
      unrealized_pnl:  0,
      buying_power:    0,
      orders_executed: 0,
      orders_failed:   0,
      timestamp:       null,
      watcher_version: '3.4',
      error:           null,
    },
    'debug_log.json': {
      timestamp: null,
      total:     0,
      logs:      [],
    },
    'performance_history.json': {
      cycles:   [],
      n_cycles: 0,
      metrics:  { avg_accuracy: 0, win_rate: 0, rolling_sharpe: 0, n_cycles: 0 },
    },
    'alerts.json': { total: 0, alerts: [] },
  };

  // ── Core Fetch ───────────────────────────────────────────
  async function fetchJSON(filename, bustCache = false) {
    const key = filename;
    const now = Date.now();
    const hit = CACHE.get(key);

    // Cache frais
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

      // ✅ NaN-safe : text() → clean → JSON.parse (jamais resp.json() direct)
      const text = await resp.text();
      const data = _parseJSON(text);

      CACHE.set(key, { data, ts: now });
      return data;

    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn(`⚠ ApiClient: ${filename} → ${err.message}`);
      }
      // Stale cache si disponible
      if (hit?.data) {
        return hit.data;
      }
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
    if (filename) CACHE.delete(filename);
    else          CACHE.clear();
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

  // ── Public API ───────────────────────────────────────────
  return {
    fetchAll,
    fetchJSON,

    // Endpoints individuels
    getSignals:      (b) => fetchJSON('current_signals.json',     b),
    getPortfolio:    (b) => fetchJSON('portfolio.json',           b),
    getRisk:         (b) => fetchJSON('risk_metrics.json',        b),
    getRegime:       (b) => fetchJSON('regime.json',              b),
    getAgents:       (b) => fetchJSON('agent_decisions.json',     b),
    getStrategy:     (b) => fetchJSON('strategy_weights.json',    b),
    getPerformance:  (b) => fetchJSON('performance_metrics.json', b),
    getSystemStatus: (b) => fetchJSON('system_status.json',       b),

    // Endpoints extra
    getManualOrders:      (b) => fetchJSON('manual_order_result.json',  b),
    getIBKRStatus:        (b) => fetchJSON('ibkr_status.json',          b),
    getDebugLog:          (b) => fetchJSON('debug_log.json',            b),
    getPerformanceHistory:(b) => fetchJSON('performance_history.json',  b),
    getAlerts:            (b) => fetchJSON('alerts.json',               b),

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