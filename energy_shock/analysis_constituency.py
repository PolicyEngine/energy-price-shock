"""
Constituency-level energy shock analysis.

Uses parliamentary constituency weights from policyengine-uk-data to compute
per-constituency energy burden and shock impacts.
"""

import csv
import json
import numpy as np
import h5py
from pathlib import Path
from policyengine_uk import Microsimulation

from .config import YEAR, CURRENT_CAP, PRICE_SCENARIOS


# Paths
WEIGHTS_PATH = Path.home() / ".cache/huggingface/hub/models--policyengine--policyengine-uk-data/snapshots/e00e9c8725d45e6761da92a66724b850b1582da2/parliamentary_constituency_weights.h5"
CONSTITUENCIES_CSV = Path(__file__).parent.parent / "data_inputs" / "constituencies_2024.csv"
GEOJSON_SRC = Path.home() / "Autumn-budget-local-area/public/data/uk_constituencies_2024.geojson"


def _load_constituency_data():
    """Load constituency weights and lookup table."""
    with h5py.File(WEIGHTS_PATH, "r") as f:
        weights = f["2025"][...]  # shape (650, n_households)

    constituencies = []
    with open(CONSTITUENCIES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            constituencies.append(row)

    return weights, constituencies


def run_constituency_analysis(output_path=None):
    """Compute per-constituency energy shock metrics."""
    print("Loading constituency weights...")
    const_weights, constituencies = _load_constituency_data()

    print("Running microsimulation...")
    sim = Microsimulation()

    def _vals(var, **kw):
        v = sim.calculate(var, YEAR, **kw)
        return v if isinstance(v, np.ndarray) else v.values

    energy = _vals("domestic_energy_consumption")
    elec = _vals("electricity_consumption")
    gas = _vals("gas_consumption")
    income = _vals("household_net_income")

    n_constituencies = len(constituencies)
    print(f"Computing impacts for {n_constituencies} constituencies...")

    rows = []
    for i in range(n_constituencies):
        c = constituencies[i]
        w = const_weights[i]  # household weights for this constituency
        w_sum = w.sum()
        if w_sum == 0:
            continue

        # Weighted averages for this constituency
        avg_energy = float(np.average(energy, weights=w))
        avg_elec = float(np.average(elec, weights=w))
        avg_gas = float(np.average(gas, weights=w))
        avg_income = float(np.average(income, weights=w))

        # Fuel poverty rate (energy > 10% of income)
        ratio = energy / np.where(income > 0, income, 1)
        fp_rate = float(np.average(ratio > 0.10, weights=w)) * 100

        # Energy burden
        burden_pct = avg_energy / avg_income * 100 if avg_income > 0 else 0

        base_row = {
            "code": c["code"],
            "name": c["name"],
            "region": c.get("region", ""),
            "country": c.get("country", ""),
            "avg_energy": round(avg_energy),
            "avg_electricity": round(avg_elec),
            "avg_gas": round(avg_gas),
            "avg_income": round(avg_income),
            "energy_burden_pct": round(burden_pct, 2),
            "fuel_poverty_pct": round(fp_rate, 1),
        }

        # Per-scenario shock impacts
        for name, new_cap in PRICE_SCENARIOS.items():
            pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
            extra_cost = avg_energy * pct
            shocked_burden = (avg_energy * (1 + pct)) / avg_income * 100 if avg_income > 0 else 0

            # Shocked fuel poverty
            shocked_energy = energy * (1 + pct)
            shocked_ratio = shocked_energy / np.where(income > 0, income, 1)
            shocked_fp = float(np.average(shocked_ratio > 0.10, weights=w)) * 100

            key = name.replace("+", "plus_").replace("-", "_").replace("%", "pct")
            base_row[f"extra_cost_{key}"] = round(extra_cost)
            base_row[f"burden_pct_{key}"] = round(shocked_burden, 2)
            base_row[f"fp_pct_{key}"] = round(shocked_fp, 1)

        rows.append(base_row)

    # Sort by energy burden descending
    rows.sort(key=lambda x: x["energy_burden_pct"], reverse=True)

    # Summary stats
    burdens = [r["energy_burden_pct"] for r in rows]
    result = {
        "n_constituencies": len(rows),
        "max_burden_pct": max(burdens),
        "min_burden_pct": min(burdens),
        "median_burden_pct": round(sorted(burdens)[len(burdens) // 2], 2),
        "constituencies": rows,
    }

    if output_path:
        with open(output_path, "w") as f:
            json.dump(result, f, indent=2)
        print(f"Constituency results saved to {output_path}")

    return result


if __name__ == "__main__":
    run_constituency_analysis(
        output_path=str(Path(__file__).parent.parent / "dashboard" / "src" / "data" / "constituency_results.json")
    )
