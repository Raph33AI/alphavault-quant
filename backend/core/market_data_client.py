# # ============================================================
# # ALPHAVAULT QUANT — Market Data Client
# # Centralise toute la logique d'acquisition de données de marché
# # Source : Cloudflare Workers (Finance Hub + Economic Data)
# # ============================================================

# import pandas as pd
# import numpy as np
# from typing import Dict, List, Optional, Tuple
# from loguru import logger
# from datetime import datetime, timedelta

# from backend.core.worker_client import WorkerClient
# from backend.config.settings import Settings

# class MarketDataClient:
#     """
#     Client données de marché haute-qualité.
    
#     Récupère et normalise :
#     - OHLCV multi-timeframes
#     - Indicateurs techniques
#     - Options chains (IV, Greeks)
#     - Earnings calendar
#     - Recommandations analystes
#     - Données macro (FRED/ECB)
#     - Sentiment & news
#     """

#     # Séries FRED importantes pour le macro overlay
#     MACRO_SERIES = {
#         "DFF":     "Fed Funds Rate",
#         "T10Y2Y":  "Yield Curve 10Y-2Y",
#         "VIXCLS":  "VIX Index",
#         "BAMLH0A0HYM2": "HY Spread",
#         "DTWEXBGS": "USD Index",
#         "CPIAUCSL": "CPI YoY",
#         "UNRATE":   "Unemployment Rate",
#         "T10YIE":   "10Y Inflation Breakeven",
#         "EFFR":     "Effective Fed Funds Rate",
#         "SOFR":     "SOFR Rate",
#     }

#     def __init__(self, settings: Settings, worker_client: WorkerClient):
#         self.settings = settings
#         self.client   = worker_client
#         logger.info("✅ MarketDataClient initialisé")

#     # ── OHLCV Multi-Timeframe ─────────────────────────────────
#     def get_ohlcv(
#         self,
#         symbol:     str,
#         interval:   str = "1day",
#         bars:       int = 252,
#     ) -> Optional[pd.DataFrame]:
#         """
#         Récupère les données OHLCV et retourne un DataFrame propre.
        
#         Colonnes : open, high, low, close, volume, datetime
#         """
#         raw = self.client.get_time_series(symbol, interval, bars)
#         if not raw:
#             return None

#         # Normalise le format (data.values ou data.data selon source)
#         records = raw.get("values") or raw.get("data") or []
#         if not records:
#             logger.warning(f"Pas de données OHLCV pour {symbol}/{interval}")
#             return None

#         try:
#             df = pd.DataFrame(records)
#             # Colonnes attendues
#             df.columns = [c.lower() for c in df.columns]
#             for col in ["open", "high", "low", "close", "volume"]:
#                 if col in df.columns:
#                     df[col] = pd.to_numeric(df[col], errors="coerce")

#             # Parse datetime
#             if "datetime" in df.columns:
#                 df["datetime"] = pd.to_datetime(df["datetime"])
#                 df = df.sort_values("datetime").reset_index(drop=True)
#             elif "timestamp" in df.columns:
#                 df["datetime"] = pd.to_datetime(df["timestamp"], unit="ms")
#                 df = df.sort_values("datetime").reset_index(drop=True)

#             df = df.dropna(subset=["close"])
#             logger.debug(f"OHLCV {symbol}/{interval}: {len(df)} bars")
#             return df

#         except Exception as e:
#             logger.error(f"get_ohlcv parse error {symbol}: {e}")
#             return None

#     def get_multi_timeframe_ohlcv(
#         self,
#         symbol:     str,
#         timeframes: List[str] = None,
#     ) -> Dict[str, Optional[pd.DataFrame]]:
#         """Récupère OHLCV sur plusieurs timeframes."""
#         if timeframes is None:
#             timeframes = self.settings.SIGNAL_TIMEFRAMES

#         result = {}
#         bars_map = {
#             "5min": 288,    # 1 jour de données 5min
#             "15min": 672,   # 1 semaine
#             "1h": 500,      # ~3 mois
#             "4h": 500,      # ~1 an
#             "1day": 252,    # 1 an de daily
#             "1week": 104,   # 2 ans de weekly
#         }
#         for tf in timeframes:
#             bars = bars_map.get(tf, 252)
#             result[tf] = self.get_ohlcv(symbol, tf, bars)
#         return result

#     # ── Quote Temps Réel ─────────────────────────────────────
#     def get_realtime_quote(self, symbol: str) -> Optional[Dict]:
#         """Prix temps réel + métriques de marché."""
#         raw = self.client.get_quote(symbol)
#         if not raw:
#             return None
#         return {
#             "symbol":        raw.get("symbol", symbol),
#             "price":         float(raw.get("close", 0) or 0),
#             "open":          float(raw.get("open", 0) or 0),
#             "high":          float(raw.get("high", 0) or 0),
#             "low":           float(raw.get("low", 0) or 0),
#             "volume":        int(raw.get("volume", 0) or 0),
#             "prev_close":    float(raw.get("previous_close", 0) or 0),
#             "change":        float(raw.get("change", 0) or 0),
#             "change_pct":    float(raw.get("percent_change", 0) or 0),
#             "52w_high":      float(raw.get("fifty_two_week", {}).get("high", 0) or 0),
#             "52w_low":       float(raw.get("fifty_two_week", {}).get("low", 0) or 0),
#             "market_cap":    float(raw.get("market_cap", 0) or 0),
#             "pe_ratio":      float(raw.get("pe_ratio", 0) or 0),
#             "timestamp":     raw.get("timestamp", ""),
#             "is_market_open": raw.get("is_market_open", False),
#         }

#     def get_portfolio_quotes(self, symbols: List[str]) -> Dict[str, Optional[Dict]]:
#         """Prix temps réel pour un portefeuille de symboles."""
#         return {sym: self.get_realtime_quote(sym) for sym in symbols}

#     # ── VWAP Proxy ───────────────────────────────────────────
#     def compute_vwap(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
#         """
#         Calcul VWAP rolling depuis les données OHLCV.
#         VWAP = Σ(Typical Price × Volume) / Σ(Volume)
#         """
#         if df is None or df.empty:
#             return pd.Series(dtype=float)
#         typical = (df["high"] + df["low"] + df["close"]) / 3
#         vwap = (typical * df["volume"]).rolling(period).sum() / df["volume"].rolling(period).sum()
#         return vwap

#     # ── Volume Profile Proxy ─────────────────────────────────
#     def compute_volume_profile(
#         self,
#         df:     pd.DataFrame,
#         bins:   int = 20,
#     ) -> Dict[str, float]:
#         """
#         Calcul du profil de volume (Point of Control, Value Area).
#         """
#         if df is None or df.empty or len(df) < 10:
#             return {}
#         price_range = np.linspace(df["low"].min(), df["high"].max(), bins)
#         vol_by_price = np.zeros(bins - 1)
#         for _, row in df.iterrows():
#             for i in range(len(price_range) - 1):
#                 if price_range[i] <= row["close"] <= price_range[i + 1]:
#                     vol_by_price[i] += row.get("volume", 0)
#                     break
#         poc_idx = np.argmax(vol_by_price)
#         poc     = (price_range[poc_idx] + price_range[poc_idx + 1]) / 2
#         total_vol = vol_by_price.sum()
#         va_vol    = 0.0
#         va_high   = poc
#         va_low    = poc
#         sorted_idx = np.argsort(vol_by_price)[::-1]
#         for idx in sorted_idx:
#             va_vol += vol_by_price[idx]
#             price_mid = (price_range[idx] + price_range[idx + 1]) / 2
#             va_high = max(va_high, price_mid)
#             va_low  = min(va_low,  price_mid)
#             if va_vol >= 0.70 * total_vol:
#                 break
#         return {
#             "poc":      round(poc, 4),
#             "va_high":  round(va_high, 4),
#             "va_low":   round(va_low, 4),
#             "total_vol": int(total_vol),
#         }

#     # ── Analyst Ratings ──────────────────────────────────────
#     def get_analyst_ratings(self, symbol: str) -> Dict[str, float]:
#         """
#         Score synthétique des recommandations analystes.
#         Retourne un score normalisé [-1, 1] (Buy=1, Sell=-1).
#         """
#         recs = self.client.get_recommendation(symbol)
#         if not recs or len(recs) == 0:
#             return {"score": 0.0, "buy": 0, "hold": 0, "sell": 0, "consensus": "neutral"}

#         latest = recs[0]
#         buy    = int(latest.get("buy", 0) or 0)
#         hold   = int(latest.get("hold", 0) or 0)
#         sell   = int(latest.get("sell", 0) or 0)
#         strong_buy  = int(latest.get("strongBuy", 0) or 0)
#         strong_sell = int(latest.get("strongSell", 0) or 0)

#         total = buy + hold + sell + strong_buy + strong_sell
#         if total == 0:
#             return {"score": 0.0, "buy": 0, "hold": 0, "sell": 0, "consensus": "neutral"}

#         score = ((strong_buy * 2 + buy * 1 - sell * 1 - strong_sell * 2) / (total * 2))
#         consensus = "strong_buy" if score > 0.5 else \
#                     "buy"        if score > 0.2 else \
#                     "sell"       if score < -0.2 else \
#                     "strong_sell" if score < -0.5 else "neutral"

#         return {
#             "score":     round(score, 3),
#             "buy":       buy + strong_buy,
#             "hold":      hold,
#             "sell":      sell + strong_sell,
#             "consensus": consensus,
#             "period":    latest.get("period", ""),
#         }

#     # ── Earnings Data ─────────────────────────────────────────
#     def get_earnings_data(self, symbol: str) -> Dict:
#         """Données earnings avec calcul de surprises."""
#         earnings = self.client.get_earnings(symbol)
#         if not earnings:
#             return {"has_data": False, "upcoming": False, "surprise_avg": 0.0}

#         surprises = []
#         for e in earnings[:8]:
#             actual   = e.get("actual") or e.get("epsActual")
#             estimate = e.get("estimate") or e.get("epsEstimate")
#             if actual is not None and estimate and float(estimate) != 0:
#                 surprise_pct = (float(actual) - float(estimate)) / abs(float(estimate)) * 100
#                 surprises.append(surprise_pct)

#         avg_surprise = np.mean(surprises) if surprises else 0.0
#         beat_rate    = (sum(1 for s in surprises if s > 0) / len(surprises)) if surprises else 0.0

#         # Vérifier si earnings imminents (< 5 jours)
#         calendar = self.client.get_earnings_calendar(days_ahead=5)
#         upcoming = False
#         if calendar:
#             earnings_list = calendar.get("earningsCalendar", [])
#             upcoming = any(e.get("symbol") == symbol for e in earnings_list)

#         return {
#             "has_data":     True,
#             "upcoming":     upcoming,
#             "surprise_avg": round(avg_surprise, 2),
#             "beat_rate":    round(beat_rate, 3),
#             "n_quarters":   len(surprises),
#         }

#     # ── Macro Indicators ─────────────────────────────────────
#     def get_macro_snapshot(self) -> Dict[str, Optional[float]]:
#         """
#         Snapshot macroéconomique complet via FRED.
#         Retourne les dernières valeurs des séries clés.
#         """
#         raw = self.client.get_multiple_fred_series(list(self.MACRO_SERIES.keys()))
#         snapshot = {}
#         for series_id, label in self.MACRO_SERIES.items():
#             series_data = raw.get(series_id)
#             if series_data:
#                 obs = series_data.get("observations", [])
#                 if obs:
#                     last_val = obs[-1].get("value")
#                     if last_val and last_val != ".":
#                         snapshot[series_id] = float(last_val)
#                     else:
#                         snapshot[series_id] = None
#                 else:
#                     snapshot[series_id] = None
#             else:
#                 snapshot[series_id] = None

#         # Calcul indicateurs dérivés
#         if snapshot.get("DFF") and snapshot.get("T10Y2Y"):
#             snapshot["yield_curve_inverted"] = snapshot["T10Y2Y"] < 0

#         logger.debug(f"Macro snapshot: {len([v for v in snapshot.values() if v is not None])} séries OK")
#         return snapshot

#     # ── News Sentiment Score ──────────────────────────────────
#     def get_news_sentiment_score(self, symbol: str) -> float:
#         """
#         Score de sentiment normalisé [-1, 1] basé sur les news.
#         Utilise les données FinnHub via Finance Hub Worker.
#         """
#         sentiment = self.client.get_sentiment(symbol)
#         if not sentiment:
#             return 0.0

#         bull_score  = float(sentiment.get("buzz", {}).get("bullishPercent", 0.5) or 0.5)
#         bear_score  = float(sentiment.get("buzz", {}).get("bearishPercent", 0.5) or 0.5)
#         company_score = float(sentiment.get("companyNewsScore", 0.5) or 0.5)
#         sector_score  = float(sentiment.get("sectorAverageBullishPercent", 0.5) or 0.5)

#         # Score composite [-1, 1]
#         composite = (bull_score - bear_score) * 0.5 + (company_score - 0.5) * 0.3 + (sector_score - 0.5) * 0.2
#         return round(max(-1.0, min(1.0, composite * 2)), 3)

# ============================================================
# ALPHAVAULT QUANT — Market Data Client v2
# ✅ Source principale : yfinance (Yahoo Finance)
#    → Gratuit, sans clé API, sans rate limit strict
# ✅ Source secondaire : Finance Hub Worker (Finnhub/TwelveData)
#    → Utilisé pour les données non disponibles sur Yahoo
# ✅ Fallback automatique si une source échoue
# ============================================================

import pandas as pd
import numpy as np
import time
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime, timedelta

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False
    logger.warning("⚠ yfinance non installé — fallback Worker uniquement")

from backend.core.worker_client import WorkerClient
from backend.config.settings import Settings

# Mapping timeframe → paramètres yfinance
YF_INTERVAL_MAP = {
    "5min":  ("5m",  "5d"),      # 5 jours de 5min
    "15min": ("15m", "30d"),
    "1h":    ("1h",  "730d"),    # ~2 ans de 1h
    "4h":    ("1h",  "730d"),    # 4h via resampling depuis 1h
    "1day":  ("1d",  "2y"),      # 2 ans de daily
    "1week": ("1wk", "5y"),      # 5 ans de weekly
}

# Séries macro FRED
MACRO_SERIES = {
    "DFF":          "Fed Funds Rate",
    "T10Y2Y":       "Yield Curve 10Y-2Y",
    "VIXCLS":       "VIX",
    "BAMLH0A0HYM2": "HY Spread",
    "CPIAUCSL":     "CPI",
    "UNRATE":       "Unemployment Rate",
    "T10YIE":       "10Y Breakeven",
    "EFFR":         "Effective Fed Funds",
}

class MarketDataClient:
    """
    Client données marché — yfinance (primary) + Workers (secondary).
    """

    def __init__(self, settings: Settings, worker_client: WorkerClient):
        self.settings = settings
        self.client   = worker_client
        self._yf_cache: Dict = {}
        self._cache_ttl = 300  # 5 minutes
        logger.info(
            f"✅ MarketDataClient initialisé | "
            f"yfinance={'✅' if YFINANCE_AVAILABLE else '❌'}"
        )

    # ── OHLCV via yfinance (primary) ──────────────────────────
    def get_ohlcv(
        self,
        symbol:   str,
        interval: str = "1day",
        bars:     int = 252,
    ) -> Optional[pd.DataFrame]:
        """Récupère OHLCV — yfinance en priorité, Worker en fallback."""

        # 1. Tentative yfinance
        if YFINANCE_AVAILABLE:
            df = self._get_ohlcv_yfinance(symbol, interval, bars)
            if df is not None and not df.empty:
                return df

        # 2. Fallback Worker (TwelveData)
        return self._get_ohlcv_worker(symbol, interval, bars)

    def _get_ohlcv_yfinance(
        self,
        symbol:   str,
        interval: str,
        bars:     int,
    ) -> Optional[pd.DataFrame]:
        """Télécharge OHLCV depuis Yahoo Finance."""
        cache_key = f"yf:{symbol}:{interval}:{bars}"
        now = time.time()

        if cache_key in self._yf_cache:
            data, ts = self._yf_cache[cache_key]
            if now - ts < self._cache_ttl:
                return data

        try:
            yf_interval, yf_period = YF_INTERVAL_MAP.get(interval, ("1d", "1y"))

            ticker = yf.Ticker(symbol)
            raw    = ticker.history(
                interval = yf_interval,
                period   = yf_period,
                auto_adjust = True,
                prepost     = False,
            )

            if raw.empty:
                return None

            # Normalisation
            raw = raw.reset_index()
            raw.columns = [c.lower() for c in raw.columns]
            raw = raw.rename(columns={"date": "datetime", "stock splits": "splits"})

            # Gestion datetime avec timezone
            if "datetime" in raw.columns:
                raw["datetime"] = pd.to_datetime(raw["datetime"])
                if hasattr(raw["datetime"].dt, "tz") and raw["datetime"].dt.tz is not None:
                    raw["datetime"] = raw["datetime"].dt.tz_localize(None)

            # Resampling 4h depuis 1h
            if interval == "4h" and yf_interval == "1h":
                raw = raw.set_index("datetime")
                raw = raw.resample("4h").agg({
                    "open": "first", "high": "max",
                    "low":  "min",   "close": "last",
                    "volume": "sum",
                }).dropna().reset_index()

            for col in ["open", "high", "low", "close", "volume"]:
                if col in raw.columns:
                    raw[col] = pd.to_numeric(raw[col], errors="coerce")

            raw = raw.dropna(subset=["close"]).tail(bars).reset_index(drop=True)

            self._yf_cache[cache_key] = (raw, now)
            logger.debug(f"yfinance {symbol}/{interval}: {len(raw)} bars")
            return raw

        except Exception as e:
            logger.warning(f"yfinance {symbol}/{interval}: {e}")
            return None

    def _get_ohlcv_worker(
        self,
        symbol:   str,
        interval: str,
        bars:     int,
    ) -> Optional[pd.DataFrame]:
        """Fallback : récupère OHLCV depuis Finance Hub Worker."""
        raw = self.client.get_time_series(symbol, interval, bars)
        if not raw:
            return None

        records = raw.get("values") or raw.get("data") or []
        if not records:
            return None

        try:
            df = pd.DataFrame(records)
            df.columns = [c.lower() for c in df.columns]
            for col in ["open", "high", "low", "close", "volume"]:
                if col in df.columns:
                    df[col] = pd.to_numeric(df[col], errors="coerce")
            if "datetime" in df.columns:
                df["datetime"] = pd.to_datetime(df["datetime"])
                df = df.sort_values("datetime").reset_index(drop=True)
            df = df.dropna(subset=["close"])
            logger.debug(f"Worker {symbol}/{interval}: {len(df)} bars")
            return df
        except Exception as e:
            logger.error(f"Worker OHLCV parse {symbol}: {e}")
            return None

    # ── Multi-Timeframe ───────────────────────────────────────
    def get_multi_timeframe_ohlcv(
        self,
        symbol:     str,
        timeframes: List[str] = None,
    ) -> Dict[str, Optional[pd.DataFrame]]:
        """
        Récupère OHLCV multi-timeframe avec yfinance batch.
        Beaucoup plus efficace que des appels individuels.
        """
        if timeframes is None:
            timeframes = self.settings.SIGNAL_TIMEFRAMES

        bars_map = {
            "5min": 288, "15min": 200, "1h": 500,
            "4h": 300, "1day": 252, "1week": 104,
        }

        result = {}
        for tf in timeframes:
            bars = bars_map.get(tf, 252)
            result[tf] = self.get_ohlcv(symbol, tf, bars)

        return result

    # ── Prix Temps Réel (yfinance) ────────────────────────────
    def get_realtime_quote(self, symbol: str) -> Optional[Dict]:
        """Quote temps réel — yfinance (15min delay gratuit)."""

        # 1. Essai yfinance
        if YFINANCE_AVAILABLE:
            try:
                ticker = yf.Ticker(symbol)
                info   = ticker.fast_info

                price = float(getattr(info, "last_price", 0) or 0)
                if price == 0:
                    # Fallback sur l'historique récent
                    hist  = ticker.history(period="1d", interval="1m")
                    if not hist.empty:
                        price = float(hist["Close"].iloc[-1])

                prev_close = float(getattr(info, "previous_close", price) or price)
                change_pct = ((price - prev_close) / prev_close * 100) if prev_close else 0

                return {
                    "symbol":       symbol,
                    "price":        price,
                    "prev_close":   prev_close,
                    "change":       price - prev_close,
                    "change_pct":   round(change_pct, 3),
                    "volume":       int(getattr(info, "three_month_average_volume", 1_000_000) or 1_000_000),
                    "market_cap":   float(getattr(info, "market_cap", 0) or 0),
                    "52w_high":     float(getattr(info, "year_high", 0) or 0),
                    "52w_low":      float(getattr(info, "year_low", 0) or 0),
                    "source":       "yfinance",
                }
            except Exception as e:
                logger.warning(f"yfinance quote {symbol}: {e}")

        # 2. Fallback Worker
        raw = self.client.get_quote(symbol)
        if raw:
            return {
                "symbol":     raw.get("symbol", symbol),
                "price":      float(raw.get("close", 0) or 0),
                "prev_close": float(raw.get("previous_close", 0) or 0),
                "change":     float(raw.get("change", 0) or 0),
                "change_pct": float(raw.get("percent_change", 0) or 0),
                "volume":     int(raw.get("volume", 1_000_000) or 1_000_000),
                "market_cap": float(raw.get("market_cap", 0) or 0),
                "source":     "worker",
            }

        # 3. Dernier recours : dernière valeur daily
        df = self.get_ohlcv(symbol, "1day", 5)
        if df is not None and not df.empty:
            last = df.iloc[-1]
            return {
                "symbol":   symbol,
                "price":    float(last["close"]),
                "volume":   int(last.get("volume", 1_000_000)),
                "source":   "ohlcv_fallback",
            }
        return None

    def get_portfolio_quotes(self, symbols: List[str]) -> Dict[str, Optional[Dict]]:
        """Quotes pour plusieurs symboles via yfinance batch."""
        if not YFINANCE_AVAILABLE:
            return {s: self.get_realtime_quote(s) for s in symbols}

        results = {}
        try:
            # Download batch (1 seul appel pour tous les symboles)
            tickers = yf.download(
                " ".join(symbols),
                period   = "2d",
                interval = "1d",
                group_by = "ticker",
                auto_adjust = True,
                progress = False,
                threads  = True,
            )
            for sym in symbols:
                try:
                    if len(symbols) == 1:
                        price = float(tickers["Close"].iloc[-1])
                        prev  = float(tickers["Close"].iloc[-2]) if len(tickers) > 1 else price
                    else:
                        price = float(tickers[sym]["Close"].iloc[-1])
                        prev  = float(tickers[sym]["Close"].iloc[-2]) if len(tickers) > 1 else price
                    results[sym] = {
                        "symbol":     sym,
                        "price":      price,
                        "prev_close": prev,
                        "change_pct": round((price - prev) / prev * 100, 3) if prev else 0,
                        "source":     "yfinance_batch",
                    }
                except Exception:
                    results[sym] = self.get_realtime_quote(sym)
        except Exception as e:
            logger.warning(f"yfinance batch download: {e}")
            results = {s: self.get_realtime_quote(s) for s in symbols}

        return results

    # ── VWAP Proxy ────────────────────────────────────────────
    def compute_vwap(self, df: pd.DataFrame, period: int = 14) -> pd.Series:
        if df is None or df.empty:
            return pd.Series(dtype=float)
        typical = (df["high"] + df["low"] + df["close"]) / 3
        return (typical * df["volume"]).rolling(period).sum() / df["volume"].rolling(period).sum()

    # ── Ratings Analystes ─────────────────────────────────────
    def get_analyst_ratings(self, symbol: str) -> Dict:
        """Recommendations analystes via yfinance."""
        if YFINANCE_AVAILABLE:
            try:
                ticker = yf.Ticker(symbol)
                recs   = ticker.recommendations

                if recs is not None and not recs.empty:
                    latest = recs.iloc[-1] if len(recs) > 0 else None
                    if latest is not None:
                        buy  = int(latest.get("strongBuy", 0) + latest.get("buy", 0))
                        hold = int(latest.get("hold", 0))
                        sell = int(latest.get("sell", 0) + latest.get("strongSell", 0))
                        total = buy + hold + sell
                        if total > 0:
                            score = (buy - sell) / total
                            return {
                                "score":     round(score, 3),
                                "buy":       buy,
                                "hold":      hold,
                                "sell":      sell,
                                "consensus": "buy" if score > 0.2 else "sell" if score < -0.2 else "neutral",
                                "source":    "yfinance",
                            }
            except Exception as e:
                logger.debug(f"yfinance analyst {symbol}: {e}")

        # Fallback Worker
        recs = self.client.get_recommendation(symbol)
        if recs and len(recs) > 0:
            latest     = recs[0]
            buy        = int((latest.get("buy", 0) or 0) + (latest.get("strongBuy", 0) or 0))
            hold       = int(latest.get("hold", 0) or 0)
            sell       = int((latest.get("sell", 0) or 0) + (latest.get("strongSell", 0) or 0))
            total      = buy + hold + sell
            if total > 0:
                score = (buy - sell) / total
                return {
                    "score":     round(score, 3),
                    "buy":       buy, "hold": hold, "sell": sell,
                    "consensus": "buy" if score > 0.2 else "sell" if score < -0.2 else "neutral",
                }
        return {"score": 0.0, "buy": 0, "hold": 0, "sell": 0, "consensus": "neutral"}

    # ── Earnings ──────────────────────────────────────────────
    def get_earnings_data(self, symbol: str) -> Dict:
        """Données earnings via yfinance."""
        if YFINANCE_AVAILABLE:
            try:
                ticker   = yf.Ticker(symbol)
                earnings = ticker.earnings_history

                if earnings is not None and not earnings.empty:
                    surprises = []
                    for _, row in earnings.iterrows():
                        actual   = row.get("epsActual") or row.get("Actual EPS")
                        estimate = row.get("epsEstimate") or row.get("EPS Estimate")
                        if actual is not None and estimate and float(str(estimate)) != 0:
                            surp = (float(str(actual)) - float(str(estimate))) / abs(float(str(estimate))) * 100
                            surprises.append(surp)

                    avg_surprise = float(np.mean(surprises)) if surprises else 0.0
                    beat_rate    = float((np.array(surprises) > 0).mean()) if surprises else 0.5

                    # Earnings imminents (< 14 jours)
                    cal = ticker.calendar
                    upcoming = False
                    if cal is not None and not cal.empty:
                        try:
                            next_earnings = cal.iloc[0]
                            upcoming = True
                        except Exception:
                            pass

                    return {
                        "has_data":     True,
                        "upcoming":     upcoming,
                        "surprise_avg": round(avg_surprise, 2),
                        "beat_rate":    round(beat_rate, 3),
                        "n_quarters":   len(surprises),
                        "source":       "yfinance",
                    }
            except Exception as e:
                logger.debug(f"yfinance earnings {symbol}: {e}")

        return {
            "has_data": False, "upcoming": False,
            "surprise_avg": 0.0, "beat_rate": 0.5, "n_quarters": 0,
        }

    # ── Macro FRED ────────────────────────────────────────────
    def get_macro_snapshot(self) -> Dict:
        """Snapshot macro via yfinance (tickers Yahoo) + FRED Worker."""
        snapshot = {}

        # Tickers Yahoo Finance pour les indicateurs macro
        YAHOO_MACRO_TICKERS = {
            "^VIX":   "VIXCLS",
            "^TNX":   "T10Y",       # 10Y Treasury
            "^IRX":   "T3M",        # 3M Treasury
            "DX-Y.NYB": "DTWEXBGS", # USD Index
        }

        if YFINANCE_AVAILABLE:
            try:
                tickers_str = " ".join(YAHOO_MACRO_TICKERS.keys())
                data = yf.download(
                    tickers_str,
                    period   = "5d",
                    interval = "1d",
                    progress = False,
                    threads  = True,
                )

                for ticker, series_id in YAHOO_MACRO_TICKERS.items():
                    try:
                        if len(YAHOO_MACRO_TICKERS) > 1:
                            vals = data["Close"][ticker].dropna()
                        else:
                            vals = data["Close"].dropna()

                        if not vals.empty:
                            snapshot[series_id] = float(vals.iloc[-1])
                    except Exception:
                        pass
            except Exception as e:
                logger.debug(f"yfinance macro: {e}")

        # Tentative FRED via Worker si configuré
        if self.client.settings.ECONOMIC_DATA_URL:
            try:
                fred_data = self.client.get_multiple_fred_series(
                    list(MACRO_SERIES.keys())
                )
                for series_id, data in fred_data.items():
                    if data:
                        obs = data.get("observations", [])
                        if obs:
                            last_val = obs[-1].get("value")
                            if last_val and last_val != ".":
                                snapshot[series_id] = float(last_val)
            except Exception:
                pass

        # Calcul dérivés
        if "T10Y" in snapshot and "T3M" in snapshot:
            snapshot["T10Y2Y"] = snapshot["T10Y"] - snapshot["T3M"]

        if snapshot.get("VIXCLS"):
            snapshot["yield_curve_inverted"] = snapshot.get("T10Y2Y", 0.5) < 0

        logger.debug(f"Macro snapshot: {len(snapshot)} séries")
        return snapshot

    # ── News Sentiment ────────────────────────────────────────
    def get_news_sentiment_score(self, symbol: str) -> float:
        """Sentiment via Worker Finnhub (ou 0.0 si indisponible)."""
        try:
            sentiment = self.client.get_sentiment(symbol)
            if not sentiment:
                return 0.0
            bull = float(sentiment.get("buzz", {}).get("bullishPercent", 0.5) or 0.5)
            bear = float(sentiment.get("buzz", {}).get("bearishPercent", 0.5) or 0.5)
            return round(float(np.tanh((bull - bear) * 4)), 3)
        except Exception:
            return 0.0