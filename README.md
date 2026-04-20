# Energy Price Shock: Distributional Impact & Policy Options

How an energy price increase hits UK households, which groups are most affected, and what policy responses would cost the Exchequer. Built on [PolicyEngine UK](https://policyengine.org/) microsimulation of 31.9m households.

## Overview

This project models the distributional impact of energy price shocks on UK households and evaluates policy responses:

1. **Flat transfer** — £400 per household
2. **Council tax band rebate** — £300 for bands A–D
3. **Shock-matching transfer** — flat payment equal to the average shock
4. **Cap-freeze subsidy** — bills held at the pre-shock cap, government subsidises the full increase
5. **National Energy Guarantee (NEG)** — subsidises the first 2,900 kWh of electricity
6. **Rising block tariff** (cost-neutral) and gas-only cap scenarios

### Behavioural response

Each household responds to a price shock at its own income decile's short-run elasticity per Priesmann & Praktiknjo (2025): −0.64 for the lowest decile, rising monotonically to −0.11 for the highest (linear interpolation). A population-mean elasticity (e.g. Labandeira et al. 2017's −0.15) averages away the progressivity that matters: lower-income households are forced to cut sharply while higher-income households barely respond.

The spend response uses the canonical constant-elasticity form
`(p_new / p_old) ** (1 + ε)`
rather than the linear first-order approximation `(1 + p)(1 + εp)`, which produces negative consumption — physically impossible — for combinations like ε = −0.64 and +161% shock. The log-linear form stays admissible at all ε ∈ (−1, 0] and p ≥ 0.

Constant-elasticity extrapolation to +161% (Q1 2023 peak) is well outside the validated band for these elasticity estimates; the extreme-shock results are illustrative, not predictive.

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
pip install -e .
export HUGGING_FACE_TOKEN=<your_token>    # required for dataset download
python -m energy_shock                    # UK only
python -m energy_shock --all-countries    # UK + England, Scotland, Wales, N. Ireland
```

This runs the PolicyEngine UK microsimulation directly via [`policyengine-uk`](https://github.com/PolicyEngine/policyengine-uk) and outputs JSON files to `dashboard/src/data/`. Datasets are fetched lazily from HuggingFace on first run (the private FRS repo requires `HUGGING_FACE_TOKEN`).

Requirements: `policyengine-uk>=2.88.0`, `microdf-python>=1.2.0`, `pandas>=2.0`, `numpy>=1.26` (Python 3.13+).

### Tests

```bash
pip install -e .[dev]
pytest tests/
```

### Dashboard

```bash
cd dashboard
bun install
bun run dev
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
| Q1 2023 peak | £4,279 | +161% |

## Key parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| Current cap | £1,641 | Ofgem Q2 2026 |
| Electricity rate | 24.70 p/kWh | Ofgem Q2 2026 |
| Gas rate | 5.70 p/kWh | Ofgem Q2 2026 |
| Short-run elasticity | −0.64 (D1) → −0.11 (D10) | Priesmann & Praktiknjo (2025) |
| Behavioural form | `(p_new/p_old) ** (1+ε)` | Constant-elasticity |
| NEG threshold | 2,900 kWh | Median household electricity |
| Dataset | enhanced_frs_2023_24.h5 | PolicyEngine UK data (HuggingFace) |

## Tech stack

- **Analysis**: Python 3.13, `policyengine-uk` >= 2.88.0, microdf
- **Dashboard**: React 18, Vite 5
- **Charts**: CSS-based vertical column charts (no charting library)
