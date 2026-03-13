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
    "2022-level": 3_764,
}

# Short-run price elasticity of household energy demand
# NEED 2022-23 data: consumption fell ~10-15% when prices roughly doubled
# Consistent with Levell et al. (2025) and Kilian (2008) estimates
SHORT_RUN_ELASTICITY = -0.15

# Policy response parameters (applied to severe shock)
SHOCK_CAP = PRICE_SCENARIOS["+60%"]
EPG_TARGET = 2_500
FLAT_TRANSFER = 400
CT_REBATE = 300
