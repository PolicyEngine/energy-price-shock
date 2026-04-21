"""
All analysis sections: baseline summary, shocks, behavioural,
policies (A–F), electricity/gas split, regional, tenure, NEG, gas-only cap.

Every function takes the shared `data` dict from baseline.run_baseline().
Energy = electricity + gas everywhere.
"""

import numpy as np
import pandas as pd
from microdf import MicroDataFrame

from .baseline import (
    build_reform_simulation,
    decile_means,
    weighted_mean,
)
from .config import (
    CT_REBATE,
    CURRENT_CAP,
    ELASTICITY_BY_DECILE,
    ENGLISH_REGIONS,
    EPG_TARGET,
    FLAT_TRANSFER,
    NEG_ELEC_KWH,
    NEG_ELEC_SPEND,
    PRICE_SCENARIOS,
    SHOCK_CAP,
    WFA_HIGHER,
    WFA_LOWER,
    YEAR,
)


def _england_mask_unfiltered(sim, country_mask=None):
    """Boolean mask selecting English households in the microsim's
    household-row order, optionally country-masked first.

    The 2022 Council Tax Rebate was England-only (Scotland / Wales ran
    separate schemes, Northern Ireland uses the Rates system and has no
    council tax bands). ``ebr_council_tax_rebate`` in policyengine-uk
    keys off ``council_tax_band`` alone and therefore pays any household
    whose dataset record has an A–D band, including non-English ones.
    Apply this mask at the analysis layer to restore the policy's real
    geographic scope.
    """
    region = _hh_array(sim, "region")
    region_str = pd.Series(region).astype(str)
    mask = region_str.isin(ENGLISH_REGIONS).to_numpy()
    if country_mask is not None:
        mask = mask[country_mask]
    return mask


def _epsilon_per_household(data):
    """Return a per-household elasticity array based on each household's
    income decile and the ``ELASTICITY_BY_DECILE`` table.

    Households with ``decile <= 0`` (top-coded or missing) get the
    decile-weighted mean of the observed deciles so they don't break
    weighted aggregates.
    """
    decile_arr = data["decile"]
    eps = np.zeros(len(decile_arr), dtype=float)
    for d in range(1, 11):
        eps[decile_arr == d] = ELASTICITY_BY_DECILE[d]
    fallback_mask = eps == 0
    if fallback_mask.any():
        # Weighted mean elasticity of the observed deciles.
        good = ~fallback_mask
        if good.any():
            mean_eps = float(np.average(eps[good], weights=data["weights"][good]))
        else:
            mean_eps = sum(ELASTICITY_BY_DECILE.values()) / 10
        eps[fallback_mask] = mean_eps
    return eps


def _behavioural_factor_hh(epsilon_hh, price_pct):
    """Per-household behavioural spend factor under a constant-elasticity
    demand curve.

    Canonical constant-elasticity form:

        q_new / q_old = (p_new / p_old) ** ε
        spend_new / spend_old = (p_new / p_old) * (q_new / q_old)
                              = (p_new / p_old) ** (1 + ε)

    The common linear first-order approximation ``(1+p)(1+εp)`` produces
    negative spending factors for combinations like ε = −0.64 and
    p = +1.61 (Q1 2023 peak for low-income households) — consumption
    cannot go below zero, so the linear form breaks outside the small-
    shock band. The log-linear ``(1+p)**(1+ε)`` form stays physically
    admissible at all ε ∈ (−1, 0] and p ≥ 0, and collapses to the
    linear approximation for small ``p``.
    """
    return (1.0 + price_pct) ** (1.0 + epsilon_hh)


# ── helpers ──────────────────────────────────────────────────────────────


def _hh_array(sim, var):
    """Pull a household-level variable from a ``policyengine_uk``
    Microsimulation. Mirrors ``baseline._hh_array``.
    """
    series = sim.calculate(var, YEAR)
    return series.values if hasattr(series, "values") else np.asarray(series)


def _calc_decile_table(sim, variable, country_mask=None):
    """Weighted mean of a PolicyEngine variable by income decile.

    If country_mask is provided, only include matching households.
    """
    values = _hh_array(sim, variable)
    deciles = _hh_array(sim, "household_income_decile")
    weights = _hh_array(sim, "household_weight")
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
    _energy, _income, _weights, _dec = (
        data["energy"],
        data["income"],
        data["weights"],
        data["decile"],
    )

    deciles = []
    for d in range(1, 11):
        e = energy_by_dec[d]
        inc = income_by_dec[d]
        deciles.append(
            {
                "decile": d,
                "energy_spend": round(e),
                "net_income": round(inc),
                "energy_share_pct": round(e / inc * 100, 2) if inc > 0 else 0,
            }
        )

    return {
        "n_households_m": round(n_households / 1e6, 1),
        "current_cap": CURRENT_CAP,
        "mean_energy_spend": round(weighted_mean(data["energy"], data["weights"])),
        "total_energy_spend_bn": round(
            float(np.sum(data["energy"] * data["weights"])) / 1e9, 1
        ),
        "mean_net_income": round(weighted_mean(data["income"], data["weights"])),
        "deciles": deciles,
    }


# ── 2. Shock scenarios ──────────────────────────────────────────────────


def _grouped_shock(data, group_key, label_key, pct, include_behavioural=False):
    """Compute shock impacts grouped by a categorical variable.

    When ``include_behavioural`` is True, the behavioural response is
    computed at the household level using each household's decile-
    specific elasticity (Priesmann & Praktiknjo 2025), then aggregated
    within the group — so the per-group behavioural impact reflects the
    decile composition of that group rather than a single population
    mean.
    """
    energy, income, weights = data["energy"], data["income"], data["weights"]
    groups = sorted(np.unique(data[group_key]))
    rows = []

    eps_hh = _epsilon_per_household(data) if include_behavioural else None
    behavioural_hit_hh = (
        energy * (_behavioural_factor_hh(eps_hh, pct) - 1)
        if include_behavioural
        else None
    )

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
        if include_behavioural:
            b_extra = float(weighted_mean(behavioural_hit_hh, weights, mask))
            row["behavioural_extra_cost"] = round(b_extra)
            row["behavioural_pct_of_income"] = (
                round(b_extra / avg_i * 100, 2) if avg_i > 0 else 0
            )
        rows.append(row)
    return rows


def shock_scenarios(data):
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    mean_energy = weighted_mean(data["energy"], data["weights"])
    total_energy = float(np.sum(data["energy"] * data["weights"]))

    _energy_arr, _income_arr, _weights_arr = (
        data["energy"],
        data["income"],
        data["weights"],
    )
    data["decile"]

    scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        deciles = []
        for d in range(1, 11):
            extra = energy_by_dec[d] * pct
            inc = income_by_dec[d]
            deciles.append(
                {
                    "decile": d,
                    "extra_cost": round(extra),
                    "pct_of_income": round(extra / inc * 100, 2) if inc > 0 else 0,
                }
            )
        scenarios.append(
            {
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
            }
        )
    return scenarios


# ── 3. Behavioural responses ────────────────────────────────────────────


def behavioural_responses(data):
    """Behavioural-response analysis using Priesmann & Praktiknjo (2025)
    decile-specific elasticities.

    Each household responds to a price shock at its own decile's
    elasticity rather than at a population mean. This lets the
    behavioural progressivity of the shock show up in the output:
    low-income households cut consumption sharply (ε ≈ −0.64) while
    high-income households barely do (ε ≈ −0.11).

    The headline ``average elasticity`` reported per scenario is the
    weighted mean of the decile-specific values (computed from the
    dataset, not hardcoded).
    """
    energy, _income, weights = data["energy"], data["income"], data["weights"]
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    mean_energy = weighted_mean(energy, weights)

    eps_hh = _epsilon_per_household(data)
    mean_epsilon = float(np.average(eps_hh, weights=weights))

    results_list = []
    for name, new_cap in PRICE_SCENARIOS.items():
        price_pct = (new_cap - CURRENT_CAP) / CURRENT_CAP

        behav_factor_hh = _behavioural_factor_hh(eps_hh, price_pct)
        behavioural_hit_hh = energy * (behav_factor_hh - 1)

        static_extra = mean_energy * price_pct
        behavioural_extra = float(weighted_mean(behavioural_hit_hh, weights))
        bill_saving = static_extra - behavioural_extra

        deciles = []
        for d in range(1, 11):
            mask = data["decile"] == d
            eps_d = ELASTICITY_BY_DECILE[d]
            e = energy_by_dec[d]
            inc = income_by_dec[d]
            static_hit = e * price_pct
            behavioural_hit = float(weighted_mean(behavioural_hit_hh, weights, mask))

            deciles.append(
                {
                    "decile": d,
                    "elasticity": round(eps_d, 3),
                    # Log-linear q_new / q_old = (1 + p)^ε; reduction is
                    # (1 - q_new/q_old) × 100. Formerly reported the
                    # linear εp approximation which produced values
                    # < −100 % at the +161 % scenario for low deciles.
                    "consumption_reduction_pct": round(
                        ((1 + price_pct) ** eps_d - 1) * 100, 1
                    ),
                    "static_extra_cost": round(static_hit),
                    "behavioural_extra_cost": round(behavioural_hit),
                    "bill_saving": round(static_hit - behavioural_hit),
                    "static_pct_of_income": (
                        round(static_hit / inc * 100, 2) if inc > 0 else 0
                    ),
                    "behavioural_pct_of_income": (
                        round(behavioural_hit / inc * 100, 2) if inc > 0 else 0
                    ),
                }
            )

        results_list.append(
            {
                "name": name,
                "new_cap": new_cap,
                "price_increase_pct": round(price_pct * 100),
                "mean_elasticity": round(mean_epsilon, 3),
                "elasticity_by_decile": {
                    str(d): round(ELASTICITY_BY_DECILE[d], 3) for d in range(1, 11)
                },
                "static_avg_extra": round(static_extra),
                "behavioural_avg_extra": round(behavioural_extra),
                "bill_saving_avg": round(bill_saving),
                "deciles": deciles,
                "by_tenure": _grouped_shock(
                    data, "tenure", "tenure", price_pct, include_behavioural=True
                ),
                "by_hh_type": _grouped_shock(
                    data, "hh_type", "hh_type", price_pct, include_behavioural=True
                ),
                "by_country": _grouped_shock(
                    data, "country", "country", price_pct, include_behavioural=True
                ),
            }
        )
    return results_list


# ── 5. Policy A: EPG ────────────────────────────────────────────────────


def policy_epg(data):
    energy_by_dec = decile_means(data, "energy")
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    cmask = data.get("country_mask")
    sim = build_reform_simulation(
        {
            "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
            "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
        }
    )
    subsidy_arr = _hh_array(sim, "epg_subsidy")
    if cmask is not None:
        subsidy_arr = subsidy_arr[cmask]
    by_decile = _calc_decile_table(sim, "epg_subsidy", cmask)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        shock = energy_by_dec[d] * shock_pct
        deciles.append(
            {
                "decile": d,
                "payment": round(val),
                "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
            }
        )
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
    sim = build_reform_simulation(
        {
            "gov.treasury.energy_bills_rebate.energy_bills_credit": {
                "2026-01-01": FLAT_TRANSFER
            },
        }
    )
    credit_arr = _hh_array(sim, "ebr_energy_bills_credit")
    if cmask is not None:
        credit_arr = credit_arr[cmask]
    by_decile = _calc_decile_table(sim, "ebr_energy_bills_credit", cmask)

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        shock = energy_by_dec[d] * shock_pct
        deciles.append(
            {
                "decile": d,
                "payment": round(val),
                "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
            }
        )
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
    sim = build_reform_simulation(
        {
            "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {
                "2026-01-01": CT_REBATE
            },
        }
    )
    rebate_arr = _hh_array(sim, "ebr_council_tax_rebate")
    if cmask is not None:
        rebate_arr = rebate_arr[cmask]
    # England-only: zero out rebate for non-English households so the
    # aggregate matches the actual 2022 policy's geographic scope.
    eng_mask = _england_mask_unfiltered(sim, cmask)
    rebate_arr = np.where(eng_mask, rebate_arr, 0.0)
    by_decile = _calc_decile_table(sim, "ebr_council_tax_rebate", cmask)
    # Apply the England mask to the decile table too.
    eng_deciles = _hh_array(sim, "household_income_decile")
    if cmask is not None:
        eng_deciles_masked = eng_deciles[cmask]
    else:
        eng_deciles_masked = eng_deciles
    eng_rebate_arr = rebate_arr  # already zeroed outside England
    w_arr = data["weights"]
    # Rebuild by_decile off the England-masked array
    by_decile = {}
    for d in range(1, 11):
        dmask = eng_deciles_masked == d
        if dmask.any() and w_arr[dmask].sum() > 0:
            by_decile[d] = float(
                np.average(eng_rebate_arr[dmask], weights=w_arr[dmask])
            )
        else:
            by_decile[d] = 0.0

    deciles = []
    for d in range(1, 11):
        val = float(by_decile[d])
        shock = energy_by_dec[d] * shock_pct
        deciles.append(
            {
                "decile": d,
                "payment": round(val),
                "shock_offset_pct": round(val / shock * 100) if shock > 0 else 0,
            }
        )
    w = data["weights"]
    return {
        "name": "CT band rebate (England only)",
        "description": f"£{CT_REBATE} for bands A-D, England only (mirrors the 2022 Council Tax Rebate)",
        "exchequer_cost_bn": round(float(np.sum(rebate_arr * w)) / 1e9, 1),
        "avg_hh_benefit": round(float(np.average(rebate_arr, weights=w))),
        "deciles": deciles,
    }


# ── 8. Policy D: Expanded WFA ───────────────────────────────────────────


def policy_wfa(data):
    cmask = data.get("country_mask")
    sim = build_reform_simulation(
        {
            "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {
                "2026-01-01": False
            },
            "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": WFA_HIGHER},
            "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": WFA_LOWER},
        }
    )
    reformed_arr = _hh_array(sim, "winter_fuel_allowance")
    baseline_arr = _hh_array(data["sim"], "winter_fuel_allowance")
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
        deciles.append(
            {
                "decile": d,
                "payment": round(val),
                "extra_vs_baseline": round(val - bl),
            }
        )
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
    sim = build_reform_simulation(
        {
            "gov.ofgem.energy_price_cap": {"2026-01-01": SHOCK_CAP},
            "gov.ofgem.energy_price_guarantee": {"2026-01-01": EPG_TARGET},
            "gov.treasury.energy_bills_rebate.energy_bills_credit": {
                "2026-01-01": FLAT_TRANSFER
            },
            "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {
                "2026-01-01": CT_REBATE
            },
            "gov.dwp.winter_fuel_payment.eligibility.require_benefits": {
                "2026-01-01": False
            },
            "gov.dwp.winter_fuel_payment.amount.higher": {"2026-01-01": WFA_HIGHER},
            "gov.dwp.winter_fuel_payment.amount.lower": {"2026-01-01": WFA_LOWER},
        }
    )

    def _arr(values):
        return values[cmask] if cmask is not None else values

    epg = _arr(_hh_array(sim, "epg_subsidy"))
    flat = _arr(_hh_array(sim, "ebr_energy_bills_credit"))
    ct = _arr(_hh_array(sim, "ebr_council_tax_rebate"))
    # CT rebate is England-only in reality; zero non-English rows.
    ct = np.where(_england_mask_unfiltered(sim, cmask), ct, 0.0)
    wfa = _arr(_hh_array(sim, "winter_fuel_allowance"))
    wfa_baseline = _arr(_hh_array(data["sim"], "winter_fuel_allowance"))
    net = _arr(_hh_array(sim, "household_net_income"))

    total_cost = (
        float(np.sum(epg * w))
        + float(np.sum(flat * w))
        + float(np.sum(ct * w))
        + (float(np.sum(wfa * w)) - float(np.sum(wfa_baseline * w)))
    )

    net_by_decile = _calc_decile_table(sim, "household_net_income", cmask)
    bl_net = _arr(_hh_array(data["sim"], "household_net_income"))
    deciles = []
    for d in range(1, 11):
        change = float(net_by_decile[d]) - income_by_dec[d]
        inc = income_by_dec[d]
        deciles.append(
            {
                "decile": d,
                "net_income_change": round(change),
                "pct_change": round(change / inc * 100, 2) if inc > 0 else 0,
            }
        )

    return {
        "name": "Combined package",
        "description": "EPG + flat transfer + CT rebate + expanded WFA",
        "exchequer_cost_bn": round(total_cost / 1e9, 1),
        "component_costs_bn": {
            "epg": round(float(np.sum(epg * w)) / 1e9, 1),
            "flat_transfer": round(float(np.sum(flat * w)) / 1e9, 1),
            "ct_rebate": round(float(np.sum(ct * w)) / 1e9, 1),
            "extra_wfa": round(
                (float(np.sum(wfa * w)) - float(np.sum(wfa_baseline * w))) / 1e9, 1
            ),
        },
        "avg_net_income_change": round(
            float(np.average(net, weights=w)) - float(np.average(bl_net, weights=w))
        ),
        "deciles": deciles,
    }


# ── 10. Policy net position ─────────────────────────────────────────────


def policy_net_position(data):
    energy_by_dec = decile_means(data, "energy")
    income_by_dec = decile_means(data, "income")
    mean_energy = weighted_mean(data["energy"], data["weights"])
    shock_pct = (SHOCK_CAP - CURRENT_CAP) / CURRENT_CAP
    eps_hh = _epsilon_per_household(data)
    behavioural_factor_hh = _behavioural_factor_hh(eps_hh, shock_pct)
    behavioural_hit_hh = data["energy"] * (behavioural_factor_hh - 1)
    mean_behavioural_hit = float(weighted_mean(behavioural_hit_hh, data["weights"]))
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
                "gov.treasury.energy_bills_rebate.energy_bills_credit": {
                    "2026-01-01": FLAT_TRANSFER
                },
            },
            "variable": "ebr_energy_bills_credit",
        },
        "ct_rebate": {
            "name": "CT band rebate",
            "reform": {
                "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {
                    "2026-01-01": CT_REBATE
                },
            },
            "variable": "ebr_council_tax_rebate",
        },
    }

    results_dict = {}
    for key, cfg in policies_config.items():
        sim = build_reform_simulation(cfg["reform"])
        benefit_arr = _hh_array(sim, cfg["variable"])
        if cmask is not None:
            benefit_arr = benefit_arr[cmask]
        # England-only gate for the CT rebate (matches other call sites).
        if key == "ct_rebate":
            eng_mask = _england_mask_unfiltered(sim, cmask)
            benefit_arr = np.where(eng_mask, benefit_arr, 0.0)
        by_decile = _calc_decile_table(sim, cfg["variable"], cmask)

        deciles = []
        for d in range(1, 11):
            mask = data["decile"] == d
            e = energy_by_dec[d]
            income_by_dec[d]
            static_shock = e * shock_pct
            behavioural_shock = float(weighted_mean(behavioural_hit_hh, w, mask))
            policy_benefit = float(by_decile[d])
            net_static = static_shock - policy_benefit
            net_behavioural = behavioural_shock - policy_benefit
            deciles.append(
                {
                    "decile": d,
                    "baseline_energy": round(e),
                    "shock_extra_static": round(static_shock),
                    "shock_extra_behavioural": round(behavioural_shock),
                    "policy_benefit": round(policy_benefit),
                    "net_cost_static": round(max(net_static, 0)),
                    "net_cost_behavioural": round(max(net_behavioural, 0)),
                    "offset_pct_static": round(policy_benefit / static_shock * 100)
                    if static_shock > 0
                    else 0,
                    "offset_pct_behavioural": round(
                        policy_benefit / behavioural_shock * 100
                    )
                    if behavioural_shock > 0
                    else 0,
                }
            )

        avg_benefit = float(np.average(benefit_arr, weights=w))
        results_dict[key] = {
            "name": cfg["name"],
            "exchequer_cost_bn": round(float(np.sum(benefit_arr * w)) / 1e9, 1),
            "avg_benefit": round(avg_benefit),
            "avg_shock_static": round(mean_energy * shock_pct),
            "avg_shock_behavioural": round(mean_behavioural_hit),
            "avg_net_cost_static": round(mean_energy * shock_pct - avg_benefit),
            "avg_net_cost_behavioural": round(mean_behavioural_hit - avg_benefit),
            "deciles": deciles,
        }
    return results_dict


def _grouped_post_policy(
    energy, income, weights, payment, group_arr, groups, pct, behav_factor_hh
):
    """Compute post-policy extra cost grouped by a categorical variable.

    ``behav_factor_hh`` is a per-household array computed from each
    household's decile-specific elasticity — group aggregates therefore
    reflect the decile composition of each group rather than a single
    mean elasticity.
    """
    result = []
    for g in groups:
        mask = group_arr == g
        e_g = energy[mask]
        i_g = income[mask]
        w_g = weights[mask]
        p_g = payment[mask]
        bf_g = behav_factor_hh[mask]
        if w_g.sum() == 0:
            result.append(
                {
                    "group": str(g),
                    "extra_cost": 0,
                    "pct_of_income": 0,
                    "behavioural_extra_cost": 0,
                    "behavioural_pct_of_income": 0,
                }
            )
            continue
        shocked_e = e_g * (1 + pct)
        net_s = np.maximum(shocked_e - p_g, e_g)
        extra_s = float(weighted_mean(np.maximum(net_s - e_g, 0), w_g))
        mean_inc = float(weighted_mean(i_g, w_g))
        pct_inc_s = round(extra_s / mean_inc * 100, 2) if mean_inc > 0 else 0
        behav_e = e_g * bf_g
        net_b = np.maximum(behav_e - p_g, e_g)
        extra_b = float(weighted_mean(np.maximum(net_b - e_g, 0), w_g))
        pct_inc_b = round(extra_b / mean_inc * 100, 2) if mean_inc > 0 else 0
        result.append(
            {
                "group": str(g),
                "extra_cost": round(extra_s),
                "pct_of_income": round(pct_inc_s, 2),
                "behavioural_extra_cost": round(extra_b),
                "behavioural_pct_of_income": round(pct_inc_b, 2),
            }
        )
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
    eps_hh = _epsilon_per_household(data)

    pe_policies = {
        "flat_transfer": {
            "reform": {
                "gov.treasury.energy_bills_rebate.energy_bills_credit": {
                    "2026-01-01": FLAT_TRANSFER
                },
            },
            "variable": "ebr_energy_bills_credit",
        },
        "ct_rebate": {
            "reform": {
                "gov.treasury.energy_bills_rebate.council_tax_rebate.amount": {
                    "2026-01-01": CT_REBATE
                },
            },
            "variable": "ebr_council_tax_rebate",
        },
    }

    cmask = data.get("country_mask")
    hh_payments = {}
    for key, cfg in pe_policies.items():
        sim = build_reform_simulation(cfg["reform"])
        arr = _hh_array(sim, cfg["variable"])
        arr = arr[cmask] if cmask is not None else arr
        # Council tax rebate is England-only in the real-world 2022
        # policy; the PE-UK formula pays any A-D band household, so mask
        # non-English rows to zero.
        if key == "ct_rebate":
            eng_mask = _england_mask_unfiltered(sim, cmask)
            arr = np.where(eng_mask, arr, 0.0)
        hh_payments[key] = arr

    results = {}
    for policy_key in ["flat_transfer", "ct_rebate", "bn_transfer", "bn_epg"]:
        scenario_list = []
        for name, new_cap in PRICE_SCENARIOS.items():
            pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
            behav_factor_hh = _behavioural_factor_hh(eps_hh, pct)

            if policy_key in hh_payments:
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
                e_d = energy[mask]
                i_d = income[mask]
                w_d = weights[mask]
                p_d = payment[mask]
                bf_d = behav_factor_hh[mask]
                shocked_e = e_d * (1 + pct)
                net_e_static = np.maximum(shocked_e - p_d, e_d)
                behav_e = e_d * bf_d
                net_e_behav = np.maximum(behav_e - p_d, e_d)
                extra_s = float(weighted_mean(np.maximum(net_e_static - e_d, 0), w_d))
                extra_b = float(weighted_mean(np.maximum(net_e_behav - e_d, 0), w_d))
                mean_inc_d = float(weighted_mean(i_d, w_d))
                pct_s = round(extra_s / mean_inc_d * 100, 2) if mean_inc_d > 0 else 0
                pct_b = round(extra_b / mean_inc_d * 100, 2) if mean_inc_d > 0 else 0
                deciles.append(
                    {
                        "decile": d,
                        "extra_cost": round(extra_s),
                        "pct_of_income": pct_s,
                        "behavioural_extra_cost": round(extra_b),
                        "behavioural_pct_of_income": pct_b,
                    }
                )

            by_tenure = _grouped_post_policy(
                energy,
                income,
                weights,
                payment,
                tenure_arr,
                tenure_groups,
                pct,
                behav_factor_hh,
            )
            for t in by_tenure:
                t["tenure"] = t.pop("group")
            by_hh_type = _grouped_post_policy(
                energy,
                income,
                weights,
                payment,
                hh_type_arr,
                hh_type_groups,
                pct,
                behav_factor_hh,
            )
            for h in by_hh_type:
                h["hh_type"] = h.pop("group")
            by_country = _grouped_post_policy(
                energy,
                income,
                weights,
                payment,
                country_arr,
                country_groups,
                pct,
                behav_factor_hh,
            )
            for c in by_country:
                c["country"] = c.pop("group")

            scenario_list.append(
                {
                    "scenario": name,
                    "deciles": deciles,
                    "by_tenure": by_tenure,
                    "by_hh_type": by_hh_type,
                    "by_country": by_country,
                }
            )
        results[policy_key] = scenario_list

    # --- NEG ---
    elec, _gas = data["elec"], data["gas"]
    neg_baseline_benefit = np.minimum(elec, NEG_ELEC_SPEND)

    neg_scenarios = []
    for name, new_cap in PRICE_SCENARIOS.items():
        pct = (new_cap - CURRENT_CAP) / CURRENT_CAP
        behav_factor_hh = _behavioural_factor_hh(eps_hh, pct)
        shocked_elec = elec * (1 + pct)
        neg_threshold_shocked = NEG_ELEC_SPEND * (1 + pct)
        benefit_shocked = np.minimum(shocked_elec, neg_threshold_shocked)
        payment = benefit_shocked - neg_baseline_benefit

        deciles = []
        for d in range(1, 11):
            mask = decile_arr == d
            e_d = energy[mask]
            i_d = income[mask]
            w_d = weights[mask]
            p_d = payment[mask]
            bf_d = behav_factor_hh[mask]
            shocked_e = e_d * (1 + pct)
            net_s = np.maximum(shocked_e - p_d, e_d)
            behav_e = e_d * bf_d
            net_b = np.maximum(behav_e - p_d, e_d)
            extra_s = float(weighted_mean(np.maximum(net_s - e_d, 0), w_d))
            extra_b = float(weighted_mean(np.maximum(net_b - e_d, 0), w_d))
            mean_inc = float(weighted_mean(i_d, w_d))
            pct_s = round(extra_s / mean_inc * 100, 2) if mean_inc > 0 else 0
            pct_b = round(extra_b / mean_inc * 100, 2) if mean_inc > 0 else 0
            deciles.append(
                {
                    "decile": d,
                    "extra_cost": round(extra_s),
                    "pct_of_income": pct_s,
                    "behavioural_extra_cost": round(extra_b),
                    "behavioural_pct_of_income": pct_b,
                }
            )

        by_tenure = _grouped_post_policy(
            energy,
            income,
            weights,
            payment,
            tenure_arr,
            tenure_groups,
            pct,
            behav_factor_hh,
        )
        for t in by_tenure:
            t["tenure"] = t.pop("group")
        by_hh_type = _grouped_post_policy(
            energy,
            income,
            weights,
            payment,
            hh_type_arr,
            hh_type_groups,
            pct,
            behav_factor_hh,
        )
        for h in by_hh_type:
            h["hh_type"] = h.pop("group")
        by_country = _grouped_post_policy(
            energy,
            income,
            weights,
            payment,
            country_arr,
            country_groups,
            pct,
            behav_factor_hh,
        )
        for c in by_country:
            c["country"] = c.pop("group")

        neg_scenarios.append(
            {
                "scenario": name,
                "deciles": deciles,
                "by_tenure": by_tenure,
                "by_hh_type": by_hh_type,
                "by_country": by_country,
            }
        )
    results["neg"] = neg_scenarios

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
        deciles.append(
            {
                "decile": d,
                "electricity": round(me),
                "gas": round(mg),
                "total_energy": round(total),
                "net_income": round(mi),
                "elec_share_pct": round(me / total * 100, 1) if total > 0 else 0,
                "elec_burden_pct": round(me / mi * 100, 2) if mi > 0 else 0,
                "gas_burden_pct": round(mg / mi * 100, 2) if mi > 0 else 0,
            }
        )

    mean_elec = weighted_mean(data["elec"], data["weights"])
    mean_gas = weighted_mean(data["gas"], data["weights"])
    mean_total = mean_elec + mean_gas

    return {
        "mean_electricity": round(mean_elec),
        "mean_gas": round(mean_gas),
        "mean_total": round(mean_total),
        "elec_share_pct": round(mean_elec / mean_total * 100, 1)
        if mean_total > 0
        else 0,
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
        regions.append(
            {
                "region": str(r),
                "electricity": round(me),
                "gas": round(mg),
                "total_energy": round(total_e),
                "net_income": round(mi),
                "energy_burden_pct": round(total_e / mi * 100, 2) if mi > 0 else 0,
                "households_m": round(n_hh, 1),
            }
        )
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

        tenures.append(
            {
                "tenure": str(t),
                "electricity": round(me),
                "gas": round(mg),
                "total_energy": round(me + mg),
                "net_income": round(mi),
                "energy_burden_pct": round((me + mg) / mi * 100, 2) if mi > 0 else 0,
                "households_m": round(n_hh, 1),
            }
        )
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

        hh_types.append(
            {
                "hh_type": str(t),
                "electricity": round(me),
                "gas": round(mg),
                "total_energy": round(me + mg),
                "net_income": round(mi),
                "energy_burden_pct": round((me + mg) / mi * 100, 2) if mi > 0 else 0,
                "households_m": round(n_hh, 1),
            }
        )
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

        countries.append(
            {
                "country": str(c),
                "electricity": round(me),
                "gas": round(mg),
                "total_energy": round(me + mg),
                "net_income": round(mi),
                "energy_burden_pct": round((me + mg) / mi * 100, 2) if mi > 0 else 0,
                "households_m": round(n_hh, 1),
            }
        )
    countries.sort(key=lambda x: x["energy_burden_pct"], reverse=True)
    return countries


# ── 14. NEF National Energy Guarantee ────────────────────────────────────


def neg_policy(data):
    elec, gas, weights = data["elec"], data["gas"], data["weights"]
    _income, decile_arr = data["income"], data["decile"]

    benefit = np.minimum(elec, NEG_ELEC_SPEND)
    baseline_cost_bn = round(float(np.sum(benefit * weights)) / 1e9, 1)
    avg_benefit = round(weighted_mean(benefit, weights))

    deciles_baseline = []
    for d in range(1, 11):
        mask = decile_arr == d
        mb = weighted_mean(benefit, weights, mask)
        me = weighted_mean(elec, weights, mask)
        coverage = mb / me * 100 if me > 0 else 0
        deciles_baseline.append(
            {
                "decile": d,
                "benefit": round(mb),
                "elec_spend": round(me),
                "coverage_pct": round(coverage, 1),
            }
        )

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
            deciles.append(
                {
                    "decile": d,
                    "benefit": round(mb),
                    "shock_extra": round(shock_hit),
                    "benefit_extra_vs_baseline": round(offset),
                    "offset_pct": round(offset_pct, 1),
                }
            )

        scenarios.append(
            {
                "name": name,
                "new_cap": new_cap,
                "exchequer_cost_bn": cost_bn,
                "avg_benefit": avg_b,
                "avg_net_extra_cost": avg_net_extra,
                "deciles": deciles,
            }
        )

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


# ── 15. Gas-only price cap ──────────────────────────────────────────────


def gas_price_cap(data):
    elec, gas, weights = data["elec"], data["gas"], data["weights"]
    decile_arr, _income = data["decile"], data["income"]

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
            deciles.append(
                {
                    "decile": d,
                    "total_shock": round(shock),
                    "gas_subsidy": round(ben),
                    "remaining_cost": round(remaining),
                    "offset_pct": round(offset_pct, 1),
                }
            )

        scenarios.append(
            {
                "name": name,
                "new_cap": new_cap,
                "exchequer_cost_bn": cost_bn,
                "avg_gas_subsidy": avg_benefit,
                "avg_remaining_cost": avg_net_extra,
                "deciles": deciles,
            }
        )

    return {
        "name": "Gas-only price cap",
        "description": "Cap gas bills at current level and let electricity prices float. Gas is more volatile due to wholesale market exposure, so capping gas alone is cheaper and targets the main source of price shocks.",
        "scenarios": scenarios,
    }
