# ============================================================
# AGENT 5 — Drawdown Guardian
# ✅ Surveillance temps réel du drawdown
# ✅ Réduction automatique de l'exposition
# ✅ Circuit breaker si limites atteintes
# ✅ Recovery plan post-drawdown
# ============================================================

import numpy as np
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime

class DrawdownGuardian:
    """
    Gardien du drawdown portefeuille.

    Niveaux d'alerte :
    L1 (5%)  : Réduction exposition 25%
    L2 (8%)  : Réduction exposition 50% + alertes
    L3 (10%) : Stop total + mode preservation
    """

    LEVELS = {
        "L1": {"threshold": 0.05, "exposure_mult": 0.75, "label": "caution"},
        "L2": {"threshold": 0.08, "exposure_mult": 0.50, "label": "warning"},
        "L3": {"threshold": 0.10, "exposure_mult": 0.10, "label": "critical"},
    }

    def __init__(self, worker_client, settings):
        self.client        = worker_client
        self.settings      = settings
        self._peak         = 1.0
        self._equity_curve = [1.0]
        self._halt_active  = False
        self._halt_reason  = ""
        logger.info("✅ DrawdownGuardian initialisé")

    def update_and_check(
        self,
        current_equity:  float,
        daily_pnl_pct:   float,
        open_positions:  Dict,
    ) -> Dict:
        """
        Met à jour l'état du drawdown et retourne les directives.
        """
        # Update equity curve
        self._equity_curve.append(current_equity)
        self._peak = max(self._peak, current_equity)

        # Drawdown courant
        current_dd = (current_equity - self._peak) / (self._peak + 1e-10)

        # Détermination du niveau d'alerte
        level_triggered = None
        for lvl_name, lvl_cfg in sorted(
            self.LEVELS.items(),
            key=lambda x: x[1]["threshold"],
            reverse=True
        ):
            if abs(current_dd) >= lvl_cfg["threshold"]:
                level_triggered = lvl_name
                break

        # Circuit breaker journalier
        daily_halt = daily_pnl_pct < -self.settings.DAILY_LOSS_LIMIT_PCT

        # Directives
        if level_triggered == "L3" or daily_halt:
            self._halt_active = True
            self._halt_reason = (
                f"DD {abs(current_dd):.1%}" if level_triggered == "L3"
                else f"Daily loss {abs(daily_pnl_pct):.1%}"
            )
            exposure_mult    = 0.10
            allow_new_trades = False
            allow_existing   = False  # Ferme tout
        elif level_triggered == "L2":
            exposure_mult    = 0.50
            allow_new_trades = False
            allow_existing   = True
        elif level_triggered == "L1":
            exposure_mult    = 0.75
            allow_new_trades = True
            allow_existing   = True
        else:
            self._halt_active = False
            self._halt_reason = ""
            exposure_mult     = 1.0
            allow_new_trades  = True
            allow_existing    = True

        # Recovery : si on remonte de 50% du DD, on relâche
        if self._halt_active and abs(current_dd) < self.LEVELS["L2"]["threshold"] * 0.5:
            self._halt_active = False
            logger.info("✅ DrawdownGuardian : Recovery — reprise progressive")

        # LLM consultatif si disponible
        llm_note = None
        if self.client.llm_available and level_triggered in ["L2", "L3"]:
            try:
                prompt = (
                    f"Portfolio drawdown: {abs(current_dd):.1%} | "
                    f"Daily P&L: {daily_pnl_pct:.1%} | "
                    f"Open positions: {list(open_positions.keys())}\n"
                    f"Recommend specific risk reduction actions. Be concise."
                )
                llm_note = self.client.call_llm(prompt, max_tokens=200)
            except Exception:
                pass

        result = {
            "current_drawdown":  round(float(current_dd), 4),
            "peak_equity":       round(float(self._peak), 4),
            "current_equity":    round(float(current_equity), 4),
            "daily_pnl_pct":     round(float(daily_pnl_pct), 4),
            "level_triggered":   level_triggered,
            "halt_active":       self._halt_active,
            "halt_reason":       self._halt_reason,
            "exposure_mult":     exposure_mult,
            "allow_new_trades":  allow_new_trades,
            "allow_existing":    allow_existing,
            "recovery_progress": round(
                max(0, 1 - abs(current_dd) / self.LEVELS["L3"]["threshold"]), 3
            ),
        }
        if llm_note:
            result["llm_note"] = llm_note

        if level_triggered:
            logger.warning(
                f"⚠ DrawdownGuardian [{level_triggered}] | "
                f"DD: {abs(current_dd):.1%} | Halt: {self._halt_active}"
            )
        return result