// // ============================================================
// // watchlist-manager.js — AlphaVault Quant v3.1
// // ✅ Vide par défaut (aucun stock hardcodé)
// // ✅ Persistance GitHub (Contents API via PAT)
// // ✅ Chargement depuis docs/signals/watchlist.json (GitHub Pages)
// // ✅ Boutons étoile + delete toujours visibles
// // ✅ StockDetail.open() sur clic symbole
// // ✅ Secteurs, pagination, recherche
// // ============================================================

// const WatchlistManager = (() => {

//   // ── Config GitHub ─────────────────────────────────────────
//   const GH_OWNER     = 'Raph33AI';
//   const GH_REPO      = 'alphavault-quant';
//   const GH_FILE_PATH = 'docs/signals/watchlist.json';

//   // ── LocalStorage Keys ─────────────────────────────────────
//   const LS_KEY     = 'av_watchlist_v3';
//   const LS_STARRED = 'av_starred_v3';

//   const PAGE_SIZE  = 50;

//   // ════════════════════════════════════════════════════════
//     // LOGO HELPER (utilise window._getLogoHtml si disponible)
//     // ════════════════════════════════════════════════════════
//     function _logoHtml(sym, size = 20) {
//     // Utilise la fonction définie dans terminal.js si disponible
//     if (typeof window._getLogoHtml === 'function') {
//         return window._getLogoHtml(sym, size);
//     }
//     // Fallback simple : badge initial
//     return `<span class="sym-initial-badge"
//                     style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.4)}px">${sym.charAt(0)}</span>`;
//     }

//   // ── State ─────────────────────────────────────────────────
//   let _currentPage    = 1;
//   let _currentSector  = 'All';
//   let _currentSearch  = '';
//   let _signalData     = {};
//   let _watchlist      = [];
//   let _starred        = [];
//   let _ghSaveTimeout  = null;
//   let _syncTimestamp  = 0;      // Timestamp de la dernière sync GitHub réussie
//   let _syncStatus     = 'local'; // 'local' | 'synced' | 'error' | 'loading'

//   // ── Universe (copie du UNIVERSE JS) ───────────────────────
//   const UNIVERSE = {
//     Technology:      ['AAPL','MSFT','NVDA','AVGO','ORCL','AMD','INTC','QCOM','TXN','AMAT','LRCX','KLAC','ADI','MU','ON','SWKS','CDNS','SNPS','FTNT','WDC','DELL','HPE','HPQ','EPAM'],
//     'Software/Cloud':['CRM','ADBE','NOW','INTU','TEAM','WDAY','DDOG','SNOW','ZS','CRWD','OKTA','NET','HUBS','VEEV','MDB','CFLT','S','ASAN','GTLB','TWLO','ZM','DOCU','PAYC','PCTY','TTD','SHOP','MELI','SQ','AFRM','SOFI'],
//     'Comm. Services':['GOOGL','GOOG','META','NFLX','DIS','CMCSA','VZ','T','TMUS','CHTR','LYV','EA','TTWO','SNAP','PINS','SPOT','PARA','WBD','MTCH','RBLX'],
//     'Cons. Discret.':['AMZN','TSLA','HD','MCD','NKE','LOW','SBUX','BKNG','TJX','CMG','ORLY','AZO','ROST','DHI','LEN','MAR','HLT','GM','F','UBER','LYFT','ABNB','EXPE','CCL','RCL','DAL','UAL','RIVN','DKNG','MGM','WYNN'],
//     'Cons. Staples': ['WMT','PG','KO','PEP','COST','PM','MO','MDLZ','CL','EL','KHC','GIS','HSY','CLX','KMB','TSN','HRL','STZ','KR'],
//     Healthcare:      ['UNH','JNJ','LLY','ABBV','MRK','TMO','ABT','DHR','BMY','AMGN','MDT','ISRG','SYK','BSX','EW','REGN','GILD','VRTX','BIIB','MRNA','PFE','DXCM','HOLX','BDX','HUM','CI','CVS','ELV','CNC','MCK'],
//     Financials:      ['JPM','BAC','WFC','GS','MS','BLK','SPGI','MCO','COF','AXP','V','MA','PYPL','SCHW','CB','PGR','ALL','TRV','MET','PRU','AFL','USB','PNC','TFC','STT','BK','CME','CBOE','ICE','NDAQ','MSCI','HOOD'],
//     Industrials:     ['HON','UPS','RTX','CAT','DE','ETN','GE','LMT','NOC','GD','BA','MMM','EMR','ITW','ROK','PH','FAST','SWK','XYL','ROP','FDX','NSC','UNP','CSX','ODFL','GWW','URI','PCAR','CTAS','AXON'],
//     Energy:          ['XOM','CVX','COP','EOG','MPC','VLO','PSX','HES','DVN','OXY','SLB','HAL','BKR','CTRA','EQT','FANG','MRO','KMI','WMB','OKE','LNG'],
//     Materials:       ['LIN','APD','SHW','PPG','ECL','NEM','FCX','NUE','STLD','ALB','CF','MOS','VMC','MLM','GOLD','WPM','AA','X','CLF'],
//     'Real Estate':   ['PLD','AMT','CCI','EQIX','SPG','O','WELL','EQR','AVB','ARE','BXP','IRM','SBAC','PSA','EXR','VICI'],
//     Utilities:       ['NEE','DUK','SO','D','EXC','AEP','XEL','SRE','ED','ETR','PPL','DTE','FE','CMS','WEC','ES','AES','NRG'],
//     'Crypto/Digital':['COIN','MSTR','RIOT','MARA','HUT','CLSK'],
//     ETFs:            ['SPY','QQQ','IWM','DIA','VTI','VOO','IVV','EFA','EEM','GLD','SLV','TLT','HYG','LQD','VNQ','XLF','XLK','XLE','XLV','XLI','XLP','XLU','XLRE','XLC','XLB','XLY','XBI','IBB','SMH','SOXX','ARKK','ARKG','SOXL','TQQQ','SPXL','SQQQ','SH','BITO'],
//     International:   ['TSM','ASML','SAP','NVO','TM','SONY','BABA','JD','NIO','LI','XPEV','RIO','BHP','VALE','AZN','GSK','BP','SHEL','SE'],
//   };

//   // Lookup flat
//   const SYMBOL_META = {};
//   const ALL_SYMBOLS_FLAT = [];
//   Object.entries(UNIVERSE).forEach(([sector, stocks]) => {
//     stocks.forEach(s => {
//       if (!SYMBOL_META[s]) {
//         SYMBOL_META[s] = { name: s, sector };
//         ALL_SYMBOLS_FLAT.push(s);
//       }
//     });
//   });

//   // ════════════════════════════════════════════════════════
//   // INIT
//   // ════════════════════════════════════════════════════════
//   async function init() {
//     // 1. Essai chargement depuis GitHub Pages (source de vérité cross-device)
//     const ghData = await _loadFromGitHubPages();
//     if (ghData) {
//       _watchlist     = Array.isArray(ghData.watchlist) ? ghData.watchlist : [];
//       _starred       = Array.isArray(ghData.starred)   ? ghData.starred   : [];
//       _syncTimestamp = ghData.updated_at ? new Date(ghData.updated_at).getTime() : Date.now();
//       _syncStatus    = 'synced';
//       _saveLocal();
//       console.log(`[WatchlistManager] ✅ Loaded from GitHub Pages | ${_watchlist.length} symbols`);
//     } else {
//       // 2. Fallback localStorage (device-local)
//       _loadLocal();
//       _syncStatus = 'local';
//       console.log(`[WatchlistManager] ⚠ GitHub Pages unavailable — loaded from localStorage | ${_watchlist.length} symbols`);
//     }

//     _buildSectorTabs();
//     _buildAddForm();
//     _buildSearchBinding();
//     _buildSyncUI();  // ← NOUVEAU : UI de sync dans la toolbar

//     // ── Sync automatique quand l'utilisateur revient sur l'onglet ──
//     document.addEventListener('visibilitychange', () => {
//       if (!document.hidden) {
//         _autoSyncFromGitHub();
//       }
//     });

//     // ── Sync toutes les 5 minutes si PAT disponible ───────────
//     setInterval(() => {
//       const pat = localStorage.getItem('av_gh_pat') || '';
//       if (pat.startsWith('ghp_')) {
//         _autoSyncFromGitHub();
//       }
//     }, 5 * 60 * 1000);

//     console.log(`[WatchlistManager] Init done | ${_watchlist.length} symbols | sync:${_syncStatus}`);
//   }

//   // ════════════════════════════════════════════════════════
//   // PERSISTANCE LOCALE
//   // ════════════════════════════════════════════════════════
//   function _loadLocal() {
//     try {
//       const wl = localStorage.getItem(LS_KEY);
//       const st = localStorage.getItem(LS_STARRED);
//       _watchlist = wl ? JSON.parse(wl) : [];   // ✅ Vide par défaut
//       _starred   = st ? JSON.parse(st) : [];
//     } catch(e) {
//       _watchlist = [];
//       _starred   = [];
//     }
//   }

//   function _saveLocal() {
//     try {
//       localStorage.setItem(LS_KEY,     JSON.stringify(_watchlist));
//       localStorage.setItem(LS_STARRED, JSON.stringify(_starred));
//     } catch(e) {}
//   }

//   // ════════════════════════════════════════════════════════
//   // PERSISTANCE GITHUB
//   // ════════════════════════════════════════════════════════
//   async function _loadFromGitHubPages() {
//     try {
//       const base = window.ApiClient ? ApiClient.getBase() : '/signals';
//       // Essai 1 : GitHub Pages public URL
//       const urls = [
//         `${base}/watchlist.json?_=${Date.now()}`,
//         `https://raw.githubusercontent.com/${GH_OWNER}/${GH_REPO}/main/docs/signals/watchlist.json?_=${Date.now()}`,
//       ];

//       for (const url of urls) {
//         try {
//           const resp = await fetch(url, {
//             signal: AbortSignal.timeout(6000),
//             cache:  'no-store',
//           });
//           if (!resp.ok) continue;
//           const data = await resp.json();
//           if (data && (Array.isArray(data.watchlist) || Array.isArray(data.starred))) {
//             console.log(`[WatchlistManager] GitHub source: ${url}`);
//             return data;
//           }
//         } catch(e) {}
//       }
//       return null;
//     } catch(e) {
//       return null;
//     }
//   }

//   async function _autoSyncFromGitHub() {
//     try {
//       const ghData = await _loadFromGitHubPages();
//       if (!ghData) return;

//       const ghTime = ghData.updated_at ? new Date(ghData.updated_at).getTime() : 0;

//       // Sync seulement si GitHub est plus récent que notre dernière sync
//       if (ghTime > _syncTimestamp && Array.isArray(ghData.watchlist)) {
//         const prevLen  = _watchlist.length;
//         _watchlist     = ghData.watchlist;
//         _starred       = Array.isArray(ghData.starred) ? ghData.starred : _starred;
//         _syncTimestamp = ghTime;
//         _syncStatus    = 'synced';
//         _saveLocal();
//         render(_signalData);
//         _updateSyncUI();

//         if (_watchlist.length !== prevLen) {
//           _showToast(`Watchlist synced from GitHub (${_watchlist.length} symbols)`, 'info');
//         }
//       }
//     } catch(e) {}
//   }

//   async function _pushToGitHub() {
//     const pat = localStorage.getItem('av_gh_pat') || '';
//     if (!pat || !pat.startsWith('ghp_')) {
//       _syncStatus = 'local';
//       _updateSyncUI();
//       console.log('[WatchlistManager] No PAT — enter it in the watchlist sync bar to enable cross-device sync.');
//       return false;
//     }

//     _syncStatus = 'loading';
//     _updateSyncUI();

//     const payload = {
//       watchlist:  _watchlist,
//       starred:    _starred,
//       updated_at: new Date().toISOString(),
//       n:          _watchlist.length,
//       device:     navigator.userAgent.slice(0, 50),
//     };

//     const content = btoa(unescape(encodeURIComponent(
//       JSON.stringify(payload, null, 2)
//     )));

//     try {
//       const getUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE_PATH}`;
//       const headers = {
//         'Authorization':        `Bearer ${pat}`,
//         'Accept':               'application/vnd.github.v3+json',
//         'X-GitHub-Api-Version': '2022-11-28',
//       };

//       let sha;
//       const getResp = await fetch(getUrl, { headers, signal: AbortSignal.timeout(8000) });
//       if (getResp.ok) {
//         const existing = await getResp.json();
//         sha = existing.sha;
//       } else if (getResp.status === 401) {
//         // PAT invalide
//         localStorage.removeItem('av_gh_pat');
//         _syncStatus = 'error';
//         _updateSyncUI();
//         _showToast('GitHub PAT invalid or expired — please re-enter', 'error');
//         return false;
//       }

//       const body = {
//         message: `Watchlist update — ${new Date().toISOString().slice(0, 16)} UTC (${_watchlist.length} symbols)`,
//         content,
//       };
//       if (sha) body.sha = sha;

//       const putResp = await fetch(getUrl, {
//         method:  'PUT',
//         headers: { ...headers, 'Content-Type': 'application/json' },
//         body:    JSON.stringify(body),
//         signal:  AbortSignal.timeout(12000),
//       });

//       if (putResp.ok) {
//         _syncTimestamp = Date.now();
//         _syncStatus    = 'synced';
//         _updateSyncUI();
//         console.log(`[WatchlistManager] ✅ Saved to GitHub | ${_watchlist.length} symbols`);
//         _showToast(`Watchlist synced to GitHub (${_watchlist.length} symbols)`, 'success');
//         return true;
//       } else {
//         const err = await putResp.json().catch(() => ({}));
//         console.warn(`[WatchlistManager] GitHub save failed: ${putResp.status} | ${err.message}`);
//         _syncStatus = 'error';
//         _updateSyncUI();
//         return false;
//       }
//     } catch(e) {
//       console.warn(`[WatchlistManager] GitHub save error: ${e.message}`);
//       _syncStatus = 'error';
//       _updateSyncUI();
//       return false;
//     }
//   }

//   // Debounce pour éviter trop d'appels API
//   function _scheduleSave() {
//     _saveLocal();
//     clearTimeout(_ghSaveTimeout);
//     _ghSaveTimeout = setTimeout(() => _pushToGitHub(), 2000);
//   }

//   // ════════════════════════════════════════════════════════
//   // CRUD WATCHLIST
//   // ════════════════════════════════════════════════════════
//   function addSymbol(sym) {
//     sym = sym.toUpperCase().trim().replace(/[^A-Z.]/g, '');
//     if (!sym || sym.length > 10) {
//       _showToast('Invalid symbol', 'warn');
//       return false;
//     }
//     if (_watchlist.includes(sym)) {
//       _showToast(`${sym} already in watchlist`, 'warn');
//       return false;
//     }

//     _watchlist.unshift(sym);

//     if (!SYMBOL_META[sym]) {
//       SYMBOL_META[sym] = { name: sym, sector: 'Custom' };
//       ALL_SYMBOLS_FLAT.push(sym);
//     }

//     _scheduleSave();
//     _showToast(`${sym} added to watchlist`, 'success');
//     render(_signalData);
//     return true;
//   }

//   function removeSymbol(sym) {
//     _watchlist = _watchlist.filter(s => s !== sym);
//     _starred   = _starred.filter(s => s !== sym);
//     _scheduleSave();
//     _showToast(`${sym} removed`, 'info');
//     render(_signalData);
//   }

//   function toggleStar(sym) {
//     if (_starred.includes(sym)) {
//       _starred = _starred.filter(s => s !== sym);
//     } else {
//       _starred.unshift(sym);
//     }
//     _scheduleSave();
//     render(_signalData);
//   }

//   function isStarred(sym)    { return _starred.includes(sym); }
//   function isInWatchlist(sym){ return _watchlist.includes(sym); }

//   function resetToDefault() {
//     _watchlist = [];
//     _starred   = [];
//     _scheduleSave();
//     render(_signalData);
//     _showToast('Watchlist cleared', 'info');
//   }

//   // ════════════════════════════════════════════════════════
//   // RENDER
//   // ════════════════════════════════════════════════════════
//   function render(signalData = {}) {
//     _signalData = signalData;
//     const sigs  = signalData?.signals || signalData || {};

//     const tbody = document.getElementById('watchlist-tbody');
//     if (!tbody) return;

//     // Filtrage + pagination
//     let symbols = _getFilteredSymbols();
//     const total = symbols.length;
//     const pages = Math.ceil(total / PAGE_SIZE);
//     _currentPage = Math.min(_currentPage, Math.max(1, pages));
//     const start  = (_currentPage - 1) * PAGE_SIZE;
//     const display= symbols.slice(start, start + PAGE_SIZE);

//     // Compteur
//     const countEls = document.querySelectorAll('#wl-sym-count, #wl-count');
//     countEls.forEach(el => {
//       el.textContent = `${_watchlist.length} symbols`;
//     });

//     // Etat vide
//     if (!_watchlist.length) {
//       tbody.innerHTML = `<tr><td colspan="11" class="loading-row">
//         <i class="fa-solid fa-circle-info" style="color:var(--b1)"></i>
//         Your watchlist is empty — add symbols using the form above.
//       </td></tr>`;
//       _renderPagination(0);
//       return;
//     }

//     if (!display.length) {
//       tbody.innerHTML = `<tr><td colspan="11" class="loading-row">
//         No results for "<strong>${_currentSearch}</strong>"
//       </td></tr>`;
//       _renderPagination(pages);
//       return;
//     }

//     // ── Render rows ─────────────────────────────────────
//     tbody.innerHTML = display.map(sym => {
//       const s       = sigs[sym] || {};
//       const meta    = SYMBOL_META[sym] || { name: sym, sector: 'Custom' };
//       const price   = parseFloat(s.price   || 0);
//       const chg     = parseFloat(s.change_pct || s.change || 0);
//       const score   = parseFloat(s.final_score || 0);
//       const bp      = parseFloat(s.buy_prob   || 0.5);
//       const dir     = s.direction || 'neutral';
//       const council = s.council   || (price > 0 ? 'wait' : '');
//       const regime  = (s.regime   || '').replace(/_/g, ' ');
//       const cls     = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
//       const starred = isStarred(sym);

//       // Score color
//       const scolor  = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';
//       const ccolor  = council.includes('execute') ? '#10b981'
//                     : council === 'veto'           ? '#ef4444'
//                     : '#f59e0b';

//       // Direction badge
//       const dirBadge = dir === 'buy'
//         ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
//         : dir === 'sell'
//           ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
//           : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i></span>`;

//       // Council badge
//       const councilBadge = council
//         ? `<span style="font-size:11px;font-weight:700;color:${ccolor}">${council.toUpperCase()}</span>`
//         : '<span style="color:var(--txt4);font-size:11px">—</span>';

//       return `<tr data-sym="${sym}">
//         <!-- ★ Star button — ALWAYS VISIBLE -->
//         <td style="padding:8px 6px;text-align:center">
//           <button class="btn-wl-star ${starred ? 'starred' : ''}"
//                   data-star="${sym}" title="${starred ? 'Unstar' : 'Star'}">
//             <i class="${starred ? 'fa-solid' : 'fa-regular'} fa-star"></i>
//           </button>
//         </td>

//         <!-- Symbol + Sector -->
//         <td style="padding:8px 10px">
//             <div style="display:flex;align-items:center;gap:7px">
//                 ${_logoHtml(sym, 22)}
//                 <div style="display:flex;flex-direction:column;gap:1px">
//                 <strong class="sym-link wl-open-detail" data-sym="${sym}"
//                         style="cursor:pointer;color:var(--txt);font-size:13px;line-height:1.2">
//                     ${sym}
//                 </strong>
//                 <span style="font-size:9px;color:var(--b1);font-weight:700">${meta.sector}</span>
//                 </div>
//             </div>
//         </td>

//         <!-- Name -->
//         <td><span class="muted-sm">${meta.name}</span></td>

//         <!-- Price -->
//         <td class="mono ${cls}" style="font-size:13px;font-weight:600">
//           ${price > 0 ? `$${price.toFixed(2)}` : '<span style="color:var(--txt4)">—</span>'}
//         </td>

//         <!-- % Change -->
//         <td class="mono ${cls}" style="font-size:12px;font-weight:600">
//           ${price > 0 ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
//         </td>

//         <!-- Score bar -->
//         <td style="padding:8px 10px">
//           ${score > 0 ? `
//             <div style="display:flex;align-items:center;gap:6px">
//               <div class="score-bar-inline">
//                 <div class="sbi-fill" style="width:${(score*100).toFixed(0)}%;background:${scolor}"></div>
//               </div>
//               <span class="mono" style="color:${scolor};font-size:11px">${score.toFixed(3)}</span>
//             </div>` :
//             '<span style="color:var(--txt4);font-size:11px">—</span>'
//           }
//         </td>

//         <!-- Direction -->
//         <td>${price > 0 ? dirBadge : '<span style="color:var(--txt4);font-size:11px">—</span>'}</td>

//         <!-- Buy Prob -->
//         <td class="mono" style="font-size:12px">
//           ${score > 0 ? `${(bp*100).toFixed(1)}%` : '—'}
//         </td>

//         <!-- Regime -->
//         <td>
//           ${regime
//             ? `<span class="regime-chip">${regime}</span>`
//             : '<span style="color:var(--txt4);font-size:11px">—</span>'}
//         </td>

//         <!-- Council -->
//         <td>${councilBadge}</td>

//         <!-- Actions — ALWAYS VISIBLE -->
//         <td style="padding:6px 8px">
//           <div style="display:flex;align-items:center;gap:4px">
//             <button class="btn-xs wl-open-detail" data-sym="${sym}"
//                     title="Open detail panel"
//                     style="display:flex;align-items:center;gap:3px;padding:4px 8px">
//               <i class="fa-solid fa-chart-bar"></i>
//             </button>
//             <button class="btn-xs wl-quick-chart" data-sym="${sym}"
//                     title="View in main chart"
//                     style="display:flex;align-items:center;gap:3px;padding:4px 8px">
//               <i class="fa-solid fa-chart-line"></i>
//             </button>
//             <button class="btn-xs wl-trade" data-sym="${sym}"
//                     title="Trade"
//                     style="display:flex;align-items:center;gap:3px;padding:4px 8px">
//               <i class="fa-solid fa-paper-plane"></i>
//             </button>
//             <button class="btn-wl-remove" data-remove="${sym}" title="Remove from watchlist">
//               <i class="fa-solid fa-xmark"></i>
//             </button>
//           </div>
//         </td>
//       </tr>`;
//     }).join('');

//     // ── Bind events ──────────────────────────────────────
//     // Star buttons
//     tbody.querySelectorAll('[data-star]').forEach(btn => {
//       btn.addEventListener('click', (e) => {
//         e.stopPropagation();
//         toggleStar(btn.dataset.star);
//       });
//     });

//     // Delete buttons
//     tbody.querySelectorAll('[data-remove]').forEach(btn => {
//       btn.addEventListener('click', (e) => {
//         e.stopPropagation();
//         removeSymbol(btn.dataset.remove);
//       });
//     });

//     // Open StockDetail (full-page panel)
//     tbody.querySelectorAll('.wl-open-detail').forEach(btn => {
//       btn.addEventListener('click', (e) => {
//         e.stopPropagation();
//         const sym = btn.dataset.sym;
//         if (window.StockDetail) {
//           StockDetail.open(sym);
//         } else {
//           console.error('[WatchlistManager] StockDetail not available');
//         }
//       });
//     });

//     // Quick chart (overview)
//     tbody.querySelectorAll('.wl-quick-chart').forEach(btn => {
//       btn.addEventListener('click', () => {
//         if (window.Terminal) {
//           Terminal.loadChartSymbol(btn.dataset.sym);
//           Terminal.showSection('overview');
//         }
//       });
//     });

//     // Trade button
//     tbody.querySelectorAll('.wl-trade').forEach(btn => {
//       btn.addEventListener('click', () => {
//         const sel = document.getElementById('order-symbol');
//         if (sel) sel.value = btn.dataset.sym;
//         if (window.Terminal) Terminal.showSection('execution');
//       });
//     });

//     _renderPagination(pages);
//   }

//   // ════════════════════════════════════════════════════════
//   // FILTERED SYMBOLS
//   // ════════════════════════════════════════════════════════
//   function _getFilteredSymbols() {
//     let symbols = [..._watchlist];

//     // Starred first
//     symbols.sort((a, b) => (isStarred(b) ? 1 : 0) - (isStarred(a) ? 1 : 0));

//     // Sector filter
//     if (_currentSector === 'Starred') {
//       symbols = symbols.filter(s => isStarred(s));
//     } else if (_currentSector !== 'All') {
//       symbols = symbols.filter(s =>
//         (SYMBOL_META[s]?.sector || 'Custom') === _currentSector
//       );
//     }

//     // Search filter
//     if (_currentSearch) {
//       const q = _currentSearch.toLowerCase();
//       symbols = symbols.filter(s =>
//         s.toLowerCase().includes(q) ||
//         (SYMBOL_META[s]?.name || '').toLowerCase().includes(q) ||
//         (SYMBOL_META[s]?.sector || '').toLowerCase().includes(q)
//       );
//     }

//     return symbols;
//   }

//   // ════════════════════════════════════════════════════════
//   // SECTOR TABS
//   // ════════════════════════════════════════════════════════
//   function _buildSectorTabs() {
//     const container = document.getElementById('sector-tabs');
//     if (!container) return;

//     const sectors = ['All', 'Starred', ...Object.keys(UNIVERSE), 'Custom'];
//     container.innerHTML = sectors.map(s => `
//       <button class="sector-tab ${s === 'All' ? 'active' : ''}" data-sector="${s}">
//         ${s === 'Starred' ? '<i class="fa-solid fa-star" style="font-size:9px"></i> ' : ''}${s}
//         ${s === 'All' ? `<span style="font-size:9px;color:rgba(255,255,255,0.7);margin-left:2px">(${_watchlist.length})</span>` : ''}
//       </button>`).join('');

//     container.querySelectorAll('.sector-tab').forEach(btn => {
//       btn.addEventListener('click', () => {
//         container.querySelectorAll('.sector-tab').forEach(b => b.classList.remove('active'));
//         btn.classList.add('active');
//         _currentSector = btn.dataset.sector;
//         _currentPage   = 1;
//         render(_signalData);
//       });
//     });
//   }

//   // ════════════════════════════════════════════════════════
//   // ADD FORM + SEARCH
//   // ════════════════════════════════════════════════════════
//   function _buildAddForm() {
//     const form = document.getElementById('wl-add-form');
//     if (!form) return;

//     form.addEventListener('submit', async e => {
//       e.preventDefault();
//       const input = document.getElementById('wl-add-input');
//       const sym   = (input?.value || '').trim().toUpperCase();
//       if (sym) {
//         const added = addSymbol(sym);
//         if (added && input) input.value = '';
//       }
//     });
//   }

//   function _buildSearchBinding() {
//     const searchEl = document.getElementById('wl-search');
//     if (!searchEl) return;
//     searchEl.addEventListener('input', () => {
//       _currentSearch = searchEl.value.trim();
//       _currentPage   = 1;
//       render(_signalData);
//     });
//   }

//   // ════════════════════════════════════════════════════════
//   // SYNC UI — Barre de statut + PAT input cross-device
//   // ════════════════════════════════════════════════════════
//   function _buildSyncUI() {
//     // Insère la barre de sync AVANT le tableau watchlist
//     const tableCard = document.querySelector('#sec-watchlist .card');
//     if (!tableCard) return;

//     // Évite les doublons
//     const existing = document.getElementById('wl-sync-bar');
//     if (existing) existing.remove();

//     const bar       = document.createElement('div');
//     bar.id          = 'wl-sync-bar';
//     bar.className   = 'wl-sync-bar';

//     const savedPAT  = localStorage.getItem('av_gh_pat') || '';
//     const hasPAT    = savedPAT.startsWith('ghp_');

//     bar.innerHTML = `
//       <div class="wl-sync-dot ${_getSyncDotClass()}" id="wl-sync-dot"></div>
//       <span id="wl-sync-text" style="color:var(--txt2);font-weight:600">
//         ${_getSyncText()}
//       </span>

//       <div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap">

//         <!-- PAT input (masqué si déjà configuré) -->
//         ${!hasPAT ? `
//           <input type="password" class="wl-pat-input-mini" id="wl-pat-quick"
//                  placeholder="ghp_... (PAT for cross-device sync)"
//                  title="Enter your GitHub PAT (workflow scope) to sync your watchlist across all devices">
//           <button class="btn-sm" id="wl-pat-save-btn" style="font-size:10px">
//             <i class="fa-solid fa-key"></i> Save PAT
//           </button>
//         ` : `
//           <span style="font-size:10px;color:var(--g)">
//             <i class="fa-solid fa-key"></i> PAT configured
//           </span>
//           <button class="btn-xs" id="wl-pat-clear-btn" title="Remove saved PAT" style="font-size:10px">
//             <i class="fa-solid fa-xmark"></i>
//           </button>
//         `}

//         <!-- Sync from GitHub -->
//         <button class="btn-sm" id="wl-sync-pull-btn" style="font-size:10px" title="Pull latest watchlist from GitHub">
//           <i class="fa-solid fa-cloud-arrow-down"></i> Pull from GitHub
//         </button>

//         <!-- Force push to GitHub -->
//         <button class="btn-sm" id="wl-sync-push-btn" style="font-size:10px" title="Push your watchlist to GitHub (requires PAT)">
//           <i class="fa-solid fa-cloud-arrow-up"></i> Push to GitHub
//         </button>

//       </div>`;

//     // Insert avant la card table
//     tableCard.parentElement.insertBefore(bar, tableCard);

//     // ── Bind events ──────────────────────────────────────────
//     // Save PAT
//     const patSaveBtn = document.getElementById('wl-pat-save-btn');
//     const patInput   = document.getElementById('wl-pat-quick');
//     if (patSaveBtn && patInput) {
//       patSaveBtn.addEventListener('click', () => {
//         const val = patInput.value.trim();
//         if (val.startsWith('ghp_')) {
//           localStorage.setItem('av_gh_pat', val);
//           _showToast('PAT saved — pushing to GitHub...', 'success');
//           _buildSyncUI(); // Rebuild pour cacher le champ
//           _pushToGitHub();
//         } else {
//           _showToast('Invalid PAT — must start with ghp_', 'error');
//         }
//       });

//       patInput.addEventListener('keydown', e => {
//         if (e.key === 'Enter') patSaveBtn.click();
//       });
//     }

//     // Clear PAT
//     document.getElementById('wl-pat-clear-btn')?.addEventListener('click', () => {
//       localStorage.removeItem('av_gh_pat');
//       _showToast('PAT removed — sync disabled', 'warn');
//       _syncStatus = 'local';
//       _buildSyncUI();
//     });

//     // Pull from GitHub
//     document.getElementById('wl-sync-pull-btn')?.addEventListener('click', async () => {
//       const btn = document.getElementById('wl-sync-pull-btn');
//       if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Pulling...';
//       const ghData = await _loadFromGitHubPages();
//       if (ghData && Array.isArray(ghData.watchlist)) {
//         _watchlist     = ghData.watchlist;
//         _starred       = Array.isArray(ghData.starred) ? ghData.starred : _starred;
//         _syncTimestamp = ghData.updated_at ? new Date(ghData.updated_at).getTime() : Date.now();
//         _syncStatus    = 'synced';
//         _saveLocal();
//         render(_signalData);
//         _updateSyncUI();
//         _showToast(`Pulled ${_watchlist.length} symbols from GitHub`, 'success');
//       } else {
//         _showToast('Could not reach GitHub Pages — check your connection', 'error');
//         _syncStatus = 'error';
//         _updateSyncUI();
//       }
//       if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Pull from GitHub';
//     });

//     // Push to GitHub
//     document.getElementById('wl-sync-push-btn')?.addEventListener('click', async () => {
//       const btn = document.getElementById('wl-sync-push-btn');
//       if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Pushing...';
//       await _pushToGitHub();
//       if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Push to GitHub';
//     });
//   }

//   function _updateSyncUI() {
//     const dot  = document.getElementById('wl-sync-dot');
//     const text = document.getElementById('wl-sync-text');
//     if (dot)  dot.className = `wl-sync-dot ${_getSyncDotClass()}`;
//     if (text) text.textContent = _getSyncText();
//   }

//   function _getSyncDotClass() {
//     switch(_syncStatus) {
//       case 'synced':  return 'synced';
//       case 'loading': return 'loading';
//       case 'error':   return 'error';
//       default:        return 'local';
//     }
//   }

//   function _getSyncText() {
//     switch(_syncStatus) {
//       case 'synced': {
//         const ago = _syncTimestamp
//           ? Math.round((Date.now() - _syncTimestamp) / 60000)
//           : 0;
//         return `Synced with GitHub${ago > 0 ? ` (${ago}m ago)` : ' (just now)'}`;
//       }
//       case 'loading': return 'Syncing...';
//       case 'error':   return 'Sync error — check PAT or connection';
//       default:        return 'Local only — enter PAT above for cross-device sync';
//     }
//   }

//   // ════════════════════════════════════════════════════════
//   // PAGINATION
//   // ════════════════════════════════════════════════════════
//   function _renderPagination(pages) {
//     const container = document.getElementById('wl-pagination');
//     if (!container) return;

//     if (pages <= 1) {
//       container.innerHTML = '';
//       return;
//     }

//     const items = [];
//     items.push(`<button class="wl-page-btn" id="wl-prev" ${_currentPage <= 1 ? 'disabled' : ''}>
//       <i class="fa-solid fa-chevron-left"></i>
//     </button>`);

//     const startP = Math.max(1, _currentPage - 3);
//     const endP   = Math.min(pages, startP + 6);
//     for (let i = startP; i <= endP; i++) {
//       items.push(`<button class="wl-page-btn ${i === _currentPage ? 'active' : ''}" data-pg="${i}">${i}</button>`);
//     }

//     items.push(`<button class="wl-page-btn" id="wl-next" ${_currentPage >= pages ? 'disabled' : ''}>
//       <i class="fa-solid fa-chevron-right"></i>
//     </button>`);
//     items.push(`<span style="font-size:11px;color:var(--txt4)">
//       ${_watchlist.length} symbols · Page ${_currentPage}/${pages}
//     </span>`);

//     container.innerHTML = items.join('');

//     container.querySelectorAll('[data-pg]').forEach(btn => {
//       btn.addEventListener('click', () => { _currentPage = parseInt(btn.dataset.pg); render(_signalData); });
//     });
//     document.getElementById('wl-prev')?.addEventListener('click', () => { _currentPage--; render(_signalData); });
//     document.getElementById('wl-next')?.addEventListener('click', () => { _currentPage++; render(_signalData); });
//   }

//   // ════════════════════════════════════════════════════════
//   // LIVE DATA (inchangé)
//   // ════════════════════════════════════════════════════════
//   const _liveCache = {};

//   async function fetchLiveQuote(sym) {
//     if (_liveCache[sym] && (Date.now() - _liveCache[sym].ts) < 60000) {
//       return _liveCache[sym].data;
//     }
//     try {
//       const data = await YahooFinance.getQuote(sym);
//       if (data) _liveCache[sym] = { data, ts: Date.now() };
//       return data;
//     } catch(e) { return null; }
//   }

//   async function fetchNews(sym) {
//     try { return await YahooFinance.getNews(sym); } catch(e) { return []; }
//   }

//   async function fetchFinancials(sym) {
//     try { return await YahooFinance.getFinancials(sym); } catch(e) { return null; }
//   }

//   // ════════════════════════════════════════════════════════
//   // UTILS
//   // ════════════════════════════════════════════════════════
//   function resetFilter() {
//     _currentSector = 'All';
//     _currentSearch = '';
//     _currentPage   = 1;
//     const searchEl = document.getElementById('wl-search');
//     if (searchEl) searchEl.value = '';
//     document.querySelectorAll('.sector-tab').forEach(b => {
//       b.classList.toggle('active', b.dataset.sector === 'All');
//     });
//     render(_signalData);
//   }

//   function _showToast(msg, type = 'info') {
//     const wrap = document.getElementById('toast-wrap');
//     if (!wrap) return;
//     const icons = { success:'fa-circle-check', warn:'fa-triangle-exclamation',
//                     info:'fa-circle-info', error:'fa-circle-exclamation' };
//     const toast = document.createElement('div');
//     toast.className = `toast ${type}`;
//     toast.innerHTML = `<i class="fa-solid ${icons[type]||'fa-info'}"></i> ${msg}`;
//     wrap.appendChild(toast);
//     setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3500);
//   }

//   // ════════════════════════════════════════════════════════
//   // PUBLIC API
//   // ════════════════════════════════════════════════════════
//   return {
//     init,
//     render,
//     addSymbol,
//     removeSymbol,
//     toggleStar,
//     isStarred,
//     isInWatchlist,
//     resetToDefault,
//     resetFilter,
//     fetchLiveQuote,
//     fetchNews,
//     fetchFinancials,

//     // State getters
//     getWatchlist:  () => _watchlist,
//     getStarred:    () => _starred,
//     getAllSymbols:  () => ALL_SYMBOLS_FLAT,
//     getSymbolMeta: (s) => SYMBOL_META[s] || { name: s, sector: 'Custom' },
//     getUniverse:   () => UNIVERSE,
//     getTotalCount: () => ALL_SYMBOLS_FLAT.length,

//     // Search state (accessible par terminal.js)
//     get _currentSearch() { return _currentSearch; },
//     set _currentSearch(v) { _currentSearch = v; },
//     get _currentPage()   { return _currentPage; },
//     set _currentPage(v)  { _currentPage = v; },
//   };

// })();

// window.WatchlistManager = WatchlistManager;
// console.log(`[WatchlistManager] Loaded | ${WatchlistManager.getTotalCount()} symbols available`);

// ============================================================
// watchlist-manager.js — AlphaVault Quant v3.2
// ✅ Sync cross-device via Cloudflare Worker (PAT serveur)
// ✅ Zero PAT côté user — authentification transparente
// ✅ GET : GitHub Pages (CDN) → Worker fallback → localStorage
// ✅ PUT : Cloudflare Worker /watchlist (PAT stocké en secret CF)
// ✅ Boutons étoile + delete toujours visibles
// ✅ StockDetail.open() sur clic symbole
// ✅ Secteurs, pagination, recherche
// ============================================================

const WatchlistManager = (() => {

  // ── Config GitHub / Worker ────────────────────────────────
  const GH_OWNER     = 'Raph33AI';
  const GH_REPO      = 'alphavault-quant';
  const GH_FILE_PATH = 'docs/signals/watchlist.json';
  const WORKER_URL   = 'https://alphavault-gh-proxy.raphnardone.workers.dev';

  // ── LocalStorage Keys ─────────────────────────────────────
  const LS_KEY     = 'av_watchlist_v3';
  const LS_STARRED = 'av_starred_v3';

  const PAGE_SIZE  = 50;

  // ════════════════════════════════════════════════════════
  // LOGO HELPER
  // ════════════════════════════════════════════════════════
  function _logoHtml(sym, size = 20) {
    if (typeof window._getLogoHtml === 'function') {
      return window._getLogoHtml(sym, size);
    }
    return `<span class="sym-initial-badge"
                    style="width:${size}px;height:${size}px;font-size:${Math.floor(size*0.4)}px">${sym.charAt(0)}</span>`;
  }

  // ── State ─────────────────────────────────────────────────
  let _currentPage    = 1;
  let _currentSector  = 'All';
  let _currentSearch  = '';
  let _signalData     = {};
  let _watchlist      = [];
  let _starred        = [];
  let _ghSaveTimeout  = null;
  let _syncTimestamp  = 0;
  let _syncStatus     = 'local';

  // ── Universe ───────────────────────────────────────────────
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

  const SYMBOL_META        = {};
  const ALL_SYMBOLS_FLAT   = [];
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
    // 1. Chargement depuis GitHub Pages (CDN) ou Worker (fallback)
    const ghData = await _loadFromGitHub();
    if (ghData) {
      _watchlist     = Array.isArray(ghData.watchlist) ? ghData.watchlist : [];
      _starred       = Array.isArray(ghData.starred)   ? ghData.starred   : [];
      _syncTimestamp = ghData.updated_at ? new Date(ghData.updated_at).getTime() : Date.now();
      _syncStatus    = 'synced';
      _saveLocal();
      console.log(`[WatchlistManager] ✅ Loaded from GitHub | ${_watchlist.length} symbols`);
    } else {
      // 2. Fallback localStorage
      _loadLocal();
      _syncStatus = 'local';
      console.log(`[WatchlistManager] ⚠ GitHub unavailable — loaded from localStorage | ${_watchlist.length} symbols`);
    }

    _buildSectorTabs();
    _buildAddForm();
    _buildSearchBinding();
    _buildSyncUI();

    // ── Sync quand l'utilisateur revient sur l'onglet ─────
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) _autoSyncFromGitHub();
    });

    // ── Sync automatique toutes les 5 minutes ─────────────
    // Pas besoin de vérifier le PAT : le Worker l'a côté serveur
    setInterval(() => {
      _autoSyncFromGitHub();
    }, 5 * 60 * 1000);

    console.log(`[WatchlistManager] Init done | ${_watchlist.length} symbols | sync:${_syncStatus}`);
  }

  // ════════════════════════════════════════════════════════
  // PERSISTANCE LOCALE
  // ════════════════════════════════════════════════════════
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

  function _saveLocal() {
    try {
      localStorage.setItem(LS_KEY,     JSON.stringify(_watchlist));
      localStorage.setItem(LS_STARRED, JSON.stringify(_starred));
    } catch(e) {}
  }

  // ════════════════════════════════════════════════════════
  // CHARGEMENT GITHUB
  // Stratégie : Pages CDN (rapide) → Worker GET (fresh) → null
  // ════════════════════════════════════════════════════════
  async function _loadFromGitHub() {
    // ── Essai 1 : GitHub Pages CDN (public, pas d'auth) ───
    try {
      const base    = window.ApiClient ? ApiClient.getBase() : '/signals';
      const pageUrl = `${base}/watchlist.json?_=${Date.now()}`;
      const resp    = await fetch(pageUrl, {
        signal: AbortSignal.timeout(5000),
        cache:  'no-store',
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && (Array.isArray(data.watchlist) || Array.isArray(data.starred))) {
          return data;  // ✅ FIX — Log retiré (verbeux à chaque auto-sync)
        }
      }
    } catch(e) {}

    // ── Essai 2 : Worker GET /watchlist (PAT serveur, fichier fresh) ──
    try {
      const resp = await fetch(`${WORKER_URL}/watchlist?_=${Date.now()}`, {
        signal: AbortSignal.timeout(8000),
        cache:  'no-store',
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data && !data.error) {
          return data;  // ✅ FIX — Log retiré (verbeux à chaque auto-sync)
        }
      }
    } catch(e) {}

    return null;
  }

  // ── Auto-sync (lecture seule, si GitHub est plus récent) ──
  async function _autoSyncFromGitHub() {
    try {
      const ghData = await _loadFromGitHub();
      if (!ghData) return;

      const ghTime = ghData.updated_at ? new Date(ghData.updated_at).getTime() : 0;

      if (ghTime > _syncTimestamp && Array.isArray(ghData.watchlist)) {
        const prevLen  = _watchlist.length;
        _watchlist     = ghData.watchlist;
        _starred       = Array.isArray(ghData.starred) ? ghData.starred : _starred;
        _syncTimestamp = ghTime;
        _syncStatus    = 'synced';
        _saveLocal();
        render(_signalData);
        _updateSyncUI();

        if (_watchlist.length !== prevLen) {
          _showToast(`Watchlist synced (${_watchlist.length} symbols)`, 'info');
        }
      }
    } catch(e) {}
  }

  // ════════════════════════════════════════════════════════
  // ÉCRITURE GITHUB — via Cloudflare Worker (PAT serveur)
  // Aucun PAT côté client nécessaire
  // ════════════════════════════════════════════════════════
  async function _pushToGitHub() {
    _syncStatus = 'loading';
    _updateSyncUI();

    const payload = {
      watchlist: _watchlist,
      starred:   _starred,
    };

    try {
      const resp = await fetch(`${WORKER_URL}/watchlist`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
        signal:  AbortSignal.timeout(15000),
      });

      if (resp.ok) {
        const result   = await resp.json();
        _syncTimestamp = Date.now();
        _syncStatus    = 'synced';
        _updateSyncUI();
        console.log(`[WatchlistManager] ✅ Saved via Worker | ${_watchlist.length} symbols`);
        _showToast(`Watchlist synced (${_watchlist.length} symbols)`, 'success');
        return true;
      }

      // Gestion des erreurs Worker
      const err = await resp.json().catch(() => ({}));
      const msg = err.error || `HTTP ${resp.status}`;
      console.warn(`[WatchlistManager] Worker PUT failed: ${msg}`);

      // Retry sur conflit SHA (409)
      if (resp.status === 409) {
        console.log('[WatchlistManager] SHA conflict — retrying in 2s...');
        setTimeout(() => _pushToGitHub(), 2000);
        return false;
      }

      _syncStatus = 'error';
      _updateSyncUI();
      _showToast(`Sync error: ${msg}`, 'error');
      return false;

    } catch(e) {
      console.warn(`[WatchlistManager] Worker PUT network error: ${e.message}`);
      _syncStatus = 'error';
      _updateSyncUI();
      return false;
    }
  }

  // ── Debounce 2s avant push ────────────────────────────────
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

  function isStarred(sym)     { return _starred.includes(sym); }
  function isInWatchlist(sym) { return _watchlist.includes(sym); }

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

    let symbols = _getFilteredSymbols();
    const total = symbols.length;
    const pages = Math.ceil(total / PAGE_SIZE);
    _currentPage = Math.min(_currentPage, Math.max(1, pages));
    const start   = (_currentPage - 1) * PAGE_SIZE;
    const display = symbols.slice(start, start + PAGE_SIZE);

    const countEls = document.querySelectorAll('#wl-sym-count, #wl-count');
    countEls.forEach(el => { el.textContent = `${_watchlist.length} symbols`; });

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

    tbody.innerHTML = display.map(sym => {
      const s       = sigs[sym] || {};
      const meta    = SYMBOL_META[sym] || { name: sym, sector: 'Custom' };
      const price   = parseFloat(s.price        || 0);
      const chg     = parseFloat(s.change_pct   || s.change || 0);
      const score   = parseFloat(s.final_score  || 0);
      const bp      = parseFloat(s.buy_prob     || 0.5);
      const dir     = s.direction || 'neutral';
      const council = s.council   || (price > 0 ? 'wait' : '');
      const regime  = (s.regime   || '').replace(/_/g, ' ');
      const cls     = chg > 0 ? 'up' : chg < 0 ? 'down' : '';
      const starred = isStarred(sym);

      const scolor  = score > 0.65 ? '#10b981' : score > 0.40 ? '#f59e0b' : '#64748b';
      const ccolor  = council.includes('execute') ? '#10b981'
                    : council === 'veto'           ? '#ef4444'
                    : '#f59e0b';

      const dirBadge = dir === 'buy'
        ? `<span class="dir-badge buy"><i class="fa-solid fa-arrow-up"></i> BUY</span>`
        : dir === 'sell'
          ? `<span class="dir-badge sell"><i class="fa-solid fa-arrow-down"></i> SELL</span>`
          : `<span class="dir-badge neutral"><i class="fa-solid fa-minus"></i></span>`;

      const councilBadge = council
        ? `<span style="font-size:11px;font-weight:700;color:${ccolor}">${council.toUpperCase()}</span>`
        : '<span style="color:var(--txt4);font-size:11px">—</span>';

      return `<tr data-sym="${sym}">
        <td style="padding:8px 6px;text-align:center">
          <button class="btn-wl-star ${starred ? 'starred' : ''}"
                  data-star="${sym}" title="${starred ? 'Unstar' : 'Star'}">
            <i class="${starred ? 'fa-solid' : 'fa-regular'} fa-star"></i>
          </button>
        </td>
        <td style="padding:8px 10px">
          <div style="display:flex;align-items:center;gap:7px">
            ${_logoHtml(sym, 22)}
            <div style="display:flex;flex-direction:column;gap:1px">
              <strong class="sym-link wl-open-detail" data-sym="${sym}"
                      style="cursor:pointer;color:var(--txt);font-size:13px;line-height:1.2">
                ${sym}
              </strong>
              <span style="font-size:9px;color:var(--b1);font-weight:700">${meta.sector}</span>
            </div>
          </div>
        </td>
        <td><span class="muted-sm">${meta.name}</span></td>
        <td class="mono ${cls}" style="font-size:13px;font-weight:600">
          ${price > 0 ? `$${price.toFixed(2)}` : '<span style="color:var(--txt4)">—</span>'}
        </td>
        <td class="mono ${cls}" style="font-size:12px;font-weight:600">
          ${price > 0 ? `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%` : '—'}
        </td>
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
        <td>${price > 0 ? dirBadge : '<span style="color:var(--txt4);font-size:11px">—</span>'}</td>
        <td class="mono" style="font-size:12px">
          ${score > 0 ? `${(bp*100).toFixed(1)}%` : '—'}
        </td>
        <td>
          ${regime
            ? `<span class="regime-chip">${regime}</span>`
            : '<span style="color:var(--txt4);font-size:11px">—</span>'}
        </td>
        <td>${councilBadge}</td>
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

    // ── Bind events ──────────────────────────────────────────
    tbody.querySelectorAll('[data-star]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        toggleStar(btn.dataset.star);
      });
    });

    tbody.querySelectorAll('[data-remove]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        removeSymbol(btn.dataset.remove);
      });
    });

    tbody.querySelectorAll('.wl-open-detail').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const sym = btn.dataset.sym;
        if (window.StockDetail) {
          StockDetail.open(sym);
        } else {
          console.error('[WatchlistManager] StockDetail not available');
        }
      });
    });

    tbody.querySelectorAll('.wl-quick-chart').forEach(btn => {
      btn.addEventListener('click', () => {
        if (window.Terminal) {
          Terminal.loadChartSymbol(btn.dataset.sym);
          Terminal.showSection('overview');
        }
      });
    });

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
    symbols.sort((a, b) => (isStarred(b) ? 1 : 0) - (isStarred(a) ? 1 : 0));

    if (_currentSector === 'Starred') {
      symbols = symbols.filter(s => isStarred(s));
    } else if (_currentSector !== 'All') {
      symbols = symbols.filter(s =>
        (SYMBOL_META[s]?.sector || 'Custom') === _currentSector
      );
    }

    if (_currentSearch) {
      const q = _currentSearch.toLowerCase();
      symbols = symbols.filter(s =>
        s.toLowerCase().includes(q) ||
        (SYMBOL_META[s]?.name   || '').toLowerCase().includes(q) ||
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
  // SYNC UI — Barre de statut (sans PAT — géré côté Worker)
  // ════════════════════════════════════════════════════════
  function _buildSyncUI() {
    const tableCard = document.querySelector('#sec-watchlist .card');
    if (!tableCard) return;

    const existing = document.getElementById('wl-sync-bar');
    if (existing) existing.remove();

    const bar     = document.createElement('div');
    bar.id        = 'wl-sync-bar';
    bar.className = 'wl-sync-bar';

    bar.innerHTML = `
      <div class="wl-sync-dot ${_getSyncDotClass()}" id="wl-sync-dot"></div>
      <div style="display:flex;flex-direction:column;gap:1px">
        <span id="wl-sync-text" style="color:var(--txt2);font-weight:600;font-size:12px">
          ${_getSyncText()}
        </span>
        <span style="font-size:10px;color:var(--txt4)">
          <i class="fa-solid fa-shield-halved" style="color:var(--g)"></i>
          Secured via Cloudflare Worker — no credentials required
        </span>
      </div>

      <div style="margin-left:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <button class="btn-sm" id="wl-sync-pull-btn" style="font-size:10px"
                title="Pull latest watchlist from GitHub">
          <i class="fa-solid fa-cloud-arrow-down"></i> Pull
        </button>
        <button class="btn-sm" id="wl-sync-push-btn" style="font-size:10px"
                title="Push your watchlist to GitHub">
          <i class="fa-solid fa-cloud-arrow-up"></i> Push
        </button>
      </div>`;

    tableCard.parentElement.insertBefore(bar, tableCard);

    // ── Pull ────────────────────────────────────────────────
    document.getElementById('wl-sync-pull-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('wl-sync-pull-btn');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';

      const ghData = await _loadFromGitHub();
      if (ghData && Array.isArray(ghData.watchlist)) {
        _watchlist     = ghData.watchlist;
        _starred       = Array.isArray(ghData.starred) ? ghData.starred : _starred;
        _syncTimestamp = ghData.updated_at ? new Date(ghData.updated_at).getTime() : Date.now();
        _syncStatus    = 'synced';
        _saveLocal();
        render(_signalData);
        _updateSyncUI();
        _showToast(`Pulled ${_watchlist.length} symbols from GitHub`, 'success');
      } else {
        _showToast('Could not reach GitHub — check your connection', 'error');
        _syncStatus = 'error';
        _updateSyncUI();
      }

      if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-down"></i> Pull';
    });

    // ── Push ────────────────────────────────────────────────
    document.getElementById('wl-sync-push-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('wl-sync-push-btn');
      if (btn) btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
      await _pushToGitHub();
      if (btn) btn.innerHTML = '<i class="fa-solid fa-cloud-arrow-up"></i> Push';
    });
  }

  function _updateSyncUI() {
    const dot  = document.getElementById('wl-sync-dot');
    const text = document.getElementById('wl-sync-text');
    if (dot)  dot.className   = `wl-sync-dot ${_getSyncDotClass()}`;
    if (text) text.textContent = _getSyncText();
  }

  function _getSyncDotClass() {
    switch(_syncStatus) {
      case 'synced':  return 'synced';
      case 'loading': return 'loading';
      case 'error':   return 'error';
      default:        return 'local';
    }
  }

  function _getSyncText() {
    switch(_syncStatus) {
      case 'synced': {
        const ago = _syncTimestamp
          ? Math.round((Date.now() - _syncTimestamp) / 60000)
          : 0;
        return `Synced with GitHub${ago > 0 ? ` (${ago}m ago)` : ' (just now)'}`;
      }
      case 'loading': return 'Syncing...';
      case 'error':   return 'Sync error — will retry automatically';
      default:        return 'Local only — push to sync all your devices';
    }
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
      btn.addEventListener('click', () => {
        _currentPage = parseInt(btn.dataset.pg);
        render(_signalData);
      });
    });
    document.getElementById('wl-prev')?.addEventListener('click', () => { _currentPage--; render(_signalData); });
    document.getElementById('wl-next')?.addEventListener('click', () => { _currentPage++; render(_signalData); });
  }

  // ════════════════════════════════════════════════════════
  // LIVE DATA
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
    try { return await YahooFinance.getNews(sym); }
    catch(e) { return []; }
  }

  async function fetchFinancials(sym) {
    try { return await YahooFinance.getFinancials(sym); }
    catch(e) { return null; }
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
    const wrap  = document.getElementById('toast-wrap');
    if (!wrap) return;
    const icons = {
      success: 'fa-circle-check',
      warn:    'fa-triangle-exclamation',
      info:    'fa-circle-info',
      error:   'fa-circle-exclamation',
    };
    const toast     = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${icons[type] || 'fa-info'}"></i> ${msg}`;
    wrap.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
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

    // Search state
    get _currentSearch() { return _currentSearch; },
    set _currentSearch(v) { _currentSearch = v; },
    get _currentPage()   { return _currentPage; },
    set _currentPage(v)  { _currentPage = v; },
  };

})();

window.WatchlistManager = WatchlistManager;
console.log(`[WatchlistManager] Loaded | ${WatchlistManager.getTotalCount()} symbols available`);