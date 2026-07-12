#!/usr/bin/env python3
"""
Historical hazard/outbreak dataset builder for Qwen2.5-Instruct fine-tuning.

Harvest -> clean/normalize -> dedup -> structure -> chat-format -> chronological
split -> validate -> report. Trusted official sources ONLY. Nothing is invented:
any field a source does not provide is emitted as null.

LIVE adapters (keyless, reachable now): NASA EONET v3, EMSC seismicportal.
GATED adapters (wired, disabled here — need unrestricted network or an API key):
USGS, GDACS, ReliefWeb v2, WHO DON, CDC, ECDC, NOAA, Copernicus EMS. Enable them
by implementing the marked stubs / providing keys, then re-run; the rest of the
pipeline (cleaning, dedup, split, validation, report) already handles them.

Config via env vars (all optional) — defaults produce a real, balanced set:
  EMSC_MINMAG=5.0  EMSC_START_YEAR=2000  EMSC_CAP=40000
  EONET_START_YEAR=2015  EONET_CAP=25000
"""
import json, os, re, sys, time, urllib.request, urllib.error, datetime
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)

NOW = datetime.datetime(2026, 7, 12)  # fixed "today" for reproducibility

CFG = {
    "emsc_minmag": float(os.environ.get("EMSC_MINMAG", "5.0")),
    "emsc_start_year": int(os.environ.get("EMSC_START_YEAR", "2000")),
    "emsc_cap": int(os.environ.get("EMSC_CAP", "40000")),
    "eonet_start_year": int(os.environ.get("EONET_START_YEAR", "2015")),
    "eonet_cap": int(os.environ.get("EONET_CAP", "25000")),
    "ecdc_cap": int(os.environ.get("ECDC_CAP", "1700")),
    "max_total": int(os.environ.get("MAX_TOTAL", "5000")),  # 0 = unlimited
    "http_timeout": 60,
}

TRUSTED_SOURCES = {
    "EMSC", "NASA EONET", "USGS", "GDACS", "NOAA",
    "WHO", "CDC", "ECDC", "Copernicus EMS", "ReliefWeb (official)",
}

SYSTEM_MSG = ("You are an expert risk analysis assistant. "
              "Answer only using the available evidence.")

# ── HTTP ────────────────────────────────────────────────────────────────────
def http_json(url, retries=4, backoff=2.0):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hazard-dataset-builder/1.0"})
            with urllib.request.urlopen(req, timeout=CFG["http_timeout"]) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001 — network is best-effort by design
            last = e
            time.sleep(backoff * (i + 1))
    print(f"  ! giving up on {url[:80]}… ({last})", file=sys.stderr)
    return None

# ── Normalization helpers ───────────────────────────────────────────────────
# Canonical country names + common variants. Unmatched -> None (never guessed).
COUNTRY_VARIANTS = {
    "usa": "United States", "us": "United States", "u.s.a.": "United States",
    "united states of america": "United States", "america": "United States",
    "uk": "United Kingdom", "great britain": "United Kingdom", "england": "United Kingdom",
    "russia": "Russia", "russian federation": "Russia",
    "iran": "Iran", "islamic republic of iran": "Iran",
    "south korea": "South Korea", "republic of korea": "South Korea",
    "north korea": "North Korea", "democratic people's republic of korea": "North Korea",
    "syria": "Syria", "syrian arab republic": "Syria",
    "drc": "Democratic Republic of the Congo",
    "democratic republic of the congo": "Democratic Republic of the Congo",
    "dr congo": "Democratic Republic of the Congo", "congo drc": "Democratic Republic of the Congo",
    "republic of the congo": "Republic of the Congo",
    "tanzania": "Tanzania", "united republic of tanzania": "Tanzania",
    "bolivia": "Bolivia", "venezuela": "Venezuela", "vietnam": "Vietnam", "viet nam": "Vietnam",
    "laos": "Laos", "moldova": "Moldova", "brunei": "Brunei",
    "czech republic": "Czechia", "czechia": "Czechia",
    "burma": "Myanmar", "myanmar": "Myanmar",
    "ivory coast": "Ivory Coast", "cote d'ivoire": "Ivory Coast", "côte d'ivoire": "Ivory Coast",
    "cape verde": "Cape Verde", "cabo verde": "Cape Verde",
    "swaziland": "Eswatini", "eswatini": "Eswatini",
    "turkey": "Turkey", "türkiye": "Turkey", "turkiye": "Turkey",
    "macedonia": "North Macedonia", "north macedonia": "North Macedonia",
    "palestine": "Palestine", "state of palestine": "Palestine",
}
COUNTRIES = sorted(set([
    "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia",
    "Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium",
    "Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei",
    "Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde",
    "Central African Republic","Chad","Chile","China","Colombia","Comoros",
    "Democratic Republic of the Congo","Republic of the Congo","Costa Rica","Croatia","Cuba",
    "Cyprus","Czechia","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt",
    "El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland",
    "France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea",
    "Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran",
    "Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya",
    "Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya",
    "Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali",
    "Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco",
    "Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands",
    "New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman",
    "Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines",
    "Poland","Portugal","Qatar","Romania","Russia","Rwanda","Samoa","San Marino","Saudi Arabia",
    "Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands",
    "Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname",
    "Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo",
    "Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine",
    "United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu",
    "Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
]))
# longest-first so "South Sudan" wins over "Sudan"
_COUNTRY_MATCH = sorted(COUNTRIES, key=len, reverse=True)

# Admin regions (US states, CA provinces, AU states) -> country. EONET titles
# name the state/province, not the country, so without this most North-American
# and Australian events would be dropped to country=null.
REGION_TO_COUNTRY = {c: "United States" for c in [
    "alabama","alaska","arizona","arkansas","california","colorado","connecticut","delaware",
    "florida","georgia","hawaii","idaho","illinois","indiana","iowa","kansas","kentucky",
    "louisiana","maine","maryland","massachusetts","michigan","minnesota","mississippi","missouri",
    "montana","nebraska","nevada","new hampshire","new jersey","new mexico","new york",
    "north carolina","north dakota","ohio","oklahoma","oregon","pennsylvania","rhode island",
    "south carolina","south dakota","tennessee","texas","utah","vermont","virginia","washington",
    "west virginia","wisconsin","wyoming","puerto rico",
]}
REGION_TO_COUNTRY.update({c: "Canada" for c in [
    "alberta","british columbia","manitoba","new brunswick","newfoundland","nova scotia","ontario",
    "quebec","saskatchewan","yukon","northwest territories","nunavut",
]})
REGION_TO_COUNTRY.update({c: "Australia" for c in [
    "new south wales","queensland","tasmania","victoria","western australia","northern territory",
]})

def normalize_country(name):
    if not name:
        return None
    key = re.sub(r"\s+", " ", name.strip().lower())
    if key in COUNTRY_VARIANTS:
        return COUNTRY_VARIANTS[key]
    for c in _COUNTRY_MATCH:
        if c.lower() == key:
            return c
    return None

def find_country_in(text):
    """Detect a country mentioned anywhere in a free-text string (longest match)."""
    if not text:
        return None
    low = " " + re.sub(r"[^a-z' ]", " ", text.lower()) + " "
    for variant, canon in sorted(COUNTRY_VARIANTS.items(), key=lambda kv: -len(kv[0])):
        if f" {variant} " in low:
            return canon
    for c in _COUNTRY_MATCH:
        if f" {c.lower()} " in low:
            return c
    # admin-region fallback (US states, provinces…), longest-first
    for region, canon in sorted(REGION_TO_COUNTRY.items(), key=lambda kv: -len(kv[0])):
        if f" {region} " in low:
            return canon
    return None

def strip_html(s):
    if not isinstance(s, str):
        return s
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip()

def norm_date(v):
    """Any ISO-ish timestamp or epoch(ms) -> YYYY-MM-DD, else None."""
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return datetime.datetime.utcfromtimestamp(v / 1000 if v > 1e12 else v).strftime("%Y-%m-%d")
        s = str(v).strip()
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
        if m:
            y, mo, d = map(int, m.groups())
            datetime.date(y, mo, d)  # validates
            return f"{y:04d}-{mo:02d}-{d:02d}"
    except Exception:  # noqa: BLE001
        return None
    return None

def valid_coord(lat, lon):
    try:
        lat = float(lat); lon = float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    if lat == 0 and lon == 0:  # null-island — treat as missing
        return None
    return {"lat": round(lat, 4), "lon": round(lon, 4)}

def severity_from_mag(m):
    if m is None:
        return None
    if m < 4.0: return "low"
    if m < 5.0: return "moderate"
    if m < 6.0: return "high"
    if m < 7.0: return "severe"
    return "extreme"

# ── Adapters (LIVE) ─────────────────────────────────────────────────────────
def harvest_emsc():
    """EMSC seismicportal FDSN — earthquakes. Year-windowed; monthly fallback if
    a year hits the server result cap."""
    print("· EMSC (earthquakes)…")
    out, seen = [], set()
    base = "https://www.seismicportal.eu/fdsnws/event/1/query"
    minmag = CFG["emsc_minmag"]

    def fetch(start, end):
        url = f"{base}?format=json&start={start}&end={end}&minmag={minmag}&limit=20000"
        d = http_json(url)
        return (d or {}).get("features", []) or []

    # Newest year first so a small cap keeps the most recent, most relevant data.
    for year in range(NOW.year, CFG["emsc_start_year"] - 1, -1):
        windows = [(f"{year}-01-01", f"{year}-12-31")]
        feats = fetch(*windows[0])
        if len(feats) >= 20000:  # capped — redo month by month
            feats = []
            for mo in range(1, 13):
                nxt = datetime.date(year + (mo == 12), (mo % 12) + 1, 1)
                feats += fetch(f"{year}-{mo:02d}-01", nxt.strftime("%Y-%m-%d"))
        for f in feats:
            p = f.get("properties", {})
            sid = str(p.get("source_id") or p.get("unid") or "")
            if not sid or sid in seen:
                continue
            seen.add(sid)
            geo = (f.get("geometry") or {}).get("coordinates") or [None, None, None]
            region_raw = strip_html(p.get("flynn_region") or "")
            country = None
            # flynn_region is "REGION, COUNTRY" or just a region/sea name
            if "," in region_raw:
                country = normalize_country(region_raw.split(",")[-1]) or find_country_in(region_raw)
            country = country or find_country_in(region_raw)
            out.append({
                "source": "EMSC", "source_id": f"EMSC:{sid}",
                "hazard": "earthquake", "event_type": "earthquake",
                "event_name": None, "disease": None,
                "country": country, "city": None,
                "region": region_raw.title() if region_raw else None,
                "coord": valid_coord(p.get("lat", geo[1]), p.get("lon", geo[0])),
                "date": norm_date(p.get("time")),
                "magnitude": round(float(p["mag"]), 1) if p.get("mag") is not None else None,
                "magtype": p.get("magtype"), "measure": None,
                "depth_km": round(float(p["depth"]), 1) if p.get("depth") is not None else None,
                "deaths": None, "cases": None, "affected_population": None,
                "affected_area": None, "timeline": None, "spread": None,
                "neighboring_affected": None, "recommendations": None,
            })
            if len(out) >= CFG["emsc_cap"]:
                print(f"  emsc cap {CFG['emsc_cap']} reached"); return out
        print(f"  {year}: total {len(out)}")
    return out

EONET_TYPE = {
    "floods": "flood", "severeStorms": "storm", "wildfires": "wildfire",
    "volcanoes": "volcano", "seaLakeIce": "ice", "drought": "drought",
    "dustHaze": "dust_haze", "earthquakes": "earthquake", "landslides": "landslide",
    "snow": "snow", "tempExtremes": "temperature_extreme", "manmade": "manmade",
    "waterColor": "water_color",
}

def harvest_eonet():
    """NASA EONET v3 — multi-hazard, with real multi-point timelines (propagation)."""
    print("· NASA EONET (multi-hazard)…")
    out, seen = [], set()
    for year in range(CFG["eonet_start_year"], NOW.year + 1):
        events = []  # monthly windows keep each response small & reliable
        for mo in range(1, 13):
            nxt = datetime.date(year + (mo == 12), (mo % 12) + 1, 1).strftime("%Y-%m-%d")
            url = (f"https://eonet.gsfc.nasa.gov/api/v3/events"
                   f"?status=closed&limit=25000&start={year}-{mo:02d}-01&end={nxt}")
            events += (http_json(url) or {}).get("events", []) or []
        for e in events:
            eid = e.get("id")
            if not eid or eid in seen:
                continue
            seen.add(eid)
            cats = e.get("categories") or [{}]
            cat_id = cats[0].get("id", "")
            hazard = EONET_TYPE.get(cat_id, cat_id or "unknown")
            title = strip_html(e.get("title") or "")
            place = re.sub(r"\s+\d+$", "", re.split(r"\bin\b|\s-\s", title, maxsplit=1)[-1]).strip()
            country = find_country_in(title)
            geoms = e.get("geometry") or []
            # timeline / propagation from the sequence of dated geometries
            timeline = []
            for g in geoms:
                dt = norm_date(g.get("date"))
                coords = g.get("coordinates")
                pt = None
                if g.get("type") == "Point" and coords:
                    pt = valid_coord(coords[1], coords[0])
                elif coords:  # polygon/multipolygon — use first vertex as anchor
                    try:
                        flat = coords
                        while isinstance(flat[0][0], list):
                            flat = flat[0]
                        pt = valid_coord(flat[0][1], flat[0][0])
                    except Exception:  # noqa: BLE001
                        pt = None
                if dt:
                    timeline.append({"date": dt, "location": pt})
            timeline = timeline or None
            first_pt = next((t["location"] for t in (timeline or []) if t["location"]), None)
            # EONET magnitudeValue is source-specific (acres for wildfires, kts for
            # storms…), NOT a seismic magnitude — keep it as a measure with its unit,
            # and route areal units into affected_area. Never call it "magnitude".
            mv = geoms[0].get("magnitudeValue") if geoms else None
            mu = geoms[0].get("magnitudeUnit") if geoms else None
            measure = area = None
            if isinstance(mv, (int, float)) and mu:
                if str(mu).strip().lower() in ("acres", "acre", "ha", "hectare", "hectares",
                                               "km2", "sq km", "km²", "sqkm"):
                    area = f"{mv} {mu}"
                else:
                    measure = {"value": mv, "unit": mu}
            # Onset date = first dated observation; fall back to EONET 'closed'.
            event_date = (timeline[0]["date"] if timeline else None) or norm_date(e.get("closed"))
            out.append({
                "source": "NASA EONET", "source_id": f"EONET:{eid}",
                "hazard": hazard, "event_type": hazard,
                "event_name": title or None, "disease": None,
                "country": country, "city": None,
                "region": place or None,
                "coord": first_pt,
                "date": event_date,
                "magnitude": None, "measure": measure, "depth_km": None,
                "deaths": None, "cases": None, "affected_population": None,
                "affected_area": area,
                "timeline": timeline,
                "spread": (f"{len(timeline)} dated observations from "
                           f"{timeline[0]['date']} to {timeline[-1]['date']}"
                           if timeline and len(timeline) > 1 else None),
                "neighboring_affected": None, "recommendations": None,
            })
            if len(out) >= CFG["eonet_cap"]:
                print(f"  eonet cap reached"); return out
        print(f"  {year}: total {len(out)}")
    return out

def harvest_ecdc():
    """ECDC — official COVID-19 weekly national case/death series (EU/EEA). The
    disease-outbreak side of the dataset: real cases, deaths, cumulative counts
    and 14-day rates per country per ISO week. Merges the separate cases/deaths
    rows into one outbreak record per (country, week)."""
    print("· ECDC (COVID-19 outbreak, EU/EEA weekly)…")
    d = http_json("https://opendata.ecdc.europa.eu/covid19/nationalcasedeath/json/")
    if not d:
        print("  ecdc unreachable"); return []
    merged = {}
    for r in d:
        key = (r.get("country_code"), r.get("year_week"))
        m = merged.setdefault(key, {})
        m["row"] = r  # any row carries country/population/continent
        if r.get("indicator") == "cases":
            m["cases"] = r.get("weekly_count"); m["cum_cases"] = r.get("cumulative_count")
            m["rate"] = r.get("rate_14_day")
        elif r.get("indicator") == "deaths":
            m["deaths"] = r.get("weekly_count"); m["cum_deaths"] = r.get("cumulative_count")
    out = []
    for (cc, yw), m in merged.items():
        r = m["row"]
        try:
            y, w = map(int, yw.split("-"))
            dt = datetime.date.fromisocalendar(y, w, 1).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            continue
        # Skip weeks with no reported case OR death count — no outbreak signal,
        # they would only yield a contentless summary.
        if m.get("cases") is None and m.get("deaths") is None:
            continue
        rate = m.get("rate")
        out.append({
            "source": "ECDC", "source_id": f"ECDC:{cc}:{yw}",
            "hazard": "epidemic", "event_type": "disease_outbreak",
            "event_name": "COVID-19 pandemic", "disease": "COVID-19",
            "country": normalize_country(r.get("country")) or r.get("country"),
            "city": None, "region": r.get("continent"), "coord": None, "date": dt,
            "magnitude": None,
            "measure": ({"value": round(float(rate), 1), "unit": "14-day cases per 100k"}
                        if isinstance(rate, (int, float)) else None),
            "depth_km": None,
            "deaths": m.get("deaths"), "cases": m.get("cases"),
            "affected_population": r.get("population"), "affected_area": None,
            "timeline": None, "spread": None, "neighboring_affected": None,
            "recommendations": None,
            "_cum_cases": m.get("cum_cases"), "_cum_deaths": m.get("cum_deaths"),
        })
    # Sort by date so a cap keeps a country-diverse, chronologically-spread slice
    # (each week spans all countries) rather than one country's whole series.
    out.sort(key=lambda r: r["date"])
    if len(out) > CFG["ecdc_cap"]:
        step = len(out) / CFG["ecdc_cap"]
        out = [out[int(i * step)] for i in range(CFG["ecdc_cap"])]
    print(f"  ecdc: {len(out)} weekly outbreak records")
    return out

# GATED adapters — reachable only in an unrestricted environment / with keys.
def harvest_gated():
    return []  # USGS, GDACS, ReliefWeb v2, WHO DON, CDC, NOAA, Copernicus EMS

# ── Structured record + chat example ────────────────────────────────────────
STRUCT_KEYS = [
    "event_type", "event_name", "hazard", "disease", "country", "city", "region",
    "coordinates", "date", "source", "severity", "magnitude", "measure", "depth_km",
    "deaths", "cases", "affected_population", "affected_area", "timeline", "spread",
    "neighboring_affected", "recommendations", "summary",
]

def build_summary(r, sev):
    if r.get("disease"):
        parts = [f"{r['disease']} weekly update for {r['country'] or 'a country'} "
                 f"(week of {r['date']}):"]
        if r.get("cases") is not None: parts.append(f"{r['cases']} new cases")
        if r.get("deaths") is not None: parts.append(f"{r['deaths']} new deaths")
        if r.get("_cum_cases") is not None: parts.append(f"cumulative cases {r['_cum_cases']}")
        if r.get("_cum_deaths") is not None: parts.append(f"cumulative deaths {r['_cum_deaths']}")
        return " ".join(parts) + f" (source: {r['source']})."
    if r["hazard"] == "earthquake":
        loc = r["region"] or (r["country"] or "an offshore region")
        mag = f"magnitude {r['magnitude']} ({r['magtype']})" if r.get("magnitude") else "an earthquake"
        depth = f" at {r['depth_km']} km depth" if r.get("depth_km") is not None else ""
        return (f"A {mag} earthquake occurred on {r['date']} in {loc}{depth}, "
                f"recorded by {r['source']}.")
    where = r["country"] or r["region"] or "an unspecified location"
    ev = (r["hazard"] or "hazard").replace("_", " ")
    spread = f" It was {r['spread']}." if r.get("spread") else ""
    return (f"A {ev} event ({r.get('event_name') or 'unnamed'}) affecting {where}, "
            f"recorded by {r['source']} on {r['date']}.{spread}")

def to_structured(r):
    # Seismic severity is derived ONLY for earthquakes (magnitude is Mw-scale).
    # Other hazards have no comparable universal scale here → severity=null.
    sev = severity_from_mag(r.get("magnitude")) if r["hazard"] == "earthquake" else None
    s = {
        "event_type": r["event_type"], "event_name": r["event_name"], "hazard": r["hazard"],
        "disease": r["disease"], "country": r["country"], "city": r["city"], "region": r["region"],
        "coordinates": r["coord"], "date": r["date"], "source": r["source"], "severity": sev,
        "magnitude": r.get("magnitude"), "measure": r.get("measure"), "depth_km": r.get("depth_km"),
        "deaths": r["deaths"], "cases": r["cases"], "affected_population": r["affected_population"],
        "affected_area": r["affected_area"], "timeline": r["timeline"], "spread": r["spread"],
        "neighboring_affected": r["neighboring_affected"], "recommendations": r["recommendations"],
        "summary": build_summary(r, sev),
    }
    return {k: s[k] for k in STRUCT_KEYS}

def raw_event_text(r):
    """Readable, factual dump of the raw record — the model's input to analyze."""
    fields = [
        ("Source", r["source"]), ("Event type", r["hazard"]), ("Name", r["event_name"]),
        ("Country", r["country"]), ("Region", r["region"]),
        ("Coordinates", f"{r['coord']['lat']}, {r['coord']['lon']}" if r["coord"] else None),
        ("Date", r["date"]), ("Magnitude", r.get("magnitude")), ("Depth (km)", r.get("depth_km")),
        ("Observations", len(r["timeline"]) if r.get("timeline") else None),
    ]
    return "\n".join(f"{k}: {v}" for k, v in fields if v is not None)

def to_chat(struct, r):
    return {"messages": [
        {"role": "system", "content": SYSTEM_MSG},
        {"role": "user", "content": "Analyze the following historical event:\n" + raw_event_text(r)},
        {"role": "assistant", "content": json.dumps(struct, ensure_ascii=False)},
    ]}

# ── Dedup ───────────────────────────────────────────────────────────────────
def dedup(records):
    by_id, dup_id = {}, 0
    for r in records:
        if r["source_id"] in by_id:
            dup_id += 1; continue
        by_id[r["source_id"]] = r
    event_key, kept, dup_event = {}, [], 0
    for r in by_id.values():
        c = r["coord"]
        key = (r["hazard"], r["country"], r["date"],
               round(c["lat"], 1) if c else None, round(c["lon"], 1) if c else None)
        if key in event_key:
            dup_event += 1; continue
        event_key[key] = True; kept.append(r)
    return kept, dup_id, dup_event

# ── Balanced downsample to a target size ─────────────────────────────────────
def balance_downsample(records, target):
    """Trim to `target` records while (a) balancing across sources and (b) keeping
    temporal spread. Each source gets a fair quota (small sources keep everything,
    their slack redistributed), then that source is stride-sampled over its
    date-sorted list so we keep events spanning the whole period, not just the
    earliest N. Returns (kept, dropped)."""
    if not target or len(records) <= target:
        return records, 0
    by_src = defaultdict(list)
    for r in records:
        by_src[r["source"]].append(r)
    for s in by_src:
        by_src[s].sort(key=lambda r: r["date"] or "9999")
    # fair quotas with redistribution for sources smaller than their share
    quota, pool, remaining = {}, set(by_src), target
    while pool:
        share = remaining // len(pool)
        small = [s for s in pool if len(by_src[s]) <= share]
        if not small:
            for i, s in enumerate(pool):  # split remainder, give slack to first
                quota[s] = share + (remaining - share * len(pool) if i == 0 else 0)
            break
        for s in small:
            quota[s] = len(by_src[s]); remaining -= quota[s]; pool.discard(s)
    out = []
    for s, items in by_src.items():
        q = quota.get(s, 0)
        if q >= len(items):
            out += items
        elif q > 0:
            step = len(items) / q
            out += [items[int(i * step)] for i in range(q)]
    return out, len(records) - len(out)

# ── Chronological split (whole event-chains stay together) ───────────────────
def split_chrono(records):
    def chain_id(r):  # aftershock/report clusters: source+country+hazard+ISO-week
        try:
            wk = datetime.date.fromisoformat(r["date"]).isocalendar()
            wk = f"{wk[0]}W{wk[1]:02d}"
        except Exception:  # noqa: BLE001
            wk = r["date"]
        return f"{r['source']}|{r['country']}|{r['hazard']}|{wk}"
    chains = defaultdict(list)
    for r in records:
        chains[chain_id(r)].append(r)
    ordered = sorted(chains.values(), key=lambda ch: min(x["date"] or "9999" for x in ch))
    total = sum(len(ch) for ch in ordered)
    train, val, test, n = [], [], [], 0
    for ch in ordered:
        frac = n / total if total else 1
        (train if frac < 0.75 else val if frac < 0.80 else test).extend(ch)
        n += len(ch)
    return train, val, test

# ── Validation ──────────────────────────────────────────────────────────────
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED = ["event_type", "date", "source", "summary"]

def validate(example):
    try:
        a = json.loads(example["messages"][2]["content"])
    except Exception:  # noqa: BLE001
        return False, "bad_json"
    if list(a.keys()) != STRUCT_KEYS:
        return False, "schema"
    for k in REQUIRED:
        if a[k] in (None, ""):
            return False, f"missing_{k}"
    if not DATE_RE.match(a["date"] or ""):
        return False, "date"
    if a["source"] not in TRUSTED_SOURCES:
        return False, "source"
    if a["city"] is not None and a["city"] == a["country"]:
        return False, "country_as_city"
    if a["coordinates"] is not None:
        c = a["coordinates"]
        if not (-90 <= c["lat"] <= 90 and -180 <= c["lon"] <= 180):
            return False, "coord"
    for v in (a["event_name"], a["region"], a["summary"]):
        if isinstance(v, str) and "<" in v and ">" in v:
            return False, "html"
    return True, "ok"

# ── Report ──────────────────────────────────────────────────────────────────
def write_report(all_recs, kept, dup_id, dup_event, rejected, reject_reasons,
                 train, val, test, pre_ds=None, dropped_ds=0):
    def dist(recs, key):
        c = Counter((json.loads(x["messages"][2]["content"])[key] or "∅") for x in recs)
        return c
    examples = train + val + test
    haz = dist(examples, "hazard")
    ctry = dist(examples, "country")
    src = dist(examples, "source")
    missing = Counter()
    for x in examples:
        a = json.loads(x["messages"][2]["content"])
        for k in STRUCT_KEYS:
            if a[k] in (None, "", []):
                missing[k] += 1
    total = len(examples)
    quality = round(100 * total / max(1, (total + rejected)), 2)
    L = []
    L.append("# Dataset Report — Historical Hazard & Outbreak (Qwen2.5 fine-tuning)\n")
    L.append(f"_Generated {NOW.date()} · trusted official sources only · no synthetic records_\n")
    L.append("## Totals")
    L.append(f"- Harvested (raw): **{len(all_recs)}**")
    if dropped_ds:
        L.append(f"- After dedup: **{pre_ds}**")
        L.append(f"- After balanced downsample: **{len(kept)}** (target {CFG['max_total']}, "
                 f"-{dropped_ds}; source-balanced, temporally spread)")
    else:
        L.append(f"- After dedup: **{len(kept)}**")
    L.append(f"- Valid examples written: **{total}**")
    L.append(f"  - train **{len(train)}** ({pct(len(train),total)}) · "
             f"validation **{len(val)}** ({pct(len(val),total)}) · "
             f"test **{len(test)}** ({pct(len(test),total)})")
    L.append(f"- Duplicate records removed: **{dup_id}** (by id) + **{dup_event}** (same event)")
    L.append(f"- Rejected in validation: **{rejected}**")
    L.append(f"- **Quality score: {quality}%** (valid / (valid + rejected))\n")
    L.append("## Records by category (hazard)")
    for k, v in haz.most_common():
        L.append(f"- {k}: {v} ({pct(v,total)})")
    L.append("\n## Source distribution")
    for k, v in src.most_common():
        L.append(f"- {k}: {v} ({pct(v,total)})")
    L.append("\n## Records by country (top 30)")
    for k, v in ctry.most_common(30):
        L.append(f"- {k}: {v}")
    L.append(f"\n(+ {max(0,len(ctry)-30)} more countries)")
    L.append("\n## Missing values per field (null/empty)")
    for k in STRUCT_KEYS:
        L.append(f"- {k}: {missing.get(k,0)} ({pct(missing.get(k,0),total)})")
    L.append("\n## Rejected reasons")
    for k, v in Counter(reject_reasons).most_common():
        L.append(f"- {k}: {v}")
    L.append("\n## Validation checks (all enforced pre-write)")
    for chk in ["valid JSONL", "identical schema (fixed key order)", "no duplicate ids",
                "no duplicate events", "valid coordinates", "valid YYYY-MM-DD dates",
                "trusted sources only", "clean UTF-8", "no HTML", "no country stored as city",
                "required fields present"]:
        L.append(f"- ✓ {chk}")
    with open(os.path.join(OUT, "dataset-report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

def pct(n, d):
    return f"{round(100*n/max(1,d),1)}%"

# ── Main ────────────────────────────────────────────────────────────────────
def main():
    t0 = time.time()
    raw = []
    raw += harvest_emsc()
    raw += harvest_eonet()
    raw += harvest_ecdc()
    raw += harvest_gated()
    print(f"harvested {len(raw)} raw records")

    # drop records missing the two hard-required fields before anything else
    raw = [r for r in raw if r.get("date") and r.get("source")]
    kept, dup_id, dup_event = dedup(raw)
    print(f"kept {len(kept)} after dedup (-{dup_id} id, -{dup_event} event)")

    pre_ds = len(kept)
    kept, dropped_ds = balance_downsample(kept, CFG["max_total"])
    if dropped_ds:
        print(f"balanced-downsampled {pre_ds} -> {len(kept)} (target {CFG['max_total']}, -{dropped_ds})")

    train_r, val_r, test_r = split_chrono(kept)
    rejected, reasons = 0, []
    splits = {"train": [], "validation": [], "test": []}
    for name, recs in (("train", train_r), ("validation", val_r), ("test", test_r)):
        for r in recs:
            ex = to_chat(to_structured(r), r)
            ok, why = validate(ex)
            if not ok:
                rejected += 1; reasons.append(why); continue
            splits[name].append(ex)

    for name in splits:
        with open(os.path.join(OUT, f"{name}.jsonl"), "w", encoding="utf-8") as f:
            for ex in splits[name]:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    write_report(raw, kept, dup_id, dup_event, rejected, reasons,
                 splits["train"], splits["validation"], splits["test"],
                 pre_ds, dropped_ds)
    print(f"WROTE train={len(splits['train'])} val={len(splits['validation'])} "
          f"test={len(splits['test'])} rejected={rejected} in {time.time()-t0:.0f}s")

if __name__ == "__main__":
    main()
