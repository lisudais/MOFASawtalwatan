# Feature Report — why each feature helps XGBoost

_Rows: 13720 · 145 countries · 241 diseases · 2004-02-02→2026-09-14_

### `week` (int)
- **Description:** ISO week number (1–53)
- **Source:** derived from report date
- **Why it helps:** captures intra-year epidemic timing

### `month` (int)
- **Description:** calendar month (1–12)
- **Source:** derived
- **Why it helps:** monthly seasonality of many diseases

### `year` (int)
- **Description:** calendar year
- **Source:** derived
- **Why it helps:** long-term shifts in reporting/incidence

### `season` (categorical)
- **Description:** N-hemisphere meteorological season
- **Source:** derived from month
- **Why it helps:** seasonal drivers (rain→cholera, winter→flu)

### `country` (categorical)
- **Description:** country name
- **Source:** pycountry
- **Why it helps:** country-specific base risk

### `iso3` (categorical)
- **Description:** ISO 3166-1 alpha-3 code
- **Source:** pycountry
- **Why it helps:** stable country key for the model

### `continent` (categorical)
- **Description:** continent
- **Source:** pycountry_convert
- **Why it helps:** coarse regional risk grouping

### `latitude` (float)
- **Description:** country centroid latitude
- **Source:** geojson centroid
- **Why it helps:** climate/geography proxy

### `longitude` (float)
- **Description:** country centroid longitude
- **Source:** geojson centroid
- **Why it helps:** climate/geography proxy

### `disease_name` (categorical)
- **Description:** normalized disease name
- **Source:** WHO-DON title
- **Why it helps:** disease-specific dynamics

### `disease_category` (categorical)
- **Description:** disease group
- **Source:** keyword mapping
- **Why it helps:** shared behaviour within a transmission class

### `current_cases` (float)
- **Description:** cumulative reported cases as of week t
- **Source:** WHO-DON text
- **Why it helps:** current outbreak size

### `current_deaths` (float)
- **Description:** cumulative reported deaths as of week t
- **Source:** WHO-DON text
- **Why it helps:** severity level

### `current_case_fatality_rate` (float)
- **Description:** deaths/cases as of t
- **Source:** derived
- **Why it helps:** lethality signal

### `cases_last_week` (float)
- **Description:** new reported cases in the latest week
- **Source:** derived
- **Why it helps:** immediate momentum

### `cases_last_2_weeks` (float)
- **Description:** sum of new cases over last 2 weeks
- **Source:** derived
- **Why it helps:** short-term load

### `cases_last_4_weeks` (float)
- **Description:** sum of new cases over last 4 weeks
- **Source:** derived
- **Why it helps:** recent burden

### `rolling_mean_4w` (float)
- **Description:** mean weekly new cases, last 4w
- **Source:** derived
- **Why it helps:** smoothed recent level

### `rolling_mean_8w` (float)
- **Description:** mean weekly new cases, last 8w
- **Source:** derived
- **Why it helps:** medium-term baseline

### `rolling_std_4w` (float)
- **Description:** std of weekly new cases, last 4w
- **Source:** derived
- **Why it helps:** volatility of the outbreak

### `weekly_growth_rate` (float)
- **Description:** (new_t - new_{t-1}) / new_{t-1}
- **Source:** derived
- **Why it helps:** acceleration/deceleration

### `weekly_death_growth_rate` (float)
- **Description:** weekly growth of new deaths
- **Source:** derived
- **Why it helps:** severity trajectory

### `trend_direction` (int)
- **Description:** sign(roll4 - roll8): -1/0/1
- **Source:** derived
- **Why it helps:** compact rising/falling signal

### `weeks_since_last_outbreak` (float)
- **Description:** weeks since last WHO-DON report
- **Source:** derived
- **Why it helps:** recency of activity

### `active_outbreak` (int)
- **Description:** report within last 4 weeks (0/1)
- **Source:** derived
- **Why it helps:** is an outbreak ongoing now

### `historical_peak_cases` (float)
- **Description:** max cumulative cases seen so far
- **Source:** derived
- **Why it helps:** outbreak ceiling reference

### `historical_peak_deaths` (float)
- **Description:** max cumulative deaths so far
- **Source:** derived
- **Why it helps:** worst severity reference

### `neighbouring_countries_with_active_outbreak` (int)
- **Description:** count of land-border neighbours active in week t
- **Source:** geojson adjacency + WHO-DON
- **Why it helps:** cross-border spread risk

### `regional_cases` (float)
- **Description:** sum of new cases in the continent, week t
- **Source:** derived
- **Why it helps:** regional pressure

### `regional_growth_rate` (float)
- **Description:** weekly growth of regional cases
- **Source:** derived
- **Why it helps:** regional momentum

### `population` (float)
- **Description:** country population (most recent)
- **Source:** World Bank
- **Why it helps:** susceptible pool size

### `population_density` (float)
- **Description:** population / land area (km²)
- **Source:** World Bank + geojson area
- **Why it helps:** transmission-intensity proxy

