# ============================================================
# ALPHAVAULT QUANT — Execution Alpha Engine
# ✅ Estimation probabilité de fill
# ✅ Slippage estimé par régime de vol
# ✅ Fenêtre optimale d'exécution intraday
# ✅ Latency penalty estimator
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional
from datetime import datetime, time
from loguru import logger

class ExecutionAlphaEngine:
    """
    Moteur d'optimisation de l'exécution.

    Objectif : minimiser le coût d'implémentation (slippage + timing).
    
    Sorties :
    - fill_probability    : prob de fill à la limite souhaitée
    - slippage_bps_est    : slippage estimé en basis points
    - optimal_timing      : meilleure fenêtre d'exécution
    - execution_quality   : score global [0, 1]
    """

    # Coûts de friction moyens par asset class (bps)
    FRICTION_BPS = {
        "large_cap":    2.0,
        "mid_cap":      5.0,
        "small_cap":   12.0,
        "etf":          1.5,
        "options":     20.0,
    }

    # Fenêtres intraday optimales (UTC) — évite open/close
    OPTIMAL_WINDOWS_UTC = [
        (15, 00, 17, 00),  # 10h00–12h00 EST
        (17, 30, 19, 30),  # 12h30–14h30 EST
    ]

    def __init__(self):
        logger.info("✅ ExecutionAlphaEngine initialisé")

    def analyze(
        self,
        symbol:        str,
        df_daily:      pd.DataFrame,
        signal:        Dict,
        market_cap:    float = 0.0,
        order_size_usd: float = 10000.0,
        df_intra:      Optional[pd.DataFrame] = None,
    ) -> Dict:
        """
        Analyse complète de l'alpha d'exécution.
        """
        try:
            asset_class = self._classify_asset(market_cap)

            fill_prob   = self._estimate_fill_probability(df_daily, signal)
            slippage    = self._estimate_slippage(
                df_daily, asset_class, order_size_usd
            )
            timing      = self._optimal_execution_timing(df_intra)
            latency_pen = self._latency_penalty()
            ex_quality  = self._execution_quality_score(
                fill_prob, slippage, timing["is_optimal_now"]
            )

            return {
                "fill_probability":    round(float(fill_prob), 3),
                "slippage_bps_est":    round(float(slippage), 2),
                "slippage_pct_est":    round(float(slippage / 10000), 5),
                "optimal_timing":      timing,
                "latency_penalty_bps": round(float(latency_pen), 2),
                "execution_quality":   round(float(ex_quality), 3),
                "asset_class":         asset_class,
                "execute_now":         (
                    fill_prob > 0.70 and
                    slippage < 15 and
                    timing["is_optimal_now"]
                ),
                "delay_recommendation": timing.get("recommendation", "execute"),
            }
        except Exception as e:
            logger.error(f"ExecutionAlphaEngine.analyze({symbol}): {e}")
            return self._default_result()

    # ── Fill Probability ─────────────────────────────────────
    def _estimate_fill_probability(
        self,
        df:     pd.DataFrame,
        signal: Dict,
    ) -> float:
        """
        Probabilité de fill à prix limite.
        Basée sur : volatilité intraday + momentum + volume.
        """
        if df.empty or len(df) < 5:
            return 0.70

        log_ret = np.log(df["close"] / df["close"].shift(1)).dropna()
        rvol_5d = float(log_ret.tail(5).std() * np.sqrt(252))

        # Vol élevée → meilleure chance de fill sur un limit order
        vol_bonus   = min(0.15, rvol_5d * 0.5)
        # Confiance signal élevée → fill probability plus haute
        conf_bonus  = signal.get("adjusted_confidence", 0.5) * 0.10
        # Base
        base_fill   = 0.75

        fill_prob = base_fill + vol_bonus + conf_bonus
        return float(np.clip(fill_prob, 0.10, 0.98))

    # ── Slippage Estimation ───────────────────────────────────
    def _estimate_slippage(
        self,
        df:             pd.DataFrame,
        asset_class:    str,
        order_size_usd: float,
    ) -> float:
        """
        Estime le slippage en basis points.
        Modèle : slippage_base × (1 + sqrt(order_size / ADV))
        """
        base_bps = self.FRICTION_BPS.get(asset_class, 5.0)

        if not df.empty and len(df) >= 20:
            adv = float((df["close"] * df["volume"]).tail(20).mean())  # ADV en USD
            if adv > 0:
                participation_rate = order_size_usd / adv
                market_impact      = np.sqrt(participation_rate) * 50  # bps
                slippage           = base_bps + market_impact
            else:
                slippage = base_bps * 2
        else:
            slippage = base_bps * 2

        # Ajustement vol : plus volatile = plus de slippage
        if len(df) >= 5:
            log_ret = np.log(df["close"] / df["close"].shift(1)).dropna()
            rvol    = float(log_ret.tail(5).std() * np.sqrt(252))
            slippage *= (1 + max(0, rvol - 0.15) * 2)

        return float(np.clip(slippage, 0.5, 100.0))

    # ── Optimal Execution Timing ──────────────────────────────
    def _optimal_execution_timing(
        self,
        df_intra: Optional[pd.DataFrame],
    ) -> Dict:
        """
        Détermine la meilleure fenêtre d'exécution.
        Évite l'ouverture (9h30-10h00 EST) et la fermeture (15h45-16h00 EST).
        """
        now_utc  = datetime.utcnow()
        hour_utc = now_utc.hour
        min_utc  = now_utc.minute
        time_dec = hour_utc + min_utc / 60

        # Vérifier si dans une fenêtre optimale
        is_optimal = any(
            (h_start + m_start / 60) <= time_dec <= (h_end + m_end / 60)
            for h_start, m_start, h_end, m_end in self.OPTIMAL_WINDOWS_UTC
        )

        # Évite l'ouverture (14:30–15:00 UTC = 9:30-10:00 EST)
        is_open_auction   = 14.5 <= time_dec <= 15.0
        # Évite la clôture (20:45–21:00 UTC = 15:45-16:00 EST)
        is_close_auction  = 20.75 <= time_dec <= 21.0

        if is_open_auction:
            rec = "wait_10min"
        elif is_close_auction:
            rec = "wait_next_day"
        elif is_optimal:
            rec = "execute"
        else:
            rec = "execute_with_caution"

        # Analyse volume intraday (si disponible)
        vol_factor = 1.0
        if df_intra is not None and len(df_intra) >= 6:
            recent_vol = df_intra["volume"].tail(3).mean()
            avg_vol    = df_intra["volume"].mean()
            vol_factor = float(recent_vol / (avg_vol + 1e-10))

        return {
            "is_optimal_now":   is_optimal and not is_open_auction and not is_close_auction,
            "is_open_auction":  is_open_auction,
            "is_close_auction": is_close_auction,
            "recommendation":   rec,
            "volume_factor":    round(vol_factor, 2),
            "utc_hour":         hour_utc,
            "utc_minute":       min_utc,
        }

    # ── Latency Penalty ───────────────────────────────────────
    def _latency_penalty(self) -> float:
        """
        Estime la pénalité de latence (GitHub Actions cold start).
        En moyenne 60–90 secondes → impact ~0.5–2 bps sur signaux 5min.
        """
        # GitHub Actions : latence ~60s → impact sur prix ~0.1–1 bps
        # Selon la volatilité, ce délai peut coûter entre 0.5 et 5 bps
        base_latency_bps = 1.5  # Coût moyen estimé
        return base_latency_bps

    # ── Quality Score ─────────────────────────────────────────
    def _execution_quality_score(
        self,
        fill_prob:      float,
        slippage_bps:   float,
        is_optimal:     bool,
    ) -> float:
        score = (
            fill_prob * 0.40 +
            (1.0 - min(slippage_bps / 50, 1.0)) * 0.40 +
            (0.20 if is_optimal else 0.0)
        )
        return float(np.clip(score, 0.0, 1.0))

    def _classify_asset(self, market_cap: float) -> str:
        if market_cap == 0:
            return "large_cap"
        elif market_cap >= 10e9:
            return "large_cap"
        elif market_cap >= 2e9:
            return "mid_cap"
        else:
            return "small_cap"

    def _default_result(self) -> Dict:
        return {
            "fill_probability":    0.70,
            "slippage_bps_est":    5.0,
            "slippage_pct_est":    0.0005,
            "optimal_timing":      {"is_optimal_now": True, "recommendation": "execute"},
            "latency_penalty_bps": 1.5,
            "execution_quality":   0.65,
            "execute_now":         False,
        }