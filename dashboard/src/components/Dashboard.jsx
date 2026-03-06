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
      "Government caps bills at £2,500/yr and subsidises the difference. Proportional to consumption, so higher users get more. Covers ~5% of each household's bill in this scenario.",
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
        Before modelling any price shock, we establish how energy costs are
        distributed across income deciles at current prices. The chart below
        shows energy spend as a share of income, absolute energy spend, and
        net income for each decile.
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
        Decile 1 households spend 10.3% of net income on energy. Decile 10
        households spend 2.2%. Energy spending ranges from £1,848 to £2,703
        across deciles: the variation in burden is driven by income, not
        consumption. The next section models what happens when prices rise.
      </p>
    </section>
  );
}

function ShockSection() {
  const [selected, setSelected] = useState(0);
  const [shockMetric, setShockMetric] = useState("pct_of_income");
  const [scenarioMetric, setScenarioMetric] = useState("avg_hh_hit_yr");
  const scenario = results.shock_scenarios[selected];
  const behav = results.behavioral[selected];

  const barData = scenario.deciles.map((d, i) => {
    const bd = behav.deciles[i];
    return {
      label: `${d.decile}`,
      staticVal: shockMetric === "pct_of_income" ? d.pct_of_income : d.extra_cost,
      behavVal: shockMetric === "pct_of_income" ? bd.behavioral_pct_of_income : bd.behavioral_extra_cost,
    };
  });

  return (
    <section className="section" id="shocks">
      <h2 className="section-title">Price shock scenarios</h2>
      <p className="section-description">
        Given the baseline distribution above, we model five scenarios in
        which the Ofgem price cap rises by a given percentage from the
        current level of £1,641. Gas makes up 35% of UK energy
        demand<a href="#fn-7"><sup>7</sup></a> and gas-fired power stations set electricity
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
        Each chart below shows two estimates side by side. The grey bar is
        the static estimate, assuming households do not change their energy
        consumption. The teal bar is the behavioural estimate, which
        accounts for the fact that households reduce usage when prices
        rise — turning down heating, using less hot water. The behavioural
        estimate uses a short-run price elasticity of −0.15, matching the
        overall energy short-run average of −0.149 reported in a
        meta-analysis of 428 studies (Labandeira, Labeaga and López-Otero,
        2017). Elasticities vary by income: Priesmann and Praktiknjo
        (2025) find short-run gas price elasticities ranging from −0.64
        for low-income to −0.11 for high-income households. The bill
        saving from reduced consumption does not capture the full cost to
        households, who also lose comfort and warmth.
      </p>
      <p className="section-description">
        Select a scenario to see its distributional impact. The first chart
        shows the extra cost per decile as a percentage of income or in
        pounds. The second chart compares all five scenarios side by side.
      </p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
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

      <div className="kpi-row">
        <KpiCard
          label="New price cap"
          value={fmt(scenario.new_cap)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Static avg hit"
          value={fmt(scenario.avg_hh_hit_yr)}
          unit="/yr"
        />
        <KpiCard
          label="Behavioural avg hit"
          value={fmt(behav.behavioral_avg_extra)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Consumption change"
          value={`${behav.consumption_change_pct}%`}
        />
      </div>

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
                ? "Grey = static (no demand response), teal = behavioural (ε = −0.15)"
                : "Grey = static (no demand response), teal = behavioural (ε = −0.15)"}
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
        {(() => {
          const maxVal = Math.max(...barData.map((d) => d.staticVal)) * 1.15;
          const ticks = niceTicks(maxVal);
          const topTick = ticks[ticks.length - 1] || maxVal;
          const effectiveMax = Math.max(maxVal, topTick);
          const fmtVal = shockMetric === "pct_of_income" ? (v) => `${v}%` : (v) => fmt(v);
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
                          {shockMetric === "pct_of_income"
                            ? `Static: ${d.staticVal}%, Behavioural: ${d.behavVal}%`
                            : `Static: ${fmt(d.staticVal)}, Behavioural: ${fmt(d.behavVal)}`}
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
              <div className="col-chart-legend">
                <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>
                <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>
              </div>
            </div>
          );
        })()}
      </div>

      <p className="section-description">
        Under a +60% shock, decile 1 households lose 6.2% of income to
        the extra cost. Decile 10 households lose 1.3%.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">All scenarios at a glance</div>
            <div className="chart-subtitle">
              {scenarioMetric === "new_cap"
                ? "New Ofgem price cap by scenario"
                : "Grey = static, teal = behavioural"}
            </div>
          </div>
          <div className="scenario-pills">
            {[
              { key: "new_cap", label: "New cap" },
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
        {scenarioMetric === "new_cap" ? (
          <ColumnChart
            data={results.shock_scenarios.map((s) => ({
              label: s.name,
              value: s.new_cap,
            }))}
            maxValue={Math.max(...results.shock_scenarios.map((s) => s.new_cap)) * 1.15}
            color="teal"
            formatValue={(v) => fmt(v)}
          />
        ) : (
          (() => {
            const scenarios = results.shock_scenarios;
            const behavAll = results.behavioral;
            const nHH = results.baseline.n_households_m;
            const glanceData = scenarios.map((s, i) => {
              if (scenarioMetric === "avg_hh_hit_yr") {
                return { label: s.name, staticVal: s.avg_hh_hit_yr, behavVal: behavAll[i].behavioral_avg_extra };
              }
              const staticTotal = Math.round((s.avg_hh_hit_yr * nHH / 1000) * 10) / 10;
              const behavTotal = Math.round((behavAll[i].behavioral_avg_extra * nHH / 1000) * 10) / 10;
              return { label: s.name, staticVal: staticTotal, behavVal: behavTotal };
            });
            const maxVal = Math.max(...glanceData.map((d) => d.staticVal)) * 1.15;
            const ticks = niceTicks(maxVal);
            const topTick = ticks[ticks.length - 1] || maxVal;
            const effectiveMax = Math.max(maxVal, topTick);
            const fmtVal = scenarioMetric === "avg_hh_hit_yr" ? (v) => fmt(v) : (v) => fmtBn(v);
            const fmtTip = scenarioMetric === "avg_hh_hit_yr"
              ? (d) => `Static: ${fmt(d.staticVal)}/yr, Behavioural: ${fmt(d.behavVal)}/yr`
              : (d) => `Static: ${fmtBn(d.staticVal)}, Behavioural: ${fmtBn(d.behavVal)}`;
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
                      {glanceData.map((d, i) => (
                        <div className="col-chart-col" key={i}>
                          <div className="col-chart-tooltip">
                            {fmtTip(d)}
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
                <div className="col-chart-legend">
                  <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>
                  <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>
                </div>
              </div>
            );
          })()
        )}
      </div>

      <p className="section-description">
        Under a +60% shock, demand response reduces the average extra cost
        from £1,345/yr to £1,023/yr, a saving of £323/yr. At the
        2022-level, households reduce consumption by 19.4%, lowering the
        average hit from £2,903/yr to £1,904/yr. These extra costs push
        more households into fuel poverty, as the next section shows.
      </p>
    </section>
  );
}


function FuelPovertySection() {
  const fp = results.fuel_poverty;
  const behavioral = results.behavioral;
  const baseline = fp[0];
  const [fpMetric, setFpMetric] = useState("rate");

  const barData = fp.map((r, i) => {
    const label = r.scenario.split("(")[0].trim();
    if (i === 0) {
      const v = fpMetric === "rate" ? r.fuel_poverty_rate_pct : r.households_m;
      return { label, staticVal: v, behavVal: v };
    }
    const b = behavioral[i - 1];
    return {
      label,
      staticVal: fpMetric === "rate" ? r.fuel_poverty_rate_pct : r.households_m,
      behavVal: fpMetric === "rate" ? b.behavioral_fp_rate : b.behavioral_fp_households_m,
    };
  });

  return (
    <section className="section" id="fuel-poverty">
      <h2 className="section-title">Fuel poverty impact</h2>
      <p className="section-description">
        The previous section showed extra costs per household. Here we
        translate those costs into fuel poverty: a household is fuel poor
        if it spends more than 10% of its net income on energy. The
        official UK definition (LILEE)<a href="#fn-8"><sup>8</sup></a> is more complex, but
        the 10% threshold captures the same
        dynamic. The chart below shows the fuel poverty rate and number of
        affected households under each scenario, with and without demand
        response.
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
              Grey = static, teal = behavioural (ε = −0.15)
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
        {(() => {
          const maxVal = fpMetric === "rate" ? 55 : Math.max(...barData.map((d) => d.staticVal)) * 1.15;
          const ticks = niceTicks(maxVal);
          const topTick = ticks[ticks.length - 1] || maxVal;
          const effectiveMax = Math.max(maxVal, topTick);
          const fmtVal = fpMetric === "rate" ? (v) => `${v}%` : (v) => `${v}m`;
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
                          {fpMetric === "rate"
                            ? `Static: ${d.staticVal}%, Behavioural: ${d.behavVal}%`
                            : `Static: ${d.staticVal}m, Behavioural: ${d.behavVal}m`}
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
              <div className="col-chart-legend">
                <span><span className="col-chart-legend-dot" style={{ background: "#94a3b8" }} />Static</span>
                <span><span className="col-chart-legend-dot" style={{ background: "#319795" }} />Behavioural</span>
              </div>
            </div>
          );
        })()}
      </div>

      <p className="section-description">
        At current prices, {baseline.households_m}m households ({baseline.fuel_poverty_rate_pct}%)
        are fuel poor. Under a +60% shock, the static rate rises to 29.9%
        (9.5m); with demand response it is 25.5% (8.1m). At the 2022-level,
        the static rate reaches 46.5% (14.8m), falling to 36.6% (11.7m)
        with behavioural adjustment. The next section evaluates four policy
        tools that could offset these costs.
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
        Given the scale of the impact shown above, we model four policy
        tools against a +60% shock (cap rises to £2,625, adding £1,345/yr
        per household). The key metric is{" "}
        <strong>shock offset</strong>: what share of the extra cost each
        policy covers for each decile.
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
        The chart below shows the payment each decile receives under the
        selected policy. Toggle to shock offset to see what share of the
        extra cost the policy covers.
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
        The EPG costs £0.4bn and offsets ~1% of the shock. The flat transfer
        costs £12.8bn and offsets 25–36%. The CT rebate costs £7.7bn and
        offsets 11–26%. Winter fuel expansion costs £1.5bn and covers
        pensioner households only. All four face a targeting gap: the
        government holds no single database linking household energy costs
        with income. Bangham argues<a href="#fn-9"><sup>9</sup></a> joining data across Ofgem,
        DWP and HMRC before 1 July could enable
        more targeted support than the 2022 response. The next section
        shows the net household position after both the price shock and
        the policy response.
      </p>
    </section>
  );
}

function PolicyNetSection() {
  const policyNet = results.policy_net_position;
  const policyKeys = ["epg", "flat_transfer", "ct_rebate"];
  const policyLabels = {
    epg: "EPG subsidy",
    flat_transfer: "Flat transfer",
    ct_rebate: "CT band rebate",
  };
  const [selectedNet, setSelectedNet] = useState("flat_transfer");
  const [netMode, setNetMode] = useState("behavioral");
  const pol = policyNet[selectedNet];

  const barData = pol.deciles.map((d) => ({
    label: `${d.decile}`,
    value: netMode === "behavioral" ? d.net_cost_behavioral : d.net_cost_static,
  }));

  return (
    <section className="section" id="policy-net">
      <h2 className="section-title">Net household position</h2>
      <p className="section-description">
        The previous section showed each policy's payment in isolation.
        This section shows the net household position: after the +60%
        price shock and the policy response, how much extra are
        households still paying compared to baseline? This accounts for
        both the behavioural demand response (ε = −0.15) and the policy
        benefit.
      </p>

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

      <div className="kpi-row">
        <KpiCard
          label="Shock (behavioural)"
          value={fmt(pol.avg_shock_behavioral)}
          unit="/yr"
        />
        <KpiCard
          label="Policy benefit"
          value={fmt(pol.avg_benefit)}
          unit="/yr"
          color="teal"
        />
        <KpiCard
          label="Net extra cost"
          value={fmt(pol.avg_net_cost_behavioral)}
          unit="/yr"
        />
        <KpiCard
          label="Exchequer cost"
          value={fmtBn(pol.exchequer_cost_bn)}
        />
      </div>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">
              Remaining extra cost after {pol.name}, by decile
            </div>
            <div className="chart-subtitle">
              Annual extra cost vs baseline after +60% shock and policy response
            </div>
          </div>
          <div className="scenario-pills">
            <button
              className={`scenario-pill scenario-pill-sm${netMode === "behavioral" ? " active" : ""}`}
              onClick={() => setNetMode("behavioral")}
            >
              With demand response
            </button>
            <button
              className={`scenario-pill scenario-pill-sm${netMode === "static" ? " active" : ""}`}
              onClick={() => setNetMode("static")}
            >
              Static
            </button>
          </div>
        </div>
        <ColumnChart
          data={barData}
          maxValue={Math.max(...barData.map((d) => d.value)) * 1.15}
          color="teal"
          formatValue={(v) => fmt(v)}
          xLabel="Decile"
        />
      </div>

      <p className="section-description">
        After accounting for both demand response and the flat transfer,
        the average household still faces an extra{" "}
        {fmt(policyNet.flat_transfer.avg_net_cost_behavioral)}/yr
        compared to baseline. The EPG leaves households with{" "}
        {fmt(policyNet.epg.avg_net_cost_behavioral)}/yr extra cost. The
        CT rebate leaves {fmt(policyNet.ct_rebate.avg_net_cost_behavioral)}/yr.
        None of the modelled policies fully offset the shock, consistent
        with the targeting constraints identified in the previous section.
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
        The previous section examined each policy individually. The chart
        below places all four side by side on two metrics: exchequer cost
        and average household benefit.
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
        The flat transfer provides the largest average benefit (£400/yr) at
        £12.8bn. The EPG is the cheapest (£0.4bn) but provides only £12/yr
        on average. The CT rebate falls in between at £7.7bn and £240/yr.
        Winter fuel expansion costs £1.5bn and averages £104/yr.
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
          This analysis estimates the distributional impact of five
          energy price shock scenarios across income deciles and models
          four policy responses.
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
        share (Ari et al., 2022). In the UK, average household losses
        reached 6% of income before government intervention. Households at
        the 10th income percentile lost 5 percentage points more than those
        at the 90th (Levell et al., 2025). The UK's 2022 relief package, a
        39% price subsidy combined with a universal £400 transfer, cost
        1.3% of GDP in six months and reduced losses, but 12% of total
        spending was lost to inefficiency (Levell et al., 2025). More
        broadly, oil price shocks have triggered recessions since the
        1970s, though their macroeconomic impact has diminished over time
        (Blanchard and Galí, 2010). Price increases tend to reduce output
        more than equivalent decreases boost it (Kilian, 2008). Even in
        the absence of a crisis, energy price volatility alone costs around
        0.8% of consumption per year (Manzano and Rey, 2013).
      </p>
      <p className="section-description">
        Under current Ofgem rules,<a href="#fn-5"><sup>5</sup></a> the
        price cap for April to June is already set at £1,641, so household
        bills would not change before 1 July. From July, the cap will
        reflect wholesale market conditions. This analysis models five
        price shock scenarios, from a 10% increase to
        a return to 2022-level prices. For each, it estimates the extra
        cost per household across income deciles, the impact on fuel
        poverty rates, and the distributional effects of four policy
        responses: an Energy Price Guarantee, a flat transfer, a council
        tax band rebate, and an expanded Winter Fuel Allowance. All
        modelling uses the PolicyEngine UK microsimulation
        model.<a href="#fn-6"><sup>6</sup></a>
      </p>
      </section>

      <BaselineSection />
      <ShockSection />
      <FuelPovertySection />
      <PolicySection />
      <PolicyNetSection />
      <SummarySection />

      <section className="section" id="references">
        <h2 className="section-title">References</h2>

        <div className="chart-title" style={{ marginBottom: 12 }}>Academic literature</div>
        <ul className="policy-bullet-list" style={{ fontSize: "0.82rem", color: "#64748b", lineHeight: 1.8 }}>
          <li>
            Ari, A., Arregui, N., Black, S., Celasun, O., Iakova, D., Mineshima, A., Mylonas, V., Parry, I., Teodoru, I. and Zhunussova, K. (2022). "Surging Energy Prices in Europe in the Aftermath of the War: How to Support the Vulnerable and Speed up the Transition Away from Fossil Fuels." <em>IMF Working Paper</em>, No. 22/152.{" "}
            <a href="https://www.imf.org/en/publications/wp/issues/2022/07/28/surging-energy-prices-in-europe-in-the-aftermath-of-the-war-how-to-support-the-vulnerable-521457" target="_blank" rel="noopener noreferrer">Link</a>
          </li>
          <li>
            Levell, P., O'Connell, M. and Smith, K. (2025). "The Welfare Effects of Price Shocks and Household Relief Packages: Evidence from an Energy Crisis." <em>IFS Working Paper</em>, No. 25/03. London: Institute for Fiscal Studies.{" "}
            <a href="https://ifs.org.uk/sites/default/files/2025-06/WP202503-The-welfare-effects-of-price-shocks-and-household-relief-packages-evidence-from-an-energy-crisis.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li>
            Blanchard, O. J. and Galí, J. (2010). "The Macroeconomic Effects of Oil Price Shocks: Why Are the 2000s so Different from the 1970s?" In Galí, J. and Gertler, M. J. (eds.), <em>International Dimensions of Monetary Policy</em>, pp. 373–421. Chicago: University of Chicago Press (NBER).{" "}
            <a href="https://www.nber.org/system/files/chapters/c0517/c0517.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li>
            Kilian, L. (2008). "The Economic Effects of Energy Price Shocks." <em>Journal of Economic Literature</em>, 46(4), pp. 871–909.{" "}
            <a href="http://www.douglaslaxton.org/sitebuildercontent/sitebuilderfiles/kilian.theeconomiceffects.paper.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li>
            Manzano, B. and Rey, L. (2013). "The Welfare Cost of Energy Insecurity." Paper presented at the International Energy Workshop, Paris, 19–21 June 2013.{" "}
            <a href="https://www.internationalenergyworkshop.org/docs/IEW%202013_5A2paperManzano.pdf" target="_blank" rel="noopener noreferrer">PDF</a>
          </li>
          <li>
            Labandeira, X., Labeaga, J. M. and López-Otero, X. (2017). "A Meta-Analysis on the Price Elasticity of Energy Demand." <em>Energy Policy</em>, 102, pp. 549–568. Short-run averages: energy −0.149, electricity −0.201, natural gas −0.184 (428 papers, 966 estimates).{" "}
            <a href="https://doi.org/10.1016/j.enpol.2017.01.002" target="_blank" rel="noopener noreferrer">DOI</a>
          </li>
          <li>
            Priesmann, J. and Praktiknjo, A. (2025). "Estimating Short- and Long-Run Price and Income Elasticities of Final Energy Demand as a Function of Household Income." <em>Energy Policy</em>, 207, 114850. Short-run gas elasticity: −0.64 (low-income) to −0.11 (high-income).{" "}
            <a href="https://doi.org/10.1016/j.enpol.2025.114850" target="_blank" rel="noopener noreferrer">DOI</a>
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
        </ol>
      </section>
    </div>
  );
}
