// ============================================================
// av-api.js — AlphaVault Quant Dashboard v1.0
// Couche données : fetch + cache LRU + refresh automatique
// Expose : window.AVApi
// Dépend de : av-config.js, av-utils.js
// ============================================================

const AVApi = (() => {

  // ── Cache LRU ─────────────────────────────────────────────
  const _cache     = new Map();   // url → {data, ts, url}
  const MAX_CACHE  = 50;
  const _intervals = [];
  const _callbacks = new Map();   // key → [fn, fn, ...]

  // ── État global des données ───────────────────────────────
  const _state = {};              // key → data (dernière valeur connue)

  // ══════════════════════════════════════════════════════════
  // FETCH JSON avec cache + retry + timeout
  // ══════════════════════════════════════════════════════════

  async function fetchJSON(url, maxAge = 30_000, retries = 3) {
    // Vérifie cache
    const cached = _cache.get(url);
    if (cached && (Date.now() - cached.ts) < maxAge) return cached.data;

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const ctrl = new AbortController();
        const timeout = setTimeout(() => ctrl.abort(), 10_000);
        const resp = await fetch(`${url}?_=${Date.now()}`, {
          signal: ctrl.signal,
          cache:  'no-store',
        });
        clearTimeout(timeout);

        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        // Mise en cache LRU
        if (_cache.size >= MAX_CACHE) {
          const firstKey = _cache.keys().next().value;
          _cache.delete(firstKey);
        }
        _cache.set(url, { data, ts: Date.now(), url });
        return data;

      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') break;
        if (attempt < retries) await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
      }
    }

    console.warn(`[AVApi] fetchJSON failed: ${url}`, lastErr?.message);
    // Retourne données en cache périmées si disponibles (fallback R9)
    return _cache.get(url)?.data ?? null;
  }

  // ══════════════════════════════════════════════════════════
  // LOAD ALL — 21 JSONs en parallèle
  // ══════════════════════════════════════════════════════════

  async function loadAll() {
    const urls    = AV_CONFIG.SIGNAL_URLS;
    const keys    = Object.keys(urls);
    const results = await Promise.allSettled(
      keys.map(k => fetchJSON(urls[k], 0))
    );

    const out = {};
    keys.forEach((k, i) => {
      out[k] = results[i].status === 'fulfilled' ? results[i].value : null;
      _state[k] = out[k];
    });
    return out;
  }

  // ── Charge un seul fichier et met à jour l'état ───────────
  async function loadOne(key, forceRefresh = false) {
    const url = AV_CONFIG.SIGNAL_URLS[key];
    if (!url) return null;
    const maxAge = forceRefresh ? 0 : AV_CONFIG.REFRESH[_keyToRefreshGroup(key)] || 60_000;
    const data = await fetchJSON(url, maxAge);
    _state[key] = data;
    _notifyCallbacks(key, data);
    return data;
  }

  function _keyToRefreshGroup(key) {
    const map = {
      portfolio: 'portfolio', risk: 'portfolio',
      signals:   'signals',
      health:    'agents',
      regime:    'regime',
      history:   'history',
      execution: 'execution', ibkr: 'execution', mode: 'execution',
      model:     'static', llm: 'static', sentiment: 'static',
      insights:  'static', rebalancer: 'static',
      pnl:       'history', system: 'regime',
      weights:   'static', decisions: 'static',
      orders:    'execution', allocation: 'signals',
      performance: 'signals',
    };
    return map[key] || 'signals';
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH
  // ══════════════════════════════════════════════════════════

  function startAutoRefresh(refreshMap) {
    // refreshMap: { key: intervalMs } ou utilise AV_CONFIG.REFRESH par défaut
    const defaults = {
      portfolio: AV_CONFIG.REFRESH.portfolio,
      risk:      AV_CONFIG.REFRESH.portfolio,
      signals:   AV_CONFIG.REFRESH.signals,
      health:    AV_CONFIG.REFRESH.agents,
      regime:    AV_CONFIG.REFRESH.regime,
      history:   AV_CONFIG.REFRESH.history,
      execution: AV_CONFIG.REFRESH.execution,
      ibkr:      AV_CONFIG.REFRESH.execution,
      mode:      AV_CONFIG.REFRESH.execution,
      pnl:       AV_CONFIG.REFRESH.history,
      system:    AV_CONFIG.REFRESH.regime,
    };
    const map = refreshMap || defaults;
    Object.entries(map).forEach(([key, ms]) => {
      const id = setInterval(() => loadOne(key, true), ms);
      _intervals.push(id);
    });
  }

  function stopAutoRefresh() {
    _intervals.forEach(id => clearInterval(id));
    _intervals.length = 0;
  }

  // ══════════════════════════════════════════════════════════
  // CALLBACK / SUBSCRIPTION
  // ══════════════════════════════════════════════════════════

  function on(key, fn) {
    if (!_callbacks.has(key)) _callbacks.set(key, []);
    _callbacks.get(key).push(fn);
    // Appelle immédiatement si données déjà disponibles
    if (_state[key]) fn(_state[key]);
  }

  function off(key, fn) {
    if (!_callbacks.has(key)) return;
    const arr = _callbacks.get(key).filter(f => f !== fn);
    _callbacks.set(key, arr);
  }

  function _notifyCallbacks(key, data) {
    (_callbacks.get(key) || []).forEach(fn => { try { fn(data); } catch(e) {} });
    // Notifie aussi 'all' listeners
    (_callbacks.get('all') || []).forEach(fn => { try { fn(key, data); } catch(e) {} });
  }

  // ══════════════════════════════════════════════════════════
  // DASHBOARD API (:5002) — SSH tunnel
  // ══════════════════════════════════════════════════════════

  let _apiAvailable = null;  // null=unknown, true/false

  async function checkDashboardAPI() {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3_000);
      const resp = await fetch(`${AV_CONFIG.DASHBOARD_API}/health`, {
        signal: ctrl.signal, cache: 'no-store',
      });
      clearTimeout(t);
      _apiAvailable = resp.ok;
    } catch {
      _apiAvailable = false;
    }
    return _apiAvailable;
  }

  async function callDashboardAPI(endpoint, options = {}) {
    if (_apiAvailable === false) {
      return { error: 'Dashboard API unavailable — SSH tunnel required', ssh: true };
    }
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8_000);
      const resp = await fetch(`${AV_CONFIG.DASHBOARD_API}${endpoint}`, {
        ...options,
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = await resp.json();
      _apiAvailable = true;
      return data;
    } catch (err) {
      _apiAvailable = false;
      return { error: err.message, ssh: true };
    }
  }

  // ══════════════════════════════════════════════════════════
  // GETTERS
  // ══════════════════════════════════════════════════════════

  function getCached(key) { return _state[key] ?? null; }
  function getAll()       { return { ..._state }; }
  function isApiAvailable() { return _apiAvailable; }

  // R1 — Toujours utiliser portfolio.json pour NetLiq
  function getNetLiq() {
    return AVUtils.netliqFromPortfolio(_state.portfolio);
  }

  function getRegime() {
    const r = _state.regime;
    if (!r) return { regime: 'NEUTRAL', confidence: 0, probabilities: {} };
    return {
      regime:     r.regime || r.signal || r.current_regime || 'NEUTRAL',
      confidence: parseFloat(r.confidence || 0),
      probabilities: r.probabilities || {},
      indicators: r.indicators || {},
      thresholds: r.signal_thresholds || {},
    };
  }

  function getAgentHealth() {
    return _state.health || { n_agents: 13, n_active: 0, n_errors: 0, agents: {} };
  }

  function getTopBuySignals(limit = 10) {
    const data = _state.signals;
    if (!data?.signals) return [];
    const sigs = Array.isArray(data.signals) ? data.signals : [];
    return sigs
      .filter(s => (s.action || '').toUpperCase() === 'BUY')
      .sort((a, b) => parseFloat(b.confidence || 0) - parseFloat(a.confidence || 0))
      .slice(0, limit);
  }

  function getNavHistory() {
    const hist = _state.history?.history || [];
    const portfolioNetliq = getNetLiq();

    // Filtre les points avec netliq valide
    const valid = hist
      .filter(p => {
        const v = parseFloat(p.netliq ?? p.net_liq ?? 0);
        return v > 0;
      })
      .map(p => ({
        time:       Math.floor(new Date(p.ts || p.label || Date.now()).getTime() / 1000),
        value:      parseFloat(p.netliq ?? p.net_liq),
        leverage:   parseFloat(p.leverage || 0),
        regime:     p.regime || 'NEUTRAL',
        total_pnl:  parseFloat(p.total_pnl || 0),
        n_positions:parseInt(p.n_positions || 0),
      }))
      .sort((a, b) => a.time - b.time);

    // Ajoute le point actuel si différent du dernier
    if (portfolioNetliq && valid.length > 0) {
      const lastTime = valid[valid.length - 1].time;
      const nowTime  = Math.floor(Date.now() / 1000);
      if (nowTime - lastTime > 60) {
        valid.push({
          time: nowTime, value: portfolioNetliq,
          leverage: parseFloat(AVUtils.safeGet(_state.risk, 'leverage.current_leverage', 0)),
          regime: getRegime().regime,
          total_pnl: parseFloat(AVUtils.safeGet(_state.portfolio, 'unrealized_pnl', 0)),
          n_positions: parseInt(AVUtils.safeGet(_state.portfolio, 'positions_count', 0)),
        });
      }
    }

    return valid;
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    fetchJSON,
    loadAll,
    loadOne,
    startAutoRefresh,
    stopAutoRefresh,
    on,
    off,
    checkDashboardAPI,
    callDashboardAPI,
    getCached,
    getAll,
    isApiAvailable,
    getNetLiq,
    getRegime,
    getAgentHealth,
    getTopBuySignals,
    getNavHistory,
    URLS: AV_CONFIG.SIGNAL_URLS,
  };

})();

window.AVApi = AVApi;
console.log('[av-api] v1.0 loaded');