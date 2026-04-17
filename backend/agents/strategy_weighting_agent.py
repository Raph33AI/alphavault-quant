# ============================================================
# AGENT 12 — Strategy Weighting Agent
# ✅ Pondère dynamiquement les stratégies selon leur performance
# ✅ Adaptive weighting (performance-based)
# ✅ Détecte les stratégies qui dégradent le portefeuille
# ============================================================

import numpy as np
from typing import Dict, List
from loguru import logger

class StrategyWeightingAgent:
    """
    Pondère dynamiquement chaque stratégie selon sa performance récente.

    Méthode : inverse volatility weighting + performance adjustment.
    """

    def __init__(self):
        self._perf_windows: Dict[str, List[float]] = {}
        logger.info("✅ StrategyWeightingAgent initialisé")

    def compute_weights(
        self,
        base_allocation:    Dict[str, float],
        performance_history: Dict[str, List[float]],
        regime_result:       Dict,
    ) -> Dict[str, float]:
        """
        Calcule les poids finaux des stratégies.
        """
        self._perf_windows = performance_history
        weights = base_allocation.copy()

        for strategy in list(weights.keys()):
            hist = performance_history.get(strategy, [])
            if len(hist) < 5:
                continue

            arr     = np.array(hist[-20:])
            sharpe  = float(np.mean(arr) / (np.std(arr) + 1e-10) * np.sqrt(252))
            vol     = float(np.std(arr))
            win_rate= float((arr > 0).mean())

            # Multiplicateur de performance
            if sharpe > 1.5 and win_rate > 0.60:
                mult = 1.25
            elif sharpe > 0.5:
                mult = 1.10
            elif sharpe < -0.5:
                mult = 0.75
            elif sharpe < -1.0:
                mult = 0.50
            else:
                mult = 1.00

            # Réduction si vol trop élevée
            if vol > 0.02:  # Plus de 2% de vol journalière
                mult *= 0.85

            weights[strategy] = max(0.01, weights[strategy] * mult)

        # Contrainte : pas de stratégie dominante (max 60%)
        for s in weights:
            weights[s] = min(weights[s], 0.60)

        # Normalisation
        total = sum(weights.values()) + 1e-10
        weights = {k: round(v / total, 4) for k, v in weights.items()}

        # Log
        logger.debug(f"Strategy weights: {weights}")
        return weights

    def flag_underperforming(
        self,
        performance_history: Dict[str, List[float]],
        lookback: int = 10,
    ) -> List[str]:
        """Identifie les stratégies qui sous-performent."""
        flagged = []
        for strategy, hist in performance_history.items():
            if len(hist) >= lookback:
                recent_ret = np.sum(hist[-lookback:])
                if recent_ret < -0.05:  # -5% sur la période
                    flagged.append(strategy)
        return flagged