# ============================================================
# ALPHAVAULT QUANT — Trading Agent (Orchestrateur Central)
# ✅ Combine TOUS les moteurs en une décision unifiée
# ✅ Fallback automatique LLM → déterministe
# ✅ Pipeline complet : features → signal → régime → risk → execution
# ✅ Intègre le Multi-Agent Council
# ============================================================

import json
import datetime
import numpy as np
from typing import Dict, List, Optional
from loguru import logger

# Imports relatifs (on est dans backend/orchestrator/)
from core.worker_client          import WorkerClient
from core.market_data_client     import MarketDataClient
from core.feature_builder        import FeatureBuilder
from core.microstructure_features import MicrostructureFeatures
from core.options_features       import OptionsFeatures
from core.volatility_engine      import VolatilityEngine
from core.regime_model           import RegimeModel
from core.signal_model           import SignalModel
from core.meta_model             import MetaModel
from core.execution_alpha_engine import ExecutionAlphaEngine
from core.smart_execution_router import SmartExecutionRouter
from core.risk_manager           import RiskManager
from core.optimizer              import PortfolioOptimizer
from core.strategy_allocator     import StrategyAllocator
from agents.multi_agent_council  import MultiAgentCouncil
from config.settings             import Settings

class TradingAgent:
    """
    Agent de trading principal — orchestre l'ensemble du pipeline.

    Séquence d'exécution par symbole :
    1.  Fetch données marché (multi-timeframe)
    2.  Build features (technique + micro + options + vol)
    3.  Detect régime de marché
    4.  Run ML signal model
    5.  Calibration meta-model
    6.  Execution alpha estimation
    7.  Risk sizing (Kelly fractionnel)
    8.  Multi-agent council (vote pondéré ou LLM)
    9.  Portfolio optimization
    10. Strategy allocation
    11. Smart order routing
    12. Génération JSON signals → dashboard
    """

    def __init__(self, settings: Settings):
        self.settings = settings

        # ── Initialisation des composants ─────────────
        logger.info("🚀 Initialisation TradingAgent...")
        self.worker       = WorkerClient(settings)
        self.market_data  = MarketDataClient(settings, self.worker)
        self.feat_builder = FeatureBuilder()
        self.micro_feats  = MicrostructureFeatures()
        self.vol_engine   = VolatilityEngine()
        self.options_feats= OptionsFeatures(self.worker)
        self.regime_model = RegimeModel()
        self.signal_model = SignalModel()
        self.meta_model   = MetaModel()
        self.exec_alpha   = ExecutionAlphaEngine()
        self.exec_router  = SmartExecutionRouter(settings)
        self.risk_manager = RiskManager(settings)
        self.optimizer    = PortfolioOptimizer(settings)
        self.allocator    = StrategyAllocator()
        self.council      = MultiAgentCouncil(self.worker, settings)

        # État du portefeuille (persisté via JSON)
        self._portfolio_value  = 100_000.0   # Capital initial
        self._positions: Dict  = {}          # {symbol: {shares, entry_price, ...}}
        self._returns_cache: Dict = {}       # {symbol: np.array}

        # Vérification des workers
        worker_status = self.worker.check_all_workers()
        self._llm_mode = "llm" if worker_status.get("ai_proxy") else "deterministic"
        logger.info(
            f"✅ TradingAgent prêt | Mode LLM: {self._llm_mode} | "
            f"Univers: {len(settings.EQUITY_UNIVERSE)} symboles"
        )

    # ════════════════════════════════════════════════
    # PIPELINE PRINCIPAL
    # ════════════════════════════════════════════════
    def run_full_pipeline(self) -> Dict:
        """
        Exécute le pipeline complet pour tous les symboles de l'univers.
        Retourne un résumé des décisions + signaux JSON pour le dashboard.
        """
        logger.info(f"\n{'='*60}")
        logger.info(f"  🤖 ALPHAVAULT QUANT — Cycle de Trading")
        logger.info(f"  {datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')} UTC")
        logger.info(f"  Mode: {self.settings.EXECUTION_MODE} | DryRun: {self.settings.DRY_RUN}")
        logger.info(f"  LLM: {self._llm_mode} | Session: {self.settings.MARKET_SESSION}")
        logger.info(f"{'='*60}\n")

        results        = {}
        all_signals    = {}
        all_returns    = {}
        session        = self.settings.MARKET_SESSION

        # ── Étape 1 : Snapshot macro (une seule fois) ──
        macro_snapshot = self._fetch_macro_snapshot()

        # ── Étape 2 : Régime global (sur SPY) ─────────
        global_regime  = self._detect_global_regime(macro_snapshot)

        # ── Étape 3 : Analyse par symbole ──────────────
        for symbol in self.settings.EQUITY_UNIVERSE:
            try:
                result = self._analyze_symbol(
                    symbol, macro_snapshot, global_regime, session
                )
                results[symbol]  = result
                all_signals[symbol] = result.get("signal", {})

                # Cache des returns pour l'optimisation portefeuille
                if result.get("returns_array") is not None:
                    all_returns[symbol] = result["returns_array"]

                logger.info(
                    f"  📊 {symbol:6s} | "
                    f"{result.get('signal', {}).get('direction', '?'):6s} | "
                    f"score={result.get('signal', {}).get('final_score', 0):.3f} | "
                    f"council={result.get('council', {}).get('decision', '?')}"
                )

            except Exception as e:
                logger.error(f"  ❌ {symbol}: {e}")
                results[symbol] = {"error": str(e)}

        # ── Étape 4 : Optimisation portefeuille global ──
        portfolio_weights = self._optimize_portfolio(
            all_returns, all_signals, global_regime
        )

        # ── Étape 5 : Allocation stratégies ───────────
        strategy_weights = self._allocate_strategies(
            all_signals, global_regime
        )

        # ── Étape 6 : Exécution des ordres ────────────
        executions = self._execute_decisions(
            results, portfolio_weights, global_regime
        )

        # ── Étape 7 : Génération JSON signals ─────────
        output = self._build_output(
            results, global_regime, macro_snapshot,
            portfolio_weights, strategy_weights, executions
        )
        return output

    # ════════════════════════════════════════════════
    # ANALYSE PAR SYMBOLE
    # ════════════════════════════════════════════════
    def _analyze_symbol(
        self,
        symbol:         str,
        macro_snapshot: Dict,
        global_regime:  Dict,
        session:        str,
    ) -> Dict:
        """Pipeline complet d'analyse pour un symbole."""

        # ── 1. Données de marché ──────────────────────
        ohlcv_dict = self.market_data.get_multi_timeframe_ohlcv(
            symbol, self.settings.SIGNAL_TIMEFRAMES
        )
        df_daily = ohlcv_dict.get("1day")
        df_5min  = ohlcv_dict.get("5min")
        df_1h    = ohlcv_dict.get("1h")

        if df_daily is None or df_daily.empty:
            return {"error": "no_data", "symbol": symbol}

        # Quote temps réel
        quote = self.market_data.get_realtime_quote(symbol)
        current_price = float(quote.get("price", df_daily["close"].iloc[-1])) if quote else float(df_daily["close"].iloc[-1])

        # Returns pour VaR / optimisation
        returns_array = np.log(df_daily["close"] / df_daily["close"].shift(1)).dropna().values

        # ── 2. Features ───────────────────────────────
        sentiment_score = self.market_data.get_news_sentiment_score(symbol)
        analyst_data    = self.market_data.get_analyst_ratings(symbol)
        analyst_score   = analyst_data.get("score", 0.0)
        earnings_data   = self.market_data.get_earnings_data(symbol)

        features = self.feat_builder.build_all_features(
            symbol         = symbol,
            ohlcv_dict     = ohlcv_dict,
            macro_snapshot = macro_snapshot,
            sentiment_score= sentiment_score,
            analyst_score  = analyst_score,
            earnings_data  = earnings_data,
        )

        micro_features = self.micro_feats.build_all(df_daily, df_5min)
        features.update(micro_features)

        vol_features = self.vol_engine.analyze(symbol, df_daily)
        features.update(vol_features)

        options_features = self.options_feats.build_all(
            symbol, current_price, df_daily
        )
        features.update(options_features)

        # ── 3. Régime par symbole ─────────────────────
        regime_result = self.regime_model.detect(df_daily, macro_snapshot, features)

        # ── 4. Signal ML ──────────────────────────────
        raw_signal = self.signal_model.predict(features)

        # ── 5. Calibration Meta-Model ─────────────────
        calibrated_signal = self.meta_model.calibrate(
            raw_signal    = raw_signal,
            regime_result = regime_result,
            options_data  = options_features,
            features      = features,
        )

        # ── 6. Execution Alpha ────────────────────────
        market_cap = float(quote.get("market_cap", 0)) if quote else 0.0
        exec_alpha = self.exec_alpha.analyze(
            symbol         = symbol,
            df_daily       = df_daily,
            signal         = calibrated_signal,
            market_cap     = market_cap,
            order_size_usd = self._portfolio_value * calibrated_signal.get("position_pct", 0.05),
            df_intra       = df_5min,
        )

        # ── 7. Risk Sizing ────────────────────────────
        position_size = self.risk_manager.compute_position_size(
            signal          = calibrated_signal,
            regime_result   = regime_result,
            portfolio_value = self._portfolio_value,
            current_price   = current_price,
        )

        # ── 8. Agent Outputs (pour le Council) ────────
        agent_outputs = {
            "drawdown_guardian":  self._get_drawdown_status(),
            "regime":             regime_result,
            "signal":             calibrated_signal,
            "exec_timing": {
                "vote": "execute" if exec_alpha.get("optimal_timing", {}).get("is_optimal_now") else "wait",
            },
            "risk": self.risk_manager.check_leverage_constraints(
                total_exposure  = self._get_total_exposure(),
                portfolio_value = self._portfolio_value,
                regime_result   = regime_result,
            ),
            "correlation_surface": {"reduce_exposure": False},
            "strategy_switching":  {"allocation_score": 0.70},
            "market_impact":       {"feasible": exec_alpha.get("execution_quality", 0.5) > 0.40},
            "capital_rotation":    {"rotation_alignment": 0.65},
            "self_eval":           {"system_health": "ok"},
            "feature_drift":       {"retrain_needed": False, "severe_drift": False},
            "greeks_balancer":     {"convexity_exposure": options_features.get("iv_rank", 0.5)},
        }

        # ── 9. Multi-Agent Council ────────────────────
        council_result = self.council.deliberate(
            agent_outputs   = agent_outputs,
            symbol          = symbol,
            proposed_action = calibrated_signal,
        )

        # ── 10. Décision finale d'exécution ───────────
        should_execute = (
            council_result.get("council_approved", False) and
            calibrated_signal.get("trade_action") in ("execute", "execute_strong") and
            exec_alpha.get("execute_now", False) and
            not self.settings.DRY_RUN is False  # Respecte dry_run
        )

        return {
            "symbol":         symbol,
            "price":          current_price,
            "signal":         calibrated_signal,
            "raw_signal":     raw_signal,
            "regime":         regime_result,
            "features":       {k: round(v, 4) for k, v in features.items() if isinstance(v, float)},
            "exec_alpha":     exec_alpha,
            "position_size":  position_size,
            "council":        council_result,
            "should_execute": should_execute,
            "returns_array":  returns_array,
            "quote":          quote,
            "options":        options_features,
            "sentiment":      sentiment_score,
            "analyst":        analyst_data,
            "earnings":       earnings_data,
            "timestamp":      datetime.datetime.utcnow().isoformat() + "Z",
        }

    # ════════════════════════════════════════════════
    # MACRO & RÉGIME GLOBAL
    # ════════════════════════════════════════════════
    def _fetch_macro_snapshot(self) -> Dict:
        """Récupère le snapshot macroéconomique complet."""
        try:
            return self.market_data.get_macro_snapshot()
        except Exception as e:
            logger.warning(f"Macro snapshot unavailable: {e}")
            return {}

    def _detect_global_regime(self, macro_snapshot: Dict) -> Dict:
        """Détecte le régime global sur SPY comme proxy du marché."""
        try:
            spy_data = self.market_data.get_ohlcv("SPY", "1day", 252)
            if spy_data is not None:
                return self.regime_model.detect(spy_data, macro_snapshot)
        except Exception as e:
            logger.warning(f"Global regime detection failed: {e}")
        return {"regime_label": "range_bound", "regime_score": 0.0,
                "allow_long": True, "allow_short": False,
                "reduce_exposure": False, "confidence": 0.5}

    # ════════════════════════════════════════════════
    # OPTIMISATION & ALLOCATION
    # ════════════════════════════════════════════════
    def _optimize_portfolio(
        self,
        returns_dict:  Dict,
        signals:       Dict,
        regime_result: Dict,
    ) -> Dict[str, float]:
        """Optimise l'allocation du portefeuille."""
        try:
            valid_returns = {s: r for s, r in returns_dict.items() if len(r) >= 20}
            if not valid_returns:
                n = len(self.settings.EQUITY_UNIVERSE)
                return {s: 1/n for s in self.settings.EQUITY_UNIVERSE}
            return self.optimizer.optimize(valid_returns, signals, regime_result)
        except Exception as e:
            logger.error(f"Portfolio optimization failed: {e}")
            n = len(self.settings.EQUITY_UNIVERSE)
            return {s: 1/n for s in self.settings.EQUITY_UNIVERSE}

    def _allocate_strategies(self, signals: Dict, regime_result: Dict) -> Dict:
        """Alloue le capital entre les familles de stratégies."""
        try:
            summary = {
                "avg_confidence": np.mean([
                    s.get("adjusted_confidence", 0.5)
                    for s in signals.values()
                ]) if signals else 0.5,
                "avg_buy_prob": np.mean([
                    s.get("adjusted_buy_prob", 0.5)
                    for s in signals.values()
                ]) if signals else 0.5,
                "avg_vol_rank": 0.5,
            }
            perf = self.allocator.get_performance_summary()
            return self.allocator.allocate(regime_result, summary, perf)
        except Exception as e:
            logger.error(f"Strategy allocation failed: {e}")
            return {"trend": 0.40, "mean_reversion": 0.25,
                    "vol_carry": 0.20, "options_convexity": 0.15}

    # ════════════════════════════════════════════════
    # EXÉCUTION DES ORDRES
    # ════════════════════════════════════════════════
    def _execute_decisions(
        self,
        results:          Dict,
        portfolio_weights: Dict,
        regime_result:    Dict,
    ) -> List[Dict]:
        """Execute (ou simule) les ordres approuvés par le Council."""
        executions = []
        for symbol, result in results.items():
            if result.get("error"):
                continue
            if not result.get("should_execute"):
                continue
            if result.get("council", {}).get("decision") not in ("execute", "execute_strong"):
                continue

            try:
                position = result.get("position_size", {})
                shares   = abs(int(position.get("position_shares", 0)))
                if shares == 0:
                    continue

                size_mult = result["council"].get("size_multiplier", 1.0)
                shares    = int(shares * size_mult)

                exec_result = self.exec_router.select_and_route(
                    symbol          = symbol,
                    direction       = position.get("direction", "buy"),
                    quantity        = shares,
                    price           = result.get("price", 0),
                    adv             = float(result.get("quote", {}).get("volume", 1e6)),
                    execution_alpha = result.get("exec_alpha", {}),
                    signal          = result.get("signal", {}),
                    dry_run         = self.settings.DRY_RUN,
                )
                executions.append({
                    "symbol":     symbol,
                    "result":     exec_result,
                    "council":    result["council"].get("decision"),
                    "timestamp":  datetime.datetime.utcnow().isoformat() + "Z",
                })
                logger.info(
                    f"  ✅ Ordre {symbol}: {exec_result.get('status')} | "
                    f"{position.get('direction')} {shares} @ "
                    f"{exec_result.get('fill_price', 0):.2f}"
                )
            except Exception as e:
                logger.error(f"  ❌ Execution {symbol}: {e}")
        return executions

    # ════════════════════════════════════════════════
    # GÉNÉRATION JSON DASHBOARD
    # ════════════════════════════════════════════════
    def _build_output(
        self,
        results:          Dict,
        global_regime:    Dict,
        macro_snapshot:   Dict,
        portfolio_weights: Dict,
        strategy_weights: Dict,
        executions:       List[Dict],
    ) -> Dict:
        """Construit les JSONs de signaux pour le dashboard GitHub Pages."""
        now = datetime.datetime.utcnow().isoformat() + "Z"

        # ── current_signals.json ──────────────────────
        current_signals = {
            "timestamp":  now,
            "session":    self.settings.MARKET_SESSION,
            "llm_mode":   self._llm_mode,
            "dry_run":    self.settings.DRY_RUN,
            "signals": {
                sym: {
                    "direction":    r.get("signal", {}).get("direction", "neutral"),
                    "final_score":  r.get("signal", {}).get("final_score", 0),
                    "confidence":   r.get("signal", {}).get("adjusted_confidence", 0),
                    "buy_prob":     r.get("signal", {}).get("adjusted_buy_prob", 0.5),
                    "trade_action": r.get("signal", {}).get("trade_action", "wait"),
                    "council":      r.get("council", {}).get("decision", "wait"),
                    "price":        r.get("price", 0),
                    "regime":       r.get("regime", {}).get("regime_label", "unknown"),
                }
                for sym, r in results.items()
                if not r.get("error")
            },
        }

        # ── portfolio.json ────────────────────────────
        portfolio = {
            "timestamp":    now,
            "total_value":  self._portfolio_value,
            "weights":      portfolio_weights,
            "positions":    self._positions,
            "cash_pct":     max(0, 1.0 - sum(portfolio_weights.values())),
        }

        # ── risk_metrics.json ─────────────────────────
        risk_metrics = {
            "timestamp":    now,
            "drawdown":     self._get_drawdown_status(),
            "leverage":     self.risk_manager.check_leverage_constraints(
                total_exposure  = self._get_total_exposure(),
                portfolio_value = self._portfolio_value,
                regime_result   = global_regime,
            ),
            "var_metrics":  {},
        }

        # ── regime.json ───────────────────────────────
        regime_json = {
            "timestamp":   now,
            "global":      global_regime,
            "macro":       macro_snapshot,
            "per_symbol":  {
                sym: r.get("regime", {})
                for sym, r in results.items()
                if not r.get("error")
            },
        }

        # ── agent_decisions.json ──────────────────────
        agent_decisions = {
            "timestamp": now,
            "decisions": {
                sym: {
                    "council":      r.get("council", {}),
                    "trade_action": r.get("signal", {}).get("trade_action"),
                    "exec_quality": r.get("exec_alpha", {}).get("execution_quality", 0),
                }
                for sym, r in results.items()
                if not r.get("error")
            },
            "executions": executions,
        }

        # ── strategy_weights.json ─────────────────────
        strategy_json = {
            "timestamp": now,
            "weights":   strategy_weights,
            "regime":    global_regime.get("regime_label"),
        }

        # ── performance_metrics.json ──────────────────
        performance = {
            "timestamp":       now,
            "portfolio_value": self._portfolio_value,
            "session":         self.settings.MARKET_SESSION,
            "n_signals":       len([r for r in results.values() if not r.get("error")]),
            "n_executions":    len(executions),
            "llm_mode":        self._llm_mode,
            "strategy_perf":   self.allocator.get_performance_summary(),
        }

        # ── system_status.json ────────────────────────
        worker_status = self.worker.check_all_workers()
        system_status = {
            "timestamp":        now,
            "overall":          "healthy" if all(worker_status.values()) else "degraded",
            "llm_available":    self.worker.llm_available,
            "workers":          worker_status,
            "mode":             self._llm_mode,
            "dry_run":          self.settings.DRY_RUN,
            "session":          self.settings.MARKET_SESSION,
        }

        return {
            "current_signals":    current_signals,
            "portfolio":          portfolio,
            "risk_metrics":       risk_metrics,
            "regime":             regime_json,
            "agent_decisions":    agent_decisions,
            "strategy_weights":   strategy_json,
            "performance_metrics": performance,
            "system_status":      system_status,
        }

    # ── Helpers ───────────────────────────────────────────────
    def _get_drawdown_status(self) -> Dict:
        return {
            "halt_active":       False,
            "hit_daily_limit":   False,
            "current_drawdown":  0.0,
            "daily_pnl_pct":     0.0,
        }

    def _get_total_exposure(self) -> float:
        return sum(
            abs(p.get("shares", 0) * p.get("price", 0))
            for p in self._positions.values()
        )