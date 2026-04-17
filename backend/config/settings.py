# ============================================================
# ALPHAVAULT QUANT — Settings & Configuration
# Centralise tous les paramètres du système
# Utilise pydantic-settings pour validation automatique
# ============================================================

from pydantic_settings import BaseSettings
from pydantic import Field, validator
from typing import Optional, List
import os

class Settings(BaseSettings):
    """
    Configuration centralisée du système AlphaVault Quant.
    Les variables sont lues depuis les secrets GitHub Actions
    (via variables d'environnement injectées dans le workflow).
    """

    # ── Cloudflare Workers (tes workers existants) ─────────
    FINANCE_HUB_URL:    str = Field(
        default="https://finance-hub-api.raphnardone.workers.dev",
        description="Finance Hub API Worker (Finnhub + TwelveData)"
    )
    AI_PROXY_URL:       str = Field(
        default="https://gemini-ai-proxy.raphnardone.workers.dev",
        description="AI Multi-Provider Proxy Worker (Gemini/Claude/OpenAI)"
    )
    ECONOMIC_DATA_URL:  str = Field(
        default="https://economic-data-worker.raphnardone.workers.dev",
        description="Economic Data Worker (ECB + FRED)"
    )

    # ── Interactive Brokers ────────────────────────────────
    IBKR_HOST:       str   = Field(default="127.0.0.1")
    IBKR_PORT:       int   = Field(default=7497)    # 7497=paper, 7496=live
    IBKR_CLIENT_ID:  int   = Field(default=1)
    IBKR_ACCOUNT:    str   = Field(default="")
    IBKR_PAPER:      bool  = Field(default=True)    # Mode paper trading par défaut

    # ── Mode d'exécution ──────────────────────────────────
    EXECUTION_MODE:  str   = Field(default="auto")   # auto|signal_only|risk_check_only
    DRY_RUN:         bool  = Field(default=True)      # TOUJOURS True en production initiale
    MARKET_SESSION:  str   = Field(default="regular") # regular|premarket|postmarket|closed

    # ── Univers de trading ────────────────────────────────
    EQUITY_UNIVERSE: List[str] = Field(
        default=["SPY", "QQQ", "IWM", "AAPL", "NVDA", "MSFT",
                 "GOOGL", "AMZN", "META", "TSLA", "JPM", "GS"]
    )
    ETF_UNIVERSE:    List[str] = Field(
        default=["SPY", "QQQ", "IWM", "GLD", "TLT", "HYG", "VIX"]
    )
    OPTIONS_UNIVERSE: List[str] = Field(
        default=["SPY", "QQQ", "AAPL", "NVDA", "MSFT"]
    )

    # ── Paramètres de risque ──────────────────────────────
    MAX_PORTFOLIO_LEVERAGE:  float = Field(default=1.5)   # Max leverage global
    MAX_SINGLE_POSITION_PCT: float = Field(default=0.10)  # Max 10% par position
    MAX_SECTOR_EXPOSURE_PCT: float = Field(default=0.30)  # Max 30% par secteur
    DAILY_LOSS_LIMIT_PCT:    float = Field(default=0.02)  # Stop trading si -2%/jour
    MAX_DRAWDOWN_PCT:        float = Field(default=0.10)  # Max drawdown 10%
    MIN_SIGNAL_CONFIDENCE:   float = Field(default=0.60)  # Confiance min pour trader

    # ── Paramètres ML ─────────────────────────────────────
    TRAINING_LOOKBACK_DAYS:  int   = Field(default=252)   # 1 an de données training
    RETRAINING_FREQUENCY:    str   = Field(default="daily")
    MIN_TRAIN_SAMPLES:       int   = Field(default=500)
    WALK_FORWARD_WINDOW:     int   = Field(default=63)    # 3 mois walk-forward

    # ── Timeframes ────────────────────────────────────────
    PRIMARY_TIMEFRAME:    str       = Field(default="5min")
    SIGNAL_TIMEFRAMES:    List[str] = Field(default=["5min", "1h", "4h", "1day"])

    # ── LLM Configuration ─────────────────────────────────
    LLM_ENABLED:          bool  = Field(default=True)
    LLM_PROVIDER:         str   = Field(default="gemini")  # gemini|claude|openai
    LLM_MODEL:            str   = Field(default="gemini-2.5-flash")
    LLM_TIMEOUT_SECONDS:  int   = Field(default=15)
    LLM_MAX_RETRIES:      int   = Field(default=2)

    # ── GitHub (pour push des signaux) ────────────────────
    GH_TOKEN:             Optional[str] = Field(default=None)
    GITHUB_REPOSITORY:    Optional[str] = Field(default=None)
    GITHUB_ACTOR:         Optional[str] = Field(default=None)

    # ── Firebase ──────────────────────────────────────────
    FIREBASE_PROJECT_ID:  Optional[str] = Field(default=None)
    FIREBASE_API_KEY:     Optional[str] = Field(default=None)

    # ── Alertes ───────────────────────────────────────────
    RESEND_ALERT_EMAIL:   Optional[str] = Field(default=None)

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = False
        extra = "ignore"

    @property
    def is_live_trading(self) -> bool:
        """Retourne True uniquement si toutes les conditions live sont remplies."""
        return (
            not self.DRY_RUN
            and not self.IBKR_PAPER
            and bool(self.IBKR_ACCOUNT)
            and self.EXECUTION_MODE == "auto"
        )

    @property
    def workers_config(self) -> dict:
        """Configuration complète des workers pour WorkerClient."""
        return {
            "finance_hub":   self.FINANCE_HUB_URL,
            "ai_proxy":      self.AI_PROXY_URL,
            "economic_data": self.ECONOMIC_DATA_URL,
        }

    def log_config(self) -> str:
        """Affichage sécurisé de la configuration (sans secrets)."""
        return (
            f"\n{'='*60}\n"
            f"  ALPHAVAULT QUANT — Configuration\n"
            f"{'='*60}\n"
            f"  Mode:         {self.EXECUTION_MODE}\n"
            f"  Dry Run:      {self.DRY_RUN}\n"
            f"  Session:      {self.MARKET_SESSION}\n"
            f"  IBKR Paper:   {self.IBKR_PAPER}\n"
            f"  LLM Enabled:  {self.LLM_ENABLED} ({self.LLM_PROVIDER}/{self.LLM_MODEL})\n"
            f"  Finance Hub:  {self.FINANCE_HUB_URL[:40]}...\n"
            f"  AI Proxy:     {self.AI_PROXY_URL[:40]}...\n"
            f"  Equity U.:    {', '.join(self.EQUITY_UNIVERSE[:5])}...\n"
            f"  Max Leverage: {self.MAX_PORTFOLIO_LEVERAGE}x\n"
            f"  Max DD:       {self.MAX_DRAWDOWN_PCT*100:.0f}%\n"
            f"{'='*60}"
        )