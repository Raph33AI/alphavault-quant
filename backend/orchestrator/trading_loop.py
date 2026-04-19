# ============================================================
# ALPHAVAULT QUANT — Trading Loop v2.1
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

    Sans cette fonction, le ML génère des signaux mais AUCUN
    ordre réel n'est jamais transmis au watcher Oracle.
    ═══════════════════════════════════════════════════════════
    """
    signals   = output.get("current_signals", {}).get("signals", {})
    dry_run   = output.get("current_signals", {}).get("dry_run", True)
    portfolio = output.get("portfolio", {})
    risk      = output.get("risk_metrics", {})

    portfolio_value = float(portfolio.get("total_value", 100_000))

    # Vérification risque global — ne pas envoyer si DD > limite
    current_dd = abs(float(
        risk.get("drawdown", {}).get("current_drawdown", 0)
    ))
    if current_dd > settings.MAX_DRAWDOWN_PCT * 0.80:
        logger.warning(
            f"[Bridge] Skip — drawdown élevé: {current_dd:.2%} "
            f"(limite: {settings.MAX_DRAWDOWN_PCT:.2%})"
        )
        return 0

    # Vérification levier
    lever_data    = risk.get("leverage", {})
    over_leveraged = lever_data.get("is_over_leveraged", False)
    if over_leveraged:
        logger.warning("[Bridge] Skip — portefeuille sur-levérisé")
        return 0

    # ── Construction des ordres ───────────────────────────────
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

        # Prix
        price = float(sig.get("price", 0))
        if price <= 0:
            logger.debug(f"[Bridge] Skip {sym} — prix nul")
            continue

        # ── Sizing basé sur le score ML ───────────────────────
        # execute_strong → 8% du portefeuille max
        # execute        → 5% du portefeuille max
        # Capé par MAX_SINGLE_POSITION_PCT des settings
        score    = float(sig.get("final_score",  0))
        conf     = float(sig.get("confidence",   0))

        if council == "execute_strong" and score > 0.70:
            base_pct = 0.08
        elif council == "execute" and score > 0.50:
            base_pct = 0.05
        else:
            base_pct = 0.03

        # Modulé par la confiance du signal
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
            "id":           order_id,
            "symbol":       sym,
            "action":       action,
            "quantity":     quantity,
            "order_type":   "MARKET",
            "dry_run":      dry_run,
            "source":       "ml_pipeline",
            "council":      council,
            "score":        round(score, 4),
            "confidence":   round(conf, 4),
            "position_pct": round(position_pct, 4),
            "position_usd": round(portfolio_value * position_pct, 2),
            "price_at_signal": round(price, 4),
            "timestamp":    ts,
        })

    if not orders:
        logger.info("[Bridge] Aucune décision EXECUTE ce cycle")
        return 0

    # ── Anti-doublon : ne pas remettre un ordre en file si
    #    le même symbole y est déjà depuis moins de 5 minutes ───
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

    # Symboles déjà en file d'attente
    now_ts         = time.time()
    recent_syms    = set()
    COOLDOWN_SECS  = 300  # 5 minutes entre deux ordres sur le même symbole

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
            recent_syms.add(o_sym)  # Par sécurité

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
    try:
        now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

        def run_git(args, check=True):
            return subprocess.run(
                ["git"] + args,
                check=check, capture_output=True, cwd=str(_ROOT_DIR)
            )

        run_git(["config", "--global", "user.name",  "AlphaVault Quant Bot"])
        run_git(["config", "--global", "user.email", "bot@alphavault-ai.com"])

        run_git(["add", "signals/", "docs/signals/"])

        diff = run_git(["diff", "--staged", "--quiet"], check=False)
        if diff.returncode == 0:
            logger.info("📋 Aucun changement — pas de commit")
            return False

        run_git(["commit", "-m", f"🤖 Signals update — {now}"])
        run_git(["push"])
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
    now      = datetime.datetime.utcnow()
    weekday  = now.weekday()
    time_dec = now.hour + now.minute / 60

    if weekday >= 5:               return "closed"
    if 14.5  <= time_dec < 21.0:   return "regular"
    if 13.0  <= time_dec < 14.5:   return "premarket"
    if 21.0  <= time_dec < 24.0:   return "postmarket"
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
    logger.info("  🚀 ALPHAVAULT QUANT — Trading Loop v2.1")
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

    # ── 2. Session de marché ──────────────────────────────
    session = os.environ.get("MARKET_SESSION") or check_market_session()
    settings.MARKET_SESSION = session
    logger.info(f"📅 Session: {session.upper()}")

    if session == "closed" and os.environ.get("EXECUTION_MODE") != "force":
        logger.info("🌙 Marché fermé — exit propre")
        closed_status = {
            "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
            "overall":       "closed",
            "session":       "closed",
            "llm_available": False,
            "workers":       {},
            "mode":          "deterministic",
            "dry_run":       True,
            "message":       "Marché fermé — prochain cycle 14:30 UTC",
        }
        with open(SIGNALS_DIR / "system_status.json", "w") as f:
            json.dump(closed_status, f, indent=2)
        git_commit_signals()
        sys.exit(0)

    # ── 3. Init Agent ─────────────────────────────────────
    try:
        logger.info("🔧 Initialisation TradingAgent...")
        agent = TradingAgent(settings)
    except Exception as e:
        logger.critical(f"❌ TradingAgent init failed: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 4. Pipeline ───────────────────────────────────────
    try:
        output = run_with_retry(agent, max_retries=2)
    except Exception as e:
        logger.error(f"💥 Pipeline définitivement échoué: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 5. Sauvegarde signals ─────────────────────────────
    saved = save_signals(output)
    if not saved:
        logger.error("No signals saved")
        sys.exit(1)

    # ── 6. Bridge ML → ibkr_watcher ✅ FIX CRITIQUE ──────
    trade_auto_mode = os.environ.get("TRADE_AUTO_MODE", "enabled").lower().strip()

    if trade_auto_mode == "disabled":
        logger.info("✋ MANUAL MODE ACTIVE — Automated order transmission DISABLED")
        logger.info("  → All 13 agents analyzed the market this cycle")
        logger.info("  → Signals generated but NO orders transmitted to Oracle Watcher")
        logger.info("  → Switch back to AUTO from dashboard to re-enable")
        logger.info(f"  → TRADE_AUTO_MODE={trade_auto_mode} (from GitHub Variable)")
        n_orders = 0

        # Écrit un fichier de status pour le dashboard
        manual_status = {
            "timestamp":      datetime.datetime.utcnow().isoformat() + "Z",
            "execution_mode": "manual",
            "trade_auto":     False,
            "message":        "Manual mode — orders blocked this cycle",
            "signals_generated": len(output.get("current_signals", {}).get("signals", {})),
            "run_id":         os.environ.get("GITHUB_RUN_NUMBER", "local"),
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
            # Non bloquant — le pipeline continue
            n_orders = 0

    # ── 7. Performance Tracker ────────────────────────────
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

        perf_path    = _ROOT_DIR / "docs" / "signals" / "performance_metrics.json"
        existing_perf= json.loads(perf_path.read_text()) if perf_path.exists() else {}
        existing_perf.update({
            "tracker_metrics": perf_metrics,
            "best_symbols":    tracker.get_best_symbols(10),
            "regime_perf":     tracker.get_regime_performance(),
        })
        perf_path.write_text(json.dumps(existing_perf, indent=2, default=str))
        logger.info("[Loop] Performance tracker updated")
    except Exception as e:
        logger.warning(f"[Loop] Performance tracker error: {e}")

    # ── 8. Alert Engine ───────────────────────────────────
    try:
        alert_engine = AlertEngine(settings=settings, root_dir=_ROOT_DIR)
        alert_engine.check_all(output=output, perf_metrics=perf_metrics)

        now_h = datetime.datetime.utcnow().hour
        if now_h >= 20 and settings.MARKET_SESSION in ("regular", "postmarket"):
            alert_engine.send_daily_summary(
                output=output, perf_metrics=perf_metrics
            )
        logger.info("[Loop] Alert engine checked")
    except Exception as e:
        logger.warning(f"[Loop] Alert engine error: {e}")

    # ── 9. Git push ───────────────────────────────────────
    pushed = git_commit_signals()

    # ── 10. Bilan ─────────────────────────────────────────
    elapsed = time.time() - start_time
    n_sigs  = len(output.get("current_signals", {}).get("signals", {}))
    n_exec  = len(output.get("agent_decisions", {}).get("executions", []))
    regime  = output.get("regime", {}).get("global", {}).get("regime_label", "?")
    llm_ok  = output.get("system_status", {}).get("llm_available", False)

    logger.info("\n" + "═" * 60)
    logger.info(f"  ✅ Terminé en {elapsed:.1f}s")
    logger.info(f"  📊 Signaux   : {n_sigs}")
    logger.info(f"  💼 Exécutés  : {n_exec}")
    logger.info(f"  🎯 Régime    : {regime.upper()}")
    logger.info(f"  🤖 LLM       : {'✅' if llm_ok else '❌ mode déterministe'}")
    logger.info(f"  📡 Git push  : {'✅' if pushed else '⚠  no changes'}")
    logger.info("═" * 60 + "\n")

if __name__ == "__main__":
    main()