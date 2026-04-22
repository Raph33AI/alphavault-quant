# ============================================================
# ALPHAVAULT QUANT — Risk Manager v2.1
# FIX v2.1 : Kelly corrigé — expected_ret dérivé du final_score
#             DAILY_LOSS_LIMIT_PCT + MAX_PORTFOLIO_LEVERAGE via settings
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, List, Optional
from loguru import logger
from scipy import stats

class RiskManager:
    def __init__(self, settings):
        self.settings     = settings
        self._daily_pnl   = []
        self._peak_equity = 1.0
        self._current_dd  = 0.0
        logger.info("✅ RiskManager initialisé")

    # ── Kelly Sizing ──────────────────────────────────────────
    def kelly_size(
        self,
        buy_prob:     float,
        expected_ret: float,
        expected_vol: float,
        confidence:   float,
        regime_score: float = 0.0,
    ) -> float:
        """
        Kelly fractionnel.
        FIX v2.1 : garde un expected_ret minimal si 0
        """
        # ✅ FIX : expected_ret ne peut pas être 0 (Kelly serait 0)
        if expected_ret <= 0:
            expected_ret = 0.008  # 0.8% minimal assumption

        if expected_vol <= 0:
            expected_vol = 0.15

        if confidence < 0.40:
            return 0.0

        p = float(buy_prob)
        q = 1.0 - p
        b = abs(float(expected_ret)) / (float(expected_vol) * 0.01 + 1e-10)

        kelly_full = (p * b - q) / (b + 1e-10) if b > 0 else 0.0

        # Fraction de Kelly ajustée par confiance
        kelly_fraction = 0.25 * min(confidence, 1.0)

        # Bonus régime favorable
        regime_mult = 1.0 + max(0.0, float(regime_score)) * 0.20

        kelly_adjusted = kelly_full * kelly_fraction * regime_mult

        max_size    = getattr(self.settings, 'MAX_SINGLE_POSITION_PCT', 0.08)
        kelly_final = float(np.clip(kelly_adjusted, 0.0, max_size))

        logger.debug(
            f"Kelly: full={kelly_full:.3f} | frac={kelly_fraction:.2f} | "
            f"ret={expected_ret:.4f} | vol={expected_vol:.3f} | "
            f"final={kelly_final:.3f}"
        )
        return kelly_final

    # ── VaR & CVaR ───────────────────────────────────────────
    def compute_var_cvar(
        self,
        returns:      np.ndarray,
        confidence:   float = 0.95,
        horizon_days: int   = 1,
    ) -> Dict:
        if len(returns) < 20:
            return {"var_95": 0.0, "cvar_95": 0.0,
                    "var_99": 0.0, "cvar_99": 0.0}

        returns = np.array(returns)
        scale   = np.sqrt(horizon_days)

        var_95 = float(np.percentile(returns, (1 - confidence) * 100) * scale)
        var_99 = float(np.percentile(returns, 1.0) * scale)

        tail_95 = returns[returns <= np.percentile(returns, (1 - confidence) * 100)]
        tail_99 = returns[returns <= np.percentile(returns, 1.0)]
        cvar_95 = float(np.mean(tail_95) * scale) if len(tail_95) > 0 else var_95
        cvar_99 = float(np.mean(tail_99) * scale) if len(tail_99) > 0 else var_99

        mu    = np.mean(returns)
        sigma = np.std(returns)
        z_95  = stats.norm.ppf(1 - confidence)
        es_param_95 = float(
            -(mu + sigma * stats.norm.pdf(z_95) / (1 - confidence)) * scale
        )

        return {
            "var_95":      round(abs(var_95), 4),
            "var_99":      round(abs(var_99), 4),
            "cvar_95":     round(abs(cvar_95), 4),
            "cvar_99":     round(abs(cvar_99), 4),
            "es_param_95": round(abs(es_param_95), 4),
        }

    # ── Portfolio Risk ────────────────────────────────────────
    def compute_portfolio_risk(
        self,
        positions:       Dict,
        returns_dict:    Dict,
        portfolio_value: float,
    ) -> Dict:
        try:
            symbols = [
                s for s in positions
                if s in returns_dict and len(returns_dict[s]) >= 20
            ]
            if not symbols:
                return self._empty_risk_metrics()

            weights = np.array([positions[s] for s in symbols])
            if weights.sum() > 0:
                weights /= weights.sum()

            ret_matrix   = np.column_stack([returns_dict[s] for s in symbols])
            min_len      = min(len(returns_dict[s]) for s in symbols)
            ret_matrix   = ret_matrix[-min_len:, :]
            port_returns = ret_matrix @ weights

            var_cvar    = self.compute_var_cvar(port_returns)
            cov_matrix  = np.cov(ret_matrix.T)
            port_vol    = float(
                np.sqrt(weights @ cov_matrix @ weights) * np.sqrt(252)
            )
            corr_matrix = np.corrcoef(ret_matrix.T)
            avg_corr    = float(
                np.mean(corr_matrix[np.triu_indices_from(corr_matrix, k=1)])
            )
            sharpe = float(
                np.mean(port_returns) / (np.std(port_returns) + 1e-10) * np.sqrt(252)
            )

            cumret    = (1 + port_returns).cumprod()
            peak      = np.maximum.accumulate(cumret)
            dd_series = (cumret - peak) / peak
            max_dd    = float(np.min(dd_series))
            curr_dd   = float(dd_series[-1])

            return {
                **var_cvar,
                "portfolio_vol_annual": round(port_vol, 4),
                "avg_correlation":      round(avg_corr, 3),
                "sharpe_ratio":         round(sharpe, 3),
                "max_drawdown":         round(max_dd, 4),
                "current_drawdown":     round(curr_dd, 4),
                "portfolio_value":      portfolio_value,
                "n_positions":          len(symbols),
            }
        except Exception as e:
            logger.error(f"compute_portfolio_risk: {e}")
            return self._empty_risk_metrics()

    # ── Leverage Check ────────────────────────────────────────
    def check_leverage_constraints(
        self,
        total_exposure:  float,
        portfolio_value: float,
        regime_result:   Dict,
    ) -> Dict:
        regime_label    = regime_result.get("regime_label", "range_bound")
        reduce_exposure = regime_result.get("reduce_exposure", False)

        # ✅ FIX : utilise MAX_PORTFOLIO_LEVERAGE via settings
        max_lever = getattr(self.settings, 'MAX_PORTFOLIO_LEVERAGE',
                    getattr(self.settings, 'max_leverage', 1.5))

        regime_lever_mult = {
            "trend_up":         1.00,
            "trend_down":       0.60,
            "range_bound":      0.80,
            "low_volatility":   1.00,
            "high_volatility":  0.50,
            "crash":            0.20,
            "macro_tightening": 0.70,
            "macro_easing":     0.90,
        }
        mult = regime_lever_mult.get(regime_label, 0.80)
        if reduce_exposure:
            mult *= 0.75

        allowed_lever  = max_lever * mult
        current_lever  = total_exposure / (portfolio_value + 1e-10)
        over_leveraged = current_lever > allowed_lever

        if current_lever > 0:
            reduce_by_pct = max(0.0, (current_lever - allowed_lever) / current_lever)
        else:
            reduce_by_pct = 0.0

        return {
            "max_leverage":      round(max_lever, 2),
            "allowed_leverage":  round(allowed_lever, 2),
            "current_leverage":  round(current_lever, 2),
            "is_over_leveraged": over_leveraged,
            "reduce_by_pct":     round(reduce_by_pct, 3),
            "regime_mult":       round(mult, 2),
        }

    # ── Drawdown Guardian ─────────────────────────────────────
    def update_drawdown(self, daily_pnl_pct: float, equity: float) -> Dict:
        self._daily_pnl.append(daily_pnl_pct)
        self._peak_equity = max(self._peak_equity, equity)
        self._current_dd  = (equity - self._peak_equity) / self._peak_equity

        # ✅ FIX : utilise DAILY_LOSS_LIMIT_PCT via settings
        daily_limit = getattr(self.settings, 'DAILY_LOSS_LIMIT_PCT',
                     getattr(self.settings, 'daily_loss_limit', 0.02))
        max_dd_pct  = getattr(self.settings, 'MAX_DRAWDOWN_PCT',
                     getattr(self.settings, 'max_drawdown_pct', 0.10))

        hit_daily_limit  = daily_pnl_pct < -daily_limit
        hit_max_drawdown = self._current_dd < -max_dd_pct

        return {
            "current_drawdown":   round(self._current_dd, 4),
            "peak_equity":        round(self._peak_equity, 2),
            "current_equity":     round(equity, 2),
            "daily_pnl_pct":      round(daily_pnl_pct, 4),
            "halt_trading":       hit_daily_limit or hit_max_drawdown,
            "hit_daily_limit":    hit_daily_limit,
            "hit_max_drawdown":   hit_max_drawdown,
            "daily_limit":        -daily_limit,
            "max_drawdown_limit": -max_dd_pct,
        }

    # ── Position Sizing ───────────────────────────────────────
    def compute_position_size(
        self,
        signal:          Dict,
        regime_result:   Dict,
        portfolio_value: float,
        current_price:   float,
    ) -> Dict:
        """
        FIX v2.1 : dérive expected_ret du final_score si absent.
        Avant : expected_ret=0.0 → Kelly=0 → 0 ordres.
        Après : expected_ret = max(score * 0.03, 0.008) → Kelly > 0.
        """
        final_score = abs(float(signal.get("final_score", 0.0) or 0.0))
        confidence  = float(signal.get("adjusted_confidence", 0.0) or 0.0)

        # ✅ FIX CRITIQUE : dériver le return attendu du score ML
        expected_ret = float(
            signal.get("expected_ret")
            or max(final_score * 0.03, 0.008)  # min 0.8%
        )
        expected_vol = float(signal.get("expected_vol") or 0.15)

        kelly_pct = self.kelly_size(
            buy_prob     = float(signal.get("adjusted_buy_prob", 0.5) or 0.5),
            expected_ret = expected_ret,
            expected_vol = expected_vol,
            confidence   = confidence,
            regime_score = float(regime_result.get("regime_score", 0.0) or 0.0),
        )

        position_usd    = portfolio_value * kelly_pct
        position_shares = int(position_usd / (current_price + 1e-10))

        direction = signal.get("direction", "neutral")
        if direction == "sell":
            position_shares = -position_shares
            position_usd    = -position_usd

        logger.debug(
            f"PositionSize | score={final_score:.3f} | conf={confidence:.3f} | "
            f"ret={expected_ret:.4f} | kelly={kelly_pct:.3f} | "
            f"shares={position_shares} | ${position_usd:.0f}"
        )

        return {
            "position_pct":    round(kelly_pct, 4),
            "position_usd":    round(position_usd, 2),
            "position_shares": position_shares,
            "direction":       direction,
            "portfolio_value": portfolio_value,
            "price":           current_price,
        }

    def _empty_risk_metrics(self) -> Dict:
        return {
            "var_95": 0.0, "var_99": 0.0,
            "cvar_95": 0.0, "cvar_99": 0.0,
            "portfolio_vol_annual": 0.0,
            "avg_correlation": 0.0,
            "sharpe_ratio": 0.0,
            "max_drawdown": 0.0,
            "current_drawdown": 0.0,
        }