# ============================================================
# AGENT 2 — Execution Timing Agent
# ✅ MODE 1 : LLM analyse le contexte macro pour le timing
# ✅ MODE 2 : Règles statistiques intraday + volume patterns
# Optimise le moment précis d'exécution
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional
from loguru import logger
from datetime import datetime, timedelta

class ExecutionTimingAgent:
    """
    Optimise le timing d'exécution des ordres.

    Logique :
    - Évite les 30 premières et 15 dernières minutes de séance
    - Privilégie les fenêtres de liquidité élevée (10h-12h, 13h-15h EST)
    - Ajuste selon les événements macro (Fed, CPI, earnings)
    - Détecte les microstructures favorables (volume uptick, spread tight)
    """

    def __init__(self, worker_client, settings):
        self.client   = worker_client
        self.settings = settings
        logger.info("✅ ExecutionTimingAgent initialisé")

    def evaluate(
        self,
        symbol:         str,
        signal:         Dict,
        execution_alpha: Dict,
        df_intra:       Optional[pd.DataFrame],
        macro_events:   Dict = None,
    ) -> Dict:
        """Évalue si c'est le bon moment pour exécuter."""
        if self.client.llm_available and macro_events:
            llm_context = self._llm_timing_context(
                symbol, signal, macro_events
            )
        else:
            llm_context = None

        det_result = self._deterministic_timing(
            df_intra, execution_alpha, signal
        )

        if llm_context:
            det_result["llm_timing_note"] = llm_context
            det_result["source"] = "hybrid"
        else:
            det_result["source"] = "deterministic"

        return det_result

    # ── MODE LLM ────────────────────────────────────────────
    def _llm_timing_context(
        self,
        symbol:       str,
        signal:       Dict,
        macro_events: Dict,
    ) -> Optional[str]:
        """Interroge le LLM sur le timing compte tenu des événements macro."""
        try:
            upcoming = [
                k for k, v in macro_events.items()
                if v.get("hours_away", 999) < 24
            ]
            if not upcoming:
                return None
            prompt = (
                f"Symbol: {symbol} | Signal: {signal.get('direction')} "
                f"(score={signal.get('final_score', 0):.2f})\n"
                f"Upcoming macro events in 24h: {upcoming}\n"
                f"Should we execute NOW or wait? "
                f"Respond with: execute_now / wait_1h / wait_event / cancel"
            )
            return self.client.call_llm(prompt, max_tokens=100)
        except Exception as e:
            logger.error(f"ExecutionTimingAgent LLM: {e}")
            return None

    # ── MODE DÉTERMINISTE ────────────────────────────────────
    def _deterministic_timing(
        self,
        df_intra:       Optional[pd.DataFrame],
        execution_alpha: Dict,
        signal:         Dict,
    ) -> Dict:
        """Analyse statistique du timing optimal."""
        now_utc  = datetime.utcnow()
        h, m     = now_utc.hour, now_utc.minute
        t        = h + m / 60

        # ── Fenêtres de marché (UTC) ──────────────────────
        is_open_volatility  = 14.5  <= t <= 15.0   # 9h30-10h EST
        is_close_volatility = 20.75 <= t <= 21.0   # 15h45-16h EST
        is_lunch_lull       = 17.0  <= t <= 17.5   # 12h-12h30 EST
        is_prime_window_1   = 15.0  <= t <= 17.0   # 10h-12h EST
        is_prime_window_2   = 17.5  <= t <= 20.5   # 12h30-15h30 EST

        # ── Analyse volume intraday ───────────────────────
        vol_score = 0.5
        if df_intra is not None and len(df_intra) >= 6:
            recent_vol = df_intra["volume"].tail(3).mean()
            avg_vol    = df_intra["volume"].mean()
            vol_ratio  = recent_vol / (avg_vol + 1e-10)
            vol_score  = float(min(1.0, vol_ratio / 2))

        # ── Score de timing ───────────────────────────────
        if is_open_volatility:
            timing_score = 0.35
            recommendation = "wait_10min"
            reason = "Open auction — spread wide, price discovery volatile"
        elif is_close_volatility:
            timing_score = 0.30
            recommendation = "wait_next_session"
            reason = "Close auction — MOC orders distort price"
        elif is_lunch_lull:
            timing_score = 0.55
            recommendation = "execute_small"
            reason = "Lunch lull — lower volume, wider spread"
        elif is_prime_window_1 or is_prime_window_2:
            timing_score = 0.85 + vol_score * 0.15
            recommendation = "execute"
            reason = "Prime execution window — high liquidity"
        else:
            timing_score = 0.50
            recommendation = "execute_with_caution"
            reason = "Suboptimal window"

        # Urgence du signal → override timing
        if signal.get("final_score", 0) > 0.85:
            if recommendation in ["wait_10min", "execute_small"]:
                recommendation = "execute"
                reason += " | Signal urgency override"

        return {
            "timing_score":      round(timing_score, 3),
            "recommendation":    recommendation,
            "reason":            reason,
            "is_prime_window":   is_prime_window_1 or is_prime_window_2,
            "is_avoid_period":   is_open_volatility or is_close_volatility,
            "volume_score":      round(vol_score, 3),
            "utc_time":          f"{h:02d}:{m:02d}",
            "execute_now":       recommendation in ["execute", "execute_small"],
        }