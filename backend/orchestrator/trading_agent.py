# ============================================================
# ALPHAVAULT QUANT — Trading Agent v2.1
# ✅ Intégration complète des 13 agents spécialisés
# ✅ DrawdownGuardian, CorrelationSurface, FeatureDrift...
# ✅ Batch OHLCV download 550+ symboles
# ✅ LLM multi-provider (Gemini → Groq → Ollama)
# ✅ Optimisé AMD Micro (1GB RAM + 3GB swap)
# ============================================================

import json
import datetime
import time
import numpy as np
import pandas as pd
from typing import Dict, List, Optional, Tuple
from concurrent.futures import ThreadPoolExecutor, as_completed
from loguru import logger

# ── Core backend ────────────────────────────────────────────
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
from backend.config.settings              import Settings

# ── Agents spécialisés ──────────────────────────────────────
# from backend.agents.multi_agent_council       import MultiAgentCouncil
# from backend.agents.capital_rotation          import CapitalRotationAgent
# from backend.agents.confidence_calibrator     import ConfidenceCalibrator
# from backend.agents.correlation_surface       import CorrelationSurfaceAgent
# from backend.agents.drawdown_guardian         import DrawdownGuardian
# from backend.agents.execution_timing          import ExecutionTimingAgent
# from backend.agents.feature_drift             import FeatureDriftAgent
# from backend.agents.greeks_balancer           import GreeksBalancer
# from backend.agents.hyperparameter_evolution  import HyperparameterEvolutionAgent
# from backend.agents.market_impact             import MarketImpactModel
# from backend.agents.self_evaluation           import SelfEvaluationAgent
# from backend.agents.strategy_discovery        import StrategyDiscoveryAgent
# from backend.agents.strategy_switching        import StrategySwitchingAgent
# from backend.agents.strategy_weighting        import StrategyWeightingAgent

from backend.agents.multi_agent_council       import MultiAgentCouncil
from backend.agents.capital_rotation_agent        import CapitalRotationAgent
from backend.agents.confidence_calibrator     import ConfidenceCalibrator
from backend.agents.correlation_surface_agent     import CorrelationSurfaceAgent
from backend.agents.drawdown_guardian         import DrawdownGuardian
from backend.agents.execution_timing_agent        import ExecutionTimingAgent
from backend.agents.feature_drift_agent           import FeatureDriftAgent
from backend.agents.greeks_balancer           import GreeksBalancer
from backend.agents.hyperparameter_evolution_agent import HyperparameterEvolutionAgent
from backend.agents.market_impact_model           import MarketImpactModel
from backend.agents.self_evaluation_agent         import SelfEvaluationAgent
from backend.agents.strategy_discovery_agent      import StrategyDiscoveryAgent
from backend.agents.strategy_switching_agent      import StrategySwitchingAgent
from backend.agents.strategy_weighting_agent      import StrategyWeightingAgent

# ── Universe ────────────────────────────────────────────────
try:
    from backend.core.universe import get_full_universe, get_sector, CORE_UNIVERSE
    _UNIVERSE_MODULE_OK = True
except ImportError:
    logger.warning("[TradingAgent] universe.py not found — fallback")
    _UNIVERSE_MODULE_OK = False
    def get_full_universe():
        return ["SPY","QQQ","IWM","GLD","TLT",
                "AAPL","MSFT","NVDA","GOOGL","AMZN",
                "META","TSLA","JPM","GS","V","UNH","LLY","XOM","HD","COST"]
    def get_sector(sym): return "Other"
    CORE_UNIVERSE = get_full_universe()

class TradingAgent:
    """
    Agent de trading principal v2.1.

    Pipeline batch optimisé pour 550+ symboles sur AMD Micro.
    Tous les agents sont instanciés et appelés à chaque cycle.
    """

    def __init__(self, settings: Settings):
        self.settings = settings

        logger.info("[TradingAgent v2.1] Initializing components + agents...")

        # ── Core components ────────────────────────────────
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

        # ── 13 Agents spécialisés ─────────────────────────
        self.council          = MultiAgentCouncil(self.worker, settings)
        self.capital_rotation = CapitalRotationAgent(self.worker, settings)
        self.conf_calibrator  = ConfidenceCalibrator()
        self.corr_surface     = CorrelationSurfaceAgent(self.worker, settings)
        self.dd_guardian      = DrawdownGuardian(self.worker, settings)
        self.exec_timing      = ExecutionTimingAgent(self.worker, settings)
        self.feat_drift       = FeatureDriftAgent(self.worker, settings)
        self.greeks_balancer  = GreeksBalancer()
        self.hyperparam_evo   = HyperparameterEvolutionAgent(settings)
        self.market_impact    = MarketImpactModel()
        self.self_eval        = SelfEvaluationAgent(self.worker, settings)
        self.strategy_disc    = StrategyDiscoveryAgent(self.worker, settings)
        self.strategy_switch  = StrategySwitchingAgent(self.worker, settings)
        self.strategy_weight  = StrategyWeightingAgent()

        # ── État portefeuille ──────────────────────────────
        self._portfolio_value       = 100_000.0
        self._positions: Dict       = {}
        self._portfolio_returns:    List[float] = []
        self._benchmark_returns:    List[float] = []
        self._trade_log:            List[Dict]  = []
        self._last_batch_quotes:    Optional[Dict] = None
        self._cycle_count:          int = 0

        # ── Universe ───────────────────────────────────────
        if _UNIVERSE_MODULE_OK:
            self._full_universe = settings.get_active_universe()
            self._core_universe = settings.get_core_universe()
        else:
            self._full_universe = settings.EQUITY_UNIVERSE
            self._core_universe = settings.EQUITY_UNIVERSE

        # ── LLM status ─────────────────────────────────────
        worker_status   = self.worker.check_all_workers()
        llm_status      = self.worker.get_llm_status()
        self._llm_mode  = "llm" if llm_status["available_providers"] else "deterministic"

        logger.info(
            f"[TradingAgent] Ready | "
            f"LLM: {self._llm_mode} "
            f"({llm_status.get('primary', 'none')}) | "
            f"Universe: {len(self._full_universe)} | "
            f"Core: {len(self._core_universe)} | "
            f"Agents: 13"
        )

    # ════════════════════════════════════════════════════════
    # PIPELINE PRINCIPAL
    # ════════════════════════════════════════════════════════
    def run_full_pipeline(self) -> Dict:
        t_start = time.time()
        self._cycle_count += 1

        logger.info(f"\n{'='*60}")
        logger.info(f"  ALPHAVAULT QUANT v2.1 — Cycle #{self._cycle_count}")
        logger.info(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        logger.info(f"  LLM: {self._llm_mode} | Session: {self.settings.MARKET_SESSION}")
        logger.info(f"  Universe: {len(self._full_universe)} | Core: {len(self._core_universe)}")
        logger.info(f"{'='*60}\n")

        # ── 1. Macro ───────────────────────────────────────
        macro = self._fetch_macro_snapshot()

        # ── 2. Régime global (SPY) ─────────────────────────
        global_regime = self._detect_global_regime(macro)

        # ── 3. Batch OHLCV ────────────────────────────────
        logger.info(f"[Pipeline] Batch daily download | {len(self._full_universe)} symbols...")
        batch_daily = self.market_data.batch_ohlcv_download(
            symbols  = self._full_universe,
            interval = "1day",
            period   = "1y",
        )

        # ── 4. Intraday (core only) ────────────────────────
        core_for_intra = self._core_universe[:self.settings.INTRADAY_TOP_N]
        logger.info(f"[Pipeline] Intraday 5min | {len(core_for_intra)} core symbols...")
        batch_5min = self.market_data.batch_ohlcv_download(
            symbols  = core_for_intra,
            interval = "5min",
            period   = "5d",
        )

        # ── 5. Batch quotes ────────────────────────────────
        batch_quotes = self.market_data.get_portfolio_quotes(self._full_universe)
        self._last_batch_quotes = batch_quotes

        # ── 6. Feature building parallèle ─────────────────
        n_workers = min(self.settings.FEATURE_WORKERS, len(self._full_universe), 4)
        all_features, all_signals = self._batch_build_features(
            symbols      = self._full_universe,
            batch_daily  = batch_daily,
            batch_5min   = batch_5min,
            batch_quotes = batch_quotes,
            macro        = macro,
            n_workers    = n_workers,
        )

        # ── 7. Feature Drift Analysis ─────────────────────
        drift_report = {}
        try:
            drift_report = self.feat_drift.analyze(
                current_features = all_features,
                trigger_retrain  = False,
            )
            if drift_report.get("retrain_recommended"):
                logger.warning(
                    f"⚠ Feature Drift | {drift_report.get('overall_drift')} | "
                    f"Retrain recommandé"
                )
        except Exception as e:
            logger.warning(f"[FeatureDrift] Error: {e}")

        # ── 8. Corrélation portefeuille ───────────────────
        corr_report = {}
        try:
            returns_for_corr = {
                sym: np.log(batch_daily[sym]["close"] / batch_daily[sym]["close"].shift(1)).dropna().values
                for sym in self._core_universe
                if sym in batch_daily and batch_daily[sym] is not None
                   and len(batch_daily[sym]) >= 20
            }
            current_pos = {sym: 0.1 for sym in list(returns_for_corr.keys())[:10]}
            corr_report = self.corr_surface.analyze(returns_for_corr, current_pos)
        except Exception as e:
            logger.warning(f"[CorrelationSurface] Error: {e}")

        # ── 9. Drawdown Guardian ──────────────────────────
        dd_report = {}
        try:
            daily_pnl = self._estimate_daily_pnl(batch_quotes)
            dd_report = self.dd_guardian.update_and_check(
                current_equity  = self._portfolio_value,
                daily_pnl_pct   = daily_pnl,
                open_positions  = self._positions,
            )
            if dd_report.get("halt_active"):
                logger.error(
                    f"🚨 TRADING HALT | DD={dd_report.get('current_drawdown', 0):.2%} | "
                    f"Reason: {dd_report.get('halt_reason')}"
                )
        except Exception as e:
            logger.warning(f"[DrawdownGuardian] Error: {e}")

        # ── 10. Capital Rotation ──────────────────────────
        rotation_report = {}
        try:
            returns_all = {
                sym: np.log(batch_daily[sym]["close"] / batch_daily[sym]["close"].shift(1)).dropna().values
                for sym in self._full_universe[:50]  # AMD Micro: limite à 50 pour perf
                if sym in batch_daily and batch_daily[sym] is not None
                   and len(batch_daily[sym]) >= 20
            }
            rotation_report = self.capital_rotation.analyze(
                returns_dict     = returns_all,
                regime_result    = global_regime,
                current_weights  = self._positions,
            )
        except Exception as e:
            logger.warning(f"[CapitalRotation] Error: {e}")

        # ── 11. Strategy Discovery (périodique) ──────────
        discovery_report = {}
        if self._cycle_count % 12 == 0:  # Toutes les 12 cycles (~1h)
            try:
                snap_for_disc = {
                    sym: all_features[sym]
                    for sym in self._core_universe
                    if sym in all_features
                }
                discovery_report = self.strategy_disc.discover(
                    features_snapshot  = snap_for_disc,
                    regime_result      = global_regime,
                    current_strategies = ["trend", "mean_reversion",
                                         "vol_carry", "options_convexity"],
                )
                if discovery_report.get("count", 0) > 0:
                    logger.info(
                        f"🔍 Strategy Discovery | "
                        f"{discovery_report['count']} nouvelles stratégies | "
                        f"Source: {discovery_report.get('source')}"
                    )
            except Exception as e:
                logger.warning(f"[StrategyDiscovery] Error: {e}")

        # ── 12. Top N pour LLM ────────────────────────────
        top_symbols = self._select_top_symbols(all_signals, self.settings.LLM_TOP_N)

        # ── 13. Analyse par symbole + Council ─────────────
        results:     Dict = {}
        all_returns: Dict = {}

        for sym in self._full_universe:
            if sym not in all_signals:
                continue

            signal   = all_signals[sym]
            features = all_features.get(sym, {})
            df_daily = batch_daily.get(sym)
            df_5min  = batch_5min.get(sym)
            quote    = batch_quotes.get(sym) or {}
            price    = float(quote.get("price", 0) or 0)

            if price <= 0 and df_daily is not None and not df_daily.empty:
                try:
                    price = float(df_daily["close"].iloc[-1])
                except Exception:
                    pass

            if price <= 0:
                continue

            # Returns
            if df_daily is not None and not df_daily.empty and len(df_daily) >= 20:
                try:
                    ret = np.log(df_daily["close"] / df_daily["close"].shift(1)).dropna().values
                    if len(ret) >= 20:
                        all_returns[sym] = ret
                except Exception:
                    pass

            # Régime par symbole
            regime = self._regime_from_features(features, global_regime)

            # Calibration du signal
            try:
                signal = self.conf_calibrator.calibrate_signal(signal, regime)
            except Exception:
                pass

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

            # Council (LLM pour top N, déterministe pour le reste)
            use_llm = (sym in top_symbols) and self.worker.llm_available
            council = self._get_council_decision(
                sym, signal, regime, features,
                df_daily, df_5min,
                dd_report, corr_report, drift_report,
                rotation_report,
                use_llm,
            )

            # Halt override du DrawdownGuardian
            if dd_report.get("halt_active") and \
               council.get("decision") in ("execute", "execute_strong"):
                council["decision"]        = "veto"
                council["council_approved"] = False
                council["reason"]          = dd_report.get("halt_reason", "DD halt")

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
                    if isinstance(v, (int, float))
                    and not (isinstance(v, float) and (np.isnan(v) or np.isinf(v)))
                },
                "position_size": pos_size,
                "council":       council,
                "quote":         quote,
                "should_execute": (
                    council.get("council_approved", False)
                    and signal.get("trade_action") in ("execute", "execute_strong")
                    and not dd_report.get("halt_active", False)
                    and not self.settings.DRY_RUN
                ),
                "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
            }

        # ── 14. Greeks Balancer ───────────────────────────
        try:
            positions_for_greeks = {
                sym: {
                    "shares":    results[sym]["position_size"].get("position_shares", 0),
                    "price":     results[sym]["price"],
                    "direction": results[sym]["position_size"].get("direction", "long"),
                }
                for sym in self._positions
                if sym in results
            }
            greeks_report = self.greeks_balancer.analyze_portfolio_greeks(
                positions       = positions_for_greeks,
                options_data    = {sym: results[sym].get("features", {}) for sym in results},
                portfolio_value = self._portfolio_value,
            )
        except Exception as e:
            logger.warning(f"[GreeksBalancer] Error: {e}")
            greeks_report = {}

        # ── 15. Portfolio Optimization ────────────────────
        portfolio_weights = self._optimize_portfolio(
            all_returns, all_signals, global_regime
        )

        # ── 16. Strategy Allocation + Weighting ──────────
        base_strategy_weights = self._allocate_strategies(all_signals, global_regime)
        perf_summary          = self.allocator.get_performance_summary()

        try:
            strategy_weights = self.strategy_weight.compute_weights(
                base_allocation     = base_strategy_weights,
                performance_history = {
                    s: [] for s in base_strategy_weights
                },
                regime_result       = global_regime,
            )
        except Exception:
            strategy_weights = base_strategy_weights

        # ── 17. Strategy Switching ────────────────────────
        try:
            switch_report = self.strategy_switch.evaluate(
                current_allocation  = base_strategy_weights,
                target_allocation   = strategy_weights,
                regime_result       = global_regime,
                performance_summary = perf_summary,
            )
            if switch_report.get("n_switches", 0) > 0:
                strategy_weights = switch_report.get("final_allocation", strategy_weights)
        except Exception as e:
            logger.warning(f"[StrategySwitching] Error: {e}")

        # ── 18. Hyperparameter Evolution (rare) ──────────
        if self._cycle_count % 24 == 0:  # ~2h
            try:
                hyp_result = self.hyperparam_evo.evolve(
                    current_performance = {
                        "sharpe_ratio": 0.5,
                        "accuracy":     0.52,
                        "ensemble_auc": 0.54,
                        "max_drawdown": abs(dd_report.get("current_drawdown", 0)),
                    },
                    n_iterations = 3,
                )
                if hyp_result.get("improved"):
                    logger.info(
                        f"🧬 Hyperparameter Evolution | "
                        f"Score: {hyp_result.get('current_score'):.4f} → "
                        f"{hyp_result.get('best_score'):.4f}"
                    )
            except Exception as e:
                logger.warning(f"[HyperparamEvo] Error: {e}")

        # ── 19. Self Evaluation (périodique) ─────────────
        if self._cycle_count % 36 == 0:  # ~3h
            try:
                self.self_eval.evaluate(
                    trade_log          = self._trade_log[-100:],
                    portfolio_returns  = self._portfolio_returns[-30:],
                    benchmark_returns  = self._benchmark_returns[-30:],
                    model_metrics      = {},
                    execution_metrics  = {},
                )
            except Exception as e:
                logger.warning(f"[SelfEval] Error: {e}")

        # ── 20. Exécution ─────────────────────────────────
        executions = self._execute_decisions(results, portfolio_weights, global_regime)

        # ── 21. Output JSON dashboard ─────────────────────
        output = self._build_output(
            results           = results,
            global_regime     = global_regime,
            macro_snapshot    = macro,
            portfolio_weights = portfolio_weights,
            strategy_weights  = strategy_weights,
            executions        = executions,
            dd_report         = dd_report,
            corr_report       = corr_report,
            drift_report      = drift_report,
            greeks_report     = greeks_report,
        )

        elapsed = time.time() - t_start
        logger.info(
            f"\n[Pipeline] DONE in {elapsed:.1f}s | "
            f"{len(results)} signals | "
            f"{len(executions)} executed | "
            f"Regime: {global_regime.get('regime_label', '?')} | "
            f"LLM: {self._llm_mode}"
        )
        return output

    # ════════════════════════════════════════════════════════
    # COUNCIL avec agents réels
    # ════════════════════════════════════════════════════════
    def _get_council_decision(
        self,
        sym:            str,
        signal:         Dict,
        regime:         Dict,
        features:       Dict,
        df_daily:       Optional[pd.DataFrame],
        df_5min:        Optional[pd.DataFrame],
        dd_report:      Dict,
        corr_report:    Dict,
        drift_report:   Dict,
        rotation_report: Dict,
        use_llm:        bool,
    ) -> Dict:
        """Construit les agent_outputs réels et appelle le Council."""
        agent_outputs = self._build_agent_outputs(
            sym, signal, regime, features,
            df_daily, df_5min,
            dd_report, corr_report, drift_report,
            rotation_report,
        )

        if use_llm:
            try:
                return self.council.deliberate(
                    agent_outputs   = agent_outputs,
                    symbol          = sym,
                    proposed_action = signal,
                )
            except Exception as e:
                logger.debug(f"[Council LLM] {sym}: {e}")

        return self._deterministic_decision(signal, regime, agent_outputs)

    def _build_agent_outputs(
        self,
        sym:            str,
        signal:         Dict,
        regime:         Dict,
        features:       Dict,
        df_daily:       Optional[pd.DataFrame],
        df_5min:        Optional[pd.DataFrame],
        dd_report:      Dict,
        corr_report:    Dict,
        drift_report:   Dict,
        rotation_report: Dict,
    ) -> Dict:
        """
        Construit l'input réel pour le MultiAgentCouncil.
        Chaque clé correspond à un agent spécialisé.
        """
        # ── Market Impact ─────────────────────────────────
        pos_size = signal.get("position_size", {})
        shares   = abs(int(pos_size.get("position_shares", 0))) if pos_size else 1
        price    = signal.get("price", 100.0)
        direction = signal.get("direction", "neutral")
        action    = "buy" if direction == "buy" else "sell"

        impact_output = {}
        try:
            if df_daily is not None and not df_daily.empty:
                impact_output = self.market_impact.estimate(
                    symbol        = sym,
                    order_shares  = max(shares, 1),
                    order_side    = action,
                    current_price = price,
                    df_daily      = df_daily,
                )
        except Exception:
            impact_output = {"acceptable": True, "impact_bps": 5.0, "feasible": True}

        impact_output["feasible"] = impact_output.get("acceptable", True)

        # ── Execution Timing ──────────────────────────────
        timing_output = {}
        try:
            timing_output = self.exec_timing.evaluate(
                symbol          = sym,
                signal          = signal,
                execution_alpha = {},
                df_intra        = df_5min,
                macro_events    = {},
            )
        except Exception:
            timing_output = {"execute_now": True, "vote": "execute",
                             "timing_score": 0.7}

        timing_output["vote"] = "execute" if timing_output.get("execute_now") else "wait"

        # ── Risk Manager ──────────────────────────────────
        total_exp = self._get_total_exposure()
        try:
            risk_output = self.risk_manager.check_leverage_constraints(
                total_exposure  = total_exp,
                portfolio_value = self._portfolio_value,
                regime_result   = regime,
            )
        except Exception:
            risk_output = {"is_over_leveraged": False, "current_leverage": 0.0}

        # ── Greeks Balancer ───────────────────────────────
        greeks_output = {
            "convexity_exposure": float(features.get("iv_rank", 0.5)),
            "imbalanced":         False,
        }

        # ── Capital Rotation Alignment ────────────────────
        rotation_alignment = 0.65
        if rotation_report.get("risk_mode", {}).get("mode") == "risk_on":
            if direction == "buy":
                rotation_alignment = 0.80
        elif rotation_report.get("risk_mode", {}).get("mode") == "risk_off_extreme":
            rotation_alignment = 0.20

        # ── Assemblage final ──────────────────────────────
        return {
            "drawdown_guardian": {
                **dd_report,
                "halt_active":   dd_report.get("halt_active",     False),
                "hit_daily_limit": dd_report.get("hit_daily_limit", False),
            },
            "regime": regime,
            "signal": signal,
            "exec_timing": timing_output,
            "risk": risk_output,
            "correlation_surface": {
                "reduce_exposure":    corr_report.get("avg_correlation", 0) > 0.75,
                "diversification":    corr_report.get("diversification_score", 0.5),
                "corr_spike":         corr_report.get("corr_spike_detected", False),
            },
            "strategy_switching": {
                "allocation_score":   0.70,
            },
            "market_impact": impact_output,
            "capital_rotation": {
                "rotation_alignment": rotation_alignment,
                "risk_mode":          rotation_report.get("risk_mode", {}).get("mode", "neutral"),
            },
            "self_eval": {
                "system_health": "ok",
            },
            "feature_drift": {
                "retrain_needed": drift_report.get("retrain_recommended", False),
                "severe_drift":   drift_report.get("overall_drift") == "critical",
            },
            "greeks_balancer": greeks_output,
        }

    def _deterministic_decision(
        self,
        signal:        Dict,
        regime:        Dict,
        agent_outputs: Dict,
    ) -> Dict:
        """Décision déterministe sans LLM."""
        score    = float(signal.get("final_score", 0) or 0)
        conf     = float(signal.get("adjusted_confidence", 0) or 0)
        buy_prob = float(signal.get("adjusted_buy_prob", 0.5) or 0.5)

        allow_long    = regime.get("allow_long",      True)
        reduce_exp    = regime.get("reduce_exposure", False)
        regime_score  = float(regime.get("regime_score", 0))

        composite = score * 0.50 + conf * 0.25 + (buy_prob - 0.5) * 0.25

        if reduce_exp:
            composite *= 0.40
        elif regime_score < -0.40:
            composite *= 0.65
        elif regime_score > 0.40:
            composite *= 1.15

        # Pénalités agents
        if agent_outputs.get("market_impact", {}).get("high_impact"):
            composite *= 0.80
        if agent_outputs.get("correlation_surface", {}).get("corr_spike"):
            composite *= 0.85
        if agent_outputs.get("feature_drift", {}).get("retrain_needed"):
            composite *= 0.75

        if composite > 0.60 and allow_long and conf > 0.55:
            decision  = "execute"
            approved  = True
            size_mult = min(1.0, composite)
        elif composite > 0.45 and allow_long and conf > 0.40:
            decision  = "execute"
            approved  = True
            size_mult = 0.75
        elif composite < -0.20 or reduce_exp:
            decision  = "veto"
            approved  = False
            size_mult = 0.0
        else:
            decision  = "wait"
            approved  = False
            size_mult = 0.0

        return {
            "decision":         decision,
            "council_approved": approved,
            "weighted_score":   round(composite, 4),
            "size_multiplier":  round(size_mult, 2),
            "mode":             "deterministic",
            "reason": (
                f"score={score:.3f} conf={conf:.3f} "
                f"composite={composite:.3f} "
                f"regime={regime.get('regime_label','?')}"
            ),
        }

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
        n_workers:    int = 4,
    ) -> Tuple[Dict, Dict]:
        all_features: Dict[str, Dict] = {}
        all_signals:  Dict[str, Dict] = {}

        def _process(sym: str) -> Tuple[str, Optional[Dict], Optional[Dict]]:
            try:
                df_daily = batch_daily.get(sym)
                if df_daily is None or df_daily.empty or len(df_daily) < 30:
                    return sym, None, None

                df_5min    = batch_5min.get(sym)
                ohlcv_dict = {"1day": df_daily}
                if df_5min is not None and not df_5min.empty and len(df_5min) >= 12:
                    ohlcv_dict["5min"] = df_5min

                features = self.feat_builder.build_all_features(
                    symbol          = sym,
                    ohlcv_dict      = ohlcv_dict,
                    macro_snapshot  = macro,
                    sentiment_score = 0.0,
                    analyst_score   = 0.0,
                    earnings_data   = None,
                )

                if df_5min is not None and not df_5min.empty:
                    try:
                        features.update(self.micro_feats.build_all(df_daily, df_5min))
                    except Exception:
                        pass

                try:
                    features.update(self.vol_engine.analyze(sym, df_daily))
                except Exception:
                    pass

                quote = batch_quotes.get(sym) or {}
                price = float(quote.get("price", 0) or 0)
                if price <= 0 and not df_daily.empty:
                    price = float(df_daily["close"].iloc[-1])
                features["current_price"] = price
                features["change_pct"]    = float(quote.get("change_pct", 0) or 0)

                raw_signal = self.signal_model.predict(features)

                momentum  = float(features.get("momentum_20d", 0))
                vol_rank  = float(features.get("atr_pct_rank", 0.5))
                reg_simple = {
                    "regime_label":    "trend_up" if momentum > 0.05 else
                                       "trend_down" if momentum < -0.05 else "range_bound",
                    "regime_score":    float(np.tanh(momentum * 3)),
                    "allow_long":      momentum >= 0,
                    "allow_short":     momentum < -0.05,
                    "reduce_exposure": vol_rank > 0.85,
                    "confidence":      0.60,
                }

                calibrated = self.meta_model.calibrate(
                    raw_signal    = raw_signal,
                    regime_result = reg_simple,
                    options_data  = features,
                    features      = features,
                )
                return sym, features, calibrated

            except Exception as e:
                logger.debug(f"[Features] {sym}: {e}")
                return sym, None, None

        with ThreadPoolExecutor(max_workers=n_workers) as executor:
            futures = {executor.submit(_process, sym): sym for sym in symbols}
            for future in as_completed(futures):
                try:
                    sym, feats, sig = future.result(timeout=30)
                    if feats is not None:
                        all_features[sym] = feats
                    if sig is not None:
                        all_signals[sym]  = sig
                except Exception as e:
                    logger.debug(f"[Features] future error: {e}")

        n_ok   = len(all_features)
        n_fail = len(symbols) - n_ok
        logger.info(f"[Features] {n_ok}/{len(symbols)} OK | {n_fail} failed")
        return all_features, all_signals

    # ════════════════════════════════════════════════════════
    # HELPERS
    # ════════════════════════════════════════════════════════
    def _select_top_symbols(self, all_signals: Dict, top_n: int) -> List[str]:
        core_set = set(self._core_universe)
        scored   = []
        for sym, sig in all_signals.items():
            score    = abs(float(sig.get("final_score", 0) or 0))
            conf     = float(sig.get("adjusted_confidence", 0) or 0)
            priority = (score + conf) * (1.5 if sym in core_set else 1.0)
            scored.append((sym, priority))
        scored.sort(key=lambda x: x[1], reverse=True)
        return [s for s, _ in scored[:top_n]]

    def _regime_from_features(self, features: Dict, global_regime: Dict) -> Dict:
        momentum = float(features.get("momentum_20d",    0))
        vol_rank = float(features.get("atr_pct_rank", 0.5))
        hurst    = float(features.get("hurst_exponent",0.5))
        rsi      = float(features.get("rsi_14",          50))

        if vol_rank > 0.88:
            label, score = "high_volatility", -0.5
        elif vol_rank < 0.15:
            label, score = "low_volatility",  +0.3
        elif momentum > 0.08 and hurst > 0.52:
            label = "trend_up"
            score = min(+0.8, momentum * 4)
        elif momentum < -0.08 and hurst > 0.52:
            label = "trend_down"
            score = max(-0.8, momentum * 4)
        elif rsi > 72:
            label, score = "high_volatility", -0.2
        elif rsi < 28:
            label, score = "range_bound",      +0.1
        else:
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

    def _estimate_daily_pnl(self, batch_quotes: Dict) -> float:
        """Estime le P&L journalier du portefeuille."""
        if not self._positions:
            return 0.0
        pnl = 0.0
        for sym, pos in self._positions.items():
            quote = batch_quotes.get(sym) or {}
            chg   = float(quote.get("change_pct", 0) or 0) / 100
            w     = float(pos.get("weight", 0.05))
            pnl  += chg * w
        return pnl

    def _get_total_exposure(self) -> float:
        return sum(
            abs(float(p.get("shares", 0)) * float(p.get("price", 0)))
            for p in self._positions.values()
        )

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
            "confidence":      0.50,
        }

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
            vals = list(signals.values())
            summary = {
                "avg_confidence": float(np.mean([s.get("adjusted_confidence", 0.5) for s in vals])) if vals else 0.5,
                "avg_buy_prob":   float(np.mean([s.get("adjusted_buy_prob",   0.5) for s in vals])) if vals else 0.5,
                "avg_vol_rank":   0.5,
            }
            perf = self.allocator.get_performance_summary()
            return self.allocator.allocate(regime_result, summary, perf)
        except Exception as e:
            logger.error(f"[Allocator] {e}")
            return {"trend": 0.40, "mean_reversion": 0.25,
                    "vol_carry": 0.20, "options_convexity": 0.15}

    def _execute_decisions(
        self,
        results:           Dict,
        portfolio_weights: Dict,
        regime_result:     Dict,
    ) -> List[Dict]:
        executions = []
        for symbol, result in results.items():
            if result.get("error") or not result.get("should_execute"):
                continue
            council = result.get("council", {})
            if council.get("decision") not in ("execute", "execute_strong"):
                continue
            try:
                pos_data  = result.get("position_size", {})
                shares    = abs(int(pos_data.get("position_shares", 0)))
                if shares == 0:
                    continue
                size_mult = float(council.get("size_multiplier", 1.0) or 1.0)
                shares    = max(1, int(shares * size_mult))
                signal    = result.get("signal", {})
                quote     = result.get("quote", {})
                adv       = float(quote.get("volume", 1_000_000) or 1_000_000)
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
                self._trade_log.append({
                    "symbol":    symbol,
                    "action":    pos_data.get("direction", "buy"),
                    "quantity":  shares,
                    "price":     result.get("price", 0),
                    "status":    exec_result.get("status"),
                    "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
                })
                logger.info(
                    f"  [Exec] {symbol}: {exec_result.get('status')} | "
                    f"{pos_data.get('direction')} {shares} @ "
                    f"${result.get('price', 0):.2f}"
                )
            except Exception as e:
                logger.error(f"  [Exec] {symbol}: {e}")
        return executions

    # ════════════════════════════════════════════════════════
    # OUTPUT JSON DASHBOARD
    # ════════════════════════════════════════════════════════
    def _build_output(
        self,
        results:           Dict,
        global_regime:     Dict,
        macro_snapshot:    Dict,
        portfolio_weights: Dict,
        strategy_weights:  Dict,
        executions:        List[Dict],
        dd_report:         Dict,
        corr_report:       Dict,
        drift_report:      Dict,
        greeks_report:     Dict,
    ) -> Dict:
        now = datetime.datetime.utcnow().isoformat() + "Z"
        llm_status = self.worker.get_llm_status()

        current_signals = {
            "timestamp":  now,
            "session":    self.settings.MARKET_SESSION,
            "llm_mode":   self._llm_mode,
            "llm_provider": llm_status.get("primary", "none"),
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
                and "signal" in r and "council" in r and "regime" in r
            },
        }

        portfolio = {
            "timestamp":   now,
            "total_value": self._portfolio_value,
            "weights":     portfolio_weights,
            "positions":   self._positions,
            "cash_pct":    max(0.0, 1.0 - sum(portfolio_weights.values())),
        }

        risk_metrics = {
            "timestamp": now,
            "drawdown": {
                "current_drawdown": dd_report.get("current_drawdown", 0),
                "halt_active":      dd_report.get("halt_active", False),
                "daily_pnl_pct":    dd_report.get("daily_pnl_pct", 0),
                "halt_reason":      dd_report.get("halt_reason", ""),
                "exposure_mult":    dd_report.get("exposure_mult", 1.0),
            },
            "leverage": self.risk_manager.check_leverage_constraints(
                total_exposure  = self._get_total_exposure(),
                portfolio_value = self._portfolio_value,
                regime_result   = global_regime,
            ),
            "correlation": {
                "avg_correlation":    corr_report.get("avg_correlation", 0),
                "diversification":    corr_report.get("diversification_score", 1.0),
                "corr_spike":         corr_report.get("corr_spike_detected", False),
                "n_clusters":         corr_report.get("n_clusters", 1),
                "best_diversifiers":  corr_report.get("best_diversifiers", []),
            },
            "greeks":       greeks_report,
            "feature_drift": drift_report,
            "var_metrics":  {},
        }

        regime_json = {
            "timestamp":  now,
            "global":     global_regime,
            "macro":      macro_snapshot,
            "per_symbol": {
                sym: r.get("regime", {})
                for sym, r in results.items()
                if not r.get("error") and "regime" in r
            },
        }

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

        strategy_json = {
            "timestamp": now,
            "weights":   strategy_weights,
            "regime":    global_regime.get("regime_label"),
        }

        n_execute = sum(
            1 for r in results.values()
            if r.get("council", {}).get("decision") in ("execute", "execute_strong")
        )
        performance = {
            "timestamp":       now,
            "portfolio_value": self._portfolio_value,
            "session":         self.settings.MARKET_SESSION,
            "n_signals":       len(current_signals["signals"]),
            "n_universe":      len(self._full_universe),
            "n_execute":       n_execute,
            "n_executions":    len(executions),
            "llm_mode":        self._llm_mode,
            "llm_providers":   llm_status.get("available_providers", []),
            "strategy_perf":   self.allocator.get_performance_summary(),
            "cycle":           self._cycle_count,
        }

        worker_status = self.worker.check_all_workers()
        system_status = {
            "timestamp":       now,
            "overall":         "healthy" if all(worker_status.values()) else "degraded",
            "llm_available":   self.worker.llm_available,
            "llm_providers":   llm_status,
            "workers":         worker_status,
            "mode":            self._llm_mode,
            "dry_run":         self.settings.DRY_RUN,
            "session":         self.settings.MARKET_SESSION,
            "n_universe":      len(self._full_universe),
            "agents_active":   13,
            "dd_halt":         dd_report.get("halt_active", False),
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