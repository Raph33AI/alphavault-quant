# ============================================================
# AGENT 13 — Self Evaluation Agent
# ✅ Évalue la performance globale du système
# ✅ Génère un rapport de performance détaillé
# ✅ Identifie les points d'amélioration
# ✅ Compare avec benchmarks (SPY, 60/40)
# ============================================================

import numpy as np
from typing import Dict, List, Optional
from loguru import logger
from datetime import datetime

class SelfEvaluationAgent:
    """
    Agent d'auto-évaluation du système de trading.

    Métriques calculées :
    - Sharpe, Sortino, Calmar
    - Win rate, Profit factor
    - Alpha vs SPY
    - Model accuracy
    - Execution quality score
    """

    def __init__(self, worker_client, settings):
        self.client   = worker_client
        self.settings = settings
        self._trade_log: List[Dict] = []
        logger.info("✅ SelfEvaluationAgent initialisé")

    def evaluate(
        self,
        trade_log:       List[Dict],
        portfolio_returns: List[float],
        benchmark_returns: List[float],
        model_metrics:   Dict,
        execution_metrics: Dict,
    ) -> Dict:
        """Évaluation complète du système."""
        report = {
            "timestamp":     datetime.utcnow().isoformat() + "Z",
            "n_trades":      len(trade_log),
            "period_days":   len(portfolio_returns),
        }

        if len(portfolio_returns) >= 5:
            report["return_metrics"]     = self._compute_return_metrics(portfolio_returns)
            report["risk_metrics"]       = self._compute_risk_metrics(portfolio_returns)
            report["vs_benchmark"]       = self._compare_to_benchmark(
                portfolio_returns, benchmark_returns
            )

        if trade_log:
            report["trade_metrics"] = self._compute_trade_metrics(trade_log)

        report["model_quality"]     = model_metrics
        report["execution_quality"] = execution_metrics
        report["overall_grade"]     = self._compute_grade(report)

        # LLM optionnel pour narrative d'évaluation
        if self.client.llm_available and len(portfolio_returns) >= 5:
            try:
                sharpe = report.get("return_metrics", {}).get("sharpe_ratio", 0)
                alpha  = report.get("vs_benchmark", {}).get("alpha_annualized", 0)
                prompt = (
                    f"Trading system evaluation:\n"
                    f"Sharpe: {sharpe:.2f} | Alpha: {alpha:.1%} | "
                    f"Grade: {report.get('overall_grade')}\n"
                    f"Key metrics: {report.get('trade_metrics', {})}\n"
                    f"Identify top 2 areas for improvement. Be specific."
                )
                report["llm_evaluation"] = self.client.call_llm(
                    prompt, max_tokens=300
                )
            except Exception:
                pass

        logger.info(
            f"📈 Self Evaluation | Grade: {report.get('overall_grade')} | "
            f"Sharpe: {report.get('return_metrics', {}).get('sharpe_ratio', 0):.2f}"
        )
        return report

    def _compute_return_metrics(self, returns: List[float]) -> Dict:
        arr = np.array(returns)
        total_ret   = float(np.expm1(np.sum(np.log1p(arr))))
        sharpe      = float(np.mean(arr) / (np.std(arr) + 1e-10) * np.sqrt(252))
        sortino_neg = arr[arr < 0]
        sortino_std = float(np.std(sortino_neg)) if len(sortino_neg) > 0 else 1e-10
        sortino     = float(np.mean(arr) / sortino_std * np.sqrt(252))
        return {
            "total_return":      round(total_ret, 4),
            "sharpe_ratio":      round(sharpe, 3),
            "sortino_ratio":     round(sortino, 3),
            "annualized_return": round(float(np.mean(arr) * 252), 4),
            "daily_vol":         round(float(np.std(arr)), 4),
        }

    def _compute_risk_metrics(self, returns: List[float]) -> Dict:
        arr      = np.array(returns)
        cumret   = (1 + arr).cumprod()
        peak     = np.maximum.accumulate(cumret)
        drawdown = (cumret - peak) / peak
        max_dd   = float(drawdown.min())
        calmar   = float(np.mean(arr) * 252 / (abs(max_dd) + 1e-10))
        var_95   = float(np.percentile(arr, 5))
        cvar_95  = float(arr[arr <= var_95].mean()) if any(arr <= var_95) else var_95
        return {
            "max_drawdown": round(max_dd, 4),
            "calmar_ratio": round(calmar, 3),
            "var_95_daily": round(abs(var_95), 4),
            "cvar_95_daily": round(abs(cvar_95), 4),
        }

    def _compare_to_benchmark(
        self,
        port:  List[float],
        bench: List[float],
    ) -> Dict:
        if not bench or len(bench) < 3:
            return {"alpha_annualized": 0.0, "beta": 1.0, "information_ratio": 0.0}
        min_len  = min(len(port), len(bench))
        p_arr    = np.array(port[-min_len:])
        b_arr    = np.array(bench[-min_len:])
        beta     = float(np.cov(p_arr, b_arr)[0, 1] / (np.var(b_arr) + 1e-10))
        alpha    = float(np.mean(p_arr - beta * b_arr) * 252)
        te       = float(np.std(p_arr - b_arr))
        ir       = float((np.mean(p_arr) - np.mean(b_arr)) / (te + 1e-10) * np.sqrt(252))
        return {
            "alpha_annualized":  round(alpha, 4),
            "beta":              round(beta, 3),
            "information_ratio": round(ir, 3),
            "tracking_error":    round(te * np.sqrt(252), 4),
        }

    def _compute_trade_metrics(self, trades: List[Dict]) -> Dict:
        pnls      = [t.get("pnl_pct", 0) for t in trades if "pnl_pct" in t]
        if not pnls:
            return {}
        winners   = [p for p in pnls if p > 0]
        losers    = [p for p in pnls if p < 0]
        win_rate  = len(winners) / (len(pnls) + 1e-10)
        avg_win   = float(np.mean(winners)) if winners else 0.0
        avg_loss  = float(np.mean(losers))  if losers  else 0.0
        pf        = abs(avg_win / (avg_loss + 1e-10)) * win_rate / (1 - win_rate + 1e-10)
        return {
            "n_trades":      len(pnls),
            "win_rate":      round(win_rate, 3),
            "avg_win_pct":   round(avg_win, 4),
            "avg_loss_pct":  round(avg_loss, 4),
            "profit_factor": round(pf, 3),
        }

    def _compute_grade(self, report: Dict) -> str:
        ret_m = report.get("return_metrics", {})
        sharpe = ret_m.get("sharpe_ratio", 0)
        alpha  = report.get("vs_benchmark", {}).get("alpha_annualized", 0)
        dd     = abs(report.get("risk_metrics", {}).get("max_drawdown", 1))
        if sharpe > 2.0 and alpha > 0.05 and dd < 0.05:
            return "A+"
        elif sharpe > 1.5 and alpha > 0.02:
            return "A"
        elif sharpe > 1.0:
            return "B"
        elif sharpe > 0.5:
            return "C"
        elif sharpe > 0:
            return "D"
        else:
            return "F"