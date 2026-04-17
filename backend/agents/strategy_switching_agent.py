# ============================================================
# AGENT 4 — Strategy Switching Agent
# ✅ Détecte les transitions de régime
# ✅ Recommande le switch entre familles de stratégies
# ✅ Gestion du délai de transition (évite le whipsaw)
# ============================================================

import numpy as np
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime, timedelta

class StrategySwitchingAgent:
    """
    Orchestre les transitions entre régimes et stratégies.

    Anti-whipsaw : impose un délai minimum entre deux switches.
    """

    MIN_SWITCH_DELAY_HOURS = 4  # Minimum 4h entre deux switches

    def __init__(self, worker_client, settings):
        self.client         = worker_client
        self.settings       = settings
        self._last_switch   = {}       # {strategy: datetime}
        self._switch_history = []
        logger.info("✅ StrategySwitchingAgent initialisé")

    def evaluate(
        self,
        current_allocation:  Dict[str, float],
        target_allocation:   Dict[str, float],
        regime_result:       Dict,
        performance_summary: Dict,
    ) -> Dict:
        """
        Évalue si un switch de stratégie est justifié.
        """
        if self.client.llm_available:
            llm_rec = self._llm_switch_recommendation(
                current_allocation, target_allocation,
                regime_result, performance_summary
            )
        else:
            llm_rec = None

        det_rec = self._deterministic_switch(
            current_allocation, target_allocation,
            regime_result, performance_summary
        )

        # Merge : LLM est consultatif, déterministe est autoritaire
        final = det_rec.copy()
        if llm_rec:
            final["llm_recommendation"] = llm_rec
        return final

    def _llm_switch_recommendation(
        self,
        current:     Dict,
        target:      Dict,
        regime:      Dict,
        performance: Dict,
    ) -> Optional[str]:
        """Consulte le LLM sur la pertinence du switch."""
        try:
            changes = {
                k: round(target.get(k, 0) - current.get(k, 0), 3)
                for k in set(list(current.keys()) + list(target.keys()))
                if abs(target.get(k, 0) - current.get(k, 0)) > 0.05
            }
            if not changes:
                return None
            prompt = (
                f"Regime: {regime.get('regime_label')} → "
                f"next: {regime.get('next_regime')}\n"
                f"Proposed allocation changes: {changes}\n"
                f"Recent performance: {performance}\n"
                f"Should we switch now? Reply: confirm / delay_2h / reject + brief reason"
            )
            return self.client.call_llm(prompt, max_tokens=150)
        except Exception as e:
            logger.error(f"StrategySwitching LLM: {e}")
            return None

    def _deterministic_switch(
        self,
        current:     Dict[str, float],
        target:      Dict[str, float],
        regime:      Dict,
        performance: Dict,
    ) -> Dict:
        """Logique déterministe de switch."""
        now = datetime.utcnow()
        switches_approved  = {}
        switches_delayed   = {}
        switches_rejected  = {}

        for strategy in set(list(current.keys()) + list(target.keys())):
            curr_w  = current.get(strategy, 0.0)
            targ_w  = target.get(strategy, 0.0)
            delta   = targ_w - curr_w
            abs_d   = abs(delta)

            # Changement < 3% → pas de switch
            if abs_d < 0.03:
                continue

            # Anti-whipsaw : vérifie délai minimum
            last_switch = self._last_switch.get(strategy)
            if last_switch:
                elapsed_h = (now - last_switch).total_seconds() / 3600
                if elapsed_h < self.MIN_SWITCH_DELAY_HOURS:
                    switches_delayed[strategy] = {
                        "delta":      round(delta, 3),
                        "wait_hours": round(self.MIN_SWITCH_DELAY_HOURS - elapsed_h, 1),
                    }
                    continue

            # Performance négative → switch plus prudent
            perf = performance.get(strategy, {})
            sharpe = perf.get("sharpe_5d", 0.0)
            if sharpe < -1.0 and delta > 0:
                # Hausse d'allocation sur stratégie qui perd → rejeter
                switches_rejected[strategy] = {
                    "delta":  round(delta, 3),
                    "reason": f"Sharpe {sharpe:.2f} trop négatif",
                }
                continue

            # Régime crash → blocage des switches non défensifs
            if regime.get("crash_regime") and strategy in ["trend", "mean_reversion"]:
                if delta > 0:
                    switches_rejected[strategy] = {
                        "delta":  round(delta, 3),
                        "reason": "Régime crash — blocage hausse stratégies directionnelles",
                    }
                    continue

            # Switch approuvé
            switches_approved[strategy] = round(delta, 3)
            self._last_switch[strategy] = now

        # Allocation finale après switches
        final_allocation = current.copy()
        for strat, delta in switches_approved.items():
            final_allocation[strat] = round(
                max(0.0, final_allocation.get(strat, 0) + delta), 4
            )
        total = sum(final_allocation.values()) + 1e-10
        final_allocation = {k: round(v / total, 4) for k, v in final_allocation.items()}

        n_approved = len(switches_approved)
        if n_approved > 0:
            self._switch_history.append({
                "timestamp": now.isoformat(),
                "switches":  switches_approved,
            })

        logger.info(
            f"🔀 Strategy Switch | Approved: {n_approved} | "
            f"Delayed: {len(switches_delayed)} | Rejected: {len(switches_rejected)}"
        )

        return {
            "final_allocation":   final_allocation,
            "switches_approved":  switches_approved,
            "switches_delayed":   switches_delayed,
            "switches_rejected":  switches_rejected,
            "n_switches":         n_approved,
        }