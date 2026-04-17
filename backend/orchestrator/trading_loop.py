# ============================================================
# ALPHAVAULT QUANT — Trading Loop
# ✅ Exécuté depuis la RACINE du repo
#    → python -m backend.orchestrator.trading_loop
# ✅ "backend" = package Python top-level
# ✅ Tous les imports relatifs (from ..core) fonctionnent
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
# __file__ = alphavault-quant/backend/orchestrator/trading_loop.py
_ORCHESTRATOR_DIR = Path(__file__).parent          # backend/orchestrator/
_BACKEND_DIR      = _ORCHESTRATOR_DIR.parent       # backend/
_ROOT_DIR         = _BACKEND_DIR.parent            # alphavault-quant/  ← CWD

# La racine est déjà dans sys.path car on lance depuis là
# Vérification de sécurité
if str(_ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(_ROOT_DIR))

# ── Imports du projet (depuis la racine, package "backend") ─
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

# ── Répertoire des signaux ───────────────────────────────────
SIGNALS_DIR = _ROOT_DIR / "signals"
SIGNALS_DIR.mkdir(exist_ok=True)

# ════════════════════════════════════════════════════════════
# UTILITAIRES
# ════════════════════════════════════════════════════════════

def save_signals(output: dict) -> list:
    """
    Sauvegarde les JSON dans /signals/ ET dans /docs/signals/.
    
    - /signals/     → historique Git + source de vérité
    - /docs/signals/ → servi par GitHub Pages (accessible au dashboard)
    """
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

    # Dossiers de destination
    signals_dir     = _ROOT_DIR / "signals"
    docs_signals_dir= _ROOT_DIR / "docs" / "signals"

    signals_dir.mkdir(exist_ok=True)
    docs_signals_dir.mkdir(parents=True, exist_ok=True)

    saved = []
    for key, filename in file_map.items():
        if key not in output:
            continue
        data = output[key]
        try:
            # 1. Sauvegarde dans /signals/
            with open(signals_dir / filename, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, default=str)

            # 2. Sauvegarde dans /docs/signals/ (GitHub Pages)
            with open(docs_signals_dir / filename, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, default=str)

            saved.append(filename)
            logger.debug(f"  💾 {filename}")
        except Exception as e:
            logger.error(f"  ❌ Erreur sauvegarde {filename}: {e}")

    logger.info(f"💾 {len(saved)}/{len(file_map)} fichiers → signals/ + docs/signals/")
    return saved

def git_commit_signals() -> bool:
    """Commit + push signals/ ET docs/signals/."""
    try:
        now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

        def run_git(args, check=True):
            return subprocess.run(
                ["git"] + args,
                check=check, capture_output=True, cwd=str(_ROOT_DIR)
            )

        run_git(["config", "--global", "user.name",  "AlphaVault Quant Bot"])
        run_git(["config", "--global", "user.email", "bot@alphavault-ai.com"])

        # Stage les deux dossiers
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
    """Écrit un system_status.json d'erreur pour le dashboard."""
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
    """Détermine la session de marché (UTC)."""
    now      = datetime.datetime.utcnow()
    weekday  = now.weekday()
    time_dec = now.hour + now.minute / 60

    if weekday >= 5:           return "closed"
    if 14.5 <= time_dec < 21: return "regular"
    if 13.0 <= time_dec < 14.5: return "premarket"
    if 21.0 <= time_dec < 24:   return "postmarket"
    return "closed"

def run_with_retry(agent: TradingAgent, max_retries: int = 2) -> dict:
    """Pipeline avec retry automatique."""
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
    logger.info("  🚀 ALPHAVAULT QUANT — Trading Loop")
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

    # Marché fermé → exit propre (sauf run manuel avec force)
    if session == "closed" and os.environ.get("EXECUTION_MODE") != "force":
        logger.info("🌙 Marché fermé — exit propre")
        write_error_status(Exception("market_closed"))
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

    # ── 6. Performance Tracker ────────────────────────────
    try:
        tracker = PerformanceTracker(root_dir=_ROOT_DIR)
        # batch_quotes disponible depuis agent si exposé, sinon None
        batch_quotes = getattr(agent, "_last_batch_quotes", None)
        tracker.record_cycle(
            output       = output,
            batch_quotes = batch_quotes,
            run_id       = f"run_{os.environ.get('GITHUB_RUN_NUMBER', '0')}",
        )
        tracker.save()
        # Injecter les métriques dans performance_metrics.json
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
        perf_metrics = {}

    # ── 7. Alert Engine ───────────────────────────────────
    try:
        alert_engine = AlertEngine(settings=settings, root_dir=_ROOT_DIR)
        alert_engine.check_all(output=output, perf_metrics=perf_metrics)

        # Résumé quotidien si fin de session regular (après 20h UTC)
        now_h = datetime.datetime.utcnow().hour
        if now_h >= 20 and settings.MARKET_SESSION in ("regular", "postmarket"):
            alert_engine.send_daily_summary(output=output, perf_metrics=perf_metrics)

        logger.info("[Loop] Alert engine checked")
    except Exception as e:
        logger.warning(f"[Loop] Alert engine error: {e}")

    # ── 8. Git push ───────────────────────────────────────
    pushed = git_commit_signals()

    # ── 7. Bilan ──────────────────────────────────────────
    elapsed = time.time() - start_time
    n_sigs  = len(output.get("current_signals", {}).get("signals", {}))
    n_exec  = len(output.get("agent_decisions", {}).get("executions", []))
    regime  = output.get("regime", {}).get("global", {}).get("regime_label", "?")
    llm_ok  = output.get("system_status", {}).get("llm_available", False)

    logger.info("\n" + "═" * 60)
    logger.info(f"  ✅ Terminé en {elapsed:.1f}s")
    logger.info(f"  📊 Signaux  : {n_sigs}")
    logger.info(f"  💼 Exécutés : {n_exec}")
    logger.info(f"  🎯 Régime   : {regime.upper()}")
    logger.info(f"  🤖 LLM      : {'✅' if llm_ok else '❌ mode déterministe'}")
    logger.info(f"  📡 Git push : {'✅' if pushed else '⚠  no changes'}")
    logger.info("═" * 60 + "\n")

if __name__ == "__main__":
    main()