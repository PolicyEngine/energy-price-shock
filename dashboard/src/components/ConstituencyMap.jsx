import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";

// Map parent activeView to constituency data keys
const VIEW_TO_METRIC = {
  elec_gas: "avg_energy",
  energy_share: "energy_burden_pct",
  net_income: "avg_income",
};

const VIEW_TO_LABEL = {
  elec_gas: "Total energy (£)",
  energy_share: "Energy burden (%)",
  net_income: "Net income (£)",
};

export default function ConstituencyMap({ data, activeView = "elec_gas", customMetricKey = null, customLabel = null }) {
  const svgRef = useRef(null);
  const tooltipRef = useRef(null);
  const [geoData, setGeoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const metricKey = customMetricKey || VIEW_TO_METRIC[activeView] || "avg_energy";
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedConstituency, setSelectedConstituency] = useState(null);

  const constituencies = data?.constituencies || [];

  // Build lookup: code -> constituency data
  const lookup = useMemo(() => {
    const m = {};
    for (const c of constituencies) {
      m[c.code] = c;
    }
    return m;
  }, [constituencies]);

  // Load GeoJSON
  useEffect(() => {
    fetch("/data/uk_constituencies_2024.geojson")
      .then((r) => r.json())
      .then((geo) => {
        setGeoData(geo);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Color scale — blue palette for all metrics
  const colorScale = useMemo(() => {
    if (!constituencies.length) return () => "#e5e7eb";
    const vals = constituencies.map((c) => c[metricKey]).filter((v) => v != null);
    if (!vals.length) return () => "#e5e7eb";
    return d3.scaleSequential((t) => d3.interpolateRgb("#dbeafe", "#1e40af")(t))
      .domain([d3.min(vals), d3.max(vals)]);
  }, [constituencies, metricKey]);

  // Search results
  const searchResults = useMemo(() => {
    if (!searchQuery || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return constituencies
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 8)
      .map((c) => ({ ...c, value: c[metricKey] }));
  }, [searchQuery, constituencies, metricKey]);

  // Render map
  useEffect(() => {
    if (!geoData || !svgRef.current || !constituencies.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 500;
    const height = 750;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    // British National Grid projection
    const features = geoData.features;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const f of features) {
      const coords = f.geometry.type === "MultiPolygon"
        ? f.geometry.coordinates.flat(2)
        : f.geometry.coordinates.flat(1);
      for (const [x, y] of coords) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    const dataWidth = maxX - minX;
    const dataHeight = maxY - minY;
    const scale = Math.min((width - 40) / dataWidth, (height - 40) / dataHeight);
    const offsetX = (width - dataWidth * scale) / 2;
    const offsetY = (height - dataHeight * scale) / 2;

    const projection = d3.geoTransform({
      point: function (x, y) {
        this.stream.point(
          (x - minX) * scale + offsetX,
          (maxY - y) * scale + offsetY
        );
      },
    });

    const path = d3.geoPath().projection(projection);

    const g = svg.append("g");

    g.selectAll("path")
      .data(features)
      .join("path")
      .attr("d", path)
      .attr("fill", (d) => {
        const code = d.properties.GSScode;
        const c = lookup[code];
        if (!c) return "#f1f5f9";
        const val = c[metricKey];
        return val != null ? colorScale(val) : "#f1f5f9";
      })
      .attr("stroke", "#fff")
      .attr("stroke-width", 0.15)
      .attr("cursor", "pointer")
      .on("mouseover", function (event, d) {
        d3.select(this).attr("stroke", "#1e293b").attr("stroke-width", 1.5);
        const code = d.properties.GSScode;
        const c = lookup[code];
        if (c) {
          setSelectedConstituency(c);
        }
      })
      .on("mouseout", function () {
        d3.select(this).attr("stroke", "#fff").attr("stroke-width", 0.15);
        setSelectedConstituency(null);
      })
      .on("mousemove", function (event) {
        if (tooltipRef.current) {
          const rect = svgRef.current.parentElement.getBoundingClientRect();
          const x = event.clientX - rect.left + 12;
          const y = event.clientY - rect.top - 10;
          tooltipRef.current.style.left = `${x}px`;
          tooltipRef.current.style.top = `${y}px`;
        }
      });

    // Zoom
    const zoom = d3.zoom().scaleExtent([1, 8]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);

  }, [geoData, constituencies, metricKey, colorScale, lookup]);

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading map data...</p>;

  const selectedLabel = customLabel || VIEW_TO_LABEL[activeView] || metricKey;
  // Determine format: keys starting with "extra_cost" or "behav_cost" are £, not %
  const isFPChange = metricKey.startsWith("_fp_change_");
  const isPctKey = !isFPChange && (metricKey.includes("_pct") || metricKey.includes("_fp_") || metricKey.includes("_bfp_")
    || metricKey.includes("_bpct_")
    || metricKey.startsWith("burden_pct") || metricKey.startsWith("fp_pct") || metricKey.startsWith("fuel_poverty")
    || metricKey === "energy_burden_pct");
  const isCostKey = !isPctKey && !isFPChange && (metricKey.startsWith("extra_cost") || metricKey.startsWith("behav_cost")
    || metricKey.includes("energy") || metricKey.includes("income") || metricKey.includes("electricity") || metricKey.includes("gas")
    || metricKey.includes("_cost_") || metricKey.includes("_bcost_"));
  const isPct = isPctKey;

  const fmtVal = (v) => {
    if (v == null) return "N/A";
    if (isFPChange) return `${v}pp`;
    if (isCostKey) return `£${v.toLocaleString("en-GB")}`;
    if (isPct) return `${v}%`;
    return String(v);
  };

  return (
    <div>
      {/* Search */}
      <div style={{ marginBottom: 12, position: "relative" }}>
        <input
          type="text"
          placeholder="Search constituency..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: "100%",
            maxWidth: 320,
            padding: "6px 12px",
            border: "1px solid #cbd5e1",
            borderRadius: 6,
            fontSize: "0.85rem",
          }}
        />
        {searchResults.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              width: 320,
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: 6,
              boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
              zIndex: 10,
              maxHeight: 280,
              overflowY: "auto",
            }}
          >
            {searchResults.map((r) => (
              <div
                key={r.code}
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  fontSize: "0.82rem",
                }}
                onMouseEnter={() => setSelectedConstituency(r)}
                onMouseLeave={() => setSelectedConstituency(null)}
                onClick={() => {
                  setSearchQuery("");
                  setSelectedConstituency(r);
                }}
              >
                <strong>{r.name}</strong>{" "}
                <span style={{ color: "#64748b" }}>
                  {selectedLabel}: {fmtVal(r.value)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Map */}
        <div style={{ position: "relative", flex: "1 1 500px", maxWidth: 520 }}>
          <svg ref={svgRef} style={{ width: "100%", height: "auto", background: "#f8fafc", borderRadius: 8 }} />
          {selectedConstituency && (
            <div
              ref={tooltipRef}
              style={{
                position: "absolute",
                pointerEvents: "none",
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: "0.8rem",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                zIndex: 20,
                minWidth: 200,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{selectedConstituency.name}</div>
              <div style={{ color: "#64748b", fontSize: "0.75rem", marginBottom: 6 }}>
                {selectedConstituency.region}
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#1e40af", marginBottom: 4 }}>
                {selectedLabel}: {fmtVal(selectedConstituency[metricKey])}
              </div>
              <table style={{ fontSize: "0.75rem", borderCollapse: "collapse", color: "#64748b" }}>
                <tbody>
                  <tr><td style={{ paddingRight: 8 }}>Energy</td><td>£{selectedConstituency.avg_energy?.toLocaleString()}</td></tr>
                  <tr><td style={{ paddingRight: 8 }}>Electricity</td><td>£{selectedConstituency.avg_electricity?.toLocaleString()}</td></tr>
                  <tr><td style={{ paddingRight: 8 }}>Gas</td><td>£{selectedConstituency.avg_gas?.toLocaleString()}</td></tr>
                  <tr><td style={{ paddingRight: 8 }}>Income</td><td>£{selectedConstituency.avg_income?.toLocaleString()}</td></tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Legend + top/bottom lists */}
        <div style={{ flex: "1 1 280px", minWidth: 260 }}>
          {/* Color legend */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6 }}>
              {selectedLabel}
            </div>
            <LegendBar colorScale={colorScale} constituencies={constituencies} metricKey={metricKey} fmtVal={fmtVal} />
          </div>

          {/* Top 10 */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>
              Highest 10 constituencies
            </div>
            <RankList
              items={[...constituencies].sort((a, b) => b[metricKey] - a[metricKey]).slice(0, 10)}
              metricKey={metricKey}
              fmtVal={fmtVal}
              onHover={setSelectedConstituency}
            />
          </div>

          {/* Bottom 10 */}
          <div>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 4 }}>
              Lowest 10 constituencies
            </div>
            <RankList
              items={[...constituencies].sort((a, b) => a[metricKey] - b[metricKey]).slice(0, 10)}
              metricKey={metricKey}
              fmtVal={fmtVal}
              onHover={setSelectedConstituency}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function LegendBar({ colorScale, constituencies, metricKey, fmtVal }) {
  const vals = constituencies.map((c) => c[metricKey]).filter((v) => v != null);
  if (!vals.length) return null;
  const lo = d3.min(vals);
  const hi = d3.max(vals);

  const steps = 60;
  const gradient = Array.from({ length: steps }, (_, i) => {
    const t = lo + (hi - lo) * (i / (steps - 1));
    return colorScale(t);
  });

  return (
    <div>
      <div
        style={{
          display: "flex",
          height: 14,
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        {gradient.map((c, i) => (
          <div key={i} style={{ flex: 1, background: c }} />
        ))}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.72rem",
          color: "#64748b",
          marginTop: 2,
        }}
      >
        <span>{fmtVal(lo)}</span>
        <span>{fmtVal(hi)}</span>
      </div>
    </div>
  );
}

function RankList({ items, metricKey, fmtVal, onHover }) {
  return (
    <div style={{ fontSize: "0.78rem" }}>
      {items.map((c, i) => (
        <div
          key={c.code}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "3px 0",
            borderBottom: "1px solid #f1f5f9",
            cursor: "pointer",
          }}
          onMouseEnter={() => onHover(c)}
          onMouseLeave={() => onHover(null)}
        >
          <span style={{ color: "#475569" }}>
            {i + 1}. {c.name}
          </span>
          <span style={{ fontWeight: 600 }}>{fmtVal(c[metricKey])}</span>
        </div>
      ))}
    </div>
  );
}
