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

    def batch_ohlcv_download(
    self,
    symbols:  List[str],
    interval: str = "1day",
    period:   str = "1y",
) -> Dict[str, Optional[pd.DataFrame]]:
    """Télécharge OHLCV pour tous les symboles en batch yfinance.
    Gère les deux formats MultiIndex selon la version yfinance :
    - (Ticker, PriceType) : raw['AAPL']['Close']
    - (PriceType, Ticker) : raw['Close']['AAPL']
    Fallback individuel si le batch échoue."""
    if not YFINANCE_AVAILABLE:
        logger.warning("[Batch] yfinance not available")
        return {s: None for s in symbols}

    if not symbols:
        return {}

    YF_IV = {
        "5min":  ("5m",  "5d"),
        "15min": ("15m", "30d"),
        "1h":    ("1h",  "60d"),
        "4h":    ("1h",  "60d"),
        "1day":  ("1d",  period),
        "1week": ("1wk", "5y"),
    }
    yf_interval, yf_period = YF_IV.get(interval, ("1d", period))

    logger.info(
        f"[Batch] {len(symbols)} symbols | "
        f"interval={yf_interval} | period={yf_period}"
    )

    # ── Cas d'un seul symbole : bypass de la complexité MultiIndex ──
    if len(symbols) == 1:
        sym = symbols[0]
        df  = self._get_ohlcv_yfinance(sym, interval, 500)
        return {sym: df}

    # ── Batch multi-symboles ────────────────────────────────────────
    try:
        import time as _time
        t0 = _time.time()

        raw = yf.download(
            tickers     = symbols,      # Liste Python directe (pas de join)
            period      = yf_period,
            interval    = yf_interval,
            group_by    = "ticker",
            auto_adjust = True,
            prepost     = False,
            progress    = False,
            threads     = True,
        )

        elapsed = _time.time() - t0
        logger.info(f"[Batch] Download done in {elapsed:.1f}s | shape={raw.shape}")

        if raw is None or raw.empty:
            logger.warning("[Batch] Empty result — falling back to individual")
            return self._batch_fallback(symbols, interval)

        # ── Détection du format MultiIndex ──────────────────────────
        if not isinstance(raw.columns, pd.MultiIndex):
            logger.warning("[Batch] No MultiIndex columns — fallback")
            return self._batch_fallback(symbols, interval)

        level_0_vals = set(str(v) for v in raw.columns.get_level_values(0).unique())
        price_types  = {
            'Open','High','Low','Close','Volume',
            'Adj Close','adj close','open','high','low','close','volume',
        }
        # Si le niveau 0 contient des prix → format (PriceType, Ticker)
        price_in_level0 = bool(level_0_vals & price_types)

        result: Dict[str, Optional[pd.DataFrame]] = {}

        for sym in symbols:
            try:
                # ── Extraction selon le format ───────────────────────
                if price_in_level0:
                    # Format (PriceType, Ticker) → ex: raw['Close']['AAPL']
                    level_1_syms = set(
                        str(v) for v in raw.columns.get_level_values(1).unique()
                    )
                    if sym not in level_1_syms:
                        result[sym] = None
                        continue
                    df_sym = raw.xs(sym, axis=1, level=1).copy()
                else:
                    # Format (Ticker, PriceType) → ex: raw['AAPL']['Close']
                    level_0_syms = set(
                        str(v) for v in raw.columns.get_level_values(0).unique()
                    )
                    if sym not in level_0_syms:
                        result[sym] = None
                        continue
                    df_sym = raw[sym].copy()

                # ── Normalisation des colonnes ───────────────────────
                df_sym = df_sym.reset_index()

                # Aplatir les colonnes si encore MultiIndex
                if isinstance(df_sym.columns, pd.MultiIndex):
                    df_sym.columns = [
                        str(col[0]) if col[1] == '' else str(col[0])
                        for col in df_sym.columns
                    ]

                # Lowercase + underscore
                df_sym.columns = [
                    str(c).lower().replace(" ", "_") for c in df_sym.columns
                ]

                # Rename date/index → datetime
                for col in ("date", "index", "datetime"):
                    if col in df_sym.columns:
                        if col != "datetime":
                            df_sym = df_sym.rename(columns={col: "datetime"})
                        break

                # Adj_close → close si nécessaire
                if "adj_close" in df_sym.columns and "close" not in df_sym.columns:
                    df_sym = df_sym.rename(columns={"adj_close": "close"})

                # ── Datetime normalization ───────────────────────────
                if "datetime" in df_sym.columns:
                    df_sym["datetime"] = pd.to_datetime(df_sym["datetime"])
                    try:
                        if df_sym["datetime"].dt.tz is not None:
                            df_sym["datetime"] = df_sym["datetime"].dt.tz_localize(None)
                    except Exception:
                        pass

                # ── Resample 4h depuis 1h ────────────────────────────
                if (interval == "4h" and yf_interval == "1h"
                        and "datetime" in df_sym.columns):
                    df_sym = df_sym.set_index("datetime")
                    df_sym = df_sym.resample("4h").agg({
                        "open":  "first",
                        "high":  "max",
                        "low":   "min",
                        "close": "last",
                        "volume":"sum",
                    }).dropna().reset_index()

                # ── Conversion numérique ─────────────────────────────
                for col in ["open", "high", "low", "close", "volume"]:
                    if col in df_sym.columns:
                        df_sym[col] = pd.to_numeric(df_sym[col], errors="coerce")

                # ── Nettoyage ────────────────────────────────────────
                df_sym = df_sym.dropna(subset=["close"])

                # Suppression doublons de timestamps
                if "datetime" in df_sym.columns:
                    df_sym = df_sym.drop_duplicates(subset=["datetime"])
                    df_sym = df_sym.sort_values("datetime").reset_index(drop=True)

                # Filtre valeurs aberrantes (prix ≤ 0)
                if "close" in df_sym.columns:
                    df_sym = df_sym[df_sym["close"] > 0]

                result[sym] = df_sym.reset_index(drop=True) if len(df_sym) >= 5 else None

            except Exception as e:
                logger.debug(f"[Batch] {sym}: {type(e).__name__}: {e}")
                result[sym] = None

        n_ok   = sum(1 for v in result.values() if v is not None)
        n_fail = len(symbols) - n_ok
        logger.info(f"[Batch] {n_ok}/{len(symbols)} OK | {n_fail} failed")

        # Si trop d'échecs (>50%), fallback individuel pour les manquants
        if n_fail > len(symbols) * 0.50:
            logger.warning(
                f"[Batch] >50% failures — retrying failed symbols individually"
            )
            failed_syms = [s for s, v in result.items() if v is None]
            fallback    = self._batch_fallback(failed_syms, interval)
            result.update(fallback)

        return result

    except Exception as e:
        logger.error(f"[Batch] Fatal error: {type(e).__name__}: {e}")
        import traceback
        logger.debug(traceback.format_exc())
        return self._batch_fallback(symbols, interval)

def _batch_fallback(
    self,
    symbols:  List[str],
    interval: str,
    bars:     int = 252,
) -> Dict[str, Optional[pd.DataFrame]]:
    """
    Fallback individuel quand le batch yfinance échoue.
    Télécharge chaque symbole séparément.
    """
    logger.info(f"[Batch] Individual fallback | {len(symbols)} symbols")
    result = {}
    for sym in symbols:
        try:
            df = self._get_ohlcv_yfinance(sym, interval, bars)
            result[sym] = df
            if df is not None:
                logger.debug(f"[Fallback] {sym}: {len(df)} bars")
        except Exception as e:
            logger.debug(f"[Fallback] {sym}: {e}")
            result[sym] = None
    n_ok = sum(1 for v in result.values() if v is not None)
    logger.info(f"[Batch] Fallback done | {n_ok}/{len(symbols)} OK")
    return result

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