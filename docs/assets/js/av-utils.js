// ============================================================
// av-utils.js — AlphaVault Quant Dashboard v1.0
// Helpers purs — pas de dépendances externes
// Expose : window.AVUtils + globals showToast, showModal,
//          formatCurrency, formatPct
// ============================================================

const AVUtils = (() => {

  // ══════════════════════════════════════════════════════════
  // FORMAT HELPERS
  // ══════════════════════════════════════════════════════════

  function formatCurrency(n, decimals = 2) {
    const v = parseFloat(n);
    if (isNaN(v)) return '—';
    const abs = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(decimals)}T`;
    if (abs >= 1e9)  return `${sign}$${(abs / 1e9).toFixed(decimals)}B`;
    if (abs >= 1e6)  return `${sign}$${(abs / 1e6).toFixed(decimals)}M`;
    return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
  }

  function formatCurrencyFull(n, decimals = 2) {
    const v = parseFloat(n);
    if (isNaN(v)) return '—';
    return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', {
      minimumFractionDigits: decimals, maximumFractionDigits: decimals,
    });
  }

  function formatPct(n, decimals = 1) {
    const v = parseFloat(n);
    if (isNaN(v)) return '—';
    return `${v.toFixed(decimals)}%`;
  }

  function formatNumber(n) {
    const v = parseFloat(n);
    if (isNaN(v)) return '—';
    const abs = Math.abs(v);
    if (abs >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
    if (abs >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
    if (abs >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
    return v.toLocaleString('en-US');
  }

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return '—'; }
  }

  function formatAge(iso) {
    if (!iso) return '—';
    try {
      const diff = Date.now() - new Date(iso).getTime();
      if (diff < 0) return 'just now';
      const s = Math.floor(diff / 1000);
      if (s < 60)   return `${s}s ago`;
      const m = Math.floor(s / 60);
      if (m < 60)   return `${m}m ago`;
      const h = Math.floor(m / 60);
      if (h < 24)   return `${h}h ago`;
      return `${Math.floor(h / 24)}d ago`;
    } catch { return '—'; }
  }

  // ══════════════════════════════════════════════════════════
  // SAFE GETTERS (R9 — jamais crasher sur null/undefined)
  // ══════════════════════════════════════════════════════════

  function safeGet(obj, path, defaultVal = null) {
    if (!obj || !path) return defaultVal;
    try {
      return path.split('.').reduce((acc, key) => {
        if (acc == null) return defaultVal;
        return acc[key] ?? defaultVal;
      }, obj);
    } catch { return defaultVal; }
  }

  // R1 — NetLiq toujours depuis portfolio.json
  function netliqFromPortfolio(data) {
    if (!data) return null;
    const v = data.net_liq ?? data.netliq ?? data.NetLiquidation ?? data.net_liquidation;
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  // R2 — Agent OK si errors === 0 (idle = NORMAL)
  function isAgentOk(agent) {
    if (!agent) return false;
    return (parseInt(agent.errors) || 0) === 0;
  }

  // R4 — avg_cost 0 => N/A
  function avgCostDisplay(val) {
    const v = parseFloat(val);
    if (isNaN(v) || v === 0) return 'N/A';
    return formatCurrencyFull(v);
  }

  // R5 — VaR/Sharpe 0 => badge "Insufficient History"
  function varDisplay(val, label = '') {
    const v = parseFloat(val);
    if (isNaN(v) || v === 0) {
      return `<span class="badge badge-info" title="Insufficient history — requires 30+ portfolio snapshots">
                <i class="fa-solid fa-circle-info"></i> Insuff. History
              </span>`;
    }
    return `${v.toFixed(4)}${label}`;
  }

  // ══════════════════════════════════════════════════════════
  // BADGE & COLOR HELPERS
  // ══════════════════════════════════════════════════════════

  function badgeHTML(text, colorClass = 'badge-blue', icon = '') {
    const ic = icon ? `<i class="${icon}"></i> ` : '';
    return `<span class="badge ${colorClass}">${ic}${text}</span>`;
  }

  function regimeColor(regime) {
    return AV_CONFIG.REGIME_COLORS[regime] || AV_CONFIG.REGIME_COLORS.NEUTRAL;
  }

  function actionColor(action) {
    return AV_CONFIG.ACTION_COLORS[action] || AV_CONFIG.ACTION_COLORS.HOLD;
  }

  function pnlClass(val) {
    const v = parseFloat(val);
    if (isNaN(v) || v === 0) return 'text-muted';
    return v > 0 ? 'text-green' : 'text-red';
  }

  function pnlIcon(val) {
    const v = parseFloat(val);
    if (isNaN(v) || v === 0) return 'fa-solid fa-minus';
    return v > 0 ? 'fa-solid fa-arrow-trend-up' : 'fa-solid fa-arrow-trend-down';
  }

  // ══════════════════════════════════════════════════════════
  // LOGO HELPER — window._getLogoHtml
  // ══════════════════════════════════════════════════════════

  const LOGO_CACHE = new Map();

  function _getLogoHtml(sym, size = 24) {
    if (!sym) return _logoFallback(sym || '?', size);
    const s      = sym.toUpperCase().trim();
    const r      = Math.round(size * 0.22);
    const parqet = `https://assets.parqet.com/logos/symbol/${s}?format=png`;
    const fmp    = `https://financialmodelingprep.com/image-stock/${s}.png`;

    // onerror simplifié : 1er échec → FMP, 2ème → _avLogoFallback global
    // AUCUNE single-quote dans l'attribut onerror → plus de bug d'affichage
    return `<img src="${parqet}" alt="${s}" width="${size}" height="${size}" ` +
        `style="width:${size}px;height:${size}px;border-radius:${r}px;` +
        `object-fit:contain;background:var(--bg-secondary,#f1f5f9);` +
        `flex-shrink:0;display:block" ` +
        `onerror="if(!this._f){this._f=1;this.src=&quot;${fmp}&quot;}` +
        `else{window._avLogoFallback(this,&quot;${s}&quot;,${size})}">`;
    }

  function _logoFallback(sym, size = 24) {
    const colors = [
      '#3b82f6','#8b5cf6','#10b981','#f59e0b','#ef4444',
      '#06b6d4','#ec4899','#84cc16',
    ];
    const idx = (sym.charCodeAt(0) || 0) % colors.length;
    const color = colors[idx];
    const fontSize = Math.floor(size * 0.42);
    const radius = Math.round(size * 0.22);
    const letter = (sym || '?').charAt(0).toUpperCase();
    return `<span style="display:inline-flex;align-items:center;justify-content:center;
                          width:${size}px;height:${size}px;border-radius:${radius}px;
                          background:${color};color:#fff;font-size:${fontSize}px;
                          font-weight:800;flex-shrink:0;font-family:var(--font-sans)">
              ${letter}
            </span>`;
  }

  // ══════════════════════════════════════════════════════════
  // TOAST SYSTEM
  // ══════════════════════════════════════════════════════════

  let _toastContainer = null;

  function _getToastContainer() {
    if (!_toastContainer) {
      _toastContainer = document.getElementById('av-toast-container');
      if (!_toastContainer) {
        _toastContainer = document.createElement('div');
        _toastContainer.id = 'av-toast-container';
        _toastContainer.style.cssText = `
          position:fixed;bottom:24px;right:24px;z-index:99999;
          display:flex;flex-direction:column;gap:8px;pointer-events:none;`;
        document.body.appendChild(_toastContainer);
      }
    }
    return _toastContainer;
  }

  const TOAST_ICONS = {
    success: 'fa-solid fa-circle-check',
    error:   'fa-solid fa-circle-xmark',
    warn:    'fa-solid fa-triangle-exclamation',
    info:    'fa-solid fa-circle-info',
  };

  const TOAST_COLORS = {
    success: '#10b981',
    error:   '#ef4444',
    warn:    '#f59e0b',
    info:    '#3b82f6',
  };

  function showToast(msg, type = 'info', duration = 3500) {
    const container = _getToastContainer();
    const color = TOAST_COLORS[type] || TOAST_COLORS.info;
    const icon  = TOAST_ICONS[type]  || TOAST_ICONS.info;

    const toast = document.createElement('div');
    toast.style.cssText = `
      display:flex;align-items:center;gap:10px;
      padding:12px 16px;border-radius:10px;
      background:var(--bg-card,#fff);
      border:1px solid var(--border,rgba(0,0,0,0.08));
      border-left:3px solid ${color};
      box-shadow:0 4px 16px rgba(0,0,0,0.12);
      font-size:13px;font-weight:500;color:var(--text-primary,#0f172a);
      max-width:320px;pointer-events:all;
      font-family:var(--font-sans,'Inter',sans-serif);
      animation:toastIn 0.2s cubic-bezier(0.4,0,0.2,1);
      transition:opacity 0.25s ease,transform 0.25s ease;`;
    toast.innerHTML = `
      <i class="${icon}" style="color:${color};font-size:14px;flex-shrink:0"></i>
      <span style="flex:1;line-height:1.4">${msg}</span>
      <button onclick="this.parentNode.remove()"
              style="border:none;background:none;cursor:pointer;padding:2px;
                     color:var(--text-muted,#64748b);font-size:12px;line-height:1">
        <i class="fa-solid fa-xmark"></i>
      </button>`;

    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      setTimeout(() => toast.remove(), 280);
    }, duration);
  }

  // ══════════════════════════════════════════════════════════
  // MODAL SYSTEM
  // ══════════════════════════════════════════════════════════

  function showModal({ title = '', body = '', confirmText = 'Confirm', cancelText = 'Cancel',
                       danger = false, onConfirm = null, onCancel = null } = {}) {
    let overlay = document.getElementById('av-modal-overlay');
    if (overlay) overlay.remove();

    overlay = document.createElement('div');
    overlay.id = 'av-modal-overlay';
    overlay.style.cssText = `
      position:fixed;inset:0;z-index:99990;
      background:rgba(15,23,42,0.6);backdrop-filter:blur(4px);
      display:flex;align-items:center;justify-content:center;padding:16px;
      animation:fadeIn 0.15s ease;`;

    const btnColor = danger ? '#ef4444' : 'var(--accent-blue,#3b82f6)';

    overlay.innerHTML = `
      <div style="background:var(--bg-card,#fff);border-radius:14px;padding:24px;
                  max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.25);
                  border:1px solid var(--border,rgba(0,0,0,0.08));
                  animation:scaleIn 0.15s cubic-bezier(0.4,0,0.2,1);">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
          <i class="${danger ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-info'}"
             style="color:${btnColor};font-size:16px"></i>
          <h3 style="margin:0;font-size:15px;font-weight:700;
                     color:var(--text-primary,#0f172a)">${title}</h3>
        </div>
        <div style="font-size:13px;color:var(--text-secondary,#334155);
                    line-height:1.6;margin-bottom:20px">${body}</div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button id="av-modal-cancel"
                  style="padding:8px 16px;border-radius:8px;border:1px solid var(--border);
                         background:transparent;color:var(--text-muted,#64748b);
                         font-size:13px;font-weight:600;cursor:pointer;
                         font-family:var(--font-sans,'Inter',sans-serif)">
            ${cancelText}
          </button>
          <button id="av-modal-confirm"
                  style="padding:8px 20px;border-radius:8px;border:none;
                         background:${btnColor};color:#fff;
                         font-size:13px;font-weight:700;cursor:pointer;
                         font-family:var(--font-sans,'Inter',sans-serif)">
            ${confirmText}
          </button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const closeModal = () => {
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 200);
    };

    overlay.addEventListener('click', e => { if (e.target === overlay) { closeModal(); if (onCancel) onCancel(); } });
    document.getElementById('av-modal-cancel')?.addEventListener('click', () => { closeModal(); if (onCancel) onCancel(); });
    document.getElementById('av-modal-confirm')?.addEventListener('click', () => { closeModal(); if (onConfirm) onConfirm(); });
  }

  // ══════════════════════════════════════════════════════════
  // THEME MANAGER
  // ══════════════════════════════════════════════════════════

  const ThemeManager = {
    STORAGE_KEY: 'av_theme_v1',
    get() { return localStorage.getItem(this.STORAGE_KEY) || 'light'; },
    set(theme) {
      localStorage.setItem(this.STORAGE_KEY, theme);
      document.documentElement.setAttribute('data-theme', theme);
      const btn = document.getElementById('av-theme-toggle');
      if (btn) {
        const icon = btn.querySelector('i');
        if (icon) icon.className = theme === 'dark' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
        btn.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
      }
    },
    toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
    init()   { this.set(this.get()); },
  };

  // ══════════════════════════════════════════════════════════
  // MISC UTILS
  // ══════════════════════════════════════════════════════════

  function debounce(fn, delay = 200) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
  }

  function throttle(fn, limit = 200) {
    let last = 0;
    return (...args) => { const now = Date.now(); if (now - last >= limit) { last = now; fn(...args); } };
  }

  function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

  function setSidebarActive(pageName) {
    document.querySelectorAll('.av-nav-link').forEach(link => {
      const active = link.getAttribute('data-page') === pageName;
      link.classList.toggle('active', active);
    });
  }

  function getCurrentPage() {
    const path = window.location.pathname;
    const file = path.split('/').pop().replace('.html', '');
    return file || 'dashboard';
  }

  // Loading skeleton
  function skeletonHTML(rows = 3, className = '') {
    return Array.from({ length: rows }, () =>
      `<div class="skeleton-line ${className}" style="height:16px;border-radius:6px;
              background:var(--skeleton-bg);margin-bottom:8px;animation:shimmer 1.5s infinite"></div>`
    ).join('');
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    formatCurrency,
    formatCurrencyFull,
    formatPct,
    formatNumber,
    formatDate,
    formatAge,
    safeGet,
    netliqFromPortfolio,
    isAgentOk,
    avgCostDisplay,
    varDisplay,
    badgeHTML,
    regimeColor,
    actionColor,
    pnlClass,
    pnlIcon,
    showToast,
    showModal,
    ThemeManager,
    debounce,
    throttle,
    clamp,
    setSidebarActive,
    getCurrentPage,
    skeletonHTML,
    _getLogoHtml,
    formatCompact: formatCurrency,   // alias — formatCurrency fait déjà T/B/M/K
  };

})();

// ── Globals exposés (compatibilité av-watchlist.js / av-stock-detail.js) ──
window.AVUtils      = AVUtils;
/**
 * Fallback logo global — appelé par onerror des <img> logo.
 * Injecté comme fonction globale pour éviter tout problème
 * de quotes dans les attributs HTML onerror.
 */
window._avLogoFallback = function (el, sym, size) {
  try {
    const colors = [
      '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b',
      '#ef4444', '#06b6d4', '#ec4899', '#84cc16',
    ];
    const idx    = ((sym || '').charCodeAt(0) || 0) % colors.length;
    const radius = Math.round(size * 0.22);
    const fSize  = Math.floor(size * 0.42);
    const letter = (sym || '?').charAt(0).toUpperCase();

    const sp = document.createElement('span');
    sp.style.cssText =
      'display:inline-flex;align-items:center;justify-content:center;' +
      `width:${size}px;height:${size}px;border-radius:${radius}px;` +
      `background:${colors[idx]};color:#fff;font-size:${fSize}px;` +
      'font-weight:800;flex-shrink:0;font-family:Inter,sans-serif';
    sp.textContent = letter;

    if (el && el.parentNode) {
      el.parentNode.insertBefore(sp, el);
      el.remove();
    }
  } catch (e) { /* silent */ }
};

// Ré-exposer sur AVUtils aussi (compatibilité av-watchlist, av-stock-detail)
window._getLogoHtml = AVUtils._getLogoHtml;
window.showToast    = AVUtils.showToast;
window.showModal    = AVUtils.showModal;
window.formatCurrency = AVUtils.formatCurrency;
window.formatPct    = AVUtils.formatPct;

console.log('[av-utils] v1.0 loaded');