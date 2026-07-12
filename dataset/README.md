# Historical Hazard & Outbreak Dataset — build pipeline

Builds an instruction fine-tuning dataset (Qwen2.5-Instruct chat format) for
analyzing **disease outbreaks** and **natural-hazard propagation**, entirely
from **trusted official sources**. Nothing is invented: any field a source does
not provide is emitted as `null`.

## Run

```bash
python build_dataset.py          # defaults below
```

Outputs to `out/`: `train.jsonl`, `validation.jsonl`, `test.jsonl`,
`dataset-report.md`. No pip dependencies (Python stdlib only).

### Config (env vars, optional)

| var | default | meaning |
|-----|---------|---------|
| `EMSC_MINMAG`      | `5.0`  | min earthquake magnitude |
| `EMSC_START_YEAR`  | `2000` | earliest EMSC year |
| `EMSC_CAP`         | `40000`| max EMSC records |
| `EONET_START_YEAR` | `2015` | earliest EONET year (EONET starts ~2015) |
| `EONET_CAP`        | `25000`| max EONET records |

Lower `EMSC_MINMAG` / `EMSC_START_YEAR` to grow the set ("largest possible");
raise them for a smaller, more significant-events-only set.

## Sources

**Live (keyless, harvested by default):**
- **EMSC** (seismicportal FDSN) — earthquakes, deep history, real Mw/depth/coords.
- **NASA EONET v3** — multi-hazard (wildfire, flood, storm, volcano, drought, ice…)
  with **multi-point dated timelines** → real geographic propagation.
- **ECDC** — official COVID-19 weekly national case/death series (EU/EEA), the
  disease-outbreak side: real weekly + cumulative cases/deaths and 14-day rates.

**Gated (wired but disabled — need an unrestricted network or an API key):**
USGS, GDACS, ReliefWeb v2 (needs an approved `appname`), WHO Disease Outbreak
News, CDC, NOAA, Copernicus EMS. Implement the `harvest_gated()` stub (return the
same record dict shape as the live adapters) and they flow through the identical
clean → dedup → split → validate → report path. Several are HTML-only and need a
scraper; ReliefWeb/ACLED need free API keys.

> Coverage note: in the build environment several US-hosted endpoints (USGS,
> GDACS, disease.sh) were unreachable and ReliefWeb requires registration, so the
> committed files contain the three live sources above. Disease coverage is
> therefore COVID-19 (ECDC) only — expand it by enabling the gated disease
> sources. Counts in `dataset-report.md` are real, never padded.

## Record schema (assistant output — fixed key order)

`event_type, event_name, hazard, disease, country, city, region, coordinates,
date, source, severity, magnitude, measure, depth_km, deaths, cases,
affected_population, affected_area, timeline, spread, neighboring_affected,
recommendations, summary`

- `severity` is derived **only** for earthquakes (Mw scale); other hazards → `null`.
- `magnitude` is seismic magnitude only; EONET's source-specific values live in
  `measure` `{value, unit}` (e.g. wind kts) or `affected_area` (acres/ha).
- `city` is `null` unless a genuine city is known — a country is **never** stored
  in `city`.
- `timeline` is a list of `{date, location}` observations (EONET propagation).

## Chat format

```json
{"messages":[
  {"role":"system","content":"You are an expert risk analysis assistant. Answer only using the available evidence."},
  {"role":"user","content":"Analyze the following historical event:\n<raw factual fields>"},
  {"role":"assistant","content":"<structured JSON, fixed schema>"}
]}
```

## Splitting

Chronological (not random): sorted by date, filled `train` → 75%, `validation`
→ 80%, `test` → 100%. Related event chains (`source|country|hazard|ISO-week`)
never cross a split boundary.

## Validation (enforced before write; failures repaired or dropped)

valid JSONL · identical fixed schema · no duplicate ids · no duplicate events ·
valid coordinates · `YYYY-MM-DD` dates · trusted sources only · clean UTF-8 ·
no HTML · no country-as-city · required fields present
(`event_type, date, source, summary`).
