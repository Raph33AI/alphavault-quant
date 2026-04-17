# ============================================================
# ALPHAVAULT QUANT — Trading Loop
# ✅ Point d'entrée principal exécuté par GitHub Actions
# ✅ Pipeline complet automatisé
# ✅ Persistance des signaux en JSON → GitHub Pages
# ✅ Git commit automatique des signaux
# ✅ Gestion des erreurs & reprise automatique
# ============================================================

import os
import sys
import json
import subprocess
import datetime
import time
from pathlib import Path
from loguru import logger

# Ajout du répertoire parent au path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from backend.config.settings   import Settings
from backend.orchestrator.trading_agent import TradingAgent

# ── Configuration du logger ───────────────────────────────
LOG_DIR = Path(__file__).parent.parent.parent / "backend" / "logs"
LOG_DIR.mkdir(exist_ok=True)
logger.add(
    LOG_DIR / f"trading_{datetime.date.today()}.log",
    rotation="1 day",
    retention="7 days",
    level="INFO",
    format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {message}",
)

# ── Répertoire des signaux (lu par GitHub Pages) ──────────
SIGNALS_DIR = Path(__file__).parent.parent.parent / "signals"
SIGNALS_DIR.mkdir(exist_ok=True)

def save_signals(output: dict):
    """
    Sauvegarde tous les JSONs de signaux dans /signals/.
    Ces fichiers sont lus directement par le dashboard HTML
    via fetch() depuis GitHub Pages.
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

    saved = []
    for key, filename in file_map.items():
        if key in output:
            fpath = SIGNALS_DIR / filename
            try:
                with open(fpath, "w", encoding="utf-8") as f:
                    json.dump(output[key], f, indent=2, default=str)
                saved.append(filename)
            except Exception as e:
                logger.error(f"Erreur sauvegarde {filename}: {e}")

    logger.info(f"💾 Signaux sauvegardés: {', '.join(saved)}")
    return saved

def git_commit_signals():
    """
    Commit et push automatique des fichiers JSON de signaux.
    Déclenché après chaque cycle de trading.
    Le GitHub Actions a les permissions nécessaires (contents: write).
    """
    try:
        now = datetime.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC")

        # Configuration Git (bot)
        subprocess.run(
            ["git", "config", "--global", "user.name", "AlphaVault Quant Bot"],
            check=True, capture_output=True
        )
        subprocess.run(
            ["git", "config", "--global", "user.email", "bot@alphavault-ai.com"],
            check=True, capture_output=True
        )

        # Stage les fichiers signals/
        subprocess.run(
            ["git", "add", "signals/"],
            check=True, capture_output=True
        )

        # Vérifie si des changements existent
        diff = subprocess.run(
            ["git", "diff", "--staged", "--quiet"],
            capture_output=True
        )

        if diff.returncode == 0:
            logger.info("📋 Aucun changement dans signals/ — pas de commit")
            return False

        # Commit
        subprocess.run(
            ["git", "commit", "-m", f"🤖 Signals update — {now}"],
            check=True, capture_output=True
        )

        # Push
        subprocess.run(
            ["git", "push"],
            check=True, capture_output=True
        )

        logger.info(f"✅ Git push réussi — {now}")
        return True

    except subprocess.CalledProcessError as e:
        logger.error(f"Git commit/push failed: {e.stderr.decode() if e.stderr else str(e)}")
        return False
    except Exception as e:
        logger.error(f"Git error: {e}")
        return False

def check_market_session() -> str:
    """
    Détermine la session de marché actuelle.
    Retourne: regular | premarket | postmarket | closed
    """
    now_utc   = datetime.datetime.utcnow()
    weekday   = now_utc.weekday()
    time_dec  = now_utc.hour + now_utc.minute / 60

    if weekday >= 5:
        return "closed"

    if 14.5 <= time_dec < 21.0:
        return "regular"
    elif 13.0 <= time_dec < 14.5:
        return "premarket"
    elif 21.0 <= time_dec < 24.0:
        return "postmarket"
    return "closed"

def run_pipeline_with_retry(agent: TradingAgent, max_retries: int = 2) -> dict:
    """
    Exécute le pipeline avec retry automatique sur erreur.
    """
    last_error = None
    for attempt in range(1, max_retries + 1):
        try:
            logger.info(f"🔄 Tentative {attempt}/{max_retries}")
            output = agent.run_full_pipeline()
            return output
        except Exception as e:
            last_error = e
            logger.error(f"❌ Tentative {attempt} échouée: {e}")
            if attempt < max_retries:
                wait = 30 * attempt
                logger.info(f"⏳ Attente {wait}s avant retry...")
                time.sleep(wait)

    raise RuntimeError(f"Pipeline failed après {max_retries} tentatives: {last_error}")

def write_error_status(error: Exception):
    """Écrit un status d'erreur dans system_status.json."""
    status = {
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "overall":   "error",
        "error":     str(error),
        "llm_available": False,
        "workers":   {},
        "mode":      "error",
    }
    fpath = SIGNALS_DIR / "system_status.json"
    with open(fpath, "w") as f:
        json.dump(status, f, indent=2)

# ════════════════════════════════════════════════════════════
# POINT D'ENTRÉE PRINCIPAL
# ════════════════════════════════════════════════════════════
def main():
    """
    Point d'entrée de la boucle de trading.
    Appelé par GitHub Actions toutes les 5 minutes.
    """
    start_time = time.time()
    logger.info("\n" + "═" * 60)
    logger.info("  🚀 ALPHAVAULT QUANT — Trading Loop Start")
    logger.info("═" * 60)

    # ── 1. Chargement de la configuration ────────────
    try:
        settings = Settings()
        logger.info(settings.log_config())
    except Exception as e:
        logger.critical(f"Configuration invalide: {e}")
        write_error_status(e)
        sys.exit(1)

    # ── 2. Vérification session de marché ─────────────
    session = os.environ.get("MARKET_SESSION") or check_market_session()
    settings.MARKET_SESSION = session
    logger.info(f"📅 Session: {session.upper()}")

    if session == "closed" and os.environ.get("EXECUTION_MODE") != "force":
        logger.info("🌙 Marché fermé — pipeline annulé")
        status = {
            "timestamp":  datetime.datetime.utcnow().isoformat() + "Z",
            "overall":    "closed",
            "session":    "closed",
            "message":    "Marché fermé — prochain cycle à l'ouverture",
        }
        fpath = SIGNALS_DIR / "system_status.json"
        with open(fpath, "w") as f:
            json.dump(status, f, indent=2)
        git_commit_signals()
        sys.exit(0)

    # ── 3. Initialisation de l'agent ─────────────────
    try:
        agent = TradingAgent(settings)
    except Exception as e:
        logger.critical(f"Initialisation TradingAgent échouée: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 4. Exécution du pipeline ──────────────────────
    try:
        output = run_pipeline_with_retry(agent, max_retries=2)
    except Exception as e:
        logger.error(f"💥 Pipeline échoué: {e}")
        write_error_status(e)
        git_commit_signals()
        sys.exit(1)

    # ── 5. Sauvegarde des signaux ─────────────────────
    saved = save_signals(output)
    if not saved:
        logger.error("Aucun signal sauvegardé")
        sys.exit(1)

    # ── 6. Git push vers GitHub Pages ─────────────────
    pushed = git_commit_signals()

    # ── 7. Bilan ──────────────────────────────────────
    elapsed = time.time() - start_time
    n_sigs  = len(output.get("current_signals", {}).get("signals", {}))
    n_exec  = len(output.get("agent_decisions", {}).get("executions", []))
    regime  = output.get("regime", {}).get("global", {}).get("regime_label", "?")
    llm_ok  = output.get("system_status", {}).get("llm_available", False)

    logger.info("\n" + "═" * 60)
    logger.info(f"  ✅ Cycle terminé en {elapsed:.1f}s")
    logger.info(f"  📊 Signaux générés : {n_sigs}")
    logger.info(f"  💼 Ordres exécutés : {n_exec}")
    logger.info(f"  🎯 Régime global   : {regime.upper()}")
    logger.info(f"  🤖 LLM disponible  : {'✅' if llm_ok else '❌ (mode déterministe)'}")
    logger.info(f"  📡 Git push        : {'✅' if pushed else '⚠ skipped'}")
    logger.info("═" * 60 + "\n")

if __name__ == "__main__":
    main()