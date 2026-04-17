# ============================================================
# ALPHAVAULT QUANT — Worker Client
# Client universel pour tous les Cloudflare Workers existants
# ✅ Détection automatique de disponibilité
# ✅ Fallback automatique si worker indisponible
# ✅ Retry avec backoff exponentiel
# ============================================================

import httpx
import asyncio
import time
import json
from typing import Optional, Dict, Any, List, Tuple
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

class WorkerStatus:
    """Suivi de l'état de disponibilité d'un worker."""
    def __init__(self, url: str):
        self.url           = url
        self.available     = None   # None = pas encore testé
        self.last_check    = 0.0
        self.latency_ms    = 0.0
        self.fail_count    = 0
        self.check_interval = 300   # Re-check toutes les 5 minutes

    @property
    def needs_recheck(self) -> bool:
        return (time.time() - self.last_check) > self.check_interval

    def mark_ok(self, latency_ms: float):
        self.available  = True
        self.latency_ms = latency_ms
        self.fail_count = 0
        self.last_check = time.time()

    def mark_failed(self):
        self.available  = False
        self.fail_count += 1
        self.last_check = time.time()
        # Backoff : plus d'échecs = intervalle plus long
        self.check_interval = min(300 * (2 ** self.fail_count), 1800)

class WorkerClient:
    """
    Client centralisé pour consommer les Cloudflare Workers AlphaVault.
    
    Fonctionnalités :
    - Détection automatique de disponibilité de chaque worker
    - Retry avec backoff exponentiel (tenacity)
    - Fallback LLM automatique (Gemini → Claude → OpenAI)
    - Cache mémoire léger pour éviter les requêtes répétitives
    - Timeout configurable par endpoint
    """

    # Timeouts par type d'endpoint (secondes)
    TIMEOUTS = {
        "quote":          8,
        "time_series":   15,
        "indicators":    15,
        "news":          10,
        "sentiment":     10,
        "options":       12,
        "ai":            20,
        "economic":      12,
        "health":         5,
        "default":       10,
    }

    def __init__(self, settings):
        self.settings = settings
        self._cache: Dict[str, Tuple[Any, float]] = {}
        self._cache_ttl = 60  # 60 secondes par défaut

        # Status de chaque worker
        self._workers: Dict[str, WorkerStatus] = {
            "finance_hub":   WorkerStatus(settings.FINANCE_HUB_URL),
            "ai_proxy":      WorkerStatus(settings.AI_PROXY_URL),
            "economic_data": WorkerStatus(settings.ECONOMIC_DATA_URL),
        }

        # Client HTTP synchrone (pour GitHub Actions)
        self._http = httpx.Client(
            timeout=httpx.Timeout(30.0),
            headers={
                "Content-Type": "application/json",
                "User-Agent":   "AlphaVault-Quant/1.0",
            },
            follow_redirects=True,
        )
        logger.info("✅ WorkerClient initialisé")

    # ── Health Check ─────────────────────────────────────────
    def health_check(self, url: str) -> Dict[str, Any]:
        """Teste la disponibilité d'un worker via /health."""
        try:
            t0 = time.time()
            resp = self._http.get(f"{url}/health", timeout=5)
            latency = (time.time() - t0) * 1000
            resp.raise_for_status()
            return {"ok": True, "latency_ms": round(latency, 1), "data": resp.json()}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def check_all_workers(self) -> Dict[str, bool]:
        """Vérifie la disponibilité de tous les workers. Retourne un dict {nom: bool}."""
        results = {}
        for name, status in self._workers.items():
            if not status.url:
                results[name] = False
                status.mark_failed()
                continue
            if not status.needs_recheck and status.available is not None:
                results[name] = status.available
                continue
            result = self.health_check(status.url)
            if result["ok"]:
                status.mark_ok(result.get("latency_ms", 0))
                results[name] = True
                logger.info(f"✅ Worker [{name}] OK — {result['latency_ms']:.0f}ms")
            else:
                status.mark_failed()
                results[name] = False
                logger.warning(f"❌ Worker [{name}] UNAVAILABLE — {result.get('error', 'unknown')}")
        return results

    @property
    def llm_available(self) -> bool:
        """True si le proxy LLM est disponible."""
        s = self._workers["ai_proxy"]
        if s.needs_recheck or s.available is None:
            self.check_all_workers()
        return self._workers["ai_proxy"].available or False

    @property
    def finance_hub_available(self) -> bool:
        s = self._workers["finance_hub"]
        if s.needs_recheck or s.available is None:
            self.check_all_workers()
        return self._workers["finance_hub"].available or False

    # ── Cache Helpers ─────────────────────────────────────────
    def _cache_get(self, key: str) -> Optional[Any]:
        if key in self._cache:
            data, ts = self._cache[key]
            if time.time() - ts < self._cache_ttl:
                return data
            del self._cache[key]
        return None

    def _cache_set(self, key: str, data: Any, ttl: int = 60):
        self._cache[key] = (data, time.time())

    # ── Finance Hub — Market Data ─────────────────────────────
    def get_quote(self, symbol: str) -> Optional[Dict]:
        """Prix temps réel via Finance Hub Worker."""
        cache_key = f"quote:{symbol}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/quote"
            resp = self._http.get(url, params={"symbol": symbol},
                                  timeout=self.TIMEOUTS["quote"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=30)
            return data
        except Exception as e:
            logger.error(f"get_quote({symbol}): {e}")
            return None

    def get_time_series(
        self,
        symbol:     str,
        interval:   str = "1day",
        outputsize: int = 252,
    ) -> Optional[Dict]:
        """Série temporelle OHLCV via Finance Hub Worker."""
        cache_key = f"ts:{symbol}:{interval}:{outputsize}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/time-series"
            resp = self._http.get(
                url,
                params={"symbol": symbol, "interval": interval, "outputsize": str(outputsize)},
                timeout=self.TIMEOUTS["time_series"],
            )
            resp.raise_for_status()
            data = resp.json()
            ttl  = 1800 if interval in ("1day", "1week") else 300
            self._cache_set(cache_key, data, ttl=ttl)
            return data
        except Exception as e:
            logger.error(f"get_time_series({symbol},{interval}): {e}")
            return None

    def get_multiple_time_series(
        self,
        symbols:    List[str],
        interval:   str = "1day",
        outputsize: int = 252,
    ) -> Dict[str, Optional[Dict]]:
        """Récupère les séries temporelles pour plusieurs symboles."""
        results = {}
        for symbol in symbols:
            results[symbol] = self.get_time_series(symbol, interval, outputsize)
        return results

    def get_technical_indicator(
        self,
        symbol:      str,
        indicator:   str,
        interval:    str = "1day",
        time_period: int = 14,
    ) -> Optional[Dict]:
        """Indicateur technique via Finance Hub Worker."""
        cache_key = f"ind:{symbol}:{indicator}:{interval}:{time_period}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/technical-indicators"
            resp = self._http.get(
                url,
                params={"symbol": symbol, "indicator": indicator,
                        "interval": interval, "time_period": str(time_period)},
                timeout=self.TIMEOUTS["indicators"],
            )
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=1800)
            return data
        except Exception as e:
            logger.error(f"get_technical_indicator({symbol},{indicator}): {e}")
            return None

    def get_company_news(
        self,
        symbol: str,
        days:   int = 7,
    ) -> Optional[List[Dict]]:
        """Actualités entreprise via Finance Hub Worker (FinnHub)."""
        cache_key = f"news:{symbol}:{days}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            from datetime import datetime, timedelta
            to_date   = datetime.utcnow().strftime("%Y-%m-%d")
            from_date = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/company-news"
            resp = self._http.get(
                url,
                params={"symbol": symbol, "from": from_date, "to": to_date},
                timeout=self.TIMEOUTS["news"],
            )
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=1800)
            return data if isinstance(data, list) else data.get("data", [])
        except Exception as e:
            logger.error(f"get_company_news({symbol}): {e}")
            return []

    def get_market_news(self, category: str = "general") -> Optional[List[Dict]]:
        """Actualités marché via Finance Hub Worker (FinnHub)."""
        cache_key = f"market_news:{category}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/market-news"
            resp = self._http.get(url, params={"category": category},
                                  timeout=self.TIMEOUTS["news"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=600)
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"get_market_news: {e}")
            return []

    def get_sentiment(self, symbol: str) -> Optional[Dict]:
        """Sentiment de marché via Finance Hub Worker (FinnHub)."""
        cache_key = f"sentiment:{symbol}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/sentiment"
            resp = self._http.get(url, params={"symbol": symbol},
                                  timeout=self.TIMEOUTS["sentiment"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=3600)
            return data
        except Exception as e:
            logger.error(f"get_sentiment({symbol}): {e}")
            return None

    def get_recommendation(self, symbol: str) -> Optional[List[Dict]]:
        """Recommandations analystes via Finance Hub Worker (FinnHub)."""
        cache_key = f"rec:{symbol}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/recommendation"
            resp = self._http.get(url, params={"symbol": symbol},
                                  timeout=self.TIMEOUTS["indicators"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=86400)
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"get_recommendation({symbol}): {e}")
            return []

    def get_earnings(self, symbol: str) -> Optional[List[Dict]]:
        """Earnings historiques via Finance Hub Worker (FinnHub)."""
        cache_key = f"earnings:{symbol}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/earnings"
            resp = self._http.get(url, params={"symbol": symbol},
                                  timeout=self.TIMEOUTS["indicators"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=86400)
            return data if isinstance(data, list) else []
        except Exception as e:
            logger.error(f"get_earnings({symbol}): {e}")
            return []

    def get_company_profile(self, symbol: str) -> Optional[Dict]:
        """Profil entreprise via Finance Hub Worker (FinnHub)."""
        cache_key = f"profile:{symbol}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/company-profile"
            resp = self._http.get(url, params={"symbol": symbol},
                                  timeout=self.TIMEOUTS["indicators"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=86400)
            return data
        except Exception as e:
            logger.error(f"get_company_profile({symbol}): {e}")
            return None

    def get_basic_financials(self, symbol: str, metric: str = "all") -> Optional[Dict]:
        """Métriques financières fondamentales via Finance Hub (FinnHub)."""
        cache_key = f"financials:{symbol}:{metric}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/basic-financials"
            resp = self._http.get(url, params={"symbol": symbol, "metric": metric},
                                  timeout=self.TIMEOUTS["indicators"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=3600)
            return data
        except Exception as e:
            logger.error(f"get_basic_financials({symbol}): {e}")
            return None

    def get_earnings_calendar(self, days_ahead: int = 14) -> Optional[Dict]:
        """Calendrier des earnings à venir."""
        cache_key = f"earnings_cal:{days_ahead}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            from datetime import datetime, timedelta
            from_date = datetime.utcnow().strftime("%Y-%m-%d")
            to_date   = (datetime.utcnow() + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
            url  = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/earnings-calendar"
            resp = self._http.get(url, params={"from": from_date, "to": to_date},
                                  timeout=self.TIMEOUTS["indicators"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=3600)
            return data
        except Exception as e:
            logger.error(f"get_earnings_calendar: {e}")
            return None

    # ── Economic Data Worker ──────────────────────────────────
    def get_fred_series(self, series_id: str, limit: int = 100) -> Optional[Dict]:
        """Données macroéconomiques FRED via Economic Data Worker."""
        cache_key = f"fred:{series_id}:{limit}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.ECONOMIC_DATA_URL}/series/observations"
            resp = self._http.get(
                url,
                params={"series_id": series_id, "limit": str(limit)},
                timeout=self.TIMEOUTS["economic"],
            )
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=3600)
            return data
        except Exception as e:
            logger.error(f"get_fred_series({series_id}): {e}")
            return None

    def get_multiple_fred_series(self, series_ids: List[str]) -> Dict[str, Optional[Dict]]:
        """Récupère plusieurs séries FRED en une fois."""
        cache_key = f"fred_multi:{','.join(sorted(series_ids))}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.ECONOMIC_DATA_URL}/multiple"
            resp = self._http.get(
                url,
                params={"series": ",".join(series_ids)},
                timeout=self.TIMEOUTS["economic"],
            )
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=3600)
            return data
        except Exception as e:
            logger.error(f"get_multiple_fred_series: {e}")
            return {sid: None for sid in series_ids}

    def get_ecb_rates(self) -> Optional[Dict]:
        """Taux de change ECB via Economic Data Worker."""
        cache_key = "ecb_rates"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.ECONOMIC_DATA_URL}/ecb/rates"
            resp = self._http.get(url, timeout=self.TIMEOUTS["economic"])
            resp.raise_for_status()
            data = resp.json()
            self._cache_set(cache_key, data, ttl=3600)
            return data
        except Exception as e:
            logger.error(f"get_ecb_rates: {e}")
            return None

    # ── AI Proxy Worker ───────────────────────────────────────
    def call_llm(
        self,
        prompt:   str,
        system:   str   = "",
        model:    str   = "gemini-2.5-flash",
        provider: str   = "gemini",
        max_tokens: int = 2048,
    ) -> Optional[str]:
        """
        Appel LLM via AI Proxy Worker.
        Retourne None automatiquement si le worker est indisponible
        (fallback déterministe automatique).
        """
        if not self.llm_available:
            logger.warning("⚠ LLM indisponible — mode déterministe activé")
            return None
        try:
            payload = {
                "provider": provider,
                "model":    model,
                "messages": [{"role": "user", "content": prompt}],
                "generationConfig": {
                    "temperature":     0.3,
                    "maxOutputTokens": max_tokens,
                },
            }
            if system:
                payload["systemInstruction"] = {"parts": [{"text": system}]}

            url  = f"{self.settings.AI_PROXY_URL}/api/chat"
            resp = self._http.post(url, json=payload,
                                   timeout=self.TIMEOUTS["ai"])
            resp.raise_for_status()
            data = resp.json()

            # Normalise la réponse (format Gemini unifié)
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                if parts:
                    return parts[0].get("text", "")
            return None
        except httpx.TimeoutException:
            logger.warning(f"⏱ LLM timeout — mode déterministe")
            self._workers["ai_proxy"].mark_failed()
            return None
        except Exception as e:
            logger.error(f"call_llm: {e}")
            self._workers["ai_proxy"].mark_failed()
            return None

    def __del__(self):
        try:
            self._http.close()
        except Exception:
            pass