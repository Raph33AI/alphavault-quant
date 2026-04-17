# ============================================================
# AGENT 8 — Market Impact Model
# ✅ Estime l'impact de marché de chaque ordre
# ✅ Modèle Almgren-Chriss simplifié
# ✅ Optimise la taille des ordres pour minimiser l'impact
# ============================================================

import numpy as np
import pandas as pd
from typing import Dict, Optional
from loguru import logger

class MarketImpactModel:
    """
    Modèle d'impact de marché basé sur Almgren-Chriss.

    Impact = η × σ × (Q/V)^0.5 × signe(Q)
    où :
    - η = coefficient d'impact (calibré empiriquement)
    - σ = volatilité du titre
    - Q = taille de l'ordre
    - V = volume journalier moyen
    """

    ETA = 0.1  # Coefficient d'impact (typique pour large caps US)

    def __init__(self):
        logger.info("✅ MarketImpactModel initialisé")

    def estimate(
        self,
        symbol:         str,
        order_shares:   int,
        order_side:     str,
        current_price:  float,
        df_daily:       pd.DataFrame,
    ) -> Dict:
        """
        Estime l'impact de marché pour un ordre donné.
        """
        try:
            if df_daily.empty or len(df_daily) < 20:
                return self._default_impact(current_price, order_shares)

            log_ret = np.log(df_daily["close"] / df_daily["close"].shift(1)).dropna()
            sigma   = float(log_ret.tail(20).std())
            adv     = float((df_daily["close"] * df_daily["volume"]).tail(20).mean())
            adv_shares = float(df_daily["volume"].tail(20).mean())

            order_value   = abs(order_shares) * current_price
            order_adv_pct = order_value / (adv + 1e-10)

            # Almgren-Chriss impact en %
            impact_pct = self.ETA * sigma * np.sqrt(order_adv_pct)
            impact_bps = impact_pct * 10000

            # Slippage directionnel
            direction_mult = 1.0 if order_side == "buy" else -1.0
            price_impact   = current_price * impact_pct * direction_mult

            # VWAP optimal : fractionnement recommandé
            if order_adv_pct > 0.01:
                n_slices = int(np.ceil(order_adv_pct / 0.005))
                n_slices = min(n_slices, 20)
            else:
                n_slices = 1

            return {
                "symbol":           symbol,
                "order_shares":     order_shares,
                "order_value_usd":  round(order_value, 2),
                "adv_pct":          round(float(order_adv_pct), 4),
                "impact_bps":       round(float(impact_bps), 2),
                "impact_pct":       round(float(impact_pct), 5),
                "price_impact_usd": round(float(abs(price_impact)), 4),
                "sigma_daily":      round(float(sigma), 4),
                "n_slices_optimal": n_slices,
                "acceptable":       impact_bps < 20,
                "high_impact":      impact_bps > 50,
            }

        except Exception as e:
            logger.error(f"MarketImpactModel.estimate({symbol}): {e}")
            return self._default_impact(current_price, order_shares)

    def optimal_order_size(
        self,
        target_pct:    float,
        portfolio_value: float,
        current_price: float,
        df_daily:      pd.DataFrame,
        max_impact_bps: float = 15.0,
    ) -> Dict:
        """
        Calcule la taille maximale d'ordre qui respecte le budget d'impact.
        """
        try:
            log_ret    = np.log(df_daily["close"] / df_daily["close"].shift(1)).dropna()
            sigma      = float(log_ret.tail(20).std())
            adv        = float((df_daily["close"] * df_daily["volume"]).tail(20).mean())
            max_impact = max_impact_bps / 10000

            # Résout : ETA × σ × √(Q/V) = max_impact
            max_adv_pct = (max_impact / (self.ETA * sigma + 1e-10)) ** 2
            max_order_usd = adv * max_adv_pct

            # Target order
            target_usd = portfolio_value * target_pct
            optimal_usd = min(target_usd, max_order_usd)
            optimal_shares = int(optimal_usd / (current_price + 1e-10))

            return {
                "target_usd":       round(target_usd, 2),
                "optimal_usd":      round(optimal_usd, 2),
                "optimal_shares":   optimal_shares,
                "size_reduction_pct": round(
                    max(0, 1 - optimal_usd / (target_usd + 1e-10)), 3
                ),
                "impact_constraint_bps": max_impact_bps,
            }
        except Exception as e:
            logger.error(f"MarketImpactModel.optimal_order_size: {e}")
            shares = int(portfolio_value * target_pct / (current_price + 1e-10))
            return {"optimal_shares": shares, "optimal_usd": shares * current_price}

    def _default_impact(self, price: float, shares: int) -> Dict:
        return {
            "impact_bps": 5.0,
            "impact_pct": 0.0005,
            "acceptable": True,
            "n_slices_optimal": 1,
            "order_value_usd": abs(shares) * price,
        }