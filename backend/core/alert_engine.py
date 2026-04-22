"""
alert_engine.py — AlphaVault Quant v1.0
Moteur d alertes email (Resend) + notifications trading.
"""
import datetime
from pathlib import Path
from typing import Dict, Optional
from loguru import logger

class AlertEngine:
    def __init__(self, settings=None, root_dir: Optional[Path] = None):
        self.settings = settings
        self.root_dir = root_dir or Path("/home/ubuntu/alphavault")
        self._alerts_sent = 0

    def check_all(self, output: Dict, perf_metrics: Optional[Dict] = None) -> None:
        try:
            risk = output.get("risk_metrics", {})
            dd   = risk.get("drawdown", {})
            dd_val = abs(float(dd.get("current_drawdown", 0)))
            if dd_val > 0.05:
                logger.warning(f"ALERTE DRAWDOWN : {dd_val:.2%}")
                self._alerts_sent += 1
            if dd.get("halt_active"):
                logger.error(f"TRADING HALT : {dd.get('halt_reason', '?')}")
                self._alerts_sent += 1
            execs = output.get("agent_decisions", {}).get("executions", [])
            if execs:
                logger.info(f"AlertEngine : {len(execs)} execution(s) ce cycle")
        except Exception as e:
            logger.debug(f"AlertEngine.check_all: {e}")

    def send_daily_summary(self, output: Dict, perf_metrics: Optional[Dict] = None) -> bool:
        try:
            if not self.settings:
                return False
            api_key = getattr(self.settings, "resend_api_key", "") or getattr(self.settings, "RESEND_API_KEY", "")
            to_addr = getattr(self.settings, "resend_alert_email", "") or getattr(self.settings, "RESEND_ALERT_EMAIL", "")
            if not api_key or not to_addr:
                logger.debug("AlertEngine.send_daily_summary: Resend non configuré")
                return False
            import httpx
            signals    = output.get("current_signals", {}).get("signals", {})
            executions = output.get("agent_decisions", {}).get("executions", [])
            regime     = output.get("regime", {}).get("global", {})
            portfolio  = output.get("portfolio", {})
            now        = datetime.datetime.utcnow().strftime("%Y-%m-%d")
            buys  = [s for s, d in signals.items() if d.get("direction") == "buy"][:10]
            sells = [s for s, d in signals.items() if d.get("direction") == "sell"][:10]
            r = httpx.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "from":    getattr(self.settings, "resend_from_email", "alerts@alphavault-ai.com"),
                    "to":      [to_addr],
                    "subject": f"AlphaVault Daily Summary — {now}",
                    "html":    f"<h2>AlphaVault Quant {now}</h2><p>Regime: {regime.get('regime_label','?').upper()}</p><p>Portfolio: ${float(portfolio.get('total_value',0)):,.0f}</p><p>Signaux: {len(signals)} ({len(buys)} BUY / {len(sells)} SELL)</p><p>Executions: {len(executions)}</p><p>BUY: {', '.join(buys)}</p><p>SELL: {', '.join(sells)}</p>",
                },
                timeout=15,
            )
            ok = r.status_code in (200, 201)
            if ok:
                logger.info(f"Daily summary envoyé a {to_addr}")
                self._alerts_sent += 1
            return ok
        except Exception as e:
            logger.debug(f"AlertEngine.send_daily_summary: {e}")
            return False
