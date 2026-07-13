#!/usr/bin/env python3
"""
run_forecast.py — LOCAL zero-shot weekly forecasting with Amazon Chronos-2.

Reads the project's REAL harvested official archives (../dataset/cache/*.json:
USGS, EMSC, GDACS, NOAA/NCEI, WHO Disease Outbreak News), converts them into
weekly (country, event_type) event-count series, loads **Amazon Chronos-2**
LOCALLY (downloaded once into the local Hugging Face cache — no external
inference API, no server), forecasts the next 4 weeks per series, and writes the
predictions to a JSON file.

STRICT: there is NO statistical fallback. If Chronos-2 cannot load or run, the
script STOPS and prints the exact error. `model_used` is always "chronos-2".

What it forecasts: how MANY events of a type a country is likely to see per week,
from historical frequency. Not geographic spread.

Run:  forecasting/.venv/Scripts/python.exe run_forecast.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "dataset", "cache")
OUT_DIR = os.path.join(HERE, "output")
os.makedirs(OUT_DIR, exist_ok=True)
OUT_FILE = os.path.join(OUT_DIR, "forecasts.json")

MODEL_ID = "amazon/chronos-2"
HORIZON = 4                                             # forecast next 4 weeks
QUANTILES = [0.1, 0.5, 0.9]                             # lower / median / upper
SINCE = os.environ.get("SINCE", "2021-01-01")          # recent window → dense series
MIN_WEEKS = int(os.environ.get("MIN_WEEKS", "12"))     # need enough history
MAX_SERIES = int(os.environ.get("MAX_SERIES", "60"))   # cap CPU work

# ── Country canonicalization (never store a country label we can't verify) ───
_VARIANTS = {
    "usa": "United States", "us": "United States", "united states of america": "United States",
    "uk": "United Kingdom", "great britain": "United Kingdom", "russian federation": "Russia",
    "islamic republic of iran": "Iran", "republic of korea": "South Korea",
    "democratic people's republic of korea": "North Korea", "syrian arab republic": "Syria",
    "dr congo": "Democratic Republic of the Congo", "drc": "Democratic Republic of the Congo",
    "democratic republic of the congo": "Democratic Republic of the Congo",
    "the democratic republic of the congo": "Democratic Republic of the Congo",
    "republic of the congo": "Republic of the Congo", "united republic of tanzania": "Tanzania",
    "viet nam": "Vietnam", "lao people's democratic republic": "Laos", "czech republic": "Czechia",
    "cote d'ivoire": "Ivory Coast", "côte d'ivoire": "Ivory Coast", "turkiye": "Turkey",
    "türkiye": "Turkey", "burma": "Myanmar", "cabo verde": "Cape Verde",
    "bolivia (plurinational state of)": "Bolivia", "venezuela (bolivarian republic of)": "Venezuela",
    "united kingdom of great britain and northern ireland": "United Kingdom",
}
_COUNTRIES = [
    "Afghanistan","Albania","Algeria","Angola","Argentina","Armenia","Australia","Austria","Azerbaijan",
    "Bahamas","Bahrain","Bangladesh","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia",
    "Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia",
    "Cameroon","Canada","Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros",
    "Democratic Republic of the Congo","Republic of the Congo","Costa Rica","Croatia","Cuba","Cyprus",
    "Czechia","Denmark","Djibouti","Dominican Republic","Ecuador","Egypt","El Salvador","Eritrea","Estonia",
    "Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece",
    "Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia",
    "Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya",
    "Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya",
    "Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Mauritania",
    "Mauritius","Mexico","Micronesia","Moldova","Mongolia","Montenegro","Morocco","Mozambique","Myanmar",
    "Namibia","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea",
    "North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay",
    "Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Samoa","Saudi Arabia",
    "Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands",
    "Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden",
    "Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga",
    "Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Uganda","Ukraine","United Arab Emirates",
    "United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Yemen",
    "Zambia","Zimbabwe",
]
_CANON = {c.lower(): c for c in _COUNTRIES}
_US_STATES = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
    "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
    "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR",
}

def canon(name):
    if not name or not isinstance(name, str):
        return None
    k = re.sub(r"\s+", " ", name.strip().strip(".")).lower()
    if not k or k in ("global", "multi-locations", "multiple countries", "unknown", "n/a"):
        return None
    return _VARIANTS.get(k) or _CANON.get(k)

# ── Per-source event extraction → {country, event_type, date(YYYY-MM-DD)} ────
def _iso_from_ms(ms):
    try:
        ms = float(ms)
        if ms < 0:
            return None  # pre-1970 (Windows can't utcfromtimestamp negatives)
        return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")
    except Exception:
        return None

def _iso(s):
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(s))
    return m.group(0) if m else None

def _load(f):
    p = os.path.join(CACHE, f)
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

def _usgs_country(place):
    if not place:
        return None
    p = re.sub(r"^\d+\s?km\s+[NSEW]{1,3}\s+of\s+", "", place, flags=re.I)
    p = re.sub(r"^(near|off)( the coast of)?\s+", "", p, flags=re.I)
    parts = [x.strip() for x in p.split(",") if x.strip()]
    if not parts:
        return None
    tail = parts[-1]
    return canon(tail) or ("United States" if tail in _US_STATES else None)

def _who_country_disease(title):
    if not title:
        return None, None
    parts = re.split(r"\s[–—-]\s|,", title)
    disease = parts[0].strip() if parts else None
    tail = parts[-1].strip() if len(parts) > 1 else ""
    tail = re.split(r"&| and ", tail)[0].strip()
    return canon(tail), disease

GDACS_TYPE = {"EQ": "EARTHQUAKE", "FL": "FLOOD", "TC": "STORM", "VO": "VOLCANO",
              "WF": "WILDFIRE", "DR": "DROUGHT"}

def extract_events():
    events, per_source = [], defaultdict(int)

    for f, evt in (("usgs.json", "EARTHQUAKE"), ("emsc.json", "EARTHQUAKE")):
        for it in (_load(f) or []):
            p = it.get("properties", {})
            date = _iso_from_ms(p.get("time"))
            country = _usgs_country(p.get("place")) if f == "usgs.json" else _usgs_country(p.get("flynn_region"))
            if date and country:
                events.append({"country": country, "event_type": evt, "date": date}); per_source[f] += 1

    for it in (_load("gdacs.json") or []):
        p = it.get("properties", {})
        evt = GDACS_TYPE.get(p.get("eventtype"))
        date = _iso(p.get("fromdate"))
        country = canon((p.get("country") or "").split(",")[0])
        if evt and date and country:
            events.append({"country": country, "event_type": evt, "date": date}); per_source["gdacs.json"] += 1

    for it in (_load("who-don.json") or []):
        date = _iso(it.get("PublicationDate"))
        country, _disease = _who_country_disease(it.get("Title"))
        if date and country:
            events.append({"country": country, "event_type": "DISEASE_OUTBREAK", "date": date}); per_source["who-don.json"] += 1

    for f, evt in (("ncei-volcanoes.json", "VOLCANO"), ("ncei-tsunamis-events.json", "TSUNAMI")):
        for it in (_load(f) or []):
            y, mo, d = it.get("year"), it.get("month"), it.get("day")
            if not (isinstance(y, int) and isinstance(mo, int) and isinstance(d, int)):
                continue
            try:
                date = datetime(y, mo, d).strftime("%Y-%m-%d")
            except Exception:
                continue
            country = canon(it.get("country"))
            if country:
                events.append({"country": country, "event_type": evt, "date": date}); per_source[f] += 1

    return events, dict(per_source)

# ── Weekly (country, event_type) series, Monday-anchored, zero-filled ────────
def weekly_series(events, since):
    buckets = defaultdict(lambda: defaultdict(int))  # (country,type) -> {monday: count}
    for e in events:
        if e["date"] < since:
            continue
        dt = datetime.strptime(e["date"], "%Y-%m-%d")
        monday = dt - timedelta(days=dt.weekday())
        buckets[(e["country"], e["event_type"])][monday] += 1
    series = []
    for (country, etype), weeks in buckets.items():
        lo, hi = min(weeks), max(weeks)
        grid, cur = [], lo
        while cur <= hi:
            grid.append(cur); cur += timedelta(days=7)
        counts = [weeks.get(w, 0) for w in grid]
        series.append({
            "country": country, "event_type": etype,
            "dates": [w.strftime("%Y-%m-%d") for w in grid],
            "counts": counts, "total": sum(counts),
        })
    return series

def next_weeks(last_date, horizon):
    start = datetime.strptime(last_date, "%Y-%m-%d")
    return [(start + timedelta(weeks=i)).strftime("%Y-%m-%d") for i in range(1, horizon + 1)]

# ── Chronos-2 (LOCAL, no fallback) ──────────────────────────────────────────
def main():
    print(f"reading real archives from {CACHE}", flush=True)
    events, per_source = extract_events()
    print(f"extracted {len(events)} dated+located events: {per_source}", flush=True)

    series = weekly_series(events, SINCE)
    usable = [s for s in series if len(s["counts"]) >= MIN_WEEKS]
    usable.sort(key=lambda s: s["total"], reverse=True)
    selected = usable[:MAX_SERIES]
    print(f"{len(series)} series total; {len(usable)} with >= {MIN_WEEKS} weeks; "
          f"forecasting top {len(selected)} by activity", flush=True)
    if not selected:
        sys.exit("No series with enough history to forecast.")

    # Load Chronos-2 locally. NO try/except swallow — fail loud with the error.
    import torch
    from chronos import BaseChronosPipeline
    print(f"loading {MODEL_ID} locally (CPU)…", flush=True)
    pipe = BaseChronosPipeline.from_pretrained(MODEL_ID, device_map="cpu", torch_dtype=torch.float32)
    print(f"loaded {type(pipe).__name__}", flush=True)

    inputs = [torch.tensor(s["counts"], dtype=torch.float32) for s in selected]
    q_list, _mean = pipe.predict_quantiles(inputs=inputs, prediction_length=HORIZON, quantile_levels=QUANTILES)

    forecasts = []
    for s, q in zip(selected, q_list):
        # q shape: (n_variates=1, horizon, n_quantiles) -> drop variate dim.
        arr = q[0].detach().cpu().numpy()              # [horizon, 3] = lower/median/upper
        lower = np.clip(np.round(arr[:, 0]), 0, None).astype(int).tolist()
        median = np.clip(np.round(arr[:, 1]), 0, None).astype(int).tolist()
        upper = np.clip(np.round(arr[:, 2]), 0, None).astype(int).tolist()
        forecasts.append({
            "country": s["country"],
            "event_type": s["event_type"],
            "historical_dates": s["dates"],
            "historical_counts": s["counts"],
            "forecast_dates": next_weeks(s["dates"][-1], HORIZON),
            "predicted_counts": median,
            "lower_bound": lower,
            "upper_bound": upper,
            "horizon_weeks": HORIZON,
            "model_used": "chronos-2",
            "interpretation": ("Predicted future WEEKLY EVENT COUNTS from historical frequency. "
                               "Does not predict geographic spread or location."),
        })

    output = {
        "model_used": "chronos-2",
        "model_id": MODEL_ID,
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataset_source": os.path.relpath(CACHE, ROOT).replace("\\", "/"),
        "dataset_files": per_source,
        "window_since": SINCE,
        "horizon_weeks": HORIZON,
        "series_forecast": len(forecasts),
        "forecasts": forecasts,
    }
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"WROTE {len(forecasts)} forecasts -> {OUT_FILE}", flush=True)
    print("model_used = chronos-2 (no fallback)", flush=True)

if __name__ == "__main__":
    main()
