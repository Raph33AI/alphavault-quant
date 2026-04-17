# ============================================================
# AGENT 10 — Greeks Balancer
# ✅ Équilibre l'exposition aux Greeks du portefeuille
# ✅ Gestion delta, gamma, vega, theta
# ✅ Proxy Greeks depuis données OHLCV (sans options feed)
# ============================================================

import numpy as np
from typing import Dict, List
from loguru import logger

class GreeksBalancer:
    """
    Équilibre les expositions aux Greeks du portefeuille options.

    En l'absence d'un feed options live, utilise des proxy Greeks
    calculés depuis la volatilité et le prix.
    """

    MAX_DELTA_EXPOSURE = 0.30   # Max 30% de delta net
    MAX_VEGA_EXPOSURE  = 0.15   # Max 15% de vega exposure
    MAX_GAMMA_EXPOSURE = 0.10   # Max 10% de gamma exposure

    def __init__(self):
        logger.info("✅ GreeksBalancer initialisé")

    def analyze_portfolio_greeks(
        self,
        positions:    Dict[str, Dict],
        options_data: Dict[str, Dict],
        portfolio_value: float,
    ) -> Dict:
        """
        Calcule les Greeks agrégés du portefeuille.

        positions    : {symbol: {shares, price, direction}}
        options_data : {symbol: {iv_rank, vol_regime, delta_proxy, ...}}
        """
        total_delta  = 0.0
        total_gamma  = 0.0
        total_vega   = 0.0
        total_theta  = 0.0
        greeks_by_sym = {}

        for symbol, pos in positions.items():
            shares    = pos.get("shares", 0)
            price     = pos.get("price", 100.0)
            direction = pos.get("direction", "long")
            opt_data  = options_data.get(symbol, {})

            # ── Proxy Greeks ──────────────────────────────
            # Delta : 1.0 pour equity long, -1.0 pour short
            sign      = 1.0 if direction == "long" else -1.0
            delta     = sign * 1.0
            # Gamma proxy : proporitionnel à vol et distance ATM
            gamma_proxy = float(opt_data.get("gamma_exposure_zone", 0.5)) * 0.1
            # Vega proxy : sensibilité à la vol implicite
            iv_rank   = float(opt_data.get("iv_rank", 0.5))
            vega_proxy = iv_rank * 0.05  # 5% max de sensibilité vega
            # Theta : decay proxy (négatif si long options)
            theta_proxy = -0.001  # Daily theta decay proxy

            position_value = abs(shares) * price / (portfolio_value + 1e-10)

            weighted_delta = delta * position_value
            weighted_gamma = gamma_proxy * position_value
            weighted_vega  = vega_proxy * position_value
            weighted_theta = theta_proxy * position_value

            total_delta += weighted_delta
            total_gamma += weighted_gamma
            total_vega  += weighted_vega
            total_theta += weighted_theta

            greeks_by_sym[symbol] = {
                "delta":  round(weighted_delta, 4),
                "gamma":  round(weighted_gamma, 4),
                "vega":   round(weighted_vega, 4),
                "theta":  round(weighted_theta, 4),
            }

        # ── Checks d'exposition ───────────────────────────
        delta_breach = abs(total_delta) > self.MAX_DELTA_EXPOSURE
        vega_breach  = abs(total_vega)  > self.MAX_VEGA_EXPOSURE
        gamma_breach = abs(total_gamma) > self.MAX_GAMMA_EXPOSURE

        # ── Recommandations de rééquilibrage ──────────────
        recommendations = []
        if delta_breach:
            adj = (abs(total_delta) - self.MAX_DELTA_EXPOSURE) / abs(total_delta + 1e-10)
            recommendations.append({
                "action":   "reduce_delta",
                "severity": "high",
                "reduce_by": round(adj, 3),
                "method":   "reduce_directional_positions",
            })
        if vega_breach:
            recommendations.append({
                "action":   "reduce_vega",
                "severity": "medium",
                "method":   "close_long_options_or_sell_vol",
            })
        if gamma_breach:
            recommendations.append({
                "action":   "reduce_gamma",
                "severity": "medium",
                "method":   "reduce_near_expiry_options",
            })

        logger.debug(
            f"Greeks | Δ={total_delta:.3f} Γ={total_gamma:.3f} "
            f"V={total_vega:.3f} Θ={total_theta:.3f}"
        )
        return {
            "portfolio_greeks": {
                "delta": round(total_delta, 4),
                "gamma": round(total_gamma, 4),
                "vega":  round(total_vega, 4),
                "theta": round(total_theta, 4),
            },
            "greeks_by_symbol": greeks_by_sym,
            "breaches": {
                "delta": delta_breach,
                "vega":  vega_breach,
                "gamma": gamma_breach,
            },
            "recommendations": recommendations,
            "portfolio_balanced": not any([delta_breach, vega_breach, gamma_breach]),
        }