# ============================================================
# ALPHAVAULT QUANT — Trading Loop
# ✅ Point d'entrée GitHub Actions
# ✅ Import paths corrigés pour "cd backend && python -m ..."
# ✅ Fallback complet si workers indisponibles
# ============================================================

import os
import sys
import json
import subprocess
import datetime
import time
from pathlib import Path
from loguru import logger

# ── Correction du path Python ─────────────────────────────
# Quand on fait "cd backend && python -m orchestrator.trading_loop"
# le CWD est backend/ donc on ajoute le parent (racine du repo)
_ROOT = Path(__file__).parent.parent.parent  # → alphavault-quant/
_BACKEND = Path(__file__).parent.parent      # → alphavault-quant/backend/

if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

# ── Import de l'agent principal ───────────────────────────
# On importe APRÈS la correction du path
from orchestrator.trading_agent import TradingAgent
from config.settings import Settings

# ── Logger ────────────────────────────────────────────────
LOG_DIR = _BACKEND / "logs"
LOG_DIR.mkdir(exist_ok=True)
logger.add(
    LOG_DIR / f"trading_{datetime.date.today()}.log",
    rotation="1 day",
    retention="7 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
)

# ── Répertoire des signaux ─────────────────────────────────
SIGNALS_DIR = _ROOT / "signals"
SIGNALS_DIR.mkdir(exist_ok=True)

# ════════════════════════════════════════════════════════════
# FONCTIONS UTILITAIRES
# ════════════════════════════════════════════════════════════

def save_signals(output: dict) -> list:
    """Sauvegarde tous les JSON dans /signals/."""
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
    saved = []
    for key, filename in file_map.items():
        if key not in output:
            continue
        fpath = SIGNALS_DIR / filename
        try:
            with open(fpath, "w", encoding="utf-8") as f:
                json.dump(output[key], f, indent=2, default=str)
            saved.append(filename)
            logger.debug(f"💾 {filename} sauvegardé")
        except Exception as e:
            logger.error(f"Erreur sauvegarde {filename}: {e}")
    logger.info(f"💾 {len(saved)} fichiers signals sauvegardés")
    return saved

def git_commit_signals() -> bool:
    """Commit et push automatique des signals JSON."""
    try:
        now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

        subprocess.run(
            ["git", "config", "--global", "user.name", "AlphaVault Quant Bot"],
            check=True, capture_output=True, cwd=str(_ROOT)
        )
        subprocess.run(
            ["git", "config", "--global", "user.email", "bot@alphavault-ai.com"],
            check=True, capture_output=True, cwd=str(_ROOT)
        )
        subprocess.run(
            ["git", "add", "signals/"],
            check=True, capture_output=True, cwd=str(_ROOT)
        )

        diff = subprocess.run(
            ["git", "diff", "--staged", "--quiet"],
            capture_output=True, cwd=str(_ROOT)
        )
        if diff.returncode == 0:
            logger.info("📋 Aucun changement dans signals/ — pas de commit")
            return False

        subprocess.run(
            ["git", "commit", "-m", f"🤖 Signals update — {now}"],
            check=True, capture_output=True, cwd=str(_ROOT)
        )
        subprocess.run(
            ["git", "push"],
            check=True, capture_output=True, cwd=str(_ROOT)
        )
        logger.info(f"✅ Git push réussi — {now}")
        return True

    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode() if e.stderr else str(e)
        logger.error(f"Git commit/push failed: {stderr}")
        return False
    except Exception as e:
        logger.error(f"Git error: {e}")
        return False

def write_error_status(error: Exception):
    """Écrit un system_status.json d'erreur."""
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
    fpath = SIGNALS_DIR / "system_status.json"
    try:
        with open(fpath, "w") as f:
            json.dump(status, f, indent=2)
    except Exception:
        pass

def check_market_session() -> str:
    """Détermine la session de marché actuelle (UTC)."""
    now      = datetime.datetime.utcnow()
    weekday  = now.weekday()   # 0=Lundi, 6=Dimanche
    time_dec = now.hour + now.minute / 60

    if weekday >= 5:
        return "closed"
    if 14.5 <= time_dec < 21.0:
        return "regular"
    if 13.0 <= time_dec < 14.5:
        return "premarket"
    if 21.0 <= time_dec < 24.0:
        return "postmarket"
    return "closed"

def run_with_retry(agent: TradingAgent, max_retries: int = 2) -> dict:
    """Exécute le pipeline avec retry automatique."""
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
    raise RuntimeError(
        f"Pipeline échoué après {max_retries} tentatives. "
        f"Dernière erreur: {last_err}"
    )

# ════════════════════════════════════════════════════════════
# POINT D'ENTRÉE
# ════════════════════════════════════════════════════════════

def main():
    start_time = time.time()

    logger.info("\n" + "═" * 60)
    logger.info("  🚀 ALPHAVAULT QUANT — Trading Loop")
    logger.info(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
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

    # Si marché fermé et pas de run manuel → exit propre
    if session == "closed" and os.environ.get("EXECUTION_MODE") != "force":
        logger.info("🌙 Marché fermé — écriture status et exit")
        status = {
            "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
            "overall":       "closed",
            "session":       "closed",
            "llm_available": False,
            "workers":       {},
            "mode":          "deterministic",
            "dry_run":       True,
            "message":       "Marché fermé — prochain cycle à l'ouverture 14:30 UTC",
        }
        fpath = SIGNALS_DIR / "system_status.json"
        with open(fpath, "w") as f:
            json.dump(status, f, indent=2)
        git_commit_signals()
        logger.info("✅ Status 'closed' écrit et pushé — exit 0")
        sys.exit(0)

    # ── 3. Initialisation de l'agent ──────────────────────
    try:
        logger.info("🔧 Initialisation TradingAgent...")
        agent = TradingAgent(settings)
    except Exception as e:
        logger.critical(f"❌ TradingAgent init failed: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 4. Exécution du pipeline ──────────────────────────
    try:
        output = run_with_retry(agent, max_retries=2)
    except Exception as e:
        logger.error(f"💥 Pipeline échoué définitivement: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 5. Sauvegarde des signaux ─────────────────────────
    saved = save_signals(output)
    if not saved:
        logger.error("❌ Aucun signal sauvegardé")
        sys.exit(1)

    # ── 6. Git push → GitHub Pages ────────────────────────
    pushed = git_commit_signals()

    # ── 7. Bilan final ────────────────────────────────────
    elapsed  = time.time() - start_time
    sigs     = output.get("current_signals", {})
    n_sigs   = len(sigs.get("signals", {}))
    n_exec   = len(output.get("agent_decisions", {}).get("executions", []))
    regime   = output.get("regime", {}).get("global", {}).get("regime_label", "?")
    llm_ok   = output.get("system_status", {}).get("llm_available", False)

    logger.info("\n" + "═" * 60)
    logger.info(f"  ✅ Cycle terminé en {elapsed:.1f}s")
    logger.info(f"  📊 Signaux générés  : {n_sigs}")
    logger.info(f"  💼 Ordres exécutés  : {n_exec}")
    logger.info(f"  🎯 Régime global    : {regime.upper()}")
    logger.info(f"  🤖 LLM disponible   : {'✅' if llm_ok else '❌ (déterministe)'}")
    logger.info(f"  📡 Git push         : {'✅' if pushed else '⚠  skipped (no change)'}")
    logger.info("═" * 60 + "\n")

if __name__ == "__main__":
    main()