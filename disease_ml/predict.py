#!/usr/bin/env python3
"""
Local inference for the disease_ml XGBoost models. No external API, no fabricated
values — if required feature columns are missing it raises a clear error rather
than silently filling them.

Usage:
  python predict.py --input path/to/features.csv [--out-prefix path/to/output]

Outputs <prefix>.json and <prefix>.csv with, per row:
  outbreak_probability, outbreak_label, predicted_future_cases_4w,
  explanation_ar, explanation_en.
"""
from __future__ import annotations

import argparse, json, os, sys

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb

HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "models")


def load_artifacts():
    need = ["preprocessor.joblib", "outbreak_classifier.json", "cases_regressor.json",
            "classification_threshold.json", "model_metadata.json"]
    for f in need:
        if not os.path.exists(os.path.join(MODELS, f)):
            sys.exit(f"ERROR: missing model artifact {os.path.join(MODELS, f)} — run training/train.py first.")
    pre = joblib.load(os.path.join(MODELS, "preprocessor.joblib"))
    clf = xgb.Booster(); clf.load_model(os.path.join(MODELS, "outbreak_classifier.json"))
    reg = xgb.Booster(); reg.load_model(os.path.join(MODELS, "cases_regressor.json"))
    thr = json.load(open(os.path.join(MODELS, "classification_threshold.json")))["threshold"]
    cal_path = os.path.join(MODELS, "outbreak_calibrator.joblib")
    cal = joblib.load(cal_path) if os.path.exists(cal_path) else None
    return pre, clf, reg, thr, cal


def explain(row, prob, thr):
    up = prob >= thr
    ar, en = [], []
    if row.get("active_outbreak", 0) == 1:
        ar.append("استمرار التفشي الحالي"); en.append("the outbreak remained active")
    if (row.get("cases_last_4_weeks", 0) or 0) > (row.get("rolling_mean_8w", 0) or 0) * 4:
        ar.append("ارتفاع الحالات خلال الأسابيع الأربعة الأخيرة"); en.append("recent 4-week cases rose")
    if (row.get("weekly_growth_rate", 0) or 0) > 0:
        ar.append("تسارع النمو الأسبوعي للحالات"); en.append("weekly case growth accelerated")
    if (row.get("neighbouring_countries_with_active_outbreak", 0) or 0) > 0:
        ar.append("نشاط مرضي في دول مجاورة"); en.append("neighboring-country activity was present")
    if not ar:
        ar.append("ثبات المؤشرات قرب خط الأساس"); en.append("indicators stable near baseline")
    head_ar = "ارتفع خطر التفشي" if up else "انخفض خطر التفشي"
    head_en = "Outbreak risk increased" if up else "Outbreak risk is low"
    return f"{head_ar} بسبب " + "، و".join(ar) + ".", f"{head_en} because " + ", ".join(en) + "."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--out-prefix", default=os.path.join(HERE, "evaluation", "inference_output"))
    args = ap.parse_args()
    if not os.path.exists(args.input):
        sys.exit(f"ERROR: input file not found: {args.input}")

    pre, clf, reg, thr, cal = load_artifacts()
    feat_cols = pre["feature_cols"]; cat = pre["categorical"]
    df = pd.read_csv(args.input)

    missing = [c for c in feat_cols if c not in df.columns]
    if missing:
        sys.exit(f"ERROR: input is missing {len(missing)} required feature column(s): {missing}\n"
                 f"       (no values are fabricated — provide the columns, NaN is allowed for unknowns.)")

    X = df[feat_cols].copy()
    for c in cat:
        X[c] = X[c].astype("object").where(X[c].notna(), np.nan)
    Xt = pre["preprocessor"].transform(X)

    prob = clf.predict(xgb.DMatrix(Xt))
    if cal is not None:
        prob = cal.predict(prob)
    label = (prob >= thr).astype(int)
    cases = np.clip(np.expm1(reg.predict(xgb.DMatrix(Xt))), 0, None)

    out = []
    for i, (_, row) in enumerate(df.iterrows()):
        ar, en = explain(row, float(prob[i]), thr)
        out.append({
            "country": row.get("country"), "disease_name": row.get("disease_name"),
            "week": row.get("week_start"),
            "outbreak_probability": round(float(prob[i]), 4),
            "outbreak_label": int(label[i]),
            "predicted_future_cases_4w": round(float(cases[i]), 1),
            "explanation_ar": ar, "explanation_en": en,
        })
    os.makedirs(os.path.dirname(args.out_prefix), exist_ok=True)
    pd.DataFrame(out).to_csv(args.out_prefix + ".csv", index=False)
    json.dump({"threshold": thr, "calibrated": cal is not None, "predictions": out},
              open(args.out_prefix + ".json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    neg = sum(1 for o in out if o["predicted_future_cases_4w"] < 0)
    print(f"wrote {len(out)} predictions -> {args.out_prefix}.json/.csv "
          f"(threshold {thr:.3f}, calibrated={cal is not None}, negative_case_preds={neg})")


if __name__ == "__main__":
    main()
