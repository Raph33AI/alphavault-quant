# ============================================================
# backend/core/ibkr_executor.py
# IBKR Paper Trading Executor — AlphaVault Quant
# ============================================================

import os
import time
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any

from loguru import logger

try:
    from ib_insync import (
        IB, Stock, Option, Future, ETF,
        MarketOrder, LimitOrder, StopOrder, StopLimitOrder,
        TagValue
    )
    IB_AVAILABLE = True
except ImportError:
    IB_AVAILABLE = False
    logger.warning("⚠ ib_insync non installé — mode simulation forcé")

# ── Constantes ────────────────────────────────────────────────
ORDER_TYPES = {
    'MKT':   'Market Order',
    'LMT':   'Limit Order',
    'STP':   'Stop Order',
    'STPLMT':'Stop-Limit Order',
}

class IBKRExecutor:
    """
    Exécuteur d'ordres IBKR avec debug logging complet.
    Supporte Paper Trading et Live (DRY_RUN=True pour simulation pure).
    """

    def __init__(self):
        self.host       = os.environ.get('IBKR_HOST',      '127.0.0.1')
        self.port       = int(os.environ.get('IBKR_PORT',  '4002'))   # 4002 = paper gateway
        self.client_id  = int(os.environ.get('IBKR_CLIENT_ID', '10'))
        self.account    = os.environ.get('IBKR_ACCOUNT',   '')
        self.dry_run    = os.environ.get('DRY_RUN', 'true').lower() == 'true'

        self.ib         = IB() if IB_AVAILABLE else None
        self._connected = False
        self._orders    = []          # Historique local des ordres

        logger.debug(
            f"IBKRExecutor init | host={self.host} port={self.port} "
            f"client_id={self.client_id} account={self.account} "
            f"dry_run={self.dry_run} ib_available={IB_AVAILABLE}"
        )

    # ════════════════════════════════════════════════════════
    # CONNEXION
    # ════════════════════════════════════════════════════════

    def connect(self, timeout: int = 15) -> bool:
        """Connecte à IB Gateway. Retourne True si succès."""
        if not IB_AVAILABLE:
            logger.warning("⚠ ib_insync non disponible — connexion impossible")
            return False
        if self.dry_run:
            logger.info("🧪 DRY_RUN=True — pas de connexion IBKR réelle")
            return True

        logger.info(f"🔌 Connexion IBKR → {self.host}:{self.port} (clientId={self.client_id})")
        try:
            self.ib.connect(
                host=self.host,
                port=self.port,
                clientId=self.client_id,
                timeout=timeout,
                readonly=False
            )
            self._connected = True

            # Infos compte
            account_summary = self.ib.accountSummary(self.account)
            net_liq = next(
                (s.value for s in account_summary if s.tag == 'NetLiquidation'), 'N/A'
            )
            logger.info(f"✅ IBKR connecté | Account: {self.account} | NetLiq: ${net_liq}")
            logger.debug(f"Server version: {self.ib.client.serverVersion()}")
            return True

        except Exception as e:
            logger.error(f"❌ Connexion IBKR échouée: {type(e).__name__}: {e}")
            self._connected = False
            return False

    def disconnect(self):
        if self._connected and self.ib:
            self.ib.disconnect()
            self._connected = False
            logger.info("🔌 IBKR déconnecté proprement")

    def is_connected(self) -> bool:
        if self.dry_run:
            return True
        return self._connected and self.ib.isConnected()

    # ════════════════════════════════════════════════════════
    # CRÉATION DE CONTRATS
    # ════════════════════════════════════════════════════════

    def _build_contract(self, symbol: str, sec_type: str = 'STK') -> Any:
        """Construit et qualifie un contrat IBKR."""
        logger.debug(f"🏗 Build contract: {symbol} ({sec_type})")

        if sec_type == 'STK':
            contract = Stock(symbol, 'SMART', 'USD')
        elif sec_type == 'ETF':
            contract = Stock(symbol, 'SMART', 'USD')
        elif sec_type == 'FUT':
            contract = Future(symbol)
        else:
            contract = Stock(symbol, 'SMART', 'USD')

        if not self.dry_run and self._connected:
            try:
                qualified = self.ib.qualifyContracts(contract)
                if qualified:
                    logger.debug(
                        f"✅ Contrat qualifié: {symbol} | "
                        f"conId={qualified[0].conId} | "
                        f"exchange={qualified[0].exchange}"
                    )
                    return qualified[0]
            except Exception as e:
                logger.warning(f"⚠ Qualification contrat {symbol}: {e}")

        return contract

    # ════════════════════════════════════════════════════════
    # CONSTRUCTION ORDRES
    # ════════════════════════════════════════════════════════

    def _build_order(
        self,
        action: str,
        quantity: int,
        order_type: str = 'MKT',
        limit_price: Optional[float] = None,
        stop_price: Optional[float] = None,
        tif: str = 'DAY',
    ) -> Any:
        """Construit l'objet ordre IBKR."""
        logger.debug(
            f"🏗 Build order: {action} {quantity}x | type={order_type} | "
            f"lmt={limit_price} | stp={stop_price} | tif={tif}"
        )

        action = action.upper()  # 'BUY' ou 'SELL'

        if order_type == 'MKT':
            order = MarketOrder(action, quantity)

        elif order_type == 'LMT':
            if limit_price is None:
                raise ValueError("limit_price requis pour LMT order")
            order = LimitOrder(action, quantity, limit_price)

        elif order_type == 'STP':
            if stop_price is None:
                raise ValueError("stop_price requis pour STP order")
            order = StopOrder(action, quantity, stop_price)

        elif order_type == 'STPLMT':
            if stop_price is None or limit_price is None:
                raise ValueError("stop_price ET limit_price requis pour STPLMT")
            order = StopLimitOrder(action, quantity, limit_price, stop_price)

        else:
            logger.warning(f"⚠ Order type inconnu '{order_type}' → fallback MKT")
            order = MarketOrder(action, quantity)

        order.tif     = tif
        order.account = self.account

        # Algorithmic order tag pour TWAP/VWAP
        if order_type in ('TWAP', 'VWAP'):
            order.algoStrategy = order_type
            order.algoParams   = [TagValue('startTime', ''), TagValue('endTime', '')]
            order.orderType    = 'LMT'
            if limit_price:
                order.lmtPrice = limit_price

        return order

    # ════════════════════════════════════════════════════════
    # PLACEMENT D'ORDRE (méthode principale)
    # ════════════════════════════════════════════════════════

    def place_order(
        self,
        symbol:      str,
        action:      str,           # 'BUY' | 'SELL'
        quantity:    int,
        order_type:  str   = 'MKT',
        limit_price: Optional[float] = None,
        stop_price:  Optional[float] = None,
        tif:         str   = 'DAY',
        source:      str   = 'auto',  # 'auto' | 'manual'
        reason:      str   = '',
    ) -> Dict[str, Any]:
        """
        Place un ordre sur IBKR.
        Retourne un dict avec status, order_id, et tous les détails.
        """
        ts = datetime.now(timezone.utc).isoformat()
        logger.info(
            f"\n{'='*60}\n"
            f"  📊 ORDRE {action} | {symbol} x{quantity}\n"
            f"  Type: {order_type} | Limit: {limit_price} | Stop: {stop_price}\n"
            f"  Source: {source} | TIF: {tif}\n"
            f"  DryRun: {self.dry_run} | Reason: {reason}\n"
            f"{'='*60}"
        )

        result = {
            'timestamp':   ts,
            'symbol':      symbol,
            'action':      action.upper(),
            'quantity':    quantity,
            'order_type':  order_type,
            'limit_price': limit_price,
            'stop_price':  stop_price,
            'tif':         tif,
            'source':      source,
            'reason':      reason,
            'dry_run':     self.dry_run,
            'status':      'pending',
            'order_id':    None,
            'fill_price':  None,
            'error':       None,
        }

        # ── Mode DRY RUN (simulation pure) ──────────────────
        if self.dry_run:
            logger.info(f"🧪 [DRY RUN] Simulation ordre {action} {quantity}x {symbol}")
            result.update({
                'status':   'simulated',
                'order_id': -1,
                'message':  f'Simulated {action} {quantity}x {symbol} @ {order_type}'
            })
            self._log_order(result)
            return result

        # ── Mode Paper/Live ──────────────────────────────────
        if not self._connected:
            logger.error("❌ Non connecté à IBKR — ordre annulé")
            result.update({'status': 'error', 'error': 'Not connected to IBKR'})
            self._log_order(result)
            return result

        try:
            # 1. Contrat
            contract = self._build_contract(symbol)
            logger.debug(f"📄 Contrat: {contract}")

            # 2. Ordre
            order = self._build_order(
                action, quantity, order_type,
                limit_price, stop_price, tif
            )
            logger.debug(f"📋 Ordre: {order}")

            # 3. Placement
            logger.info(f"📤 Envoi ordre à IBKR...")
            trade = self.ib.placeOrder(contract, order)
            self.ib.sleep(2)   # Attente acknowledgment

            order_id = trade.order.orderId
            status   = trade.orderStatus.status
            filled   = trade.orderStatus.filled
            avg_fill = trade.orderStatus.avgFillPrice

            logger.info(
                f"✅ Ordre placé | orderId={order_id} | "
                f"status={status} | filled={filled} | avgFill=${avg_fill}"
            )

            # 4. Logs détaillés de la trade
            logger.debug(f"Trade log: {trade.log}")

            result.update({
                'status':      'placed',
                'order_id':    order_id,
                'ibkr_status': status,
                'filled':      filled,
                'fill_price':  avg_fill,
                'message':     f'Order {order_id} placed — status: {status}'
            })

        except Exception as e:
            logger.error(f"❌ Erreur placement ordre {symbol}: {type(e).__name__}: {e}")
            result.update({'status': 'error', 'error': str(e)})

        self._log_order(result)
        return result

    # ════════════════════════════════════════════════════════
    # GESTION POSITIONS
    # ════════════════════════════════════════════════════════

    def get_positions(self) -> list:
        """Récupère les positions ouvertes du compte paper."""
        if self.dry_run or not self._connected:
            logger.debug("get_positions: dry_run ou non connecté → []")
            return []

        try:
            positions = self.ib.positions(self.account)
            result = []
            for pos in positions:
                result.append({
                    'symbol':    pos.contract.symbol,
                    'sec_type':  pos.contract.secType,
                    'position':  pos.position,
                    'avg_cost':  pos.avgCost,
                    'market_val': pos.position * pos.avgCost
                })
                logger.debug(
                    f"Position: {pos.contract.symbol} | "
                    f"qty={pos.position} | avgCost={pos.avgCost}"
                )
            return result
        except Exception as e:
            logger.error(f"❌ get_positions: {e}")
            return []

    def get_account_summary(self) -> dict:
        """Récupère le résumé du compte paper."""
        if self.dry_run or not self._connected:
            return {
                'net_liquidation': 100000,
                'available_funds': 100000,
                'unrealized_pnl':  0,
                'realized_pnl':    0,
                'dry_run':         True
            }
        try:
            summary = self.ib.accountSummary(self.account)
            data = {s.tag: s.value for s in summary}
            result = {
                'net_liquidation': float(data.get('NetLiquidation',     0)),
                'available_funds': float(data.get('AvailableFunds',     0)),
                'unrealized_pnl':  float(data.get('UnrealizedPnL',     0)),
                'realized_pnl':    float(data.get('RealizedPnL',       0)),
                'buying_power':    float(data.get('BuyingPower',        0)),
                'dry_run':         False
            }
            logger.info(
                f"💰 Account | NetLiq=${result['net_liquidation']:,.0f} | "
                f"AvailFunds=${result['available_funds']:,.0f} | "
                f"UPnL=${result['unrealized_pnl']:,.0f}"
            )
            return result
        except Exception as e:
            logger.error(f"❌ get_account_summary: {e}")
            return {}

    def cancel_all_orders(self) -> int:
        """Annule tous les ordres ouverts. Retourne le nombre annulé."""
        if self.dry_run or not self._connected:
            logger.info("cancel_all_orders: dry_run — rien à annuler")
            return 0
        try:
            open_orders = self.ib.openOrders()
            count = 0
            for order in open_orders:
                self.ib.cancelOrder(order)
                logger.info(f"❌ Ordre annulé: orderId={order.orderId}")
                count += 1
            logger.info(f"✅ {count} ordres annulés")
            return count
        except Exception as e:
            logger.error(f"❌ cancel_all_orders: {e}")
            return 0

    # ════════════════════════════════════════════════════════
    # LOGGING INTERNE
    # ════════════════════════════════════════════════════════

    def _log_order(self, result: dict):
        """Sauvegarde l'ordre dans l'historique local."""
        self._orders.append(result)

    def get_order_history(self) -> list:
        return self._orders

    def save_execution_log(self, output_path: str = 'docs/signals/execution_log.json'):
        """Sauvegarde l'historique des ordres dans un JSON pour le dashboard."""
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        # Charge l'existant
        existing = []
        if path.exists():
            try:
                existing = json.loads(path.read_text()).get('orders', [])
            except Exception:
                pass

        # Fusionne (garde les 200 derniers)
        all_orders = existing + self._orders
        all_orders = all_orders[-200:]

        data = {
            'timestamp':    datetime.now(timezone.utc).isoformat(),
            'total_orders': len(all_orders),
            'orders':       all_orders
        }
        path.write_text(json.dumps(data, indent=2, default=str))
        logger.info(f"💾 execution_log.json sauvegardé ({len(all_orders)} ordres)")