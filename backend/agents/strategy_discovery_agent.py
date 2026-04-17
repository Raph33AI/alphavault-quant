# ============================================================
# AGENT 1 — Strategy Discovery Agent
# ✅ MODE 1 : LLM génère des hypothèses de stratégies nouvelles
# ✅ MODE 2 : Scan déterministe de patterns statistiques
# Recherche en continu de nouvelles opportunités alpha
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from loguru import logger
from scipy import stats
from itertools import combinations

class StrategyDiscoveryAgent:
    """
    Découvre automatiquement de nouvelles stratégies alpha.

    MODE LLM    : Soumet les features au LLM pour générer des hypothèses
                  de stratégies que le système n'utilise pas encore.
    MODE FALLBACK: Scan statistique de patterns (momentum cross, vol pairs,
                   mean-reversion spreads, seasonal patterns).
    """

    SYSTEM_PROMPT = """You are a quantitative strategy researcher at a prop trading firm.
    Analyze the provided market features and regime data, then suggest 2-3 specific,
    implementable trading strategy hypotheses. Each hypothesis must include:
    1. Strategy name
    2. Entry conditions (specific thresholds)
    3. Expected alpha source
    4. Risk parameters
    Return as JSON array."""

    def __init__(self, worker_client, settings):
        self.client   = worker_client
        self.settings = settings
        self._discovered: List[Dict] = []
        self._tested:     List[str]  = []
        logger.info("✅ StrategyDiscoveryAgent initialisé")

    def discover(
        self,
        features_snapshot: Dict[str, Dict],
        regime_result:     Dict,
        current_strategies: List[str],
    ) -> Dict:
        """
        Point d'entrée principal de l'agent.
        Retourne des nouvelles stratégies à évaluer.
        """
        if self.client.llm_available:
            return self._llm_discover(
                features_snapshot, regime_result, current_strategies
            )
        return self._deterministic_discover(
            features_snapshot, regime_result
        )

    # ── MODE LLM ────────────────────────────────────────────
    def _llm_discover(
        self,
        features:  Dict[str, Dict],
        regime:    Dict,
        existing:  List[str],
    ) -> Dict:
        """Utilise le LLM pour générer des hypothèses de stratégies."""
        try:
            # Résumé compact des features pour le prompt
            top_symbols = list(features.keys())[:5]
            feat_summary = {
                sym: {
                    k: round(float(v), 3)
                    for k, v in features[sym].items()
                    if k in ["momentum_20d", "rsi_norm", "hurst_exponent",
                             "vol_regime_score", "macd_hist", "bb_position"]
                }
                for sym in top_symbols if sym in features
            }

            prompt = (
                f"Market regime: {regime.get('regime_label')} "
                f"(confidence {regime.get('confidence', 0):.1%})\n"
                f"Feature snapshot: {feat_summary}\n"
                f"Current strategies: {existing}\n"
                f"Suggest 2-3 NEW strategy hypotheses not in current list."
            )

            response = self.client.call_llm(
                prompt  = prompt,
                system  = self.SYSTEM_PROMPT,
                max_tokens = 1024,
            )

            if response:
                strategies = self._parse_llm_strategies(response)
                self._discovered.extend(strategies)
                return {
                    "source":     "llm",
                    "strategies": strategies,
                    "count":      len(strategies),
                }
        except Exception as e:
            logger.error(f"StrategyDiscovery LLM: {e}")

        return self._deterministic_discover(features, regime)

    # ── MODE FALLBACK DÉTERMINISTE ───────────────────────────
    def _deterministic_discover(
        self,
        features: Dict[str, Dict],
        regime:   Dict,
    ) -> Dict:
        """
        Scan statistique : détecte les patterns d'alpha non exploités.
        """
        discoveries = []
        symbols     = list(features.keys())

        # ── 1. Momentum Cross (EMA curvature divergence) ──
        for sym in symbols:
            f = features.get(sym, {})
            ema8_slope  = f.get("ema_8_slope",  0)
            ema50_slope = f.get("ema_50_slope", 0)
            if abs(ema8_slope - ema50_slope) > 0.3 and f.get("volume_regime", 0) > 0.5:
                discoveries.append({
                    "name":        f"EMA_Cross_Divergence_{sym}",
                    "type":        "trend_acceleration",
                    "symbol":      sym,
                    "confidence":  0.62,
                    "entry_signal": "ema8_ema50_cross",
                    "alpha_source": "momentum_acceleration",
                    "risk_score":  0.45,
                })

        # ── 2. RSI Divergence Mean Reversion ──────────────
        for sym in symbols:
            f = features.get(sym, {})
            rsi_div = f.get("rsi_divergence", 0)
            bb_pos  = f.get("bb_position", 0)
            if abs(rsi_div) > 0.5 and abs(bb_pos) > 0.7:
                direction = "long" if rsi_div > 0 else "short"
                discoveries.append({
                    "name":        f"RSI_Divergence_MR_{sym}",
                    "type":        "mean_reversion",
                    "symbol":      sym,
                    "confidence":  0.58,
                    "entry_signal": f"rsi_divergence_{direction}",
                    "alpha_source": "mean_reversion_signal",
                    "risk_score":  0.40,
                })

        # ── 3. Vol Compression Breakout Setup ─────────────
        for sym in symbols:
            f = features.get(sym, {})
            if (f.get("bb_squeeze", 0) > 0.5 and
                f.get("hurst_exponent", 0.5) > 0.60 and
                f.get("atr_pct_rank", 0.5) < 0.30):
                discoveries.append({
                    "name":        f"VolCompression_Breakout_{sym}",
                    "type":        "volatility_breakout",
                    "symbol":      sym,
                    "confidence":  0.65,
                    "entry_signal": "bb_squeeze_with_hurst",
                    "alpha_source": "vol_compression_expansion",
                    "risk_score":  0.50,
                })

        # ── 4. Cross-Asset Momentum Pairs ─────────────────
        if len(symbols) >= 2:
            for s1, s2 in list(combinations(symbols[:6], 2)):
                f1 = features.get(s1, {})
                f2 = features.get(s2, {})
                m1 = f1.get("momentum_20d", 0)
                m2 = f2.get("momentum_20d", 0)
                # Forte divergence de momentum → spread trade
                if abs(m1 - m2) > 0.15:
                    long_sym  = s1 if m1 > m2 else s2
                    short_sym = s2 if m1 > m2 else s1
                    discoveries.append({
                        "name":        f"Pairs_Momentum_{long_sym}_{short_sym}",
                        "type":        "pairs_momentum",
                        "symbols":     [long_sym, short_sym],
                        "confidence":  0.55,
                        "entry_signal": "momentum_spread",
                        "alpha_source": "relative_momentum",
                        "risk_score":  0.40,
                    })

        # Filtre : garde les plus confiants
        discoveries = sorted(discoveries, key=lambda x: x["confidence"], reverse=True)[:5]
        new_ones    = [d for d in discoveries if d["name"] not in self._tested]

        return {
            "source":     "deterministic",
            "strategies": new_ones[:3],
            "count":      len(new_ones),
        }

    def _parse_llm_strategies(self, response: str) -> List[Dict]:
        """Parse la réponse JSON du LLM."""
        import json, re
        try:
            match = re.search(r'\[.*?\]', response, re.DOTALL)
            if match:
                return json.loads(match.group())
        except Exception:
            pass
        return []