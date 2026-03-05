import { useState } from "react";
import results from "../data/results.json";
import "./Dashboard.css";

const fmt = (v) => `£${v.toLocaleString("en-GB")}`;
const fmtBn = (v) => `£${v}bn`;

const POLICY_COLORS = {
  epg: "#0d9488",
  flat_transfer: "#2dd4bf",
  ct_rebate: "#5eead4",
  winter_fuel: "#14b8a6",
  combined: "#319795",
};

const POLICY_META = {
  epg: {
    letter: "A",
    fullName: "Energy Price Guarantee (EPG)",
    description:
      "The 2022 approach. The government sets a guarantee level (e.g. £2,500/year for a typical household) and subsidises the difference between the actual market price cap and this target. The subsidy is proportional to each household's energy consumption and uses a monthly seasonal model (higher subsidies in winter). In this scenario, the gap is modest: cap at £2,752 vs guarantee at £2,500, so the subsidy only covers ~9% of each household's bill.",
    targeting: "Proportional to energy spend — higher spenders get more £",
  },
  flat_transfer: {
    letter: "B",
    fullName: "Flat transfer (£400 per household)",
    description:
      "The simplest possible intervention: give every household the same flat amount, credited to their energy bill. This was part of the 2022 Energy Bills Rebate (£200 credit, later topped up to £400). A flat transfer is progressive in percentage terms — £400 offsets a larger share of the shock for low-income households. But it's expensive (£12.8bn for 31.9m households) and untargeted — billionaires get the same as pensioners on pension credit.",
    targeting: "Universal — same amount regardless of income or usage",
  },
  ct_rebate: {
    letter: "C",
    fullName: "Council tax band rebate (£300 for bands A–D)",
    description:
      "A £300 payment to households in council tax bands A through D (the lower half of the 8-band system). This uses property value as a proxy for wealth — households in cheaper properties are more likely to be lower-income. More targeted than a flat transfer, but council tax bands are a crude proxy — some low-income households live in high-band properties (e.g. asset-rich, income-poor pensioners).",
    targeting:
      "Property value proxy — lower bands correlate with lower wealth",
  },
  winter_fuel: {
    letter: "D",
    fullName: "Expanded Winter Fuel Allowance",
    description:
      "The Winter Fuel Allowance is currently means-tested (restricted to pensioners on pension credit). We model removing the means test (making it universal for all pensioner households) and increasing the amounts from £200/£300 to £350/£500. This is cheap (£1.5bn extra) and well-targeted at a vulnerable group, but it only reaches pensioner households — working-age families on low incomes get nothing.",
    targeting:
      "Age-targeted; means test removed to reach all pensioner households",
  },
  combined: {
    letter: "E",
    fullName: "Combined package",
    description:
      "All four policies activated together: EPG subsidy capping bills at £2,500, £400 flat transfer to every household, £300 council tax rebate for bands A–D, and expanded winter fuel (universal, £350/£500). This represents a comprehensive response package with multiple targeting mechanisms layered together.",
    targeting: "Multiple targeting mechanisms layered together",
  },
};

function ViewToggle({ view, setView }) {
  return (
    <div className="scenario-pills">
      <button
        className={`scenario-pill scenario-pill-sm${view === "chart" ? " active" : ""}`}
        onClick={() => setView("chart")}
      >
        Chart
      </button>
      <button
        className={`scenario-pill scenario-pill-sm${view === "table" ? " active" : ""}`}
        onClick={() => setView("table")}
      >
        Table
      </button>
    </div>
  );
}

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

function ColumnChart({ data, maxValue, color, formatValue, colorFn, yLabel }) {
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
              return (
                <div className="col-chart-col" key={i} title={d.tooltip || (formatValue ? `${d.label}: ${formatValue(d.value)}` : `${d.label}: ${d.value}`)}>
                  <div className="col-chart-val">
                    {formatValue ? formatValue(d.value) : d.value}
                  </div>
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
    </div>
  );
}

function CompareColumnChart({ deciles, policyKeys, policies }) {
  const rawMax = Math.max(
    ...policyKeys.flatMap((k) =>
      policies[k].deciles.map((d) => d.shock_offset_pct ?? 0)
    )
  );
  const ticks = niceTicks(rawMax * 1.15);
  const effectiveMax = ticks[ticks.length - 1] || rawMax * 1.15;

  return (
    <div>
      <div className="compare-legend">
        {policyKeys.map((key) => (
          <div className="legend-item" key={key}>
            <span
              className="legend-dot"
              style={{ background: POLICY_COLORS[key] }}
            />
            {POLICY_META[key].letter}. {policies[key].name}
          </div>
        ))}
      </div>
      <div className="col-chart">
        <div className="col-chart-body">
          <div className="col-chart-y-axis">
            {[...ticks].reverse().map((t, i) => (
              <div
                className="col-chart-y-tick"
                key={i}
                style={{ bottom: `${(t / effectiveMax) * 100}%` }}
              >
                {t}%
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
              {deciles.map((decile) => (
                <div
                  className="col-chart-col col-chart-col-grouped"
                  key={decile}
                >
                  <div className="col-chart-group">
                    {policyKeys.map((key) => {
                      const val =
                        policies[key].deciles[decile - 1].shock_offset_pct ?? 0;
                      const pct = (val / effectiveMax) * 100;
                      return (
                        <div className="col-chart-group-bar" key={key}>
                          <div
                            className="col-chart-group-fill"
                            style={{
                              height: `${pct}%`,
                              background: POLICY_COLORS[key],
                            }}
                            title={`${POLICY_META[key].letter}: ${val}%`}
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="col-chart-label">D{decile}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
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
        label: `D${d.decile}`,
        value: d.energy_share_pct,
      })),
      format: (v) => `${v}%`,
      title: "Energy spend as % of net income, by decile",
      subtitle: "decile 1 = poorest 10% of households, decile 10 = richest 10%",
    },
    energy_spend: {
      label: "Energy spend (£/yr)",
      data: baseline.deciles.map((d) => ({
        label: `D${d.decile}`,
        value: d.energy_spend,
      })),
      format: (v) => fmt(v),
      title: "Energy spend by decile",
      subtitle: "annual household gas and electricity bill",
    },
    net_income: {
      label: "Net income (£/yr)",
      data: baseline.deciles.map((d) => ({
        label: `D${d.decile}`,
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
      <h2 className="section-title">Baseline: who spends what on energy?</h2>
      <p className="section-description">
        Energy costs are deeply regressive. The poorest 10% of households spend
        over 10% of their net income on energy — already at the fuel poverty
        threshold — while the richest 10% spend just 2.2%. Energy spending is
        relatively flat across the distribution (£1,900–£2,700). It's the
        denominator — income — that drives the regressivity. This means any
        price shock hits low-income households hardest as a share of their
        budget.
      </p>

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

      <div className="chart-wrapper">
        <div className="chart-mode-toggle">
          {Object.entries(views).map(([key, v]) => (
            <button
              key={key}
              className={`scenario-pill${baselineView === key ? " active" : ""}`}
              onClick={() => setBaselineView(key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="chart-title">{current.title}</div>
        <div className="chart-subtitle">{current.subtitle}</div>
        <ColumnChart
          data={current.data}
          maxValue={Math.max(...current.data.map((d) => d.value)) * 1.15}
          color="teal"
          formatValue={current.format}
        />
      </div>
    </section>
  );
}

function ShockSection() {
  const [selected, setSelected] = useState(1);
  const [shockView, setShockView] = useState("chart");
  const scenario = results.shock_scenarios[selected];

  const barData = scenario.deciles.map((d) => ({
    label: `D${d.decile}`,
    value: d.pct_of_income,
  }));

  return (
    <section className="section" id="shocks">
      <h2 className="section-title">
        Price shock scenarios — no policy response
      </h2>
      <p className="section-description">
        We model four price cap increases, from a moderate +30% to an extreme
        £4,500 cap (higher than the October 2022 peak of £3,764). The
        assumption is that households don't reduce consumption when prices rise
        — energy demand is highly inelastic in the short run. You can't
        insulate your house overnight, and people won't stop heating their
        homes.
      </p>
      <p className="section-description">
        Any price shock hits low-income households hardest as a share of their
        budget. Under a severe (+60%) shock, decile 1 faces a ~6.5% income hit
        vs ~1.3% for decile 10.
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

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">
              Extra energy cost as % of income, by decile — {scenario.name.toLowerCase()}
            </div>
            <div className="chart-subtitle">
              Shows how much of each decile's income is eaten by the price rise
            </div>
          </div>
          <ViewToggle view={shockView} setView={setShockView} />
        </div>
        {shockView === "chart" ? (
          <ColumnChart
            data={barData}
            maxValue={Math.max(...barData.map((d) => d.value)) * 1.15}
            color="teal"
            formatValue={(v) => `${v}%`}
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Decile</th>
                <th>Extra cost (£/yr)</th>
                <th>% of income</th>
              </tr>
            </thead>
            <tbody>
              {scenario.deciles.map((d) => (
                <tr key={d.decile}>
                  <td>Decile {d.decile}</td>
                  <td>{fmt(d.extra_cost)}</td>
                  <td>{d.pct_of_income}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="data-table-wrapper">
        <div className="data-table-title">All scenarios at a glance</div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>New cap</th>
              <th>Increase</th>
              <th>Avg HH hit (£/yr)</th>
              <th>Avg HH hit (£/mo)</th>
              <th>Total cost</th>
            </tr>
          </thead>
          <tbody>
            {results.shock_scenarios.map((s, i) => (
              <tr
                key={i}
                style={i === selected ? { background: "#f0fdfa" } : {}}
              >
                <td>{s.name}</td>
                <td>{fmt(s.new_cap)}</td>
                <td>+{s.price_increase_pct}%</td>
                <td>{fmt(s.avg_hh_hit_yr)}</td>
                <td>{fmt(s.avg_hh_hit_mo)}</td>
                <td>{fmtBn(s.total_cost_bn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FuelPovertySection() {
  const fp = results.fuel_poverty;
  const baseline = fp[0];
  const [fpView, setFpView] = useState("chart");

  const barData = fp.map((r) => ({
    label: r.scenario.split("(")[0].trim(),
    value: r.fuel_poverty_rate_pct,
  }));

  return (
    <section className="section" id="fuel-poverty">
      <h2 className="section-title">Fuel poverty</h2>
      <p className="section-description">
        Fuel poverty means a household has to spend a disproportionate share of
        its income to maintain adequate heating. In this analysis, a household
        is classified as fuel poor if it spends more than 10% of its net income
        on energy. This is a commonly used threshold — the official UK measure
        (Low Income Low Energy Efficiency, or LILEE) is more complex, factoring
        in housing energy efficiency ratings, but the 10% rule captures the
        core dynamic: when energy costs consume too large a share of income,
        households face impossible trade-offs between heating, eating, and other
        essentials.
      </p>
      <p className="section-description">
        Even at current prices, {baseline.households_m}m households (
        {baseline.fuel_poverty_rate_pct}% of all households) are already fuel
        poor. Under a severe shock, fuel poverty nearly doubles. Under a
        2022-level shock, almost half of all households would be fuel poor.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">Fuel poverty rate by scenario</div>
            <div className="chart-subtitle">
              Percentage of all UK households spending &gt;10% of net income on
              energy
            </div>
          </div>
          <ViewToggle view={fpView} setView={setFpView} />
        </div>
        {fpView === "chart" ? (
          <ColumnChart
            data={barData}
            maxValue={55}
            color="teal"
            formatValue={(v) => `${v}%`}
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Rate</th>
                <th>Households</th>
                <th>Extra households</th>
              </tr>
            </thead>
            <tbody>
              {fp.map((r, i) => (
                <tr key={i}>
                  <td>{r.scenario}</td>
                  <td>{r.fuel_poverty_rate_pct}%</td>
                  <td>{r.households_m}m</td>
                  <td>
                    {r.extra_households_m > 0
                      ? `+${r.extra_households_m}m`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
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
    "combined",
  ];
  const [selectedPolicy, setSelectedPolicy] = useState("flat_transfer");
  const [chartMode, setChartMode] = useState("shock_offset");

  const policy = policies[selectedPolicy];
  const meta = POLICY_META[selectedPolicy];
  const color = POLICY_COLORS[selectedPolicy];

  const hasShockOffset = policy.deciles[0].shock_offset_pct !== undefined;
  const hasNetChange = policy.deciles[0].net_income_change !== undefined;

  const comparisonPolicies = policyKeys.filter((k) => k !== "combined");

  return (
    <section className="section" id="policies">
      <h2 className="section-title">Policy responses</h2>
      <p className="section-description">
        Five policy responses to a severe (+60%) shock (cap rises from £1,720
        to £2,752). This shock adds ~£1,350/year to the average household bill
        and costs households ~£43bn in aggregate. Each policy uses existing
        PolicyEngine UK variables — we change parameter values to activate
        them.
      </p>
      <p className="section-description">
        The key metric is shock offset: what percentage of the extra energy cost
        (caused by the price shock) is covered by a given policy. 100% means
        fully compensated. A higher shock offset for lower deciles means the
        policy is progressive.
      </p>

      {/* Policy switcher */}
      <div className="policy-switcher">
        {policyKeys.map((key) => (
          <button
            key={key}
            className={`scenario-pill${
              selectedPolicy === key ? " active" : ""
            }`}
            onClick={() => setSelectedPolicy(key)}
          >
            {POLICY_META[key].letter}. {policies[key].name}
          </button>
        ))}
      </div>

      {/* Active policy detail card */}
      <div className="policy-detail-card" style={{ borderTopColor: color }}>
        <div className="policy-detail-header">
          <div>
            <div className="policy-detail-name">
              {meta.letter}. {meta.fullName}
            </div>
            <div className="policy-detail-targeting">{meta.targeting}</div>
          </div>
          <div className="policy-detail-cost" style={{ color }}>
            {fmtBn(policy.exchequer_cost_bn)}
          </div>
        </div>
        <p className="policy-detail-desc">{meta.description}</p>

        <div className="policy-detail-kpis">
          <div className="policy-detail-kpi">
            <div className="kpi-label">Exchequer cost</div>
            <div className="kpi-value" style={{ color }}>
              {fmtBn(policy.exchequer_cost_bn)}
            </div>
          </div>
          <div className="policy-detail-kpi">
            <div className="kpi-label">
              {hasNetChange ? "Avg net income change" : "Avg HH benefit"}
            </div>
            <div className="kpi-value" style={{ color }}>
              {fmt(
                hasNetChange
                  ? policy.avg_net_income_change
                  : policy.avg_hh_benefit
              )}
              <span className="kpi-unit">/yr</span>
            </div>
          </div>
          {hasShockOffset && (
            <>
              <div className="policy-detail-kpi">
                <div className="kpi-label">Shock offset (D1, poorest)</div>
                <div className="kpi-value" style={{ color }}>
                  {policy.deciles[0].shock_offset_pct}%
                </div>
              </div>
              <div className="policy-detail-kpi">
                <div className="kpi-label">Shock offset (D10, richest)</div>
                <div className="kpi-value">
                  {policy.deciles[9].shock_offset_pct}%
                </div>
              </div>
            </>
          )}
          {hasNetChange && (
            <>
              <div className="policy-detail-kpi">
                <div className="kpi-label">Income boost (D1)</div>
                <div className="kpi-value" style={{ color }}>
                  +{policy.deciles[0].pct_change}%
                </div>
              </div>
              <div className="policy-detail-kpi">
                <div className="kpi-label">Income boost (D10)</div>
                <div className="kpi-value">
                  +{policy.deciles[9].pct_change}%
                </div>
              </div>
            </>
          )}
        </div>

        {/* Chart mode toggle */}
        <div className="chart-mode-toggle">
          {hasShockOffset && (
            <button
              className={`scenario-pill${
                chartMode === "shock_offset" ? " active" : ""
              }`}
              onClick={() => setChartMode("shock_offset")}
            >
              Shock offset (%)
            </button>
          )}
          {(hasShockOffset || policy.deciles[0].payment !== undefined) && (
            <button
              className={`scenario-pill${
                chartMode === "payment" ? " active" : ""
              }`}
              onClick={() => setChartMode("payment")}
            >
              Payment (£)
            </button>
          )}
          {hasNetChange && (
            <button
              className={`scenario-pill${
                chartMode === "net_change" ? " active" : ""
              }`}
              onClick={() => setChartMode("net_change")}
            >
              Net income change
            </button>
          )}
          <button
            className={`scenario-pill${
              chartMode === "compare_all" ? " active" : ""
            }`}
            onClick={() => setChartMode("compare_all")}
          >
            Compare all policies
          </button>
        </div>

        {/* Charts */}
        <div className="chart-wrapper chart-wrapper-inner">
          {chartMode === "shock_offset" && hasShockOffset && (
            <>
              <div className="chart-title">
                Shock offset by decile — {meta.fullName}
              </div>
              <div className="chart-subtitle">
                % of the extra energy cost covered by this policy
              </div>
              <ColumnChart
                data={policy.deciles.map((d) => ({
                  label: `D${d.decile}`,
                  value: d.shock_offset_pct,
                }))}
                maxValue={
                  Math.max(
                    ...policy.deciles.map((d) => d.shock_offset_pct)
                  ) * 1.2 || 10
                }
                color="custom"
                colorFn={() => color}
                formatValue={(v) => `${v}%`}
              />
            </>
          )}

          {chartMode === "payment" &&
            policy.deciles[0].payment !== undefined && (
              <>
                <div className="chart-title">
                  Payment by decile — {meta.fullName}
                </div>
                <div className="chart-subtitle">
                  Annual £ received per household
                </div>
                <ColumnChart
                  data={policy.deciles.map((d) => ({
                    label: `D${d.decile}`,
                    value: d.payment,
                  }))}
                  maxValue={
                    Math.max(...policy.deciles.map((d) => d.payment)) * 1.2
                  }
                  color="custom"
                  colorFn={() => color}
                  formatValue={(v) => fmt(v)}
                />
              </>
            )}

          {chartMode === "net_change" && hasNetChange && (
            <>
              <div className="chart-title">
                Net income change by decile — combined package
              </div>
              <div className="chart-subtitle">
                % change in household net income
              </div>
              <ColumnChart
                data={policy.deciles.map((d) => ({
                  label: `D${d.decile}`,
                  value: d.pct_change,
                }))}
                maxValue={
                  Math.max(...policy.deciles.map((d) => d.pct_change)) * 1.2
                }
                color="custom"
                colorFn={() => color}
                formatValue={(v) => `+${v}%`}
              />
            </>
          )}

          {chartMode === "compare_all" && (
            <>
              <div className="chart-title">
                Shock offset by decile — all policies compared
              </div>
              <div className="chart-subtitle">
                % of extra energy cost covered, by income decile
              </div>
              <CompareColumnChart
                deciles={[1, 2, 3, 4, 5, 6, 7, 8, 9, 10]}
                policyKeys={comparisonPolicies}
                policies={policies}
              />
            </>
          )}
        </div>

        {/* Decile table */}
        <div className="data-table-wrapper">
          <div className="data-table-title">
            Decile breakdown — {meta.fullName}
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Decile</th>
                {policy.deciles[0].payment !== undefined && (
                  <th>Payment (£/yr)</th>
                )}
                {hasShockOffset && <th>Shock offset</th>}
                {policy.deciles[0].extra_vs_baseline !== undefined && (
                  <th>Extra vs baseline</th>
                )}
                {hasNetChange && <th>Net income change</th>}
                {hasNetChange && <th>% change</th>}
              </tr>
            </thead>
            <tbody>
              {policy.deciles.map((d) => (
                <tr key={d.decile}>
                  <td>Decile {d.decile}</td>
                  {d.payment !== undefined && <td>{fmt(d.payment)}</td>}
                  {hasShockOffset && <td>{d.shock_offset_pct}%</td>}
                  {d.extra_vs_baseline !== undefined && (
                    <td>+{fmt(d.extra_vs_baseline)}</td>
                  )}
                  {hasNetChange && <td>+{fmt(d.net_income_change)}</td>}
                  {hasNetChange && <td>+{d.pct_change}%</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPolicy === "combined" && (
        <div className="data-table-wrapper">
          <div className="data-table-title">
            Combined package — component costs
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Component</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>EPG subsidy</td>
                <td>{fmtBn(policies.combined.component_costs_bn.epg)}</td>
              </tr>
              <tr>
                <td>Flat transfer</td>
                <td>
                  {fmtBn(policies.combined.component_costs_bn.flat_transfer)}
                </td>
              </tr>
              <tr>
                <td>CT band rebate</td>
                <td>
                  {fmtBn(policies.combined.component_costs_bn.ct_rebate)}
                </td>
              </tr>
              <tr>
                <td>Extra winter fuel</td>
                <td>
                  {fmtBn(policies.combined.component_costs_bn.extra_wfa)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummarySection() {
  const { policies } = results;
  const [summaryView, setSummaryView] = useState("chart");
  const [summaryMetric, setSummaryMetric] = useState("cost");

  const rows = [
    { key: "epg", name: "EPG subsidy", ...policies.epg },
    { key: "flat_transfer", name: "Flat transfer", ...policies.flat_transfer },
    { key: "ct_rebate", name: "CT band rebate", ...policies.ct_rebate },
    { key: "winter_fuel", name: "Expanded winter fuel", ...policies.winter_fuel },
    { key: "combined", name: "Combined package", ...policies.combined },
  ];

  const costSorted = [...rows].sort((a, b) => b.exchequer_cost_bn - a.exchequer_cost_bn);
  const benefitSorted = [...rows].sort((a, b) => (b.avg_hh_benefit || b.avg_net_income_change || 0) - (a.avg_hh_benefit || a.avg_net_income_change || 0));

  const chartData = summaryMetric === "cost"
    ? costSorted.map((r) => ({
        label: r.name,
        value: r.exchequer_cost_bn,
        tooltip: `${r.name}: ${fmtBn(r.exchequer_cost_bn)}`,
      }))
    : benefitSorted.map((r) => ({
        label: r.name,
        value: r.avg_hh_benefit || r.avg_net_income_change || 0,
        tooltip: `${r.name}: ${fmt(r.avg_hh_benefit || r.avg_net_income_change || 0)}/yr`,
      }));

  const chartMax = Math.max(...chartData.map((d) => d.value)) * 1.15;
  const chartFormat = summaryMetric === "cost" ? (v) => fmtBn(v) : (v) => fmt(v);
  const chartTitle = summaryMetric === "cost" ? "Exchequer cost comparison" : "Average household benefit comparison";
  const chartSubtitle = summaryMetric === "cost" ? "Sorted by cost, highest first" : "Sorted by benefit, highest first";

  return (
    <section className="section" id="summary">
      <h2 className="section-title">Summary comparison</h2>
      <p className="section-description">
        The key trade-off is between fiscal cost and targeting. Flat transfers
        are easy to deliver but expensive and poorly targeted. Council tax
        rebates are moderately targeted but still blunt. EPG subsidies scale
        with consumption but are regressive in absolute terms. Winter fuel
        expansion is well-targeted but narrow. Combined packages layer multiple
        mechanisms but compound costs.
      </p>

      <div className="chart-wrapper">
        <div className="chart-header">
          <div>
            <div className="chart-title">{chartTitle}</div>
            <div className="chart-subtitle">{chartSubtitle}</div>
          </div>
          <ViewToggle view={summaryView} setView={setSummaryView} />
        </div>

        <div className="chart-mode-toggle">
          <button
            className={`scenario-pill${summaryMetric === "cost" ? " active" : ""}`}
            onClick={() => setSummaryMetric("cost")}
          >
            Exchequer cost
          </button>
          <button
            className={`scenario-pill${summaryMetric === "benefit" ? " active" : ""}`}
            onClick={() => setSummaryMetric("benefit")}
          >
            Avg HH benefit
          </button>
        </div>

        {summaryView === "chart" ? (
          <ColumnChart
            data={chartData}
            maxValue={chartMax}
            color="teal"
            formatValue={chartFormat}
          />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Policy</th>
                <th>Exchequer cost</th>
                <th>Avg HH benefit (£/yr)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{fmtBn(r.exchequer_cost_bn)}</td>
                  <td>
                    {fmt(r.avg_hh_benefit || r.avg_net_income_change || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default function Dashboard() {
  return (
    <div className="narrative-container">
      <header className="narrative-hero">
        <h1>Energy price shock: budget impact analysis</h1>
        <p className="narrative-lead">
          How an energy price spike hits UK households, who suffers most, and
          what <strong>five policy responses</strong> would cost the Exchequer.
          Built on <strong>PolicyEngine UK</strong> microsimulation of{" "}
          {results.baseline.n_households_m}m households.
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
