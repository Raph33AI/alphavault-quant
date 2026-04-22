# ============================================================
# ALPHAVAULT QUANT — Worker Client v2.0
# ✅ Multi-provider LLM : Gemini → Groq → Ollama → Deterministic
# ✅ Groq free tier (llama3.1-8b, 14 400 tok/min)
# ✅ Ollama local sur Oracle VM (phi3:mini, phi3, gemma2)
# ✅ Rotation automatique en cas de quota dépassé
# ============================================================

import httpx
import time
import json
from typing import Optional, Dict, Any, List, Tuple
from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

class WorkerStatus:
    def __init__(self, url: str):
        self.url            = url
        self.available      = None
        self.last_check     = 0.0
        self.latency_ms     = 0.0
        self.fail_count     = 0
        self.check_interval = 300

    @property
    def needs_recheck(self) -> bool:
        return (time.time() - self.last_check) > self.check_interval

    def mark_ok(self, latency_ms: float):
        self.available      = True
        self.latency_ms     = latency_ms
        self.fail_count     = 0
        self.last_check     = time.time()
        self.check_interval = 300

    def mark_failed(self):
        self.available       = False
        self.fail_count     += 1
        self.last_check      = time.time()
        self.check_interval  = min(300 * (2 ** self.fail_count), 1800)

class WorkerClient:
    """
    Client centralisé pour tous les LLMs et Workers AlphaVault.

    Ordre de priorité LLM :
    1. Gemini via Cloudflare proxy   (primaire)
    2. Groq API free tier            (fallback quota Gemini)
    3. Ollama local Oracle VM        (fallback total)
    4. None → mode déterministe      (fallback final)
    """

    TIMEOUTS = {
        "quote":        8,
        "time_series": 15,
        "indicators":  15,
        "news":        10,
        "sentiment":   10,
        "ai":          25,
        "economic":    12,
        "health":       5,
        "groq":        20,
        "ollama":      60,
        "default":     10,
    }

    # ── Groq modèles disponibles (free tier) ─────────────────
    GROQ_MODELS = {
        "fast":    "llama3-8b-8192",
        "smart":   "llama3-70b-8192",
        "default": "llama3-8b-8192",
    }

    # ── Ollama modèles (Oracle AMD Micro 4GB) ─────────────────
    OLLAMA_MODELS = {
        "default": "phi3:mini",   # 3.8B Q4, ~2.3GB → OK sur 4GB
        "fast":    "phi3:mini",
        "smart":   "gemma2:2b",   # 2B Q4, ~1.5GB
    }

    def __init__(self, settings):
        self.settings = settings
        self._cache: Dict[str, Tuple[Any, float]] = {}
        self._cache_ttl = 60

        # Workers Cloudflare
        self._workers: Dict[str, WorkerStatus] = {
            "finance_hub":   WorkerStatus(settings.FINANCE_HUB_URL),
            "ai_proxy":      WorkerStatus(settings.AI_PROXY_URL),
            "economic_data": WorkerStatus(settings.ECONOMIC_DATA_URL),
        }

        # LLM provider status
        self._llm_provider_status: Dict[str, Dict] = {
            "gemini": {"available": None, "quota_reset": 0, "calls_today": 0},
            "groq":   {"available": None, "quota_reset": 0, "calls_today": 0},
            "ollama": {"available": None, "quota_reset": 0, "calls_today": 0},
        }

        # HTTP client
        self._http = httpx.Client(
            timeout=httpx.Timeout(30.0),
            headers={
                "Content-Type": "application/json",
                "User-Agent":   "AlphaVault-Quant/2.0",
            },
            follow_redirects=True,
        )

        # Groq API key (from settings ou env)
        self._groq_key   = getattr(settings, "GROQ_API_KEY",   None)
        self._ollama_url = getattr(settings, "OLLAMA_URL",     "http://localhost:11434")

        logger.info(
            f"✅ WorkerClient v2.0 | "
            f"Groq: {'✅' if self._groq_key else '❌'} | "
            f"Ollama: {self._ollama_url}"
        )

    # ════════════════════════════════════════════════════════
    # HEALTH CHECKS
    # ════════════════════════════════════════════════════════
    def health_check(self, url: str) -> Dict[str, Any]:
        try:
            t0   = time.time()
            resp = self._http.get(f"{url}/health", timeout=5)
            lat  = (time.time() - t0) * 1000
            resp.raise_for_status()
            return {"ok": True, "latency_ms": round(lat, 1), "data": resp.json()}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def check_all_workers(self) -> Dict[str, bool]:
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
            else:
                status.mark_failed()
                results[name] = False
        return results

    @property
    def llm_available(self) -> bool:
        """True si AU MOINS UN provider LLM est disponible."""
        # Gemini
        s = self._workers["ai_proxy"]
        if s.needs_recheck or s.available is None:
            self.check_all_workers()
        if self._workers["ai_proxy"].available:
            return True
        # Groq
        if self._groq_key:
            return True
        # Ollama
        if self._check_ollama_available():
            return True
        return False

    @property
    def finance_hub_available(self) -> bool:
        s = self._workers["finance_hub"]
        if s.needs_recheck or s.available is None:
            self.check_all_workers()
        return self._workers["finance_hub"].available or False

    # ════════════════════════════════════════════════════════
    # MULTI-PROVIDER LLM — POINT D'ENTRÉE PRINCIPAL
    # ════════════════════════════════════════════════════════
    def call_llm(
        self,
        prompt:     str,
        system:     str  = "",
        model:      str  = "auto",
        provider:   str  = "auto",
        max_tokens: int  = 2048,
    ) -> Optional[str]:
        """
        Appel LLM avec fallback automatique multi-provider.

        Ordre : Gemini → Groq → Ollama → None (déterministe)

        Returns None si tous les providers sont indisponibles.
        Jamais d'exception levée — le système continue en déterministe.
        """
        providers = self._get_provider_order(provider)

        if not providers:
            logger.warning("⚠ Aucun provider LLM disponible → mode déterministe")
            return None

        for prov in providers:
            try:
                result = self._call_provider(
                    provider   = prov,
                    prompt     = prompt,
                    system     = system,
                    max_tokens = max_tokens,
                )
                if result:
                    self._llm_provider_status[prov]["calls_today"] = \
                        self._llm_provider_status[prov].get("calls_today", 0) + 1
                    logger.debug(f"✅ LLM [{prov}] répondu | {len(result)} chars")
                    return result
            except Exception as e:
                logger.warning(f"⚠ Provider [{prov}] failed: {type(e).__name__}: {e}")
                self._llm_provider_status[prov]["available"] = False
                continue

        logger.warning("⚠ Tous les providers LLM ont échoué → mode déterministe")
        return None

    # ── Ordre des providers ────────────────────────────────
    def _get_provider_order(self, preferred: str = "auto") -> List[str]:
        """
        FIX v2.1 : Ollama-only mode.
        
        Avant : Gemini (429) → Groq (400) → Ollama → Déterministe
                = 4s timeout × 350 symboles = 23 min perdues
        
        Après : Ollama (Oracle local si accessible) → Déterministe
                = 1.1s si disponible, sinon immédiat déterministe
        
        Depuis GitHub Actions : Ollama = localhost:11434 non accessible
        → retourne [] → mode déterministe immédiat (rapide + fiable)
        
        Sur Oracle (standalone trader) : Ollama accessible ✅
        """
        order = []

        # ── Ollama UNIQUEMENT (pas de Gemini, pas de Groq) ────────
        # Sur GitHub Actions : _check_ollama_available() → False (timeout 3s)
        # Sur Oracle         : _check_ollama_available() → True ✅
        if self._check_ollama_available():
            order.append("ollama")
            logger.debug("✅ Provider: Ollama local Oracle")
        else:
            logger.debug("ℹ Ollama non accessible → mode déterministe")

        # Si preferred spécifié et disponible → priorité
        if preferred not in ("auto", "ollama") and preferred in order:
            order.remove(preferred)
            order.insert(0, preferred)

        return order

    # ── Dispatcher par provider ────────────────────────────
    def _call_provider(
        self,
        provider:   str,
        prompt:     str,
        system:     str,
        max_tokens: int,
    ) -> Optional[str]:
        if provider == "gemini":
            return self._call_gemini(prompt, system, max_tokens)
        elif provider == "groq":
            return self._call_groq(prompt, system, max_tokens)
        elif provider == "ollama":
            return self._call_ollama(prompt, system, max_tokens)
        return None

    # ════════════════════════════════════════════════════════
    # PROVIDER 1 — GEMINI (Cloudflare Proxy)
    # ════════════════════════════════════════════════════════
    def _call_gemini(
        self,
        prompt:     str,
        system:     str,
        max_tokens: int,
    ) -> Optional[str]:
        """Appel Gemini via le proxy Cloudflare Workers."""
        url = f"{self.settings.AI_PROXY_URL}/api/chat"
        payload = {
            "model":   "gemini-2.5-flash",
            "messages": [{"role": "user", "content": prompt}],
            "generationConfig": {
                "temperature":     0.3,
                "maxOutputTokens": max_tokens,
            },
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}

        resp = self._http.post(url, json=payload, timeout=self.TIMEOUTS["ai"])
        resp.raise_for_status()
        data = resp.json()

        # Vérif quota (429)
        if resp.status_code == 429:
            logger.warning("⚠ Gemini 429 — quota dépassé, switch Groq")
            self._workers["ai_proxy"].mark_failed()
            return None

        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            if parts:
                return parts[0].get("text")
        return None

    # ════════════════════════════════════════════════════════
    # PROVIDER 2 — GROQ (Free Tier)
    # ════════════════════════════════════════════════════════
    def _call_groq(
        self,
        prompt:     str,
        system:     str,
        max_tokens: int,
    ) -> Optional[str]:
        """
        Appel Groq API (OpenAI-compatible).
        Free tier : 14 400 tokens/minute, llama3-8b-8192.
        Largement suffisant pour 1 décision/30s.
        """
        if not self._groq_key:
            return None

        url = "https://api.groq.com/openai/v1/chat/completions"

        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        payload = {
            "model":       self.GROQ_MODELS["default"],
            "messages":    messages,
            "max_tokens":  min(max_tokens, 4096),  # Groq limit
            "temperature": 0.3,
            "stream":      False,
        }

        resp = self._http.post(
            url,
            json    = payload,
            timeout = self.TIMEOUTS["groq"],
            headers = {
                "Authorization": f"Bearer {self._groq_key}",
                "Content-Type":  "application/json",
            },
        )

        if resp.status_code == 429:
            logger.warning("⚠ Groq 429 — rate limit, switch Ollama")
            return None

        resp.raise_for_status()
        data = resp.json()

        choices = data.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content")
            if content:
                logger.debug(
                    f"✅ Groq [{self.GROQ_MODELS['default']}] | "
                    f"tokens={data.get('usage', {}).get('total_tokens', '?')}"
                )
                return content
        return None

    # ════════════════════════════════════════════════════════
    # PROVIDER 3 — OLLAMA (Local Oracle VM)
    # ════════════════════════════════════════════════════════
    def _call_ollama(
        self,
        prompt:     str,
        system:     str,
        max_tokens: int,
    ) -> Optional[str]:
        """
        Appel Ollama local Oracle A1.
        Modèles disponibles : llama3.2:3b (primary) | qwen2.5:7b | mistral:7b
        Latence mesurée : 1141ms ✅
        """
        ollama_url = getattr(self, '_ollama_url',
                     getattr(self.settings, 'ollama_host', 'http://localhost:11434'))

        if not ollama_url:
            return None

        url = f"{ollama_url}/api/generate"

        # Modèle primaire Oracle (llama3.2:3b — 1141ms)
        model = getattr(self.settings, 'OLLAMA_MODEL',
                getattr(self.settings, 'ollama_model', 'llama3.2:3b-instruct-q4_K_M'))

        full_prompt = f"{system}\n\n{prompt}" if system else prompt
        payload = {
            "model":  model,
            "prompt": full_prompt,
            "stream": False,
            "options": {
                "temperature":  float(getattr(self.settings, 'ollama_temperature', 0.3)),
                "num_predict":  min(max_tokens, 512),
                "num_ctx":      2048,
            },
        }

        resp = self._http.post(url, json=payload, timeout=self.TIMEOUTS["ollama"])
        resp.raise_for_status()
        data = resp.json()

        response = data.get("response", "").strip()
        if response:
            logger.info(f"✅ Ollama [{model}] Oracle | {len(response)} chars")
            return response
        return None

    def _check_ollama_available(self) -> bool:
        """Vérifie si Ollama est actif sur Oracle VM."""
        try:
            resp = self._http.get(
                f"{self._ollama_url}/api/tags",
                timeout=3
            )
            if resp.status_code == 200:
                models = [m["name"] for m in resp.json().get("models", [])]
                return any(
                    m.startswith("phi3") or m.startswith("gemma")
                    for m in models
                )
        except Exception:
            pass
        return False

    def get_llm_status(self) -> Dict:
        """Retourne le statut complet des providers LLM."""
        providers = self._get_provider_order()
        return {
            "available_providers": providers,
            "primary":            providers[0] if providers else "none",
            "gemini_ok":          self._workers["ai_proxy"].available or False,
            "groq_ok":            bool(self._groq_key),
            "ollama_ok":          self._check_ollama_available(),
            "deterministic_always": True,
        }

    # ════════════════════════════════════════════════════════
    # CACHE HELPERS
    # ════════════════════════════════════════════════════════
    def _cache_get(self, key: str) -> Optional[Any]:
        if key in self._cache:
            data, ts = self._cache[key]
            if time.time() - ts < self._cache_ttl:
                return data
            del self._cache[key]
        return None

    def _cache_set(self, key: str, data: Any, ttl: int = 60):
        self._cache[key] = (data, time.time())

    # ════════════════════════════════════════════════════════
    # FINANCE HUB — MARKET DATA
    # ════════════════════════════════════════════════════════
    def get_quote(self, symbol: str) -> Optional[Dict]:
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
        cache_key = f"ts:{symbol}:{interval}:{outputsize}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            url  = f"{self.settings.FINANCE_HUB_URL}/api/time-series"
            resp = self._http.get(
                url,
                params={"symbol": symbol, "interval": interval,
                        "outputsize": str(outputsize)},
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
        return {s: self.get_time_series(s, interval, outputsize) for s in symbols}

    def get_technical_indicator(
        self,
        symbol:      str,
        indicator:   str,
        interval:    str = "1day",
        time_period: int = 14,
    ) -> Optional[Dict]:
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

    def get_company_news(self, symbol: str, days: int = 7) -> Optional[List[Dict]]:
        cache_key = f"news:{symbol}:{days}"
        cached = self._cache_get(cache_key)
        if cached:
            return cached
        try:
            from datetime import datetime, timedelta
            to_d   = datetime.utcnow().strftime("%Y-%m-%d")
            from_d = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
            url    = f"{self.settings.FINANCE_HUB_URL}/api/finnhub/company-news"
            resp   = self._http.get(
                url,
                params={"symbol": symbol, "from": from_d, "to": to_d},
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

    # ════════════════════════════════════════════════════════
    # ECONOMIC DATA WORKER
    # ════════════════════════════════════════════════════════
    def get_fred_series(self, series_id: str, limit: int = 100) -> Optional[Dict]:
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

    def __del__(self):
        try:
            self._http.close()
        except Exception:
            pass