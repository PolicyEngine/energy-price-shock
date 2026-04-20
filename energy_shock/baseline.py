"""Shared baseline: run the microsimulation once, extract all household arrays.

Energy is defined as electricity_consumption + gas_consumption throughout.

Uses ``policyengine_uk.Microsimulation`` directly. A migration to the
unified ``policyengine.py`` API was trialled but blocked by a
bootstrap mismatch in ``policyengine.py`` 4.1.x's bundled UK release
manifest (pinned to a data-package version without a published
``release_manifest.json`` on Hugging Face). Reform dicts use the same
parameter paths either way, so the migration can be revisited once
upstream stabilises.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# The ``policyengine_uk`` import pulls the whole UK tax-benefit system
# at module load (variable registry, parameter tree, etc.), so defer it
# into the actual simulation functions. That keeps importing
# ``energy_shock.baseline`` for its pure helpers (``weighted_mean``,
# ``decile_means``, ``filter_by_country``) cheap and makes the unit
# tests under ``tests/`` runnable without a microsim bootstrap.
from .config import DATASET_URL, REGION_TO_COUNTRY, YEAR


def _build_simulation(reform: dict | None = None):
    """Construct a ``policyengine_uk`` Microsimulation.

    Reform dicts use the same parameter paths and date-keyed values as
    reforms passed to the library directly.
    """
    from policyengine_uk import Microsimulation

    return Microsimulation(dataset=DATASET_URL, reform=reform)


def _hh_array(sim, var: str) -> np.ndarray:
    """Pull a household-level variable as a numpy array."""
    series = sim.calculate(var, YEAR)
    return series.values if hasattr(series, "values") else np.asarray(series)


def _person_array(sim, var: str) -> np.ndarray:
    series = sim.calculate(var, YEAR, map_to="person")
    return series.values if hasattr(series, "values") else np.asarray(series)


def _benunit_array(sim, var: str) -> np.ndarray:
    series = sim.calculate(var, YEAR, map_to="benunit")
    return series.values if hasattr(series, "values") else np.asarray(series)


def _weights(sim) -> np.ndarray:
    """Household weights as a raw numpy array (skip the MicroSeries)."""
    series = sim.calculate("household_weight", YEAR, unweighted=True)
    return series.values if hasattr(series, "values") else np.asarray(series)


def run_baseline():
    """Run baseline simulation and return dict of household-level arrays."""
    sim = _build_simulation()

    elec = _hh_array(sim, "electricity_consumption")
    gas = _hh_array(sim, "gas_consumption")
    energy = elec + gas

    income = _hh_array(sim, "household_net_income")
    weights = _weights(sim)
    decile = _hh_array(sim, "household_income_decile")
    region = _hh_array(sim, "region")
    tenure = _hh_array(sim, "tenure_type")
    accomm = _hh_array(sim, "accommodation_type")

    hh_type = _build_household_type(sim)

    country_arr = (
        pd.Series(region)
        .astype(str)
        .map(REGION_TO_COUNTRY)
        .fillna("UNKNOWN")
        .to_numpy()
    )

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
        "country": country_arr,
    }


def _build_household_type(sim) -> np.ndarray:
    """Classify each household into type based on family_type + pensioner status.

    ``family_type`` is held at benunit level; ``is_SP_age`` at person
    level. Aggregate both up to the household via pandas groupby, keeping
    the household frame's row order.
    """
    hh_ids = _hh_array(sim, "household_id")

    # First benunit's family_type per household.
    bu_frame = pd.DataFrame(
        {
            "household_id": _benunit_array(sim, "household_id"),
            "family_type": _benunit_array(sim, "family_type").astype(str),
        }
    )
    first_ft = bu_frame.groupby("household_id")["family_type"].first()

    # Any person at SP age → pensioner household.
    person_frame = pd.DataFrame(
        {
            "household_id": _person_array(sim, "household_id"),
            "is_sp": _person_array(sim, "is_SP_age").astype(bool),
        }
    )
    any_sp = person_frame.groupby("household_id")["is_sp"].any()

    ft = pd.Series(hh_ids).map(first_ft).fillna("UNKNOWN").astype(str).to_numpy()
    is_pen = pd.Series(hh_ids).map(any_sp).fillna(False).astype(bool).to_numpy()

    categories = np.full(len(hh_ids), "OTHER", dtype=object)
    categories[(ft == "SINGLE") & is_pen] = "SINGLE_PENSIONER"
    categories[(ft == "COUPLE_NO_CHILDREN") & is_pen] = "COUPLE_PENSIONER"
    categories[(ft == "SINGLE") & ~is_pen] = "SINGLE_WORKING_AGE"
    categories[(ft == "COUPLE_NO_CHILDREN") & ~is_pen] = "COUPLE_NO_CHILDREN"
    categories[ft == "COUPLE_WITH_CHILDREN"] = "COUPLE_WITH_CHILDREN"
    categories[ft == "LONE_PARENT"] = "LONE_PARENT"
    return categories.astype(str)


def build_reform_simulation(reform: dict):
    """Construct a reformed Simulation. Reform dict uses the same parameter
    paths and date-keyed values as the raw ``policyengine-uk`` reforms.

    Example:

    .. code-block:: python

        sim = build_reform_simulation({
            "gov.ofgem.energy_price_cap": {"2026-01-01": 2625},
        })
    """
    return _build_simulation(reform=reform)


def filter_by_country(data, country):
    """Filter all household arrays to a single country/nation.

    country: "UK" (no filter), "ENGLAND", "SCOTLAND", "WALES", "NORTHERN_IRELAND"
    Returns a new data dict with filtered arrays and a 'country_mask' key
    containing the boolean mask against the original arrays.
    """
    country = country.upper()
    if country == "UK":
        mask = np.ones(len(data["weights"]), dtype=bool)
        return {**data, "country_mask": mask, "country": country}

    hh_country = (
        pd.Series(data["region"])
        .astype(str)
        .map(REGION_TO_COUNTRY)
        .fillna("")
        .to_numpy()
    )
    mask = hh_country == country

    filtered = {
        "sim": data["sim"],  # keep original sim for policy reform lookups
        "country_mask": mask,
        "country": country,
    }
    for key in (
        "elec",
        "gas",
        "energy",
        "income",
        "weights",
        "decile",
        "region",
        "tenure",
        "accomm",
        "hh_type",
    ):
        filtered[key] = data[key][mask]
    return filtered


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
