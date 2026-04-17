# ============================================================
# AGENT 6 — Correlation Surface Agent
# ✅ Calcule la surface de corrélation dynamique
# ✅ Détecte les clusters de corrélation (risque de contagion)
# ✅ Identifie les actifs décorrélés (diversification)
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, List, Optional
from loguru import logger
from scipy.cluster.hierarchy import linkage, fcluster

class CorrelationSurfaceAgent:
    """
    Analyse la surface de corrélation du portefeuille.

    Outputs :
    - Matrice de corrélation rolling
    - Clusters de corrélation (risque de co-mouvement)
    - Score de diversification [0, 1]
    - Alertes de correlation breakdown / spike
    """

    def __init__(self, worker_client, settings):
        self.client      = worker_client
        self.settings    = settings
        self._prev_corr  = None
        logger.info("✅ CorrelationSurfaceAgent initialisé")

    def analyze(
        self,
        returns_dict: Dict[str, np.ndarray],
        positions:    Dict[str, float],
    ) -> Dict:
        """Analyse complète de la surface de corrélation."""
        symbols = [s for s in positions if s in returns_dict and len(returns_dict[s]) >= 20]
        if len(symbols) < 2:
            return {"diversification_score": 1.0, "clusters": [], "avg_correlation": 0.0}

        min_len = min(len(returns_dict[s]) for s in symbols)
        min_len = max(min_len, 20)

        ret_matrix = np.column_stack([
            np.array(returns_dict[s])[-min_len:]
            for s in symbols
        ])

        corr_matrix = np.corrcoef(ret_matrix.T)

        # Corrélation moyenne (excluant diagonale)
        n       = len(symbols)
        mask    = ~np.eye(n, dtype=bool)
        avg_corr = float(np.mean(np.abs(corr_matrix[mask])))

        # Score de diversification [0=tout corrélé, 1=tout décorrélé]
        div_score = 1.0 - avg_corr

        # Clustering hiérarchique
        dist_matrix = np.sqrt(0.5 * (1 - corr_matrix))
        np.fill_diagonal(dist_matrix, 0)
        try:
            from scipy.spatial.distance import squareform
            link     = linkage(squareform(dist_matrix), method="ward")
            labels   = fcluster(link, t=0.5, criterion="distance")
            clusters = {}
            for sym, lbl in zip(symbols, labels):
                clusters.setdefault(int(lbl), []).append(sym)
            cluster_list = list(clusters.values())
        except Exception:
            cluster_list = [symbols]

        # Alertes corrélation spike
        corr_spike = False
        if self._prev_corr is not None and self._prev_corr.shape == corr_matrix.shape:
            corr_change = float(np.mean(np.abs(corr_matrix - self._prev_corr)))
            corr_spike  = corr_change > 0.15

        self._prev_corr = corr_matrix.copy()

        # Actifs les plus décorrélés (meilleurs pour diversification)
        best_diversifiers = []
        for i, sym in enumerate(symbols):
            avg_corr_sym = float(np.mean(np.abs(corr_matrix[i, mask[i]])))
            best_diversifiers.append((sym, avg_corr_sym))
        best_diversifiers.sort(key=lambda x: x[1])

        # LLM optionnel pour narrative
        llm_insight = None
        if self.client.llm_available and corr_spike:
            try:
                prompt = (
                    f"Correlation spike detected in portfolio: {symbols}\n"
                    f"Avg correlation jumped to {avg_corr:.2f}. "
                    f"What macro event typically causes this? 1 sentence."
                )
                llm_insight = self.client.call_llm(prompt, max_tokens=100)
            except Exception:
                pass

        result = {
            "avg_correlation":     round(avg_corr, 3),
            "diversification_score": round(div_score, 3),
            "n_clusters":          len(cluster_list),
            "clusters":            cluster_list,
            "corr_spike_detected": corr_spike,
            "best_diversifiers":   [s for s, _ in best_diversifiers[:3]],
            "worst_diversifiers":  [s for s, _ in best_diversifiers[-3:]],
            "correlation_matrix":  {
                symbols[i]: {
                    symbols[j]: round(float(corr_matrix[i, j]), 3)
                    for j in range(n) if i != j
                }
                for i in range(n)
            },
        }
        if llm_insight:
            result["llm_insight"] = llm_insight

        logger.info(
            f"📊 CorrelationSurface | Avg: {avg_corr:.2f} | "
            f"Clusters: {len(cluster_list)} | "
            f"Diversification: {div_score:.1%}"
        )
        return result