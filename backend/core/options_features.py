# ============================================================
# ALPHAVAULT QUANT — Options Analytics Engine
# ✅ IV Rank / Percentile
# ✅ Skew & Term Structure
# ✅ Gamma Exposure Proxy
# ✅ Max Pain / Gamma Flip
# ✅ Dealer Positioning Proxy
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional, List
from loguru import logger
import math

class OptionsFeatures:
    """
    Moteur d'analyse options sans accès direct à un options feed.
    Utilise les données disponibles (IV implicite via FinnHub) et
    des proxies statistiques robustes pour le positionnement dealer.
    """

    def __init__(self, worker_client):
        self.client = worker_client
        logger.info("✅ OptionsFeatures initialisé")

    def build_all(
        self,
        symbol:      str,
        current_price: float,
        df_daily:    pd.DataFrame,
    ) -> Dict[str, float]:
        """Construit toutes les features options."""
        features = {}
        try:
            # IV estimée via la volatilité historique (proxy)
            iv_data = self._estimate_iv_metrics(df_daily, current_price)
            features.update(iv_data)

            # Skew proxy (depuis les rendements)
            features.update(self._compute_skew_proxy(df_daily))

            # Term Structure proxy
            features.update(self._term_structure_proxy(df_daily))

            # Gamma Exposure Proxy (MEX/DIX style)
            features.update(self._gamma_exposure_proxy(df_daily, current_price))

            # Sentiment options (Put/Call ratio proxy)
            features.update(self._put_call_ratio_proxy(df_daily))

            # Max Pain Proxy
            features["max_pain_proxy"] = self._estimate_max_pain_proxy(
                current_price, df_daily
            )

        except Exception as e:
            logger.error(f"OptionsFeatures.build_all({symbol}): {e}")
        return features

    # ── IV Rank & Percentile ──────────────────────────────────
    def _estimate_iv_metrics(
        self,
        df: pd.DataFrame,
        current_price: float,
    ) -> Dict:
        """
        Estime la volatilité implicite depuis la vol historique.
        IV ≈ vol réalisée × facteur de prime (1.1 à 1.4 selon régime).
        """
        if df.empty or len(df) < 30:
            return {"iv_rank": 0.5, "iv_percentile": 50.0}

        log_ret  = np.log(df["close"] / df["close"].shift(1)).dropna()
        rvol_30d = log_ret.tail(30).std() * np.sqrt(252)
        rvol_252 = log_ret.std() * np.sqrt(252) if len(log_ret) >= 252 else rvol_30d

        # Estimation IV (prime standard de 15% sur la vol réalisée)
        iv_proxy = rvol_30d * 1.15

        # IV de chaque jour des 252 derniers (proxy via vol rolling 30j)
        rolling_vol = log_ret.rolling(30).std() * np.sqrt(252) * 1.15
        rolling_vol = rolling_vol.dropna()

        if len(rolling_vol) < 2:
            return {"iv_rank": 0.5, "iv_percentile": 50.0, "iv_proxy": float(iv_proxy)}

        iv_high = rolling_vol.max()
        iv_low  = rolling_vol.min()
        iv_rank = (iv_proxy - iv_low) / (iv_high - iv_low + 1e-10)
        iv_pct  = float(rolling_vol[rolling_vol <= iv_proxy].count() / len(rolling_vol) * 100)

        # IV vs RVol Spread (vol risk premium)
        iv_rvol_spread = iv_proxy - rvol_252
        return {
            "iv_proxy":       float(iv_proxy),
            "iv_rank":        float(np.clip(iv_rank, 0, 1)),
            "iv_percentile":  float(iv_pct),
            "iv_vs_rvol":     float(np.tanh(iv_rvol_spread * 5)),
            "vol_risk_premium": float(iv_rvol_spread > 0),
        }

    # ── Skew Slope Proxy ──────────────────────────────────────
    def _compute_skew_proxy(self, df: pd.DataFrame) -> Dict:
        """
        Proxy du skew implicite via l'asymétrie des rendements.
        Skew négatif des rendements → prime put élevée (risk-off).
        """
        if df.empty or len(df) < 21:
            return {"skew_slope": 0.0}
        from scipy import stats as sci_stats
        log_ret = np.log(df["close"] / df["close"].shift(1)).dropna()
        skew_30  = float(sci_stats.skew(log_ret.tail(30)))
        skew_90  = float(sci_stats.skew(log_ret.tail(90))) if len(log_ret) >= 90 else skew_30

        # Skew négatif = protection put demandée = bearish sentiment
        return {
            "skew_slope":     float(np.tanh(-skew_30)),  # inversé : skew négatif = signal baissier
            "skew_30d":       float(skew_30),
            "skew_90d":       float(skew_90),
            "skew_expanding": 1.0 if abs(skew_30) > abs(skew_90) else -1.0,
        }

    # ── Term Structure Proxy ──────────────────────────────────
    def _term_structure_proxy(self, df: pd.DataFrame) -> Dict:
        """
        Proxy de la structure par terme de volatilité.
        Utilise la volatilité réalisée à différentes maturités.
        Vol courte > Vol longue → contango inverse (bearish).
        """
        if df.empty or len(df) < 63:
            return {"term_structure_slope": 0.0}
        log_ret  = np.log(df["close"] / df["close"].shift(1)).dropna()
        vol_7d   = log_ret.tail(7).std()  * np.sqrt(252)
        vol_30d  = log_ret.tail(30).std() * np.sqrt(252)
        vol_63d  = log_ret.tail(63).std() * np.sqrt(252)

        # Slope : vol court terme vs long terme
        slope = (vol_7d - vol_63d) / (vol_63d + 1e-10)
        inversion = 1.0 if vol_7d > vol_30d > vol_63d else 0.0
        steepening = 1.0 if vol_63d > vol_30d > vol_7d else 0.0

        return {
            "term_structure_slope":     float(np.tanh(slope * 3)),
            "term_structure_inverted":  inversion,
            "term_structure_steepening": steepening,
            "vol_7d":  float(vol_7d),
            "vol_30d": float(vol_30d),
            "vol_63d": float(vol_63d),
        }

    # ── Gamma Exposure Proxy ──────────────────────────────────
    def _gamma_exposure_proxy(
        self,
        df:            pd.DataFrame,
        current_price: float,
    ) -> Dict:
        """
        Proxy du gamma exposure dealer.
        Basé sur la distance au support/résistance clé (strike clusters).
        
        Concept : les dealers sont courts gamma near-the-money → amplification.
        Dealers longs gamma far OTM → suppression de la volatilité.
        """
        if df.empty or len(df) < 20:
            return {"gamma_flip_proxy": 0.0}

        # Niveaux clés (approximation des strikes importants)
        # Utilise les max/min rolling comme proxy des open interest clusters
        high_20 = df["high"].tail(20).max()
        low_20  = df["low"].tail(20).min()
        mid_20  = (high_20 + low_20) / 2

        # Distance au "gamma flip" proxy (mid-range)
        dist_from_mid = (current_price - mid_20) / mid_20
        range_20 = (high_20 - low_20) / current_price

        # Gamma exposure normalisé
        # Prix proche des extrêmes → gamma exposure élevé → vol amplifiée
        pct_in_range = (current_price - low_20) / (high_20 - low_20 + 1e-10)
        gamma_zone = abs(pct_in_range - 0.5) * 2  # 0=middle (neutral), 1=extremes

        return {
            "gamma_flip_proxy":    float(np.tanh(dist_from_mid * 10)),
            "gamma_exposure_zone": float(gamma_zone),
            "near_resistance":     1.0 if pct_in_range > 0.85 else 0.0,
            "near_support":        1.0 if pct_in_range < 0.15 else 0.0,
        }

    # ── Put/Call Ratio Proxy ──────────────────────────────────
    def _put_call_ratio_proxy(self, df: pd.DataFrame) -> Dict:
        """
        Proxy du Put/Call ratio via l'asymétrie volume/momentum.
        Volume élevé + baisse → put hedging.
        """
        if df.empty or len(df) < 5:
            return {"pcr_proxy": 0.0}

        vol   = df["volume"]
        close = df["close"]
        delta = close.diff()

        down_vol = vol.where(delta < 0, 0).fillna(0).tail(5).sum()
        up_vol   = vol.where(delta > 0, 0).fillna(0).tail(5).sum()
        total_vol = down_vol + up_vol + 1e-10

        # PCR proxy : > 1 = bearish hedging, < 1 = bullish
        pcr_proxy = down_vol / (up_vol + 1e-10)
        pcr_norm  = (pcr_proxy - 1) / (pcr_proxy + 1)  # normalise dans (-1, 1)

        return {
            "pcr_proxy":     float(np.tanh(pcr_norm)),
            "put_hedging":   1.0 if pcr_proxy > 1.3 else 0.0,
            "call_demand":   1.0 if pcr_proxy < 0.7 else 0.0,
        }

    # ── Max Pain Proxy ────────────────────────────────────────
    def _estimate_max_pain_proxy(
        self,
        current_price: float,
        df: pd.DataFrame,
    ) -> float:
        """
        Proxy du Max Pain via le VWAP long terme.
        Théorie : les prix gravitent vers les zones où le plus
        d'options expirent sans valeur.
        """
        if df.empty or len(df) < 20:
            return 0.0
        typical = (df["high"] + df["low"] + df["close"]) / 3
        vwap_long = (typical * df["volume"]).tail(60).sum() / \
                     df["volume"].tail(60).sum()
        dist = (current_price - float(vwap_long)) / float(vwap_long)
        # Distance du max pain proxy (négatif = sous max pain = support)
        return float(np.tanh(-dist * 10))