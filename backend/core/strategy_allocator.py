# ============================================================
# ALPHAVAULT QUANT — Strategy Allocation Engine
# ✅ Allocation dynamique entre 4 familles de stratégies
# ✅ Fallback déterministe sans LLM
# ✅ Convex Payoff Balancing (options overlay)
# ============================================================

import numpy as np
from typing import Dict, Optional
from loguru import logger

STRATEGY_FAMILIES = ["trend", "mean_reversion", "vol_carry", "options_convexity"]

class StrategyAllocator:
    """
    Alloue le capital entre les 4 familles de stratégies.

    Allocation baseline par régime (déterministe / sans LLM) :
    - Trend               : Momentum EMA/RSI/ML signals
    - Mean Reversion      : BB bounce, RSI extremes
    - Vol Carry           : Short IV expansion, long vol carry
    - Options Convexity   : Long gamma, tail hedges, spreads

    Peut être enrichi par le LLM si disponible.
    """

    # Allocations de base par régime (déterministe)
    REGIME_BASE_ALLOCATIONS = {
        "trend_up": {
            "trend":             0.55,
            "mean_reversion":    0.20,
            "vol_carry":         0.15,
            "options_convexity": 0.10,
        },
        "trend_down": {
            "trend":             0.45,
            "mean_reversion":    0.15,
            "vol_carry":         0.20,
            "options_convexity": 0.20,
        },
        "range_bound": {
            "trend":             0.20,
            "mean_reversion":    0.45,
            "vol_carry":         0.25,
            "options_convexity": 0.10,
        },
        "low_volatility": {
            "trend":             0.40,
            "mean_reversion":    0.30,
            "vol_carry":         0.25,
            "options_convexity": 0.05,
        },
        "high_volatility": {
            "trend":             0.20,
            "mean_reversion":    0.10,
            "vol_carry":         0.30,
            "options_convexity": 0.40,
        },
        "crash": {
            "trend":             0.10,
            "mean_reversion":    0.05,
            "vol_carry":         0.20,
            "options_convexity": 0.65,  # Max convexité en crise
        },
        "macro_tightening": {
            "trend":             0.25,
            "mean_reversion":    0.25,
            "vol_carry":         0.25,
            "options_convexity": 0.25,
        },
        "macro_easing": {
            "trend":             0.50,
            "mean_reversion":    0.20,
            "vol_carry":         0.20,
            "options_convexity": 0.10,
        },
    }

    def __init__(self):
        self._performance_history: Dict[str, list] = {s: [] for s in STRATEGY_FAMILIES}
        logger.info("✅ StrategyAllocator initialisé")

    def allocate(
        self,
        regime_result:     Dict,
        signals_summary:   Dict,
        performance_data:  Dict = None,
        llm_override:      Dict = None,
    ) -> Dict[str, float]:
        """
        Calcule l'allocation optimale entre les stratégies.

        Args:
            regime_result    : résultat du RegimeModel
            signals_summary  : résumé des signaux ML
            performance_data : performance récente de chaque stratégie
            llm_override     : ajustements suggérés par le LLM (optionnel)

        Returns:
            Dict {strategy_name: allocation_pct}
        """
        try:
            regime = regime_result.get("regime_label", "range_bound")

            # ── 1. Base déterministe par régime ──────────
            base = self.REGIME_BASE_ALLOCATIONS.get(
                regime,
                self.REGIME_BASE_ALLOCATIONS["range_bound"]
            ).copy()

            # ── 2. Ajustement par performance récente ────
            if performance_data:
                base = self._performance_adjusted(base, performance_data)

            # ── 3. Ajustement par signal strength ────────
            base = self._signal_adjusted(base, signals_summary, regime_result)

            # ── 4. Override LLM si disponible ────────────
            if llm_override:
                base = self._apply_llm_override(base, llm_override)

            # ── 5. Normalisation ─────────────────────────
            total = sum(base.values()) + 1e-10
            base  = {k: round(v / total, 4) for k, v in base.items()}

            logger.info(
                f"📊 Allocation | "
                f"Trend: {base.get('trend', 0):.0%} | "
                f"MR: {base.get('mean_reversion', 0):.0%} | "
                f"Vol: {base.get('vol_carry', 0):.0%} | "
                f"Options: {base.get('options_convexity', 0):.0%}"
            )
            return base

        except Exception as e:
            logger.error(f"StrategyAllocator.allocate: {e}")
            return {s: 0.25 for s in STRATEGY_FAMILIES}

    # ── Ajustement Performance ────────────────────────────────
    def _performance_adjusted(
        self,
        base:             Dict[str, float],
        performance_data: Dict,
    ) -> Dict[str, float]:
        """Surpondere les stratégies qui performent bien récemment."""
        adjusted = base.copy()
        for strategy in STRATEGY_FAMILIES:
            perf = performance_data.get(strategy, {})
            sharpe = perf.get("sharpe_5d", 0.0)
            if sharpe > 1.0:
                adjusted[strategy] *= 1.15
            elif sharpe < -0.5:
                adjusted[strategy] *= 0.85
        return adjusted

    # ── Ajustement Signaux ────────────────────────────────────
    def _signal_adjusted(
        self,
        base:            Dict[str, float],
        signals_summary: Dict,
        regime_result:   Dict,
    ) -> Dict[str, float]:
        """Ajuste selon la qualité des signaux ML."""
        adjusted = base.copy()
        avg_confidence = signals_summary.get("avg_confidence", 0.5)
        avg_buy_prob   = signals_summary.get("avg_buy_prob",   0.5)
        vol_rank       = signals_summary.get("avg_vol_rank",   0.5)

        # Signaux directionnels forts → plus de trend
        if avg_confidence > 0.70 and abs(avg_buy_prob - 0.5) > 0.15:
            adjusted["trend"] *= 1.20
            adjusted["mean_reversion"] *= 0.85

        # Vol élevée → plus d'options convexity
        if vol_rank > 0.70:
            adjusted["options_convexity"] *= 1.30
            adjusted["trend"] *= 0.85

        # Régime crash → protections maximales
        if regime_result.get("crash_regime"):
            adjusted["options_convexity"] = max(adjusted["options_convexity"], 0.50)
            adjusted["trend"] = min(adjusted["trend"], 0.20)

        return adjusted

    # ── Override LLM ──────────────────────────────────────────
    def _apply_llm_override(
        self,
        base:         Dict[str, float],
        llm_override: Dict,
    ) -> Dict[str, float]:
        """
        Applique les ajustements suggérés par le LLM.
        Le LLM est additif : il ne peut modifier de plus de ±20% chaque bucket.
        """
        adjusted = base.copy()
        for strategy, delta in llm_override.items():
            if strategy in adjusted:
                max_change = 0.20 * base.get(strategy, 0.25)
                clamped    = float(np.clip(delta, -max_change, max_change))
                adjusted[strategy] = max(0.01, adjusted[strategy] + clamped)
        return adjusted

    # ── Performance Update ────────────────────────────────────
    def update_performance(self, strategy: str, daily_return: float):
        """Enregistre la performance quotidienne d'une stratégie."""
        if strategy in self._performance_history:
            self._performance_history[strategy].append(daily_return)
            if len(self._performance_history[strategy]) > 20:
                self._performance_history[strategy].pop(0)

    def get_performance_summary(self) -> Dict:
        """Retourne un résumé de performance par stratégie."""
        summary = {}
        for strategy, returns in self._performance_history.items():
            if len(returns) >= 5:
                arr = np.array(returns)
                summary[strategy] = {
                    "sharpe_5d": float(
                        np.mean(arr) / (np.std(arr) + 1e-10) * np.sqrt(252)
                    ),
                    "total_return": float(np.sum(arr)),
                    "win_rate":     float((arr > 0).mean()),
                }
            else:
                summary[strategy] = {"sharpe_5d": 0.0, "total_return": 0.0, "win_rate": 0.5}
        return summary