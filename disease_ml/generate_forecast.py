#!/usr/bin/env python3
"""
Turn the VERIFIED local XGBoost outbreak CLASSIFIER into a forecasting product.

For the latest available epidemiological week of each (country, disease) series it
produces the calibrated probability of an outbreak in the next 4 weeks, plus a
risk level, trend, confidence, and deterministic Arabic/English explanations with
the numeric evidence behind them.

Uses ONLY: outbreak_classifier.json + preprocessor.joblib + outbreak_calibrator.joblib
+ classification_threshold.json. No regression model, no Chronos, no external API.

Output: disease_ml/output/outbreak_forecast.json
"""
from __future__ import annotations

import json, os
from collections import Counter
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "dataset")
MODELS = os.path.join(HERE, "models")
OUT_DIR = os.path.join(HERE, "output")
os.makedirs(OUT_DIR, exist_ok=True)

# Low-base-rate-aware DISPLAY bands (visual only — see the note below). These are
# tuned to a ~4.3% outbreak base rate so meaningful relative elevation is visible.
DISPLAY_BANDS = [(0.73, "Outbreak Alert"), (0.15, "High Monitoring"),
                 (0.05, "Elevated"), (0.02, "Low"), (0.0, "Very Low")]
DISPLAY_AR = {"Outbreak Alert": "إنذار تفشٍّ", "High Monitoring": "مراقبة عالية",
              "Elevated": "مرتفع نسبيًا", "Low": "منخفض", "Very Low": "منخفض جدًا"}
OFFICIAL_THRESHOLD = 0.73   # the official binary alert threshold — UNCHANGED


def display_band(p):
    for lo, name in DISPLAY_BANDS:
        if p >= lo:
            return name
    return "Very Low"


def base_rate_comparison(p, base_rate):
    ratio = p / base_rate if base_rate > 0 else 0.0
    pctp = round(p * 100)
    if ratio >= 1.5:
        n = round(ratio)
        return (f"الاحتمال المتوقع {pctp}%، أي نحو {n} أضعاف المعدل الأساسي التاريخي.",
                f"Forecast probability is {pctp}%, approximately {n}× the historical base rate.")
    if ratio >= 0.7:
        return (f"الاحتمال المتوقع {pctp}%، قريب من المعدل الأساسي التاريخي ({round(base_rate*100,1)}%).",
                f"Forecast probability is {pctp}%, near the historical base rate ({round(base_rate*100,1)}%).")
    return (f"الاحتمال المتوقع {pctp}%، أقل من المعدل الأساسي التاريخي ({round(base_rate*100,1)}%).",
            f"Forecast probability is {pctp}%, below the historical base rate ({round(base_rate*100,1)}%).")


def _months_between(d1, d2):
    from datetime import datetime as _dt
    return round((_dt.fromisoformat(d2) - _dt.fromisoformat(d1)).days / 30.44, 1)


def compute_history(g, pred_date):
    """Real epidemiological history for one (country, disease) series, from the
    dataset only. An 'outbreak' = a maximal run of active_outbreak weeks."""
    g = g.sort_values("week_start")
    act = g["active_outbreak"].fillna(0).astype(int).tolist()
    wks = g["week_start"].tolist()
    starts = [wks[i] for i in range(len(act)) if act[i] == 1 and (i == 0 or act[i - 1] != 1)]
    intervals = [_months_between(starts[i - 1], starts[i]) for i in range(1, len(starts))]
    five = f"{int(pred_date[:4]) - 5}{pred_date[4:]}"
    pk_c, pk_d = g["historical_peak_cases"].max(), g["historical_peak_deaths"].max()
    last = starts[-1] if starts else None
    return {
        "historical_outbreak_count": len(starts),
        "last_outbreak_date": last,
        "months_since_last_outbreak": _months_between(last, pred_date) if last else None,
        "outbreaks_last_5_years": sum(1 for d in starts if d >= five),
        "average_interval_months": round(sum(intervals) / len(intervals), 1) if intervals else None,
        "max_historical_cases": None if np.isnan(pk_c) else int(pk_c),
        "max_historical_deaths": None if np.isnan(pk_d) else int(pk_d),
        "timeline": starts[-8:],
    }


def main():
    pre = joblib.load(os.path.join(MODELS, "preprocessor.joblib"))
    clf = xgb.Booster(); clf.load_model(os.path.join(MODELS, "outbreak_classifier.json"))
    cal = joblib.load(os.path.join(MODELS, "outbreak_calibrator.joblib"))
    thr = json.load(open(os.path.join(MODELS, "classification_threshold.json")))["threshold"]
    feat_cols = pre["feature_cols"]; cat = pre["categorical"]

    # Exact stored test-set outbreak prevalence = the historical base rate.
    base_rate = float(pd.read_csv(os.path.join(DATA, "test.csv"))["future_outbreak"].mean())

    df = pd.concat([pd.read_csv(os.path.join(DATA, f"{s}.csv")) for s in ("train", "validation", "test")],
                   ignore_index=True)
    df = df.sort_values("week_start")
    latest = df.groupby(["country", "disease_name"], as_index=False).tail(1).reset_index(drop=True)

    # seasonal reference: the season with the most historical activity per category
    active = df[(df["active_outbreak"] == 1)]
    cat_season = {c: Counter(g["season"].dropna()).most_common(1)[0][0]
                  for c, g in active.groupby("disease_category") if len(g)}

    # ── real historical/regional reference (from the dataset + geojson borders) ──
    import build_ml_dataset as bm
    from datetime import datetime as _dt, timedelta as _td
    hist_groups = {k: g for k, g in df.groupby(["country", "disease_name"])}
    series_rate = df.groupby(["country", "disease_name"])["future_outbreak"].mean().to_dict()
    series_n = df.groupby(["country", "disease_name"]).size().to_dict()
    # Latest GENUINELY-OBSERVED source date = the newest WHO-DON report publication
    # date that is <= today. NOT df["week_start"].max(), which is a synthetic
    # zero-filled grid week extending up to TRAIL_WEEKS past the last real report.
    import re as _re
    from datetime import date as _date, timedelta as _tdelta
    _today = datetime.now(timezone.utc).date()
    _who_dates = []
    for _r in json.load(open(os.path.join(bm.CACHE, "who-don.json"), encoding="utf-8")):
        _d = (_r.get("PublicationDate") or "")[:10]
        if _re.match(r"\d{4}-\d{2}-\d{2}", _d):
            try:
                if _date.fromisoformat(_d) <= _today:
                    _who_dates.append(_d)
            except ValueError:
                pass
    source_last = max(_who_dates) if _who_dates else None
    dataset_last_update = source_last                              # real, <= today
    prediction_generation_date = _today.isoformat()
    forecast_period_start = (_date.fromisoformat(source_last) + _tdelta(weeks=1)).isoformat() if source_last else None
    forecast_period_end = (_date.fromisoformat(source_last) + _tdelta(weeks=4)).isoformat() if source_last else None
    name2iso2 = {cn: bm.resolve_iso2(cn) for cn in df["country"].unique()}
    _geo, adjacency = bm.load_geo()
    active_weeks = {}
    for _, r in df[df["active_outbreak"] == 1].iterrows():
        i2 = name2iso2.get(r["country"])
        if i2:
            active_weeks.setdefault(i2, []).append(r["week_start"])
    mm = json.load(open(os.path.join(MODELS, "model_metadata.json"), encoding="utf-8"))
    _cal_method = mm.get("calibration_method", "none")
    _cal_label = {
        "platt": "معايرة Platt (سيغمويد) على مجموعة التحقق",
        "isotonic": "معايرة أيزوتونية على مجموعة التحقق",
        "none": "غير معاير",
    }.get(_cal_method, "غير معاير")
    model_info = {
        "model_name": "XGBoost Outbreak Classifier",
        "prediction_type": "احتمال معاير لحدوث تفشٍّ خلال 4 أسابيع (تصنيف ثنائي معاير)",
        "prediction_type_en": "Calibrated probability of an outbreak within 4 weeks (calibrated binary classification)",
        "calibration": _cal_label,
        "training_date": mm.get("training_date_utc"),
        "model_version": f"XGBoost {mm.get('xgboost_version', '')}".strip(),
    }

    X = latest[feat_cols].copy()
    for c in cat:
        X[c] = X[c].astype("object").where(X[c].notna(), np.nan)
    Xt = pre["preprocessor"].transform(X)
    raw = clf.predict(xgb.DMatrix(Xt))
    prob = cal.predict(raw)

    completeness = latest[feat_cols].notna().mean(axis=1).values

    records = []
    for i, row in latest.iterrows():
        p = float(prob[i])
        band = display_band(p)
        ratio = p / base_rate if base_rate > 0 else 0.0
        cmp_ar, cmp_en = base_rate_comparison(p, base_rate)
        td = row.get("trend_direction")
        trend = "Increasing" if td == 1 else "Decreasing" if td == -1 else "Stable"
        # confidence: probability extremeness + feature completeness + historical support + (good) calibration
        support = 1.0 if (pd.notna(row.get("weeks_since_last_outbreak")) and pd.notna(row.get("historical_peak_cases"))) else 0.4
        score = 0.35 * float(completeness[i]) + 0.25 * support + 0.20 * abs(p - 0.5) * 2 + 0.20 * 0.85
        confidence = "High" if score >= 0.70 else "Medium" if score >= 0.50 else "Low"

        wsl = row.get("weeks_since_last_outbreak")
        g_r = row.get("weekly_growth_rate")
        r4 = row.get("rolling_mean_4w"); r8 = row.get("rolling_mean_8w")
        nb = row.get("neighbouring_countries_with_active_outbreak")
        reg = row.get("regional_cases")
        pk_d = row.get("historical_peak_deaths")
        seas = row.get("season")
        seasonal_match = bool(cat_season.get(row.get("disease_category")) == seas)

        factors = {
            "weeks_since_last_outbreak": None if pd.isna(wsl) else float(wsl),
            "season": seas, "seasonal_match": seasonal_match,
            "historical_peak_deaths": None if pd.isna(pk_d) else float(pk_d),
            "disease_category": row.get("disease_category"),
            "recent_growth_rate": None if pd.isna(g_r) else float(g_r),
            "rolling_mean_4w": None if pd.isna(r4) else float(r4),
            "rolling_mean_8w": None if pd.isna(r8) else float(r8),
            "neighbouring_active": None if pd.isna(nb) else int(nb),
            "regional_cases": None if pd.isna(reg) else float(reg),
            "active_outbreak": int(row.get("active_outbreak") or 0),
            "feature_completeness": round(float(completeness[i]), 3),
            "calibrated_probability": round(p, 4),
        }

        # ── real epidemiological history + regional situation ──────────────
        ck = (row["country"], row["disease_name"])
        pred_date = row["week_start"]
        history = compute_history(hist_groups[ck], pred_date)
        sr, sn = series_rate.get(ck, 0.0), series_n.get(ck, 0)
        # how many times above this country+disease's own historical outbreak rate
        hist_ratio = round(p / sr) if (sr > 0 and sn >= 8) else None
        iso2 = name2iso2.get(row["country"])
        iso3 = bm.iso2_to_iso3(iso2) if iso2 else None
        neigh_names, affected = [], 0
        if iso3:
            lo_date = (_dt.fromisoformat(pred_date) - _td(weeks=26)).strftime("%Y-%m-%d")
            for n3 in adjacency.get(iso3, set()):
                try:
                    ci = __import__("pycountry").countries.get(alpha_3=n3)
                    if not ci:
                        continue
                    neigh_names.append(ci.name)
                    if any(lo_date <= w <= pred_date for w in active_weeks.get(ci.alpha_2, [])):
                        affected += 1
                except Exception:
                    continue
        regional = {
            "neighbouring_countries": sorted(neigh_names) or None,
            "neighbouring_count": len(neigh_names),
            "affected_neighbours_recent": affected,
            "neighbouring_active_now": None if pd.isna(nb) else int(nb),
            "regional_cases": None if pd.isna(reg) else float(reg),
        }

        # deterministic explanation from real values
        up = p >= 0.40
        ar, en = [], []
        if pd.notna(wsl) and wsl <= 6:
            ar.append("قصر الفترة منذ آخر تفشٍ"); en.append("the previous outbreak occurred recently")
        elif pd.notna(wsl) and wsl > 12:
            ar.append("طول الفترة منذ آخر تفشٍ"); en.append("a long time has passed since the last outbreak")
        if seasonal_match:
            ar.append("وجود نمط موسمي مشابه"); en.append("seasonal patterns are favorable")
        if (r4 or 0) > (r8 or 0):
            ar.append("ارتفاع الحالات في الأسابيع الأخيرة"); en.append("recent cases rose")
        if (nb or 0) > 0 or (reg or 0) > 0:
            ar.append("ارتفاع النشاط المرضي في المنطقة"); en.append("regional outbreak activity remains elevated")
        if pd.notna(pk_d) and pk_d and pk_d > 0:
            ar.append(f"سوابق وفيات مرتفعة (ذروة {int(pk_d)})"); en.append(f"a history of high fatalities (peak {int(pk_d)})")
        if not ar:
            ar.append("ثبات المؤشرات قرب خط الأساس"); en.append("indicators are stable near baseline")
        head_ar = "ارتفع احتمال التفشي" if up else "انخفض احتمال التفشي"
        head_en = "Outbreak probability increased" if up else "Outbreak probability is low"

        records.append({
            "country": row["country"], "disease": row["disease_name"],
            "disease_category": row.get("disease_category"),
            "prediction_date": row["week_start"], "forecast_horizon": "4 weeks",
            # explicitly FORECAST (future) dates — the 4 weeks after the anchor.
            "forecast_period_start": (_dt.fromisoformat(pred_date) + _td(weeks=1)).strftime("%Y-%m-%d"),
            "forecast_period_end": (_dt.fromisoformat(pred_date) + _td(weeks=4)).strftime("%Y-%m-%d"),
            "prediction_generation_date": prediction_generation_date,
            "probability": round(p, 4),
            # DISPLAY level (base-rate aware) — visual only, kept separate from the
            # official binary decision below. Probabilities are NOT rescaled.
            "display_risk_level": band, "display_risk_level_ar": DISPLAY_AR[band],
            # Official model decision — unchanged 0.73 threshold, kept separate.
            "official_alert": bool(p >= OFFICIAL_THRESHOLD), "official_threshold": OFFICIAL_THRESHOLD,
            "base_rate": round(base_rate, 5),
            "probability_vs_base_rate_ratio": round(ratio, 2),
            "absolute_risk_difference_from_base_rate": round(p - base_rate, 5),
            "base_rate_comparison_ar": cmp_ar, "base_rate_comparison_en": cmp_en,
            "country_disease_base_rate": round(sr, 4) if sn >= 8 else None,
            "historical_comparison_ratio": hist_ratio,
            "trend": trend, "confidence": confidence,
            "model_used": "XGBoost Outbreak Classifier",
            "explanation_ar": f"{head_ar} بسبب " + "، و".join(ar) + ".",
            "explanation_en": f"{head_en} because " + ", ".join(en) + ".",
            "explanation_factors": factors,
            "history": history, "regional": regional,
        })

    records.sort(key=lambda r: r["probability"], reverse=True)
    out = {
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "model_used": "XGBoost Outbreak Classifier", "forecast_horizon": "4 weeks",
        "official_threshold": OFFICIAL_THRESHOLD, "calibrated": True,
        "base_rate": round(base_rate, 5), "base_rate_source": "test-set outbreak prevalence",
        "dataset_last_update": dataset_last_update,
        "source_data_last_observed_date": source_last,
        "prediction_generation_date": prediction_generation_date,
        "forecast_period_start": forecast_period_start,
        "forecast_period_end": forecast_period_end,
        "historical_data_source": "WHO Disease Outbreak News",
        "model_info": model_info,
        "display_note_ar": "مستويات العرض تراعي انخفاض المعدل الأساسي للتفشيات، بينما يبقى حد الإنذار الرسمي عند 73%.",
        "display_note_en": "Display levels account for the low historical outbreak base rate; the official alert threshold remains 73%.",
        "count": len(records), "forecasts": records,
    }
    json.dump(out, open(os.path.join(OUT_DIR, "outbreak_forecast.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    # console summary
    probs = [r["probability"] for r in records]
    print(f"forecasts: {len(records)} | countries: {len({r['country'] for r in records})} | "
          f"diseases: {len({r['disease'] for r in records})} | avg prob: {np.mean(probs):.3f}")
    by_country = {}
    for r in records:
        by_country[r["country"]] = max(by_country.get(r["country"], 0), r["probability"])
    print("highest-risk countries:", sorted(by_country.items(), key=lambda x: -x[1])[:5])
    by_disease = {}
    for r in records:
        by_disease[r["disease"]] = max(by_disease.get(r["disease"], 0), r["probability"])
    print("highest-risk diseases:", sorted(by_disease.items(), key=lambda x: -x[1])[:5])
    print(f"base_rate: {base_rate:.5f}")
    print("display band distribution:", dict(Counter(r["display_risk_level"] for r in records)))
    print("prob>=0.05 (markers):", sum(1 for r in records if r["probability"] >= 0.05))
    print("official alerts (>=0.73):", sum(1 for r in records if r["official_alert"]))
    print("=== TOP 10 by probability ===")
    for r in records[:10]:
        print(f"  {r['country']:22} {r['disease']:32} p={r['probability']:.3f} "
              f"({r['probability_vs_base_rate_ratio']}x) [{r['display_risk_level']}]")
    print(f"WROTE {os.path.join(OUT_DIR, 'outbreak_forecast.json')}")


if __name__ == "__main__":
    main()
