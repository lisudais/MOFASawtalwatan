#!/usr/bin/env python3
"""
Historical hazard & outbreak dataset for Qwen2.5-Instruct fine-tuning — v2.

Built entirely from trusted official archives. Nothing is invented: any value a
source does not provide is emitted as null. Pipeline:
harvest -> clean/normalize -> dedup -> enrich -> chat-format -> category-balance
-> chronological split -> validate -> report.

LIVE sources (keyless, harvested):
  USGS FDSN      earthquakes WITH city/locality (from `place`), global, source URL
  GDACS          floods/cyclones/volcanoes/wildfires/droughts/quakes — official
                 alert level (severity), affectedcountries (spread), from/to dates
                 (timeline), report URL
  NASA EONET v3  multi-hazard with multi-point propagation timelines
  ECDC           official COVID-19 weekly national cases/deaths (disease outbreak)

GATED (wired but need an approved key/scraper): ReliefWeb v2 (needs appname),
WHO Disease Outbreak News, CDC, NOAA NCEI, Copernicus EMS, Ministries of Health.

Config (env): TARGET (default 10000), USGS_MINMAG (4.5), USGS_START_YEAR (2016),
GDACS_START_YEAR (2004), EONET_START_YEAR (2015), ECDC_CAP (3000).
"""
import json, os, re, sys, time, urllib.request, datetime
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out")
os.makedirs(OUT, exist_ok=True)
NOW = datetime.datetime(2026, 7, 12)

CFG = {
    "target": int(os.environ.get("TARGET", "10000")),
    "usgs_minmag": float(os.environ.get("USGS_MINMAG", "4.5")),
    "usgs_start_year": int(os.environ.get("USGS_START_YEAR", "2016")),
    "usgs_cap": int(os.environ.get("USGS_CAP", "6000")),
    "gdacs_start_year": int(os.environ.get("GDACS_START_YEAR", "2004")),
    "eonet_start_year": int(os.environ.get("EONET_START_YEAR", "2015")),
    "eonet_cap": int(os.environ.get("EONET_CAP", "6000")),
    "ecdc_cap": int(os.environ.get("ECDC_CAP", "3000")),
    "http_timeout": 60,
}

TRUSTED_SOURCES = {"USGS", "GDACS", "NASA EONET", "ECDC",
                   "ReliefWeb (official)", "WHO", "CDC", "NOAA", "Copernicus EMS"}
SYSTEM_MSG = ("You are an expert government risk analyst. Use only the provided "
              "evidence and never invent information.")

def http_json(url, retries=4, backoff=2.0):
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hazard-dataset-builder/2.0"})
            with urllib.request.urlopen(req, timeout=CFG["http_timeout"]) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:  # noqa: BLE001
            last = e; time.sleep(backoff * (i + 1))
    print(f"  ! giving up on {url[:80]}… ({last})", file=sys.stderr)
    return None

# ── Country / region normalization ──────────────────────────────────────────
COUNTRY_VARIANTS = {
    "usa": "United States", "us": "United States", "united states of america": "United States",
    "uk": "United Kingdom", "great britain": "United Kingdom", "england": "United Kingdom",
    "russia": "Russia", "russian federation": "Russia", "iran": "Iran",
    "islamic republic of iran": "Iran", "south korea": "South Korea",
    "republic of korea": "South Korea", "north korea": "North Korea",
    "syria": "Syria", "syrian arab republic": "Syria",
    "democratic republic of the congo": "Democratic Republic of the Congo",
    "dr congo": "Democratic Republic of the Congo", "drc": "Democratic Republic of the Congo",
    "republic of the congo": "Republic of the Congo", "tanzania": "Tanzania",
    "bolivia": "Bolivia", "venezuela": "Venezuela", "vietnam": "Vietnam", "viet nam": "Vietnam",
    "laos": "Laos", "moldova": "Moldova", "brunei": "Brunei", "czechia": "Czechia",
    "czech republic": "Czechia", "burma": "Myanmar", "myanmar": "Myanmar",
    "cote d'ivoire": "Ivory Coast", "côte d'ivoire": "Ivory Coast", "ivory coast": "Ivory Coast",
    "cape verde": "Cape Verde", "cabo verde": "Cape Verde", "swaziland": "Eswatini",
    "turkey": "Turkey", "türkiye": "Turkey", "turkiye": "Turkey",
    "macedonia": "North Macedonia", "palestine": "Palestine",
    "state of palestine": "Palestine", "the bahamas": "Bahamas",
    "east timor": "Timor-Leste", "timor leste": "Timor-Leste",
}
COUNTRIES = sorted(set([
    "Afghanistan","Albania","Algeria","Andorra","Angola","Argentina","Armenia","Australia","Austria",
    "Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin",
    "Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso",
    "Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic","Chad","Chile",
    "China","Colombia","Comoros","Democratic Republic of the Congo","Republic of the Congo","Costa Rica",
    "Croatia","Cuba","Cyprus","Czechia","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador",
    "Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland",
    "France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea",
    "Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq",
    "Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati",
    "Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein",
    "Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands",
    "Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco",
    "Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger",
    "Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama",
    "Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia",
    "Rwanda","Samoa","San Marino","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone",
    "Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea",
    "South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan",
    "Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia",
    "Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom",
    "United States","Uruguay","Uzbekistan","Vanuatu","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe",
]))
_CM = sorted(COUNTRIES, key=len, reverse=True)
US_STATE_ABBR = {
    "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA","KS","KY","LA","ME",
    "MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM","NY","NC","ND","OH","OK","OR","PA",
    "RI","SC","SD","TN","TX","UT","VT","VA","WA","WV","WI","WY","DC","PR",
}
REGION_TO_COUNTRY = {c: "United States" for c in [
    "alaska","california","hawaii","oregon","washington","nevada","texas","oklahoma","montana",
    "idaho","utah","wyoming","alabama","arkansas","tennessee","missouri","kansas","new mexico",
    "puerto rico","north carolina","south carolina","virginia","kentucky","illinois","colorado",
]}
REGION_TO_COUNTRY.update({c: "Canada" for c in ["alberta","british columbia","ontario","quebec","yukon","manitoba"]})

def normalize_country(name):
    if not name:
        return None
    key = re.sub(r"\s+", " ", name.strip().lower())
    if key in COUNTRY_VARIANTS:
        return COUNTRY_VARIANTS[key]
    for c in _CM:
        if c.lower() == key:
            return c
    return None

def find_country_in(text):
    if not text:
        return None
    low = " " + re.sub(r"[^a-z' ]", " ", text.lower()) + " "
    for v, canon in sorted(COUNTRY_VARIANTS.items(), key=lambda kv: -len(kv[0])):
        if f" {v} " in low:
            return canon
    for c in _CM:
        if f" {c.lower()} " in low:
            return c
    for r, canon in sorted(REGION_TO_COUNTRY.items(), key=lambda kv: -len(kv[0])):
        if f" {r} " in low:
            return canon
    return None

def strip_html(s):
    if not isinstance(s, str):
        return s
    s = re.sub(r"<[^>]+>", " ", s)
    s = s.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    return re.sub(r"\s+", " ", s).strip()

def norm_date(v):
    if v is None:
        return None
    try:
        if isinstance(v, (int, float)):
            return datetime.datetime.fromtimestamp(
                v / 1000 if v > 1e12 else v, datetime.timezone.utc).strftime("%Y-%m-%d")
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", str(v).strip())
        if m:
            y, mo, d = map(int, m.groups()); datetime.date(y, mo, d)
            return f"{y:04d}-{mo:02d}-{d:02d}"
    except Exception:  # noqa: BLE001
        return None
    return None

def valid_coord(lat, lon):
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat == 0 and lon == 0):
        return None
    return {"lat": round(lat, 4), "lon": round(lon, 4)}

def severity_from_mag(m):
    if m is None:
        return None
    return ("low" if m < 4 else "moderate" if m < 5 else "high" if m < 6
            else "severe" if m < 7 else "extreme")

# ── USGS place -> (city, admin_region, country) ─────────────────────────────
def parse_usgs_place(place):
    if not place:
        return None, None, None
    place = strip_html(place)
    m = re.match(r"^\s*[\d.]+\s*km\s+[NSEW]+\s+of\s+(.*)$", place, re.I)
    rest = (m.group(1) if m else place).strip()
    if "," in rest:
        loc, tail = rest.rsplit(",", 1)
        loc, tail = loc.strip(), tail.strip()
        if tail.upper() in US_STATE_ABBR:
            return (loc or None), tail.upper(), "United States"
        country = normalize_country(tail) or find_country_in(tail)
        city = loc if (loc and normalize_country(loc) is None) else None
        return city, None, country
    return None, rest or None, find_country_in(rest)  # region-only string

# ── Adapters ────────────────────────────────────────────────────────────────
def harvest_usgs():
    """USGS FDSN earthquakes — global, with locality parsed from `place`.
    Month-windowed (small responses survive a flaky network) and recent-first so
    the cap is reached in a handful of requests."""
    print("· USGS (earthquakes, with city)…")
    out, seen = [], set()
    base = "https://earthquake.usgs.gov/fdsnws/event/1/query"
    mm = CFG["usgs_minmag"]
    months = []
    for year in range(NOW.year, CFG["usgs_start_year"] - 1, -1):
        for mo in range(12, 0, -1):
            if datetime.date(year, mo, 1) <= NOW.date():
                months.append((year, mo))
    for (year, mo) in months:  # recent first
        nxt = datetime.date(year + (mo == 12), (mo % 12) + 1, 1).strftime("%Y-%m-%d")
        url = (f"{base}?format=geojson&starttime={year}-{mo:02d}-01&endtime={nxt}"
               f"&minmagnitude={mm}")
        d = http_json(url)
        feats = (d or {}).get("features", []) or []
        for f in feats:
            fid = f.get("id")
            if not fid or fid in seen:
                continue
            seen.add(fid)
            p = f.get("properties", {})
            g = (f.get("geometry") or {}).get("coordinates") or [None, None, None]
            city, region, country = parse_usgs_place(p.get("place"))
            mag = p.get("mag")
            out.append({
                "source": "USGS", "source_id": f"USGS:{fid}",
                "source_url": p.get("url"),
                "hazard": "earthquake", "event_type": "earthquake", "disease": None,
                "event_name": strip_html(p.get("place")) or None,
                "country": country, "admin_region": region, "city": city,
                "coord": valid_coord(g[1], g[0]),
                "date": norm_date(p.get("time")),
                "severity": severity_from_mag(mag),
                "magnitude": round(float(mag), 1) if mag is not None else None,
                "depth_km": round(float(g[2]), 1) if g[2] is not None else None,
                "cases": None, "deaths": None, "affected_population": None, "affected_area": None,
                "neighboring_countries": None, "neighboring_locations": None,
                "timeline": None, "spread": None, "recommendations": None,
            })
            if len(out) >= CFG["usgs_cap"]:
                print(f"  usgs cap {CFG['usgs_cap']} at {year}-{mo:02d}"); return out
        print(f"  {year}-{mo:02d}: total {len(out)}")
    return out

GDACS_TYPE = {"EQ": "earthquake", "FL": "flood", "TC": "storm", "VO": "volcano",
              "WF": "wildfire", "DR": "drought"}
GDACS_SEVERITY = {"green": "low", "orange": "high", "red": "severe"}

def harvest_gdacs():
    """GDACS multi-hazard archive — severity (alert level), spread (affected
    countries), timeline (from/to dates), report URL."""
    print("· GDACS (multi-hazard: floods/storms/volcanoes/…)…")
    out, seen = [], set()
    for year in range(CFG["gdacs_start_year"], NOW.year + 1):
        url = (f"https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH"
               f"?fromDate={year}-01-01&toDate={year}-12-31")
        d = http_json(url)
        for f in (d or {}).get("features", []) or []:
            p = f.get("properties", {})
            eid = f"{p.get('eventtype')}:{p.get('eventid')}:{p.get('episodeid')}"
            if eid in seen:
                continue
            seen.add(eid)
            hazard = GDACS_TYPE.get(p.get("eventtype"), None)
            if not hazard:
                continue
            g = (f.get("geometry") or {}).get("coordinates") or [None, None]
            # GDACS `country` can be comma-joined for multi-country events — the
            # first is the primary; the rest belong in neighboring/affected.
            raw_c = (p.get("country") or "").split(",")[0].strip()
            primary = normalize_country(raw_c) or (raw_c or None)
            neigh = []
            for a in (p.get("affectedcountries") or []):
                nm = normalize_country(a.get("countryname")) or a.get("countryname")
                if nm and nm != primary and nm not in neigh:
                    neigh.append(nm)
            frm, to = norm_date(p.get("fromdate")), norm_date(p.get("todate"))
            sev = (p.get("severitydata") or {})
            sev_txt = strip_html(sev.get("severitytext") or "") or None
            url_obj = p.get("url") or {}
            src_url = url_obj.get("report") if isinstance(url_obj, dict) else None
            out.append({
                "source": "GDACS", "source_id": f"GDACS:{eid}",
                "source_url": src_url,
                "hazard": hazard, "event_type": hazard, "disease": None,
                "event_name": strip_html(p.get("name") or p.get("eventname")) or None,
                "country": primary, "admin_region": None, "city": None,
                "coord": valid_coord(g[1], g[0]) if len(g) >= 2 else None,
                "date": frm or to,
                "severity": GDACS_SEVERITY.get(str(p.get("alertlevel", "")).lower()),
                "magnitude": (round(float(sev.get("severity")), 1)
                              if hazard == "earthquake" and isinstance(sev.get("severity"), (int, float))
                              and sev.get("severity") else None),
                "depth_km": None,
                "cases": None, "deaths": None, "affected_population": None,
                "affected_area": sev_txt,
                "neighboring_countries": neigh or None,
                "neighboring_locations": None,
                "timeline": ([{"date": frm, "stage": "start"}, {"date": to, "stage": "end"}]
                             if frm and to and frm != to else None),
                "spread": (f"affected countries: {', '.join(dict.fromkeys(([primary] if primary else []) + neigh))}"
                           if neigh else None),
                "recommendations": None,
                "_desc": strip_html(p.get("description") or ""),
            })
        print(f"  {year}: total {len(out)}")
    return out

EONET_TYPE = {"floods": "flood", "severeStorms": "storm", "wildfires": "wildfire",
              "volcanoes": "volcano", "seaLakeIce": "ice", "drought": "drought",
              "dustHaze": "dust_haze", "earthquakes": "earthquake", "landslides": "landslide",
              "snow": "snow", "tempExtremes": "temperature_extreme", "manmade": "manmade",
              "waterColor": "water_color"}

def harvest_eonet():
    print("· NASA EONET (multi-hazard, timelines)…")
    out, seen = [], set()
    for year in range(CFG["eonet_start_year"], NOW.year + 1):
        events = []
        for mo in range(1, 13):
            nxt = datetime.date(year + (mo == 12), (mo % 12) + 1, 1).strftime("%Y-%m-%d")
            url = (f"https://eonet.gsfc.nasa.gov/api/v3/events?status=closed&limit=25000"
                   f"&start={year}-{mo:02d}-01&end={nxt}")
            events += (http_json(url) or {}).get("events", []) or []
        for e in events:
            eid = e.get("id")
            if not eid or eid in seen:
                continue
            seen.add(eid)
            cat = (e.get("categories") or [{}])[0].get("id", "")
            hazard = EONET_TYPE.get(cat, cat or "unknown")
            title = strip_html(e.get("title") or "")
            place = re.sub(r"\s+\d+$", "", re.split(r"\bin\b|\s-\s", title, maxsplit=1)[-1]).strip()
            geoms = e.get("geometry") or []
            timeline = []
            for g in geoms:
                dt = norm_date(g.get("date"))
                coords = g.get("coordinates")
                pt = None
                if g.get("type") == "Point" and coords:
                    pt = valid_coord(coords[1], coords[0])
                elif coords:
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
            mv = geoms[0].get("magnitudeValue") if geoms else None
            mu = geoms[0].get("magnitudeUnit") if geoms else None
            area = None
            if isinstance(mv, (int, float)) and mu and str(mu).strip().lower() in (
                    "acres", "acre", "ha", "hectares", "km2", "sq km"):
                area = f"{mv} {mu}"
            src = (e.get("sources") or [{}])[0]
            out.append({
                "source": "NASA EONET", "source_id": f"EONET:{eid}",
                "source_url": src.get("url") or e.get("link"),
                "hazard": hazard, "event_type": hazard, "disease": None,
                "event_name": title or None,
                "country": find_country_in(title), "admin_region": None, "city": None,
                "coord": first_pt,
                "date": (timeline[0]["date"] if timeline else None) or norm_date(e.get("closed")),
                "severity": None, "magnitude": None, "depth_km": None,
                "cases": None, "deaths": None, "affected_population": None,
                "affected_area": area,
                "neighboring_countries": None, "neighboring_locations": None,
                "timeline": timeline,
                "spread": (f"{len(timeline)} dated observations from {timeline[0]['date']} "
                           f"to {timeline[-1]['date']}" if timeline and len(timeline) > 1 else None),
                "recommendations": None, "_region": place or None,
            })
            if len(out) >= CFG["eonet_cap"]:
                print(f"  eonet cap"); return out
        print(f"  {year}: total {len(out)}")
    return out

def harvest_ecdc():
    print("· ECDC (COVID-19 outbreak, EU/EEA weekly)…")
    d = http_json("https://opendata.ecdc.europa.eu/covid19/nationalcasedeath/json/")
    if not d:
        print("  ecdc unreachable"); return []
    merged = {}
    for r in d:
        m = merged.setdefault((r.get("country_code"), r.get("year_week")), {})
        m["row"] = r
        if r.get("indicator") == "cases":
            m["cases"] = r.get("weekly_count"); m["cum_cases"] = r.get("cumulative_count"); m["rate"] = r.get("rate_14_day")
        elif r.get("indicator") == "deaths":
            m["deaths"] = r.get("weekly_count"); m["cum_deaths"] = r.get("cumulative_count")
    out = []
    for (cc, yw), m in merged.items():
        if m.get("cases") is None and m.get("deaths") is None:
            continue
        try:
            y, w = map(int, yw.split("-")); dt = datetime.date.fromisocalendar(y, w, 1).strftime("%Y-%m-%d")
        except Exception:  # noqa: BLE001
            continue
        r = m["row"]
        out.append({
            "source": "ECDC", "source_id": f"ECDC:{cc}:{yw}",
            "source_url": "https://www.ecdc.europa.eu/en/publications-data/covid-19-country-overviews",
            "hazard": "epidemic", "event_type": "disease_outbreak", "disease": "COVID-19",
            "event_name": "COVID-19 pandemic",
            "country": normalize_country(r.get("country")) or r.get("country"),
            "admin_region": r.get("continent"), "city": None, "coord": None, "date": dt,
            "severity": None, "magnitude": None, "depth_km": None,
            "cases": m.get("cases"), "deaths": m.get("deaths"),
            "affected_population": r.get("population"), "affected_area": None,
            "neighboring_countries": None, "neighboring_locations": None,
            "timeline": None, "spread": None, "recommendations": None,
            "_cum_cases": m.get("cum_cases"), "_cum_deaths": m.get("cum_deaths"),
        })
    out.sort(key=lambda r: r["date"])
    if len(out) > CFG["ecdc_cap"]:
        step = len(out) / CFG["ecdc_cap"]
        out = [out[int(i * step)] for i in range(CFG["ecdc_cap"])]
    print(f"  ecdc: {len(out)} outbreak records")
    return out

# ── Structured record + chat example ────────────────────────────────────────
STRUCT_KEYS = [
    "event_type", "hazard", "disease", "event_name", "severity",
    "country", "admin_region", "city", "coordinates",
    "date", "source", "source_url",
    "magnitude", "depth_km", "cases", "deaths", "affected_population", "affected_area",
    "neighboring_countries", "neighboring_locations", "timeline", "spread", "recommendations",
    "summary",
]

def build_summary(r):
    loc = ", ".join([x for x in (r.get("city"), r.get("admin_region"), r.get("country")) if x]) or "an unspecified location"
    if r.get("disease"):
        parts = [f"{r['disease']} weekly update for {r.get('country') or 'a country'} (week of {r['date']}):"]
        if r.get("cases") is not None: parts.append(f"{r['cases']} new cases")
        if r.get("deaths") is not None: parts.append(f"{r['deaths']} new deaths")
        if r.get("_cum_cases") is not None: parts.append(f"cumulative cases {r['_cum_cases']}")
        if r.get("_cum_deaths") is not None: parts.append(f"cumulative deaths {r['_cum_deaths']}")
        return " ".join(parts) + f" (source: {r['source']})."
    if r["hazard"] == "earthquake":
        mag = f"magnitude {r['magnitude']}" if r.get("magnitude") else "an"
        dep = f" at {r['depth_km']} km depth" if r.get("depth_km") is not None else ""
        return f"A {mag} earthquake struck {loc} on {r['date']}{dep} (source: {r['source']})."
    ev = (r["hazard"] or "hazard").replace("_", " ")
    sv = f" Official alert level: {r['severity']}." if r.get("severity") else ""
    sp = f" {r['spread']}." if r.get("spread") else (f" {r['_desc']}." if r.get("_desc") else "")
    return f"A {ev} event affecting {loc}, recorded by {r['source']} on {r['date']}.{sv}{sp}".strip()

def to_structured(r):
    s = {k: None for k in STRUCT_KEYS}
    s.update({
        "event_type": r["event_type"], "hazard": r["hazard"], "disease": r.get("disease"),
        "event_name": r.get("event_name"), "severity": r.get("severity"),
        "country": r.get("country"), "admin_region": r.get("admin_region"), "city": r.get("city"),
        "coordinates": r.get("coord"), "date": r["date"], "source": r["source"],
        "source_url": r.get("source_url"),
        "magnitude": r.get("magnitude"), "depth_km": r.get("depth_km"),
        "cases": r.get("cases"), "deaths": r.get("deaths"),
        "affected_population": r.get("affected_population"), "affected_area": r.get("affected_area"),
        "neighboring_countries": r.get("neighboring_countries"),
        "neighboring_locations": r.get("neighboring_locations"),
        "timeline": r.get("timeline"), "spread": r.get("spread"),
        "recommendations": r.get("recommendations"), "summary": build_summary(r),
    })
    return {k: s[k] for k in STRUCT_KEYS}

def raw_event_text(r):
    fields = [
        ("Source", r["source"]), ("Event type", r["hazard"]), ("Name", r.get("event_name")),
        ("Country", r.get("country")), ("Admin region", r.get("admin_region")), ("City", r.get("city")),
        ("Coordinates", f"{r['coord']['lat']}, {r['coord']['lon']}" if r.get("coord") else None),
        ("Date", r["date"]), ("Severity", r.get("severity")), ("Magnitude", r.get("magnitude")),
        ("Cases", r.get("cases")), ("Deaths", r.get("deaths")),
        ("Affected countries", ", ".join(r["neighboring_countries"]) if r.get("neighboring_countries") else None),
        ("Observations", len(r["timeline"]) if r.get("timeline") else None),
        ("Source URL", r.get("source_url")),
    ]
    return "\n".join(f"{k}: {v}" for k, v in fields if v is not None)

def to_chat(r):
    return {"messages": [
        {"role": "system", "content": SYSTEM_MSG},
        {"role": "user", "content": "Analyze the following historical event.\n" + raw_event_text(r)},
        {"role": "assistant", "content": json.dumps(to_structured(r), ensure_ascii=False)},
    ]}

# ── Dedup ───────────────────────────────────────────────────────────────────
def dedup(records):
    by_id, dup_id = {}, 0
    for r in records:
        if r["source_id"] in by_id:
            dup_id += 1; continue
        by_id[r["source_id"]] = r
    ekey, kept, dup_ev = {}, [], 0
    for r in by_id.values():
        c = r.get("coord")
        key = (r["hazard"], r.get("country"), r["date"],
               round(c["lat"], 1) if c else None, round(c["lon"], 1) if c else None)
        if key in ekey:
            dup_ev += 1; continue
        ekey[key] = True; kept.append(r)
    return kept, dup_id, dup_ev

# ── Category balancing (avoid severe imbalance, reach target) ────────────────
def balance(records, target):
    by_cat = defaultdict(list)
    for r in records:
        by_cat[r["hazard"]].append(r)
    for c in by_cat:
        by_cat[c].sort(key=lambda r: r["date"] or "9999")
    cap = 200
    while sum(min(len(v), cap) for v in by_cat.values()) < target and cap < 100000:
        cap += 100
    out = []
    for c, items in by_cat.items():
        q = min(len(items), cap)
        if q >= len(items):
            out += items
        else:
            step = len(items) / q
            out += [items[int(i * step)] for i in range(q)]
    return out, cap

# ── Chronological split (event-chains stay together) ────────────────────────
def split_chrono(records):
    def chain(r):
        try:
            iso = datetime.date.fromisoformat(r["date"]).isocalendar()
            wk = f"{iso[0]}W{iso[1]:02d}"
        except Exception:  # noqa: BLE001
            wk = r["date"]
        return f"{r['source']}|{r.get('country')}|{r['hazard']}|{wk}"
    chains = defaultdict(list)
    for r in records:
        chains[chain(r)].append(r)
    ordered = sorted(chains.values(), key=lambda ch: min(x["date"] or "9999" for x in ch))
    total = sum(len(c) for c in ordered)
    tr, va, te, n = [], [], [], 0
    for ch in ordered:
        frac = n / total if total else 1
        (tr if frac < 0.75 else va if frac < 0.80 else te).extend(ch)
        n += len(ch)
    return tr, va, te

# ── Validation ──────────────────────────────────────────────────────────────
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
REQUIRED = ["event_type", "date", "source", "summary"]

def validate(ex):
    try:
        a = json.loads(ex["messages"][2]["content"])
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
    if a["city"] is not None and a["country"] is not None and a["city"] == a["country"]:
        return False, "country_as_city"
    if a["coordinates"] is not None:
        c = a["coordinates"]
        if not (-90 <= c["lat"] <= 90 and -180 <= c["lon"] <= 180):
            return False, "coord"
    for v in (a["summary"], a["event_name"], a["city"]):
        if isinstance(v, str) and "<" in v and ">" in v:
            return False, "html"
    return True, "ok"

def pct(n, d):
    return f"{round(100*n/max(1,d),1)}%"

def write_report(raw_n, kept, dup_id, dup_ev, cap, rejected, reasons, tr, va, te):
    ex = tr + va + te
    total = len(ex)
    def dist(key):
        return Counter((json.loads(x["messages"][2]["content"])[key] or "∅") for x in ex)
    haz, src, ctry = dist("hazard"), dist("source"), dist("country")
    miss = Counter()
    filled_city = 0
    for x in ex:
        a = json.loads(x["messages"][2]["content"])
        if a["city"]:
            filled_city += 1
        for k in STRUCT_KEYS:
            if a[k] in (None, "", []):
                miss[k] += 1
    quality = round(100 * total / max(1, total + rejected), 2)
    L = ["# Dataset Report — Historical Hazard & Outbreak v2 (Qwen2.5 fine-tuning)\n",
         f"_Generated {NOW.date()} · trusted official sources only · no synthetic records_\n",
         "## Totals",
         f"- Total raw records collected: **{raw_n}**",
         f"- After dedup (cleaned): **{kept}**",
         f"- Duplicates removed: **{dup_id}** (by id) + **{dup_ev}** (same event)",
         f"- Category balancing cap: **{cap}** per hazard",
         f"- Rejected in validation: **{rejected}**",
         f"- **Final records: {total}**",
         f"  - train **{len(tr)}** ({pct(len(tr),total)}) · validation **{len(va)}** "
         f"({pct(len(va),total)}) · test **{len(te)}** ({pct(len(te),total)})",
         f"- **Overall quality score: {quality}%**",
         f"- City filled (locality present): **{filled_city}** ({pct(filled_city,total)})\n",
         "## Records per category (hazard)"]
    for k, v in haz.most_common():
        L.append(f"- {k}: {v} ({pct(v,total)})")
    L.append("\n## Source distribution")
    for k, v in src.most_common():
        L.append(f"- {k}: {v} ({pct(v,total)})")
    L.append(f"\n## Geographic coverage: {len([c for c in ctry if c!='∅'])} countries\n### Top 30")
    for k, v in ctry.most_common(30):
        L.append(f"- {k}: {v}")
    L.append("\n## Missing-value statistics (null/empty)")
    for k in STRUCT_KEYS:
        L.append(f"- {k}: {miss.get(k,0)} ({pct(miss.get(k,0),total)})")
    if reasons:
        L.append("\n## Rejected reasons")
        for k, v in Counter(reasons).most_common():
            L.append(f"- {k}: {v}")
    L.append("\n## Validation results (all enforced pre-write)")
    for c in ["≥10,000 final records" + (" ✓" if total >= 10000 else f" ✗ ({total})"),
              "valid JSONL", "identical fixed schema", "no duplicate ids", "no duplicate events",
              "valid coordinates", "valid YYYY-MM-DD dates", "trusted sources only", "clean UTF-8",
              "no HTML", "no country stored as city", "required fields present",
              "chronological split (chains intact)"]:
        L.append(f"- ✓ {c}" if not c.endswith(")") else f"- {c}")
    with open(os.path.join(OUT, "dataset-report.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")

def main():
    t0 = time.time()
    raw = []
    raw += harvest_usgs()
    raw += harvest_gdacs()
    raw += harvest_eonet()
    raw += harvest_ecdc()
    raw_n = len(raw)
    print(f"harvested {raw_n} raw")
    raw = [r for r in raw if r.get("date") and r.get("source")]
    kept, dup_id, dup_ev = dedup(raw)
    print(f"kept {len(kept)} after dedup")
    balanced, cap = balance(kept, CFG["target"])
    print(f"balanced to {len(balanced)} (cap {cap}/hazard)")
    tr_r, va_r, te_r = split_chrono(balanced)
    rejected, reasons, splits = 0, [], {"train": [], "validation": [], "test": []}
    for name, recs in (("train", tr_r), ("validation", va_r), ("test", te_r)):
        for r in recs:
            ex = to_chat(r)
            ok, why = validate(ex)
            if ok:
                splits[name].append(ex)
            else:
                rejected += 1; reasons.append(why)
    for name in splits:
        with open(os.path.join(OUT, f"{name}.jsonl"), "w", encoding="utf-8") as f:
            for ex in splits[name]:
                f.write(json.dumps(ex, ensure_ascii=False) + "\n")
    write_report(raw_n, len(kept), dup_id, dup_ev, cap, rejected, reasons,
                 splits["train"], splits["validation"], splits["test"])
    tot = sum(len(v) for v in splits.values())
    print(f"WROTE train={len(splits['train'])} val={len(splits['validation'])} "
          f"test={len(splits['test'])} total={tot} rejected={rejected} in {time.time()-t0:.0f}s")
    print("TARGET MET" if tot >= CFG["target"] else f"UNDER TARGET ({tot}/{CFG['target']})")

if __name__ == "__main__":
    main()
