# ============================================================
# ALPHAVAULT QUANT — Trading Loop v2.2
# ✅ Couverture Marchés Mondiaux : Océanie · Asie · ME · Afrique · EU · Amériques
# ✅ Fix: Bridge ML → ibkr_watcher (pending_orders.json)
# ✅ Optimisé AMD Micro (1GB RAM + 3GB swap)
# ============================================================

import os
import sys
import json
import subprocess
import datetime
import time
from pathlib import Path
from loguru import logger

# ── Chemins ────────────────────────────────────────────────
_ORCHESTRATOR_DIR = Path(__file__).parent
_BACKEND_DIR      = _ORCHESTRATOR_DIR.parent
_ROOT_DIR         = _BACKEND_DIR.parent

if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

from backend.orchestrator.trading_agent import TradingAgent
from backend.config.settings import Settings
from backend.core.performance_tracker import PerformanceTracker
from backend.core.alert_engine        import AlertEngine

# ── Logger ──────────────────────────────────────────────────
LOG_DIR = _BACKEND_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)

logger.add(
    LOG_DIR / f"trading_{datetime.date.today()}.log",
    rotation="1 day",
    retention="7 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
)

SIGNALS_DIR = _ROOT_DIR / "signals"
SIGNALS_DIR.mkdir(exist_ok=True)

# ════════════════════════════════════════════════════════════
# SESSIONS ACTIVES — Toutes les sessions de marché mondiales
# ════════════════════════════════════════════════════════════
ACTIVE_SESSIONS = frozenset({
    # USA
    "us_regular",
    "us_premarket",
    "us_postmarket",
    # Europe
    "eu_regular",
    # Asie / Océanie
    "asia_regular",
    "oceania_regular",
    # Moyen-Orient
    "me_regular",
    # Afrique
    "africa_regular",
    # Rétrocompatibilité (anciens noms)
    "regular",
    "premarket",
    "postmarket",
    "eu_premarket",
})

# ════════════════════════════════════════════════════════════
# UTILITAIRES
# ════════════════════════════════════════════════════════════

def save_signals(output: dict) -> list:
    file_map = {
        "current_signals":     "current_signals.json",
        "portfolio":           "portfolio.json",
        "risk_metrics":        "risk_metrics.json",
        "regime":              "regime.json",
        "agent_decisions":     "agent_decisions.json",
        "strategy_weights":    "strategy_weights.json",
        "performance_metrics": "performance_metrics.json",
        "system_status":       "system_status.json",
    }

    signals_dir      = _ROOT_DIR / "signals"
    docs_signals_dir = _ROOT_DIR / "docs" / "signals"

    signals_dir.mkdir(exist_ok=True)
    docs_signals_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for key, filename in file_map.items():
        if key not in output:
            continue
        data = output[key]
        try:
            for path in (signals_dir / filename, docs_signals_dir / filename):
                with open(path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2, default=str)
            saved.append(filename)
            logger.debug(f"  💾 {filename}")
        except Exception as e:
            logger.error(f"  ❌ Erreur sauvegarde {filename}: {e}")

    logger.info(f"💾 {len(saved)}/{len(file_map)} fichiers → signals/ + docs/signals/")
    return saved

def push_execute_orders_to_watcher(output: dict, settings: Settings) -> int:
    """
    ═══════════════════════════════════════════════════════════
    BRIDGE ML → IBKR WATCHER (Fix critique v2.1)
    ═══════════════════════════════════════════════════════════

    Extrait les décisions EXECUTE du pipeline ML et les écrit
    dans signals/pending_orders.json pour que ibkr_watcher.py
    sur Oracle VM les lise et les transmette à IBeam → IBKR.
    ═══════════════════════════════════════════════════════════
    """
    signals   = output.get("current_signals", {}).get("signals", {})
    dry_run   = output.get("current_signals", {}).get("dry_run", True)
    portfolio = output.get("portfolio", {})
    risk      = output.get("risk_metrics", {})

    portfolio_value = float(portfolio.get("total_value", 100_000))

    current_dd = abs(float(
        risk.get("drawdown", {}).get("current_drawdown", 0)
    ))
    if current_dd > settings.MAX_DRAWDOWN_PCT * 0.80:
        logger.warning(
            f"[Bridge] Skip — drawdown élevé: {current_dd:.2%} "
            f"(limite: {settings.MAX_DRAWDOWN_PCT:.2%})"
        )
        return 0

    lever_data     = risk.get("leverage", {})
    over_leveraged = lever_data.get("is_over_leveraged", False)
    if over_leveraged:
        logger.warning("[Bridge] Skip — portefeuille sur-levérisé")
        return 0

    orders = []
    ts     = datetime.datetime.utcnow().isoformat() + "Z"

    for sym, sig in signals.items():
        council = sig.get("council", "wait")
        if council not in ("execute", "execute_strong"):
            continue

        direction = sig.get("direction", "neutral")
        if direction == "neutral":
            continue

        action = "BUY" if direction == "buy" else "SELL"

        price = float(sig.get("price", 0))
        if price <= 0:
            logger.debug(f"[Bridge] Skip {sym} — prix nul")
            continue

        score    = float(sig.get("final_score",  0))
        conf     = float(sig.get("confidence",   0))

        if council == "execute_strong" and score > 0.70:
            base_pct = 0.08
        elif council == "execute" and score > 0.50:
            base_pct = 0.05
        else:
            base_pct = 0.03

        position_pct = base_pct * min(conf / 0.60, 1.0)
        position_pct = min(position_pct, settings.MAX_SINGLE_POSITION_PCT)

        quantity = int((portfolio_value * position_pct) / price)
        if quantity < 1:
            logger.debug(
                f"[Bridge] Skip {sym} — quantité insuffisante "
                f"({portfolio_value * position_pct:.0f}$ / {price:.2f}$)"
            )
            continue

        order_id = (
            f"ml-{sym.lower()}-"
            f"{action.lower()[:1]}-"
            f"{int(time.time())}"
        )

        orders.append({
            "id":              order_id,
            "symbol":          sym,
            "action":          action,
            "quantity":        quantity,
            "order_type":      "MARKET",
            "dry_run":         dry_run,
            "source":          "ml_pipeline",
            "council":         council,
            "score":           round(score, 4),
            "confidence":      round(conf, 4),
            "position_pct":    round(position_pct, 4),
            "position_usd":    round(portfolio_value * position_pct, 2),
            "price_at_signal": round(price, 4),
            "timestamp":       ts,
        })

    if not orders:
        logger.info("[Bridge] Aucune décision EXECUTE ce cycle")
        return 0

    pending_path = _ROOT_DIR / "signals" / "pending_orders.json"
    docs_path    = _ROOT_DIR / "docs" / "signals" / "pending_orders.json"

    existing_orders    = []
    existing_processed = []

    if pending_path.exists():
        try:
            existing = json.loads(pending_path.read_text())
            existing_orders    = existing.get("orders",    [])
            existing_processed = existing.get("processed", [])
        except Exception as e:
            logger.warning(f"[Bridge] Lecture pending_orders: {e}")

    now_ts        = time.time()
    recent_syms   = set()
    COOLDOWN_SECS = 300

    for o in existing_orders:
        o_sym = o.get("symbol")
        o_ts  = o.get("timestamp", "")
        try:
            o_age = now_ts - datetime.datetime.fromisoformat(
                o_ts.replace("Z", "+00:00")
            ).timestamp()
            if o_age < COOLDOWN_SECS:
                recent_syms.add(o_sym)
        except Exception:
            recent_syms.add(o_sym)

    new_orders = [o for o in orders if o["symbol"] not in recent_syms]

    if not new_orders:
        logger.info(
            f"[Bridge] {len(orders)} ordres générés mais tous en cooldown "
            f"({recent_syms})"
        )
        return 0

    all_orders = existing_orders + new_orders
    payload    = {
        "orders":     all_orders,
        "processed":  existing_processed,
        "updated_at": ts,
        "source":     "ml_pipeline",
        "cycle_run":  os.environ.get("GITHUB_RUN_NUMBER", "local"),
    }

    for path in (pending_path, docs_path):
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            path.write_text(json.dumps(payload, indent=2, default=str))
        except Exception as e:
            logger.error(f"[Bridge] Écriture {path.name}: {e}")

    syms_log = [o["symbol"] for o in new_orders]
    logger.info(
        f"[Bridge] ✅ {len(new_orders)} ordres → pending_orders.json | "
        f"dry_run={dry_run} | Symboles: {syms_log}"
    )

    for o in new_orders:
        logger.info(
            f"  → {o['action']} {o['quantity']}x {o['symbol']} | "
            f"score={o['score']:.3f} | "
            f"council={o['council']} | "
            f"${o['position_usd']:.0f} ({o['position_pct']:.1%})"
        )

    return len(new_orders)

def git_commit_signals() -> bool:
    """
    FIX v2.3 : Remplace git pull --rebase (conflits) par fetch + reset --soft.
    Pousse vers HEAD:refs/heads/main (évite le detached HEAD).
    """
    try:
        now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

        def run_git(args, check=True):
            return subprocess.run(
                ["git"] + args,
                check=check, capture_output=True, cwd=str(_ROOT_DIR)
            )

        run_git(["config", "--global", "user.name",  "AlphaVault Quant Bot"])
        run_git(["config", "--global", "user.email", "bot@alphavault-ai.com"])

        # ✅ FIX : fetch + reset --soft au lieu de pull --rebase
        # Évite les conflits avec les fichiers pushés par le watcher Oracle
        run_git(["fetch", "origin"])
        run_git(["reset", "--soft", "origin/main"])

        # Ajouter signals + docs/signals mais PAS ibkr_status (géré par Oracle)
        run_git(["add", "signals/", "docs/signals/"])
        run_git(["reset", "HEAD", "docs/signals/ibkr_status.json"],  check=False)
        run_git(["reset", "HEAD", "docs/signals/portfolio.json"],    check=False)
        run_git(["reset", "HEAD", "docs/signals/system_status.json"],check=False)

        diff = run_git(["diff", "--staged", "--quiet"], check=False)
        if diff.returncode == 0:
            logger.info("📋 Aucun changement — pas de commit")
            return False

        run_git(["commit", "-m", f"🤖 Signals update — {now}"])

        # ✅ FIX : push explicite vers refs/heads/main (évite detached HEAD)
        run_git(["push", "origin", "HEAD:refs/heads/main"])

        logger.info(f"✅ Git push réussi — {now}")
        return True

    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode("utf-8", errors="replace") if e.stderr else str(e)
        logger.error(f"Git error: {stderr[:300]}")
        return False
    except Exception as e:
        logger.error(f"Git error: {e}")
        return False

def write_error_status(error: Exception):
    status = {
        "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
        "overall":       "error",
        "error":         str(error)[:500],
        "llm_available": False,
        "workers":       {},
        "mode":          "error",
        "session":       os.environ.get("MARKET_SESSION", "unknown"),
        "dry_run":       True,
    }
    try:
        with open(SIGNALS_DIR / "system_status.json", "w") as f:
            json.dump(status, f, indent=2)
    except Exception:
        pass

def check_market_session() -> str:
    """
    Détecte la session de marché globale actuelle (UTC).

    Couverture complète :
      🌏 Océanie   : ASX Sydney (00:00-06:00 + dim 23:00)
      🌏 Asie      : TSE/KRX (00:00) | HKEX/SSE (01:30) | SGX (01:00) | BSE/NSE (03:45)
      🕌 Moyen-Est : DFM/ADX/Tadawul/TASE/QSE (06:00-15:30 UTC, Dim-Jeu)
      🌍 Afrique   : JSE (07:00-15:00) | EGX (08:30-14:30) | NGX (09:30-14:30)
      🌍 Europe    : XETRA (07:00) | LSE (08:00) | Euronext (08:00-17:30)
      🌎 Amériques : B3 (13:00) | NYSE/NASDAQ (14:30-21:00) | Post-market (21:00-24:00)

    Retourne la session active selon la priorité :
      us_regular > us_premarket > us_postmarket > eu_regular >
      asia_regular > me_regular > africa_regular > oceania_regular > closed
    """
    now      = datetime.datetime.utcnow()
    weekday  = now.weekday()   # Python : 0=Lun ... 6=Dim
    time_dec = now.hour + now.minute / 60

    WEEKDAYS = frozenset({0, 1, 2, 3, 4})   # Lundi-Vendredi
    ME_DAYS  = frozenset({0, 1, 2, 3, 6})   # Lun-Jeu + Dim (semaine Moyen-Orient)

    def _open(t: float, o: float, c: float, days=WEEKDAYS) -> bool:
        return (weekday in days) and (o <= t < c)

    # ── 🌎 US — priorité maximale ──────────────────────────────────
    if _open(time_dec, 14.5, 21.0):           return "us_regular"
    if _open(time_dec, 13.0, 14.5):           return "us_premarket"
    if _open(time_dec, 21.0, 24.0):           return "us_postmarket"

    # ── 🌍 Europe (XETRA 07:00, Euronext ferme 17:30) ──────────────
    if _open(time_dec,  7.0, 17.5):           return "eu_regular"

    # ── 🌏 Asie (SGX 01:00, TSE/KRX 00:00, BSE 03:45, HKEX 01:30) ─
    if _open(time_dec,  0.0,  9.0):           return "asia_regular"

    # ── 🕌 Moyen-Orient (Dim-Jeu, DFM 06:00, TASE close 15:25) ────
    if _open(time_dec,  5.75, 15.5, ME_DAYS): return "me_regular"

    # ── 🌍 Afrique (JSE 07:00-15:00, NSE_KE 06:00-12:00) ──────────
    if _open(time_dec,  6.0,  15.0):          return "africa_regular"

    # ── 🌏 Océanie (ASX 00:00-06:00 + Dim 23:00 pré-ouverture) ────
    if _open(time_dec,  0.0,  6.0):           return "oceania_regular"
    if weekday == 6 and time_dec >= 23.0:      return "oceania_regular"

    return "closed"

def run_with_retry(agent: TradingAgent, max_retries: int = 2) -> dict:
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"🔄 Tentative {attempt}/{max_retries}")
            return agent.run_full_pipeline()
        except Exception as e:
            last_err = e
            logger.error(f"❌ Tentative {attempt} échouée: {e}")
            if attempt < max_retries:
                wait = 20 * attempt
                logger.info(f"⏳ Retry dans {wait}s...")
                time.sleep(wait)
    raise RuntimeError(f"Pipeline échoué x{max_retries}: {last_err}")

# ════════════════════════════════════════════════════════════
# POINT D'ENTRÉE
# ════════════════════════════════════════════════════════════

def main():
    start_time = time.time()

    logger.info("\n" + "═" * 60)
    logger.info("  🚀 ALPHAVAULT QUANT — Trading Loop v2.2")
    logger.info(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
    logger.info(f"  Root: {_ROOT_DIR}")
    logger.info("═" * 60)

    # ── 1. Configuration ──────────────────────────────────
    try:
        settings = Settings()
        logger.info(settings.log_config())
    except Exception as e:
        logger.critical(f"❌ Configuration invalide: {e}")
        write_error_status(e)
        sys.exit(1)

    # ── 2. Session de marché mondiale ─────────────────────
    session = os.environ.get("MARKET_SESSION") or check_market_session()
    settings.MARKET_SESSION = session
    logger.info(f"📅 Session: {session.upper()}")

    # ── 3. Vérification si tous les marchés sont fermés ───
    if session not in ACTIVE_SESSIONS and os.environ.get("EXECUTION_MODE") != "force":
        logger.info("🌙 Tous marchés fermés — exit propre")
        logger.info("   Prochaine ouverture :")
        logger.info("     🌏 ASX    : 00:00 UTC (Lun-Ven)")
        logger.info("     🌏 TSE    : 00:00 UTC (Lun-Ven)")
        logger.info("     🕌 Dubai  : 06:00 UTC (Dim-Jeu)")
        logger.info("     🌍 Europe : 07:00 UTC (Lun-Ven)")
        logger.info("     🌎 NYSE   : 14:30 UTC (Lun-Ven)")

        closed_status = {
            "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
            "overall":       "closed",
            "session":       "closed",
            "llm_available": False,
            "workers":       {},
            "mode":          "deterministic",
            "dry_run":       True,
            "message":       (
                "Tous marchés fermés — "
                "ASX 00:00 UTC | EU 07:00 UTC | US 13:00 UTC | ME dim 06:00 UTC"
            ),
        }
        with open(SIGNALS_DIR / "system_status.json", "w") as f:
            json.dump(closed_status, f, indent=2)
        git_commit_signals()
        sys.exit(0)

    logger.info(f"✅ Marché actif — session: {session}")

    # ── 4. Init Agent ─────────────────────────────────────
    try:
        logger.info("🔧 Initialisation TradingAgent...")
        agent = TradingAgent(settings)
    except Exception as e:
        logger.critical(f"❌ TradingAgent init failed: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 5. Pipeline ───────────────────────────────────────
    try:
        output = run_with_retry(agent, max_retries=2)
    except Exception as e:
        logger.error(f"💥 Pipeline définitivement échoué: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 6. Sauvegarde signals ─────────────────────────────
    saved = save_signals(output)
    if not saved:
        logger.error("No signals saved")
        sys.exit(1)

    # ── 7. Bridge ML → ibkr_watcher ✅ FIX CRITIQUE ──────
    trade_auto_mode = os.environ.get("TRADE_AUTO_MODE", "enabled").lower().strip()

    if trade_auto_mode == "disabled":
        logger.info("✋ MANUAL MODE ACTIVE — Automated order transmission DISABLED")
        logger.info("  → All 13 agents analyzed the market this cycle")
        logger.info("  → Signals generated but NO orders transmitted to Oracle Watcher")
        logger.info("  → Switch back to AUTO from dashboard to re-enable")
        logger.info(f"  → TRADE_AUTO_MODE={trade_auto_mode} (from GitHub Variable)")
        n_orders = 0

        manual_status = {
            "timestamp":         datetime.datetime.utcnow().isoformat() + "Z",
            "execution_mode":    "manual",
            "trade_auto":        False,
            "message":           "Manual mode — orders blocked this cycle",
            "signals_generated": len(output.get("current_signals", {}).get("signals", {})),
            "run_id":            os.environ.get("GITHUB_RUN_NUMBER", "local"),
        }
        try:
            manual_path = _ROOT_DIR / "docs" / "signals" / "execution_mode.json"
            if manual_path.exists():
                existing = json.loads(manual_path.read_text())
                existing["last_blocked_cycle"] = manual_status["timestamp"]
                existing["signals_this_cycle"]  = manual_status["signals_generated"]
                manual_path.write_text(json.dumps(existing, indent=2))
        except Exception:
            pass

    else:
        try:
            n_orders = push_execute_orders_to_watcher(output, settings)
            if n_orders > 0:
                logger.info(
                    f"🎯 {n_orders} ordres transmis au watcher Oracle "
                    f"(dry_run={settings.DRY_RUN})"
                )
            else:
                logger.info("📭 Aucun ordre à transmettre ce cycle")
        except Exception as e:
            logger.error(f"[Bridge] Erreur transmission ordres: {e}")
            n_orders = 0

    # ── 8. Performance Tracker ────────────────────────────
    perf_metrics = {}
    try:
        tracker      = PerformanceTracker(root_dir=_ROOT_DIR)
        batch_quotes = getattr(agent, "_last_batch_quotes", None)
        tracker.record_cycle(
            output       = output,
            batch_quotes = batch_quotes,
            run_id       = f"run_{os.environ.get('GITHUB_RUN_NUMBER', '0')}",
        )
        tracker.save()
        perf_metrics = tracker.compute_metrics()

        perf_path     = _ROOT_DIR / "docs" / "signals" / "performance_metrics.json"
        existing_perf = json.loads(perf_path.read_text()) if perf_path.exists() else {}
        existing_perf.update({
            "tracker_metrics": perf_metrics,
            "best_symbols":    tracker.get_best_symbols(10),
            "regime_perf":     tracker.get_regime_performance(),
        })
        perf_path.write_text(json.dumps(existing_perf, indent=2, default=str))
        logger.info("[Loop] Performance tracker updated")
    except Exception as e:
        logger.warning(f"[Loop] Performance tracker error: {e}")

    # ── 9. Alert Engine ───────────────────────────────────
    try:
        alert_engine = AlertEngine(settings=settings, root_dir=_ROOT_DIR)
        alert_engine.check_all(output=output, perf_metrics=perf_metrics)

        now_h = datetime.datetime.utcnow().hour
        if now_h >= 20 and settings.MARKET_SESSION in ("us_regular", "regular", "postmarket", "us_postmarket"):
            alert_engine.send_daily_summary(
                output=output, perf_metrics=perf_metrics
            )
        logger.info("[Loop] Alert engine checked")
    except Exception as e:
        logger.warning(f"[Loop] Alert engine error: {e}")

    # ── 10. Git push ──────────────────────────────────────
    pushed = git_commit_signals()

    # ── 11. Bilan ─────────────────────────────────────────
    elapsed = time.time() - start_time
    n_sigs  = len(output.get("current_signals", {}).get("signals", {}))
    n_exec  = len(output.get("agent_decisions", {}).get("executions", []))
    regime  = output.get("regime", {}).get("global", {}).get("regime_label", "?")
    llm_ok  = output.get("system_status", {}).get("llm_available", False)

    logger.info("\n" + "═" * 60)
    logger.info(f"  ✅ Terminé en {elapsed:.1f}s")
    logger.info(f"  📅 Session   : {session.upper()}")
    logger.info(f"  📊 Signaux   : {n_sigs}")
    logger.info(f"  💼 Exécutés  : {n_exec}")
    logger.info(f"  🎯 Régime    : {regime.upper()}")
    logger.info(f"  🤖 LLM       : {'✅' if llm_ok else '❌ mode déterministe'}")
    logger.info(f"  📡 Git push  : {'✅' if pushed else '⚠  no changes'}")
    logger.info("═" * 60 + "\n")

if __name__ == "__main__":
    main()