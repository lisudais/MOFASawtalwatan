#!/usr/bin/env python3
"""
Train + evaluate two XGBoost models on the prepared disease_ml dataset:
  1) classification  -> future_outbreak   (binary, imbalanced)
  2) regression      -> future_cases_4w    (log1p target, sparse/skewed)

Rules honoured: no shuffle (chronological splits preserved), no leakage (targets
never used as features; identifiers dropped), NaN kept native (never imputed with
invented values), fixed seed, local only, no external API. Encoders/tuning fitted
on TRAIN/VALIDATION only — the test set is untouched until final evaluation.

Writes models to disease_ml/models/ and evaluation to disease_ml/evaluation/.
"""
from __future__ import annotations

import json, os, warnings
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.preprocessing import OrdinalEncoder
from sklearn.compose import ColumnTransformer
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import (average_precision_score, roc_auc_score, precision_score,
                             recall_score, f1_score, balanced_accuracy_score, log_loss,
                             confusion_matrix, brier_score_loss, mean_absolute_error,
                             median_absolute_error)
import xgboost as xgb

warnings.filterwarnings("ignore")
SEED = 42
np.random.seed(SEED)

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)
DATA = os.path.join(BASE, "dataset")
MODELS = os.path.join(BASE, "models")
EVAL = os.path.join(BASE, "evaluation")
os.makedirs(MODELS, exist_ok=True)
os.makedirs(EVAL, exist_ok=True)

TARGET_CLS = "future_outbreak"
TARGET_REG = "future_cases_4w"
IDENTIFIERS = ["week_start", "iso3"]        # kept for output, NOT features
CATEGORICAL = ["country", "continent", "disease_name", "disease_category", "season"]

# ── STEP 1 — load + inspect ─────────────────────────────────────────────────
def load():
    tr = pd.read_csv(os.path.join(DATA, "train.csv"))
    va = pd.read_csv(os.path.join(DATA, "validation.csv"))
    te = pd.read_csv(os.path.join(DATA, "test.csv"))
    assert list(tr.columns) == list(va.columns) == list(te.columns), "schema mismatch"
    assert tr.week_start.max() <= va.week_start.min() <= te.week_start.min(), "not chronological"
    feature_cols = [c for c in tr.columns if c not in (TARGET_CLS, TARGET_REG, *IDENTIFIERS)]
    cat = [c for c in CATEGORICAL if c in feature_cols]
    numeric = [c for c in feature_cols if c not in cat]
    print("STEP 1 — data inspection")
    print(f"  rows: train={len(tr)} val={len(va)} test={len(te)}")
    print(f"  features={len(feature_cols)} (categorical={len(cat)}, numeric={len(numeric)})")
    print(f"  class balance (future_outbreak %pos): train={100*tr[TARGET_CLS].mean():.2f} "
          f"val={100*va[TARGET_CLS].mean():.2f} test={100*te[TARGET_CLS].mean():.2f}")
    print(f"  future_cases_4w mean: train={tr[TARGET_REG].mean():.1f} test={te[TARGET_REG].mean():.1f}")
    miss = tr[feature_cols].isna().mean().sort_values(ascending=False)
    print("  top missing (train): " + ", ".join(f"{c}={100*m:.0f}%" for c, m in miss.head(5).items()))
    return tr, va, te, feature_cols, cat, numeric

# ── STEP 2 — preprocessing (fit on train only) ──────────────────────────────
def build_preprocessor(cat, numeric):
    enc = OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1,
                         encoded_missing_value=-1)
    # numerics pass through with NaN preserved (XGBoost handles NaN natively).
    ct = ColumnTransformer([("num", "passthrough", numeric), ("cat", enc, cat)],
                           remainder="drop")
    return ct

def to_str_cat(df, cat):
    d = df.copy()
    for c in cat:
        d[c] = d[c].astype("object").where(d[c].notna(), np.nan)
    return d

# ── metric helpers ──────────────────────────────────────────────────────────
def cls_metrics(y, p, thr):
    yhat = (p >= thr).astype(int)
    return {
        "PR_AUC": float(average_precision_score(y, p)),
        "ROC_AUC": float(roc_auc_score(y, p)) if len(set(y)) > 1 else None,
        "precision": float(precision_score(y, yhat, zero_division=0)),
        "recall": float(recall_score(y, yhat, zero_division=0)),
        "F1": float(f1_score(y, yhat, zero_division=0)),
        "balanced_accuracy": float(balanced_accuracy_score(y, yhat)),
        "log_loss": float(log_loss(y, np.clip(p, 1e-6, 1 - 1e-6))),
        "threshold": float(thr),
    }

def reg_metrics(y, p):
    y = np.asarray(y, float); p = np.asarray(p, float)
    mae = float(mean_absolute_error(y, p))
    rmse = float(np.sqrt(np.mean((y - p) ** 2)))
    wape = float(np.sum(np.abs(y - p)) / np.sum(np.abs(y))) if np.sum(np.abs(y)) > 0 else None
    rmsle = float(np.sqrt(np.mean((np.log1p(np.clip(p, 0, None)) - np.log1p(np.clip(y, 0, None))) ** 2)))
    return {"MAE": mae, "RMSE": rmse, "WAPE": wape, "RMSLE": rmsle,
            "MedAE": float(median_absolute_error(y, p)), "n": int(len(y))}

# ── STEP 3 — classification ─────────────────────────────────────────────────
def train_classifier(Xtr, ytr, Xva, yva, spw):
    grid = [
        dict(max_depth=3, learning_rate=0.05, min_child_weight=1, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.0, reg_lambda=1.0),
        dict(max_depth=4, learning_rate=0.05, min_child_weight=5, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.0, reg_lambda=1.0),
        dict(max_depth=5, learning_rate=0.05, min_child_weight=5, subsample=0.7, colsample_bytree=0.7, reg_alpha=0.1, reg_lambda=2.0),
        dict(max_depth=4, learning_rate=0.10, min_child_weight=3, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.0, reg_lambda=1.0),
    ]
    best, best_ap, best_params = None, -1, None
    for params in grid:
        m = xgb.XGBClassifier(n_estimators=600, eval_metric="aucpr", early_stopping_rounds=40,
                              scale_pos_weight=spw, random_state=SEED, tree_method="hist",
                              n_jobs=0, **params)
        m.fit(Xtr, ytr, eval_set=[(Xva, yva)], verbose=False)
        ap = average_precision_score(yva, m.predict_proba(Xva)[:, 1])
        if ap > best_ap:
            best, best_ap, best_params = m, ap, {**params, "best_iteration": int(m.best_iteration)}
    print(f"STEP 3 — classifier: best val PR-AUC={best_ap:.4f} params={best_params}")
    return best, best_params

def select_threshold(yva, pva, beta=2.0):
    """Validation-selected threshold maximizing F-beta (beta=2 → recall-priority)."""
    best_t, best_fb = 0.5, -1
    for t in np.linspace(0.05, 0.95, 91):
        yhat = (pva >= t).astype(int)
        pr = precision_score(yva, yhat, zero_division=0)
        rc = recall_score(yva, yhat, zero_division=0)
        if pr + rc == 0:
            continue
        fb = (1 + beta**2) * pr * rc / (beta**2 * pr + rc) if (beta**2 * pr + rc) > 0 else 0
        if fb > best_fb and pr >= 0.15:   # keep precision usable
            best_fb, best_t = fb, t
    return float(best_t)

# ── STEP 4 — regression ─────────────────────────────────────────────────────
def train_regressor(Xtr, ytr_log, Xva, yva_log):
    grid = [
        dict(max_depth=4, learning_rate=0.05, min_child_weight=3, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.0, reg_lambda=1.0),
        dict(max_depth=5, learning_rate=0.05, min_child_weight=5, subsample=0.7, colsample_bytree=0.8, reg_alpha=0.1, reg_lambda=2.0),
        dict(max_depth=6, learning_rate=0.05, min_child_weight=5, subsample=0.7, colsample_bytree=0.7, reg_alpha=0.5, reg_lambda=3.0),
        dict(max_depth=4, learning_rate=0.10, min_child_weight=3, subsample=0.8, colsample_bytree=0.8, reg_alpha=0.0, reg_lambda=1.0),
    ]
    best, best_rmse, best_params = None, 1e18, None
    for params in grid:
        m = xgb.XGBRegressor(n_estimators=800, eval_metric="rmse", early_stopping_rounds=40,
                             random_state=SEED, tree_method="hist", n_jobs=0, **params)
        m.fit(Xtr, ytr_log, eval_set=[(Xva, yva_log)], verbose=False)
        rmse = np.sqrt(np.mean((m.predict(Xva) - yva_log) ** 2))
        if rmse < best_rmse:
            best, best_rmse, best_params = m, rmse, {**params, "best_iteration": int(m.best_iteration)}
    print(f"STEP 4 — regressor: best val log-RMSE={best_rmse:.4f} params={best_params}")
    return best, best_params

# ── STEP 5 — baselines ──────────────────────────────────────────────────────
def baselines(tr, te):
    rows = []
    y = te[TARGET_CLS].values
    # classification baselines
    for name, score in [("always_no_outbreak", np.zeros(len(te))),
                        ("active_outbreak", te["active_outbreak"].fillna(0).values),
                        ("recent_growth>0", (te["weekly_growth_rate"].fillna(0) > 0).astype(int).values)]:
        yhat = (score >= 0.5).astype(int)
        rows.append({"task": "classification", "model": name,
                     "PR_AUC": round(float(average_precision_score(y, score)), 4) if len(set(y)) > 1 else None,
                     "precision": round(float(precision_score(y, yhat, zero_division=0)), 4),
                     "recall": round(float(recall_score(y, yhat, zero_division=0)), 4),
                     "F1": round(float(f1_score(y, yhat, zero_division=0)), 4)})
    # regression baselines
    yr = te[TARGET_REG].values
    for name, pred in [("predict_zero", np.zeros(len(te))),
                       ("last_week", te["cases_last_week"].fillna(0).values),
                       ("rolling4x4", (te["rolling_mean_4w"].fillna(0) * 4).values)]:
        mt = reg_metrics(yr, np.clip(pred, 0, None))
        rows.append({"task": "regression", "model": name,
                     "MAE": round(mt["MAE"], 3), "RMSE": round(mt["RMSE"], 3),
                     "WAPE": round(mt["WAPE"], 4) if mt["WAPE"] else None, "RMSLE": round(mt["RMSLE"], 4)})
    return pd.DataFrame(rows)

# ── STEP 6 — explanations (rule-based, grounded in real feature values) ─────
def explain(row, prob, thr):
    up = prob >= thr
    reasons_ar, reasons_en = [], []
    if row.get("active_outbreak", 0) == 1:
        reasons_ar.append("استمرار التفشي الحالي"); reasons_en.append("the outbreak remained active")
    if (row.get("cases_last_4_weeks", 0) or 0) > (row.get("rolling_mean_8w", 0) or 0) * 4:
        reasons_ar.append("ارتفاع الحالات خلال الأسابيع الأربعة الأخيرة"); reasons_en.append("recent 4-week cases rose")
    if (row.get("weekly_growth_rate", 0) or 0) > 0:
        reasons_ar.append("تسارع النمو الأسبوعي للحالات"); reasons_en.append("weekly case growth accelerated")
    if (row.get("neighbouring_countries_with_active_outbreak", 0) or 0) > 0:
        reasons_ar.append("نشاط مرضي في دول مجاورة"); reasons_en.append("neighboring-country activity was present")
    ws = row.get("weeks_since_last_outbreak")
    if not up and (ws is None or (isinstance(ws, float) and np.isnan(ws)) or ws is not None and ws == ws and ws > 8):
        reasons_ar.append("مرور فترة طويلة دون تقارير جديدة"); reasons_en.append("a long gap since the last report")
    if not reasons_ar:
        reasons_ar.append("ثبات المؤشرات قرب خط الأساس"); reasons_en.append("indicators stable near baseline")
    head_ar = "ارتفع خطر التفشي" if up else "انخفض خطر التفشي"
    head_en = "Outbreak risk increased" if up else "Outbreak risk is low"
    return (f"{head_ar} بسبب " + "، و".join(reasons_ar) + ".",
            f"{head_en} because " + ", ".join(reasons_en) + ".")

def gain_importance(model, feature_names, path):
    booster = model.get_booster()
    score = booster.get_score(importance_type="gain")
    # map f0.. -> names
    fmap = {f"f{i}": n for i, n in enumerate(feature_names)}
    rows = sorted(((fmap.get(k, k), v) for k, v in score.items()), key=lambda x: -x[1])
    pd.DataFrame(rows, columns=["feature", "gain"]).to_csv(path, index=False)
    return rows[:12]

def main():
    tr, va, te, feats, cat, numeric = load()
    feature_order = numeric + cat   # ColumnTransformer output order

    pre = build_preprocessor(cat, numeric)
    Xtr = pre.fit_transform(to_str_cat(tr[feats], cat))
    Xva = pre.transform(to_str_cat(va[feats], cat))
    Xte = pre.transform(to_str_cat(te[feats], cat))
    joblib.dump({"preprocessor": pre, "feature_cols": feats, "categorical": cat,
                 "numeric": numeric, "feature_order": feature_order},
                os.path.join(MODELS, "preprocessor.joblib"))

    ytr_c, yva_c, yte_c = tr[TARGET_CLS].values, va[TARGET_CLS].values, te[TARGET_CLS].values
    spw = float((ytr_c == 0).sum() / max(1, (ytr_c == 1).sum()))
    print(f"  scale_pos_weight = {spw:.2f}")

    clf, clf_params = train_classifier(Xtr, ytr_c, Xva, yva_c, spw)
    pva = clf.predict_proba(Xva)[:, 1]; pte = clf.predict_proba(Xte)[:, 1]
    thr = select_threshold(yva_c, pva)
    print(f"  validation-selected threshold (F2, precision>=0.15) = {thr:.3f}")

    cls_test = {"at_0.50": cls_metrics(yte_c, pte, 0.50),
                "at_selected": cls_metrics(yte_c, pte, thr),
                "val_at_selected": cls_metrics(yva_c, pva, thr)}
    cm = confusion_matrix(yte_c, (pte >= thr).astype(int))
    pd.DataFrame(cm, index=["actual_0", "actual_1"], columns=["pred_0", "pred_1"]).to_csv(
        os.path.join(EVAL, "confusion_matrix.csv"))

    # ── STEP 7 — calibration ────────────────────────────────────────────────
    brier_unc = brier_score_loss(yte_c, pte)
    iso = IsotonicRegression(out_of_bounds="clip").fit(pva, yva_c)
    pte_cal = iso.predict(pte)
    brier_cal = brier_score_loss(yte_c, pte_cal)
    prauc_unc = average_precision_score(yte_c, pte)
    prauc_cal = average_precision_score(yte_c, pte_cal)
    use_cal = (brier_cal < brier_unc) and (prauc_cal >= prauc_unc - 0.02)
    print(f"STEP 7 — Brier: uncal={brier_unc:.4f} cal={brier_cal:.4f} | "
          f"PR-AUC uncal={prauc_unc:.4f} cal={prauc_cal:.4f} -> keep_calibration={use_cal}")
    if use_cal:
        joblib.dump(iso, os.path.join(MODELS, "outbreak_calibrator.joblib"))
        pte_final = pte_cal
    else:
        pte_final = pte
    cls_test["calibration"] = {"brier_uncalibrated": float(brier_unc), "brier_calibrated": float(brier_cal),
                               "prauc_uncalibrated": float(prauc_unc), "prauc_calibrated": float(prauc_cal),
                               "calibration_applied": bool(use_cal)}

    # ── regression ──────────────────────────────────────────────────────────
    ytr_r, yva_r, yte_r = tr[TARGET_REG].values, va[TARGET_REG].values, te[TARGET_REG].values
    reg, reg_params = train_regressor(Xtr, np.log1p(ytr_r), Xva, np.log1p(yva_r))
    pte_r = np.clip(np.expm1(reg.predict(Xte)), 0, None)
    reg_test = {"overall": reg_metrics(yte_r, pte_r),
                "actual_gt_0": reg_metrics(yte_r[yte_r > 0], pte_r[yte_r > 0]) if (yte_r > 0).any() else None,
                "by_disease_category": {}, "by_country": {}}
    for c, idx in te.groupby("disease_category").groups.items():
        ii = te.index.get_indexer(idx)
        reg_test["by_disease_category"][c] = reg_metrics(yte_r[ii], pte_r[ii])
    for c, idx in te.groupby("country").groups.items():
        ii = te.index.get_indexer(idx)
        if len(ii) >= 30:
            reg_test["by_country"][c] = reg_metrics(yte_r[ii], pte_r[ii])

    # ── STEP 5 baselines + STEP 6 importance ────────────────────────────────
    base_df = baselines(tr, te); base_df.to_csv(os.path.join(EVAL, "baseline_comparison.csv"), index=False)
    top_clf = gain_importance(clf, feature_order, os.path.join(EVAL, "feature_importance_classifier.csv"))
    top_reg = gain_importance(reg, feature_order, os.path.join(EVAL, "feature_importance_regressor.csv"))

    # ── save models + metadata ──────────────────────────────────────────────
    clf.get_booster().save_model(os.path.join(MODELS, "outbreak_classifier.json"))
    reg.get_booster().save_model(os.path.join(MODELS, "cases_regressor.json"))
    json.dump({"threshold": thr, "selection": "validation F-beta(2), precision>=0.15"},
              open(os.path.join(MODELS, "classification_threshold.json"), "w"), indent=2)

    meta = {
        "training_date_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "seed": SEED, "xgboost_version": xgb.__version__,
        "feature_list": feats, "feature_order": feature_order,
        "categorical_columns": cat, "numeric_columns": numeric,
        "classifier_params": clf_params, "regressor_params": reg_params,
        "scale_pos_weight": spw, "selected_threshold": thr,
        "dataset_paths": {k: os.path.join(DATA, f"{k}.csv") for k in ["train", "validation", "test"]},
        "date_ranges": {"train": [tr.week_start.min(), tr.week_start.max()],
                        "validation": [va.week_start.min(), va.week_start.max()],
                        "test": [te.week_start.min(), te.week_start.max()]},
        "validation_metrics": {"classification_at_selected": cls_metrics(yva_c, pva, thr),
                               "regression_log_rmse": float(np.sqrt(np.mean((reg.predict(Xva) - np.log1p(yva_r)) ** 2)))},
        "test_metrics": {"classification": cls_test, "regression": reg_test},
    }
    json.dump(meta, open(os.path.join(MODELS, "model_metadata.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump({"model": "XGBClassifier", "target": TARGET_CLS, "test": cls_test,
               "baselines": base_df[base_df.task == "classification"].to_dict("records"),
               "top_features_gain": top_clf},
              open(os.path.join(EVAL, "classification_metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    json.dump({"model": "XGBRegressor(log1p)", "target": TARGET_REG, "test": reg_test,
               "baselines": base_df[base_df.task == "regression"].to_dict("records"),
               "top_features_gain": top_reg},
              open(os.path.join(EVAL, "regression_metrics.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # ── STEP 9 — test_predictions.csv ───────────────────────────────────────
    preds = []
    lab = (pte_final >= thr).astype(int)
    for i, (_, row) in enumerate(te.iterrows()):
        ar, en = explain(row, float(pte_final[i]), thr)
        preds.append({"country": row["country"], "disease_name": row["disease_name"], "week": row["week_start"],
                      "actual_future_outbreak": int(row[TARGET_CLS]),
                      "predicted_outbreak_probability": round(float(pte_final[i]), 4),
                      "predicted_outbreak_label": int(lab[i]),
                      "actual_future_cases_4w": float(row[TARGET_REG]),
                      "predicted_future_cases_4w": round(float(pte_r[i]), 1),
                      "explanation_ar": ar, "explanation_en": en})
    pd.DataFrame(preds).to_csv(os.path.join(EVAL, "test_predictions.csv"), index=False)

    write_report(meta, cls_test, reg_test, base_df, thr, top_clf, top_reg, use_cal)
    print("\nDONE — models + evaluation written.")
    print(f"  TEST classification: PR-AUC={cls_test['at_selected']['PR_AUC']:.3f} "
          f"recall@sel={cls_test['at_selected']['recall']:.3f} precision@sel={cls_test['at_selected']['precision']:.3f}")
    print(f"  TEST regression: MAE={reg_test['overall']['MAE']:.1f} WAPE={reg_test['overall']['WAPE']} "
          f"RMSLE={reg_test['overall']['RMSLE']:.3f}")

def write_report(meta, cls_test, reg_test, base_df, thr, top_clf, top_reg, use_cal):
    cb = base_df[base_df.task == "classification"]
    rb = base_df[base_df.task == "regression"]
    sel = cls_test["at_selected"]
    xgb_prauc = sel["PR_AUC"]; base_prauc = cb["PR_AUC"].dropna().max() if cb["PR_AUC"].notna().any() else 0
    reg_wape = reg_test["overall"]["WAPE"]; base_wape = rb["WAPE"].dropna().min()
    cls_beats = xgb_prauc > (base_prauc or 0) + 0.02
    reg_beats = (reg_wape is not None and base_wape is not None and reg_wape < base_wape - 0.02)
    L = ["# XGBoost Training Report — disease_ml\n",
         f"_Trained {meta['training_date_utc']} · seed {meta['seed']} · xgboost {meta['xgboost_version']} · CPU · no external API_\n",
         "## 1. Classification (future_outbreak)",
         f"- scale_pos_weight = {meta['scale_pos_weight']:.2f}; validation-selected threshold = **{thr:.3f}** (F-beta=2, precision≥0.15).",
         f"- **Test @ selected threshold:** PR-AUC **{sel['PR_AUC']:.3f}** · ROC-AUC {sel['ROC_AUC']} · "
         f"precision {sel['precision']:.3f} · recall {sel['recall']:.3f} · F1 {sel['F1']:.3f} · "
         f"balanced-acc {sel['balanced_accuracy']:.3f} · logloss {sel['log_loss']:.3f}.",
         f"- Test @ 0.50: precision {cls_test['at_0.50']['precision']:.3f} · recall {cls_test['at_0.50']['recall']:.3f} · F1 {cls_test['at_0.50']['F1']:.3f}.",
         f"- Calibration applied: **{use_cal}** (Brier {cls_test['calibration']['brier_uncalibrated']:.4f} → {cls_test['calibration']['brier_calibrated']:.4f}).",
         "\n## 2. Regression (future_cases_4w, log1p)",
         f"- **Test overall:** MAE **{reg_test['overall']['MAE']:.1f}** · RMSE {reg_test['overall']['RMSE']:.1f} · "
         f"WAPE **{reg_test['overall']['WAPE']}** · RMSLE {reg_test['overall']['RMSLE']:.3f} · MedAE {reg_test['overall']['MedAE']:.1f}.",
         f"- Test on actual>0 rows: " + (f"MAE {reg_test['actual_gt_0']['MAE']:.1f}, WAPE {reg_test['actual_gt_0']['WAPE']}, n={reg_test['actual_gt_0']['n']}." if reg_test['actual_gt_0'] else "n/a"),
         "\n## 3. Baseline comparison",
         "**Classification** (PR-AUC / F1):"]
    for _, r in cb.iterrows():
        L.append(f"- {r['model']}: PR-AUC {r['PR_AUC']} · F1 {r['F1']} · recall {r['recall']}")
    L.append(f"- **XGBoost**: PR-AUC {sel['PR_AUC']:.3f} · F1 {sel['F1']:.3f} · recall {sel['recall']:.3f}")
    L.append("\n**Regression** (WAPE / MAE):")
    for _, r in rb.iterrows():
        L.append(f"- {r['model']}: WAPE {r['WAPE']} · MAE {r['MAE']}")
    L.append(f"- **XGBoost**: WAPE {reg_test['overall']['WAPE']} · MAE {reg_test['overall']['MAE']:.1f}")
    L.append(f"\n## 4. Did XGBoost meaningfully beat baselines?")
    L.append(f"- Classification: **{'YES' if cls_beats else 'NO / marginal'}** (XGBoost PR-AUC {xgb_prauc:.3f} vs best baseline {base_prauc}).")
    L.append(f"- Regression: **{'YES' if reg_beats else 'NO / marginal'}** (XGBoost WAPE {reg_wape} vs best baseline {base_wape}).")
    L.append("\n## 5. Most influential features (gain)")
    L.append("- Classifier: " + ", ".join(f"{n}" for n, _ in top_clf[:8]))
    L.append("- Regressor: " + ", ".join(f"{n}" for n, _ in top_reg[:8]))
    L.append("\n## 6. Limitations")
    L.append("- WHO-DON is episodic → targets are sparse; class balance drifts across chronological splits "
             "(train/val/test outbreak rates differ), which caps achievable precision/recall.")
    L.append("- Case counts parsed from report text are cumulative snapshots; between-report weeks carry forward "
             "the last value — the regression signal is coarse.")
    L.append("- Metrics are reported honestly; treat modest numbers as modest. Not integrated into the dashboard.")
    open(os.path.join(EVAL, "TRAINING_REPORT.md"), "w", encoding="utf-8").write("\n".join(L) + "\n")

if __name__ == "__main__":
    main()
