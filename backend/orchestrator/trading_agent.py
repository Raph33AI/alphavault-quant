# # ============================================================
# # ALPHAVAULT QUANT — Trading Agent (Orchestrateur Central)
# # ✅ Combine TOUS les moteurs en une décision unifiée
# # ✅ Fallback automatique LLM → déterministe
# # ✅ Pipeline complet : features → signal → régime → risk → execution
# # ✅ Intègre le Multi-Agent Council
# # ============================================================

# import json
# import datetime
# import numpy as np
# from typing import Dict, List, Optional
# from loguru import logger

# # ── Imports absolus (package backend = top-level) ──────────
# from backend.core.worker_client           import WorkerClient
# from backend.core.market_data_client      import MarketDataClient
# from backend.core.feature_builder         import FeatureBuilder
# from backend.core.microstructure_features import MicrostructureFeatures
# from backend.core.options_features        import OptionsFeatures
# from backend.core.volatility_engine       import VolatilityEngine
# from backend.core.regime_model            import RegimeModel
# from backend.core.signal_model            import SignalModel
# from backend.core.meta_model              import MetaModel
# from backend.core.execution_alpha_engine  import ExecutionAlphaEngine
# from backend.core.smart_execution_router  import SmartExecutionRouter
# from backend.core.risk_manager            import RiskManager
# from backend.core.optimizer               import PortfolioOptimizer
# from backend.core.strategy_allocator      import StrategyAllocator
# from backend.agents.multi_agent_council   import MultiAgentCouncil
# from backend.config.settings              import Settings

# class TradingAgent:
#     """
#     Agent de trading principal — orchestre l'ensemble du pipeline.

#     Séquence d'exécution par symbole :
#     1.  Fetch données marché (multi-timeframe)
#     2.  Build features (technique + micro + options + vol)
#     3.  Detect régime de marché
#     4.  Run ML signal model
#     5.  Calibration meta-model
#     6.  Execution alpha estimation
#     7.  Risk sizing (Kelly fractionnel)
#     8.  Multi-agent council (vote pondéré ou LLM)
#     9.  Portfolio optimization
#     10. Strategy allocation
#     11. Smart order routing
#     12. Génération JSON signals → dashboard
#     """

#     def __init__(self, settings: Settings):
#         self.settings = settings

#         # ── Initialisation des composants ─────────────
#         logger.info("🚀 Initialisation TradingAgent...")
#         self.worker       = WorkerClient(settings)
#         self.market_data  = MarketDataClient(settings, self.worker)
#         self.feat_builder = FeatureBuilder()
#         self.micro_feats  = MicrostructureFeatures()
#         self.vol_engine   = VolatilityEngine()
#         self.options_feats= OptionsFeatures(self.worker)
#         self.regime_model = RegimeModel()
#         self.signal_model = SignalModel()
#         self.meta_model   = MetaModel()
#         self.exec_alpha   = ExecutionAlphaEngine()
#         self.exec_router  = SmartExecutionRouter(settings)
#         self.risk_manager = RiskManager(settings)
#         self.optimizer    = PortfolioOptimizer(settings)
#         self.allocator    = StrategyAllocator()
#         self.council      = MultiAgentCouncil(self.worker, settings)

#         # ── Univers de trading ─────────────────────────────
#         self._full_universe = settings.get_active_universe()
#         self._core_universe = settings.get_core_universe()

#         # Vérification des workers
#         worker_status     = self.worker.check_all_workers()
#         self._llm_mode    = "llm" if worker_status.get("ai_proxy") else "deterministic"

#         logger.info(
#             f"[TradingAgent] Ready | LLM: {self._llm_mode} | "
#             f"Universe: {len(self._full_universe)} symbols "
#             f"({len(self._core_universe)} core)"
#         )

#     # ════════════════════════════════════════════════
#     # PIPELINE PRINCIPAL
#     # ════════════════════════════════════════════════
#     def run_full_pipeline(self) -> Dict:
#         """
#         Exécute le pipeline complet pour tous les symboles de l'univers.
#         Retourne un résumé des décisions + signaux JSON pour le dashboard.
#         """
#         logger.info(f"\n{'='*60}")
#         logger.info(f"  🤖 ALPHAVAULT QUANT — Cycle de Trading")
#         logger.info(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
#         logger.info(f"  Mode: {self.settings.EXECUTION_MODE} | DryRun: {self.settings.DRY_RUN}")
#         logger.info(f"  LLM: {self._llm_mode} | Session: {self.settings.MARKET_SESSION}")
#         logger.info(f"{'='*60}\n")

#         results        = {}
#         all_signals    = {}
#         all_returns    = {}
#         session        = self.settings.MARKET_SESSION

#         # ── Étape 1 : Snapshot macro (une seule fois) ──
#         macro_snapshot = self._fetch_macro_snapshot()

#         # ── Étape 2 : Régime global (sur SPY) ─────────
#         global_regime  = self._detect_global_regime(macro_snapshot)

#         # ── Étape 3 : Analyse par symbole ──────────────
#         for symbol in self.settings.EQUITY_UNIVERSE:
#             try:
#                 result = self._analyze_symbol(
#                     symbol, macro_snapshot, global_regime, session
#                 )
#                 results[symbol]  = result
#                 all_signals[symbol] = result.get("signal", {})

#                 # Cache des returns pour l'optimisation portefeuille
#                 if result.get("returns_array") is not None:
#                     all_returns[symbol] = result["returns_array"]

#                 logger.info(
#                     f"  📊 {symbol:6s} | "
#                     f"{result.get('signal', {}).get('direction', '?'):6s} | "
#                     f"score={result.get('signal', {}).get('final_score', 0):.3f} | "
#                     f"council={result.get('council', {}).get('decision', '?')}"
#                 )

#             except Exception as e:
#                 logger.error(f"  ❌ {symbol}: {e}")
#                 results[symbol] = {"error": str(e)}

#         # ── Étape 4 : Optimisation portefeuille global ──
#         portfolio_weights = self._optimize_portfolio(
#             all_returns, all_signals, global_regime
#         )

#         # ── Étape 5 : Allocation stratégies ───────────
#         strategy_weights = self._allocate_strategies(
#             all_signals, global_regime
#         )

#         # ── Étape 6 : Exécution des ordres ────────────
#         executions = self._execute_decisions(
#             results, portfolio_weights, global_regime
#         )

#         # ── Étape 7 : Génération JSON signals ─────────
#         output = self._build_output(
#             results, global_regime, macro_snapshot,
#             portfolio_weights, strategy_weights, executions
#         )
#         return output

#     # ════════════════════════════════════════════════
#     # ANALYSE PAR SYMBOLE
#     # ════════════════════════════════════════════════
#     def _analyze_symbol(
#         self,
#         symbol:         str,
#         macro_snapshot: Dict,
#         global_regime:  Dict,
#         session:        str,
#     ) -> Dict:
#         """Pipeline complet d'analyse pour un symbole."""
#         try:
#             # ── 1. OHLCV ──────────────────────────────────
#             ohlcv_dict = self.market_data.get_multi_timeframe_ohlcv(
#                 symbol, self.settings.SIGNAL_TIMEFRAMES
#             )
#             df_daily = ohlcv_dict.get("1day")
#             df_5min  = ohlcv_dict.get("5min")

#             if df_daily is None or df_daily.empty or len(df_daily) < 30:
#                 return {"error": "insufficient_data", "symbol": symbol}

#             # ── 2. Prix courant — sécurisé ─────────────────
#             try:
#                 quote = self.market_data.get_realtime_quote(symbol)
#             except Exception:
#                 quote = None

#             # ✅ Protection division par zéro sur le prix
#             if quote and float(quote.get("price", 0) or 0) > 0:
#                 current_price = float(quote["price"])
#             else:
#                 current_price = float(df_daily["close"].iloc[-1])

#             if current_price <= 0:
#                 logger.warning(f"Prix nul pour {symbol} — skip")
#                 return {"error": "zero_price", "symbol": symbol}

#             # Returns array
#             returns_array = np.log(
#                 df_daily["close"] / df_daily["close"].shift(1)
#             ).dropna().values

#             # ── 3. Features ───────────────────────────────
#             sentiment_score = self.market_data.get_news_sentiment_score(symbol)
#             analyst_data    = self.market_data.get_analyst_ratings(symbol)
#             analyst_score   = analyst_data.get("score", 0.0)
#             earnings_data   = self.market_data.get_earnings_data(symbol)

#             features = self.feat_builder.build_all_features(
#                 symbol          = symbol,
#                 ohlcv_dict      = ohlcv_dict,
#                 macro_snapshot  = macro_snapshot,
#                 sentiment_score = sentiment_score,
#                 analyst_score   = analyst_score,
#                 earnings_data   = earnings_data,
#             )
#             features.update(self.micro_feats.build_all(df_daily, df_5min))
#             features.update(self.vol_engine.analyze(symbol, df_daily))
#             features.update(self.options_feats.build_all(symbol, current_price, df_daily))

#             # ── 4. Régime ─────────────────────────────────
#             regime_result = self.regime_model.detect(df_daily, macro_snapshot, features)

#             # ── 5. Signal ML ──────────────────────────────
#             raw_signal = self.signal_model.predict(features)

#             # ── 6. Meta Model ─────────────────────────────
#             calibrated_signal = self.meta_model.calibrate(
#                 raw_signal    = raw_signal,
#                 regime_result = regime_result,
#                 options_data  = features,
#                 features      = features,
#             )

#             # ── 7. Execution Alpha ─────────────────────────
#             market_cap = float((quote or {}).get("market_cap", 0) or 0)
#             pos_pct    = float(calibrated_signal.get("position_pct", 0.05) or 0.05)
#             exec_alpha = self.exec_alpha.analyze(
#                 symbol          = symbol,
#                 df_daily        = df_daily,
#                 signal          = calibrated_signal,
#                 market_cap      = market_cap,
#                 order_size_usd  = self._portfolio_value * pos_pct,
#                 df_intra        = df_5min,
#             )

#             # ── 8. Risk Sizing ─────────────────────────────
#             position_size = self.risk_manager.compute_position_size(
#                 signal          = calibrated_signal,
#                 regime_result   = regime_result,
#                 portfolio_value = self._portfolio_value,
#                 current_price   = current_price,
#             )

#             # ── 9. Agent Outputs ───────────────────────────
#             agent_outputs = {
#                 "drawdown_guardian":  self._get_drawdown_status(),
#                 "regime":             regime_result,
#                 "signal":             calibrated_signal,
#                 "exec_timing": {
#                     "vote": "execute"
#                     if exec_alpha.get("optimal_timing", {}).get("is_optimal_now")
#                     else "wait",
#                 },
#                 "risk": self.risk_manager.check_leverage_constraints(
#                     total_exposure  = self._get_total_exposure(),
#                     portfolio_value = self._portfolio_value,
#                     regime_result   = regime_result,
#                 ),
#                 "correlation_surface": {"reduce_exposure": False},
#                 "strategy_switching":  {"allocation_score": 0.70},
#                 "market_impact":       {
#                     "feasible": exec_alpha.get("execution_quality", 0.5) > 0.40
#                 },
#                 "capital_rotation":    {"rotation_alignment": 0.65},
#                 "self_eval":           {"system_health": "ok"},
#                 "feature_drift":       {"retrain_needed": False, "severe_drift": False},
#                 "greeks_balancer":     {
#                     "convexity_exposure": features.get("iv_rank", 0.5)
#                 },
#             }

#             # ── 10. Council ────────────────────────────────
#             council_result = self.council.deliberate(
#                 agent_outputs   = agent_outputs,
#                 symbol          = symbol,
#                 proposed_action = calibrated_signal,
#             )

#             should_execute = (
#                 council_result.get("council_approved", False) and
#                 calibrated_signal.get("trade_action") in ("execute", "execute_strong") and
#                 exec_alpha.get("execute_now", False) and
#                 not self.settings.DRY_RUN
#             )

#             return {
#                 "symbol":        symbol,
#                 "price":         current_price,
#                 "signal":        calibrated_signal,
#                 "raw_signal":    raw_signal,
#                 "regime":        regime_result,
#                 "features":      {
#                     k: round(v, 4)
#                     for k, v in features.items()
#                     if isinstance(v, (int, float))
#                 },
#                 "exec_alpha":    exec_alpha,
#                 "position_size": position_size,
#                 "council":       council_result,
#                 "should_execute": should_execute,
#                 "returns_array": returns_array,
#                 "quote":         quote or {},
#                 "options":       features,
#                 "sentiment":     sentiment_score,
#                 "analyst":       analyst_data,
#                 "earnings":      earnings_data,
#                 "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
#             }

#         except Exception as e:
#             logger.error(f"  ❌ {symbol}: {e}")
#             import traceback
#             logger.debug(traceback.format_exc())
#             return {"error": str(e), "symbol": symbol}

#     # ════════════════════════════════════════════════
#     # MACRO & RÉGIME GLOBAL
#     # ════════════════════════════════════════════════
#     def _fetch_macro_snapshot(self) -> Dict:
#         """Récupère le snapshot macroéconomique complet."""
#         try:
#             return self.market_data.get_macro_snapshot()
#         except Exception as e:
#             logger.warning(f"Macro snapshot unavailable: {e}")
#             return {}

#     def _detect_global_regime(self, macro_snapshot: Dict) -> Dict:
#         """Détecte le régime global sur SPY comme proxy du marché."""
#         try:
#             spy_data = self.market_data.get_ohlcv("SPY", "1day", 252)
#             if spy_data is not None:
#                 return self.regime_model.detect(spy_data, macro_snapshot)
#         except Exception as e:
#             logger.warning(f"Global regime detection failed: {e}")
#         return {"regime_label": "range_bound", "regime_score": 0.0,
#                 "allow_long": True, "allow_short": False,
#                 "reduce_exposure": False, "confidence": 0.5}

#     # ════════════════════════════════════════════════
#     # OPTIMISATION & ALLOCATION
#     # ════════════════════════════════════════════════
#     def _optimize_portfolio(
#         self,
#         returns_dict:  Dict,
#         signals:       Dict,
#         regime_result: Dict,
#     ) -> Dict[str, float]:
#         """Optimise l'allocation du portefeuille."""
#         try:
#             valid_returns = {s: r for s, r in returns_dict.items() if len(r) >= 20}
#             if not valid_returns:
#                 n = len(self.settings.EQUITY_UNIVERSE)
#                 return {s: 1/n for s in self.settings.EQUITY_UNIVERSE}
#             return self.optimizer.optimize(valid_returns, signals, regime_result)
#         except Exception as e:
#             logger.error(f"Portfolio optimization failed: {e}")
#             n = len(self.settings.EQUITY_UNIVERSE)
#             return {s: 1/n for s in self.settings.EQUITY_UNIVERSE}

#     def _allocate_strategies(self, signals: Dict, regime_result: Dict) -> Dict:
#         """Alloue le capital entre les familles de stratégies."""
#         try:
#             summary = {
#                 "avg_confidence": np.mean([
#                     s.get("adjusted_confidence", 0.5)
#                     for s in signals.values()
#                 ]) if signals else 0.5,
#                 "avg_buy_prob": np.mean([
#                     s.get("adjusted_buy_prob", 0.5)
#                     for s in signals.values()
#                 ]) if signals else 0.5,
#                 "avg_vol_rank": 0.5,
#             }
#             perf = self.allocator.get_performance_summary()
#             return self.allocator.allocate(regime_result, summary, perf)
#         except Exception as e:
#             logger.error(f"Strategy allocation failed: {e}")
#             return {"trend": 0.40, "mean_reversion": 0.25,
#                     "vol_carry": 0.20, "options_convexity": 0.15}

#     # ════════════════════════════════════════════════
#     # EXÉCUTION DES ORDRES
#     # ════════════════════════════════════════════════
#     def _execute_decisions(
#         self,
#         results:          Dict,
#         portfolio_weights: Dict,
#         regime_result:    Dict,
#     ) -> List[Dict]:
#         """Execute (ou simule) les ordres approuvés par le Council."""
#         executions = []
#         for symbol, result in results.items():
#             if result.get("error"):
#                 continue
#             if not result.get("should_execute"):
#                 continue
#             if result.get("council", {}).get("decision") not in ("execute", "execute_strong"):
#                 continue

#             try:
#                 position = result.get("position_size", {})
#                 shares   = abs(int(position.get("position_shares", 0)))
#                 if shares == 0:
#                     continue

#                 size_mult = result["council"].get("size_multiplier", 1.0)
#                 shares    = int(shares * size_mult)

#                 exec_result = self.exec_router.select_and_route(
#                     symbol          = symbol,
#                     direction       = position.get("direction", "buy"),
#                     quantity        = shares,
#                     price           = result.get("price", 0),
#                     adv             = float(result.get("quote", {}).get("volume", 1e6)),
#                     execution_alpha = result.get("exec_alpha", {}),
#                     signal          = result.get("signal", {}),
#                     dry_run         = self.settings.DRY_RUN,
#                 )
#                 executions.append({
#                     "symbol":     symbol,
#                     "result":     exec_result,
#                     "council":    result["council"].get("decision"),
#                     "timestamp":  datetime.datetime.utcnow().isoformat() + "Z",
#                 })
#                 logger.info(
#                     f"  ✅ Ordre {symbol}: {exec_result.get('status')} | "
#                     f"{position.get('direction')} {shares} @ "
#                     f"{exec_result.get('fill_price', 0):.2f}"
#                 )
#             except Exception as e:
#                 logger.error(f"  ❌ Execution {symbol}: {e}")
#         return executions

#     # ════════════════════════════════════════════════
#     # GÉNÉRATION JSON DASHBOARD
#     # ════════════════════════════════════════════════
#     def _build_output(
#         self,
#         results:          Dict,
#         global_regime:    Dict,
#         macro_snapshot:   Dict,
#         portfolio_weights: Dict,
#         strategy_weights: Dict,
#         executions:       List[Dict],
#     ) -> Dict:
#         """Construit les JSONs de signaux pour le dashboard GitHub Pages."""
#         now = datetime.datetime.utcnow().isoformat() + "Z"

#         # ── current_signals.json ──────────────────────
#         current_signals = {
#             "timestamp":  now,
#             "session":    self.settings.MARKET_SESSION,
#             "llm_mode":   self._llm_mode,
#             "dry_run":    self.settings.DRY_RUN,
#             "signals": {
#                 sym: {
#                     "direction":    r.get("signal", {}).get("direction", "neutral"),
#                     "final_score":  r.get("signal", {}).get("final_score", 0),
#                     "confidence":   r.get("signal", {}).get("adjusted_confidence", 0),
#                     "buy_prob":     r.get("signal", {}).get("adjusted_buy_prob", 0.5),
#                     "trade_action": r.get("signal", {}).get("trade_action", "wait"),
#                     "council":      r.get("council", {}).get("decision", "wait"),
#                     "price":        r.get("price", 0),
#                     "regime":       r.get("regime", {}).get("regime_label", "unknown"),
#                 }
#                 for sym, r in results.items()
#                 if not r.get("error")
#             },
#         }

#         # ── portfolio.json ────────────────────────────
#         portfolio = {
#             "timestamp":    now,
#             "total_value":  self._portfolio_value,
#             "weights":      portfolio_weights,
#             "positions":    self._positions,
#             "cash_pct":     max(0, 1.0 - sum(portfolio_weights.values())),
#         }

#         # ── risk_metrics.json ─────────────────────────
#         risk_metrics = {
#             "timestamp":    now,
#             "drawdown":     self._get_drawdown_status(),
#             "leverage":     self.risk_manager.check_leverage_constraints(
#                 total_exposure  = self._get_total_exposure(),
#                 portfolio_value = self._portfolio_value,
#                 regime_result   = global_regime,
#             ),
#             "var_metrics":  {},
#         }

#         # ── regime.json ───────────────────────────────
#         regime_json = {
#             "timestamp":   now,
#             "global":      global_regime,
#             "macro":       macro_snapshot,
#             "per_symbol":  {
#                 sym: r.get("regime", {})
#                 for sym, r in results.items()
#                 if not r.get("error")
#             },
#         }

#         # ── agent_decisions.json ──────────────────────
#         agent_decisions = {
#             "timestamp": now,
#             "decisions": {
#                 sym: {
#                     "council":      r.get("council", {}),
#                     "trade_action": r.get("signal", {}).get("trade_action"),
#                     "exec_quality": r.get("exec_alpha", {}).get("execution_quality", 0),
#                 }
#                 for sym, r in results.items()
#                 if not r.get("error")
#             },
#             "executions": executions,
#         }

#         # ── strategy_weights.json ─────────────────────
#         strategy_json = {
#             "timestamp": now,
#             "weights":   strategy_weights,
#             "regime":    global_regime.get("regime_label"),
#         }

#         # ── performance_metrics.json ──────────────────
#         performance = {
#             "timestamp":       now,
#             "portfolio_value": self._portfolio_value,
#             "session":         self.settings.MARKET_SESSION,
#             "n_signals":       len([r for r in results.values() if not r.get("error")]),
#             "n_executions":    len(executions),
#             "llm_mode":        self._llm_mode,
#             "strategy_perf":   self.allocator.get_performance_summary(),
#         }

#         # ── system_status.json ────────────────────────
#         worker_status = self.worker.check_all_workers()
#         system_status = {
#             "timestamp":        now,
#             "overall":          "healthy" if all(worker_status.values()) else "degraded",
#             "llm_available":    self.worker.llm_available,
#             "workers":          worker_status,
#             "mode":             self._llm_mode,
#             "dry_run":          self.settings.DRY_RUN,
#             "session":          self.settings.MARKET_SESSION,
#         }

#         return {
#             "current_signals":    current_signals,
#             "portfolio":          portfolio,
#             "risk_metrics":       risk_metrics,
#             "regime":             regime_json,
#             "agent_decisions":    agent_decisions,
#             "strategy_weights":   strategy_json,
#             "performance_metrics": performance,
#             "system_status":      system_status,
#         }

#     # ── Helpers ───────────────────────────────────────────────
#     def _get_drawdown_status(self) -> Dict:
#         return {
#             "halt_active":       False,
#             "hit_daily_limit":   False,
#             "current_drawdown":  0.0,
#             "daily_pnl_pct":     0.0,
#         }

#     def _get_total_exposure(self) -> float:
#         return sum(
#             abs(p.get("shares", 0) * p.get("price", 0))
#             for p in self._positions.values()
#         )

# ============================================================
# ALPHAVAULT QUANT — Trading Agent v2.0
# ✅ Batch OHLCV download (yfinance) — ~300 symboles en ~30s
# ✅ Feature building parallèle (ThreadPoolExecutor)
# ✅ LLM intelligent — Top N uniquement (quota protection)
# ✅ Régime par symbole dérivé des features ML
# ✅ Universe.py — ~300 symboles vs 12 hardcodés
# ✅ JSON output enrichi (sector, change_pct, n_universe)
# ============================================================

import json
import datetime
import time
import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from loguru import logger

# ── Imports backend ────────────────────────────────────────
from backend.core.worker_client           import WorkerClient
from backend.core.market_data_client      import MarketDataClient
from backend.core.feature_builder         import FeatureBuilder
from backend.core.microstructure_features import MicrostructureFeatures
from backend.core.options_features        import OptionsFeatures
from backend.core.volatility_engine       import VolatilityEngine
from backend.core.regime_model            import RegimeModel
from backend.core.signal_model            import SignalModel
from backend.core.meta_model              import MetaModel
from backend.core.execution_alpha_engine  import ExecutionAlphaEngine
from backend.core.smart_execution_router  import SmartExecutionRouter
from backend.core.risk_manager            import RiskManager
from backend.core.optimizer               import PortfolioOptimizer
from backend.core.strategy_allocator      import StrategyAllocator
from backend.agents.multi_agent_council   import MultiAgentCouncil
from backend.config.settings              import Settings

# ── Universe (nouveau module) ──────────────────────────────
try:
    from backend.core.universe import get_full_universe, get_sector, CORE_UNIVERSE
    _UNIVERSE_MODULE_OK = True
except ImportError:
    logger.warning("[TradingAgent] universe.py not found — using settings fallback")
    _UNIVERSE_MODULE_OK = False

    def get_full_universe():
        return [
            "SPY", "QQQ", "IWM", "GLD", "TLT",
            "AAPL", "MSFT", "NVDA", "GOOGL", "AMZN",
            "META", "TSLA", "JPM", "GS", "V",
            "UNH", "LLY", "XOM", "HD", "COST",
        ]

    def get_sector(sym): return "Other"
    CORE_UNIVERSE = get_full_universe()

class TradingAgent:
    """
    Agent de trading principal — pipeline batch optimisé.

    Séquence par cycle :
    1.  Macro snapshot (1 appel)
    2.  Régime global sur SPY
    3.  Batch OHLCV download — tous les symboles (1 appel yfinance)
    4.  Intraday download — core universe uniquement
    5.  Batch quotes — prix temps réel
    6.  Feature building parallèle (ThreadPoolExecutor)
    7.  ML signal inference
    8.  Top N sélection → LLM Council
    9.  Déterministe pour le reste
    10. Portfolio optimization
    11. JSON output → GitHub Pages dashboard
    """

    def __init__(self, settings: Settings):
        self.settings = settings

        logger.info("[TradingAgent] Initializing components...")

        # ── Composants ────────────────────────────────────
        self.worker        = WorkerClient(settings)
        self.market_data   = MarketDataClient(settings, self.worker)
        self.feat_builder  = FeatureBuilder()
        self.micro_feats   = MicrostructureFeatures()
        self.vol_engine    = VolatilityEngine()
        self.options_feats = OptionsFeatures(self.worker)
        self.regime_model  = RegimeModel()
        self.signal_model  = SignalModel()
        self.meta_model    = MetaModel()
        self.exec_alpha    = ExecutionAlphaEngine()
        self.exec_router   = SmartExecutionRouter(settings)
        self.risk_manager  = RiskManager(settings)
        self.optimizer     = PortfolioOptimizer(settings)
        self.allocator     = StrategyAllocator()
        self.council       = MultiAgentCouncil(self.worker, settings)

        # ── Portfolio state ────────────────────────────────
        self._portfolio_value  = 100_000.0
        self._positions: Dict  = {}

        # ── Universe ───────────────────────────────────────
        if _UNIVERSE_MODULE_OK:
            self._full_universe = settings.get_active_universe()
            self._core_universe = settings.get_core_universe()
        else:
            self._full_universe = settings.EQUITY_UNIVERSE
            self._core_universe = settings.EQUITY_UNIVERSE

        # ── LLM availability ───────────────────────────────
        worker_status   = self.worker.check_all_workers()
        self._llm_mode  = "llm" if worker_status.get("ai_proxy") else "deterministic"

        logger.info(
            f"[TradingAgent] Ready | LLM: {self._llm_mode} | "
            f"Universe: {len(self._full_universe)} symbols "
            f"({len(self._core_universe)} core)"
        )

    # ════════════════════════════════════════════════════════
    # PIPELINE PRINCIPAL — VERSION BATCH
    # ════════════════════════════════════════════════════════
    def run_full_pipeline(self) -> Dict:
        """
        Pipeline complet — optimisé pour ~300 symboles en < 5 minutes.
        """
        t_start = time.time()

        logger.info(f"\n{'='*60}")
        logger.info(f"  ALPHAVAULT QUANT — Trading Cycle")
        logger.info(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        logger.info(f"  Mode: {self.settings.EXECUTION_MODE} | DryRun: {self.settings.DRY_RUN}")
        logger.info(f"  LLM: {self._llm_mode} | Session: {self.settings.MARKET_SESSION}")
        logger.info(f"  Universe: {len(self._full_universe)} symbols | "
                    f"Core: {len(self._core_universe)}")
        logger.info(f"{'='*60}\n")

        # ── 1. Macro ───────────────────────────────────────
        macro = self._fetch_macro_snapshot()

        # ── 2. Régime global (SPY) ─────────────────────────
        global_regime = self._detect_global_regime(macro)

        # ── 3. Batch OHLCV (tous les symboles, 1 appel) ───
        logger.info(f"[Pipeline] Batch daily download | {len(self._full_universe)} symbols...")
        batch_daily = self.market_data.batch_ohlcv_download(
            symbols  = self._full_universe,
            interval = "1day",
            period   = "1y",
        )
        t_dl = time.time()
        logger.info(f"[Pipeline] Daily download done in {t_dl - t_start:.1f}s")

        # ── 4. Intraday — core only ────────────────────────
        logger.info(f"[Pipeline] Intraday 5min | {len(self._core_universe)} core symbols...")
        batch_5min = self.market_data.batch_ohlcv_download(
            symbols  = self._core_universe,
            interval = "5min",
            period   = "5d",
        )
        t_intra = time.time()
        logger.info(f"[Pipeline] Intraday done in {t_intra - t_dl:.1f}s")

        # ── 5. Batch quotes ────────────────────────────────
        logger.info(f"[Pipeline] Batch quotes...")
        batch_quotes = self.market_data.get_portfolio_quotes(self._full_universe)

        # ── 6. Feature building parallèle ─────────────────
        n_workers = min(self.settings.FEATURE_WORKERS, len(self._full_universe), 12)
        logger.info(f"[Pipeline] Feature building | {n_workers} workers...")

        all_features, all_signals = self._batch_build_features(
            symbols      = self._full_universe,
            batch_daily  = batch_daily,
            batch_5min   = batch_5min,
            batch_quotes = batch_quotes,
            macro        = macro,
            n_workers    = n_workers,
        )

        t_feat = time.time()
        logger.info(
            f"[Pipeline] Features done in {t_feat - t_intra:.1f}s | "
            f"{len(all_features)} symbols"
        )

        # ── 7. Top N pour LLM ─────────────────────────────
        top_symbols = self._select_top_symbols(all_signals, self.settings.LLM_TOP_N)
        logger.info(f"[Pipeline] Top {len(top_symbols)} selected for LLM/Council")

        # ── 8. Council + résultats ─────────────────────────
        results:     Dict = {}
        all_returns: Dict = {}

        for sym in self._full_universe:
            if sym not in all_signals:
                continue

            signal   = all_signals[sym]
            features = all_features.get(sym, {})
            df_daily = batch_daily.get(sym)
            quote    = batch_quotes.get(sym) or {}
            price    = float(quote.get("price", 0) or 0)

            # Fallback prix sur la dernière close
            if price <= 0 and df_daily is not None and not df_daily.empty:
                try:
                    price = float(df_daily["close"].iloc[-1])
                except Exception:
                    pass

            if price <= 0:
                continue

            # Returns pour l'optimizer
            if df_daily is not None and not df_daily.empty and len(df_daily) >= 20:
                try:
                    returns = np.log(
                        df_daily["close"] / df_daily["close"].shift(1)
                    ).dropna().values
                    if len(returns) >= 20:
                        all_returns[sym] = returns
                except Exception:
                    pass

            # Régime par symbole (léger, depuis features)
            regime = self._regime_from_features(features, global_regime)

            # Risk sizing
            try:
                pos_size = self.risk_manager.compute_position_size(
                    signal          = signal,
                    regime_result   = regime,
                    portfolio_value = self._portfolio_value,
                    current_price   = price,
                )
            except Exception:
                pos_size = {
                    "position_pct":    0.0,
                    "position_usd":    0.0,
                    "position_shares": 0,
                    "direction":       signal.get("direction", "neutral"),
                }

            # Council — LLM ou déterministe
            use_llm = (sym in top_symbols) and (self._llm_mode == "llm")
            council = self._get_council_decision(sym, signal, regime, features, use_llm)

            # Log signaux significatifs
            score = float(signal.get("final_score", 0) or 0)
            if abs(score) > 0.30 or sym in self._core_universe:
                logger.info(
                    f"  {sym:6s} | {signal.get('direction','?'):7s} | "
                    f"score={score:.3f} | "
                    f"council={council.get('decision','?')} | "
                    f"llm={'Y' if use_llm else 'N'}"
                )

            results[sym] = {
                "symbol":        sym,
                "price":         price,
                "signal":        signal,
                "regime":        regime,
                "features": {
                    k: round(float(v), 4)
                    for k, v in features.items()
                    if isinstance(v, (int, float)) and not (isinstance(v, float) and (np.isnan(v) or np.isinf(v)))
                },
                "position_size": pos_size,
                "council":       council,
                "quote":         quote,
                "should_execute": (
                    council.get("council_approved", False)
                    and signal.get("trade_action") in ("execute", "execute_strong")
                    and not self.settings.DRY_RUN
                ),
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            }

        t_council = time.time()
        logger.info(
            f"[Pipeline] Council done in {t_council - t_feat:.1f}s | "
            f"{len(results)} results"
        )

        # ── 9. Portfolio optimization ──────────────────────
        portfolio_weights = self._optimize_portfolio(
            all_returns, all_signals, global_regime
        )
        strategy_weights  = self._allocate_strategies(all_signals, global_regime)

        # ── 10. Execution ──────────────────────────────────
        executions = self._execute_decisions(results, portfolio_weights, global_regime)

        # ── 11. Output JSON ────────────────────────────────
        output = self._build_output(
            results           = results,
            global_regime     = global_regime,
            macro_snapshot    = macro,
            portfolio_weights = portfolio_weights,
            strategy_weights  = strategy_weights,
            executions        = executions,
        )

        t_total = time.time() - t_start
        n_exec  = len(executions)
        n_sigs  = len(results)
        logger.info(f"\n[Pipeline] DONE in {t_total:.1f}s | {n_sigs} signals | {n_exec} executed")

        return output

    # ════════════════════════════════════════════════════════
    # BATCH FEATURE BUILDING
    # ════════════════════════════════════════════════════════
    def _batch_build_features(
        self,
        symbols:      List[str],
        batch_daily:  Dict[str, Optional[pd.DataFrame]],
        batch_5min:   Dict[str, Optional[pd.DataFrame]],
        batch_quotes: Dict[str, Optional[Dict]],
        macro:        Dict,
        n_workers:    int = 8,
    ) -> Tuple[Dict, Dict]:
        """
        Feature building + ML inference pour tous les symboles en parallèle.
        Retourne (all_features, all_signals).
        """
        all_features: Dict[str, Dict] = {}
        all_signals:  Dict[str, Dict] = {}

        def _process(sym: str) -> Tuple[str, Optional[Dict], Optional[Dict]]:
            try:
                df_daily = batch_daily.get(sym)
                if df_daily is None or df_daily.empty or len(df_daily) < 30:
                    return sym, None, None

                df_5min = batch_5min.get(sym)

                ohlcv_dict = {"1day": df_daily}
                if df_5min is not None and not df_5min.empty and len(df_5min) >= 12:
                    ohlcv_dict["5min"] = df_5min

                # ── Features ──────────────────────────────
                features = self.feat_builder.build_all_features(
                    symbol          = sym,
                    ohlcv_dict      = ohlcv_dict,
                    macro_snapshot  = macro,
                    sentiment_score = 0.0,
                    analyst_score   = 0.0,
                    earnings_data   = None,
                )

                # Microstructure (si 5min dispo)
                if df_5min is not None and not df_5min.empty:
                    try:
                        features.update(self.micro_feats.build_all(df_daily, df_5min))
                    except Exception:
                        pass

                # Volatility
                try:
                    features.update(self.vol_engine.analyze(sym, df_daily))
                except Exception:
                    pass

                # Prix courant dans les features
                quote = batch_quotes.get(sym) or {}
                price = float(quote.get("price", 0) or 0)
                if price <= 0 and not df_daily.empty:
                    price = float(df_daily["close"].iloc[-1])
                features["current_price"] = price

                # Change pct
                chg = float(quote.get("change_pct", 0) or 0)
                features["change_pct"] = chg

                # ── ML Signal ─────────────────────────────
                raw_signal = self.signal_model.predict(features)

                # Régime simplifié pour la calibration
                momentum = float(features.get("momentum_20d", 0))
                vol_rank = float(features.get("atr_pct_rank", 0.5))
                regime_simple = {
                    "regime_label":    "trend_up" if momentum > 0.05 else
                                       "trend_down" if momentum < -0.05 else
                                       "range_bound",
                    "regime_score":    float(np.tanh(momentum * 3)),
                    "allow_long":      momentum >= 0,
                    "allow_short":     momentum < -0.05,
                    "reduce_exposure": vol_rank > 0.85,
                    "confidence":      0.60,
                }

                # ── Meta Model ────────────────────────────
                calibrated = self.meta_model.calibrate(
                    raw_signal    = raw_signal,
                    regime_result = regime_simple,
                    options_data  = features,
                    features      = features,
                )

                return sym, features, calibrated

            except Exception as e:
                logger.debug(f"[Features] {sym}: {e}")
                return sym, None, None

        # Parallélisation via ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            futures = {executor.submit(_process, sym): sym for sym in symbols}
            for future in as_completed(futures):
                try:
                    sym, feats, sig = future.result(timeout=30)
                    if feats is not None:
                        all_features[sym] = feats
                    if sig is not None:
                        all_signals[sym] = sig
                except Exception as e:
                    logger.debug(f"[Features] future error: {e}")

        n_ok = len(all_features)
        n_fail = len(symbols) - n_ok
        logger.debug(f"[Features] {n_ok}/{len(symbols)} OK | {n_fail} failed")

        return all_features, all_signals

    # ════════════════════════════════════════════════════════
    # SÉLECTION TOP N
    # ════════════════════════════════════════════════════════
    def _select_top_symbols(self, all_signals: Dict, top_n: int) -> List[str]:
        """
        Sélectionne les Top N symboles pour l'analyse LLM approfondie.
        Priorise: core universe + signaux forts + haute confiance.
        """
        core_set = set(self._core_universe)
        scored   = []

        for sym, sig in all_signals.items():
            score = abs(float(sig.get("final_score", 0) or 0))
            conf  = float(sig.get("adjusted_confidence", 0) or 0)
            # Core universe = bonus de priorité ×1.5
            priority = (score + conf) * (1.5 if sym in core_set else 1.0)
            scored.append((sym, priority))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [s for s, _ in scored[:top_n]]

    # ════════════════════════════════════════════════════════
    # RÉGIME PAR SYMBOLE (léger)
    # ════════════════════════════════════════════════════════
    def _regime_from_features(self, features: Dict, global_regime: Dict) -> Dict:
        """
        Dérive le régime pour un symbole depuis ses features ML.
        Évite un appel complet au RegimeModel pour 300 symboles.
        """
        momentum = float(features.get("momentum_20d", 0))
        vol_rank = float(features.get("atr_pct_rank", 0.5))
        hurst    = float(features.get("hurst_exponent", 0.5))
        rsi      = float(features.get("rsi_14", 50))

        # Détection simplifiée
        if vol_rank > 0.88:
            label = "high_volatility"
            score = -0.5
        elif vol_rank < 0.15:
            label = "low_volatility"
            score = +0.3
        elif momentum > 0.08 and hurst > 0.52:
            label = "trend_up"
            score = min(+0.8, momentum * 4)
        elif momentum < -0.08 and hurst > 0.52:
            label = "trend_down"
            score = max(-0.8, momentum * 4)
        elif rsi > 72:
            label = "high_volatility"
            score = -0.2
        elif rsi < 28:
            label = "range_bound"
            score = +0.1
        else:
            # Hérite du régime global
            label = global_regime.get("regime_label", "range_bound")
            score = float(global_regime.get("regime_score", 0)) * 0.7

        return {
            "regime_label":    label,
            "regime_score":    round(float(score), 3),
            "confidence":      0.60,
            "allow_long":      score >= -0.20,
            "allow_short":     score < -0.30,
            "reduce_exposure": vol_rank > 0.85 or label == "crash",
            "leverage_allowed":vol_rank < 0.70 and score > 0,
            "favor_options":   vol_rank > 0.70,
        }

    # ════════════════════════════════════════════════════════
    # COUNCIL DECISION
    # ════════════════════════════════════════════════════════
    def _get_council_decision(
        self,
        sym:      str,
        signal:   Dict,
        regime:   Dict,
        features: Dict,
        use_llm:  bool,
    ) -> Dict:
        """
        Décision du Council.
        - LLM path   : appel au MultiAgentCouncil complet (top N symboles)
        - Déterministe: logique ML + régime (tous les autres symboles)
        """
        if use_llm:
            try:
                agent_outputs = self._build_agent_outputs(signal, regime, features)
                return self.council.deliberate(
                    agent_outputs   = agent_outputs,
                    symbol          = sym,
                    proposed_action = signal,
                )
            except Exception as e:
                logger.debug(f"[Council LLM] {sym}: {e} — fallback deterministic")

        # ── Déterministe ──────────────────────────────────
        return self._deterministic_decision(signal, regime)

    def _build_agent_outputs(
        self,
        signal:   Dict,
        regime:   Dict,
        features: Dict,
    ) -> Dict:
        """Construit l'input pour le MultiAgentCouncil."""
        return {
            "drawdown_guardian":   self._get_drawdown_status(),
            "regime":              regime,
            "signal":              signal,
            "exec_timing":         {
                "vote": "execute" if float(signal.get("final_score", 0) or 0) > 0.55 else "wait"
            },
            "risk":                self.risk_manager.check_leverage_constraints(
                total_exposure  = self._get_total_exposure(),
                portfolio_value = self._portfolio_value,
                regime_result   = regime,
            ),
            "correlation_surface": {"reduce_exposure": False},
            "strategy_switching":  {"allocation_score": 0.70},
            "market_impact":       {"feasible": True},
            "capital_rotation":    {"rotation_alignment": 0.65},
            "self_eval":           {"system_health": "ok"},
            "feature_drift":       {"retrain_needed": False, "severe_drift": False},
            "greeks_balancer":     {
                "convexity_exposure": float(features.get("iv_rank", 0.5) or 0.5)
            },
        }

    def _deterministic_decision(self, signal: Dict, regime: Dict) -> Dict:
        """
        Décision déterministe pure — ne nécessite pas le LLM.
        Basée sur score ML + confiance + régime.
        """
        score    = float(signal.get("final_score", 0) or 0)
        conf     = float(signal.get("adjusted_confidence", 0) or 0)
        buy_prob = float(signal.get("adjusted_buy_prob", 0.5) or 0.5)

        allow_long    = regime.get("allow_long",      True)
        reduce_exp    = regime.get("reduce_exposure", False)
        regime_score  = float(regime.get("regime_score", 0))

        # Score composite
        composite = score * 0.50 + conf * 0.25 + (buy_prob - 0.5) * 0.25

        # Pénalité régime défavorable
        if reduce_exp:
            composite *= 0.40
        elif regime_score < -0.40:
            composite *= 0.65
        elif regime_score > 0.40:
            composite *= 1.15

        # Décision
        if composite > 0.60 and allow_long and conf > 0.55:
            decision = "execute"
            approved = True
            mult     = min(1.0, composite)
        elif composite > 0.45 and allow_long and conf > 0.40:
            decision = "execute"
            approved = True
            mult     = 0.75
        elif composite > 0.25:
            decision = "wait"
            approved = False
            mult     = 0.0
        elif composite < -0.20 or reduce_exp:
            decision = "veto"
            approved = False
            mult     = 0.0
        else:
            decision = "wait"
            approved = False
            mult     = 0.0

        return {
            "decision":         decision,
            "council_approved": approved,
            "weighted_score":   round(composite, 4),
            "size_multiplier":  round(mult, 2),
            "mode":             "deterministic",
            "reason": (
                f"ML score={score:.3f} | conf={conf:.3f} | "
                f"composite={composite:.3f} | "
                f"regime={regime.get('regime_label','?')}"
            ),
        }

    # ════════════════════════════════════════════════════════
    # ANALYSE DÉTAILLÉE PAR SYMBOLE (pour core + LLM deep dive)
    # ════════════════════════════════════════════════════════
    def _analyze_symbol(
        self,
        symbol:         str,
        macro_snapshot: Dict,
        global_regime:  Dict,
        session:        str,
        df_daily:       Optional[pd.DataFrame] = None,
        df_5min:        Optional[pd.DataFrame] = None,
        quote:          Optional[Dict]         = None,
    ) -> Dict:
        """
        Analyse détaillée pour un symbole — options, earnings, analyst ratings.
        Utilisée pour le core universe ou les analyses à la demande.
        """
        try:
            # Fetch data si non fourni
            if df_daily is None:
                ohlcv = self.market_data.get_multi_timeframe_ohlcv(
                    symbol, self.settings.SIGNAL_TIMEFRAMES
                )
                df_daily = ohlcv.get("1day")
                df_5min  = ohlcv.get("5min")

            if df_daily is None or df_daily.empty or len(df_daily) < 30:
                return {"error": "insufficient_data", "symbol": symbol}

            if quote is None:
                quote = self.market_data.get_realtime_quote(symbol) or {}

            price = float(quote.get("price", 0) or 0)
            if price <= 0 and not df_daily.empty:
                price = float(df_daily["close"].iloc[-1])
            if price <= 0:
                return {"error": "zero_price", "symbol": symbol}

            returns_array = np.log(
                df_daily["close"] / df_daily["close"].shift(1)
            ).dropna().values

            # Features complètes (avec sentiment + analyst + earnings)
            sentiment_score = self.market_data.get_news_sentiment_score(symbol)
            analyst_data    = self.market_data.get_analyst_ratings(symbol)
            analyst_score   = analyst_data.get("score", 0.0)
            earnings_data   = self.market_data.get_earnings_data(symbol)

            ohlcv_dict = {"1day": df_daily}
            if df_5min is not None and not df_5min.empty:
                ohlcv_dict["5min"] = df_5min

            features = self.feat_builder.build_all_features(
                symbol          = symbol,
                ohlcv_dict      = ohlcv_dict,
                macro_snapshot  = macro_snapshot,
                sentiment_score = sentiment_score,
                analyst_score   = analyst_score,
                earnings_data   = earnings_data,
            )
            features.update(self.micro_feats.build_all(df_daily, df_5min))
            features.update(self.vol_engine.analyze(symbol, df_daily))
            features.update(self.options_feats.build_all(symbol, price, df_daily))

            regime     = self.regime_model.detect(df_daily, macro_snapshot, features)
            raw_signal = self.signal_model.predict(features)
            calibrated = self.meta_model.calibrate(
                raw_signal    = raw_signal,
                regime_result = regime,
                options_data  = features,
                features      = features,
            )
            exec_alpha = self.exec_alpha.analyze(
                symbol         = symbol,
                df_daily       = df_daily,
                signal         = calibrated,
                market_cap     = float(quote.get("market_cap", 0) or 0),
                order_size_usd = self._portfolio_value * float(
                    calibrated.get("position_pct", 0.05) or 0.05
                ),
                df_intra       = df_5min,
            )
            pos_size = self.risk_manager.compute_position_size(
                signal          = calibrated,
                regime_result   = regime,
                portfolio_value = self._portfolio_value,
                current_price   = price,
            )
            agent_outputs = self._build_agent_outputs(calibrated, regime, features)
            council       = self.council.deliberate(
                agent_outputs   = agent_outputs,
                symbol          = symbol,
                proposed_action = calibrated,
            )

            return {
                "symbol":        symbol,
                "price":         price,
                "signal":        calibrated,
                "raw_signal":    raw_signal,
                "regime":        regime,
                "features": {
                    k: round(float(v), 4)
                    for k, v in features.items()
                    if isinstance(v, (int, float))
                    and not (isinstance(v, float) and (np.isnan(v) or np.isinf(v)))
                },
                "exec_alpha":    exec_alpha,
                "position_size": pos_size,
                "council":       council,
                "returns_array": returns_array,
                "quote":         quote,
                "sentiment":     sentiment_score,
                "analyst":       analyst_data,
                "earnings":      earnings_data,
                "should_execute": (
                    council.get("council_approved", False)
                    and calibrated.get("trade_action") in ("execute", "execute_strong")
                    and not self.settings.DRY_RUN
                ),
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            }

        except Exception as e:
            logger.error(f"  [DetailedAnalysis] {symbol}: {e}")
            import traceback
            logger.debug(traceback.format_exc())
            return {"error": str(e), "symbol": symbol}

    # ════════════════════════════════════════════════════════
    # MACRO & RÉGIME GLOBAL
    # ════════════════════════════════════════════════════════
    def _fetch_macro_snapshot(self) -> Dict:
        try:
            return self.market_data.get_macro_snapshot()
        except Exception as e:
            logger.warning(f"[Macro] Unavailable: {e}")
            return {}

    def _detect_global_regime(self, macro_snapshot: Dict) -> Dict:
        try:
            spy_data = self.market_data.get_ohlcv("SPY", "1day", 252)
            if spy_data is not None and not spy_data.empty:
                return self.regime_model.detect(spy_data, macro_snapshot)
        except Exception as e:
            logger.warning(f"[Regime] Global detection failed: {e}")

        return {
            "regime_label":    "range_bound",
            "regime_score":    0.0,
            "allow_long":      True,
            "allow_short":     False,
            "reduce_exposure": False,
            "leverage_allowed":False,
            "confidence":      0.50,
        }

    # ════════════════════════════════════════════════════════
    # OPTIMISATION & ALLOCATION
    # ════════════════════════════════════════════════════════
    def _optimize_portfolio(
        self,
        returns_dict:  Dict,
        signals:       Dict,
        regime_result: Dict,
    ) -> Dict[str, float]:
        try:
            valid = {s: r for s, r in returns_dict.items() if len(r) >= 20}
            if not valid:
                n = max(len(self._full_universe), 1)
                return {s: 1 / n for s in self._full_universe}
            return self.optimizer.optimize(valid, signals, regime_result)
        except Exception as e:
            logger.error(f"[Optimizer] {e}")
            n = max(len(self._full_universe), 1)
            return {s: 1 / n for s in self._full_universe}

    def _allocate_strategies(self, signals: Dict, regime_result: Dict) -> Dict:
        try:
            values     = list(signals.values())
            avg_conf   = float(np.mean([
                s.get("adjusted_confidence", 0.5) for s in values
            ])) if values else 0.5
            avg_bp     = float(np.mean([
                s.get("adjusted_buy_prob", 0.5) for s in values
            ])) if values else 0.5

            summary = {
                "avg_confidence": avg_conf,
                "avg_buy_prob":   avg_bp,
                "avg_vol_rank":   0.5,
            }
            perf = self.allocator.get_performance_summary()
            return self.allocator.allocate(regime_result, summary, perf)
        except Exception as e:
            logger.error(f"[Allocator] {e}")
            return {
                "trend": 0.40, "mean_reversion": 0.25,
                "vol_carry": 0.20, "options_convexity": 0.15,
            }

    # ════════════════════════════════════════════════════════
    # EXECUTION
    # ════════════════════════════════════════════════════════
    def _execute_decisions(
        self,
        results:           Dict,
        portfolio_weights: Dict,
        regime_result:     Dict,
    ) -> List[Dict]:
        executions = []
        for symbol, result in results.items():
            if result.get("error"):
                continue
            if not result.get("should_execute"):
                continue
            council = result.get("council", {})
            if council.get("decision") not in ("execute", "execute_strong"):
                continue

            try:
                pos_data   = result.get("position_size", {})
                shares     = abs(int(pos_data.get("position_shares", 0)))
                if shares == 0:
                    continue

                size_mult  = float(council.get("size_multiplier", 1.0) or 1.0)
                shares     = max(1, int(shares * size_mult))
                signal     = result.get("signal", {})
                quote      = result.get("quote", {})
                adv        = float(quote.get("volume", 1_000_000) or 1_000_000)

                exec_result = self.exec_router.select_and_route(
                    symbol          = symbol,
                    direction       = pos_data.get("direction", "buy"),
                    quantity        = shares,
                    price           = result.get("price", 0),
                    adv             = adv,
                    execution_alpha = {},
                    signal          = signal,
                    dry_run         = self.settings.DRY_RUN,
                )

                executions.append({
                    "symbol":    symbol,
                    "result":    exec_result,
                    "council":   council.get("decision"),
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                })

                logger.info(
                    f"  [Execution] {symbol}: {exec_result.get('status')} | "
                    f"{pos_data.get('direction')} {shares} shares @ "
                    f"${result.get('price', 0):.2f}"
                )

            except Exception as e:
                logger.error(f"  [Execution] {symbol}: {e}")

        return executions

    # ════════════════════════════════════════════════════════
    # OUTPUT JSON POUR LE DASHBOARD
    # ════════════════════════════════════════════════════════
    def _build_output(
        self,
        results:           Dict,
        global_regime:     Dict,
        macro_snapshot:    Dict,
        portfolio_weights: Dict,
        strategy_weights:  Dict,
        executions:        List[Dict],
    ) -> Dict:
        now = datetime.datetime.utcnow().isoformat() + "Z"

        # ── current_signals.json ──────────────────────────
        current_signals = {
            "timestamp":  now,
            "session":    self.settings.MARKET_SESSION,
            "llm_mode":   self._llm_mode,
            "dry_run":    self.settings.DRY_RUN,
            "n_universe": len(self._full_universe),
            "signals": {
                sym: {
                    "direction":    r["signal"].get("direction", "neutral"),
                    "final_score":  r["signal"].get("final_score", 0),
                    "confidence":   r["signal"].get("adjusted_confidence", 0),
                    "buy_prob":     r["signal"].get("adjusted_buy_prob", 0.5),
                    "trade_action": r["signal"].get("trade_action", "wait"),
                    "council":      r["council"].get("decision", "wait"),
                    "price":        r.get("price", 0),
                    "change_pct":   r.get("quote", {}).get("change_pct", 0),
                    "regime":       r["regime"].get("regime_label", "unknown"),
                    "sector":       get_sector(sym),
                }
                for sym, r in results.items()
                if not r.get("error")
                and r.get("price", 0) > 0
                and "signal" in r
                and "council" in r
                and "regime" in r
            },
        }

        # ── portfolio.json ────────────────────────────────
        portfolio = {
            "timestamp":   now,
            "total_value": self._portfolio_value,
            "weights":     portfolio_weights,
            "positions":   self._positions,
            "cash_pct":    max(0.0, 1.0 - sum(portfolio_weights.values())),
        }

        # ── risk_metrics.json ─────────────────────────────
        risk_metrics = {
            "timestamp": now,
            "drawdown":  self._get_drawdown_status(),
            "leverage":  self.risk_manager.check_leverage_constraints(
                total_exposure  = self._get_total_exposure(),
                portfolio_value = self._portfolio_value,
                regime_result   = global_regime,
            ),
            "var_metrics": {},
        }

        # ── regime.json ───────────────────────────────────
        regime_json = {
            "timestamp":   now,
            "global":      global_regime,
            "macro":       macro_snapshot,
            "per_symbol": {
                sym: r.get("regime", {})
                for sym, r in results.items()
                if not r.get("error") and "regime" in r
            },
        }

        # ── agent_decisions.json ──────────────────────────
        agent_decisions = {
            "timestamp": now,
            "decisions": {
                sym: {
                    "council":      r.get("council", {}),
                    "trade_action": r.get("signal", {}).get("trade_action"),
                    "exec_quality": 0.75,
                }
                for sym, r in results.items()
                if not r.get("error") and "council" in r
            },
            "executions": executions,
        }

        # ── strategy_weights.json ─────────────────────────
        strategy_json = {
            "timestamp": now,
            "weights":   strategy_weights,
            "regime":    global_regime.get("regime_label"),
        }

        # ── performance_metrics.json ──────────────────────
        n_exec    = len(executions)
        n_execute = sum(
            1 for r in results.values()
            if r.get("council", {}).get("decision") == "execute"
        )
        performance = {
            "timestamp":       now,
            "portfolio_value": self._portfolio_value,
            "session":         self.settings.MARKET_SESSION,
            "n_signals":       len(current_signals["signals"]),
            "n_universe":      len(self._full_universe),
            "n_execute":       n_execute,
            "n_executions":    n_exec,
            "llm_mode":        self._llm_mode,
            "strategy_perf":   self.allocator.get_performance_summary(),
        }

        # ── system_status.json ────────────────────────────
        worker_status = self.worker.check_all_workers()
        system_status = {
            "timestamp":     now,
            "overall":       "healthy" if all(worker_status.values()) else "degraded",
            "llm_available": self.worker.llm_available,
            "workers":       worker_status,
            "mode":          self._llm_mode,
            "dry_run":       self.settings.DRY_RUN,
            "session":       self.settings.MARKET_SESSION,
            "n_universe":    len(self._full_universe),
        }

        return {
            "current_signals":     current_signals,
            "portfolio":           portfolio,
            "risk_metrics":        risk_metrics,
            "regime":              regime_json,
            "agent_decisions":     agent_decisions,
            "strategy_weights":    strategy_json,
            "performance_metrics": performance,
            "system_status":       system_status,
        }

    # ════════════════════════════════════════════════════════
    # HELPERS
    # ════════════════════════════════════════════════════════
    def _get_drawdown_status(self) -> Dict:
        return {
            "halt_active":     False,
            "hit_daily_limit": False,
            "current_drawdown":0.0,
            "daily_pnl_pct":   0.0,
        }

    def _get_total_exposure(self) -> float:
        return sum(
            abs(float(p.get("shares", 0)) * float(p.get("price", 0)))
            for p in self._positions.values()
        )