"""
predict.py
==========

Zero-shot weekly forecasting of crisis-event counts with **Amazon Chronos-2**.

What the model does
-------------------
Chronos-2 is a pretrained time-series foundation model. Here it is used in
**zero-shot inference only** — we never fine-tune it and never change its
weights (no training, no Unsloth). We hand it the past weekly event counts as
context and ask for the next four weeks.

What the forecast means (read this carefully)
--------------------------------------------
The model predicts *future numerical event counts* for a (country, event_type)
pair, learned purely from the historical **frequency** of those events. It does
**NOT** predict the geographic spread of an earthquake, the transmission of a
disease, or where inside a country the next crisis will occur. It answers only:
"given how often this type of event happened here recently, how many are we
likely to see in each of the next four weeks?"

Fallback
--------
If Chronos-2 / torch cannot be loaded (e.g. no model download available in a
demo environment), we fall back to a transparent statistical baseline so the API
still returns valid JSON. The response always reports which path produced it via
the `model_used` field.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from prepare_data import WeeklySeries, next_week_dates

# Official pretrained model on the Hugging Face Hub. Loaded once, lazily.
CHRONOS_MODEL_ID = "amazon/chronos-2"
DEFAULT_HORIZON = 4  # forecast the next four weeks
QUANTILE_LEVELS = [0.1, 0.5, 0.9]  # lower / median / upper prediction range

# Lazily-initialised singletons so the (heavy) model is loaded at most once and
# only when the first forecast is requested — not at import time.
_PIPELINE: Any = None
_PIPELINE_STATE = "not_loaded"   # "not_loaded" | "chronos-2" | "unavailable"
_LOAD_ERROR: str | None = None


def load_pipeline() -> Any:
    """
    Load the official pretrained Chronos-2 pipeline from Hugging Face, once.

    Returns the pipeline, or None if it cannot be loaded (the caller then uses
    the statistical fallback). Never raises — a missing model must not take the
    whole API down.
    """
    global _PIPELINE, _PIPELINE_STATE, _LOAD_ERROR
    if _PIPELINE is not None or _PIPELINE_STATE == "unavailable":
        return _PIPELINE
    try:
        import torch
        from chronos import BaseChronosPipeline

        # Zero-shot: from_pretrained just downloads/loads frozen weights. CPU is
        # fine for a demo — the context here is only a few dozen numbers.
        _PIPELINE = BaseChronosPipeline.from_pretrained(
            CHRONOS_MODEL_ID,
            device_map="cpu",
            torch_dtype=torch.float32,
        )
        _PIPELINE_STATE = "chronos-2"
    except Exception as exc:  # noqa: BLE001 - any failure => use fallback
        _PIPELINE = None
        _PIPELINE_STATE = "unavailable"
        _LOAD_ERROR = f"{type(exc).__name__}: {exc}"
    return _PIPELINE


def pipeline_status() -> dict[str, Any]:
    """Small status blob for the /health endpoint."""
    return {
        "model_id": CHRONOS_MODEL_ID,
        "state": _PIPELINE_STATE,
        "load_error": _LOAD_ERROR,
    }


def _chronos_forecast(counts: list[int], horizon: int):
    """
    Zero-shot Chronos-2 forecast. Returns (median, lower, upper) as int lists.

    Uses the pipeline's quantile interface: the context is the raw weekly counts,
    and we read the 10th / 50th / 90th percentiles of the predictive distribution
    as the lower bound / point forecast / upper bound.
    """
    import torch

    pipeline = load_pipeline()
    context = torch.tensor(counts, dtype=torch.float32)

    # predict_quantiles -> (quantiles[batch, horizon, n_levels], mean[batch, horizon])
    quantiles, _mean = pipeline.predict_quantiles(
        context=context,
        prediction_length=horizon,
        quantile_levels=QUANTILE_LEVELS,
    )
    q = quantiles[0].detach().cpu().numpy()  # shape: [horizon, 3]
    lower = np.clip(np.round(q[:, 0]), 0, None)
    median = np.clip(np.round(q[:, 1]), 0, None)
    upper = np.clip(np.round(q[:, 2]), 0, None)
    return median.astype(int).tolist(), lower.astype(int).tolist(), upper.astype(int).tolist()


def _fallback_forecast(counts: list[int], horizon: int):
    """
    Transparent statistical baseline used only when Chronos-2 is unavailable.

    Point forecast = mean of the most recent weeks; the band is +/- one standard
    deviation. Counts can't be negative, so everything is clipped at zero.
    """
    arr = np.asarray(counts, dtype=float)
    recent = arr[-8:] if arr.size >= 8 else arr
    mean = float(recent.mean()) if recent.size else 0.0
    std = float(recent.std()) if recent.size > 1 else max(1.0, mean ** 0.5)

    median = [int(max(0, round(mean))) for _ in range(horizon)]
    lower = [int(max(0, round(mean - std))) for _ in range(horizon)]
    upper = [int(max(0, round(mean + std))) for _ in range(horizon)]
    return median, lower, upper


def forecast_series(series: WeeklySeries, horizon: int = DEFAULT_HORIZON) -> dict[str, Any]:
    """
    Forecast the next `horizon` weeks for one (country, event_type) series.

    Returns a JSON-serialisable dict with the historical context, the predicted
    counts, the lower/upper prediction ranges, the forecast dates, and which
    model produced the numbers.
    """
    if horizon < 1:
        raise ValueError("horizon must be >= 1")
    if not series.counts:
        raise ValueError(
            f"No historical weeks for {series.country}/{series.event_type}"
        )

    pipeline = load_pipeline()
    if pipeline is not None:
        try:
            median, lower, upper = _chronos_forecast(series.counts, horizon)
            model_used = "chronos-2"
        except Exception:  # noqa: BLE001 - never fail the request on a model quirk
            median, lower, upper = _fallback_forecast(series.counts, horizon)
            model_used = "statistical-fallback"
    else:
        median, lower, upper = _fallback_forecast(series.counts, horizon)
        model_used = "statistical-fallback"

    forecast_dates = next_week_dates(series.dates[-1], horizon)

    return {
        "country": series.country,
        "event_type": series.event_type,
        "historical_dates": series.dates,
        "historical_counts": series.counts,
        "forecast_dates": forecast_dates,
        "predicted_counts": median,
        "lower_bound": lower,
        "upper_bound": upper,
        "horizon_weeks": horizon,
        "model_used": model_used,
        # Reminder carried into every response so consumers don't over-read it:
        "interpretation": (
            "Predicted future WEEKLY EVENT COUNTS based on historical frequency. "
            "Does not predict the geographic spread or location of any event."
        ),
    }


if __name__ == "__main__":
    from prepare_data import build_weekly_series

    for s in build_weekly_series():
        result = forecast_series(s)
        print(
            f"{result['country']} / {result['event_type']} "
            f"[{result['model_used']}] -> next {result['horizon_weeks']}w: "
            f"{result['predicted_counts']}"
        )
