// ============================================================
// av-utils.js — AlphaVault Quant Dashboard v1.0
// Helpers purs — pas de dépendances externes
// Dépend de : av-config.js
// ============================================================

const AVUtils = (() => {

  // ══════════════════════════════════════════════════════════
  // FORMATTERS NUMÉRIQUES
  // ══════════════════════════════════════════════════════════

  /**
   * Formate un nombre en devise USD
   * @param {number} n
   * @param {number} decimals
   * @returns {string} "$1,024,703.60"
   */
  function formatCurrency(n, decimals = 2) {
    if (n == null || isNaN(parseFloat(n))) return '--';
    const v = parseFloat(n);
    const neg = v < 0;
    const abs = Math.abs(v);
    const formatted = abs.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    return `${neg ? '-' : ''}$${formatted}`;
  }

  /**
   * Formate en pourcentage
   * @param {number} n  — déjà en % (ex: 85.2) ou fraction (ex: 0.852) selon isDecimal
   * @param {number} decimals
   * @param {boolean} isDecimal — true si n est une fraction (0.xx)
   * @returns {string} "85.2%"
   */
  function formatPct(n, decimals = 1, isDecimal = false) {
    if (n == null || isNaN(parseFloat(n))) return '--';
    const v = isDecimal ? parseFloat(n) * 100 : parseFloat(n);
    return `${v.toFixed(decimals)}%`;
  }

  /**
   * Formate un grand nombre (volume, employees)
   * @returns {string} "1.02B" | "487.6K"
   */
  function formatNum(n) {
    if (n == null || isNaN(parseFloat(n))) return '--';
    const v = Math.abs(parseFloat(n));
    if (v >= 1e12) return `${(v / 1e12).toFixed(2)}T`;
    if (v >= 1e9)  return `${(v / 1e9).toFixed(2)}B`;
    if (v >= 1e6)  return `${(v / 1e6).toFixed(2)}M`;
    if (v >= 1e3)  return `${(v / 1e3).toFixed(1)}K`;
    return v.toFixed(0);
  }

  /**
   * Formate une market cap avec signe $
   */
  function formatMCap(n) {
    if (n == null || isNaN(parseFloat(n))) return '--';
    const v = parseFloat(n);
    const neg = v < 0;
    const abs = Math.abs(v);
    const str = (() => {
      if (abs >= 1e12) return `${(abs / 1e12).toFixed(2)}T`;
      if (abs >= 1e9)  return `${(abs / 1e9).toFixed(2)}B`;
      if (abs >= 1e6)  return `${(abs / 1e6).toFixed(2)}M`;
      if (abs >= 1e3)  return `${(abs / 1e3).toFixed(1)}K`;
      return abs.toFixed(2);
    })();
    return `${neg ? '-' : ''}$${str}`;
  }

  /**
   * Formate une date ISO en lisible
   * @returns {string} "25 Apr 2026 08:45"
   */
  function formatDate(iso) {
    if (!iso) return '--';
    try {
      const d = new Date(typeof iso === 'number' ? iso * 1000 : iso);
      if (isNaN(d)) return '--';
      return d.toLocaleString('en-US', {
        day:    '2-digit',
        month:  'short',
        year:   'numeric',
        hour:   '2-digit',
        minute: '2-digit',
        hour12: false,
      });
    } catch { return '--'; }
  }

  /**
   * Formate un timestamp en "time ago"
   * @returns {string} "2 min ago" | "3h ago" | "2d ago"
   */
  function formatAge(iso) {
    if (!iso) return '--';
    try {
      const ts  = typeof iso === 'number' ? iso * 1000 : new Date(iso).getTime();
      const d   = Date.now() - ts;
      if (isNaN(d) || d < 0) return 'Just now';
      const sec = Math.floor(d / 1000);
      const min = Math.floor(sec / 60);
      const hr  = Math.floor(min / 60);
      const day = Math.floor(hr  / 24);
      if (day  > 0) return `${day}d ago`;
      if (hr   > 0) return `${hr}h ago`;
      if (min  > 0) return `${min}m ago`;
      return 'Just now';
    } catch { return '--'; }
  }

  // ══════════════════════════════════════════════════════════
  // SAFE DATA ACCESS (R9)
  // ══════════════════════════════════════════════════════════

  /**
   * Accès sécurisé à un chemin d'objet imbriqué
   * @param {object} obj
   * @param {string} path  — "a.b.c" ou "a[0].b"
   * @param {*} def        — valeur par défaut
   */
  function safeGet(obj, path, def = null) {
    if (obj == null) return def;
    try {
      const parts = path.replace(/\[(\d+)\]/g, '.$1').split('.');
      let current = obj;
      for (const p of parts) {
        if (current == null || typeof current !== 'object') return def;
        current = current[p];
      }
      return current !== undefined && current !== null ? current : def;
    } catch {
      return def;
    }
  }

  // ══════════════════════════════════════════════════════════
  // RÈGLES CRITIQUES DASHBOARD
  // ══════════════════════════════════════════════════════════

  /**
   * R1 — Extrait NetLiq TOUJOURS depuis portfolio.json
   * JAMAIS depuis performance_metrics.portfolio_value (= 100k seed)
   */
  function netliqFromPortfolio(data) {
    if (!data) return null;
    for (const field of AV_CONFIG.PORTFOLIO.netliqFields) {
      const v = data[field];
      if (v != null && parseFloat(v) > 1000) return parseFloat(v);
    }
    return null;
  }

  /**
   * R2 — Agent OK si errors === 0 (idle = NORMAL, pas une erreur)
   */
  function isAgentOk(agent) {
    if (!agent) return false;
    return (agent.errors === 0 || agent.errors == null);
  }

  /**
   * R4 — avg_cost toujours 0.00 → afficher "N/A"
   */
  function avgCostDisplay(val) {
    if (val == null || parseFloat(val) === 0) return 'N/A';
    return formatCurrency(val);
  }

  /**
   * R5 — VaR/Sharpe = 0.0 → afficher badge "Insufficient History"
   */
  function varDisplay(val, label = '') {
    const v = parseFloat(val);
    if (v === 0 || isNaN(v)) {
      return `<span class="badge badge-info" title="Less than 30 portfolio snapshots available">
        <i class="fa-solid fa-clock"></i> Insufficient History
      </span>`;
    }
    return `${label}${v.toFixed(4)}`;
  }

  /**
   * R3 — Positions SHORT: qty < 0 → badge SHORT rouge + abs()
   */
  function formatPosition(sym, pos) {
    const qty   = parseFloat(pos.quantity || pos.qty || 0);
    const mval  = parseFloat(pos.market_value || 0);
    const side  = qty < 0 ? 'SHORT' : 'LONG';
    return {
      symbol:       sym,
      side,
      quantity:     Math.abs(qty),
      market_value: Math.abs(mval),
      pnl:          parseFloat(pos.unrealized_pnl || 0),
      pnl_pct:      parseFloat(pos.pnl_pct || 0),
      price:        parseFloat(pos.current_price || pos.price || 0),
      avg_cost:     avgCostDisplay(pos.avg_cost),
      isShort:      side === 'SHORT',
    };
  }

  // ══════════════════════════════════════════════════════════
  // HTML HELPERS
  // ══════════════════════════════════════════════════════════

  /**
   * Génère un badge HTML inline
   */
  function badgeHTML(text, color = 'blue', icon = '') {
    const MAP = {
      green:  { bg: 'rgba(16,185,129,0.12)', text: '#10b981', border: 'rgba(16,185,129,0.25)' },
      red:    { bg: 'rgba(239,68,68,0.12)',  text: '#ef4444', border: 'rgba(239,68,68,0.25)'  },
      orange: { bg: 'rgba(245,158,11,0.12)', text: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
      blue:   { bg: 'rgba(59,130,246,0.12)', text: '#3b82f6', border: 'rgba(59,130,246,0.25)' },
      violet: { bg: 'rgba(139,92,246,0.12)', text: '#8b5cf6', border: 'rgba(139,92,246,0.25)' },
      gray:   { bg: 'rgba(107,114,128,0.12)',text: '#6b7280', border: 'rgba(107,114,128,0.25)'},
      gold:   { bg: 'rgba(234,179,8,0.12)',  text: '#eab308', border: 'rgba(234,179,8,0.25)'  },
    };
    const c = MAP[color] || MAP.blue;
    const iconHtml = icon ? `<i class="fa-solid ${icon}" style="font-size:10px"></i> ` : '';
    return `<span class="badge" style="background:${c.bg};color:${c.text};border:1px solid ${c.border}">
      ${iconHtml}${text}
    </span>`;
  }

  /**
   * Retourne le badge HTML pour un régime
   */
  function regimeBadge(regime) {
    if (!regime) return badgeHTML('--', 'gray');
    const MAP = { BULL: 'green', BEAR: 'red', NEUTRAL: 'gray', CRISIS: 'violet' };
    const icons = { BULL: 'fa-arrow-trend-up', BEAR: 'fa-arrow-trend-down', NEUTRAL: 'fa-minus', CRISIS: 'fa-skull' };
    const color = MAP[regime] || 'gray';
    const icon  = icons[regime] || 'fa-circle';
    return badgeHTML(regime, color, icon);
  }

  /**
   * Retourne le badge HTML pour une action BUY/SELL
   */
  function actionBadge(action) {
    if (!action) return badgeHTML('--', 'gray');
    const MAP = { BUY: 'green', SELL: 'red', HOLD: 'gray' };
    const icons = { BUY: 'fa-arrow-up', SELL: 'fa-arrow-down', HOLD: 'fa-minus' };
    return badgeHTML(action, MAP[action] || 'gray', icons[action] || 'fa-circle');
  }

  /**
   * Badge PnL coloré (vert/rouge/gris)
   */
  function pnlBadge(val, decimals = 2) {
    const v = parseFloat(val);
    if (isNaN(v)) return '<span class="badge badge-gray">--</span>';
    const color = v > 0 ? 'green' : v < 0 ? 'red' : 'gray';
    const icon  = v > 0 ? 'fa-arrow-up' : v < 0 ? 'fa-arrow-down' : 'fa-minus';
    const sign  = v > 0 ? '+' : '';
    return badgeHTML(`${sign}${formatCurrency(v, decimals)}`, color, icon);
  }

  /**
   * Badge leverage — orange si > maxLeverage
   */
  function leverageBadge(val, isOver = false) {
    const v = parseFloat(val);
    if (isNaN(v)) return '--';
    const color = isOver ? 'orange' : 'green';
    const icon  = isOver ? 'fa-triangle-exclamation' : 'fa-check';
    return badgeHTML(`${v.toFixed(2)}x`, color, icon);
  }

  /**
   * Progress bar HTML
   * @param {number} pct  — 0 à 100
   * @param {string} color — CSS color
   */
  function progressBar(pct, color = '#3b82f6', height = 6) {
    const w = Math.min(100, Math.max(0, parseFloat(pct) || 0));
    return `<div class="progress-track" style="height:${height}px;border-radius:${height}px;background:rgba(148,163,184,0.15);overflow:hidden">
      <div class="progress-fill" style="width:${w.toFixed(1)}%;height:100%;background:${color};border-radius:${height}px;transition:width 0.5s ease"></div>
    </div>`;
  }

  // ══════════════════════════════════════════════════════════
  // TOAST NOTIFICATIONS
  // ══════════════════════════════════════════════════════════

  function showToast(msg, type = 'info', duration = 3500) {
    let wrap = document.getElementById('av-toast-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id            = 'av-toast-wrap';
      wrap.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none';
      document.body.appendChild(wrap);
    }

    const ICONS = {
      success: 'fa-circle-check',
      error:   'fa-circle-exclamation',
      warn:    'fa-triangle-exclamation',
      info:    'fa-circle-info',
    };
    const COLORS = {
      success: '#10b981',
      error:   '#ef4444',
      warn:    '#f59e0b',
      info:    '#3b82f6',
    };

    const toast = document.createElement('div');
    toast.style.cssText = `
      pointer-events:auto;
      display:flex;align-items:center;gap:10px;
      padding:12px 16px;border-radius:10px;
      background:var(--bg-card, #1e293b);
      border:1px solid ${COLORS[type] || COLORS.info}40;
      box-shadow:0 4px 20px rgba(0,0,0,0.3);
      color:var(--text-primary, #f1f5f9);
      font-size:13px;font-weight:500;
      min-width:240px;max-width:360px;
      opacity:0;transform:translateX(20px);
      transition:all 0.25s ease;
    `;
    toast.innerHTML = `
      <i class="fa-solid ${ICONS[type] || ICONS.info}" style="color:${COLORS[type] || COLORS.info};font-size:15px;flex-shrink:0"></i>
      <span>${msg}</span>
    `;
    wrap.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity   = '1';
      toast.style.transform = 'translateX(0)';
    });

    setTimeout(() => {
      toast.style.opacity   = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 280);
    }, duration);
  }

  // ══════════════════════════════════════════════════════════
  // MODAL
  // ══════════════════════════════════════════════════════════

  function showModal({ title = '', body = '', onConfirm = null, confirmText = 'Confirm', cancelText = 'Cancel', danger = false } = {}) {
    const existing = document.getElementById('av-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id    = 'av-modal-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99990;
      background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;
      animation:fadeIn 0.2s ease;
    `;

    const confirmBg = danger ? '#ef4444' : '#3b82f6';

    overlay.innerHTML = `
      <div style="
        background:var(--bg-card,#1e293b);
        border:1px solid var(--border,rgba(148,163,184,0.1));
        border-radius:16px;padding:28px;
        max-width:440px;width:calc(100% - 40px);
        box-shadow:0 20px 60px rgba(0,0,0,0.5);
        animation:slideUp 0.25s ease;
      ">
        ${title ? `<div style="font-size:17px;font-weight:700;color:var(--text-primary,#f1f5f9);margin-bottom:12px">
          ${title}
        </div>` : ''}
        <div style="font-size:13px;color:var(--text-muted,#94a3b8);line-height:1.6;margin-bottom:24px">
          ${body}
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button id="av-modal-cancel" style="
            padding:9px 18px;border-radius:8px;border:1px solid var(--border,rgba(148,163,184,0.2));
            background:transparent;color:var(--text-muted,#94a3b8);
            cursor:pointer;font-size:13px;font-weight:600;transition:all 0.2s
          ">${cancelText}</button>
          ${onConfirm ? `<button id="av-modal-confirm" style="
            padding:9px 18px;border-radius:8px;border:none;
            background:${confirmBg};color:#fff;
            cursor:pointer;font-size:13px;font-weight:700;transition:all 0.2s
          ">${confirmText}</button>` : ''}
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const close = () => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
    };

    document.getElementById('av-modal-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

    if (onConfirm) {
      document.getElementById('av-modal-confirm')?.addEventListener('click', () => {
        close();
        onConfirm();
      });
    }

    return { close };
  }

  // ══════════════════════════════════════════════════════════
  // SIDEBAR ACTIVE STATE
  // ══════════════════════════════════════════════════════════

  function setActivePage() {
    const page = window.location.pathname.split('/').pop() || 'dashboard.html';
    document.querySelectorAll('.nav-item[data-page]').forEach(link => {
      const isActive = page.includes(link.dataset.page);
      link.classList.toggle('active', isActive);
    });
  }

  // ══════════════════════════════════════════════════════════
  // THEME (dark / light)
  // ══════════════════════════════════════════════════════════

  function initTheme() {
    const saved = localStorage.getItem('av-theme') || 'light';
    applyTheme(saved);
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('av-theme', theme);
    const btn = document.getElementById('av-theme-toggle');
    if (btn) {
      btn.innerHTML = theme === 'dark'
        ? '<i class="fa-solid fa-sun"></i>'
        : '<i class="fa-solid fa-moon"></i>';
      btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  // ══════════════════════════════════════════════════════════
  // MISC
  // ══════════════════════════════════════════════════════════

  /**
   * Debounce helper
   */
  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  /**
   * Copie dans le presse-papier
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied to clipboard', 'success', 2000);
      return true;
    } catch {
      showToast('Copy failed', 'error');
      return false;
    }
  }

  /**
   * Parse safe float
   */
  function sf(val, def = 0) {
    const v = parseFloat(val);
    return isNaN(v) ? def : v;
  }

  /**
   * Dernière mise à jour sidebar
   */
  function updateLastSync(ts) {
    const el = document.getElementById('last-sync');
    if (el) el.textContent = `Updated ${formatAge(ts)}`;
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    // Formatters
    formatCurrency,
    formatPct,
    formatNum,
    formatMCap,
    formatDate,
    formatAge,
    sf,

    // Safe access (R9)
    safeGet,

    // Règles critiques
    netliqFromPortfolio,   // R1
    isAgentOk,             // R2
    formatPosition,        // R3
    avgCostDisplay,        // R4
    varDisplay,            // R5

    // HTML helpers
    badgeHTML,
    regimeBadge,
    actionBadge,
    pnlBadge,
    leverageBadge,
    progressBar,

    // UI
    showToast,
    showModal,
    setActivePage,

    // Theme
    initTheme,
    applyTheme,
    toggleTheme,
    isDark,

    // Misc
    debounce,
    copyToClipboard,
    updateLastSync,
  };

})();

window.AVUtils = AVUtils;

// ── Aliases globaux pratiques ─────────────────────────────
const {
  formatCurrency, formatPct, formatNum, formatMCap,
  formatDate, formatAge, safeGet, showToast, showModal,
  netliqFromPortfolio, isAgentOk, avgCostDisplay, varDisplay,
  badgeHTML, regimeBadge, actionBadge, pnlBadge, leverageBadge,
  progressBar, isDark, sf,
} = AVUtils;

console.log('[av-utils] Loaded — helpers, rules R1-R9, theme, toasts');