# Chronos-2 Forecasting — Scientific Evaluation Report

Local Amazon **Chronos-2** (zero-shot), CPU, no external API, no statistical
fallback. Target = weekly **event counts** per (country, event_type), built from
the project's real archives (USGS, EMSC, GDACS, NCEI, WHO-DON). Window since
2021-01-01.

## Headline (honest)

- **Chronos-2 beats all three naive baselines** on MAE + WAPE for **5 of 7**
  event types; on the two most sparse (tsunami, volcano) `last_value` ties it
  within ~0.4 %.
- **Prediction intervals are well-calibrated** (P10–P90 coverage 0.96–1.00).
- **Covariates did NOT help** — tested, improvement was 4th-decimal noise → the
  simpler **univariate** configuration is kept.
- **Fine-tuning was NOT performed: no GPU is available** (`torch.cuda.is_available()
  == False`, CPU-only build). Per the rule "fine-tune on GPU, not CPU", it is
  reported as blocked, not run. **Forecast accuracy therefore did not increase**
  over the original zero-shot model.
- What *did* improve: accuracy is now **measured and verified**, and every
  forecast carries a **traceable, deterministic explanation** (no LLM).

⚠️ **Do not over-read the forecasts.** WAPE ≈ 1.0 across every event type means
these are intrinsically low-rate, near-unpredictable series (most country-weeks
have zero events). Chronos-2 wins by **not over-predicting** (baselines carry
stale non-zero values into zero weeks). This is calibrated restraint, **not**
high predictive skill on rare events.

## Phase 1 — Rolling backtest vs baselines

Method: for each of 157 eligible series (≥16 weekly points), roll the origin back
in 4-week steps (≤3 folds), hide the next 4 weeks, forecast, score. 471 folds.
Baselines: historical mean, seasonal-naive (52w), last-value.

WAPE (lower is better) — full numbers in `model_comparison.csv`:

| event_type | chronos-2 | hist_mean | seasonal_naive | last_value | best |
|---|---|---|---|---|---|
| DISEASE_OUTBREAK | **1.005** | 1.151 | 1.164 | 1.149 | chronos-2 |
| EARTHQUAKE | **1.005** | 1.278 | 1.147 | 1.300 | chronos-2 |
| FLOOD | **1.002** | 1.181 | 1.111 | 1.100 | chronos-2 |
| STORM | **1.004** | 1.224 | 1.444 | 1.421 | chronos-2 |
| WILDFIRE | **1.002** | 1.144 | 1.100 | 1.154 | chronos-2 |
| TSUNAMI | 1.003 | 1.184 | 1.056 | **1.000** | last_value (≈tie) |
| VOLCANO | 1.004 | 1.273 | 1.250 | **1.000** | last_value (≈tie) |

MAE: Chronos-2 is lowest or tied-lowest for every type. Interval coverage
(P10–P90): 0.96–1.00. Files: `backtest_metrics.json`, `best_configuration.json`.

## Phase 2 & 3 — Covariate-informed vs univariate

Leakage-free, genuinely-available covariates: `roll4`, `roll8`, `trend` (past
covariates), `month` (known-future). Excluded and why (never invented):
historical rainfall/temperature (not in project data — only current weather),
mobility (absent), per-week disease cases/deaths (not reliably parseable from the
WHO-DON cache), GDACS severity/neighbor-count (source-specific, deferred).

Result (`covariate_decision.json`): covariates improved only 2/7 types (volcano,
wildfire) and only in the **4th decimal of WAPE** — noise. Decision: **keep
univariate** (best score, least complexity).

## Phase 4 — Fine-tuning: BLOCKED (no GPU)

`torch 2.13.0+cpu`, `cuda available: False`. The task requires GPU fine-tuning;
CPU fine-tuning is explicitly disallowed. Therefore:

- No fine-tuning was run. **The original `amazon/chronos-2` was not modified or
  overwritten. No fine-tuned model folder was created.**
- **Whether fine-tuning improves accuracy cannot be answered in this environment.**
  To run it on a CUDA machine: reinstall a CUDA torch build, prepare the
  chronological train/val/test split, fine-tune with early stopping tracking
  val loss, save to a *separate* folder (e.g. `forecasting/models/chronos2-ft/`),
  and re-run `evaluate.py` pointed at the fine-tuned weights over the **same**
  test folds — keeping it only if MAE **and** WAPE clearly improve.

## Phase 5 — Deterministic explanations

Every production forecast carries an `explanation_factors` object of measured
numbers (recent trend, % change last 4 weeks, vs previous-8-week average,
seasonality signal, interval width, forecast-vs-recent, and the covariate effect
on the forecast = the group-level ablation). AR + EN explanations are assembled
**only** from those values — no LLM. Text is reconciled so direction never
contradicts evidence (Chronos-2 mean-reverts sparse spikes, so a recent rise can
still yield a flat/lower 4-week outlook — the text says so explicitly).

## Did the "improved" model improve accuracy?

**No — forecast accuracy is unchanged.** No configuration beat univariate
zero-shot Chronos-2 (covariates rejected; fine-tuning blocked by hardware). The
concrete improvements are: (1) accuracy is now **objectively measured** and shown
to beat naive baselines, (2) intervals are shown **well-calibrated**, and (3)
each forecast is now **explainable from real numbers**. The forecasts remain
intrinsically modest because the underlying event-count series are sparse.

## Files

- `evaluation/backtest_metrics.json`, `model_comparison.csv`, `best_configuration.json`, `covariate_decision.json`
- `forecasting/output/improved_forecasts.json`, `forecast_explanations.json`
- Scripts: `forecasting/evaluate.py`, `evaluate_covariates.py`, `run_improved.py`

**Not integrated into the dashboard** — per instruction, the dashboard still uses
the prior `forecasts.json`; these evaluated outputs are held for review first.
