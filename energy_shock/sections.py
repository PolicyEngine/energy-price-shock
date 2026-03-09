"""
All analysis sections: baseline summary, shocks, fuel poverty, behavioural,
policies (A–F), electricity/gas split, regional, tenure, NEG, rising block
tariff, gas-only cap.

Every function takes the shared `data` dict from baseline.run_baseline().
Energy = electricity + gas everywhere.
"""

import numpy as np
from policyengine_uk import Microsimulation
from microdf import MicroDataFrame

from .config import (
    YEAR, CURRENT_CAP, PRICE_SCENARIOS,
    SHOCK_CAP, EPG_TARGET, FLAT_TRANSFER, CT_REBATE,
    SHORT_RUN_ELASTICITY,
)
from .baseline import weighted_mean, decile_means

# Ofgem Q4 2023 unit rates (for kWh threshold conversions)
ELEC_RATE = 27.35 / 100  # £/kWh
GAS_RATE = 6.89 / 100    # £/kWh
NEG_ELEC_KWH = 2_900
NEG_ELEC_SPEND = NEG_ELEC_KWH * ELEC_RATE


# ── helpers ──────────────────────────────────────────────────────────────

def _calc_decile_table(sim, variable):
    """Weighted mean of a PolicyEngine variable by income decile."""
    from .baseline import _vals
    values = sim.calculate(variable, YEAR)
    deciles = _vals(sim, "household_income_decile", unweighted=True)
    weights = _vals(sim, "household_weight", unweighted=True)
    df = MicroDataFrame(
        {"value": values.values if hasattr(values, "values") else values,
         "decile": deciles},
        weights=weights,
    )
    df = df[df.decile > 0]
    return df.groupby("decile")["value"].mean()


# ── 1. Baseline summary ─────────────────────────────────────────────────

def baseline_summary(data):
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    n_households = float(data["weights"].sum())

    deciles = []
    for d in range(1, 11):
        e = energy_by_dec[d]
        inc = income_by_dec[d]
        deciles.append({
            "decile": d,
            "energy_spend": round(e),
            "net_income": round(inc),
            "energy_share_pct": round(e / inc * 100, 1) if inc > 0 else 0,
        })

    return {
        "n_households_m": round(n_households / 1e6, 1),
        "current_cap": CURRENT_CAP,
        "mean_energy_spend": round(weighted_mean(data["energy"], data["weights"])),
        "total_energy_spend_bn": round(float(np.sum(data["energy"] * data["weights"])) / 1e9, 1),
        "mean_net_income": round(weighted_mean(data["income"], data["weights"])),
        "deciles": deciles,
    }


# ── 2. Shock scenarios ──────────────────────────────────────────────────

def _grouped_shock(data, group_key, label_key, pct, epsilon=None):
    """Compute shock impacts grouped by a categorical variable.

    If epsilon is None, returns static impacts only.
    If epsilon is given, returns both static and behavioural.
    """
    energy, income, weights = data["energy"], data["income"], data["weights"]
    groups = sorted(np.unique(data[group_key]))
    rows = []
    behavioral_factor = (1 + pct) * (1 + epsilon * pct) if epsilon else None
    for g in groups:
        g_str = str(g)
        if g_str == "" or g_str == "None":
            continue
        mask = data[group_key] == g
        e_g, i_g, w_g = energy[mask], income[mask], weights[mask]
        avg_e = weighted_mean(energy, weights, mask)
        avg_i = weighted_mean(income, weights, mask)
        extra = avg_e * pct
        n_hh = float(w_g.sum()) / 1e6

        # Static fuel poverty
        shocked_e = e_g * (1 + pct)
        ratio = shocked_e / np.where(i_g > 0, i_g, 1)
        static_fp = float(np.average(ratio > 0.10, weights=w_g)) * 100 if w_g.sum() > 0 else 0
        static_fp_hh = round(static_fp / 100 * n_hh, 2)

        row = {
            label_key: g_str,
            "extra_cost": round(extra),
            "pct_of_income": round(extra / avg_i * 100, 1) if avg_i > 0 else 0,
            "fp_rate": round(static_fp, 1),
            "fp_households_m": round(static_fp_hh, 2),
        }
        if epsilon is not None:
            b_extra = avg_e * (behavioral_factor - 1)
            behav_e = e_g * behavioral_factor
            b_ratio = behav_e / np.where(i_g > 0, i_g, 1)
            behav_fp = float(np.average(b_ratio > 0.10, weights=w_g)) * 100 if w_g.sum() > 0 else 0
            behav_fp_hh = round(behav_fp / 100 * n_hh, 2)
            row["behavioral_extra_cost"] = round(b_extra)
            row["behavioral_pct_of_income"] = round(b_extra / avg_i * 100, 1) if avg_i > 0 else 0
            row["behavioral_fp_rate"] = round(behav_fp, 1)
            row["behavioral_fp_households_m"] = round(behav_fp_hh, 2)
        rows.append(row)
    return rows


def shock_scenarios(data):
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    mean_energy = weighted_mean(data["energy"], data["weights"])
    total_energy = float(np.sum(data["energy"] * data["weights"]))

    energy_arr, income_arr, weights_arr = data["energy"], data["income"], data["weights"]
    decile_arr = data["decile"]

    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        deciles = []
        for d in range(1, 11):
            extra = energy_by_dec[d] * pct
            inc = income_by_dec[d]
            mask = decile_arr == d
            e_d, i_d, w_d = energy_arr[mask], income_arr[mask], weights_arr[mask]
            shocked_e = e_d * (1 + pct)
            ratio = shocked_e / np.where(i_d > 0, i_d, 1)
            n_hh = float(w_d.sum()) / 1e6
            fp_rate = float(np.average(ratio > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0
            deciles.append({
                "decile": d,
                "extra_cost": round(extra),
                "pct_of_income": round(extra / inc * 100, 1) if inc > 0 else 0,
                "fp_rate": round(fp_rate, 1),
                "fp_households_m": round(fp_rate / 100 * n_hh, 2),
            })
        scenarios.append({
            "name": name,
            "new_cap": new_cap,
            "price_increase_pct": round(pct * 100),
            "avg_hh_hit_yr": round(mean_energy * pct),
            "avg_hh_hit_mo": round(mean_energy * pct / 12),
            "total_cost_bn": round(total_energy * pct / 1e9, 1),
            "deciles": deciles,
            "by_tenure": _grouped_shock(data, "tenure", "tenure", pct),
            "by_hh_type": _grouped_shock(data, "hh_type", "hh_type", pct),
        })
    return scenarios


# ── 3. Fuel poverty ─────────────────────────────────────────────────────

def fuel_poverty(data):
    energy, income, weights = data["energy"], data["income"], data["weights"]
    fp_df = MicroDataFrame(
        {"energy": energy, "income": income}, weights=weights,
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


# ── 4. Behavioural responses ────────────────────────────────────────────

def behavioral_responses(data):
    energy, income, weights = data["energy"], data["income"], data["weights"]
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    mean_energy = weighted_mean(energy, weights)
    epsilon = SHORT_RUN_ELASTICITY

    results_list = []
    for name, new_cap in PRICE_SCENARIOS.items():
        price_pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        consumption_change_pct = epsilon * price_pct
        behavioral_factor = (1 + price_pct) * (1 + consumption_change_pct)
        static_factor = (1 + price_pct)

        static_extra = mean_energy * price_pct
        behavioral_extra = mean_energy * (behavioral_factor - 1)
        bill_saving = static_extra - behavioral_extra
        welfare_loss_comfort = mean_energy * 0.5 * abs(epsilon) * (price_pct ** 2)

        decile_arr = data["decile"]
        deciles = []
        for d in range(1, 11):
            e = energy_by_dec[d]
            inc = income_by_dec[d]
            static_hit = e * price_pct
            behavioral_hit = e * (behavioral_factor - 1)

            mask = decile_arr == d
            e_d, i_d, w_d = energy[mask], income[mask], weights[mask]
            n_hh = float(w_d.sum()) / 1e6
            s_ratio = (e_d * static_factor) / np.where(i_d > 0, i_d, 1)
            b_ratio = (e_d * behavioral_factor) / np.where(i_d > 0, i_d, 1)
            s_fp = float(np.average(s_ratio > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0
            b_fp = float(np.average(b_ratio > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0

            deciles.append({
                "decile": d,
                "static_extra_cost": round(static_hit),
                "behavioral_extra_cost": round(behavioral_hit),
                "bill_saving": round(static_hit - behavioral_hit),
                "consumption_reduction_pct": round(consumption_change_pct * 100, 1),
                "static_pct_of_income": round(static_hit / inc * 100, 1) if inc > 0 else 0,
                "behavioral_pct_of_income": round(behavioral_hit / inc * 100, 1) if inc > 0 else 0,
                "static_fp_rate": round(s_fp, 1),
                "behavioral_fp_rate": round(b_fp, 1),
                "static_fp_households_m": round(s_fp / 100 * n_hh, 2),
                "behavioral_fp_households_m": round(b_fp / 100 * n_hh, 2),
            })

        fp_df = MicroDataFrame({"energy": energy, "income": income}, weights=weights)
        static_fp = (fp_df.energy * static_factor / fp_df.income.clip(lower=1)) > 0.10
        behavioral_fp = (fp_df.energy * behavioral_factor / fp_df.income.clip(lower=1)) > 0.10

        results_list.append({
            "name": name,
            "new_cap": new_cap,
            "price_increase_pct": round(price_pct * 100),
            "elasticity": epsilon,
            "consumption_change_pct": round(consumption_change_pct * 100, 1),
            "static_avg_extra": round(static_extra),
            "behavioral_avg_extra": round(behavioral_extra),
            "bill_saving_avg": round(bill_saving),
            "welfare_loss_comfort_avg": round(welfare_loss_comfort),
            "static_fp_rate": round(float(static_fp.mean()) * 100, 1),
            "behavioral_fp_rate": round(float(behavioral_fp.mean()) * 100, 1),
            "static_fp_households_m": round(float(static_fp.sum()) / 1e6, 1),
            "behavioral_fp_households_m": round(float(behavioral_fp.sum()) / 1e6, 1),
            "deciles": deciles,
            "by_tenure": _grouped_shock(data, "tenure", "tenure", price_pct, epsilon),
            "by_hh_type": _grouped_shock(data, "hh_type", "hh_type", price_pct, epsilon),
        })
    return results_list


# ── 5. Policy A: EPG ────────────────────────────────────────────────────

def policy_epg(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    sim = Microsimulation(reform={
        "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
        "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
    })
    subsidy = sim.calculate("epg_subsidy", YEAR)
    by_decile = _calc_decile_table(sim, "epg_subsidy")

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        shock = energy_by_dec[d] * shock_pct
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


# ── 6. Policy B: Flat transfer ──────────────────────────────────────────

def policy_flat(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    sim = Microsimulation(reform={
        "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
    })
    credit = sim.calculate("ebr_energy_bills_credit", YEAR)
    by_decile = _calc_decile_table(sim, "ebr_energy_bills_credit")

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        shock = energy_by_dec[d] * shock_pct
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


# ── 7. Policy C: CT rebate ──────────────────────────────────────────────

def policy_ct_rebate(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    sim = Microsimulation(reform={
        "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
    })
    rebate = sim.calculate("ebr_council_tax_rebate", YEAR)
    by_decile = _calc_decile_table(sim, "ebr_council_tax_rebate")

    deciles = []
    for d in range(1, 11):
        val = float(by_decile.get(d, 0))
        shock = energy_by_dec[d] * shock_pct
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


# ── 8. Policy D: Expanded WFA ───────────────────────────────────────────

def policy_wfa(data):
    sim = Microsimulation(reform={
        "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {"2026-01-01": False},
        "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": 500},
        "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": 350},
    })
    wfa_reformed = sim.calculate("winter_fuel_allowance", YEAR)
    wfa_baseline = data["sim"].calculate("winter_fuel_allowance", YEAR)
    extra_cost = float(wfa_reformed.sum()) - float(wfa_baseline.sum())

    by_decile = _calc_decile_table(sim, "winter_fuel_allowance")
    bl_by_decile = _calc_decile_table(data["sim"], "winter_fuel_allowance")

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


# ── 9. Policy E: Combined ───────────────────────────────────────────────

def policy_combined(data):
    income_by_dec = decile_means(data, "income")
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
    wfa_baseline = data["sim"].calculate("winter_fuel_allowance", YEAR)
    net = sim.calculate("household_net_income", YEAR)

    total_cost = (
        float(epg.sum()) + float(flat.sum()) + float(ct.sum())
        + (float(wfa.sum()) - float(wfa_baseline.sum()))
    )

    net_by_decile = _calc_decile_table(sim, "household_net_income")
    deciles = []
    for d in range(1, 11):
        change = float(net_by_decile.get(d, 0)) - income_by_dec[d]
        inc = income_by_dec[d]
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
            data["sim"].calculate("household_net_income", YEAR).mean()
        )),
        "deciles": deciles,
    }


# ── 10. Policy net position ─────────────────────────────────────────────

def policy_net_position(data):
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    mean_energy = weighted_mean(data["energy"], data["weights"])
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    epsilon = SHORT_RUN_ELASTICITY
    consumption_change = epsilon * shock_pct
    behavioral_factor = (1 + shock_pct) * (1 + consumption_change)

    policies_config = {
        "epg": {
            "name": "EPG subsidy",
            "reform": {
                "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
                "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
            },
            "variable": "epg_subsidy",
        },
        "flat_transfer": {
            "name": "Flat transfer",
            "reform": {
                "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
            },
            "variable": "ebr_energy_bills_credit",
        },
        "ct_rebate": {
            "name": "CT band rebate",
            "reform": {
                "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
            },
            "variable": "ebr_council_tax_rebate",
        },
    }

    results_dict = {}
    for key, cfg in policies_config.items():
        sim = Microsimulation(reform=cfg["reform"])
        benefit = sim.calculate(cfg["variable"], YEAR)
        by_decile = _calc_decile_table(sim, cfg["variable"])

        deciles = []
        for d in range(1, 11):
            e = energy_by_dec[d]
            inc = income_by_dec[d]
            static_shock = e * shock_pct
            behavioral_shock = e * (behavioral_factor - 1)
            policy_benefit = float(by_decile.get(d, 0))
            net_static = static_shock - policy_benefit
            net_behavioral = behavioral_shock - policy_benefit
            deciles.append({
                "decile": d,
                "baseline_energy": round(e),
                "shock_extra_static": round(static_shock),
                "shock_extra_behavioral": round(behavioral_shock),
                "policy_benefit": round(policy_benefit),
                "net_cost_static": round(max(net_static, 0)),
                "net_cost_behavioral": round(max(net_behavioral, 0)),
                "offset_pct_static": round(policy_benefit / static_shock * 100) if static_shock > 0 else 0,
                "offset_pct_behavioral": round(policy_benefit / behavioral_shock * 100) if behavioral_shock > 0 else 0,
            })

        results_dict[key] = {
            "name": cfg["name"],
            "exchequer_cost_bn": round(float(benefit.sum()) / 1e9, 1),
            "avg_benefit": round(float(benefit.mean())),
            "avg_shock_static": round(mean_energy * shock_pct),
            "avg_shock_behavioral": round(mean_energy * (behavioral_factor - 1)),
            "avg_net_cost_static": round(mean_energy * shock_pct - float(benefit.mean())),
            "avg_net_cost_behavioral": round(mean_energy * (behavioral_factor - 1) - float(benefit.mean())),
            "deciles": deciles,
        }
    return results_dict


# ── 10b. Post-policy fuel poverty ────────────────────────────────────────

def _fp_by_group(energy, income, weights, payment, group_arr, groups, pct, behavioral_factor):
    """Compute post-policy FP rates grouped by an arbitrary categorical array."""
    result = []
    for g in groups:
        mask = group_arr == g
        e_g, i_g, w_g, p_g = energy[mask], income[mask], weights[mask], payment[mask]
        n_hh = float(w_g.sum()) / 1e6
        if n_hh == 0:
            result.append({"group": g, "extra_cost": 0, "pct_of_income": 0,
                           "fp_rate": 0, "fp_households_m": 0,
                           "behavioral_extra_cost": 0, "behavioral_pct_of_income": 0,
                           "behavioral_fp_rate": 0, "behavioral_fp_households_m": 0})
            continue
        # Static
        shocked_e = e_g * (1 + pct)
        net_s = np.maximum(shocked_e - p_g, 0)
        extra_s = float(weighted_mean(net_s - e_g, w_g))
        pct_inc_s = float(weighted_mean(net_s / np.where(i_g > 0, i_g, 1) * 100, w_g))
        fp_s = float(np.average((net_s / np.where(i_g > 0, i_g, 1)) > 0.10, weights=w_g)) * 100
        # Behavioural
        behav_e = e_g * behavioral_factor
        net_b = np.maximum(behav_e - p_g, 0)
        extra_b = float(weighted_mean(net_b - e_g, w_g))
        pct_inc_b = float(weighted_mean(net_b / np.where(i_g > 0, i_g, 1) * 100, w_g))
        fp_b = float(np.average((net_b / np.where(i_g > 0, i_g, 1)) > 0.10, weights=w_g)) * 100
        result.append({
            "group": str(g),
            "extra_cost": round(extra_s),
            "pct_of_income": round(pct_inc_s, 1),
            "fp_rate": round(fp_s, 1),
            "fp_households_m": round(fp_s / 100 * n_hh, 2),
            "behavioral_extra_cost": round(extra_b),
            "behavioral_pct_of_income": round(pct_inc_b, 1),
            "behavioral_fp_rate": round(fp_b, 1),
            "behavioral_fp_households_m": round(fp_b / 100 * n_hh, 2),
        })
    return result


def policy_fuel_poverty(data):
    """Compute fuel poverty rates after each policy for every scenario,
    broken down by decile, tenure, and household type.

    Returns dict keyed by policy name, each containing a list of scenario dicts.
    """
    energy = data["energy"]
    income = data["income"]
    weights = data["weights"]
    decile_arr = data["decile"]
    tenure_arr = data["tenure"]
    hh_type_arr = data["hh_type"]
    tenure_groups = sorted(np.unique(tenure_arr))
    hh_type_groups = sorted(np.unique(hh_type_arr))
    epsilon = SHORT_RUN_ELASTICITY

    # --- Get household-level payment arrays for PE policies (A-C) ---
    pe_policies = {
        "epg": {
            "reform": {
                "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
                "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
            },
            "variable": "epg_subsidy",
        },
        "flat_transfer": {
            "reform": {
                "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
            },
            "variable": "ebr_energy_bills_credit",
        },
        "ct_rebate": {
            "reform": {
                "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
            },
            "variable": "ebr_council_tax_rebate",
        },
    }

    # Household-level payment arrays for A-C (fixed, don't vary by scenario)
    hh_payments = {}
    for key, cfg in pe_policies.items():
        sim = Microsimulation(reform=cfg["reform"])
        pay = sim.calculate(cfg["variable"], YEAR)
        hh_payments[key] = pay.values if hasattr(pay, "values") else np.array(pay)

    # EPG scales by scenario: only activates above EPG_TARGET
    # The microsim was run at SHOCK_CAP (+60%), so we scale the subsidy
    epg_ref_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP

    results = {}
    for policy_key in ["epg", "flat_transfer", "ct_rebate", "bn_transfer", "bn_epg"]:
        scenario_list = []
        for name, new_cap in PRICE_SCENARIOS.items():
            pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
            behavioral_factor = (1 + pct) * (1 + epsilon * pct)

            # Compute household-level payment for this scenario
            if policy_key == "epg":
                # Scale EPG: only activates when cap > EPG_TARGET
                epg_scale = max(0, new_cap - EPG_TARGET) / (SHOCK_CAP - EPG_TARGET)
                payment = hh_payments["epg"] * epg_scale
            elif policy_key in hh_payments:
                payment = hh_payments[policy_key]
            elif policy_key == "bn_transfer":
                # Flat payment = average extra cost
                avg_extra = float(weighted_mean(energy, weights) * pct)
                payment = np.full_like(energy, avg_extra)
            elif policy_key == "bn_epg":
                # Full offset: payment = each household's extra cost
                payment = energy * pct
            else:
                payment = np.zeros_like(energy)

            deciles = []
            for d in range(1, 11):
                mask = decile_arr == d
                e_d = energy[mask]
                i_d = income[mask]
                w_d = weights[mask]
                p_d = payment[mask]
                n_hh = float(w_d.sum()) / 1e6

                # Static: shocked energy minus policy payment
                shocked_e = e_d * (1 + pct)
                net_e_static = np.maximum(shocked_e - p_d, 0)
                ratio_s = net_e_static / np.where(i_d > 0, i_d, 1)
                fp_static = float(np.average(ratio_s > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0

                # Behavioural: reduced consumption minus policy payment
                behav_e = e_d * behavioral_factor
                net_e_behav = np.maximum(behav_e - p_d, 0)
                ratio_b = net_e_behav / np.where(i_d > 0, i_d, 1)
                fp_behav = float(np.average(ratio_b > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0

                deciles.append({
                    "decile": d,
                    "fp_rate": round(fp_static, 1),
                    "fp_households_m": round(fp_static / 100 * n_hh, 2),
                    "behavioral_fp_rate": round(fp_behav, 1),
                    "behavioral_fp_households_m": round(fp_behav / 100 * n_hh, 2),
                })

            # Aggregate
            shocked_all = energy * (1 + pct)
            net_all_s = np.maximum(shocked_all - payment, 0)
            fp_all_s = float(np.average(
                (net_all_s / np.where(income > 0, income, 1)) > 0.10,
                weights=weights,
            )) * 100
            behav_all = energy * behavioral_factor
            net_all_b = np.maximum(behav_all - payment, 0)
            fp_all_b = float(np.average(
                (net_all_b / np.where(income > 0, income, 1)) > 0.10,
                weights=weights,
            )) * 100
            n_total = float(weights.sum()) / 1e6

            # Tenure and household type breakdowns
            by_tenure = _fp_by_group(energy, income, weights, payment,
                                     tenure_arr, tenure_groups, pct, behavioral_factor)
            for t in by_tenure:
                t["tenure"] = t.pop("group")
            by_hh_type = _fp_by_group(energy, income, weights, payment,
                                      hh_type_arr, hh_type_groups, pct, behavioral_factor)
            for h in by_hh_type:
                h["hh_type"] = h.pop("group")

            scenario_list.append({
                "scenario": name,
                "fp_rate": round(fp_all_s, 1),
                "fp_households_m": round(fp_all_s / 100 * n_total, 2),
                "behavioral_fp_rate": round(fp_all_b, 1),
                "behavioral_fp_households_m": round(fp_all_b / 100 * n_total, 2),
                "deciles": deciles,
                "by_tenure": by_tenure,
                "by_hh_type": by_hh_type,
            })
        results[policy_key] = scenario_list

    # --- NEG: household-level benefit = min(elec, threshold) at shocked prices ---
    elec, gas = data["elec"], data["gas"]
    neg_baseline_benefit = np.minimum(elec, NEG_ELEC_SPEND)

    neg_scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        behavioral_factor = (1 + pct) * (1 + epsilon * pct)
        shocked_elec = elec * (1 + pct)
        neg_threshold_shocked = NEG_ELEC_SPEND * (1 + pct)
        benefit_shocked = np.minimum(shocked_elec, neg_threshold_shocked)
        # NEG payment = extra benefit vs baseline
        payment = benefit_shocked - neg_baseline_benefit

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            e_d, i_d, w_d, p_d = energy[mask], income[mask], weights[mask], payment[mask]
            n_hh = float(w_d.sum()) / 1e6
            shocked_e = e_d * (1 + pct)
            net_s = np.maximum(shocked_e - p_d, 0)
            fp_s = float(np.average((net_s / np.where(i_d > 0, i_d, 1)) > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0
            behav_e = e_d * behavioral_factor
            net_b = np.maximum(behav_e - p_d, 0)
            fp_b = float(np.average((net_b / np.where(i_d > 0, i_d, 1)) > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0
            deciles.append({
                "decile": d,
                "fp_rate": round(fp_s, 1), "fp_households_m": round(fp_s / 100 * n_hh, 2),
                "behavioral_fp_rate": round(fp_b, 1), "behavioral_fp_households_m": round(fp_b / 100 * n_hh, 2),
            })
        n_total = float(weights.sum()) / 1e6
        shocked_all = energy * (1 + pct)
        net_all_s = np.maximum(shocked_all - payment, 0)
        fp_all_s = float(np.average((net_all_s / np.where(income > 0, income, 1)) > 0.10, weights=weights)) * 100
        behav_all = energy * behavioral_factor
        net_all_b = np.maximum(behav_all - payment, 0)
        fp_all_b = float(np.average((net_all_b / np.where(income > 0, income, 1)) > 0.10, weights=weights)) * 100
        neg_scenarios.append({
            "scenario": name,
            "fp_rate": round(fp_all_s, 1), "fp_households_m": round(fp_all_s / 100 * n_total, 2),
            "behavioral_fp_rate": round(fp_all_b, 1), "behavioral_fp_households_m": round(fp_all_b / 100 * n_total, 2),
            "deciles": deciles,
        })
    results["neg"] = neg_scenarios

    # --- RBT: household-level net effect (negative = saving) ---
    threshold = NEG_ELEC_SPEND
    discount_rate = 0.50
    block1 = np.minimum(elec, threshold)
    block1_subsidy = block1 * discount_rate
    block2 = np.maximum(elec - threshold, 0)
    total_subsidy = float(np.sum(block1_subsidy * weights))
    total_block2 = float(np.sum(block2 * weights))
    surcharge_rate = total_subsidy / total_block2 if total_block2 > 0 else 0
    rbt_payment = block1_subsidy - block2 * surcharge_rate  # positive = saving

    rbt_scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        behavioral_factor = (1 + pct) * (1 + epsilon * pct)

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            e_d, i_d, w_d, p_d = energy[mask], income[mask], weights[mask], rbt_payment[mask]
            n_hh = float(w_d.sum()) / 1e6
            shocked_e = e_d * (1 + pct)
            net_s = np.maximum(shocked_e - p_d, 0)
            fp_s = float(np.average((net_s / np.where(i_d > 0, i_d, 1)) > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0
            behav_e = e_d * behavioral_factor
            net_b = np.maximum(behav_e - p_d, 0)
            fp_b = float(np.average((net_b / np.where(i_d > 0, i_d, 1)) > 0.10, weights=w_d)) * 100 if w_d.sum() > 0 else 0
            deciles.append({
                "decile": d,
                "fp_rate": round(fp_s, 1), "fp_households_m": round(fp_s / 100 * n_hh, 2),
                "behavioral_fp_rate": round(fp_b, 1), "behavioral_fp_households_m": round(fp_b / 100 * n_hh, 2),
            })
        n_total = float(weights.sum()) / 1e6
        shocked_all = energy * (1 + pct)
        net_all_s = np.maximum(shocked_all - rbt_payment, 0)
        fp_all_s = float(np.average((net_all_s / np.where(income > 0, income, 1)) > 0.10, weights=weights)) * 100
        behav_all = energy * behavioral_factor
        net_all_b = np.maximum(behav_all - rbt_payment, 0)
        fp_all_b = float(np.average((net_all_b / np.where(income > 0, income, 1)) > 0.10, weights=weights)) * 100
        rbt_scenarios.append({
            "scenario": name,
            "fp_rate": round(fp_all_s, 1), "fp_households_m": round(fp_all_s / 100 * n_total, 2),
            "behavioral_fp_rate": round(fp_all_b, 1), "behavioral_fp_households_m": round(fp_all_b / 100 * n_total, 2),
            "deciles": deciles,
        })
    results["rbt"] = rbt_scenarios

    return results


# ── 11. Electricity vs gas split ─────────────────────────────────────────

def energy_split(data):
    deciles = []
    for d in range(1, 11):
        mask = data["decile"] == d
        me = weighted_mean(data["elec"], data["weights"], mask)
        mg = weighted_mean(data["gas"], data["weights"], mask)
        mi = weighted_mean(data["income"], data["weights"], mask)
        total = me + mg
        deciles.append({
            "decile": d,
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(total),
            "net_income": round(mi),
            "elec_share_pct": round(me / total * 100, 1) if total > 0 else 0,
            "elec_burden_pct": round(me / mi * 100, 1) if mi > 0 else 0,
            "gas_burden_pct": round(mg / mi * 100, 1) if mi > 0 else 0,
        })

    mean_elec = weighted_mean(data["elec"], data["weights"])
    mean_gas = weighted_mean(data["gas"], data["weights"])
    mean_total = mean_elec + mean_gas

    return {
        "mean_electricity": round(mean_elec),
        "mean_gas": round(mean_gas),
        "mean_total": round(mean_total),
        "elec_share_pct": round(mean_elec / mean_total * 100, 1) if mean_total > 0 else 0,
        "deciles": deciles,
    }


# ── 12. Regional breakdown ──────────────────────────────────────────────

def regional_breakdown(data):
    regions = []
    for r in sorted(np.unique(data["region"])):
        if r == "" or r is None:
            continue
        mask = data["region"] == r
        me = weighted_mean(data["elec"], data["weights"], mask)
        mg = weighted_mean(data["gas"], data["weights"], mask)
        mi = weighted_mean(data["income"], data["weights"], mask)
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
    regions.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return regions


# ── 13. Tenure breakdown ────────────────────────────────────────────────

def tenure_breakdown(data):
    tenures = []
    for t in sorted(np.unique(data["tenure"])):
        if t == "" or t is None:
            continue
        mask = data["tenure"] == t
        me = weighted_mean(data["elec"], data["weights"], mask)
        mg = weighted_mean(data["gas"], data["weights"], mask)
        mi = weighted_mean(data["income"], data["weights"], mask)
        n_hh = float(data["weights"][mask].sum()) / 1e6

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


# ── 13b. Household type breakdown ────────────────────────────────────────

def household_type_breakdown(data):
    hh_types = []
    for t in sorted(np.unique(data["hh_type"])):
        if t == "" or t is None:
            continue
        mask = data["hh_type"] == t
        me = weighted_mean(data["elec"], data["weights"], mask)
        mg = weighted_mean(data["gas"], data["weights"], mask)
        mi = weighted_mean(data["income"], data["weights"], mask)
        n_hh = float(data["weights"][mask].sum()) / 1e6

        total_e = data["elec"][mask] + data["gas"][mask]
        inc = data["income"][mask]
        w = data["weights"][mask]
        fp = (total_e / np.where(inc > 0, inc, 1)) > 0.10
        fp_rate = float(np.average(fp, weights=w)) * 100 if w.sum() > 0 else 0

        hh_types.append({
            "hh_type": str(t),
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(me + mg),
            "net_income": round(mi),
            "energy_burden_pct": round((me + mg) / mi * 100, 1) if mi > 0 else 0,
            "fuel_poverty_pct": round(fp_rate, 1),
            "households_m": round(n_hh, 1),
        })
    hh_types.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return hh_types


# ── 14. NEF National Energy Guarantee ────────────────────────────────────

def neg_policy(data):
    elec, gas, weights = data["elec"], data["gas"], data["weights"]
    income, decile_arr = data["income"], data["decile"]

    benefit = np.minimum(elec, NEG_ELEC_SPEND)
    baseline_cost_bn = round(float(np.sum(benefit * weights)) / 1e9, 1)
    avg_benefit = round(weighted_mean(benefit, weights))

    deciles_baseline = []
    for d in range(1, 11):
        mask = decile_arr == d
        mb = weighted_mean(benefit, weights, mask)
        me = weighted_mean(elec, weights, mask)
        coverage = mb / me * 100 if me > 0 else 0
        deciles_baseline.append({
            "decile": d,
            "benefit": round(mb),
            "elec_spend": round(me),
            "coverage_pct": round(coverage, 1),
        })

    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        shocked_elec = elec * (1 + pct)
        shocked_gas = gas * (1 + pct)
        shocked_total = shocked_elec + shocked_gas

        neg_threshold_shocked = NEG_ELEC_SPEND * (1 + pct)
        benefit_shocked = np.minimum(shocked_elec, neg_threshold_shocked)

        cost_bn = round(float(np.sum(benefit_shocked * weights)) / 1e9, 1)
        avg_b = round(weighted_mean(benefit_shocked, weights))

        net_extra = (shocked_total - (elec + gas)) - (benefit_shocked - benefit)
        avg_net_extra = round(weighted_mean(net_extra, weights))

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            mb = weighted_mean(benefit_shocked, weights, mask)
            shock_hit = weighted_mean(shocked_total - (elec + gas), weights, mask)
            offset = mb - weighted_mean(benefit, weights, mask)
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


# ── 15. Rising block tariff ─────────────────────────────────────────────

def rising_block_tariff(data):
    elec, weights = data["elec"], data["weights"]
    decile_arr, income = data["decile"], data["income"]

    threshold = NEG_ELEC_SPEND
    discount_rate = 0.50

    block1 = np.minimum(elec, threshold)
    block1_subsidy = block1 * discount_rate
    block2 = np.maximum(elec - threshold, 0)

    total_subsidy = float(np.sum(block1_subsidy * weights))
    total_block2 = float(np.sum(block2 * weights))
    surcharge_rate = total_subsidy / total_block2 if total_block2 > 0 else 0

    net_effect = -block1_subsidy + block2 * surcharge_rate

    deciles = []
    for d in range(1, 11):
        mask = decile_arr == d
        me = weighted_mean(elec, weights, mask)
        mb1 = weighted_mean(block1, weights, mask)
        mb2 = weighted_mean(block2, weights, mask)
        saving = weighted_mean(block1_subsidy, weights, mask)
        surcharge = weighted_mean(block2 * surcharge_rate, weights, mask)
        net = weighted_mean(net_effect, weights, mask)
        mi = weighted_mean(income, weights, mask)
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


# ── 16. Gas-only price cap ──────────────────────────────────────────────

def gas_price_cap(data):
    elec, gas, weights = data["elec"], data["gas"], data["weights"]
    decile_arr, income = data["decile"], data["income"]

    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        shocked_elec = elec * (1 + pct)
        shocked_gas = gas * (1 + pct)
        total_shock_extra = (shocked_elec + shocked_gas) - (elec + gas)

        net_extra = shocked_elec - elec
        gas_subsidy = shocked_gas - gas

        cost_bn = round(float(np.sum(gas_subsidy * weights)) / 1e9, 1)
        avg_benefit = round(weighted_mean(gas_subsidy, weights))
        avg_net_extra = round(weighted_mean(net_extra, weights))

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            shock = weighted_mean(total_shock_extra, weights, mask)
            ben = weighted_mean(gas_subsidy, weights, mask)
            remaining = weighted_mean(net_extra, weights, mask)
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
        "description": "Cap gas bills at current level and let electricity prices float. Gas is more volatile due to wholesale market exposure, so capping gas alone is cheaper and targets the main source of price shocks.",
        "scenarios": scenarios,
    }
