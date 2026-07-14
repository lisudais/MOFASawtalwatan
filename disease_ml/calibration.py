"""Probability calibrators for the outbreak classifier.

Both training (training/train.py) and inference (generate_forecast.py) import
`PlattCalibrator` from here, so a calibrator pickled during training loads back
with the exact same class at forecast time.

Why Platt (sigmoid) instead of isotonic: isotonic regression fitted on the small
validation set is a STEP function — it maps large ranges of raw scores onto a
handful of output values (measured: ~40 distinct probabilities across 2,058 test
rows, 600+ of them collapsed to a single value). That is what made many different
country/disease forecasts show the exact same percentage. Platt scaling is a
smooth, strictly monotonic logistic map, so every distinct raw score keeps a
distinct calibrated probability (measured: ~1,730 distinct), it preserves the
model's ranking/PR-AUC, and it still greatly improves the Brier score over the
raw model. It is a drop-in for isotonic: same `.predict(raw_probs)` interface.
"""
from __future__ import annotations

import numpy as np


class PlattCalibrator:
    """Sigmoid (Platt) scaling on the logit of the raw model probability.

    Stored as two plain floats (coef, intercept) so it pickles/unpickles with no
    heavy dependency and behaves identically wherever it is loaded.
    """

    def __init__(self, coef: float, intercept: float):
        self.coef = float(coef)
        self.intercept = float(intercept)

    @staticmethod
    def _logit(p, eps: float = 1e-6):
        p = np.clip(np.asarray(p, dtype=float), eps, 1.0 - eps)
        return np.log(p / (1.0 - p))

    def predict(self, raw):
        """raw outbreak probabilities -> calibrated probabilities (same shape)."""
        z = self.coef * self._logit(raw) + self.intercept
        return 1.0 / (1.0 + np.exp(-z))

    @classmethod
    def fit(cls, raw, y) -> "PlattCalibrator":
        # Near-unpenalised logistic regression of label on the raw-score logit —
        # the standard Platt fit. Fitted on VALIDATION only (never on test).
        from sklearn.linear_model import LogisticRegression
        z = cls._logit(raw).reshape(-1, 1)
        lr = LogisticRegression(C=1e6, solver="lbfgs", max_iter=1000).fit(z, np.asarray(y))
        return cls(lr.coef_[0, 0], lr.intercept_[0])
