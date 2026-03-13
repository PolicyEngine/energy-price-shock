"""
Constituency-level energy shock analysis.

Uses parliamentary constituency weights to compute per-constituency
energy burden and shock impacts. Energy = electricity + gas.
"""

import csv
import numpy as np
import h5py
from pathlib import Path

from policyengine_uk import Microsimulation

from .config import (
    CURRENT_CAP, PRICE_SCENARIOS, SHORT_RUN_ELASTICITY,
    YEAR, SHOCK_CAP, EPG_TARGET, FLAT_TRANSFER, CT_REBATE,
    REGION_TO_COUNTRY,
)
from .baseline import weighted_mean

NEG_ELEC_SPEND = 764  # median electricity spend threshold for NEG

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


def constituency_analysis(data, country="UK"):
    """Compute per-constituency energy shock metrics using shared baseline."""
    print("Loading constituency weights...")
    const_weights, constituencies = _load_constituency_data()

    # Filter constituencies by country if not UK-wide
    country = country.upper()
    if country != "UK":
        filtered_idx = [
            i for i, c in enumerate(constituencies)
            if c.get("country", "").upper().replace(" ", "_") == country
        ]
        constituencies = [constituencies[i] for i in filtered_idx]
        const_weights = const_weights[filtered_idx] if filtered_idx else const_weights
        print(f"  Filtered to {len(constituencies)} {country} constituencies")

    energy = data["energy"]
    elec = data["elec"]
    gas = data["gas"]
    income = data["income"]

    # Pre-compute household-level policy payments (same as policy_fuel_poverty)
    pe_policies = {
        "flat_transfer": {
            "reform": {"gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER}},
            "variable": "ebr_energy_bills_credit",
        },
        "ct_rebate": {
            "reform": {"gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE}},
            "variable": "ebr_council_tax_rebate",
        },
    }
    hh_payments_fixed = {}
    for key, cfg in pe_policies.items():
        sim = Microsimulation(reform=cfg["reform"])
        pay = sim.calculate(cfg["variable"], YEAR)
        hh_payments_fixed[key] = pay.values if hasattr(pay, "values") else np.array(pay)

    # NEG baseline benefit
    neg_baseline_benefit = np.minimum(elec, NEG_ELEC_SPEND)

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

            behav_energy = energy * behav_factor
            behav_ratio = behav_energy / np.where(income > 0, income, 1)
            behav_fp = float(np.average(behav_ratio > 0.10, weights=w)) * 100

            key = name.replace("+", "plus_").replace("-", "_").replace("%", "pct")
            base_row[f"extra_cost_{key}"] = round(extra_cost)
            base_row[f"extra_pct_{key}"] = round(extra_pct, 2)
            base_row[f"behav_cost_{key}"] = round(behav_extra_cost)
            base_row[f"behav_pct_{key}"] = round(behav_extra_pct, 2)
            base_row[f"burden_pct_{key}"] = round((avg_energy * (1 + pct)) / avg_income * 100 if avg_income > 0 else 0, 2)
            base_row[f"fp_pct_{key}"] = round(shocked_fp, 1)
            base_row[f"behav_fp_pct_{key}"] = round(behav_fp, 1)

            # Post-policy metrics per policy
            safe_inc = np.where(income > 0, income, 1)
            policy_payments = {
                "flat_transfer": hh_payments_fixed["flat_transfer"],
                "ct_rebate": hh_payments_fixed["ct_rebate"],
                "bn_transfer": np.full_like(energy, float(np.average(energy, weights=data["weights"]) * pct)),
                "bn_epg": energy * pct,
            }
            # NEG payment
            shocked_elec = elec * (1 + pct)
            neg_threshold_shocked = NEG_ELEC_SPEND * (1 + pct)
            neg_benefit_shocked = np.minimum(shocked_elec, neg_threshold_shocked)
            policy_payments["neg"] = neg_benefit_shocked - neg_baseline_benefit

            for pk, pay in policy_payments.items():
                net_s = np.maximum(shocked_energy - pay, energy)
                net_extra_s = float(np.average(np.maximum(net_s - energy, 0), weights=w))
                pct_s = net_extra_s / avg_income * 100 if avg_income > 0 else 0
                fp_s = float(np.average((net_s / safe_inc) > 0.10, weights=w)) * 100

                behav_e = energy * behav_factor
                net_b = np.maximum(behav_e - pay, energy)
                net_extra_b = float(np.average(np.maximum(net_b - energy, 0), weights=w))
                pct_b = net_extra_b / avg_income * 100 if avg_income > 0 else 0
                fp_b = float(np.average((net_b / safe_inc) > 0.10, weights=w)) * 100

                base_row[f"pp_{pk}_cost_{key}"] = round(net_extra_s)
                base_row[f"pp_{pk}_pct_{key}"] = round(pct_s, 2)
                base_row[f"pp_{pk}_fp_{key}"] = round(fp_s, 1)
                base_row[f"pp_{pk}_bcost_{key}"] = round(net_extra_b)
                base_row[f"pp_{pk}_bpct_{key}"] = round(pct_b, 2)
                base_row[f"pp_{pk}_bfp_{key}"] = round(fp_b, 1)

        rows.append(base_row)

    rows.sort(key=lambda x: x["energy_burden_pct"], reverse=True)

    burdens = [r["energy_burden_pct"] for r in rows]
    if not burdens:
        return {"n_constituencies": 0, "max_burden_pct": 0, "min_burden_pct": 0, "median_burden_pct": 0, "constituencies": []}
    return {
        "n_constituencies": len(rows),
        "max_burden_pct": max(burdens),
        "min_burden_pct": min(burdens),
        "median_burden_pct": round(sorted(burdens)[len(burdens) // 2], 2),
        "constituencies": rows,
    }
