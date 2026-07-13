# Feature Dictionary

| feature | type | source | description |
|---|---|---|---|
| `week` | int | derived from report date | ISO week number (1–53) |
| `month` | int | derived | calendar month (1–12) |
| `year` | int | derived | calendar year |
| `season` | categorical | derived from month | N-hemisphere meteorological season |
| `country` | categorical | pycountry | country name |
| `iso3` | categorical | pycountry | ISO 3166-1 alpha-3 code |
| `continent` | categorical | pycountry_convert | continent |
| `latitude` | float | geojson centroid | country centroid latitude |
| `longitude` | float | geojson centroid | country centroid longitude |
| `disease_name` | categorical | WHO-DON title | normalized disease name |
| `disease_category` | categorical | keyword mapping | disease group |
| `current_cases` | float | WHO-DON text | cumulative reported cases as of week t |
| `current_deaths` | float | WHO-DON text | cumulative reported deaths as of week t |
| `current_case_fatality_rate` | float | derived | deaths/cases as of t |
| `cases_last_week` | float | derived | new reported cases in the latest week |
| `cases_last_2_weeks` | float | derived | sum of new cases over last 2 weeks |
| `cases_last_4_weeks` | float | derived | sum of new cases over last 4 weeks |
| `rolling_mean_4w` | float | derived | mean weekly new cases, last 4w |
| `rolling_mean_8w` | float | derived | mean weekly new cases, last 8w |
| `rolling_std_4w` | float | derived | std of weekly new cases, last 4w |
| `weekly_growth_rate` | float | derived | (new_t - new_{t-1}) / new_{t-1} |
| `weekly_death_growth_rate` | float | derived | weekly growth of new deaths |
| `trend_direction` | int | derived | sign(roll4 - roll8): -1/0/1 |
| `weeks_since_last_outbreak` | float | derived | weeks since last WHO-DON report |
| `active_outbreak` | int | derived | report within last 4 weeks (0/1) |
| `historical_peak_cases` | float | derived | max cumulative cases seen so far |
| `historical_peak_deaths` | float | derived | max cumulative deaths so far |
| `neighbouring_countries_with_active_outbreak` | int | geojson adjacency + WHO-DON | count of land-border neighbours active in week t |
| `regional_cases` | float | derived | sum of new cases in the continent, week t |
| `regional_growth_rate` | float | derived | weekly growth of regional cases |
| `population` | float | World Bank | country population (most recent) |
| `population_density` | float | World Bank + geojson area | population / land area (km²) |

## Targets
- `future_outbreak` — **binary**: 1 if a new WHO-DON report lands in weeks t+1..t+4, else 0.
- `future_cases_4w` — **regression**: reported new cases summed over weeks t+1..t+4.
