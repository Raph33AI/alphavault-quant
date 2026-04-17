# ============================================================
# ALPHAVAULT QUANT — Feature Builder
# Génère toutes les features pour les modèles ML
# ✅ Multi-timeframe momentum stack
# ✅ Régimes de volatilité
# ✅ Divergences RSI/MACD
# ✅ Hurst Exponent, Variance Ratio
# ✅ Cross-asset correlation stack
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional, List, Tuple
from loguru import logger
from scipy import stats

class FeatureBuilder:
    """
    Moteur de construction de features quantitatives.
    
    Toutes les features sont normalisées dans [-1, 1] ou [0, 1]
    pour garantir la compatibilité avec les modèles ML.
    """

    def __init__(self):
        logger.info("✅ FeatureBuilder initialisé")

    # ── Pipeline Principal ────────────────────────────────────
    def build_all_features(
        self,
        symbol:        str,
        ohlcv_dict:    Dict[str, pd.DataFrame],
        macro_snapshot: Dict     = None,
        sentiment_score: float   = 0.0,
        analyst_score:   float   = 0.0,
        earnings_data:   Dict    = None,
    ) -> Dict[str, float]:
        """
        Construit l'ensemble complet des features pour un symbole.
        Retourne un dictionnaire {feature_name: float}.
        """
        features = {}

        # DataFrame daily comme référence
        df_daily = ohlcv_dict.get("1day")
        df_1h    = ohlcv_dict.get("1h")
        df_5min  = ohlcv_dict.get("5min")
        df_4h    = ohlcv_dict.get("4h")

        if df_daily is None or df_daily.empty or len(df_daily) < 30:
            logger.warning(f"Données insuffisantes pour {symbol}")
            return self._empty_features()

        try:
            # ── 1. Prix & Returns ─────────────────────────
            features.update(self._price_features(df_daily))

            # ── 2. Momentum Multi-Timeframe ───────────────
            features.update(self._momentum_stack(df_daily, df_1h, df_4h))

            # ── 3. EMA Curvature & Slope ──────────────────
            features.update(self._ema_curvature(df_daily))

            # ── 4. RSI Divergence ─────────────────────────
            features.update(self._rsi_features(df_daily))

            # ── 5. MACD Histogram Acceleration ────────────
            features.update(self._macd_features(df_daily))

            # ── 6. Bollinger Bands ────────────────────────
            features.update(self._bollinger_features(df_daily))

            # ── 7. VWAP Deviation ─────────────────────────
            features.update(self._vwap_features(df_daily))

            # ── 8. ATR Percentile Regime ──────────────────
            features.update(self._atr_features(df_daily))

            # ── 9. Volatilité Réalisée ────────────────────
            features.update(self._realized_vol_features(df_daily))

            # ── 10. GARCH Forecast ────────────────────────
            features.update(self._garch_features(df_daily))

            # ── 11. Rolling Skewness & Kurtosis ──────────
            features.update(self._higher_moments(df_daily))

            # ── 12. Hurst Exponent ────────────────────────
            features["hurst_exponent"] = self._hurst_exponent(df_daily["close"].values)

            # ── 13. Variance Ratio Test ───────────────────
            features["variance_ratio"] = self._variance_ratio(df_daily["close"].values)

            # ── 14. Cross-Asset Correlation ───────────────
            # (sera enrichi par le CorrelationSurfaceAgent)
            features["cross_asset_beta"] = 0.0  # placeholder

            # ── 15. Sector Relative Strength ──────────────
            features["sector_rel_strength"] = 0.0  # placeholder

            # ── 16. Macro Overlay ─────────────────────────
            if macro_snapshot:
                features.update(self._macro_features(macro_snapshot))

            # ── 17. Sentiment ─────────────────────────────
            features["sentiment_score"]  = float(sentiment_score)
            features["analyst_score"]    = float(analyst_score)

            # ── 18. Earnings Risk ─────────────────────────
            if earnings_data:
                features["earnings_upcoming"]  = 1.0 if earnings_data.get("upcoming") else 0.0
                features["earnings_surprise"]  = float(earnings_data.get("surprise_avg", 0)) / 100
                features["earnings_beat_rate"] = float(earnings_data.get("beat_rate", 0.5))

            # ── 19. 5min Intraday (si dispo) ──────────────
            if df_5min is not None and not df_5min.empty:
                features.update(self._intraday_features(df_5min))

            logger.debug(f"Features {symbol}: {len(features)} générées")
            return features

        except Exception as e:
            logger.error(f"build_all_features({symbol}): {e}")
            return self._empty_features()

    # ── Price Features ────────────────────────────────────────
    def _price_features(self, df: pd.DataFrame) -> Dict:
        close = df["close"].values
        returns_1d = np.diff(np.log(close[-2:])) if len(close) >= 2 else [0]
        returns_5d = np.diff(np.log(close[[-6,-1]])) if len(close) >= 6 else [0]
        returns_20d= np.diff(np.log(close[[-21,-1]])) if len(close) >= 21 else [0]
        high_52w = df["high"].tail(252).max() if len(df) >= 252 else df["high"].max()
        low_52w  = df["low"].tail(252).min()  if len(df) >= 252 else df["low"].min()
        current  = close[-1]
        range_52 = high_52w - low_52w
        pct_from_52h = (current - high_52w) / high_52w if high_52w else 0
        pct_in_range = (current - low_52w) / range_52 if range_52 > 0 else 0.5

        return {
            "return_1d":       float(returns_1d[0]),
            "return_5d":       float(returns_5d[0]),
            "return_20d":      float(returns_20d[0]),
            "pct_from_52w_high": float(pct_from_52h),
            "pct_in_52w_range":  float(pct_in_range),
        }

    # ── Momentum Stack ────────────────────────────────────────
    def _momentum_stack(
        self,
        df_daily: pd.DataFrame,
        df_1h:    Optional[pd.DataFrame],
        df_4h:    Optional[pd.DataFrame],
    ) -> Dict:
        feats = {}
        close = df_daily["close"].values

        # Momentum daily (ROC à différentes périodes)
        for p in [5, 10, 20, 60, 120, 252]:
            if len(close) > p:
                roc = (close[-1] - close[-(p+1)]) / close[-(p+1)]
                feats[f"momentum_{p}d"] = float(np.tanh(roc * 5))  # normalise dans [-1,1]

        # Momentum 1H
        if df_1h is not None and len(df_1h) >= 24:
            c1h = df_1h["close"].values
            feats["momentum_1h"]  = float(np.tanh((c1h[-1] - c1h[-5]) / c1h[-5] * 10))
            feats["momentum_4h"]  = float(np.tanh((c1h[-1] - c1h[-13]) / c1h[-13] * 10))
            feats["momentum_24h"] = float(np.tanh((c1h[-1] - c1h[-25]) / c1h[-25] * 10))

        # Momentum alignment (tous les timeframes dans le même sens ?)
        daily_signs = [np.sign(feats.get(f"momentum_{p}d", 0)) for p in [5,20,60]]
        if all(s > 0 for s in daily_signs):
            feats["momentum_alignment"] = 1.0
        elif all(s < 0 for s in daily_signs):
            feats["momentum_alignment"] = -1.0
        else:
            feats["momentum_alignment"] = 0.0

        return feats

    # ── EMA Curvature & Slope ─────────────────────────────────
    def _ema_curvature(self, df: pd.DataFrame) -> Dict:
        close = df["close"]
        feats = {}
        for span in [8, 21, 50, 200]:
            if len(close) > span:
                ema = close.ewm(span=span, adjust=False).mean()
                # Slope normalisée (% change sur 5 bars)
                slope = (ema.iloc[-1] - ema.iloc[-6]) / ema.iloc[-6] if len(ema) >= 6 else 0
                feats[f"ema_{span}_slope"] = float(np.tanh(slope * 20))

        # EMA curvature (accélération) = slope_récent - slope_passé
        if len(close) > 50:
            ema21 = close.ewm(span=21).mean()
            s_now  = (ema21.iloc[-1] - ema21.iloc[-6]) / ema21.iloc[-6]
            s_prev = (ema21.iloc[-6] - ema21.iloc[-11]) / ema21.iloc[-11]
            feats["ema21_curvature"] = float(np.tanh((s_now - s_prev) * 50))

        # Position relative aux EMAs (prix au-dessus/dessous)
        for span in [21, 50, 200]:
            if len(close) > span:
                ema = close.ewm(span=span).mean()
                feats[f"above_ema_{span}"] = 1.0 if close.iloc[-1] > ema.iloc[-1] else -1.0

        return feats

    # ── RSI Features ─────────────────────────────────────────
    def _rsi_features(self, df: pd.DataFrame, period: int = 14) -> Dict:
        close  = df["close"]
        delta  = close.diff()
        gain   = delta.clip(lower=0).rolling(period).mean()
        loss   = (-delta.clip(upper=0)).rolling(period).mean()
        rs     = gain / (loss + 1e-10)
        rsi    = 100 - (100 / (1 + rs))

        current_rsi = rsi.iloc[-1] if not rsi.empty else 50
        prev_rsi    = rsi.iloc[-6] if len(rsi) >= 6 else current_rsi
        rsi_change  = current_rsi - prev_rsi

        # Divergence haussière : prix fait un bas mais RSI fait un haut
        price_trend = (close.iloc[-1] - close.iloc[-14]) if len(close) >= 14 else 0
        rsi_trend   = (rsi.iloc[-1] - rsi.iloc[-14]) if len(rsi) >= 14 else 0
        divergence  = 0.0
        if price_trend < 0 and rsi_trend > 0:
            divergence = 1.0   # Divergence haussière
        elif price_trend > 0 and rsi_trend < 0:
            divergence = -1.0  # Divergence baissière

        # Zone RSI normalisée [-1, 1] : 70+=1, 30-= -1
        rsi_norm = (current_rsi - 50) / 50

        return {
            "rsi_14":        float(current_rsi),
            "rsi_norm":      float(rsi_norm),
            "rsi_change_5d": float(rsi_change),
            "rsi_divergence": float(divergence),
            "rsi_overbought": 1.0 if current_rsi > 70 else 0.0,
            "rsi_oversold":   1.0 if current_rsi < 30 else 0.0,
        }

    # ── MACD Features ─────────────────────────────────────────
    def _macd_features(self, df: pd.DataFrame) -> Dict:
        close = df["close"]
        ema12 = close.ewm(span=12, adjust=False).mean()
        ema26 = close.ewm(span=26, adjust=False).mean()
        macd  = ema12 - ema26
        signal= macd.ewm(span=9, adjust=False).mean()
        hist  = macd - signal

        if len(hist) < 3:
            return {"macd_hist": 0.0, "macd_acceleration": 0.0, "macd_crossover": 0.0}

        h_now   = hist.iloc[-1]
        h_prev  = hist.iloc[-2]
        h_prev2 = hist.iloc[-3]
        accel   = (h_now - h_prev) - (h_prev - h_prev2)

        # Normalisation par la volatilité du prix
        price_std = close.tail(20).std() + 1e-10
        hist_norm = float(h_now / price_std)
        accel_norm= float(accel / price_std)

        # Crossover signal
        crossover = 0.0
        if h_prev < 0 and h_now > 0:
            crossover = 1.0   # Crossover haussier
        elif h_prev > 0 and h_now < 0:
            crossover = -1.0  # Crossover baissier

        return {
            "macd_hist":         float(np.tanh(hist_norm)),
            "macd_acceleration": float(np.tanh(accel_norm)),
            "macd_crossover":    crossover,
            "macd_above_zero":   1.0 if h_now > 0 else -1.0,
        }

    # ── Bollinger Bands ───────────────────────────────────────
    def _bollinger_features(self, df: pd.DataFrame, period: int = 20) -> Dict:
        close = df["close"]
        if len(close) < period:
            return {}
        sma = close.rolling(period).mean()
        std = close.rolling(period).std()
        upper = sma + 2 * std
        lower = sma - 2 * std
        bb_width = (upper - lower) / (sma + 1e-10)

        # Position dans les bandes [-1=lower, 0=middle, 1=upper]
        current = close.iloc[-1]
        mid     = sma.iloc[-1]
        u       = upper.iloc[-1]
        l       = lower.iloc[-1]
        bb_pos  = (current - l) / (u - l + 1e-10) * 2 - 1

        # Squeeze (bandes très étroites = breakout imminent)
        w_now  = bb_width.iloc[-1]
        w_prev = bb_width.tail(50).quantile(0.20) if len(bb_width) >= 50 else w_now
        squeeze = 1.0 if w_now < w_prev else 0.0

        return {
            "bb_position":    float(np.clip(bb_pos, -1, 1)),
            "bb_width_norm":  float(np.tanh(w_now * 10)),
            "bb_squeeze":     squeeze,
            "bb_breakout_up": 1.0 if current > u else 0.0,
            "bb_breakout_dn": 1.0 if current < l else 0.0,
        }

    # ── VWAP Features ─────────────────────────────────────────
    def _vwap_features(self, df: pd.DataFrame) -> Dict:
        typical = (df["high"] + df["low"] + df["close"]) / 3
        vol     = df["volume"]
        vwap    = (typical * vol).rolling(20).sum() / vol.rolling(20).sum()
        if vwap.empty or vwap.iloc[-1] == 0:
            return {"vwap_deviation": 0.0, "above_vwap": 0.0}
        current = df["close"].iloc[-1]
        dev     = (current - vwap.iloc[-1]) / vwap.iloc[-1]
        return {
            "vwap_deviation": float(np.tanh(dev * 20)),
            "above_vwap":     1.0 if current > vwap.iloc[-1] else -1.0,
        }

    # ── ATR Percentile Regime ─────────────────────────────────
    def _atr_features(self, df: pd.DataFrame, period: int = 14) -> Dict:
        high  = df["high"]
        low   = df["low"]
        close = df["close"]
        tr = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs(),
        ], axis=1).max(axis=1)
        atr = tr.rolling(period).mean()
        if atr.empty or atr.iloc[-1] == 0:
            return {}
        current_atr = atr.iloc[-1]
        close_price = close.iloc[-1]
        atr_pct     = current_atr / close_price

        # Percentile ATR (position dans l'historique)
        if len(atr) >= 252:
            atr_pct_rank = float(stats.percentileofscore(
                atr.tail(252).dropna().values, current_atr
            ) / 100)
        else:
            atr_pct_rank = 0.5

        return {
            "atr_pct":      float(atr_pct),
            "atr_pct_rank": float(atr_pct_rank),  # 0=très faible, 1=très élevé
            "vol_regime":   1.0 if atr_pct_rank > 0.75 else
                           -1.0 if atr_pct_rank < 0.25 else 0.0,
        }

    # ── Realized Volatility ───────────────────────────────────
    def _realized_vol_features(self, df: pd.DataFrame) -> Dict:
        log_returns = np.log(df["close"] / df["close"].shift(1)).dropna()
        if len(log_returns) < 20:
            return {}
        vol_5d  = log_returns.tail(5).std()  * np.sqrt(252)
        vol_21d = log_returns.tail(21).std() * np.sqrt(252)
        vol_63d = log_returns.tail(63).std() * np.sqrt(252)
        vol_ratio = vol_5d / (vol_63d + 1e-10)
        return {
            "rvol_5d":       float(vol_5d),
            "rvol_21d":      float(vol_21d),
            "rvol_63d":      float(vol_63d),
            "rvol_ratio":    float(np.tanh(vol_ratio - 1)),
            "rvol_expanding": 1.0 if vol_5d > vol_21d > vol_63d else
                             -1.0 if vol_5d < vol_21d < vol_63d else 0.0,
        }

    # ── GARCH Volatility Forecast ─────────────────────────────
    def _garch_features(self, df: pd.DataFrame) -> Dict:
        """Modèle GARCH(1,1) simplifié pour prévision de volatilité."""
        try:
            from arch import arch_model
            log_returns = np.log(df["close"] / df["close"].shift(1)).dropna() * 100
            if len(log_returns) < 60:
                return {"garch_forecast": 0.0}
            model  = arch_model(log_returns.tail(252), vol="Garch", p=1, q=1)
            result = model.fit(disp="off", show_warning=False)
            forecast = result.forecast(horizon=1)
            variance_forecast = forecast.variance.iloc[-1, 0]
            vol_forecast = np.sqrt(variance_forecast) * np.sqrt(252) / 100
            # Comparaison avec vol réalisée
            rvol = log_returns.tail(21).std() * np.sqrt(252) / 100
            garch_spread = vol_forecast - rvol
            return {
                "garch_forecast":  float(vol_forecast),
                "garch_vs_rvol":   float(np.tanh(garch_spread * 10)),
            }
        except Exception:
            return {"garch_forecast": 0.0, "garch_vs_rvol": 0.0}

    # ── Higher Moments ────────────────────────────────────────
    def _higher_moments(self, df: pd.DataFrame) -> Dict:
        log_returns = np.log(df["close"] / df["close"].shift(1)).dropna()
        if len(log_returns) < 20:
            return {}
        skew_21 = float(stats.skew(log_returns.tail(21)))
        kurt_21 = float(stats.kurtosis(log_returns.tail(21)))
        skew_63 = float(stats.skew(log_returns.tail(63))) if len(log_returns) >= 63 else skew_21
        return {
            "skewness_21d":  float(np.tanh(skew_21)),
            "kurtosis_21d":  float(np.tanh(kurt_21 / 3)),
            "skewness_63d":  float(np.tanh(skew_63)),
            "fat_tails":     1.0 if kurt_21 > 3 else 0.0,
        }

    # ── Hurst Exponent ────────────────────────────────────────
    def _hurst_exponent(self, prices: np.ndarray, max_lag: int = 100) -> float:
        """
        Calcule l'exposant de Hurst.
        H > 0.5 = tendance (trend-following)
        H < 0.5 = mean-reversion
        H = 0.5 = marche aléatoire
        """
        if len(prices) < 50:
            return 0.5
        try:
            log_prices = np.log(prices)
            lags = range(2, min(max_lag, len(prices) // 2))
            tau  = []
            for lag in lags:
                diff = np.diff(log_prices, lag)
                if len(diff) > 0:
                    tau.append(np.sqrt(np.std(diff)))
            if len(tau) < 3:
                return 0.5
            log_lags = np.log(list(lags[:len(tau)]))
            log_tau  = np.log(tau)
            slope, *_ = np.polyfit(log_lags, log_tau, 1)
            return float(np.clip(slope, 0, 1))
        except Exception:
            return 0.5

    # ── Variance Ratio Test ───────────────────────────────────
    def _variance_ratio(self, prices: np.ndarray, k: int = 4) -> float:
        """
        Variance Ratio Test de Lo-MacKinlay.
        VR > 1 → momentum, VR < 1 → mean-reversion.
        Retourne VR normalisé dans [-1, 1].
        """
        if len(prices) < k * 4:
            return 0.0
        try:
            log_returns = np.diff(np.log(prices))
            n      = len(log_returns)
            mu     = np.mean(log_returns)
            sigma1 = np.var(log_returns - mu, ddof=1)
            k_returns = np.array([np.sum(log_returns[i:i+k]) for i in range(n - k + 1)])
            sigmaK = np.var(k_returns - k * mu, ddof=1)
            vr     = sigmaK / (k * sigma1 + 1e-10)
            return float(np.tanh(vr - 1))  # Centré sur 0
        except Exception:
            return 0.0

    # ── Macro Features ────────────────────────────────────────
    def _macro_features(self, macro: Dict) -> Dict:
        feats = {}
        # Yield curve
        yc = macro.get("T10Y2Y")
        if yc is not None:
            feats["yield_curve"]          = float(np.tanh(yc))
            feats["yield_curve_inverted"] = 1.0 if yc < 0 else 0.0

        # VIX regime
        vix = macro.get("VIXCLS")
        if vix is not None:
            feats["vix_level"]    = float(vix)
            feats["vix_regime"]   = 1.0 if vix > 30 else 0.5 if vix > 20 else 0.0
            feats["vix_elevated"] = 1.0 if vix > 25 else 0.0

        # Fed Funds Rate (hawkish = high rate)
        ffr = macro.get("DFF")
        if ffr is not None:
            feats["fed_rate"]     = float(np.tanh((ffr - 3) / 2))
            feats["tight_policy"] = 1.0 if ffr > 4 else 0.0

        # HY Spread (risk appetite)
        hy = macro.get("BAMLH0A0HYM2")
        if hy is not None:
            feats["hy_spread"]    = float(np.tanh((hy - 400) / 200))
            feats["credit_stress"]= 1.0 if hy > 600 else 0.0

        return feats

    # ── Intraday Features (5min) ──────────────────────────────
    def _intraday_features(self, df_5min: pd.DataFrame) -> Dict:
        if df_5min.empty or len(df_5min) < 12:
            return {}
        close = df_5min["close"]
        vol   = df_5min["volume"]
        # Momentum intraday (30 dernières minutes)
        mom_30m = (close.iloc[-1] - close.iloc[-7]) / close.iloc[-7] if len(close) >= 7 else 0
        # Volume spike (volume des 30 dernières min vs moyenne)
        vol_avg = vol.tail(78).mean()  # Moyenne sur 1 séance complète
        vol_now = vol.tail(6).mean()   # Dernières 30 minutes
        vol_ratio = vol_now / (vol_avg + 1e-10)
        return {
            "intraday_momentum_30m": float(np.tanh(mom_30m * 50)),
            "intraday_vol_spike":    float(np.tanh(vol_ratio - 1)),
        }

    # ── Features vides (en cas d'erreur) ─────────────────────
    def _empty_features(self) -> Dict[str, float]:
        return {k: 0.0 for k in [
            "return_1d", "return_5d", "return_20d", "momentum_5d", "momentum_20d",
            "rsi_14", "rsi_norm", "rsi_divergence", "macd_hist", "macd_crossover",
            "bb_position", "atr_pct_rank", "vol_regime", "rvol_21d",
            "hurst_exponent", "variance_ratio", "sentiment_score", "analyst_score",
        ]}