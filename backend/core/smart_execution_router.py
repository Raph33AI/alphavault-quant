# ============================================================
# backend/core/smart_execution_router.py v2.0
# Smart Execution Router — AlphaVault Quant
# ============================================================
# v2.0 : Migration ib_insync → IBKRExecutor REST (IBeam)
#        _execute_ibkr utilise maintenant httpx via IBKRExecutor
#        Toute la logique de routing inchangée
# ============================================================

import os
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

    v2.0 :
    - DRY_RUN (GitHub Actions) : simulation pure
    - LIVE avec IBeam connecté : exécution via REST API
    - PLUS de dépendance ib_insync (incompatible IBeam)
    """

    # ── Seuils de participation rate ──────────────────────────
    PART_RATE_THRESHOLDS = {
        "market":           0.005,
        "limit_laddering":  0.020,
        "twap":             0.050,
        "vwap":             0.100,
        "adaptive_slicing": 1.000,
    }

    # ── Tailles des slices (% de l'ordre total) ───────────────
    SLICE_CONFIGS = {
        ExecutionMethod.TWAP:             {"n_slices": 6,  "interval_min": 10},
        ExecutionMethod.VWAP:             {"n_slices": 10, "interval_min": 6},
        ExecutionMethod.ADAPTIVE_SLICING: {"n_slices": 20, "interval_min": 3},
    }

    def __init__(self, settings, ibkr_executor=None):
        """
        Args:
            settings      : Settings v2.1 (DRY_RUN, etc.)
            ibkr_executor : IBKRExecutor v2.0 (REST API) — optionnel en DRY_RUN
        """
        self.settings      = settings
        self.ibkr_executor = ibkr_executor
        logger.info(
            f"✅ SmartExecutionRouter v2.0 initialisé | "
            f"dry_run={settings.DRY_RUN} | "
            f"ibkr_disponible={ibkr_executor is not None}"
        )

    # ════════════════════════════════════════════════════════
    # POINT D'ENTRÉE PRINCIPAL
    # ════════════════════════════════════════════════════════

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
        Sélectionne et route un ordre (simulation ou réel).

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

            method = self._select_method(participation, execution_alpha, signal)

            slippage_bps = execution_alpha.get("slippage_bps_est", 5.0)
            fill_price   = self._estimate_fill_price(price, direction, slippage_bps)

            logger.info(
                f"📋 Router | {symbol} {direction.upper()} {quantity} "
                f"@ ~{price:.2f} | Method: {method.value} | "
                f"Part: {participation:.2%} | EstFill: ~{fill_price:.2f} | "
                f"DryRun: {dry_run}"
            )

            # ── Simulation si dry_run ou pas d'executor ──────────
            effective_dry_run = (
                dry_run
                or getattr(self.settings, "DRY_RUN", True)
                or self.ibkr_executor is None
            )

            if effective_dry_run:
                return self._simulate_fill(
                    symbol, direction, quantity, price,
                    fill_price, method, slippage_bps
                )

            # ── Exécution réelle via IBeam REST ──────────────────
            return self._execute_ibkr(
                symbol, direction, quantity, price,
                fill_price, method, slippage_bps, signal
            )

        except Exception as e:
            logger.error(f"SmartExecutionRouter.select_and_route ({symbol}): {e}")
            return {
                "status":  "error",
                "error":   str(e),
                "symbol":  symbol,
                "dry_run": True,
            }

    # ════════════════════════════════════════════════════════
    # SÉLECTION DE MÉTHODE
    # ════════════════════════════════════════════════════════

    def _select_method(
        self,
        participation_rate: float,
        execution_alpha:    Dict,
        signal:             Dict,
    ) -> ExecutionMethod:
        """
        Sélectionne la méthode d'exécution optimale.

        Logique :
        - Signal fort + timing optimal + petit ordre → MARKET
        - Ordres moyens → LIMIT ou TWAP
        - Gros ordres → VWAP ou ADAPTIVE_SLICING
        """
        urgency  = signal.get("final_score", 0.5)
        is_opt   = (
            execution_alpha
            .get("optimal_timing", {})
            .get("is_optimal_now", True)
        )
        vol_regime = execution_alpha.get("vol_regime", "normal")

        # Signal très fort + timing parfait + petit ordre → market immédiat
        if urgency > 0.80 and participation_rate < 0.01 and is_opt:
            logger.debug(f"  → MARKET (urgency={urgency:.2f}, part={participation_rate:.3%})")
            return ExecutionMethod.MARKET

        # Volatilité élevée → préférer limit même pour petits ordres
        if vol_regime in ("high", "extreme") and participation_rate < 0.02:
            logger.debug(f"  → LIMIT (vol_regime={vol_regime})")
            return ExecutionMethod.LIMIT

        if participation_rate < self.PART_RATE_THRESHOLDS["market"]:
            if urgency < 0.70:
                return ExecutionMethod.LIMIT
            return ExecutionMethod.MARKET

        if participation_rate < self.PART_RATE_THRESHOLDS["limit_laddering"]:
            return ExecutionMethod.LIMIT

        if participation_rate < self.PART_RATE_THRESHOLDS["twap"]:
            return ExecutionMethod.TWAP

        if participation_rate < self.PART_RATE_THRESHOLDS["vwap"]:
            return ExecutionMethod.VWAP

        return ExecutionMethod.ADAPTIVE_SLICING

    # ════════════════════════════════════════════════════════
    # ESTIMATION FILL PRICE
    # ════════════════════════════════════════════════════════

    def _estimate_fill_price(
        self,
        market_price: float,
        direction:    str,
        slippage_bps: float,
    ) -> float:
        """Estime le prix de fill après slippage."""
        slippage_pct = slippage_bps / 10_000
        if direction == "buy":
            return round(market_price * (1 + slippage_pct), 4)
        return round(market_price * (1 - slippage_pct), 4)

    # ════════════════════════════════════════════════════════
    # SIMULATION DE FILL (DRY RUN)
    # ════════════════════════════════════════════════════════

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
        Utilisé en GitHub Actions (DRY_RUN=True).
        """
        fill_value   = quantity * fill_price
        slippage_usd = abs(fill_price - market_price) * quantity

        logger.info(
            f"🧪 [SIMULATED] {direction.upper()} {quantity}x {symbol} | "
            f"market={market_price:.4f} → fill={fill_price:.4f} | "
            f"method={method.value} | slip={slippage_bps:.1f}bps"
        )

        return {
            "status":          "simulated",
            "symbol":          symbol,
            "direction":       direction,
            "quantity":        quantity,
            "market_price":    round(market_price, 4),
            "fill_price":      round(fill_price, 4),
            "fill_value_usd":  round(fill_value, 2),
            "slippage_usd":    round(slippage_usd, 2),
            "slippage_bps":    round(slippage_bps, 2),
            "method":          method.value,
            "dry_run":         True,
        }

    # ════════════════════════════════════════════════════════
    # EXÉCUTION RÉELLE VIA IBEAM REST API
    # ════════════════════════════════════════════════════════

    def _execute_ibkr(
        self,
        symbol:       str,
        direction:    str,
        quantity:     int,
        market_price: float,
        fill_price:   float,
        method:       ExecutionMethod,
        slippage_bps: float,
        signal:       Dict,
    ) -> Dict:
        """
        Exécution réelle via IBKRExecutor v2.0 (httpx → IBeam REST API).

        v2.0 : Plus de ib_insync.
               Utilise self.ibkr_executor.place_order() → REST API IBeam.
               Gère MARKET, LIMIT, et les méthodes algorithmiques (TWAP/VWAP
               simulées en slices successives via LIMIT orders).
        """
        if self.ibkr_executor is None:
            logger.warning("⚠ ibkr_executor non disponible → simulation forcée")
            return self._simulate_fill(
                symbol, direction, quantity, market_price,
                fill_price, method, slippage_bps
            )

        action = "BUY" if direction == "buy" else "SELL"

        # ── MARKET : ordre immédiat ───────────────────────────
        if method == ExecutionMethod.MARKET:
            return self._route_market(
                symbol, action, quantity, market_price, slippage_bps, signal
            )

        # ── LIMIT : ordre limite unique ───────────────────────
        if method == ExecutionMethod.LIMIT:
            return self._route_limit(
                symbol, action, quantity, fill_price, market_price, slippage_bps
            )

        # ── TWAP / VWAP / ADAPTIVE : slicing en ordres LIMIT ──
        return self._route_sliced(
            symbol, action, quantity, market_price, fill_price,
            method, slippage_bps
        )

    # ── Market ────────────────────────────────────────────────
    def _route_market(
        self,
        symbol:       str,
        action:       str,
        quantity:     int,
        market_price: float,
        slippage_bps: float,
        signal:       Dict,
    ) -> Dict:
        """Ordre market via IBeam REST."""
        logger.info(f"📤 [MARKET] {action} {quantity}x {symbol}")
        result = self.ibkr_executor.place_order(
            symbol=symbol,
            action=action,
            quantity=quantity,
            order_type="MKT",
            source="smart_router",
            reason=f"method=market|score={signal.get('final_score',0):.3f}",
        )

        fill_price = (
            result.get("fill_price") or
            self._estimate_fill_price(
                market_price,
                "buy" if action == "BUY" else "sell",
                slippage_bps
            )
        )

        return {
            **result,
            "market_price":   round(market_price, 4),
            "fill_price":     round(fill_price, 4),
            "fill_value_usd": round(quantity * fill_price, 2),
            "slippage_bps":   round(slippage_bps, 2),
            "method":         ExecutionMethod.MARKET.value,
            "dry_run":        False,
        }

    # ── Limit ─────────────────────────────────────────────────
    def _route_limit(
        self,
        symbol:       str,
        action:       str,
        quantity:     int,
        fill_price:   float,
        market_price: float,
        slippage_bps: float,
    ) -> Dict:
        """Ordre limite unique via IBeam REST."""
        lmt_price = round(fill_price, 2)
        logger.info(f"📤 [LIMIT] {action} {quantity}x {symbol} @ {lmt_price}")
        result = self.ibkr_executor.place_order(
            symbol=symbol,
            action=action,
            quantity=quantity,
            order_type="LMT",
            limit_price=lmt_price,
            source="smart_router",
            reason="method=limit_laddering",
        )
        return {
            **result,
            "market_price":   round(market_price, 4),
            "fill_price":     round(fill_price, 4),
            "fill_value_usd": round(quantity * fill_price, 2),
            "slippage_bps":   round(slippage_bps, 2),
            "method":         ExecutionMethod.LIMIT.value,
            "dry_run":        False,
        }

    # ── Sliced (TWAP / VWAP / Adaptive) ──────────────────────
    def _route_sliced(
        self,
        symbol:       str,
        action:       str,
        quantity:     int,
        market_price: float,
        fill_price:   float,
        method:       ExecutionMethod,
        slippage_bps: float,
    ) -> Dict:
        """
        Découpe l'ordre en slices LIMIT successives.
        Simule TWAP/VWAP côté logique (IBeam REST ne supporte pas les algos natifs
        Client Portal sans TWS). Les slices sont soumises avec un léger décalage de prix.
        """
        config   = self.SLICE_CONFIGS.get(method, {"n_slices": 5, "interval_min": 10})
        n_slices = config["n_slices"]

        slices        = self._compute_slices(quantity, n_slices)
        results       = []
        total_filled  = 0
        total_value   = 0.0

        logger.info(
            f"📤 [{method.value.upper()}] {action} {quantity}x {symbol} "
            f"→ {n_slices} slices"
        )

        for i, slice_qty in enumerate(slices):
            if slice_qty <= 0:
                continue

            # Variation légère du prix limite pour chaque slice
            price_variation = (np.random.uniform(-0.5, 0.5) * slippage_bps / 10_000)
            slice_price     = round(
                fill_price * (1 + price_variation), 2
            )

            logger.debug(
                f"  Slice {i+1}/{n_slices}: {slice_qty}x @ {slice_price}"
            )

            res = self.ibkr_executor.place_order(
                symbol=symbol,
                action=action,
                quantity=slice_qty,
                order_type="LMT",
                limit_price=slice_price,
                source="smart_router",
                reason=f"method={method.value}|slice={i+1}/{n_slices}",
            )
            results.append(res)

            if res.get("status") in ("submitted", "simulated"):
                total_filled += slice_qty
                total_value  += slice_qty * slice_price

        avg_fill = round(total_value / total_filled, 4) if total_filled else fill_price
        total_slippage_bps = (
            abs(avg_fill - market_price) / market_price * 10_000
        )

        return {
            "status":          "submitted" if total_filled == quantity else "partial",
            "symbol":          symbol,
            "direction":       "buy" if action == "BUY" else "sell",
            "quantity":        quantity,
            "filled":          total_filled,
            "market_price":    round(market_price, 4),
            "fill_price":      avg_fill,
            "fill_value_usd":  round(total_value, 2),
            "slippage_bps":    round(total_slippage_bps, 2),
            "method":          method.value,
            "n_slices":        len(results),
            "slices":          results,
            "dry_run":         False,
        }

    # ── Calcul des slices ─────────────────────────────────────
    @staticmethod
    def _compute_slices(total_qty: int, n_slices: int) -> list:
        """
        Découpe total_qty en n_slices entières équilibrées.
        Le reste est ajouté à la première slice.
        """
        if n_slices <= 0:
            return [total_qty]
        base  = total_qty // n_slices
        reste = total_qty  % n_slices
        slices = [base] * n_slices
        slices[0] += reste
        return slices