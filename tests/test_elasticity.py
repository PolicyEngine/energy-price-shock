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

    # Both strictly below the static (no-response) factor 1 + pct.
    assert low_factor < 1 + pct
    assert high_factor < 1 + pct


def test_behavioural_factor_physically_admissible_at_extreme_shock():
    """Q1 2023 peak (+161 %) must not produce negative spending factors
    for any decile. The linear approximation ``(1+p)(1+εp)`` produces a
    physically impossible negative factor at (ε=−0.64, p=1.61); the
    log-linear form ``(1+p)^(1+ε)`` stays positive for all ε ∈ (−1, 0].
    Guards against any regression back to the linear first-order form.
    """
    pct = 1.61
    d1_eps = ELASTICITY_BY_DECILE[1]  # -0.64

    # Linear first-order form at (ε=-0.64, p=1.61):
    #   (1 + 1.61) * (1 + (-0.64)*1.61) = 2.61 * (-0.0304) ≈ -0.0793
    linear_factor = (1 + pct) * (1 + d1_eps * pct)
    assert linear_factor < 0, (
        f"sanity: the linear form (1+p)(1+εp) = {linear_factor:.4f} "
        "should be negative at (ε=-0.64, p=1.61) — this test guards "
        "against regressing to it"
    )

    for eps in ELASTICITY_BY_DECILE.values():
        factor = _behavioural_factor_hh(np.array([eps]), pct)[0]
        assert factor > 0, (
            f"ε={eps}: factor {factor} is non-positive, implying "
            "physically impossible consumption change"
        )
        # And explicitly not the broken linear form:
        lin = (1 + pct) * (1 + eps * pct)
        assert not np.isclose(factor, lin, atol=1e-3), (
            f"ε={eps}: factor {factor} matches linear form {lin} — "
            "log-linear implementation has regressed to first-order"
        )

    # Spot-check the canonical constant-elasticity identity:
    # (1+p)**(1+ε) at ε=−0.64, p=1.61  →  2.61**0.36 ≈ 1.4115
    d1_factor = _behavioural_factor_hh(np.array([d1_eps]), pct)[0]
    assert np.isclose(d1_factor, 2.61**0.36, rtol=1e-4)


def test_epsilon_fallback_honours_weights():
    """The weighted-mean fallback for missing-decile rows should weight
    by ``household_weight`` — a uniform fallback would bias toward the
    unweighted arithmetic mean."""
    data = _synthetic_data(
        [0, 1, 10],
        weights=[1.0, 1.0, 9.0],  # D10 dominates
    )
    eps = _epsilon_per_household(data)
    # Weighted mean of D1 and D10, weighted 1:9 toward D10.
    expected = (1 * ELASTICITY_BY_DECILE[1] + 9 * ELASTICITY_BY_DECILE[10]) / 10
    assert np.isclose(eps[0], expected)
