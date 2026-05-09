# Energy Price Shock: Distributional Impact & Policy Options

How an energy price increase hits UK households, which groups are most affected, and what policy responses would cost the Exchequer. Built on [PolicyEngine UK](https://policyengine.org/) microsimulation of 31.9m households.

## Overview

This project models the distributional impact of energy price shocks on UK households and evaluates policy responses:

1. **Flat transfer** — £400 per household
2. **Council tax band rebate** — £300 for bands A–D, England only (mirrors the 2022 Council Tax Rebate's geographic scope)
3. **Shock-matching transfer** — flat payment equal to the average shock
4. **Cap-freeze subsidy** — bills held at the pre-shock cap, government subsidises the full increase
5. **National Energy Guarantee (NEG)** — subsidises the first 2,900 kWh of electricity

### Behavioural response

Each household responds to a price shock at its own income decile's short-run elasticity per Priesmann & Praktiknjo (2025): −0.64 for the lowest decile, rising monotonically to −0.11 for the highest (linear interpolation). A population-mean elasticity (e.g. Labandeira et al. 2017's −0.15) averages away the progressivity that matters: lower-income households are forced to cut sharply while higher-income households barely respond.

The spend response uses the canonical constant-elasticity form
`(p_new / p_old) ** (1 + ε)`
rather than the linear first-order approximation `(1 + p)(1 + εp)`, which produces negative consumption — physically impossible — for combinations like ε = −0.64 and +161% shock. The log-linear form stays admissible at all ε ∈ (−1, 0] and p ≥ 0.

**Transferability caveats.** Priesmann & Praktiknjo estimate their elasticities from German *gas* demand using a decile-specific log-linear model; the decile-specific pattern, not the headline magnitude, is what we rely on. Applying those point estimates to combined (electricity + gas) UK consumption assumes (i) the UK income gradient in responsiveness mirrors Germany's and (ii) electricity responds at the same elasticity as gas. Both assumptions are conservative — UK electricity demand is typically estimated less elastic than gas — so the behavioural bill savings reported here are best read as an upper bound. Linear interpolation between D1 and D10 is also a convenience; the underlying estimates give coarser decile bins.

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
├── src/                    # Next.js frontend — reads and displays results
│   ├── app/
│   ├── components/
│   │   ├── Dashboard.jsx
│   │   └── Dashboard.css
│   └── data/               # Generated JSON results (per country)
├── package.json
├── next.config.ts
├── papers/                 # Reference PDFs
└── pyproject.toml
```

## Setup

### Python analysis

```bash
uv venv --python 3.13 .venv
source .venv/bin/activate
uv pip install -e .
export HUGGING_FACE_TOKEN=<your_token>    # required for dataset download
python -m energy_shock                    # UK only
python -m energy_shock --all-countries    # UK + England, Scotland, Wales, N. Ireland
```

This runs the PolicyEngine UK microsimulation directly via [`policyengine-uk`](https://github.com/PolicyEngine/policyengine-uk) and outputs JSON files to `src/data/`. Datasets are fetched lazily from HuggingFace on first run (the private FRS repo requires `HUGGING_FACE_TOKEN`).

Requirements: `policyengine-uk>=2.88.0`, `microdf-python>=1.2.0`, `pandas>=2.0`, `numpy>=1.26` (Python 3.13+).

### Tests

```bash
uv pip install -e .[dev]
pytest tests/
```

### Dashboard

```bash
bun install
bun run dev
```

Opens at `http://localhost:3000`.

## Shock scenarios

Current Ofgem price cap (Q2 2026): £1,641/yr.

| Scenario | New cap | Increase |
|----------|---------|----------|
| +10% | £1,805 | +10% |
| +20% | £1,969 | +20% |
| +30% | £2,133 | +30% |
| +60% | £2,625 | +60% |
| Q1 2023 peak | £4,279 | +161% |

The +10 %, +20 %, and +30 % figures sit inside the range Cornwall Insight has
forecast for the July 2026 cap. +60 % is close to Stifel's upper-bound
scenario under a sustained Strait-of-Hormuz closure. The Q1 2023 peak
corresponds to the *announced* cap of £4,279 for January–March 2023;
households actually paid around £2,500 under the concurrent Energy Price
Guarantee, so the +161 % scenario is what bills would have reached absent
government intervention — not a realised historical data point. It is
included as a stress-test of the model's geometry at elasticity ranges
outside the validated band (the elasticities are estimated on ±10–20 %
variation), and should be read as illustrative rather than predictive.

Shocks are modelled as a uniform percentage increase on the combined
dual-fuel cap. A gas-only shock — the more plausible trigger given the
wholesale-gas dynamics these scenarios anticipate — would hit gas-heated
households more sharply and all-electric households less sharply than
these averages imply. The cap figure of £1,641/yr also bundles roughly
£290/yr of fixed standing charges with unit-rate spend, so a uniform
percentage shock implicitly rescales standing charges too. Low-consumption
households (often small, well-insulated, or low-income) would be *less*
exposed to a true unit-rate shock than the combined-cap model implies.

## Key parameters

| Parameter | Value | Source |
|-----------|-------|--------|
| Current cap | £1,641 | Ofgem Q2 2026 |
| Electricity rate | 24.70 p/kWh | Ofgem Q2 2026 |
| Gas rate | 5.70 p/kWh | Ofgem Q2 2026 |
| Short-run elasticity | −0.64 (D1) → −0.11 (D10) | Priesmann & Praktiknjo (2025) |
| Behavioural form | `(p_new/p_old) ** (1+ε)` | Constant-elasticity |
| NEG threshold | 2,900 kWh | Bangham (2026) proposal, mirroring Austria/Netherlands 2022 schemes |
| Dataset | enhanced_frs_2023_24.h5 | PolicyEngine UK data (HuggingFace) |

## Tech stack

- **Analysis**: Python 3.13, `policyengine-uk` >= 2.88.0, microdf
- **Dashboard**: Next.js 16, React 19
- **Charts**: CSS-based vertical column charts (no charting library)
