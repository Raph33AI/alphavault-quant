# ============================================================
# ALPHAVAULT QUANT — Portfolio Optimizer
# ✅ Mean-Variance Optimization (Markowitz)
# ✅ Risk Parity
# ✅ Hierarchical Risk Parity (HRP)
# ✅ Minimum Variance
# ✅ Max Sharpe
# ✅ Convex Payoff Balancing
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from loguru import logger
from scipy.optimize import minimize
from scipy.cluster.hierarchy import linkage, fcluster
from scipy.spatial.distance import squareform

class PortfolioOptimizer:
    """
    Optimiseur de portefeuille multi-méthodes.
    Toutes les méthodes convergent vers des poids [0,1] normalisés.
    """

    def __init__(self, settings):
        self.settings   = settings
        self.rf_rate    = 0.05  # Taux sans risque (SOFR actuel ~5%)
        logger.info("✅ PortfolioOptimizer initialisé")

    # ── Dispatcher Principal ──────────────────────────────────
    def optimize(
        self,
        returns_dict:  Dict[str, np.ndarray],
        signals:       Dict[str, Dict],
        regime_result: Dict,
        method:        str = "auto",
    ) -> Dict[str, float]:
        """
        Optimise le portefeuille selon la méthode et le régime.

        method = "auto" → sélection automatique selon le régime
        """
        symbols = list(returns_dict.keys())
        if not symbols:
            return {}

        # Sélection automatique de méthode
        if method == "auto":
            method = self._select_method(regime_result)

        logger.info(f"📐 Optimisation: {method} | {len(symbols)} actifs")

        try:
            if method == "risk_parity":
                weights = self._risk_parity(returns_dict)
            elif method == "hrp":
                weights = self._hrp(returns_dict)
            elif method == "min_variance":
                weights = self._min_variance(returns_dict)
            elif method == "max_sharpe":
                weights = self._max_sharpe(returns_dict, signals)
            elif method == "signal_weighted":
                weights = self._signal_weighted(symbols, signals)
            else:  # equal_weight fallback
                weights = {s: 1.0 / len(symbols) for s in symbols}

            # Application des contraintes
            weights = self._apply_constraints(weights, signals, regime_result)
            return weights

        except Exception as e:
            logger.error(f"PortfolioOptimizer.optimize: {e}")
            return {s: 1.0 / len(symbols) for s in symbols}

    # ── Sélection de Méthode ──────────────────────────────────
    def _select_method(self, regime_result: Dict) -> str:
        regime = regime_result.get("regime_label", "range_bound")
        mapping = {
            "trend_up":          "max_sharpe",
            "trend_down":        "min_variance",
            "range_bound":       "risk_parity",
            "low_volatility":    "max_sharpe",
            "high_volatility":   "hrp",
            "crash":             "min_variance",
            "macro_tightening":  "risk_parity",
            "macro_easing":      "max_sharpe",
        }
        return mapping.get(regime, "risk_parity")

    # ── Risk Parity ───────────────────────────────────────────
    def _risk_parity(self, returns_dict: Dict[str, np.ndarray]) -> Dict[str, float]:
        """
        Risk Parity : chaque actif contribue également au risque total.
        Résout : minimize Σ(w_i × (Σ × w)_i - cible)²
        """
        symbols    = list(returns_dict.keys())
        ret_matrix = self._build_return_matrix(returns_dict, symbols)
        n          = len(symbols)
        cov        = np.cov(ret_matrix.T) + np.eye(n) * 1e-6

        def risk_contributions(w):
            port_var = w @ cov @ w
            marginal = cov @ w
            rc       = w * marginal / (port_var + 1e-10)
            return rc

        def objective(w):
            rc = risk_contributions(w)
            return float(np.sum((rc - 1.0 / n) ** 2))

        constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
        bounds      = [(0.01, 0.35)] * n
        w0          = np.ones(n) / n

        result = minimize(objective, w0, method="SLSQP",
                          bounds=bounds, constraints=constraints,
                          options={"maxiter": 500, "ftol": 1e-9})

        weights = result.x if result.success else w0
        return {s: float(w) for s, w in zip(symbols, weights)}

    # ── HRP (Hierarchical Risk Parity) ───────────────────────
    def _hrp(self, returns_dict: Dict[str, np.ndarray]) -> Dict[str, float]:
        """
        Hierarchical Risk Parity de López de Prado.
        Robuste aux matrices de covariance mal conditionnées.
        """
        symbols    = list(returns_dict.keys())
        ret_matrix = self._build_return_matrix(returns_dict, symbols)
        corr       = np.corrcoef(ret_matrix.T)
        dist       = np.sqrt(0.5 * (1 - corr))
        np.fill_diagonal(dist, 0)

        # Clustering hiérarchique
        link    = linkage(squareform(dist), method="ward")
        order   = self._get_quasi_diag_order(link, len(symbols))

        # Allocation bisection récursive
        weights = self._hrp_recursive_bisection(ret_matrix, order)
        return {symbols[i]: float(w) for i, w in enumerate(weights)}

    def _get_quasi_diag_order(self, link, n: int) -> List[int]:
        """Reconstruit l'ordre quasi-diagonal depuis le dendrogramme."""
        link = link.astype(int)
        sort_ix = pd.Series([n])
        while sort_ix.max() >= n:
            sort_ix.index = range(0, sort_ix.shape[0] * 2, 2)
            df0 = sort_ix[sort_ix >= n]
            i   = df0.index
            j   = df0.values - n
            sort_ix[i] = link[j, 0]
            df0 = pd.Series(link[j, 1], index=i + 1)
            sort_ix = pd.concat([sort_ix, df0]).sort_index()
            sort_ix = sort_ix.drop_duplicates()
        return sort_ix.tolist()

    def _hrp_recursive_bisection(self, ret_matrix, order) -> np.ndarray:
        """Allocation récursive par bisection."""
        n       = ret_matrix.shape[1]
        weights = np.ones(n)
        c_items = [order]
        while c_items:
            c_items = [
                i[j:k]
                for i in c_items
                for j, k in ((0, len(i) // 2), (len(i) // 2, len(i)))
                if len(i) > 1
            ]
            for subsets in [c_items[i::2] for i in range(2)]:
                for subset in subsets:
                    variance = np.var(ret_matrix[:, subset].mean(axis=1)) + 1e-10
                    weights[subset] *= 1.0 / variance
        weights /= weights.sum()
        return weights

    # ── Min Variance ─────────────────────────────────────────
    def _min_variance(self, returns_dict: Dict[str, np.ndarray]) -> Dict[str, float]:
        """Minimum Variance Portfolio."""
        symbols    = list(returns_dict.keys())
        ret_matrix = self._build_return_matrix(returns_dict, symbols)
        n          = len(symbols)
        cov        = np.cov(ret_matrix.T) + np.eye(n) * 1e-6

        def objective(w):
            return float(w @ cov @ w)

        constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
        bounds      = [(0.0, 0.30)] * n
        w0          = np.ones(n) / n

        result = minimize(objective, w0, method="SLSQP",
                          bounds=bounds, constraints=constraints,
                          options={"maxiter": 500})

        weights = result.x if result.success else w0
        return {s: float(w) for s, w in zip(symbols, weights)}

    # ── Max Sharpe ────────────────────────────────────────────
    def _max_sharpe(
        self,
        returns_dict: Dict[str, np.ndarray],
        signals:      Dict[str, Dict],
    ) -> Dict[str, float]:
        """Maximum Sharpe Ratio Portfolio."""
        symbols    = list(returns_dict.keys())
        ret_matrix = self._build_return_matrix(returns_dict, symbols)
        n          = len(symbols)
        cov        = np.cov(ret_matrix.T) + np.eye(n) * 1e-6

        # Rendements espérés depuis les signaux ou empiriques
        mu = np.array([
            signals.get(s, {}).get("expected_ret",
                                   float(np.mean(returns_dict.get(s, [0]))))
            for s in symbols
        ])

        daily_rf = self.rf_rate / 252

        def neg_sharpe(w):
            port_ret = float(w @ mu)
            port_vol = float(np.sqrt(w @ cov @ w))
            return -((port_ret - daily_rf) / (port_vol + 1e-10))

        constraints = [{"type": "eq", "fun": lambda w: np.sum(w) - 1.0}]
        bounds      = [(0.0, 0.30)] * n
        w0          = np.ones(n) / n

        result = minimize(neg_sharpe, w0, method="SLSQP",
                          bounds=bounds, constraints=constraints,
                          options={"maxiter": 500})

        weights = result.x if result.success else w0
        return {s: float(w) for s, w in zip(symbols, weights)}

    # ── Signal Weighted ───────────────────────────────────────
    def _signal_weighted(
        self,
        symbols: List[str],
        signals: Dict[str, Dict],
    ) -> Dict[str, float]:
        """Pondération directement proportionnelle au score du signal."""
        scores = {}
        for s in symbols:
            sig   = signals.get(s, {})
            score = sig.get("final_score", 0.0)
            if sig.get("direction") == "buy" and score > 0:
                scores[s] = score
            else:
                scores[s] = 0.0

        total = sum(scores.values()) + 1e-10
        return {s: float(v / total) for s, v in scores.items()}

    # ── Contraintes ───────────────────────────────────────────
    def _apply_constraints(
        self,
        weights:       Dict[str, float],
        signals:       Dict[str, Dict],
        regime_result: Dict,
    ) -> Dict[str, float]:
        """Applique les contraintes de position maximale."""
        max_pos = self.settings.MAX_SINGLE_POSITION_PCT

        # Clamp positions
        for s in weights:
            weights[s] = max(0.0, min(weights[s], max_pos))

        # Normalisation
        total = sum(weights.values()) + 1e-10
        weights = {s: w / total for s, w in weights.items()}

        # Réduction générale en régime de crise
        if regime_result.get("reduce_exposure"):
            reduce_factor = 0.5 if regime_result.get("crash_regime") else 0.75
            weights = {s: w * reduce_factor for s, w in weights.items()}

        return weights

    # ── Helper ────────────────────────────────────────────────
    def _build_return_matrix(
        self,
        returns_dict: Dict[str, np.ndarray],
        symbols:      List[str],
    ) -> np.ndarray:
        """Construit la matrice de rendements alignée."""
        min_len = min(len(v) for v in returns_dict.values() if len(v) > 0)
        min_len = max(min_len, 20)
        return np.column_stack([
            np.array(returns_dict[s])[-min_len:]
            for s in symbols
        ])