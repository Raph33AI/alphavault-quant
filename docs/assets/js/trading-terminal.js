// ============================================================
// trading-terminal.js — AlphaVault Quant
// Terminal de trading manuel via GitHub Actions API
// ============================================================

const TradingTerminal = (() => {

    // ── Config GitHub ─────────────────────────────────────────
    const GH_OWNER    = 'Raph33AI';                    // ← ton username GitHub
    const GH_REPO     = 'alphavault-quant';            // ← ton repo
    const GH_WORKFLOW = 'manual-trade.yml';            // ← nom du workflow
    const GH_BRANCH   = 'main';                        // ← branche principale

    // ── État ──────────────────────────────────────────────────
    let _pat     = '';
    let _dryRun  = true;
    let _loading = false;

    // ════════════════════════════════════════════════════════
    // INIT
    // ════════════════════════════════════════════════════════
    function init() {
        // Charge PAT depuis localStorage
        _pat    = localStorage.getItem('gh_pat')  || '';
        _dryRun = localStorage.getItem('terminal_dry_run') !== 'false';

        const input = document.getElementById('gh-pat-input');
        const cb    = document.getElementById('terminal-dry-run');

        if (input) input.value = _pat;
        if (cb)    cb.checked  = _dryRun;

        _updatePATStatus();
        _updateDryRunBadge();

        // Charge historique ordres
        refresh();

        // Charge status IBKR
        _loadIBKRStatus();

        console.log('✅ TradingTerminal initialisé');
    }

    // ════════════════════════════════════════════════════════
    // PAT
    // ════════════════════════════════════════════════════════
    function savePAT(val) {
        _pat = val.trim();
        localStorage.setItem('gh_pat', _pat);
        _updatePATStatus();
    }

    function togglePAT() {
        const input = document.getElementById('gh-pat-input');
        const icon  = document.getElementById('pat-visibility-icon');
        if (!input) return;
        if (input.type === 'password') {
            input.type = 'text';
            if (icon) icon.textContent = '🔒';
        } else {
            input.type = 'password';
            if (icon) icon.textContent = '👁';
        }
    }

    function _updatePATStatus() {
        const el = document.getElementById('pat-status');
        if (!el) return;
        if (_pat && _pat.startsWith('ghp_') && _pat.length > 20) {
            el.textContent   = '✅ PAT configuré';
            el.style.color   = '#10b981';
        } else if (_pat) {
            el.textContent   = '⚠ Format PAT invalide';
            el.style.color   = '#f59e0b';
        } else {
            el.textContent   = '❌ Non configuré';
            el.style.color   = '#ef4444';
        }
    }

    // ════════════════════════════════════════════════════════
    // DRY RUN
    // ════════════════════════════════════════════════════════
    function updateDryRun() {
        const cb = document.getElementById('terminal-dry-run');
        _dryRun  = cb ? cb.checked : true;
        localStorage.setItem('terminal_dry_run', String(_dryRun));
        _updateDryRunBadge();
    }

    function _updateDryRunBadge() {
        const btBuy  = document.getElementById('btn-buy');
        const btSell = document.getElementById('btn-sell');
        const label  = _dryRun ? ' (DRY)' : ' (PAPER)';
        if (btBuy)  btBuy.textContent  = '▲ BUY'  + label;
        if (btSell) btSell.textContent = '▼ SELL' + label;
    }

    // ════════════════════════════════════════════════════════
    // SYMBOL HELPERS
    // ════════════════════════════════════════════════════════
    function setSymbol(sym) {
        const input = document.getElementById('order-symbol');
        if (input) {
            input.value = sym.toUpperCase();
            input.focus();
        }
        // Highlight le bouton rapide
        document.querySelectorAll('.sym-btn').forEach(b => {
            b.classList.toggle('active', b.textContent === sym);
        });
    }

    function onOrderTypeChange() {
        const type  = document.getElementById('order-type')?.value || 'MKT';
        const lmtG  = document.getElementById('limit-price-group');
        const stpG  = document.getElementById('stop-price-group');
        if (lmtG) lmtG.style.display = ['LMT', 'STPLMT'].includes(type) ? '' : 'none';
        if (stpG) stpG.style.display = ['STP', 'STPLMT'].includes(type) ? '' : 'none';
    }

    // ════════════════════════════════════════════════════════
    // SOUMISSION ORDRE (BUY / SELL)
    // ════════════════════════════════════════════════════════
    async function submitOrder(action) {
        if (_loading) { console.warn('⚠ Ordre déjà en cours'); return; }

        // ── Lecture formulaire ────────────────────────────────
        const symbol     = document.getElementById('order-symbol')?.value?.toUpperCase()?.trim();
        const quantity   = parseInt(document.getElementById('order-qty')?.value || '1');
        const orderType  = document.getElementById('order-type')?.value || 'MKT';
        const limitPrice = document.getElementById('order-limit-price')?.value || '';
        const stopPrice  = document.getElementById('order-stop-price')?.value  || '';
        const reason     = document.getElementById('order-reason')?.value || 'Dashboard manual order';

        // ── Validations frontend ──────────────────────────────
        const errors = [];
        if (!symbol || symbol.length > 10) errors.push(`Symbole invalide: "${symbol}"`);
        if (!quantity || quantity < 1 || quantity > 10000) errors.push(`Quantité invalide: ${quantity}`);
        if (orderType === 'LMT' && !limitPrice)    errors.push('Prix limite requis pour LMT');
        if (orderType === 'STP' && !stopPrice)      errors.push('Prix stop requis pour STP');
        if (orderType === 'STPLMT' && (!limitPrice || !stopPrice)) {
            errors.push('Prix limite ET stop requis pour STPLMT');
        }
        if (!_pat || !_pat.startsWith('ghp_')) errors.push('GitHub PAT non configuré ou invalide');

        if (errors.length) {
            _showStatus('error', '❌ ' + errors.join(' | '));
            return;
        }

        // ── Confirmation si pas dry run ───────────────────────
        if (!_dryRun) {
            const confirm_msg =
                `⚠ ORDRE RÉEL SUR IBKR PAPER TRADING ⚠\n\n` +
                `Action : ${action}\n` +
                `Symbole: ${symbol}\n` +
                `Qté    : ${quantity}\n` +
                `Type   : ${orderType}\n` +
                `${limitPrice ? `Limite : $${limitPrice}\n` : ''}` +
                `\nConfirmer ?`;
            if (!window.confirm(confirm_msg)) return;
        }

        // ── Envoi workflow_dispatch ───────────────────────────
        _loading = true;
        _setButtonsState(true);
        _showStatus('loading', `⏳ Envoi ordre ${action} ${quantity}x ${symbol}...`);

        const inputs = {
            symbol:      symbol,
            action:      action,
            quantity:    String(quantity),
            order_type:  orderType,
            limit_price: limitPrice,
            stop_price:  stopPrice,
            dry_run:     String(_dryRun),
            reason:      reason
        };

        console.log('📤 workflow_dispatch payload:', {
            workflow:    GH_WORKFLOW,
            ref:         GH_BRANCH,
            inputs
        });

        try {
            const apiUrl = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/actions/workflows/${GH_WORKFLOW}/dispatches`;

            const resp = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `token ${_pat}`,
                    'Accept':        'application/vnd.github.v3+json',
                    'Content-Type':  'application/json',
                    'X-GitHub-Api-Version': '2022-11-28'
                },
                body: JSON.stringify({ ref: GH_BRANCH, inputs })
            });

            console.log('📡 GitHub API response status:', resp.status);

            if (resp.status === 204) {
                // ✅ Succès
                const runUrl = `https://github.com/${GH_OWNER}/${GH_REPO}/actions`;
                _showStatus(
                    'success',
                    `✅ Workflow déclenché ! ${action} ${quantity}x ${symbol} [${_dryRun ? 'DRY RUN' : 'PAPER'}]`,
                    runUrl
                );

                // Sauvegarde local pending order
                _savePendingOrder({ ...inputs, action, timestamp: new Date().toISOString() });

                // Refresh dans 30s (temps que le workflow tourne)
                setTimeout(() => refresh(), 30000);
                setTimeout(() => refresh(), 60000);

            } else if (resp.status === 401) {
                const body = await resp.json().catch(() => ({}));
                _showStatus('error', `❌ PAT invalide ou expiré (401). Vérifiez votre token.\n${body.message || ''}`);
            } else if (resp.status === 404) {
                _showStatus('error', `❌ Workflow non trouvé (404). Vérifiez que "${GH_WORKFLOW}" existe dans .github/workflows/`);
            } else if (resp.status === 422) {
                const body = await resp.json().catch(() => ({}));
                _showStatus('error', `❌ Paramètres invalides (422): ${body.message || 'Check inputs'}`);
            } else {
                const body = await resp.text();
                _showStatus('error', `❌ Erreur API GitHub (${resp.status}): ${body}`);
            }

        } catch (err) {
            console.error('❌ submitOrder error:', err);
            _showStatus('error', `❌ Erreur réseau: ${err.message}. Vérifiez votre connexion et le CORS.`);
        } finally {
            _loading = false;
            _setButtonsState(false);
        }
    }

    // ════════════════════════════════════════════════════════
    // IBKR STATUS
    // ════════════════════════════════════════════════════════
    async function _loadIBKRStatus() {
        try {
            const resp = await fetch(
                `${ApiClient.getBase()}/ibkr_status.json?_=${Date.now()}`,
                { cache: 'no-store' }
            );
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            const dot   = document.getElementById('ibkr-dot');
            const label = document.getElementById('ibkr-status-label');
            const badge = document.getElementById('ibkr-mode-badge');
            const lat   = document.getElementById('ibkr-latency');

            const reachable = data.reachable;
            const mode      = data.mode || 'paper';

            if (dot) {
                dot.className = `ibkr-dot ${reachable ? 'connected' : 'disconnected'}`;
            }
            if (label) {
                label.textContent = reachable
                    ? `✅ IB Gateway accessible — ${data.host}:${data.port}`
                    : `❌ IB Gateway injoignable — ${data.error || 'Timeout'}`;
                label.style.color = reachable ? '#10b981' : '#ef4444';
            }
            if (badge) {
                badge.textContent = mode.toUpperCase();
                badge.className   = `mode-badge ${mode}`;
            }
            if (lat && data.latency_ms) {
                lat.textContent = `${data.latency_ms}ms`;
            }

        } catch(e) {
            const label = document.getElementById('ibkr-status-label');
            if (label) {
                label.textContent = '⚠ Status IBKR non disponible (premier run ?)';
                label.style.color = '#f59e0b';
            }
        }
    }

    // ════════════════════════════════════════════════════════
    // HISTORIQUE ORDRES
    // ════════════════════════════════════════════════════════
    async function refresh() {
        try {
            const resp = await fetch(
                `${ApiClient.getBase()}/manual_order_result.json?_=${Date.now()}`,
                { cache: 'no-store' }
            );
            if (!resp.ok) throw new Error('not found');
            const data = await resp.json();
            _renderOrderHistory(data.history || []);
        } catch(e) {
            _renderOrderHistory(_getPendingOrders());
        }
    }

    function _renderOrderHistory(orders) {
        const tbody = document.getElementById('manual-orders-tbody');
        if (!tbody) return;

        if (!orders.length) {
            tbody.innerHTML = `<tr><td colspan="8" class="loading-row">Aucun ordre manuel — utilisez le formulaire ci-dessus</td></tr>`;
            return;
        }

        tbody.innerHTML = [...orders].reverse().slice(0, 20).map(o => {
            const ts      = o.timestamp ? new Date(o.timestamp).toLocaleTimeString() : '--';
            const status  = o.status || 'unknown';
            const isDry   = o.dry_run !== false;
            const color   = status === 'simulated' ? '#06b6d4'
                          : status === 'placed'    ? '#10b981'
                          : status === 'error'     ? '#ef4444'
                          : '#64748b';
            return `<tr>
                <td style="font-size:11px;color:#64748b">${ts}</td>
                <td><strong>${o.symbol || '—'}</strong></td>
                <td><span class="dir-badge ${(o.action||'').toLowerCase()}">${o.action || '—'}</span></td>
                <td>${o.quantity || '—'}</td>
                <td><code style="font-size:11px">${o.order_type || 'MKT'}</code></td>
                <td>${o.fill_price ? `$${parseFloat(o.fill_price).toFixed(2)}` : o.limit_price ? `~$${o.limit_price}` : '—'}</td>
                <td><strong style="color:${color}">${status.toUpperCase()}</strong></td>
                <td style="font-size:11px">${isDry ? '🧪 DRY' : '📄 PAPER'}</td>
            </tr>`;
        }).join('');
    }

    // ── Ordres locaux (avant que GitHub pousse le JSON) ───────
    function _savePendingOrder(order) {
        const key     = 'pending_manual_orders';
        const pending = JSON.parse(localStorage.getItem(key) || '[]');
        pending.push({ ...order, status: 'pending_workflow' });
        localStorage.setItem(key, JSON.stringify(pending.slice(-20)));
    }

    function _getPendingOrders() {
        return JSON.parse(localStorage.getItem('pending_manual_orders') || '[]');
    }

    // ════════════════════════════════════════════════════════
    // STATUS BAR
    // ════════════════════════════════════════════════════════
    function _showStatus(type, msg, runUrl = null) {
        const bar     = document.getElementById('order-status-bar');
        const inner   = document.getElementById('order-status-inner');
        const spinner = document.getElementById('order-spinner');
        const msgEl   = document.getElementById('order-status-msg');
        const link    = document.getElementById('order-run-link');

        if (!bar) return;
        bar.style.display = 'flex';

        const colors = {
            loading: '#3b82f6',
            success: '#10b981',
            error:   '#ef4444',
            info:    '#64748b'
        };
        bar.style.borderColor      = colors[type] || '#64748b';
        bar.style.backgroundColor  = (colors[type] || '#64748b') + '11';

        if (spinner) spinner.style.display = type === 'loading' ? 'inline-block' : 'none';
        if (msgEl)   msgEl.textContent     = msg;

        if (link) {
            link.style.display = runUrl ? 'block' : 'none';
            if (runUrl) link.href = runUrl;
        }
    }

    function _setButtonsState(disabled) {
        const btns = ['btn-buy', 'btn-sell'];
        btns.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) {
                btn.disabled         = disabled;
                btn.style.opacity    = disabled ? '0.5' : '1';
                btn.style.cursor     = disabled ? 'not-allowed' : 'pointer';
            }
        });
    }

    // ── Auto-init ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', init);

    return {
        savePAT,
        togglePAT,
        updateDryRun,
        setSymbol,
        onOrderTypeChange,
        submitOrder,
        refresh,
    };

})();

window.TradingTerminal = TradingTerminal;
console.log('✅ TradingTerminal loaded');