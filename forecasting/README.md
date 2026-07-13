# Crisis-Event Forecasting Prototype (Amazon Chronos-2, zero-shot)

A small, self-contained Python backend that forecasts **future weekly counts** of
crisis events (earthquakes, disease outbreaks, floods, travel warnings, …) per
country and event type, using the pretrained **Amazon Chronos-2** time-series
model in **zero-shot** mode.

> **What it predicts:** how *many* events of a given type a country is likely to
> see in each of the next 4 weeks, learned from historical **frequency**.
>
> **What it does NOT predict:** the geographic spread or location of an
> earthquake, disease, or crisis. It forecasts counts, not maps.

The model is used **as-is**: no fine-tuning, no weight changes, no Unsloth.

If Chronos-2 / torch cannot be loaded in your environment, the API automatically
falls back to a transparent statistical baseline so the endpoints still return
valid JSON. Every response reports which path produced it via `model_used`, and
`GET /health` shows the model load state.

---

## Project layout

```
forecasting/
├── data/
│   └── sample_events.jsonl     # small example dataset (test immediately)
├── prepare_data.py             # raw events -> zero-filled weekly series
├── predict.py                  # Chronos-2 zero-shot forecast (+ fallback)
├── api.py                      # FastAPI service
├── requirements.txt
└── README.md
```

---

## Setup & run — Windows PowerShell

Run these from the `forecasting` folder.

```powershell
# 1) Create a virtual environment
python -m venv .venv

# 2) Activate it
.\.venv\Scripts\Activate.ps1
# If activation is blocked by execution policy, run once (current user):
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# 3) Install dependencies
python -m pip install --upgrade pip
python -m pip install -r requirements.txt

# 4) Start the FastAPI server (http://127.0.0.1:8100)
uvicorn api:app --reload --port 8100
```

The **first** forecast call downloads the Chronos-2 weights from Hugging Face
(one-time). If there is no internet / model access, the API serves the
statistical fallback instead — still valid JSON.

---

## Test the endpoints — Windows PowerShell

Open a **second** PowerShell window (leave the server running in the first):

```powershell
# Health + model status
Invoke-RestMethod http://127.0.0.1:8100/health | ConvertTo-Json -Depth 6

# All forecasts
Invoke-RestMethod http://127.0.0.1:8100/forecast | ConvertTo-Json -Depth 6

# One country (all its event types)
Invoke-RestMethod "http://127.0.0.1:8100/forecast/Saudi Arabia" | ConvertTo-Json -Depth 6

# One country + event type
Invoke-RestMethod "http://127.0.0.1:8100/forecast/Saudi Arabia/EARTHQUAKE" | ConvertTo-Json -Depth 6

# Optional: change the horizon (weeks)
Invoke-RestMethod "http://127.0.0.1:8100/forecast/Pakistan/FLOOD?horizon=6" | ConvertTo-Json -Depth 6
```

You can also open the interactive docs in a browser: <http://127.0.0.1:8100/docs>

---

## Inspect the data pipeline without the server

```powershell
# Prints the parsed weekly series for every (country, event_type)
python prepare_data.py

# Prints a zero-shot forecast for every series
python predict.py
```

---

## Using your own data

Point the loader at a real export (JSON array or JSONL) via an environment
variable, then restart the server:

```powershell
$env:FORECAST_DATA_PATH = "C:\path\to\events.jsonl"
uvicorn api:app --reload --port 8100
```

Each record should contain at least `event_type`, `date`, and `country`
(optional: `event`, `city`, `latitude`, `longitude`, `severity`, `description`).
