"""
performance_tracker.py — AlphaVault Quant v1.0
Tracking des performances de trading par cycle.
"""
import json, datetime
from pathlib import Path
from typing import Dict, List, Optional
from loguru import logger

class PerformanceTracker:
    def __init__(self, root_dir: Optional[Path] = None):
        self.root_dir = root_dir or Path("/home/ubuntu/alphavault")
        self.cycles: List[Dict] = []
        self._load()

    def _load(self):
        try:
            p = self.root_dir / "docs" / "signals" / "performance_metrics.json"
            if p.exists():
                self.cycles = json.loads(p.read_text()).get("cycles", [])
        except Exception as e:
            logger.debug(f"PerformanceTracker._load: {e}")

    def record_cycle(self, output: Dict, batch_quotes: Optional[Dict] = None, run_id: str = "local") -> None:
        try:
            signals    = output.get("current_signals", {}).get("signals", {})
            executions = output.get("agent_decisions", {}).get("executions", [])
            portfolio  = output.get("portfolio", {})
            regime     = output.get("regime", {}).get("global", {})
            self.cycles.append({
                "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
                "run_id":        run_id,
                "n_signals":     len(signals),
                "n_executions":  len(executions),
                "portfolio_value": float(portfolio.get("total_value", 100_000)),
                "session":       output.get("current_signals", {}).get("session", "unknown"),
                "regime":        regime.get("regime_label", "unknown"),
                "llm_mode":      output.get("current_signals", {}).get("llm_mode", "deterministic"),
                "executions": [{"symbol": e.get("symbol"), "status": e.get("result", {}).get("status")} for e in executions[:10]],
            })
            if len(self.cycles) > 500:
                self.cycles = self.cycles[-500:]
        except Exception as e:
            logger.debug(f"PerformanceTracker.record_cycle: {e}")

    def compute_metrics(self) -> Dict:
        try:
            total = len(self.cycles)
            if not total:
                return {"total_cycles": 0, "win_rate": 0.0, "sharpe": 0.0}
            return {
                "total_cycles":    total,
                "total_executions": sum(c.get("n_executions", 0) for c in self.cycles),
                "avg_signals":     round(sum(c.get("n_signals", 0) for c in self.cycles) / total, 1),
                "last_cycle":      self.cycles[-1].get("timestamp"),
                "win_rate":        0.0, "sharpe": 0.0, "max_drawdown": 0.0,
                "computed_at":     datetime.datetime.utcnow().isoformat() + "Z",
            }
        except Exception as e:
            return {"total_cycles": 0, "error": str(e)}

    def get_best_symbols(self, n: int = 10) -> List[Dict]:
        try:
            counts: Dict[str, int] = {}
            for c in self.cycles:
                for e in c.get("executions", []):
                    s = e.get("symbol", "")
                    if s:
                        counts[s] = counts.get(s, 0) + 1
            return [{"symbol": s, "count": v} for s, v in sorted(counts.items(), key=lambda x: -x[1])[:n]]
        except Exception:
            return []

    def get_regime_performance(self) -> Dict:
        try:
            regimes: Dict[str, Dict] = {}
            for c in self.cycles:
                r = c.get("regime", "unknown")
                if r not in regimes:
                    regimes[r] = {"count": 0, "executions": 0}
                regimes[r]["count"] += 1
                regimes[r]["executions"] += c.get("n_executions", 0)
            return regimes
        except Exception:
            return {}

    def save(self) -> None:
        try:
            p = self.root_dir / "docs" / "signals" / "performance_metrics.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({"cycles": self.cycles[-100:], "metrics": self.compute_metrics(), "updated_at": datetime.datetime.utcnow().isoformat() + "Z"}, indent=2, default=str))
        except Exception as e:
            logger.debug(f"PerformanceTracker.save: {e}")
