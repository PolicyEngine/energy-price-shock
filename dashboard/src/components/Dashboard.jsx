import { useState } from "react";
import results from "../data/results.json";
import "./Dashboard.css";

const fmt = (v) => `£${v.toLocaleString("en-GB")}`;
const fmtBn = (v) => `£${v}bn`;

const POLICY_META = {
  epg: {
    letter: "A",
    fullName: "Energy Price Guarantee (EPG)",
    description:
      "Government caps bills at £2,500/yr and subsidises the difference. Proportional to consumption, so higher users get more. Covers ~9% of each household's bill in this scenario.",
    targeting: "Proportional to energy spend; higher spenders get more £",
  },
  flat_transfer: {
    letter: "B",
    fullName: "Flat transfer (£400 per household)",
    description:
      "£400 credited to every household's energy bill. Progressive in percentage terms but untargeted. Costs £12.8bn for 31.9m households.",
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
  const [baselineView, setBaselineView] = useState("energy_share");

  const views = {
    energy_share: {
      label: "Energy / income (%)",
      data: baseline.deciles.map((d) => ({
        label: `${d.decile}`,
        value: d.energy_share_pct,
      })),
      format: (v) => `${v}%`,
      title: "Energy spend as % of net income, by decile",
      subtitle: "decile 1 = lowest income, decile 10 = highest income",
    },
    energy_spend: {
      label: "Energy spend (£/yr)",
      data: baseline.deciles.map((d) => ({
        label: `${d.decile}`,
        value: d.energy_spend,
      })),
      format: (v) => fmt(v),
      title: "Energy spend by decile",
      subtitle: "annual household gas and electricity bill",
    },
    net_income: {
      label: "Net income (£/yr)",
      data: baseline.deciles.map((d) => ({
        label: `${d.decile}`,
        value: d.net_income,
      })),
      format: (v) => fmt(v),
      title: "Net income by decile",
      subtitle: "annual household net income (earnings + benefits − taxes)",
    },
  };

  const current = views[baselineView];

  return (
    <section className="section" id="baseline">
      <h2 className="section-title">Baseline energy burden</h2>

      <div className="kpi-row">
        <KpiCard
          label="Households"
          value={`${baseline.n_households_m}m`}
          color="teal"
        />
        <KpiCard
          label="Current Ofgem cap"
          value={fmt(baseline.current_cap)}
          unit="/yr"
        />
        <KpiCard
          label="Mean energy spend"
          value={fmt(baseline.mean_energy_spend)}
          unit="/yr"
        />
        <KpiCard
          label="Total energy spend"
          value={fmtBn(baseline.total_energy_spend_bn)}
        />
      </div>

      <p className="section-description">
        Decile 1 households spend over 10% of their net income on energy,
        while decile 10 households spend 2.2%. Energy spending is relatively
        flat across the distribution (£1,900–£2,700). The difference in
        burden is driven by income, not consumption.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">{current.title}</div>
            <div className="chart-subtitle">{current.subtitle}</div>
          </div>
          <div className="scenario-pills">
            {Object.entries(views).map(([key, v]) => (
              <button
                key={key}
                className={`scenario-pill scenario-pill-sm${baselineView === key ? " active" : ""}`}
                onClick={() => setBaselineView(key)}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
        <ColumnChart
          data={current.data}
          maxValue={Math.max(...current.data.map((d) => d.value)) * 1.15}
          color="teal"
          formatValue={current.format}
          xLabel="Decile"
        />
      </div>

      <p className="section-description">
        Households already spending 10% or more of income on energy are at
        the fuel poverty threshold. Any further price increase pushes them
        above it.
      </p>
    </section>
  );
}

function ShockSection() {
  const [selected, setSelected] = useState(2);
  const [shockMetric, setShockMetric] = useState("pct_of_income");
  const [scenarioMetric, setScenarioMetric] = useState("avg_hh_hit_yr");
  const scenario = results.shock_scenarios[selected];

  const barData = scenario.deciles.map((d) => ({
    label: `${d.decile}`,
    value: shockMetric === "pct_of_income" ? d.pct_of_income : d.extra_cost,
  }));

  return (
    <section className="section" id="shocks">
      <h2 className="section-title">Price shock scenarios</h2>
      <p className="section-description">
        The UK is particularly{" "}
        <a href="https://www.ft.com/content/13f5e566-83c0-4d94-9338-9d418053c290" target="_blank" rel="noopener noreferrer">
          exposed
        </a>{" "}
        to gas price shocks. Gas makes up 35% of total energy demand and
        gas-fired power stations set electricity prices. The Resolution Foundation{" "}
        <a href="https://www.theguardian.com/business/2026/mar/04/war-in-middle-east-could-wipe-out-growth-in-uk-living-standards" target="_blank" rel="noopener noreferrer">
          estimates
        </a>{" "}
        a persistent rise could add £500 to typical annual energy bills.
        We model five scenarios below, from a mild +10% to an extreme
        £4,500 cap.
      </p>
      <p className="section-description">
        <strong>Mild (+10%)</strong> represents a short-lived supply disruption
        or moderate market uncertainty, raising the cap to £1,892.{" "}
        <strong>Moderate (+30%)</strong> corresponds to a sustained disruption,
        such as extended conflict affecting gas shipping routes, with a cap
        of £2,236.{" "}
        <strong>Severe (+60%)</strong> models a major escalation comparable to
        the initial impact of the 2022 crisis, raising the cap to £2,752.{" "}
        <strong>2022-level</strong> matches the October 2022 peak of £3,764,
        when wholesale gas prices reached record highs.{" "}
        <strong>Extreme (4500)</strong> models a scenario at £4,500, above any
        cap level previously seen.
      </p>
      <p className="section-description">
        Under a severe (+60%) shock, decile 1 households lose 6.5% of their
        income to the extra cost, compared with 1.3% for decile 10.
      </p>

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

      <div className="kpi-row">
        <KpiCard
          label="New price cap"
          value={fmt(scenario.new_cap)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Price increase"
          value={`+${scenario.price_increase_pct}%`}
          color="teal"
        />
        <KpiCard
          label="Avg household hit"
          value={fmt(scenario.avg_hh_hit_yr)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Total cost to households"
          value={fmtBn(scenario.total_cost_bn)}
          color="teal"
        />
      </div>

      <p className="section-description">
        Select a scenario above to see its distributional impact by decile.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">
              {shockMetric === "pct_of_income"
                ? `Extra energy cost as % of income, by decile: ${scenario.name.toLowerCase()}`
                : `Extra energy cost (£/yr), by decile: ${scenario.name.toLowerCase()}`}
            </div>
            <div className="chart-subtitle">
              {shockMetric === "pct_of_income"
                ? "Share of each decile's income consumed by the price increase"
                : "Annual extra cost per household by income decile"}
            </div>
          </div>
          <div className="scenario-pills">
            <button
              className={`scenario-pill scenario-pill-sm${shockMetric === "pct_of_income" ? " active" : ""}`}
              onClick={() => setShockMetric("pct_of_income")}
            >
              % of income
            </button>
            <button
              className={`scenario-pill scenario-pill-sm${shockMetric === "extra_cost" ? " active" : ""}`}
              onClick={() => setShockMetric("extra_cost")}
            >
              Extra cost (£/yr)
            </button>
          </div>
        </div>
        <ColumnChart
          data={barData}
          maxValue={Math.max(...barData.map((d) => d.value)) * 1.15}
          color="teal"
          formatValue={shockMetric === "pct_of_income" ? (v) => `${v}%` : (v) => fmt(v)}
          xLabel="Decile"
        />
      </div>

      <p className="section-description">
        Extra costs take a larger share of income from lower-income
        households across all scenarios.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">All scenarios at a glance</div>
            <div className="chart-subtitle">
              {{ new_cap: "New Ofgem price cap by scenario",
                 increase: "Percentage increase from current cap",
                 avg_hh_hit_yr: "Average household hit per year, by scenario",
                 total_cost: "Total cost to all UK households",
              }[scenarioMetric]}
            </div>
          </div>
          <div className="scenario-pills">
            {[
              { key: "new_cap", label: "New cap" },
              { key: "increase", label: "Increase" },
              { key: "avg_hh_hit_yr", label: "Avg HH hit (£/yr)" },
              { key: "total_cost", label: "Total cost" },
            ].map((m) => (
              <button
                key={m.key}
                className={`scenario-pill scenario-pill-sm${scenarioMetric === m.key ? " active" : ""}`}
                onClick={() => setScenarioMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
        <ColumnChart
          data={results.shock_scenarios.map((s) => ({
            label: s.name,
            value: {
              new_cap: s.new_cap,
              increase: s.price_increase_pct,
              avg_hh_hit_yr: s.avg_hh_hit_yr,
              total_cost: s.total_cost_bn,
            }[scenarioMetric],
          }))}
          maxValue={Math.max(...results.shock_scenarios.map((s) => ({
            new_cap: s.new_cap,
            increase: s.price_increase_pct,
            avg_hh_hit_yr: s.avg_hh_hit_yr,
            total_cost: s.total_cost_bn,
          })[scenarioMetric])) * 1.15}
          color="teal"
          formatValue={{
            new_cap: (v) => fmt(v),
            increase: (v) => `+${v}%`,
            avg_hh_hit_yr: (v) => fmt(v),
            total_cost: (v) => fmtBn(v),
          }[scenarioMetric]}
        />
      </div>

      <p className="section-description">
        Even the mild scenario adds £19/month to the average bill. At the
        severe end, households face an extra £113/month. At the 2022-level,
        the extra cost rises to £223/month per household.
      </p>
    </section>
  );
}

function FuelPovertySection() {
  const fp = results.fuel_poverty;
  const baseline = fp[0];
  const [fpMetric, setFpMetric] = useState("rate");

  const barData = fp.map((r) => ({
    label: r.scenario.split("(")[0].trim(),
    value: fpMetric === "rate" ? r.fuel_poverty_rate_pct : r.households_m,
  }));

  return (
    <section className="section" id="fuel-poverty">
      <h2 className="section-title">Fuel poverty impact</h2>
      <p className="section-description">
        We define a household as fuel poor if it spends more than 10% of its
        net income on energy. At current prices, {baseline.households_m}m
        households ({baseline.fuel_poverty_rate_pct}%) are fuel poor by this
        measure. Under a severe shock, this nearly doubles to 27.3%. Under
        a 2022-level shock, 39.8% of all UK households would be fuel poor.
      </p>

      <p className="section-description">
        The 10% threshold is a simplification. The official UK
        definition ({" "}
        <a href="https://www.gov.uk/government/collections/fuel-poverty-statistics" target="_blank" rel="noopener noreferrer">
          LILEE
        </a>
        ) is more complex, but the 10% measure captures the same underlying
        dynamic.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">
              {fpMetric === "rate"
                ? "Fuel poverty rate by scenario"
                : "Fuel poor households by scenario"}
            </div>
            <div className="chart-subtitle">
              {fpMetric === "rate"
                ? "Percentage of all UK households spending >10% of net income on energy"
                : "Millions of UK households spending >10% of net income on energy"}
            </div>
          </div>
          <div className="scenario-pills">
            <button
              className={`scenario-pill scenario-pill-sm${fpMetric === "rate" ? " active" : ""}`}
              onClick={() => setFpMetric("rate")}
            >
              Rate
            </button>
            <button
              className={`scenario-pill scenario-pill-sm${fpMetric === "households" ? " active" : ""}`}
              onClick={() => setFpMetric("households")}
            >
              Households
            </button>
          </div>
        </div>
        <ColumnChart
          data={barData}
          maxValue={fpMetric === "rate" ? 55 : Math.max(...fp.map((r) => r.households_m)) * 1.15}
          color="teal"
          formatValue={fpMetric === "rate" ? (v) => `${v}%` : (v) => `${v}m`}
        />
      </div>

      <p className="section-description">
        At the 2022-level scenario, an additional 8.1m households fall into
        fuel poverty. At the extreme, the total reaches 15.1m, nearly half
        of all UK households.
      </p>
    </section>
  );
}

function PolicySection() {
  const { policies } = results;
  const policyKeys = [
    "epg",
    "flat_transfer",
    "ct_rebate",
    "winter_fuel",
  ];
  const [selectedPolicy, setSelectedPolicy] = useState("epg");
  const [chartMode, setChartMode] = useState("payment");

  const policy = policies[selectedPolicy];
  const meta = POLICY_META[selectedPolicy];

  const hasShockOffset = policy.deciles[0].shock_offset_pct !== undefined;

  const handlePolicyChange = (key) => {
    setSelectedPolicy(key);
    const newPolicy = policies[key];
    const newHasOffset = newPolicy.deciles[0].shock_offset_pct !== undefined;
    if (!newHasOffset && chartMode === "shock_offset") {
      setChartMode("payment");
    }
  };

  return (
    <section className="section" id="policies">
      <h2 className="section-title">Policy responses</h2>
      <p className="section-description">
        We model four policy tools against a severe (+60%) shock (cap rises
        to £2,752, adding £1,350/yr per household). The key metric is{" "}
        <strong>shock offset</strong>: what share of the extra cost each
        policy covers.
      </p>

      <ul className="policy-bullet-list">
        {policyKeys.map((key) => (
          <li key={key}>
            <strong>{POLICY_META[key].letter}. {POLICY_META[key].fullName}</strong>{" "}
            {POLICY_META[key].description}
          </li>
        ))}
      </ul>

      {/* Policy switcher */}
      <div className="scenario-pills" style={{ marginTop: 8 }}>
        {policyKeys.map((key) => (
          <button
            key={key}
            className={`scenario-pill${
              selectedPolicy === key ? " active" : ""
            }`}
            onClick={() => handlePolicyChange(key)}
          >
            {POLICY_META[key].letter}. {policies[key].name}
          </button>
        ))}
      </div>

      <div className="kpi-row">
        <KpiCard
          label="Exchequer cost"
          value={fmtBn(policy.exchequer_cost_bn)}
          color="teal"
        />
        <KpiCard
          label="Avg HH benefit"
          value={fmt(policy.avg_hh_benefit)}
          unit="/yr"
          color="teal"
        />
        {hasShockOffset && (
          <>
            <KpiCard
              label="Shock offset (D1)"
              value={`${policy.deciles[0].shock_offset_pct}%`}
              color="teal"
            />
            <KpiCard
              label="Shock offset (D10)"
              value={`${policy.deciles[9].shock_offset_pct}%`}
            />
          </>
        )}
      </div>

      <p className="section-description">
        Toggle between payment amounts and shock offset (what share of
        the extra cost each policy covers).
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            {chartMode === "shock_offset" && hasShockOffset && (
              <>
                <div className="chart-title">Shock offset by decile: {meta.fullName}</div>
                <div className="chart-subtitle">% of the extra energy cost covered by this policy</div>
              </>
            )}
            {chartMode === "payment" && (
              <>
                <div className="chart-title">Payment by decile: {meta.fullName}</div>
                <div className="chart-subtitle">Annual £ received per household</div>
              </>
            )}
          </div>
          <div className="scenario-pills">
            {policy.deciles[0].payment !== undefined && (
              <button
                className={`scenario-pill scenario-pill-sm${chartMode === "payment" ? " active" : ""}`}
                onClick={() => setChartMode("payment")}
              >
                Payment (£/yr)
              </button>
            )}
            {hasShockOffset && (
              <button
                className={`scenario-pill scenario-pill-sm${chartMode === "shock_offset" ? " active" : ""}`}
                onClick={() => setChartMode("shock_offset")}
              >
                Shock offset
              </button>
            )}
          </div>
        </div>

        {chartMode === "shock_offset" && hasShockOffset ? (
          <ColumnChart
            data={policy.deciles.map((d) => ({
              label: `${d.decile}`,
              value: d.shock_offset_pct,
            }))}
            maxValue={
              Math.max(
                ...policy.deciles.map((d) => d.shock_offset_pct)
              ) * 1.2 || 10
            }
            color="teal"
            formatValue={(v) => `${v}%`}
            xLabel="Decile"
          />
        ) : (
          <ColumnChart
            data={policy.deciles.map((d) => ({
              label: `${d.decile}`,
              value: d.payment,
            }))}
            maxValue={
              Math.max(...policy.deciles.map((d) => d.payment)) * 1.2
            }
            color="teal"
            formatValue={(v) => fmt(v)}
            xLabel="Decile"
          />
        )}
      </div>

      <p className="section-description">
        The EPG costs £0.8bn but covers only ~2% of the shock. The flat
        transfer reaches all households at £12.8bn. Council tax rebates
        cost £7.7bn and cover 17–23% of the shock for lower bands. Winter
        fuel expansion costs £1.5bn and reaches pensioner households only.
        In 2022, layering multiple policies brought the total cost to £35bn.
      </p>
    </section>
  );
}

function SummarySection() {
  const { policies } = results;
  const [summaryMetric, setSummaryMetric] = useState("cost");

  const rows = [
    { key: "epg", name: "EPG subsidy", ...policies.epg },
    { key: "flat_transfer", name: "Flat transfer", ...policies.flat_transfer },
    { key: "ct_rebate", name: "CT band rebate", ...policies.ct_rebate },
    { key: "winter_fuel", name: "Expanded winter fuel", ...policies.winter_fuel },
  ];

  const costSorted = [...rows].sort((a, b) => b.exchequer_cost_bn - a.exchequer_cost_bn);
  const benefitSorted = [...rows].sort((a, b) => (b.avg_hh_benefit || 0) - (a.avg_hh_benefit || a.avg_net_income_change || 0));

  const chartData = summaryMetric === "cost"
    ? costSorted.map((r) => ({
        label: r.name,
        value: r.exchequer_cost_bn,
        tooltip: `${r.name}: ${fmtBn(r.exchequer_cost_bn)}`,
      }))
    : benefitSorted.map((r) => ({
        label: r.name,
        value: r.avg_hh_benefit || 0,
        tooltip: `${r.name}: ${fmt(r.avg_hh_benefit || 0)}/yr`,
      }));

  const chartMax = Math.max(...chartData.map((d) => d.value)) * 1.15;
  const chartFormat = summaryMetric === "cost" ? (v) => fmtBn(v) : (v) => fmt(v);
  const chartTitle = summaryMetric === "cost" ? "Exchequer cost comparison" : "Average household benefit comparison";
  const chartSubtitle = summaryMetric === "cost" ? "Sorted by cost, highest first" : "Sorted by benefit, highest first";

  return (
    <section className="section" id="summary">
      <h2 className="section-title">Policy cost comparison</h2>
      <p className="section-description">
        The 2022 energy support package cost £35bn in total. The four
        policies modelled here range from £0.8bn (EPG) to £12.8bn (flat
        transfer). The following chart compares them on fiscal cost and
        average household benefit.
      </p>

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

        <ColumnChart
          data={chartData}
          maxValue={chartMax}
          color="teal"
          formatValue={chartFormat}
        />
      </div>

      <p className="section-description">
        Bangham{" "}
        <a href="https://georgebangham.substack.com/p/now-is-the-time-to-prepare-for-another?r=8zbi3" target="_blank" rel="noopener noreferrer">
          argues
        </a>{" "}
        the government should use the window before the next price cap change
        on 1 July to join data across Ofgem, DWP and HMRC, enabling more
        targeted support than the 2022 response.
      </p>
    </section>
  );
}

export default function Dashboard() {
  return (
    <div className="narrative-container">
      <header className="narrative-hero">
        <h1>Energy price shock: distributional impact and policy options</h1>
        <p className="narrative-lead">
          The Iran war could trigger an energy price{" "}
          <a href="https://www.ft.com/content/13f5e566-83c0-4d94-9338-9d418053c290" target="_blank" rel="noopener noreferrer">
            shock
          </a>{" "}
          that the Resolution Foundation{" "}
          <a href="https://www.theguardian.com/business/2026/mar/04/war-in-middle-east-could-wipe-out-growth-in-uk-living-standards" target="_blank" rel="noopener noreferrer">
            estimates
          </a>{" "}
          could wipe out growth in UK living standards. The price cap
          system means bills would not rise until the end of June at the
          earliest, giving the government time to{" "}
          <a href="https://georgebangham.substack.com/p/now-is-the-time-to-prepare-for-another?r=8zbi3" target="_blank" rel="noopener noreferrer">
            prepare
          </a>
          . This
          analysis{" "}
          <a href="https://github.com/PolicyEngine/energy-price-shock" target="_blank" rel="noopener noreferrer">
            uses
          </a>{" "}
          <strong>PolicyEngine UK</strong> microsimulation to model the
          distributional impact and evaluate <strong>four policy responses</strong>.
        </p>
      </header>

      <BaselineSection />
      <ShockSection />
      <FuelPovertySection />
      <PolicySection />
      <SummarySection />
    </div>
  );
}
