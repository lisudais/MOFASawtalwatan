#!/usr/bin/env python3
"""
Phase 5 — production forecasts + deterministic, data-grounded explanations.

Uses the configuration chosen by the backtest (univariate Chronos-2 — covariates
were tested and rejected as non-improving; see evaluation/covariate_decision.json).
For every eligible (country, event_type) series it produces the real next-4-week
Chronos-2 forecast AND an `explanation_factors` object of numeric evidence, then
renders a concise Arabic + English explanation STRICTLY from those numbers.

No LLM is used to invent reasons. Every phrase maps to a computed value. Includes
a per-series covariate ABLATION: the forecast change from adding covariates
(covariate median vs univariate median) — the group-level "remove covariates"
diagnostic, consistent with the aggregate backtest.

Outputs:
  forecasting/output/improved_forecasts.json
  forecasting/output/forecast_explanations.json

Run:  forecasting/.venv/Scripts/python.exe run_improved.py
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

import run_forecast as rf
import evaluate as ev
from evaluate_covariates import covariates

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "output")
ROOT = os.path.dirname(HERE)
EVAL_DIR = os.path.join(ROOT, "evaluation")
HORIZON = 4
Q = [0.1, 0.5, 0.9]


def next_weeks(last_date, h):
    start = datetime.strptime(last_date, "%Y-%m-%d")
    return [(start + timedelta(weeks=i)).strftime("%Y-%m-%d") for i in range(1, h + 1)]


def explanation_factors(counts, dates, median, p10, p90, cov_median):
    """All numeric evidence — every value is measured from real history/forecast."""
    c = np.asarray(counts, dtype=float)
    last4 = c[-4:] if c.size >= 4 else c
    prev4 = c[-8:-4] if c.size >= 8 else np.array([])
    prev8 = c[-12:-4] if c.size >= 12 else (c[:-4] if c.size > 4 else np.array([]))
    last4_sum, prev4_sum = float(last4.sum()), float(prev4.sum())
    pct_change_last_4w = (round((last4_sum - prev4_sum) / prev4_sum * 100, 1)
                          if prev4_sum > 0 else (100.0 if last4_sum > 0 else 0.0))
    last4_mean = float(last4.mean()) if last4.size else 0.0
    prev8_mean = float(prev8.mean()) if prev8.size else 0.0
    vs_prev_8w_avg = round(last4_mean - prev8_mean, 3)
    roll4 = float(c[-4:].mean()) if c.size >= 1 else 0.0
    roll8 = float(c[-8:].mean()) if c.size >= 1 else 0.0
    recent_trend = "rising" if roll4 > roll8 + 1e-9 else "falling" if roll4 < roll8 - 1e-9 else "stable"

    # Seasonality: how the forecast months compare to the series' overall mean.
    months = np.array([pd.Timestamp(d).month for d in dates])
    overall_mean = float(c.mean()) if c.size else 0.0
    fut_months = [pd.Timestamp(d).month for d in next_weeks(dates[-1], HORIZON)]
    seas_levels = [float(c[months == m].mean()) if np.any(months == m) else overall_mean for m in fut_months]
    seasonality_signal = round((np.mean(seas_levels) - overall_mean), 3)

    med = np.asarray(median, dtype=float)
    interval_width = round(float(np.mean(np.asarray(p90, dtype=float) - np.asarray(p10, dtype=float))), 3)
    forecast_vs_recent = round(float(med.mean()) - last4_mean, 3)
    covariate_effect_on_forecast = round(float(np.mean(np.abs(np.asarray(cov_median, dtype=float) - med))), 3)

    return {
        "recent_trend": recent_trend,
        "last_4w_events": last4_sum,
        "prev_4w_events": prev4_sum,
        "pct_change_last_4w": pct_change_last_4w,
        "last_4w_mean": round(last4_mean, 3),
        "prev_8w_mean": round(prev8_mean, 3),
        "vs_prev_8w_avg": vs_prev_8w_avg,
        "seasonality_signal": seasonality_signal,
        "interval_width": interval_width,
        "forecast_mean": round(float(med.mean()), 3),
        "forecast_vs_recent": forecast_vs_recent,
        "covariate_effect_on_forecast": covariate_effect_on_forecast,
    }


def render_explanation(f):
    """Deterministic AR/EN text — assembled only from explanation_factors, and
    RECONCILED so the stated direction never contradicts the evidence (Chronos-2
    mean-reverts sparse spikes, so a recent rise can still yield a flat/lower
    forecast — the text must say so, not claim 'down because it rose')."""
    fv = f["forecast_vs_recent"]
    up, down = fv > 0.05, fv < -0.05
    rose, fell = f["pct_change_last_4w"] > 0, f["pct_change_last_4w"] < 0
    head_ar = "ارتفاع متوقّع" if up else "انخفاض متوقّع" if down else "استقرار متوقّع"
    head_en = "An expected increase" if up else "An expected decrease" if down else "An expected steady level"

    parts_ar, parts_en = [], []
    if up and rose:
        parts_ar.append(f"استمرار ارتفاع تكرار الأحداث (+{f['pct_change_last_4w']}% خلال ٤ أسابيع)")
        parts_en.append(f"continued rise in event frequency (+{f['pct_change_last_4w']}% over 4 weeks)")
    elif down and rose:
        parts_ar.append(f"توقّع انحسار الارتفاع الأخير: رغم ارتفاع التكرار +{f['pct_change_last_4w']}% يعود المتوسط نحو خط الأساس ({f['forecast_mean']})")
        parts_en.append(f"the recent spike is expected to subside — despite a +{f['pct_change_last_4w']}% rise, the 4-week outlook reverts toward baseline ({f['forecast_mean']})")
    elif down and fell:
        parts_ar.append(f"استمرار تراجع التكرار ({f['pct_change_last_4w']}% خلال ٤ أسابيع)")
        parts_en.append(f"a continued decline in frequency ({f['pct_change_last_4w']}% over 4 weeks)")
    elif up and fell:
        parts_ar.append(f"تعافٍ متوقّع بعد تراجع أخير ({f['pct_change_last_4w']}%)")
        parts_en.append(f"an expected rebound after a recent decline ({f['pct_change_last_4w']}%)")
    else:
        parts_ar.append(f"ثبات تكرار الأحداث قرب خط الأساس ({f['forecast_mean']})")
        parts_en.append(f"stable event frequency near baseline ({f['forecast_mean']})")

    if f["seasonality_signal"] > 0.05:
        parts_ar.append("وإشارة موسمية أعلى من المعدل في أشهر التوقّع")
        parts_en.append("and an above-average seasonal signal in the forecast months")
    elif f["seasonality_signal"] < -0.05:
        parts_ar.append("وإشارة موسمية أقل من المعدل في أشهر التوقّع")
        parts_en.append("and a below-average seasonal signal in the forecast months")

    tail_ar = f" مع عدم يقين {'مرتفع' if f['interval_width'] >= 2 else 'منخفض'} (عرض فترة التوقّع {f['interval_width']})."
    tail_en = f" Uncertainty is {'high' if f['interval_width'] >= 2 else 'low'} (interval width {f['interval_width']})."
    ar = f"{head_ar}: " + "؛ ".join(parts_ar) + "." + tail_ar
    en = f"{head_en}: " + "; ".join(parts_en) + "." + tail_en
    return ar, en


def main():
    series = ev.eligible_series()
    print(f"eligible series: {len(series)}", flush=True)

    import torch
    from chronos import BaseChronosPipeline
    print("loading amazon/chronos-2 locally (CPU)…", flush=True)
    pipe = BaseChronosPipeline.from_pretrained("amazon/chronos-2", device_map="cpu", torch_dtype=torch.float32)
    print(f"loaded {type(pipe).__name__}", flush=True)

    # Univariate production forecast (chosen config) — batched.
    inputs = [torch.tensor(s["counts"], dtype=torch.float32) for s in series]
    q_list, _ = pipe.predict_quantiles(inputs=inputs, prediction_length=HORIZON, quantile_levels=Q)
    uni = []
    for q in q_list:
        arr = q[0].detach().cpu().numpy()
        uni.append((np.clip(np.round(arr[:, 1]), 0, None).astype(int),
                    np.clip(np.round(arr[:, 0]), 0, None).astype(int),
                    np.clip(np.round(arr[:, 2]), 0, None).astype(int)))

    # Covariate forecast — ONLY to measure the ablation effect per series.
    df_rows, fut_rows = [], []
    for si, s in enumerate(series):
        roll4, roll8, trend, month = covariates(s["counts"], s["dates"])
        for k in range(len(s["counts"])):
            df_rows.append({"item_id": str(si), "timestamp": pd.Timestamp(s["dates"][k]),
                            "target": float(s["counts"][k]), "roll4": roll4[k], "roll8": roll8[k],
                            "trend": trend[k], "month": month[k]})
        for d in next_weeks(s["dates"][-1], HORIZON):
            fut_rows.append({"item_id": str(si), "timestamp": pd.Timestamp(d), "month": pd.Timestamp(d).month})
    cov_res = pipe.predict_df(pd.DataFrame(df_rows), future_df=pd.DataFrame(fut_rows),
                              prediction_length=HORIZON, quantile_levels=Q)
    cov_med = {iid: grp["0.5"].to_numpy()[:HORIZON] for iid, grp in cov_res.groupby("item_id", sort=False)}

    forecasts, explanations = [], []
    for si, s in enumerate(series):
        median, p10, p90 = uni[si]
        fdates = next_weeks(s["dates"][-1], HORIZON)
        factors = explanation_factors(s["counts"], s["dates"], median, p10, p90, cov_med.get(str(si), median))
        ar, en = render_explanation(factors)
        fid = f"{s['country']}|{s['event_type']}"
        rec = {
            "id": fid, "country": s["country"], "event_type": s["event_type"],
            "historical_dates": s["dates"][-12:], "historical_counts": s["counts"][-12:],
            "forecast_dates": fdates,
            "predicted_counts": median.tolist(), "lower_bound": p10.tolist(), "upper_bound": p90.tolist(),
            "horizon_weeks": HORIZON, "model_used": "chronos-2", "configuration": "univariate",
            "explanation_factors": factors,
            "explanation_ar": ar, "explanation_en": en,
        }
        forecasts.append(rec)
        explanations.append({"id": fid, "country": s["country"], "event_type": s["event_type"],
                             "explanation_ar": ar, "explanation_en": en, "explanation_factors": factors})

    cov_decision = json.load(open(os.path.join(EVAL_DIR, "covariate_decision.json"), encoding="utf-8"))
    meta = {
        "model_used": "chronos-2", "model_id": "amazon/chronos-2",
        "configuration": "univariate (covariates tested and rejected as non-improving)",
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "chosen_by": "backtest — see evaluation/best_configuration.json + covariate_decision.json",
        "covariate_ablation_summary": cov_decision["per_event_type"],
        "explanation_note": "Explanations are deterministic, built only from explanation_factors. No LLM.",
        "series_count": len(forecasts),
    }
    with open(os.path.join(OUT_DIR, "improved_forecasts.json"), "w", encoding="utf-8") as f:
        json.dump({**meta, "forecasts": forecasts}, f, ensure_ascii=False, indent=2)
    with open(os.path.join(OUT_DIR, "forecast_explanations.json"), "w", encoding="utf-8") as f:
        json.dump({**meta, "explanations": explanations}, f, ensure_ascii=False, indent=2)
    print(f"WROTE improved_forecasts.json + forecast_explanations.json ({len(forecasts)} series)", flush=True)
    ex = forecasts[0]
    print(f"\nsample [{ex['id']}]\n  AR: {ex['explanation_ar']}\n  EN: {ex['explanation_en']}", flush=True)


if __name__ == "__main__":
    main()
