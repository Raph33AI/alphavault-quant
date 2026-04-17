# ============================================================
# ALPHAVAULT QUANT — Settings & Configuration v2
# ============================================================

from pydantic_settings import BaseSettings
from pydantic import Field
from typing import Optional, List
import os

class Settings(BaseSettings):

    # ── Cloudflare Workers ─────────────────────────────────
    FINANCE_HUB_URL:    str = Field(
        default="https://finance-hub-api.raphnardone.workers.dev")
    AI_PROXY_URL:       str = Field(
        default="https://gemini-ai-proxy.raphnardone.workers.dev")
    ECONOMIC_DATA_URL:  str = Field(
        default="https://economic-data-worker.raphnardone.workers.dev")

    # ── Interactive Brokers ────────────────────────────────
    IBKR_HOST:       str   = Field(default="127.0.0.1")
    IBKR_PORT:       int   = Field(default=7497)
    IBKR_CLIENT_ID:  int   = Field(default=1)
    IBKR_ACCOUNT:    str   = Field(default="")
    IBKR_PAPER:      bool  = Field(default=True)

    # ── Execution Mode ─────────────────────────────────────
    EXECUTION_MODE:  str   = Field(default="signal_only")
    DRY_RUN:         bool  = Field(default=True)
    MARKET_SESSION:  str   = Field(default="regular")

    # ── Universe Configuration ─────────────────────────────
    USE_FULL_UNIVERSE: bool = Field(
        default=True,
        description="True = all ~300 symbols | False = EQUITY_UNIVERSE only")

    EQUITY_UNIVERSE: List[str] = Field(
        default=[
            "SPY", "QQQ", "IWM", "GLD", "TLT",
            "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
            "META", "TSLA", "JPM", "GS", "V",
            "UNH", "LLY", "XOM", "HD", "COST",
        ],
        description="Core universe — always used when USE_FULL_UNIVERSE=False")

    # Top N symbols qui reçoivent aussi les données intraday (5min)
    INTRADAY_TOP_N: int = Field(
        default=30,
        description="Only top N symbols get intraday (5min) OHLCV")

    # Top N pour appels LLM (évite de dépasser les quotas)
    LLM_TOP_N: int = Field(
        default=20,
        description="Max symbols sent to LLM council per cycle")

    # Workers ThreadPool pour le feature building parallèle
    FEATURE_WORKERS: int = Field(
        default=8,
        description="ThreadPoolExecutor workers for parallel feature building")

    # ── Risk Parameters ────────────────────────────────────
    MAX_PORTFOLIO_LEVERAGE:  float = Field(default=1.5)
    MAX_SINGLE_POSITION_PCT: float = Field(default=0.10)
    MAX_SECTOR_EXPOSURE_PCT: float = Field(default=0.30)
    DAILY_LOSS_LIMIT_PCT:    float = Field(default=0.02)
    MAX_DRAWDOWN_PCT:        float = Field(default=0.10)
    MIN_SIGNAL_CONFIDENCE:   float = Field(default=0.60)

    # ── ML Parameters ──────────────────────────────────────
    TRAINING_LOOKBACK_DAYS:  int   = Field(default=252)
    RETRAINING_FREQUENCY:    str   = Field(default="daily")
    MIN_TRAIN_SAMPLES:       int   = Field(default=500)
    WALK_FORWARD_WINDOW:     int   = Field(default=63)

    # ── Timeframes ─────────────────────────────────────────
    PRIMARY_TIMEFRAME:    str       = Field(default="1day")
    SIGNAL_TIMEFRAMES:    List[str] = Field(default=["1day"])
    # Note: "5min", "1h", "4h" uniquement pour INTRADAY_TOP_N symbols

    # ── LLM Configuration ──────────────────────────────────
    LLM_ENABLED:          bool  = Field(default=True)
    LLM_PROVIDER:         str   = Field(default="gemini")
    LLM_MODEL:            str   = Field(default="gemini-2.5-flash")
    LLM_TIMEOUT_SECONDS:  int   = Field(default=15)
    LLM_MAX_RETRIES:      int   = Field(default=2)

    # ── GitHub ─────────────────────────────────────────────
    GH_TOKEN:             Optional[str] = Field(default=None)
    GITHUB_REPOSITORY:    Optional[str] = Field(default=None)
    GITHUB_ACTOR:         Optional[str] = Field(default=None)

    # ── Firebase ───────────────────────────────────────────
    FIREBASE_PROJECT_ID:  Optional[str] = Field(default=None)
    FIREBASE_API_KEY:     Optional[str] = Field(default=None)

    # ── Alertes ────────────────────────────────────────────
    RESEND_ALERT_EMAIL:   Optional[str] = Field(default=None)

    class Config:
        env_file          = ".env"
        env_file_encoding = "utf-8"
        case_sensitive    = False
        extra             = "ignore"

    def get_active_universe(self) -> List[str]:
        """Retourne l'univers actif selon la configuration."""
        if self.USE_FULL_UNIVERSE:
            from backend.core.universe import get_full_universe
            return get_full_universe()
        return self.EQUITY_UNIVERSE

    def get_core_universe(self) -> List[str]:
        """Retourne toujours le core (pour intraday + LLM)."""
        from backend.core.universe import CORE_UNIVERSE
        return list(CORE_UNIVERSE)

    @property
    def is_live_trading(self) -> bool:
        return (
            not self.DRY_RUN and not self.IBKR_PAPER
            and bool(self.IBKR_ACCOUNT)
            and self.EXECUTION_MODE == "auto"
        )

    @property
    def workers_config(self) -> dict:
        return {
            "finance_hub":   self.FINANCE_HUB_URL,
            "ai_proxy":      self.AI_PROXY_URL,
            "economic_data": self.ECONOMIC_DATA_URL,
        }

    def log_config(self) -> str:
        universe = self.get_active_universe()
        return (
            f"\n{'='*60}\n"
            f"  ALPHAVAULT QUANT — Configuration\n"
            f"{'='*60}\n"
            f"  Mode:            {self.EXECUTION_MODE}\n"
            f"  Dry Run:         {self.DRY_RUN}\n"
            f"  Session:         {self.MARKET_SESSION}\n"
            f"  IBKR Paper:      {self.IBKR_PAPER}\n"
            f"  LLM Enabled:     {self.LLM_ENABLED} ({self.LLM_PROVIDER}/{self.LLM_MODEL})\n"
            f"  Universe:        {len(universe)} symbols (full={self.USE_FULL_UNIVERSE})\n"
            f"  Intraday Top N:  {self.INTRADAY_TOP_N}\n"
            f"  LLM Top N:       {self.LLM_TOP_N}\n"
            f"  Feature Workers: {self.FEATURE_WORKERS}\n"
            f"  Finance Hub:     {self.FINANCE_HUB_URL[:40]}...\n"
            f"  Max Leverage:    {self.MAX_PORTFOLIO_LEVERAGE}x\n"
            f"  Max DD:          {self.MAX_DRAWDOWN_PCT*100:.0f}%\n"
            f"{'='*60}"
        )