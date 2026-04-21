"""
All analysis sections: baseline summary, shocks, behavioural responses,
policy scenarios (flat transfer + CT rebate + post-shock composite),
electricity/gas split, tenure / household-type / country breakdowns, and
the National Energy Guarantee (NEG).

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
    FLAT_TRANSFER,
    NEG_ELEC_KWH,
    NEG_ELEC_SPEND,
    PRICE_SCENARIOS,
    SHOCK_CAP,
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
                    # Log-linear q_new / q_old = (1 + p)^ε. Reduction is
                    # reported as a positive percentage: (1 − q_new/q_old)
                    # × 100. The earlier linear εp approximation produced
                    # values > 100 % (implying negative consumption) at
                    # the +161 % scenario for low deciles.
                    "consumption_reduction_pct": round(
                        (1 - (1 + price_pct) ** eps_d) * 100, 1
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


# ── 5. Policy: Flat transfer ────────────────────────────────────────────


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


# ── 6. Policy: CT rebate ────────────────────────────────────────────────


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
                    "net_change": 0,
                    "behavioural_net_change": 0,
                }
            )
            continue
        shocked_e = e_g * (1 + pct)
        # Signed net change: positive = still worse off vs baseline,
        # negative = over-compensated by the policy payment.
        net_change_s = float(weighted_mean(shocked_e - p_g - e_g, w_g))
        # "extra_cost" is the underwater-only aggregate: households fully
        # offset by the policy contribute zero, so this floor is a
        # residual-burden view rather than a net-welfare view.
        extra_s = float(weighted_mean(np.maximum(shocked_e - p_g - e_g, 0), w_g))
        mean_inc = float(weighted_mean(i_g, w_g))
        pct_inc_s = round(extra_s / mean_inc * 100, 2) if mean_inc > 0 else 0
        behav_e = e_g * bf_g
        net_change_b = float(weighted_mean(behav_e - p_g - e_g, w_g))
        extra_b = float(weighted_mean(np.maximum(behav_e - p_g - e_g, 0), w_g))
        pct_inc_b = round(extra_b / mean_inc * 100, 2) if mean_inc > 0 else 0
        result.append(
            {
                "group": str(g),
                "extra_cost": round(extra_s),
                "pct_of_income": round(pct_inc_s, 2),
                "behavioural_extra_cost": round(extra_b),
                "behavioural_pct_of_income": round(pct_inc_b, 2),
                "net_change": round(net_change_s),
                "behavioural_net_change": round(net_change_b),
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
                behav_e = e_d * bf_d
                # Signed net change (can be negative when the policy
                # over-compensates vs the household's shock) and the
                # underwater-only residual (used for the main chart).
                net_change_s = float(weighted_mean(shocked_e - p_d - e_d, w_d))
                net_change_b = float(weighted_mean(behav_e - p_d - e_d, w_d))
                extra_s = float(
                    weighted_mean(np.maximum(shocked_e - p_d - e_d, 0), w_d)
                )
                extra_b = float(weighted_mean(np.maximum(behav_e - p_d - e_d, 0), w_d))
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
                        "net_change": round(net_change_s),
                        "behavioural_net_change": round(net_change_b),
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
        # NEG subsidy is indexed to each household's static pre-shock
        # consumption (see neg_policy docstring for the caveat). Using
        # static here keeps the subsidy consistent between the two
        # response views the dashboard toggles between.
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
            behav_e = e_d * bf_d
            net_change_s = float(weighted_mean(shocked_e - p_d - e_d, w_d))
            net_change_b = float(weighted_mean(behav_e - p_d - e_d, w_d))
            extra_s = float(weighted_mean(np.maximum(shocked_e - p_d - e_d, 0), w_d))
            extra_b = float(weighted_mean(np.maximum(behav_e - p_d - e_d, 0), w_d))
            mean_inc = float(weighted_mean(i_d, w_d))
            pct_s = round(extra_s / mean_inc * 100, 2) if mean_inc > 0 else 0
            pct_b = round(extra_b / mean_inc * 100, 2) if mean_inc > 0 else 0
            deciles.append(
                {
                    "decile": d,
                    "extra_cost": round(extra_s),
                    "pct_of_income": pct_s,
                    "net_change": round(net_change_s),
                    "behavioural_net_change": round(net_change_b),
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


# ── 12. Tenure breakdown ────────────────────────────────────────────────


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


# ── 12b. Household type breakdown ───────────────────────────────────────


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


# ── 12c. Country breakdown ──────────────────────────────────────────────


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


# ── 13. NEF National Energy Guarantee ───────────────────────────────────


def neg_policy(data):
    """National Energy Guarantee scenarios.

    Subsidy is indexed to each household's pre-shock consumption up to
    the 2,900 kWh threshold. This is the simpler reading of Bangham's
    (2026) proposal — an "inframarginal" allocation each household
    receives at the old price regardless of how it responds to the
    shock. An alternative design indexing the subsidy to actual post-
    shock consumption would shrink subsidy cost for the highest-
    elasticity (low-income) deciles that cut below the threshold, and
    correspondingly reduce headline progressivity.
    """
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
        # Subsidy base: static pre-shock electricity consumption up to
        # the 2,900 kWh threshold. We treat the NEG allocation as a
        # fixed entitlement indexed to each household's baseline usage
        # rather than their post-shock behavioural response, so the
        # subsidy doesn't shrink when a household cuts below threshold.
        # If the real policy were indexed to actual post-shock usage,
        # subsidy cost and headline progressivity would both fall for
        # the highest-elasticity (low-income) deciles.
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
        "subsidy_indexed_to": "static_baseline_consumption",
    }
