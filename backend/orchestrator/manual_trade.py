#!/usr/bin/env python3
# ============================================================
# backend/orchestrator/manual_trade.py
# Exécution d'un ordre manuel via workflow_dispatch GitHub
# Variables d'env injectées par manual-trade.yml
# ============================================================

import os
import sys
import json
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

# ── Import du executor et debug logger ──────────────────────
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.core.ibkr_executor import IBKRExecutor
from backend.core.debug_logger  import debug_log

def main():
    # ── Lecture des paramètres depuis env vars ───────────────
    symbol      = os.environ.get('TRADE_SYMBOL',     'SPY').upper().strip()
    action      = os.environ.get('TRADE_ACTION',     'BUY').upper().strip()
    quantity    = int(os.environ.get('TRADE_QTY',    '1'))
    order_type  = os.environ.get('TRADE_ORDER_TYPE', 'MKT').upper().strip()
    limit_price = os.environ.get('TRADE_LIMIT_PRICE', '')
    stop_price  = os.environ.get('TRADE_STOP_PRICE',  '')
    tif         = os.environ.get('TRADE_TIF',         'DAY').upper().strip()
    reason      = os.environ.get('TRADE_REASON',      'Manual order from dashboard')
    dry_run_env = os.environ.get('DRY_RUN',           'true').lower() == 'true'

    limit_price = float(limit_price) if limit_price else None
    stop_price  = float(stop_price)  if stop_price  else None

    logger.info(
        f"\n{'='*60}\n"
        f"  🖐 ORDRE MANUEL — AlphaVault Quant\n"
        f"  {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')} UTC\n"
        f"  Symbol:     {symbol}\n"
        f"  Action:     {action}\n"
        f"  Quantity:   {quantity}\n"
        f"  Order Type: {order_type}\n"
        f"  Limit:      {limit_price}\n"
        f"  Stop:       {stop_price}\n"
        f"  TIF:        {tif}\n"
        f"  DryRun:     {dry_run_env}\n"
        f"  Reason:     {reason}\n"
        f"{'='*60}"
    )

    debug_log.info(
        f"Démarrage ordre manuel: {action} {quantity}x {symbol}",
        module='manual_trade',
        symbol=symbol,
        details={
            'action': action, 'quantity': quantity,
            'order_type': order_type, 'limit_price': limit_price,
            'stop_price': stop_price, 'dry_run': dry_run_env
        }
    )

    # ── Initialisation executor ──────────────────────────────
    executor = IBKRExecutor()

    # ── Connexion ────────────────────────────────────────────
    logger.info("🔌 Tentative de connexion IBKR...")
    connected = executor.connect(timeout=20)

    if not connected and not dry_run_env:
        logger.error("❌ Impossible de se connecter à IBKR — ordre annulé")
        debug_log.error(
            "Connexion IBKR échouée — ordre annulé",
            module='manual_trade', symbol=symbol
        )
        _save_result({
            'status': 'error',
            'error':  'Cannot connect to IBKR Gateway',
            'symbol': symbol, 'action': action, 'quantity': quantity
        })
        debug_log.save()
        sys.exit(1)

    # ── Placement ordre ──────────────────────────────────────
    logger.info(f"📤 Placement ordre: {action} {quantity}x {symbol} @ {order_type}")

    result = executor.place_order(
        symbol      = symbol,
        action      = action,
        quantity    = quantity,
        order_type  = order_type,
        limit_price = limit_price,
        stop_price  = stop_price,
        tif         = tif,
        source      = 'manual',
        reason      = reason,
    )

    logger.info(f"📋 Résultat: {json.dumps(result, indent=2, default=str)}")

    # Log debug
    debug_log.log_order(
        symbol     = symbol,
        action     = action,
        quantity   = quantity,
        order_type = order_type,
        status     = result.get('status', 'unknown'),
        order_id   = result.get('order_id'),
        fill_price = result.get('fill_price'),
        error      = result.get('error')
    )

    # ── Infos compte après ordre ─────────────────────────────
    if connected:
        account = executor.get_account_summary()
        positions= executor.get_positions()
        logger.info(f"💰 Post-trade account: {json.dumps(account, indent=2)}")
        logger.info(f"📊 Positions: {json.dumps(positions, indent=2)}")

        result['account_after'] = account
        result['positions']     = positions

    # ── Déconnexion ──────────────────────────────────────────
    executor.disconnect()

    # ── Sauvegarde résultats ─────────────────────────────────
    executor.save_execution_log()
    _save_result(result)
    debug_log.save()

    # ── Résumé final ─────────────────────────────────────────
    status_icon = '✅' if result.get('status') not in ('error',) else '❌'
    logger.info(
        f"\n{'='*60}\n"
        f"  {status_icon} ORDRE {'EXÉCUTÉ' if result.get('status') != 'error' else 'ÉCHOUÉ'}\n"
        f"  Status:   {result.get('status')}\n"
        f"  Order ID: {result.get('order_id', 'N/A')}\n"
        f"  Fill:     ${result.get('fill_price', 'N/A')}\n"
        f"{'='*60}"
    )

    if result.get('status') == 'error':
        sys.exit(1)

def _save_result(result: dict):
    """Sauvegarde le résultat dans manual_order_result.json pour le dashboard."""
    path = Path('docs/signals/manual_order_result.json')
    path.parent.mkdir(parents=True, exist_ok=True)

    # Historique
    history = []
    if path.exists():
        try:
            history = json.loads(path.read_text()).get('history', [])
        except Exception:
            pass

    history.append(result)
    history = history[-50:]   # 50 derniers ordres manuels

    payload = {
        'timestamp':    datetime.now(timezone.utc).isoformat(),
        'last_order':   result,
        'total_manual': len(history),
        'history':      history
    }
    path.write_text(json.dumps(payload, indent=2, default=str))
    logger.info(f"💾 manual_order_result.json sauvegardé")

if __name__ == '__main__':
    main()