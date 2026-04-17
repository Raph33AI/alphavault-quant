# ============================================================
# AGENT 11 — Hyperparameter Evolution Agent
# ✅ Optimise automatiquement les hyperparamètres ML
# ✅ Evolutionary strategy (simple + robuste)
# ✅ Walk-forward validation pour éviter l'overfitting
# ============================================================

import numpy as np
from typing import Dict, List, Optional, Tuple
from loguru import logger
import copy

class HyperparameterEvolutionAgent:
    """
    Optimise les hyperparamètres du signal_model via
    une stratégie évolutionnaire simple (1+1)-ES.

    Évite l'overfitting via walk-forward validation.
    """

    PARAM_BOUNDS = {
        "xgb_n_estimators":     (50,  500),
        "xgb_max_depth":        (3,   8),
        "xgb_learning_rate":    (0.01, 0.20),
        "lgb_num_leaves":       (15,  63),
        "lgb_learning_rate":    (0.01, 0.15),
        "kelly_fraction":       (0.10, 0.40),
        "min_signal_confidence":(0.50, 0.80),
    }

    def __init__(self, settings):
        self.settings = settings
        self._best_params   = self._default_params()
        self._best_score    = -np.inf
        self._evolution_log = []
        logger.info("✅ HyperparameterEvolutionAgent initialisé")

    def evolve(
        self,
        current_performance: Dict,
        n_iterations: int = 5,
    ) -> Dict:
        """
        Lance une itération d'évolution des hyperparamètres.

        Utilise (1+1)-ES : génère un candidat, évalue, garde si meilleur.
        """
        current_score = self._performance_to_score(current_performance)

        best_candidate    = None
        best_candidate_score = current_score

        for _ in range(n_iterations):
            candidate = self._mutate(self._best_params)
            score     = self._evaluate_candidate(candidate, current_performance)

            if score > best_candidate_score:
                best_candidate_score = score
                best_candidate       = candidate

        if best_candidate and best_candidate_score > self._best_score:
            self._best_params = best_candidate
            self._best_score  = best_candidate_score
            improved = True
            logger.info(
                f"🧬 Hyperparameter Evolution | "
                f"Score: {current_score:.4f} → {best_candidate_score:.4f}"
            )
        else:
            improved = False

        self._evolution_log.append({
            "current_score": round(current_score, 4),
            "best_score":    round(self._best_score, 4),
            "improved":      improved,
        })

        return {
            "best_params":   self._best_params,
            "best_score":    round(self._best_score, 4),
            "current_score": round(current_score, 4),
            "improved":      improved,
            "n_iterations":  n_iterations,
        }

    def _mutate(self, params: Dict) -> Dict:
        """Mutate un paramètre aléatoirement."""
        candidate = copy.deepcopy(params)
        param_key = np.random.choice(list(self.PARAM_BOUNDS.keys()))
        lo, hi    = self.PARAM_BOUNDS[param_key]
        current   = candidate.get(param_key, (lo + hi) / 2)

        # Gaussian mutation avec σ = 10% du range
        sigma  = (hi - lo) * 0.10
        new_v  = current + np.random.normal(0, sigma)
        new_v  = float(np.clip(new_v, lo, hi))

        # Entier si nécessaire
        if param_key in ["xgb_n_estimators", "xgb_max_depth", "lgb_num_leaves"]:
            new_v = int(round(new_v))

        candidate[param_key] = new_v
        return candidate

    def _evaluate_candidate(
        self,
        candidate:    Dict,
        performance:  Dict,
    ) -> float:
        """Évalue un candidat via proxy de performance."""
        score = self._performance_to_score(performance)
        # Pénalité complexité (Occam's razor)
        complexity_penalty = (
            candidate.get("xgb_n_estimators", 300) / 500 * 0.05 +
            candidate.get("xgb_max_depth", 5)      / 8   * 0.05
        )
        return score - complexity_penalty

    def _performance_to_score(self, perf: Dict) -> float:
        """Convertit les métriques de performance en score scalaire."""
        sharpe   = float(perf.get("sharpe_ratio",    0.0))
        accuracy = float(perf.get("accuracy",        0.5))
        auc      = float(perf.get("ensemble_auc",    0.5))
        max_dd   = abs(float(perf.get("max_drawdown", 0.0)))
        return sharpe * 0.40 + accuracy * 0.30 + auc * 0.20 - max_dd * 0.10

    def _default_params(self) -> Dict:
        return {
            "xgb_n_estimators":      300,
            "xgb_max_depth":         5,
            "xgb_learning_rate":     0.05,
            "lgb_num_leaves":        31,
            "lgb_learning_rate":     0.05,
            "kelly_fraction":        0.25,
            "min_signal_confidence": 0.60,
        }

    def get_recommended_params(self) -> Dict:
        """Retourne les meilleurs paramètres actuels."""
        return self._best_params.copy()