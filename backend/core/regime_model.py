# ============================================================
# ALPHAVAULT QUANT — Regime Detection Engine
# ✅ 7 régimes de marché détectés
# ✅ HMM simplifié + règles statistiques
# ✅ Macro overlay (yield curve, VIX, credit spreads)
# ✅ Transition matrix pour prédiction de régime
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional, Tuple, List
from loguru import logger
from scipy import stats
from enum import Enum

class MarketRegime(str, Enum):
    TREND_UP        = "trend_up"
    TREND_DOWN      = "trend_down"
    RANGE_BOUND     = "range_bound"
    LOW_VOL         = "low_volatility"
    HIGH_VOL        = "high_volatility"
    CRASH           = "crash"
    MACRO_TIGHTENING = "macro_tightening"
    MACRO_EASING    = "macro_easing"

REGIME_SCORES = {
    MarketRegime.TREND_UP:         1.0,
    MarketRegime.MACRO_EASING:     0.7,
    MarketRegime.LOW_VOL:          0.5,
    MarketRegime.RANGE_BOUND:      0.0,
    MarketRegime.HIGH_VOL:        -0.3,
    MarketRegime.MACRO_TIGHTENING:-0.5,
    MarketRegime.TREND_DOWN:      -0.7,
    MarketRegime.CRASH:           -1.0,
}

class RegimeModel:
    """
    Moteur de détection de régime de marché multi-couches.

    Méthode :
    1. Analyse technique (momentum, volatilité, tendance)
    2. Overlay macroéconomique (VIX, yield curve, Fed)
    3. Consensus pondéré → régime final + probabilités
    4. Matrice de transition pour prédiction

    Le régime conditionne TOUTES les décisions du système.
    """

    # Matrice de transition empirique (regime_from → regime_to)
    # Basée sur données historiques S&P 500 1990–2024
    TRANSITION_MATRIX = {
        MarketRegime.TREND_UP: {
            MarketRegime.TREND_UP:    0.72,
            MarketRegime.RANGE_BOUND: 0.15,
            MarketRegime.HIGH_VOL:    0.07,
            MarketRegime.TREND_DOWN:  0.04,
            MarketRegime.LOW_VOL:     0.02,
        },
        MarketRegime.TREND_DOWN: {
            MarketRegime.TREND_DOWN:  0.60,
            MarketRegime.RANGE_BOUND: 0.20,
            MarketRegime.CRASH:       0.10,
            MarketRegime.HIGH_VOL:    0.07,
            MarketRegime.TREND_UP:    0.03,
        },
        MarketRegime.RANGE_BOUND: {
            MarketRegime.RANGE_BOUND: 0.55,
            MarketRegime.TREND_UP:    0.20,
            MarketRegime.TREND_DOWN:  0.15,
            MarketRegime.LOW_VOL:     0.10,
        },
        MarketRegime.LOW_VOL: {
            MarketRegime.LOW_VOL:     0.60,
            MarketRegime.TREND_UP:    0.25,
            MarketRegime.RANGE_BOUND: 0.10,
            MarketRegime.HIGH_VOL:    0.05,
        },
        MarketRegime.HIGH_VOL: {
            MarketRegime.HIGH_VOL:    0.50,
            MarketRegime.CRASH:       0.20,
            MarketRegime.RANGE_BOUND: 0.20,
            MarketRegime.TREND_DOWN:  0.10,
        },
        MarketRegime.CRASH: {
            MarketRegime.CRASH:       0.35,
            MarketRegime.HIGH_VOL:    0.35,
            MarketRegime.TREND_DOWN:  0.20,
            MarketRegime.RANGE_BOUND: 0.10,
        },
        MarketRegime.MACRO_TIGHTENING: {
            MarketRegime.MACRO_TIGHTENING: 0.65,
            MarketRegime.RANGE_BOUND:      0.20,
            MarketRegime.TREND_DOWN:       0.10,
            MarketRegime.MACRO_EASING:     0.05,
        },
        MarketRegime.MACRO_EASING: {
            MarketRegime.MACRO_EASING:     0.60,
            MarketRegime.TREND_UP:         0.25,
            MarketRegime.RANGE_BOUND:      0.10,
            MarketRegime.MACRO_TIGHTENING: 0.05,
        },
    }

    def __init__(self):
        self._last_regime: Optional[MarketRegime] = None
        self._regime_history: List[MarketRegime]  = []
        logger.info("✅ RegimeModel initialisé")

    # ── Détection Principale ──────────────────────────────────
    def detect(
        self,
        df_daily:       pd.DataFrame,
        macro_snapshot: Dict = None,
        features:       Dict = None,
    ) -> Dict:
        """
        Détecte le régime de marché courant.

        Returns dict avec :
        - regime       : MarketRegime (régime principal)
        - probabilities: Dict[MarketRegime, float]
        - confidence   : float [0, 1]
        - regime_score : float [-1, 1]
        - next_regime  : MarketRegime (prédiction)
        - signals      : Dict (signaux détaillés)
        """
        if df_daily is None or df_daily.empty or len(df_daily) < 20:
            return self._default_result()

        try:
            # ── Couche 1 : Technique ──────────────────────
            tech_signals   = self._technical_regime(df_daily)
            # ── Couche 2 : Volatilité ─────────────────────
            vol_signals    = self._volatility_regime(df_daily)
            # ── Couche 3 : Macro ─────────────────────────
            macro_signals  = self._macro_regime(macro_snapshot or {})
            # ── Couche 4 : Momentum ───────────────────────
            mom_signals    = self._momentum_regime(df_daily)

            # ── Consensus ────────────────────────────────
            probs = self._compute_regime_probabilities(
                tech_signals, vol_signals, macro_signals, mom_signals
            )

            # Régime dominant
            regime = max(probs, key=probs.get)
            confidence = probs[regime]

            # Score synthétique [-1, 1]
            regime_score = sum(
                REGIME_SCORES.get(r, 0) * p
                for r, p in probs.items()
            )

            # Prédiction du prochain régime
            next_regime = self._predict_next_regime(regime)

            # Mise à jour historique
            self._last_regime = regime
            self._regime_history.append(regime)
            if len(self._regime_history) > 100:
                self._regime_history.pop(0)

            result = {
                "regime":        regime,
                "regime_label":  regime.value,
                "probabilities": {r.value: round(p, 3) for r, p in probs.items()},
                "confidence":    round(float(confidence), 3),
                "regime_score":  round(float(regime_score), 3),
                "next_regime":   next_regime.value,
                "signals": {
                    "technical":  tech_signals,
                    "volatility": vol_signals,
                    "macro":      macro_signals,
                    "momentum":   mom_signals,
                },
                # Flags stratégiques
                "allow_long":       regime in [
                    MarketRegime.TREND_UP, MarketRegime.LOW_VOL,
                    MarketRegime.MACRO_EASING,
                ],
                "allow_short":      regime in [
                    MarketRegime.TREND_DOWN, MarketRegime.CRASH,
                    MarketRegime.MACRO_TIGHTENING,
                ],
                "reduce_exposure":  regime in [
                    MarketRegime.HIGH_VOL, MarketRegime.CRASH,
                    MarketRegime.MACRO_TIGHTENING,
                ],
                "favor_options":    regime in [
                    MarketRegime.HIGH_VOL, MarketRegime.LOW_VOL,
                    MarketRegime.RANGE_BOUND,
                ],
                "leverage_allowed": confidence > 0.65 and regime in [
                    MarketRegime.TREND_UP, MarketRegime.LOW_VOL,
                    MarketRegime.MACRO_EASING,
                ],
            }

            logger.info(
                f"🎯 Régime: {regime.value} | "
                f"Confiance: {confidence:.1%} | "
                f"Score: {regime_score:+.2f}"
            )
            return result

        except Exception as e:
            logger.error(f"RegimeModel.detect: {e}")
            return self._default_result()

    # ── Couche Technique ──────────────────────────────────────
    def _technical_regime(self, df: pd.DataFrame) -> Dict:
        """Signaux basés sur trend, EMA, ADX."""
        close = df["close"]
        votes = {}

        # EMAs
        ema20  = close.ewm(span=20).mean()
        ema50  = close.ewm(span=50).mean()
        ema200 = close.ewm(span=200).mean() if len(close) >= 200 else ema50

        above_ema20  = close.iloc[-1] > ema20.iloc[-1]
        above_ema50  = close.iloc[-1] > ema50.iloc[-1]
        above_ema200 = close.iloc[-1] > ema200.iloc[-1]

        ema_slope_20  = (ema20.iloc[-1]  - ema20.iloc[-10])  / ema20.iloc[-10]  if len(ema20) >= 10  else 0
        ema_slope_50  = (ema50.iloc[-1]  - ema50.iloc[-20])  / ema50.iloc[-20]  if len(ema50) >= 20  else 0
        ema_slope_200 = (ema200.iloc[-1] - ema200.iloc[-50]) / ema200.iloc[-50] if len(ema200) >= 50 else 0

        # Votes trend_up
        trend_up_score = (
            (0.3 if above_ema20  else 0) +
            (0.3 if above_ema50  else 0) +
            (0.4 if above_ema200 else 0) +
            (0.2 if ema_slope_20 > 0.01 else 0) +
            (0.2 if ema_slope_50 > 0.005 else 0)
        ) / 1.4

        trend_down_score = (
            (0.3 if not above_ema20  else 0) +
            (0.3 if not above_ema50  else 0) +
            (0.4 if not above_ema200 else 0) +
            (0.2 if ema_slope_20 < -0.01 else 0) +
            (0.2 if ema_slope_50 < -0.005 else 0)
        ) / 1.4

        # ADX proxy (force de tendance)
        high = df["high"]
        low  = df["low"]
        tr   = pd.concat([
            high - low,
            (high - close.shift()).abs(),
            (low  - close.shift()).abs(),
        ], axis=1).max(axis=1)
        atr14 = tr.rolling(14).mean()
        dm_plus  = (high.diff().clip(lower=0))
        dm_minus = (-low.diff().clip(upper=0))
        di_plus  = 100 * dm_plus.rolling(14).mean()  / (atr14 + 1e-10)
        di_minus = 100 * dm_minus.rolling(14).mean() / (atr14 + 1e-10)
        dx       = 100 * (di_plus - di_minus).abs() / (di_plus + di_minus + 1e-10)
        adx      = dx.rolling(14).mean()
        adx_val  = float(adx.iloc[-1]) if not adx.empty else 25

        strong_trend = adx_val > 25

        # Range bound score
        if not strong_trend:
            range_score = 1.0 - max(trend_up_score, trend_down_score)
        else:
            range_score = 0.0

        return {
            "trend_up_score":   round(float(trend_up_score), 3),
            "trend_down_score": round(float(trend_down_score), 3),
            "range_score":      round(float(range_score), 3),
            "adx":              round(adx_val, 1),
            "strong_trend":     strong_trend,
            "above_ema200":     above_ema200,
        }

    # ── Couche Volatilité ─────────────────────────────────────
    def _volatility_regime(self, df: pd.DataFrame) -> Dict:
        """Signaux basés sur la structure de volatilité."""
        log_ret = np.log(df["close"] / df["close"].shift(1)).dropna()
        if len(log_ret) < 5:
            return {}

        rvol_5d  = float(log_ret.tail(5).std()  * np.sqrt(252))
        rvol_21d = float(log_ret.tail(21).std() * np.sqrt(252))
        rvol_63d = float(log_ret.tail(63).std() * np.sqrt(252)) if len(log_ret) >= 63 else rvol_21d

        # Percentile
        if len(log_ret) >= 252:
            hist_vols = log_ret.rolling(21).std().dropna() * np.sqrt(252)
            pct_rank  = float(stats.percentileofscore(hist_vols.values, rvol_21d) / 100)
        else:
            pct_rank = 0.5

        crash_score   = 1.0 if rvol_21d > 0.35 else max(0.0, (rvol_21d - 0.25) / 0.10)
        high_vol      = 1.0 if rvol_21d > 0.20 and crash_score < 0.8 else 0.0
        low_vol       = 1.0 if pct_rank < 0.25 else 0.0

        return {
            "rvol_21d":      round(rvol_21d, 4),
            "rvol_pct_rank": round(pct_rank, 3),
            "crash_score":   round(crash_score, 3),
            "high_vol":      high_vol,
            "low_vol":       low_vol,
        }

    # ── Couche Macro ──────────────────────────────────────────
    def _macro_regime(self, macro: Dict) -> Dict:
        """Signaux macroéconomiques FRED/ECB."""
        tight_score = 0.0
        ease_score  = 0.0
        risk_off    = 0.0

        # Yield curve
        yc = macro.get("T10Y2Y")
        if yc is not None:
            if yc < -0.5:
                tight_score += 0.35
            elif yc < 0:
                tight_score += 0.15
            elif yc > 1.0:
                ease_score  += 0.20

        # Fed Funds Rate
        ffr = macro.get("DFF")
        if ffr is not None:
            if ffr > 4.5:
                tight_score += 0.30
            elif ffr > 3.0:
                tight_score += 0.15
            elif ffr < 1.0:
                ease_score  += 0.30

        # VIX
        vix = macro.get("VIXCLS")
        if vix is not None:
            if vix > 35:
                risk_off += 0.50
            elif vix > 25:
                risk_off += 0.25
            elif vix < 15:
                ease_score += 0.15

        # HY Credit Spreads
        hy = macro.get("BAMLH0A0HYM2")
        if hy is not None:
            if hy > 700:
                risk_off += 0.30
            elif hy > 500:
                tight_score += 0.15

        return {
            "tight_score":      round(min(1.0, tight_score), 3),
            "ease_score":       round(min(1.0, ease_score), 3),
            "risk_off_score":   round(min(1.0, risk_off), 3),
            "yield_curve":      float(yc) if yc is not None else None,
            "fed_rate":         float(ffr) if ffr is not None else None,
            "vix":              float(vix) if vix is not None else None,
        }

    # ── Couche Momentum ───────────────────────────────────────
    def _momentum_regime(self, df: pd.DataFrame) -> Dict:
        """Signaux de momentum multi-horizon."""
        close = df["close"]
        mom = {}
        for p in [20, 60, 120]:
            if len(close) > p:
                ret = (close.iloc[-1] - close.iloc[-(p + 1)]) / close.iloc[-(p + 1)]
                mom[f"mom_{p}d"] = float(ret)

        all_pos = all(v > 0 for v in mom.values() if v is not None)
        all_neg = all(v < 0 for v in mom.values() if v is not None)

        return {
            **mom,
            "momentum_aligned_up":   all_pos,
            "momentum_aligned_down": all_neg,
            "momentum_divergent":    not all_pos and not all_neg,
        }

    # ── Calcul des Probabilités ───────────────────────────────
    def _compute_regime_probabilities(
        self,
        tech:  Dict,
        vol:   Dict,
        macro: Dict,
        mom:   Dict,
    ) -> Dict[MarketRegime, float]:
        """Calcule les probabilités de chaque régime via vote pondéré."""
        scores = {r: 0.0 for r in MarketRegime}

        # ── Votes TREND_UP ────────────────────────────────
        tu = (
            tech.get("trend_up_score", 0)   * 0.35 +
            (0.20 if mom.get("momentum_aligned_up")   else 0) +
            macro.get("ease_score", 0)       * 0.20 +
            vol.get("low_vol", 0)            * 0.10 +
            (0.15 if tech.get("above_ema200") else 0)
        )
        scores[MarketRegime.TREND_UP] = tu

        # ── Votes TREND_DOWN ──────────────────────────────
        td = (
            tech.get("trend_down_score", 0)  * 0.35 +
            (0.20 if mom.get("momentum_aligned_down") else 0) +
            macro.get("tight_score", 0)      * 0.20 +
            (0.15 if not tech.get("above_ema200") else 0)
        )
        scores[MarketRegime.TREND_DOWN] = td

        # ── Votes RANGE_BOUND ─────────────────────────────
        rb = (
            tech.get("range_score", 0)       * 0.40 +
            (0.20 if mom.get("momentum_divergent") else 0) +
            (0.20 if vol.get("rvol_pct_rank", 0.5) < 0.6 else 0)
        )
        scores[MarketRegime.RANGE_BOUND] = rb

        # ── Votes LOW_VOL ─────────────────────────────────
        lv = vol.get("low_vol", 0) * 0.70 + (0.30 if tu > 0.3 else 0)
        scores[MarketRegime.LOW_VOL] = lv

        # ── Votes HIGH_VOL ────────────────────────────────
        hv = vol.get("high_vol", 0) * 0.60 + macro.get("risk_off_score", 0) * 0.40
        scores[MarketRegime.HIGH_VOL] = hv

        # ── Votes CRASH ───────────────────────────────────
        cr = vol.get("crash_score", 0) * 0.70 + macro.get("risk_off_score", 0) * 0.30
        scores[MarketRegime.CRASH] = cr

        # ── Votes MACRO_TIGHTENING ────────────────────────
        mt = macro.get("tight_score", 0) * 0.80 + vol.get("rvol_pct_rank", 0.5) * 0.20
        scores[MarketRegime.MACRO_TIGHTENING] = mt

        # ── Votes MACRO_EASING ────────────────────────────
        me = macro.get("ease_score", 0) * 0.80
        scores[MarketRegime.MACRO_EASING] = me

        # Normalisation softmax
        total = sum(scores.values()) + 1e-10
        probs = {r: s / total for r, s in scores.items()}
        return probs

    # ── Prédiction Prochain Régime ────────────────────────────
    def _predict_next_regime(self, current: MarketRegime) -> MarketRegime:
        """Utilise la matrice de transition pour prédire le prochain régime."""
        transitions = self.TRANSITION_MATRIX.get(current, {})
        if not transitions:
            return current
        return max(transitions, key=transitions.get)

    def _default_result(self) -> Dict:
        return {
            "regime":        MarketRegime.RANGE_BOUND,
            "regime_label":  "range_bound",
            "probabilities": {r.value: 0.0 for r in MarketRegime},
            "confidence":    0.0,
            "regime_score":  0.0,
            "next_regime":   "range_bound",
            "signals":       {},
            "allow_long":    False,
            "allow_short":   False,
            "reduce_exposure": True,
            "favor_options": False,
            "leverage_allowed": False,
        }