#!/usr/bin/env python3
"""
Phase 2 + 3 — covariate-informed Chronos-2 vs univariate Chronos-2.

Adds time-varying covariates that are (a) genuinely available from the real
project data and (b) known BEFORE the forecast date (no leakage):
  past covariates  (df only):  roll4, roll8 (rolling means of the target),
                               trend (roll4 - roll8 momentum)
  known-future     (df+future): month (calendar month of the week)

Covariates listed in the brief that are NOT used, and why (never invented):
  - rainfall/temperature: no HISTORICAL weather in project data (only current).
  - mobility/travel indicators: not present in project data.
  - disease cases/deaths per week: not reliably parseable per-week from the WHO
    DON cache; excluded rather than fabricated.
  - severity / neighboring-country count: GDACS-only + per-week alignment;
    deferred (documented) — not applied uniformly, so excluded from this test.

Same rolling backtest folds as evaluate.py, so the comparison is apples-to-apples.
Appends "chronos-2-cov" rows to evaluation/model_comparison.csv and writes
evaluation/covariate_decision.json (does covariate help, per event type).

Run:  forecasting/.venv/Scripts/python.exe evaluate_covariates.py
"""
from __future__ import annotations

import csv
import json
import os
from collections import defaultdict

import numpy as np
import pandas as pd

import run_forecast as rf
import evaluate as ev

EVAL_DIR = ev.EVAL_DIR
HORIZON = ev.HORIZON


def folds_with_dates(s):
    dates, counts = s["dates"], s["counts"]
    out, origin = [], len(counts) - HORIZON
    while origin >= ev.MIN_CONTEXT and len(out) < ev.MAX_FOLDS:
        out.append((dates[:origin], counts[:origin], dates[origin:origin + HORIZON],
                    counts[origin:origin + HORIZON]))
        origin -= HORIZON
    return out


def covariates(ctx_counts, ctx_dates):
    """Past covariates for each context week — all strictly past-derived."""
    c = np.asarray(ctx_counts, dtype=float)
    roll4, roll8, trend = [], [], []
    for k in range(len(c)):
        r4 = float(c[max(0, k - 3):k + 1].mean())
        r8 = float(c[max(0, k - 7):k + 1].mean())
        roll4.append(r4); roll8.append(r8); trend.append(r4 - r8)
    month = [pd.Timestamp(d).month for d in ctx_dates]
    return roll4, roll8, trend, month


def main():
    series = ev.eligible_series()
    print(f"eligible series: {len(series)}", flush=True)

    df_rows, fut_rows, meta = [], [], {}  # meta[item_id] = (event_type, actual[4])
    for si, s in enumerate(series):
        for fi, (cd, cc, fd, fa) in enumerate(folds_with_dates(s)):
            iid = f"{si}#{fi}"
            meta[iid] = (s["event_type"], fa)
            roll4, roll8, trend, month = covariates(cc, cd)
            for k in range(len(cc)):
                df_rows.append({"item_id": iid, "timestamp": pd.Timestamp(cd[k]),
                                "target": float(cc[k]), "roll4": roll4[k], "roll8": roll8[k],
                                "trend": trend[k], "month": month[k]})
            for k in range(HORIZON):
                fut_rows.append({"item_id": iid, "timestamp": pd.Timestamp(fd[k]),
                                 "month": pd.Timestamp(fd[k]).month})
    df = pd.DataFrame(df_rows)
    future_df = pd.DataFrame(fut_rows)
    n_items = df["item_id"].nunique()
    print(f"covariate folds: {n_items} | df rows: {len(df)}", flush=True)

    import torch  # noqa: F401
    from chronos import BaseChronosPipeline
    print("loading amazon/chronos-2 locally (CPU)…", flush=True)
    pipe = BaseChronosPipeline.from_pretrained("amazon/chronos-2", device_map="cpu", torch_dtype="float32")
    print(f"loaded {type(pipe).__name__} — running covariate predict_df…", flush=True)

    res = pipe.predict_df(df, future_df=future_df, prediction_length=HORIZON,
                          quantile_levels=[0.1, 0.5, 0.9])

    # Parse predictions per item_id (rows are ordered per item, 4 each).
    acc = defaultdict(lambda: {"abs": [], "sq": [], "sum_abs": 0.0, "sum_act": 0.0,
                               "cov_hit": 0, "cov_n": 0, "n_folds": 0})
    for iid, grp in res.groupby("item_id", sort=False):
        et, actual = meta[iid]
        actual = np.asarray(actual, dtype=float)
        med = grp["0.5"].to_numpy()[:HORIZON]
        p10 = grp["0.1"].to_numpy()[:HORIZON]
        p90 = grp["0.9"].to_numpy()[:HORIZON]
        err = med - actual
        a = acc[et]
        a["abs"].extend(np.abs(err).tolist()); a["sq"].extend((err ** 2).tolist())
        a["sum_abs"] += float(np.abs(err).sum()); a["sum_act"] += float(np.abs(actual).sum())
        a["n_folds"] += 1
        hit = np.logical_and(actual >= np.floor(p10), actual <= np.ceil(p90))
        a["cov_hit"] += int(hit.sum()); a["cov_n"] += int(hit.size)

    def metrics(a):
        abs_arr = np.asarray(a["abs"]); sq = np.asarray(a["sq"])
        return {"MAE": float(abs_arr.mean()) if abs_arr.size else None,
                "RMSE": float(np.sqrt(sq.mean())) if sq.size else None,
                "WAPE": float(a["sum_abs"] / a["sum_act"]) if a["sum_act"] > 0 else None,
                "interval_coverage_p10_p90": float(a["cov_hit"] / a["cov_n"]) if a["cov_n"] else None,
                "n_folds": a["n_folds"]}

    cov_metrics = {et: metrics(acc[et]) for et in acc}

    # Compare to univariate Chronos from Phase 1.
    uni = json.load(open(os.path.join(EVAL_DIR, "backtest_metrics.json"), encoding="utf-8"))["by_event_type"]
    decision = {"covariates_used": ["roll4", "roll8", "trend", "month"], "per_event_type": {}}
    for et, cm in cov_metrics.items():
        um = uni.get(et, {}).get("chronos-2", {})
        improves = (cm["WAPE"] is not None and um.get("WAPE") is not None
                    and cm["WAPE"] < um["WAPE"] - 1e-9 and cm["MAE"] < um.get("MAE", 1e9) - 1e-9)
        decision["per_event_type"][et] = {
            "univariate": {"WAPE": um.get("WAPE"), "MAE": um.get("MAE")},
            "covariate": {"WAPE": cm["WAPE"], "MAE": cm["MAE"]},
            "covariate_improves": bool(improves),
            "chosen": "chronos-2-cov" if improves else "chronos-2",
        }

    # Append covariate rows to the comparison CSV.
    with open(os.path.join(EVAL_DIR, "model_comparison.csv"), "a", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        for et, cm in cov_metrics.items():
            w.writerow([et, "chronos-2-cov", cm["MAE"], cm["RMSE"], cm["WAPE"],
                        cm["interval_coverage_p10_p90"], cm["n_folds"]])
    with open(os.path.join(EVAL_DIR, "covariate_decision.json"), "w", encoding="utf-8") as f:
        json.dump(decision, f, ensure_ascii=False, indent=2)

    print("\n=== covariate vs univariate (WAPE) ===", flush=True)
    for et, d in decision["per_event_type"].items():
        print(f"{et:16} uni={d['univariate']['WAPE']}  cov={d['covariate']['WAPE']}  "
              f"-> {'COV helps' if d['covariate_improves'] else 'keep univariate'}", flush=True)
    n_improve = sum(1 for d in decision["per_event_type"].values() if d["covariate_improves"])
    print(f"\nCovariates improve {n_improve}/{len(decision['per_event_type'])} event types.", flush=True)
    print(f"WROTE {EVAL_DIR}/covariate_decision.json + appended model_comparison.csv", flush=True)


if __name__ == "__main__":
    main()
