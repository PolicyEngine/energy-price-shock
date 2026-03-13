"""
Single entry point: run all analyses and write dashboard JSON files.

Usage:
    conda activate python313
    python -m energy_shock                        # UK only (default)
    python -m energy_shock --country SCOTLAND     # single country
    python -m energy_shock --all-countries         # UK + all four nations
"""

import argparse
import json
from pathlib import Path

from .baseline import run_baseline, filter_by_country
from .config import (
    YEAR, CURRENT_CAP, SHOCK_CAP, EPG_TARGET,
    FLAT_TRANSFER, CT_REBATE, SHORT_RUN_ELASTICITY,
)
from . import sections
from .constituency import constituency_analysis

OUTPUT_DIR = Path(__file__).parent.parent / "dashboard" / "src" / "data"

VALID_COUNTRIES = ["UK", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN_IRELAND"]


def _run_one(data, country, suffix, raw_data):
    """Run full analysis for one country/nation and write JSON files."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*50}")
    print(f"  {country}: {data['weights'].sum()/1e6:.1f}m households")
    print(f"  Mean energy: £{data['energy'].mean():.0f}")
    print(f"{'='*50}")

    # ── results.json ─────────────────────────────────────────────────
    print("  Baseline summary...")
    baseline = sections.baseline_summary(data)

    print("  Shock scenarios...")
    scenarios = sections.shock_scenarios(data)

    print("  Fuel poverty...")
    fp = sections.fuel_poverty(data)

    print("  Behavioural responses...")
    behav = sections.behavioral_responses(data)

    print("  Policy A: EPG...")
    pol_epg = sections.policy_epg(data)

    print("  Policy B: Flat transfer...")
    pol_flat = sections.policy_flat(data)

    print("  Policy C: CT rebate...")
    pol_ct = sections.policy_ct_rebate(data)

    print("  Policy E: Combined...")
    pol_combined = sections.policy_combined(data)

    print("  Policy net positions...")
    pol_net = sections.policy_net_position(data)

    print("  Post-policy fuel poverty...")
    pol_fp = sections.policy_fuel_poverty(data)

    results = {
        "baseline": baseline,
        "shock_scenarios": scenarios,
        "fuel_poverty": fp,
        "behavioral": behav,
        "policies": {
            "epg": pol_epg,
            "flat_transfer": pol_flat,
            "ct_rebate": pol_ct,
            "combined": pol_combined,
        },
        "policy_net_position": pol_net,
        "policy_fuel_poverty": pol_fp,
        "config": {
            "year": YEAR,
            "country": country,
            "current_cap": CURRENT_CAP,
            "shock_cap": SHOCK_CAP,
            "epg_target": EPG_TARGET,
            "flat_transfer": FLAT_TRANSFER,
            "ct_rebate": CT_REBATE,
            "elasticity": SHORT_RUN_ELASTICITY,
        },
    }

    path = OUTPUT_DIR / f"results{suffix}.json"
    with open(path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  -> {path}")

    # ── results_v2.json ──────────────────────────────────────────────
    print("  Electricity/gas split...")
    split = sections.energy_split(data)

    print("  Tenure breakdown...")
    tenure = sections.tenure_breakdown(data)

    print("  Household type breakdown...")
    hh_type = sections.household_type_breakdown(data)

    print("  NEF National Energy Guarantee...")
    neg = sections.neg_policy(data)

    print("  Rising block tariff...")
    rbt = sections.rising_block_tariff(data)

    print("  Country breakdown...")
    country_bd = sections.country_breakdown(data)

    results_v2 = {
        "energy_split": split,
        "tenure": tenure,
        "household_type": hh_type,
        "country": country_bd,
        "neg_policy": neg,
        "rising_block_tariff": rbt,
    }

    path_v2 = OUTPUT_DIR / f"results_v2{suffix}.json"
    with open(path_v2, "w") as f:
        json.dump(results_v2, f, indent=2)
    print(f"  -> {path_v2}")

    # ── constituency_results.json ────────────────────────────────────
    # Constituency weights matrix is aligned to full dataset, so pass raw_data
    print("  Constituency analysis...")
    const = constituency_analysis(raw_data, country=country)

    path_const = OUTPUT_DIR / f"constituency_results{suffix}.json"
    with open(path_const, "w") as f:
        json.dump(const, f, indent=2)
    print(f"  -> {path_const}")


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
        "--country", default="UK",
        choices=VALID_COUNTRIES,
        help="Country/nation to analyse (default: UK)",
    )
    parser.add_argument(
        "--all-countries", action="store_true",
        help="Generate data for UK + all four nations",
    )
    args = parser.parse_args()
    if args.all_countries:
        run_all_countries()
    else:
        run_all(country=args.country)


if __name__ == "__main__":
    _cli()
