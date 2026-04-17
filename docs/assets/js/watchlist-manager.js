// ============================================================
// watchlist-manager.js — AlphaVault Quant v3.1
// ✅ Vide par défaut (aucun stock hardcodé)
// ✅ Persistance GitHub (Contents API via PAT)
// ✅ Chargement depuis docs/signals/watchlist.json (GitHub Pages)
// ✅ Boutons étoile + delete toujours visibles
// ✅ StockDetail.open() sur clic symbole
// ✅ Secteurs, pagination, recherche
// ============================================================

const WatchlistManager = (() => {

  // ── Config GitHub ─────────────────────────────────────────
  const GH_OWNER     = 'Raph33AI';
  const GH_REPO      = 'alphavault-quant';
  const GH_FILE_PATH = 'docs/signals/watchlist.json';

  // ── LocalStorage Keys ─────────────────────────────────────
  const LS_KEY     = 'av_watchlist_v3';
  const LS_STARRED = 'av_starred_v3';

  const PAGE_SIZE  = 50;

  // ── State ─────────────────────────────────────────────────
  let _currentPage    = 1;
  let _currentSector  = 'All';
  let _currentSearch  = '';
  let _signalData     = {};
  let _watchlist      = [];
  let _starred        = [];
  let _ghSaveTimeout  = null;

  // ── Universe (copie du UNIVERSE JS) ───────────────────────
  const UNIVERSE = {
    Technology:      ['AAPL','MSFT','NVDA','AVGO','ORCL','AMD','INTC','QCOM','TXN','AMAT','LRCX','KLAC','ADI','MU','ON','SWKS','CDNS','SNPS','FTNT','WDC','DELL','HPE','HPQ','EPAM'],
    'Software/Cloud':['CRM','ADBE','NOW','INTU','TEAM','WDAY','DDOG','SNOW','ZS','CRWD','OKTA','NET','HUBS','VEEV','MDB','CFLT','S','ASAN','GTLB','TWLO','ZM','DOCU','PAYC','PCTY','TTD','SHOP','MELI','SQ','AFRM','SOFI'],
    'Comm. Services':['GOOGL','GOOG','META','NFLX','DIS','CMCSA','VZ','T','TMUS','CHTR','LYV','EA','TTWO','SNAP','PINS','SPOT','PARA','WBD','MTCH','RBLX'],
    'Cons. Discret.':['AMZN','TSLA','HD','MCD','NKE','LOW','SBUX','BKNG','TJX','CMG','ORLY','AZO','ROST','DHI','LEN','MAR','HLT','GM','F','UBER','LYFT','ABNB','EXPE','CCL','RCL','DAL','UAL','RIVN','DKNG','MGM','WYNN'],
    'Cons. Staples': ['WMT','PG','KO','PEP','COST','PM','MO','MDLZ','CL','EL','KHC','GIS','HSY','CLX','KMB','TSN','HRL','STZ','KR'],
    Healthcare:      ['UNH','JNJ','LLY','ABBV','MRK','TMO','ABT','DHR','BMY','AMGN','MDT','ISRG','SYK','BSX','EW','REGN','GILD','VRTX','BIIB','MRNA','PFE','DXCM','HOLX','BDX','HUM','CI','CVS','ELV','CNC','MCK'],
    Financials:      ['JPM','BAC','WFC','GS','MS','BLK','SPGI','MCO','COF','AXP','V','MA','PYPL','SCHW','CB','PGR','ALL','TRV','MET','PRU','AFL','USB','PNC','TFC','STT','BK','CME','CBOE','ICE','NDAQ','MSCI','HOOD'],
    Industrials:     ['HON','UPS','RTX','CAT','DE','ETN','GE','LMT','NOC','GD','BA','MMM','EMR','ITW','ROK','PH','FAST','SWK','XYL','ROP','FDX','NSC','UNP','CSX','ODFL','GWW','URI','PCAR','CTAS','AXON'],
    Energy:          ['XOM','CVX','COP','EOG','MPC','VLO','PSX','HES','DVN','OXY','SLB','HAL','BKR','CTRA','EQT','FANG','MRO','KMI','WMB','OKE','LNG'],
    Materials:       ['LIN','APD','SHW','PPG','ECL','NEM','FCX','NUE','STLD','ALB','CF','MOS','VMC','MLM','GOLD','WPM','AA','X','CLF'],
    'Real Estate':   ['PLD','AMT','CCI','EQIX','SPG','O','WELL','EQR','AVB','ARE','BXP','IRM','SBAC','PSA','EXR','VICI'],
    Utilities:       ['NEE','DUK','SO','D','EXC','AEP','XEL','SRE','ED','ETR','PPL','DTE','FE','CMS','WEC','ES','AES','NRG'],
    'Crypto/Digital':['COIN','MSTR','RIOT','MARA','HUT','CLSK'],
    ETFs:            ['SPY','QQQ','IWM','DIA','VTI','VOO','IVV','EFA','EEM','GLD','SLV','TLT','HYG','LQD','VNQ','XLF','XLK','XLE','XLV','XLI','XLP','XLU','XLRE','XLC','XLB','XLY','XBI','IBB','SMH','SOXX','ARKK','ARKG','SOXL','TQQQ','SPXL','SQQQ','SH','BITO'],
    International:   ['TSM','ASML','SAP','NVO','TM','SONY','BABA','JD','NIO','LI','XPEV','RIO','BHP','VALE','AZN','GSK','BP','SHEL','SE'],
  };

  // Lookup flat
  const SYMBOL_META = {};
  const ALL_SYMBOLS_FLAT = [];
  Object.entries(UNIVERSE).forEach(([sector, stocks]) => {
    stocks.forEach(s => {
      if (!SYMBOL_META[s]) {
        SYMBOL_META[s] = { name: s, sector };
        ALL_SYMBOLS_FLAT.push(s);
      }
    });
  });

  // ════════════════════════════════════════════════════════
  // INIT
  // ════════════════════════════════════════════════════════
  async function init() {
    // 1. Essai chargement depuis GitHub Pages (watchlist.json)
    const ghData = await _loadFromGitHubPages();
    if (ghData) {
      _watchlist = Array.isArray(ghData.watchlist) ? ghData.watchlist : [];
      _starred   = Array.isArray(ghData.starred)   ? ghData.starred   : [];
      _saveLocal();
      console.log(`[WatchlistManager] Loaded from GitHub Pages | ${_watchlist.length} symbols`);
    } else {
      // 2. Fallback localStorage
      _loadLocal();
      console.log(`[WatchlistManager] Loaded from localStorage | ${_watchlist.length} symbols`);
    }

    _buildSectorTabs();
    _buildAddForm();
    _buildSearchBinding();

    console.log(`[WatchlistManager] Init done | ${_watchlist.length} symbols in watchlist | ${ALL_SYMBOLS_FLAT.length} universe`);
  }

  // ════════════════════════════════════════════════════════
  // PERSISTANCE LOCALE
  // ════════════════════════════════════════════════════════
  function _loadLocal() {
    try {
      const wl = localStorage.getItem(LS_KEY);
      const st = localStorage.getItem(LS_STARRED);
      _watchlist = wl ? JSON.parse(wl) : [];   // ✅ Vide par défaut
      _starred   = st ? JSON.parse(st) : [];
    } catch(e) {
      _watchlist = [];
      _starred   = [];
    }
  }

  function _saveLocal() {
    try {
      localStorage.setItem(LS_KEY,     JSON.stringify(_watchlist));
      localStorage.setItem(LS_STARRED, JSON.stringify(_starred));
    } catch(e) {}
  }

  // ════════════════════════════════════════════════════════
  // PERSISTANCE GITHUB
  // ════════════════════════════════════════════════════════
  async function _loadFromGitHubPages() {
    try {
      // ApiClient détecte automatiquement la base URL GitHub Pages
      const base = window.ApiClient ? ApiClient.getBase() : '/signals';
      const resp = await fetch(`${base}/watchlist.json?_=${Date.now()}`, {
        signal: AbortSignal.timeout(5000),
        cache:  'no-store',
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      if (data && (Array.isArray(data.watchlist) || Array.isArray(data.starred))) {
        return data;
      }
      return null;
    } catch(e) {
      return null;
    }
  }

  async function _pushToGitHub() {
    const pat = localStorage.getItem('av_gh_pat') || '';
    if (!pat || !pat.startsWith('ghp_')) {
      console.log('[WatchlistManager] No PAT — GitHub save skipped (use localStorage only)');
      return false;
    }

    const payload = {
      watchlist:  _watchlist,
      starred:    _starred,
      updated_at: new Date().toISOString(),
      n:          _watchlist.length,
    };

    // Encode en base64 UTF-8
    const content = btoa(unescape(encodeURIComponent(
      JSON.stringify(payload, null, 2)
    )));

    try {
      // Récupère le SHA actuel du fichier (requis pour la mise à jour)
      const getUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE_PATH}`;
      const headers = {
        'Authorization':        `Bearer ${pat}`,
        'Accept':               'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      let sha;
      const getResp = await fetch(getUrl, { headers, signal: AbortSignal.timeout(8000) });
      if (getResp.ok) {
        const existing = await getResp.json();
        sha = existing.sha;
      }

      // Écrit le fichier
      const body = {
        message: `Watchlist update — ${new Date().toISOString().slice(0, 16)} UTC`,
        content,
      };
      if (sha) body.sha = sha;

      const putResp = await fetch(getUrl, {
        method:  'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        signal:  AbortSignal.timeout(10000),
      });

      if (putResp.ok) {
        console.log(`[WatchlistManager] Saved to GitHub | ${_watchlist.length} symbols`);
        _showToast(`Watchlist saved to GitHub (${_watchlist.length} symbols)`, 'success');
        return true;
      } else {
        const err = await putResp.json().catch(() => ({}));
        console.warn(`[WatchlistManager] GitHub save failed: ${putResp.status} | ${err.message}`);
        return false;
      }
    } catch(e) {
      console.warn(`[WatchlistManager] GitHub save error: ${e.message}`);
      return false;
    }
  }

  // Debounce pour éviter trop d'appels API
  function _scheduleSave() {
    _saveLocal();
    clearTimeout(_ghSaveTimeout);
    _ghSaveTimeout = setTimeout(() => _pushToGitHub(), 2000);
  }

  // ════════════════════════════════════════════════════════
  // CRUD WATCHLIST
  // ════════════════════════════════════════════════════════
  function addSymbol(sym) {
    sym = sym.toUpperCase().trim().replace(/[^A-Z.]/g, '');
    if (!sym || sym.length > 10) {
      _showToast('Invalid symbol', 'warn');
      return false;
    }
    if (_watchlist.includes(sym)) {
      _showToast(`${sym} already in watchlist`, 'warn');
      return false;
    }

    _watchlist.unshift(sym);

    if (!SYMBOL_META[sym]) {
      SYMBOL_META[sym] = { name: sym, sector: 'Custom' };
      ALL_SYMBOLS_FLAT.push(sym);
    }

    _scheduleSave();
    _showToast(`${sym} added to watchlist`, 'success');
    render(_signalData);
    return true;
  }

  function removeSymbol(sym) {
    _watchlist = _watchlist.filter(s => s !== sym);
    _starred   = _starred.filter(s => s !== sym);
    _scheduleSave();
    _showToast(`${sym} removed`, 'info');
    render(_signalData);
  }

  function toggleStar(sym) {
    if (_starred.includes(sym)) {
      _starred = _starred.filter(s => s !== sym);
    } else {
      _starred.unshift(sym);
    }
    _scheduleSave();
    render(_signalData);
  }

  function isStarred(sym)    { return _starred.includes(sym); }
  function isInWatchlist(sym){ return _watchlist.includes(sym); }

  function resetToDefault() {
    _watchlist = [];
    _starred   = [];
    _scheduleSave();
    render(_signalData);
    _showToast('Watchlist cleared', 'info');
  }

  // ════════════════════════════════════════════════════════
  // RENDER
  // ════════════════════════════════════════════════════════
  function render(signalData = {}) {
    _signalData = signalData;
    const sigs  = signalData?.signals || signalData || {};

    const tbody = document.getElementById('watchlist-tbody');
    if (!tbody) return;

    // Filtrage + pagination
    let symbols = _getFilteredSymbols();
    const total = symbols.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    _currentPage = Math.min(_currentPage, Math.max(1, pages));
    const start  = (_currentPage - 1) * PAGE_SIZE;
    const display= symbols.slice(start, start + PAGE_SIZE);

    // Compteur
    const countEls = document.querySelectorAll('#wl-sym-count, #wl-count');
    countEls.forEach(el => {
      el.textContent = `${_watchlist.length} symbols`;
    });

    // Etat vide
    if (!_watchlist.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="loading-row">
        <i class="fa-solid fa-circle-info" style="color:var(--b1)"></i>
        Your watchlist is empty — add symbols using the form above.
      </td></tr>`;
      _renderPagination(0);
      return;
    }

    if (!display.length) {
      tbody.innerHTML = `<tr><td colspan="11" class="loading-row">
        No results for "<strong>${_currentSearch}</strong>"
      </td></tr>`;
      _renderPagination(pages);
      return;
    }

    // ── Render rows ─────────────────────────────────────
    tbody.innerHTML = display.map(sym => {
      const s       = sigs[sym] || {};
      const meta    = SYMBOL_META[sym] || { name: sym, sector: 'Custom' };
      const price   = parseFloat(s.price   || 0);
      const chg     = parseFloat(s.change_pct || s.change || 0);
      const score   = parseFloat(s.final_score || 0);
      const bp      = parseFloat(s.buy_prob   || 0.5);
      const dir     = s.direction || 'neutral';
      const council = s.council   || (price > 0 ? 'wait' : '');
      const regime  = (s.regime   || '').replace(/_/g, ' ');
      const cls     = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      const starred = isStarred(sym);

      // Score color
      const scolor  = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';
      const ccolor  = council.includes('execute') ? '#10b981'
                    : council === 'veto'           ? '#ef4444'
                    : '#f59e0b';

      // Direction badge
      const dirBadge = dir === 'buy'
        ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
        : dir === 'sell'
          ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
          : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i></span>`;

      // Council badge
      const councilBadge = council
        ? `<span style="font-size:11px;font-weight:700;color:${ccolor}">${council.toUpperCase()}</span>`
        : '<span style="color:var(--txt4);font-size:11px">—</span>';

      return `<tr data-sym="${sym}">
        <!-- ★ Star button — ALWAYS VISIBLE -->
        <td style="padding:8px 6px;text-align:center">
          <button class="btn-wl-star ${starred ? 'starred' : ''}"
                  data-star="${sym}" title="${starred ? 'Unstar' : 'Star'}">
            <i class="${starred ? 'fa-solid' : 'fa-regular'} fa-star"></i>
          </button>
        </td>

        <!-- Symbol + Sector -->
        <td style="padding:8px 10px">
          <div style="display:flex;flex-direction:column;gap:2px">
            <strong class="sym-link wl-open-detail" data-sym="${sym}"
                    style="cursor:pointer;color:var(--txt);font-size:13px">
              ${sym}
            </strong>
            <span style="font-size:9px;color:var(--b1);font-weight:700">${meta.sector}</span>
          </div>
        </td>

        <!-- Name -->
        <td><span class="muted-sm">${meta.name}</span></td>

        <!-- Price -->
        <td class="mono ${cls}" style="font-size:13px;font-weight:600">
          ${price > 0 ? `$${price.toFixed(2)}` : '<span style="color:var(--txt4)">—</span>'}
        </td>

        <!-- % Change -->
        <td class="mono ${cls}" style="font-size:12px;font-weight:600">
          ${price > 0 ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
        </td>

        <!-- Score bar -->
        <td style="padding:8px 10px">
          ${score > 0 ? `
            <div style="display:flex;align-items:center;gap:6px">
              <div class="score-bar-inline">
                <div class="sbi-fill" style="width:${(score*100).toFixed(0)}%;background:${scolor}"></div>
              </div>
              <span class="mono" style="color:${scolor};font-size:11px">${score.toFixed(3)}</span>
            </div>` :
            '<span style="color:var(--txt4);font-size:11px">—</span>'
          }
        </td>

        <!-- Direction -->
        <td>${price > 0 ? dirBadge : '<span style="color:var(--txt4);font-size:11px">—</span>'}</td>

        <!-- Buy Prob -->
        <td class="mono" style="font-size:12px">
          ${score > 0 ? `${(bp*100).toFixed(1)}%` : '—'}
        </td>

        <!-- Regime -->
        <td>
          ${regime
            ? `<span class="regime-chip">${regime}</span>`
            : '<span style="color:var(--txt4);font-size:11px">—</span>'}
        </td>

        <!-- Council -->
        <td>${councilBadge}</td>

        <!-- Actions — ALWAYS VISIBLE -->
        <td style="padding:6px 8px">
          <div style="display:flex;align-items:center;gap:4px">
            <button class="btn-xs wl-open-detail" data-sym="${sym}"
                    title="Open detail panel"
                    style="display:flex;align-items:center;gap:3px;padding:4px 8px">
              <i class="fa-solid fa-chart-bar"></i>
            </button>
            <button class="btn-xs wl-quick-chart" data-sym="${sym}"
                    title="View in main chart"
                    style="display:flex;align-items:center;gap:3px;padding:4px 8px">
              <i class="fa-solid fa-chart-line"></i>
            </button>
            <button class="btn-xs wl-trade" data-sym="${sym}"
                    title="Trade"
                    style="display:flex;align-items:center;gap:3px;padding:4px 8px">
              <i class="fa-solid fa-paper-plane"></i>
            </button>
            <button class="btn-wl-remove" data-remove="${sym}" title="Remove from watchlist">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');

    // ── Bind events ──────────────────────────────────────
    // Star buttons
    tbody.querySelectorAll('[data-star]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleStar(btn.dataset.star);
      });
    });

    // Delete buttons
    tbody.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeSymbol(btn.dataset.remove);
      });
    });

    // Open StockDetail (full-page panel)
    tbody.querySelectorAll('.wl-open-detail').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const sym = btn.dataset.sym;
        if (window.StockDetail) {
          StockDetail.open(sym);
        } else {
          console.error('[WatchlistManager] StockDetail not available');
        }
      });
    });

    // Quick chart (overview)
    tbody.querySelectorAll('.wl-quick-chart').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.Terminal) {
          Terminal.loadChartSymbol(btn.dataset.sym);
          Terminal.showSection('overview');
        }
      });
    });

    // Trade button
    tbody.querySelectorAll('.wl-trade').forEach(btn => {
      btn.addEventListener('click', () => {
        const sel = document.getElementById('order-symbol');
        if (sel) sel.value = btn.dataset.sym;
        if (window.Terminal) Terminal.showSection('execution');
      });
    });

    _renderPagination(pages);
  }

  // ════════════════════════════════════════════════════════
  // FILTERED SYMBOLS
  // ════════════════════════════════════════════════════════
  function _getFilteredSymbols() {
    let symbols = [..._watchlist];

    // Starred first
    symbols.sort((a, b) => (isStarred(b) ? 1 : 0) - (isStarred(a) ? 1 : 0));

    // Sector filter
    if (_currentSector === 'Starred') {
      symbols = symbols.filter(s => isStarred(s));
    } else if (_currentSector !== 'All') {
      symbols = symbols.filter(s =>
        (SYMBOL_META[s]?.sector || 'Custom') === _currentSector
      );
    }

    // Search filter
    if (_currentSearch) {
      const q = _currentSearch.toLowerCase();
      symbols = symbols.filter(s =>
        s.toLowerCase().includes(q) ||
        (SYMBOL_META[s]?.name || '').toLowerCase().includes(q) ||
        (SYMBOL_META[s]?.sector || '').toLowerCase().includes(q)
      );
    }

    return symbols;
  }

  // ════════════════════════════════════════════════════════
  // SECTOR TABS
  // ════════════════════════════════════════════════════════
  function _buildSectorTabs() {
    const container = document.getElementById('sector-tabs');
    if (!container) return;

    const sectors = ['All', 'Starred', ...Object.keys(UNIVERSE), 'Custom'];
    container.innerHTML = sectors.map(s => `
      <button class="sector-tab ${s === 'All' ? 'active' : ''}" data-sector="${s}">
        ${s === 'Starred' ? '<i class="fa-solid fa-star" style="font-size:9px"></i> ' : ''}${s}
        ${s === 'All' ? `<span style="font-size:9px;color:rgba(255,255,255,0.7);margin-left:2px">(${_watchlist.length})</span>` : ''}
      </button>`).join('');

    container.querySelectorAll('.sector-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.sector-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _currentSector = btn.dataset.sector;
        _currentPage   = 1;
        render(_signalData);
      });
    });
  }

  // ════════════════════════════════════════════════════════
  // ADD FORM + SEARCH
  // ════════════════════════════════════════════════════════
  function _buildAddForm() {
    const form = document.getElementById('wl-add-form');
    if (!form) return;

    form.addEventListener('submit', async e => {
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
    const searchEl = document.getElementById('wl-search');
    if (!searchEl) return;
    searchEl.addEventListener('input', () => {
      _currentSearch = searchEl.value.trim();
      _currentPage   = 1;
      render(_signalData);
    });
  }

  // ════════════════════════════════════════════════════════
  // PAGINATION
  // ════════════════════════════════════════════════════════
  function _renderPagination(pages) {
    const container = document.getElementById('wl-pagination');
    if (!container) return;

    if (pages <= 1) {
      container.innerHTML = '';
      return;
    }

    const items = [];
    items.push(`<button class="wl-page-btn" id="wl-prev" ${_currentPage <= 1 ? 'disabled' : ''}>
      <i class="fa-solid fa-chevron-left"></i>
    </button>`);

    const startP = Math.max(1, _currentPage - 3);
    const endP   = Math.min(pages, startP + 6);
    for (let i = startP; i <= endP; i++) {
      items.push(`<button class="wl-page-btn ${i === _currentPage ? 'active' : ''}" data-pg="${i}">${i}</button>`);
    }

    items.push(`<button class="wl-page-btn" id="wl-next" ${_currentPage >= pages ? 'disabled' : ''}>
      <i class="fa-solid fa-chevron-right"></i>
    </button>`);
    items.push(`<span style="font-size:11px;color:var(--txt4)">
      ${_watchlist.length} symbols · Page ${_currentPage}/${pages}
    </span>`);

    container.innerHTML = items.join('');

    container.querySelectorAll('[data-pg]').forEach(btn => {
      btn.addEventListener('click', () => { _currentPage = parseInt(btn.dataset.pg); render(_signalData); });
    });
    document.getElementById('wl-prev')?.addEventListener('click', () => { _currentPage--; render(_signalData); });
    document.getElementById('wl-next')?.addEventListener('click', () => { _currentPage++; render(_signalData); });
  }

  // ════════════════════════════════════════════════════════
  // LIVE DATA (inchangé)
  // ════════════════════════════════════════════════════════
  const _liveCache = {};

  async function fetchLiveQuote(sym) {
    if (_liveCache[sym] && (Date.now() - _liveCache[sym].ts) < 60000) {
      return _liveCache[sym].data;
    }
    try {
      const data = await YahooFinance.getQuote(sym);
      if (data) _liveCache[sym] = { data, ts: Date.now() };
      return data;
    } catch(e) { return null; }
  }

  async function fetchNews(sym) {
    try { return await YahooFinance.getNews(sym); } catch(e) { return []; }
  }

  async function fetchFinancials(sym) {
    try { return await YahooFinance.getFinancials(sym); } catch(e) { return null; }
  }

  // ════════════════════════════════════════════════════════
  // UTILS
  // ════════════════════════════════════════════════════════
  function resetFilter() {
    _currentSector = 'All';
    _currentSearch = '';
    _currentPage   = 1;
    const searchEl = document.getElementById('wl-search');
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('.sector-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.sector === 'All');
    });
    render(_signalData);
  }

  function _showToast(msg, type = 'info') {
    const wrap = document.getElementById('toast-wrap');
    if (!wrap) return;
    const icons = { success:'fa-circle-check', warn:'fa-triangle-exclamation',
                    info:'fa-circle-info', error:'fa-circle-exclamation' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type]||'fa-info'}"></i> ${msg}`;
    wrap.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
  }

  // ════════════════════════════════════════════════════════
  // PUBLIC API
  // ════════════════════════════════════════════════════════
  return {
    init,
    render,
    addSymbol,
    removeSymbol,
    toggleStar,
    isStarred,
    isInWatchlist,
    resetToDefault,
    resetFilter,
    fetchLiveQuote,
    fetchNews,
    fetchFinancials,

    // State getters
    getWatchlist:  () => _watchlist,
    getStarred:    () => _starred,
    getAllSymbols:  () => ALL_SYMBOLS_FLAT,
    getSymbolMeta: (s) => SYMBOL_META[s] || { name: s, sector: 'Custom' },
    getUniverse:   () => UNIVERSE,
    getTotalCount: () => ALL_SYMBOLS_FLAT.length,

    // Search state (accessible par terminal.js)
    get _currentSearch() { return _currentSearch; },
    set _currentSearch(v) { _currentSearch = v; },
    get _currentPage()   { return _currentPage; },
    set _currentPage(v)  { _currentPage = v; },
  };

})();

window.WatchlistManager = WatchlistManager;
console.log(`[WatchlistManager] Loaded | ${WatchlistManager.getTotalCount()} symbols available`);