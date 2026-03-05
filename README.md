# Energy Price Shock: Budget Impact Analysis

How an energy price spike hits UK households, who suffers most, and what five policy responses would cost the Exchequer. Built on [PolicyEngine UK](https://policyengine.org/) microsimulation of 31.9m households.

## Overview

This project models the distributional impact of energy price shocks on UK households and evaluates five policy responses:

1. **EPG subsidy** — Energy Price Guarantee capping bills at £2,500/yr
2. **Flat transfer** — £400 per household
3. **Council tax band rebate** — £300 for bands A–D
4. **Expanded winter fuel** — Universal for pensioners at £350/£500
5. **Combined package** — All four policies together

Each policy is modelled against a severe (+60%) price shock, raising the Ofgem cap from £1,720 to £2,752.

## Project structure

```
energy-price-shock/
├── energy_shock/           # Python package — runs microsimulation
│   ├── __init__.py
│   ├── config.py           # Constants: price caps, scenario parameters
│   ├── utils.py            # Helper functions (formatting, decile tables)
│   └── analysis.py         # Full analysis pipeline, outputs JSON
├── run_analysis.py         # Entry point — generates results.json
├── dashboard/              # React frontend — reads and displays results
│   ├── src/
│   │   ├── components/
│   │   │   ├── Dashboard.jsx
│   │   │   └── Dashboard.css
│   │   ├── data/
│   │   │   └── results.json
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
└── pyproject.toml
```

## Setup

### Python analysis (optional — results.json is pre-generated)

```bash
conda activate python313
pip install -e .
python run_analysis.py
```

This runs the PolicyEngine UK microsimulation and outputs `dashboard/src/data/results.json`.

Requirements: `policyengine-uk`, `microdf`, `pandas`, `numpy` (Python 3.13+).

### Dashboard

```bash
cd dashboard
npm install
npm run dev
```

Opens at `http://localhost:5173`.

## Shock scenarios

| Scenario | New cap | Increase | Avg HH hit (£/yr) | Total cost |
|----------|---------|----------|-------------------|------------|
| Moderate | £2,236 | +30% | £675 | £21.5bn |
| Severe | £2,752 | +60% | £1,350 | £43.0bn |
| 2022-level | £3,764 | +119% | £2,678 | £85.3bn |
| Extreme | £4,500 | +162% | £3,645 | £116.2bn |

## Policy comparison

| Policy | Exchequer cost | Avg HH benefit |
|--------|---------------|----------------|
| EPG subsidy | £0.8bn | £24/yr |
| Flat transfer | £12.8bn | £400/yr |
| CT band rebate | £7.7bn | £240/yr |
| Expanded winter fuel | £1.5bn | £104/yr |
| Combined package | £22.7bn | £712/yr |

## Tech stack

- **Analysis**: Python 3.13, PolicyEngine UK, microdf
- **Dashboard**: React 18, Vite 5
- **Charts**: CSS-based vertical column charts (no charting library)
