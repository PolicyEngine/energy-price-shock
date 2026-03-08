import { useState } from "react";
import results from "../data/results.json";
import resultsV2 from "../data/results_v2.json";
import constituencyData from "../data/constituency_results.json";
import ConstituencyMap from "./ConstituencyMap";
import RegionMap from "./RegionMap";
import "./Dashboard.css";

const fmt = (v) => `£${v.toLocaleString("en-GB")}`;
const fmtBn = (v) => `£${v}bn`;

const POLICY_META = {
  epg: {
    letter: "A",
    fullName: "Energy Price Guarantee (EPG)",
    description:
      "Government caps bills at £2,500/yr and subsidises the difference. Introduced in October 2022 and ran until June 2023. Proportional to consumption, so higher users get more. Only activates when the price cap exceeds £2,500.",
    targeting: "Proportional to energy spend; higher spenders get more £",
  },
  flat_transfer: {
    letter: "B",
    fullName: "Flat transfer (£400 per household)",
    description:
      "£400 credited to every household's energy bill. Progressive in percentage terms but untargeted.",
    targeting: "Universal, same amount regardless of income or usage",
  },
  ct_rebate: {
    letter: "C",
    fullName: "Council tax band rebate (£300 for bands A–D)",
    description:
      "£300 payment to households in council tax bands A through D. Uses property value as a proxy for income. More targeted than a flat transfer but an imprecise proxy.",
    targeting:
      "Property value proxy; lower bands correlate with lower wealth",
  },
  winter_fuel: {
    letter: "D",
    fullName: "Expanded Winter Fuel Allowance",
    description:
      "Remove means test and increase payments to £350/£500 for all pensioner households. Costs £1.5bn extra. Does not cover working-age households.",
    targeting:
      "Age-targeted; means test removed to reach all pensioner households",
  },
  bn_transfer: {
    letter: "E",
    fullName: "Budget-neutral flat transfer",
    description:
      "Every household receives a flat payment equal to the average extra energy cost under the selected shock. Fully offsets the shock on average, but higher-consuming households remain under-compensated. Scales with the shock.",
    targeting: "Universal, same amount per household; progressive in % terms",
  },
  bn_epg: {
    letter: "F",
    fullName: "Budget-neutral EPG (cap at £1,641)",
    description:
      "Government caps bills at the current Ofgem level of £1,641 and subsidises the full price increase. Every household is fully compensated in proportion to its consumption. The most expensive option but achieves 100% offset for all deciles.",
    targeting: "Proportional to consumption; 100% offset for every household",
  },
};

function KpiCard({ label, value, unit, color }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
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
  const regional = resultsV2.regional;
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
  const REGION_LABELS = {
    NORTH_EAST: "NE",
    NORTH_WEST: "NW",
    YORKSHIRE: "Yorks",
    EAST_MIDLANDS: "E Mids",
    WEST_MIDLANDS: "W Mids",
    EAST_OF_ENGLAND: "E Eng",
    LONDON: "London",
    SOUTH_EAST: "SE",
    SOUTH_WEST: "SW",
    WALES: "Wales",
    SCOTLAND: "Scotland",
    NORTHERN_IRELAND: "NI",
  };

  // Build chart data for current metric + breakdown combo
  let chartTitle, chartSubtitle, xLabel;
  const bk = breakdownView;

  if (bk === "decile") xLabel = "Decile";
  else if (bk === "region") xLabel = "Region";
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
    if (bk === "region") return regional.map((r) => ({
      label: REGION_LABELS[r.region] || r.region,
      elec: r.electricity, gas: r.gas, net_income: r.net_income, energy_burden_pct: r.energy_burden_pct,
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
    chartTitle = `Energy spending by ${xLabel.toLowerCase()}`;
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
    chartTitle = `Energy spend as % of net income, by ${xLabel.toLowerCase()}`;
    chartSubtitle = bk === "decile" ? "decile 1 = lowest income, decile 10 = highest income" : "% of household net income spent on energy";
  } else {
    simpleBarData = items.map((it) => ({ label: it.label, value: it.net_income }));
    simpleMaxVal = Math.max(...simpleBarData.map((d) => d.value)) * 1.15;
    simpleFormat = (v) => fmt(v);
    chartTitle = `Net income by ${xLabel.toLowerCase()}`;
    chartSubtitle = "annual household net income (earnings + benefits − taxes)";
  }

  return (
    <section className="section" id="baseline">
      <h2 className="section-title">Baseline energy burden</h2>

      <div className="kpi-row">
        <KpiCard label="Households" value={`${baseline.n_households_m}m`} color="teal" />
        <KpiCard label="Current Ofgem cap" value={fmt(baseline.current_cap)} unit="/yr" />
        <KpiCard label="Avg electricity" value={fmt(split.mean_electricity)} unit="/yr" />
        <KpiCard label="Avg gas" value={fmt(split.mean_gas)} unit="/yr" />
        <KpiCard label="Avg total energy" value={fmt(baseline.mean_energy_spend)} unit="/yr" />
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
      <div className="pill-row">
        <span className="pill-row-label">BREAKDOWN</span>
        <div className="scenario-pills">
          {[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
            { key: "region", label: "By region" },
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

      {breakdownView === "region" ? (
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <div className="chart-title">Regional energy map</div>
              <div className="chart-subtitle">Hover over a region to see details</div>
            </div>
          </div>
          <RegionMap regionData={regional} activeView={baselineView} />
        </div>
      ) : breakdownView === "constituency" ? (
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <div className="chart-title">Constituency-level map</div>
              <div className="chart-subtitle">650 parliamentary constituencies — search or hover to explore</div>
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
                              Elec: {stackedFmtVal(d.elec)}, Gas: {stackedFmtVal(d.gas)}
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
              <div className="chart-title">Fuel poverty rate by {breakdownView === "hh_type" ? "household type" : "tenure"}</div>
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
        spending but drives most price volatility. Regional variation is
        significant: the {regional[0].region === "NORTH_WEST" ? "North West" : regional[0].region} has
        the highest energy burden at {regional[0].energy_burden_pct}% of
        income, while London is lowest. The next section models what happens
        when prices rise.
      </p>
    </section>
  );
}

function ShockSection() {
  const [selected, setSelected] = useState(0);
  const [shockMetric, setShockMetric] = useState("pct_of_income");
  const [shockResponse, setShockResponse] = useState("both");
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
  const REGION_LABELS = {
    NORTH_EAST: "NE", NORTH_WEST: "NW", YORKSHIRE: "Yorks", EAST_MIDLANDS: "E Mids",
    WEST_MIDLANDS: "W Mids", EAST_OF_ENGLAND: "E Eng", LONDON: "London",
    SOUTH_EAST: "SE", SOUTH_WEST: "SW", WALES: "Wales", SCOTLAND: "Scotland", NORTHERN_IRELAND: "NI",
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
  } else if (shockBreakdown === "region") {
    xLabel = "Region";
    barData = scenario.by_region.map((d) => {
      const bd = behav.by_region.find((b) => b.region === d.region);
      return {
        label: REGION_LABELS[d.region] || d.region,
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
      <ul className="policy-bullet-list">
        <li><strong>+10%</strong> Short-lived supply disruption or moderate market uncertainty. Cap rises to £1,805.</li>
        <li><strong>+20%</strong> Sustained disruption or extended uncertainty in shipping routes. Cap rises to £1,969.</li>
        <li><strong>+30%</strong> Prolonged conflict affecting gas supply, such as extended Strait of Hormuz disruption. Cap rises to £2,133.</li>
        <li><strong>+60%</strong> Major escalation comparable to the initial impact of the 2022 crisis. Cap rises to £2,625.</li>
        <li><strong>2022-level</strong> Matches the October 2022 peak of £3,764, when wholesale gas prices reached record highs.</li>
      </ul>
      <h3 className="section-title" style={{ fontSize: "1.1rem", marginTop: 32 }}>Behavioural response</h3>
      <p className="section-description">
        Each chart below shows two estimates side by side. The <strong>static</strong>{" "}
        estimate assumes households do not change their energy
        consumption. The <strong>behavioural</strong> estimate accounts for the fact that
        households reduce usage when prices rise — turning down heating,
        using less hot water. The behavioural estimate uses a short-run
        price elasticity of −0.15, matching the
        overall energy short-run average of −0.149 reported in a
        meta-analysis of 428 studies (<a href="#ref-labandeira">Labandeira, Labeaga and López-Otero,
        2017</a>). Elasticities vary by income: <a href="#ref-priesmann">Priesmann and Praktiknjo
        (2025)</a> find short-run gas price elasticities ranging from −0.64
        for low-income to −0.11 for high-income households. The bill
        saving from reduced consumption does not capture the full cost to
        households, who also lose comfort and warmth.
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
        pensioners and lone parents, and regions such as the North East and
        West Midlands.
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
            { key: "static", label: "Static" },
            { key: "behavioural", label: "Behavioural" },
            { key: "both", label: "Both" },
          ].map((m) => (
            <button key={m.key} className={`scenario-pill${shockResponse === m.key ? " active" : ""}`} onClick={() => setShockResponse(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="pill-row">
        <span className="pill-row-label">BREAKDOWN</span>
        <div className="scenario-pills">
          {[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
            { key: "region", label: "By region" },
            { key: "constituency", label: "By constituency" },
          ].map((v) => (
            <button key={v.key} className={`scenario-pill${shockBreakdown === v.key ? " active" : ""}`} onClick={() => setShockBreakdown(v.key)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard label="New price cap" value={fmt(scenario.new_cap)} unit="/yr" color="teal" />
        <KpiCard label="Static avg hit" value={fmt(scenario.avg_hh_hit_yr)} unit="/yr" />
        <KpiCard label="Behavioural avg hit" value={fmt(behav.behavioral_avg_extra)} unit="/yr" color="teal" />
        <KpiCard label="Consumption change" value={`${behav.consumption_change_pct}%`} />
      </div>

      {shockBreakdown === "region" ? (() => {
        // Build shock-specific region data for the map
        const useStatic = shockResponse !== "behavioural";
        const srcData = useStatic ? scenario.by_region : behav.by_region;
        const fieldMap = {
          pct_of_income: useStatic ? "pct_of_income" : "behavioral_pct_of_income",
          extra_cost: useStatic ? "extra_cost" : "behavioral_extra_cost",
          fp_rate: useStatic ? "fp_rate" : "behavioral_fp_rate",
          fp_households: useStatic ? "fp_households_m" : "behavioral_fp_households_m",
        };
        const srcField = fieldMap[shockMetric];
        const metricField = shockMetric === "pct_of_income" ? "shock_pct"
          : shockMetric === "fp_rate" ? "shock_fp_rate"
          : shockMetric === "fp_households" ? "shock_fp_hh"
          : "shock_cost";
        const shockRegionData = srcData.map((r) => ({
          region: r.region,
          [metricField]: r[srcField] || 0,
        }));
        const responseLabel = useStatic ? "static" : "behavioural";
        const labelMap = {
          pct_of_income: `Extra cost as % of income (${responseLabel})`,
          extra_cost: `Extra cost £/yr (${responseLabel})`,
          fp_rate: `Fuel poverty rate % (${responseLabel})`,
          fp_households: `Fuel poor households, millions (${responseLabel})`,
        };
        const mapLabel = labelMap[shockMetric];
        return (
          <div className="chart-wrapper">
            <div className="chart-header">
              <div>
                <div className="chart-title">Regional shock impact: {scenario.name}</div>
                <div className="chart-subtitle">{mapLabel}</div>
              </div>
            </div>
            <RegionMap regionData={shockRegionData} customMetricKey={metricField} customLabel={mapLabel} />
          </div>
        );
      })() : shockBreakdown === "constituency" ? (() => {
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
                <div className="chart-title">Constituency-level shock impact: {scenario.name}</div>
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
                {shockMetric === "pct_of_income" ? `Extra energy cost as % of income, by ${xLabel.toLowerCase()}: ${scenario.name}`
                  : shockMetric === "extra_cost" ? `Extra energy cost (£/yr), by ${xLabel.toLowerCase()}: ${scenario.name}`
                  : shockMetric === "fp_rate" ? `Fuel poverty rate (%), by ${xLabel.toLowerCase()}: ${scenario.name}`
                  : `Fuel poor households (millions), by ${xLabel.toLowerCase()}: ${scenario.name}`}
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



function PolicySection() {
  const { policies } = results;
  const EPG_TARGET = 2500;
  const EPG_REF_CAP = 2625;
  const nHH = results.baseline.n_households_m;
  const policyKeys = [
    "epg",
    "flat_transfer",
    "ct_rebate",
    "winter_fuel",
    "bn_transfer",
    "bn_epg",
  ];
  const [selectedPolicy, setSelectedPolicy] = useState("flat_transfer");
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [chartMode, setChartMode] = useState("shock_offset");

  const scenario = results.shock_scenarios[selectedScenario];
  const behav = results.behavioral[selectedScenario];
  const meta = POLICY_META[selectedPolicy];
  const isBudgetNeutral = selectedPolicy === "bn_transfer" || selectedPolicy === "bn_epg";

  // Compute dynamic decile data based on policy type
  let dynamicDeciles, avgBenefit, exchequerCost;

  if (selectedPolicy === "bn_transfer") {
    // Budget-neutral flat transfer: every HH gets the average static extra cost
    const avgHit = scenario.avg_hh_hit_yr;
    avgBenefit = avgHit;
    exchequerCost = Math.round(avgHit * nHH / 100) / 10;
    dynamicDeciles = scenario.deciles.map((d, i) => {
      const payment = avgHit;
      const staticExtra = d.extra_cost;
      const behavExtra = behav.deciles[i].behavioral_extra_cost;
      return {
        decile: d.decile,
        payment,
        staticOffsetPct: staticExtra > 0 ? Math.round(payment / staticExtra * 100) : 0,
        behavOffsetPct: behavExtra > 0 ? Math.round(payment / behavExtra * 100) : 0,
      };
    });
  } else if (selectedPolicy === "bn_epg") {
    // Budget-neutral EPG: cap at current level, subsidy = full extra cost per HH
    avgBenefit = scenario.avg_hh_hit_yr;
    exchequerCost = scenario.total_cost_bn;
    dynamicDeciles = scenario.deciles.map((d, i) => {
      const payment = d.extra_cost;
      const behavExtra = behav.deciles[i].behavioral_extra_cost;
      return {
        decile: d.decile,
        payment,
        staticOffsetPct: 100,
        behavOffsetPct: behavExtra > 0 ? Math.round(payment / behavExtra * 100) : 0,
      };
    });
  } else {
    const policy = policies[selectedPolicy];
    const epgScale = selectedPolicy === "epg"
      ? Math.max(0, scenario.new_cap - EPG_TARGET) / (EPG_REF_CAP - EPG_TARGET)
      : 1;
    avgBenefit = selectedPolicy === "epg"
      ? Math.round(policy.avg_hh_benefit * epgScale)
      : policy.avg_hh_benefit;
    exchequerCost = selectedPolicy === "epg"
      ? Math.round(policy.exchequer_cost_bn * epgScale * 10) / 10
      : policy.exchequer_cost_bn;
    dynamicDeciles = policy.deciles.map((d, i) => {
      const payment = selectedPolicy === "epg"
        ? Math.round(d.payment * epgScale)
        : d.payment;
      const staticExtra = scenario.deciles[i].extra_cost;
      const behavExtra = behav.deciles[i].behavioral_extra_cost;
      return {
        decile: d.decile,
        payment,
        staticOffsetPct: staticExtra > 0 ? Math.round(payment / staticExtra * 100) : 0,
        behavOffsetPct: behavExtra > 0 ? Math.round(payment / behavExtra * 100) : 0,
      };
    });
  }

  return (
    <section className="section" id="policies">
      <h2 className="section-title">Policy responses</h2>
      <p className="section-description">
        Policies A–D reflect the toolkit the UK government deployed
        during the 2022 energy crisis<a href="#fn-10"><sup>10</sup></a> and
        are the instruments available in
        the <a href="https://policyengine.org/uk" target="_blank" rel="noopener noreferrer">PolicyEngine UK</a> microsimulation
        model. Policies E–F are <strong>budget-neutral</strong> variants
        designed to fully offset the extra cost so that households are no
        worse off on average. We apply each policy to the selected shock
        scenario. The key metric is <strong>shock offset</strong>: what
        share of the extra cost each policy covers for each decile.
      </p>

      <ul className="policy-bullet-list">
        {policyKeys.map((key) => (
          <li key={key}>
            <strong>{POLICY_META[key].letter}. {POLICY_META[key].fullName}</strong>{" "}
            {POLICY_META[key].description}
          </li>
        ))}
      </ul>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8" }}>SCENARIO</span>
        <div className="scenario-pills">
          {results.shock_scenarios.map((s, i) => (
            <button
              key={i}
              className={`scenario-pill scenario-pill-sm${i === selectedScenario ? " active" : ""}`}
              onClick={() => setSelectedScenario(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8" }}>POLICY</span>
        <div className="scenario-pills">
          {policyKeys.map((key) => (
            <button
              key={key}
              className={`scenario-pill${
                selectedPolicy === key ? " active" : ""
              }`}
              onClick={() => setSelectedPolicy(key)}
            >
              {POLICY_META[key].letter}. {policies[key]?.name || POLICY_META[key].fullName}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard
          label="Shock scenario"
          value={scenario.name}
          color="teal"
        />
        <KpiCard
          label="Exchequer cost"
          value={fmtBn(exchequerCost)}
          color="teal"
        />
        <KpiCard
          label="Avg HH benefit"
          value={fmt(avgBenefit)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Avg shock offset"
          value={`${scenario.avg_hh_hit_yr > 0 ? Math.round(avgBenefit / scenario.avg_hh_hit_yr * 100) : 0}%`}
        />
      </div>

      {selectedPolicy === "epg" && scenario.new_cap <= EPG_TARGET ? (
        <div className="chart-wrapper" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="section-description" style={{ color: "#64748b", marginBottom: 0 }}>
            Under {scenario.name}, the cap rises to {fmt(scenario.new_cap)}.
            The EPG only activates when the cap exceeds the guarantee
            threshold of £2,500. At this shock level, the cap remains below
            the threshold and the EPG provides no subsidy.
          </p>
        </div>
      ) : (
        <>
          <p className="section-description">
            The chart below shows the payment each decile receives under the
            selected policy and scenario. Toggle to shock offset to see what
            share of the extra cost the policy covers.
          </p>

          <div className="chart-wrapper">
            <div className="chart-header">
              <div>
                {chartMode === "shock_offset" ? (
                  <>
                    <div className="chart-title">Shock offset by decile: {meta.fullName} ({scenario.name})</div>
                    <div className="chart-subtitle">
                      Static vs behavioural
                      {Math.min(...dynamicDeciles.map((d) => d.staticOffsetPct)) >= 100
                        ? " — policy more than fully covers the shock"
                        : ""}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="chart-title">Payment by decile: {meta.fullName} ({scenario.name})</div>
                    <div className="chart-subtitle">Annual £ received per household</div>
                  </>
                )}
              </div>
              <div className="scenario-pills">
                <button
                  className={`scenario-pill scenario-pill-sm${chartMode === "payment" ? " active" : ""}`}
                  onClick={() => setChartMode("payment")}
                >
                  Payment (£/yr)
                </button>
                <button
                  className={`scenario-pill scenario-pill-sm${chartMode === "shock_offset" ? " active" : ""}`}
                  onClick={() => setChartMode("shock_offset")}
                >
                  Shock offset
                </button>
              </div>
            </div>

            {(() => {
              const isOffset = chartMode === "shock_offset";
              const barItems = dynamicDeciles.map((d) => ({
                label: `${d.decile}`,
                staticVal: isOffset ? d.staticOffsetPct : d.payment,
                behavVal: isOffset ? d.behavOffsetPct : d.payment,
              }));
              const maxVal = Math.max(...barItems.map((d) => Math.max(d.staticVal, d.behavVal))) * 1.15;
              const ticks = niceTicks(maxVal);
              const topTick = ticks[ticks.length - 1] || maxVal;
              const effectiveMax = Math.max(maxVal, topTick) || 10;
              const fmtVal = isOffset ? (v) => `${v}%` : (v) => fmt(v);
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
                        {barItems.map((d, i) => (
                          <div className="col-chart-col" key={i}>
                            <div className="col-chart-tooltip">
                              {isOffset
                                ? `Static: ${d.staticVal}%, Behavioural: ${d.behavVal}%`
                                : `${fmt(d.staticVal)}`}
                            </div>
                            {isOffset ? (
                              <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                                <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: "#94a3b8", borderRadius: "3px 3px 0 0" }} />
                                <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#319795", borderRadius: "3px 3px 0 0" }} />
                              </div>
                            ) : (
                              <div className="col-chart-track">
                                <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, background: "#319795", borderRadius: "3px 3px 0 0" }} />
                              </div>
                            )}
                            <div className="col-chart-label">{d.label}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="col-chart-x-label">Decile</div>
                  {isOffset && (
                    <div className="col-chart-legend">
                      <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>
                      <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </>
      )}

      <p className="section-description">
        Under the selected scenario, fixed-cost policies (A–D) offset a
        larger share of the shock when the shock is milder. Budget-neutral
        policies (E, F) scale with the shock by design. All face a
        targeting gap: the government holds no single database linking
        household energy costs with
        income. <a href="#fn-9">Bangham (2026)</a> argues joining data
        across Ofgem, DWP and HMRC before 1 July could enable more
        targeted support than the 2022 response. The next section shows the
        net household position after both the price shock and the policy
        response.
      </p>
    </section>
  );
}

function PolicyNetSection() {
  const { policies } = results;
  const EPG_TARGET = 2500;
  const EPG_REF_CAP = 2625;
  const nHH = results.baseline.n_households_m;
  const policyKeys = ["epg", "flat_transfer", "ct_rebate", "winter_fuel", "bn_transfer", "bn_epg"];
  const policyLabels = {
    epg: "A. EPG subsidy",
    flat_transfer: "B. Flat transfer",
    ct_rebate: "C. CT band rebate",
    winter_fuel: "D. Winter fuel",
    bn_transfer: "E. BN transfer",
    bn_epg: "F. BN EPG",
  };
  const [selectedNet, setSelectedNet] = useState("flat_transfer");
  const [selectedScenario, setSelectedScenario] = useState(0); // default +10%

  const scenario = results.shock_scenarios[selectedScenario];
  const behav = results.behavioral[selectedScenario];

  let avgBenefit, exchequerCost, barData;

  if (selectedNet === "bn_transfer") {
    avgBenefit = scenario.avg_hh_hit_yr;
    exchequerCost = Math.round(scenario.avg_hh_hit_yr * nHH / 100) / 10;
    barData = scenario.deciles.map((d, i) => {
      const payment = scenario.avg_hh_hit_yr;
      const behavExtra = behav.deciles[i].behavioral_extra_cost;
      return { label: `${d.decile}`, staticVal: Math.max(0, d.extra_cost - payment), behavVal: Math.max(0, behavExtra - payment) };
    });
  } else if (selectedNet === "bn_epg") {
    avgBenefit = scenario.avg_hh_hit_yr;
    exchequerCost = scenario.total_cost_bn;
    barData = scenario.deciles.map((d, i) => {
      const behavExtra = behav.deciles[i].behavioral_extra_cost;
      return { label: `${d.decile}`, staticVal: 0, behavVal: Math.max(0, behavExtra - d.extra_cost) };
    });
  } else {
    const policy = policies[selectedNet];
    const epgScale = selectedNet === "epg"
      ? Math.max(0, scenario.new_cap - EPG_TARGET) / (EPG_REF_CAP - EPG_TARGET)
      : 1;
    avgBenefit = selectedNet === "epg"
      ? Math.round(policy.avg_hh_benefit * epgScale)
      : policy.avg_hh_benefit;
    exchequerCost = selectedNet === "epg"
      ? Math.round(policy.exchequer_cost_bn * epgScale * 10) / 10
      : policy.exchequer_cost_bn;
    barData = policy.deciles.map((d, i) => {
      const payment = selectedNet === "epg"
        ? Math.round(d.payment * epgScale)
        : d.payment;
      const staticExtra = scenario.deciles[i].extra_cost;
      const behavExtra = behav.deciles[i].behavioral_extra_cost;
      return { label: `${d.decile}`, staticVal: Math.max(0, staticExtra - payment), behavVal: Math.max(0, behavExtra - payment) };
    });
  }

  const avgStaticShock = scenario.avg_hh_hit_yr;
  const avgBehavShock = behav.behavioral_avg_extra;

  return (
    <section className="section" id="policy-net">
      <h2 className="section-title">Net household position</h2>
      <p className="section-description">
        The previous section showed each policy's payment in isolation.
        This section shows the net household position: after the selected
        price shock and the policy response, how much extra are
        households still paying compared to baseline? The static estimate
        assumes no change in consumption. The behavioural estimate
        accounts for demand response (ε = −0.15).
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8" }}>SCENARIO</span>
        <div className="scenario-pills">
          {results.shock_scenarios.map((s, i) => (
            <button
              key={i}
              className={`scenario-pill scenario-pill-sm${i === selectedScenario ? " active" : ""}`}
              onClick={() => setSelectedScenario(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8" }}>POLICY</span>
        <div className="scenario-pills">
          {policyKeys.map((key) => (
            <button
              key={key}
              className={`scenario-pill${selectedNet === key ? " active" : ""}`}
              onClick={() => setSelectedNet(key)}
            >
              {policyLabels[key]}
            </button>
          ))}
        </div>
      </div>

      <div className="kpi-row">
        <KpiCard
          label="Static net cost"
          value={fmt(Math.max(0, avgStaticShock - avgBenefit))}
          unit="/yr"
        />
        <KpiCard
          label="Behavioural net cost"
          value={fmt(Math.max(0, avgBehavShock - avgBenefit))}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Policy benefit"
          value={fmt(avgBenefit)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Exchequer cost"
          value={fmtBn(exchequerCost)}
        />
      </div>

      {Math.max(...barData.map((d) => d.staticVal)) === 0 && Math.max(...barData.map((d) => d.behavVal)) === 0 ? (
        <div className="chart-wrapper" style={{ textAlign: "center", padding: "40px 24px" }}>
          <p className="section-description" style={{ color: "#319795", fontWeight: 500, marginBottom: 0 }}>
            The {policyLabels[selectedNet]} fully offsets the {scenario.name} shock
            for all deciles. Every household's net extra cost is £0. Select a
            larger shock to see remaining costs.
          </p>
        </div>
      ) : (
        <div className="chart-wrapper">
          <div className="chart-header">
            <div>
              <div className="chart-title">
                Remaining extra cost after {policyLabels[selectedNet]}, by decile ({scenario.name})
              </div>
              <div className="chart-subtitle">
                Static vs behavioural
              </div>
            </div>
          </div>
          {(() => {
            const maxVal = Math.max(...barData.map((d) => d.staticVal)) * 1.15;
            const ticks = niceTicks(maxVal);
            const topTick = ticks[ticks.length - 1] || maxVal;
            const effectiveMax = Math.max(maxVal, topTick) || 10;
            return (
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>
                        {fmt(t)}
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
                            Static: {fmt(d.staticVal)}, Behavioural: {fmt(d.behavVal)}
                          </div>
                          <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                            <div
                              className="col-chart-fill"
                              style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: "#94a3b8", borderRadius: "3px 3px 0 0" }}
                            />
                            <div
                              className="col-chart-fill"
                              style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#319795", borderRadius: "3px 3px 0 0" }}
                            />
                          </div>
                          <div className="col-chart-label">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="col-chart-x-label">Decile</div>
                <div className="col-chart-legend">
                  <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>
                  <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      <p className="section-description">
        Under the {scenario.name} scenario, the selected policy determines how
        much of the shock each decile absorbs. Budget-neutral policies (E, F)
        fully offset the average hit but still leave some deciles worse off.
        Fixed-cost policies (A–D) cover a larger share when the shock is
        milder. This illustrates the fiscal trade-off: fully offsetting a
        severe shock is expensive, while the same fixed payment goes much
        further against a milder shock.
      </p>
    </section>
  );
}

function SummarySection() {
  const { policies } = results;
  const EPG_TARGET = 2500;
  const EPG_REF_CAP = 2625;
  const nHH = results.baseline.n_households_m;
  const [summaryMetric, setSummaryMetric] = useState("cost");
  const [selectedScenario, setSelectedScenario] = useState(0); // default +10%

  const scenario = results.shock_scenarios[selectedScenario];
  const behav = results.behavioral[selectedScenario];

  const epgScale = Math.max(0, scenario.new_cap - EPG_TARGET) / (EPG_REF_CAP - EPG_TARGET);

  // Static cost = cost to offset static shock; Behavioural cost = cost to offset behavioural shock
  // For fixed policies (A-D), cost is the same either way (fixed payment)
  // For BN policies, cost scales with the shock size
  const epgCost = Math.round(policies.epg.exchequer_cost_bn * epgScale * 10) / 10;
  const epgBenefit = Math.round(policies.epg.avg_hh_benefit * epgScale);

  const rows = [
    { name: "EPG", staticCost: epgCost, behavCost: epgCost, staticBenefit: epgBenefit, behavBenefit: epgBenefit },
    { name: "Flat transfer", staticCost: policies.flat_transfer.exchequer_cost_bn, behavCost: policies.flat_transfer.exchequer_cost_bn, staticBenefit: policies.flat_transfer.avg_hh_benefit, behavBenefit: policies.flat_transfer.avg_hh_benefit },
    { name: "CT rebate", staticCost: policies.ct_rebate.exchequer_cost_bn, behavCost: policies.ct_rebate.exchequer_cost_bn, staticBenefit: policies.ct_rebate.avg_hh_benefit, behavBenefit: policies.ct_rebate.avg_hh_benefit },
    { name: "Winter fuel", staticCost: policies.winter_fuel.exchequer_cost_bn, behavCost: policies.winter_fuel.exchequer_cost_bn, staticBenefit: policies.winter_fuel.avg_hh_benefit, behavBenefit: policies.winter_fuel.avg_hh_benefit },
    { name: "BN transfer", staticCost: Math.round(scenario.avg_hh_hit_yr * nHH / 100) / 10, behavCost: Math.round(behav.behavioral_avg_extra * nHH / 100) / 10, staticBenefit: scenario.avg_hh_hit_yr, behavBenefit: behav.behavioral_avg_extra },
    { name: "BN EPG", staticCost: scenario.total_cost_bn, behavCost: Math.round(behav.behavioral_avg_extra * nHH / 100) / 10, staticBenefit: scenario.avg_hh_hit_yr, behavBenefit: behav.behavioral_avg_extra },
  ];

  const sortKey = summaryMetric === "cost" ? "staticCost" : "staticBenefit";
  const sorted = [...rows].sort((a, b) => b[sortKey] - a[sortKey]);

  const chartTitle = summaryMetric === "cost"
    ? `Exchequer cost comparison (${scenario.name})`
    : `Average household benefit comparison (${scenario.name})`;
  const chartSubtitle = "Static vs behavioural";

  return (
    <section className="section" id="summary">
      <h2 className="section-title">Policy cost comparison</h2>
      <p className="section-description">
        The chart below places all six policies side by side on two
        metrics: exchequer cost and average household benefit. The
        budget-neutral policies (E, F) scale with the shock — select a
        scenario to see how the fiscal cost changes.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontSize: "0.78rem", fontWeight: 600, color: "#94a3b8" }}>SCENARIO</span>
        <div className="scenario-pills">
          {results.shock_scenarios.map((s, i) => (
            <button
              key={i}
              className={`scenario-pill scenario-pill-sm${i === selectedScenario ? " active" : ""}`}
              onClick={() => setSelectedScenario(i)}
            >
              {s.name}
            </button>
          ))}
        </div>
      </div>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">{chartTitle}</div>
            <div className="chart-subtitle">{chartSubtitle}</div>
          </div>
          <div className="scenario-pills">
            <button
              className={`scenario-pill scenario-pill-sm${summaryMetric === "cost" ? " active" : ""}`}
              onClick={() => setSummaryMetric("cost")}
            >
              Exchequer cost
            </button>
            <button
              className={`scenario-pill scenario-pill-sm${summaryMetric === "benefit" ? " active" : ""}`}
              onClick={() => setSummaryMetric("benefit")}
            >
              Avg HH benefit
            </button>
          </div>
        </div>

        {(() => {
          const isCost = summaryMetric === "cost";
          const barItems = sorted.map((r) => ({
            label: r.name,
            staticVal: isCost ? r.staticCost : r.staticBenefit,
            behavVal: isCost ? r.behavCost : r.behavBenefit,
          }));
          const maxVal = Math.max(...barItems.map((d) => d.staticVal)) * 1.15;
          const ticks = niceTicks(maxVal);
          const topTick = ticks[ticks.length - 1] || maxVal;
          const effectiveMax = Math.max(maxVal, topTick) || 10;
          const fmtVal = isCost ? (v) => fmtBn(v) : (v) => fmt(v);
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
                    {barItems.map((d, i) => (
                      <div className="col-chart-col" key={i}>
                        <div className="col-chart-tooltip">
                          {isCost
                            ? `Static: ${fmtBn(d.staticVal)}, Behavioural: ${fmtBn(d.behavVal)}`
                            : `Static: ${fmt(d.staticVal)}/yr, Behavioural: ${fmt(d.behavVal)}/yr`}
                        </div>
                        <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                          <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: "#94a3b8", borderRadius: "3px 3px 0 0" }} />
                          <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#319795", borderRadius: "3px 3px 0 0" }} />
                        </div>
                        <div className="col-chart-label">{d.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="col-chart-legend">
                <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>
                <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>
              </div>
            </div>
          );
        })()}
      </div>

      <p className="section-description">
        Policies A–D have fixed costs regardless of the shock size.
        The budget-neutral policies (E, F) cost more as the shock grows:
        under the {scenario.name} scenario, fully offsetting the average
        household costs {fmtBn(scenario.total_cost_bn)}. The trade-off is
        clear — household budget neutrality requires the government to absorb
        the full cost of the shock.
      </p>
    </section>
  );
}


function NewPoliciesSection() {
  const neg = resultsV2.neg_policy;
  const rbt = resultsV2.rising_block_tariff;
  const gasCap = resultsV2.gas_price_cap;
  const [newPolicy, setNewPolicy] = useState("neg");
  const [selectedScenario, setSelectedScenario] = useState(0);

  const scenarioNames = results.shock_scenarios.map((s) => s.name);

  return (
    <section className="section" id="new-policies">
      <h2 className="section-title">Alternative policy designs</h2>
      <p className="section-description">
        The policies above replicate the 2022 response. <a href="#ref-bangham">Bangham (2026)</a> argues
        the government should use the next four months to build better
        infrastructure. Below we model three alternative designs that exploit
        the new electricity/gas data split.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <div className="scenario-pills">
          {[
            { key: "neg", label: "Energy Guarantee" },
            { key: "rbt", label: "Block tariff" },
            { key: "gas_cap", label: "Gas-only cap" },
          ].map((p) => (
            <button
              key={p.key}
              className={`scenario-pill${newPolicy === p.key ? " active" : ""}`}
              onClick={() => setNewPolicy(p.key)}
            >
              {p.key === "neg" ? "G" : p.key === "rbt" ? "H" : "I"}. {p.label}
            </button>
          ))}
        </div>
      </div>

      {newPolicy !== "rbt" && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: "0.8rem", color: "#64748b", fontWeight: 600 }}>SCENARIO</span>
          <div className="scenario-pills">
            {scenarioNames.map((name, i) => (
              <button
                key={i}
                className={`scenario-pill scenario-pill-sm${i === selectedScenario ? " active" : ""}`}
                onClick={() => setSelectedScenario(i)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="policy-card" style={{ marginBottom: 24 }}>
        {newPolicy === "neg" && (
          <>
            <div className="chart-title">G. {neg.name}</div>
            <p className="section-description" style={{ margin: "8px 0 16px" }}>
              {neg.description}
            </p>
            <div className="kpi-row">
              <KpiCard label="Threshold" value={`${neg.threshold_kwh.toLocaleString()} kWh`} />
              <KpiCard label="Threshold (£)" value={fmt(neg.threshold_spend)} unit="/yr" />
              <KpiCard label="Exchequer cost" value={fmtBn(neg.scenarios[selectedScenario].exchequer_cost_bn)} />
              <KpiCard label="Avg benefit" value={fmt(neg.scenarios[selectedScenario].avg_benefit)} unit="/yr" />
            </div>
          </>
        )}
        {newPolicy === "rbt" && (
          <>
            <div className="chart-title">H. {rbt.name}</div>
            <p className="section-description" style={{ margin: "8px 0 16px" }}>
              {rbt.description}
            </p>
            <div className="kpi-row">
              <KpiCard label="Block 1 discount" value={`${rbt.discount_rate_pct}%`} />
              <KpiCard label="Block 2 surcharge" value={`${rbt.surcharge_rate_pct}%`} />
              <KpiCard label="Exchequer cost" value="£0" />
              <KpiCard label="Redistribution" value={fmtBn(rbt.total_subsidy_bn)} />
            </div>
          </>
        )}
        {newPolicy === "gas_cap" && (
          <>
            <div className="chart-title">I. {gasCap.name}</div>
            <p className="section-description" style={{ margin: "8px 0 16px" }}>
              {gasCap.description}
            </p>
            <div className="kpi-row">
              <KpiCard label="Exchequer cost" value={fmtBn(gasCap.scenarios[selectedScenario].exchequer_cost_bn)} />
              <KpiCard label="Avg gas subsidy" value={fmt(gasCap.scenarios[selectedScenario].avg_gas_subsidy)} unit="/yr" />
              <KpiCard label="Avg remaining cost" value={fmt(gasCap.scenarios[selectedScenario].avg_remaining_cost)} unit="/yr" />
            </div>
          </>
        )}
      </div>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">
              {newPolicy === "neg"
                ? `Shock offset by decile (${scenarioNames[selectedScenario]})`
                : newPolicy === "rbt"
                ? "Net effect by decile (baseline)"
                : `Gas subsidy vs remaining cost (${scenarioNames[selectedScenario]})`}
            </div>
            <div className="chart-subtitle">
              {newPolicy === "rbt" ? "Negative = household saves, positive = pays more" : "Annual £ per household"}
            </div>
          </div>
        </div>
        {(() => {
          let barData, maxVal;
          if (newPolicy === "neg") {
            const scen = neg.scenarios[selectedScenario];
            barData = scen.deciles.map((d) => ({
              label: `${d.decile}`,
              staticVal: d.benefit_extra_vs_baseline,
              behavVal: d.shock_extra,
            }));
            maxVal = Math.max(...barData.map((d) => Math.max(d.staticVal, d.behavVal))) * 1.15;
            const ticks = niceTicks(maxVal);
            const topTick = ticks[ticks.length - 1] || maxVal;
            const effectiveMax = Math.max(maxVal, topTick);
            return (
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{fmt(t)}</div>
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
                            NEG benefit: {fmt(d.staticVal)}, Shock: {fmt(d.behavVal)}
                          </div>
                          <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                            <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: "#10b981", borderRadius: "3px 3px 0 0" }} />
                            <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#ef4444", borderRadius: "3px 3px 0 0" }} />
                          </div>
                          <div className="col-chart-label">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="col-chart-x-label">Decile</div>
                <div className="col-chart-legend">
                  <span><span className="col-chart-legend-dot" style={{ background: "#10b981" }} />NEG benefit</span>
                  <span><span className="col-chart-legend-dot" style={{ background: "#ef4444" }} />Shock cost</span>
                </div>
              </div>
            );
          } else if (newPolicy === "rbt") {
            barData = rbt.deciles.map((d) => ({
              label: `${d.decile}`,
              value: d.net_effect,
            }));
            const absMax = Math.max(...barData.map((d) => Math.abs(d.value))) * 1.15;
            const ticks = niceTicks(absMax);
            const topTick = ticks[ticks.length - 1] || absMax;
            const effectiveMax = Math.max(absMax, topTick);
            return (
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{fmt(t)}</div>
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
                            Net: {d.value >= 0 ? "+" : ""}{fmt(d.value)}/yr
                          </div>
                          <div className="col-chart-track">
                            <div
                              className="col-chart-fill"
                              style={{
                                height: `${(Math.abs(d.value) / effectiveMax) * 100}%`,
                                background: d.value <= 0 ? "#10b981" : "#ef4444",
                                borderRadius: "3px 3px 0 0",
                              }}
                            />
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
            );
          } else {
            const scen = gasCap.scenarios[selectedScenario];
            barData = scen.deciles.map((d) => ({
              label: `${d.decile}`,
              staticVal: d.gas_subsidy,
              behavVal: d.remaining_cost,
            }));
            maxVal = Math.max(...barData.map((d) => Math.max(d.staticVal, d.behavVal))) * 1.15;
            const ticks = niceTicks(maxVal);
            const topTick = ticks[ticks.length - 1] || maxVal;
            const effectiveMax = Math.max(maxVal, topTick);
            return (
              <div className="col-chart">
                <div className="col-chart-body">
                  <div className="col-chart-y-axis">
                    {[...ticks].reverse().map((t, i) => (
                      <div className="col-chart-y-tick" key={i} style={{ bottom: `${(t / effectiveMax) * 100}%` }}>{fmt(t)}</div>
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
                            Gas subsidy: {fmt(d.staticVal)}, Remaining: {fmt(d.behavVal)}
                          </div>
                          <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                            <div className="col-chart-fill" style={{ height: `${(d.staticVal / effectiveMax) * 100}%`, width: "48%", background: "#3b82f6", borderRadius: "3px 3px 0 0" }} />
                            <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#ef4444", borderRadius: "3px 3px 0 0" }} />
                          </div>
                          <div className="col-chart-label">{d.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="col-chart-x-label">Decile</div>
                <div className="col-chart-legend">
                  <span><span className="col-chart-legend-dot" style={{ background: "#3b82f6" }} />Gas subsidy</span>
                  <span><span className="col-chart-legend-dot" style={{ background: "#ef4444" }} />Remaining cost</span>
                </div>
              </div>
            );
          }
        })()}
      </div>

      <p className="section-description">
        The National Energy Guarantee (G) is the most progressive: it covers
        a larger share of spending for low-income households. The rising block
        tariff (H) achieves redistribution at zero exchequer cost — low users
        save while high users pay more. The gas-only cap (I) targets the most
        volatile fuel at lower fiscal cost than capping total energy bills.
        These designs respond to <a href="#ref-bangham">Bangham's (2026)</a> call for better
        infrastructure built before the next price cap change on 30 June.
      </p>
    </section>
  );
}


function ConstituencyMapSection() {
  return (
    <section className="section" id="constituency-map">
      <h2 className="section-title">Constituency-level impacts</h2>
      <p className="section-description">
        Energy burden and price shock impacts vary widely across the UK's 650
        parliamentary constituencies. This map shows how each constituency
        is affected, computed by applying constituency-specific population
        weights to household-level microsimulation data. Hover over a
        constituency to see detailed metrics, or use the search bar to find
        a specific area. Switch between metrics using the buttons above the
        map.
      </p>
      <ConstituencyMap data={constituencyData} />
    </section>
  );
}


export default function Dashboard() {
  return (
    <div className="narrative-container">
      <header className="narrative-hero">
        <h1>Energy price shock: distributional impact and policy options</h1>
        <p className="narrative-lead">
          This analysis estimates the distributional impact of five
          energy price shock scenarios across income deciles, with separate
          electricity and gas breakdowns, and models nine policy responses
          including three new designs for the next crisis.
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
        £300 growth in living standards expected this year.<a href="#fn-4"><sup>4</sup></a>
      </p>
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
        spending was lost to inefficiency (<a href="#ref-levell">Levell et al., 2025</a>). More
        broadly, oil price shocks have triggered recessions since the
        1970s, though their macroeconomic impact has diminished over time
        (<a href="#ref-blanchard">Blanchard and Galí, 2010</a>). Price increases tend to reduce output
        more than equivalent decreases boost it (<a href="#ref-kilian">Kilian, 2008</a>). Even in
        the absence of a crisis, energy price volatility alone costs around
        0.8% of consumption per year (<a href="#ref-manzano">Manzano and Rey, 2013</a>).
      </p>
      <p className="section-description">
        Under current Ofgem rules,<a href="#fn-5"><sup>5</sup></a> the
        price cap for April to June is already set at £1,641, so household
        bills would not change before 1 July. From July, the cap will
        reflect wholesale market conditions. This analysis models five
        price shock scenarios, from a 10% increase to
        a return to 2022-level prices. For each, it estimates the extra
        cost per household across income deciles, the impact on fuel
        poverty rates, and the distributional effects of six policy
        responses — an Energy Price Guarantee, a flat transfer, a council
        tax band rebate, an expanded Winter Fuel Allowance, and two
        budget-neutral variants — plus three alternative designs: a
        National Energy Guarantee, a rising block tariff, and a gas-only
        price cap. All modelling uses the PolicyEngine
        UK microsimulation model with separate electricity and gas
        imputations calibrated to NEED 2023 admin
        data.<a href="#fn-6"><sup>6</sup></a>
      </p>
      </section>

      <BaselineSection />
      <ShockSection />
      <PolicySection />
      <PolicyNetSection />
      <SummarySection />
      <NewPoliciesSection />
      <ConstituencyMapSection />

      <hr style={{ border: "none", borderTop: "1px solid #e2e8f0", margin: "48px 0" }} />

      <section className="section" id="references">
        <h2 className="section-title">References</h2>

        <div className="chart-title" style={{ marginBottom: 12 }}>Academic literature</div>
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
        </ol>
      </section>
    </div>
  );
}
