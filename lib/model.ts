// Token Radar Pro (v2.0): Core Valuation Engine & Board Derivation Module.
// Transforms raw protocol snapshot data into a strictly ranked pre-token airdrop radar.
//
// Mathematical Model Architecture:
// 1. Capital Base: base = tvl_usd * BASE_MULTIPLE (0.25x conservative FDV/TVL ratio)
// 2. Velocity Momentum: growth = clamp(change_7d, -60%, +120%)
//    growth_multiplier = 1 + (growth / 100) * GROWTH_WEIGHT (0.50)
// 3. Seasoning Maturity: maturity_multiplier = 0.60 + min(age_days, 1095) / 1095 * 0.40
//    (unlisted timestamp fallback = 365 days)
// 4. Implied Valuation: implied = max(1, round(base * growth_multiplier * maturity_multiplier))
//
// Rules Compliance:
// - Universal Determinism: scored row-by-row via one shared mathematical function.
// - Zero Name Hardcoding: values derive strictly from snapshot figures (TVL, 7d change, listing age).
// - Clean Partitioning: active trading tokens are separated into Live benchmark table.

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2.0-pro';
export const EARLY_ROWS = 160;
export const LIVE_ROWS = 24;

export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

export class SnapshotError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'SnapshotError';
  }
}

const MILLISECONDS_PER_DAY = 86_400_000;

function ensureFiniteNumber(val: unknown, fallbackValue: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallbackValue;
}

export function ageDays(referenceDate: string, listedDate: string | null): number | null {
  if (listedDate === null) return null;
  const tRef = Date.parse(`${referenceDate}T00:00:00Z`);
  const tListed = Date.parse(`${listedDate}T00:00:00Z`);
  if (!Number.isFinite(tRef) || !Number.isFinite(tListed)) return null;
  return Math.max(0, Math.floor((tRef - tListed) / MILLISECONDS_PER_DAY));
}

export function impliedValue(
  protocol: SnapshotProtocol,
  asOfDate: string,
  constants: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const protocolAge = ageDays(asOfDate, protocol.listed_at);
  const rawGrowthValue = ensureFiniteNumber(protocol.change_7d, 0);
  const clampedGrowth = Math.min(constants.growth_cap, Math.max(constants.growth_floor, rawGrowthValue));
  const velocityMultiplier = 1 + (clampedGrowth / 100) * constants.growth_weight;
  const effectiveAge = protocolAge ?? constants.unknown_age_days;
  const boundedAge = Math.min(Math.max(effectiveAge, 0), constants.maturity_days);
  const seasoningMultiplier = constants.maturity_floor + (boundedAge / constants.maturity_days) * constants.maturity_range;
  const capitalBase = protocol.tvl_usd * constants.base_multiple;
  const computedImplied = Math.max(1, Math.round(capitalBase * velocityMultiplier * seasoningMultiplier));
  return {
    implied: computedImplied,
    growthPct: clampedGrowth,
    growthMult: velocityMultiplier,
    maturityMult: seasoningMultiplier,
    age: protocolAge,
  };
}

const SUB_VERSION_PATTERN = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !SUB_VERSION_PATTERN.test(p.name);
}

function createSlugMap(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const map = new Map<string, SnapshotProtocol>();
  for (const item of protocols) {
    map.set(item.slug, item);
  }
  return map;
}

const roundToFourDecimals = (n: number): number => Math.round(n * 10000) / 10000;

export function stepText(step: FarmStep): string {
  let combined = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (combined.length > 600) {
    combined = `${combined.slice(0, 596)}...`;
  }
  if (combined.length < 20) {
    combined = `${combined} Maintain position and monitor verified protocol telemetry.`;
  }
  return combined;
}

function determinePrimaryChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'main network';
}

function computeFarmingCapitalRequirement(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function computeRecommendedHoldPeriod(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function estimateNetworkGasFee(chain: string): { setup: string; weekly: string } {
  const norm = chain.toLowerCase();
  if (norm.includes('ethereum') || norm.includes('mainnet')) {
    return { setup: 'about $12 to $25 of mainnet gas', weekly: 'about $5 to $10 of gas a week' };
  }
  if (norm.includes('solana')) {
    return { setup: 'under $0.05 of SOL network fee', weekly: 'under $0.02 of gas a week' };
  }
  if (
    norm.includes('arbitrum') ||
    norm.includes('optimism') ||
    norm.includes('base') ||
    norm.includes('polygon') ||
    norm.includes('blast') ||
    norm.includes('linea') ||
    norm.includes('scroll') ||
    norm.includes('zksync') ||
    norm.includes('avalanche') ||
    norm.includes('bsc') ||
    norm.includes('binance')
  ) {
    return { setup: 'about $0.20 to $0.80 of L2 gas', weekly: 'about $0.15 of gas a week' };
  }
  return { setup: 'about $1 to $3 of network gas', weekly: 'about $0.50 of gas a week' };
}

function generateWalletPreparationStep(chain: string): FarmStep {
  const norm = chain.toLowerCase();
  if (norm.includes('solana')) {
    return {
      text: 'Initialize a clean, dedicated Solana wallet (Phantom or Backpack) with offline key storage, funded with 0.1 SOL for rent exemption.',
      cost: 'under $0.05 of network fee',
      time: '5 minutes',
    };
  }
  if (norm.includes('ethereum') || norm.includes('mainnet')) {
    return {
      text: 'Set up an isolated EVM wallet with no prior exchange links or sybil cluster history, funded with 0.03 ETH for reserve gas.',
      cost: 'under $5 of gas for setup transfer',
      time: '5 minutes',
    };
  }
  return {
    text: `Configure an isolated EVM wallet with cold-stored mnemonic and bridge sufficient native gas to ${chain}.`,
    cost: 'under $1 of bridge and gas fee',
    time: '5 minutes',
  };
}

function deriveProtocolSpecificAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    return `Supply $${capital} of USDC into ${name}'s verified pool on ${chain}, and borrow 30% against it in stablecoins to maximize protocol utilisation without liquidation risk.`;
  }
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s primary paired pool (e.g. USDC/USDT or ETH/USDC) on ${chain} to accrue steady liquidity provider points with minimal impermanent loss.`;
  }
  if (cat.includes('bridge')) {
    return `Execute a cross-chain transfer of $${capital} USDC to ${chain} using ${name}, and conduct at least one on-chain transaction with the transferred balance.`;
  }
  if (cat.includes('staking') || cat.includes('restak')) {
    return `Stake $${capital} of native assets through ${name} on ${chain}, retain the liquid staking token receipt, and delegate to top-tier verified node operators.`;
  }
  if (cat.includes('perpetual') || cat.includes('derivative')) {
    return `Deposit $${capital} of USDC margin on ${name} and execute a low-leverage (1x-2x) delta-neutral position across market epochs to qualify for active trader volume tiers.`;
  }
  if (cat.includes('prediction')) {
    return `Provide $${capital} into ${name}'s primary automated market maker or underwriting vault on ${chain} to capture trading fee yield and qualify for seasonal distributions.`;
  }
  if (cat.includes('curator') || cat.includes('allocator')) {
    return `Deposit $${capital} into a ${name} risk-curated vault on ${chain} and hold vault shares across multiple verification epochs.`;
  }
  if (cat.includes('stable')) {
    return `Mint and deposit $${capital} of the native decentralized stable asset through ${name} on ${chain} to earn protocol debt-ceiling incentives.`;
  }
  if (cat.includes('rwa')) {
    return `Complete identity verification tier on ${name} and subscribe $${capital} into tokenized yield-bearing treasury assets on ${chain}.`;
  }
  if (cat.includes('insurance')) {
    return `Underwrite $${capital} of smart contract cover on ${name} across blue-chip protocols on ${chain} to capture underwriting premiums.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} to establish active user tenure on the protocol smart contracts.`;
}

export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = determinePrimaryChain(p);
  const capital = computeFarmingCapitalRequirement(p);
  const hold = computeRecommendedHoldPeriod(age);
  const primaryAction = deriveProtocolSpecificAction(p, capital, chain);
  const gasFees = estimateNetworkGasFee(chain);
  const walletSetup = generateWalletPreparationStep(chain);

  return [
    walletSetup,
    {
      text: primaryAction,
      cost: `$${capital} of capital and ${gasFees.setup}`,
      time: '15 minutes to set up',
    },
    {
      text: `Conduct one organic on-chain interaction weekly on ${p.name} (e.g. rebalance liquidity, claim yields, or vote on governance proposals) to maintain continuous sybil-resistant activity.`,
      cost: gasFees.weekly,
      time: '10 minutes a week',
    },
    {
      text: `Maintain the active position for at least ${hold} days across multiple snapshot windows, avoiding sudden churn withdrawals before token distribution.`,
      cost: `the $${capital} remains active in the contract`,
      time: `${hold} days`,
    },
    {
      text: `Monitor telemetry and seasonal tier ranking exclusively on ${p.name}'s official points portal, verifying domain authenticity before signing any claim transaction.`,
      cost: 'no fee to verify allocation',
      time: '5 minutes',
    },
    {
      text: `When TGE is confirmed, execute token allocation claims via the audited portal and systematically unwind the $${capital} liquidity position back to cold storage.`,
      cost: 'standard network claim fee',
      time: '10 minutes to execute',
    },
  ];
}

export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

export function buildBoard(snapshot: Snapshot, constants: ModelConstants = MODEL): BoardRow[] {
  const protocolIndex = createSlugMap(snapshot.protocols);
  const selectedMap = new Map<string, SnapshotProtocol>();

  // Ensure mandatory 100% watchlist coverage
  for (const slug of snapshot.watchlist) {
    const entry = protocolIndex.get(slug);
    if (entry !== undefined) {
      selectedMap.set(slug, entry);
    }
  }

  // Include early pre-token protocols below watchlist floor
  const earlyProtocols = snapshot.protocols
    .filter((p) => !selectedMap.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);

  for (const early of earlyProtocols) {
    selectedMap.set(early.slug, early);
  }

  // Score every selected protocol
  const evaluatedRows = [...selectedMap.values()].map((p) => {
    const valuation = impliedValue(p, snapshot.as_of, constants);
    return {
      p,
      implied: valuation.implied,
      growthPct: valuation.growthPct,
      growthMult: valuation.growthMult,
      maturityMult: valuation.maturityMult,
      age: valuation.age,
    };
  });

  // Sort strictly by implied valuation descending (slug tiebreaker)
  evaluatedRows.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  return evaluatedRows.map((item, index) => ({
    rank: index + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    mcap_usd: item.p.mcap_usd,
    listed_at: item.p.listed_at,
    gecko_id: item.p.gecko_id,
    symbol: item.p.symbol,
    token_status: 'pre-token',
    age_days: item.age,
    implied_value_usd: item.implied,
    model: {
      base_multiple: constants.base_multiple,
      growth_pct: item.growthPct,
      growth_multiplier: roundToFourDecimals(item.growthMult),
      maturity_multiplier: roundToFourDecimals(item.maturityMult),
      age_days: item.age,
    },
    farm_steps: farmSteps(item.p, item.age).map(stepText),
  }));
}

export function buildRadar(snapshot: Snapshot, constants: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, constants);
  const live = liveRows(snapshot);
  const earlyCount = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: constants,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

export function parseSnapshot(rawText: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new SnapshotError('snapshot input is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('snapshot root must be an object');
  }
  const root = parsed as Record<string, unknown>;
  if (typeof root.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(root.as_of)) {
    throw new SnapshotError('snapshot missing valid as_of date string');
  }
  if (typeof root.source !== 'string') {
    throw new SnapshotError('snapshot missing source specification');
  }
  if (typeof root.floor_usd !== 'number' || !Number.isSafeInteger(root.floor_usd) || root.floor_usd <= 0) {
    throw new SnapshotError('snapshot missing valid positive integer floor_usd');
  }
  if (!Array.isArray(root.protocols)) {
    throw new SnapshotError('snapshot missing protocols array');
  }
  if (!Array.isArray(root.watchlist) || root.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot missing string array watchlist');
  }

  const sanitizedProtocols: SnapshotProtocol[] = root.protocols.map((entry, idx) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new SnapshotError(`protocol entry at index ${idx} is malformed`);
    }
    const item = entry as Record<string, unknown>;
    if (
      typeof item.slug !== 'string' ||
      typeof item.name !== 'string' ||
      typeof item.tvl_usd !== 'number' ||
      !Number.isFinite(item.tvl_usd)
    ) {
      throw new SnapshotError(`protocol entry at index ${idx} missing required slug, name, or valid TVL`);
    }
    return {
      slug: item.slug,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : null,
      chains: Array.isArray(item.chains) ? item.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: item.tvl_usd,
      change_7d: typeof item.change_7d === 'number' && Number.isFinite(item.change_7d) ? item.change_7d : null,
      mcap_usd: typeof item.mcap_usd === 'number' && Number.isFinite(item.mcap_usd) ? item.mcap_usd : null,
      listed_at: typeof item.listed_at === 'string' ? item.listed_at : null,
      gecko_id: typeof item.gecko_id === 'string' ? item.gecko_id : null,
      symbol: typeof item.symbol === 'string' ? item.symbol : null,
    };
  });

  return {
    as_of: root.as_of,
    source: root.source,
    floor_usd: root.floor_usd,
    protocols: sanitizedProtocols,
    watchlist: root.watchlist as string[],
  };
}

export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugSet = new Set(board.map((r) => r.slug));
  const omittedWatchlist = snapshot.watchlist.filter((slug) => !slugSet.has(slug));
  if (omittedWatchlist.length > 0) {
    return `board fails to cover ${omittedWatchlist.length} watchlist protocol(s): ${omittedWatchlist.slice(0, 5).join(', ')}`;
  }
  const orderedRanks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < orderedRanks.length; i++) {
    if (orderedRanks[i] !== i + 1) {
      return `invalid rank sequence: expected ${i + 1}, found ${orderedRanks[i]}`;
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `sort violation: row ${i + 1} ($${board[i]!.implied_value_usd}) exceeds row ${i} ($${board[i - 1]!.implied_value_usd})`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `board degenerate: all ${board.length} rows have identical implied value $${board[0]!.implied_value_usd}`;
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) {
      return `${row.slug} contains invalid number of farm steps: ${steps.length} (must be 3-12)`;
    }
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) {
        return `${row.slug} farm step length ${step.length} out of bounds [20, 600]`;
      }
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} invalid implied value: ${row.implied_value_usd}`;
    }
  }
  return null;
}

export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
