"""
Extended analysis using separate electricity and gas variables.

Adds:
- Electricity/gas baseline split by decile
- Regional energy burden breakdown
- Tenure-based energy burden breakdown
- NEF National Energy Guarantee policy (subsidise first 2,900 kWh electricity)
- Rising block tariff (cost-neutral)
- Gas-only price cap policy
"""

import json
import numpy as np
from policyengine_uk import Microsimulation
from microdf import MicroDataFrame

from .config import YEAR, CURRENT_CAP, PRICE_SCENARIOS, SHORT_RUN_ELASTICITY


# Ofgem Q4 2023 unit rates (for converting kWh thresholds to £)
ELEC_RATE = 27.35 / 100  # £/kWh
GAS_RATE = 6.89 / 100    # £/kWh

# NEF National Energy Guarantee threshold
NEG_ELEC_KWH = 2_900  # First 2,900 kWh of electricity free
NEG_ELEC_SPEND = NEG_ELEC_KWH * ELEC_RATE  # £793 at current rates


def _run_extended_baseline():
    """Run baseline and extract electricity, gas, income, weights, region, tenure, accommodation."""
    sim = Microsimulation()
    def _vals(var, **kw):
        v = sim.calculate(var, YEAR, **kw)
        return v if isinstance(v, np.ndarray) else v.values

    elec = _vals("electricity_consumption")
    gas = _vals("gas_consumption")
    total = _vals("domestic_energy_consumption")
    income = _vals("household_net_income")
    weights = _vals("household_weight", unweighted=True)
    decile = _vals("household_income_decile", unweighted=True)
    region = _vals("region")
    tenure = _vals("tenure_type")
    accomm = _vals("accommodation_type")

    return {
        "sim": sim,
        "elec": elec,
        "gas": gas,
        "total": total,
        "income": income,
        "weights": weights,
        "decile": decile,
        "region": region,
        "tenure": tenure,
        "accomm": accomm,
    }


def _weighted_mean(values, weights, mask=None):
    if mask is not None:
        values = values[mask]
        weights = weights[mask]
    if weights.sum() == 0:
        return 0
    return float(np.average(values, weights=weights))


def _energy_split_baseline(data):
    """Electricity vs gas baseline by decile."""
    deciles = []
    for d in range(1, 11):
        mask = data["decile"] == d
        me = _weighted_mean(data["elec"], data["weights"], mask)
        mg = _weighted_mean(data["gas"], data["weights"], mask)
        mt = _weighted_mean(data["total"], data["weights"], mask)
        mi = _weighted_mean(data["income"], data["weights"], mask)
        deciles.append({
            "decile": d,
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(mt),
            "elec_plus_gas": round(me + mg),
            "net_income": round(mi),
            "elec_share_pct": round(me / (me + mg) * 100, 1) if (me + mg) > 0 else 0,
            "elec_burden_pct": round(me / mi * 100, 1) if mi > 0 else 0,
            "gas_burden_pct": round(mg / mi * 100, 1) if mi > 0 else 0,
        })

    return {
        "mean_electricity": round(_weighted_mean(data["elec"], data["weights"])),
        "mean_gas": round(_weighted_mean(data["gas"], data["weights"])),
        "mean_total": round(_weighted_mean(data["total"], data["weights"])),
        "elec_share_pct": round(
            _weighted_mean(data["elec"], data["weights"])
            / _weighted_mean(data["elec"] + data["gas"], data["weights"]) * 100, 1
        ),
        "deciles": deciles,
    }


def _regional_breakdown(data):
    """Energy burden by region."""
    regions = []
    for r in sorted(np.unique(data["region"])):
        if r == "" or r is None:
            continue
        mask = data["region"] == r
        me = _weighted_mean(data["elec"], data["weights"], mask)
        mg = _weighted_mean(data["gas"], data["weights"], mask)
        mi = _weighted_mean(data["income"], data["weights"], mask)
        n_hh = float(data["weights"][mask].sum()) / 1e6
        total_e = me + mg
        regions.append({
            "region": str(r),
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(total_e),
            "net_income": round(mi),
            "energy_burden_pct": round(total_e / mi * 100, 1) if mi > 0 else 0,
            "households_m": round(n_hh, 1),
        })
    # Sort by energy burden descending
    regions.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return regions


def _tenure_breakdown(data):
    """Energy burden by tenure type."""
    tenures = []
    for t in sorted(np.unique(data["tenure"])):
        if t == "" or t is None:
            continue
        mask = data["tenure"] == t
        me = _weighted_mean(data["elec"], data["weights"], mask)
        mg = _weighted_mean(data["gas"], data["weights"], mask)
        mi = _weighted_mean(data["income"], data["weights"], mask)
        n_hh = float(data["weights"][mask].sum()) / 1e6

        # Fuel poverty rate
        total_e = data["elec"][mask] + data["gas"][mask]
        inc = data["income"][mask]
        w = data["weights"][mask]
        fp = (total_e / np.where(inc > 0, inc, 1)) > 0.10
        fp_rate = float(np.average(fp, weights=w)) * 100 if w.sum() > 0 else 0

        tenures.append({
            "tenure": str(t),
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(me + mg),
            "net_income": round(mi),
            "energy_burden_pct": round((me + mg) / mi * 100, 1) if mi > 0 else 0,
            "fuel_poverty_pct": round(fp_rate, 1),
            "households_m": round(n_hh, 1),
        })
    tenures.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return tenures


def _neg_policy(data):
    """
    NEF National Energy Guarantee: subsidise first 2,900 kWh of electricity.

    For each household:
    - If elec_spend <= NEG_ELEC_SPEND: benefit = elec_spend (fully covered)
    - If elec_spend > NEG_ELEC_SPEND: benefit = NEG_ELEC_SPEND

    Then compute by decile and across scenarios.
    """
    elec = data["elec"]
    gas = data["gas"]
    weights = data["weights"]
    income = data["income"]
    decile_arr = data["decile"]

    # Baseline benefit (no shock)
    benefit = np.minimum(elec, NEG_ELEC_SPEND)

    baseline_cost_bn = round(float(np.sum(benefit * weights)) / 1e9, 1)
    avg_benefit = round(_weighted_mean(benefit, weights))

    deciles_baseline = []
    for d in range(1, 11):
        mask = decile_arr == d
        mb = _weighted_mean(benefit, weights, mask)
        me = _weighted_mean(elec, weights, mask)
        coverage = mb / me * 100 if me > 0 else 0
        deciles_baseline.append({
            "decile": d,
            "benefit": round(mb),
            "elec_spend": round(me),
            "coverage_pct": round(coverage, 1),
        })

    # Under each shock scenario
    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        shocked_elec = elec * (1 + pct)
        shocked_gas = gas * (1 + pct)
        shocked_total = shocked_elec + shocked_gas

        # NEG benefit under shock: still covers first 2,900 kWh
        # But kWh threshold in £ also rises with price: NEG_ELEC_SPEND * (1 + pct)
        neg_threshold_shocked = NEG_ELEC_SPEND * (1 + pct)
        benefit_shocked = np.minimum(shocked_elec, neg_threshold_shocked)

        cost_bn = round(float(np.sum(benefit_shocked * weights)) / 1e9, 1)
        avg_b = round(_weighted_mean(benefit_shocked, weights))

        # Extra cost after NEG
        net_extra = (shocked_total - (elec + gas)) - (benefit_shocked - benefit)
        avg_net_extra = round(_weighted_mean(net_extra, weights))

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            mb = _weighted_mean(benefit_shocked, weights, mask)
            shock_hit = _weighted_mean(shocked_total - (elec + gas), weights, mask)
            offset = mb - _weighted_mean(benefit, weights, mask)
            offset_pct = offset / shock_hit * 100 if shock_hit > 0 else 0
            deciles.append({
                "decile": d,
                "benefit": round(mb),
                "shock_extra": round(shock_hit),
                "benefit_extra_vs_baseline": round(offset),
                "offset_pct": round(offset_pct, 1),
            })

        scenarios.append({
            "name": name,
            "new_cap": new_cap,
            "exchequer_cost_bn": cost_bn,
            "avg_benefit": avg_b,
            "avg_net_extra_cost": avg_net_extra,
            "deciles": deciles,
        })

    return {
        "name": "NEF National Energy Guarantee",
        "description": f"Subsidise first {NEG_ELEC_KWH:,} kWh of electricity per household (£{round(NEG_ELEC_SPEND)} at current rates). Progressive because low users get most or all of their electricity covered.",
        "threshold_kwh": NEG_ELEC_KWH,
        "threshold_spend": round(NEG_ELEC_SPEND),
        "baseline_cost_bn": baseline_cost_bn,
        "avg_benefit_baseline": avg_benefit,
        "deciles_baseline": deciles_baseline,
        "scenarios": scenarios,
    }


def _rising_block_tariff(data):
    """
    Rising block tariff: cost-neutral design.

    Block 1: first X kWh at reduced rate (e.g. 50% discount)
    Block 2: remaining kWh at surcharge rate

    Find the surcharge rate that makes total subsidy = total surcharge.
    We use electricity only for simplicity (as per Bangham/NEF).
    """
    elec = data["elec"]
    weights = data["weights"]
    decile_arr = data["decile"]
    income = data["income"]

    # Block 1 threshold: first 2,900 kWh = £793 at current rates
    threshold = NEG_ELEC_SPEND
    discount_rate = 0.50  # 50% off block 1

    # Block 1 spend (discounted portion)
    block1 = np.minimum(elec, threshold)
    block1_subsidy = block1 * discount_rate  # how much govt pays

    # Block 2 spend (above threshold)
    block2 = np.maximum(elec - threshold, 0)

    # Find surcharge that makes it cost-neutral
    total_subsidy = float(np.sum(block1_subsidy * weights))
    total_block2 = float(np.sum(block2 * weights))

    if total_block2 > 0:
        surcharge_rate = total_subsidy / total_block2
    else:
        surcharge_rate = 0

    # Net effect per household: saves on block 1, pays more on block 2
    net_effect = -block1_subsidy + block2 * surcharge_rate  # positive = pays more

    deciles = []
    for d in range(1, 11):
        mask = decile_arr == d
        me = _weighted_mean(elec, weights, mask)
        mb1 = _weighted_mean(block1, weights, mask)
        mb2 = _weighted_mean(block2, weights, mask)
        saving = _weighted_mean(block1_subsidy, weights, mask)
        surcharge = _weighted_mean(block2 * surcharge_rate, weights, mask)
        net = _weighted_mean(net_effect, weights, mask)
        mi = _weighted_mean(income, weights, mask)
        deciles.append({
            "decile": d,
            "elec_spend": round(me),
            "block1_spend": round(mb1),
            "block2_spend": round(mb2),
            "block1_saving": round(saving),
            "block2_surcharge": round(surcharge),
            "net_effect": round(net),
            "net_pct_income": round(net / mi * 100, 2) if mi > 0 else 0,
        })

    return {
        "name": "Rising block tariff (cost-neutral)",
        "description": f"50% discount on first {NEG_ELEC_KWH:,} kWh of electricity, funded by a {round(surcharge_rate * 100, 1)}% surcharge on consumption above that level. Zero exchequer cost — high users cross-subsidise low users.",
        "threshold_kwh": NEG_ELEC_KWH,
        "threshold_spend": round(threshold),
        "discount_rate_pct": round(discount_rate * 100),
        "surcharge_rate_pct": round(surcharge_rate * 100, 1),
        "exchequer_cost_bn": 0,
        "total_subsidy_bn": round(total_subsidy / 1e9, 1),
        "deciles": deciles,
    }


def _gas_price_cap(data):
    """
    Gas-only price cap: cap only the gas component of bills.

    Since gas prices are more volatile (directly tied to Iran/wholesale),
    cap gas bills at current level and let electricity float.
    """
    elec = data["elec"]
    gas = data["gas"]
    weights = data["weights"]
    decile_arr = data["decile"]
    income = data["income"]

    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP

        # Without policy: both rise
        shocked_elec = elec * (1 + pct)
        shocked_gas = gas * (1 + pct)
        total_shock_extra = (shocked_elec + shocked_gas) - (elec + gas)

        # With gas cap: only electricity rises, gas stays at current
        net_extra = shocked_elec - elec  # only elec increase hits
        gas_subsidy = shocked_gas - gas  # govt absorbs gas increase

        cost_bn = round(float(np.sum(gas_subsidy * weights)) / 1e9, 1)
        avg_benefit = round(_weighted_mean(gas_subsidy, weights))
        avg_net_extra = round(_weighted_mean(net_extra, weights))

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            shock = _weighted_mean(total_shock_extra, weights, mask)
            ben = _weighted_mean(gas_subsidy, weights, mask)
            remaining = _weighted_mean(net_extra, weights, mask)
            offset_pct = ben / shock * 100 if shock > 0 else 0
            deciles.append({
                "decile": d,
                "total_shock": round(shock),
                "gas_subsidy": round(ben),
                "remaining_cost": round(remaining),
                "offset_pct": round(offset_pct, 1),
            })

        scenarios.append({
            "name": name,
            "new_cap": new_cap,
            "exchequer_cost_bn": cost_bn,
            "avg_gas_subsidy": avg_benefit,
            "avg_remaining_cost": avg_net_extra,
            "deciles": deciles,
        })

    return {
        "name": "Gas-only price cap",
        "description": "Cap gas bills at current level and let electricity prices float. Gas is more volatile due to wholesale market exposure (Iran/LNG), so capping gas alone is cheaper and targets the main source of price shocks.",
        "scenarios": scenarios,
    }


def run_extended_analysis(output_path=None):
    """Run all extended analyses and return results dict."""
    print("Running extended baseline (elec/gas split)...")
    data = _run_extended_baseline()

    print("Computing electricity/gas baseline split...")
    energy_split = _energy_split_baseline(data)

    print("Computing regional breakdown...")
    regional = _regional_breakdown(data)

    print("Computing tenure breakdown...")
    tenure = _tenure_breakdown(data)

    print("Computing NEF National Energy Guarantee...")
    neg = _neg_policy(data)

    print("Computing rising block tariff...")
    rbt = _rising_block_tariff(data)

    print("Computing gas-only price cap...")
    gas_cap = _gas_price_cap(data)

    results = {
        "energy_split": energy_split,
        "regional": regional,
        "tenure": tenure,
        "neg_policy": neg,
        "rising_block_tariff": rbt,
        "gas_price_cap": gas_cap,
    }

    if output_path:
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Extended results saved to {output_path}")

    return results
