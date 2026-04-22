# ============================================================
# backend/core/ibkr_executor.py v3.0
# IBKR Executor via Client Portal REST API (IBeam)
# ============================================================
# v3.0 : Support complet multi-exchanges internationaux
#        Mapping yfinance ticker suffix → IBKR exchange code
#        Résolution conid améliorée pour symboles internationaux
#        Architecture : yfinance (data) + IBKR (ordres seul)
# ============================================================

import os
import time
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

import httpx
from loguru import logger

# ── Exchanges valides — TOUS LES MARCHÉS MONDIAUX ──────────
VALID_EXCHANGES = {
    # ── Amérique du Nord ────────────────────────────────────
    "NASDAQ", "NYSE", "SMART", "ARCA", "AMEX", "BATS", "ISLAND",
    "TSX",        # Toronto Stock Exchange
    "TSXV",       # TSX Venture Exchange
    "BOVESPA",    # B3 Brazil
    "MX",         # Montreal Exchange (options)

    # ── Europe ───────────────────────────────────────────────
    "SBF",        # Euronext Paris
    "AEB",        # Euronext Amsterdam
    "EBR",        # Euronext Brussels
    "IBIS",       # Frankfurt / XETRA (Deutsche Börse)
    "FWB",        # Frankfurt Wertpapierbörse
    "LSE",        # London Stock Exchange
    "LSEETF",     # LSE ETFs
    "BVME",       # Borsa Italiana (Milan)
    "BME",        # Bolsa de Madrid
    "EBS",        # Swiss Exchange (SIX)
    "VSE",        # Vienna Stock Exchange
    "OSE",        # Oslo Stock Exchange
    "HEX",        # Helsinki Stock Exchange
    "SFB",        # Stockholm Stock Exchange
    "CPH",        # Copenhagen Stock Exchange
    "PSE",        # Prague Stock Exchange (PX)

    # ── Asie-Pacifique ───────────────────────────────────────
    "TSEJ",       # Tokyo Stock Exchange
    "HKEX",       # Hong Kong Stock Exchange
    "ASX",        # Australian Securities Exchange
    "SGX",        # Singapore Exchange
    "KSE",        # Korea Stock Exchange
    "TWSE",       # Taiwan Stock Exchange
    "NSE",        # National Stock Exchange India
    "BSE",        # Bombay Stock Exchange

    # ── Moyen-Orient / Afrique ───────────────────────────────
    "TASE",       # Tel Aviv Stock Exchange
}

# ── Mapping : suffixe yfinance → code exchange IBKR ────────
# yfinance utilise des suffixes pour identifier les exchanges
# IBKR utilise ses propres codes d'exchange
YFINANCE_SUFFIX_TO_IBKR = {
    # Europe
    ".PA":  "SBF",      # Paris  (MC.PA → SBF)
    ".AS":  "AEB",      # Amsterdam (ASML.AS → AEB)
    ".BR":  "EBR",      # Brussels
    ".DE":  "IBIS",     # Frankfurt/XETRA (SAP.DE → IBIS)
    ".F":   "FWB",      # Frankfurt alt
    ".L":   "LSE",      # London (HSBA.L → LSE)
    ".MI":  "BVME",     # Milan (ENI.MI → BVME)
    ".MC":  "BME",      # Madrid (ITX.MC → BME)
    ".SW":  "EBS",      # Swiss (NESN.SW → EBS)
    ".VI":  "VSE",      # Vienna
    ".OL":  "OSE",      # Oslo (EQNR.OL → OSE)
    ".HE":  "HEX",      # Helsinki
    ".ST":  "SFB",      # Stockholm (VOLV-B.ST → SFB)
    ".CO":  "CPH",      # Copenhagen (NOVO-B.CO → CPH)
    ".TO":  "TSX",      # Toronto (SHOP.TO → TSX)
    ".V":   "TSXV",     # TSX Venture

    # Asie-Pacifique
    ".T":   "TSEJ",     # Tokyo (7203.T → TSEJ)
    ".HK":  "HKEX",     # Hong Kong (0700.HK → HKEX)
    ".AX":  "ASX",      # Australia (CBA.AX → ASX)
    ".SI":  "SGX",      # Singapore (D05.SI → SGX)
    ".KS":  "KSE",      # Korea (005930.KS → KSE)
    ".TW":  "TWSE",     # Taiwan (2330.TW → TWSE)
    ".NS":  "NSE",      # India NSE (RELIANCE.NS → NSE)
    ".BO":  "BSE",      # India BSE

    # Amérique Latine
    ".SA":  "BOVESPA",  # Brazil (PETR4.SA → BOVESPA)

    # Moyen-Orient
    ".TA":  "TASE",     # Tel Aviv (TEVA.TA → TASE)
}

# ── Mapping types d'ordre (REST API IBKR) ─────────────────
ORDER_TYPE_MAP = {
    "MKT":    "MKT",
    "MARKET": "MKT",
    "LMT":    "LMT",
    "LIMIT":  "LMT",
    "STP":    "STP",
    "STOP":   "STP",
    "STPLMT": "STPLMT",
}

# ── Devises par exchange (pour information) ─────────────────
EXCHANGE_CURRENCY = {
    "NYSE": "USD", "NASDAQ": "USD", "ARCA": "USD", "SMART": "USD",
    "TSX": "CAD", "BOVESPA": "BRL",
    "SBF": "EUR", "AEB": "EUR", "EBR": "EUR", "IBIS": "EUR",
    "BVME": "EUR", "BME": "EUR",
    "LSE": "GBP", "LSEETF": "GBP",
    "EBS": "CHF",
    "OSE": "NOK", "SFB": "SEK", "HEX": "EUR", "CPH": "DKK",
    "TSEJ": "JPY",
    "HKEX": "HKD",
    "ASX": "AUD",
    "SGX": "SGD",
    "KSE": "KRW",
    "TWSE": "TWD",
    "NSE": "INR", "BSE": "INR",
    "TASE": "ILS",
}

def parse_yfinance_ticker(ticker: str) -> Tuple[str, Optional[str], Optional[str]]:
    """
    Parse un ticker yfinance pour extraire :
    - Le symbole IBKR (sans suffixe)
    - L'exchange IBKR correspondant
    - La devise

    Exemples :
        "AAPL"    → ("AAPL", "SMART",  "USD")
        "MC.PA"   → ("MC",   "SBF",    "EUR")
        "7203.T"  → ("7203", "TSEJ",   "JPY")
        "HSBA.L"  → ("HSBA", "LSE",    "GBP")
        "SAP.DE"  → ("SAP",  "IBIS",   "EUR")
        "SHOP.TO" → ("SHOP", "TSX",    "CAD")
    """
    ticker = ticker.upper().strip()

    # Cherche un suffixe connu (du plus long au plus court)
    for suffix, ibkr_exchange in sorted(
        YFINANCE_SUFFIX_TO_IBKR.items(),
        key=lambda x: len(x[0]),
        reverse=True
    ):
        if ticker.endswith(suffix.upper()):
            symbol   = ticker[: -len(suffix)]
            currency = EXCHANGE_CURRENCY.get(ibkr_exchange, "USD")
            return symbol, ibkr_exchange, currency

    # Pas de suffixe → exchange US par défaut
    return ticker, "SMART", "USD"

class IBKRExecutor:
    """
    Exécuteur d'ordres IBKR via Client Portal REST API (IBeam).

    v3.0 : Support multi-exchanges mondial
           Architecture : yfinance (data) + IBKR (ordres seul)
           Mapping automatique ticker yfinance → IBKR exchange
           Résolution conid pour symboles internationaux
    """

    def __init__(self):
        _host = os.environ.get("IBKR_HOST", "localhost")
        _port = os.environ.get("IBKR_PORT", "5055")
        self.ibeam_url = os.environ.get(
            "IBEAM_BASE_URL",
            f"https://{_host}:{_port}"
        )
        self.account = os.environ.get("IBKR_ACCOUNT",   "DUM895161")
        self.dry_run = os.environ.get("DRY_RUN", "true").lower() == "true"

        # Client httpx partagé (SSL non vérifié — cert auto-signé IBeam)
        self._http      = httpx.Client(verify=False, timeout=15)
        self._connected = False
        self._orders: List[Dict] = []

        # Cache conid pour éviter les requêtes répétées
        self._conid_cache: Dict[str, Optional[int]] = {}

        logger.debug(
            f"IBKRExecutor v3.0 init | ibeam={self.ibeam_url} "
            f"account={self.account} dry_run={self.dry_run}"
        )

    # ════════════════════════════════════════════════════════
    # CONNEXION / AUTH
    # ════════════════════════════════════════════════════════

    def connect(self, timeout: int = 15) -> bool:
        """
        Vérifie la session IBeam et marque le client comme connecté.
        Pas de socket — juste un GET sur /iserver/auth/status.
        """
        if self.dry_run:
            logger.info("🧪 DRY_RUN=True — connexion simulée")
            self._connected = True
            return True

        logger.info(f"🔌 Vérification session IBeam → {self.ibeam_url}")
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/auth/status",
                timeout=timeout
            )
            data = r.json()
            authenticated = data.get("authenticated", False)

            if authenticated:
                self._connected = True
                logger.info(
                    f"✅ IBeam connecté | authenticated={authenticated} | "
                    f"competing={data.get('competing', False)}"
                )
                self._log_account_summary()
                return True
            else:
                logger.error(f"❌ IBeam non authentifié | réponse: {data}")
                self._connected = False
                return False

        except Exception as e:
            logger.error(f"❌ Connexion IBeam échouée: {type(e).__name__}: {e}")
            self._connected = False
            return False

    def disconnect(self):
        if self._http:
            self._http.close()
        self._connected = False
        logger.info("🔌 IBKRExecutor déconnecté")

    def is_connected(self) -> bool:
        if self.dry_run:
            return True
        return self._connected and self._check_auth_live()

    def _check_auth_live(self) -> bool:
        try:
            r = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/auth/status",
                timeout=5
            )
            return r.status_code == 200 and r.json().get("authenticated", False)
        except Exception:
            return False

    def tickle(self):
        try:
            r = self._http.get(f"{self.ibeam_url}/v1/api/tickle", timeout=10)
            logger.debug(f"IBeam tickle: {r.status_code}")
        except Exception as e:
            logger.debug(f"tickle: {e}")

    # ════════════════════════════════════════════════════════
    # RÉSOLUTION CONID — INTERNATIONAL
    # ════════════════════════════════════════════════════════

    def get_conid(
        self,
        ticker: str,
        force_exchange: Optional[str] = None,
    ) -> Optional[int]:
        """
        Résout un ticker yfinance → conid IBKR.

        Gère automatiquement les tickers internationaux :
            "MC.PA"   → cherche "MC" sur exchange SBF
            "7203.T"  → cherche "7203" sur exchange TSEJ
            "AAPL"    → cherche "AAPL" sur SMART (US)

        Args:
            ticker:         Ticker yfinance (ex: "MC.PA", "AAPL", "7203.T")
            force_exchange: Override de l'exchange IBKR si nécessaire
        """
        # Cache
        cache_key = f"{ticker}:{force_exchange or ''}"
        if cache_key in self._conid_cache:
            cached = self._conid_cache[cache_key]
            logger.debug(f"conid({ticker}): {cached} [cache]")
            return cached

        # Parse le ticker yfinance
        ibkr_symbol, detected_exchange, currency = parse_yfinance_ticker(ticker)
        target_exchange = force_exchange or detected_exchange

        logger.debug(
            f"Résolution conid | ticker={ticker} → "
            f"symbol={ibkr_symbol} exchange={target_exchange} currency={currency}"
        )

        conid = (
            self._get_conid_trsrv(ibkr_symbol, target_exchange)
            or self._get_conid_secdef(ibkr_symbol, target_exchange)
        )

        self._conid_cache[cache_key] = conid
        if conid:
            logger.info(
                f"✅ conid({ticker}): {conid} | "
                f"symbol={ibkr_symbol} exchange={target_exchange} currency={currency}"
            )
        else:
            logger.error(f"❌ conid introuvable pour {ticker} ({ibkr_symbol}@{target_exchange})")

        return conid

    def _get_conid_trsrv(
        self,
        symbol: str,
        target_exchange: str,
    ) -> Optional[int]:
        """Méthode 1 : /trsrv/stocks — priorité exchange cible."""
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/trsrv/stocks",
                params={"symbols": symbol},
                timeout=10
            )
            data = r.json()

            # Priorité 1 : exchange exact demandé
            for item in data.get(symbol, []):
                for contract in item.get("contracts", []):
                    exch = contract.get("exchange", "")
                    if exch == target_exchange:
                        conid = contract["conid"]
                        logger.debug(f"  trsrv: {conid} via {exch} [exact match]")
                        return conid

            # Priorité 2 : SMART (routing automatique IBKR)
            if target_exchange in {"NASDAQ", "NYSE", "ARCA", "AMEX", "SMART"}:
                for item in data.get(symbol, []):
                    for contract in item.get("contracts", []):
                        exch = contract.get("exchange", "")
                        if exch == "SMART":
                            conid = contract["conid"]
                            logger.debug(f"  trsrv: {conid} via SMART [US fallback]")
                            return conid

            # Priorité 3 : Premier contrat dans VALID_EXCHANGES
            for item in data.get(symbol, []):
                for contract in item.get("contracts", []):
                    exch = contract.get("exchange", "")
                    if exch in VALID_EXCHANGES:
                        conid = contract["conid"]
                        logger.debug(f"  trsrv: {conid} via {exch} [valid exchange]")
                        return conid

            # Priorité 4 : Premier contrat disponible
            for item in data.get(symbol, []):
                contracts = item.get("contracts", [])
                if contracts:
                    conid = contracts[0]["conid"]
                    exch  = contracts[0].get("exchange", "?")
                    logger.warning(f"  trsrv: {conid} via {exch} [fallback]")
                    return conid

        except Exception as e:
            logger.warning(f"  _get_conid_trsrv({symbol}): {e}")
        return None

    def _get_conid_secdef(
        self,
        symbol: str,
        target_exchange: str,
    ) -> Optional[int]:
        """Méthode 2 : /iserver/secdef/search — fallback."""
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/secdef/search",
                params={"symbol": symbol, "name": False, "secType": "STK"},
                timeout=10
            )
            data = r.json()
            if isinstance(data, list) and data:
                # Cherche l'exchange demandé
                for item in data:
                    sections = item.get("sections", [])
                    for section in sections:
                        if section.get("exchange") == target_exchange:
                            conid = item.get("conid")
                            if conid:
                                logger.debug(f"  secdef: {conid} via {target_exchange}")
                                return conid
                # Fallback : premier résultat
                conid = data[0].get("conid")
                if conid:
                    logger.debug(f"  secdef: {conid} [first result]")
                    return conid
        except Exception as e:
            logger.warning(f"  _get_conid_secdef({symbol}): {e}")
        return None

    def resolve_batch_conids(self, tickers: List[str]) -> Dict[str, Optional[int]]:
        """
        Résout les conids pour une liste de tickers en batch.
        Utile pour pré-charger le cache avant l'exécution.
        """
        results = {}
        for ticker in tickers:
            try:
                results[ticker] = self.get_conid(ticker)
                time.sleep(0.1)  # Respecter les rate limits IBKR
            except Exception as e:
                logger.warning(f"resolve_batch_conids({ticker}): {e}")
                results[ticker] = None
        return results

    # ════════════════════════════════════════════════════════
    # PLACEMENT D'ORDRE — MULTI-EXCHANGES
    # ════════════════════════════════════════════════════════

    def place_order(
        self,
        symbol:       str,
        action:       str,
        quantity:     int,
        order_type:   str             = "MKT",
        limit_price:  Optional[float] = None,
        stop_price:   Optional[float] = None,
        tif:          str             = "DAY",
        source:       str             = "auto",
        reason:       str             = "",
        force_exchange: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Place un ordre via Client Portal REST API.

        Le paramètre `symbol` accepte les tickers yfinance :
            "AAPL"    → ordre sur NYSE/NASDAQ (SMART)
            "MC.PA"   → ordre sur Euronext Paris (SBF)
            "7203.T"  → ordre sur Tokyo (TSEJ)
            "HSBA.L"  → ordre sur London (LSE)

        Gère le 2-step confirmation IBKR automatiquement.
        """
        ts     = datetime.now(timezone.utc).isoformat()
        action = action.upper()
        ibkr_order_type = ORDER_TYPE_MAP.get(order_type.upper(), "MKT")

        # Parse le ticker pour détecter l'exchange
        ibkr_symbol, detected_exchange, currency = parse_yfinance_ticker(symbol)
        target_exchange = force_exchange or detected_exchange

        logger.info(
            f"\n{'='*60}\n"
            f"  📊 ORDRE {action} | {symbol} x{quantity}\n"
            f"  Symbol IBKR: {ibkr_symbol} | Exchange: {target_exchange} | Currency: {currency}\n"
            f"  Type: {ibkr_order_type} | Limit: {limit_price} | Stop: {stop_price}\n"
            f"  Source: {source} | TIF: {tif} | DryRun: {self.dry_run}\n"
            f"  Reason: {reason}\n"
            f"{'='*60}"
        )

        result: Dict[str, Any] = {
            "timestamp":       ts,
            "symbol":          symbol,
            "ibkr_symbol":     ibkr_symbol,
            "exchange":        target_exchange,
            "currency":        currency,
            "action":          action,
            "quantity":        quantity,
            "order_type":      ibkr_order_type,
            "limit_price":     limit_price,
            "stop_price":      stop_price,
            "tif":             tif,
            "source":          source,
            "reason":          reason,
            "dry_run":         self.dry_run,
            "account":         self.account,
            "status":          "pending",
            "order_id":        None,
            "fill_price":      None,
            "error":           None,
        }

        # ── DRY RUN ───────────────────────────────────────────
        if self.dry_run:
            logger.info(
                f"🧪 [DRY RUN] {action} {quantity}x {symbol} "
                f"({ibkr_symbol}@{target_exchange}) @ {ibkr_order_type}"
            )
            result.update({
                "status":   "simulated",
                "order_id": -1,
                "message":  f"[DRY RUN] {action} {quantity}x {symbol}@{target_exchange}",
            })
            self._log_order(result)
            return result

        # ── Vérification connexion ────────────────────────────
        if not self._connected:
            logger.error("❌ Non connecté à IBeam — reconnexion...")
            if not self.connect():
                result.update({"status": "error", "error": "IBeam not connected"})
                self._log_order(result)
                return result

        # ── Résolution conid ──────────────────────────────────
        conid = self.get_conid(symbol, force_exchange)
        if not conid:
            result.update({
                "status": "error",
                "error":  f"conid not found for {symbol} ({ibkr_symbol}@{target_exchange})",
            })
            self._log_order(result)
            return result

        # ── Construction payload ──────────────────────────────
        order_payload: Dict[str, Any] = {
            "acctId":    self.account,
            "conid":     conid,
            "orderType": ibkr_order_type,
            "side":      action,
            "quantity":  quantity,
            "tif":       tif,
            "listingExchange": target_exchange,  # ← Exchange cible
        }

        if ibkr_order_type in ("LMT", "STPLMT") and limit_price:
            order_payload["price"] = limit_price

        if ibkr_order_type in ("STP", "STPLMT") and stop_price:
            order_payload["auxPrice"] = stop_price

        # ── Soumission ────────────────────────────────────────
        try:
            logger.info(
                f"📤 POST /orders | {action} {quantity}x {symbol} "
                f"conid={conid} exchange={target_exchange} type={ibkr_order_type}"
            )
            r    = self._http.post(
                f"{self.ibeam_url}/v1/api/iserver/account/{self.account}/orders",
                json={"orders": [order_payload]},
                timeout=15,
            )
            data = r.json()
            logger.debug(f"POST /orders réponse: {data}")

            if not isinstance(data, list) or not data:
                result.update({
                    "status": "error",
                    "error":  f"Réponse vide ou invalide: {data}",
                })
                self._log_order(result)
                return result

            first = data[0]

            # Ordre direct (pas de confirmation)
            if "order_id" in first or "orderId" in first:
                order_id = first.get("order_id") or first.get("orderId")
                status   = first.get("order_status", "Submitted")
                logger.success(f"✅ Ordre soumis | order_id={order_id} | status={status}")
                result.update({
                    "status":      "submitted",
                    "order_id":    order_id,
                    "ibkr_status": status,
                    "message":     f"Order {order_id} submitted — {status}",
                })
                self._log_order(result)
                return result

            # Confirmation 2-step requise
            if "id" in first:
                result = self._handle_confirmation(first, result)
                self._log_order(result)
                return result

            result.update({
                "status": "error",
                "error":  f"Réponse inattendue: {first}",
            })

        except Exception as e:
            logger.error(f"❌ place_order exception ({symbol}): {type(e).__name__}: {e}")
            result.update({"status": "error", "error": str(e)})

        self._log_order(result)
        return result

    def _handle_confirmation(
        self,
        confirmation_data: Dict,
        result: Dict,
    ) -> Dict:
        """Gère le 2-step confirmation IBKR (jusqu'à 3 rounds)."""
        confirm_id = confirmation_data.get("id")
        messages   = confirmation_data.get("message", [])
        logger.info(f"🔔 Confirmation requise | id={confirm_id} | messages={messages}")

        max_rounds = 3
        for round_n in range(1, max_rounds + 1):
            try:
                logger.info(f"  → Confirmation round {round_n}/3 | id={confirm_id}")
                cr  = self._http.post(
                    f"{self.ibeam_url}/v1/api/iserver/reply/{confirm_id}",
                    json={"confirmed": True},
                    timeout=15,
                )
                cd = cr.json()
                logger.debug(f"  Réponse confirmation: {cd}")

                if not isinstance(cd, list) or not cd:
                    result.update({"status": "error", "error": f"Confirmation vide: {cd}"})
                    return result

                first = cd[0]

                if "order_id" in first or "orderId" in first:
                    order_id = first.get("order_id") or first.get("orderId")
                    status   = first.get("order_status", "Submitted")
                    logger.success(f"✅ Ordre confirmé | order_id={order_id} | status={status}")
                    result.update({
                        "status":      "submitted",
                        "order_id":    order_id,
                        "ibkr_status": status,
                        "message":     f"Order {order_id} confirmed — {status}",
                    })
                    return result

                if "id" in first:
                    confirm_id = first["id"]
                    messages   = first.get("message", [])
                    logger.warning(f"  ⚠ Nouvelle confirmation | id={confirm_id} | msg={messages}")
                    continue

                result.update({"status": "error", "error": f"Réponse inattendue: {first}"})
                return result

            except Exception as e:
                logger.error(f"_handle_confirmation round {round_n}: {e}")
                result.update({"status": "error", "error": str(e)})
                return result

        result.update({
            "status": "error",
            "error":  f"Max confirmation rounds ({max_rounds}) atteint",
        })
        return result

    # ════════════════════════════════════════════════════════
    # POSITIONS & COMPTE
    # ════════════════════════════════════════════════════════

    def get_positions(self) -> List[Dict]:
        if self.dry_run or not self._connected:
            return []
        try:
            positions = []
            page = 0
            while True:
                r    = self._http.get(
                    f"{self.ibeam_url}/v1/api/portfolio/{self.account}/positions/{page}",
                    timeout=15,
                )
                data = r.json()
                if not data:
                    break
                for pos in data:
                    size = pos.get("position", 0)
                    if size == 0:
                        continue
                    positions.append({
                        "symbol":         pos.get("contractDesc", pos.get("ticker", "?")),
                        "conid":          pos.get("conid"),
                        "position":       size,
                        "avg_cost":       pos.get("avgCost",      0),
                        "mkt_price":      pos.get("mktPrice",     0),
                        "market_val":     pos.get("mktValue",     0),
                        "unrealized_pnl": pos.get("unrealizedPnl", 0),
                        "realized_pnl":   pos.get("realizedPnl",   0),
                        "currency":       pos.get("currency",     "USD"),
                    })
                page += 1
                if len(data) < 100:
                    break
            logger.info(f"📊 {len(positions)} position(s) ouvertes")
            return positions
        except Exception as e:
            logger.error(f"❌ get_positions: {e}")
            return []

    def get_account_summary(self) -> Dict:
        if self.dry_run or not self._connected:
            return {
                "net_liquidation": 100_000.0,
                "available_funds": 100_000.0,
                "unrealized_pnl":      0.0,
                "realized_pnl":        0.0,
                "buying_power":   100_000.0,
                "dry_run":           True,
            }
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/portfolio/{self.account}/summary",
                timeout=15,
            )
            data = r.json()

            def _val(key: str) -> float:
                entry = data.get(key, {})
                if isinstance(entry, dict):
                    return float(entry.get("amount", entry.get("value", 0)))
                return float(entry or 0)

            result = {
                "net_liquidation": _val("netliquidation"),
                "available_funds": _val("availablefunds"),
                "unrealized_pnl":  _val("unrealizedpnl"),
                "realized_pnl":    _val("realizedpnl"),
                "buying_power":    _val("buyingpower"),
                "equity_value":    _val("equitywithloanvalue"),
                "dry_run":         False,
            }
            logger.info(
                f"💰 Account | NetLiq=${result['net_liquidation']:,.0f} | "
                f"AvailFunds=${result['available_funds']:,.0f} | "
                f"UPnL=${result['unrealized_pnl']:,.0f}"
            )
            return result
        except Exception as e:
            logger.error(f"❌ get_account_summary: {e}")
            return {}

    def _log_account_summary(self):
        try:
            summary = self.get_account_summary()
            if summary and not summary.get("dry_run"):
                logger.info(
                    f"💼 Compte {self.account} | "
                    f"NetLiq=${summary.get('net_liquidation', 0):,.0f} | "
                    f"BuyingPower=${summary.get('buying_power', 0):,.0f}"
                )
        except Exception:
            pass

    def get_open_orders(self) -> List[Dict]:
        if self.dry_run or not self._connected:
            return []
        try:
            r    = self._http.get(
                f"{self.ibeam_url}/v1/api/iserver/account/orders"
                f"?accountId={self.account}",
                timeout=15,
            )
            data = r.json()
            orders = data.get("orders", []) if isinstance(data, dict) else []
            logger.info(f"📋 {len(orders)} ordre(s) ouvert(s)")
            return orders
        except Exception as e:
            logger.error(f"❌ get_open_orders: {e}")
            return []

    def cancel_all_orders(self) -> int:
        if self.dry_run or not self._connected:
            return 0
        open_orders = self.get_open_orders()
        cancelled   = 0
        for order in open_orders:
            order_id = order.get("orderId") or order.get("order_id")
            if not order_id:
                continue
            try:
                r = self._http.delete(
                    f"{self.ibeam_url}/v1/api/iserver/account/"
                    f"{self.account}/order/{order_id}",
                    timeout=10,
                )
                if r.status_code in (200, 204):
                    logger.info(f"❌ Ordre annulé: orderId={order_id}")
                    cancelled += 1
            except Exception as e:
                logger.error(f"cancel_order {order_id}: {e}")
        logger.info(f"✅ {cancelled}/{len(open_orders)} ordres annulés")
        return cancelled

    # ════════════════════════════════════════════════════════
    # UTILITAIRES
    # ════════════════════════════════════════════════════════

    def test_international_resolution(self, tickers: List[str]) -> None:
        """
        Test de résolution de conids pour des tickers internationaux.
        Utile pour vérifier que Trading Permissions sont activées.
        """
        logger.info(f"\n{'='*50}")
        logger.info(f"  TEST RÉSOLUTION CONIDS INTERNATIONAUX")
        logger.info(f"{'='*50}")
        for ticker in tickers:
            sym, exch, currency = parse_yfinance_ticker(ticker)
            logger.info(f"\n  {ticker}")
            logger.info(f"    → symbol={sym} | exchange={exch} | currency={currency}")
            if not self.dry_run and self._connected:
                conid = self.get_conid(ticker)
                logger.info(f"    → conid={conid}")
            else:
                logger.info(f"    → conid=[dry_run ou non connecté]")
        logger.info(f"{'='*50}\n")

    def get_supported_exchanges(self) -> Dict[str, str]:
        """Retourne la liste des exchanges supportés et leurs devises."""
        return {
            exch: EXCHANGE_CURRENCY.get(exch, "?")
            for exch in sorted(VALID_EXCHANGES)
        }

    def _log_order(self, result: Dict):
        self._orders.append(result)

    def get_order_history(self) -> List[Dict]:
        return self._orders

    def save_execution_log(
        self,
        output_path: str = "docs/signals/execution_log.json",
    ):
        path = Path(output_path)
        path.parent.mkdir(parents=True, exist_ok=True)

        existing = []
        if path.exists():
            try:
                existing = json.loads(path.read_text()).get("orders", [])
            except Exception:
                pass

        all_orders = (existing + self._orders)[-200:]
        data = {
            "timestamp":    datetime.now(timezone.utc).isoformat(),
            "total_orders": len(all_orders),
            "account":      self.account,
            "orders":       all_orders,
        }
        path.write_text(json.dumps(data, indent=2, default=str))
        logger.info(f"💾 execution_log.json sauvegardé ({len(all_orders)} ordres)")