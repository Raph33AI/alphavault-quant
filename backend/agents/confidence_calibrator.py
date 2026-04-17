# ============================================================
# AGENT 7 — Confidence Calibrator
# ✅ Calibre la fiabilité réelle des probabilités ML
# ✅ Courbe de calibration (reliability diagram)
# ✅ Ajustement Platt scaling / isotonic
# ============================================================

import numpy as np
from typing import Dict, List
from loguru import logger

class ConfidenceCalibrator:
    """
    Calibre les probabilités du modèle ML pour qu'elles soient
    statistiquement fiables (p=0.7 → 70% des trades gagnants).
    """

    def __init__(self):
        self._prediction_log: List[Dict] = []
        self._calibration_curve: Dict    = {}
        logger.info("✅ ConfidenceCalibrator initialisé")

    def calibrate_signal(
        self,
        raw_signal:    Dict,
        regime_result: Dict,
    ) -> Dict:
        """Ajuste la confiance du signal selon la calibration historique."""
        raw_prob = raw_signal.get("buy_prob", 0.5)
        raw_conf = raw_signal.get("confidence", 0.0)
        regime   = regime_result.get("regime_label", "range_bound")

        # Correction de calibration (depuis l'historique)
        cal_correction = self._get_calibration_correction(raw_prob, regime)
        calibrated_prob = float(np.clip(raw_prob + cal_correction, 0.01, 0.99))

        # Shrinkage vers 0.5 proportionnel à l'incertitude
        n_obs = len(self._prediction_log)
        shrinkage = max(0, 1 - n_obs / 200)  # Disparaît après 200 observations
        calibrated_prob = calibrated_prob * (1 - shrinkage) + 0.5 * shrinkage

        # Nouvelle confiance calibrée
        calibrated_conf = abs(calibrated_prob - 0.5) * 2 * raw_conf

        return {
            **raw_signal,
            "buy_prob":            round(calibrated_prob, 4),
            "sell_prob":           round(1 - calibrated_prob, 4),
            "confidence":          round(float(calibrated_conf), 4),
            "calibration_applied": True,
            "calibration_n_obs":   n_obs,
            "raw_buy_prob":        round(raw_prob, 4),
        }

    def record_outcome(
        self,
        prediction_prob: float,
        actual_outcome:  int,
        regime:          str,
    ):
        """Enregistre le résultat d'un trade pour la calibration."""
        self._prediction_log.append({
            "prob":    prediction_prob,
            "outcome": actual_outcome,
            "regime":  regime,
        })
        if len(self._prediction_log) > 500:
            self._prediction_log.pop(0)
        self._update_calibration()

    def _update_calibration(self):
        """Met à jour la courbe de calibration."""
        if len(self._prediction_log) < 30:
            return
        bins = np.linspace(0.3, 0.9, 8)
        for i in range(len(bins) - 1):
            lo, hi = bins[i], bins[i + 1]
            in_bin = [
                x for x in self._prediction_log
                if lo <= x["prob"] < hi
            ]
            if len(in_bin) >= 5:
                avg_pred = np.mean([x["prob"] for x in in_bin])
                avg_out  = np.mean([x["outcome"] for x in in_bin])
                key = f"{lo:.2f}-{hi:.2f}"
                self._calibration_curve[key] = {
                    "predicted":  round(float(avg_pred), 3),
                    "actual":     round(float(avg_out), 3),
                    "correction": round(float(avg_out - avg_pred), 3),
                    "n":          len(in_bin),
                }

    def _get_calibration_correction(self, prob: float, regime: str) -> float:
        """Retourne la correction de calibration pour une probabilité donnée."""
        if not self._calibration_curve:
            return 0.0
        for key, val in self._calibration_curve.items():
            lo, hi = map(float, key.split("-"))
            if lo <= prob < hi:
                return val.get("correction", 0.0)
        return 0.0

    def get_calibration_summary(self) -> Dict:
        """Résumé de la qualité de calibration."""
        if len(self._prediction_log) < 30:
            return {"status": "insufficient_data", "n_obs": len(self._prediction_log)}
        preds   = np.array([x["prob"] for x in self._prediction_log])
        outs    = np.array([x["outcome"] for x in self._prediction_log])
        brier   = float(np.mean((preds - outs) ** 2))
        avg_acc = float((
            (preds > 0.5).astype(int) == outs
        ).mean())
        return {
            "n_observations":   len(self._prediction_log),
            "brier_score":      round(brier, 4),
            "accuracy":         round(avg_acc, 3),
            "calibration_bins": self._calibration_curve,
        }