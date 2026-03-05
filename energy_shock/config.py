YEAR = 2026

# Current Ofgem price cap (Q3 2025, latest published)
CURRENT_CAP = 1_720

# Price shock scenarios to test
PRICE_SCENARIOS = {
    "Moderate (+30%)": int(CURRENT_CAP * 1.30),
    "Severe (+60%)": int(CURRENT_CAP * 1.60),
    "2022-level": 3_764,
    "Extreme (£4,500)": 4_500,
}

# Policy response parameters (applied to severe shock)
SHOCK_CAP = PRICE_SCENARIOS["Severe (+60%)"]
EPG_TARGET = 2_500
FLAT_TRANSFER = 400
CT_REBATE = 300
