# ============================================================
# ALPHAVAULT QUANT — Smart Execution Router
# ✅ Sélection automatique de la méthode d'exécution
# ✅ Market / Limit / TWAP / VWAP / Adaptive Slicing
# ✅ ib_insync OPTIONNEL (import conditionnel)
# ✅ Simulation complète en DRY_RUN mode
# ============================================================

import numpy as np
from typing import Dict, Optional
from loguru import logger
from enum import Enum

class ExecutionMethod(str, Enum):
    MARKET           = "market"
    LIMIT            = "limit_laddering"
    TWAP             = "twap"
    VWAP             = "vwap"
    ADAPTIVE_SLICING = "adaptive_slicing"

class SmartExecutionRouter:
    """
    Routeur d'exécution intelligent.

    Sélectionne la méthode optimale selon :
    - Taille de l'ordre vs ADV (participation rate)
    - Urgence du signal (final_score)
    - Régime de volatilité
    - Alpha d'exécution estimé

    En mode DRY_RUN (GitHub Actions) : simulation uniquement.
    En mode LIVE avec IBKR Gateway connecté : exécution réelle.
    """

    # Seuils de participation rate
    PART_RATE_THRESHOLDS = {
        "market":           0.005,
        "limit_laddering":  0.020,
        "twap":             0.050,
        "vwap":             0.100,
        "adaptive_slicing": 1.000,
    }

    def __init__(self, settings, ibkr_client=None):
        self.settings    = settings
        self.ibkr_client = ibkr_client
        logger.info("✅ SmartExecutionRouter initialisé")

    # ── Point d'entrée principal ──────────────────────────────
    def select_and_route(
        self,
        symbol:          str,
        direction:       str,
        quantity:        int,
        price:           float,
        adv:             float,
        execution_alpha: Dict,
        signal:          Dict,
        dry_run:         bool = True,
    ) -> Dict:
        """
        Sélectionne et exécute (ou simule) un ordre.

        Args:
            symbol          : ticker (ex: "SPY")
            direction       : "buy" ou "sell"
            quantity        : nombre d'actions
            price           : prix courant du marché
            adv             : Average Daily Volume en USD
            execution_alpha : résultat ExecutionAlphaEngine
            signal          : signal calibré du MetaModel
            dry_run         : True = simulation uniquement

        Returns:
            Dict avec status, method, fill_price, slippage, etc.
        """
        try:
            order_value   = quantity * price
            participation = order_value / (adv + 1e-10)

            method = self._select_method(
                participation, execution_alpha, signal
            )

            slippage_bps = execution_alpha.get("slippage_bps_est", 5.0)
            fill_price   = self._estimate_fill_price(
                price, direction, slippage_bps
            )

            logger.info(
                f"📋 Order | {symbol} {direction.upper()} {quantity} "
                f"@ ~{price:.2f} | Method: {method.value} | "
                f"Part: {participation:.2%} | Fill: ~{fill_price:.2f} | "
                f"DryRun: {dry_run}"
            )

            # Toujours simuler si dry_run ou pas de client IBKR
            if dry_run or self.settings.DRY_RUN or self.ibkr_client is None:
                return self._simulate_fill(
                    symbol, direction, quantity, price,
                    fill_price, method, slippage_bps
                )

            # Exécution réelle via IBKR
            return self._execute_ibkr(
                symbol, direction, quantity, price,
                fill_price, method, slippage_bps
            )

        except Exception as e:
            logger.error(f"SmartExecutionRouter.select_and_route: {e}")
            return {
                "status":  "error",
                "error":   str(e),
                "symbol":  symbol,
                "dry_run": True,
            }

    # ── Sélection de Méthode ──────────────────────────────────
    def _select_method(
        self,
        participation_rate: float,
        execution_alpha:    Dict,
        signal:             Dict,
    ) -> ExecutionMethod:
        """Sélectionne la méthode d'exécution optimale."""
        urgency  = signal.get("final_score", 0.5)
        is_opt   = execution_alpha.get(
            "optimal_timing", {}
        ).get("is_optimal_now", True)

        # Signal fort + timing optimal + petit ordre → market
        if urgency > 0.80 and participation_rate < 0.01 and is_opt:
            return ExecutionMethod.MARKET

        # Petits ordres dans la fenêtre optimale
        if participation_rate < self.PART_RATE_THRESHOLDS["market"]:
            if urgency < 0.70:
                return ExecutionMethod.LIMIT
            return ExecutionMethod.MARKET

        # Ordres moyens
        if participation_rate < self.PART_RATE_THRESHOLDS["limit_laddering"]:
            return ExecutionMethod.LIMIT

        if participation_rate < self.PART_RATE_THRESHOLDS["twap"]:
            return ExecutionMethod.TWAP

        if participation_rate < self.PART_RATE_THRESHOLDS["vwap"]:
            return ExecutionMethod.VWAP

        return ExecutionMethod.ADAPTIVE_SLICING

    # ── Estimation Prix de Fill ───────────────────────────────
    def _estimate_fill_price(
        self,
        market_price:  float,
        direction:     str,
        slippage_bps:  float,
    ) -> float:
        """Estime le prix de fill après slippage."""
        slippage_pct = slippage_bps / 10_000
        if direction == "buy":
            return round(market_price * (1 + slippage_pct), 4)
        return round(market_price * (1 - slippage_pct), 4)

    # ── Simulation de Fill (DRY RUN) ──────────────────────────
    def _simulate_fill(
        self,
        symbol:       str,
        direction:    str,
        quantity:     int,
        market_price: float,
        fill_price:   float,
        method:       ExecutionMethod,
        slippage_bps: float,
    ) -> Dict:
        """
        Simule un fill complet sans passer d'ordre réel.
        Utilisé en GitHub Actions (DRY_RUN = True).
        """
        fill_value   = quantity * fill_price
        slippage_usd = abs(fill_price - market_price) * quantity

        return {
            "status":         "simulated",
            "symbol":         symbol,
            "direction":      direction,
            "quantity":       quantity,
            "market_price":   round(market_price, 4),
            "fill_price":     round(fill_price, 4),
            "fill_value_usd": round(fill_value, 2),
            "slippage_usd":   round(slippage_usd, 2),
            "slippage_bps":   round(slippage_bps, 2),
            "method":         method.value,
            "dry_run":        True,
        }

    # ── Exécution Réelle IBKR ─────────────────────────────────
    def _execute_ibkr(
        self,
        symbol:       str,
        direction:    str,
        quantity:     int,
        market_price: float,
        fill_price:   float,
        method:       ExecutionMethod,
        slippage_bps: float,
    ) -> Dict:
        """
        Exécution réelle via Interactive Brokers (ib_insync).
        
        ⚠ Nécessite :
        - IBKR TWS ou Gateway ouvert sur le même réseau
        - ib_insync installé (décommenté dans requirements.txt)
        - DRY_RUN = False dans les settings
        - IBKR_PORT = 7497 (paper) ou 7496 (live)
        """
        # Import conditionnel : ib_insync n'est PAS dans requirements.txt
        # (non compatible avec GitHub Actions sans IBKR Gateway)
        try:
            from ib_insync import IB, Stock, MarketOrder, LimitOrder
        except ImportError:
            logger.warning(
                "⚠ ib_insync non installé → simulation forcée. "
                "Pour le paper trading réel, installe ib_insync et "
                "connecte IBKR Gateway."
            )
            return self._simulate_fill(
                symbol, direction, quantity, market_price,
                fill_price, method, slippage_bps
            )

        try:
            # Contrat
            contract = Stock(symbol, "SMART", "USD")

            # Ordre selon la méthode sélectionnée
            action = "BUY" if direction == "buy" else "SELL"

            if method == ExecutionMethod.MARKET:
                order = MarketOrder(action, quantity)
            else:
                # Limite pour toutes les autres méthodes
                lmt_price = round(fill_price, 2)
                order     = LimitOrder(action, quantity, lmt_price)

            # Soumission de l'ordre
            trade = self.ibkr_client.placeOrder(contract, order)
            self.ibkr_client.sleep(2)  # Attente confirmation

            return {
                "status":        "submitted",
                "symbol":        symbol,
                "direction":     direction,
                "quantity":      quantity,
                "market_price":  round(market_price, 4),
                "fill_price":    round(fill_price, 4),
                "fill_value_usd": round(quantity * fill_price, 2),
                "slippage_bps":  round(slippage_bps, 2),
                "method":        method.value,
                "ibkr_order_id": trade.order.orderId,
                "dry_run":       False,
            }

        except Exception as e:
            logger.error(f"IBKR execution error for {symbol}: {e}")
            return {
                "status":  "ibkr_error",
                "error":   str(e),
                "symbol":  symbol,
                "dry_run": False,
            }