"""Unit tests for the decile-specific elasticity helpers.

Kept lightweight: no microsimulation, no dataset download. Tests the
pure numerical machinery that decile-specific behavioural responses
rest on.
"""

from __future__ import annotations

import numpy as np

from energy_shock.config import ELASTICITY_BY_DECILE
from energy_shock.sections import (
    _behavioural_factor_hh,
    _epsilon_per_household,
)


def _synthetic_data(deciles, weights=None, energy=None, income=None):
    """Build a tiny dict with the same shape as ``run_baseline`` output."""
    deciles = np.asarray(deciles)
    n = len(deciles)
    return {
        "decile": deciles,
        "weights": np.ones(n) if weights is None else np.asarray(weights),
        "energy": np.full(n, 1500.0) if energy is None else np.asarray(energy),
        "income": np.full(n, 30000.0) if income is None else np.asarray(income),
    }


def test_elasticity_spans_priesmann_endpoints():
    """D1 should sit at -0.64, D10 at -0.11, monotone in between."""
    assert np.isclose(ELASTICITY_BY_DECILE[1], -0.64)
    assert np.isclose(ELASTICITY_BY_DECILE[10], -0.11)
    for d in range(1, 10):
        assert ELASTICITY_BY_DECILE[d] < ELASTICITY_BY_DECILE[d + 1] + 1e-9


def test_epsilon_per_household_maps_deciles():
    data = _synthetic_data([1, 5, 10])
    eps = _epsilon_per_household(data)
    assert np.isclose(eps[0], ELASTICITY_BY_DECILE[1])
    assert np.isclose(eps[1], ELASTICITY_BY_DECILE[5])
    assert np.isclose(eps[2], ELASTICITY_BY_DECILE[10])


def test_epsilon_per_household_fallback_for_missing():
    """Decile 0 / -1 rows should fall back to the weighted mean, not stay
    at zero (which would silently eliminate their behavioural response)."""
    data = _synthetic_data([0, 1, 10], weights=[1.0, 1.0, 1.0])
    eps = _epsilon_per_household(data)
    # Fallback is the mean of the two good values; should be negative.
    assert eps[0] < 0, "missing-decile fallback should inherit the weighted mean"
    assert np.isclose(eps[0], (ELASTICITY_BY_DECILE[1] + ELASTICITY_BY_DECILE[10]) / 2)


def test_behavioural_factor_zero_price_change_identity():
    """No price change ⇒ factor = 1.0 regardless of elasticity."""
    eps = np.array([-0.64, -0.11])
    factor = _behavioural_factor_hh(eps, 0.0)
    assert np.allclose(factor, 1.0)


def test_behavioural_factor_low_decile_cuts_harder():
    """At +60 %, low-decile households should reduce consumption more
    than high-decile households (the whole point of using Priesmann)."""
    low_eps = ELASTICITY_BY_DECILE[1]
    high_eps = ELASTICITY_BY_DECILE[10]
    pct = 0.60

    low_factor = _behavioural_factor_hh(np.array([low_eps]), pct)[0]
    high_factor = _behavioural_factor_hh(np.array([high_eps]), pct)[0]
    # Lower factor = bigger bill saving relative to static.
    assert low_factor < high_factor

    # Quantify: low-decile consumption drops more, so its bill ratio
    # is closer to 1.0 than the high-decile one under a 60% shock.
    assert low_factor < 1 + pct  # static 1.6
    assert high_factor < 1 + pct
