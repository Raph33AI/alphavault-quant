# ============================================================
# AGENT 14 — Multi-Agent Council
# ✅ Orchestre le vote de tous les agents
# ✅ MODE 1 : LLM arbitre les conflits
# ✅ MODE 2 : Vote pondéré déterministe
# ✅ Décision finale consensuelle
# ============================================================

import numpy as np
from typing import Dict, List, Optional
from loguru import logger

class MultiAgentCouncil:
    """
    Conseil multi-agents : agrège les décisions de tous les agents
    en une décision finale cohérente.

    Agents votants :
    1.  StrategyDiscoveryAgent   → opportunité (buy/sell/wait)
    2.  ExecutionTimingAgent     → timing (execute/wait)
    3.  FeatureDriftAgent        → fiabilité modèle (ok/retrain)
    4.  StrategySwitchingAgent   → allocation (changes)
    5.  DrawdownGuardian         → risque (allow/halt)
    6.  CorrelationSurfaceAgent  → diversification (ok/reduce)
    7.  ConfidenceCalibrator     → confiance calibrée
    8.  MarketImpactModel        → faisabilité ordre
    9.  CapitalRotationAgent     → rotation sectorielle
    10. GreeksBalancer           → exposition options
    11. HyperparameterEvolution  → qualité modèle
    12. StrategyWeightingAgent   → poids stratégies
    13. SelfEvaluationAgent      → santé globale
    """

    # Poids de vote de chaque agent
    AGENT_WEIGHTS = {
        "drawdown_guardian":    0.20,  # Priorité absolue risque
        "regime_model":         0.15,  # Régime de marché
        "signal_model":         0.15,  # Signal ML
        "execution_timing":     0.10,  # Timing optimal
        "risk_manager":         0.10,  # Gestion risque
        "correlation_surface":  0.08,  # Diversification
        "strategy_switching":   0.08,  # Allocation stratégies
        "market_impact":        0.07,  # Impact de l'ordre
        "capital_rotation":     0.07,  # Rotation sectorielle
    }

    # Seuils de décision finale
    EXECUTE_THRESHOLD     = 0.58   # Score pondéré > 0.58 → execute
    STRONG_EXECUTE        = 0.72   # Score > 0.72 → execute_strong
    VETO_THRESHOLD        = 0.30   # Score < 0.30 → veto absolu

    def __init__(self, worker_client, settings):
        self.client           = worker_client
        self.settings         = settings
        self._decisions_log: List[Dict] = []
        logger.info("✅ MultiAgentCouncil initialisé")

    # ── Point d'Entrée Principal ─────────────────────────────
    def deliberate(
        self,
        agent_outputs:   Dict[str, Dict],
        symbol:          str,
        proposed_action: Dict,
    ) -> Dict:
        """
        Lance la délibération et retourne la décision finale.

        Args:
            agent_outputs   : résultats de chaque agent {nom: output_dict}
            symbol          : ticker concerné
            proposed_action : action proposée par le TradingAgent
        """
        if self.client.llm_available:
            return self._llm_council(agent_outputs, symbol, proposed_action)
        return self._deterministic_council(agent_outputs, symbol, proposed_action)

    # ── MODE 1 : Conseil LLM ─────────────────────────────────
    def _llm_council(
        self,
        outputs:  Dict,
        symbol:   str,
        proposed: Dict,
    ) -> Dict:
        """
        Le LLM arbitre les conflits entre agents.
        Fallback automatique vers déterministe si LLM échoue.
        """
        try:
            # Construction du résumé pour le prompt
            drawdown_ok  = not outputs.get("drawdown_guardian",  {}).get("halt_active", False)
            regime_label = outputs.get("regime",       {}).get("regime_label", "unknown")
            regime_score = outputs.get("regime",       {}).get("regime_score", 0.0)
            signal_dir   = outputs.get("signal",       {}).get("direction", "neutral")
            signal_conf  = outputs.get("signal",       {}).get("adjusted_confidence", 0.0)
            exec_ok      = outputs.get("exec_timing",  {}).get("vote", "execute") == "execute"
            impact_ok    = outputs.get("market_impact",{}).get("feasible", True)
            self_eval    = outputs.get("self_eval",    {}).get("system_health", "ok")
            drift_ok     = not outputs.get("feature_drift", {}).get("retrain_needed", False)
            corr_ok      = not outputs.get("correlation_surface", {}).get("reduce_exposure", False)

            prompt = f"""You are the chief risk officer of a quantitative hedge fund.
A multi-agent trading system is requesting approval for the following action:

SYMBOL: {symbol}
PROPOSED ACTION: {proposed.get('trade_action', 'unknown').upper()}
DIRECTION: {proposed.get('direction', 'neutral').upper()}
SIGNAL SCORE: {proposed.get('final_score', 0):.3f}
SIGNAL CONFIDENCE: {signal_conf:.1%}

AGENT REPORTS:
- Drawdown Guardian  : {'✅ ALLOW' if drawdown_ok else '🚨 HALT'}
- Market Regime      : {regime_label} (score={regime_score:+.2f})
- ML Signal          : {signal_dir.upper()} (confidence={signal_conf:.1%})
- Execution Timing   : {'✅ OPTIMAL' if exec_ok else '⚠ SUBOPTIMAL'}
- Market Impact      : {'✅ FEASIBLE' if impact_ok else '⚠ HIGH IMPACT'}
- Feature Drift      : {'✅ STABLE' if drift_ok else '⚠ RETRAIN NEEDED'}
- Correlation Check  : {'✅ DIVERSIFIED' if corr_ok else '⚠ REDUCE EXPOSURE'}
- System Health      : {self_eval.upper()}

Respond with EXACTLY this JSON format (no markdown):
{{"decision": "execute|wait|veto", "confidence": 0.0-1.0, "reason": "one sentence", "size_mult": 0.5-1.5}}

Rules:
- "veto" if drawdown_guardian=HALT or system_health=critical
- "execute" only if regime allows direction AND confidence > 0.55
- "wait" for all other cases
- size_mult < 1.0 if any warning active"""

            llm_response = self.client.call_llm(
                prompt    = prompt,
                max_tokens= 150,
                model     = "gemini-2.5-flash",
            )

            if llm_response:
                parsed = self._parse_llm_response(llm_response)
                if parsed:
                    result = self._build_council_result(
                        decision     = parsed.get("decision", "wait"),
                        confidence   = float(parsed.get("confidence", 0.5)),
                        size_mult    = float(parsed.get("size_mult", 1.0)),
                        reason       = parsed.get("reason", "LLM council decision"),
                        mode         = "llm",
                        agent_votes  = self._collect_votes(outputs, proposed),
                    )
                    self._log_decision(symbol, result)
                    return result

            # Fallback déterministe si parsing échoue
            logger.warning("⚠ LLM response parse failed → fallback déterministe")
            return self._deterministic_council(outputs, symbol, proposed)

        except Exception as e:
            logger.error(f"MultiAgentCouncil._llm_council: {e}")
            return self._deterministic_council(outputs, symbol, proposed)

    # ── MODE 2 : Conseil Déterministe ────────────────────────
    def _deterministic_council(
        self,
        outputs:  Dict,
        symbol:   str,
        proposed: Dict,
    ) -> Dict:
        """
        Vote pondéré déterministe — aucun LLM requis.
        Chaque agent contribue un score normalisé.
        """
        try:
            # ── Collecte des votes ────────────────────────
            votes    = self._collect_votes(outputs, proposed)
            weighted = self._compute_weighted_score(votes)

            # ── Vétos absolus ─────────────────────────────
            veto_active, veto_reason = self._check_vetos(outputs)
            if veto_active:
                result = self._build_council_result(
                    decision   = "veto",
                    confidence = 1.0,
                    size_mult  = 0.0,
                    reason     = veto_reason,
                    mode       = "deterministic_veto",
                    agent_votes= votes,
                )
                self._log_decision(symbol, result)
                return result

            # ── Décision finale ───────────────────────────
            if weighted["score"] >= self.STRONG_EXECUTE:
                decision   = "execute_strong"
                size_mult  = 1.20
                confidence = min(weighted["score"], 0.95)
            elif weighted["score"] >= self.EXECUTE_THRESHOLD:
                decision   = "execute"
                size_mult  = 1.00
                confidence = weighted["score"]
            elif weighted["score"] >= self.VETO_THRESHOLD:
                decision   = "wait"
                size_mult  = 0.0
                confidence = 1.0 - weighted["score"]
            else:
                decision   = "veto"
                size_mult  = 0.0
                confidence = 0.95

            # Réduction si agents d'avertissement actifs
            warnings = self._count_warnings(outputs)
            size_mult *= max(0.5, 1.0 - warnings * 0.10)

            reason = (
                f"Score pondéré: {weighted['score']:.3f} | "
                f"Votes buy: {weighted['buy_votes']} | "
                f"Votes sell: {weighted['sell_votes']} | "
                f"Warnings: {warnings}"
            )

            result = self._build_council_result(
                decision    = decision,
                confidence  = round(confidence, 3),
                size_mult   = round(size_mult, 2),
                reason      = reason,
                mode        = "deterministic",
                agent_votes = votes,
                weighted    = weighted,
            )
            self._log_decision(symbol, result)
            return result

        except Exception as e:
            logger.error(f"_deterministic_council: {e}")
            return self._safe_default(symbol)

    # ── Collecte des Votes ────────────────────────────────────
    def _collect_votes(self, outputs: Dict, proposed: Dict) -> Dict:
        """Extrait le vote normalisé de chaque agent."""
        votes = {}

        # 1. DrawdownGuardian → veto si halt
        dg = outputs.get("drawdown_guardian", {})
        votes["drawdown_guardian"] = {
            "vote":   "wait" if dg.get("halt_active") else proposed.get("direction", "neutral"),
            "score":  0.0 if dg.get("halt_active") else 1.0,
            "weight": self.AGENT_WEIGHTS["drawdown_guardian"],
        }

        # 2. Regime Model → aligne ou bloque
        reg = outputs.get("regime", {})
        regime_score = reg.get("regime_score", 0.0)
        allow_long   = reg.get("allow_long", False)
        allow_short  = reg.get("allow_short", False)
        direction    = proposed.get("direction", "neutral")

        if direction == "buy" and allow_long:
            reg_score = 0.5 + regime_score * 0.5
        elif direction == "sell" and allow_short:
            reg_score = 0.5 + abs(regime_score) * 0.5
        else:
            reg_score = 0.3  # Contre-régime → score faible

        votes["regime_model"] = {
            "vote":   direction if (allow_long or allow_short) else "wait",
            "score":  float(np.clip(reg_score, 0, 1)),
            "weight": self.AGENT_WEIGHTS["regime_model"],
        }

        # 3. Signal Model
        sig = outputs.get("signal", {})
        sig_conf = sig.get("adjusted_confidence", 0.0)
        sig_dir  = sig.get("direction", "neutral")
        votes["signal_model"] = {
            "vote":   sig_dir,
            "score":  sig_conf,
            "weight": self.AGENT_WEIGHTS["signal_model"],
        }

        # 4. Execution Timing
        et = outputs.get("exec_timing", {})
        et_vote  = et.get("vote", "execute")
        et_score = 0.85 if et_vote == "execute" else \
                   0.40 if et_vote == "execute_with_caution" else 0.10
        votes["execution_timing"] = {
            "vote":   direction if et_vote in ("execute", "execute_with_caution") else "wait",
            "score":  et_score,
            "weight": self.AGENT_WEIGHTS["execution_timing"],
        }

        # 5. Risk Manager
        rm = outputs.get("risk", {})
        is_over = rm.get("is_over_leveraged", False)
        votes["risk_manager"] = {
            "vote":   "wait" if is_over else direction,
            "score":  0.30 if is_over else 0.80,
            "weight": self.AGENT_WEIGHTS["risk_manager"],
        }

        # 6. Correlation Surface
        cs = outputs.get("correlation_surface", {})
        reduce = cs.get("reduce_exposure", False)
        votes["correlation_surface"] = {
            "vote":   "wait" if reduce else direction,
            "score":  0.40 if reduce else 0.80,
            "weight": self.AGENT_WEIGHTS["correlation_surface"],
        }

        # 7. Strategy Switching
        ss = outputs.get("strategy_switching", {})
        ss_score = ss.get("allocation_score", 0.70)
        votes["strategy_switching"] = {
            "vote":   direction,
            "score":  float(ss_score),
            "weight": self.AGENT_WEIGHTS["strategy_switching"],
        }

        # 8. Market Impact
        mi = outputs.get("market_impact", {})
        feasible = mi.get("feasible", True)
        votes["market_impact"] = {
            "vote":   direction if feasible else "wait",
            "score":  0.85 if feasible else 0.20,
            "weight": self.AGENT_WEIGHTS["market_impact"],
        }

        # 9. Capital Rotation
        cr = outputs.get("capital_rotation", {})
        cr_score = cr.get("rotation_alignment", 0.60)
        votes["capital_rotation"] = {
            "vote":   direction,
            "score":  float(cr_score),
            "weight": self.AGENT_WEIGHTS["capital_rotation"],
        }

        return votes

    # ── Score Pondéré ─────────────────────────────────────────
    def _compute_weighted_score(self, votes: Dict) -> Dict:
        """Calcule le score pondéré global du conseil."""
        direction = "buy"  # direction de référence
        total_weight = 0.0
        weighted_sum = 0.0
        buy_votes    = 0
        sell_votes   = 0
        wait_votes   = 0

        for agent, v in votes.items():
            w     = v.get("weight", 0.05)
            score = float(v.get("score", 0.5))
            vote  = v.get("vote", "neutral")
            weighted_sum  += score * w
            total_weight  += w
            if vote in ("buy", "sell"):
                if vote == "buy":
                    buy_votes += 1
                else:
                    sell_votes += 1
            else:
                wait_votes += 1

        final_score = weighted_sum / (total_weight + 1e-10)
        return {
            "score":      round(float(final_score), 4),
            "buy_votes":  buy_votes,
            "sell_votes": sell_votes,
            "wait_votes": wait_votes,
            "n_agents":   len(votes),
        }

    # ── Vétos Absolus ─────────────────────────────────────────
    def _check_vetos(self, outputs: Dict) -> tuple:
        """
        Vérifie les conditions de veto absolu.
        Aucun LLM ne peut outrepasser un veto.
        """
        # 1. Drawdown Guardian halt
        if outputs.get("drawdown_guardian", {}).get("halt_active"):
            return True, "🚨 VETO: DrawdownGuardian — limite de drawdown atteinte"

        # 2. Perte journalière maximale
        if outputs.get("drawdown_guardian", {}).get("hit_daily_limit"):
            return True, "🚨 VETO: Limite de perte journalière atteinte"

        # 3. Régime crash sans couverture options
        regime = outputs.get("regime", {})
        if regime.get("regime_label") == "crash" and \
           outputs.get("greeks_balancer", {}).get("convexity_exposure", 0) < 0.10:
            return True, "⚠ VETO: Régime crash sans couverture convexity suffisante"

        # 4. Self-eval critique
        self_eval = outputs.get("self_eval", {})
        if self_eval.get("system_health") == "critical":
            return True, "🚨 VETO: SelfEvaluationAgent — système en état critique"

        # 5. Feature drift sévère
        if outputs.get("feature_drift", {}).get("severe_drift"):
            return True, "⚠ VETO: Feature drift sévère — modèle non fiable"

        return False, ""

    # ── Comptage des Warnings ─────────────────────────────────
    def _count_warnings(self, outputs: Dict) -> int:
        """Compte le nombre d'agents en état d'avertissement."""
        warnings = 0
        if outputs.get("feature_drift",      {}).get("retrain_needed"):    warnings += 1
        if outputs.get("correlation_surface",{}).get("reduce_exposure"):   warnings += 1
        if outputs.get("market_impact",      {}).get("high_impact"):       warnings += 1
        if outputs.get("risk",               {}).get("is_over_leveraged"): warnings += 1
        if outputs.get("greeks_balancer",    {}).get("imbalanced"):        warnings += 1
        return warnings

    # ── Construction Résultat ─────────────────────────────────
    def _build_council_result(
        self,
        decision:    str,
        confidence:  float,
        size_mult:   float,
        reason:      str,
        mode:        str,
        agent_votes: Dict,
        weighted:    Dict = None,
    ) -> Dict:
        """Construit le dictionnaire de résultat standardisé."""
        import datetime
        return {
            "decision":         decision,
            "confidence":       round(float(confidence), 4),
            "size_multiplier":  round(float(np.clip(size_mult, 0.0, 2.0)), 2),
            "reason":           reason,
            "mode":             mode,
            "n_agents":         len(agent_votes),
            "agent_votes":      {k: v.get("vote", "?") for k, v in agent_votes.items()},
            "agent_scores":     {k: round(v.get("score", 0), 3) for k, v in agent_votes.items()},
            "weighted_score":   weighted.get("score", 0.0) if weighted else 0.0,
            "council_approved": decision in ("execute", "execute_strong"),
            "timestamp":        datetime.datetime.utcnow().isoformat() + "Z",
        }

    # ── Parse LLM Response ────────────────────────────────────
    def _parse_llm_response(self, text: str) -> Optional[Dict]:
        """Parse la réponse JSON du LLM avec plusieurs fallbacks."""
        import json, re
        try:
            return json.loads(text.strip())
        except Exception:
            pass
        try:
            match = re.search(r'\{[^}]+\}', text, re.DOTALL)
            if match:
                return json.loads(match.group())
        except Exception:
            pass

        # Extraction heuristique si JSON malformé
        result = {"decision": "wait", "confidence": 0.5, "reason": "parse_fallback", "size_mult": 1.0}
        if "execute" in text.lower():
            result["decision"] = "execute"
            result["confidence"] = 0.65
        elif "veto" in text.lower():
            result["decision"] = "veto"
            result["confidence"] = 0.90
        return result

    # ── Log ───────────────────────────────────────────────────
    def _log_decision(self, symbol: str, result: Dict):
        """Enregistre la décision dans l'historique interne."""
        self._decisions_log.append({
            "symbol":   symbol,
            "decision": result["decision"],
            "mode":     result["mode"],
        })
        if len(self._decisions_log) > 200:
            self._decisions_log.pop(0)
        logger.info(
            f"⚖  Council [{result['mode'].upper()}] | "
            f"{symbol} → {result['decision'].upper()} | "
            f"score={result.get('weighted_score', 0):.3f} | "
            f"size×{result['size_multiplier']}"
        )

    def _safe_default(self, symbol: str) -> Dict:
        return {
            "decision":        "wait",
            "confidence":      0.5,
            "size_multiplier": 0.0,
            "reason":          "council_error_safe_default",
            "mode":            "error",
            "council_approved": False,
            "agent_votes":     {},
            "weighted_score":  0.0,
        }

    def get_decisions_history(self) -> List[Dict]:
        return self._decisions_log.copy()