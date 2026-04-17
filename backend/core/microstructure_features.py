# ============================================================
# ALPHAVAULT QUANT — Microstructure Features (Proxy)
# Proxy signals de microstructure depuis données OHLCV/Volume
# (Sans accès direct au L2 order book)
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional
from loguru import logger

class MicrostructureFeatures:
    """
    Génère des proxy signals de microstructure de marché.
    
    Comme nous n'avons pas accès au L2 order book directement,
    nous utilisons des proxies statistiques robustes basés sur
    les données OHLCV et volume.
    """

    def __init__(self):
        logger.info("✅ MicrostructureFeatures initialisé")

    def build_all(
        self,
        df_daily:  pd.DataFrame,
        df_intra:  Optional[pd.DataFrame] = None,
    ) -> Dict[str, float]:
        """Construit toutes les features microstructure."""
        features = {}
        try:
            features.update(self._volume_imbalance(df_daily))
            features.update(self._intraday_liquidity_gaps(df_daily))
            features.update(self._vwap_pressure(df_daily))
            features.update(self._volume_spike_acceleration(df_daily))
            features.update(self._intraday_vol_clustering(df_daily, df_intra))
            features.update(self._execution_friction(df_daily))
        except Exception as e:
            logger.error(f"MicrostructureFeatures.build_all: {e}")
        return features

    # ── Volume Imbalance ──────────────────────────────────────
    def _volume_imbalance(self, df: pd.DataFrame) -> Dict:
        """
        Proxy d'imbalance via classification des bougies.
        Bougie haussière → volume attribué aux acheteurs.
        Bougie baissière → volume attribué aux vendeurs.
        """
        if df.empty or len(df) < 10:
            return {"vol_imbalance": 0.0}
        close = df["close"]
        prev  = df["close"].shift(1)
        vol   = df["volume"]
        delta_close = close - prev
        buy_vol  = vol.where(delta_close > 0, 0).fillna(0)
        sell_vol = vol.where(delta_close < 0, 0).fillna(0)

        # Rolling 5 jours
        buy_5d  = buy_vol.tail(5).sum()
        sell_5d = sell_vol.tail(5).sum()
        total   = buy_5d + sell_5d + 1e-10
        imbalance = (buy_5d - sell_5d) / total

        return {
            "vol_imbalance":       float(np.tanh(imbalance * 3)),
            "vol_imbalance_raw":   float(imbalance),
            "buy_pressure":        float(buy_5d / (total)),
        }

    # ── Intraday Liquidity Gaps ───────────────────────────────
    def _intraday_liquidity_gaps(self, df: pd.DataFrame) -> Dict:
        """
        Détecte les gaps de liquidité (zones de prix peu tradées).
        Proxy : écart high-low vs volume.
        """
        if df.empty or len(df) < 5:
            return {"liquidity_gap_score": 0.0}
        hl_range = (df["high"] - df["low"]) / (df["close"] + 1e-10)
        vol      = df["volume"]
        efficiency = vol / (hl_range * df["close"] + 1e-10)
        eff_pct  = efficiency.rank(pct=True).iloc[-1]
        gap_score = 1.0 - float(eff_pct)  # Faible efficience = potentiel de gap
        return {
            "liquidity_gap_score": float(np.tanh(gap_score * 2 - 1)),
            "price_efficiency":    float(eff_pct),
        }

    # ── VWAP Pressure ────────────────────────────────────────
    def _vwap_pressure(self, df: pd.DataFrame) -> Dict:
        """Pression autour du VWAP rolling."""
        if df.empty or len(df) < 20:
            return {}
        typical = (df["high"] + df["low"] + df["close"]) / 3
        vwap    = (typical * df["volume"]).rolling(20).sum() / \
                   df["volume"].rolling(20).sum()
        dev     = (df["close"] - vwap) / (vwap + 1e-10)
        dev_5d  = dev.tail(5).mean()

        return {
            "vwap_pressure_5d": float(np.tanh(dev_5d * 20)),
            "vwap_convergence": 1.0 if abs(dev.iloc[-1]) < abs(dev.iloc[-5]) else -1.0,
        }

    # ── Volume Spike Acceleration ─────────────────────────────
    def _volume_spike_acceleration(self, df: pd.DataFrame) -> Dict:
        """Détecte l'accélération des pics de volume (distribution/accumulation)."""
        if df.empty or len(df) < 20:
            return {}
        vol = df["volume"]
        vol_ma20    = vol.rolling(20).mean()
        vol_ratio   = vol / (vol_ma20 + 1e-10)

        # Accélération : est-ce que le ratio augmente ?
        ratio_change = vol_ratio.diff()
        accel_score  = ratio_change.tail(5).mean()

        high_vol_days = (vol_ratio.tail(10) > 1.5).sum()

        return {
            "vol_spike_accel":    float(np.tanh(float(accel_score))),
            "high_vol_days_10d":  float(high_vol_days / 10),
            "current_vol_ratio":  float(np.tanh(float(vol_ratio.iloc[-1]) - 1)),
        }

    # ── Intraday Volatility Clustering ────────────────────────
    def _intraday_vol_clustering(
        self,
        df_daily: pd.DataFrame,
        df_intra: Optional[pd.DataFrame],
    ) -> Dict:
        """Clustering de volatilité intraday (utilise daily si intraday absent)."""
        if df_intra is not None and len(df_intra) >= 12:
            log_ret = np.log(df_intra["close"] / df_intra["close"].shift(1)).dropna()
            abs_ret = log_ret.abs()
            # Autocorrélation des rendements absolus (mesure du clustering)
            if len(abs_ret) >= 4:
                autocorr = float(abs_ret.autocorr(lag=1))
                return {
                    "vol_clustering_intra": float(np.tanh(autocorr * 2)),
                    "intra_vol_regime":     1.0 if autocorr > 0.3 else 0.0,
                }

        # Fallback sur daily
        log_ret = np.log(df_daily["close"] / df_daily["close"].shift(1)).dropna()
        if len(log_ret) < 5:
            return {}
        abs_ret  = log_ret.abs()
        autocorr = float(abs_ret.tail(30).autocorr(lag=1)) if len(abs_ret) >= 30 else 0.0
        return {
            "vol_clustering_daily": float(np.tanh(autocorr * 2)),
            "intra_vol_regime":     1.0 if autocorr > 0.3 else 0.0,
        }

    # ── Execution Friction Estimator ─────────────────────────
    def _execution_friction(self, df: pd.DataFrame) -> Dict:
        """
        Estime le coût de friction d'exécution via le spread bid-ask proxy.
        Proxy : (High - Low) / Close → approximation du spread journalier.
        """
        if df.empty or len(df) < 5:
            return {}
        spread_proxy = (df["high"] - df["low"]) / df["close"]
        avg_spread   = float(spread_proxy.tail(5).mean())
        vol_impact   = float(df["volume"].tail(5).mean())

        # Coût estimé en bps
        friction_bps = avg_spread * 10000 * 0.3  # 30% du range = approx spread
        return {
            "friction_bps":      float(np.tanh(friction_bps / 50)),
            "execution_quality": 1.0 - float(np.tanh(friction_bps / 100)),
        }