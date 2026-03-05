import json
import numpy as np
from policyengine_uk import Microsimulation
from microdf import MicroDataFrame

from .config import (
    YEAR, CURRENT_CAP, PRICE_SCENARIOS,
    SHOCK_CAP, EPG_TARGET, FLAT_TRANSFER, CT_REBATE,
)
from .utils import calc_decile_table


def _run_baseline():
    """Run baseline simulation and return core series + decile tables."""
    sim = Microsimulation()
    energy = sim.calculate("domestic_energy_consumption", YEAR)
    net_income = sim.calculate("household_net_income", YEAR)
    weights = sim.calculate("household_weight", YEAR, unweighted=True)

    energy_by_decile = calc_decile_table(sim, "domestic_energy_consumption", YEAR)
    income_by_decile = calc_decile_table(sim, "household_net_income", YEAR)

    return sim, energy, net_income, weights, energy_by_decile, income_by_decile


def _baseline_summary(energy, net_income, weights, energy_by_decile, income_by_decile):
    """Section 1: baseline energy spend."""
    n_households = float(weights.sum())
    deciles = []
    for d in range(1, 11):
        e = float(energy_by_decile.get(d, 0))
        inc = float(income_by_decile.get(d, 0))
        deciles.append({
            "decile": d,
            "energy_spend": round(e),
            "net_income": round(inc),
            "energy_share_pct": round(e / inc * 100, 1) if inc > 0 else 0,
        })
    return {
        "n_households_m": round(n_households / 1e6, 1),
        "current_cap": CURRENT_CAP,
        "mean_energy_spend": round(float(energy.mean())),
        "total_energy_spend_bn": round(float(energy.sum()) / 1e9, 1),
        "mean_net_income": round(float(net_income.mean())),
        "deciles": deciles,
    }


def _shock_scenarios(energy, weights, energy_by_decile, income_by_decile):
    """Section 2: price shock impact with no policy response."""
    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        deciles = []
        for d in range(1, 11):
            extra = float(energy_by_decile.get(d, 0)) * pct
            inc = float(income_by_decile.get(d, 0))
            deciles.append({
                "decile": d,
                "extra_cost": round(extra),
                "pct_of_income": round(extra / inc * 100, 1) if inc > 0 else 0,
            })
        scenarios.append({
            "name": name,
            "new_cap": new_cap,
            "price_increase_pct": round(pct * 100),
            "avg_hh_hit_yr": round(float(energy.mean()) * pct),
            "avg_hh_hit_mo": round(float(energy.mean()) * pct / 12),
            "total_cost_bn": round(float(energy.sum()) * pct / 1e9, 1),
            "deciles": deciles,
        })
    return scenarios


def _fuel_poverty(energy, net_income, weights):
    """Section 3: fuel poverty counts."""
    fp_df = MicroDataFrame(
        {"energy": energy.values, "income": net_income.values},
        weights=weights,
    )

    fp_df["fuel_poor"] = (fp_df.energy / fp_df.income.clip(lower=1)) > 0.10
    baseline_rate = float(fp_df.fuel_poor.mean())
    baseline_count = float(fp_df.fuel_poor.sum())

    rows = [{
        "scenario": "Baseline (current prices)",
        "fuel_poverty_rate_pct": round(baseline_rate * 100, 1),
        "households_m": round(baseline_count / 1e6, 1),
        "extra_households_m": 0,
    }]

    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        shocked = fp_df.energy * (1 + pct)
        fuel_poor = (shocked / fp_df.income.clip(lower=1)) > 0.10
        rows.append({
            "scenario": f"{name} (cap -> {new_cap})",
            "fuel_poverty_rate_pct": round(float(fuel_poor.mean()) * 100, 1),
            "households_m": round(float(fuel_poor.sum()) / 1e6, 1),
            "extra_households_m": round((float(fuel_poor.sum()) - baseline_count) / 1e6, 1),
        })

    return rows


def _policy_epg(energy_by_decile):
    """Policy A: Energy Price Guarantee."""
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    sim = Microsimulation(reform={
        "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
        "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
    })
    subsidy = sim.calculate("epg_subsidy", YEAR)
    by_decile = calc_decile_table(sim, "epg_subsidy", YEAR)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        shock = float(energy_by_decile.get(d, 0)) * shock_pct
        deciles.append({
            "decile": d,
            "payment": round(val),
            "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
        })
    return {
        "name": "EPG subsidy",
        "description": f"Energy Price Guarantee at {EPG_TARGET}",
        "exchequer_cost_bn": round(float(subsidy.sum()) / 1e9, 1),
        "avg_hh_benefit": round(float(subsidy.mean())),
        "deciles": deciles,
    }


def _policy_flat(energy_by_decile):
    """Policy B: Flat transfer."""
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    sim = Microsimulation(reform={
        "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
    })
    credit = sim.calculate("ebr_energy_bills_credit", YEAR)
    by_decile = calc_decile_table(sim, "ebr_energy_bills_credit", YEAR)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        shock = float(energy_by_decile.get(d, 0)) * shock_pct
        deciles.append({
            "decile": d,
            "payment": round(val),
            "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
        })
    return {
        "name": "Flat transfer",
        "description": f"{FLAT_TRANSFER} per household",
        "exchequer_cost_bn": round(float(credit.sum()) / 1e9, 1),
        "avg_hh_benefit": round(float(credit.mean())),
        "deciles": deciles,
    }


def _policy_ct_rebate(energy_by_decile):
    """Policy C: Council tax band rebate."""
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    sim = Microsimulation(reform={
        "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
    })
    rebate = sim.calculate("ebr_council_tax_rebate", YEAR)
    by_decile = calc_decile_table(sim, "ebr_council_tax_rebate", YEAR)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        shock = float(energy_by_decile.get(d, 0)) * shock_pct
        deciles.append({
            "decile": d,
            "payment": round(val),
            "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
        })
    return {
        "name": "CT band rebate",
        "description": f"{CT_REBATE} for bands A-D",
        "exchequer_cost_bn": round(float(rebate.sum()) / 1e9, 1),
        "avg_hh_benefit": round(float(rebate.mean())),
        "deciles": deciles,
    }


def _policy_wfa(baseline_sim, energy_by_decile):
    """Policy D: Expanded Winter Fuel Allowance."""
    sim = Microsimulation(reform={
        "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {"2026-01-01": False},
        "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": 500},
        "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": 350},
    })
    wfa_reformed = sim.calculate("winter_fuel_allowance", YEAR)
    wfa_baseline = baseline_sim.calculate("winter_fuel_allowance", YEAR)
    extra_cost = float(wfa_reformed.sum()) - float(wfa_baseline.sum())

    by_decile = calc_decile_table(sim, "winter_fuel_allowance", YEAR)
    bl_by_decile = calc_decile_table(baseline_sim, "winter_fuel_allowance", YEAR)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        bl = float(bl_by_decile.get(d, 0))
        deciles.append({
            "decile": d,
            "payment": round(val),
            "extra_vs_baseline": round(val - bl),
        })
    return {
        "name": "Expanded winter fuel",
        "description": "Universal for pensioners, 350/500",
        "exchequer_cost_bn": round(extra_cost / 1e9, 1),
        "total_spending_bn": round(float(wfa_reformed.sum()) / 1e9, 1),
        "avg_hh_benefit": round(float(wfa_reformed.mean())),
        "deciles": deciles,
    }


def _policy_combined(baseline_sim, energy_by_decile, income_by_decile):
    """Policy E: Combined package."""
    sim = Microsimulation(reform={
        "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
        "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
        "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
        "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
        "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {"2026-01-01": False},
        "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": 500},
        "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": 350},
    })

    epg = sim.calculate("epg_subsidy", YEAR)
    flat = sim.calculate("ebr_energy_bills_credit", YEAR)
    ct = sim.calculate("ebr_council_tax_rebate", YEAR)
    wfa = sim.calculate("winter_fuel_allowance", YEAR)
    wfa_baseline = baseline_sim.calculate("winter_fuel_allowance", YEAR)
    net = sim.calculate("household_net_income", YEAR)

    total_cost = (
        float(epg.sum()) + float(flat.sum()) + float(ct.sum())
        + (float(wfa.sum()) - float(wfa_baseline.sum()))
    )

    net_by_decile = calc_decile_table(sim, "household_net_income", YEAR)
    deciles = []
    for d in range(1, 11):
        change = float(net_by_decile.get(d, 0)) - float(income_by_decile.get(d, 0))
        inc = float(income_by_decile.get(d, 0))
        deciles.append({
            "decile": d,
            "net_income_change": round(change),
            "pct_change": round(change / inc * 100, 1) if inc > 0 else 0,
        })

    return {
        "name": "Combined package",
        "description": "EPG + flat transfer + CT rebate + expanded WFA",
        "exchequer_cost_bn": round(total_cost / 1e9, 1),
        "component_costs_bn": {
            "epg": round(float(epg.sum()) / 1e9, 1),
            "flat_transfer": round(float(flat.sum()) / 1e9, 1),
            "ct_rebate": round(float(ct.sum()) / 1e9, 1),
            "extra_wfa": round((float(wfa.sum()) - float(wfa_baseline.sum())) / 1e9, 1),
        },
        "avg_net_income_change": round(float(net.mean()) - float(
            baseline_sim.calculate("household_net_income", YEAR).mean()
        )),
        "deciles": deciles,
    }


def run_full_analysis(output_path=None):
    """Run all analysis sections and return results as a dict (optionally save to JSON)."""
    print("Running baseline simulation...")
    sim, energy, net_income, weights, energy_by_decile, income_by_decile = _run_baseline()

    print("Computing baseline summary...")
    baseline = _baseline_summary(energy, net_income, weights, energy_by_decile, income_by_decile)

    print("Computing shock scenarios...")
    scenarios = _shock_scenarios(energy, weights, energy_by_decile, income_by_decile)

    print("Computing fuel poverty...")
    fuel_poverty = _fuel_poverty(energy, net_income, weights)

    print("Running Policy A: EPG...")
    pol_epg = _policy_epg(energy_by_decile)

    print("Running Policy B: Flat transfer...")
    pol_flat = _policy_flat(energy_by_decile)

    print("Running Policy C: CT rebate...")
    pol_ct = _policy_ct_rebate(energy_by_decile)

    print("Running Policy D: Winter fuel...")
    pol_wfa = _policy_wfa(sim, energy_by_decile)

    print("Running Policy E: Combined...")
    pol_combined = _policy_combined(sim, energy_by_decile, income_by_decile)

    results = {
        "baseline": baseline,
        "shock_scenarios": scenarios,
        "fuel_poverty": fuel_poverty,
        "policies": {
            "epg": pol_epg,
            "flat_transfer": pol_flat,
            "ct_rebate": pol_ct,
            "winter_fuel": pol_wfa,
            "combined": pol_combined,
        },
        "config": {
            "year": YEAR,
            "current_cap": CURRENT_CAP,
            "shock_cap": SHOCK_CAP,
            "epg_target": EPG_TARGET,
            "flat_transfer": FLAT_TRANSFER,
            "ct_rebate": CT_REBATE,
        },
    }

    if output_path:
        with open(output_path, "w") as f:
            json.dump(results, f, indent=2)
        print(f"Results saved to {output_path}")

    return results
