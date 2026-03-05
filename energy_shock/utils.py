from microdf import MicroDataFrame


def fmt_bn(v):
    return f"{v / 1e9:.1f}"


def fmt_gbp(v):
    return f"{v:,.0f}"


def calc_decile_table(sim, variable, year):
    """Weighted mean of `variable` by income decile using microdf."""
    values = sim.calculate(variable, year)
    deciles = sim.calculate("household_income_decile", year, unweighted=True)
    weights = sim.calculate("household_weight", year, unweighted=True)
    df = MicroDataFrame(
        {"value": values.values, "decile": deciles},
        weights=weights,
    )
    df = df[df.decile > 0]
    return df.groupby("decile")["value"].mean()
