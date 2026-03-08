"""
Shared baseline: run the microsimulation once, extract all household arrays.

Energy is defined as electricity_consumption + gas_consumption throughout.
"""

import numpy as np
from policyengine_uk import Microsimulation

from .config import YEAR


def _vals(sim, var, **kw):
    """Extract numpy array from sim.calculate, handling MicroSeries."""
    v = sim.calculate(var, YEAR, **kw)
    return v if isinstance(v, np.ndarray) else v.values


def run_baseline():
    """Run baseline simulation and return dict of household-level arrays."""
    sim = Microsimulation()

    elec = _vals(sim, "electricity_consumption")
    gas = _vals(sim, "gas_consumption")
    energy = elec + gas  # consistent total

    income = _vals(sim, "household_net_income")
    weights = _vals(sim, "household_weight", unweighted=True)
    decile = _vals(sim, "household_income_decile", unweighted=True)
    region = _vals(sim, "region")
    tenure = _vals(sim, "tenure_type")
    accomm = _vals(sim, "accommodation_type")

    # Household type: family_type (benunit) + pensioner status (person)
    hh_type = _build_household_type(sim)

    return {
        "sim": sim,
        "elec": elec,
        "gas": gas,
        "energy": energy,
        "income": income,
        "weights": weights,
        "decile": decile,
        "region": region,
        "tenure": tenure,
        "accomm": accomm,
        "hh_type": hh_type,
    }


def _build_household_type(sim):
    """Classify each household into type based on family_type + pensioner status."""
    from collections import defaultdict

    hh_id_hh = _vals(sim, "household_id")
    hh_id_bu = _vals(sim, "household_id", map_to="benunit")
    hh_id_person = _vals(sim, "household_id", map_to="person")
    ft = _vals(sim, "family_type")
    is_sp = _vals(sim, "is_SP_age")

    # First benunit's family_type per household
    hh_ft = {}
    for i, hid in enumerate(hh_id_bu):
        if hid not in hh_ft:
            hh_ft[hid] = str(ft[i])

    # Any person at state pension age -> pensioner household
    hh_pensioner = defaultdict(bool)
    for i, hid in enumerate(hh_id_person):
        if is_sp[i]:
            hh_pensioner[hid] = True

    categories = []
    for hid in hh_id_hh:
        ftype = hh_ft.get(hid, "UNKNOWN")
        is_pen = hh_pensioner[hid]
        if ftype == "SINGLE" and is_pen:
            categories.append("SINGLE_PENSIONER")
        elif ftype == "COUPLE_NO_CHILDREN" and is_pen:
            categories.append("COUPLE_PENSIONER")
        elif ftype == "SINGLE":
            categories.append("SINGLE_WORKING_AGE")
        elif ftype == "COUPLE_NO_CHILDREN":
            categories.append("COUPLE_NO_CHILDREN")
        elif ftype == "COUPLE_WITH_CHILDREN":
            categories.append("COUPLE_WITH_CHILDREN")
        elif ftype == "LONE_PARENT":
            categories.append("LONE_PARENT")
        else:
            categories.append("OTHER")

    return np.array(categories)


def weighted_mean(values, weights, mask=None):
    """Weighted average, optionally filtered by boolean mask."""
    if mask is not None:
        values = values[mask]
        weights = weights[mask]
    if weights.sum() == 0:
        return 0
    return float(np.average(values, weights=weights))


def decile_means(data, var_key):
    """Return dict {1: mean, 2: mean, ...} for a variable by income decile."""
    out = {}
    for d in range(1, 11):
        mask = data["decile"] == d
        out[d] = weighted_mean(data[var_key], data["weights"], mask)
    return out
