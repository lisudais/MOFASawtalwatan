#!/usr/bin/env python3
"""
Phase 1 - rolling time-series backtest of LOCAL Chronos-2 vs simple baselines.

For every eligible (country, event_type) weekly series we roll the forecast
origin back in 4-week steps, hide the next 4 weeks, forecast them, and score the
predictions against the real values. Chronos-2 is compared head-to-head with
three baselines (historical mean, seasonal-naive, last-value). Metrics: MAE,
RMSE, WAPE, and Chronos-2 prediction-interval coverage (P10–P90).

STRICT: no statistical fallback substitutes for Chronos-2 - if the model errors,
we stop and raise. No numbers are invented. Sparse series are reported as sparse.

Outputs (../evaluation/):
  backtest_metrics.json   per-event-type metrics for every method
  model_comparison.csv    flat table: event_type,method,MAE,RMSE,WAPE,coverage,n
  best_configuration.json  best method per event type (by WAPE, then MAE)

Run:  forecasting/.venv/Scripts/python.exe evaluate.py
"""
from __future__ import annotations

import csv
import json
import os
from collections import defaultdict

import numpy as np

import run_forecast as rf  # reuse the exact real-data extraction + weekly series

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
EVAL_DIR = os.path.join(ROOT, "evaluation")
os.makedirs(EVAL_DIR, exist_ok=True)

HORIZON = 4
MIN_CONTEXT = 8          # never forecast from fewer than 8 observed weeks
MIN_SERIES_LEN = 16      # eligibility: >= 16 weekly points
MAX_FOLDS = 3            # rolling origins per series (end, end-4, end-8)
SEASON = 52              # weekly seasonality period for seasonal-naive
QUANTILES = [0.1, 0.5, 0.9]
METHODS = ["chronos-2", "hist_mean", "seasonal_naive", "last_value"]


def eligible_series():
    events, _ = rf.extract_events()
    series = rf.weekly_series(events, rf.SINCE)
    return [s for s in series if len(s["counts"]) >= MIN_SERIES_LEN]


def folds_for(counts):
    """Rolling origins from the end: (context, actual[4])."""
    out, origin = [], len(counts) - HORIZON
    while origin >= MIN_CONTEXT and len(out) < MAX_FOLDS:
        out.append((origin, counts[:origin], counts[origin:origin + HORIZON]))
        origin -= HORIZON
    return out


def baseline_forecast(method, context):
    ctx = np.asarray(context, dtype=float)
    if method == "hist_mean":
        v = float(ctx.mean()) if ctx.size else 0.0
        return np.full(HORIZON, v)
    if method == "last_value":
        v = float(ctx[-1]) if ctx.size else 0.0
        return np.full(HORIZON, v)
    if method == "seasonal_naive":
        if ctx.size >= SEASON:
            # value from one season (52w) before each forecast week
            return np.array([ctx[-SEASON + i] for i in range(HORIZON)], dtype=float)
        return None  # not enough history -> this fold has no seasonal baseline
    raise ValueError(method)


def load_chronos():
    import torch
    from chronos import BaseChronosPipeline
    print("loading amazon/chronos-2 locally (CPU)…", flush=True)
    pipe = BaseChronosPipeline.from_pretrained("amazon/chronos-2", device_map="cpu", torch_dtype=torch.float32)
    print(f"loaded {type(pipe).__name__}", flush=True)
    return pipe, torch


def chronos_batch(pipe, torch, contexts):
    """Batched Chronos-2 quantile forecast for a list of 1-D contexts.
    Returns list of (median[4], p10[4], p90[4]). Raises on model failure."""
    inputs = [torch.tensor(c, dtype=torch.float32) for c in contexts]
    q_list, _ = pipe.predict_quantiles(inputs=inputs, prediction_length=HORIZON, quantile_levels=QUANTILES)
    out = []
    for q in q_list:
        arr = q[0].detach().cpu().numpy()  # [horizon, 3]
        out.append((arr[:, 1], arr[:, 0], arr[:, 2]))
    return out


def main():
    series = eligible_series()
    by_type = defaultdict(int)
    for s in series:
        by_type[s["event_type"]] += 1
    print(f"eligible series: {len(series)} - {dict(by_type)}", flush=True)

    # Collect every (series, fold) once; run Chronos in a single batched call.
    jobs = []  # (event_type, context, actual)
    for s in series:
        for _origin, ctx, act in folds_for(s["counts"]):
            jobs.append((s["event_type"], ctx, act))
    print(f"backtest folds: {len(jobs)}", flush=True)

    pipe, torch = load_chronos()
    ch = chronos_batch(pipe, torch, [j[1] for j in jobs])

    # Accumulate pooled errors per (event_type, method).
    acc = defaultdict(lambda: {"abs": [], "sq": [], "sum_abs": 0.0, "sum_act": 0.0,
                               "cov_hit": 0, "cov_n": 0, "n_folds": 0})

    def add(et, method, pred, actual, lo=None, hi=None):
        a = acc[(et, method)]
        pred = np.asarray(pred, dtype=float); actual = np.asarray(actual, dtype=float)
        err = pred - actual
        a["abs"].extend(np.abs(err).tolist())
        a["sq"].extend((err ** 2).tolist())
        a["sum_abs"] += float(np.abs(err).sum())
        a["sum_act"] += float(np.abs(actual).sum())
        a["n_folds"] += 1
        if lo is not None:
            hit = np.logical_and(actual >= np.floor(lo), actual <= np.ceil(hi))
            a["cov_hit"] += int(hit.sum()); a["cov_n"] += int(hit.size)

    for (et, ctx, act), (med, p10, p90) in zip(jobs, ch):
        add(et, "chronos-2", med, act, p10, p90)
        for m in ("hist_mean", "seasonal_naive", "last_value"):
            b = baseline_forecast(m, ctx)
            if b is not None:
                add(et, m, b, act)

    # Build metrics per (event_type, method).
    def metrics(a):
        abs_arr = np.asarray(a["abs"]); sq = np.asarray(a["sq"])
        mae = float(abs_arr.mean()) if abs_arr.size else None
        rmse = float(np.sqrt(sq.mean())) if sq.size else None
        wape = float(a["sum_abs"] / a["sum_act"]) if a["sum_act"] > 0 else None
        cov = float(a["cov_hit"] / a["cov_n"]) if a["cov_n"] else None
        return {"MAE": mae, "RMSE": rmse, "WAPE": wape,
                "interval_coverage_p10_p90": cov, "n_folds": a["n_folds"]}

    event_types = sorted({et for (et, _m) in acc})
    report = {"config": {"horizon_weeks": HORIZON, "max_folds_per_series": MAX_FOLDS,
                         "min_series_len": MIN_SERIES_LEN, "season": SEASON,
                         "since": rf.SINCE, "note": "Real backtest on sparse weekly event-count series."},
              "by_event_type": {}}
    rows = []
    for et in event_types:
        report["by_event_type"][et] = {}
        for m in METHODS:
            if (et, m) in acc:
                mt = metrics(acc[(et, m)])
                report["by_event_type"][et][m] = mt
                rows.append({"event_type": et, "method": m, **{k: mt[k] for k in
                             ["MAE", "RMSE", "WAPE", "interval_coverage_p10_p90", "n_folds"]}})

    # best_configuration: lowest WAPE (fallback MAE) per event type.
    best = {}
    for et in event_types:
        cand = []
        for m in METHODS:
            mt = report["by_event_type"][et].get(m)
            if not mt:
                continue
            key = (mt["WAPE"] if mt["WAPE"] is not None else float("inf"),
                   mt["MAE"] if mt["MAE"] is not None else float("inf"))
            cand.append((key, m, mt))
        if cand:
            cand.sort(key=lambda x: x[0])
            (_, m, mt) = cand[0]
            chronos = report["by_event_type"][et].get("chronos-2", {})
            best[et] = {"best_method": m, "best_WAPE": mt["WAPE"], "best_MAE": mt["MAE"],
                        "chronos2_WAPE": chronos.get("WAPE"), "chronos2_MAE": chronos.get("MAE"),
                        "chronos2_is_best": m == "chronos-2"}

    with open(os.path.join(EVAL_DIR, "backtest_metrics.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    with open(os.path.join(EVAL_DIR, "model_comparison.csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["event_type", "method", "MAE", "RMSE", "WAPE",
                                          "interval_coverage_p10_p90", "n_folds"])
        w.writeheader(); w.writerows(rows)
    with open(os.path.join(EVAL_DIR, "best_configuration.json"), "w", encoding="utf-8") as f:
        json.dump({"criterion": "lowest WAPE then MAE, per event type", "best_per_event_type": best}, f,
                  ensure_ascii=False, indent=2)

    print("\n=== summary (WAPE - lower is better) ===", flush=True)
    for et in event_types:
        line = "  ".join(f"{m}:{(report['by_event_type'][et].get(m) or {}).get('WAPE')}" for m in METHODS)
        star = "  -> best: " + best[et]["best_method"] if et in best else ""
        print(f"{et:16} {line}{star}", flush=True)
    chr_best = sum(1 for et in best if best[et]["chronos2_is_best"])
    print(f"\nChronos-2 is best on {chr_best}/{len(best)} event types.", flush=True)
    print(f"WROTE {EVAL_DIR}/backtest_metrics.json, model_comparison.csv, best_configuration.json", flush=True)


if __name__ == "__main__":
    main()
