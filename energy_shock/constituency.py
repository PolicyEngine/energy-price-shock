"""
Constituency-level energy shock analysis.

Uses parliamentary constituency weights to compute per-constituency
energy burden and shock impacts. Energy = electricity + gas.
"""

import csv
import numpy as np
import h5py
from pathlib import Path

from .config import CURRENT_CAP, PRICE_SCENARIOS, SHORT_RUN_ELASTICITY
from .baseline import weighted_mean

WEIGHTS_PATH = (
    Path.home()
    / ".cache/huggingface/hub/models--policyengine--policyengine-uk-data"
    / "snapshots/e00e9c8725d45e6761da92a66724b850b1582da2"
    / "parliamentary_constituency_weights.h5"
)
CONSTITUENCIES_CSV = Path(__file__).parent.parent / "data_inputs" / "constituencies_2024.csv"


def _load_constituency_data():
    with h5py.File(WEIGHTS_PATH, "r") as f:
        weights = f["2025"][...]
    constituencies = []
    with open(CONSTITUENCIES_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            constituencies.append(row)
    return weights, constituencies


def constituency_analysis(data):
    """Compute per-constituency energy shock metrics using shared baseline."""
    print("Loading constituency weights...")
    const_weights, constituencies = _load_constituency_data()

    energy = data["energy"]
    elec = data["elec"]
    gas = data["gas"]
    income = data["income"]

    n_const = len(constituencies)
    print(f"Computing impacts for {n_const} constituencies...")

    rows = []
    for i in range(n_const):
        c = constituencies[i]
        w = const_weights[i]
        w_sum = w.sum()
        if w_sum == 0:
            continue

        avg_energy = float(np.average(energy, weights=w))
        avg_elec = float(np.average(elec, weights=w))
        avg_gas = float(np.average(gas, weights=w))
        avg_income = float(np.average(income, weights=w))

        ratio = energy / np.where(income > 0, income, 1)
        fp_rate = float(np.average(ratio > 0.10, weights=w)) * 100

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

        for name, new_cap in PRICE_SCENARIOS.items():
            pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
            epsilon = SHORT_RUN_ELASTICITY
            behav_factor = (1 + pct) * (1 + epsilon * pct)

            # Static
            extra_cost = avg_energy * pct
            extra_pct = extra_cost / avg_income * 100 if avg_income > 0 else 0

            # Behavioural
            behav_extra_cost = avg_energy * (behav_factor - 1)
            behav_extra_pct = behav_extra_cost / avg_income * 100 if avg_income > 0 else 0

            shocked_energy = energy * (1 + pct)
            shocked_ratio = shocked_energy / np.where(income > 0, income, 1)
            shocked_fp = float(np.average(shocked_ratio > 0.10, weights=w)) * 100

            key = name.replace("+", "plus_").replace("-", "_").replace("%", "pct")
            base_row[f"extra_cost_{key}"] = round(extra_cost)
            base_row[f"extra_pct_{key}"] = round(extra_pct, 2)
            base_row[f"behav_cost_{key}"] = round(behav_extra_cost)
            base_row[f"behav_pct_{key}"] = round(behav_extra_pct, 2)
            base_row[f"burden_pct_{key}"] = round((avg_energy * (1 + pct)) / avg_income * 100 if avg_income > 0 else 0, 2)
            base_row[f"fp_pct_{key}"] = round(shocked_fp, 1)

        rows.append(base_row)

    rows.sort(key=lambda x: x["energy_burden_pct"], reverse=True)

    burdens = [r["energy_burden_pct"] for r in rows]
    return {
        "n_constituencies": len(rows),
        "max_burden_pct": max(burdens),
        "min_burden_pct": min(burdens),
        "median_burden_pct": round(sorted(burdens)[len(burdens) // 2], 2),
        "constituencies": rows,
    }
