// HTML Report Renderer — generates a self-contained, beautiful HTML dashboard
// from an InsightReport. No external dependencies needed. Uses SVG for charts.

import type {
  InsightReport,
  KnowledgeHeatmap,
  HeatmapCell,
  KnowledgeLossRanking,
  LifecycleStats,
  TMSKnowledgeNetwork,
  TeamDepartureOverview,
} from "./storage/types.js";

const CATEGORY_COLORS: Record<string, string> = {
  security: "#ef4444",
  decision: "#f59e0b",
  api: "#3b82f6",
  process: "#10b981",
  experience: "#8b5cf6",
  general: "#6b7280",
};

function getCategoryColor(cat: string): string {
  return CATEGORY_COLORS[cat] ?? "#6b7280";
}

function strengthColor(strength: number): string {
  if (strength >= 0.8) return "#10b981";
  if (strength >= 0.5) return "#3b82f6";
  if (strength >= 0.3) return "#f59e0b";
  if (strength >= 0.1) return "#f97316";
  return "#ef4444";
}

function riskColor(risk: number): string {
  if (risk >= 0.7) return "#ef4444";
  if (risk >= 0.5) return "#f97316";
  if (risk >= 0.3) return "#f59e0b";
  return "#10b981";
}

function healthColor(score: number): string {
  if (score >= 70) return "#10b981";
  if (score >= 50) return "#f59e0b";
  if (score >= 30) return "#f97316";
  return "#ef4444";
}

function pct(v: number): string {
  return `${Math.round(v * 100)}`;
}

export function renderHtmlReport(report: InsightReport): string {
  const { summary, heatmap, lossRanking, lifecycle, network, departureOverview } = report;

  const radarSvg = renderRadarChart(lifecycle, departureOverview, lossRanking);
  const heatmapHtml = renderHeatmap(heatmap);
  const lossRankingHtml = renderLossRanking(lossRanking);
  const lifecycleHtml = renderLifecycleStats(lifecycle);
  const networkHtml = renderTMSNetwork(network);
  const departureHtml = renderDepartureOverview(departureOverview);

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Team Memory Insight Report — ${report.teamId}</title>
<style>
:root {
  --bg: #0f172a;
  --surface: #1e293b;
  --surface2: #334155;
  --text: #f1f5f9;
  --text-dim: #94a3b8;
  --border: #475569;
  --accent: #3b82f6;
  --green: #10b981;
  --amber: #f59e0b;
  --red: #ef4444;
  --orange: #f97316;
  --purple: #8b5cf6;
}
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.6;
  padding: 2rem;
}
.container { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 2rem; margin-bottom: 0.5rem; }
h2 { font-size: 1.4rem; margin-bottom: 1rem; color: var(--accent); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
h3 { font-size: 1.1rem; margin-bottom: 0.5rem; color: var(--text-dim); }
.subtitle { color: var(--text-dim); margin-bottom: 2rem; font-size: 0.95rem; }
.grid { display: grid; gap: 1.5rem; }
.grid-2 { grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); }
.grid-4 { grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); }
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 1.5rem;
}
.card-accent { border-left: 4px solid var(--accent); }
.card-green { border-left: 4px solid var(--green); }
.card-amber { border-left: 4px solid var(--amber); }
.card-red { border-left: 4px solid var(--red); }
.stat-value { font-size: 2.5rem; font-weight: 700; }
.stat-label { color: var(--text-dim); font-size: 0.85rem; margin-top: 0.25rem; }
.badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
}
.badge-green { background: rgba(16, 185, 129, 0.15); color: var(--green); }
.badge-amber { background: rgba(245, 158, 11, 0.15); color: var(--amber); }
.badge-red { background: rgba(239, 68, 68, 0.15); color: var(--red); }
.badge-blue { background: rgba(59, 130, 246, 0.15); color: var(--accent); }
.badge-purple { background: rgba(139, 92, 246, 0.15); color: var(--purple); }
table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
th, td { padding: 0.6rem 0.8rem; text-align: left; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
th { color: var(--text-dim); font-weight: 500; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em; }
tr:hover { background: var(--surface2); }
.progress-bar {
  height: 8px;
  background: var(--surface2);
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
}
.progress-fill {
  height: 100%;
  border-radius: 4px;
  transition: width 0.3s;
}
.list-item { padding: 0.75rem 0; border-bottom: 1px solid var(--border); }
.list-item:last-child { border-bottom: none; }
.tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  background: var(--surface2);
  color: var(--text-dim);
  margin-right: 4px;
}
.recommendation {
  padding: 0.75rem;
  background: var(--surface);
  border-radius: 8px;
  margin-bottom: 0.5rem;
  border-left: 3px solid var(--accent);
}
@media (max-width: 768px) {
  body { padding: 1rem; }
  .grid-2, .grid-3, .grid-4 { grid-template-columns: 1fr; }
}
/* Radar chart styles */
.radar-container { display: flex; align-items: center; justify-content: center; }
/* Bar chart styles */
.bar-chart { display: flex; align-items: flex-end; gap: 4px; height: 80px; padding-top: 4px; }
.bar-item { display: flex; flex-direction: column; align-items: center; flex: 1; }
.bar-fill { width: 100%; border-radius: 3px 3px 0 0; min-height: 2px; }
.bar-label { font-size: 0.65rem; color: var(--text-dim); margin-top: 4px; text-align: center; }
.bar-value { font-size: 0.65rem; color: var(--text); margin-bottom: 2px; }
/* Pulse animation for critical items */
@keyframes pulse { 0%,100%{ opacity:1; } 50%{ opacity:0.6; } }
.pulse { animation: pulse 2s ease-in-out infinite; }
/* Gradient text */
.gradient-text {
  background: linear-gradient(135deg, var(--accent), var(--purple));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
</style>
</head>
<body>
<div class="container">

<!-- Header -->
<div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2rem;">
  <div>
    <h1><span class="gradient-text">Team Memory Insight Report</span></h1>
    <p class="subtitle">Generated: ${new Date(report.generatedAt).toLocaleString('zh-CN')} | Team: ${report.teamId}</p>
  </div>
  <div style="text-align: right;">
    <div class="stat-value" style="color: ${healthColor(summary.teamHealthScore)};">${summary.teamHealthScore}</div>
    <div class="stat-label">Team Health Score / 100</div>
  </div>
</div>

<!-- Radar Chart + Top Stats -->
<div class="grid grid-2" style="margin-bottom: 2rem;">
  <div class="card card-accent">
    <h3 style="color: var(--accent); text-align: center;">Cognitive Capability Radar</h3>
    <div class="radar-container" style="display:flex;justify-content:center;">
      ${radarSvg}
    </div>
  </div>
  <div>
    <div class="grid grid-2" style="gap: 1rem;">
      <div class="card card-accent">
        <div class="stat-value">${summary.totalMemories}</div>
        <div class="stat-label">Total Memories</div>
      </div>
      <div class="card ${lifecycle.avgStrength >= 0.5 ? 'card-green' : lifecycle.avgStrength >= 0.3 ? 'card-amber' : 'card-red'}">
        <div class="stat-value">${pct(lifecycle.avgStrength)}%</div>
        <div class="stat-label">Avg Memory Strength</div>
      </div>
      <div class="card ${lifecycle.avgRiskScore <= 0.3 ? 'card-green' : lifecycle.avgRiskScore <= 0.5 ? 'card-amber' : 'card-red'}">
        <div class="stat-value">${pct(lifecycle.avgRiskScore)}%</div>
        <div class="stat-label">Avg Risk Score</div>
      </div>
      <div class="card ${departureOverview.teamResilienceScore >= 0.7 ? 'card-green' : departureOverview.teamResilienceScore >= 0.5 ? 'card-amber' : 'card-red'}">
        <div class="stat-value">${pct(departureOverview.teamResilienceScore)}%</div>
        <div class="stat-label">Team Resilience</div>
      </div>
    </div>
  </div>
</div>

<!-- Executive Summary: Risks & Recommendations -->
<div class="grid grid-2" style="margin-bottom: 2rem;">
  <div class="card">
    <h2><span style="color: var(--red);">⚠</span> Top Risks</h2>
    ${summary.topRisks.length > 0
      ? summary.topRisks.map((r, i) => {
          const badge = i === 0 ? 'badge-red' : i === 1 ? 'badge-red' : 'badge-amber';
          return `<div class="list-item"><span class="badge ${badge}">#${i + 1}</span> ${r}</div>`;
        }).join('')
      : '<p style="color: var(--green);">No critical risks detected. Team cognitive state is healthy.</p>'
    }
  </div>
  <div class="card">
    <h2><span style="color: var(--accent);">→</span> Recommendations</h2>
    ${summary.recommendations.map((r) => `<div class="recommendation">${r}</div>`).join('')}
  </div>
</div>

<!-- Knowledge Heatmap -->
<h2>Knowledge Heatmap</h2>
${heatmapHtml}

<!-- Knowledge Loss Ranking -->
<h2 style="margin-top: 2rem;">Knowledge Loss Risk Ranking</h2>
${lossRankingHtml}

<!-- Lifecycle Stats -->
<h2 style="margin-top: 2rem;">Memory Lifecycle Statistics</h2>
${lifecycleHtml}

<!-- TMS Network -->
<h2 style="margin-top: 2rem;">Team Knowledge Network</h2>
${networkHtml}

<!-- Departure Overview -->
<h2 style="margin-top: 2rem;">Knowledge Transfer Simulation</h2>
${departureHtml}

</div>
</body>
</html>`;
}

// ============================================================================
// Radar Chart (SVG)
// ============================================================================

function renderRadarChart(
  lifecycle: LifecycleStats,
  departureOverview: TeamDepartureOverview,
  lossRanking: KnowledgeLossRanking,
): string {
  const cx = 130, cy = 130, r = 90;

  // 5 dimensions, all 0-100 scale
  const dimensions = [
    {
      label: 'Memory\nFreshness',
      value: lifecycle.totalMemories > 0 ? lifecycle.avgStrength * 100 : 50,
    },
    {
      label: 'Knowledge\nDistribution',
      value: departureOverview.teamResilienceScore * 100,
    },
    {
      label: 'Risk\nManagement',
      value: lifecycle.totalMemories > 0 ? (1 - lifecycle.avgRiskScore) * 100 : 50,
    },
    {
      label: 'Conflict\nResolution',
      value: lifecycle.totalMemories > 0
        ? (1 - (lifecycle.conflictingMemories / lifecycle.totalMemories)) * 100
        : 80,
    },
    {
      label: 'Coverage\nDepth',
      value: lossRanking.rankings.length > 0
        ? Math.max(0, (1 - lossRanking.teamAvgSinglePoints / Math.max(lifecycle.totalMemories, 1))) * 100
        : 70,
    },
  ];

  const n = dimensions.length;

  // Helper: polar to cartesian
  const polar = (angle: number, radius: number) => ({
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  });

  // Grid levels
  const gridLevels = [0.25, 0.5, 0.75, 1.0];
  let gridSvg = '';
  for (const level of gridLevels) {
    const points: string[] = [];
    for (let i = 0; i < n; i++) {
      const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
      const p = polar(angle, r * level);
      points.push(`${p.x},${p.y}`);
    }
    gridSvg += `<polygon points="${points.join(' ')}" fill="none" stroke="rgba(71,85,105,${level === 1 ? 0.5 : 0.3})" stroke-width="1"/>`;
    // Label for the outermost level
    if (level === 1) {
      const labelAngle = (Math.PI * 2 * 0 / n) - Math.PI / 2;
      const lp = polar(labelAngle, r * level + 14);
      gridSvg += `<text x="${lp.x}" y="${lp.y}" fill="#94a3b8" font-size="9" text-anchor="middle">${Math.round(level * 100)}</text>`;
    }
  }

  // Data polygon
  const dataPoints: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    const val = Math.max(0, Math.min(100, dimensions[i].value));
    const p = polar(angle, r * (val / 100));
    dataPoints.push(`${p.x},${p.y}`);
  }
  const dataSvg = `<polygon points="${dataPoints.join(' ')}" fill="rgba(59, 130, 246, 0.2)" stroke="#3b82f6" stroke-width="2"/>`;

  // Data dots + labels
  let dotsSvg = '';
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i / n) - Math.PI / 2;
    const val = Math.max(0, Math.min(100, dimensions[i].value));
    const p = polar(angle, r * (val / 100));

    dotsSvg += `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#3b82f6" stroke="#0f172a" stroke-width="2"/>`;

    // Axis lines
    const endP = polar(angle, r);
    dotsSvg += `<line x1="${cx}" y1="${cy}" x2="${endP.x}" y2="${endP.y}" stroke="rgba(71,85,105,0.3)" stroke-width="1"/>`;

    // Dimension labels
    const labelAngle = angle;
    const labelR = r + 28;
    const lx = cx + labelR * Math.cos(labelAngle);
    const ly = cy + labelR * Math.sin(labelAngle);

    const lines = dimensions[i].label.split('\n');
    const textY = ly - ((lines.length - 1) * 7);
    dotsSvg += lines.map((line, li) =>
      `<text x="${lx}" y="${textY + li * 14}" fill="${strengthColor(val / 100)}" font-size="10" font-weight="600" text-anchor="middle">${line}</text>`
    ).join('');

    // Value label
    const valueR = r * (val / 100) - 14;
    const vx = cx + valueR * Math.cos(labelAngle);
    const vy = cy + valueR * Math.sin(labelAngle);
    dotsSvg += `<text x="${vx}" y="${vy}" fill="#f1f5f9" font-size="11" font-weight="700" text-anchor="middle">${Math.round(val)}</text>`;
  }

  const svgW = 260, svgH = 260;
  return `<svg width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${svgW}" height="${svgH}" fill="transparent"/>
    ${gridSvg}
    ${dataSvg}
    ${dotsSvg}
  </svg>`;
}

// ============================================================================
// Heatmap Renderer
// ============================================================================

function renderHeatmap(heatmap: KnowledgeHeatmap): string {
  const { categories, members, cells, blindSpots, denseAreas } = heatmap;

  if (members.length === 0 || members[0] === 'team') {
    const rows = cells.map((c) => {
      const color = strengthColor(c.avgStrength);
      return `<tr>
        <td><span style="color: ${color};">●</span> ${c.category}</td>
        <td>${c.memoryCount}</td>
        <td>
          <div class="progress-bar"><div class="progress-fill" style="width: ${pct(c.avgStrength)}%; background: ${color};"></div></div>
        </td>
        <td><span style="color: ${riskColor(c.avgRisk)};">${pct(c.avgRisk)}%</span></td>
      </tr>`;
    }).join('');

    return `<table>
      <tr><th>Category</th><th>Memories</th><th>Strength</th><th>Risk</th></tr>
      ${rows}
    </table>`;
  }

  const gridData: Record<string, Record<string, HeatmapCell | undefined>> = {};
  for (const cat of categories) {
    gridData[cat] = {};
    for (const mem of members) {
      gridData[cat][mem] = cells.find((c) => c.category === cat && c.memberId === mem);
    }
  }

  const headerRow = `<tr><th></th>${members.map((m) => {
    const cell = cells.find((c) => c.memberId === m);
    return `<th>${cell?.displayName ?? m}</th>`;
  }).join('')}</tr>`;

  const dataRows = categories.map((cat) => {
    const cellValues = members.map((mem) => {
      const cell = gridData[cat][mem];
      if (!cell) return '<td style="background: rgba(15, 23, 42, 0.5); color: var(--text-dim); text-align: center;">—</td>';
      const bgAlpha = Math.min(0.8, cell.memoryCount * 0.15);
      const bgColor = `rgba(59, 130, 246, ${bgAlpha})`;
      return `<td style="background: ${bgColor}; text-align: center; padding: 0.75rem;">
        <div style="font-size: 1.2rem; font-weight: 700;">${cell.memoryCount}</div>
        <div style="font-size: 0.7rem; color: var(--text-dim);">
          <span style="color: ${strengthColor(cell.avgStrength)};">●</span>
          ${pct(cell.avgRisk)}% risk
        </div>
      </td>`;
    }).join('');
    return `<tr><td style="font-weight: 600;"><span style="color: ${getCategoryColor(cat)};">●</span> ${cat}</td>${cellValues}</tr>`;
  }).join('');

  const blindSpotsHtml = blindSpots.length > 0
    ? `<div style="margin-top: 1rem; padding: 0.75rem; background: var(--surface); border-radius: 8px; border-left: 3px solid var(--red);">
        <strong style="color: var(--red);">Blind Spots (${blindSpots.length}):</strong>
        ${blindSpots.map((bs) => `<div style="font-size: 0.85rem; color: var(--text-dim); margin-top: 2px;">• <strong>${bs.category}:</strong> ${bs.reason}</div>`).join('')}
      </div>`
    : '';

  const denseAreasHtml = denseAreas.length > 0
    ? `<div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--surface); border-radius: 8px; border-left: 3px solid var(--green);">
        <strong style="color: var(--green);">Knowledge Dense Areas:</strong>
        ${denseAreas.map((da) => `<div style="font-size: 0.85rem; color: var(--text-dim); margin-top: 2px;">• <strong>${da.category}:</strong> ${da.count} memories across ${da.holders} member(s)</div>`).join('')}
      </div>`
    : '';

  return `
    <div style="overflow-x: auto;">
      <table>${headerRow}${dataRows}</table>
    </div>
    ${blindSpotsHtml}
    ${denseAreasHtml}
  `;
}

// ============================================================================
// Loss Ranking Renderer
// ============================================================================

function renderLossRanking(ranking: KnowledgeLossRanking): string {
  if (ranking.rankings.length === 0) {
    return '<div class="card"><p style="color: var(--text-dim);">No TMS data available for loss ranking.</p></div>';
  }

  const rows = ranking.rankings.map((r, i) => {
    const riskVal = r.riskScore * 100;
    let badgeClass: string;
    let badgeText: string;
    if (riskVal >= 70) { badgeClass = 'badge-red'; badgeText = 'Critical'; }
    else if (riskVal >= 50) { badgeClass = 'badge-amber'; badgeText = 'High Risk'; }
    else if (riskVal >= 35) { badgeClass = 'badge-blue'; badgeText = 'Moderate'; }
    else { badgeClass = 'badge-green'; badgeText = 'Low Risk'; }

    return `<tr>
      <td style="font-weight: 700; color: var(--text-dim);">${i + 1}</td>
      <td style="font-weight: 600;">${r.displayName}</td>
      <td><strong style="color: ${r.singlePointCount > 2 ? 'var(--red)' : r.singlePointCount > 0 ? 'var(--amber)' : 'var(--green)'};">${r.singlePointCount}</strong></td>
      <td>${r.totalKnownMemories}</td>
      <td>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="progress-bar" style="width: 80px;"><div class="progress-fill" style="width: ${pct(r.riskScore)}%; background: ${riskColor(r.riskScore)};"></div></div>
          <span style="color: ${riskColor(r.riskScore)}; font-size: 0.85rem; font-weight: 600;">${pct(r.riskScore)}%</span>
        </div>
      </td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
    </tr>`;
  }).join('');

  // Critical memories detail for top-ranked member
  let criticalDetail = '';
  if (ranking.rankings.length > 0 && ranking.rankings[0].criticalMemories.length > 0) {
    const top = ranking.rankings[0];
    const detailItems = top.criticalMemories.slice(0, 3).map((id) => {
      return `<div style="font-size: 0.8rem; color: var(--text-dim); margin-top: 4px;">• <code style="color: var(--accent);">${id}</code></div>`;
    }).join('');
    criticalDetail = `<div style="margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid var(--border);">
      <strong style="font-size: 0.85rem; color: var(--text-dim);">${top.displayName}'s critical memories:</strong>
      ${detailItems}
    </div>`;
  }

  return `<div class="card">
    <div style="display: flex; gap: 2rem; margin-bottom: 1rem;">
      <div>
        <div class="stat-value" style="font-size: 1.5rem;">${ranking.teamAvgSinglePoints.toFixed(1)}</div>
        <div class="stat-label">Avg Single Points / Member</div>
      </div>
      <div>
        <div class="stat-value" style="font-size: 1.5rem; color: ${getCategoryColor(ranking.mostVulnerableCategory)};">${ranking.mostVulnerableCategory}</div>
        <div class="stat-label">Most Vulnerable Category</div>
      </div>
    </div>
    <table>
      <tr><th>Rank</th><th>Member</th><th>Single Points</th><th>Total Known</th><th>Risk Score</th><th>Level</th></tr>
      ${rows}
    </table>
    ${criticalDetail}
  </div>`;
}

// ============================================================================
// Lifecycle Stats Renderer
// ============================================================================

function renderLifecycleStats(lifecycle: LifecycleStats): string {
  const sd = lifecycle.strengthDistribution;
  const total = lifecycle.totalMemories || 1;

  // CSS-only bar chart for strength distribution
  const maxCount = Math.max(...Object.values(sd), 1);
  const strengthBars = (['fresh', 'strong', 'fading', 'weak', 'critical'] as const).map((label) => {
    const count = sd[label];
    const heightPct = (count / maxCount) * 100;
    const color = strengthColor(label === 'fresh' ? 0.9 : label === 'strong' ? 0.6 : label === 'fading' ? 0.4 : label === 'weak' ? 0.2 : 0.05);
    return `<div class="bar-item">
      <div class="bar-value">${count}</div>
      <div class="bar-fill" style="height: ${Math.max(heightPct, 4)}%; background: ${color}; width: 32px;"></div>
      <div class="bar-label">${label}</div>
    </div>`;
  }).join('');

  const categoryRows = Object.entries(lifecycle.categoryBreakdown)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([cat, data]) => {
      const riskDot = riskColor(data.avgRisk);
      return `<tr>
        <td><span style="color: ${getCategoryColor(cat)};">●</span> ${cat}</td>
        <td style="font-weight: 600;">${data.count}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="progress-bar" style="width: 60px;"><div class="progress-fill" style="width: ${pct(data.avgStrength)}%; background: ${strengthColor(data.avgStrength)};"></div></div>
            <span style="color: ${strengthColor(data.avgStrength)}; font-size: 0.8rem;">${pct(data.avgStrength)}%</span>
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="progress-bar" style="width: 60px;"><div class="progress-fill" style="width: ${pct(data.avgRisk)}%; background: ${riskDot};"></div></div>
            <span style="color: ${riskDot}; font-size: 0.8rem;">${pct(data.avgRisk)}%</span>
          </div>
        </td>
      </tr>`;
    }).join('');

  const forgettingDist = lifecycle.forgettingSpeedDistribution;

  return `<div class="grid grid-3">
    <div class="card">
      <h3>Memory State</h3>
      <div style="margin-bottom: 0.5rem;">
        <span class="badge badge-green">Active: ${lifecycle.activeMemories}</span>
        <span class="badge badge-amber" style="margin-left: 4px;">Superseded: ${lifecycle.supersededMemories}</span>
        ${lifecycle.conflictingMemories > 0 ? `<span class="badge badge-red" style="margin-left: 4px;${lifecycle.conflictingMemories > 0 ? ' animation: pulse 2s ease-in-out infinite;' : ''}">Conflicting: ${lifecycle.conflictingMemories}</span>` : ''}
      </div>
      <div style="margin-top: 1rem;">
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.75rem; font-weight: 500;">Strength Distribution</div>
        <div class="bar-chart" style="height: 90px; padding-bottom: 20px;">
          ${strengthBars}
        </div>
      </div>
    </div>
    <div class="card">
      <h3>Decay & Lifespan</h3>
      <table>
        <tr><td>Avg Age</td><td style="font-weight: 600;">${lifecycle.avgAgeDays.toFixed(1)} days</td></tr>
        <tr><td>Avg Version</td><td style="font-weight: 600;">${lifecycle.avgVersionCount}</td></tr>
        <tr><td>Longest Lived</td><td style="font-weight: 600;">${lifecycle.memoryLifespan.longestLivedDays} days</td></tr>
        <tr><td>Avg Until Superseded</td><td style="font-weight: 600;">${lifecycle.memoryLifespan.avgDaysUntilSuperseded ? `${lifecycle.memoryLifespan.avgDaysUntilSuperseded} days` : 'N/A'}</td></tr>
        <tr><td>Total Reviews</td><td style="font-weight: 600;">${lifecycle.reviewStats.totalReviews} (${lifecycle.reviewStats.avgReviewsPerMemory}/mem)</td></tr>
      </table>
      <div style="margin-top: 0.75rem;">
        <div style="font-size: 0.8rem; color: var(--text-dim); margin-bottom: 0.25rem; font-weight: 500;">Forgetting Speed Classification</div>
        <div style="display: flex; gap: 0.5rem;">
          <span class="badge badge-red">Fast (${forgettingDist.fast})</span>
          <span class="badge badge-amber">Medium (${forgettingDist.medium})</span>
          <span class="badge badge-green">Slow (${forgettingDist.slow})</span>
        </div>
        <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 4px;">Based on recall_half_life: ≤3d fast, ≤7d medium, >7d slow</div>
      </div>
    </div>
    <div class="card">
      <h3>Category Breakdown</h3>
      <table>
        <tr><th>Category</th><th>Count</th><th>Strength</th><th>Risk</th></tr>
        ${categoryRows}
      </table>
    </div>
  </div>`;
}

// ============================================================================
// TMS Network Renderer
// ============================================================================

function renderTMSNetwork(network: TMSKnowledgeNetwork): string {
  const personNodes = network.nodes.filter((n) => n.type === 'person');
  const categoryNodes = network.nodes.filter((n) => n.type === 'category');

  if (personNodes.length === 0) {
    return '<div class="card"><p style="color: var(--text-dim);">No TMS data available for network visualization.</p></div>';
  }

  const memberRows = personNodes.map((n) => {
    const expertiseTags = n.expertiseAreas.slice(0, 4).map((e) => `<span class="tag">${e}</span>`).join('');
    return `<tr>
      <td style="font-weight: 600;">${n.displayName}</td>
      <td>${n.memoryCount}</td>
      <td>${expertiseTags}</td>
      <td><span style="color: ${strengthColor(n.trustScore)}; font-weight: 600;">${pct(n.trustScore)}%</span></td>
    </tr>`;
  }).join('');

  const overlapHtml = network.overlapPairs.length > 0
    ? network.overlapPairs.slice(0, 10).map((o) => {
        const overlapPct = o.sharedPercentage;
        const barColor = overlapPct > 50 ? 'var(--green)' : overlapPct > 25 ? 'var(--amber)' : 'var(--red)';
        return `<tr>
          <td>${o.memberA}</td>
          <td>${o.memberB}</td>
          <td>${o.sharedCount} shared</td>
          <td>
            <div style="display: flex; align-items: center; gap: 6px;">
              <div class="progress-bar" style="width: 60px;"><div class="progress-fill" style="width: ${overlapPct}%; background: ${barColor};"></div></div>
              <span style="color: ${barColor}; font-size: 0.8rem;">${overlapPct}%</span>
            </div>
          </td>
        </tr>`;
      }).join('')
    : '<tr><td colspan="4" style="color: var(--text-dim);">No knowledge overlap detected — team has no shared memories.</td></tr>';

  // Knowledge silos: only show if member has genuinely isolated categories (not just low count)
  const silosHtml = network.knowledgeSilos.length > 0
    ? network.knowledgeSilos.map((s) => `<div style="padding: 0.5rem 0; border-bottom: 1px solid var(--border);">
        <strong>${s.displayName}</strong> — isolated from: ${s.uniqueCategories.map((c) => `<span class="tag" style="background: ${getCategoryColor(c)}22; color: ${getCategoryColor(c)};">${c}</span>`).join(' ')}
      </div>`).join('')
    : '<p style="color: var(--green);">No knowledge silos detected — team knowledge is well distributed.</p>';

  return `<div class="grid grid-2">
    <div class="card">
      <h3>Team Members</h3>
      <table>
        <tr><th>Member</th><th>Memories</th><th>Expertise Areas</th><th>Trust</th></tr>
        ${memberRows}
      </table>
    </div>
    <div class="card">
      <h3>Knowledge Overlap</h3>
      <table>
        <tr><th>Member A</th><th>Member B</th><th>Shared</th><th>Overlap</th></tr>
        ${overlapHtml}
      </table>
    </div>
    <div class="card">
      <h3>Knowledge Silos</h3>
      ${silosHtml}
    </div>
    <div class="card">
      <h3>Network Topology</h3>
      <table>
        <tr><td>Person Nodes</td><td style="font-weight: 600;">${personNodes.length}</td></tr>
        <tr><td>Category Nodes</td><td style="font-weight: 600;">${categoryNodes.length}</td></tr>
        <tr><td>Knowledge Edges (person→category)</td><td style="font-weight: 600;">${network.edges.filter((e) => e.type === 'knows').length}</td></tr>
        <tr><td>Overlap Edges (person↔person)</td><td style="font-weight: 600;">${network.edges.filter((e) => e.type === 'overlap').length}</td></tr>
        <tr><td>Knowledge Silos</td><td style="font-weight: 600; color: ${network.knowledgeSilos.length > 0 ? 'var(--amber)' : 'var(--green)'};">${network.knowledgeSilos.length}</td></tr>
      </table>
    </div>
  </div>`;
}

// ============================================================================
// Departure Overview Renderer
// ============================================================================

function renderDepartureOverview(overview: TeamDepartureOverview): string {
  if (overview.memberImpacts.length === 0) {
    return '<div class="card"><p style="color: var(--text-dim);">No departure simulation data available.</p></div>';
  }

  const rows = overview.memberImpacts.map((m) => {
    // Better thresholds using both single point count AND knowledge loss percentage
    const lossPct = m.knowledgeLossPercentage;
    let badgeClass: string;
    let badgeText: string;
    if (lossPct > 25 || m.singlePointCount > 3) { badgeClass = 'badge-red'; badgeText = 'Critical'; }
    else if (lossPct > 10 || m.singlePointCount > 1) { badgeClass = 'badge-amber'; badgeText = 'Warning'; }
    else { badgeClass = 'badge-green'; badgeText = 'Safe'; }

    return `<tr>
      <td style="font-weight: 600;">${m.displayName}</td>
      <td><strong style="color: ${m.singlePointCount > 2 ? 'var(--red)' : m.singlePointCount > 0 ? 'var(--amber)' : 'var(--green)'};">${m.singlePointCount}</strong></td>
      <td>
        <div style="display: flex; align-items: center; gap: 6px;">
          <div class="progress-bar" style="width: 60px;"><div class="progress-fill" style="width: ${Math.min(lossPct, 100)}%; background: ${riskColor(lossPct / 100)};"></div></div>
          <span style="font-weight: 600;">${lossPct}%</span>
        </div>
      </td>
      <td><span style="color: ${riskColor(m.riskIncrease)}; font-weight: 600;">+${pct(m.riskIncrease)}%</span></td>
      <td><span class="badge ${badgeClass}">${badgeText}</span></td>
    </tr>`;
  }).join('');

  return `<div class="grid grid-2">
    <div class="card">
      <h3>Departure Impact Comparison</h3>
      <table>
        <tr><th>Member</th><th>Single Points</th><th>Knowledge Loss</th><th>Risk Increase</th><th>Level</th></tr>
        ${rows}
      </table>
    </div>
    <div class="card">
      <h3>Team Resilience</h3>
      <div style="margin-bottom: 1rem;">
        <div class="stat-value" style="color: ${healthColor(overview.teamResilienceScore * 100)};">${pct(overview.teamResilienceScore)}%</div>
        <div class="stat-label">Overall Team Resilience Score</div>
      </div>
      <div class="progress-bar" style="height: 12px;">
        <div class="progress-fill" style="width: ${overview.teamResilienceScore * 100}%; background: ${healthColor(overview.teamResilienceScore * 100)};"></div>
      </div>
      <div style="margin-top: 1rem; font-size: 0.9rem; color: var(--text-dim);">
        Worst case: if <strong style="color: var(--red);">${overview.worstCaseMemberId}</strong> leaves, the team loses <strong style="color: var(--red);">${overview.worstCaseLoss}%</strong> of its knowledge base.
      </div>
      ${overview.worstCaseLoss > 20
        ? `<div style="margin-top: 0.75rem; padding: 0.5rem 0.75rem; background: rgba(239, 68, 68, 0.1); border-radius: 6px; border: 1px solid rgba(239, 68, 68, 0.3);">
            <span style="color: var(--red); font-weight: 600; font-size: 0.85rem;">⚠ Action needed:</span>
            <span style="color: var(--text-dim); font-size: 0.85rem;"> Prioritize knowledge sharing to reduce single-point dependencies.</span>
          </div>`
        : ''}
    </div>
  </div>`;
}
