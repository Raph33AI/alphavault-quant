# ============================================================
# backend/core/ibkr_executor.py v2.0
# IBKR Executor via Client Portal REST API (IBeam)
# ============================================================
# Migration v2.0 :
#   ib_insync (port 4002 TWS)  →  httpx REST (port 5055 IBeam)
#
# ⚠ Architecture AlphaVault :
#   IBeam  = Client Portal REST API  (port 5055)  ← UTILISÉ ICI
#   TWS    = Socket API              (port 4002)  ← INCOMPATIBLE IBeam
#   ib_insync parle TWS → jamais compatible avec IBeam
# ============================================================

import os
import time
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List

import httpx
from loguru import logger

# ── Exchanges valides (ETFs: ARCA, Actions: NASDAQ/NYSE) ──
VALID_EXCHANGES = {"NASDAQ", "NYSE", "SMART", "ARCA", "AMEX", "BATS", "ISLAND"}

# ── Mapping types d'ordre (REST API IBKR) ─────────────────
ORDER_TYPE_MAP = {
    "MKT":    "MKT",
    "MARKET": "MKT",
    "LMT":    "LMT",
    "LIMIT":  "LMT",
    "STP":    "STP",
    "STOP":   "STP",
    "STPLMT": "STPLMT",
}

class IBKRExecutor:
    """
    Exécuteur d'ordres IBKR via Client Portal REST API (IBeam).
    Supporte Paper Trading et Live (DRY_RUN=True pour simulation pure).

    v2.0 : Migration complète ib_insync → httpx REST
           Endpoint : https://localhost:5055/v1/api/...
           Auth     : session IBeam (TOTP auto via ibkr_watchdog)
    """

    def __init__(self):
        self.ibeam_url  = os.environ.get("IBEAM_BASE_URL", "https://localhost:5055")
        self.account    = os.environ.get("IBKR_ACCOUNT",   "DUM895161")
        self.dry_run    = os.environ.get("DRY_RUN", "true").lower() == "true"

        # Client httpx partagé (SSL non vérifié — cert auto-signé IBeam)
        self._http      = httpx.Client(verify=False, timeout=15)
        self._connected = False
        self._orders: List[Dict] = []

        logger.debug(
            f"IBKRExecutor v2.0 init | ibeam={self.ibeam_url} "
            f"account={self.account} dry_run={self.dry_run}"
        )

    # ════════════════════════════════════════════════════════
    # CONNEXION / AUTH
    # ════════════════════════════════════════════════════════

    def connect(self, timeout: int = 15) -> bool:
        """
        Vérifie la session IBeam et marque le client comme connecté.
        Pas de socket — juste un GET sur /iserver/auth/status.
        """
        if self.dry_run:
            logger.info("🧪 DRY_RUN=True — connexion simulée (pas de vraie session IBKR)")
            self._connected = True
            return True

        logger.info(f"🔌 Vérification session IBeam → {self.ibeam_url}")
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/auth/status",
                timeout=timeout
            )
            data = r.json()
            authenticated = data.get("authenticated", False)

            if authenticated:
                self._connected = True
                logger.info(
                    f"✅ IBeam connecté | authenticated={authenticated} | "
                    f"competing={data.get('competing', False)} | "
                    f"connected={data.get('connected', False)}"
                )
                # Récupère le résumé du compte pour confirmation
                self._log_account_summary()
                return True
            else:
                logger.error(
                    f"❌ IBeam non authentifié | réponse: {data} | "
                    f"→ Vérifiez ibkr_watchdog.sh et docker compose ps"
                )
                self._connected = False
                return False

        except Exception as e:
            logger.error(f"❌ Connexion IBeam échouée: {type(e).__name__}: {e}")
            self._connected = False
            return False

    def disconnect(self):
        """Ferme le client HTTP proprement."""
        if self._http:
            self._http.close()
        self._connected = False
        logger.info("🔌 IBKRExecutor déconnecté (client HTTP fermé)")

    def is_connected(self) -> bool:
        if self.dry_run:
            return True
        return self._connected and self._check_auth_live()

    def _check_auth_live(self) -> bool:
        """Ping rapide pour vérifier la session IBeam."""
        try:
            r = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/auth/status",
                timeout=5
            )
            return r.status_code == 200 and r.json().get("authenticated", False)
        except Exception:
            return False

    def tickle(self):
        """Maintient la session IBeam active (à appeler régulièrement)."""
        try:
            r = self._http.get(f"{self.ibeam_url}/v1/api/tickle", timeout=10)
            logger.debug(f"IBeam tickle: {r.status_code}")
        except Exception as e:
            logger.debug(f"tickle: {e}")

    # ════════════════════════════════════════════════════════
    # RÉSOLUTION CONID
    # ════════════════════════════════════════════════════════

    def get_conid(self, symbol: str) -> Optional[int]:
        """
        Résout symbol → conid IBKR via REST API.
        Méthode 1 : /trsrv/stocks (priorité exchanges valides)
        Méthode 2 : /iserver/secdef/search (fallback)
        """
        # ── Méthode 1 : /trsrv/stocks ────────────────────────
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/trsrv/stocks",
                params={"symbols": symbol},
                timeout=10
            )
            data = r.json()

            # Priorité aux exchanges validés
            for item in data.get(symbol, []):
                for contract in item.get("contracts", []):
                    exch = contract.get("exchange", "")
                    if exch in VALID_EXCHANGES:
                        conid = contract["conid"]
                        logger.debug(f"conid({symbol}): {conid} via {exch} [trsrv/stocks]")
                        return conid

            # Fallback : premier contrat disponible
            for item in data.get(symbol, []):
                contracts = item.get("contracts", [])
                if contracts:
                    conid = contracts[0]["conid"]
                    exch  = contracts[0].get("exchange", "?")
                    logger.warning(f"conid({symbol}): {conid} via {exch} [fallback exchange]")
                    return conid

        except Exception as e:
            logger.warning(f"get_conid method 1 ({symbol}): {e}")

        # ── Méthode 2 : /secdef/search ────────────────────────
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/secdef/search",
                params={"symbol": symbol, "name": False, "secType": "STK"},
                timeout=10
            )
            data = r.json()
            if isinstance(data, list) and data:
                conid = data[0].get("conid")
                if conid:
                    logger.debug(f"conid({symbol}): {conid} [secdef/search]")
                    return conid
        except Exception as e:
            logger.warning(f"get_conid method 2 ({symbol}): {e}")

        logger.error(f"Cannot resolve conid for {symbol}")
        return None

    # ════════════════════════════════════════════════════════
    # PLACEMENT D'ORDRE (méthode principale)
    # ════════════════════════════════════════════════════════

    def place_order(
        self,
        symbol:      str,
        action:      str,
        quantity:    int,
        order_type:  str            = "MKT",
        limit_price: Optional[float] = None,
        stop_price:  Optional[float] = None,
        tif:         str            = "DAY",
        source:      str            = "auto",
        reason:      str            = "",
    ) -> Dict[str, Any]:
        """
        Place un ordre via Client Portal REST API.
        Gère le 2-step confirmation IBKR automatiquement.

        Returns:
            Dict avec status, order_id, fill_price, error, etc.
        """
        ts     = datetime.now(timezone.utc).isoformat()
        action = action.upper()
        ibkr_order_type = ORDER_TYPE_MAP.get(order_type.upper(), "MKT")

        logger.info(
            f"\n{'='*60}\n"
            f"  📊 ORDRE {action} | {symbol} x{quantity}\n"
            f"  Type: {ibkr_order_type} | Limit: {limit_price} | Stop: {stop_price}\n"
            f"  Source: {source} | TIF: {tif} | DryRun: {self.dry_run}\n"
            f"  Reason: {reason}\n"
            f"{'='*60}"
        )

        result: Dict[str, Any] = {
            "timestamp":     ts,
            "symbol":        symbol,
            "action":        action,
            "quantity":      quantity,
            "order_type":    ibkr_order_type,
            "limit_price":   limit_price,
            "stop_price":    stop_price,
            "tif":           tif,
            "source":        source,
            "reason":        reason,
            "dry_run":       self.dry_run,
            "account":       self.account,
            "status":        "pending",
            "order_id":      None,
            "fill_price":    None,
            "error":         None,
        }

        # ── DRY RUN : simulation pure ─────────────────────────
        if self.dry_run:
            logger.info(f"🧪 [DRY RUN] Simulation {action} {quantity}x {symbol}")
            result.update({
                "status":  "simulated",
                "order_id": -1,
                "message": f"[DRY RUN] {action} {quantity}x {symbol} @ {ibkr_order_type}",
            })
            self._log_order(result)
            return result

        # ── Vérification connexion ────────────────────────────
        if not self._connected:
            logger.error("❌ Non connecté à IBeam — reconnexion...")
            if not self.connect():
                result.update({"status": "error", "error": "IBeam not connected"})
                self._log_order(result)
                return result

        # ── Résolution conid ──────────────────────────────────
        conid = self.get_conid(symbol)
        if not conid:
            result.update({
                "status": "error",
                "error":  f"conid not found for {symbol}",
            })
            self._log_order(result)
            return result

        # ── Construction du payload ordre ─────────────────────
        order_payload: Dict[str, Any] = {
            "acctId":    self.account,
            "conid":     conid,
            "orderType": ibkr_order_type,
            "side":      action,
            "quantity":  quantity,
            "tif":       tif,
        }

        if ibkr_order_type in ("LMT", "STPLMT") and limit_price:
            order_payload["price"] = limit_price

        if ibkr_order_type in ("STP", "STPLMT") and stop_price:
            order_payload["auxPrice"] = stop_price

        # ── Soumission initiale ───────────────────────────────
        try:
            logger.info(
                f"📤 POST /orders | {action} {quantity}x {symbol} "
                f"conid={conid} | type={ibkr_order_type}"
            )
            r    = self._http.post(
                f"{self.ibeam_url}/v1/api/iserver/account/{self.account}/orders",
                json={"orders": [order_payload]},
                timeout=15,
            )
            data = r.json()
            logger.debug(f"POST /orders réponse: {data}")

            if not isinstance(data, list) or not data:
                result.update({
                    "status": "error",
                    "error":  f"Réponse vide ou invalide: {data}",
                })
                self._log_order(result)
                return result

            first = data[0]

            # ── CAS 1 : ordre direct (pas de confirmation requise) ─
            if "order_id" in first or "orderId" in first:
                order_id = first.get("order_id") or first.get("orderId")
                status   = first.get("order_status", "Submitted")
                logger.success(
                    f"✅ Ordre soumis directement | order_id={order_id} | "
                    f"status={status}"
                )
                result.update({
                    "status":      "submitted",
                    "order_id":    order_id,
                    "ibkr_status": status,
                    "message":     f"Order {order_id} submitted — {status}",
                })
                self._log_order(result)
                return result

            # ── CAS 2 : confirmation 2-step requise ───────────────
            if "id" in first:
                result = self._handle_confirmation(first, result)
                self._log_order(result)
                return result

            # ── CAS 3 : réponse inattendue ────────────────────────
            result.update({
                "status": "error",
                "error":  f"Réponse inattendue: {first}",
            })

        except Exception as e:
            logger.error(f"❌ place_order exception ({symbol}): {type(e).__name__}: {e}")
            result.update({"status": "error", "error": str(e)})

        self._log_order(result)
        return result

    def _handle_confirmation(
        self,
        confirmation_data: Dict,
        result: Dict,
    ) -> Dict:
        """
        Gère le 2-step confirmation IBKR.
        Confirme automatiquement le message de précaution.
        Peut gérer plusieurs rounds de confirmation consécutifs.
        """
        confirm_id = confirmation_data.get("id")
        messages   = confirmation_data.get("message", [])
        logger.info(
            f"🔔 Confirmation requise | id={confirm_id} | "
            f"messages={messages}"
        )

        max_rounds = 3  # Sécurité anti-boucle infinie
        for round_n in range(1, max_rounds + 1):
            try:
                logger.info(f"  → Confirmation round {round_n}/3 | id={confirm_id}")
                cr   = self._http.post(
                    f"{self.ibeam_url}/v1/api/iserver/reply/{confirm_id}",
                    json={"confirmed": True},
                    timeout=15,
                )
                cd = cr.json()
                logger.debug(f"  Réponse confirmation: {cd}")

                if not isinstance(cd, list) or not cd:
                    result.update({
                        "status": "error",
                        "error":  f"Confirmation vide: {cd}",
                    })
                    return result

                first = cd[0]

                # Ordre confirmé → extrait order_id
                if "order_id" in first or "orderId" in first:
                    order_id = first.get("order_id") or first.get("orderId")
                    status   = first.get("order_status", "Submitted")
                    logger.success(
                        f"✅ Ordre confirmé | order_id={order_id} | "
                        f"status={status}"
                    )
                    result.update({
                        "status":      "submitted",
                        "order_id":    order_id,
                        "ibkr_status": status,
                        "message":     f"Order {order_id} confirmed — {status}",
                    })
                    return result

                # Nouvelle confirmation requise (cas rare)
                if "id" in first:
                    confirm_id = first["id"]
                    messages   = first.get("message", [])
                    logger.warning(
                        f"  ⚠ Nouvelle confirmation requise | "
                        f"id={confirm_id} | msg={messages}"
                    )
                    continue

                result.update({
                    "status": "error",
                    "error":  f"Réponse confirmation inattendue: {first}",
                })
                return result

            except Exception as e:
                logger.error(f"_handle_confirmation round {round_n}: {e}")
                result.update({"status": "error", "error": str(e)})
                return result

        result.update({
            "status": "error",
            "error":  f"Max confirmation rounds ({max_rounds}) atteint sans succès",
        })
        return result

    # ════════════════════════════════════════════════════════
    # GESTION POSITIONS & COMPTE
    # ════════════════════════════════════════════════════════

    def get_positions(self) -> List[Dict]:
        """Récupère les positions ouvertes via REST API."""
        if self.dry_run or not self._connected:
            logger.debug("get_positions: dry_run ou non connecté → []")
            return []

        try:
            positions = []
            page = 0
            while True:
                r    = self._http.get(
                    f"{self.ibeam_url}/v1/api/portfolio/{self.account}/positions/{page}",
                    timeout=15,
                )
                data = r.json()
                if not data:
                    break
                for pos in data:
                    size = pos.get("position", 0)
                    if size == 0:
                        continue
                    positions.append({
                        "symbol":     pos.get("contractDesc", pos.get("ticker", "?")),
                        "conid":      pos.get("conid"),
                        "position":   size,
                        "avg_cost":   pos.get("avgCost",    0),
                        "mkt_price":  pos.get("mktPrice",   0),
                        "market_val": pos.get("mktValue",   0),
                        "unrealized_pnl": pos.get("unrealizedPnl", 0),
                        "realized_pnl":   pos.get("realizedPnl",   0),
                    })
                    logger.debug(
                        f"Position: {pos.get('contractDesc','?')} | "
                        f"qty={size} | avgCost={pos.get('avgCost',0):.2f} | "
                        f"uPnL={pos.get('unrealizedPnl',0):.2f}"
                    )
                page += 1
                if len(data) < 100:
                    break  # Dernière page

            logger.info(f"📊 {len(positions)} position(s) ouvertes")
            return positions

        except Exception as e:
            logger.error(f"❌ get_positions: {e}")
            return []

    def get_account_summary(self) -> Dict:
        """Récupère le résumé financier du compte via REST API."""
        if self.dry_run or not self._connected:
            return {
                "net_liquidation": 100_000.0,
                "available_funds": 100_000.0,
                "unrealized_pnl":      0.0,
                "realized_pnl":        0.0,
                "buying_power":   100_000.0,
                "dry_run":           True,
            }

        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/portfolio/{self.account}/summary",
                timeout=15,
            )
            data = r.json()

            def _val(key: str) -> float:
                entry = data.get(key, {})
                if isinstance(entry, dict):
                    return float(entry.get("amount", entry.get("value", 0)))
                return float(entry or 0)

            result = {
                "net_liquidation": _val("netliquidation"),
                "available_funds": _val("availablefunds"),
                "unrealized_pnl":  _val("unrealizedpnl"),
                "realized_pnl":    _val("realizedpnl"),
                "buying_power":    _val("buyingpower"),
                "equity_value":    _val("equitywithloanvalue"),
                "dry_run":         False,
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

    def _log_account_summary(self):
        """Log le résumé du compte à la connexion."""
        try:
            summary = self.get_account_summary()
            if summary and not summary.get("dry_run"):
                logger.info(
                    f"💼 Compte {self.account} | "
                    f"NetLiq=${summary.get('net_liquidation',0):,.0f} | "
                    f"BuyingPower=${summary.get('buying_power',0):,.0f}"
                )
        except Exception:
            pass

    def get_open_orders(self) -> List[Dict]:
        """Récupère les ordres ouverts (non exécutés)."""
        if self.dry_run or not self._connected:
            return []

        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/account/orders"
                f"?accountId={self.account}",
                timeout=15,
            )
            data = r.json()
            orders = data.get("orders", []) if isinstance(data, dict) else []
            logger.info(f"📋 {len(orders)} ordre(s) ouvert(s)")
            return orders
        except Exception as e:
            logger.error(f"❌ get_open_orders: {e}")
            return []

    def cancel_all_orders(self) -> int:
        """Annule tous les ordres ouverts. Retourne le nombre annulé."""
        if self.dry_run or not self._connected:
            logger.info("cancel_all_orders: dry_run ou non connecté → 0")
            return 0

        open_orders = self.get_open_orders()
        cancelled   = 0

        for order in open_orders:
            order_id = order.get("orderId") or order.get("order_id")
            if not order_id:
                continue
            try:
                r = self._http.delete(
                    f"{self.ibeam_url}/v1/api/iserver/account/"
                    f"{self.account}/order/{order_id}",
                    timeout=10,
                )
                if r.status_code in (200, 204):
                    logger.info(f"❌ Ordre annulé: orderId={order_id}")
                    cancelled += 1
                else:
                    logger.warning(
                        f"⚠ Annulation ordre {order_id}: "
                        f"status={r.status_code}"
                    )
            except Exception as e:
                logger.error(f"cancel_order {order_id}: {e}")

        logger.info(f"✅ {cancelled}/{len(open_orders)} ordres annulés")
        return cancelled

    # ════════════════════════════════════════════════════════
    # LOGGING INTERNE & PERSISTANCE
    # ════════════════════════════════════════════════════════

    def _log_order(self, result: Dict):
        """Sauvegarde l'ordre dans l'historique local."""
        self._orders.append(result)

    def get_order_history(self) -> List[Dict]:
        return self._orders

    def save_execution_log(
        self,
        output_path: str = "docs/signals/execution_log.json",
    ):
        """Sauvegarde l'historique des ordres pour le dashboard."""
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        existing = []
        if path.exists():
            try:
                existing = json.loads(path.read_text()).get("orders", [])
            except Exception:
                pass

        all_orders = (existing + self._orders)[-200:]
        data = {
            "timestamp":    datetime.now(timezone.utc).isoformat(),
            "total_orders": len(all_orders),
            "account":      self.account,
            "orders":       all_orders,
        }
        path.write_text(json.dumps(data, indent=2, default=str))
        logger.info(f"💾 execution_log.json sauvegardé ({len(all_orders)} ordres)")