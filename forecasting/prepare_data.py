"""
prepare_data.py
===============

Turns raw historical crisis-event records into weekly time-series that a
forecasting model can consume.

Pipeline
--------
1. Read a JSON (array) or JSONL (one object per line) dataset.
2. Parse and sort the event dates.
3. Group records by (country, event_type).
4. Count how many events happened per ISO week.
5. Fill any missing weeks in each group's range with zero.
6. Emit a numeric weekly series per (country, event_type).

IMPORTANT (what this represents)
--------------------------------
The series is a *frequency* signal: "how many events of this type occurred in
this country each week". It says nothing about WHERE inside the country an event
happened. Latitude/longitude/city are kept in the raw data for reference but are
NOT used to build the series — the model downstream forecasts future event
*counts*, not geographic spread.

Run directly to inspect the parsed series:
    python prepare_data.py
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import pandas as pd

# Default dataset shipped with the prototype. Override with the FORECAST_DATA_PATH
# environment variable to point at the real project export.
DEFAULT_DATA_PATH = os.environ.get(
    "FORECAST_DATA_PATH",
    os.path.join(os.path.dirname(__file__), "data", "sample_events.jsonl"),
)

# Required fields for a usable record. Everything else (city, lat/lng, severity,
# description) is optional and ignored when building the frequency series.
REQUIRED_FIELDS = ("event_type", "date", "country")

# Weeks are anchored to Monday so every group lands on the same weekly grid.
# We floor each date to the Monday of its week and step the grid by 7 days, so
# the event buckets and the zero-fill grid always align (using pandas' "W-MON"
# period vs. date_range anchors would land on different days and mis-align).
WEEK_STEP = "7D"


@dataclass
class WeeklySeries:
    """One numeric weekly frequency series for a (country, event_type) pair."""

    country: str
    event_type: str
    dates: list[str] = field(default_factory=list)   # ISO week-start dates (Mondays)
    counts: list[int] = field(default_factory=list)   # events observed that week

    def to_dict(self) -> dict[str, Any]:
        return {
            "country": self.country,
            "event_type": self.event_type,
            "dates": self.dates,
            "counts": self.counts,
        }


def load_events(path: str = DEFAULT_DATA_PATH) -> list[dict[str, Any]]:
    """
    Read events from a .json array or a .jsonl file.

    Raises FileNotFoundError if the path is missing and ValueError if the file
    cannot be parsed — callers surface these as clear API errors.
    """
    if not os.path.exists(path):
        raise FileNotFoundError(f"Dataset not found: {path}")

    text = open(path, "r", encoding="utf-8").read().strip()
    if not text:
        return []

    records: list[dict[str, Any]] = []
    if path.lower().endswith(".jsonl"):
        for line_no, line in enumerate(text.splitlines(), start=1):
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise ValueError(f"Invalid JSON on line {line_no} of {path}: {exc}") from exc
    else:
        try:
            data = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Invalid JSON file {path}: {exc}") from exc
        # Accept either a bare array or an object with a top-level "events" key.
        if isinstance(data, dict) and "events" in data:
            data = data["events"]
        if not isinstance(data, list):
            raise ValueError(f"Expected a JSON array of events in {path}")
        records = data

    return records


def _clean_records(records: list[dict[str, Any]]) -> pd.DataFrame:
    """Validate, parse dates, and drop unusable rows. Returns a tidy DataFrame."""
    rows = []
    for rec in records:
        if not isinstance(rec, dict):
            continue
        if any(rec.get(f) in (None, "") for f in REQUIRED_FIELDS):
            continue  # skip records missing a required field
        parsed = pd.to_datetime(rec["date"], errors="coerce", utc=False)
        if pd.isna(parsed):
            continue  # skip unparseable dates
        rows.append(
            {
                "country": str(rec["country"]).strip(),
                "event_type": str(rec["event_type"]).strip(),
                "date": parsed.normalize(),
            }
        )

    df = pd.DataFrame(rows, columns=["country", "event_type", "date"])
    if not df.empty:
        df = df.sort_values("date").reset_index(drop=True)
    return df


def build_weekly_series(
    records: list[dict[str, Any]] | None = None,
    path: str = DEFAULT_DATA_PATH,
) -> list[WeeklySeries]:
    """
    Build one zero-filled weekly frequency series per (country, event_type).

    Pass `records` to use an in-memory list, or leave it None to read `path`.
    """
    if records is None:
        records = load_events(path)

    df = _clean_records(records)
    series: list[WeeklySeries] = []
    if df.empty:
        return series

    # Weekly bucket = the Monday of each event's week (weekday: Monday == 0).
    df["week"] = df["date"] - pd.to_timedelta(df["date"].dt.weekday, unit="D")

    for (country, event_type), group in df.groupby(["country", "event_type"], sort=True):
        counts = group.groupby("week").size()
        # Reindex to a continuous weekly range so missing weeks become zeros.
        full_index = pd.date_range(counts.index.min(), counts.index.max(), freq=WEEK_STEP)
        counts = counts.reindex(full_index, fill_value=0)
        series.append(
            WeeklySeries(
                country=country,
                event_type=event_type,
                dates=[d.strftime("%Y-%m-%d") for d in counts.index],
                counts=[int(v) for v in counts.values],
            )
        )
    return series


def next_week_dates(last_date: str, horizon: int) -> list[str]:
    """Return the `horizon` Monday-anchored week-start dates after `last_date`."""
    start = datetime.strptime(last_date, "%Y-%m-%d")
    return [(start + timedelta(weeks=i)).strftime("%Y-%m-%d") for i in range(1, horizon + 1)]


if __name__ == "__main__":
    built = build_weekly_series()
    print(f"Loaded dataset: {DEFAULT_DATA_PATH}")
    print(f"Built {len(built)} (country, event_type) weekly series:\n")
    for s in built:
        print(f"  {s.country} / {s.event_type}: {len(s.counts)} weeks -> {s.counts}")
