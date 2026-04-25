// ============================================================
// av-watchlist.js — AlphaVault Quant v1.0
// Watchlist Manager — Sync GitHub via Cloudflare Worker
// Expose : window.WatchlistManager
// Dépend de : av-config.js, av-utils.js, av-api.js
// ============================================================

const WatchlistManager = (() => {

  // ── Config ────────────────────────────────────────────────
  const WORKER_URL   = AV_CONFIG.WORKERS.ghProxy;
  const GH_BASE      = AV_CONFIG.GITHUB_BASE;
  const LS_KEY       = 'av_watchlist_v4';
  const LS_STARRED   = 'av_starred_v4';
  const PAGE_SIZE    = 50;

  // ── State ─────────────────────────────────────────────────
  let _watchlist     = [];
  let _starred       = [];
  let _signalData    = {};
  let _currentPage   = 1;
  let _currentSector = 'All';
  let _currentSearch = '';
  let _syncStatus    = 'local';
  let _syncTimestamp = 0;
  let _saveTimeout   = null;

  // ══════════════════════════════════════════════════════════
  // UNIVERSE — 907 symboles organisés par secteur
  // ══════════════════════════════════════════════════════════
  const UNIVERSE = {
    Technology:       ['AAPL','MSFT','NVDA','AVGO','ORCL','AMD','INTC','QCOM',
                       'TXN','AMAT','LRCX','KLAC','ADI','MU','ON','SWKS',
                       'CDNS','SNPS','FTNT','WDC','DELL','HPE','HPQ','EPAM'],
    'Software/Cloud': ['CRM','ADBE','NOW','INTU','TEAM','WDAY','DDOG','SNOW',
                       'ZS','CRWD','OKTA','NET','HUBS','VEEV','MDB','CFLT',
                       'S','ASAN','GTLB','TWLO','ZM','DOCU','PAYC','PCTY',
                       'TTD','SHOP','MELI','SQ','AFRM','SOFI'],
    'Comm. Services': ['GOOGL','GOOG','META','NFLX','DIS','CMCSA','VZ','T',
                       'TMUS','CHTR','LYV','EA','TTWO','SNAP','PINS','SPOT',
                       'PARA','WBD','MTCH','RBLX'],
    'Cons. Discret.': ['AMZN','TSLA','HD','MCD','NKE','LOW','SBUX','BKNG',
                       'TJX','CMG','ORLY','AZO','ROST','DHI','LEN','MAR',
                       'HLT','GM','F','UBER','LYFT','ABNB','EXPE','CCL',
                       'RCL','DAL','UAL','RIVN','DKNG','MGM','WYNN'],
    'Cons. Staples':  ['WMT','PG','KO','PEP','COST','PM','MO','MDLZ','CL',
                       'EL','KHC','GIS','HSY','CLX','KMB','TSN','HRL','STZ','KR'],
    Healthcare:       ['UNH','JNJ','LLY','ABBV','MRK','TMO','ABT','DHR','BMY',
                       'AMGN','MDT','ISRG','SYK','BSX','EW','REGN','GILD',
                       'VRTX','BIIB','MRNA','PFE','DXCM','HOLX','BDX',
                       'HUM','CI','CVS','ELV','CNC','MCK'],
    Financials:       ['JPM','BAC','WFC','GS','MS','BLK','SPGI','MCO','COF',
                       'AXP','V','MA','PYPL','SCHW','CB','PGR','ALL','TRV',
                       'MET','PRU','AFL','USB','PNC','TFC','STT','BK',
                       'CME','CBOE','ICE','NDAQ','MSCI','HOOD'],
    Industrials:      ['HON','UPS','RTX','CAT','DE','ETN','GE','LMT','NOC',
                       'GD','BA','MMM','EMR','ITW','ROK','PH','FAST','SWK',
                       'XYL','ROP','FDX','NSC','UNP','CSX','ODFL','GWW',
                       'URI','PCAR','CTAS','AXON'],
    Energy:           ['XOM','CVX','COP','EOG','MPC','VLO','PSX','HES','DVN',
                       'OXY','SLB','HAL','BKR','CTRA','EQT','FANG','MRO',
                       'KMI','WMB','OKE','LNG'],
    Materials:        ['LIN','APD','SHW','PPG','ECL','NEM','FCX','NUE','STLD',
                       'ALB','CF','MOS','VMC','MLM','GOLD','WPM','AA','X','CLF'],
    'Real Estate':    ['PLD','AMT','CCI','EQIX','SPG','O','WELL','EQR','AVB',
                       'ARE','BXP','IRM','SBAC','PSA','EXR','VICI'],
    Utilities:        ['NEE','DUK','SO','D','EXC','AEP','XEL','SRE','ED',
                       'ETR','PPL','DTE','FE','CMS','WEC','ES','AES','NRG'],
    'Crypto/Digital': ['COIN','MSTR','RIOT','MARA','HUT','CLSK'],
    ETFs:             ['SPY','QQQ','IWM','DIA','VTI','VOO','IVV','EFA','EEM',
                       'GLD','SLV','TLT','HYG','LQD','VNQ','XLF','XLK','XLE',
                       'XLV','XLI','XLP','XLU','XLRE','XLC','XLB','XLY',
                       'XBI','IBB','SMH','SOXX','ARKK','ARKG','SH','BITO'],
    International:    ['TSM','ASML','SAP','NVO','TM','SONY','BABA','JD','NIO',
                       'LI','XPEV','RIO','BHP','VALE','AZN','GSK','BP','SHEL','SE'],
  };

  // Lookup flat
  const SYMBOL_META   = {};
  const ALL_SYMBOLS   = [];
  Object.entries(UNIVERSE).forEach(([sector, syms]) => {
    syms.forEach(s => {
      if (!SYMBOL_META[s]) {
        SYMBOL_META[s] = { sector };
        ALL_SYMBOLS.push(s);
      }
    });
  });

  // ══════════════════════════════════════════════════════════
  // LOGO HELPER
  // ══════════════════════════════════════════════════════════
  function _logo(sym, size = 22) {
    if (typeof window._getLogoHtml === 'function')
      return window._getLogoHtml(sym, size);
    return `<span style="display:inline-flex;align-items:center;justify-content:center;
                          width:${size}px;height:${size}px;border-radius:5px;
                          background:var(--gradient-brand-soft);
                          font-size:${Math.floor(size*0.42)}px;font-weight:800;
                          color:var(--accent-blue)">${sym.charAt(0)}</span>`;
  }

  // ══════════════════════════════════════════════════════════
  // PERSISTANCE LOCALE
  // ══════════════════════════════════════════════════════════
  function _saveLocal() {
    try {
      localStorage.setItem(LS_KEY,     JSON.stringify(_watchlist));
      localStorage.setItem(LS_STARRED, JSON.stringify(_starred));
    } catch(e) {}
  }

  function _loadLocal() {
    try {
      const wl = localStorage.getItem(LS_KEY);
      const st = localStorage.getItem(LS_STARRED);
      _watchlist = wl ? JSON.parse(wl) : [];
      _starred   = st ? JSON.parse(st) : [];
    } catch(e) {
      _watchlist = [];
      _starred   = [];
    }
  }

  // ══════════════════════════════════════════════════════════
  // SYNC GITHUB — via Cloudflare Worker (PAT serveur)
  // ══════════════════════════════════════════════════════════
  async function _loadFromGitHub() {
    // Essai 1 : GitHub Pages CDN (public)
    try {
      const url  = `${GH_BASE}/watchlist.json?_=${Date.now()}`;
      const data = await AVApi.fetchJSON(url, 0);
      if (data && (Array.isArray(data.watchlist) || Array.isArray(data.starred)))
        return data;
    } catch(e) {}

    // Essai 2 : Worker GET (fresh, authentifié côté serveur)
    try {
      const resp = await fetch(`${WORKER_URL}/watchlist?_=${Date.now()}`, {
        signal: AbortSignal.timeout(8000),
        cache:  'no-store',
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && !data.error) return data;
      }
    } catch(e) {}

    return null;
  }

  async function _pushToGitHub() {
    _syncStatus = 'loading';
    _updateSyncUI();

    const payload = {
      watchlist:  _watchlist,
      starred:    _starred,
      updated_at: new Date().toISOString(),
      n:          _watchlist.length,
    };

    try {
      const resp = await fetch(`${WORKER_URL}/watchlist`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        _syncTimestamp = Date.now();
        _syncStatus    = 'synced';
        _updateSyncUI();
        showToast(`Watchlist synced (${_watchlist.length} symbols)`, 'success');
        return true;
      }

      // Retry sur conflit SHA 409
      if (resp.status === 409) {
        setTimeout(() => _pushToGitHub(), 2000);
        return false;
      }

      _syncStatus = 'error';
      _updateSyncUI();
      showToast('Sync error — will retry', 'error');
      return false;

    } catch(e) {
      _syncStatus = 'error';
      _updateSyncUI();
      return false;
    }
  }

  function _scheduleSave() {
    _saveLocal();
    clearTimeout(_saveTimeout);
    _saveTimeout = setTimeout(() => _pushToGitHub(), 2000);
  }

  // ══════════════════════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════════════════════
  async function init() {
    // 1. Charge depuis GitHub (CDN ou Worker)
    const ghData = await _loadFromGitHub();
    if (ghData) {
      _watchlist     = Array.isArray(ghData.watchlist) ? ghData.watchlist : [];
      _starred       = Array.isArray(ghData.starred)   ? ghData.starred   : [];
      _syncTimestamp = ghData.updated_at
        ? new Date(ghData.updated_at).getTime() : Date.now();
      _syncStatus    = 'synced';
      _saveLocal();
    } else {
      // 2. Fallback localStorage
      _loadLocal();
      _syncStatus = 'local';
    }

    _buildSectorTabs();
    _buildAddForm();
    _buildSearchBinding();
    _buildSyncBar();

    // Auto-sync si l'onglet devient visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _autoSync();
    });

    // Auto-sync toutes les 5 minutes
    setInterval(() => _autoSync(), 5 * 60 * 1000);
  }

  async function _autoSync() {
    try {
      const ghData = await _loadFromGitHub();
      if (!ghData) return;
      const ghTime = ghData.updated_at
        ? new Date(ghData.updated_at).getTime() : 0;
      if (ghTime > _syncTimestamp && Array.isArray(ghData.watchlist)) {
        const prev     = _watchlist.length;
        _watchlist     = ghData.watchlist;
        _starred       = Array.isArray(ghData.starred) ? ghData.starred : _starred;
        _syncTimestamp = ghTime;
        _syncStatus    = 'synced';
        _saveLocal();
        render(_signalData);
        _updateSyncUI();
        if (_watchlist.length !== prev)
          showToast(`Watchlist synced (${_watchlist.length} symbols)`, 'info');
      }
    } catch(e) {}
  }

  // ══════════════════════════════════════════════════════════
  // CRUD
  // ══════════════════════════════════════════════════════════
  function addSymbol(sym) {
    sym = sym.toUpperCase().trim().replace(/[^A-Z.]/g, '');
    if (!sym || sym.length > 10)       { showToast('Invalid symbol', 'warn'); return false; }
    if (_watchlist.includes(sym))      { showToast(`${sym} already in watchlist`, 'warn'); return false; }

    _watchlist.unshift(sym);
    if (!SYMBOL_META[sym]) {
      SYMBOL_META[sym] = { sector: 'Custom' };
      ALL_SYMBOLS.push(sym);
    }
    _scheduleSave();
    showToast(`${sym} added`, 'success');
    render(_signalData);
    return true;
  }

  function removeSymbol(sym) {
    _watchlist = _watchlist.filter(s => s !== sym);
    _starred   = _starred.filter(s => s !== sym);
    _scheduleSave();
    showToast(`${sym} removed`, 'info');
    render(_signalData);
  }

  function toggleStar(sym) {
    _starred = _starred.includes(sym)
      ? _starred.filter(s => s !== sym)
      : [sym, ..._starred];
    _scheduleSave();
    render(_signalData);
  }

  function clearAll() {
    _watchlist = [];
    _starred   = [];
    _scheduleSave();
    render(_signalData);
    showToast('Watchlist cleared', 'info');
  }

  function isStarred(sym)     { return _starred.includes(sym); }
  function isInWatchlist(sym) { return _watchlist.includes(sym); }

  // ══════════════════════════════════════════════════════════
  // FILTER + SORT
  // ══════════════════════════════════════════════════════════
  function _getFiltered() {
    let list = [..._watchlist];

    // Starred toujours en premier
    list.sort((a, b) => (isStarred(b) ? 1 : 0) - (isStarred(a) ? 1 : 0));

    // Filtre secteur
    if (_currentSector === 'Starred') {
      list = list.filter(s => isStarred(s));
    } else if (_currentSector !== 'All') {
      list = list.filter(s => (SYMBOL_META[s]?.sector || 'Custom') === _currentSector);
    }

    // Filtre recherche
    if (_currentSearch) {
      const q = _currentSearch.toLowerCase();
      list = list.filter(s =>
        s.toLowerCase().includes(q) ||
        (SYMBOL_META[s]?.sector || '').toLowerCase().includes(q)
      );
    }

    return list;
  }

  // ══════════════════════════════════════════════════════════
  // RENDER TABLE
  // ══════════════════════════════════════════════════════════
  function render(signalData = {}) {
    _signalData = signalData;

    // Normalise : signals peut être tableau ou dict
    const sigsArr = signalData?.signals || signalData || {};
    const sigs    = {};
    if (Array.isArray(sigsArr)) {
      sigsArr.forEach(s => { if (s.symbol) sigs[s.symbol] = s; });
    } else if (typeof sigsArr === 'object') {
      Object.assign(sigs, sigsArr);
    }

    const tbody = document.getElementById('watchlist-tbody');
    if (!tbody) return;

    const filtered = _getFiltered();
    const total    = filtered.length;
    const pages    = Math.max(1, Math.ceil(total / PAGE_SIZE));
    _currentPage   = Math.min(_currentPage, pages);
    const start    = (_currentPage - 1) * PAGE_SIZE;
    const display  = filtered.slice(start, start + PAGE_SIZE);

    // Compteur
    document.querySelectorAll('#wl-sym-count,#wl-count')
      .forEach(el => { el.textContent = `${_watchlist.length} symbols`; });

    // Etat vide
    if (!_watchlist.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center;padding:36px;color:var(--text-muted)">
            <i class="fa-solid fa-eye-slash"
               style="font-size:24px;margin-bottom:10px;display:block;opacity:0.3"></i>
            Your watchlist is empty — add symbols using the form above.
          </td>
        </tr>`;
      _renderPagination(0, total);
      return;
    }

    if (!display.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center;padding:28px;color:var(--text-muted)">
            <i class="fa-solid fa-filter" style="margin-right:6px"></i>
            No results for "<strong>${_currentSearch}</strong>"
          </td>
        </tr>`;
      _renderPagination(pages, total);
      return;
    }

    tbody.innerHTML = display.map(sym => {
      const s       = sigs[sym] || {};
      const meta    = SYMBOL_META[sym] || { sector: 'Custom' };
      const price   = parseFloat(s.price       || 0);
      const chg     = parseFloat(s.change_pct  || s.change  || 0);
      const score   = parseFloat(s.final_score || s.score   || 0);
      const bp      = parseFloat(s.buy_prob    || 0.5);
      const dir     = s.direction || (s.action === 'BUY' ? 'buy'
                    : s.action === 'SELL' ? 'sell' : 'neutral');
      const council = s.council || (price > 0 ? 'wait' : '');
      const regime  = (s.regime || '').replace(/_/g, ' ');
      const starred = isStarred(sym);
      const cls     = chg > 0 ? 'color:#10b981' : chg < 0 ? 'color:#ef4444' : '';

      const sColor  = score > 0.65 ? '#10b981'
                    : score > 0.40 ? '#f59e0b' : '#64748b';
      const cColor  = council.includes('execute') ? '#10b981'
                    : council === 'veto'           ? '#ef4444' : '#f59e0b';

      // Direction badge
      const dirBadge = dir === 'buy'
        ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
                        background:rgba(16,185,129,0.12);color:#10b981;border:1px solid rgba(16,185,129,0.25)">
             <i class="fa-solid fa-arrow-up" style="font-size:8px"></i> BUY
           </span>`
        : dir === 'sell'
          ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;
                          background:rgba(239,68,68,0.12);color:#ef4444;border:1px solid rgba(239,68,68,0.25)">
               <i class="fa-solid fa-arrow-down" style="font-size:8px"></i> SELL
             </span>`
          : `<span style="font-size:10px;color:var(--text-faint)">—</span>`;

      return `
        <tr data-sym="${sym}" style="transition:background 0.12s">
          <!-- Star -->
          <td style="padding:6px;text-align:center">
            <button onclick="WatchlistManager.toggleStar('${sym}')"
                    style="border:none;background:none;cursor:pointer;padding:4px;
                           color:${starred ? '#eab308' : 'var(--text-faint)'};font-size:14px"
                    title="${starred ? 'Unstar' : 'Star'}">
              <i class="${starred ? 'fa-solid' : 'fa-regular'} fa-star"></i>
            </button>
          </td>

          <!-- Symbol -->
          <td style="padding:8px 10px">
            <div style="display:flex;align-items:center;gap:7px">
              ${_logo(sym, 22)}
              <div>
                <div style="font-weight:700;font-size:13px;color:var(--text-primary);
                            cursor:pointer;line-height:1.2"
                     onclick="if(window.StockDetail) StockDetail.open('${sym}')">
                  ${sym}
                </div>
                <div style="font-size:9px;color:var(--accent-blue);font-weight:700;
                            text-transform:uppercase;letter-spacing:0.4px">
                  ${meta.sector}
                </div>
              </div>
            </div>
          </td>

          <!-- Price -->
          <td style="padding:8px 10px;font-family:var(--font-mono);font-size:12px;
                     font-weight:600;${cls}">
            ${price > 0
              ? formatCurrency(price, 2)
              : '<span style="color:var(--text-faint)">—</span>'}
          </td>

          <!-- Change % -->
          <td style="padding:8px 10px;font-family:var(--font-mono);font-size:11px;
                     font-weight:600;${cls}">
            ${price > 0
              ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`
              : '—'}
          </td>

          <!-- Score bar -->
          <td style="padding:8px 10px;min-width:120px">
            ${score > 0 ? `
              <div style="display:flex;align-items:center;gap:6px">
                <div style="flex:1;height:5px;border-radius:3px;
                            background:rgba(148,163,184,0.15);overflow:hidden">
                  <div style="width:${(score*100).toFixed(0)}%;height:100%;
                              background:${sColor};border-radius:3px;
                              transition:width 0.5s ease"></div>
                </div>
                <span style="font-size:10px;font-weight:700;font-family:var(--font-mono);
                             color:${sColor};min-width:38px">${score.toFixed(3)}</span>
              </div>` :
              '<span style="color:var(--text-faint);font-size:11px">—</span>'}
          </td>

          <!-- Direction -->
          <td style="padding:8px 10px">
            ${price > 0 ? dirBadge
            : '<span style="color:var(--text-faint);font-size:11px">—</span>'}
          </td>

          <!-- Buy Prob -->
          <td style="padding:8px 10px;font-family:var(--font-mono);font-size:11px;
                     color:var(--text-primary)">
            ${score > 0 ? `${(bp * 100).toFixed(1)}%` : '—'}
          </td>

          <!-- Regime -->
          <td style="padding:8px 10px">
            ${regime
              ? `<span style="font-size:10px;font-weight:700;padding:2px 7px;
                              border-radius:4px;background:rgba(59,130,246,0.1);
                              color:#3b82f6;border:1px solid rgba(59,130,246,0.2);
                              text-transform:uppercase">${regime}</span>`
              : '<span style="color:var(--text-faint);font-size:11px">—</span>'}
          </td>

          <!-- Council -->
          <td style="padding:8px 10px">
            ${council
              ? `<span style="font-size:10px;font-weight:700;color:${cColor}">
                   ${council.toUpperCase()}
                 </span>`
              : '<span style="color:var(--text-faint);font-size:11px">—</span>'}
          </td>

          <!-- Actions -->
          <td style="padding:6px 8px">
            <div style="display:flex;align-items:center;gap:4px">
              <!-- Detail -->
              <button class="btn-xs" title="View detail"
                      onclick="if(window.StockDetail) StockDetail.open('${sym}')">
                <i class="fa-solid fa-chart-bar"></i>
              </button>
              <!-- Trade -->
              <button class="btn-xs" title="Quick trade"
                      onclick="WatchlistManager._quickTrade('${sym}')">
                <i class="fa-solid fa-paper-plane"></i>
              </button>
              <!-- Remove -->
              <button title="Remove from watchlist"
                      onclick="WatchlistManager.removeSymbol('${sym}')"
                      style="border:none;background:none;cursor:pointer;padding:4px 6px;
                             color:var(--text-faint);border-radius:4px;font-size:12px;
                             transition:color 0.15s"
                      onmouseover="this.style.color='#ef4444'"
                      onmouseout="this.style.color='var(--text-faint)'">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </td>
        </tr>`;
    }).join('');

    _renderPagination(pages, total);
  }

  function _quickTrade(sym) {
    const selEl = document.getElementById('order-symbol');
    if (selEl) selEl.value = sym;
    const tradingPage = document.querySelector('[data-page="trading"]');
    if (tradingPage) window.location.href = 'trading.html?symbol=' + sym;
  }

  // ══════════════════════════════════════════════════════════
  // PAGINATION
  // ══════════════════════════════════════════════════════════
  function _renderPagination(pages, total) {
    const container = document.getElementById('wl-pagination');
    if (!container) return;

    if (pages <= 1) {
      container.innerHTML = `
        <span style="font-size:11px;color:var(--text-muted)">
          ${total} symbol${total !== 1 ? 's' : ''} · Page 1/1
        </span>`;
      return;
    }

    const startP = Math.max(1, _currentPage - 2);
    const endP   = Math.min(pages, startP + 4);

    container.innerHTML = `
      <button class="page-btn" data-pg="prev" ${_currentPage <= 1 ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      ${Array.from({ length: endP - startP + 1 }, (_, i) => startP + i)
        .map(p => `
          <button class="page-btn ${p === _currentPage ? 'active' : ''}"
                  data-pg="${p}">${p}</button>`).join('')}
      <button class="page-btn" data-pg="next" ${_currentPage >= pages ? 'disabled' : ''}>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
      <span style="font-size:11px;color:var(--text-muted);margin-left:4px">
        ${total} symbols · Page ${_currentPage}/${pages}
      </span>`;

    container.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const pg = btn.dataset.pg;
        if (pg === 'prev')      { if (_currentPage > 1) _currentPage--; }
        else if (pg === 'next') { if (_currentPage < pages) _currentPage++; }
        else                    { _currentPage = parseInt(pg); }
        render(_signalData);
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // SECTOR TABS
  // ══════════════════════════════════════════════════════════
  function _buildSectorTabs() {
    const container = document.getElementById('sector-tabs');
    if (!container) return;

    const sectors = ['All', 'Starred', ...Object.keys(UNIVERSE), 'Custom'];

    container.innerHTML = sectors.map(s => `
      <button class="sector-tab ${s === 'All' ? 'active' : ''}"
              data-sector="${s}"
              style="padding:5px 12px;border-radius:var(--radius-full);
                     font-size:11px;font-weight:600;border:1px solid var(--border);
                     background:${s === 'All' ? 'var(--gradient-brand)' : 'transparent'};
                     color:${s === 'All' ? '#fff' : 'var(--text-muted)'};
                     cursor:pointer;transition:all 0.15s;white-space:nowrap;flex-shrink:0">
        ${s === 'Starred'
          ? '<i class="fa-solid fa-star" style="font-size:9px;color:#eab308"></i> '
          : ''}${s}
        ${s === 'All'
          ? `<span style="font-size:9px;opacity:0.8;margin-left:3px">(${_watchlist.length})</span>`
          : ''}
      </button>`).join('');

    container.querySelectorAll('.sector-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sector-tab').forEach(b => {
          b.style.background = 'transparent';
          b.style.color      = 'var(--text-muted)';
          b.classList.remove('active');
        });
        btn.style.background = 'var(--gradient-brand)';
        btn.style.color      = '#fff';
        btn.classList.add('active');
        _currentSector = btn.dataset.sector;
        _currentPage   = 1;
        render(_signalData);
      });
    });
  }

  // ══════════════════════════════════════════════════════════
  // ADD FORM
  // ══════════════════════════════════════════════════════════
  function _buildAddForm() {
    const form = document.getElementById('wl-add-form');
    if (!form) return;

    form.addEventListener('submit', e => {
      e.preventDefault();
      const input = document.getElementById('wl-add-input');
      const sym   = (input?.value || '').trim().toUpperCase();
      if (sym) {
        const added = addSymbol(sym);
        if (added && input) input.value = '';
      }
    });
  }

  function _buildSearchBinding() {
    const el = document.getElementById('wl-search');
    if (!el) return;
    el.addEventListener('input', AVUtils.debounce(() => {
      _currentSearch = el.value.trim();
      _currentPage   = 1;
      render(_signalData);
    }, 200));
  }

  // ══════════════════════════════════════════════════════════
  // SYNC BAR UI
  // ══════════════════════════════════════════════════════════
  function _buildSyncBar() {
    const existing = document.getElementById('wl-sync-bar');
    if (existing) existing.remove();

    const anchor = document.querySelector('#sec-watchlist .av-table-wrapper')
                || document.querySelector('#sec-watchlist .card')
                || document.getElementById('watchlist-tbody')?.closest('.av-table-wrapper');
    if (!anchor) return;

    const bar = document.createElement('div');
    bar.id    = 'wl-sync-bar';
    bar.className = 'wl-sync-bar';
    bar.innerHTML = `
      <div class="wl-sync-dot ${_getSyncDotClass()}" id="wl-sync-dot"></div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <span id="wl-sync-text"
              style="font-size:12px;font-weight:600;color:var(--text-secondary)">
          ${_getSyncText()}
        </span>
        <span style="font-size:10px;color:var(--text-muted)">
          <i class="fa-solid fa-shield-halved" style="color:#10b981"></i>
          Secured via Cloudflare Worker — no credentials required
        </span>
      </div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:6px">
        <button class="btn-sm" id="wl-pull-btn" title="Pull from GitHub">
          <i class="fa-solid fa-cloud-arrow-down"></i> Pull
        </button>
        <button class="btn-sm" id="wl-push-btn" title="Push to GitHub">
          <i class="fa-solid fa-cloud-arrow-up"></i> Push
        </button>
        <button class="btn-sm" id="wl-clear-btn"
                style="color:#ef4444;border-color:rgba(239,68,68,0.3)"
                title="Clear all">
          <i class="fa-solid fa-trash"></i>
        </button>
      </div>`;

    anchor.parentElement?.insertBefore(bar, anchor);

    // Pull
    document.getElementById('wl-pull-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('wl-pull-btn');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      const ghData = await _loadFromGitHub();
      if (ghData && Array.isArray(ghData.watchlist)) {
        _watchlist     = ghData.watchlist;
        _starred       = Array.isArray(ghData.starred) ? ghData.starred : _starred;
        _syncTimestamp = ghData.updated_at
          ? new Date(ghData.updated_at).getTime() : Date.now();
        _syncStatus    = 'synced';
        _saveLocal();
        render(_signalData);
        _updateSyncUI();
        showToast(`Pulled ${_watchlist.length} symbols`, 'success');
      } else {
        showToast('Could not reach GitHub — check connection', 'error');
        _syncStatus = 'error';
        _updateSyncUI();
      }
      if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Pull';
    });

    // Push
    document.getElementById('wl-push-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('wl-push-btn');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      await _pushToGitHub();
      if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Push';
    });

    // Clear
    document.getElementById('wl-clear-btn')?.addEventListener('click', () => {
      showModal({
        title: 'Clear Watchlist',
        body:  `<div style="font-size:13px;color:var(--text-muted)">
                  Remove all ${_watchlist.length} symbols from your watchlist?
                </div>`,
        confirmText: 'Clear All',
        danger: true,
        onConfirm: () => clearAll(),
      });
    });
  }

  function _updateSyncUI() {
    const dot  = document.getElementById('wl-sync-dot');
    const text = document.getElementById('wl-sync-text');
    if (dot)  dot.className   = `wl-sync-dot ${_getSyncDotClass()}`;
    if (text) text.textContent = _getSyncText();
  }

  function _getSyncDotClass() {
    return { synced:'synced', loading:'loading', error:'error' }[_syncStatus] || 'local';
  }

  function _getSyncText() {
    switch (_syncStatus) {
      case 'synced': {
        const ago = _syncTimestamp
          ? Math.round((Date.now() - _syncTimestamp) / 60000) : 0;
        return `Synced with GitHub${ago > 0 ? ` (${ago}m ago)` : ' (just now)'}`;
      }
      case 'loading': return 'Syncing...';
      case 'error':   return 'Sync error — will retry automatically';
      default:        return 'Local only — push to sync across devices';
    }
  }

  // ══════════════════════════════════════════════════════════
  // LIVE DATA — via YahooFinance (stock-detail.js)
  // ══════════════════════════════════════════════════════════
  async function fetchLiveQuote(sym) {
    if (typeof window.YahooFinance === 'undefined') return null;
    try { return await YahooFinance.getQuote(sym); }
    catch(e) { return null; }
  }

  async function fetchNews(sym) {
    if (typeof window.YahooFinance === 'undefined') return [];
    try { return await YahooFinance.getNews(sym, 20); }
    catch(e) { return []; }
  }

  // ══════════════════════════════════════════════════════════
  // RESET FILTER
  // ══════════════════════════════════════════════════════════
  function resetFilter() {
    _currentSector = 'All';
    _currentSearch = '';
    _currentPage   = 1;
    const el = document.getElementById('wl-search');
    if (el) el.value = '';
    document.querySelectorAll('.sector-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.sector === 'All');
    });
    render(_signalData);
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════════════════════
  return {
    init,
    render,
    addSymbol,
    removeSymbol,
    toggleStar,
    isStarred,
    isInWatchlist,
    clearAll,
    resetFilter,
    fetchLiveQuote,
    fetchNews,
    _quickTrade,

    // Getters
    getWatchlist:  () => _watchlist,
    getStarred:    () => _starred,
    getAllSymbols:  () => ALL_SYMBOLS,
    getSymbolMeta: s  => SYMBOL_META[s] || { sector: 'Custom' },
    getUniverse:   () => UNIVERSE,
    getTotalCount: () => ALL_SYMBOLS.length,

    // Search state (pour compatibilité externe)
    get _currentSearch() { return _currentSearch; },
    set _currentSearch(v) { _currentSearch = v; },
    get _currentPage()   { return _currentPage; },
    set _currentPage(v)  { _currentPage = v; },
  };

})();

window.WatchlistManager = WatchlistManager;
console.log(`[av-watchlist] Loaded | ${WatchlistManager.getTotalCount()} symbols available`);