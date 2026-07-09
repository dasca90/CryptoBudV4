import type { AiMission } from './AiCommandCenterTypes';

export function parseAiMission(command: string): AiMission {
  const text = normalize(command);
  const maxMatch = text.match(/(?:max(?:im)?|maximum|find|gaseste|cauta)\s+(\d+)/i) ?? text.match(/(\d+)\s+coin/i);
  const upsideMatch = text.match(/(?:peste|above|over|upside|tp1)\s+(\d+(?:\.\d+)?)\s*%/i);
  const missionType: AiMission['missionType'] = text.includes('unic')
    ? 'FIND_UNICORNS'
    : text.includes('upside') || text.includes('potential') || text.includes('tp1')
      ? 'FIND_COINS_WITH_UPSIDE'
      : text.includes('rank') || text.includes('top')
        ? 'RANK_CANDIDATES'
        : text.includes('guard') || text.includes('fomo') || text.includes('rug')
          ? 'APPLY_GUARDS'
          : 'ANALYZE_SYMBOL';

  return {
    missionType,
    maxResults: clampInt(Number(maxMatch?.[1] ?? 3), 1, 3),
    minCleanUpsidePct: clamp(Number(upsideMatch?.[1] ?? 3), 0, 100),
    requireRetrospectiveAnalysis: true,
    antiFomo: true,
    antiRugpull: true,
    antiManipulation: true,
    newListingGuard: true,
    allowBuyIntent: true,
  };
}

export function updateAiMission(mission: AiMission, patch: Partial<AiMission>): AiMission {
  return {
    ...mission,
    ...patch,
    maxResults: clampInt(Number(patch.maxResults ?? mission.maxResults), 1, 3),
    minCleanUpsidePct: clamp(Number(patch.minCleanUpsidePct ?? mission.minCleanUpsidePct), 0, 100),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function clampInt(value: number, min: number, max: number): 1 | 2 | 3 {
  return clamp(Math.round(value), min, max) as 1 | 2 | 3;
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
