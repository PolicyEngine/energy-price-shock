import { useState, useEffect, useRef } from "react";
import resultsUK from "../data/results.json";
import resultsV2UK from "../data/results_v2.json";
import resultsEngland from "../data/results_england.json";
import resultsV2England from "../data/results_v2_england.json";
import resultsScotland from "../data/results_scotland.json";
import resultsV2Scotland from "../data/results_v2_scotland.json";
import resultsWales from "../data/results_wales.json";
import resultsV2Wales from "../data/results_v2_wales.json";
import resultsNI from "../data/results_northern_ireland.json";
import resultsV2NI from "../data/results_v2_northern_ireland.json";
import "./Dashboard.css";

const ALL_DATA = {
  UK: { results: resultsUK, v2: resultsV2UK },
  ENGLAND: { results: resultsEngland, v2: resultsV2England },
  SCOTLAND: { results: resultsScotland, v2: resultsV2Scotland },
  WALES: { results: resultsWales, v2: resultsV2Wales },
  NORTHERN_IRELAND: { results: resultsNI, v2: resultsV2NI },
};

const COUNTRY_OPTIONS = [
  { key: "UK", label: "UK" },
  { key: "ENGLAND", label: "England" },
  { key: "SCOTLAND", label: "Scotland" },
  { key: "WALES", label: "Wales" },
  { key: "NORTHERN_IRELAND", label: "N. Ireland" },
];

function useData(country) {
  const d = ALL_DATA[country];
  return { results: d.results, resultsV2: d.v2 };
}

function ExpandablePillRow({ label, options, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const activeLabel = options.find((o) => o.key === value)?.label || value;

  useEffect(() => {
    if (!open) return;
    const handle = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div className="pill-row expandable" ref={ref}>
      <span className="pill-row-label">{label}</span>
      <button className="pill-row-collapsed" onClick={() => setOpen(!open)}>
        <span className="pill-row-active">{activeLabel}</span>
        <span className="pill-row-chevron">{open ? "\u25B4" : "\u25BE"}</span>
      </button>
      {open && (
        <div className="pill-row-dropdown">
          {options.map((o) => (
            <button
              key={o.key}
              className={`pill-row-option${value === o.key ? " active" : ""}`}
              onClick={() => { onChange(o.key); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const fmt = (v) => `£${v.toLocaleString("en-GB")}`;
const fmtBn = (v) => `£${v}bn`;

const POLICY_META = {
  flat_transfer: {
    fullName: "Flat transfer (£400 per household)",
    description: <>
      Every household receives a £400 credit on its energy bill, regardless of income, tenure, or consumption. This replicates the Energy Bills
      Support Scheme (EBSS) paid in autumn/winter 2022.<a href="#fn-9"><sup>9</sup></a> We model it as a lump-sum deduction from each household's
      post-shock energy cost.
    </>,
  },
  ct_rebate: {
    fullName: "Council tax band rebate (£300 for bands A–D, England only)",
    description: <>
      An England-only £300 payment to households in council tax bands A through D. The 2022 Council Tax Rebate was £150; this dashboard models £300.<a href="#fn-10"><sup>10</sup></a>
      PolicyEngine takes council tax bands directly from the Family Resources Survey and calibrates household weights so the band distribution matches VOA administrative counts by region. Bands A–D cover roughly 63% of English
      dwellings.<a href="#fn-11"><sup>11</sup></a>
    </>,
  },
  bn_transfer: {
    fullName: "Shock-matching flat transfer",
    description: <>
      Every household receives a flat payment equal to the average static extra cost across all households under the selected
      scenario. Aggregate payout therefore matches aggregate shock cost, but higher-consuming households
      receive the same amount as lower-consuming households.
    </>,
  },
  bn_epg: {
    fullName: "Cap-freeze subsidy (bills held at £1,641)",
    description: <>
      The government holds every household's bill at the pre-shock level of £1,641/yr and
      subsidises the full price increase.<a href="#fn-6"><sup>6</sup></a> Each household's subsidy equals its actual bill increase, so every decile's net extra cost
      is zero. The exchequer bears the full shock cost but achieves 100% offset for all households.
      This differs from the 2022 Energy Price Guarantee, which capped bills at £2,500 rather than freezing them at the pre-shock level:
      we model it by setting each household's bill to the pre-shock level and computing the subsidy as the difference.
    </>,
  },
  neg: {
    fullName: "National Energy Guarantee (NEG)",
    description: <>
      Based on the proposal in <a href="#ref-bangham">Bangham (2026)</a>: each household's first 2,900 kWh/yr of electricity
      (the median) is held at the pre-shock unit price, with the government paying the difference; consumption above that
      threshold is charged the shocked price. Low-income households tend to consume less electricity, so a larger share of
      their bill falls below the threshold.
    </>,
  },
};

function KpiCard({ label, value, unit, color, info }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${color || ""}`}>
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </div>
      {info && <div className="metric-info">{info}</div>}
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
  const [country, setCountry] = useState("UK");
  const { results, resultsV2 } = useData(country);
  const { baseline } = results;
  const split = resultsV2.energy_split;
  const tenureData = resultsV2.tenure;
  const hhTypeData = resultsV2.household_type.filter((h) => h.hh_type !== "OTHER");
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
  };
  const COUNTRY_LABELS = {
    ENGLAND: "England",
    SCOTLAND: "Scotland",
    WALES: "Wales",
    NORTHERN_IRELAND: "N. Ireland",
  };
  const countryData = resultsV2.country;
  // Build chart data for current metric + breakdown combo
  let xLabel;
  const bk = breakdownView;

  if (bk === "decile") xLabel = "Decile";
  else if (bk === "hh_type") xLabel = "Household type";
  else if (bk === "country") xLabel = "Country";
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
    if (bk === "country") return countryData.map((c) => ({
      label: COUNTRY_LABELS[c.country] || c.country,
      elec: c.electricity, gas: c.gas, net_income: c.net_income, energy_burden_pct: c.energy_burden_pct,
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
    else items.sort((a, b) => b.energy_burden_pct - a.energy_burden_pct);
  }

  let stackedBarData, stackedMaxVal, stackedFmtVal, stackedLegendA, stackedLegendB, stackedColorA, stackedColorB;
  let yLabel;

  if (baselineView === "elec_gas") {
    stackedBarData = items.map((it) => ({ label: it.label, elec: it.elec, gas: it.gas }));
    stackedMaxVal = Math.max(...stackedBarData.map((d) => d.elec + d.gas)) * 1.15;
    stackedFmtVal = (v) => fmt(v);
    stackedLegendA = "Electricity"; stackedLegendB = "Gas";
    stackedColorA = "#f59e0b"; stackedColorB = "#3b82f6";
    yLabel = "£/yr";
  } else {
    stackedBarData = items.map((it) => {
      const elecPct = it.elec_burden_pct != null ? it.elec_burden_pct : +(it.elec / it.net_income * 100).toFixed(1);
      const gasPct = it.gas_burden_pct != null ? it.gas_burden_pct : +(it.gas / it.net_income * 100).toFixed(1);
      return { label: it.label, elec: elecPct, gas: gasPct };
    });
    stackedMaxVal = Math.max(...stackedBarData.map((d) => d.elec + d.gas)) * 1.15;
    stackedFmtVal = (v) => `${v.toFixed(1)}%`;
    stackedLegendA = "Electricity"; stackedLegendB = "Gas";
    stackedColorA = "#f59e0b"; stackedColorB = "#3b82f6";
    yLabel = "% of income";
  }

  return (
    <div id="baseline">
      <h2 className="section-heading">Baseline energy burden</h2>

      <p className="section-description">
        Household energy bills are split between
        electricity ({split.elec_share_pct}% of spending)
        and gas ({(100 - split.elec_share_pct).toFixed(1)}%). Gas prices are
        more volatile because they are directly linked to{" "}
        <a href="https://www.ofgem.gov.uk/information-consumers/energy-advice-households/energy-price-cap-explained" target="_blank" rel="noopener noreferrer">wholesale markets</a>,
        so a geopolitical shock feeds through primarily via gas. Electricity
        prices also rise because gas-fired power stations set the marginal
        price. ONS estimates that the lowest-income decile spends roughly 7% of income on energy,
        compared with around 2% for the highest.<a href="#fn-7"><sup>7</sup></a>{" "}
        The figure below shows the baseline energy burden by decile, tenure and household type.
      </p>

      <div className="metric-row">
        <KpiCard label="Avg electricity" value={fmt(split.mean_electricity)} unit="/yr" info="Mean annual household electricity bill before any price shock, based on imputed consumption from NEED 2023 data." />
        <KpiCard label="Avg gas" value={fmt(split.mean_gas)} unit="/yr" info="Mean annual household gas bill before any price shock, based on imputed consumption from NEED 2023 data." />
        <KpiCard label="Avg total energy" value={fmt(baseline.mean_energy_spend)} unit="/yr" info="Mean annual combined electricity and gas bill per household at current prices." />
      </div>

      <div className="section-card">
      <div className="pill-rows">
        <CountryPills value={country} onChange={setCountry} />
        <ExpandablePillRow
          label="METRIC"
          options={[
            { key: "elec_gas", label: "Energy (£/yr)" },
            { key: "energy_share", label: "Energy / income (%)" },
          ]}
          value={baselineView}
          onChange={setBaselineView}
        />
        <ExpandablePillRow
          label="BREAKDOWN"
          options={[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
          ]}
          value={breakdownView}
          onChange={setBreakdownView}
        />
      </div>

        <div className="chart-wrapper">
          {(() => {
            const ticks = niceTicks(stackedMaxVal);
            const topTick = ticks[ticks.length - 1] || stackedMaxVal;
            const effectiveMax = Math.max(stackedMaxVal, topTick);
            return (
              <div className="col-chart">
                {yLabel && <div className="col-chart-y-label">{yLabel}</div>}
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
          })()}
        </div>

      </div>

    </div>
  );
}

function ShockSection() {
  const [country, setCountry] = useState("UK");
  const { results, resultsV2 } = useData(country);
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
    COUPLE_WITH_CHILDREN: "Couple + kids", LONE_PARENT: "Lone parent",
  };
  const COUNTRY_LABELS = {
    ENGLAND: "England", SCOTLAND: "Scotland", WALES: "Wales", NORTHERN_IRELAND: "N. Ireland",
  };
  // Build bar data based on breakdown
  const isPct = shockMetric === "pct_of_income";

  // Helper to pick the right static/behavioral field from a row
  const getStaticVal = (d) => {
    if (shockMetric === "pct_of_income") return d.pct_of_income;
    if (shockMetric === "extra_cost") return d.extra_cost;
    return 0;
  };
  const getBehavVal = (bd) => {
    if (!bd) return 0;
    if (shockMetric === "pct_of_income") return bd.behavioral_pct_of_income;
    if (shockMetric === "extra_cost") return bd.behavioral_extra_cost;
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
    barData = scenario.by_hh_type.filter((d) => d.hh_type !== "OTHER").map((d) => {
      const bd = behav.by_hh_type.find((b) => b.hh_type === d.hh_type);
      return {
        label: HH_TYPE_LABELS[d.hh_type] || d.hh_type,
        staticVal: getStaticVal(d),
        behavVal: getBehavVal(bd),
      };
    });
  } else if (shockBreakdown === "country") {
    xLabel = "Country";
    barData = scenario.by_country.map((d) => {
      const bd = behav.by_country.find((b) => b.country === d.country);
      return {
        label: COUNTRY_LABELS[d.country] || d.country,
        staticVal: getStaticVal(d),
        behavVal: getBehavVal(bd),
      };
    });
  }

  // Sort non-decile breakdowns by static value descending
  if (shockBreakdown !== "decile") {
    barData.sort((a, b) => b.staticVal - a.staticVal);
  }

  return (
    <div id="shocks">
      <h2 className="section-heading">Price shock scenarios</h2>
      <p className="section-description">
        We model five scenarios in which the Ofgem price cap rises from the current level of £1,641
        (dual-fuel, direct-debit, typical consumption). Ofgem resets the cap quarterly using observed
        wholesale gas and electricity costs, so a wholesale-price shock passes through to household
        unit rates at the next cap update, raising the £/kWh paid for every unit of energy consumed. The largest scenario, "Q1 2023 peak" (£4,279), is the
        cap level Ofgem announced for January–March 2023, the peak of the 2022–23 energy crisis.<a href="#fn-8"><sup>8</sup></a>
      </p>

      <details className="expandable-table">
        <summary>View scenarios</summary>
        <div className="scenario-chips">
          {results.shock_scenarios.map((s, i) => (
            <div className="scenario-chip" key={i}><span className="scenario-chip-label">{s.name}</span><span className="scenario-chip-value">£{s.new_cap.toLocaleString()}</span></div>
          ))}
        </div>
      </details>

      <p className="section-description">
        All charts include a <strong>static</strong> estimate (no change in
        consumption) and a <strong>behavioural</strong> estimate that applies a
        single uniform short-run price elasticity of −0.15, the overall energy
        median from a meta-analysis of 966 estimates (<a href="#ref-labandeira">Labandeira,
        Labeaga and López-Otero, 2017</a>, Table 3). Elasticities vary by income:{" "}
        <a href="#ref-priesmann">Priesmann and Praktiknjo (2025)</a> report
        short-run gas price elasticities from −0.64 (low-income) to −0.11
        (high-income). Under a single-elasticity behavioural estimate, low-income consumption
        reductions are therefore closer to the average than under an income-differentiated estimate.
        The figure below shows the 2026–27 extra cost and income
        share of each scenario by decile, tenure and household type.
      </p>

      <div className="section-card">
      <div className="pill-rows">
        <CountryPills value={country} onChange={setCountry} />
        <ExpandablePillRow
          label="SCENARIO"
          options={results.shock_scenarios.map((s, i) => ({ key: String(i), label: s.name }))}
          value={String(selected)}
          onChange={(v) => setSelected(Number(v))}
        />
        <ExpandablePillRow
          label="METRIC"
          options={[
            { key: "pct_of_income", label: "% of income" },
            { key: "extra_cost", label: "Extra cost (£/yr)" },
          ]}
          value={shockMetric}
          onChange={setShockMetric}
        />
        <ExpandablePillRow
          label="RESPONSE"
          options={[
            { key: "behavioural", label: "Behavioural" },
            { key: "static", label: "Static" },
            { key: "both", label: "Both" },
          ]}
          value={shockResponse}
          onChange={setShockResponse}
        />
        <ExpandablePillRow
          label="BREAKDOWN"
          options={[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
          ]}
          value={shockBreakdown}
          onChange={setShockBreakdown}
        />
      </div>

      <div className="metric-row">
        <KpiCard label="New price cap" value={fmt(scenario.new_cap)} unit="/yr" color="teal" info="The Ofgem price cap after the shock is applied. This is the cap level that determines household bills." />
        <KpiCard label="Static avg hit" value={fmt(scenario.avg_hh_hit_yr)} unit="/yr" info="Average extra annual cost per household assuming no change in energy consumption (static estimate)." />
        <KpiCard label="Behavioural avg hit" value={fmt(behav.behavioral_avg_extra)} unit="/yr" color="teal" info="Average extra annual cost after households reduce consumption in response to higher prices (elasticity = -0.15)." />
        <KpiCard label="Consumption change" value={`${behav.consumption_change_pct}%`} info="Percentage reduction in energy consumption due to the price increase, based on a short-run price elasticity of -0.15." />
      </div>

        <div className="chart-wrapper">
          {(() => {
            const showStatic = shockResponse === "static" || shockResponse === "both";
            const showBehav = shockResponse === "behavioural" || shockResponse === "both";
            const showBoth = showStatic && showBehav;
            const maxVal = Math.max(...barData.map((d) => Math.max(
              showStatic ? d.staticVal : 0,
              showBehav ? d.behavVal : 0
            ))) * 1.15;
            const ticks = niceTicks(maxVal, shockMetric === "pct_of_income" ? 8 : 5);
            const topTick = ticks[ticks.length - 1] || maxVal;
            const effectiveMax = Math.max(maxVal, topTick);
            const fmtVal = shockMetric === "pct_of_income" ? (v) => `${v.toFixed(2)}%`
              : (v) => fmt(v);
            const shockYLabel = shockMetric === "pct_of_income" ? "% of income" : "£/yr";
            return (
              <div className="col-chart">
                <div className="col-chart-y-label">{shockYLabel}</div>
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
                              <div className="col-chart-fill" style={{ height: `${(d.behavVal / effectiveMax) * 100}%`, width: "48%", background: "#64748b", borderRadius: "3px 3px 0 0" }} />
                            </div>
                          ) : (
                            <div className="col-chart-track">
                              <div className="col-chart-fill" style={{
                                height: `${((showStatic ? d.staticVal : d.behavVal) / effectiveMax) * 100}%`,
                                background: showStatic ? "#94a3b8" : "#64748b",
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
                  {showBehav && <span><span className="col-chart-legend-dot" style={{ background: "#64748b" }} />Behavioural</span>}
                </div>
              </div>
            );
          })()}
        </div>

      </div>
    </div>
  );
}


function PolicyNetSection() {
  const [country, setCountry] = useState("UK");
  const { results, resultsV2 } = useData(country);
  const { policies } = results;
  const nHH = results.baseline.n_households_m;
  const neg = resultsV2.neg_policy;
  const policyKeys = ["flat_transfer", "bn_transfer", "bn_epg", "neg", "ct_rebate"];
  const policyLabels = {
    flat_transfer: "Flat transfer", ct_rebate: "CT rebate",
    bn_transfer: "Shock-match", bn_epg: "Cap-freeze subsidy",
    neg: "Energy Guarantee",
  };
  const TENURE_LABELS = {
    OWNED_OUTRIGHT: "Owned outright", OWNED_WITH_MORTGAGE: "Mortgage",
    RENT_PRIVATELY: "Private rent", RENT_FROM_COUNCIL: "Council rent", RENT_FROM_HA: "Housing assoc.",
  };
  const HH_TYPE_LABELS = {
    SINGLE_PENSIONER: "Single pensioner", COUPLE_PENSIONER: "Couple pensioner",
    SINGLE_WORKING_AGE: "Single (WA)", COUPLE_NO_CHILDREN: "Couple, no kids",
    COUPLE_WITH_CHILDREN: "Couple + kids", LONE_PARENT: "Lone parent",
  };
  const COUNTRY_LABELS = {
    ENGLAND: "England", SCOTLAND: "Scotland", WALES: "Wales", NORTHERN_IRELAND: "N. Ireland",
  };
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [selectedNet, setSelectedNet] = useState("flat_transfer");
  const [policyResponse, setPolicyResponse] = useState("behavioural");
  const [policyBreakdown, setPolicyBreakdown] = useState("decile");

  const scenario = results.shock_scenarios[selectedScenario];
  const behav = results.behavioral[selectedScenario];
  const scenarioName = scenario.name;
  const isAlt = selectedNet === "neg";
  const bk = policyBreakdown;
  const geographyLabel = country === "UK" ? "the UK" : COUNTRY_OPTIONS.find((option) => option.key === country)?.label || country;
  const breakdownLabel = bk === "decile" ? "group" : bk === "tenure" ? "tenure group" : bk === "hh_type" ? "household type" : "country";

  useEffect(() => {
    if (selectedNet === "ct_rebate" && country !== "ENGLAND") {
      setCountry("ENGLAND");
    }
  }, [selectedNet, country]);

  // === KPI computation (independent of breakdown) ===
  let avgBenefit = 0, exchequerCost = 0;
  if (selectedNet === "bn_transfer") { avgBenefit = scenario.avg_hh_hit_yr; exchequerCost = Math.round(scenario.avg_hh_hit_yr * nHH / 100) / 10; }
  else if (selectedNet === "bn_epg") { avgBenefit = scenario.avg_hh_hit_yr; exchequerCost = scenario.total_cost_bn; }
  else if (selectedNet === "neg") { const s = neg.scenarios[selectedScenario]; avgBenefit = s.avg_benefit; exchequerCost = s.exchequer_cost_bn; }
  else {
    const p = policies[selectedNet];
    avgBenefit = p.avg_hh_benefit;
    exchequerCost = p.exchequer_cost_bn;
  }
  const avgStaticShock = scenario.avg_hh_hit_yr;
  const avgBehavShock = behav.behavioral_avg_extra;

  // === Chart data computation ===
  let barData, xLabel;
  let chartMode = "standard";
  let chartMessage = "";

  if (bk === "decile") {
    // Post-policy decile — all policies
    xLabel = "Decile";
    if (selectedNet === "neg") {
      chartMode = "neg";
      const scen = neg.scenarios[selectedScenario];
      barData = scen.deciles.map((d, i) => ({
        label: `${d.decile}`,
        benefit: d.benefit_extra_vs_baseline,
        shockStatic: d.shock_extra,
        shockBehav: behav.deciles[i].behavioral_extra_cost,
      }));
    } else if (selectedNet === "bn_epg") {
      barData = scenario.deciles.map((d) => ({ label: `${d.decile}`, staticVal: 0, behavVal: 0 }));
      chartMessage = `The ${policyLabels[selectedNet]} fully offsets the ${scenarioName} shock for all households.`;
    } else {
      // Standard policies — use policy_post_shock data
      const pfp = results.policy_post_shock?.[selectedNet]?.[selectedScenario];
      if (pfp) {
        barData = pfp.deciles.map((d) => ({
          label: `${d.decile}`, staticVal: d.extra_cost, behavVal: d.behavioral_extra_cost,
        }));
      } else {
        barData = scenario.deciles.map((d) => ({ label: `${d.decile}`, staticVal: 0, behavVal: 0 }));
      }
    }
  } else if (selectedNet === "bn_epg") {
    // Cap-freeze subsidy fully offsets every household — show zero bars
    const items = bk === "tenure" ? scenario.by_tenure.map((d) => ({ label: TENURE_LABELS[d.tenure] || d.tenure }))
      : bk === "hh_type" ? scenario.by_hh_type.filter((d) => d.hh_type !== "OTHER").map((d) => ({ label: HH_TYPE_LABELS[d.hh_type] || d.hh_type }))
      : scenario.by_country.map((d) => ({ label: COUNTRY_LABELS[d.country] || d.country }));
    barData = items.map((d) => ({ label: d.label, staticVal: 0, behavVal: 0 }));
    xLabel = bk === "tenure" ? "Tenure" : bk === "hh_type" ? "Household type" : "Country";
    chartMessage = `The ${policyLabels[selectedNet]} fully offsets the ${scenarioName} shock for all households.`;
  } else if (bk === "tenure" || bk === "hh_type" || bk === "country") {
    // Post-policy tenure/hh_type/country breakdown from policy_post_shock data
    xLabel = bk === "tenure" ? "Tenure" : bk === "hh_type" ? "Household type" : "Country";
    const pfp = results.policy_post_shock?.[selectedNet]?.[selectedScenario];
    let groupData = pfp ? (bk === "tenure" ? pfp.by_tenure : bk === "hh_type" ? pfp.by_hh_type : pfp.by_country) : null;
    if (groupData && bk === "hh_type") groupData = groupData.filter((d) => d.hh_type !== "OTHER");
    if (groupData) {
      const LABELS = bk === "tenure" ? TENURE_LABELS : bk === "hh_type" ? HH_TYPE_LABELS : COUNTRY_LABELS;
      const groupKey = bk === "tenure" ? "tenure" : bk === "hh_type" ? "hh_type" : "country";
      barData = groupData.map((d) => ({
        label: LABELS[d[groupKey]] || d[groupKey], staticVal: d.extra_cost, behavVal: d.behavioral_extra_cost,
      }));
      barData.sort((a, b) => b.staticVal - a.staticVal);
    } else {
      barData = [];
    }
  }

  const metricYLabel = "Extra cost after policy (£/yr)";

  const showStatic = policyResponse === "static" || policyResponse === "both";
  const showBehav = policyResponse === "behavioural" || policyResponse === "both";
  const showBoth = showStatic && showBehav;

  return (
    <div id="policy-net">
      <h2 className="section-heading">Policy responses</h2>
      <p className="section-description">
        This section models five policy responses to the price shock and compares
        their exchequer cost, average household benefit and distributional
        effects across income deciles, tenure and household type. The five policies below explore
        alternatives ranging from flat transfers to targeted designs:
      </p>

      <details className="expandable-table">
        <summary>Policy descriptions</summary>
        <ul className="policy-bullet-list">
          {policyKeys.map((key) => (
            <li key={key}>
              <strong>{POLICY_META[key].fullName}</strong>{" "}
              {POLICY_META[key].description}
            </li>
          ))}
        </ul>
      </details>
      <p className="section-description">
        The chart below shows the extra energy cost each group still faces after the selected policy is applied, broken down by decile, tenure, household type or country. A larger bar means a larger remaining burden for that group under the selected policy.
      </p>

      <div className="section-card">
      <div className="pill-rows">
        <CountryPills value={country} onChange={setCountry} />
        <ExpandablePillRow
          label="SCENARIO"
          options={results.shock_scenarios.map((s, i) => ({ key: String(i), label: s.name }))}
          value={String(selectedScenario)}
          onChange={(v) => setSelectedScenario(Number(v))}
        />
        <ExpandablePillRow
          label="POLICY"
          options={policyKeys.map((k) => ({ key: k, label: policyLabels[k] }))}
          value={selectedNet}
          onChange={setSelectedNet}
        />
<ExpandablePillRow
          label="RESPONSE"
          options={[
            { key: "behavioural", label: "Behavioural" },
            { key: "static", label: "Static" },
            { key: "both", label: "Both" },
          ]}
          value={policyResponse}
          onChange={setPolicyResponse}
        />
        <ExpandablePillRow
          label="BREAKDOWN"
          options={[
            { key: "decile", label: "By decile" },
            { key: "tenure", label: "By tenure" },
            { key: "hh_type", label: "By household type" },
          ]}
          value={policyBreakdown}
          onChange={setPolicyBreakdown}
        />
      </div>

      {/* KPI cards */}
      {selectedNet === "neg" && (() => {
        const scen = neg.scenarios[selectedScenario];
        return (
          <div className="metric-row">
            <KpiCard label="Threshold" value={`${neg.threshold_kwh.toLocaleString()} kWh`} info="Energy consumption threshold below which all usage is subsidised. Set at the median household level." />
            <KpiCard label="Baseline cost" value={fmtBn(neg.baseline_cost_bn)} info={`The NEG subsidises the first ${neg.threshold_kwh.toLocaleString()} kWh of electricity for all households. This is the programme cost with no price shock.`} />
            <KpiCard label="Extra cost from shock" value={fmtBn(Math.round((scen.exchequer_cost_bn - neg.baseline_cost_bn) * 10) / 10)} info={`Additional exchequer cost caused by the price shock (total £${scen.exchequer_cost_bn}bn minus baseline £${neg.baseline_cost_bn}bn). The NEG automatically scales with prices, so costs rise when energy prices rise.`} />
            <KpiCard label="Avg extra benefit" value={fmt(scen.avg_benefit - neg.avg_benefit_baseline)} unit="/yr" color="teal" info="Additional annual subsidy per household due to the price shock, above the baseline NEG benefit." />
          </div>
        );
      })()}
      {!isAlt && (
        <div className="metric-row">
          <KpiCard label="Avg shock (pre-policy)" value={fmt(policyResponse === "static" ? avgStaticShock : avgBehavShock)} unit="/yr" info="Average annual extra energy cost per household under the selected shock scenario, before any policy intervention." />
          <KpiCard label="Policy benefit" value={fmt(avgBenefit)} unit="/yr" color="teal" info="Average annual payment or subsidy each household receives from the selected policy. For shock-matching policies this equals the average shock." />
          <KpiCard label="Exchequer cost" value={fmtBn(exchequerCost)} info={`Total annual cost to the government of funding this policy across households in ${geographyLabel}.`} />
        </div>
      )}

      {/* ── Chart rendering ── */}
      {(() => {
        // NEG benefit vs shock
        if (chartMode === "neg") {
          const shockVal = (d) => showStatic ? d.shockStatic : d.shockBehav;
          const maxVal = Math.max(...barData.map((d) => Math.max(d.benefit, showBoth ? Math.max(d.shockStatic, d.shockBehav) : shockVal(d)))) * 1.15;
          const ticks = niceTicks(maxVal);
          const topTick = ticks[ticks.length - 1] || maxVal;
          const effectiveMax = Math.max(maxVal, topTick);
          return (
            <div className="chart-wrapper">
              <div className="col-chart">
                <div className="col-chart-y-label">Extra cost / benefit (£/yr)</div>
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
                              Extra NEG benefit: {fmt(d.benefit)}
                              {showBoth
                                ? `, Shock (static): ${fmt(d.shockStatic)}, Shock (behav): ${fmt(d.shockBehav)}`
                                : `, Shock: ${fmt(shock)}`}
                            </div>
                            <div className="col-chart-track" style={{ flexDirection: "row", gap: "2px", alignItems: "flex-end" }}>
                              <div className="col-chart-fill" style={{ height: `${(d.benefit / effectiveMax) * 100}%`, width: showBoth ? "32%" : "48%", background: "#94a3b8", borderRadius: "3px 3px 0 0" }} />
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
                  <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Extra NEG benefit</span>
                  {showStatic && <span><span className="col-chart-legend-dot" style={{ background: "#ef4444" }} />{showBoth ? "Shock (static)" : "Shock cost"}</span>}
                  {showBehav && <span><span className="col-chart-legend-dot" style={{ background: "#f97316" }} />{showBoth ? "Shock (behav)" : "Shock cost"}</span>}
                </div>
                <p className="chart-note">
                  The NEG subsidises the first {neg.threshold_kwh.toLocaleString()} kWh of electricity for all households, costing £{neg.baseline_cost_bn}bn/yr even with no price shock.
                  When prices rise, the same kWh costs more, so the subsidy automatically increases.
                  The gray bars show this additional benefit per decile (the gap between what the NEG pays at shocked prices vs. what it pays at current prices).
                  The red{showBehav ? "/orange" : ""} bars show the total shock cost, so where the shock bar exceeds the gray bar, households still face a net extra cost despite the NEG.
                </p>
              </div>
            </div>
          );
        }

        // Standard bar chart
        const allZero = barData && Math.max(...barData.map((d) => d.staticVal)) === 0 && Math.max(...barData.map((d) => d.behavVal)) === 0;

        const maxVal = Math.max(...barData.map((d) => Math.max(showStatic ? d.staticVal : 0, showBehav ? d.behavVal : 0))) * 1.15;
        const ticks = niceTicks(maxVal);
        const topTick = ticks[ticks.length - 1] || maxVal;
        const effectiveMax = Math.max(maxVal, topTick) || 10;

        const fmtChart = (v) => fmt(v);
        const barColorStatic = "#94a3b8";
        const barColorBehav = "#64748b";

        if (allZero && chartMessage) {
          return (
            <div className="chart-wrapper">
              <p style={{ color: "#64748b", fontWeight: 500, fontSize: "0.88rem", marginBottom: 12, textAlign: "center" }}>{chartMessage}</p>
            </div>
          );
        }

        return (
          <div className="chart-wrapper">
            <div className="col-chart">
              <div className="col-chart-y-label">{metricYLabel}</div>
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
                {showBehav && <span><span className="col-chart-legend-dot" style={{ background: "#64748b" }} />Behavioural</span>}
              </div>
            </div>
          </div>
        );
      })()}

      </div>

      <p className="section-description">
        Under the {scenarioName} scenario, the selected policy determines how
        much of the shock each {breakdownLabel} absorbs in {geographyLabel}. The shock-matching flat transfer
        gives every household the same amount, so higher-consuming groups receive less than
        they actually lose. The cap-freeze subsidy offsets each household's actual bill increase,
        eliminating the extra cost across all groups. Flat payments (flat transfer, council tax rebate)
        cover a larger share of the shock at lower cap levels.
      </p>

      <hr className="section-divider" />
    </div>
  );
}



function PolicyComparisonSection() {
  const [country, setCountry] = useState("UK");
  const { results, resultsV2 } = useData(country);
  const { policies } = results;
  const nHH = results.baseline.n_households_m;
  const neg = resultsV2.neg_policy;

  const policyKeys = ["flat_transfer", "bn_transfer", "bn_epg", "neg", "ct_rebate"];
  const policyLabels = {
    flat_transfer: "Flat transfer", ct_rebate: "CT rebate",
    bn_transfer: "Shock-match", bn_epg: "Cap-freeze subsidy",
    neg: "Energy Guarantee",
  };
  const policyBarLabels = {
    flat_transfer: "Flat transfer", ct_rebate: "CT rebate",
    bn_transfer: "Shock-match", bn_epg: "Cap-freeze subsidy", neg: "Energy Guarantee",
  };

  const [compScenario, setCompScenario] = useState(0);
  const [compResponse, setCompResponse] = useState("behavioural");
  const showStatic = compResponse === "static" || compResponse === "both";
  const showBehav = compResponse === "behavioural" || compResponse === "both";
  const showBoth = compResponse === "both";

  const scenarios = results.shock_scenarios;
  const scenario = scenarios[compScenario];
  const scenarioName = scenario.name;

  // Compute exchequer cost for each policy at the selected scenario (static + behavioural)
  const behav = results.behavioral[compScenario];
  const behavRatio = behav.behavioral_avg_extra / behav.static_avg_extra;
  const getExchequer = (pk) => {
    let staticCost, behavCost;
    if (pk === "bn_transfer") {
      // Shock-matching: pays the average hit, which differs under behavioural response
      staticCost = Math.round(scenario.avg_hh_hit_yr * nHH / 100) / 10;
      behavCost = Math.round(behav.behavioral_avg_extra * nHH / 100) / 10;
    } else if (pk === "bn_epg") {
      staticCost = scenario.total_cost_bn;
      behavCost = Math.round(staticCost * behavRatio * 10) / 10;
    } else if (pk === "neg") {
      staticCost = neg.scenarios[compScenario].exchequer_cost_bn;
      behavCost = Math.round(staticCost * behavRatio * 10) / 10;
    } else {
      // Fixed-amount policies (flat_transfer, ct_rebate): same cost regardless
      staticCost = policies[pk].exchequer_cost_bn;
      behavCost = staticCost;
    }
    return { staticVal: staticCost, behavVal: behavCost };
  };

  const exchequerData = policyKeys.map((pk) => {
    const e = getExchequer(pk);
    return { label: policyBarLabels[pk], staticVal: e.staticVal, behavVal: e.behavVal };
  });

  // Sort by value descending
  const sortVal = (d) => Math.max(d.staticVal || 0, d.behavVal || 0);
  const activeBarData = [...exchequerData].sort((a, b) => sortVal(b) - sortVal(a));

  const maxActive = Math.max(...activeBarData.map((d) => Math.max(showStatic ? d.staticVal : 0, showBehav ? d.behavVal : 0))) * 1.15 || 1;
  const activeTicks = niceTicks(maxActive);
  const activeFmt = (v) => `£${v}bn`;
  const activeColor = "#94a3b8";
  const activeColorB = "#64748b";


  const topTick = activeTicks[activeTicks.length - 1] || 1;
  const chartMax = Math.max(topTick, ...activeBarData.map((d) => Math.max(
    showStatic ? (d.staticVal || 0) : 0,
    showBehav ? (d.behavVal || 0) : 0
  ))) || 1;
  const effectiveMax = Math.max(chartMax, topTick);

  return (
    <div id="policy-comparison">
      <h2 className="section-heading">Policy at a glance</h2>
      <p className="section-description">
        The figure below compares the five modelled policies side by side on 2026–27 exchequer cost.
      </p>

      <div className="section-card">
      <div className="pill-rows">
        <CountryPills value={country} onChange={setCountry} />
        <ExpandablePillRow
          label="SCENARIO"
          options={scenarios.map((s, i) => ({ key: String(i), label: s.name }))}
          value={String(compScenario)}
          onChange={(v) => setCompScenario(Number(v))}
        />
        <ExpandablePillRow
          label="RESPONSE"
          options={[
            { key: "behavioural", label: "Behavioural" },
            { key: "static", label: "Static" },
            { key: "both", label: "Both" },
          ]}
          value={compResponse}
          onChange={setCompResponse}
        />
      </div>

      <div className="chart-wrapper">
        <div className="col-chart">
          <div className="col-chart-y-label">£bn</div>
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
      </div>

      {(() => {
        const s10 = scenarios[0];
        const sMax = scenarios[scenarios.length - 1];
        const d1 = results.baseline.deciles[0];
        const d10 = results.baseline.deciles[9];
        return (
          <p className="section-description" style={{ marginTop: 24 }}>
            A {s10.name} scenario adds £{s10.avg_hh_hit_yr.toLocaleString()}/yr to the average bill; under the {sMax.name} scenario the average hit reaches
            £{sMax.avg_hh_hit_yr.toLocaleString()}/yr. The lowest-income decile spends {d1.energy_share_pct}% of net income on energy versus {d10.energy_share_pct}%
            for the highest. The
            flat £{results.config.flat_transfer} transfer costs £{policies.flat_transfer.exchequer_cost_bn}bn, and the council tax rebate £{policies.ct_rebate.exchequer_cost_bn}bn.
            The cap-freeze subsidy and shock-matching transfer fully offset the average shock at higher exchequer cost.
          </p>
        );
      })()}
    </div>
  );
}

function CountryPills({ value, onChange }) {
  return (
    <ExpandablePillRow
      label="COUNTRY"
      options={COUNTRY_OPTIONS}
      value={value}
      onChange={onChange}
    />
  );
}

const TAB_OPTIONS = [
  { id: "impact", label: "Impact scenarios" },
  { id: "policy", label: "Policy responses" },
  { id: "methodology", label: "Methodology" },
];

function MethodologySection() {
  const { results } = useData("UK");
  const scenarios = results.shock_scenarios;
  const s10 = scenarios[0];
  const s60 = scenarios[3];
  const sMax = scenarios[scenarios.length - 1];
  const { policies } = results;
  const flatAmt = results.config.flat_transfer;
  const ctAmt = results.config.ct_rebate;
  const ctAvg = policies.ct_rebate.avg_hh_benefit;
  const s60hit = s60.avg_hh_hit_yr;
  const s10cost = Math.round(s10.avg_hh_hit_yr * results.baseline.n_households_m / 100) / 10;

  return (
    <div className="tab-content">
      <div className="section-card" style={{ marginBottom: 24 }}>
        <h2 className="section-heading">Key findings</h2>
        <ul className="policy-bullet-list">
          <li>Under <strong>no policy intervention</strong>, a price cap rise adds between <strong>£{s10.avg_hh_hit_yr.toLocaleString()}/year</strong> ({s10.name} scenario) and <strong>£{sMax.avg_hh_hit_yr.toLocaleString()}/year</strong> ({sMax.name} scenario) to the average household energy bill.</li>
          <li>A <strong>flat £{flatAmt} transfer</strong> costs <strong>£{policies.flat_transfer.exchequer_cost_bn}bn</strong> but covers less than half the <strong>£{s60hit.toLocaleString()}/year</strong> average hit under a {s60.name} scenario.</li>
          <li>A <strong>council tax band rebate</strong> (£{ctAmt} for bands A–D) costs <strong>£{policies.ct_rebate.exchequer_cost_bn}bn</strong> and delivers <strong>£{ctAvg.toLocaleString()}/year</strong> on average, leaving around <strong>£{(s60hit - ctAvg).toLocaleString()}/year</strong> residual under a {s60.name} scenario.</li>
          <li>A <strong>shock-matching flat transfer</strong> fully offsets the average household hit but costs the exchequer <strong>£{s10cost}bn</strong> for a {s10.name} scenario.</li>
        </ul>
      </div>

      <div className="methodology-two-col">
        <div className="section-card methodology-col">
          <h2 className="section-heading">Methodology</h2>
          <p className="section-description">
            All modelling uses{" "}
            <a href="https://policyengine.org" target="_blank" rel="noopener noreferrer">PolicyEngine UK</a>.<a href="#fn-5"><sup>5</sup></a>
            Household electricity and gas bills are imputed from the National Energy Efficiency Data-Framework (NEED) 2023
            administrative dataset. The baseline establishes 2026–27 energy costs across UK
            households under current Ofgem rules, with the price cap set at £1,641
            (dual-fuel, direct-debit, typical consumption).<a href="#fn-6"><sup>6</sup></a> All estimates are annualised.
          </p>
          <p className="section-description">
            Shock scenarios raise the Ofgem cap (four by a given percentage: +10%, +20%, +30%, +60%;
            and one to the Q1 2023 peak level of £4,279) and compute the extra cost and income share
            for each household. Behavioural estimates apply a short-run price
            elasticity of −0.15 (<a href="#ref-labandeira">Labandeira et al., 2017</a>). Five policy
            responses are modelled: a flat transfer, a council tax band rebate, a shock-matching
            flat transfer, a cap-freeze subsidy, and a National Energy Guarantee (NEG).
          </p>
        </div>

        <div className="section-card methodology-col">
          <h2 className="section-heading">Previous studies</h2>
          <p className="section-description">
            The most recent comparable episode, the 2022 European energy
            crisis, raised household living costs by around 7% of
            consumption, with lower-income households bearing a larger
            share (<a href="#ref-ari">Ari et al., 2022</a>). In the UK, average household losses
            reached 6% of income before government intervention. Households at
            the 10th income percentile lost 5 percentage points of income more than those
            at the 90th (<a href="#ref-levell">Levell et al., 2025</a>).
          </p>
          <p className="section-description">
            More broadly, oil price shocks have triggered recessions since the
            1970s, though their macroeconomic impact has diminished over time
            (<a href="#ref-blanchard">Blanchard and Galí, 2010</a>). Price increases tend to reduce output
            more than equivalent decreases boost it (<a href="#ref-kilian">Kilian, 2008</a>). Even in
            the absence of a crisis, energy price volatility alone costs around
            0.8% of consumption per year (<a href="#ref-manzano">Manzano and Rey, 2013</a>).
          </p>
        </div>
      </div>

      <details className="expandable-references" id="references">
        <summary className="section-heading">References</summary>

        <div className="chart-title" style={{ marginBottom: 12, marginTop: 16 }}>Academic literature</div>
        <ul className="policy-bullet-list" style={{ fontSize: "0.82rem", color: "var(--pe-color-gray-500)", lineHeight: 1.8 }}>
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
            <em>City AM</em>, "UK gas prices increase over 90 per cent amid US-Iran war," 3 March 2026.{" "}
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
            PolicyEngine, "Energy price shock: distributional impact and policy options," GitHub repository.{" "}
            <a href="https://github.com/PolicyEngine/energy-price-shock" target="_blank" rel="noopener noreferrer">github.com</a>
          </li>
          <li id="fn-6">
            Ofgem, "Energy price cap explained," accessed April 2026.{" "}
            <a href="https://www.ofgem.gov.uk/information-consumers/energy-advice-households/energy-price-cap-explained" target="_blank" rel="noopener noreferrer">ofgem.gov.uk</a>
          </li>
          <li id="fn-7">
            ONS, "Energy prices and their effect on households," February 2022.{" "}
            <a href="https://www.ons.gov.uk/economy/inflationandpriceindices/articles/energypricesandtheireffectonhouseholds/2022-02-01" target="_blank" rel="noopener noreferrer">ons.gov.uk</a>
          </li>
          <li id="fn-8">
            Ofgem, "Energy price cap (default tariff) levels," accessed April 2026. The Q1 2023 cap (1 January – 31 March 2023) was set at £4,279/yr for a typical dual-fuel direct-debit household, the peak announced cap during the 2022–23 energy crisis.{" "}
            <a href="https://www.ofgem.gov.uk/energy-regulation/domestic-and-non-domestic/energy-pricing-rules/energy-price-cap/energy-price-cap-default-tariff-levels" target="_blank" rel="noopener noreferrer">ofgem.gov.uk</a>
          </li>
          <li id="fn-9">
            DESNZ, "Energy Bills Support Scheme," GOV.UK, 2022. A £400 non-repayable discount applied to electricity bills in six monthly instalments (October 2022 – March 2023) for all domestic electricity customers.{" "}
            <a href="https://www.gov.uk/get-help-energy-bills/energy-bills-support-scheme" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-10">
            DLUHC, "Council Tax Rebate: guidance for billing authorities," GOV.UK, 2022. A one-off £150 payment to households in council tax bands A–D in England.{" "}
            <a href="https://www.gov.uk/government/publications/the-council-tax-rebate-2022-23-billing-authority-guidance" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-11">
            VOA, "Council tax: stock of properties," GOV.UK, 2024. Valuation Office Agency data on the distribution of dwellings by council tax band in England.{" "}
            <a href="https://www.gov.uk/government/statistics/council-tax-stock-of-properties-2024" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-12">
            DESNZ, "Energy Price Guarantee," GOV.UK, 2023. The EPG capped the unit rate for electricity and gas so a typical household paid no more than £2,500/yr. Suppliers were compensated for the shortfall.{" "}
            <a href="https://www.gov.uk/government/publications/energy-price-guarantee/energy-price-guarantee" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
          <li id="fn-13">
            HM Treasury, "Energy bills support factsheet," GOV.UK, updated 2023. Details the Energy Price Guarantee, Energy Bills Support Scheme (£400 flat transfer), and Council Tax Rebate.{" "}
            <a href="https://www.gov.uk/government/publications/energy-bills-support/energy-bills-support-factsheet-8-september-2022" target="_blank" rel="noopener noreferrer">gov.uk</a>
          </li>
        </ol>
      </details>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("impact");

  // Auto-switch to methodology tab and scroll when clicking reference links
  useEffect(() => {
    const handler = (e) => {
      const link = e.target.closest('a[href^="#ref-"], a[href^="#fn-"]');
      if (!link) return;
      e.preventDefault();
      setActiveTab("methodology");
      const targetId = link.getAttribute("href").slice(1);
      setTimeout(() => {
        // Expand references section if collapsed
        const details = document.querySelector(".expandable-references");
        if (details && !details.open) details.open = true;
        const el = document.getElementById(targetId);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  return (
    <div className="app-shell">
      <header className="title-row">
        <div className="title-row-inner">
          <h1>Energy price shock: Distributional impact & policy options</h1>
        </div>
      </header>

      <main className="main-content">
        <p className="intro-text">
          Since February 2026, military strikes on Iran have disrupted Strait of Hormuz shipping
          (~20% of global oil and gas), increasing UK wholesale gas prices over 90%.<a href="#fn-1"><sup>1</sup></a>
          Cornwall Insight forecasts the July 2026 Ofgem cap at £1,801, around +10% on the current cap.<a href="#fn-2"><sup>2</sup></a>
          Stifel analysts estimate a sustained closure could push it to £2,500.<a href="#fn-3"><sup>3</sup></a>
          Resolution Foundation estimates the combined energy-bill and motor-fuel rises could leave a
          typical household £480 worse off in 2026.<a href="#fn-4"><sup>4</sup></a>
        </p>
        <p className="intro-text">
          This dashboard uses PolicyEngine UK to estimate the distributional impact of five
          price-shock scenarios.<a href="#fn-5"><sup>5</sup></a> Electricity and gas bills are imputed
          from the National Energy Efficiency Data-Framework (NEED) 2023. Under current Ofgem rules,
          the cap is £1,641 (dual-fuel, direct-debit, typical consumption); all figures are annual
          values for the 2026–27 fiscal year.<a href="#fn-6"><sup>6</sup></a> The{" "}
          <strong>Impact scenarios</strong> tab models baseline burden and shock effects. The{" "}
          <strong>Policy responses</strong> tab evaluates five interventions. The{" "}
          <strong>Methodology</strong> tab explains the approach and data sources.
        </p>

        <div className="tab-bar">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-button ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "impact" && (
          <div className="tab-content">
            <BaselineSection />
            <hr className="section-divider" />
            <ShockSection />
          </div>
        )}

        {activeTab === "policy" && (
          <div className="tab-content">
            <PolicyNetSection />
            <PolicyComparisonSection />
          </div>
        )}

        {activeTab === "methodology" && <MethodologySection />}

        <footer className="dashboard-footer">
          <p>
            Replication code:{" "}
            <a href="https://github.com/PolicyEngine/energy-price-shock" target="_blank" rel="noopener noreferrer">
              PolicyEngine/energy-price-shock
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
