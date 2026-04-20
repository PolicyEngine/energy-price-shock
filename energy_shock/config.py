YEAR = 2026

# Country / nation filter (default: whole UK)
# Valid values: "UK", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN_IRELAND"
COUNTRY = "UK"

ENGLISH_REGIONS = {
    "EAST_MIDLANDS", "EAST_OF_ENGLAND", "LONDON", "NORTH_EAST",
    "NORTH_WEST", "SOUTH_EAST", "SOUTH_WEST", "WEST_MIDLANDS", "YORKSHIRE",
}

REGION_TO_COUNTRY = {r: "ENGLAND" for r in ENGLISH_REGIONS}
REGION_TO_COUNTRY["SCOTLAND"] = "SCOTLAND"
REGION_TO_COUNTRY["WALES"] = "WALES"
REGION_TO_COUNTRY["NORTHERN_IRELAND"] = "NORTHERN_IRELAND"

# Current Ofgem price cap (Q2 2026, April–June)
CURRENT_CAP = 1_641

# Price shock scenarios to test
PRICE_SCENARIOS = {
    "+10%": int(CURRENT_CAP * 1.10),
    "+20%": int(CURRENT_CAP * 1.20),
    "+30%": int(CURRENT_CAP * 1.30),
    "+60%": int(CURRENT_CAP * 1.60),
    # Q1 2023 Ofgem cap peak (default tariff, dual-fuel direct-debit, typical consumption).
    # Source: Ofgem default tariff levels — https://www.ofgem.gov.uk/energy-regulation/domestic-and-non-domestic/energy-pricing-rules/energy-price-cap/energy-price-cap-default-tariff-levels
    "Q1 2023 peak": 4_279,
}

# Short-run price elasticity of household energy demand.
# Default −0.15 is the overall energy meta-analytic estimate from
# Labandeira et al. (2017). NEED 2022-23 UK data shows consumption fell
# ~10-15% when prices roughly doubled, consistent with this value at the
# population mean.
#
# CAVEAT: this is a mean elasticity applied uniformly. Priesmann and
# Praktiknjo (2025) find income-differentiated values ranging from −0.64
# (low-income) to −0.11 (high-income) — poorer households cut
# consumption far more sharply under a shock. Using a uniform value
# therefore understates the behavioural-side progressivity of a shock
# (and overstates the bill-saving that richer households achieve).
# ``ELASTICITY_BY_DECILE`` below linearly interpolates the Priesmann
# endpoints across deciles for sensitivity runs; ``SHORT_RUN_ELASTICITY``
# is used for the headline numbers to stay comparable with prior PE work.
#
# CAVEAT 2: a constant-elasticity linearisation is applied out to +161%
# (Q1 2023 peak scenario), well outside the ±10-20% band over which the
# meta-analyses are validated. Treat the extreme-shock scenarios as
# illustrative rather than predictive.
SHORT_RUN_ELASTICITY = -0.15

# Priesmann & Praktiknjo (2025) income-differentiated elasticities.
# Linearly interpolate from D1 = −0.64 to D10 = −0.11 across the ten
# income deciles. Used by ``behavioral_responses`` when
# ``decile_elasticity=True`` is passed through.
ELASTICITY_BY_DECILE = {
    d: -0.64 + (d - 1) * (-0.11 - -0.64) / 9 for d in range(1, 11)
}

# Policy response parameters (applied to severe shock)
SHOCK_CAP = PRICE_SCENARIOS["+60%"]
EPG_TARGET = 2_500
FLAT_TRANSFER = 400
CT_REBATE = 300

# Ofgem Q2 2026 unit rates (for kWh ↔ £ threshold conversions)
ELEC_RATE = 24.70 / 100   # £/kWh
GAS_RATE = 5.70 / 100     # £/kWh

# NEG: median electricity consumption threshold
NEG_ELEC_KWH = 2_900
NEG_ELEC_SPEND = NEG_ELEC_KWH * ELEC_RATE

# Winter Fuel Payment amounts
WFA_HIGHER = 500
WFA_LOWER = 350

# Rising block tariff discount rate
RBT_DISCOUNT_RATE = 0.50

# HuggingFace dataset URL for PE UK data
DATASET_URL = "hf://policyengine/policyengine-uk-data/enhanced_frs_2023_24.h5"

