import { useState, useEffect } from "react";
import results from "../data/results.json";
import resultsV2 from "../data/results_v2.json";
import constituencyData from "../data/constituency_results.json";
import ConstituencyMap from "./ConstituencyMap";
import "./Dashboard.css";

const fmt = (v) => `£${v.toLocaleString("en-GB")}`;
const fmtBn = (v) => `£${v}bn`;

const POLICY_META = {
  epg: {
    letter: "A",
    fullName: "Energy Price Guarantee (EPG)",
    description: <>
      The government caps the unit rate so that a typical dual-fuel household pays no more than £2,500/yr and subsidises suppliers for the
      difference.<a href="#fn-11"><sup>11</sup></a> This mirrors the EPG that ran from October 2022 to June
      2023.<a href="#fn-10"><sup>10</sup></a> We model it by computing each household's bill at the shocked price cap and capping it at £2,500; the subsidy equals
      the difference. Because the subsidy is proportional to consumption, higher-usage households receive more in absolute terms. The EPG only
      activates when the Ofgem cap exceeds £2,500, so small shocks produce zero benefit.
    </>,
  },
  flat_transfer: {
    letter: "A",
    fullName: "Flat transfer (£400 per household)",
    description: <>
      Every household receives a £400 credit on its energy bill, regardless of income, tenure, or consumption. This replicates the Energy Bills
      Support Scheme (EBSS) paid in autumn/winter 2022.<a href="#fn-12"><sup>12</sup></a> We model it as a lump-sum deduction from each household's
      post-shock energy cost. Because the payment is flat, it represents a larger share of income for poorer households (progressive in percentage
      terms) but is entirely untargeted, as wealthy households receive the same amount.
    </>,
  },
  ct_rebate: {
    letter: "B",
    fullName: "Council tax band rebate (£300 for bands A–D)",
    description: <>
      A £300 payment to households in council tax bands A through D, replicating the Council Tax Rebate paid in April
      2022.<a href="#fn-13"><sup>13</sup></a> We assign council tax bands using the PolicyEngine UK microsimulation
      model<a href="#fn-6"><sup>6</sup></a> and apply the payment to qualifying households. Bands A–D cover roughly 63% of English
      dwellings,<a href="#fn-14"><sup>14</sup></a> using property value as a proxy for income. More targeted than a flat transfer but an imprecise proxy:
      some high-income households in low-band properties receive it, while some low-income households in higher bands do not.
    </>,
  },
  bn_transfer: {
    letter: "C",
    fullName: "Budget-neutral flat transfer",
    description: <>
      A hypothetical policy: every household receives a flat payment equal to the average extra energy cost under the selected shock scenario.
      By construction the total payout equals the total shock cost, making it budget-neutral relative to the shock. We compute the average
      static extra cost across all households and credit that amount to each. Higher-consuming households remain under-compensated; lower-consuming
      households are over-compensated. The payment scales automatically with the shock severity.
    </>,
  },
  bn_epg: {
    letter: "D",
    fullName: "Budget-neutral EPG (cap at £1,641)",
    description: <>
      A hypothetical policy: the government caps every household's bill at the current Ofgem level (£1,641/yr)<a href="#fn-5"><sup>5</sup></a> and
      subsidises the full price increase. Each household is compensated in exact proportion to its consumption, so every decile's net extra cost
      is zero. This is the most expensive option, as the exchequer cost equals the total shock cost, but it achieves 100% offset for all households.
      We model it by setting each household's bill to the pre-shock level and computing the subsidy as the difference.
    </>,
  },
  neg: {
    letter: "E",
    fullName: "National Energy Guarantee",
    description: <>
      Based on the NEF proposal discussed in <a href="#ref-bangham">Bangham (2026)</a>: the government subsidises all energy consumption below a
      kWh threshold at the pre-shock unit price. The threshold is set at the median household consumption level. Households consuming below the
      threshold are fully shielded; those above pay the shocked price on the margin. We compute each household's subsidy as min(consumption,
      threshold) × (shocked unit price − baseline unit price). Progressive by design because low-income households tend to consume less energy, so
      a larger share of their bill falls below the threshold.
    </>,
  },
  rbt: {
    letter: "G",
    fullName: "Rising block tariff",
    description: <>
      A two-tier pricing structure with zero exchequer cost, as discussed in <a href="#ref-bangham">Bangham (2026)</a>. The first block of
      consumption (below a threshold) receives a percentage discount; usage above the threshold pays a percentage surcharge. The surcharge rate is
      calibrated so that total surcharge revenue exactly funds total discount payments. We model this by computing each household's consumption
      split across blocks and applying the discount/surcharge rates.
    </>,
  },
};

function KpiCard({ label, value, unit, color, info }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">
        {label}
        {info && (
          <span className="kpi-info-wrap">
            <span className="kpi-info-icon">i</span>
            <span className="kpi-info-tooltip">{info}</span>
          </span>
        )}
      </div>
      <div className={`kpi-value ${color || ""}`}>
        {value}
        {unit && <span className="kpi-unit">{unit}</span>}
      </div>
    </div>
  );
}

function niceTicks(maxValue, count = 5) {
  if (maxValue <= 0) return [0];
  const rough = maxValue / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  let step;
  if (residual <= 1.5) step = mag;
  else if (residual <= 3) step = 2 * mag;
  else if (residual <= 7) step = 5 * mag;
  else step = 10 * mag;
  const ticks = [];
  for (let v = 0; v <= maxValue; v += step) {
    ticks.push(Math.round(v * 1000) / 1000);
  }
  return ticks;
}

function ColumnChart({ data, maxValue, color, formatValue, colorFn, yLabel, xLabel }) {
  const ticks = niceTicks(maxValue);
  const topTick = ticks[ticks.length - 1] || maxValue;
  const effectiveMax = Math.max(maxValue, topTick);

  return (
    <div className="col-chart">
      {yLabel && <div className="col-chart-y-label">{yLabel}</div>}
      <div className="col-chart-body">
        <div className="col-chart-y-axis">
          {[...ticks].reverse().map((t, i) => (
            <div
              className="col-chart-y-tick"
              key={i}
              style={{ bottom: `${(t / effectiveMax) * 100}%` }}
            >
              {formatValue ? formatValue(t) : t}
            </div>
          ))}
        </div>
        <div className="col-chart-area">
          {ticks.map((t, i) => (
            <div
              className="col-chart-gridline"
              key={i}
              style={{ bottom: `${(t / effectiveMax) * 100}%` }}
            />
          ))}
          <div className="col-chart-bars">
            {data.map((d, i) => {
              const pct = (d.value / effectiveMax) * 100;
              const bg = colorFn ? colorFn(d, i) : undefined;
              const tooltipText = d.tooltip || (formatValue ? formatValue(d.value) : d.value);
              return (
                <div className="col-chart-col" key={i}>
                  <div className="col-chart-tooltip">{tooltipText}</div>
                  <div className="col-chart-track">
                    <div
                      className={`col-chart-fill ${color || ""}`}
                      style={{
                        height: `${pct}%`,
                        ...(bg ? { background: bg } : {}),
                      }}
                    />
                  </div>
                  <div className="col-chart-label">{d.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {xLabel && <div className="col-chart-x-label">{xLabel}</div>}
    </div>
  );
}

function BaselineSection() {
  const { baseline } = results;
  const split = resultsV2.energy_split;
  const tenureData = resultsV2.tenure;
  const hhTypeData = resultsV2.household_type;
  const [baselineView, setBaselineView] = useState("elec_gas");
  const [breakdownView, setBreakdownView] = useState("decile");

  const TENURE_LABELS = {
    OWNED_OUTRIGHT: "Owned outright",
    OWNED_WITH_MORTGAGE: "Mortgage",
    RENT_PRIVATELY: "Private rent",
    RENT_FROM_COUNCIL: "Council rent",
    RENT_FROM_HA: "Housing assoc.",
  };
  const HH_TYPE_LABELS = {
    SINGLE_PENSIONER: "Single pensioner",
    COUPLE_PENSIONER: "Couple pensioner",
    SINGLE_WORKING_AGE: "Single (working age)",
    COUPLE_NO_CHILDREN: "Couple, no children",
    COUPLE_WITH_CHILDREN: "Couple with children",
    LONE_PARENT: "Lone parent",
    OTHER: "Other",
  };
  // Build chart data for current metric + breakdown combo
  let chartTitle, chartSubtitle, xLabel;
  const bk = breakdownView;

  if (bk === "decile") xLabel = "Decile";
  else if (bk === "hh_type") xLabel = "Household type";
  else xLabel = "Tenure";

  // Helper: generic item list with .elec, .gas, .net_income, .energy_burden_pct
  const getItems = () => {
    if (bk === "decile") return baseline.deciles.map((d, i) => ({
      label: `${d.decile}`,
      elec: split.deciles[i].electricity, gas: split.deciles[i].gas,
      net_income: d.net_income, energy_burden_pct: d.energy_share_pct,
      elec_burden_pct: split.deciles[i].elec_burden_pct, gas_burden_pct: split.deciles[i].gas_burden_pct,
    }));
    if (bk === "hh_type") return hhTypeData.map((h) => ({
      label: HH_TYPE_LABELS[h.hh_type] || h.hh_type,
      elec: h.electricity, gas: h.gas, net_income: h.net_income, energy_burden_pct: h.energy_burden_pct,
    }));
    return tenureData.map((t) => ({
      label: TENURE_LABELS[t.tenure] || t.tenure,
      elec: t.electricity, gas: t.gas, net_income: t.net_income, energy_burden_pct: t.energy_burden_pct,
    }));
  };
  const items = getItems();

  // Sort non-decile breakdowns by the active metric descending
  if (bk !== "decile") {
    if (baselineView === "elec_gas") items.sort((a, b) => (b.elec + b.gas) - (a.elec + a.gas));
    else if (baselineView === "energy_share") items.sort((a, b) => b.energy_burden_pct - a.energy_burden_pct);
    else items.sort((a, b) => b.net_income - a.net_income);
  }

  // All views use stacked elec/gas bars except net_income
  let stackedBarData, stackedMaxVal, stackedFmtVal, stackedLegendA, stackedLegendB, stackedColorA, stackedColorB;
  let simpleBarData, simpleMaxVal, simpleFormat;
  const isStacked = baselineView === "elec_gas" || baselineView === "energy_share";

  if (baselineView === "elec_gas") {
    stackedBarData = items.map((it) => ({ label: it.label, elec: it.elec, gas: it.gas }));
    stackedMaxVal = Math.max(...stackedBarData.map((d) => d.elec + d.gas)) * 1.15;
    stackedFmtVal = (v) => fmt(v);
    stackedLegendA = "Electricity"; stackedLegendB = "Gas";
    stackedColorA = "#f59e0b"; stackedColorB = "#3b82f6";
    chartTitle = "Figure 1: Baseline energy burden";
    chartSubtitle = "Annual £ per household";
  } else if (baselineView === "energy_share") {
    stackedBarData = items.map((it) => {
      const elecPct = it.elec_burden_pct != null ? it.elec_burden_pct : +(it.elec / it.net_income * 100).toFixed(1);
      const gasPct = it.gas_burden_pct != null ? it.gas_burden_pct : +(it.gas / it.net_income * 100).toFixed(1);
      return { label: it.label, elec: elecPct, gas: gasPct };
    });
    stackedMaxVal = Math.max(...stackedBarData.map((d) => d.elec + d.gas)) * 1.15;
    stackedFmtVal = (v) => `${v.toFixed(1)}%`;
    stackedLegendA = "Electricity"; stackedLegendB = "Gas";
    stackedColorA = "#f59e0b"; stackedColorB = "#3b82f6";
    chartTitle = "Figure 1: Baseline energy burden";
    chartSubtitle = bk === "decile" ? "decile 1 = lowest income, decile 10 = highest income" : "% of household net income spent on energy";
  } else {
    simpleBarData = items.map((it) => ({ label: it.label, value: it.net_income }));
    simpleMaxVal = Math.max(...simpleBarData.map((d) => d.value)) * 1.15;
    simpleFormat = (v) => fmt(v);
    chartTitle = "Figure 1: Baseline energy burden";
    chartSubtitle = "annual household net income (earnings + benefits − taxes)";
  }

  return (
    <section className="section" id="baseline">
      <h2 className="section-title">Baseline energy burden</h2>

      <div className="kpi-row">
        <KpiCard label="Households" value={`${baseline.n_households_m}m`} color="teal" info="Total number of UK households in the microsimulation sample, weighted to population totals." />
        <KpiCard label="Avg electricity" value={fmt(split.mean_electricity)} unit="/yr" info="Mean annual household electricity bill before any price shock, based on imputed consumption from NEED 2023 data." />
        <KpiCard label="Avg gas" value={fmt(split.mean_gas)} unit="/yr" info="Mean annual household gas bill before any price shock, based on imputed consumption from NEED 2023 data." />
        <KpiCard label="Avg total energy" value={fmt(baseline.mean_energy_spend)} unit="/yr" info="Mean annual combined electricity and gas bill per household at current prices." />
      </div>

      <p className="section-description">
        Before modelling any price shock, we establish how energy costs are
        distributed. Household energy bills are split between
        electricity ({split.elec_share_pct}% of spending)
        and gas ({(100 - split.elec_share_pct).toFixed(1)}%). Gas prices are
        more volatile because they are directly tied to wholesale markets, so
        a geopolitical shock feeds through primarily via gas. Electricity
        prices also rise because gas-fired power stations set the marginal
        price.
      </p>

      <div className="pill-row">
        <span className="pill-row-label">METRIC</span>
        <div className="scenario-pills">
          {[
            { key: "elec_gas", label: "Energy (£/yr)" },
            { key: "energy_share", label: "Energy / income (%)" },
            { key: "net_income", label: "Net income (£/yr)" },
          ].map((v) => (
            <button
              key={v.key}
              className={`scenario-pill${baselineView === v.key ? " active" : ""}`}
              onClick={() => setBaselineView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row" style={{ justifyContent: "center" }}>
        <span className="pill-row-label">BREAKDOWN</span>
        <div className="scenario-pills">
          {[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
            { key: "constituency", label: "By constituency" },
          ].map((v) => (
            <button
              key={v.key}
              className={`scenario-pill${breakdownView === v.key ? " active" : ""}`}
              onClick={() => setBreakdownView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {breakdownView === "constituency" ? (
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <div className="chart-title">Figure 1: Baseline energy burden</div>
              <div className="chart-subtitle">650 parliamentary constituencies. Search or hover to explore.</div>
            </div>
          </div>
          <ConstituencyMap data={constituencyData} activeView={baselineView} />
        </div>
      ) : (
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <div className="chart-title">{chartTitle}</div>
              <div className="chart-subtitle">{chartSubtitle}</div>
            </div>
          </div>

          {isStacked ? (
            (() => {
              const ticks = niceTicks(stackedMaxVal);
              const topTick = ticks[ticks.length - 1] || stackedMaxVal;
              const effectiveMax = Math.max(stackedMaxVal, topTick);
              return (
                <div className="col-chart">
                  <div className="col-chart-body">
                    <div className="col-chart-y-axis">
                      {[...ticks].reverse().map((t, i) => (
                        <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>
                          {stackedFmtVal(t)}
                        </div>
                      ))}
                    </div>
                    <div className="col-chart-area">
                      {ticks.map((t, i) => (
                        <div className="col-chart-gridline" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }} />
                      ))}
                      <div className="col-chart-bars">
                        {stackedBarData.map((d, i) => (
                          <div className="col-chart-col" key={i}>
                            <div className="col-chart-tooltip">
                              Total: {stackedFmtVal(d.elec + d.gas)} (Elec: {stackedFmtVal(d.elec)}, Gas: {stackedFmtVal(d.gas)})
                            </div>
                            <div className="col-chart-track" style={{ flexDirection: "column-reverse" }}>
                              <div
                                className="col-chart-fill"
                                style={{ height: `${(d.elec / effectiveMax) * 100}%`, background: stackedColorA, borderRadius: 0 }}
                              />
                              <div
                                className="col-chart-fill"
                                style={{ height: `${(d.gas / effectiveMax) * 100}%`, background: stackedColorB, borderRadius: "3px 3px 0 0" }}
                              />
                            </div>
                            <div className="col-chart-label">{d.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="col-chart-x-label">{xLabel}</div>
                  <div className="col-chart-legend">
                    <span><span className="col-chart-legend-dot" style={{ background: stackedColorA }} />{stackedLegendA}</span>
                    <span><span className="col-chart-legend-dot" style={{ background: stackedColorB }} />{stackedLegendB}</span>
                  </div>
                </div>
              );
            })()
          ) : (
            <ColumnChart
              data={simpleBarData}
              maxValue={simpleMaxVal}
              color="teal"
              formatValue={simpleFormat}
              xLabel={xLabel}
            />
          )}
        </div>
      )}

      {(breakdownView === "tenure" || breakdownView === "hh_type") && baselineView !== "net_income" && (
        <div className="chart-wrapper" style={{ marginTop: 32 }}>
          <div className="chart-header">
            <div>
              <div className="chart-title">Figure 2: Fuel poverty rate</div>
              <div className="chart-subtitle">% of households spending &gt;10% of income on energy</div>
            </div>
          </div>
          <ColumnChart
            data={breakdownView === "hh_type"
              ? hhTypeData.map((h) => ({ label: HH_TYPE_LABELS[h.hh_type] || h.hh_type, value: h.fuel_poverty_pct }))
              : tenureData.map((t) => ({ label: TENURE_LABELS[t.tenure] || t.tenure, value: t.fuel_poverty_pct }))
            }
            maxValue={Math.max(...(breakdownView === "hh_type" ? hhTypeData : tenureData).map((d) => d.fuel_poverty_pct)) * 1.2}
            colorFn={() => "#ef4444"}
            formatValue={(v) => `${v}%`}
          />
        </div>
      )}

      <p className="section-description">
        Decile 1 households spend {baseline.deciles[0].energy_share_pct}% of
        net income on energy. Decile 10 households
        spend {baseline.deciles[9].energy_share_pct}%.
        Gas accounts for {(100 - split.elec_share_pct).toFixed(0)}% of energy
        spending but drives most price volatility. The next section models
        what happens when prices rise.
      </p>
    </section>
  );
}

function ShockSection() {
  const [selected, setSelected] = useState(0);
  const [shockMetric, setShockMetric] = useState("pct_of_income");
  const [shockResponse, setShockResponse] = useState("behavioural");
  const [shockBreakdown, setShockBreakdown] = useState("decile");
  const scenario = results.shock_scenarios[selected];
  const behav = results.behavioral[selected];

  const TENURE_LABELS = {
    OWNED_OUTRIGHT: "Owned outright", OWNED_WITH_MORTGAGE: "Mortgage",
    RENT_PRIVATELY: "Private rent", RENT_FROM_COUNCIL: "Council rent", RENT_FROM_HA: "Housing assoc.",
  };
  const HH_TYPE_LABELS = {
    SINGLE_PENSIONER: "Single pensioner", COUPLE_PENSIONER: "Couple pensioner",
    SINGLE_WORKING_AGE: "Single (WA)", COUPLE_NO_CHILDREN: "Couple, no kids",
    COUPLE_WITH_CHILDREN: "Couple + kids", LONE_PARENT: "Lone parent", OTHER: "Other",
  };
  // Build bar data based on breakdown
  const isPct = shockMetric === "pct_of_income" || shockMetric === "fp_rate";

  // Helper to pick the right static/behavioral field from a row
  const getStaticVal = (d) => {
    if (shockMetric === "pct_of_income") return d.pct_of_income;
    if (shockMetric === "extra_cost") return d.extra_cost;
    if (shockMetric === "fp_rate") return d.fp_rate;
    if (shockMetric === "fp_households") return d.fp_households_m;
    return 0;
  };
  const getBehavVal = (bd) => {
    if (!bd) return 0;
    if (shockMetric === "pct_of_income") return bd.behavioral_pct_of_income;
    if (shockMetric === "extra_cost") return bd.behavioral_extra_cost;
    if (shockMetric === "fp_rate") return bd.behavioral_fp_rate;
    if (shockMetric === "fp_households") return bd.behavioral_fp_households_m;
    return 0;
  };

  let barData, xLabel;
  if (shockBreakdown === "decile") {
    xLabel = "Decile";
    barData = scenario.deciles.map((d, i) => {
      const bd = behav.deciles[i];
      return {
        label: `${d.decile}`,
        staticVal: getStaticVal(d),
        behavVal: getBehavVal(bd),
      };
    });
  } else if (shockBreakdown === "tenure") {
    xLabel = "Tenure";
    barData = scenario.by_tenure.map((d) => {
      const bd = behav.by_tenure.find((b) => b.tenure === d.tenure);
      return {
        label: TENURE_LABELS[d.tenure] || d.tenure,
        staticVal: getStaticVal(d),
        behavVal: getBehavVal(bd),
      };
    });
  } else if (shockBreakdown === "hh_type") {
    xLabel = "Household type";
    barData = scenario.by_hh_type.map((d) => {
      const bd = behav.by_hh_type.find((b) => b.hh_type === d.hh_type);
      return {
        label: HH_TYPE_LABELS[d.hh_type] || d.hh_type,
        staticVal: getStaticVal(d),
        behavVal: getBehavVal(bd),
      };
    });
  }

  // Sort non-decile breakdowns by static value descending
  if (shockBreakdown !== "decile" && shockBreakdown !== "constituency") {
    barData.sort((a, b) => b.staticVal - a.staticVal);
  }

  return (
    <section className="section" id="shocks">
      <h2 className="section-title">Price shock scenarios</h2>
      <p className="section-description">
        Given the baseline distribution above, we model five scenarios in
        which the Ofgem price cap rises by a given percentage from the
        current level of £1,641. Gas accounts for {(100 - resultsV2.energy_split.elec_share_pct).toFixed(0)}% of
        household energy spending and gas-fired power stations set electricity
        prices, so wholesale gas price shocks feed through to the cap and
        to all household bills.
      </p>
      <div className="chart-title" style={{ marginBottom: 8 }}>Table 1: Price shock scenarios</div>
      <table className="scenario-table">
        <thead>
          <tr>
            <th>Scenario</th>
            <th>New cap</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>+10%</td><td>£1,805</td></tr>
          <tr><td>+20%</td><td>£1,969</td></tr>
          <tr><td>+30%</td><td>£2,133</td></tr>
          <tr><td>+60%</td><td>£2,625</td></tr>
          <tr><td>2022-level</td><td>£3,764</td></tr>
        </tbody>
      </table>
      <h3 className="section-title" style={{ fontSize: "1.1rem", marginTop: 32 }}>Behavioural response</h3>
      <p className="section-description">
        All charts include a <strong>static</strong> estimate (no change in
        consumption) and a <strong>behavioural</strong> estimate (households
        reduce usage when prices rise). The behavioural estimate applies a
        short-run price elasticity of −0.15, the overall energy average
        from a meta-analysis of 428 studies (<a href="#ref-labandeira">Labandeira,
        Labeaga and López-Otero, 2017</a>). Elasticities vary by
        income: <a href="#ref-priesmann">Priesmann and Praktiknjo (2025)</a> report
        short-run gas price elasticities from −0.64 (low-income) to −0.11
        (high-income). Reduced consumption lowers bills but also reduces
        comfort and warmth.
      </p>

      <h3 className="section-title" style={{ fontSize: "1.1rem", marginTop: 32 }}>Fuel poverty</h3>
      <p className="section-description">
        A household is fuel poor if it spends more than 10% of its net income
        on energy. The official UK definition
        (LILEE)<a href="#fn-8"><sup>8</sup></a> is more complex, but the 10%
        threshold captures the same dynamic and is straightforward to apply
        across the income distribution. Use the "FP rate (%)" and "FP
        households (m)" metric toggles below to see how each scenario pushes
        households into fuel poverty. At current prices,{" "}
        {results.fuel_poverty[0].households_m}m households
        ({results.fuel_poverty[0].fuel_poverty_rate_pct}%) are fuel poor. Even
        a modest +10% shock pushes the rate
        to {results.fuel_poverty[1].fuel_poverty_rate_pct}%
        ({results.fuel_poverty[1].households_m}m). At the 2022-level, the
        static rate
        reaches {results.fuel_poverty[results.fuel_poverty.length - 1].fuel_poverty_rate_pct}%
        ({results.fuel_poverty[results.fuel_poverty.length - 1].households_m}m).
        Demand response lowers these figures but cannot prevent a large rise in
        fuel poverty. The distributional pattern is stark: fuel poverty is
        concentrated among low-income deciles, private renters, single
        pensioners and lone parents.
      </p>

      <div className="pill-row">
        <span className="pill-row-label">SCENARIO</span>
        <div className="scenario-pills">
          {results.shock_scenarios.map((s, i) => (
            <button
              key={i}
              className={`scenario-pill${i === selected ? " active" : ""}`}
              onClick={() => setSelected(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">METRIC</span>
        <div className="scenario-pills">
          {[
            { key: "pct_of_income", label: "% of income" },
            { key: "extra_cost", label: "Extra cost (£/yr)" },
            { key: "fp_rate", label: "FP rate (%)" },
            { key: "fp_households", label: "FP households (m)" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${shockMetric === m.key ? " active" : ""}`} onClick={() => setShockMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">RESPONSE</span>
        <div className="scenario-pills">
          {[
            { key: "behavioural", label: "Behavioural" },
            { key: "static", label: "Static" },
            { key: "both", label: "Both" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${shockResponse === m.key ? " active" : ""}`} onClick={() => setShockResponse(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row" style={{ justifyContent: "center" }}>
        <span className="pill-row-label">BREAKDOWN</span>
        <div className="scenario-pills">
          {[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
            { key: "constituency", label: "By constituency" },
          ].map((v) => (
            <button key={v.key} className={`scenario-pill${shockBreakdown === v.key ? " active" : ""}`} onClick={() => setShockBreakdown(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="New price cap" value={fmt(scenario.new_cap)} unit="/yr" color="teal" info="The Ofgem price cap after the shock is applied. This is the cap level that determines household bills." />
        <KpiCard label="Static avg hit" value={fmt(scenario.avg_hh_hit_yr)} unit="/yr" info="Average extra annual cost per household assuming no change in energy consumption (static estimate)." />
        <KpiCard label="Behavioural avg hit" value={fmt(behav.behavioral_avg_extra)} unit="/yr" color="teal" info="Average extra annual cost after households reduce consumption in response to higher prices (elasticity = -0.15)." />
        <KpiCard label="Consumption change" value={`${behav.consumption_change_pct}%`} info="Percentage reduction in energy consumption due to the price increase, based on a short-run price elasticity of -0.15." />
      </div>

      {shockBreakdown === "constituency" ? (() => {
        // Map scenario name to constituency data key suffix
        const SCENARIO_KEY_MAP = { "+10%": "plus_10pct", "+20%": "plus_20pct", "+30%": "plus_30pct", "+60%": "plus_60pct", "2022-level": "2022_level" };
        const suffix = SCENARIO_KEY_MAP[scenario.name] || "plus_10pct";
        const useBehav = shockResponse === "behavioural";
        let constMetricKey, constLabel;
        const responseLabel = useBehav ? "behavioural" : "static";
        if (shockMetric === "fp_rate" || shockMetric === "fp_households") {
          // Constituency data only has static FP rate (no behavioural or household counts)
          constMetricKey = `fp_pct_${suffix}`;
          constLabel = `Fuel poverty rate %: ${scenario.name}`;
        } else {
          const costPrefix = useBehav ? "behav_cost" : "extra_cost";
          const pctPrefix = useBehav ? "behav_pct" : "extra_pct";
          constMetricKey = shockMetric === "pct_of_income" ? `${pctPrefix}_${suffix}` : `${costPrefix}_${suffix}`;
          constLabel = shockMetric === "pct_of_income"
            ? `Extra cost as % of income (${responseLabel}): ${scenario.name}`
            : `Extra cost £ (${responseLabel}): ${scenario.name}`;
        }
        return (
          <div className="chart-wrapper">
            <div className="chart-header">
              <div>
                <div className="chart-title">Figure 3: Shock impact</div>
                <div className="chart-subtitle">Search or hover to explore 650 constituencies</div>
              </div>
            </div>
            <ConstituencyMap data={constituencyData} customMetricKey={constMetricKey} customLabel={constLabel} />
          </div>
        );
      })() : (
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <div className="chart-title">
                {"Figure 3: Shock impact"}
              </div>
              <div className="chart-subtitle">
                {shockResponse === "both" ? "Static vs behavioural (ε = −0.15)"
                  : shockResponse === "static" ? "Static (no demand response)"
                  : "Behavioural (ε = −0.15)"}
              </div>
            </div>
          </div>
          {(() => {
            const showStatic = shockResponse === "static" || shockResponse === "both";
            const showBehav = shockResponse === "behavioural" || shockResponse === "both";
            const showBoth = showStatic && showBehav;
            const maxVal = Math.max(...barData.map((d) => Math.max(
              showStatic ? d.staticVal : 0,
              showBehav ? d.behavVal : 0
            ))) * 1.15;
            const ticks = niceTicks(maxVal);
            const topTick = ticks[ticks.length - 1] || maxVal;
            const effectiveMax = Math.max(maxVal, topTick);
            const fmtVal = shockMetric === "pct_of_income" ? (v) => `${v}%`
              : shockMetric === "fp_rate" ? (v) => `${v}%`
              : shockMetric === "fp_households" ? (v) => `${v}m`
              : (v) => fmt(v);
            return (
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>
                        {fmtVal(t)}
                      </div>
                    ))}
                  </div>
                  <div className="col-chart-area">
                    {ticks.map((t, i) => (
                      <div className="col-chart-gridline" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }} />
                    ))}
                    <div className="col-chart-bars">
                      {barData.map((d, i) => (
                        <div className="col-chart-col" key={i}>
                          <div className="col-chart-tooltip">
                            {showBoth
                              ? `Static: ${fmtVal(d.staticVal)}, Behavioural: ${fmtVal(d.behavVal)}`
                              : showStatic ? `Static: ${fmtVal(d.staticVal)}`
                              : `Behavioural: ${fmtVal(d.behavVal)}`}
                          </div>
                          {showBoth ? (
                            <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                              <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: "#94a3b8", borderRadius: "3px 3px 0 0" }} />
                              <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#319795", borderRadius: "3px 3px 0 0" }} />
                            </div>
                          ) : (
                            <div className="col-chart-track">
                              <div className="col-chart-fill" style={{
                                height: `${((showStatic ? d.staticVal : d.behavVal) / effectiveMax) * 100}%`,
                                background: showStatic ? "#94a3b8" : "#319795",
                                borderRadius: "3px 3px 0 0",
                              }} />
                            </div>
                          )}
                          <div className="col-chart-label">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="col-chart-legend">
                  {showStatic && <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>}
                  {showBehav && <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <p className="section-description">
        Under the {scenario.name} scenario, demand response reduces the average
        extra cost from {fmt(scenario.avg_hh_hit_yr)}/yr to{" "}
        {fmt(behav.behavioral_avg_extra)}/yr, a saving of{" "}
        {fmt(scenario.avg_hh_hit_yr - behav.behavioral_avg_extra)}/yr.
        The next section evaluates policy tools that could offset these costs.
      </p>
    </section>
  );
}




function PolicyNetSection() {
  const { policies } = results;
  const EPG_TARGET = 2500;
  const EPG_REF_CAP = 2625;
  const nHH = results.baseline.n_households_m;
  const neg = resultsV2.neg_policy;
  const rbt = resultsV2.rising_block_tariff;
  const policyKeys = ["flat_transfer", "ct_rebate", "bn_transfer", "bn_epg", "neg"];
  const policyLabels = {
    flat_transfer: "A. Flat transfer", ct_rebate: "B. CT rebate",
    bn_transfer: "C. BN transfer", bn_epg: "D. BN EPG",
    neg: "E. Energy Guarantee",
  };
  const TENURE_LABELS = {
    OWNED_OUTRIGHT: "Owned outright", OWNED_WITH_MORTGAGE: "Mortgage",
    RENT_PRIVATELY: "Private rent", RENT_FROM_COUNCIL: "Council rent", RENT_FROM_HA: "Housing assoc.",
  };
  const HH_TYPE_LABELS = {
    SINGLE_PENSIONER: "Single pensioner", COUPLE_PENSIONER: "Couple pensioner",
    SINGLE_WORKING_AGE: "Single (WA)", COUPLE_NO_CHILDREN: "Couple, no kids",
    COUPLE_WITH_CHILDREN: "Couple + kids", LONE_PARENT: "Lone parent", OTHER: "Other",
  };
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [selectedNet, setSelectedNet] = useState("flat_transfer");
  const [policyMetric, setPolicyMetric] = useState("extra_cost");
  const [policyResponse, setPolicyResponse] = useState("behavioural");
  const [policyBreakdown, setPolicyBreakdown] = useState("decile");

  const isNoShock = selectedScenario === -1;
  const scenario = isNoShock ? null : results.shock_scenarios[selectedScenario];
  const behav = isNoShock ? null : results.behavioral[selectedScenario];
  const scenarioName = isNoShock ? "0%" : scenario.name;
  const isAlt = selectedNet === "neg";
  const bk = policyBreakdown;
  const isFPMetric = policyMetric === "fp_rate" || policyMetric === "fp_households";

  // Metric helpers (for shock data on any breakdown)
  const getStaticVal = (d) => {
    if (policyMetric === "extra_cost") return d.extra_cost;
    if (policyMetric === "pct_of_income") return d.pct_of_income;
    if (policyMetric === "fp_rate") return d.fp_rate;
    if (policyMetric === "fp_households") return d.fp_households_m;
    return 0;
  };
  const getBehavVal = (d) => {
    if (!d) return 0;
    if (policyMetric === "extra_cost") return d.behavioral_extra_cost;
    if (policyMetric === "pct_of_income") return d.behavioral_pct_of_income;
    if (policyMetric === "fp_rate") return d.behavioral_fp_rate;
    if (policyMetric === "fp_households") return d.behavioral_fp_households_m;
    return 0;
  };
  const fmtMetric = policyMetric === "extra_cost" ? (v) => fmt(v)
    : policyMetric === "pct_of_income" ? (v) => `${v}%`
    : policyMetric === "fp_rate" ? (v) => `${v}%`
    : (v) => `${v}m`;

  // === KPI computation (independent of breakdown) ===
  let avgBenefit = 0, exchequerCost = 0;
  if (isNoShock) {
    if (selectedNet === "neg") { avgBenefit = neg.avg_benefit_baseline; exchequerCost = neg.baseline_cost_bn; }
    else if (selectedNet === "rbt") { avgBenefit = 0; exchequerCost = 0; }
    else if (!["bn_transfer", "bn_epg"].includes(selectedNet)) {
      const p = policies[selectedNet]; avgBenefit = p.avg_hh_benefit; exchequerCost = p.exchequer_cost_bn;
    }
  } else {
    if (selectedNet === "bn_transfer") { avgBenefit = scenario.avg_hh_hit_yr; exchequerCost = Math.round(scenario.avg_hh_hit_yr * nHH / 100) / 10; }
    else if (selectedNet === "bn_epg") { avgBenefit = scenario.avg_hh_hit_yr; exchequerCost = scenario.total_cost_bn; }
    else if (selectedNet === "neg") { const s = neg.scenarios[selectedScenario]; avgBenefit = s.avg_benefit; exchequerCost = s.exchequer_cost_bn; }
    else if (selectedNet === "rbt") { avgBenefit = 0; exchequerCost = 0; }
    else {
      const p = policies[selectedNet];
      const epgScale = selectedNet === "epg" ? Math.max(0, scenario.new_cap - EPG_TARGET) / (EPG_REF_CAP - EPG_TARGET) : 1;
      avgBenefit = selectedNet === "epg" ? Math.round(p.avg_hh_benefit * epgScale) : p.avg_hh_benefit;
      exchequerCost = selectedNet === "epg" ? Math.round(p.exchequer_cost_bn * epgScale * 10) / 10 : p.exchequer_cost_bn;
    }
  }
  const avgStaticShock = isNoShock ? 0 : scenario.avg_hh_hit_yr;
  const avgBehavShock = isNoShock ? 0 : behav.behavioral_avg_extra;

  // === Chart data computation ===
  let barData, xLabel;
  // chartMode: "standard" = static/behav bars, "neg"/"rbt" = special, "benefit" = simple bars, "message" = text, "constituency" = map
  let chartMode = "standard";
  let chartMessage = "";

  if (isNoShock && bk !== "decile") {
    chartMode = "message";
    chartMessage = "Select a shock scenario to see the impact by " + (bk === "tenure" ? "tenure" : bk === "hh_type" ? "household type" : "constituency") + ".";
  } else if (isNoShock) {
    // decile + no shock
    xLabel = "Decile";
    if (["bn_transfer", "bn_epg"].includes(selectedNet)) {
      chartMode = "message";
      chartMessage = "Budget-neutral policies only activate when there is a price shock.";
    } else if (selectedNet === "neg") {
      chartMode = "benefit";
      barData = neg.deciles_baseline.map((d) => ({ label: `${d.decile}`, value: d.benefit, staticVal: d.benefit, behavVal: d.benefit }));
    } else if (selectedNet === "rbt") {
      chartMode = "rbt";
      barData = rbt.deciles.map((d) => ({ label: `${d.decile}`, value: d.net_effect }));
    } else {
      chartMode = "benefit";
      const p = policies[selectedNet];
      barData = p.deciles.map((d) => ({ label: `${d.decile}`, value: d.payment, staticVal: d.payment, behavVal: d.payment }));
    }
  } else if (bk === "constituency") {
    chartMode = "constituency";
  } else if (bk === "decile") {
    // Decile with shock — all policies
    xLabel = "Decile";
    if (isFPMetric) {
      // Post-policy FP change: difference between shock FP and post-policy FP
      const pfp = results.policy_fuel_poverty?.[selectedNet]?.[selectedScenario];
      if (pfp) {
        barData = pfp.deciles.map((d, i) => {
          const shockS = policyMetric === "fp_rate" ? scenario.deciles[i].fp_rate : scenario.deciles[i].fp_households_m;
          const shockB = policyMetric === "fp_rate" ? behav.deciles[i].behavioral_fp_rate : behav.deciles[i].behavioral_fp_households_m;
          const postS = policyMetric === "fp_rate" ? d.fp_rate : d.fp_households_m;
          const postB = policyMetric === "fp_rate" ? d.behavioral_fp_rate : d.behavioral_fp_households_m;
          return { label: `${d.decile}`, staticVal: +(shockS - postS).toFixed(2), behavVal: +(shockB - postB).toFixed(2) };
        });
      } else {
        barData = scenario.deciles.map((d) => ({ label: `${d.decile}`, staticVal: 0, behavVal: 0 }));
      }
    } else if (isAlt && policyMetric === "extra_cost") {
      // Alt policies with extra_cost: show special charts
      if (selectedNet === "neg") {
        chartMode = "neg";
        const scen = neg.scenarios[selectedScenario];
        barData = scen.deciles.map((d, i) => ({
          label: `${d.decile}`,
          benefit: d.benefit_extra_vs_baseline,
          shockStatic: d.shock_extra,
          shockBehav: behav.deciles[i].behavioral_extra_cost,
        }));
      } else if (selectedNet === "rbt") {
        chartMode = "rbt";
        barData = rbt.deciles.map((d) => ({ label: `${d.decile}`, value: d.net_effect }));
      }
    } else if (isAlt && policyMetric === "pct_of_income") {
      // Alt policies with pct_of_income: compute remaining % of income
      if (selectedNet === "neg") {
        const scen = neg.scenarios[selectedScenario];
        barData = scen.deciles.map((d, i) => {
          const income = results.baseline.deciles[i].net_income;
          const sr = Math.max(0, d.shock_extra - d.benefit_extra_vs_baseline);
          return { label: `${d.decile}`, staticVal: income > 0 ? +((sr / income * 100).toFixed(2)) : 0, behavVal: income > 0 ? +((sr / income * 100).toFixed(2)) : 0 };
        });
      } else if (selectedNet === "rbt") {
        barData = rbt.deciles.map((d, i) => {
          const income = results.baseline.deciles[i].net_income;
          return { label: `${d.decile}`, staticVal: income > 0 ? +((d.net_effect / income * 100).toFixed(2)) : 0, behavVal: income > 0 ? +((d.net_effect / income * 100).toFixed(2)) : 0 };
        });
      }
    } else {
      // Standard policies (A-E) with extra_cost or pct_of_income
      const epgScale = selectedNet === "epg" ? Math.max(0, scenario.new_cap - EPG_TARGET) / (EPG_REF_CAP - EPG_TARGET) : 1;
      barData = scenario.deciles.map((d, i) => {
        let payment;
        if (selectedNet === "bn_transfer") payment = scenario.avg_hh_hit_yr;
        else if (selectedNet === "bn_epg") payment = d.extra_cost;
        else {
          const pd = policies[selectedNet].deciles[i];
          payment = selectedNet === "epg" ? Math.round(pd.payment * epgScale) : pd.payment;
        }
        const sr = Math.max(0, d.extra_cost - payment);
        const br = Math.max(0, behav.deciles[i].behavioral_extra_cost - payment);
        if (policyMetric === "pct_of_income") {
          const income = results.baseline.deciles[i].net_income;
          return { label: `${d.decile}`, staticVal: income > 0 ? +((sr / income * 100).toFixed(2)) : 0, behavVal: income > 0 ? +((br / income * 100).toFixed(2)) : 0 };
        }
        return { label: `${d.decile}`, staticVal: sr, behavVal: br };
      });
    }
  } else if (selectedNet === "bn_epg" && !isFPMetric) {
    // BN EPG fully offsets every household, so all breakdowns show £0
    chartMode = "message";
    chartMessage = `The ${policyLabels[selectedNet]} fully offsets the ${scenarioName} shock for all households. Every household's net extra cost is £0.`;
  } else {
    // Non-decile breakdowns (tenure, hh_type) with shock: policy-adjusted data not available
    chartMode = "message";
    const breakdownLabel = bk === "tenure" ? "tenure" : bk === "hh_type" ? "household type" : "constituency";
    chartMessage = `Post-policy breakdown by ${breakdownLabel} is not available. Select "By decile" to see the policy effect.`;
  }

  // Determine chart title/subtitle for "standard" mode
  const metricLabelShort = policyMetric === "extra_cost" ? "extra cost (£/yr)"
    : policyMetric === "pct_of_income" ? "extra cost as % of income"
    : policyMetric === "fp_rate" ? "fuel poverty rate (%)"
    : "fuel poor households (millions)";

  const showStatic = policyResponse === "static" || policyResponse === "both";
  const showBehav = policyResponse === "behavioural" || policyResponse === "both";
  const showBoth = showStatic && showBehav;
  const responseSubtitle = showBoth ? "Static vs behavioural (ε = −0.15)"
    : policyResponse === "static" ? "Static (no demand response)"
    : "Behavioural (ε = −0.15)";

  return (
    <section className="section" id="policy-net">
      <h2 className="section-title">Policy responses</h2>
      <p className="section-description">
        Policies A and B reflect the toolkit the UK government deployed
        during the 2022 energy crisis<a href="#fn-10"><sup>10</sup></a> and
        are the instruments available in
        the <a href="https://policyengine.org/uk" target="_blank" rel="noopener noreferrer">PolicyEngine UK</a> microsimulation
        model. Policies C and D are <strong>budget-neutral</strong> variants
        designed to fully offset the extra cost so that households are no
        worse off on average. Policy E is an <strong>alternative
        design</strong> that exploits the new electricity/gas data split,
        responding to <a href="#ref-bangham">Bangham's (2026)</a> call for
        better infrastructure built before the next price cap change.
        All estimates are for the 2026-27 fiscal year. Select a scenario and policy to explore the distributional effects.
      </p>

      <ul className="policy-bullet-list">
        {policyKeys.map((key) => (
          <li key={key}>
            <strong>{POLICY_META[key].letter}. {POLICY_META[key].fullName}</strong>{" "}
            {POLICY_META[key].description}
          </li>
        ))}
      </ul>

      <div className="pill-row">
        <span className="pill-row-label">SCENARIO</span>
        <div className="scenario-pills">
          {results.shock_scenarios.map((s, i) => (
            <button key={i} className={`scenario-pill scenario-pill-sm${i === selectedScenario ? " active" : ""}`} onClick={() => setSelectedScenario(i)}>{s.name}</button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">POLICY</span>
        <div className="scenario-pills">
          {policyKeys.map((key) => (
            <button key={key} className={`scenario-pill${selectedNet === key ? " active" : ""}`} onClick={() => setSelectedNet(key)}>{policyLabels[key]}</button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">METRIC</span>
        <div className="scenario-pills">
          {[
            { key: "extra_cost", label: "Extra cost (£/yr)" },
            { key: "pct_of_income", label: "% of income" },
            { key: "fp_rate", label: "FP rate change (pp)" },
            { key: "fp_households", label: "FP households change (m)" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${policyMetric === m.key ? " active" : ""}`} onClick={() => setPolicyMetric(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">RESPONSE</span>
        <div className="scenario-pills">
          {[
            { key: "behavioural", label: "Behavioural" },
            { key: "static", label: "Static" },
            { key: "both", label: "Both" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${policyResponse === m.key ? " active" : ""}`} onClick={() => setPolicyResponse(m.key)}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="pill-row" style={{ justifyContent: "center" }}>
        <span className="pill-row-label">BREAKDOWN</span>
        <div className="scenario-pills">
          {[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
            { key: "constituency", label: "By constituency" },
          ].map((v) => (
            <button key={v.key} className={`scenario-pill${bk === v.key ? " active" : ""}`} onClick={() => setPolicyBreakdown(v.key)}>{v.label}</button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      {selectedNet === "neg" && !isNoShock && (() => {
        const scen = neg.scenarios[selectedScenario];
        return (
          <div className="kpi-row">
            <KpiCard label="Threshold" value={`${neg.threshold_kwh.toLocaleString()} kWh`} info="Energy consumption threshold below which all usage is subsidised at the pre-shock price. Set at the median household level." />
            <KpiCard label="Threshold (£)" value={fmt(neg.threshold_spend)} unit="/yr" info="The annual energy bill corresponding to the kWh threshold at current prices." />
            <KpiCard label="Exchequer cost" value={fmtBn(scen.exchequer_cost_bn)} info="Total annual cost to the government of subsidising below-threshold consumption for all households." />
            <KpiCard label="Avg benefit" value={fmt(scen.avg_benefit)} unit="/yr" color="teal" info="Average annual subsidy received per household under the National Energy Guarantee." />
          </div>
        );
      })()}
      {selectedNet === "rbt" && (
        <div className="kpi-row">
          <KpiCard label="Block 1 discount" value={`${rbt.discount_rate_pct}%`} info="Percentage discount applied to energy consumption below the block threshold. Reduces bills for low users." />
          <KpiCard label="Block 2 surcharge" value={`${rbt.surcharge_rate_pct}%`} info="Percentage surcharge applied to energy consumption above the block threshold. Funds the Block 1 discount." />
          <KpiCard label="Exchequer cost" value="£0" info="The rising block tariff is revenue-neutral by design: surcharges on high users fund discounts for low users. No government spending required." />
          <KpiCard label="Redistribution" value={fmtBn(rbt.total_subsidy_bn)} info="Total annual value transferred from high-consuming to low-consuming households through the block tariff structure." />
        </div>
      )}
      {!isAlt && (
        <div className="kpi-row">
          <KpiCard label="Avg extra cost" value={fmt(avgStaticShock)} unit="/yr" info="Average annual extra energy cost per household under the selected shock scenario, before any policy intervention (static estimate)." />
          <KpiCard label="Policy benefit" value={fmt(avgBenefit)} unit="/yr" color="teal" info="Average annual payment or subsidy each household receives from the selected policy. For budget-neutral policies this equals the average shock." />
          <KpiCard label="Net cost" value={fmt(Math.max(0, avgBehavShock - avgBenefit))} unit="/yr" info="Average remaining cost per household after the policy benefit and behavioural demand response are accounted for. Zero means the policy fully offsets the shock." />
          <KpiCard label="Exchequer cost" value={fmtBn(exchequerCost)} info="Total annual cost to the government of funding this policy across all UK households." />
        </div>
      )}

      {/* ── Chart rendering ── */}
      {(() => {
        // Message mode
        if (chartMode === "message") {
          return (
            <div className="chart-wrapper" style={{ textAlign: "center", padding: "40px 24px" }}>
              <p className="section-description" style={{ color: "#64748b", marginBottom: 0 }}>{chartMessage} Select a scenario above to see the policy effect.</p>
            </div>
          );
        }

        // Benefit mode (no-shock, simple bars)
        if (chartMode === "benefit") {
          return (
            <div className="chart-wrapper">
              <div className="chart-header">
                <div>
                  <div className="chart-title">Figure 4: Policy effect</div>
                  <div className="chart-subtitle">Annual £ received per household</div>
                </div>
              </div>
              <ColumnChart data={barData} maxValue={Math.max(...barData.map((d) => d.staticVal)) * 1.15} color="teal" formatValue={(v) => fmt(v)} xLabel="Decile" />
            </div>
          );
        }

        // RBT net effect
        if (chartMode === "rbt") {
          const absMax = Math.max(...barData.map((d) => Math.abs(d.value))) * 1.15;
          const ticks = niceTicks(absMax);
          const topTick = ticks[ticks.length - 1] || absMax;
          const effectiveMax = Math.max(absMax, topTick);
          return (
            <div className="chart-wrapper">
              <div className="chart-header">
                <div>
                  <div className="chart-title">Figure 4: Policy effect</div>
                  <div className="chart-subtitle">{isNoShock ? "Negative = saves, positive = pays more" : "Redistribution is independent of the shock"}</div>
                </div>
              </div>
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{fmt(t)}</div>
                    ))}
                  </div>
                  <div className="col-chart-area">
                    {ticks.map((t, i) => (<div className="col-chart-gridline" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }} />))}
                    <div className="col-chart-bars">
                      {barData.map((d, i) => (
                        <div className="col-chart-col" key={i}>
                          <div className="col-chart-tooltip">Net: {d.value >= 0 ? "+" : ""}{fmt(d.value)}/yr</div>
                          <div className="col-chart-track">
                            <div className="col-chart-fill" style={{ height: `${(Math.abs(d.value) / effectiveMax) * 100}%`, background: d.value <= 0 ? "#10b981" : "#ef4444", borderRadius: "3px 3px 0 0" }} />
                          </div>
                          <div className="col-chart-label">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="col-chart-x-label">Decile</div>
                <div className="col-chart-legend">
                  <span><span className="col-chart-legend-dot" style={{ background: "#10b981" }} />Saves</span>
                  <span><span className="col-chart-legend-dot" style={{ background: "#ef4444" }} />Pays more</span>
                </div>
              </div>
            </div>
          );
        }

        // NEG benefit vs shock
        if (chartMode === "neg") {
          const shockVal = (d) => showStatic ? d.shockStatic : d.shockBehav;
          const maxVal = Math.max(...barData.map((d) => Math.max(d.benefit, showBoth ? Math.max(d.shockStatic, d.shockBehav) : shockVal(d)))) * 1.15;
          const ticks = niceTicks(maxVal);
          const topTick = ticks[ticks.length - 1] || maxVal;
          const effectiveMax = Math.max(maxVal, topTick);
          return (
            <div className="chart-wrapper">
              <div className="chart-header">
                <div>
                  <div className="chart-title">Figure 4: Policy effect</div>
                  <div className="chart-subtitle">Annual £ per household</div>
                </div>
              </div>
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{fmt(t)}</div>
                    ))}
                  </div>
                  <div className="col-chart-area">
                    {ticks.map((t, i) => (<div className="col-chart-gridline" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }} />))}
                    <div className="col-chart-bars">
                      {barData.map((d, i) => {
                        const shock = showBoth ? null : shockVal(d);
                        return (
                          <div className="col-chart-col" key={i}>
                            <div className="col-chart-tooltip">
                              NEG benefit: {fmt(d.benefit)}
                              {showBoth
                                ? `, Shock (static): ${fmt(d.shockStatic)}, Shock (behav): ${fmt(d.shockBehav)}`
                                : `, Shock: ${fmt(shock)}`}
                            </div>
                            <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                              <div className="col-chart-fill" style={{ height: `${(d.benefit / effectiveMax) * 100}%`, width: showBoth ? "32%" : "48%", background: "#10b981", borderRadius: "3px 3px 0 0" }} />
                              {showStatic && <div className="col-chart-fill" style={{ height: `${(d.shockStatic / effectiveMax) * 100}%`, width: showBoth ? "32%" : "48%", background: "#ef4444", borderRadius: "3px 3px 0 0" }} />}
                              {showBehav && !showStatic && <div className="col-chart-fill" style={{ height: `${(d.shockBehav / effectiveMax) * 100}%`, width: "48%", background: "#f97316", borderRadius: "3px 3px 0 0" }} />}
                              {showBoth && <div className="col-chart-fill" style={{ height: `${(d.shockBehav / effectiveMax) * 100}%`, width: "32%", background: "#f97316", borderRadius: "3px 3px 0 0" }} />}
                            </div>
                            <div className="col-chart-label">{d.label}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="col-chart-x-label">Decile</div>
                <div className="col-chart-legend">
                  <span><span className="col-chart-legend-dot" style={{ background: "#10b981" }} />NEG benefit</span>
                  {showStatic && <span><span className="col-chart-legend-dot" style={{ background: "#ef4444" }} />{showBoth ? "Shock (static)" : "Shock cost"}</span>}
                  {showBehav && <span><span className="col-chart-legend-dot" style={{ background: "#f97316" }} />{showBoth ? "Shock (behav)" : "Shock cost"}</span>}
                </div>
              </div>
            </div>
          );
        }

        // Constituency map
        if (chartMode === "constituency") {
          const SCENARIO_KEY_MAP = { "+10%": "plus_10pct", "+20%": "plus_20pct", "+30%": "plus_30pct", "+60%": "plus_60pct", "2022-level": "2022_level" };
          const suffix = SCENARIO_KEY_MAP[scenario.name] || "plus_10pct";
          const useBehav = policyResponse === "behavioural";
          let constMetricKey, constLabel;
          const responseLabel = useBehav ? "behavioural" : "static";
          if (policyMetric === "fp_rate" || policyMetric === "fp_households") {
            constMetricKey = `fp_pct_${suffix}`;
            constLabel = `Fuel poverty rate %: ${scenario.name}`;
          } else {
            const costPrefix = useBehav ? "behav_cost" : "extra_cost";
            const pctPrefix = useBehav ? "behav_pct" : "extra_pct";
            constMetricKey = policyMetric === "pct_of_income" ? `${pctPrefix}_${suffix}` : `${costPrefix}_${suffix}`;
            constLabel = policyMetric === "pct_of_income"
              ? `Extra cost as % of income (${responseLabel}): ${scenario.name}`
              : `Extra cost £ (${responseLabel}): ${scenario.name}`;
          }
          return (
            <div className="chart-wrapper">
              <div className="chart-header">
                <div>
                  <div className="chart-title">Figure 4: Policy effect</div>
                  <div className="chart-subtitle">Search or hover to explore 650 constituencies</div>
                </div>
              </div>
              <ConstituencyMap data={constituencyData} customMetricKey={constMetricKey} customLabel={constLabel} />
            </div>
          );
        }

        // Standard bar chart (remaining cost for A-F decile, or shock impact for non-decile / FP metrics)
        // Fully offset check
        if (barData && Math.max(...barData.map((d) => d.staticVal)) === 0 && Math.max(...barData.map((d) => d.behavVal)) === 0) {
          return (
            <div className="chart-wrapper" style={{ textAlign: "center", padding: "40px 24px" }}>
              <p className="section-description" style={{ color: "#319795", fontWeight: 500, marginBottom: 0 }}>
                The {policyLabels[selectedNet]} fully offsets the {scenarioName} shock for all deciles. Every household's net extra cost is £0.
              </p>
            </div>
          );
        }

        const isDecilePolicy = bk === "decile" && !isAlt && !isFPMetric;
        const isPostPolicyFP = bk === "decile" && isFPMetric && results.policy_fuel_poverty?.[selectedNet]?.[selectedScenario];
        const chartTitle = "Figure 4: Policy effect";

        const maxVal = Math.max(...barData.map((d) => Math.max(showStatic ? d.staticVal : 0, showBehav ? d.behavVal : 0))) * 1.15;
        const ticks = niceTicks(maxVal);
        const topTick = ticks[ticks.length - 1] || maxVal;
        const effectiveMax = Math.max(maxVal, topTick) || 10;

        // For FP change charts, use different format and green bars
        const fmtChart = isPostPolicyFP
          ? (policyMetric === "fp_rate" ? (v) => `${v}pp` : (v) => `${v}m`)
          : fmtMetric;
        const barColorStatic = isPostPolicyFP ? "#10b981" : "#94a3b8";
        const barColorBehav = isPostPolicyFP ? "#059669" : "#319795";

        return (
          <div className="chart-wrapper">
            <div className="chart-header">
              <div>
                <div className="chart-title">{chartTitle}</div>
                <div className="chart-subtitle">{isPostPolicyFP ? "Higher = larger reduction in fuel poverty" : responseSubtitle}</div>
              </div>
            </div>
            <div className="col-chart">
              <div className="col-chart-body">
                <div className="col-chart-y-axis">
                  {[...ticks].reverse().map((t, i) => (
                    <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{fmtChart(t)}</div>
                  ))}
                </div>
                <div className="col-chart-area">
                  {ticks.map((t, i) => (<div className="col-chart-gridline" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }} />))}
                  <div className="col-chart-bars">
                    {barData.map((d, i) => (
                      <div className="col-chart-col" key={i}>
                        <div className="col-chart-tooltip">
                          {showBoth
                            ? `Static: ${fmtChart(d.staticVal)}, Behavioural: ${fmtChart(d.behavVal)}`
                            : showStatic ? `Static: ${fmtChart(d.staticVal)}`
                            : `Behavioural: ${fmtChart(d.behavVal)}`}
                        </div>
                        {showBoth ? (
                          <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                            <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: barColorStatic, borderRadius: "3px 3px 0 0" }} />
                            <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: barColorBehav, borderRadius: "3px 3px 0 0" }} />
                          </div>
                        ) : (
                          <div className="col-chart-track">
                            <div className="col-chart-fill" style={{
                              height: `${((showStatic ? d.staticVal : d.behavVal) / effectiveMax) * 100}%`,
                              background: showStatic ? barColorStatic : barColorBehav,
                              borderRadius: "3px 3px 0 0",
                            }} />
                          </div>
                        )}
                        <div className="col-chart-label">{d.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {xLabel && <div className="col-chart-x-label">{xLabel}</div>}
              <div className="col-chart-legend">
                {showStatic && <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>}
                {showBehav && <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>}
              </div>
            </div>
          </div>
        );
      })()}

      <p className="section-description">
        Under the {scenarioName} scenario, the selected policy determines how
        much of the shock each decile absorbs. Budget-neutral policies
        fully offset the average hit but still leave some deciles worse off.
        Fixed-cost policies cover a larger share when the shock is
        milder. The National Energy Guarantee subsidises consumption below
        a threshold. Use the breakdown toggles to see how the shock distributes
        across tenure, household type and constituency.
      </p>
    </section>
  );
}



function PolicyComparisonSection() {
  const { policies } = results;
  const EPG_TARGET = 2500;
  const EPG_REF_CAP = 2625;
  const nHH = results.baseline.n_households_m;
  const neg = resultsV2.neg_policy;

  const policyKeys = ["flat_transfer", "ct_rebate", "bn_transfer", "bn_epg", "neg"];
  const policyLabels = {
    flat_transfer: "A. Flat transfer", ct_rebate: "B. CT rebate",
    bn_transfer: "C. BN transfer", bn_epg: "D. BN EPG",
    neg: "E. Energy Guarantee",
  };
  const policyBarLabels = {
    flat_transfer: "Flat transfer", ct_rebate: "CT rebate",
    bn_transfer: "BN transfer", bn_epg: "BN EPG", neg: "Energy Guarantee",
  };

  const [compScenario, setCompScenario] = useState(0);
  const [compMetric, setCompMetric] = useState("exchequer");
  const [compResponse, setCompResponse] = useState("behavioural");
  const showStatic = compResponse === "static" || compResponse === "both";
  const showBehav = compResponse === "behavioural" || compResponse === "both";
  const showBoth = compResponse === "both";

  const scenarios = results.shock_scenarios;
  const scenario = scenarios[compScenario];
  const scenarioName = scenario.name;

  // Compute exchequer cost for each policy at the selected scenario (static + behavioural)
  const behav = results.behavioral[compScenario];
  const behavRatio = behav.behavioral_avg_extra / (behav.static_avg_extra || 1);
  const getExchequer = (pk) => {
    let staticCost, behavCost;
    if (pk === "bn_transfer") {
      // Budget-neutral: pays the average hit, which differs under behavioural response
      staticCost = Math.round(scenario.avg_hh_hit_yr * nHH / 100) / 10;
      behavCost = Math.round(behav.behavioral_avg_extra * nHH / 100) / 10;
    } else if (pk === "bn_epg") {
      staticCost = scenario.total_cost_bn;
      behavCost = Math.round(staticCost * behavRatio * 10) / 10;
    } else if (pk === "neg") {
      staticCost = neg.scenarios[compScenario].exchequer_cost_bn;
      behavCost = Math.round(staticCost * behavRatio * 10) / 10;
    } else if (pk === "epg") {
      const epgScale = Math.max(0, scenario.new_cap - EPG_TARGET) / (EPG_REF_CAP - EPG_TARGET);
      staticCost = Math.round(policies[pk].exchequer_cost_bn * epgScale * 10) / 10;
      behavCost = Math.round(staticCost * behavRatio * 10) / 10;
    } else {
      // Fixed-amount policies (flat_transfer, ct_rebate): same cost regardless
      staticCost = policies[pk].exchequer_cost_bn;
      behavCost = staticCost;
    }
    return { staticVal: staticCost, behavVal: behavCost };
  };

  // Compute FP rate change and FP households change for each policy
  const shockFP = results.fuel_poverty[compScenario + 1]; // +1 because index 0 is baseline
  const getFPChange = (pk, metric) => {
    const pfp = results.policy_fuel_poverty?.[pk]?.[compScenario];
    if (!pfp) return { staticVal: 0, behavVal: 0 };
    if (metric === "fp_rate") {
      return {
        staticVal: +(shockFP.fuel_poverty_rate_pct - pfp.fp_rate).toFixed(2),
        behavVal: +(shockFP.fuel_poverty_rate_pct - pfp.behavioral_fp_rate).toFixed(2),
      };
    }
    return {
      staticVal: +(shockFP.households_m - pfp.fp_households_m).toFixed(2),
      behavVal: +(shockFP.households_m - pfp.behavioral_fp_households_m).toFixed(2),
    };
  };

  const exchequerData = policyKeys.map((pk) => {
    const e = getExchequer(pk);
    return { label: policyBarLabels[pk], staticVal: e.staticVal, behavVal: e.behavVal };
  });

  const fpRateData = policyKeys.map((pk) => {
    const c = getFPChange(pk, "fp_rate");
    return { label: policyBarLabels[pk], staticVal: c.staticVal, behavVal: c.behavVal };
  });
  const fpHHData = policyKeys.map((pk) => {
    const c = getFPChange(pk, "fp_households");
    return { label: policyBarLabels[pk], staticVal: c.staticVal, behavVal: c.behavVal };
  });

  // Pick active data based on compMetric toggle, then sort by value descending
  const sortVal = (d) => Math.max(d.staticVal || 0, d.behavVal || 0);
  const activeBarData = [...(compMetric === "exchequer" ? exchequerData
    : compMetric === "fp_rate" ? fpRateData : fpHHData)].sort((a, b) => sortVal(b) - sortVal(a));

  const maxActive = Math.max(...activeBarData.map((d) => Math.max(showStatic ? d.staticVal : 0, showBehav ? d.behavVal : 0))) * 1.15 || 1;
  const activeTicks = niceTicks(maxActive);
  const activeFmt = compMetric === "exchequer" ? (v) => `£${v}bn`
    : compMetric === "fp_rate" ? (v) => `${v}pp` : (v) => `${v}m`;
  const activeColor = "#94a3b8";
  const activeColorB = "#319795";
  const activeSubtitle = compMetric === "exchequer" ? "Exchequer cost (£bn)"
    : compMetric === "fp_rate" ? "FP rate reduction (pp)" : "FP households reduction (m)";

  const topTick = activeTicks[activeTicks.length - 1] || 1;
  const chartMax = Math.max(topTick, ...activeBarData.map((d) => Math.max(
    showStatic ? (d.staticVal || 0) : 0,
    showBehav ? (d.behavVal || 0) : 0
  ))) || 1;
  const effectiveMax = Math.max(chartMax, topTick);

  return (
    <section className="section" id="policy-comparison">
      <h2 className="section-title">Policy at a glance</h2>
      <p className="section-description">
        This chart compares all five policies side by side for the 2026-27 fiscal year. Use the metric toggle to switch
        between exchequer cost, reduction in fuel poverty rate, and reduction in fuel poor households.
      </p>

      <div className="pill-row">
        <span className="pill-row-label">SCENARIO</span>
        <div className="scenario-pills">
          {scenarios.map((s, i) => (
            <button
              key={i}
              className={`scenario-pill${i === compScenario ? " active" : ""}`}
              onClick={() => setCompScenario(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">METRIC</span>
        <div className="scenario-pills">
          {[
            { key: "exchequer", label: "Exchequer cost (£bn)" },
            { key: "fp_rate", label: "FP rate reduction (pp)" },
            { key: "fp_households", label: "FP households reduction (m)" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${compMetric === m.key ? " active" : ""}`} onClick={() => setCompMetric(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">RESPONSE</span>
        <div className="scenario-pills">
          {[
            { key: "behavioural", label: "Behavioural" },
            { key: "static", label: "Static" },
            { key: "both", label: "Both" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${compResponse === m.key ? " active" : ""}`} onClick={() => setCompResponse(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">Figure 5: Policy comparison</div>
            <div className="chart-subtitle">Sorted by selected metric, highest first</div>
          </div>
        </div>
        <div className="col-chart">
          <div className="col-chart-body">
            <div className="col-chart-y-axis">
              {[...activeTicks].reverse().map((t, i) => (
                <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{activeFmt(t)}</div>
              ))}
            </div>
            <div className="col-chart-area">
              {activeTicks.map((t, i) => (<div className="col-chart-gridline" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }} />))}
              <div className="col-chart-bars">
                {activeBarData.map((d, i) => {
                  const pctS = showStatic ? ((d.staticVal || 0) / effectiveMax) * 100 : 0;
                  const pctB = showBehav ? ((d.behavVal || 0) / effectiveMax) * 100 : 0;
                  return (
                    <div className="col-chart-col" key={i}>
                      <div className="col-chart-tooltip">
                        {showBoth
                          ? `Static: ${activeFmt(d.staticVal)} | Behavioural: ${activeFmt(d.behavVal)}`
                          : activeFmt(showStatic ? d.staticVal : d.behavVal)}
                      </div>
                      <div className="col-chart-track" style={showBoth ? { display: "flex", gap: 2, alignItems: "flex-end" } : {}}>
                        {showStatic && <div className="col-chart-fill" style={{ height: `${pctS}%`, background: activeColor, ...(showBoth ? { flex: 1 } : {}) }} />}
                        {showBehav && <div className="col-chart-fill" style={{ height: `${pctB}%`, background: activeColorB, ...(showBoth ? { flex: 1 } : {}) }} />}
                      </div>
                      <div className="col-chart-label">{d.label}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="col-chart-x-label">Policy</div>
          <div className="col-chart-legend">
            {showStatic && <span><span className="col-chart-legend-dot" style={{ background: activeColor }} />Static</span>}
            {showBehav && <span><span className="col-chart-legend-dot" style={{ background: activeColorB }} />Behavioural</span>}
          </div>
        </div>

      </div>

      <p className="section-description" style={{ marginTop: 24 }}>
        A 10% shock adds £156/yr to the average bill and raises the fuel poverty
        rate from 9.3% to 10.3%. At 2022-level prices the average hit reaches
        £2,019/yr and 8.8 million households (27.6%) are fuel poor. The burden
        falls hardest on the lowest-income decile, who spend 6.9% of net income on
        energy versus 1.4% for the highest.
      </p>
      <p className="section-description">
        The budget-neutral EPG delivers the largest fuel poverty reduction
        (18.3 pp at 2022-level) but costs the most. The budget-neutral transfer
        reduces fuel poverty by 14.9 pp. The National Energy Guarantee sits
        between the two, cutting fuel poverty by 9.0 pp while targeting
        lower-consuming households. The fixed-amount policies have lower
        exchequer costs but smaller fuel poverty reductions. The trade-off
        between fiscal cost and household protection varies with the scale
        of the shock.
      </p>
    </section>
  );
}

export default function Dashboard() {
  // Auto-open References <details> when clicking in-text reference links
  useEffect(() => {
    const handler = (e) => {
      const link = e.target.closest('a[href^="#ref-"], a[href^="#fn-"]');
      if (!link) return;
      const details = document.querySelector(".references-details");
      if (details && !details.open) details.open = true;
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div className="narrative-container">
      <header className="narrative-hero">
        <h1>Energy price shock: distributional impact and policy options</h1>
        <p className="narrative-lead">
          This analysis estimates the distributional impact of five
          energy price shock scenarios on UK households, with
          separate electricity and gas breakdowns, and models five policy
          responses.
        </p>
      </header>

      <section className="section" id="introduction">
      <h2 className="section-title">Introduction</h2>
      <p className="section-description">
        Military strikes on Iran have disrupted shipping through the Strait
        of Hormuz, which carries roughly 20% of the world's oil and
        gas. UK wholesale gas prices spiked over 90% in the first
        week.<a href="#fn-1"><sup>1</sup></a> Cornwall Insight forecasts the July 2026 Ofgem
        price cap at £1,801, a 10% increase.<a href="#fn-2"><sup>2</sup></a> Stifel analysts
        warn a prolonged closure could push the cap to
        £2,500.<a href="#fn-3"><sup>3</sup></a> The Resolution Foundation estimates a sustained
        rise could add £500 to typical annual energy bills, offsetting the
        £300 growth in living standards expected in 2026-27.<a href="#fn-4"><sup>4</sup></a>
      </p>
      <p className="section-description">
        Under current Ofgem rules,<a href="#fn-5"><sup>5</sup></a> the
        price cap for April to June 2026 is already set at £1,641, so
        household bills would not change before 1 July 2026. From July,
        the cap will reflect wholesale market conditions. All estimates
        in this analysis are for the 2026-27 fiscal year. This analysis models five
        price shock scenarios, from a 10% increase to
        a return to 2022-level prices. For each, it estimates the extra
        cost per household across income deciles, the impact on fuel
        poverty rates, and the distributional effects of five policy
        responses: a flat transfer, a council
        tax band rebate, two
        budget-neutral variants, and a National Energy Guarantee. All modelling uses the PolicyEngine
        UK microsimulation model with separate electricity and gas
        imputations calibrated to NEED 2023 admin
        data.<a href="#fn-6"><sup>6</sup></a>
      </p>

      <h3 className="section-title" style={{ fontSize: "1.05rem", marginTop: 24 }}>Previous studies</h3>
      <p className="section-description">
        The most recent comparable episode, the 2022 European energy
        crisis, raised household living costs by around 7% of
        consumption, with lower-income households bearing a larger
        share (<a href="#ref-ari">Ari et al., 2022</a>). In the UK, average household losses
        reached 6% of income before government intervention. Households at
        the 10th income percentile lost 5 percentage points more than those
        at the 90th (<a href="#ref-levell">Levell et al., 2025</a>). The UK's 2022 relief package, a
        39% price subsidy combined with a universal £400 transfer, cost
        1.3% of GDP in six months and reduced losses, but 12% of total
        spending was lost to inefficiency (<a href="#ref-levell">Levell et al., 2025</a>).
      </p>
      <p className="section-description">
        More broadly, oil price shocks have triggered recessions since the
        1970s, though their macroeconomic impact has diminished over time
        (<a href="#ref-blanchard">Blanchard and Galí, 2010</a>). Price increases tend to reduce output
        more than equivalent decreases boost it (<a href="#ref-kilian">Kilian, 2008</a>). Even in
        the absence of a crisis, energy price volatility alone costs around
        0.8% of consumption per year (<a href="#ref-manzano">Manzano and Rey, 2013</a>).
      </p>
      <p className="section-description">
        The results below first establish the baseline energy burden across
        UK households, then model five shock scenarios ranging from +10% to
        2022-level prices. For each scenario, we estimate the extra cost by
        income decile, tenure, and household type, with and without behavioural
        demand response. We then evaluate five policy responses and compare
        their exchequer cost against their effectiveness in reducing fuel poverty.
      </p>
      </section>

      <BaselineSection />
      <ShockSection />
      <PolicyNetSection />
      <PolicyComparisonSection />

      <section className="section" id="conclusion">
        <h2 className="section-title">Conclusion</h2>
        <p className="section-description">
          Even a moderate price shock pushes hundreds of thousands of
          additional households into fuel poverty, with the largest burden
          falling on the lowest-income deciles. The five policies modelled
          here range from low-cost fixed transfers to budget-neutral designs
          that fully offset the shock. Each involves a different trade-off
          between exchequer cost and the degree of household protection.
          The comparison above summarises how these trade-offs vary across
          shock scenarios and response assumptions.
        </p>
      </section>

      <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "48px 0" }} />

      <section className="section" id="references">
        <details className="references-details">
          <summary className="references-summary">
            <h2 className="section-title" style={{ display: "inline", cursor: "pointer" }}>References</h2>
          </summary>

        <div className="chart-title" style={{ marginBottom: 12, marginTop: 16 }}>Academic literature</div>
        <ul className="policy-bullet-list" style={{ fontSize: "0.82rem", color: "#64748b", lineHeight: 1.8 }}>
          <li id="ref-ari">
            Ari, A., Arregui, N., Black, S., Celasun, O., Iakova, D., Mineshima, A., Mylonas, V., Parry, I., Teodoru, I. and Zhunussova, K. (2022). "Surging Energy Prices in Europe in the Aftermath of the War: How to Support the Vulnerable and Speed up the Transition Away from Fossil Fuels." <em>IMF Working Paper</em>, No. 22/152.{" "}
            <a href="https://www.imf.org/en/publications/wp/issues/2022/07/28/surging-energy-prices-in-europe-in-the-aftermath-of-the-war-how-to-support-the-vulnerable-521457" target="_blank" rel="noopener noreferrer">Link</a>
          </li>
          <li id="ref-levell">
            Levell, P., O'Connell, M. and Smith, K. (2025). "The Welfare Effects of Price Shocks and Household Relief Packages: Evidence from an Energy Crisis." <em>IFS Working Paper</em>, No. 25/03. London: Institute for Fiscal Studies.{" "}
            <a href="https://ifs.org.uk/sites/default/files/2025-06/WP202503-The-welfare-effects-of-price-shocks-and-household-relief-packages-evidence-from-an-energy-crisis.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li id="ref-blanchard">
            Blanchard, O. J. and Galí, J. (2010). "The Macroeconomic Effects of Oil Price Shocks: Why Are the 2000s so Different from the 1970s?" In Galí, J. and Gertler, M. J. (eds.), <em>International Dimensions of Monetary Policy</em>, pp. 373–421. Chicago: University of Chicago Press (NBER).{" "}
            <a href="https://www.nber.org/system/files/chapters/c0517/c0517.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li id="ref-kilian">
            Kilian, L. (2008). "The Economic Effects of Energy Price Shocks." <em>Journal of Economic Literature</em>, 46(4), pp. 871–909.{" "}
            <a href="http://www.douglaslaxton.org/sitebuildercontent/sitebuilderfiles/kilian.theeconomiceffects.paper.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li id="ref-manzano">
            Manzano, B. and Rey, L. (2013). "The Welfare Cost of Energy Insecurity." Paper presented at the International Energy Workshop, Paris, 19–21 June 2013.{" "}
            <a href="https://www.internationalenergyworkshop.org/docs/IEW%202013_5A2paperManzano.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li id="ref-labandeira">
            Labandeira, X., Labeaga, J. M. and López-Otero, X. (2017). "A Meta-Analysis on the Price Elasticity of Energy Demand." <em>Energy Policy</em>, 102, pp. 549–568. Short-run averages: energy −0.149, electricity −0.201, natural gas −0.184 (428 papers, 966 estimates).{" "}
            <a href="https://doi.org/10.1016/j.enpol.2017.01.002" target="_blank" rel="noopener noreferrer">DOI</a>
          </li>
          <li id="ref-priesmann">
            Priesmann, J. and Praktiknjo, A. (2025). "Estimating Short- and Long-Run Price and Income Elasticities of Final Energy Demand as a Function of Household Income." <em>Energy Policy</em>, 207, 114850. Short-run gas elasticity: −0.64 (low-income) to −0.11 (high-income).{" "}
            <a href="https://doi.org/10.1016/j.enpol.2025.114850" target="_blank" rel="noopener noreferrer">DOI</a>
          </li>
          <li id="ref-bangham">
            Bangham, G. (2026). "Now is the time to prepare for another energy price shock." <em>Substack</em>, 5 March 2026. Argues for joining Ofgem, DWP and HMRC data and implementing a National Energy Guarantee with rising block tariffs.{" "}
            <a href="https://georgebangham.substack.com/p/now-is-the-time-to-prepare-for-another" target="_blank" rel="noopener noreferrer">Link</a>
          </li>
        </ul>

        <div className="chart-title" style={{ marginTop: 24, marginBottom: 12 }}>Sources and data</div>
        <ol className="ref-list">
          <li id="fn-1">
            <em>City AM</em>, "UK gas prices spike over 90 per cent amid US-Iran war," 3 March 2026.{" "}
            <a href="https://www.cityam.com/uk-gas-prices-spike-over-90-per-cent-amid-us-iran-war/" target="_blank" rel="noopener noreferrer">cityam.com</a>
          </li>
          <li id="fn-2">
            Cornwall Insight, "Final July price cap forecast," March 2026.{" "}
            <a href="https://www.cornwall-insight.com/press-and-media/press-release/cornwall-insight-release-final-july-price-cap-forecast/" target="_blank" rel="noopener noreferrer">cornwall-insight.com</a>
          </li>
          <li id="fn-3">
            <em>GB News</em>, "Iran war: Household energy bills could rise by £160," March 2026 (citing Stifel analysts).{" "}
            <a href="https://www.gbnews.com/news/iran-war-household-energy-bills-rise" target="_blank" rel="noopener noreferrer">gbnews.com</a>
          </li>
          <li id="fn-4">
            Resolution Foundation, "War in Middle East threatens bumper year of living standards growth for lower-income families," 4 March 2026.{" "}
            <a href="https://www.resolutionfoundation.org/press-releases/war-in-middle-east-threatens-bumper-year-of-living-standards-growth-for-lower-income-families/" target="_blank" rel="noopener noreferrer">resolutionfoundation.org</a>
          </li>
          <li id="fn-5">
            Ofgem, "Energy price cap explained," accessed March 2026.{" "}
            <a href="https://www.ofgem.gov.uk/energy-regulation/domestic-and-non-domestic/energy-pricing-rules/energy-price-cap" target="_blank" rel="noopener noreferrer">ofgem.gov.uk</a>
          </li>
          <li id="fn-6">
            PolicyEngine, "Energy price shock: distributional impact and policy options," GitHub repository.{" "}
            <a href="https://github.com/PolicyEngine/energy-price-shock" target="_blank" rel="noopener noreferrer">github.com</a>
          </li>
          <li id="fn-7">
            <em>Financial Times</em>, "Iran conflict pushes gas prices higher," March 2026.{" "}
            <a href="https://www.ft.com/content/13f5e566-83c0-4d94-9338-9d418053c290" target="_blank" rel="noopener noreferrer">ft.com</a>
          </li>
          <li id="fn-8">
            DESNZ, "Fuel poverty statistics," GOV.UK, accessed March 2026.{" "}
            <a href="https://www.gov.uk/government/collections/fuel-poverty-statistics" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-9">
            Bangham, G., "Now is the time to prepare for another energy price shock," Substack, March 2026.{" "}
            <a href="https://georgebangham.substack.com/p/now-is-the-time-to-prepare-for-another" target="_blank" rel="noopener noreferrer">substack.com</a>
          </li>
          <li id="fn-10">
            HM Treasury, "Energy bills support factsheet," GOV.UK, updated 2023. Details the Energy Price Guarantee, Energy Bills Support Scheme (£400 flat transfer), and Council Tax Rebate.{" "}
            <a href="https://www.gov.uk/government/publications/energy-bills-support/energy-bills-support-factsheet-8-september-2022" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-11">
            DESNZ, "Energy Price Guarantee," GOV.UK, 2023. The EPG capped the unit rate for electricity and gas so a typical household paid no more than £2,500/yr. Suppliers were compensated for the shortfall.{" "}
            <a href="https://www.gov.uk/government/publications/energy-price-guarantee/energy-price-guarantee" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-12">
            DESNZ, "Energy Bills Support Scheme," GOV.UK, 2022. A £400 non-repayable discount applied to electricity bills in six monthly instalments (October 2022 – March 2023) for all domestic electricity customers.{" "}
            <a href="https://www.gov.uk/get-help-energy-bills/energy-bills-support-scheme" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-13">
            DLUHC, "Council Tax Rebate: guidance for billing authorities," GOV.UK, 2022. A one-off £150 payment to households in council tax bands A–D in England.{" "}
            <a href="https://www.gov.uk/government/publications/the-council-tax-rebate-2022-23-billing-authority-guidance" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-14">
            VOA, "Council tax: stock of properties," GOV.UK, 2024. Valuation Office Agency data on the distribution of dwellings by council tax band in England.{" "}
            <a href="https://www.gov.uk/government/statistics/council-tax-stock-of-properties-2024" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
        </ol>
        </details>
      </section>
    </div>
  );
}
