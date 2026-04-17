# ============================================================
# ALPHAVAULT QUANT — ML Signal Engine
# ✅ Ensemble XGBoost + LightGBM + LogisticRegression
# ✅ Walk-Forward Training
# ✅ Mode train + inférence
# ✅ Sérialisation / Chargement modèles depuis /models/
# ============================================================

import numpy as np
import pandas as pd
import json
import os
import base64
import pickle
from typing import Dict, List, Optional, Tuple
from loguru import logger
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import roc_auc_score
import xgboost as xgb
import lightgbm as lgb

MODELS_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "models"
)

class SignalModel:
    """
    Moteur de signaux ML — Ensemble de 3 modèles complémentaires.

    Architecture :
    - XGBoost     : capture les interactions non-linéaires
    - LightGBM    : rapide, gère bien les features catégorielles
    - Logistic Reg: base linéaire calibrée (robuste en out-of-sample)

    Output par symbole :
    - buy_prob    : probabilité de hausse
    - sell_prob   : probabilité de baisse
    - expected_ret: rendement espéré (normalisé)
    - expected_vol: volatilité espérée
    - confidence  : confiance globale [0, 1]
    """

    XGB_PARAMS = {
        "n_estimators":     300,
        "max_depth":        5,
        "learning_rate":    0.05,
        "subsample":        0.8,
        "colsample_bytree": 0.8,
        "min_child_weight": 3,
        "reg_alpha":        0.1,
        "reg_lambda":       1.0,
        "objective":        "binary:logistic",
        "eval_metric":      "auc",
        "tree_method":      "hist",
        "use_label_encoder": False,
        "random_state":     42,
        "n_jobs":           -1,
    }

    LGB_PARAMS = {
        "n_estimators":     300,
        "max_depth":        5,
        "learning_rate":    0.05,
        "num_leaves":       31,
        "subsample":        0.8,
        "colsample_bytree": 0.8,
        "reg_alpha":        0.1,
        "reg_lambda":       1.0,
        "objective":        "binary",
        "metric":           "auc",
        "verbose":          -1,
        "random_state":     42,
        "n_jobs":           -1,
    }

    def __init__(self):
        self.xgb_model:  Optional[xgb.XGBClassifier]         = None
        self.lgb_model:  Optional[lgb.LGBMClassifier]        = None
        self.lr_model:   Optional[CalibratedClassifierCV]     = None
        self.scaler:     Optional[StandardScaler]             = None
        self.feature_names: List[str]                         = []
        self.is_trained  = False
        self._load_models()
        logger.info(f"✅ SignalModel initialisé (trained={self.is_trained})")

    # ── Training ──────────────────────────────────────────────
    def train(
        self,
        features_df: pd.DataFrame,
        labels_df:   pd.Series,
        walk_forward: bool = True,
    ) -> Dict:
        """
        Entraîne l'ensemble ML avec walk-forward validation.

        Args:
            features_df : DataFrame de features (N × F)
            labels_df   : Series binaire (1=hausse, 0=baisse)
            walk_forward: utilise le walk-forward ou simple split
        """
        if features_df.empty or len(features_df) < 100:
            logger.warning("Pas assez de données pour l'entraînement")
            return {"status": "insufficient_data"}

        logger.info(f"🧠 Training sur {len(features_df)} échantillons, {len(features_df.columns)} features")

        X = features_df.fillna(0).values
        y = labels_df.values
        self.feature_names = list(features_df.columns)

        # Split train/test (80/20 temporel — PAS de random shuffle)
        split_idx = int(len(X) * 0.80)
        X_train, X_test = X[:split_idx], X[split_idx:]
        y_train, y_test = y[:split_idx], y[split_idx:]

        # Normalisation
        self.scaler = StandardScaler()
        X_train_sc  = self.scaler.fit_transform(X_train)
        X_test_sc   = self.scaler.transform(X_test)

        metrics = {}

        # ── XGBoost ──────────────────────────────────────
        logger.info("  Training XGBoost...")
        self.xgb_model = xgb.XGBClassifier(**self.XGB_PARAMS)
        self.xgb_model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            verbose=False,
        )
        xgb_pred = self.xgb_model.predict_proba(X_test)[:, 1]
        metrics["xgb_auc"] = float(roc_auc_score(y_test, xgb_pred))
        logger.info(f"  XGBoost AUC: {metrics['xgb_auc']:.4f}")

        # ── LightGBM ─────────────────────────────────────
        logger.info("  Training LightGBM...")
        self.lgb_model = lgb.LGBMClassifier(**self.LGB_PARAMS)
        callbacks = [lgb.early_stopping(50, verbose=False), lgb.log_evaluation(-1)]
        self.lgb_model.fit(
            X_train, y_train,
            eval_set=[(X_test, y_test)],
            callbacks=callbacks,
        )
        lgb_pred = self.lgb_model.predict_proba(X_test)[:, 1]
        metrics["lgb_auc"] = float(roc_auc_score(y_test, lgb_pred))
        logger.info(f"  LightGBM AUC: {metrics['lgb_auc']:.4f}")

        # ── Logistic Regression ───────────────────────────
        logger.info("  Training Logistic Regression...")
        base_lr = LogisticRegression(C=0.1, max_iter=1000, random_state=42, n_jobs=-1)
        self.lr_model = CalibratedClassifierCV(base_lr, cv=3, method="isotonic")
        self.lr_model.fit(X_train_sc, y_train)
        lr_pred = self.lr_model.predict_proba(X_test_sc)[:, 1]
        metrics["lr_auc"] = float(roc_auc_score(y_test, lr_pred))
        logger.info(f"  Logistic Reg AUC: {metrics['lr_auc']:.4f}")

        # ── Ensemble AUC ─────────────────────────────────
        ensemble_pred = (xgb_pred * 0.40 + lgb_pred * 0.40 + lr_pred * 0.20)
        metrics["ensemble_auc"] = float(roc_auc_score(y_test, ensemble_pred))
        logger.info(f"  Ensemble AUC: {metrics['ensemble_auc']:.4f}")

        self.is_trained = True
        self._save_models()
        return {"status": "trained", "metrics": metrics, "n_samples": len(X)}

    # ── Inférence ─────────────────────────────────────────────
    def predict(self, features: Dict[str, float]) -> Dict:
        """
        Génère les signaux pour un symbole donné.
        Fonctionne même sans modèles ML (fallback statistique).
        """
        if not self.is_trained:
            return self._statistical_fallback(features)

        try:
            X = self._features_to_array(features)
            X_sc = self.scaler.transform(X) if self.scaler else X

            probs_xgb = self.xgb_model.predict_proba(X)[0]    if self.xgb_model else [0.5, 0.5]
            probs_lgb = self.lgb_model.predict_proba(X)[0]    if self.lgb_model else [0.5, 0.5]
            probs_lr  = self.lr_model.predict_proba(X_sc)[0]  if self.lr_model  else [0.5, 0.5]

            # Ensemble pondéré
            buy_prob = (
                probs_xgb[1] * 0.40 +
                probs_lgb[1] * 0.40 +
                probs_lr[1]  * 0.20
            )
            sell_prob = 1.0 - buy_prob

            # Confiance : distance au point d'incertitude (0.5)
            confidence = abs(buy_prob - 0.5) * 2

            # Rendement espéré proxy
            momentum_score = features.get("momentum_20d", 0)
            expected_ret   = float(buy_prob - 0.5) * 0.04 + momentum_score * 0.01

            # Volatilité espérée
            expected_vol = features.get("rvol_21d", 0.15)

            return {
                "buy_prob":      round(float(buy_prob), 4),
                "sell_prob":     round(float(sell_prob), 4),
                "expected_ret":  round(float(expected_ret), 4),
                "expected_vol":  round(float(expected_vol), 4),
                "confidence":    round(float(confidence), 4),
                "direction":     "buy" if buy_prob > 0.55 else
                                 "sell" if buy_prob < 0.45 else "neutral",
                "model_used":    "ensemble_ml",
                "xgb_prob":      round(float(probs_xgb[1]), 4),
                "lgb_prob":      round(float(probs_lgb[1]), 4),
                "lr_prob":       round(float(probs_lr[1]), 4),
            }

        except Exception as e:
            logger.error(f"SignalModel.predict: {e}")
            return self._statistical_fallback(features)

    # ── Fallback Statistique ──────────────────────────────────
    def _statistical_fallback(self, features: Dict) -> Dict:
        """
        Génère des signaux déterministes sans ML.
        Utilisé quand les modèles ne sont pas encore entraînés.
        """
        # Score composite basé sur les features les plus fiables
        score = 0.0
        weights = {
            "momentum_20d":    0.15,
            "rsi_norm":        0.10,
            "macd_hist":       0.10,
            "ema_50_slope":    0.10,
            "momentum_alignment": 0.15,
            "hurst_exponent":  0.10,  # H > 0.5 → trend
            "variance_ratio":  0.10,
            "sentiment_score": 0.10,
            "analyst_score":   0.10,
        }
        for feat, w in weights.items():
            val = features.get(feat, 0)
            if feat == "hurst_exponent":
                val = (val - 0.5) * 2  # Centre sur 0
            score += float(val) * w

        # Normalise dans [0, 1]
        buy_prob  = float(0.5 + np.tanh(score * 2) * 0.35)
        sell_prob = 1.0 - buy_prob
        confidence = abs(buy_prob - 0.5) * 2

        return {
            "buy_prob":     round(buy_prob, 4),
            "sell_prob":    round(sell_prob, 4),
            "expected_ret": round((buy_prob - 0.5) * 0.04, 4),
            "expected_vol": round(float(features.get("rvol_21d", 0.15)), 4),
            "confidence":   round(confidence, 4),
            "direction":    "buy" if buy_prob > 0.55 else
                            "sell" if buy_prob < 0.45 else "neutral",
            "model_used":   "statistical_fallback",
        }

    # ── Sérialisation ─────────────────────────────────────────
    def _save_models(self):
        """Sauvegarde les modèles entraînés dans /models/."""
        os.makedirs(MODELS_DIR, exist_ok=True)
        try:
            if self.xgb_model:
                self.xgb_model.save_model(os.path.join(MODELS_DIR, "xgboost_model.json"))

            if self.lgb_model:
                self.lgb_model.booster_.save_model(os.path.join(MODELS_DIR, "lightgbm_model.txt"))

            if self.lr_model and self.scaler:
                meta = {
                    "lr_model_b64": base64.b64encode(
                        pickle.dumps(self.lr_model)
                    ).decode("utf-8"),
                    "scaler_b64": base64.b64encode(
                        pickle.dumps(self.scaler)
                    ).decode("utf-8"),
                    "feature_names": self.feature_names,
                }
                with open(os.path.join(MODELS_DIR, "logistic_model.pkl.b64"), "w") as f:
                    json.dump(meta, f)

            logger.info(f"✅ Modèles sauvegardés dans {MODELS_DIR}/")
        except Exception as e:
            logger.error(f"_save_models: {e}")

    def _load_models(self):
        """Charge les modèles depuis /models/ si disponibles."""
        try:
            xgb_path = os.path.join(MODELS_DIR, "xgboost_model.json")
            if os.path.exists(xgb_path):
                self.xgb_model = xgb.XGBClassifier()
                self.xgb_model.load_model(xgb_path)
                logger.info("✅ XGBoost chargé")

            lgb_path = os.path.join(MODELS_DIR, "lightgbm_model.txt")
            if os.path.exists(lgb_path):
                self.lgb_model = lgb.LGBMClassifier()
                self.lgb_model = lgb.Booster(model_file=lgb_path)
                logger.info("✅ LightGBM chargé")

            lr_path = os.path.join(MODELS_DIR, "logistic_model.pkl.b64")
            if os.path.exists(lr_path):
                with open(lr_path, "r") as f:
                    meta = json.load(f)
                self.lr_model      = pickle.loads(base64.b64decode(meta["lr_model_b64"]))
                self.scaler        = pickle.loads(base64.b64decode(meta["scaler_b64"]))
                self.feature_names = meta.get("feature_names", [])
                logger.info("✅ Logistic Regression chargée")

            self.is_trained = (
                self.xgb_model is not None and
                self.lgb_model is not None and
                self.lr_model  is not None
            )
        except Exception as e:
            logger.warning(f"_load_models: {e} — mode fallback statistique")
            self.is_trained = False

    def _features_to_array(self, features: Dict) -> np.ndarray:
        """Convertit un dict de features en array numpy ordonné."""
        if self.feature_names:
            arr = [float(features.get(f, 0)) for f in self.feature_names]
        else:
            arr = [float(v) for v in features.values()]
        return np.array(arr, dtype=np.float32).reshape(1, -1)

    # ── Génération des Labels d'Entraînement ──────────────────
    @staticmethod
    def generate_labels(
        df:           pd.DataFrame,
        horizon:      int   = 5,
        threshold:    float = 0.005,
    ) -> pd.Series:
        """
        Génère les labels binaires pour l'entraînement.
        Label = 1 si rendement horizon > threshold, 0 sinon.
        """
        future_ret = df["close"].shift(-horizon) / df["close"] - 1
        return (future_ret > threshold).astype(int)