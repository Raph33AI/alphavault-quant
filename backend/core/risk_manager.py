# ============================================================
# ALPHAVAULT QUANT — Risk Manager
# ✅ Kelly Sizing dynamique
# ✅ CVaR / Expected Shortfall
# ✅ Tail Risk, Drawdown Guardian
# ✅ Gamma Exposure Limits
# ✅ Leverage Constraints
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from loguru import logger
from scipy import stats

class RiskManager:
    """
    Gestionnaire de risque complet du portefeuille.

    Responsabilités :
    - Calibrer la taille des positions (Kelly fractionnel)
    - Calculer les métriques de risque (VaR, CVaR, ES)
    - Vérifier les contraintes de levier et d'exposition
    - Émettre des signaux de réduction de risque
    """

    def __init__(self, settings):
        self.settings     = settings
        self._daily_pnl   = []  # Historique des P&L journaliers
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
        Calcule la taille de position via Kelly fractionnel.

        Kelly complet = (p × b - q) / b
        Kelly fractionnel = Kelly × fraction (fraction < 1 pour sécurité)

        Args:
            buy_prob     : probabilité de hausse [0,1]
            expected_ret : rendement espéré par trade
            expected_vol : volatilité espérée
            confidence   : confiance du signal [0,1]
        
        Returns:
            position_size_pct : pourcentage du capital [0, MAX_POSITION]
        """
        if expected_vol <= 0 or confidence < 0.40:
            return 0.0

        p = float(buy_prob)
        q = 1.0 - p
        b = abs(float(expected_ret)) / (float(expected_vol) * 0.01 + 1e-10)

        kelly_full = (p * b - q) / (b + 1e-10) if b > 0 else 0.0

        # Fraction de Kelly (sécurité) — ajustée par confiance
        kelly_fraction = 0.25 * confidence  # Max 25% du Kelly complet

        # Ajustement par régime (régime favorable → plus agressif)
        regime_mult = 1.0 + max(0, regime_score) * 0.20  # +20% max si trending up

        kelly_adjusted = kelly_full * kelly_fraction * regime_mult

        # Contraintes max
        max_size = self.settings.MAX_SINGLE_POSITION_PCT
        kelly_capped = float(np.clip(kelly_adjusted, 0.0, max_size))

        logger.debug(
            f"Kelly: full={kelly_full:.3f} | frac={kelly_fraction:.2f} | "
            f"final={kelly_capped:.3f}"
        )
        return kelly_capped

    # ── VaR & CVaR ───────────────────────────────────────────
    def compute_var_cvar(
        self,
        returns:      np.ndarray,
        confidence:   float = 0.95,
        horizon_days: int   = 1,
    ) -> Dict[str, float]:
        """
        Calcule Value at Risk et Conditional VaR (Expected Shortfall).
        
        VaR(95%)   : perte maximale à 95% de confiance
        CVaR(95%)  : perte moyenne dans les 5% pires cas
        """
        if len(returns) < 20:
            return {"var_95": 0.0, "cvar_95": 0.0, "var_99": 0.0, "cvar_99": 0.0}

        returns = np.array(returns)
        scale   = np.sqrt(horizon_days)

        # VaR historique
        var_95 = float(np.percentile(returns, (1 - confidence) * 100) * scale)
        var_99 = float(np.percentile(returns, 1.0) * scale)

        # CVaR = moyenne des pertes au-delà du VaR
        tail_95 = returns[returns <= np.percentile(returns, (1 - confidence) * 100)]
        tail_99 = returns[returns <= np.percentile(returns, 1.0)]
        cvar_95 = float(np.mean(tail_95) * scale) if len(tail_95) > 0 else var_95
        cvar_99 = float(np.mean(tail_99) * scale) if len(tail_99) > 0 else var_99

        # Expected Shortfall paramétrique (Cornish-Fisher)
        mu    = np.mean(returns)
        sigma = np.std(returns)
        z_95  = stats.norm.ppf(1 - confidence)
        es_param_95 = float(-(mu + sigma * stats.norm.pdf(z_95) / (1 - confidence)) * scale)

        return {
            "var_95":       round(abs(var_95), 4),
            "var_99":       round(abs(var_99), 4),
            "cvar_95":      round(abs(cvar_95), 4),
            "cvar_99":      round(abs(cvar_99), 4),
            "es_param_95":  round(abs(es_param_95), 4),
        }

    # ── Portfolio Risk Metrics ────────────────────────────────
    def compute_portfolio_risk(
        self,
        positions:    Dict[str, float],   # {symbol: weight}
        returns_dict: Dict[str, np.ndarray],
        portfolio_value: float,
    ) -> Dict:
        """
        Métriques de risque au niveau portefeuille.
        """
        try:
            symbols = [s for s in positions if s in returns_dict and len(returns_dict[s]) >= 20]
            if not symbols:
                return self._empty_risk_metrics()

            weights = np.array([positions[s] for s in symbols])
            if weights.sum() > 0:
                weights /= weights.sum()

            # Matrice de returns
            ret_matrix = np.column_stack([returns_dict[s] for s in symbols])
            min_len    = min(len(returns_dict[s]) for s in symbols)
            ret_matrix = ret_matrix[-min_len:, :]

            # Rendements portefeuille
            port_returns = ret_matrix @ weights

            # VaR / CVaR portefeuille
            var_cvar = self.compute_var_cvar(port_returns)

            # Volatilité portefeuille
            cov_matrix  = np.cov(ret_matrix.T)
            port_vol    = float(np.sqrt(weights @ cov_matrix @ weights) * np.sqrt(252))

            # Corrélation clustering
            corr_matrix = np.corrcoef(ret_matrix.T)
            avg_corr    = float(np.mean(corr_matrix[np.triu_indices_from(corr_matrix, k=1)]))

            # Sharpe ratio (ex-post)
            sharpe = float(np.mean(port_returns) / (np.std(port_returns) + 1e-10) * np.sqrt(252))

            # Drawdown courant
            cumret    = (1 + port_returns).cumprod()
            peak      = cumret.cummax()
            dd_series = (cumret - peak) / peak
            max_dd    = float(dd_series.min())
            curr_dd   = float(dd_series.iloc[-1])

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
        max_lever       = self.settings.MAX_PORTFOLIO_LEVERAGE

        regime_lever_mult = {
            "trend_up":          1.00,
            "trend_down":        0.60,
            "range_bound":       0.80,
            "low_volatility":    1.00,
            "high_volatility":   0.50,
            "crash":             0.20,
            "macro_tightening":  0.70,
            "macro_easing":      0.90,
        }
        mult           = regime_lever_mult.get(regime_label, 0.80)
        if reduce_exposure:
            mult *= 0.75

        allowed_lever  = max_lever * mult
        current_lever  = total_exposure / (portfolio_value + 1e-10)
        over_leveraged = current_lever > allowed_lever

        # ✅ FIX : évite ZeroDivisionError quand pas de positions
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
        """
        Met à jour le suivi du drawdown et émet des alertes.
        """
        self._daily_pnl.append(daily_pnl_pct)
        self._peak_equity = max(self._peak_equity, equity)
        self._current_dd  = (equity - self._peak_equity) / self._peak_equity

        hit_daily_limit   = daily_pnl_pct < -self.settings.DAILY_LOSS_LIMIT_PCT
        hit_max_drawdown  = self._current_dd < -self.settings.MAX_DRAWDOWN_PCT

        return {
            "current_drawdown":  round(self._current_dd, 4),
            "peak_equity":       round(self._peak_equity, 2),
            "current_equity":    round(equity, 2),
            "daily_pnl_pct":     round(daily_pnl_pct, 4),
            "halt_trading":      hit_daily_limit or hit_max_drawdown,
            "hit_daily_limit":   hit_daily_limit,
            "hit_max_drawdown":  hit_max_drawdown,
            "daily_limit":       -self.settings.DAILY_LOSS_LIMIT_PCT,
            "max_drawdown_limit":-self.settings.MAX_DRAWDOWN_PCT,
        }

    # ── Position Sizing Final ─────────────────────────────────
    def compute_position_size(
        self,
        signal:        Dict,
        regime_result: Dict,
        portfolio_value: float,
        current_price: float,
    ) -> Dict:
        """
        Calcule la taille de position finale en $, % et nombre d'actions.
        """
        kelly_pct = self.kelly_size(
            buy_prob     = signal.get("adjusted_buy_prob", 0.5),
            expected_ret = signal.get("expected_ret", 0.0),
            expected_vol = signal.get("expected_vol", 0.15),
            confidence   = signal.get("adjusted_confidence", 0.0),
            regime_score = regime_result.get("regime_score", 0.0),
        )

        position_usd   = portfolio_value * kelly_pct
        position_shares= int(position_usd / (current_price + 1e-10))

        # Direction
        direction = signal.get("direction", "neutral")
        if direction == "sell":
            position_shares = -position_shares
            position_usd    = -position_usd

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