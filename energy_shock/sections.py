"""
All analysis sections: baseline summary, shocks, behavioural,
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
    ELEC_RATE, GAS_RATE, NEG_ELEC_KWH, NEG_ELEC_SPEND,
    WFA_HIGHER, WFA_LOWER, RBT_DISCOUNT_RATE,
    DATASET_URL,
)
from .baseline import weighted_mean, decile_means


# ── helpers ──────────────────────────────────────────────────────────────

def _calc_decile_table(sim, variable, country_mask=None):
    """Weighted mean of a PolicyEngine variable by income decile.

    If country_mask is provided, only include matching households.
    """
    from .baseline import _vals
    values = sim.calculate(variable, YEAR)
    values = values.values
    deciles = _vals(sim, "household_income_decile", unweighted=True)
    weights = _vals(sim, "household_weight", unweighted=True)
    if country_mask is not None:
        values = values[country_mask]
        deciles = deciles[country_mask]
        weights = weights[country_mask]
    df = MicroDataFrame(
        {"value": values, "decile": deciles},
        weights=weights,
    )
    df = df[df.decile > 0]
    return df.groupby("decile")["value"].mean()


# ── 1. Baseline summary ─────────────────────────────────────────────────

def baseline_summary(data):
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    n_households = float(data["weights"].sum())
    energy, income, weights, dec = data["energy"], data["income"], data["weights"], data["decile"]

    deciles = []
    for d in range(1, 11):
        e = energy_by_dec[d]
        inc = income_by_dec[d]
        deciles.append({
            "decile": d,
            "energy_spend": round(e),
            "net_income": round(inc),
            "energy_share_pct": round(e / inc * 100, 2) if inc > 0 else 0,
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
        avg_e = weighted_mean(energy, weights, mask)
        avg_i = weighted_mean(income, weights, mask)
        extra = avg_e * pct

        row = {
            label_key: g_str,
            "extra_cost": round(extra),
            "pct_of_income": round(extra / avg_i * 100, 2) if avg_i > 0 else 0,
        }
        if epsilon is not None:
            b_extra = avg_e * (behavioral_factor - 1)
            row["behavioral_extra_cost"] = round(b_extra)
            row["behavioral_pct_of_income"] = round(b_extra / avg_i * 100, 2) if avg_i > 0 else 0
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
            deciles.append({
                "decile": d,
                "extra_cost": round(extra),
                "pct_of_income": round(extra / inc * 100, 2) if inc > 0 else 0,
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
            "by_country": _grouped_shock(data, "country", "country", pct),
        })
    return scenarios


# ── 3. Behavioural responses ────────────────────────────────────────────

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

        deciles = []
        for d in range(1, 11):
            e = energy_by_dec[d]
            inc = income_by_dec[d]
            static_hit = e * price_pct
            behavioral_hit = e * (behavioral_factor - 1)

            deciles.append({
                "decile": d,
                "static_extra_cost": round(static_hit),
                "behavioral_extra_cost": round(behavioral_hit),
                "bill_saving": round(static_hit - behavioral_hit),
                "consumption_reduction_pct": round(consumption_change_pct * 100, 1),
                "static_pct_of_income": round(static_hit / inc * 100, 2) if inc > 0 else 0,
                "behavioral_pct_of_income": round(behavioral_hit / inc * 100, 2) if inc > 0 else 0,
            })

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
            "deciles": deciles,
            "by_tenure": _grouped_shock(data, "tenure", "tenure", price_pct, epsilon),
            "by_hh_type": _grouped_shock(data, "hh_type", "hh_type", price_pct, epsilon),
            "by_country": _grouped_shock(data, "country", "country", price_pct, epsilon),
        })
    return results_list


# ── 5. Policy A: EPG ────────────────────────────────────────────────────

def policy_epg(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    cmask = data.get("country_mask")
    sim = Microsimulation(dataset=DATASET_URL, reform={
        "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
        "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
    })
    subsidy_all = sim.calculate("epg_subsidy", YEAR)
    subsidy_arr = subsidy_all.values
    if cmask is not None:
        subsidy_arr = subsidy_arr[cmask]
    by_decile = _calc_decile_table(sim, "epg_subsidy", cmask)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        shock = energy_by_dec[d] * shock_pct
        deciles.append({
            "decile": d,
            "payment": round(val),
            "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
        })
    w = data["weights"]
    return {
        "name": "EPG subsidy",
        "description": f"Energy Price Guarantee at {EPG_TARGET}",
        "exchequer_cost_bn": round(float(np.sum(subsidy_arr * w)) / 1e9, 1),
        "avg_hh_benefit": round(float(np.average(subsidy_arr, weights=w))),
        "deciles": deciles,
    }


# ── 6. Policy B: Flat transfer ──────────────────────────────────────────

def policy_flat(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    cmask = data.get("country_mask")
    sim = Microsimulation(dataset=DATASET_URL, reform={
        "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
    })
    credit_all = sim.calculate("ebr_energy_bills_credit", YEAR)
    credit_arr = credit_all.values
    if cmask is not None:
        credit_arr = credit_arr[cmask]
    by_decile = _calc_decile_table(sim, "ebr_energy_bills_credit", cmask)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        shock = energy_by_dec[d] * shock_pct
        deciles.append({
            "decile": d,
            "payment": round(val),
            "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
        })
    w = data["weights"]
    return {
        "name": "Flat transfer",
        "description": f"{FLAT_TRANSFER} per household",
        "exchequer_cost_bn": round(float(np.sum(credit_arr * w)) / 1e9, 1),
        "avg_hh_benefit": round(float(np.average(credit_arr, weights=w))),
        "deciles": deciles,
    }


# ── 7. Policy C: CT rebate ──────────────────────────────────────────────

def policy_ct_rebate(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    cmask = data.get("country_mask")
    sim = Microsimulation(dataset=DATASET_URL, reform={
        "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
    })
    rebate_all = sim.calculate("ebr_council_tax_rebate", YEAR)
    rebate_arr = rebate_all.values
    if cmask is not None:
        rebate_arr = rebate_arr[cmask]
    by_decile = _calc_decile_table(sim, "ebr_council_tax_rebate", cmask)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        shock = energy_by_dec[d] * shock_pct
        deciles.append({
            "decile": d,
            "payment": round(val),
            "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
        })
    w = data["weights"]
    return {
        "name": "CT band rebate",
        "description": f"{CT_REBATE} for bands A-D",
        "exchequer_cost_bn": round(float(np.sum(rebate_arr * w)) / 1e9, 1),
        "avg_hh_benefit": round(float(np.average(rebate_arr, weights=w))),
        "deciles": deciles,
    }


# ── 8. Policy D: Expanded WFA ───────────────────────────────────────────

def policy_wfa(data):
    cmask = data.get("country_mask")
    sim = Microsimulation(dataset=DATASET_URL, reform={
        "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {"2026-01-01": False},
        "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": WFA_HIGHER},
        "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": WFA_LOWER},
    })
    wfa_reformed_all = sim.calculate("winter_fuel_allowance", YEAR)
    wfa_baseline_all = data["sim"].calculate("winter_fuel_allowance", YEAR)
    reformed_arr = wfa_reformed_all.values
    baseline_arr = wfa_baseline_all.values
    if cmask is not None:
        reformed_arr = reformed_arr[cmask]
        baseline_arr = baseline_arr[cmask]
    w = data["weights"]
    extra_cost = float(np.sum(reformed_arr * w)) - float(np.sum(baseline_arr * w))

    by_decile = _calc_decile_table(sim, "winter_fuel_allowance", cmask)
    bl_by_decile = _calc_decile_table(data["sim"], "winter_fuel_allowance", cmask)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        bl = float(bl_by_decile[d])
        deciles.append({
            "decile": d,
            "payment": round(val),
            "extra_vs_baseline": round(val - bl),
        })
    return {
        "name": "Expanded winter fuel",
        "description": f"Universal for pensioners, {WFA_LOWER}/{WFA_HIGHER}",
        "exchequer_cost_bn": round(extra_cost / 1e9, 1),
        "total_spending_bn": round(float(np.sum(reformed_arr * w)) / 1e9, 1),
        "avg_hh_benefit": round(float(np.average(reformed_arr, weights=w))),
        "deciles": deciles,
    }


# ── 9. Policy E: Combined ───────────────────────────────────────────────

def policy_combined(data):
    income_by_dec = decile_means(data, "income")
    cmask = data.get("country_mask")
    w = data["weights"]
    sim = Microsimulation(dataset=DATASET_URL, reform={
        "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
        "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
        "gov.treasury.energy_bills_rebate.energy_bills_credit": {"2026-01-01": FLAT_TRANSFER},
        "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {"2026-01-01": CT_REBATE},
        "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {"2026-01-01": False},
        "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": WFA_HIGHER},
        "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": WFA_LOWER},
    })

    def _arr(series):
        a = series.values
        return a[cmask] if cmask is not None else a

    epg = _arr(sim.calculate("epg_subsidy", YEAR))
    flat = _arr(sim.calculate("ebr_energy_bills_credit", YEAR))
    ct = _arr(sim.calculate("ebr_council_tax_rebate", YEAR))
    wfa = _arr(sim.calculate("winter_fuel_allowance", YEAR))
    wfa_baseline = _arr(data["sim"].calculate("winter_fuel_allowance", YEAR))
    net = _arr(sim.calculate("household_net_income", YEAR))

    total_cost = (
        float(np.sum(epg * w)) + float(np.sum(flat * w)) + float(np.sum(ct * w))
        + (float(np.sum(wfa * w)) - float(np.sum(wfa_baseline * w)))
    )

    net_by_decile = _calc_decile_table(sim, "household_net_income", cmask)
    bl_net = _arr(data["sim"].calculate("household_net_income", YEAR))
    deciles = []
    for d in range(1, 11):
        change = float(net_by_decile[d]) - income_by_dec[d]
        inc = income_by_dec[d]
        deciles.append({
            "decile": d,
            "net_income_change": round(change),
            "pct_change": round(change / inc * 100, 2) if inc > 0 else 0,
        })

    return {
        "name": "Combined package",
        "description": "EPG + flat transfer + CT rebate + expanded WFA",
        "exchequer_cost_bn": round(total_cost / 1e9, 1),
        "component_costs_bn": {
            "epg": round(float(np.sum(epg * w)) / 1e9, 1),
            "flat_transfer": round(float(np.sum(flat * w)) / 1e9, 1),
            "ct_rebate": round(float(np.sum(ct * w)) / 1e9, 1),
            "extra_wfa": round((float(np.sum(wfa * w)) - float(np.sum(wfa_baseline * w))) / 1e9, 1),
        },
        "avg_net_income_change": round(float(np.average(net, weights=w)) - float(np.average(bl_net, weights=w))),
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
    cmask = data.get("country_mask")
    w = data["weights"]

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
        sim = Microsimulation(dataset=DATASET_URL, reform=cfg["reform"])
        benefit_all = sim.calculate(cfg["variable"], YEAR)
        benefit_arr = benefit_all.values
        if cmask is not None:
            benefit_arr = benefit_arr[cmask]
        by_decile = _calc_decile_table(sim, cfg["variable"], cmask)

        deciles = []
        for d in range(1, 11):
            e = energy_by_dec[d]
            inc = income_by_dec[d]
            static_shock = e * shock_pct
            behavioral_shock = e * (behavioral_factor - 1)
            policy_benefit = float(by_decile[d])
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

        avg_benefit = float(np.average(benefit_arr, weights=w))
        results_dict[key] = {
            "name": cfg["name"],
            "exchequer_cost_bn": round(float(np.sum(benefit_arr * w)) / 1e9, 1),
            "avg_benefit": round(avg_benefit),
            "avg_shock_static": round(mean_energy * shock_pct),
            "avg_shock_behavioral": round(mean_energy * (behavioral_factor - 1)),
            "avg_net_cost_static": round(mean_energy * shock_pct - avg_benefit),
            "avg_net_cost_behavioral": round(mean_energy * (behavioral_factor - 1) - avg_benefit),
            "deciles": deciles,
        }
    return results_dict




def _grouped_post_policy(energy, income, weights, payment, group_arr, groups, pct, behavioral_factor):
    """Compute post-policy extra cost grouped by a categorical variable."""
    result = []
    for g in groups:
        mask = group_arr == g
        e_g, i_g, w_g, p_g = energy[mask], income[mask], weights[mask], payment[mask]
        if w_g.sum() == 0:
            result.append({"group": str(g), "extra_cost": 0, "pct_of_income": 0,
                           "behavioral_extra_cost": 0, "behavioral_pct_of_income": 0})
            continue
        shocked_e = e_g * (1 + pct)
        net_s = np.maximum(shocked_e - p_g, e_g)
        extra_s = float(weighted_mean(np.maximum(net_s - e_g, 0), w_g))
        mean_inc = float(weighted_mean(i_g, w_g))
        pct_inc_s = round(extra_s / mean_inc * 100, 2) if mean_inc > 0 else 0
        behav_e = e_g * behavioral_factor
        net_b = np.maximum(behav_e - p_g, e_g)
        extra_b = float(weighted_mean(np.maximum(net_b - e_g, 0), w_g))
        pct_inc_b = round(extra_b / mean_inc * 100, 2) if mean_inc > 0 else 0
        result.append({
            "group": str(g),
            "extra_cost": round(extra_s),
            "pct_of_income": round(pct_inc_s, 2),
            "behavioral_extra_cost": round(extra_b),
            "behavioral_pct_of_income": round(pct_inc_b, 2),
        })
    return result


def policy_post_shock(data):
    """Compute post-policy extra cost after each policy for every scenario,
    broken down by decile, tenure, and household type.

    Returns dict keyed by policy name, each containing a list of scenario dicts.
    """
    energy = data["energy"]
    income = data["income"]
    weights = data["weights"]
    decile_arr = data["decile"]
    tenure_arr = data["tenure"]
    hh_type_arr = data["hh_type"]
    country_arr = data["country"]
    tenure_groups = sorted(np.unique(tenure_arr))
    hh_type_groups = sorted(np.unique(hh_type_arr))
    country_groups = sorted(np.unique(country_arr))
    epsilon = SHORT_RUN_ELASTICITY

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

    cmask = data.get("country_mask")
    hh_payments = {}
    for key, cfg in pe_policies.items():
        sim = Microsimulation(dataset=DATASET_URL, reform=cfg["reform"])
        pay = sim.calculate(cfg["variable"], YEAR)
        arr = pay.values
        hh_payments[key] = arr[cmask] if cmask is not None else arr

    results = {}
    for policy_key in ["epg", "flat_transfer", "ct_rebate", "bn_transfer", "bn_epg"]:
        scenario_list = []
        for name, new_cap in PRICE_SCENARIOS.items():
            pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
            behavioral_factor = (1 + pct) * (1 + epsilon * pct)

            if policy_key == "epg":
                epg_scale = max(0, new_cap - EPG_TARGET) / (SHOCK_CAP - EPG_TARGET)
                payment = hh_payments["epg"] * epg_scale
            elif policy_key in hh_payments:
                payment = hh_payments[policy_key]
            elif policy_key == "bn_transfer":
                avg_extra = float(weighted_mean(energy, weights) * pct)
                payment = np.full_like(energy, avg_extra)
            elif policy_key == "bn_epg":
                payment = energy * pct
            else:
                payment = np.zeros_like(energy)

            deciles = []
            for d in range(1, 11):
                mask = decile_arr == d
                e_d, i_d, w_d, p_d = energy[mask], income[mask], weights[mask], payment[mask]
                shocked_e = e_d * (1 + pct)
                net_e_static = np.maximum(shocked_e - p_d, e_d)
                behav_e = e_d * behavioral_factor
                net_e_behav = np.maximum(behav_e - p_d, e_d)
                extra_s = float(weighted_mean(np.maximum(net_e_static - e_d, 0), w_d))
                extra_b = float(weighted_mean(np.maximum(net_e_behav - e_d, 0), w_d))
                mean_inc_d = float(weighted_mean(i_d, w_d))
                pct_s = round(extra_s / mean_inc_d * 100, 2) if mean_inc_d > 0 else 0
                pct_b = round(extra_b / mean_inc_d * 100, 2) if mean_inc_d > 0 else 0
                deciles.append({
                    "decile": d,
                    "extra_cost": round(extra_s),
                    "pct_of_income": pct_s,
                    "behavioral_extra_cost": round(extra_b),
                    "behavioral_pct_of_income": pct_b,
                })

            by_tenure = _grouped_post_policy(energy, income, weights, payment,
                                             tenure_arr, tenure_groups, pct, behavioral_factor)
            for t in by_tenure:
                t["tenure"] = t.pop("group")
            by_hh_type = _grouped_post_policy(energy, income, weights, payment,
                                              hh_type_arr, hh_type_groups, pct, behavioral_factor)
            for h in by_hh_type:
                h["hh_type"] = h.pop("group")
            by_country = _grouped_post_policy(energy, income, weights, payment,
                                              country_arr, country_groups, pct, behavioral_factor)
            for c in by_country:
                c["country"] = c.pop("group")

            scenario_list.append({
                "scenario": name,
                "deciles": deciles,
                "by_tenure": by_tenure,
                "by_hh_type": by_hh_type,
                "by_country": by_country,
            })
        results[policy_key] = scenario_list

    # --- NEG ---
    elec, gas = data["elec"], data["gas"]
    neg_baseline_benefit = np.minimum(elec, NEG_ELEC_SPEND)

    neg_scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        behavioral_factor = (1 + pct) * (1 + epsilon * pct)
        shocked_elec = elec * (1 + pct)
        neg_threshold_shocked = NEG_ELEC_SPEND * (1 + pct)
        benefit_shocked = np.minimum(shocked_elec, neg_threshold_shocked)
        payment = benefit_shocked - neg_baseline_benefit

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            e_d, i_d, w_d, p_d = energy[mask], income[mask], weights[mask], payment[mask]
            shocked_e = e_d * (1 + pct)
            net_s = np.maximum(shocked_e - p_d, e_d)
            behav_e = e_d * behavioral_factor
            net_b = np.maximum(behav_e - p_d, e_d)
            extra_s = float(weighted_mean(np.maximum(net_s - e_d, 0), w_d))
            extra_b = float(weighted_mean(np.maximum(net_b - e_d, 0), w_d))
            mean_inc = float(weighted_mean(i_d, w_d))
            pct_s = round(extra_s / mean_inc * 100, 2) if mean_inc > 0 else 0
            pct_b = round(extra_b / mean_inc * 100, 2) if mean_inc > 0 else 0
            deciles.append({
                "decile": d,
                "extra_cost": round(extra_s),
                "pct_of_income": pct_s,
                "behavioral_extra_cost": round(extra_b),
                "behavioral_pct_of_income": pct_b,
            })

        by_tenure = _grouped_post_policy(energy, income, weights, payment,
                                         tenure_arr, tenure_groups, pct, behavioral_factor)
        for t in by_tenure:
            t["tenure"] = t.pop("group")
        by_hh_type = _grouped_post_policy(energy, income, weights, payment,
                                          hh_type_arr, hh_type_groups, pct, behavioral_factor)
        for h in by_hh_type:
            h["hh_type"] = h.pop("group")
        by_country = _grouped_post_policy(energy, income, weights, payment,
                                          country_arr, country_groups, pct, behavioral_factor)
        for c in by_country:
            c["country"] = c.pop("group")

        neg_scenarios.append({
            "scenario": name,
            "deciles": deciles,
            "by_tenure": by_tenure,
            "by_hh_type": by_hh_type,
            "by_country": by_country,
        })
    results["neg"] = neg_scenarios

    # --- RBT ---
    threshold = NEG_ELEC_SPEND
    discount_rate = RBT_DISCOUNT_RATE
    block1 = np.minimum(elec, threshold)
    block1_subsidy = block1 * discount_rate
    block2 = np.maximum(elec - threshold, 0)
    total_subsidy = float(np.sum(block1_subsidy * weights))
    total_block2 = float(np.sum(block2 * weights))
    surcharge_rate = total_subsidy / total_block2 if total_block2 > 0 else 0
    rbt_payment = block1_subsidy - block2 * surcharge_rate

    rbt_scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        rbt_scenarios.append({"scenario": name, "deciles": []})
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
            "elec_burden_pct": round(me / mi * 100, 2) if mi > 0 else 0,
            "gas_burden_pct": round(mg / mi * 100, 2) if mi > 0 else 0,
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
            "energy_burden_pct": round(total_e / mi * 100, 2) if mi > 0 else 0,
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

        tenures.append({
            "tenure": str(t),
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(me + mg),
            "net_income": round(mi),
            "energy_burden_pct": round((me + mg) / mi * 100, 2) if mi > 0 else 0,
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

        hh_types.append({
            "hh_type": str(t),
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(me + mg),
            "net_income": round(mi),
            "energy_burden_pct": round((me + mg) / mi * 100, 2) if mi > 0 else 0,
            "households_m": round(n_hh, 1),
        })
    hh_types.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return hh_types


# ── 13c. Country breakdown ──────────────────────────────────────────────

def country_breakdown(data):
    countries = []
    for c in sorted(np.unique(data["country"])):
        if c == "" or c is None or c == "UNKNOWN":
            continue
        mask = data["country"] == c
        me = weighted_mean(data["elec"], data["weights"], mask)
        mg = weighted_mean(data["gas"], data["weights"], mask)
        mi = weighted_mean(data["income"], data["weights"], mask)
        n_hh = float(data["weights"][mask].sum()) / 1e6

        countries.append({
            "country": str(c),
            "electricity": round(me),
            "gas": round(mg),
            "total_energy": round(me + mg),
            "net_income": round(mi),
            "energy_burden_pct": round((me + mg) / mi * 100, 2) if mi > 0 else 0,
            "households_m": round(n_hh, 1),
        })
    countries.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return countries


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
    discount_rate = RBT_DISCOUNT_RATE

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
