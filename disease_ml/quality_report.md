# Quality Report

- Rows: **13720** | duplicate rows: **0**
- future_outbreak positive rate: **11.42%** (1567 pos / 12153 neg) — imbalanced (use scale_pos_weight).
- future_cases_4w: min 0, median 0, mean 507.0, max 816658

## Missing values (%) — top columns
- regional_growth_rate: 80.91%
- current_case_fatality_rate: 39.11%
- current_deaths: 36.98%
- historical_peak_deaths: 36.98%
- current_cases: 20.34%
- historical_peak_cases: 20.34%
- population_density: 1.9%
- latitude: 1.81%
- longitude: 1.81%
- population: 0.39%
- continent: 0.28%
- regional_cases: 0.28%
- week_start: 0.0%
- week: 0.0%
- month: 0.0%

## |correlation| with future_cases_4w (top)
- weeks_since_last_outbreak: 0.158
- future_outbreak: 0.095
- longitude: 0.037
- population_density: 0.024
- year: 0.019
- active_outbreak: 0.017
- week: 0.015
- month: 0.014
- neighbouring_countries_with_active_outbreak: 0.012
- population: 0.01
- trend_direction: 0.009
- latitude: 0.007

## Outlier counts (IQR rule)
- current_cases: 1714
- future_cases_4w: 842
- cases_last_4_weeks: 2807
- regional_cases: 2676

_Missing values are genuine unknowns left as NaN for XGBoost — not imputed with invented values._
