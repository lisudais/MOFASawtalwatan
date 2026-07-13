#!/usr/bin/env python3
"""
Build a tabular XGBoost dataset for DISEASE-OUTBREAK risk + 4-week spread.

Unit of analysis: one (country, disease, epidemiological week) row. All signal is
derived from real official data — nothing is invented; unknowns are left NaN
(XGBoost handles NaN natively):

  outbreak signal + case/death numbers : WHO Disease Outbreak News (project cache
                                          dataset/cache/who-don.json) — cumulative
                                          case/death counts parsed from the report
                                          text; between reports the last reported
                                          cumulative is carried forward (not invented).
  population                            : World Bank API (SP.POP.TOTL, most recent)
  latitude/longitude, land area, borders: world-countries-110m.geojson (centroid,
                                          spherical polygon area, shared-boundary
                                          adjacency graph)
  ISO codes + continent                 : pycountry / pycountry_convert

STRICT anti-leakage: every feature at week t uses ONLY data with week <= t; both
targets use ONLY weeks t+1..t+4.

Targets:
  future_outbreak (binary)    1 if a new WHO-DON report for this (country,disease)
                              lands in weeks t+1..t+4, else 0.
  future_cases_4w (regression) reported new cases summed over weeks t+1..t+4.

Rows are emitted only for weeks within [report-4, report+12] windows (near real
outbreak activity) so the panel is focused and not decades of empty weeks.

Outputs under disease_ml/: dataset/{train,validation,test}.csv, metadata.json,
feature_dictionary.md, feature_report.md, quality_report.md.
"""
from __future__ import annotations

import json, math, os, re, sys, urllib.request
from collections import defaultdict

import numpy as np
import pandas as pd
import pycountry
import pycountry_convert as pcc

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CACHE = os.path.join(ROOT, "dataset", "cache")
GEOJSON = os.path.join(ROOT, "dashboard", "public", "world-countries-110m.geojson")
OUT = os.path.join(HERE, "dataset")
os.makedirs(OUT, exist_ok=True)

WINDOW_BEFORE, WINDOW_AFTER = 4, 12   # emit rows in [report-4, report+12] weeks
TRAIL_WEEKS = 12                      # internal series extends this past last report
HORIZON = 4

# ── country resolution (real ISO + continent, no manual tables) ─────────────
_VARIANTS = {
    "democratic republic of the congo": "CD", "dr congo": "CD", "drc": "CD",
    "republic of the congo": "CG", "united states": "US", "usa": "US",
    "united kingdom": "GB", "iran": "IR", "russia": "RU", "syria": "SY",
    "south korea": "KR", "north korea": "KP", "vietnam": "VN", "laos": "LA",
    "tanzania": "TZ", "bolivia": "BO", "venezuela": "VE", "moldova": "MD",
    "brunei": "BN", "czechia": "CZ", "cape verde": "CV", "myanmar": "MM",
    "ivory coast": "CI", "cote d'ivoire": "CI", "palestine": "PS", "turkey": "TR",
    "eswatini": "SZ", "cape verde": "CV", "the gambia": "GM",
}
_CONTINENT = {"AF": "Africa", "AS": "Asia", "EU": "Europe", "NA": "North America",
              "SA": "South America", "OC": "Oceania", "AN": "Antarctica"}
_iso_cache: dict = {}

def resolve_iso2(name):
    if not name:
        return None
    k = re.sub(r"\s+", " ", name.strip().lower())
    if k in _iso_cache:
        return _iso_cache[k]
    iso2 = _VARIANTS.get(k)
    if not iso2:
        try:
            iso2 = pycountry.countries.lookup(name).alpha_2
        except LookupError:
            try:
                iso2 = pycountry.countries.search_fuzzy(name)[0].alpha_2
            except LookupError:
                iso2 = None
    _iso_cache[k] = iso2
    return iso2

def iso2_to_iso3(iso2):
    try:
        return pycountry.countries.get(alpha_2=iso2).alpha_3
    except Exception:
        return None

def continent_of(iso2):
    try:
        return _CONTINENT.get(pcc.country_alpha2_to_continent_code(iso2))
    except Exception:
        return None

# ── geojson: centroid, spherical area, adjacency (all real, computed) ───────
def _ring_points(geom):
    rings = []
    if geom["type"] == "Polygon":
        rings = geom["coordinates"]
    elif geom["type"] == "MultiPolygon":
        for poly in geom["coordinates"]:
            rings.extend(poly)
    return rings

def _spherical_area_km2(rings):
    R = 6371.0088
    total = 0.0
    for ring in rings:
        if len(ring) < 4:
            continue
        s = 0.0
        for i in range(len(ring) - 1):
            lon1, lat1 = math.radians(ring[i][0]), math.radians(ring[i][1])
            lon2, lat2 = math.radians(ring[i + 1][0]), math.radians(ring[i + 1][1])
            s += (lon2 - lon1) * (2 + math.sin(lat1) + math.sin(lat2))
        total += abs(s * R * R / 2.0)
    return total

def load_geo():
    g = json.load(open(GEOJSON, encoding="utf-8"))
    geo = {}                      # iso3 -> {lat,lon,area}
    pts = defaultdict(set)        # rounded point -> {iso3}
    iso3_pts = defaultdict(set)   # iso3 -> {rounded points}
    for f in g["features"]:
        iso3 = f.get("id")
        if not iso3:
            continue
        rings = _ring_points(f["geometry"])
        xs = [p[0] for r in rings for p in r]
        ys = [p[1] for r in rings for p in r]
        if not xs:
            continue
        lat, lon = sum(ys) / len(ys), sum(xs) / len(xs)
        geo[iso3] = {"lat": round(lat, 4), "lon": round(lon, 4),
                     "area_km2": round(_spherical_area_km2(rings), 1)}
        for r in rings:
            for p in r:
                key = (round(p[0], 1), round(p[1], 1))
                pts[key].add(iso3); iso3_pts[iso3].add(key)
    adj = defaultdict(set)
    for iso3, ps in iso3_pts.items():
        for p in ps:
            for other in pts[p]:
                if other != iso3:
                    adj[iso3].add(other)
    return geo, adj

# ── World Bank population (real, one call) ──────────────────────────────────
def load_population():
    url = ("https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL"
           "?format=json&mrnev=1&per_page=400")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "ml-dataset/1.0"})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.loads(r.read().decode("utf-8"))
        out = {}
        for rec in (data[1] or []):
            iso2 = rec.get("country", {}).get("id")
            v = rec.get("value")
            if iso2 and isinstance(v, (int, float)):
                out[iso2] = float(v)
        return out
    except Exception as e:  # noqa: BLE001
        print(f"  ! World Bank population unavailable ({e}); population -> NaN", file=sys.stderr)
        return {}

# ── disease normalisation + category ────────────────────────────────────────
DISEASE_CATEGORY = [
    (("ebola", "marburg", "lassa", "crimean", "haemorrhagic", "hemorrhagic", "rift valley"), "viral_haemorrhagic"),
    (("influenza", "mers", "sars", "covid", "coronavirus", "respiratory", "legionell", "diphther"), "respiratory"),
    (("cholera", "typhoid", "hepatitis a", "hepatitis e", "e. coli", "diarrhoea", "diarrhea", "shigell", "salmonell"), "enteric_diarrhoeal"),
    (("dengue", "zika", "chikungunya", "yellow fever", "west nile", "malaria", "rift"), "vector_borne"),
    (("measles", "polio", "poliomyel", "meningococc", "meningitis", "rubella", "pertussis", "mumps", "tetanus"), "vaccine_preventable"),
    (("nipah", "mpox", "monkeypox", "anthrax", "plague", "rabies", "brucell", "hantavirus", "avian"), "zoonotic"),
]

def norm_disease(raw):
    if not raw:
        return None, "other"
    d = re.sub(r"\s+", " ", raw.strip()).strip(" -–,")
    d = re.sub(r"\b(update|situation report|outbreak)\b", "", d, flags=re.I).strip(" -–,")
    if not d or d.isdigit():
        return None, "other"
    name = d[:1].upper() + d[1:]
    low = name.lower()
    cat = "other"
    for keys, c in DISEASE_CATEGORY:
        if any(k in low for k in keys):
            cat = c; break
    return name, cat

# ── WHO-DON title parsing + case/death extraction ──────────────────────────
# A number = properly-grouped thousands ("5,948" / "5 948" / "1 234 567") OR a
# plain run of digits. Crucially it does NOT span a separator into a 4-digit run,
# so "in 2021, 5,948 cases" resolves to 5948, never a merged "20215948".
_NUM = r"(\d{1,3}(?:[,  ]\d{3})+|\d+)"
CASES_RE = re.compile(_NUM + r"\s+(?:laboratory[- ]confirmed|confirmed|suspected|reported|probable)?\s*(?:human\s+)?cases", re.I)
DEATHS_RE = re.compile(_NUM + r"\s+(?:deaths|fatalities|people (?:have )?died)", re.I)
WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
            "eight": 8, "nine": 9, "ten": 10}

def _nums(regex, text):
    vals = []
    for m in regex.finditer(text):
        n = re.sub(r"[,\s]", "", m.group(1))
        if n.isdigit():
            vals.append(int(n))
    # also catch "one confirmed case"
    for w, v in WORD_NUM.items():
        if re.search(rf"\b{w}\b\s+(?:laboratory[- ]confirmed|confirmed|suspected)?\s*(?:human\s+)?cases", text, re.I):
            vals.append(v)
    return max(vals) if vals else None

def strip_html(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(s or "")).replace("&nbsp;", " ")).strip()

def parse_country(title):
    m = re.search(r"\bin ([A-Z][A-Za-z .'-]+?)\s*$", title.strip())
    cand = m.group(1) if m else re.split(r"\s[–—-]\s|,", title)[-1]
    return resolve_iso2(cand.strip())

def parse_disease(title):
    t = re.sub(r"^\d{4}\s*[-–]?\s*", "", title).strip()
    t = re.split(r"\s[–—-]\s|,| in [A-Z]", t)[0].strip()
    return t

def extract_events():
    who = json.load(open(os.path.join(CACHE, "who-don.json"), encoding="utf-8"))
    events = []
    for r in who:
        title = r.get("Title") or ""
        date = (r.get("PublicationDate") or "")[:10]
        if not re.match(r"\d{4}-\d{2}-\d{2}", date):
            continue
        iso2 = parse_country(title)
        dname, dcat = norm_disease(parse_disease(title))
        if not iso2 or not dname:
            continue
        text = strip_html(" ".join(str(r.get(f) or "") for f in
                                   ["Epidemiology", "Overview", "Summary", "Assessment"]))
        events.append({"iso2": iso2, "disease": dname, "category": dcat, "date": date,
                       "cases": _nums(CASES_RE, text), "deaths": _nums(DEATHS_RE, text)})
    return events


def monday(d):
    ts = pd.Timestamp(d)
    return (ts - pd.Timedelta(days=ts.weekday())).normalize()


def season_of(month):
    return {12: "winter", 1: "winter", 2: "winter", 3: "spring", 4: "spring", 5: "spring",
            6: "summer", 7: "summer", 8: "summer", 9: "autumn", 10: "autumn", 11: "autumn"}[month]


def main():
    print("loading reference (geojson, World Bank, pycountry)…", flush=True)
    geo, adj = load_geo()
    pop = load_population()
    print(f"  geo countries: {len(geo)} | population entries: {len(pop)}", flush=True)

    print("extracting WHO-DON events…", flush=True)
    events = extract_events()
    print(f"  resolved events: {len(events)}", flush=True)

    # group by (iso2, disease)
    series = defaultdict(list)
    for e in events:
        series[(e["iso2"], e["disease"])].append(e)

    # ── build internal weekly series per (iso2, disease) ────────────────────
    # week_data[(iso2,disease)] = {week: {new_cases,new_deaths,cum_cases,cum_deaths,report}}
    week_data = {}
    emit_weeks = {}    # (iso2,disease) -> set(week) to emit as rows
    for key, evs in series.items():
        evs.sort(key=lambda x: x["date"])
        cat = evs[0]["category"]
        rep_weeks = sorted({monday(e["date"]) for e in evs})
        start, end = rep_weeks[0], rep_weeks[-1] + pd.Timedelta(weeks=TRAIL_WEEKS)
        grid = pd.date_range(start, end, freq="7D")
        # cumulative reported (max seen) per report week
        cum_c = {}; cum_d = {}; rep = defaultdict(bool)
        run_c = run_d = None
        for e in evs:
            w = monday(e["date"]); rep[w] = True
            if e["cases"] is not None:
                run_c = e["cases"] if run_c is None else max(run_c, e["cases"])
            if e["deaths"] is not None:
                run_d = e["deaths"] if run_d is None else max(run_d, e["deaths"])
            cum_c[w] = run_c; cum_d[w] = run_d
        wd = {}
        last_c = last_d = np.nan
        prev_c = prev_d = 0.0
        for w in grid:
            if w in cum_c and cum_c[w] is not None:
                last_c = float(cum_c[w])
            if w in cum_d and cum_d[w] is not None:
                last_d = float(cum_d[w])
            cc = last_c if not np.isnan(last_c) else np.nan
            dd = last_d if not np.isnan(last_d) else np.nan
            nc = max(0.0, (cc - prev_c)) if not np.isnan(cc) else 0.0
            nd = max(0.0, (dd - prev_d)) if not np.isnan(dd) else 0.0
            wd[w] = {"new_cases": nc, "new_deaths": nd, "cum_cases": cc, "cum_deaths": dd,
                     "report": bool(rep[w])}
            if not np.isnan(cc):
                prev_c = cc
            if not np.isnan(dd):
                prev_d = dd
        week_data[key] = wd
        ew = set()
        for w in rep_weeks:
            for k in range(-WINDOW_BEFORE, WINDOW_AFTER + 1):
                ew.add(w + pd.Timedelta(weeks=k))
        emit_weeks[key] = {w for w in ew if w in wd}

    # ── global aggregates for neighbour / regional (data as-of each week) ────
    active_by_week = defaultdict(set)            # week -> {iso3 with report in [w-3,w]}
    newcases_cont_week = defaultdict(float)      # (continent, week) -> sum new_cases
    for (iso2, disease), wd in week_data.items():
        iso3 = iso2_to_iso3(iso2); cont = continent_of(iso2)
        weeks = sorted(wd)
        for i, w in enumerate(weeks):
            if cont:
                newcases_cont_week[(cont, w)] += wd[w]["new_cases"]
            if any(wd[weeks[j]]["report"] for j in range(max(0, i - 3), i + 1)) and iso3:
                active_by_week[w].add(iso3)

    # ── assemble rows ───────────────────────────────────────────────────────
    rows = []
    for (iso2, disease), wd in week_data.items():
        iso3 = iso2_to_iso3(iso2); cont = continent_of(iso2)
        g = geo.get(iso3, {})
        population = pop.get(iso2)
        area = g.get("area_km2")
        dens = (population / area) if (population and area) else np.nan
        cname = None
        try:
            cname = pycountry.countries.get(alpha_2=iso2).name
        except Exception:
            pass
        cat = series[(iso2, disease)][0]["category"]
        neighbours = adj.get(iso3, set())
        weeks = sorted(wd)
        nc_series = np.array([wd[w]["new_cases"] for w in weeks])
        for i, w in enumerate(weeks):
            if w not in emit_weeks[(iso2, disease)]:
                continue
            hist = nc_series[:i + 1]               # up to and including t (known at t)
            last1 = float(nc_series[i])
            last2 = float(nc_series[max(0, i - 1):i + 1].sum())
            last4 = float(nc_series[max(0, i - 3):i + 1].sum())
            roll4 = float(nc_series[max(0, i - 3):i + 1].mean())
            roll8 = float(nc_series[max(0, i - 7):i + 1].mean())
            std4 = float(nc_series[max(0, i - 3):i + 1].std())
            prev1 = float(nc_series[i - 1]) if i >= 1 else 0.0
            growth = (last1 - prev1) / prev1 if prev1 > 0 else (1.0 if last1 > 0 else 0.0)
            nd_series = np.array([wd[x]["new_deaths"] for x in weeks])
            prevd = float(nd_series[i - 1]) if i >= 1 else 0.0
            dgrowth = (float(nd_series[i]) - prevd) / prevd if prevd > 0 else (1.0 if nd_series[i] > 0 else 0.0)
            trend_dir = 1 if roll4 > roll8 + 1e-9 else -1 if roll4 < roll8 - 1e-9 else 0
            # outbreak history (<= t)
            rep_before = [weeks[j] for j in range(i + 1) if wd[weeks[j]]["report"]]
            weeks_since = (i - weeks.index(rep_before[-1])) if rep_before else np.nan
            active = 1 if any(wd[weeks[j]]["report"] for j in range(max(0, i - 3), i + 1)) else 0
            peak_c = float(np.nanmax([wd[weeks[j]]["cum_cases"] for j in range(i + 1)])) if not np.all(
                np.isnan([wd[weeks[j]]["cum_cases"] for j in range(i + 1)])) else np.nan
            peak_d = float(np.nanmax([wd[weeks[j]]["cum_deaths"] for j in range(i + 1)])) if not np.all(
                np.isnan([wd[weeks[j]]["cum_deaths"] for j in range(i + 1)])) else np.nan
            # neighbour / regional (as-of week w)
            nb_active = sum(1 for n in neighbours if n in active_by_week.get(w, set()))
            reg_cases = newcases_cont_week.get((cont, w), np.nan) if cont else np.nan
            prev_w = weeks[i - 1] if i >= 1 else None
            reg_prev = newcases_cont_week.get((cont, prev_w), np.nan) if (cont and prev_w is not None) else np.nan
            reg_growth = ((reg_cases - reg_prev) / reg_prev) if (cont and reg_prev and reg_prev > 0) else np.nan
            cur_c = wd[w]["cum_cases"]; cur_d = wd[w]["cum_deaths"]
            cfr = (cur_d / cur_c) if (cur_c and cur_c > 0 and not np.isnan(cur_d)) else np.nan
            # targets (t+1..t+4)
            fut = [weeks[j] for j in range(i + 1, min(i + 1 + HORIZON, len(weeks)))]
            future_outbreak = int(any(wd[fw]["report"] for fw in fut))
            future_cases_4w = float(sum(wd[fw]["new_cases"] for fw in fut))
            rows.append({
                "week_start": w.strftime("%Y-%m-%d"),
                "week": int(w.isocalendar().week), "month": int(w.month), "year": int(w.year),
                "season": season_of(int(w.month)),
                "country": cname, "iso3": iso3, "continent": cont,
                "latitude": g.get("lat"), "longitude": g.get("lon"),
                "disease_name": disease, "disease_category": cat,
                "current_cases": cur_c, "current_deaths": cur_d, "current_case_fatality_rate": round(cfr, 4) if not np.isnan(cfr) else np.nan,
                "cases_last_week": last1, "cases_last_2_weeks": last2, "cases_last_4_weeks": last4,
                "rolling_mean_4w": round(roll4, 3), "rolling_mean_8w": round(roll8, 3), "rolling_std_4w": round(std4, 3),
                "weekly_growth_rate": round(growth, 4), "weekly_death_growth_rate": round(dgrowth, 4),
                "trend_direction": trend_dir,
                "weeks_since_last_outbreak": weeks_since, "active_outbreak": active,
                "historical_peak_cases": peak_c, "historical_peak_deaths": peak_d,
                "neighbouring_countries_with_active_outbreak": nb_active,
                "regional_cases": round(reg_cases, 2) if not (isinstance(reg_cases, float) and np.isnan(reg_cases)) else np.nan,
                "regional_growth_rate": round(reg_growth, 4) if not (isinstance(reg_growth, float) and np.isnan(reg_growth)) else np.nan,
                "population": population, "population_density": round(dens, 2) if not np.isnan(dens) else np.nan,
                "future_outbreak": future_outbreak, "future_cases_4w": future_cases_4w,
            })

    df = pd.DataFrame(rows).drop_duplicates(subset=["iso3", "disease_name", "week_start"])
    df = df.sort_values("week_start").reset_index(drop=True)
    print(f"panel rows: {len(df)} | countries: {df['iso3'].nunique()} | diseases: {df['disease_name'].nunique()}", flush=True)

    # ── chronological split 70/15/15 ────────────────────────────────────────
    n = len(df)
    i1, i2 = int(n * 0.70), int(n * 0.85)
    tr, va, te = df.iloc[:i1], df.iloc[i1:i2], df.iloc[i2:]
    tr.to_csv(os.path.join(OUT, "train.csv"), index=False)
    va.to_csv(os.path.join(OUT, "validation.csv"), index=False)
    te.to_csv(os.path.join(OUT, "test.csv"), index=False)

    write_docs(df, tr, va, te)
    print(f"WROTE train={len(tr)} validation={len(va)} test={len(te)} -> {OUT}", flush=True)


def write_docs(df, tr, va, te):
    feat_cols = [c for c in df.columns if c not in ("future_outbreak", "future_cases_4w")]
    # quality checks
    miss = {c: round(float(df[c].isna().mean() * 100), 2) for c in df.columns}
    num = df.select_dtypes(include=[np.number])
    corr = num.corr(numeric_only=True)
    tgt_corr = corr["future_cases_4w"].drop(["future_cases_4w"], errors="ignore").abs().sort_values(ascending=False).head(12)
    dup = int(df.duplicated().sum())
    pos = int(df["future_outbreak"].sum())
    outliers = {}
    for c in ["current_cases", "future_cases_4w", "cases_last_4_weeks", "regional_cases"]:
        if c in df:
            v = df[c].dropna()
            if len(v):
                q1, q3 = v.quantile(0.25), v.quantile(0.75)
                iqr = q3 - q1
                outliers[c] = int(((v < q1 - 1.5 * iqr) | (v > q3 + 1.5 * iqr)).sum())

    metadata = {
        "unit": "one (country, disease, epidemiological week)",
        "rows": len(df), "features": len(feat_cols),
        "date_range": [df["week_start"].min(), df["week_start"].max()],
        "countries": int(df["iso3"].nunique()), "diseases": int(df["disease_name"].nunique()),
        "sources": {
            "outbreak_and_cases": "WHO Disease Outbreak News (dataset/cache/who-don.json)",
            "population": "World Bank SP.POP.TOTL (most recent)",
            "geo_area_borders": "world-countries-110m.geojson (centroid, spherical area, adjacency)",
            "iso_continent": "pycountry / pycountry_convert",
        },
        "split": {"type": "chronological (no shuffle)", "ratios": "70/15/15",
                  "train": len(tr), "validation": len(va), "test": len(te),
                  "train_range": [tr["week_start"].min(), tr["week_start"].max()],
                  "validation_range": [va["week_start"].min(), va["week_start"].max()],
                  "test_range": [te["week_start"].min(), te["week_start"].max()]},
        "targets": {
            "future_outbreak": {"type": "binary",
                                "positive_rate": round(float(df["future_outbreak"].mean()), 4),
                                "positives": pos, "negatives": len(df) - pos},
            "future_cases_4w": {"type": "regression", "min": float(df["future_cases_4w"].min()),
                                "median": float(df["future_cases_4w"].median()),
                                "max": float(df["future_cases_4w"].max()),
                                "mean": round(float(df["future_cases_4w"].mean()), 2)},
        },
        "quality_checks": {
            "duplicate_rows": dup,
            "missing_pct_by_column": miss,
            "class_balance_future_outbreak": {"positive_pct": round(float(df["future_outbreak"].mean() * 100), 2)},
            "top_abs_correlation_with_future_cases_4w": {k: round(float(v), 3) for k, v in tgt_corr.items()},
            "outlier_counts_iqr": outliers,
        },
        "leakage_control": "All features use week <= t; both targets use weeks t+1..t+4 only.",
        "missing_value_policy": "Genuine unknowns left as NaN (XGBoost handles NaN natively) — never imputed with invented values.",
    }
    json.dump(metadata, open(os.path.join(HERE, "metadata.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    # feature dictionary + report
    FEATURES = [
        ("week", "ISO week number (1–53)", "int", "derived from report date", "captures intra-year epidemic timing"),
        ("month", "calendar month (1–12)", "int", "derived", "monthly seasonality of many diseases"),
        ("year", "calendar year", "int", "derived", "long-term shifts in reporting/incidence"),
        ("season", "N-hemisphere meteorological season", "categorical", "derived from month", "seasonal drivers (rain→cholera, winter→flu)"),
        ("country", "country name", "categorical", "pycountry", "country-specific base risk"),
        ("iso3", "ISO 3166-1 alpha-3 code", "categorical", "pycountry", "stable country key for the model"),
        ("continent", "continent", "categorical", "pycountry_convert", "coarse regional risk grouping"),
        ("latitude", "country centroid latitude", "float", "geojson centroid", "climate/geography proxy"),
        ("longitude", "country centroid longitude", "float", "geojson centroid", "climate/geography proxy"),
        ("disease_name", "normalized disease name", "categorical", "WHO-DON title", "disease-specific dynamics"),
        ("disease_category", "disease group", "categorical", "keyword mapping", "shared behaviour within a transmission class"),
        ("current_cases", "cumulative reported cases as of week t", "float", "WHO-DON text", "current outbreak size"),
        ("current_deaths", "cumulative reported deaths as of week t", "float", "WHO-DON text", "severity level"),
        ("current_case_fatality_rate", "deaths/cases as of t", "float", "derived", "lethality signal"),
        ("cases_last_week", "new reported cases in the latest week", "float", "derived", "immediate momentum"),
        ("cases_last_2_weeks", "sum of new cases over last 2 weeks", "float", "derived", "short-term load"),
        ("cases_last_4_weeks", "sum of new cases over last 4 weeks", "float", "derived", "recent burden"),
        ("rolling_mean_4w", "mean weekly new cases, last 4w", "float", "derived", "smoothed recent level"),
        ("rolling_mean_8w", "mean weekly new cases, last 8w", "float", "derived", "medium-term baseline"),
        ("rolling_std_4w", "std of weekly new cases, last 4w", "float", "derived", "volatility of the outbreak"),
        ("weekly_growth_rate", "(new_t - new_{t-1}) / new_{t-1}", "float", "derived", "acceleration/deceleration"),
        ("weekly_death_growth_rate", "weekly growth of new deaths", "float", "derived", "severity trajectory"),
        ("trend_direction", "sign(roll4 - roll8): -1/0/1", "int", "derived", "compact rising/falling signal"),
        ("weeks_since_last_outbreak", "weeks since last WHO-DON report", "float", "derived", "recency of activity"),
        ("active_outbreak", "report within last 4 weeks (0/1)", "int", "derived", "is an outbreak ongoing now"),
        ("historical_peak_cases", "max cumulative cases seen so far", "float", "derived", "outbreak ceiling reference"),
        ("historical_peak_deaths", "max cumulative deaths so far", "float", "derived", "worst severity reference"),
        ("neighbouring_countries_with_active_outbreak", "count of land-border neighbours active in week t", "int", "geojson adjacency + WHO-DON", "cross-border spread risk"),
        ("regional_cases", "sum of new cases in the continent, week t", "float", "derived", "regional pressure"),
        ("regional_growth_rate", "weekly growth of regional cases", "float", "derived", "regional momentum"),
        ("population", "country population (most recent)", "float", "World Bank", "susceptible pool size"),
        ("population_density", "population / land area (km²)", "float", "World Bank + geojson area", "transmission-intensity proxy"),
    ]
    dict_md = ["# Feature Dictionary\n", "| feature | type | source | description |", "|---|---|---|---|"]
    for name, desc, typ, src, _why in FEATURES:
        dict_md.append(f"| `{name}` | {typ} | {src} | {desc} |")
    dict_md += ["", "## Targets",
                "- `future_outbreak` — **binary**: 1 if a new WHO-DON report lands in weeks t+1..t+4, else 0.",
                "- `future_cases_4w` — **regression**: reported new cases summed over weeks t+1..t+4."]
    open(os.path.join(HERE, "feature_dictionary.md"), "w", encoding="utf-8").write("\n".join(dict_md) + "\n")

    rep = ["# Feature Report — why each feature helps XGBoost\n",
           f"_Rows: {len(df)} · {df['iso3'].nunique()} countries · {df['disease_name'].nunique()} diseases · "
           f"{df['week_start'].min()}→{df['week_start'].max()}_\n"]
    for name, desc, typ, src, why in FEATURES:
        rep.append(f"### `{name}` ({typ})\n- **Description:** {desc}\n- **Source:** {src}\n- **Why it helps:** {why}\n")
    open(os.path.join(HERE, "feature_report.md"), "w", encoding="utf-8").write("\n".join(rep) + "\n")

    q = ["# Quality Report\n",
         f"- Rows: **{len(df)}** | duplicate rows: **{dup}**",
         f"- future_outbreak positive rate: **{round(float(df['future_outbreak'].mean()*100),2)}%** "
         f"({pos} pos / {len(df)-pos} neg) — imbalanced (use scale_pos_weight).",
         f"- future_cases_4w: min {df['future_cases_4w'].min():.0f}, median {df['future_cases_4w'].median():.0f}, "
         f"mean {df['future_cases_4w'].mean():.1f}, max {df['future_cases_4w'].max():.0f}",
         "\n## Missing values (%) — top columns"]
    for c, m in sorted(miss.items(), key=lambda x: -x[1])[:15]:
        q.append(f"- {c}: {m}%")
    q.append("\n## |correlation| with future_cases_4w (top)")
    for k, v in tgt_corr.items():
        q.append(f"- {k}: {round(float(v),3)}")
    q.append("\n## Outlier counts (IQR rule)")
    for c, v in outliers.items():
        q.append(f"- {c}: {v}")
    q.append("\n_Missing values are genuine unknowns left as NaN for XGBoost — not imputed with invented values._")
    open(os.path.join(HERE, "quality_report.md"), "w", encoding="utf-8").write("\n".join(q) + "\n")


if __name__ == "__main__":
    main()
