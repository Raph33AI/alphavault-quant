# ============================================================
# ALPHAVAULT QUANT — Alert Engine
# ✅ Alertes sur signaux forts (score > threshold)
# ✅ Alertes sur changement de régime
# ✅ Alertes drawdown
# ✅ Alerte LLM indisponible
# ✅ Résumé quotidien par email (via Finance Hub Worker)
# ✅ Cooldown anti-spam
# ✅ Output vers docs/signals/alerts.json
# ============================================================

import json
import httpx
import time
from pathlib import Path
from typing import Dict, List, Optional
from datetime import datetime, timedelta
from loguru import logger

class AlertEngine:
    """
    Moteur d'alertes du système de trading.

    Canaux :
    1. alerts.json  → affiché sur le dashboard GitHub Pages
    2. Email        → via Finance Hub Worker (Resend API)
    """

    # ── Seuils ────────────────────────────────────────────
    STRONG_SIGNAL_THRESHOLD  = 0.78   # Score ML pour déclencher une alerte
    DRAWDOWN_ALERT_THRESHOLD = 0.04   # 4% drawdown
    DRAWDOWN_HALT_THRESHOLD  = 0.08   # 8% → alerte critique

    COOLDOWNS = {              # secondes entre deux alertes du même type
        "strong_signal":   1800,  # 30 min
        "regime_change":   3600,  # 1h
        "drawdown":        1800,  # 30 min
        "drawdown_critical":600,  # 10 min
        "llm_unavailable": 7200,  # 2h
        "daily_summary":   82800, # 23h
    }

    MAX_ALERTS_STORED = 200   # Nombre max d'alertes en JSON

    def __init__(self, settings, root_dir: Path):
        self.settings       = settings
        self._root          = Path(root_dir)
        self._alerts_path   = self._root / "docs" / "signals" / "alerts.json"
        self._last_sent:    Dict[str, float] = {}
        self._prev_regime:  Optional[str] = None
        self._stored:       List[Dict] = self._load_stored()

    # ════════════════════════════════════════════════════════
    # POINT D'ENTRÉE PRINCIPAL
    # ════════════════════════════════════════════════════════
    def check_all(self, output: Dict, perf_metrics: Optional[Dict] = None):
        """
        Vérifie toutes les conditions d'alerte pour un cycle.
        """
        triggered = []

        triggered += self._check_strong_signals(output)
        triggered += self._check_regime_change(output)
        triggered += self._check_drawdown(output)
        triggered += self._check_llm_status(output)

        if triggered:
            # Envoi email si configuré
            if self.settings.RESEND_ALERT_EMAIL:
                self._send_email_batch(triggered)

            # Sauvegarde JSON pour le dashboard
            self._store_alerts(triggered)
            self.save_alerts_json()

        return triggered

    def send_daily_summary(self, output: Dict, perf_metrics: Dict):
        """
        Envoie le résumé quotidien de performance.
        Appelé une fois en fin de session (21h UTC).
        """
        if not self._can_send("daily_summary"):
            return

        signals  = output.get("current_signals", {}).get("signals", {})
        regime   = output.get("regime", {}).get("global", {})
        n_sigs   = len(signals)
        n_exec   = sum(
            1 for s in signals.values()
            if s.get("council") in ("execute", "execute_strong")
        )
        buy_count = sum(1 for s in signals.values() if s.get("direction") == "buy")
        sell_count= sum(1 for s in signals.values() if s.get("direction") == "sell")

        # Top 5 signaux
        top_signals = sorted(
            [
                (sym, float(s.get("final_score", 0) or 0))
                for sym, s in signals.items()
            ],
            key=lambda x: abs(x[1]),
            reverse=True,
        )[:5]

        alert = self._make_alert(
            alert_type = "daily_summary",
            level      = "info",
            title      = f"AlphaVault Daily Summary — {datetime.utcnow().strftime('%Y-%m-%d')}",
            message    = (
                f"Cycle completed | {n_sigs} signals | "
                f"{buy_count} BUY | {sell_count} SELL | "
                f"{n_exec} to execute | "
                f"Regime: {regime.get('regime_label', '?')} | "
                f"Accuracy: {perf_metrics.get('avg_accuracy', 0):.1%} | "
                f"Sharpe: {perf_metrics.get('rolling_sharpe', 0):.2f}"
            ),
            data={
                "top_signals": [{"sym": s, "score": round(sc, 3)} for s, sc in top_signals],
                "n_signals":   n_sigs,
                "n_execute":   n_exec,
                "regime":      regime.get("regime_label"),
                "accuracy":    perf_metrics.get("avg_accuracy", 0),
                "sharpe":      perf_metrics.get("rolling_sharpe", 0),
            },
        )

        self._last_sent["daily_summary"] = time.time()
        self._store_alerts([alert])
        self.save_alerts_json()

        if self.settings.RESEND_ALERT_EMAIL:
            self._send_email_batch([alert])

    # ════════════════════════════════════════════════════════
    # VÉRIFICATIONS
    # ════════════════════════════════════════════════════════
    def _check_strong_signals(self, output: Dict) -> List[Dict]:
        if not self._can_send("strong_signal"):
            return []

        signals = output.get("current_signals", {}).get("signals", {})
        strong  = [
            (sym, s)
            for sym, s in signals.items()
            if abs(float(s.get("final_score", 0) or 0)) >= self.STRONG_SIGNAL_THRESHOLD
            and s.get("council") in ("execute", "execute_strong")
        ]

        if not strong:
            return []

        top = sorted(strong, key=lambda x: abs(float(x[1].get("final_score", 0))), reverse=True)[:5]
        lines = [
            f"  {sym}: {s.get('direction', '?').upper()} "
            f"score={float(s.get('final_score', 0)):.3f} "
            f"@${float(s.get('price', 0)):.2f} "
            f"council={s.get('council', '?').upper()}"
            for sym, s in top
        ]

        alert = self._make_alert(
            alert_type = "strong_signal",
            level      = "warning",
            title      = f"Strong ML Signal — {len(strong)} symbol(s)",
            message    = "\n".join(lines),
            data={"signals": [{"sym": sym, "score": float(s.get("final_score", 0)),
                               "dir": s.get("direction"), "price": float(s.get("price", 0)),
                               "council": s.get("council")} for sym, s in top]},
        )

        self._last_sent["strong_signal"] = time.time()
        return [alert]

    def _check_regime_change(self, output: Dict) -> List[Dict]:
        regime     = output.get("regime", {}).get("global", {})
        new_regime = regime.get("regime_label", "unknown")

        if self._prev_regime is None:
            self._prev_regime = new_regime
            return []

        if new_regime == self._prev_regime:
            return []

        if not self._can_send("regime_change"):
            self._prev_regime = new_regime
            return []

        score = float(regime.get("regime_score", 0))
        conf  = float(regime.get("confidence", 0))

        level = "critical" if new_regime in ("crash", "high_volatility") else "warning"

        alert = self._make_alert(
            alert_type = "regime_change",
            level      = level,
            title      = f"Regime Change: {self._prev_regime} → {new_regime}",
            message    = (
                f"Market regime changed from {self._prev_regime} to {new_regime}. "
                f"Score: {score:+.2f} | Confidence: {conf:.1%}. "
                f"Strategy allocation will be adjusted automatically."
            ),
            data={
                "from":       self._prev_regime,
                "to":         new_regime,
                "score":      score,
                "confidence": conf,
                "allow_long": regime.get("allow_long"),
                "reduce_exp": regime.get("reduce_exposure"),
            },
        )

        logger.warning(f"[Alerts] Regime change: {self._prev_regime} → {new_regime}")
        self._prev_regime                  = new_regime
        self._last_sent["regime_change"]   = time.time()
        return [alert]

    def _check_drawdown(self, output: Dict) -> List[Dict]:
        risk     = output.get("risk_metrics", {})
        dd_data  = risk.get("drawdown", {})
        curr_dd  = abs(float(dd_data.get("current_drawdown", 0)))
        halted   = dd_data.get("halt_active", False)
        alerts   = []

        # Alerte critique (halt ou DD > 8%)
        if (halted or curr_dd >= self.DRAWDOWN_HALT_THRESHOLD) and self._can_send("drawdown_critical"):
            alert = self._make_alert(
                alert_type = "drawdown_critical",
                level      = "critical",
                title      = f"CRITICAL DRAWDOWN ALERT — {curr_dd:.2%}",
                message    = (
                    f"Portfolio drawdown reached {curr_dd:.2%}. "
                    f"{'Trading HALTED by risk engine.' if halted else 'Approaching halt threshold.'} "
                    f"Review positions immediately."
                ),
                data={"drawdown": curr_dd, "halted": halted},
            )
            self._last_sent["drawdown_critical"] = time.time()
            alerts.append(alert)
            logger.error(f"[Alerts] CRITICAL DRAWDOWN: {curr_dd:.2%}")

        # Alerte standard (DD > 4%)
        elif curr_dd >= self.DRAWDOWN_ALERT_THRESHOLD and self._can_send("drawdown"):
            alert = self._make_alert(
                alert_type = "drawdown",
                level      = "warning",
                title      = f"Drawdown Alert — {curr_dd:.2%}",
                message    = (
                    f"Current drawdown: {curr_dd:.2%}. "
                    f"Threshold: {self.DRAWDOWN_ALERT_THRESHOLD:.0%}. "
                    f"Risk engine is monitoring — no action required yet."
                ),
                data={"drawdown": curr_dd, "threshold": self.DRAWDOWN_ALERT_THRESHOLD},
            )
            self._last_sent["drawdown"] = time.time()
            alerts.append(alert)
            logger.warning(f"[Alerts] Drawdown: {curr_dd:.2%}")

        return alerts

    def _check_llm_status(self, output: Dict) -> List[Dict]:
        status    = output.get("system_status", {})
        llm_avail = status.get("llm_available", True)
        mode      = status.get("mode", "deterministic")

        if not llm_avail and mode == "deterministic" and self._can_send("llm_unavailable"):
            alert = self._make_alert(
                alert_type = "llm_unavailable",
                level      = "info",
                title      = "LLM Unavailable — Deterministic Mode Active",
                message    = (
                    "Gemini LLM quota exceeded (HTTP 429) or unreachable. "
                    "System is running in DETERMINISTIC mode using ML ensemble "
                    "(XGBoost + LightGBM + LogisticRegression). "
                    "All signals continue to generate normally. "
                    "LLM will resume automatically when quota resets."
                ),
                data={"mode": mode, "llm_available": llm_avail},
            )
            self._last_sent["llm_unavailable"] = time.time()
            logger.info("[Alerts] LLM unavailable alert queued")
            return [alert]

        return []

    # ════════════════════════════════════════════════════════
    # ENVOI EMAIL VIA FINANCE HUB WORKER
    # ════════════════════════════════════════════════════════
    def _send_email_batch(self, alerts: List[Dict]):
        """Envoie les alertes par email via le Finance Hub Worker."""
        if not alerts or not self.settings.RESEND_ALERT_EMAIL:
            return

        hub_url = self.settings.FINANCE_HUB_URL
        to_addr = self.settings.RESEND_ALERT_EMAIL

        for alert in alerts:
            if alert.get("level") == "info":
                continue  # Ne pas envoyer les alertes info par email

            try:
                payload = {
                    "to":      to_addr,
                    "subject": f"[AlphaVault] {alert['title']}",
                    "html":    self._build_email_html(alert),
                }
                resp = httpx.post(
                    f"{hub_url}/api/send-alert",
                    json    = payload,
                    timeout = 10,
                    headers = {"Content-Type": "application/json"},
                )
                if resp.status_code in (200, 201, 202):
                    logger.info(f"[Alerts] Email sent: {alert['alert_type']}")
                else:
                    logger.warning(
                        f"[Alerts] Email failed: {resp.status_code} | "
                        f"{resp.text[:200]}"
                    )
            except Exception as e:
                logger.warning(f"[Alerts] Email error: {e}")

    def _build_email_html(self, alert: Dict) -> str:
        """Construit le HTML de l'email d'alerte."""
        level   = alert.get("level", "info")
        color   = {
            "critical":"#ef4444", "warning":"#f59e0b",
            "info":"#3b82f6",     "success":"#10b981",
        }.get(level, "#64748b")

        ts  = alert.get("timestamp", "")
        msg = alert.get("message", "").replace("\n", "<br>")

        return f"""
<!DOCTYPE html>
<html>
<body style="font-family:Inter,sans-serif;background:#f0f4ff;padding:32px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;
              overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.1)">
    <div style="background:{color};padding:24px 28px">
      <div style="color:#fff;font-size:20px;font-weight:800">{alert['title']}</div>
      <div style="color:rgba(255,255,255,0.8);font-size:12px;margin-top:4px">{ts}</div>
    </div>
    <div style="padding:24px 28px">
      <div style="font-size:14px;color:#374151;line-height:1.7">{msg}</div>
      <div style="margin-top:20px;padding:12px 16px;background:#f8faff;
                  border-radius:8px;border-left:3px solid {color}">
        <div style="font-size:11px;color:#6b7280">Alert Type: {alert['alert_type'].upper()}</div>
        <div style="font-size:11px;color:#6b7280">System: AlphaVault Quant — GitHub Actions</div>
      </div>
      <a href="https://{self._get_pages_url()}"
         style="display:inline-block;margin-top:16px;padding:10px 20px;
                background:{color};color:#fff;border-radius:8px;text-decoration:none;
                font-weight:700;font-size:13px">
        View Dashboard
      </a>
    </div>
    <div style="padding:16px 28px;background:#f8faff;font-size:11px;color:#9ca3af;
                border-top:1px solid #e5e7eb">
      AlphaVault Quant — Automated Trading System<br>
      This is an automated alert. Do not reply to this email.
    </div>
  </div>
</body>
</html>"""

    def _get_pages_url(self) -> str:
        repo = (self.settings.GITHUB_REPOSITORY or "").replace("/", ".github.io/", 1)
        return repo or "github.com"

    # ════════════════════════════════════════════════════════
    # PERSISTENCE JSON POUR LE DASHBOARD
    # ════════════════════════════════════════════════════════
    def _store_alerts(self, alerts: List[Dict]):
        self._stored.extend(alerts)
        self._stored = self._stored[-self.MAX_ALERTS_STORED:]

    def save_alerts_json(self):
        """Sauvegarde les alertes dans docs/signals/alerts.json."""
        payload = {
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "total":      len(self._stored),
            "alerts":     list(reversed(self._stored)),  # Plus récent en premier
        }
        self._alerts_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self._alerts_path.write_text(json.dumps(payload, indent=2, default=str))
        except Exception as e:
            logger.warning(f"[Alerts] JSON save failed: {e}")

    def _load_stored(self) -> List[Dict]:
        if self._alerts_path.exists():
            try:
                data = json.loads(self._alerts_path.read_text())
                return data.get("alerts", [])
            except Exception:
                pass
        return []

    # ════════════════════════════════════════════════════════
    # HELPERS
    # ════════════════════════════════════════════════════════
    def _can_send(self, alert_type: str) -> bool:
        cooldown  = self.COOLDOWNS.get(alert_type, 3600)
        last_sent = self._last_sent.get(alert_type, 0)
        return (time.time() - last_sent) >= cooldown

    def _make_alert(
        self,
        alert_type: str,
        level:      str,
        title:      str,
        message:    str,
        data:       Optional[Dict] = None,
    ) -> Dict:
        return {
            "alert_type": alert_type,
            "level":      level,
            "title":      title,
            "message":    message,
            "data":       data or {},
            "timestamp":  datetime.utcnow().isoformat() + "Z",
        }