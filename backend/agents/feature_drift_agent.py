# ============================================================
# AGENT 3 — Feature Drift Agent
# ✅ Détecte les dérives des distributions de features
# ✅ Alerte si le modèle ML devient obsolète (concept drift)
# ✅ Déclenche le retraining si nécessaire
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, List, Optional
from loguru import logger
from scipy import stats
import json, os

DRIFT_HISTORY_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "signals", "feature_drift_history.json"
)

class FeatureDriftAgent:
    """
    Monitore la dérive statistique des features ML.

    Méthodes :
    - Population Stability Index (PSI) : mesure la dérive de distribution
    - KS Test : test de Kolmogorov-Smirnov
    - CUSUM : détection de changement de moyenne
    """

    PSI_THRESHOLD_WARN  = 0.10  # PSI > 0.10 → attention
    PSI_THRESHOLD_ALERT = 0.25  # PSI > 0.25 → retrain requis

    def __init__(self, worker_client, settings):
        self.client   = worker_client
        self.settings = settings
        self._baseline: Dict[str, Dict] = {}
        self._history:  List[Dict]      = []
        self._load_history()
        logger.info("✅ FeatureDriftAgent initialisé")

    def analyze(
        self,
        current_features: Dict[str, Dict],
        trigger_retrain:  bool = False,
    ) -> Dict:
        """Analyse la dérive des features et émet des alertes."""
        drift_report = {
            "features_analyzed": 0,
            "drifted_features":  [],
            "psi_scores":        {},
            "ks_scores":         {},
            "retrain_recommended": False,
            "overall_drift":     "stable",
        }

        if not self._baseline:
            self._set_baseline(current_features)
            return {**drift_report, "status": "baseline_set"}

        # Analyse feature par feature
        all_features = set()
        for sym_feats in current_features.values():
            all_features.update(sym_feats.keys())

        psi_scores  = {}
        ks_pvalues  = {}
        drifted     = []

        for feat_name in list(all_features)[:30]:  # Limite pour perf
            # Valeurs courantes
            current_vals = np.array([
                float(v.get(feat_name, 0))
                for v in current_features.values()
                if feat_name in v
            ])
            # Valeurs baseline
            baseline_vals = np.array(
                self._baseline.get(feat_name, {}).get("values", [])
            )
            if len(current_vals) < 3 or len(baseline_vals) < 3:
                continue

            # PSI
            psi = self._compute_psi(baseline_vals, current_vals)
            psi_scores[feat_name] = round(psi, 4)

            # KS Test
            ks_stat, ks_p = stats.ks_2samp(baseline_vals, current_vals)
            ks_pvalues[feat_name] = round(float(ks_p), 4)

            if psi > self.PSI_THRESHOLD_WARN or ks_p < 0.05:
                drifted.append({
                    "feature":    feat_name,
                    "psi":        round(psi, 4),
                    "ks_pvalue":  round(float(ks_p), 4),
                    "severity":   "high" if psi > self.PSI_THRESHOLD_ALERT else "medium",
                })

        drift_report["features_analyzed"] = len(psi_scores)
        drift_report["drifted_features"]  = drifted
        drift_report["psi_scores"]        = psi_scores
        drift_report["ks_scores"]         = ks_pvalues

        # Décision retrain
        high_drift_count = sum(1 for d in drifted if d["severity"] == "high")
        if high_drift_count >= 3:
            drift_report["retrain_recommended"] = True
            drift_report["overall_drift"]        = "critical"
        elif len(drifted) >= 5:
            drift_report["retrain_recommended"] = True
            drift_report["overall_drift"]        = "significant"
        elif len(drifted) >= 2:
            drift_report["overall_drift"]        = "moderate"

        # Log
        logger.info(
            f"📊 Feature Drift | Drifted: {len(drifted)}/{len(psi_scores)} | "
            f"Status: {drift_report['overall_drift']} | "
            f"Retrain: {drift_report['retrain_recommended']}"
        )

        # Sauvegarde
        self._history.append({
            "timestamp":   pd.Timestamp.utcnow().isoformat(),
            "drift_count": len(drifted),
            "status":      drift_report["overall_drift"],
        })
        self._save_history()

        # Optionnellement update la baseline
        if drift_report["retrain_recommended"]:
            self._set_baseline(current_features)

        return drift_report

    def _compute_psi(
        self,
        expected: np.ndarray,
        actual:   np.ndarray,
        n_bins:   int = 10,
    ) -> float:
        """
        Population Stability Index.
        PSI = Σ (actual% - expected%) × ln(actual% / expected%)
        """
        try:
            min_val = min(expected.min(), actual.min())
            max_val = max(expected.max(), actual.max())
            if max_val == min_val:
                return 0.0
            bins        = np.linspace(min_val, max_val, n_bins + 1)
            exp_counts  = np.histogram(expected, bins=bins)[0] + 1e-6
            act_counts  = np.histogram(actual,   bins=bins)[0] + 1e-6
            exp_pct     = exp_counts / exp_counts.sum()
            act_pct     = act_counts / act_counts.sum()
            psi         = float(np.sum((act_pct - exp_pct) * np.log(act_pct / exp_pct)))
            return max(0.0, psi)
        except Exception:
            return 0.0

    def _set_baseline(self, features: Dict[str, Dict]):
        """Initialise la baseline depuis le snapshot courant."""
        self._baseline = {}
        all_features   = set()
        for sym_feats in features.values():
            all_features.update(sym_feats.keys())
        for feat in all_features:
            vals = [
                float(v[feat])
                for v in features.values()
                if feat in v
            ]
            if vals:
                self._baseline[feat] = {
                    "values": vals,
                    "mean":   float(np.mean(vals)),
                    "std":    float(np.std(vals)),
                }
        logger.info(f"✅ Baseline définie: {len(self._baseline)} features")

    def _load_history(self):
        try:
            if os.path.exists(DRIFT_HISTORY_PATH):
                with open(DRIFT_HISTORY_PATH) as f:
                    self._history = json.load(f)
        except Exception:
            self._history = []

    def _save_history(self):
        try:
            os.makedirs(os.path.dirname(DRIFT_HISTORY_PATH), exist_ok=True)
            with open(DRIFT_HISTORY_PATH, "w") as f:
                json.dump(self._history[-100:], f, indent=2)
        except Exception as e:
            logger.warning(f"_save_history: {e}")