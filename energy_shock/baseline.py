"""Shared baseline: run the microsimulation once, extract all household arrays.

Energy is defined as electricity_consumption + gas_consumption throughout.

Uses the ``policyengine.py`` API for dataset ensuring + simulation. The
policy/dynamic reform dicts compile against the bundled UK model
version, so reform dicts use the same parameter paths as the raw
``policyengine-uk`` Microsimulation.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

# ``policyengine`` import is expensive (HF manifest fetch, multi-GB
# dataset registry) and fails without ``HUGGING_FACE_TOKEN`` set.
# Defer it into the actual simulation functions so that importing
# ``energy_shock.baseline`` for its pure helpers (``weighted_mean``,
# ``decile_means``, ``filter_by_country``) is cheap and offline-safe.
from .config import YEAR, REGION_TO_COUNTRY, DATASET_URL

# Extra household/person variables the energy-shock analysis needs on top
# of the model's default entity_variables. Anything not in this list (or
# in the model default) won't be present on ``output_dataset.data``.
EXTRA_VARIABLES = {
    "person": [
        "is_SP_age",
    ],
    "benunit": [
        "family_type",
    ],
    "household": [
        # Demographics / housing
        "electricity_consumption",
        "gas_consumption",
        "region",
        "accommodation_type",
        # Reform-specific variables pulled by sections.policy_*
        "epg_subsidy",
        "ebr_energy_bills_credit",
        "ebr_council_tax_rebate",
        "winter_fuel_allowance",
    ],
}


def _load_dataset():
    """Ensure the enhanced FRS dataset is materialised for ``YEAR``."""
    from policyengine.tax_benefit_models.uk import ensure_datasets

    datasets = ensure_datasets(datasets=[DATASET_URL], years=[YEAR])
    # ``ensure_datasets`` keys by ``f"{basename}_{year}"`` where basename
    # drops the ``.h5`` suffix.
    (key,) = datasets.keys()
    return datasets[key]


def _build_simulation(policy: dict | None = None):
    """Construct a policyengine.py Simulation with the extra vars wired in."""
    from policyengine.core import Simulation
    from policyengine.tax_benefit_models.uk import uk_latest

    sim = Simulation(
        dataset=_load_dataset(),
        tax_benefit_model_version=uk_latest,
        extra_variables=EXTRA_VARIABLES,
        policy=policy,
    )
    sim.ensure()
    return sim


def _hh_array(sim, var: str) -> np.ndarray:
    """Pull a household-level variable as a numpy array."""
    return np.asarray(sim.output_dataset.data.household[var].values)


def _person_array(sim, var: str) -> np.ndarray:
    return np.asarray(sim.output_dataset.data.person[var].values)


def _benunit_array(sim, var: str) -> np.ndarray:
    return np.asarray(sim.output_dataset.data.benunit[var].values)


def run_baseline():
    """Run baseline simulation and return dict of household-level arrays."""
    sim = _build_simulation()

    elec = _hh_array(sim, "electricity_consumption")
    gas = _hh_array(sim, "gas_consumption")
    energy = elec + gas

    income = _hh_array(sim, "household_net_income")
    # Household weights live on the MicroDataFrame; extract as raw array.
    weights = np.asarray(sim.output_dataset.data.household["household_weight"].values)
    decile = _hh_array(sim, "household_income_decile")
    region = _hh_array(sim, "region")
    tenure = _hh_array(sim, "tenure_type")
    accomm = _hh_array(sim, "accommodation_type")

    hh_type = _build_household_type(sim)

    country_arr = pd.Series(region).astype(str).map(REGION_TO_COUNTRY).fillna("UNKNOWN").to_numpy()

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
    hh_ids = np.asarray(sim.output_dataset.data.household["household_id"].values)

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
    return _build_simulation(policy=reform)


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

    hh_country = pd.Series(data["region"]).astype(str).map(REGION_TO_COUNTRY).fillna("").to_numpy()
    mask = hh_country == country

    filtered = {
        "sim": data["sim"],  # keep original sim for policy reform lookups
        "country_mask": mask,
        "country": country,
    }
    for key in ("elec", "gas", "energy", "income", "weights",
                "decile", "region", "tenure", "accomm", "hh_type"):
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
