"""
Single entry point: run all analyses and write dashboard JSON files.

Usage:
    conda activate python313
    python -m energy_shock.generate
"""

import json
from pathlib import Path

from .baseline import run_baseline
from .config import (
    YEAR, CURRENT_CAP, SHOCK_CAP, EPG_TARGET,
    FLAT_TRANSFER, CT_REBATE, SHORT_RUN_ELASTICITY,
)
from . import sections
from .constituency import constituency_analysis

OUTPUT_DIR = Path(__file__).parent.parent / "dashboard" / "src" / "data"


def run_all():
    """Run every analysis section from one shared baseline."""
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── shared baseline (single microsimulation) ───────────────────────
    print("Running baseline microsimulation...")
    data = run_baseline()
    print(f"  Households: {data['weights'].sum()/1e6:.1f}m")
    print(f"  Mean energy (elec+gas): £{data['energy'].mean():.0f}")

    # ── results.json (main dashboard data) ─────────────────────────────
    print("\n=== Main analysis ===")

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

    print("  Policy D: Winter fuel...")
    pol_wfa = sections.policy_wfa(data)

    print("  Policy E: Combined...")
    pol_combined = sections.policy_combined(data)

    print("  Policy net positions...")
    pol_net = sections.policy_net_position(data)

    results = {
        "baseline": baseline,
        "shock_scenarios": scenarios,
        "fuel_poverty": fp,
        "behavioral": behav,
        "policies": {
            "epg": pol_epg,
            "flat_transfer": pol_flat,
            "ct_rebate": pol_ct,
            "winter_fuel": pol_wfa,
            "combined": pol_combined,
        },
        "policy_net_position": pol_net,
        "config": {
            "year": YEAR,
            "current_cap": CURRENT_CAP,
            "shock_cap": SHOCK_CAP,
            "epg_target": EPG_TARGET,
            "flat_transfer": FLAT_TRANSFER,
            "ct_rebate": CT_REBATE,
            "elasticity": SHORT_RUN_ELASTICITY,
        },
    }

    path = OUTPUT_DIR / "results.json"
    with open(path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"  -> {path}")

    # ── results_v2.json (extended: elec/gas split, regional, tenure, new policies)
    print("\n=== Extended analysis ===")

    print("  Electricity/gas split...")
    split = sections.energy_split(data)

    print("  Regional breakdown...")
    regional = sections.regional_breakdown(data)

    print("  Tenure breakdown...")
    tenure = sections.tenure_breakdown(data)

    print("  Household type breakdown...")
    hh_type = sections.household_type_breakdown(data)

    print("  NEF National Energy Guarantee...")
    neg = sections.neg_policy(data)

    print("  Rising block tariff...")
    rbt = sections.rising_block_tariff(data)

    print("  Gas-only price cap...")
    gas_cap = sections.gas_price_cap(data)

    results_v2 = {
        "energy_split": split,
        "regional": regional,
        "tenure": tenure,
        "household_type": hh_type,
        "neg_policy": neg,
        "rising_block_tariff": rbt,
        "gas_price_cap": gas_cap,
    }

    path_v2 = OUTPUT_DIR / "results_v2.json"
    with open(path_v2, "w") as f:
        json.dump(results_v2, f, indent=2)
    print(f"  -> {path_v2}")

    # ── constituency_results.json ──────────────────────────────────────
    print("\n=== Constituency analysis ===")
    const = constituency_analysis(data)

    path_const = OUTPUT_DIR / "constituency_results.json"
    with open(path_const, "w") as f:
        json.dump(const, f, indent=2)
    print(f"  -> {path_const}")

    print("\nDone. All dashboard data regenerated.")


if __name__ == "__main__":
    run_all()
