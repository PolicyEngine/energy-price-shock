import { useEffect, useRef, useState, useMemo } from "react";
import * as d3 from "d3";

// Map from GeoJSON properties to resultsV2 region enum
const GEOJSON_TO_ENUM = {
  "North East": "NORTH_EAST",
  "North West": "NORTH_WEST",
  "Yorkshire and the Humber": "YORKSHIRE",
  "East Midlands": "EAST_MIDLANDS",
  "West Midlands": "WEST_MIDLANDS",
  "East of England": "EAST_OF_ENGLAND",
  "Greater London": "LONDON",
  "South East": "SOUTH_EAST",
  "South West": "SOUTH_WEST",
};

// For non-England nations, use Country property
const COUNTRY_TO_ENUM = {
  Wales: "WALES",
  Scotland: "SCOTLAND",
  "Northern Ireland": "NORTHERN_IRELAND",
};

const REGION_DISPLAY = {
  NORTH_EAST: "North East",
  NORTH_WEST: "North West",
  YORKSHIRE: "Yorkshire",
  EAST_MIDLANDS: "East Midlands",
  WEST_MIDLANDS: "West Midlands",
  EAST_OF_ENGLAND: "East of England",
  LONDON: "London",
  SOUTH_EAST: "South East",
  SOUTH_WEST: "South West",
  WALES: "Wales",
  SCOTLAND: "Scotland",
  NORTHERN_IRELAND: "N. Ireland",
};

const METRIC_OPTIONS = [
  { key: "energy_burden_pct", label: "Energy burden (%)" },
  { key: "total_energy", label: "Total energy (£)" },
  { key: "electricity", label: "Electricity (£)" },
  { key: "gas", label: "Gas (£)" },
  { key: "net_income", label: "Net income (£)" },
];

function getRegionEnum(feature) {
  const region = feature.properties.CTR_REG || "";
  if (region && GEOJSON_TO_ENUM[region]) return GEOJSON_TO_ENUM[region];
  const country = feature.properties.Country || "";
  return COUNTRY_TO_ENUM[country] || null;
}

export default function RegionMap({ regionData }) {
  const svgRef = useRef(null);
  const [geoData, setGeoData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [metricKey, setMetricKey] = useState("energy_burden_pct");
  const [hoveredRegion, setHoveredRegion] = useState(null);

  // Build lookup: enum -> region data
  const lookup = useMemo(() => {
    const m = {};
    for (const r of regionData) {
      m[r.region] = r;
    }
    return m;
  }, [regionData]);

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

  // Color scale
  const colorScale = useMemo(() => {
    const vals = regionData.map((r) => r[metricKey]).filter((v) => v != null);
    if (!vals.length) return () => "#e5e7eb";
    const isCurrency = metricKey !== "energy_burden_pct";
    if (isCurrency) {
      return d3.scaleSequential((t) => d3.interpolateRgb("#dbeafe", "#1e40af")(t))
        .domain([d3.min(vals), d3.max(vals)]);
    }
    return d3.scaleSequential(d3.interpolateOrRd).domain([d3.min(vals), d3.max(vals)]);
  }, [regionData, metricKey]);

  // Render map
  useEffect(() => {
    if (!geoData || !svgRef.current || !regionData.length) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const width = 440;
    const height = 660;
    svg.attr("viewBox", `0 0 ${width} ${height}`);

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
    const scale = Math.min((width - 30) / dataWidth, (height - 30) / dataHeight);
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
        const enumKey = getRegionEnum(d);
        const r = enumKey ? lookup[enumKey] : null;
        if (!r) return "#f1f5f9";
        const val = r[metricKey];
        return val != null ? colorScale(val) : "#f1f5f9";
      })
      .attr("stroke", (d) => {
        // Use slightly darker stroke for region boundaries
        return "#94a3b8";
      })
      .attr("stroke-width", 0.08)
      .attr("cursor", "pointer")
      .on("mouseover", function (event, d) {
        const enumKey = getRegionEnum(d);
        if (!enumKey) return;
        // Highlight all constituencies in this region
        g.selectAll("path").each(function (dd) {
          if (getRegionEnum(dd) === enumKey) {
            d3.select(this).attr("stroke", "#1e293b").attr("stroke-width", 1);
          }
        });
        setHoveredRegion(enumKey);
      })
      .on("mouseout", function () {
        g.selectAll("path").attr("stroke", "#94a3b8").attr("stroke-width", 0.08);
        setHoveredRegion(null);
      });

    // Zoom
    const zoom = d3.zoom().scaleExtent([1, 6]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);
  }, [geoData, regionData, metricKey, colorScale, lookup]);

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading map...</p>;

  const isCurrency = metricKey !== "energy_burden_pct";
  const fmtVal = (v) => {
    if (v == null) return "N/A";
    if (isCurrency) return `£${v.toLocaleString("en-GB")}`;
    return `${v}%`;
  };

  const hoveredData = hoveredRegion ? lookup[hoveredRegion] : null;
  const sortedRegions = [...regionData].sort((a, b) => b[metricKey] - a[metricKey]);

  return (
    <div>
      {/* Metric pills */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {METRIC_OPTIONS.map((m) => (
          <button
            key={m.key}
            className={`scenario-btn${metricKey === m.key ? " active" : ""}`}
            onClick={() => setMetricKey(m.key)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* Map */}
        <div style={{ position: "relative", flex: "1 1 420px", maxWidth: 460 }}>
          <svg ref={svgRef} style={{ width: "100%", height: "auto", background: "#f8fafc", borderRadius: 8 }} />

          {/* Tooltip */}
          {hoveredData && (
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                background: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: "0.8rem",
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                minWidth: 180,
                zIndex: 10,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>
                {REGION_DISPLAY[hoveredRegion] || hoveredRegion}
              </div>
              <table style={{ fontSize: "0.78rem", borderCollapse: "collapse" }}>
                <tbody>
                  <tr>
                    <td style={{ paddingRight: 10, color: "#64748b" }}>Electricity</td>
                    <td style={{ fontWeight: 600 }}>£{hoveredData.electricity.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 10, color: "#64748b" }}>Gas</td>
                    <td style={{ fontWeight: 600 }}>£{hoveredData.gas.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 10, color: "#64748b" }}>Total energy</td>
                    <td>£{hoveredData.total_energy.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 10, color: "#64748b" }}>Net income</td>
                    <td>£{hoveredData.net_income.toLocaleString()}</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 10, color: "#64748b" }}>Energy burden</td>
                    <td style={{ fontWeight: 700, color: "#dc2626" }}>{hoveredData.energy_burden_pct}%</td>
                  </tr>
                  <tr>
                    <td style={{ paddingRight: 10, color: "#64748b" }}>Households</td>
                    <td>{hoveredData.households_m}m</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Region ranking */}
        <div style={{ flex: "1 1 240px", minWidth: 220 }}>
          {/* Legend */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 6 }}>
              {METRIC_OPTIONS.find((m) => m.key === metricKey)?.label}
            </div>
            <RegionLegend colorScale={colorScale} regionData={regionData} metricKey={metricKey} fmtVal={fmtVal} />
          </div>

          {/* Ranked list */}
          <div style={{ fontSize: "0.78rem" }}>
            {sortedRegions.map((r, i) => (
              <div
                key={r.region}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: "1px solid #f1f5f9",
                  cursor: "pointer",
                  background: hoveredRegion === r.region ? "#f1f5f9" : "transparent",
                  borderRadius: 4,
                  paddingLeft: 4,
                  paddingRight: 4,
                }}
                onMouseEnter={() => setHoveredRegion(r.region)}
                onMouseLeave={() => setHoveredRegion(null)}
              >
                <span style={{ color: "#475569" }}>
                  {i + 1}. {REGION_DISPLAY[r.region] || r.region}
                </span>
                <span style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      borderRadius: 2,
                      background: colorScale(r[metricKey]),
                    }}
                  />
                  {fmtVal(r[metricKey])}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function RegionLegend({ colorScale, regionData, metricKey, fmtVal }) {
  const vals = regionData.map((r) => r[metricKey]).filter((v) => v != null);
  if (!vals.length) return null;
  const lo = d3.min(vals);
  const hi = d3.max(vals);
  const steps = 40;
  const gradient = Array.from({ length: steps }, (_, i) => {
    const t = lo + (hi - lo) * (i / (steps - 1));
    return colorScale(t);
  });

  return (
    <div>
      <div style={{ display: "flex", height: 12, borderRadius: 4, overflow: "hidden" }}>
        {gradient.map((c, i) => (
          <div key={i} style={{ flex: 1, background: c }} />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.72rem", color: "#64748b", marginTop: 2 }}>
        <span>{fmtVal(lo)}</span>
        <span>{fmtVal(hi)}</span>
      </div>
    </div>
  );
}
