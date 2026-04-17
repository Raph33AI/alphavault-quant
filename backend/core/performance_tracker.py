# ============================================================
# ALPHAVAULT QUANT — Performance Tracker
# ✅ Suivi de la précision des signaux ML sur N cycles
# ✅ Rolling Sharpe, Win Rate, Max Drawdown
# ✅ Attribution de performance par régime et stratégie
# ✅ Output vers docs/signals/performance_history.json
# ============================================================

import json
import numpy as np
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from datetime import datetime, timedelta
from loguru import logger

class PerformanceTracker:
    """
    Suit la performance du système de trading sur la durée.

    Méthodologie :
    - Chaque cycle enregistre les signaux + prix courants
    - Le cycle N+1 compare les prix aux signaux du cycle N
    - Si signal=BUY et prix a monté → correct (et vice versa)
    - Produit des métriques rolling (Sharpe proxy, Win Rate, Accuracy)
    """

    MAX_HISTORY  = 500     # Cycles max conservés
    HISTORY_FILE = "performance_history.json"
    ALERTS_FILE  = "alerts.json"

    def __init__(self, root_dir: Path):
        self._root      = Path(root_dir)
        self._hist_path = self._root / "signals"       / self.HISTORY_FILE
        self._docs_path = self._root / "docs" / "signals" / self.HISTORY_FILE
        self._alrt_path = self._root / "docs" / "signals" / self.ALERTS_FILE
        self._history   = self._load()
        self._alerts:   List[Dict] = []

    # ════════════════════════════════════════════════════════
    # PERSISTENCE
    # ════════════════════════════════════════════════════════
    def _load(self) -> List[Dict]:
        for path in (self._hist_path, self._docs_path):
            if path.exists():
                try:
                    data = json.loads(path.read_text())
                    return data.get("cycles", [])
                except Exception:
                    continue
        return []

    def save(self):
        """Sauvegarde l'historique et les métriques."""
        metrics = self.compute_metrics()
        payload = {
            "updated_at":   datetime.utcnow().isoformat() + "Z",
            "n_cycles":     len(self._history),
            "cycles":       self._history[-self.MAX_HISTORY:],
            "metrics":      metrics,
            "regime_perf":  self.get_regime_performance(),
            "recent_10":    self.get_recent_cycles(10),
        }
        for path in (self._hist_path, self._docs_path):
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                path.write_text(json.dumps(payload, indent=2, default=str))
            except Exception as e:
                logger.warning(f"[Tracker] Save failed {path.name}: {e}")

        logger.info(
            f"[Tracker] Saved | {len(self._history)} cycles | "
            f"accuracy={metrics.get('avg_accuracy', 0):.1%} | "
            f"sharpe={metrics.get('rolling_sharpe', 0):.2f}"
        )

    # ════════════════════════════════════════════════════════
    # ENREGISTREMENT D'UN CYCLE
    # ════════════════════════════════════════════════════════
    def record_cycle(
        self,
        output:       Dict,
        batch_quotes: Optional[Dict] = None,
        run_id:       str            = "",
    ):
        """
        Enregistre le cycle courant et calcule la précision
        par rapport aux signaux du cycle précédent.
        """
        signals   = output.get("current_signals", {}).get("signals", {})
        regime    = output.get("regime", {}).get("global", {})
        strategy  = output.get("strategy_weights", {}).get("weights", {})
        risk      = output.get("risk_metrics", {})
        status    = output.get("system_status", {})
        perf      = output.get("performance_metrics", {})

        # Précision vs cycle précédent
        accuracy = self._compute_accuracy(signals, batch_quotes)

        # Compte des directions
        dirs = {"B": 0, "S": 0, "N": 0}
        for s in signals.values():
            d = s.get("direction", "neutral")
            k = "B" if d == "buy" else "S" if d == "sell" else "N"
            dirs[k] += 1

        # Score moyen
        scores = [abs(float(s.get("final_score", 0))) for s in signals.values()]
        avg_score = float(np.mean(scores)) if scores else 0.0

        # Drawdown courant
        curr_dd = float(
            risk.get("drawdown", {}).get("current_drawdown", 0)
        )

        cycle = {
            "ts":          datetime.utcnow().isoformat() + "Z",
            "run_id":      run_id,
            "n_signals":   len(signals),
            "n_buy":       dirs["B"],
            "n_sell":      dirs["S"],
            "n_neutral":   dirs["N"],
            "n_execute":   sum(
                1 for s in signals.values()
                if s.get("council") in ("execute", "execute_strong")
            ),
            "avg_score":   round(avg_score, 4),
            "regime":      regime.get("regime_label", "unknown"),
            "regime_score":round(float(regime.get("regime_score", 0)), 3),
            "regime_conf": round(float(regime.get("confidence", 0)), 3),
            "llm_mode":    status.get("mode", "deterministic"),
            "dry_run":     status.get("dry_run", True),
            "drawdown":    round(curr_dd, 4),
            "strategy":    strategy,
            "accuracy":    accuracy,
            # Snapshot compact des signaux forts (score > 0.35)
            "signals": {
                sym: {
                    "d": ("B" if s.get("direction") == "buy"
                          else "S" if s.get("direction") == "sell" else "N"),
                    "s": round(float(s.get("final_score", 0)), 3),
                    "p": round(float(s.get("price", 0)), 2),
                    "c": round(float(s.get("change_pct", 0)), 3),
                    "k": s.get("council", "wait")[:1].upper(),  # E/W/V
                }
                for sym, s in signals.items()
                if abs(float(s.get("final_score", 0))) > 0.35
            },
        }

        self._history.append(cycle)
        logger.info(
            f"[Tracker] Cycle #{len(self._history)} | "
            f"regime={cycle['regime']} | "
            f"n={cycle['n_signals']} signals | "
            f"accuracy={accuracy.get('overall', 0):.1%} | "
            f"execute={cycle['n_execute']}"
        )

    # ════════════════════════════════════════════════════════
    # CALCUL DE PRÉCISION
    # ════════════════════════════════════════════════════════
    def _compute_accuracy(
        self,
        current_signals: Dict,
        batch_quotes:    Optional[Dict],
    ) -> Dict:
        """
        Précision des signaux du cycle PRÉCÉDENT vs prix ACTUELS.

        Méthode :
        - Cycle N dit BUY sur AAPL à $185
        - Cycle N+1 : AAPL est à $187 → +1.08% → correct
        """
        if not self._history:
            return {"overall": 0.0, "buy": 0.0, "sell": 0.0, "n": 0, "n_correct": 0}

        prev = self._history[-1].get("signals", {})
        if not prev:
            return {"overall": 0.0, "buy": 0.0, "sell": 0.0, "n": 0, "n_correct": 0}

        ok_buy = ok_sell = tot_buy = tot_sell = 0

        for sym, prev_sig in prev.items():
            curr_sig = current_signals.get(sym)
            if not curr_sig:
                continue

            p0 = float(prev_sig.get("p", 0))
            p1 = float(curr_sig.get("price", 0))
            if p0 <= 0 or p1 <= 0:
                continue

            went_up = p1 > p0
            d       = prev_sig.get("d", "N")

            if d == "B":
                tot_buy += 1
                if went_up:
                    ok_buy += 1
            elif d == "S":
                tot_sell += 1
                if not went_up:
                    ok_sell += 1

        n       = tot_buy + tot_sell
        n_ok    = ok_buy  + ok_sell
        overall = n_ok / n if n > 0 else 0.0

        return {
            "overall":   round(overall, 4),
            "buy":       round(ok_buy  / tot_buy  if tot_buy  > 0 else 0.0, 4),
            "sell":      round(ok_sell / tot_sell if tot_sell > 0 else 0.0, 4),
            "n":         n,
            "n_correct": n_ok,
        }

    # ════════════════════════════════════════════════════════
    # MÉTRIQUES ROLLING
    # ════════════════════════════════════════════════════════
    def compute_metrics(self, window: int = 30) -> Dict:
        """
        Calcule les métriques de performance sur les N derniers cycles.
        """
        if not self._history:
            return self._empty_metrics()

        recent = self._history[-window:]
        n      = len(recent)

        # ── Accuracy rolling ──────────────────────────────
        acc_vals = [
            c["accuracy"]["overall"]
            for c in recent
            if c.get("accuracy", {}).get("n", 0) >= 3
        ]
        avg_acc  = float(np.mean(acc_vals)) if acc_vals else 0.0

        # ── Win Rate (proxy via n_execute et accuracy) ────
        total_exe = sum(c.get("n_execute", 0) for c in recent)
        if total_exe > 0 and acc_vals:
            win_rate = float(np.mean(acc_vals))
        else:
            win_rate = 0.0

        # ── Sharpe proxy ──────────────────────────────────
        # Utilise le change_pct pondéré par le score comme proxy du PnL
        proxy_returns = []
        for cycle in recent:
            for s in cycle.get("signals", {}).values():
                d   = s.get("d", "N")
                chg = float(s.get("c", 0))
                sc  = float(s.get("s", 0))
                if d == "B" and chg != 0:
                    proxy_returns.append(chg * sc)
                elif d == "S" and chg != 0:
                    proxy_returns.append(-chg * sc)

        sharpe = 0.0
        if len(proxy_returns) >= 10:
            mu     = float(np.mean(proxy_returns))
            sigma  = float(np.std(proxy_returns)) + 1e-10
            sharpe = float(mu / sigma * np.sqrt(252))

        # ── Max Drawdown tracking ─────────────────────────
        dd_vals = [abs(c.get("drawdown", 0)) for c in recent]
        max_dd  = float(max(dd_vals)) if dd_vals else 0.0

        # ── Régime distribution ───────────────────────────
        regime_dist: Dict[str, int] = {}
        for c in recent:
            r = c.get("regime", "unknown")
            regime_dist[r] = regime_dist.get(r, 0) + 1

        # ── LLM taux ──────────────────────────────────────
        llm_n    = sum(1 for c in recent if c.get("llm_mode") == "llm")
        llm_rate = llm_n / max(n, 1)

        # ── Séries temporelles pour le dashboard ──────────
        acc_series    = [round(c.get("accuracy", {}).get("overall", 0), 3) for c in recent]
        regime_series = [c.get("regime", "?") for c in recent[-20:]]
        score_series  = [round(c.get("avg_score", 0), 3) for c in recent]
        dd_series     = [round(abs(c.get("drawdown", 0)), 4) for c in recent]
        ts_series     = [c.get("ts", "") for c in recent]

        return {
            "n_cycles":            n,
            "total_cycles":        len(self._history),
            "window":              window,
            "avg_accuracy":        round(avg_acc, 4),
            "win_rate":            round(win_rate, 4),
            "rolling_sharpe":      round(sharpe, 3),
            "max_drawdown":        round(max_dd, 4),
            "llm_rate":            round(llm_rate, 3),
            "avg_n_signals":       round(float(np.mean([c.get("n_signals", 0) for c in recent])), 1),
            "avg_n_execute":       round(float(np.mean([c.get("n_execute", 0) for c in recent])), 1),
            "avg_score":           round(float(np.mean([c.get("avg_score", 0) for c in recent])), 4),
            "regime_distribution": regime_dist,
            "regime_series":       regime_series,
            "accuracy_series":     acc_series,
            "score_series":        score_series,
            "drawdown_series":     dd_series,
            "ts_series":           ts_series,
            "updated_at":          datetime.utcnow().isoformat() + "Z",
        }

    # ════════════════════════════════════════════════════════
    # PERFORMANCE PAR RÉGIME
    # ════════════════════════════════════════════════════════
    def get_regime_performance(self) -> Dict:
        """Performance breakdown par régime de marché."""
        by_regime: Dict[str, Dict] = {}

        for cycle in self._history:
            r   = cycle.get("regime", "unknown")
            acc = cycle.get("accuracy", {}).get("overall", 0.0)
            sc  = cycle.get("avg_score", 0.0)
            exe = cycle.get("n_execute", 0)

            if r not in by_regime:
                by_regime[r] = {"acc": [], "scores": [], "executes": [], "n": 0}

            by_regime[r]["acc"].append(acc)
            by_regime[r]["scores"].append(sc)
            by_regime[r]["executes"].append(exe)
            by_regime[r]["n"] += 1

        return {
            regime: {
                "avg_accuracy":  round(float(np.mean(d["acc"])), 4),
                "avg_score":     round(float(np.mean(d["scores"])), 4),
                "avg_execute":   round(float(np.mean(d["executes"])), 1),
                "n_cycles":      d["n"],
                "best_accuracy": round(float(max(d["acc"])), 4) if d["acc"] else 0.0,
            }
            for regime, d in by_regime.items()
        }

    # ════════════════════════════════════════════════════════
    # GETTERS
    # ════════════════════════════════════════════════════════
    def get_recent_cycles(self, n: int = 10) -> List[Dict]:
        return self._history[-n:] if self._history else []

    def get_best_symbols(self, n: int = 10) -> List[Dict]:
        """Top N symboles avec la meilleure précision historique."""
        sym_acc: Dict[str, List[float]] = {}
        for cycle in self._history:
            sigs = cycle.get("signals", {})
            acc  = cycle.get("accuracy", {})
            if not acc.get("n", 0):
                continue
            overall = acc.get("overall", 0)
            for sym in sigs:
                sym_acc.setdefault(sym, []).append(overall)

        ranked = sorted(
            [
                {
                    "symbol":   sym,
                    "avg_acc":  round(float(np.mean(vals)), 4),
                    "n_cycles": len(vals),
                }
                for sym, vals in sym_acc.items()
                if len(vals) >= 3
            ],
            key=lambda x: x["avg_acc"],
            reverse=True,
        )
        return ranked[:n]

    def _empty_metrics(self) -> Dict:
        return {
            "n_cycles": 0, "total_cycles": 0, "window": 30,
            "avg_accuracy": 0.0, "win_rate": 0.0,
            "rolling_sharpe": 0.0, "max_drawdown": 0.0,
            "llm_rate": 0.0, "avg_n_signals": 0.0,
            "avg_n_execute": 0.0, "avg_score": 0.0,
            "regime_distribution": {}, "regime_series": [],
            "accuracy_series": [], "score_series": [],
            "drawdown_series": [], "ts_series": [],
            "updated_at": datetime.utcnow().isoformat() + "Z",
        }