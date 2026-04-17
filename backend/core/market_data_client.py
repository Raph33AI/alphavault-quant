# ============================================================
# ALPHAVAULT QUANT — Market Data Client
# Centralise toute la logique d'acquisition de données de marché
# Source : Cloudflare Workers (Finance Hub + Economic Data)
# ============================================================

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Tuple
from loguru import logger
from datetime import datetime, timedelta

from backend.core.worker_client import WorkerClient
from backend.config.settings import Settings

class MarketDataClient:
    """
    Client données de marché haute-qualité.
    
    Récupère et normalise :
    - OHLCV multi-timeframes
    - Indicateurs techniques
    - Options chains (IV, Greeks)
    - Earnings calendar
    - Recommandations analystes
    - Données macro (FRED/ECB)
    - Sentiment & news
    """

    # Séries FRED importantes pour le macro overlay
    MACRO_SERIES = {
        "DFF":     "Fed Funds Rate",
        "T10Y2Y":  "Yield Curve 10Y-2Y",
        "VIXCLS":  "VIX Index",
        "BAMLH0A0HYM2": "HY Spread",
        "DTWEXBGS": "USD Index",
        "CPIAUCSL": "CPI YoY",
        "UNRATE":   "Unemployment Rate",
        "T10YIE":   "10Y Inflation Breakeven",
        "EFFR":     "Effective Fed Funds Rate",
        "SOFR":     "SOFR Rate",
    }

    def __init__(self, settings: Settings, worker_client: WorkerClient):
        self.settings = settings
        self.client   = worker_client
        logger.info("✅ MarketDataClient initialisé")

    # ── OHLCV Multi-Timeframe ─────────────────────────────────
    def get_ohlcv(
        self,
        symbol:     str,
        interval:   str = "1day",
        bars:       int = 252,
    ) -> Optional[pd.DataFrame]:
        """
        Récupère les données OHLCV et retourne un DataFrame propre.
        
        Colonnes : open, high, low, close, volume, datetime
        """
        raw = self.client.get_time_series(symbol, interval, bars)
        if not raw:
            return None

        # Normalise le format (data.values ou data.data selon source)
        records = raw.get("values") or raw.get("data") or []
        if not records:
            logger.warning(f"Pas de données OHLCV pour {symbol}/{interval}")
            return None

        try:
            df = pd.DataFrame(records)
            # Colonnes attendues
            df.columns = [c.lower() for c in df.columns]
            for col in ["open", "high", "low", "close", "volume"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")

            # Parse datetime
            if "datetime" in df.columns:
                df["datetime"] = pd.to_datetime(df["datetime"])
                df = df.sort_values("datetime").reset_index(drop=True)
            elif "timestamp" in df.columns:
                df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
                df = df.sort_values("datetime").reset_index(drop=True)

            df = df.dropna(subset=["close"])
            logger.debug(f"OHLCV {symbol}/{interval}: {len(df)} bars")
            return df

        except Exception as e:
            logger.error(f"get_ohlcv parse error {symbol}: {e}")
            return None

    def get_multi_timeframe_ohlcv(
        self,
        symbol:     str,
        timeframes: List[str] = None,
    ) -> Dict[str, Optional[pd.DataFrame]]:
        """Récupère OHLCV sur plusieurs timeframes."""
        if timeframes is None:
            timeframes = self.settings.SIGNAL_TIMEFRAMES

        result = {}
        bars_map = {
            "5min": 288,    # 1 jour de données 5min
            "15min": 672,   # 1 semaine
            "1h": 500,      # ~3 mois
            "4h": 500,      # ~1 an
            "1day": 252,    # 1 an de daily
            "1week": 104,   # 2 ans de weekly
        }
        for tf in timeframes:
            bars = bars_map.get(tf, 252)
            result[tf] = self.get_ohlcv(symbol, tf, bars)
        return result

    # ── Quote Temps Réel ─────────────────────────────────────
    def get_realtime_quote(self, symbol: str) -> Optional[Dict]:
        """Prix temps réel + métriques de marché."""
        raw = self.client.get_quote(symbol)
        if not raw:
            return None
        return {
            "symbol":        raw.get("symbol", symbol),
            "price":         float(raw.get("close", 0) or 0),
            "open":          float(raw.get("open", 0) or 0),
            "high":          float(raw.get("high", 0) or 0),
            "low":           float(raw.get("low", 0) or 0),
            "volume":        int(raw.get("volume", 0) or 0),
            "prev_close":    float(raw.get("previous_close", 0) or 0),
            "change":        float(raw.get("change", 0) or 0),
            "change_pct":    float(raw.get("percent_change", 0) or 0),
            "52w_high":      float(raw.get("fifty_two_week", {}).get("high", 0) or 0),
            "52w_low":       float(raw.get("fifty_two_week", {}).get("low", 0) or 0),
            "market_cap":    float(raw.get("market_cap", 0) or 0),
            "pe_ratio":      float(raw.get("pe_ratio", 0) or 0),
            "timestamp":     raw.get("timestamp", ""),
            "is_market_open": raw.get("is_market_open", False),
        }

    def get_portfolio_quotes(self, symbols: List[str]) -> Dict[str, Optional[Dict]]:
        """Prix temps réel pour un portefeuille de symboles."""
        return {sym: self.get_realtime_quote(sym) for sym in symbols}

    # ── VWAP Proxy ───────────────────────────────────────────
    def compute_vwap(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        """
        Calcul VWAP rolling depuis les données OHLCV.
        VWAP = Σ(Typical Price × Volume) / Σ(Volume)
        """
        if df is None or df.empty:
            return pd.Series(dtype=float)
        typical = (df["high"] + df["low"] + df["close"]) / 3
        vwap = (typical * df["volume"]).rolling(period).sum() / df["volume"].rolling(period).sum()
        return vwap

    # ── Volume Profile Proxy ─────────────────────────────────
    def compute_volume_profile(
        self,
        df:     pd.DataFrame,
        bins:   int = 20,
    ) -> Dict[str, float]:
        """
        Calcul du profil de volume (Point of Control, Value Area).
        """
        if df is None or df.empty or len(df) < 10:
            return {}
        price_range = np.linspace(df["low"].min(), df["high"].max(), bins)
        vol_by_price = np.zeros(bins - 1)
        for _, row in df.iterrows():
            for i in range(len(price_range) - 1):
                if price_range[i] <= row["close"] <= price_range[i + 1]:
                    vol_by_price[i] += row.get("volume", 0)
                    break
        poc_idx = np.argmax(vol_by_price)
        poc     = (price_range[poc_idx] + price_range[poc_idx + 1]) / 2
        total_vol = vol_by_price.sum()
        va_vol    = 0.0
        va_high   = poc
        va_low    = poc
        sorted_idx = np.argsort(vol_by_price)[::-1]
        for idx in sorted_idx:
            va_vol += vol_by_price[idx]
            price_mid = (price_range[idx] + price_range[idx + 1]) / 2
            va_high = max(va_high, price_mid)
            va_low  = min(va_low,  price_mid)
            if va_vol >= 0.70 * total_vol:
                break
        return {
            "poc":      round(poc, 4),
            "va_high":  round(va_high, 4),
            "va_low":   round(va_low, 4),
            "total_vol": int(total_vol),
        }

    # ── Analyst Ratings ──────────────────────────────────────
    def get_analyst_ratings(self, symbol: str) -> Dict[str, float]:
        """
        Score synthétique des recommandations analystes.
        Retourne un score normalisé [-1, 1] (Buy=1, Sell=-1).
        """
        recs = self.client.get_recommendation(symbol)
        if not recs or len(recs) == 0:
            return {"score": 0.0, "buy": 0, "hold": 0, "sell": 0, "consensus": "neutral"}

        latest = recs[0]
        buy    = int(latest.get("buy", 0) or 0)
        hold   = int(latest.get("hold", 0) or 0)
        sell   = int(latest.get("sell", 0) or 0)
        strong_buy  = int(latest.get("strongBuy", 0) or 0)
        strong_sell = int(latest.get("strongSell", 0) or 0)

        total = buy + hold + sell + strong_buy + strong_sell
        if total == 0:
            return {"score": 0.0, "buy": 0, "hold": 0, "sell": 0, "consensus": "neutral"}

        score = ((strong_buy * 2 + buy * 1 - sell * 1 - strong_sell * 2) / (total * 2))
        consensus = "strong_buy" if score > 0.5 else \
                    "buy"        if score > 0.2 else \
                    "sell"       if score < -0.2 else \
                    "strong_sell" if score < -0.5 else "neutral"

        return {
            "score":     round(score, 3),
            "buy":       buy + strong_buy,
            "hold":      hold,
            "sell":      sell + strong_sell,
            "consensus": consensus,
            "period":    latest.get("period", ""),
        }

    # ── Earnings Data ─────────────────────────────────────────
    def get_earnings_data(self, symbol: str) -> Dict:
        """Données earnings avec calcul de surprises."""
        earnings = self.client.get_earnings(symbol)
        if not earnings:
            return {"has_data": False, "upcoming": False, "surprise_avg": 0.0}

        surprises = []
        for e in earnings[:8]:
            actual   = e.get("actual") or e.get("epsActual")
            estimate = e.get("estimate") or e.get("epsEstimate")
            if actual is not None and estimate and float(estimate) != 0:
                surprise_pct = (float(actual) - float(estimate)) / abs(float(estimate)) * 100
                surprises.append(surprise_pct)

        avg_surprise = np.mean(surprises) if surprises else 0.0
        beat_rate    = (sum(1 for s in surprises if s > 0) / len(surprises)) if surprises else 0.0

        # Vérifier si earnings imminents (< 5 jours)
        calendar = self.client.get_earnings_calendar(days_ahead=5)
        upcoming = False
        if calendar:
            earnings_list = calendar.get("earningsCalendar", [])
            upcoming = any(e.get("symbol") == symbol for e in earnings_list)

        return {
            "has_data":     True,
            "upcoming":     upcoming,
            "surprise_avg": round(avg_surprise, 2),
            "beat_rate":    round(beat_rate, 3),
            "n_quarters":   len(surprises),
        }

    # ── Macro Indicators ─────────────────────────────────────
    def get_macro_snapshot(self) -> Dict[str, Optional[float]]:
        """
        Snapshot macroéconomique complet via FRED.
        Retourne les dernières valeurs des séries clés.
        """
        raw = self.client.get_multiple_fred_series(list(self.MACRO_SERIES.keys()))
        snapshot = {}
        for series_id, label in self.MACRO_SERIES.items():
            series_data = raw.get(series_id)
            if series_data:
                obs = series_data.get("observations", [])
                if obs:
                    last_val = obs[-1].get("value")
                    if last_val and last_val != ".":
                        snapshot[series_id] = float(last_val)
                    else:
                        snapshot[series_id] = None
                else:
                    snapshot[series_id] = None
            else:
                snapshot[series_id] = None

        # Calcul indicateurs dérivés
        if snapshot.get("DFF") and snapshot.get("T10Y2Y"):
            snapshot["yield_curve_inverted"] = snapshot["T10Y2Y"] < 0

        logger.debug(f"Macro snapshot: {len([v for v in snapshot.values() if v is not None])} séries OK")
        return snapshot

    # ── News Sentiment Score ──────────────────────────────────
    def get_news_sentiment_score(self, symbol: str) -> float:
        """
        Score de sentiment normalisé [-1, 1] basé sur les news.
        Utilise les données FinnHub via Finance Hub Worker.
        """
        sentiment = self.client.get_sentiment(symbol)
        if not sentiment:
            return 0.0

        bull_score  = float(sentiment.get("buzz", {}).get("bullishPercent", 0.5) or 0.5)
        bear_score  = float(sentiment.get("buzz", {}).get("bearishPercent", 0.5) or 0.5)
        company_score = float(sentiment.get("companyNewsScore", 0.5) or 0.5)
        sector_score  = float(sentiment.get("sectorAverageBullishPercent", 0.5) or 0.5)

        # Score composite [-1, 1]
        composite = (bull_score - bear_score) * 0.5 + (company_score - 0.5) * 0.3 + (sector_score - 0.5) * 0.2
        return round(max(-1.0, min(1.0, composite * 2)), 3)