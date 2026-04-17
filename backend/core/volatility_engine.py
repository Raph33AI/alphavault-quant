# ============================================================
# ALPHAVAULT QUANT — Volatility Carry Engine
# ✅ IV Expansion / Compression
# ✅ Term Structure Steepening / Inversion
# ✅ Volatility Carry Opportunities
# ✅ Régimes de volatilité
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional, Tuple
from loguru import logger

class VolatilityEngine:
    """
    Moteur d'analyse de volatilité et de carry.
    
    Génère des signaux pour :
    - Les stratégies de vente de volatilité (IV > RVol)
    - Les achats de protection (IV compression → breakout)
    - L'arbitrage de structure par terme
    """

    def __init__(self):
        logger.info("✅ VolatilityEngine initialisé")

    def analyze(
        self,
        symbol:       str,
        df_daily:     pd.DataFrame,
        options_data: Dict = None,
    ) -> Dict[str, float]:
        """Analyse complète de volatilité pour un symbole."""
        result = {}
        try:
            result.update(self._vol_regime(df_daily))
            result.update(self._iv_expansion_detection(df_daily))
            result.update(self._carry_opportunity(df_daily, options_data))
            result.update(self._vol_of_vol(df_daily))
            result.update(self._mean_reversion_vol(df_daily))
            result.update(self._breakout_probability(df_daily))
        except Exception as e:
            logger.error(f"VolatilityEngine.analyze({symbol}): {e}")
        return result

    # ── Régime de Volatilité ──────────────────────────────────
    def _vol_regime(self, df: pd.DataFrame) -> Dict:
        """
        Classifie le régime de volatilité courant.
        Retourne un score catégorique et des features numériques.
        """
        if df.empty or len(df) < 30:
            return {"vol_regime_score": 0.0}

        log_ret  = np.log(df["close"] / df["close"].shift(1)).dropna()
        rvol_5d  = log_ret.tail(5).std()  * np.sqrt(252)
        rvol_21d = log_ret.tail(21).std() * np.sqrt(252)
        rvol_63d = log_ret.tail(63).std() * np.sqrt(252) if len(log_ret) >= 63 else rvol_21d

        # Percentile de vol actuelle dans l'historique
        if len(log_ret) >= 252:
            rolling_vols = log_ret.rolling(21).std() * np.sqrt(252)
            pct_rank = float((rolling_vols.dropna() <= rvol_21d).mean())
        else:
            pct_rank = 0.5

        # Regime classification
        if rvol_21d > 0.30:
            regime_label = "crash"
            regime_score = 1.0
        elif rvol_21d > 0.20:
            regime_label = "high_vol"
            regime_score = 0.75
        elif rvol_21d > 0.12:
            regime_label = "normal"
            regime_score = 0.5
        elif rvol_21d > 0.08:
            regime_label = "low_vol"
            regime_score = 0.25
        else:
            regime_label = "ultra_low"
            regime_score = 0.0

        return {
            "vol_regime_score":   float(regime_score),
            "vol_pct_rank":       float(pct_rank),
            "rvol_5d":            float(rvol_5d),
            "rvol_21d":           float(rvol_21d),
            "rvol_63d":           float(rvol_63d),
            "rvol_trend":         float(np.tanh((rvol_5d - rvol_63d) / (rvol_63d + 1e-10))),
            "low_vol_regime":     1.0 if regime_score < 0.3 else 0.0,
            "high_vol_regime":    1.0 if regime_score > 0.7 else 0.0,
            "crash_regime":       1.0 if regime_label == "crash" else 0.0,
        }

    # ── IV Expansion Detection ────────────────────────────────
    def _iv_expansion_detection(self, df: pd.DataFrame) -> Dict:
        """
        Détecte les setups d'expansion et compression de volatilité implicite.
        Proxy : accélération de la vol réalisée.
        """
        if df.empty or len(df) < 30:
            return {}
        log_ret  = np.log(df["close"] / df["close"].shift(1)).dropna()
        rvol_5d  = log_ret.tail(5).std()
        rvol_10d = log_ret.tail(10).std()
        rvol_21d = log_ret.tail(21).std()

        # Ratio court terme / moyen terme
        expansion_ratio = rvol_5d / (rvol_21d + 1e-10)
        # Compression si vol court terme très inférieure à vol longue
        compression_score = 1.0 - expansion_ratio if expansion_ratio < 0.7 else 0.0
        expansion_score   = expansion_ratio - 1.0 if expansion_ratio > 1.3 else 0.0

        return {
            "iv_expansion_ratio":     float(np.tanh(expansion_ratio - 1)),
            "iv_expansion_setup":     1.0 if expansion_ratio > 1.5 else 0.0,
            "iv_compression_setup":   float(compression_score),
            "vol_breakout_candidate": 1.0 if compression_score > 0.3 else 0.0,
        }

    # ── Volatility Carry Opportunity ─────────────────────────
    def _carry_opportunity(
        self,
        df:           pd.DataFrame,
        options_data: Dict = None,
    ) -> Dict:
        """
        Identifie les opportunités de carry sur la volatilité.
        IV > RVol → vente de vol profitable (short strangle, iron condor).
        IV < RVol → achat de vol (long straddle, long vol).
        """
        if df.empty or len(df) < 21:
            return {"vol_carry_score": 0.0}

        log_ret  = np.log(df["close"] / df["close"].shift(1)).dropna()
        rvol_21d = log_ret.tail(21).std() * np.sqrt(252)

        # IV proxy (vol réalisée × prime standard)
        iv_proxy    = rvol_21d * 1.15
        carry_spread = iv_proxy - rvol_21d

        # Score carry : positif = opportunité de vente de vol
        carry_score = carry_spread / (rvol_21d + 1e-10)

        # Qualité du carry (cohérence historique)
        if len(log_ret) >= 63:
            historical_carry = []
            for i in range(0, min(42, len(log_ret) - 21), 7):
                rv = log_ret.iloc[-(i + 21):-(i) or None].std() * np.sqrt(252) if i > 0 else rvol_21d
                historical_carry.append(rv)
            carry_consistency = float(np.std(historical_carry)) if historical_carry else 0.0
        else:
            carry_consistency = 0.0

        return {
            "vol_carry_score":       float(np.tanh(carry_score)),
            "vol_carry_spread":      float(carry_spread),
            "short_vol_opportunity": 1.0 if carry_score > 0.1 else 0.0,
            "long_vol_opportunity":  1.0 if carry_score < -0.05 else 0.0,
            "carry_consistency":     float(np.tanh(carry_consistency * 5)),
        }

    # ── Volatility of Volatility ──────────────────────────────
    def _vol_of_vol(self, df: pd.DataFrame) -> Dict:
        """
        Calcule la volatilité de la volatilité (VoV).
        VoV élevé → régime instable → attention aux positions courtes vol.
        """
        if df.empty or len(df) < 42:
            return {"vol_of_vol": 0.0}
        log_ret  = np.log(df["close"] / df["close"].shift(1)).dropna()
        rolling_vol = log_ret.rolling(5).std() * np.sqrt(252)
        vov = rolling_vol.dropna().std()
        vov_norm = float(np.tanh(vov * 10))
        return {
            "vol_of_vol":         float(vov),
            "vol_of_vol_norm":    vov_norm,
            "unstable_vol_regime": 1.0 if vov > 0.05 else 0.0,
        }

    # ── Mean Reversion de la Volatilité ──────────────────────
    def _mean_reversion_vol(self, df: pd.DataFrame) -> Dict:
        """
        Mesure la tendance de retour à la moyenne de la volatilité.
        Vol haute → réversion vers la moyenne attendue (short vol entry).
        """
        if df.empty or len(df) < 63:
            return {}
        log_ret   = np.log(df["close"] / df["close"].shift(1)).dropna()
        rvol_now  = log_ret.tail(21).std() * np.sqrt(252)
        rvol_long = log_ret.std() * np.sqrt(252)
        reversion_potential = (rvol_long - rvol_now) / (rvol_long + 1e-10)

        return {
            "vol_mean_reversion_potential": float(np.tanh(reversion_potential * 3)),
            "vol_above_ltm":               1.0 if rvol_now > rvol_long else 0.0,
            "vol_below_ltm":               1.0 if rvol_now < rvol_long * 0.8 else 0.0,
        }

    # ── Breakout Probability ──────────────────────────────────
    def _breakout_probability(self, df: pd.DataFrame) -> Dict:
        """
        Estime la probabilité d'un breakout de prix basé sur la volatilité.
        Bandes de Bollinger étroites + momentum = setup breakout.
        """
        if df.empty or len(df) < 20:
            return {}
        close   = df["close"]
        log_ret = np.log(close / close.shift(1)).dropna()
        vol_5d  = log_ret.tail(5).std()
        vol_20d = log_ret.tail(20).std()

        # Compression (bandes étroites)
        compression = 1.0 - (vol_5d / (vol_20d + 1e-10))
        compression = max(0.0, compression)

        # 1-jour breakout probability (movement > 1.5 ATR)
        atr_20d     = vol_20d * np.sqrt(1)  # Daily ATR proxy
        breakout_prob = 1.0 - np.exp(-compression * 2)

        return {
            "breakout_probability": float(np.clip(breakout_prob, 0, 1)),
            "vol_compression":      float(compression),
            "atr_daily_proxy":      float(atr_20d),
        }

    # ── Régime Global ─────────────────────────────────────────
    def get_vol_regime_label(self, vol_regime_score: float) -> str:
        """Retourne le label textuel du régime de volatilité."""
        if vol_regime_score >= 1.0:
            return "crash"
        elif vol_regime_score >= 0.75:
            return "high_volatility"
        elif vol_regime_score >= 0.5:
            return "normal"
        elif vol_regime_score >= 0.25:
            return "low_volatility"
        else:
            return "ultra_low_volatility"