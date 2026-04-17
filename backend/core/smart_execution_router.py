# ============================================================
# ALPHAVAULT QUANT — Smart Execution Router
# ✅ Sélection automatique de la méthode d'exécution
# ✅ Market / Limit / TWAP / VWAP / Adaptive Slicing
# ✅ Intégration IBKR via ib_insync
# ============================================================

import numpy as np
from typing import Dict, Optional
from loguru import logger
from enum import Enum

class ExecutionMethod(str, Enum):
    MARKET          = "market"
    LIMIT           = "limit_laddering"
    TWAP            = "twap"
    VWAP            = "vwap"
    ADAPTIVE_SLICING = "adaptive_slicing"

class SmartExecutionRouter:
    """
    Routeur d'exécution intelligent.

    Sélectionne la méthode optimale selon :
    - Taille de l'ordre
    - Liquidité estimée (ADV)
    - Urgence du signal
    - Régime de volatilité
    - Alpha d'exécution estimé

    Note : En mode GitHub Actions + paper trading, simule l'exécution.
    """

    # Seuils de participation rate pour sélection de méthode
    PART_RATE_THRESHOLDS = {
        "market":          0.005,   # < 0.5% ADV → market OK
        "limit_laddering": 0.020,   # 0.5%–2% ADV → limit
        "twap":            0.050,   # 2%–5% ADV → TWAP
        "vwap":            0.100,   # 5%–10% ADV → VWAP
        "adaptive_slicing": 1.000,  # > 10% ADV → slicing adaptatif
    }

    def __init__(self, settings, ibkr_client=None):
        self.settings    = settings
        self.ibkr_client = ibkr_client  # None si paper/dry_run
        logger.info("✅ SmartExecutionRouter initialisé")

    def select_and_route(
        self,
        symbol:         str,
        direction:      str,
        quantity:       int,
        price:          float,
        adv:            float,
        execution_alpha: Dict,
        signal:         Dict,
        dry_run:        bool = True,
    ) -> Dict:
        """
        Sélectionne et simule / exécute un ordre.

        Args:
            symbol      : ticker (ex: "SPY")
            direction   : "buy" ou "sell"
            quantity    : nombre d'actions
            price       : prix courant
            adv         : Average Daily Volume en $
            execution_alpha : résultat ExecutionAlphaEngine
            signal      : signal calibré du MetaModel
            dry_run     : True = simulation uniquement

        Returns:
            order_result : Dict avec status, method, fill_price, etc.
        """
        try:
            order_value      = quantity * price
            participation    = order_value / (adv + 1e-10)
            method           = self._select_method(
                participation,
                execution_alpha,
                signal,
            )
            slippage_bps     = execution_alpha.get("slippage_bps_est", 5.0)
            fill_price       = self._estimate_fill_price(price, direction, slippage_bps)

            logger.info(
                f"📋 Order | {symbol} {direction.upper()} {quantity} @ ~{price:.2f} | "
                f"Method: {method.value} | Part: {participation:.2%} | "
                f"Est. Fill: {fill_price:.2f} | DryRun: {dry_run}"
            )

            if dry_run or self.settings.DRY_RUN:
                return self._simulate_fill(
                    symbol, direction, quantity, price, fill_price,
                    method, slippage_bps
                )

            # ── Exécution Réelle via IBKR ─────────────────
            if self.ibkr_client and not dry_run:
                return self._execute_ibkr(
                    symbol, direction, quantity, price, fill_price,
                    method, slippage_bps
                )

            return self._simulate_fill(
                symbol, direction, quantity, price, fill_price,
                method, slippage_bps
            )

        except Exception as e:
            logger.error(f"SmartExecutionRouter: {e}")
            return {"status": "error", "error": str(e)}

    # ── Sélection de Méthode ──────────────────────────────────
    def _select_method(
        self,
        participation_rate: float,
        execution_alpha:    Dict,
        signal:             Dict,
    ) -> ExecutionMethod:
        """Sélectionne la méthode d'exécution optimale."""
        urgency = signal.get("final_score", 0.5)
        is_opt  = execution_alpha.get("optimal_timing", {}).get("is_optimal_now", True)

        # Signal très fort + timing optimal → market
        if urgency > 0.80 and participation_rate < 0.01 and is_opt:
            return ExecutionMethod.MARKET

        # Petit ordre dans la fenêtre optimale
        if participation_rate < self.PART_RATE_THRESHOLDS["market"]:
            return ExecutionMethod.LIMIT if urgency < 0.70 else ExecutionMethod.MARKET

        # Ordre moyen
        if participation_rate < self.PART_RATE_THRESHOLDS["limit_laddering"]:
            return ExecutionMethod.LIMIT

        if participation_rate < self.PART_RATE_THRESHOLDS["twap"]:
            return ExecutionMethod.TWAP

        if participation_rate < self.PART_RATE_THRESHOLDS["vwap"]:
            return ExecutionMethod.VWAP

        return ExecutionMethod.ADAPTIVE_SLICING

    # ── Estimation du Prix de Fill ────────────────────────────
    def _estimate_fill_price(
        self,
        market_price:  float,
        direction:     str,
        slippage_bps:  float,
    ) -> float:
        """Estime le prix de fill après slippage."""
        slippage_pct = slippage_bps / 10000
        if direction == "buy":
            return market_price * (1 + slippage_pct)
        else:
            return market_price * (1 - slippage_pct)

    # ── Simulation de Fill ────────────────────────────────────
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
        """Simule un fill (dry run / paper trading)."""
        fill_value   = quantity * fill_price
        slippage_usd = abs(fill_price - market_price) * quantity

        return {
            "status":        "simulated",
            "symbol":        symbol,
            "direction":     direction,
            "quantity":      quantity,
            "market_price":  round(market_price, 4),
            "fill_price":    round(fill_price, 4),
            "fill_value_usd": round(fill_value, 2),
            "slippage_usd":  round(slippage_usd, 2),
            "slippage_bps":  round(slippage_bps, 2),
            "method":        method.value,
            "dry_run":       True,
        }

    # ── Exécution IBKR ────────────────────────────────────────
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
        """Exécution réelle via Interactive Brokers (ib_insync)."""
        try:
            from ib_insync import Stock, MarketOrder, LimitOrder
            contract = Stock(symbol, "SMART", "USD")

            if method == ExecutionMethod.MARKET:
                action = "BUY" if direction == "buy" else "SELL"
                order  = MarketOrder(action, quantity)
            else:
                action    = "BUY" if direction == "buy" else "SELL"
                lmt_price = round(fill_price, 2)
                order     = LimitOrder(action, quantity, lmt_price)

            trade = self.ibkr_client.placeOrder(contract, order)
            self.ibkr_client.sleep(2)

            return {
                "status":        "submitted",
                "symbol":        symbol,
                "direction":     direction,
                "quantity":      quantity,
                "fill_price":    fill_price,
                "method":        method.value,
                "ibkr_order_id": trade.order.orderId,
                "dry_run":       False,
            }
        except Exception as e:
            logger.error(f"IBKR execution error: {e}")
            return {"status": "ibkr_error", "error": str(e)}