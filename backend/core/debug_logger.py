# ============================================================
# backend/core/debug_logger.py
# Debug Logger JSON — AlphaVault Quant
# Écrit des logs structurés lisibles par le dashboard
# ============================================================

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

class DebugLogger:
    """
    Logger qui écrit en JSON pour être lu par le dashboard GitHub Pages.
    Thread-safe.
    """

    MAX_ENTRIES = 500          # Nb max d'entrées conservées
    OUTPUT_PATH = 'docs/signals/debug_log.json'

    def __init__(self):
        self._entries  = []
        self._lock     = threading.Lock()
        self._run_id   = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')

    # ── Niveau DEBUG ─────────────────────────────────────────
    def debug(self, message: str, module: str = '', symbol: str = '',
              details: Optional[Dict] = None):
        self._add('DEBUG', message, module, symbol, details)

    # ── Niveau INFO ──────────────────────────────────────────
    def info(self, message: str, module: str = '', symbol: str = '',
             details: Optional[Dict] = None):
        self._add('INFO', message, module, symbol, details)

    # ── Niveau WARNING ───────────────────────────────────────
    def warning(self, message: str, module: str = '', symbol: str = '',
                details: Optional[Dict] = None):
        self._add('WARNING', message, module, symbol, details)

    # ── Niveau ERROR ─────────────────────────────────────────
    def error(self, message: str, module: str = '', symbol: str = '',
              details: Optional[Dict] = None):
        self._add('ERROR', message, module, symbol, details)

    # ── Signal généré ────────────────────────────────────────
    def log_signal(self, symbol: str, direction: str, score: float,
                   confidence: float, council: str, regime: str,
                   kelly_size: float, features: Optional[Dict] = None):
        self._add(
            level   = 'SIGNAL',
            message = f'{direction.upper()} signal | score={score:.3f} | council={council}',
            module  = 'signal_engine',
            symbol  = symbol,
            details = {
                'direction':   direction,
                'final_score': score,
                'confidence':  confidence,
                'council':     council,
                'regime':      regime,
                'kelly_size':  kelly_size,
                'features':    features or {}
            }
        )

    # ── Ordre placé ──────────────────────────────────────────
    def log_order(self, symbol: str, action: str, quantity: int,
                  order_type: str, status: str, order_id: Any,
                  fill_price: Optional[float] = None,
                  error: Optional[str] = None):
        level = 'ORDER_OK' if status not in ('error',) else 'ORDER_ERR'
        self._add(
            level   = level,
            message = f'{action} {quantity}x {symbol} @ {order_type} → {status}',
            module  = 'ibkr_executor',
            symbol  = symbol,
            details = {
                'action':      action,
                'quantity':    quantity,
                'order_type':  order_type,
                'status':      status,
                'order_id':    order_id,
                'fill_price':  fill_price,
                'error':       error
            }
        )

    # ── Décision council ─────────────────────────────────────
    def log_council(self, symbol: str, decision: str, score: float,
                    mode: str, reason: str, agent_votes: Optional[Dict] = None):
        self._add(
            level   = 'COUNCIL',
            message = f'Council [{mode}] → {decision.upper()} | score={score:.3f}',
            module  = 'multi_agent_council',
            symbol  = symbol,
            details = {
                'decision':    decision,
                'score':       score,
                'mode':        mode,
                'reason':      reason,
                'agent_votes': agent_votes or {}
            }
        )

    # ── Régime détecté ───────────────────────────────────────
    def log_regime(self, regime: str, score: float, confidence: float,
                   allow_long: bool, allow_short: bool):
        self._add(
            level   = 'REGIME',
            message = f'Régime: {regime} | score={score:+.2f} | conf={confidence:.1%}',
            module  = 'regime_model',
            symbol  = 'GLOBAL',
            details = {
                'regime':      regime,
                'score':       score,
                'confidence':  confidence,
                'allow_long':  allow_long,
                'allow_short': allow_short
            }
        )

    # ── Interne ──────────────────────────────────────────────
    def _add(self, level: str, message: str, module: str = '',
             symbol: str = '', details: Optional[Dict] = None):
        entry = {
            'ts':      datetime.now(timezone.utc).isoformat(),
            'level':   level,
            'module':  module,
            'symbol':  symbol,
            'message': message,
            'details': details or {},
            'run_id':  self._run_id,
        }
        with self._lock:
            self._entries.append(entry)
            if len(self._entries) > self.MAX_ENTRIES:
                self._entries = self._entries[-self.MAX_ENTRIES:]

    # ── Sauvegarde ───────────────────────────────────────────
    def save(self, path: str = None):
        out = Path(path or self.OUTPUT_PATH)
        out.parent.mkdir(parents=True, exist_ok=True)

        # Charge logs précédents et fusionne
        existing = []
        if out.exists():
            try:
                existing = json.loads(out.read_text()).get('logs', [])
            except Exception:
                pass

        with self._lock:
            all_logs = existing + self._entries

        # Garde les N plus récents
        all_logs = all_logs[-self.MAX_ENTRIES:]

        payload = {
            'timestamp':  datetime.now(timezone.utc).isoformat(),
            'run_id':     self._run_id,
            'total':      len(all_logs),
            'logs':       all_logs
        }
        out.write_text(json.dumps(payload, indent=2, default=str))

# ── Singleton global accessible partout dans le backend ──────
debug_log = DebugLogger()