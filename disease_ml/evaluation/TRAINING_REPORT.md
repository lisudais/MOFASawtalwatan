# XGBoost Training Report — disease_ml

_Trained 2026-07-13T10:23:34Z · seed 42 · xgboost 3.3.0 · CPU · no external API_

## 1. Classification (future_outbreak)
- scale_pos_weight = 7.78; validation-selected threshold = **0.730** (F-beta=2, precision≥0.15).
- **Test @ selected threshold:** PR-AUC **0.702** · ROC-AUC 0.8239110710393116 · precision 0.702 · recall 0.663 · F1 0.682 · balanced-acc 0.825 · logloss 0.241.
- Test @ 0.50: precision 0.324 · recall 0.685 · F1 0.440.
- Calibration applied: **True** (Brier 0.0655 → 0.0188).

## 2. Regression (future_cases_4w, log1p)
- **Test overall:** MAE **115.6** · RMSE 2118.0 · WAPE **1.0012887160540411** · RMSLE 0.714 · MedAE 0.2.
- Test on actual>0 rows: MAE 6410.9, WAPE 0.998485482819771, n=37.

## 3. Baseline comparison
**Classification** (PR-AUC / F1):
- always_no_outbreak: PR-AUC 0.0432 · F1 0.0 · recall 0.0
- active_outbreak: PR-AUC 0.0405 · F1 0.0516 · recall 0.2022
- recent_growth>0: PR-AUC 0.044 · F1 0.0562 · recall 0.0562
- **XGBoost**: PR-AUC 0.702 · F1 0.682 · recall 0.663

**Regression** (WAPE / MAE):
- predict_zero: WAPE 1.0 · MAE 115.434
- last_week: WAPE 7.0474 · MAE 813.516
- rolling4x4: WAPE 47.2169 · MAE 5450.453
- **XGBoost**: WAPE 1.0012887160540411 · MAE 115.6

## 4. Did XGBoost meaningfully beat baselines?
- Classification: **YES** (XGBoost PR-AUC 0.702 vs best baseline 0.044).
- Regression: **NO / marginal** (XGBoost WAPE 1.0012887160540411 vs best baseline 1.0).

## 5. Most influential features (gain)
- Classifier: weeks_since_last_outbreak, year, historical_peak_deaths, season, disease_category, longitude, continent, month
- Regressor: weeks_since_last_outbreak, disease_category, country, historical_peak_deaths, rolling_std_4w, population, population_density, current_cases

## 6. Limitations
- WHO-DON is episodic → targets are sparse; class balance drifts across chronological splits (train/val/test outbreak rates differ), which caps achievable precision/recall.
- Case counts parsed from report text are cumulative snapshots; between-report weeks carry forward the last value — the regression signal is coarse.
- Metrics are reported honestly; treat modest numbers as modest. Not integrated into the dashboard.
