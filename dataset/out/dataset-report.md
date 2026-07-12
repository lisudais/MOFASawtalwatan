# Dataset Report — Historical Hazard & Outbreak v2 (Qwen2.5 fine-tuning)

_Generated 2026-07-12 · trusted official sources only · no synthetic records_

## Totals
- Total raw records collected: **1886**
- After dedup (cleaned): **1854**
- Duplicates removed: **0** (by id) + **32** (same event)
- Category balancing cap: **200** per hazard
- Rejected in validation: **0**
- **Final records: 829**
  - train **622** (75.0%) · validation **42** (5.1%) · test **165** (19.9%)
- **Overall quality score: 100.0%**
- City filled (locality present): **135** (16.3%)

## Records per category (hazard)
- epidemic: 200 (24.1%)
- earthquake: 200 (24.1%)
- wildfire: 200 (24.1%)
- storm: 100 (12.1%)
- flood: 67 (8.1%)
- ice: 29 (3.5%)
- volcano: 29 (3.5%)
- drought: 4 (0.5%)

## Source distribution
- NASA EONET: 254 (30.6%)
- ECDC: 200 (24.1%)
- GDACS: 199 (24.0%)
- USGS: 176 (21.2%)

## Geographic coverage: 149 countries
### Top 30
- ∅: 158
- United States: 116
- Indonesia: 28
- Philippines: 23
- Mexico: 21
- Japan: 20
- Russia: 16
- China: 14
- Vanuatu: 13
- Italy: 11
- Chile: 11
- Greece: 10
- India: 10
- Papua New Guinea: 10
- Portugal: 9
- Malta: 9
- Czechia: 8
- France: 8
- Ireland: 7
- Hungary: 7
- Germany: 7
- Estonia: 7
- Cyprus: 7
- Bulgaria: 7
- Sweden: 7
- Spain: 7
- Norway: 7
- Netherlands: 7
- Lithuania: 7
- Tonga: 7

## Missing-value statistics (null/empty)
- event_type: 0 (0.0%)
- hazard: 0 (0.0%)
- disease: 629 (75.9%)
- event_name: 0 (0.0%)
- severity: 454 (54.8%)
- country: 158 (19.1%)
- admin_region: 587 (70.8%)
- city: 694 (83.7%)
- coordinates: 200 (24.1%)
- date: 0 (0.0%)
- source: 0 (0.0%)
- source_url: 0 (0.0%)
- magnitude: 629 (75.9%)
- depth_km: 653 (78.8%)
- cases: 629 (75.9%)
- deaths: 638 (77.0%)
- affected_population: 629 (75.9%)
- affected_area: 458 (55.2%)
- neighboring_countries: 766 (92.4%)
- neighboring_locations: 829 (100.0%)
- timeline: 409 (49.3%)
- spread: 714 (86.1%)
- recommendations: 829 (100.0%)
- summary: 0 (0.0%)

## Validation results (all enforced pre-write)
- ≥10,000 final records ✗ (829)
- ✓ valid JSONL
- ✓ identical fixed schema
- ✓ no duplicate ids
- ✓ no duplicate events
- ✓ valid coordinates
- ✓ valid YYYY-MM-DD dates
- ✓ trusted sources only
- ✓ clean UTF-8
- ✓ no HTML
- ✓ no country stored as city
- ✓ required fields present
- chronological split (chains intact)
