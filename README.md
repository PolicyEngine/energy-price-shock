# Energy Price Shock: Distributional Impact & Policy Options

How an energy price increase hits UK households, who suffers most, and what policy responses would cost the Exchequer. Built on [PolicyEngine UK](https://policyengine.org/) microsimulation of 31.9m households.

## Overview

This project models the distributional impact of energy price shocks on UK households and evaluates policy responses:

1. **Flat transfer** — £400 per household
2. **Council tax band rebate** — £300 for bands A–D
3. **Shock-matching transfer** — Flat payment equal to the average shock
4. **Full-offset EPG** — Energy Price Guarantee that fully offsets the shock
5. **National Energy Guarantee (NEG)** — Subsidises the first 2,900 kWh of electricity

Additional analysis covers the rising block tariff (cost-neutral) and gas-only cap scenarios.

The model applies a single uniform short-run price elasticity of −0.15 (the overall energy average from Labandeira et al., 2017) to estimate behavioural responses. This is a simplification; Priesmann and Praktiknjo (2025) show elasticities vary by income from −0.64 (low-income) to −0.11 (high-income).

## Project structure

```
energy-price-shock/
├── energy_shock/           # Python package — runs microsimulation
│   ├── __init__.py
│   ├── __main__.py         # CLI entry point
│   ├── config.py           # Constants: price caps, scenario parameters
│   ├── baseline.py         # Shared baseline simulation and helpers
│   ├── sections.py         # All analysis sections (shocks, policies, breakdowns)
│   └── generate.py         # Orchestrates analysis, outputs JSON
├── dashboard/              # React frontend — reads and displays results
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.jsx
│   │   │   └── Dashboard.css
│   │   ├── data/           # Generated JSON results (per country)
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── papers/                 # Reference PDFs
└── pyproject.toml
```

## Setup

### Python analysis

```bash
conda activate python313
pip install policyengine-uk==2.86.12
pip install "policyengine-uk-data @ git+https://github.com/PolicyEngine/policyengine-uk-data.git"
python -m energy_shock                    # UK only
python -m energy_shock --all-countries    # UK + England, Scotland, Wales, N. Ireland
```

This runs the PolicyEngine UK microsimulation and outputs JSON files to `dashboard/src/data/`.

Requirements: `policyengine-uk`, `microdf`, `numpy` (Python 3.13+).

### Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Shock scenarios

Current Ofgem price cap (Q2 2026): £1,641/yr.

| Scenario | New cap | Increase |
|----------|---------|----------|
| +10% | £1,805 | +10% |
| +20% | £1,969 | +20% |
| +30% | £2,133 | +30% |
| +60% | £2,625 | +60% |
| 2022-level | £3,764 | +129% |

## Key parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| Current cap | £1,641 | Ofgem Q2 2026 |
| Electricity rate | 24.70 p/kWh | Ofgem Q2 2026 |
| Gas rate | 5.70 p/kWh | Ofgem Q2 2026 |
| Short-run elasticity | −0.15 | Labandeira et al. (2017) |
| NEG threshold | 2,900 kWh | Median household electricity |
| Dataset | enhanced_frs_2023_24.h5 | PolicyEngine UK data (HuggingFace) |

## Tech stack

- **Analysis**: Python 3.13, PolicyEngine UK 2.86.12, microdf
- **Dashboard**: React 18, Vite 5
- **Charts**: CSS-based vertical column charts (no charting library)
