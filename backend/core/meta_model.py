# ============================================================
# ALPHAVAULT QUANT — Meta Model Calibrator
# ✅ Blende les outputs des 3 modèles ensemble
# ✅ Calibration par régime de marché
# ✅ Surface de confiance dynamique
# ============================================================

import numpy as np
from typing import Dict, Optional
from loguru import logger

class MetaModel:
    """
    Calibrateur méta-modèle : combine signal_model + regime + options.

    Responsabilité :
    - Ajuster les probabilités selon le régime de marché
    - Calculer le trade score final [0, 1]
    - Générer la surface de confiance
    - Filtrer les signaux faibles
    """

    # Multiplicateurs de confiance par régime
    REGIME_CONFIDENCE_MULT = {
        "trend_up":          1.20,
        "trend_down":        1.15,
        "range_bound":       0.80,
        "low_volatility":    1.10,
        "high_volatility":   0.70,
        "crash":             0.50,
        "macro_tightening":  0.85,
        "macro_easing":      1.15,
    }

    # Ajustement de direction par régime
    REGIME_DIRECTION_BIAS = {
        "trend_up":          +0.05,  # Biais haussier
        "trend_down":        -0.05,  # Biais baissier
        "crash":             -0.10,  # Fort biais baissier
        "macro_easing":      +0.03,
        "macro_tightening":  -0.03,
    }

    def __init__(self):
        logger.info("✅ MetaModel initialisé")

    def calibrate(
        self,
        raw_signal:    Dict,
        regime_result: Dict,
        options_data:  Dict = None,
        features:      Dict = None,
    ) -> Dict:
        """
        Calibre et enrichit les signaux bruts du SignalModel.

        Returns:
            final_score    : float [0, 1] (score de trade final)
            confidence_surface : Dict (confiance par horizon)
            adjusted_buy_prob  : float (probabilité ajustée)
            trade_action   : str (execute / wait / skip)
        """
        try:
            regime_label = regime_result.get("regime_label", "range_bound")
            regime_score = regime_result.get("regime_score", 0.0)
            regime_conf  = regime_result.get("confidence", 0.5)

            # ── 1. Probabilité ajustée par régime ────────
            raw_buy  = raw_signal.get("buy_prob",  0.5)
            raw_sell = raw_signal.get("sell_prob", 0.5)
            raw_conf = raw_signal.get("confidence", 0.0)

            direction_bias = self.REGIME_DIRECTION_BIAS.get(regime_label, 0.0)
            adj_buy_prob   = np.clip(raw_buy + direction_bias, 0.01, 0.99)
            adj_sell_prob  = 1.0 - adj_buy_prob

            # ── 2. Multiplicateur de confiance par régime
            conf_mult = self.REGIME_CONFIDENCE_MULT.get(regime_label, 1.0)
            adj_conf  = float(np.clip(raw_conf * conf_mult, 0.0, 1.0))

            # ── 3. Ajustement options (si disponible) ────
            options_boost = 0.0
            if options_data:
                iv_rank = options_data.get("iv_rank", 0.5)
                if adj_buy_prob > 0.55 and iv_rank < 0.30:
                    options_boost = 0.05  # Vol basse + signal haussier = boost
                elif adj_buy_prob < 0.45 and iv_rank > 0.70:
                    options_boost = 0.05  # Vol haute + signal baissier = boost
            adj_conf = float(np.clip(adj_conf + options_boost, 0.0, 1.0))

            # ── 4. Score de trade final ───────────────────
            # Combine : direction nette × confiance ajustée × régime
            direction_strength = abs(adj_buy_prob - 0.5) * 2  # [0, 1]
            final_score = float(
                direction_strength * adj_conf * regime_conf * conf_mult * 0.5
            )
            final_score = float(np.clip(final_score, 0.0, 1.0))

            # ── 5. Surface de confiance multi-horizon ─────
            confidence_surface = {
                "intraday":  round(adj_conf * 0.70, 3),  # Plus incertain CT
                "1_week":    round(adj_conf * 1.00, 3),
                "1_month":   round(adj_conf * 0.85, 3),
                "3_months":  round(adj_conf * 0.65, 3),
            }

            # ── 6. Décision d'action ──────────────────────
            min_conf   = 0.55
            min_score  = 0.35
            allow_long = regime_result.get("allow_long", False)
            allow_short= regime_result.get("allow_short", False)

            direction = raw_signal.get("direction", "neutral")
            if adj_conf < min_conf or final_score < min_score:
                trade_action = "wait"
            elif direction == "buy" and not allow_long:
                trade_action = "wait"
            elif direction == "sell" and not allow_short:
                trade_action = "wait"
            elif final_score >= 0.70:
                trade_action = "execute_strong"
            elif final_score >= min_score:
                trade_action = "execute"
            else:
                trade_action = "wait"

            return {
                "final_score":        round(final_score, 4),
                "adjusted_buy_prob":  round(float(adj_buy_prob), 4),
                "adjusted_sell_prob": round(float(adj_sell_prob), 4),
                "adjusted_confidence":round(adj_conf, 4),
                "raw_confidence":     round(raw_conf, 4),
                "direction":          direction,
                "trade_action":       trade_action,
                "confidence_surface": confidence_surface,
                "regime_mult":        conf_mult,
                "options_boost":      round(options_boost, 3),
                "probability_reliability": self._assess_reliability(
                    adj_buy_prob, adj_conf, regime_label
                ),
            }

        except Exception as e:
            logger.error(f"MetaModel.calibrate: {e}")
            return {
                "final_score":  0.0,
                "trade_action": "wait",
                "direction":    "neutral",
                "adjusted_confidence": 0.0,
                "confidence_surface":  {},
            }

    def _assess_reliability(
        self,
        prob:         float,
        confidence:   float,
        regime_label: str,
    ) -> str:
        """Évalue la fiabilité qualitative du signal."""
        if confidence > 0.75 and abs(prob - 0.5) > 0.20 and regime_label in [
            "trend_up", "trend_down", "low_volatility"
        ]:
            return "high"
        elif confidence > 0.55 and abs(prob - 0.5) > 0.10:
            return "medium"
        elif confidence > 0.40:
            return "low"
        else:
            return "very_low"