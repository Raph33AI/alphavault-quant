// ============================================================
// av-api.js — AlphaVault Quant Dashboard v1.0
// Couche données — Cache LRU + Retry + Auto-refresh
// Dépend de : av-config.js, av-utils.js
// ============================================================

const AVApi = (() => {

  // ══════════════════════════════════════════════════════════
  // CACHE LRU
  // ══════════════════════════════════════════════════════════
  const _cache     = new Map();   // url → { data, ts, etag }
  const _intervals = [];          // pour cleanup
  const _listeners = new Map();   // key → [callbacks]

  // ══════════════════════════════════════════════════════════
  // FETCH JSON — Cache + Retry + Timeout (R9)
  // ══════════════════════════════════════════════════════════

  /**
   * Fetch JSON avec cache LRU, retry 3x, timeout 8s
   * @param {string} url
   * @param {number} maxAge   — ms avant expiration cache (0 = force refresh)
   * @param {number} retries  — nombre de tentatives
   */
  async function fetchJSON(url, maxAge = 30_000, retries = 3) {
    // ── Cache hit ───────────────────────────────────────────
    const cached = _cache.get(url);
    if (maxAge > 0 && cached && (Date.now() - cached.ts) < maxAge) {
      return cached.data;
    }

    // ── Fetch avec retry ────────────────────────────────────
    let lastErr;
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout    = setTimeout(() => controller.abort(), 8_000);

        const resp = await fetch(url, {
          signal: controller.signal,
          cache:  'no-store',
          headers: { 'Accept': 'application/json' },
        });

        clearTimeout(timeout);

        if (!resp.ok) throw new Error(`HTTP ${resp.status} — ${url}`);

        const data = await resp.json();

        // ── Mise en cache ───────────────────────────────────
        _cache.set(url, { data, ts: Date.now() });

        return data;

      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError') {
          console.warn(`[AVApi] Timeout (attempt ${attempt + 1}/${retries}): ${url}`);
        } else {
          console.warn(`[AVApi] Fetch error (attempt ${attempt + 1}/${retries}): ${err.message}`);
        }
        // Délai exponentiel entre tentatives (sauf dernière)
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 500 * Math.pow(2, attempt)));
        }
      }
    }

    // ── Fallback sur cache expiré si disponible ─────────────
    if (cached?.data) {
      console.warn(`[AVApi] Serving stale cache for: ${url}`);
      return cached.data;
    }

    console.error(`[AVApi] All retries failed: ${url} — ${lastErr?.message}`);
    return null;
  }

  // ══════════════════════════════════════════════════════════
  // LOAD ALL — 21 JSONs en parallèle
  // ══════════════════════════════════════════════════════════

  /**
   * Charge tous les JSONs en parallèle via Promise.allSettled
   * @param {number} maxAge — ms cache (0 = force refresh)
   * @returns {object} — { portfolio, signals, regime, risk, ... }
   */
  async function loadAll(maxAge = 30_000) {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const keys = Object.keys(URLS);
    const urls = keys.map(k => URLS[k]);

    const results = await Promise.allSettled(
      urls.map(url => fetchJSON(url, maxAge))
    );

    const data = {};
    keys.forEach((key, i) => {
      const result = results[i];
      data[key] = result.status === 'fulfilled' ? result.value : null;
      if (result.status === 'rejected') {
        console.warn(`[AVApi] loadAll — failed: ${key}`);
      }
    });

    return data;
  }

  /**
   * Charge une sélection de JSONs
   * @param {string[]} keys — ex: ['portfolio', 'risk', 'regime']
   */
  async function loadSelected(keys, maxAge = 30_000) {
    const URLS = AV_CONFIG.SIGNAL_URLS;
    const results = await Promise.allSettled(
      keys.map(k => fetchJSON(URLS[k], maxAge))
    );
    const data = {};
    keys.forEach((key, i) => {
      data[key] = results[i].status === 'fulfilled' ? results[i].value : null;
    });
    return data;
  }

  // ══════════════════════════════════════════════════════════
  // DASHBOARD API :5002 — SSH Tunnel (R10)
  // ══════════════════════════════════════════════════════════

  let _apiAvailable    = null;   // null = pas encore testé
  let _apiLastCheck    = 0;
  const API_CHECK_TTL  = 30_000; // Re-test toutes les 30s

  /**
   * Vérifie si le Dashboard API :5002 est accessible
   */
  async function checkDashboardAPI() {
    const now = Date.now();
    if (now - _apiLastCheck < API_CHECK_TTL && _apiAvailable !== null) {
      return _apiAvailable;
    }
    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 3_000);
      const resp = await fetch(`${AV_CONFIG.DASHBOARD_API}/health`, {
        signal: controller.signal,
        cache:  'no-store',
      });
      clearTimeout(timeout);
      _apiAvailable = resp.ok;
    } catch {
      _apiAvailable = false;
    }
    _apiLastCheck = now;
    return _apiAvailable;
  }

  /**
   * Appelle le Dashboard API :5002 avec fallback gracieux (R10)
   * @param {string} endpoint    — ex: '/status', '/agents'
   * @param {object} options     — fetch options
   * @returns {{ data, available }} — data=null si API indisponible
   */
  async function callDashboardAPI(endpoint, options = {}) {
    const available = await checkDashboardAPI();

    // ── Mise à jour indicateur UI si présent ────────────────
    const indicator = document.getElementById('av-api-indicator');
    if (indicator) {
      indicator.className = `av-api-dot ${available ? 'connected' : 'disconnected'}`;
      indicator.title     = available
        ? 'Dashboard API :5002 connected'
        : 'Dashboard API unavailable — SSH tunnel required';
    }

    if (!available) {
      return { data: null, available: false };
    }

    try {
      const controller = new AbortController();
      const timeout    = setTimeout(() => controller.abort(), 8_000);
      const resp = await fetch(`${AV_CONFIG.DASHBOARD_API}${endpoint}`, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      clearTimeout(timeout);

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      return { data, available: true };

    } catch (err) {
      console.warn(`[AVApi] Dashboard API ${endpoint}: ${err.message}`);
      return { data: null, available: true, error: err.message };
    }
  }

  // ══════════════════════════════════════════════════════════
  // AUTO-REFRESH SYSTEM
  // ══════════════════════════════════════════════════════════

  /**
   * Démarre les auto-refresh pour une page donnée
   * @param {object} pageRefreshMap — { urlKey: intervalMs, onUpdate: fn }
   *   ex: { portfolio: 30000, risk: 30000, onUpdate: (key, data) => {} }
   */
  function startAutoRefresh(pageRefreshMap) {
    const { onUpdate, ...urlMap } = pageRefreshMap;

    // Grouper par intervalle pour optimiser les appels
    const byInterval = {};
    Object.entries(urlMap).forEach(([key, ms]) => {
      if (!byInterval[ms]) byInterval[ms] = [];
      byInterval[ms].push(key);
    });

    Object.entries(byInterval).forEach(([ms, keys]) => {
      const interval = parseInt(ms);
      const id = setInterval(async () => {
        const URLS = AV_CONFIG.SIGNAL_URLS;
        const results = await Promise.allSettled(
          keys.map(k => fetchJSON(URLS[k], 0))  // 0 = force refresh
        );
        keys.forEach((key, i) => {
          if (results[i].status === 'fulfilled' && results[i].value) {
            const data = results[i].value;
            // Mise à jour cache
            _cache.set(URLS[key], { data, ts: Date.now() });
            // Callback
            if (typeof onUpdate === 'function') {
              onUpdate(key, data);
            }
            // Notifie les listeners
            _notifyListeners(key, data);
          }
        });
      }, interval);

      _intervals.push(id);
    });
  }

  /**
   * Arrête tous les auto-refresh (cleanup)
   */
  function stopAutoRefresh() {
    _intervals.forEach(id => clearInterval(id));
    _intervals.length = 0;
  }

  // ══════════════════════════════════════════════════════════
  // PUB/SUB — Listeners par clé JSON
  // ══════════════════════════════════════════════════════════

  function subscribe(key, callback) {
    if (!_listeners.has(key)) _listeners.set(key, []);
    _listeners.get(key).push(callback);
    // Retourne une fonction de cleanup
    return () => {
      const list = _listeners.get(key) || [];
      const idx  = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  function _notifyListeners(key, data) {
    (_listeners.get(key) || []).forEach(cb => {
      try { cb(data); } catch (e) { console.warn('[AVApi] Listener error:', e); }
    });
  }

  // ══════════════════════════════════════════════════════════
  // GETTERS SPÉCIALISÉS — Données critiques (R1, R2, R6, R7)
  // ══════════════════════════════════════════════════════════

  /**
   * R1 — NetLiq depuis portfolio.json
   * JAMAIS depuis performance_metrics
   */
  async function getNetLiq() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.portfolio, AV_CONFIG.REFRESH.portfolio);
    return netliqFromPortfolio(data);
  }

  /**
   * Régime courant depuis regime.json
   */
  async function getRegime() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.regime, AV_CONFIG.REFRESH.regime);
    return {
      regime:      safeGet(data, 'regime', safeGet(data, 'signal', 'NEUTRAL')),
      confidence:  safeGet(data, 'confidence', 0),
      previous:    safeGet(data, 'previous_regime', '--'),
      probs:       safeGet(data, 'probabilities', {}),
      indicators:  safeGet(data, 'indicators', {}),
      thresholds:  safeGet(data, 'signal_thresholds', {}),
      raw:         data,
    };
  }

  /**
   * Signaux ML depuis current_signals.json
   */
  async function getSignals() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.signals, AV_CONFIG.REFRESH.signals);
    if (!data) return { signals: [], meta: {} };

    // Normalise les signaux (peuvent être array ou dict)
    let signals = [];
    if (Array.isArray(data.signals)) {
      signals = data.signals;
    } else if (data.signals && typeof data.signals === 'object') {
      signals = Object.entries(data.signals).map(([sym, s]) => ({
        symbol: sym,
        ...s,
      }));
    }

    return {
      signals,
      n_signals:   safeGet(data, 'n_signals',   signals.length),
      n_buy:       safeGet(data, 'n_buy',        signals.filter(s => s.action === 'BUY').length),
      n_sell:      safeGet(data, 'n_sell',       signals.filter(s => s.action === 'SELL').length),
      n_high_conf: safeGet(data, 'n_high_conf',  signals.filter(s => (s.confidence || 0) >= AV_CONFIG.THRESHOLDS.highConf).length),
      n_scanned:   safeGet(data, 'n_scanned',    safeGet(data, 'universe_size', 0)),
      universe:    safeGet(data, 'universe_size', 0),
      updated_at:  safeGet(data, 'updated_at',   null),
      models:      safeGet(data, 'models_active', {}),
      thresholds: {
        buy:       safeGet(data, 'buy_threshold',   AV_CONFIG.THRESHOLDS.buyConf),
        sell:      safeGet(data, 'sell_threshold',  AV_CONFIG.THRESHOLDS.sellConf),
        high_conf: safeGet(data, 'high_conf_gate',  AV_CONFIG.THRESHOLDS.highConf),
      },
      raw: data,
    };
  }

  /**
   * Positions depuis portfolio.json (avec normalisation R3, R4)
   */
  async function getPortfolio() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.portfolio, AV_CONFIG.REFRESH.portfolio);
    if (!data) return null;

    const netliq     = netliqFromPortfolio(data);
    const positions  = safeGet(data, 'positions', {});
    const normalized = {};

    Object.entries(positions).forEach(([sym, pos]) => {
      normalized[sym] = AVUtils.formatPosition(sym, pos);
    });

    return {
      netliq,
      cash:          sf(safeGet(data, 'cash', safeGet(data, 'Cash', 0))),
      cash_pct:      sf(safeGet(data, 'cash_pct', safeGet(data, 'cash_ratio', 0))),
      gross_position: sf(safeGet(data, 'gross_position', 0)),
      unrealized_pnl: sf(safeGet(data, 'unrealized_pnl', 0)),
      leverage:      sf(safeGet(data, 'leverage', safeGet(data, 'current_leverage', 0))),
      positions_count: safeGet(data, 'positions_count', Object.keys(positions).length),
      long_count:    safeGet(data, 'long_count',  0),
      short_count:   safeGet(data, 'short_count', 0),
      positions:     normalized,
      account:       safeGet(data, 'account', AV_CONFIG.ACCOUNT.paper),
      mode:          safeGet(data, 'mode', 'paper'),
      raw:           data,
    };
  }

  /**
   * Métriques de risque depuis risk_metrics.json
   */
  async function getRisk() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.risk, AV_CONFIG.REFRESH.portfolio);
    if (!data) return null;

    return {
      leverage:       safeGet(data, 'leverage', {}),
      drawdown:       safeGet(data, 'drawdown', {}),
      var_metrics:    safeGet(data, 'var_metrics', {}),
      correlation:    safeGet(data, 'correlation', {}),
      risk_score:     safeGet(data, 'risk_score', 0),
      alerts:         safeGet(data, 'alerts', []),
      is_over_leveraged: safeGet(data, 'leverage.is_over_leveraged', false),
      current_leverage:  sf(safeGet(data, 'leverage.current_leverage', safeGet(data, 'leverage.current', 0))),
      raw: data,
    };
  }

  /**
   * Santé agents depuis agent_health.json (R2)
   */
  async function getAgentHealth() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.health, AV_CONFIG.REFRESH.agents);
    if (!data) return null;

    const agents = safeGet(data, 'agents', {});
    const agentsArr = Object.entries(agents).map(([name, info]) => ({
      name,
      ...info,
      isOk: isAgentOk(info),
    }));

    return {
      n_agents:  safeGet(data, 'n_agents',  13),
      n_active:  safeGet(data, 'n_active',  0),
      n_errors:  safeGet(data, 'n_errors',  0),
      agents:    agentsArr,
      agentsMap: agents,
      raw:       data,
    };
  }

  /**
   * Historique NAV depuis rolling_history.json
   * Avec fallback netliq si point nul (R1)
   */
  async function getRollingHistory(currentNetliq = null) {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.history, AV_CONFIG.REFRESH.history);
    if (!data) return [];

    const history = safeGet(data, 'history', []);

    // Filtre les points avec netliq valide, fallback sur le dernier connu
    let lastValidNetliq = currentNetliq;
    const cleaned = history.map(pt => {
      const netliq = sf(safeGet(pt, 'netliq', safeGet(pt, 'net_liq', 0)));
      const valid  = netliq > 1000;
      if (valid) lastValidNetliq = netliq;
      return {
        ts:          safeGet(pt, 'ts', ''),
        netliq:      valid ? netliq : (lastValidNetliq || 0),
        leverage:    sf(safeGet(pt, 'leverage', 0)),
        total_pnl:   sf(safeGet(pt, 'total_pnl', 0)),
        n_positions: sf(safeGet(pt, 'n_positions', 0)),
        regime:      safeGet(pt, 'regime', 'NEUTRAL'),
        sharpe:      sf(safeGet(pt, 'sharpe', 0)),
        drawdown:    sf(safeGet(pt, 'drawdown', 0)),
        win_rate:    sf(safeGet(pt, 'win_rate', 0)),
        hasRealNetliq: valid,
      };
    }).filter(pt => pt.netliq > 0);

    return cleaned;
  }

  /**
   * Mode d'exécution depuis execution_mode.json
   */
  async function getExecutionMode() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.mode, AV_CONFIG.REFRESH.execution);
    if (!data) return { mode: 'paper', auto: false, dry_run: true, available: false };

    return {
      mode:           safeGet(data, 'mode',     'paper'),
      auto:           safeGet(data, 'auto',     false),
      dry_run:        safeGet(data, 'dry_run',  true),
      account:        safeGet(data, 'account',  AV_CONFIG.ACCOUNT.paper),
      orders_blocked: safeGet(data, 'orders_blocked', false),
      label:          safeGet(data, 'label',   ''),
      available:      true,
      raw:            data,
    };
  }

  /**
   * Status IBKR depuis ibkr_status.json
   */
  async function getIBKRStatus() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.ibkr, AV_CONFIG.REFRESH.execution);
    return {
      connected:     safeGet(data, 'ibkr_connected', safeGet(data, 'connected', false)),
      authenticated: safeGet(data, 'authenticated', false),
      mode:          safeGet(data, 'mode', 'paper'),
      raw:           data,
    };
  }

  /**
   * PnL Monitor depuis pnl_monitor.json
   */
  async function getPnLMonitor() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.pnl, AV_CONFIG.REFRESH.portfolio);
    if (!data) return null;
    return {
      n_positions:  sf(safeGet(data, 'n_positions',  0)),
      total_pnl:    sf(safeGet(data, 'total_pnl_usd', safeGet(data, 'total_pnl', 0))),
      winning:      sf(safeGet(data, 'winning',   0)),
      losing:       sf(safeGet(data, 'losing',    0)),
      win_rate:     sf(safeGet(data, 'win_rate',  0)),
      regime:       safeGet(data, 'current_regime', 'NEUTRAL'),
      raw:          data,
    };
  }

  /**
   * System Status depuis system_status.json
   */
  async function getSystemStatus() {
    const data = await fetchJSON(AV_CONFIG.SIGNAL_URLS.system, AV_CONFIG.REFRESH.signals);
    if (!data) return null;
    return {
      overall:       safeGet(data, 'overall',       '--'),
      session:       safeGet(data, 'session',       '--'),
      oracle_cycle:  safeGet(data, 'oracle_cycle',  0),
      agents_active: safeGet(data, 'agents_active', 0),
      dd_halt:       safeGet(data, 'dd_halt',       false),
      llm_available: safeGet(data, 'llm_available', false),
      workers:       safeGet(data, 'workers',       {}),
      mode:          safeGet(data, 'mode',          '--'),
      raw:           data,
    };
  }

  // ══════════════════════════════════════════════════════════
  // SIDEBAR STATUS — Mise à jour temps réel
  // ══════════════════════════════════════════════════════════

  /**
   * Met à jour le status bar de la sidebar
   */
  async function updateSidebarStatus() {
    try {
      const [modeData, ibkrData, portData] = await Promise.allSettled([
        fetchJSON(AV_CONFIG.SIGNAL_URLS.mode, AV_CONFIG.REFRESH.execution),
        fetchJSON(AV_CONFIG.SIGNAL_URLS.ibkr, AV_CONFIG.REFRESH.execution),
        fetchJSON(AV_CONFIG.SIGNAL_URLS.portfolio, AV_CONFIG.REFRESH.portfolio),
      ]);

      const mode = modeData.status === 'fulfilled' ? modeData.value : null;
      const ibkr = ibkrData.status === 'fulfilled' ? ibkrData.value : null;
      const port = portData.status === 'fulfilled' ? portData.value : null;

      // ── Dot IBKR ─────────────────────────────────────────
      const dot = document.getElementById('ibkr-dot');
      if (dot) {
        const connected = safeGet(ibkr, 'ibkr_connected', safeGet(ibkr, 'connected', false));
        dot.className   = `status-dot ${connected ? 'connected' : 'disconnected'}`;
        dot.title       = connected ? 'IBKR Connected' : 'IBKR Disconnected';
      }

      // ── Label mode ───────────────────────────────────────
      const modeLabel = document.getElementById('mode-label');
      if (modeLabel && mode) {
        const m    = (safeGet(mode, 'mode', 'paper') || 'PAPER').toUpperCase();
        const auto = safeGet(mode, 'auto', false) ? 'AUTO' : 'MANUAL';
        modeLabel.textContent = `${auto} ${m}`;
        modeLabel.style.color = m === 'LIVE' ? '#ef4444' : '#10b981';
      }

      // ── Last sync ────────────────────────────────────────
      const syncEl = document.getElementById('last-sync');
      if (syncEl && port) {
        const ts = safeGet(port, 'updated_at', null);
        syncEl.textContent = ts ? `Updated ${formatAge(ts)}` : 'Live data';
      }

    } catch (err) {
      console.warn('[AVApi] updateSidebarStatus:', err.message);
    }
  }

  // ══════════════════════════════════════════════════════════
  // INIT — Commun à toutes les pages
  // ══════════════════════════════════════════════════════════

  /**
   * Initialise la couche API pour une page
   * @param {object} config — { refreshMap, onUpdate }
   */
  async function init(config = {}) {
    // Init thème
    AVUtils.initTheme();

    // Active nav item courant
    AVUtils.setActivePage();

    // Init bouton thème
    const themeBtn = document.getElementById('av-theme-toggle');
    if (themeBtn) {
      themeBtn.addEventListener('click', AVUtils.toggleTheme);
    }

    // Premier statut sidebar
    await updateSidebarStatus();

    // Auto-refresh sidebar toutes les 30s
    const sidebarInterval = setInterval(updateSidebarStatus, 30_000);
    _intervals.push(sidebarInterval);

    // Auto-refresh données page
    if (config.refreshMap) {
      startAutoRefresh(config.refreshMap);
    }
  }

  // ══════════════════════════════════════════════════════════
  // UTILITAIRES CACHE
  // ══════════════════════════════════════════════════════════

  function getCached(key) {
    const url = AV_CONFIG.SIGNAL_URLS[key];
    return url ? _cache.get(url)?.data : null;
  }

  function invalidate(key) {
    const url = AV_CONFIG.SIGNAL_URLS[key];
    if (url) _cache.delete(url);
  }

  function invalidateAll() {
    _cache.clear();
  }

  function getCacheStats() {
    const now = Date.now();
    return Array.from(_cache.entries()).map(([url, { ts }]) => ({
      url:  url.split('/').pop(),
      age:  Math.round((now - ts) / 1000),
    }));
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    // Core
    fetchJSON,
    loadAll,
    loadSelected,

    // Dashboard API (SSH tunnel)
    callDashboardAPI,
    checkDashboardAPI,

    // Auto-refresh
    startAutoRefresh,
    stopAutoRefresh,

    // PubSub
    subscribe,

    // Getters spécialisés
    getNetLiq,
    getRegime,
    getSignals,
    getPortfolio,
    getRisk,
    getAgentHealth,
    getRollingHistory,
    getExecutionMode,
    getIBKRStatus,
    getPnLMonitor,
    getSystemStatus,

    // Sidebar
    updateSidebarStatus,

    // Init
    init,

    // Cache
    getCached,
    invalidate,
    invalidateAll,
    getCacheStats,
  };

})();

window.AVApi = AVApi;
console.log('[av-api] Loaded — 21 JSON endpoints | Cache LRU | Auto-refresh | Dashboard API');