YEAR = 2026

# Country / nation filter (default: whole UK)
# Valid values: "UK", "ENGLAND", "SCOTLAND", "WALES", "NORTHERN_IRELAND"
COUNTRY = "UK"

ENGLISH_REGIONS = {
    "EAST_MIDLANDS",
    "EAST_OF_ENGLAND",
    "LONDON",
    "NORTH_EAST",
    "NORTH_WEST",
    "SOUTH_EAST",
    "SOUTH_WEST",
    "WEST_MIDLANDS",
    "YORKSHIRE",
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

# Income-differentiated short-run price elasticities of household energy
# demand. The D1 (−0.64) and D10 (−0.11) endpoints are reported by
# Priesmann & Praktiknjo (2025) for German gas; the interior values
# (D2-D9) are our own linear interpolation between those endpoints and
# are not a result of that paper. A flat or smoothly monotone pattern
# between endpoints is consistent with Priesmann's reported trend but
# any specific interior shape is a modelling choice.
#
# The behavioural response for each household is computed from its own
# decile's ε rather than a population-mean value, so the progressivity
# of the shock is captured rather than averaged away. A uniform value
# (e.g. the −0.15 Labandeira et al. 2017 meta-analytic mean) would
# understate how sharply low-income households are forced to cut and
# overstate the bill-saving higher-income households achieve.
#
# For reporting headline aggregate statistics ("average household gives
# up X% of consumption") the weighted mean of these decile-specific
# values is used — computed at output time rather than hardcoded.
#
# CAVEAT: the constant-elasticity form is applied out to +161 %
# (Q1 2023 peak scenario), well outside the ±10-20 % band over which
# the underlying elasticity studies are validated. Treat the extreme-
# shock scenarios as illustrative rather than predictive.
ELASTICITY_BY_DECILE = {d: -0.64 + (d - 1) * (-0.11 - -0.64) / 9 for d in range(1, 11)}

# Policy response parameters (applied to severe shock)
SHOCK_CAP = PRICE_SCENARIOS["+60%"]
FLAT_TRANSFER = 400
CT_REBATE = 300

# Ofgem Q2 2026 unit rates (for kWh ↔ £ threshold conversions)
ELEC_RATE = 24.70 / 100  # £/kWh
GAS_RATE = 5.70 / 100  # £/kWh

# NEG electricity threshold per Bangham (2026) Substack proposal: matches
# Austria and the Netherlands' 2022 "first N kWh at the old price" relief
# schemes. 2,900 kWh is close to but not identical to the Ofgem TDCV for
# electricity (≈ 2,700 kWh for the medium-consumption band).
NEG_ELEC_KWH = 2_900
NEG_ELEC_SPEND = NEG_ELEC_KWH * ELEC_RATE

# HuggingFace dataset URL for PE UK data
DATASET_URL = "hf://policyengine/policyengine-uk-data/enhanced_frs_2023_24.h5"
