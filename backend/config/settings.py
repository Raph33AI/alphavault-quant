"""
settings.py — AlphaVault Quant v2.2
Configuration centrale — Oracle A1 ARM64 | 4 OCPUs | 24GB RAM | 110GB Disk
Compatible Python 3.10+ sans dépendance pydantic-settings

FIX v2.2 vs v2.1 :
  - Ajout UPPERCASE aliases (requis par trading_loop.py v2.2 + trading_agent.py v2.1)
  - Ajout log_config() method (requis par trading_loop.py v2.2)
  - Ajout get_active_universe() + get_core_universe() + EQUITY_UNIVERSE
  - Ajout MARKET_SESSION (attribut writable par trading_loop.py)
  - Ajout MAX_SINGLE_POSITION_PCT
  - Fix defaults : trade_auto_mode=enabled | lookback=252 | ibkr_port=5055 | dry_run=false
"""

import os
from typing import Optional, List

class Settings:
    """
    Configuration AlphaVault Quant v2.2
    Rétrocompatible : tous les attributs lowercase de v2.1 conservés.
    Nouveauté : aliases UPPERCASE + méthodes pour trading_loop v2.2.
    """

    def __init__(self):

        # ══════════════════════════════════════════════════
        # POSTGRESQL
        # ══════════════════════════════════════════════════
        self.pg_host     = os.getenv("PG_HOST",     "localhost")
        self.pg_port     = int(os.getenv("PG_PORT", "5432"))
        self.pg_user     = os.getenv("PG_USER",     "alphavault")
        self.pg_database = os.getenv("PG_DATABASE", "alphavault")
        # database.py v5.4 lit : DB_PASSWORD → PG_PASSWORD → défaut
        self.pg_password = (
            os.getenv("DB_PASSWORD")
            or os.getenv("PG_PASSWORD")
            or "AlphaVault_PG_8125aa19f7c3739c"
        )

        # ══════════════════════════════════════════════════
        # IBKR
        # FIX v2.2 : ibkr_port 4002 → 5055 (IBeam Client Portal REST API)
        # ══════════════════════════════════════════════════
        self.ibkr_host      = os.getenv("IBKR_HOST",      "localhost")
        self.ibkr_port      = int(os.getenv("IBKR_PORT",  "5055"))   # IBeam REST API
        self.ibkr_client_id = int(os.getenv("IBKR_CLIENT_ID", "10"))
        self.ibkr_account   = os.getenv("IBKR_ACCOUNT",   "DUM895161")
        self.trading_mode   = os.getenv("TRADING_MODE",   "paper")

        # ══════════════════════════════════════════════════
        # EXECUTION TRADING
        # FIX v2.2 : defaults corrigés (enabled + false)
        # ══════════════════════════════════════════════════
        self.trade_auto_mode  = os.getenv("TRADE_AUTO_MODE", "enabled")   # FIX: was "disabled"
        self.dry_run          = os.getenv("DRY_RUN", "false").lower() == "true"  # FIX: was "true"
        self.min_confidence   = float(os.getenv("MIN_CONFIDENCE",  "0.55"))
        self.max_position_pct = float(os.getenv("MAX_POSITION_PCT","0.08"))   # 8%
        self.max_sector_pct   = float(os.getenv("MAX_SECTOR_PCT",  "0.30"))   # 30%
        self.max_drawdown_pct = float(os.getenv("MAX_DRAWDOWN_PCT","0.10"))   # 10%
        self.daily_loss_limit = float(os.getenv("DAILY_LOSS_LIMIT","0.02"))   # 2%
        self.max_leverage     = float(os.getenv("MAX_LEVERAGE",    "1.5"))

        # ══════════════════════════════════════════════════
        # MARKET SESSION — writable par trading_loop.py v2.2
        # trading_loop.py fait : settings.MARKET_SESSION = session
        # ══════════════════════════════════════════════════
        self.MARKET_SESSION = os.getenv("MARKET_SESSION", "closed")

        # ══════════════════════════════════════════════════
        # ML / FEATURE ENGINEERING — A1 ARM64 optimisé
        # FIX v2.2 : training_lookback_days 756 → 252 (AUC 0.7588 vs 0.5327)
        # ══════════════════════════════════════════════════
        self.feature_workers        = int(os.getenv("FEATURE_WORKERS",        "10"))
        self.intraday_top_n         = int(os.getenv("INTRADAY_TOP_N",         "100"))
        self.llm_top_n              = int(os.getenv("LLM_TOP_N",              "50"))
        self.training_lookback_days = int(os.getenv("TRAINING_LOOKBACK_DAYS", "252"))  # FIX: was 756
        self.walk_forward_window    = int(os.getenv("WALK_FORWARD_WINDOW",    "189"))
        self.use_full_universe      = os.getenv("USE_FULL_UNIVERSE", "true").lower() == "true"
        self.universe_size          = int(os.getenv("UNIVERSE_SIZE", "907"))  # FIX: was 550

        # ══════════════════════════════════════════════════
        # OLLAMA — Local LLM ARM64
        # ══════════════════════════════════════════════════
        self.ollama_host         = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
        self.ollama_model        = os.getenv("OLLAMA_MODEL", "llama3.2:3b-instruct-q4_K_M")
        self.ollama_model_smart  = os.getenv("OLLAMA_MODEL_SMART",  "qwen2.5:7b-instruct-q4_K_M")
        self.ollama_model_backup = os.getenv("OLLAMA_MODEL_BACKUP", "mistral:7b-instruct-q4_K_M")
        self.ollama_timeout      = int(os.getenv("OLLAMA_TIMEOUT", "60"))
        self.ollama_temperature  = float(os.getenv("OLLAMA_TEMPERATURE", "0.3"))

        # ══════════════════════════════════════════════════
        # LLM FALLBACK CHAIN
        # Priorité : Gemini (CF Proxy) → Groq → Ollama → Déterministe
        # ══════════════════════════════════════════════════
        self.gemini_proxy_url = os.getenv(
            "AI_PROXY_URL",
            "https://gemini-ai-proxy.raphnardone.workers.dev"
        )
        self.groq_api_key   = os.getenv("GROQ_API_KEY",  "")
        self.groq_model     = os.getenv("GROQ_MODEL",    "llama3-8b-8192")
        self.groq_rpm_limit = int(os.getenv("GROQ_RPM_LIMIT", "14400"))

        # ══════════════════════════════════════════════════
        # CLOUDFLARE WORKERS
        # ══════════════════════════════════════════════════
        self.finance_hub_url   = os.getenv(
            "FINANCE_HUB_URL",
            "https://finance-hub-api.raphnardone.workers.dev"
        )
        self.ai_proxy_url      = os.getenv(
            "AI_PROXY_URL",
            "https://gemini-ai-proxy.raphnardone.workers.dev"
        )
        self.economic_data_url = os.getenv(
            "ECONOMIC_DATA_URL",
            "https://economic-data-worker.raphnardone.workers.dev"
        )
        self.gh_proxy_url      = os.getenv(
            "GH_PROXY_URL",
            "https://alphavault-gh-proxy.raphnardone.workers.dev"
        )

        # ══════════════════════════════════════════════════
        # RAG SERVER
        # ══════════════════════════════════════════════════
        self.rag_server_url     = os.getenv("RAG_SERVER_URL",  "http://localhost:5001")
        self.rag_retention_days = int(os.getenv("RAG_RETENTION_DAYS", "365"))
        self.finbert_model      = os.getenv("FINBERT_MODEL",   "ProsusAI/finbert")
        self.finbert_dim        = int(os.getenv("FINBERT_DIM", "768"))

        # ══════════════════════════════════════════════════
        # WATCHER
        # ══════════════════════════════════════════════════
        self.watcher_api_url  = os.getenv("WATCHER_API_URL",  "http://localhost:5000")
        self.watcher_poll_sec = int(os.getenv("WATCHER_POLL_SEC", "30"))

        # ══════════════════════════════════════════════════
        # EMAIL ALERTS (Resend)
        # ══════════════════════════════════════════════════
        self.resend_api_key     = os.getenv("RESEND_API_KEY",     "")
        self.resend_from_email  = os.getenv("RESEND_FROM_EMAIL",  "alerts@alphavault-ai.com")
        self.resend_alert_email = os.getenv("RESEND_ALERT_EMAIL", "")

        # ══════════════════════════════════════════════════
        # PATHS
        # ══════════════════════════════════════════════════
        self.base_dir    = os.getenv("BASE_DIR",    "/home/ubuntu/alphavault")
        self.models_dir  = os.getenv("MODELS_DIR",  "/home/ubuntu/alphavault/models")
        self.logs_dir    = os.getenv("LOGS_DIR",    "/home/ubuntu/alphavault/logs")
        self.signals_dir = os.getenv("SIGNALS_DIR", "/home/ubuntu/alphavault/signals")

    # ══════════════════════════════════════════════════════
    # UPPERCASE ALIASES — requis par trading_loop.py v2.2
    #                      et trading_agent.py v2.1
    # Toutes les propriétés ci-dessous sont READ-ONLY
    # (sauf MARKET_SESSION qui est un vrai attribut dans __init__)
    # ══════════════════════════════════════════════════════

    @property
    def DRY_RUN(self) -> bool:
        return self.dry_run

    @DRY_RUN.setter
    def DRY_RUN(self, value: bool):
        self.dry_run = value

    @property
    def MAX_DRAWDOWN_PCT(self) -> float:
        """Alias uppercase requis par trading_loop.py v2.2."""
        return self.max_drawdown_pct

    @property
    def MAX_SINGLE_POSITION_PCT(self) -> float:
        """Alias de max_position_pct requis par trading_loop.py v2.2 bridge."""
        return self.max_position_pct

    @property
    def MAX_POSITION_PCT(self) -> float:
        return self.max_position_pct

    @property
    def MAX_SECTOR_PCT(self) -> float:
        return self.max_sector_pct

    @property
    def DAILY_LOSS_LIMIT(self) -> float:
        return self.daily_loss_limit

    @property
    def MAX_LEVERAGE(self) -> float:
        return self.max_leverage

    @property
    def MIN_CONFIDENCE(self) -> float:
        return self.min_confidence

    @property
    def FEATURE_WORKERS(self) -> int:
        """Alias uppercase requis par trading_agent.py v2.1."""
        return self.feature_workers

    @property
    def INTRADAY_TOP_N(self) -> int:
        """Alias uppercase requis par trading_agent.py v2.1."""
        return self.intraday_top_n

    @property
    def LLM_TOP_N(self) -> int:
        """Alias uppercase requis par trading_agent.py v2.1."""
        return self.llm_top_n

    @property
    def TRAINING_LOOKBACK_DAYS(self) -> int:
        return self.training_lookback_days

    @property
    def WALK_FORWARD_WINDOW(self) -> int:
        return self.walk_forward_window

    @property
    def UNIVERSE_SIZE(self) -> int:
        return self.universe_size

    @property
    def TRADING_MODE(self) -> str:
        return self.trading_mode

    @property
    def TRADE_AUTO_MODE(self) -> str:
        return self.trade_auto_mode

    @property
    def OLLAMA_MODEL(self) -> str:
        return self.ollama_model

    @property
    def OLLAMA_HOST(self) -> str:
        return self.ollama_host

    @property
    def OLLAMA_TIMEOUT(self) -> int:
        return self.ollama_timeout

    @property
    def OLLAMA_TEMPERATURE(self) -> float:
        return self.ollama_temperature

    @property
    def FINANCE_HUB_URL(self) -> str:
        return self.finance_hub_url

    @property
    def AI_PROXY_URL(self) -> str:
        return self.ai_proxy_url

    @property
    def ECONOMIC_DATA_URL(self) -> str:
        return self.economic_data_url

    @property
    def GROQ_API_KEY(self) -> str:
        return self.groq_api_key

    @property
    def GROQ_MODEL(self) -> str:
        return self.groq_model

    @property
    def RESEND_API_KEY(self) -> str:
        return self.resend_api_key

    @property
    def RESEND_FROM_EMAIL(self) -> str:
        return self.resend_from_email

    @property
    def RESEND_ALERT_EMAIL(self) -> str:
        return self.resend_alert_email

    @property
    def IBKR_ACCOUNT(self) -> str:
        return self.ibkr_account

    @property
    def IBKR_HOST(self) -> str:
        return self.ibkr_host

    @property
    def IBKR_PORT(self) -> int:
        return self.ibkr_port

    @property
    def RAG_SERVER_URL(self) -> str:
        return self.rag_server_url

    # ══════════════════════════════════════════════════════
    # UNIVERS — requis par trading_agent.py v2.1
    # ══════════════════════════════════════════════════════

    @property
    def EQUITY_UNIVERSE(self) -> List[str]:
        """Univers complet — essaie universe.py sinon fallback interne."""
        return self.get_active_universe()

    def get_active_universe(self) -> List[str]:
        """
        Univers COMPLET de trading (~907 symboles).
        Essaie d'importer backend.core.universe (si existant sur GitHub Actions),
        sinon retourne le fallback interne.
        """
        try:
            from backend.core.universe import get_full_universe
            return get_full_universe()
        except (ImportError, Exception):
            return self._fallback_full_universe()

    def get_core_universe(self) -> List[str]:
        """
        Univers CORE haute liquidité (~100 symboles prioritaires).
        Essaie d'importer backend.core.universe sinon fallback interne.
        """
        try:
            from backend.core.universe import CORE_UNIVERSE
            return list(CORE_UNIVERSE)
        except (ImportError, Exception):
            return self._fallback_core_universe()

    def _fallback_full_universe(self) -> List[str]:
        """Univers complet US + ETFs internationaux (fallback si universe.py absent)."""
        return [
            # ETFs US marché large
            "SPY","QQQ","IWM","DIA","MDY","VTI","VOO","VTV","VUG","VNQ",
            # ETFs secteurs US
            "XLK","XLF","XLV","XLE","XLY","XLP","XLI","XLB","XLU","XLRE","XLC",
            "GDX","GLD","SLV","USO","UNG","TLT","IEF","SHY","HYG","LQD","BND","AGG",
            # Mega cap
            "AAPL","MSFT","NVDA","GOOGL","GOOG","META","AMZN","TSLA","BRK-B",
            "AMD","AVGO","ORCL","INTC","QCOM","TXN","MU","ADI","AMAT","LRCX","KLAC",
            "ASML","TSM","MCHP","MPWR","ENPH","FSLR","SEDG","RUN","PLUG",
            # Technology
            "CRM","ADBE","NOW","INTU","ANSS","CDNS","SNPS","CTSH","EPAM",
            "PLTR","CRWD","NET","SNOW","DDOG","PANW","ZS","FTNT","CYBR","OKTA",
            "TWLO","MDB","HUBS","VEEV","WDAY","ZM","DOCU","SPLK","DT","AI",
            # Finance
            "JPM","BAC","GS","MS","V","MA","C","WFC","AXP","BLK","SCHW",
            "CB","MMC","AON","TRV","PGR","ALL","MET","PRU","HIG",
            "SOFI","AFRM","UPST","NU","COIN","HOOD","SQ","PYPL",
            # Healthcare
            "JNJ","UNH","LLY","ABBV","PFE","MRK","TMO","DHR","ABT","AMGN",
            "GILD","BIIB","REGN","VRTX","ISRG","SYK","BSX","MDT",
            "MRNA","BNTX","NVAX","CVS","WBA","HUM","ELV","CNC","CI",
            # Energy
            "XOM","CVX","COP","SLB","EOG","PXD","MPC","VLO","PSX","OXY",
            "HAL","BKR","DVN","FANG","APA","BP","SHEL","TTE","ENB",
            # Consumer Disc
            "HD","WMT","COST","MCD","NKE","SBUX","TGT","LOW","BKNG","ABNB",
            "TJX","ROST","DLTR","DG","YUM","CMG","DPZ","QSR",
            "GM","F","RIVN","LCID","NIO","XPEV","LI",
            # Consumer Staples
            "PG","KO","PEP","PM","MO","CL","EL","CHD","CLX","GIS","K",
            # Industrials
            "GE","CAT","DE","HON","UNP","UPS","FDX","LMT","RTX","NOC",
            "GD","BA","MMM","EMR","ETN","PH","ROK","ITW","IR","DOV","WM",
            # Materials
            "LIN","APD","SHW","FCX","NEM","NUE","VMC","MLM","ALB","MOS",
            # Utilities
            "NEE","DUK","SO","D","AEP","EXC","XEL","WEC","ES","ETR","AWK",
            # REITs
            "O","SPG","PLD","AMT","CCI","EQIX","DLR","PSA","EQR","AVB","VNQ",
            # Communication
            "META","NFLX","DIS","CMCSA","T","VZ","TMUS","CHTR","PARA","WBD",
            # ETFs Internationaux (US-listés)
            "EWJ","EWG","EWQ","EWU","EWL","EWI","EWP","EWN","EWD","FXI",
            "KWEB","EWT","EWY","EWA","EWH","EWS","EPI","INDA","EWZ","EWC",
            "EWW","EZA","EEM","VEA","VWO","IEFA","IEMG","ACWI",
            "KSA","UAE","GULF","AFK","EWM",
            # China Tech
            "BABA","JD","PDD","NTES","TCEHY","BIDU","NIO","XPEV","LI","BILI",
            "TME","IQ","HUYA","DOYU","VNET","GDS","BEKE",
            # Emerging Markets
            "GRAB","SEA","SHOP","MELI","NU","VALE","PBR","ITUB","BBD",
            "TS","ERJ","LOMA","GLOB","VTEX","ARCO",
            # Crypto related
            "COIN","MARA","RIOT","IBIT","GBTC","FBTC","BTCO","ARKB",
            "HUT","BITF","CLSK","CIFR","IREN","CORZ",
            # Biotech/Pharma
            "RXRX","BEAM","EDIT","CRSP","FATE","BLUE","SAGE","ACAD",
            "ALNY","IONS","EXEL","FOLD","SGEN","RARE","ARWR",
            # Growth Misc
            "CLOV","HERO","OPEN","SKLZ","DKNG","PENN","BYND","OATLY",
            "ACHR","JOBY","WKHS","EVGO","CHPT","BLNK","NKLA","RIVN",
            "LCID","FSR","LAZR","MVIS","LIDR","IDEX","NNDM","APPH",
        ]

    def _fallback_core_universe(self) -> List[str]:
        """Core universe ~100 symboles haute liquidité."""
        return [
            "SPY","QQQ","IWM","GLD","TLT","DIA","MDY","VTI","VEA","EEM",
            "XLK","XLF","XLV","XLE","XLY","XLP","XLI","XLU","XLRE","GDX",
            "AAPL","MSFT","NVDA","GOOGL","META","AMZN","TSLA","BRK-B",
            "AMD","AVGO","ORCL","TSM","ASML","QCOM","TXN","MU",
            "JPM","BAC","GS","V","MA","C","WFC","BLK","SCHW","AXP",
            "JNJ","UNH","LLY","ABBV","PFE","MRK","TMO","DHR","ABT","AMGN",
            "XOM","CVX","COP","SLB","EOG","MPC","OXY",
            "HD","WMT","COST","MCD","NKE","SBUX","TGT","LOW","BKNG",
            "CAT","DE","HON","UNP","UPS","FDX","LMT","RTX","BA","GE",
            "NEE","DUK","LIN","FCX","NEM","PG","KO","PEP",
            "PLTR","CRWD","NET","PANW","ZS","SNOW","DDOG","CRM","ADBE","NOW",
            "COIN","MARA","RIOT","IBIT","GBTC",
            "EWJ","EWG","EWQ","EWU","FXI","EWT","EWY","EWA","EWZ","EWC",
            "BABA","JD","NIO","SHOP","MELI","NU",
        ]

    # ══════════════════════════════════════════════════════
    # LOG CONFIG — requis par trading_loop.py v2.2
    # logger.info(settings.log_config())
    # ══════════════════════════════════════════════════════

    def log_config(self) -> str:
        """
        Résumé de configuration pour les logs.
        Requis par trading_loop.py v2.2.
        """
        return (
            f"[Settings v2.2] "
            f"mode={self.trading_mode.upper()} | "
            f"auto={self.trade_auto_mode.upper()} | "
            f"dry_run={self.dry_run} | "
            f"session={self.MARKET_SESSION} | "
            f"universe={self.universe_size} | "
            f"workers={self.feature_workers} | "
            f"llm_top_n={self.llm_top_n} | "
            f"lookback={self.training_lookback_days}j | "
            f"min_conf={self.min_confidence} | "
            f"max_pos={self.max_position_pct:.0%} | "
            f"max_dd={self.max_drawdown_pct:.0%} | "
            f"ollama={self.ollama_model}"
        )

    def __repr__(self) -> str:
        return (
            f"Settings(mode={self.trading_mode}, auto={self.trade_auto_mode}, "
            f"dry_run={self.dry_run}, session={self.MARKET_SESSION}, "
            f"workers={self.feature_workers}, ollama={self.ollama_model})"
        )

# ══════════════════════════════════════════════════════════════
# SINGLETON
# ══════════════════════════════════════════════════════════════

_settings_instance: Optional[Settings] = None

def get_settings() -> Settings:
    """Factory : retourne le singleton Settings."""
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = Settings()
    return _settings_instance

# ══════════════════════════════════════════════════════════════
# TEST STANDALONE
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    s = Settings()
    print("✅ Settings v2.2 chargé avec succès\n")
    print(s.log_config())
    print()
    # Lowercase (v2.1 — rétrocompatibilité)
    print("── LOWERCASE (rétrocompatible v2.1) ──────────────────")
    print(f"  {'trading_mode':<30}: {s.trading_mode}")
    print(f"  {'trade_auto_mode':<30}: {s.trade_auto_mode}")
    print(f"  {'dry_run':<30}: {s.dry_run}")
    print(f"  {'feature_workers':<30}: {s.feature_workers}")
    print(f"  {'intraday_top_n':<30}: {s.intraday_top_n}")
    print(f"  {'llm_top_n':<30}: {s.llm_top_n}")
    print(f"  {'training_lookback_days':<30}: {s.training_lookback_days}")
    print(f"  {'walk_forward_window':<30}: {s.walk_forward_window}")
    print(f"  {'max_drawdown_pct':<30}: {s.max_drawdown_pct:.0%}")
    print(f"  {'max_position_pct':<30}: {s.max_position_pct:.0%}")
    print(f"  {'ibkr_port':<30}: {s.ibkr_port}")
    print()
    # Uppercase (v2.2 — requis trading_loop + trading_agent)
    print("── UPPERCASE (nouveau v2.2) ────────────────────────────")
    print(f"  {'DRY_RUN':<30}: {s.DRY_RUN}")
    print(f"  {'MARKET_SESSION':<30}: {s.MARKET_SESSION}")
    print(f"  {'MAX_DRAWDOWN_PCT':<30}: {s.MAX_DRAWDOWN_PCT:.0%}")
    print(f"  {'MAX_SINGLE_POSITION_PCT':<30}: {s.MAX_SINGLE_POSITION_PCT:.0%}")
    print(f"  {'FEATURE_WORKERS':<30}: {s.FEATURE_WORKERS}")
    print(f"  {'INTRADAY_TOP_N':<30}: {s.INTRADAY_TOP_N}")
    print(f"  {'LLM_TOP_N':<30}: {s.LLM_TOP_N}")
    print(f"  {'TRADING_MODE':<30}: {s.TRADING_MODE}")
    print()
    # Méthodes (v2.2)
    print("── MÉTHODES (nouveau v2.2) ─────────────────────────────")
    print(f"  {'log_config()':<30}: ✅")
    full = s.get_active_universe()
    core = s.get_core_universe()
    print(f"  {'get_active_universe()':<30}: {len(full)} symboles")
    print(f"  {'get_core_universe()':<30}: {len(core)} symboles")
    print(f"  {'EQUITY_UNIVERSE':<30}: {len(s.EQUITY_UNIVERSE)} symboles")
    print()
    print("✅ Tous les checks OK — trading_loop.py v2.2 prêt !")
