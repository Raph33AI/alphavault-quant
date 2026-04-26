"""
settings.py — AlphaVault Quant v2.3
Configuration centrale — Oracle A1 ARM64 | 4 OCPUs | 24GB RAM | 110GB Disk

FIX v2.3 vs v2.2 :
  - Ajout DAILY_LOSS_LIMIT_PCT (requis par risk_manager.py → update_drawdown)
  - Ajout MAX_PORTFOLIO_LEVERAGE (requis par risk_manager.py → check_leverage_constraints)
"""

import os
from typing import Optional, List

class Settings:

    def __init__(self):

        # ══════════════════════════════════════════════════
        # POSTGRESQL
        # ══════════════════════════════════════════════════
        self.pg_host     = os.getenv("PG_HOST",     "localhost")
        self.pg_port     = int(os.getenv("PG_PORT", "5432"))
        self.pg_user     = os.getenv("PG_USER",     "alphavault")
        self.pg_database = os.getenv("PG_DATABASE", "alphavault")
        self.pg_password = (
            os.getenv("DB_PASSWORD")
            or os.getenv("PG_PASSWORD")
            or "AlphaVault_PG_8125aa19f7c3739c"
        )

        # ══════════════════════════════════════════════════
        # IBKR
        # ══════════════════════════════════════════════════
        self.ibkr_host      = os.getenv("IBKR_HOST",      "localhost")
        self.ibkr_port      = int(os.getenv("IBKR_PORT",  "5055"))
        self.ibkr_client_id = int(os.getenv("IBKR_CLIENT_ID", "10"))
        self.ibkr_account   = os.getenv("IBKR_ACCOUNT",   "DUM895161")
        self.trading_mode   = os.getenv("TRADING_MODE",   "paper")

        # ══════════════════════════════════════════════════
        # EXECUTION TRADING
        # ══════════════════════════════════════════════════
        self.trade_auto_mode  = os.getenv("TRADE_AUTO_MODE", "enabled")
        self.dry_run          = os.getenv("DRY_RUN", "false").lower() == "true"
        self.min_confidence   = float(os.getenv("MIN_CONFIDENCE",  "0.55"))
        self.max_position_pct = float(os.getenv("MAX_POSITION_PCT","0.08"))
        self.max_sector_pct   = float(os.getenv("MAX_SECTOR_PCT",  "0.30"))
        self.max_drawdown_pct = float(os.getenv("MAX_DRAWDOWN_PCT","0.10"))
        self.daily_loss_limit = float(os.getenv("DAILY_LOSS_LIMIT","0.02"))
        self.max_leverage     = float(os.getenv("MAX_LEVERAGE",    "1.5"))

        # ══════════════════════════════════════════════════
        # MARKET SESSION — writable par trading_loop.py v2.2
        # ══════════════════════════════════════════════════
        self.MARKET_SESSION = os.getenv("MARKET_SESSION", "closed")

        # ══════════════════════════════════════════════════
        # ML / FEATURE ENGINEERING
        # ══════════════════════════════════════════════════
        self.feature_workers        = int(os.getenv("FEATURE_WORKERS",        "10"))
        self.intraday_top_n         = int(os.getenv("INTRADAY_TOP_N",         "100"))
        self.llm_top_n              = int(os.getenv("LLM_TOP_N",              "50"))
        self.training_lookback_days = int(os.getenv("TRAINING_LOOKBACK_DAYS", "252"))
        self.walk_forward_window    = int(os.getenv("WALK_FORWARD_WINDOW",    "189"))
        self.use_full_universe      = os.getenv("USE_FULL_UNIVERSE", "true").lower() == "true"
        self.universe_size          = int(os.getenv("UNIVERSE_SIZE", "907"))

        # ══════════════════════════════════════════════════
        # OLLAMA — Local LLM Oracle A1
        # ══════════════════════════════════════════════════
        self.ollama_host         = os.getenv("OLLAMA_HOST",  "http://localhost:11434")
        self.ollama_model        = os.getenv("OLLAMA_MODEL", "llama3.2:3b-instruct-q4_K_M")
        self.ollama_model_smart  = os.getenv("OLLAMA_MODEL_SMART",  "qwen2.5:7b-instruct-q4_K_M")
        self.ollama_model_backup = os.getenv("OLLAMA_MODEL_BACKUP", "mistral:7b-instruct-q4_K_M")
        self.ollama_timeout      = int(os.getenv("OLLAMA_TIMEOUT", "60"))
        self.ollama_temperature  = float(os.getenv("OLLAMA_TEMPERATURE", "0.3"))

        # ══════════════════════════════════════════════════
        # LLM CHAIN (Ollama-only désormais — Gemini/Groq désactivés)
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
    # ══════════════════════════════════════════════════════

    @property
    def DRY_RUN(self) -> bool:
        return self.dry_run

    @DRY_RUN.setter
    def DRY_RUN(self, value: bool):
        self.dry_run = value

    @property
    def MAX_DRAWDOWN_PCT(self) -> float:
        return self.max_drawdown_pct

    @property
    def MAX_SINGLE_POSITION_PCT(self) -> float:
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

    # ══════════════════════════════════════════════════════
    # FIX v2.3 — 2 propriétés manquantes ajoutées
    # ══════════════════════════════════════════════════════

    @property
    def DAILY_LOSS_LIMIT_PCT(self) -> float:
        """
        Requis par risk_manager.py → update_drawdown().
        Alias de daily_loss_limit (0.02 = 2% par défaut).
        """
        return self.daily_loss_limit

    @property
    def MAX_PORTFOLIO_LEVERAGE(self) -> float:
        """
        Requis par risk_manager.py → check_leverage_constraints().
        Alias de max_leverage (1.5 par défaut).
        """
        return self.max_leverage

    # ══════════════════════════════════════════════════════
    # Suite des aliases UPPERCASE
    # ══════════════════════════════════════════════════════

    @property
    def MAX_LEVERAGE(self) -> float:
        return self.max_leverage

    @property
    def MIN_CONFIDENCE(self) -> float:
        return self.min_confidence

    @property
    def FEATURE_WORKERS(self) -> int:
        return self.feature_workers

    @property
    def INTRADAY_TOP_N(self) -> int:
        return self.intraday_top_n

    @property
    def LLM_TOP_N(self) -> int:
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
    # UNIVERS
    # ══════════════════════════════════════════════════════

    @property
    def EQUITY_UNIVERSE(self) -> List[str]:
        return self.get_active_universe()

    def get_active_universe(self) -> List[str]:
        try:
            from backend.core.universe import get_full_universe
            return get_full_universe()
        except (ImportError, Exception):
            return self._fallback_full_universe()

    def get_core_universe(self) -> List[str]:
        try:
            from backend.core.universe import CORE_UNIVERSE
            return list(CORE_UNIVERSE)
        except (ImportError, Exception):
            return self._fallback_core_universe()

    def _fallback_full_universe(self) -> List[str]:
        return [
            "SPY","QQQ","IWM","DIA","MDY","VTI","VOO","VTV","VUG","VNQ",
            "XLK","XLF","XLV","XLE","XLY","XLP","XLI","XLB","XLU","XLRE","XLC",
            "GDX","GLD","SLV","USO","UNG","TLT","IEF","SHY","HYG","LQD","BND","AGG",
            "AAPL","MSFT","NVDA","GOOGL","GOOG","META","AMZN","TSLA","BRK-B",
            "AMD","AVGO","ORCL","INTC","QCOM","TXN","MU","ADI","AMAT","LRCX","KLAC",
            "ASML","TSM","MCHP","MPWR","ENPH","FSLR","SEDG","RUN","PLUG",
            "CRM","ADBE","NOW","INTU","CDNS","SNPS","CTSH","EPAM",
            "PLTR","CRWD","NET","SNOW","DDOG","PANW","ZS","FTNT","OKTA",
            "TWLO","MDB","HUBS","VEEV","WDAY","ZM","DOCU","DT","AI",
            "JPM","BAC","GS","MS","V","MA","C","WFC","AXP","BLK","SCHW",
            "CB","MMC","AON","TRV","PGR","ALL","MET","PRU","HIG",
            "SOFI","AFRM","UPST","NU","COIN","HOOD","PYPL",
            "JNJ","UNH","LLY","ABBV","PFE","MRK","TMO","DHR","ABT","AMGN",
            "GILD","BIIB","REGN","VRTX","ISRG","SYK","BSX","MDT",
            "MRNA","BNTX","NVAX","CVS","HUM","ELV","CNC","CI",
            "XOM","CVX","COP","SLB","EOG","MPC","VLO","PSX","OXY",
            "HAL","BKR","DVN","FANG","APA","BP","SHEL","TTE","ENB",
            "HD","WMT","COST","MCD","NKE","SBUX","TGT","LOW","BKNG","ABNB",
            "TJX","ROST","DLTR","DG","YUM","CMG","DPZ","QSR",
            "GM","F","RIVN","LCID","NIO","XPEV","LI",
            "PG","KO","PEP","PM","MO","CL","EL","CHD","CLX","GIS",
            "GE","CAT","DE","HON","UNP","UPS","FDX","LMT","RTX","NOC",
            "GD","BA","MMM","EMR","ETN","PH","ROK","ITW","IR","DOV","WM",
            "LIN","APD","SHW","FCX","NEM","NUE","VMC","MLM","ALB","MOS",
            "NEE","DUK","SO","D","AEP","EXC","XEL","WEC","ES","ETR","AWK",
            "O","SPG","PLD","AMT","CCI","EQIX","DLR","PSA","EQR","AVB",
            "NFLX","DIS","CMCSA","T","VZ","TMUS","CHTR","WBD",
            "EWJ","EWG","EWQ","EWU","EWL","EWI","EWP","EWN","EWD","FXI",
            "KWEB","EWT","EWY","EWA","EWH","EWS","EPI","INDA","EWZ","EWC",
            "EWW","EZA","EEM","VEA","VWO","IEFA","IEMG","ACWI",
            "KSA","UAE","AFK","EWM",
            "BABA","JD","PDD","NTES","TCEHY","BIDU","BILI",
            "TME","IQ","HUYA","DOYU","VNET","GDS","BEKE",
            "GRAB","SEA","SHOP","MELI","VALE","PBR","ITUB","BBD",
            "TS","GLOB","ARCO",
            "COIN","MARA","RIOT","IBIT","GBTC","FBTC","BTCO","ARKB",
            "HUT","BITF","CLSK","CIFR","IREN","CORZ",
            "RXRX","BEAM","EDIT","CRSP","FATE","ACAD",
            "ALNY","IONS","EXEL","FOLD","RARE","ARWR",
            "CLOV","HERO","OPEN","SKLZ","DKNG","PENN","BYND",
            "ACHR","JOBY","WKHS","EVGO","CHPT","BLNK","RIVN","LCID",
        ]

    def _fallback_core_universe(self) -> List[str]:
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
    # ══════════════════════════════════════════════════════

    def log_config(self) -> str:
        return (
            f"[Settings v2.3] "
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
    global _settings_instance
    if _settings_instance is None:
        _settings_instance = Settings()
    return _settings_instance

# ══════════════════════════════════════════════════════════════
# TEST STANDALONE — python3 backend/config/settings.py
# ══════════════════════════════════════════════════════════════

if __name__ == "__main__":
    s = Settings()
    print("✅ Settings v2.3 chargé\n")
    print(s.log_config())
    print()

    print("── FIX v2.3 — Attributs critiques ─────────────────────")
    checks = {
        "DAILY_LOSS_LIMIT_PCT":  s.DAILY_LOSS_LIMIT_PCT,
        "MAX_PORTFOLIO_LEVERAGE": s.MAX_PORTFOLIO_LEVERAGE,
        "MAX_DRAWDOWN_PCT":       s.MAX_DRAWDOWN_PCT,
        "MAX_SINGLE_POSITION_PCT":s.MAX_SINGLE_POSITION_PCT,
        "DRY_RUN":               s.DRY_RUN,
        "TRADE_AUTO_MODE":       s.TRADE_AUTO_MODE,
        "OLLAMA_MODEL":          s.OLLAMA_MODEL,
    }
    all_ok = True
    for k, v in checks.items():
        if v is None or v == "MISSING":
            print(f"  ❌ {k:<30}: MANQUANT")
            all_ok = False
        else:
            print(f"  ✅ {k:<30}: {v}")

    print()
    full = s.get_active_universe()
    core = s.get_core_universe()
    print(f"  ✅ {'get_active_universe()':<30}: {len(full)} symboles")
    print(f"  ✅ {'get_core_universe()':<30}: {len(core)} symboles")
    print()

    if all_ok:
        print("✅ Tous les checks OK — trading_loop.py v2.2 prêt !")
    else:
        print("❌ Des attributs sont manquants — corriger avant de lancer")
