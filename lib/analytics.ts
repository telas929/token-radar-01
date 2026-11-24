// Institutional Valuation Analytics, Risk Assessment & Airdrop Yield Intelligence.
// Extends the core Token Radar pipeline with quantitative metrics for pre-token protocols.

import type { BoardRow, Snapshot, SnapshotProtocol } from './model.ts';

export type RiskTier = 'LOW' | 'MEDIUM' | 'HIGH' | 'SPECULATIVE';

export interface ProtocolRiskProfile {
  risk_tier: RiskTier;
  risk_score: number; // 0 to 100 (lower is safer)
  velocity_volatility: number;
  chain_resilience: number;
  seasoning_stability: number;
}

export interface AirdropYieldEstimate {
  projected_fdv_usd: number;
  estimated_community_pool_usd: number;
  expected_farmer_roi_pct: number;
  gas_breakeven_days: number;
}

export interface EcosystemBreakdown {
  chain: string;
  protocol_count: number;
  total_tvl_usd: number;
  market_share_pct: number;
}

export interface SectorBreakdown {
  category: string;
  protocol_count: number;
  total_tvl_usd: number;
  average_implied_value_usd: number;
}

export interface RadarAnalyticsSummary {
  total_tracked_tvl_usd: number;
  total_implied_valuation_usd: number;
  median_implied_value_usd: number;
  top_chains_by_tvl: EcosystemBreakdown[];
  sectors_distribution: SectorBreakdown[];
}

/** Clamp utility for numerical stability */
function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

/** Evaluates the multi-factor risk score of a pre-token DeFi protocol */
export function evaluateRiskProfile(protocol: SnapshotProtocol, ageDays: number | null): ProtocolRiskProfile {
  // 1. 7-day velocity volatility penalty
  const velocity = protocol.change_7d ?? 0;
  const absVelocity = Math.abs(velocity);
  const velocityVolatility = clamp(Math.round(absVelocity * 0.5), 0, 35);

  // 2. Chain diversification resilience (more chains = higher resilience = lower risk)
  const chainCount = protocol.chains.length;
  const chainResilience = chainCount >= 5 ? 5 : chainCount >= 3 ? 12 : chainCount === 2 ? 18 : 25;

  // 3. Category systemic risk index
  const category = (protocol.category ?? '').toLowerCase();
  let categoryRisk = 15;
  if (category.includes('perpetual') || category.includes('derivative')) {
    categoryRisk = 25;
  } else if (category.includes('bridge') || category.includes('cross')) {
    categoryRisk = 22;
  } else if (category.includes('cdp') || category.includes('lend')) {
    categoryRisk = 18;
  } else if (category.includes('rollup') || category.includes('l2')) {
    categoryRisk = 10;
  } else if (category.includes('staking') || category.includes('restak')) {
    categoryRisk = 12;
  }

  // 4. Seasoning stability (older protocols with continuous operation have lower risk)
  const age = ageDays ?? 180;
  const seasoningStability = age >= 730 ? 5 : age >= 365 ? 10 : age >= 180 ? 15 : 25;

  const totalScore = clamp(velocityVolatility + chainResilience + categoryRisk + seasoningStability, 5, 95);

  let riskTier: RiskTier = 'MEDIUM';
  if (totalScore <= 35) {
    riskTier = 'LOW';
  } else if (totalScore <= 60) {
    riskTier = 'MEDIUM';
  } else if (totalScore <= 80) {
    riskTier = 'HIGH';
  } else {
    riskTier = 'SPECULATIVE';
  }

  return {
    risk_tier: riskTier,
    risk_score: totalScore,
    velocity_volatility: velocityVolatility,
    chain_resilience: chainResilience,
    seasoning_stability: seasoningStability,
  };
}

/** Forecasts realistic community airdrop yield and capital efficiency */
export function projectAirdropYield(
  protocol: SnapshotProtocol,
  impliedValueUsd: number,
  capitalRequirementUsd: number,
  estimatedHoldDays: number,
): AirdropYieldEstimate {
  // Industry standard community airdrop allocation range: 8% to 12% of launch FDV
  const communityPoolPct = 0.10;
  const projectedFdv = impliedValueUsd;
  const estimatedCommunityPool = Math.round(projectedFdv * communityPoolPct);

  // Expected farmer yield allocation per unit of active TVL
  const protocolTvl = Math.max(protocol.tvl_usd, 1_000_000);
  const capitalShareRatio = capitalRequirementUsd / protocolTvl;
  const estimatedFarmerReward = Math.max(25, Math.round(estimatedCommunityPool * capitalShareRatio * 2.5));

  const expectedRoiPct = Math.round((estimatedFarmerReward / capitalRequirementUsd) * 100);

  // Gas payback duration estimate
  const estimatedGasCostUsd = protocol.chains.some((c) => c.toLowerCase() === 'ethereum') ? 35 : 3;
  const dailyYield = estimatedFarmerReward / Math.max(estimatedHoldDays, 30);
  const gasBreakevenDays = Math.max(1, Math.ceil(estimatedGasCostUsd / Math.max(dailyYield, 0.1)));

  return {
    projected_fdv_usd: projectedFdv,
    estimated_community_pool_usd: estimatedCommunityPool,
    expected_farmer_roi_pct: expectedRoiPct,
    gas_breakeven_days: gasBreakevenDays,
  };
}

/** Aggregates ecosystem TVL and sector distribution across the universe */
export function computeEcosystemAnalytics(snapshot: Snapshot, board: BoardRow[]): RadarAnalyticsSummary {
  const chainTvlMap = new Map<string, { count: number; tvl: number }>();
  const sectorTvlMap = new Map<string, { count: number; tvl: number; impliedSum: number }>();

  let totalUniverseTvl = 0;
  for (const p of snapshot.protocols) {
    totalUniverseTvl += p.tvl_usd;
    for (const chain of p.chains) {
      const existing = chainTvlMap.get(chain) ?? { count: 0, tvl: 0 };
      existing.count += 1;
      existing.tvl += p.tvl_usd;
      chainTvlMap.set(chain, existing);
    }
  }

  let totalImplied = 0;
  const impliedValues: number[] = [];

  for (const row of board) {
    totalImplied += row.implied_value_usd;
    impliedValues.push(row.implied_value_usd);
    const category = row.category ?? 'Uncategorized';
    const existing = sectorTvlMap.get(category) ?? { count: 0, tvl: 0, impliedSum: 0 };
    existing.count += 1;
    existing.tvl += row.tvl_usd;
    existing.impliedSum += row.implied_value_usd;
    sectorTvlMap.set(category, existing);
  }

  impliedValues.sort((a, b) => a - b);
  const medianImplied = impliedValues.length > 0 ? impliedValues[Math.floor(impliedValues.length / 2)]! : 0;

  const topChains: EcosystemBreakdown[] = [...chainTvlMap.entries()]
    .map(([chain, data]) => ({
      chain,
      protocol_count: data.count,
      total_tvl_usd: data.tvl,
      market_share_pct: Math.round((data.tvl / Math.max(totalUniverseTvl, 1)) * 10000) / 100,
    }))
    .sort((a, b) => b.total_tvl_usd - a.total_tvl_usd)
    .slice(0, 10);

  const sectorDistribution: SectorBreakdown[] = [...sectorTvlMap.entries()]
    .map(([category, data]) => ({
      category,
      protocol_count: data.count,
      total_tvl_usd: data.tvl,
      average_implied_value_usd: Math.round(data.impliedSum / Math.max(data.count, 1)),
    }))
    .sort((a, b) => b.total_tvl_usd - a.total_tvl_usd);

  return {
    total_tracked_tvl_usd: totalUniverseTvl,
    total_implied_valuation_usd: totalImplied,
    median_implied_value_usd: medianImplied,
    top_chains_by_tvl: topChains,
    sectors_distribution: sectorDistribution,
  };
}

/** Formats financial figures with standard suffixes */
export function formatCurrencyMetric(val: number): string {
  if (val >= 1_000_000_000) return `$${(val / 1e9).toFixed(2)}B`;
  if (val >= 1_000_000) return `$${(val / 1e6).toFixed(1)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1e3)}K`;
  return `$${val.toLocaleString()}`;
}

/** Generates structured institutional executive summary table */
export function generateExecutiveMarkdownSummary(board: BoardRow[], analytics: RadarAnalyticsSummary): string {
  const topRows = board.slice(0, 5);
  const lines: string[] = [
    `# Institutional Token Radar Intelligence Report`,
    ``,
    `## Macro Snapshot Overview`,
    `- **Total Tracked DeFi TVL:** ${formatCurrencyMetric(analytics.total_tracked_tvl_usd)}`,
    `- **Aggregated Implied Token Valuation:** ${formatCurrencyMetric(analytics.total_implied_valuation_usd)}`,
    `- **Median Implied Protocol Valuation:** ${formatCurrencyMetric(analytics.median_implied_value_usd)}`,
    `- **Top Dominant Ecosystem:** ${analytics.top_chains_by_tvl[0]?.chain ?? 'Unknown'} (${analytics.top_chains_by_tvl[0]?.market_share_pct ?? 0}% market share)`,
    ``,
    `## Top 5 High-Signal Launch Candidates`,
    `| Rank | Protocol | Category | TVL | Implied Value | Growth 7d | Chains |`,
    `| :--- | :--- | :--- | :--- | :--- | :--- | :--- |`,
  ];

  for (const row of topRows) {
    const growthStr = row.change_7d !== null ? `${row.change_7d > 0 ? '+' : ''}${row.change_7d.toFixed(1)}%` : 'n/a';
    const chainStr = row.chains.slice(0, 3).join(', ');
    lines.push(
      `| #${row.rank} | **${row.name}** | ${row.category ?? 'DeFi'} | ${formatCurrencyMetric(row.tvl_usd)} | ${formatCurrencyMetric(row.implied_value_usd)} | ${growthStr} | ${chainStr} |`,
    );
  }

  lines.push(``);
  lines.push(`Generated deterministically by Token Radar Pro autonomous engine under telas929.`);
  return lines.join('\n');
}

/** Exports clean CSV formatted data for external institutional modeling */
export function exportBoardCsv(board: BoardRow[]): string {
  const headers = ['rank', 'slug', 'name', 'category', 'tvl_usd', 'change_7d', 'implied_value_usd', 'chains'];
  const rows = board.map((r) => [
    r.rank,
    r.slug,
    `"${r.name.replace(/"/g, '""')}"`,
    `"${(r.category ?? 'Other').replace(/"/g, '""')}"`,
    r.tvl_usd,
    r.change_7d ?? 0,
    r.implied_value_usd,
    `"${r.chains.join(';')}"`,
  ].join(','));
  return [headers.join(','), ...rows].join('\n');
}
