"""
Single entry point: run all analyses and write dashboard JSON files.

Usage:
    uv venv --python 3.13 .venv && source .venv/bin/activate
    uv pip install -e .
    python -m energy_shock                        # UK only (default)
    python -m energy_shock --country SCOTLAND     # single country
    python -m energy_shock --all-countries         # UK + all four nations
"""

import argparse
import json
from pathlib import Path

from . import sections
from .baseline import filter_by_country, run_baseline
from .config import (
    CT_REBATE,
    CURRENT_CAP,
    ELASTICITY_BY_DECILE,
    FLAT_TRANSFER,
    YEAR,
)

OUTPUT_DIR = Path(__file__).parent.parent / "dashboard" / "src" / "data"

VALID_COUNTRIES = ["UK", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN_IRELAND"]


def _run_one(data, country, suffix, raw_data):
    """Run full analysis for one country/nation and write JSON files."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'=' * 50}")
    print(f"  {country}: {data['weights'].sum() / 1e6:.1f}m households")
    print(f"  Mean energy: £{data['energy'].mean():.0f}")
    print(f"{'=' * 50}")

    # ── results.json ─────────────────────────────────────────────────
    print("  Baseline summary...")
    baseline = sections.baseline_summary(data)

    print("  Shock scenarios...")
    scenarios = sections.shock_scenarios(data)

    print("  Behavioural responses...")
    behav = sections.behavioural_responses(data)

    print("  Policy: Flat transfer...")
    pol_flat = sections.policy_flat(data)

    print("  Policy: CT rebate...")
    pol_ct = sections.policy_ct_rebate(data)

    print("  Post-policy shock...")
    pol_ps = sections.policy_post_shock(data)

    results = {
        "baseline": baseline,
        "shock_scenarios": scenarios,
        "behavioural": behav,
        "policies": {
            "flat_transfer": pol_flat,
            "ct_rebate": pol_ct,
        },
        "policy_post_shock": pol_ps,
        "config": {
            "year": YEAR,
            "country": country,
            "current_cap": CURRENT_CAP,
            "flat_transfer": FLAT_TRANSFER,
            "ct_rebate": CT_REBATE,
            "elasticity_by_decile": {
                str(d): round(ELASTICITY_BY_DECILE[d], 3) for d in range(1, 11)
            },
        },
    }

    path = OUTPUT_DIR / f"results{suffix}.json"
    with open(path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  -> {path}")

    # ── results_breakdowns.json ──────────────────────────────────────
    print("  Electricity/gas split...")
    split = sections.energy_split(data)

    print("  Tenure breakdown...")
    tenure = sections.tenure_breakdown(data)

    print("  Household type breakdown...")
    hh_type = sections.household_type_breakdown(data)

    print("  NEF National Energy Guarantee...")
    neg = sections.neg_policy(data)

    print("  Country breakdown...")
    country_bd = sections.country_breakdown(data)

    breakdowns = {
        "energy_split": split,
        "tenure": tenure,
        "household_type": hh_type,
        "country": country_bd,
        "neg_policy": neg,
    }

    path_breakdowns = OUTPUT_DIR / f"results_breakdowns{suffix}.json"
    with open(path_breakdowns, "w") as f:
        json.dump(breakdowns, f, indent=2)
    print(f"  -> {path_breakdowns}")


def run_all(country="UK"):
    """Run analysis for a single country."""
    print("Running baseline microsimulation...")
    raw_data = run_baseline()

    if country == "UK":
        _run_one(raw_data, "UK", "", raw_data)
    else:
        data = filter_by_country(raw_data, country)
        suffix = f"_{country.lower()}"
        _run_one(data, country, suffix, raw_data)

    print("\nDone.")


def run_all_countries():
    """Run analysis for UK + all four nations."""
    print("Running baseline microsimulation...")
    raw_data = run_baseline()

    # UK (full dataset)
    _run_one(raw_data, "UK", "", raw_data)

    # Each nation
    for c in ["ENGLAND", "SCOTLAND", "WALES", "NORTHERN_IRELAND"]:
        data = filter_by_country(raw_data, c)
        _run_one(data, c, f"_{c.lower()}", raw_data)

    print("\nDone. All countries generated.")


def _cli():
    parser = argparse.ArgumentParser(description="Generate energy-shock analysis")
    parser.add_argument(
        "--country",
        default="UK",
        choices=VALID_COUNTRIES,
        help="Country/nation to analyse (default: UK)",
    )
    parser.add_argument(
        "--all-countries",
        action="store_true",
        help="Generate data for UK + all four nations",
    )
    args = parser.parse_args()
    if args.all_countries:
        run_all_countries()
    else:
        run_all(country=args.country)


if __name__ == "__main__":
    _cli()
