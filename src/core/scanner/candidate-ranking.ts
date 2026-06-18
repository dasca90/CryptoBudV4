import type { ScannerCandidate } from '../types';

export interface RankedCandidate extends ScannerCandidate {
  rank: number;
  rankScore: number;
}

export function rankCandidates(candidates: ScannerCandidate[]): RankedCandidate[] {
  const scored = candidates.map(c => ({
    ...c,
    rankScore: computeRankScore(c),
    scoreBreakdown: buildScoreBreakdown(c),
    rank: 0,
  }));

  // In Smart mode, professionalScore is the primary sort (higher is better)
  // Fallback to rankScore for non-Smart modes or when pro analysis is absent
  scored.sort((a, b) => {
    const proA = (a as any).professionalAnalysis?.professionalScore;
    const proB = (b as any).professionalAnalysis?.professionalScore;
    if (proA != null && proB != null) { return proB - proA; }
    if (proA != null) return -1;
    if (proB != null) return 1;
    return b.rankScore - a.rankScore;
  });

  return scored.map((c, i) => ({ ...c, rank: i + 1 }));
}

function buildScoreBreakdown(c: ScannerCandidate): Record<string, number> {
  return {
    entryGate: c.entryGateDecision?.decision === 'ALLOW' ? (c.status === 'BUY' ? 1000 : 500) : 0,
    confidence: c.confidence * 200,
    mlSafety: !c.mlBadEntryRisk ? 50 : 0,
    spread: Math.max(0, 100 - c.spreadPct * 500),
    volume: c.volumeRel > 0.5 ? 30 : 0,
    tpRoom: c.tpRoomOk ? 40 : 0,
    rebound: c.reboundConfirmed ? 25 : 0,
    momentum: c.momentumConfirmed ? 25 : 0,
    riskGroup: c.riskGroup === 'top_caps' ? 20 : c.riskGroup === 'large_caps' ? 16 : c.riskGroup === 'mid_caps' ? 10 : c.riskGroup === 'very_high_risk' ? -30 : 0,
    blockPenalty: -(c.blockReasons.length * 10),
  };
}

function computeRankScore(c: ScannerCandidate): number {
  let score = 0;

  // EntryGate ALLOW first
  if (c.entryGateDecision?.decision === 'ALLOW') {
    if (c.status === 'BUY') score += 1000;
    else score += 500;
  }

  // Higher confidence
  score += c.confidence * 200;

  // Lower ML bad entry risk
  if (!c.mlBadEntryRisk) score += 50;

  // Lower spread
  score += Math.max(0, 100 - c.spreadPct * 500);

  // Volume pass
  if (c.volumeRel > 0.5) score += 30;

  // TP room
  if (c.tpRoomOk) score += 40;

  // Rebound and momentum
  if (c.reboundConfirmed) score += 25;
  if (c.momentumConfirmed) score += 25;

  // Risk group safety
  if (c.riskGroup === 'top_caps') score += 20;
  else if (c.riskGroup === 'large_caps') score += 16;
  else if (c.riskGroup === 'mid_caps') score += 10;
  else if (c.riskGroup === 'very_high_risk') score -= 30;

  // Penalize block reasons
  score -= c.blockReasons.length * 10;

  return Math.max(0, score);
}

export function buildSummaryMessage(candidates: ScannerCandidate[]): string {
  const buys = candidates.filter(c => c.entryGateDecision?.decision === 'ALLOW' && c.status === 'BUY');
  const waits = candidates.filter(c => c.status === 'WAIT' || (c.status === 'BLOCK' && c.entryGateDecision?.decision !== 'ALLOW'));
  const blocks = candidates.filter(c => c.status === 'BLOCK');
  const avoids = candidates.filter(c => c.status === 'AVOID');

  if (buys.length === 0 && waits.length > 0) {
    const topReasons = getTopBlockReasons(candidates, 3);
    return `No BUY — candidates stopped before Entry Gate. Top reasons: ${topReasons.map(r => r.reason).join(', ')}`;
  }

  if (buys.length === 0 && candidates.length === 0) {
    return 'No candidates yet. Start AUTO scanner.';
  }

  if (candidates.length === 0) {
    return 'No candidates yet. Start AUTO scanner.';
  }

  const parts: string[] = [];
  if (buys.length > 0) parts.push(`${buys.length} BUY`);
  if (waits.length > 0) parts.push(`${waits.length} WAIT`);
  if (blocks.length > 0) parts.push(`${blocks.length} BLOCK`);
  if (avoids.length > 0) parts.push(`${avoids.length} AVOID`);

  return parts.join(' · ');
}

export function getTopBlockReasons(candidates: ScannerCandidate[], limit = 5): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const c of candidates) {
    for (const r of c.blockReasons) {
      counts.set(r, (counts.get(r) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
