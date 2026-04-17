# ============================================================
# AGENT 9 — Capital Rotation Agent
# ✅ Rotation sectorielle dynamique
# ✅ Risk-on / Risk-off detection
# ✅ Rotation vers les actifs les plus forts
# ============================================================

import numpy as np
from typing import Dict, List, Optional
from loguru import logger

SECTORS = {
    "technology":   ["AAPL", "MSFT", "NVDA", "GOOGL", "META"],
    "financials":   ["JPM", "GS", "BAC", "MS"],
    "energy":       ["XOM", "CVX", "COP"],
    "healthcare":   ["JNJ", "UNH", "PFE"],
    "consumer":     ["AMZN", "TSLA", "HD"],
    "defensives":   ["KO", "PG", "JNJ"],
    "rates_proxy":  ["TLT", "IEF"],
    "risk_assets":  ["QQQ", "IWM", "HYG"],
}

RISK_ON_ASSETS  = ["QQQ", "IWM", "NVDA", "META", "TSLA"]
RISK_OFF_ASSETS = ["TLT", "GLD", "KO", "PG", "JNJ"]

class CapitalRotationAgent:
    """
    Orchestre la rotation du capital entre secteurs et actifs.

    Logique :
    - Détecte la phase risk-on / risk-off via momentum relatif
    - Calcule le relative strength de chaque secteur
    - Recommande les rotations de capital
    """

    def __init__(self, worker_client, settings):
        self.client   = worker_client
        self.settings = settings
        logger.info("✅ CapitalRotationAgent initialisé")

    def analyze(
        self,
        returns_dict:   Dict[str, np.ndarray],
        regime_result:  Dict,
        current_weights: Dict[str, float],
    ) -> Dict:
        """Analyse et recommande les rotations de capital."""
        risk_mode   = self._detect_risk_mode(returns_dict, regime_result)
        sector_rs   = self._compute_sector_relative_strength(returns_dict)
        rotation_rec = self._compute_rotation_recommendations(
            sector_rs, risk_mode, current_weights, regime_result
        )

        llm_note = None
        if self.client.llm_available:
            try:
                top_sectors = sorted(sector_rs.items(), key=lambda x: x[1], reverse=True)[:3]
                prompt = (
                    f"Risk mode: {risk_mode['mode']}\n"
                    f"Top sectors by momentum: {top_sectors}\n"
                    f"Regime: {regime_result.get('regime_label')}\n"
                    f"Suggest capital rotation in 1 sentence."
                )
                llm_note = self.client.call_llm(prompt, max_tokens=100)
            except Exception:
                pass

        result = {
            "risk_mode":          risk_mode,
            "sector_rs":          {k: round(v, 3) for k, v in sector_rs.items()},
            "rotation_rec":       rotation_rec,
            "top_sectors":        sorted(
                sector_rs.items(), key=lambda x: x[1], reverse=True
            )[:3],
            "bottom_sectors":     sorted(
                sector_rs.items(), key=lambda x: x[1]
            )[:3],
        }
        if llm_note:
            result["llm_note"] = llm_note
        return result

    def _detect_risk_mode(
        self,
        returns_dict:  Dict[str, np.ndarray],
        regime_result: Dict,
    ) -> Dict:
        """Détecte le mode risk-on ou risk-off."""
        risk_on_scores  = []
        risk_off_scores = []

        for sym in RISK_ON_ASSETS:
            if sym in returns_dict and len(returns_dict[sym]) >= 20:
                ret_20d = float(np.sum(returns_dict[sym][-20:]))
                risk_on_scores.append(ret_20d)

        for sym in RISK_OFF_ASSETS:
            if sym in returns_dict and len(returns_dict[sym]) >= 20:
                ret_20d = float(np.sum(returns_dict[sym][-20:]))
                risk_off_scores.append(ret_20d)

        avg_risk_on  = float(np.mean(risk_on_scores))  if risk_on_scores  else 0.0
        avg_risk_off = float(np.mean(risk_off_scores)) if risk_off_scores else 0.0
        spread       = avg_risk_on - avg_risk_off

        if regime_result.get("crash_regime"):
            mode = "risk_off_extreme"
        elif spread > 0.02:
            mode = "risk_on"
        elif spread < -0.02:
            mode = "risk_off"
        else:
            mode = "neutral"

        return {
            "mode":         mode,
            "spread":       round(spread, 4),
            "risk_on_avg":  round(avg_risk_on, 4),
            "risk_off_avg": round(avg_risk_off, 4),
        }

    def _compute_sector_relative_strength(
        self,
        returns_dict: Dict[str, np.ndarray],
    ) -> Dict[str, float]:
        """Calcule le relative strength de chaque secteur (20j)."""
        sector_rs = {}
        for sector, syms in SECTORS.items():
            sector_rets = []
            for sym in syms:
                if sym in returns_dict and len(returns_dict[sym]) >= 20:
                    ret = float(np.sum(returns_dict[sym][-20:]))
                    sector_rets.append(ret)
            if sector_rets:
                sector_rs[sector] = float(np.mean(sector_rets))
            else:
                sector_rs[sector] = 0.0
        return sector_rs

    def _compute_rotation_recommendations(
        self,
        sector_rs:    Dict[str, float],
        risk_mode:    Dict,
        weights:      Dict[str, float],
        regime:       Dict,
    ) -> List[Dict]:
        """Génère des recommandations de rotation."""
        recs       = []
        mode       = risk_mode.get("mode", "neutral")
        sorted_sec = sorted(sector_rs.items(), key=lambda x: x[1], reverse=True)

        for i, (sector, rs) in enumerate(sorted_sec):
            if i < 2 and rs > 0.01:  # Top 2 secteurs avec momentum positif
                recs.append({
                    "action":       "increase",
                    "sector":       sector,
                    "relative_strength": round(rs, 4),
                    "rationale":    f"Top momentum sector in {mode} environment",
                })
            elif i >= len(sorted_sec) - 2 and rs < -0.01:  # Bottom 2 secteurs
                recs.append({
                    "action":       "decrease",
                    "sector":       sector,
                    "relative_strength": round(rs, 4),
                    "rationale":    f"Underperforming sector — reduce exposure",
                })

        # Risk mode override
        if mode == "risk_off":
            recs.insert(0, {
                "action":    "increase",
                "sector":    "rates_proxy",
                "rationale": "Risk-off mode: shift to TLT/bonds",
            })
        elif mode == "risk_off_extreme":
            recs = [{
                "action":    "reduce_all_risk",
                "sector":    "all",
                "rationale": "Extreme risk-off: cash/bonds only",
            }]
        return recs