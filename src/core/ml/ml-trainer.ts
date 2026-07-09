import type {
  ImportedMLRow, MLTrainingResult, MLBrainModel, MLModelRule,
  MLPredictionV2, EntryGateVerdict,
} from '../types';
import { logger } from '../../utils/logger';

function generateModelVersion(): string {
  return `v1_rule_${Date.now()}`;
}

const ALL_FEATURE_NAMES = [
  'spreadPct', 'volumeRel', 'dipPercent', 'reboundPercent',
  'm5Change', 'm15Change', 'h1Change', 'change24h',
  'confidence',
];

function computeWinRate(rows: ImportedMLRow[]): number {
  if (rows.length === 0) return 0;
  const wins = rows.filter(r => (r.pnlPercent ?? 0) > 0).length;
  return wins / rows.length;
}

function computeAvgPnl(rows: ImportedMLRow[]): number {
  if (rows.length === 0) return 0;
  return rows.reduce((s, r) => s + (r.pnlPercent ?? 0), 0) / rows.length;
}

function extractFeatureNames(rows: ImportedMLRow[]): string[] {
  const names = new Set<string>();
  for (const r of rows) {
    for (const key of Object.keys(r.predictionFeatures)) {
      names.add(key);
    }
  }
  return [...names].sort();
}

export function splitTrainingRows(rows: ImportedMLRow[]): {
  trainingRows: ImportedMLRow[];
  validationRows: ImportedMLRow[];
  skippedRows: ImportedMLRow[];
} {
  const good = rows.filter(r => r.trainingEligible && r.dataQuality === 'GOOD');
  const skipped = rows.filter(r => !r.trainingEligible || r.dataQuality !== 'GOOD');

  if (good.length === 0) {
    return { trainingRows: [], validationRows: [], skippedRows: skipped };
  }

  const splitIdx = Math.max(1, Math.floor(good.length * 0.8));
  const trainingRows = good.slice(0, splitIdx);
  const validationRows = good.slice(splitIdx);

  return { trainingRows, validationRows, skippedRows: skipped };
}

function trainRules(trainingRows: ImportedMLRow[], featureNames: string[]): MLModelRule[] {
  const rules: MLModelRule[] = [];

  for (const feature of featureNames) {
    if (feature === 'strategy' || feature === 'marketRegime' || feature === 'btcRegime') continue;

    const withFeature = trainingRows.filter(r => r.predictionFeatures[feature] !== undefined);
    if (withFeature.length < 3) continue;

    const wins = withFeature.filter(r => (r.pnlPercent ?? 0) > 0);
    const losses = withFeature.filter(r => (r.pnlPercent ?? 0) <= 0);
    if (wins.length === 0 || losses.length === 0) continue;

    const winAvg = wins.reduce((s, r) => s + Number(r.predictionFeatures[feature] ?? 0), 0) / wins.length;
    const lossAvg = losses.reduce((s, r) => s + Number(r.predictionFeatures[feature] ?? 0), 0) / losses.length;

    if (Math.abs(winAvg - lossAvg) < 0.001) continue;

    const weight = (wins.length / withFeature.length) * Math.abs(winAvg - lossAvg);
    const operator = winAvg > lossAvg ? 'gt' : 'lt';
    const threshold = (winAvg + lossAvg) / 2;

    rules.push({
      feature,
      operator,
      value: Math.round(threshold * 10000) / 10000,
      weight: Math.round(Math.min(1, weight) * 10000) / 10000,
    });
  }

  rules.sort((a, b) => b.weight - a.weight);
  return rules.slice(0, 10);
}

export function trainMLModel(rows: ImportedMLRow[]): MLTrainingResult {
  logger.info('ML_TRAIN_STARTED');
  const trainedAt = new Date().toISOString();
  const modelVersion = generateModelVersion();
  const warnings: string[] = [];

  const { trainingRows, validationRows, skippedRows } = splitTrainingRows(rows);

  if (trainingRows.length === 0) {
    const msg = 'No GOOD training rows available';
    warnings.push(msg);
    logger.warn(`ML_TRAIN_FAILED: ${msg}`);

    return {
      trainedAt,
      modelVersion,
      totalRows: rows.length,
      trainingRows: 0,
      validationRows: 0,
      skippedRows: skippedRows.length,
      accuracy: null,
      winRateTraining: 0,
      avgPnlTraining: 0,
      featureNames: [],
      warnings,
      model: {
        modelVersion,
        trainedAt,
        featureNames: [],
        trainingRowCount: 0,
        winRateTraining: 0,
        avgPnlTraining: 0,
        goodRowCount: rows.filter(r => r.dataQuality === 'GOOD').length,
        mediumRowCount: rows.filter(r => r.dataQuality === 'MEDIUM').length,
        badRowCount: rows.filter(r => r.dataQuality === 'BAD').length,
        rules: [],
        importId: null,
        lastImportSummary: null,
        enabled: false,
      },
    };
  }

  const featureNames = extractFeatureNames(trainingRows);
  const rules = trainRules(trainingRows, featureNames);
  const winRateTraining = computeWinRate(trainingRows);
  const avgPnlTraining = computeAvgPnl(trainingRows);

  let accuracy: number | null = null;
  if (validationRows.length > 0 && rules.length > 0) {
    let correct = 0;
    for (const v of validationRows) {
      const actualWin = (v.pnlPercent ?? 0) > 0;
      let predictedWin = false;
      let score = 0;
      for (const rule of rules) {
        const val = Number(v.predictionFeatures[rule.feature] ?? 0);
        if ((rule.operator === 'gt' && val > Number(rule.value)) ||
            (rule.operator === 'lt' && val < Number(rule.value))) {
          score += rule.weight;
        }
      }
      predictedWin = score > 0;
      if (predictedWin === actualWin) correct++;
    }
    accuracy = Math.round((correct / validationRows.length) * 10000) / 100;
  }

  logger.info(`ML_TRAIN_COMPLETED: ${trainingRows.length} training rows, ${rules.length} rules, accuracy ${accuracy ?? 'N/A'}`);

  return {
    trainedAt,
    modelVersion,
    totalRows: rows.length,
    trainingRows: trainingRows.length,
    validationRows: validationRows.length,
    skippedRows: skippedRows.length,
    accuracy,
    winRateTraining: Math.round(winRateTraining * 10000) / 100,
    avgPnlTraining: Math.round(avgPnlTraining * 100) / 100,
    featureNames,
    warnings,
    model: {
      modelVersion,
      trainedAt,
      featureNames,
      trainingRowCount: trainingRows.length,
      winRateTraining: Math.round(winRateTraining * 10000) / 100,
      avgPnlTraining: Math.round(avgPnlTraining * 100) / 100,
      goodRowCount: rows.filter(r => r.dataQuality === 'GOOD').length,
      mediumRowCount: rows.filter(r => r.dataQuality === 'MEDIUM').length,
      badRowCount: rows.filter(r => r.dataQuality === 'BAD').length,
      rules,
      importId: null,
      lastImportSummary: `${trainingRows.length} training rows, ${rules.length} rules`,
      enabled: rules.length > 0,
    },
  };
}

export function evaluateModelBasic(model: MLBrainModel, row: ImportedMLRow): MLPredictionV2 {
  const setupId = `eval_${Date.now()}`;
  const reasons: string[] = [];

  if (!model.enabled || model.rules.length === 0) {
    return {
      symbol: row.symbol,
      setupId,
      modelVersion: model.modelVersion,
      isTrained: false,
      winProbability: null,
      badEntryRisk: 0,
      expectedMovePct: null,
      expectedHoldMinutes: null,
      confidenceAdjustment: 0,
      suggestedAction: 'ALLOW',
      reasons: ['ML brain not trained yet'],
      rowsUsed: model.trainingRowCount,
    };
  }

  let score = 0;
  let maxScore = 0;
  let applicableRules = 0;

  for (const rule of model.rules) {
    const val = Number(row.predictionFeatures[rule.feature] ?? 0);
    maxScore += rule.weight;
    if ((rule.operator === 'gt' && val > Number(rule.value)) ||
        (rule.operator === 'lt' && val < Number(rule.value)) ||
        (rule.operator === 'eq' && val === Number(rule.value))) {
      score += rule.weight;
      applicableRules++;
    }
  }

  if (applicableRules === 0) {
    return {
      symbol: row.symbol,
      setupId,
      modelVersion: model.modelVersion,
      isTrained: true,
      winProbability: model.winRateTraining / 100,
      badEntryRisk: 0.3,
      expectedMovePct: model.avgPnlTraining,
      expectedHoldMinutes: null,
      confidenceAdjustment: -0.05,
      suggestedAction: 'ALLOW',
      reasons: ['No applicable rules, using fallback'],
      rowsUsed: model.trainingRowCount,
    };
  }

  const normalizedScore = maxScore > 0 ? score / maxScore : 0;
  const winProbability = normalizedScore * model.winRateTraining / 100;
  const badEntryRisk = 1 - winProbability;
  let suggestedAction: EntryGateVerdict = 'ALLOW';
  let confidenceAdjustment = 0;

  if (badEntryRisk >= 0.80) {
    suggestedAction = 'BLOCK';
    confidenceAdjustment = -0.3;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% >= 80% -> BLOCK`);
  } else if (badEntryRisk >= 0.65) {
    suggestedAction = 'WAIT';
    confidenceAdjustment = -0.15;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% >= 65% -> WAIT`);
  } else if (badEntryRisk >= 0.50) {
    suggestedAction = 'ALLOW';
    confidenceAdjustment = -0.05;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% -> slight confidence reduction`);
  } else {
    confidenceAdjustment = 0;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% < 50% -> ALLOW`);
  }

  reasons.push(`${applicableRules} applicable rules, score ${(normalizedScore * 100).toFixed(0)}%`);

  return {
    symbol: row.symbol,
    setupId,
    modelVersion: model.modelVersion,
    isTrained: true,
    winProbability: Math.round(winProbability * 10000) / 10000,
    badEntryRisk: Math.round(badEntryRisk * 10000) / 10000,
    expectedMovePct: model.avgPnlTraining,
    expectedHoldMinutes: null,
    confidenceAdjustment: Math.round(confidenceAdjustment * 10000) / 10000,
    suggestedAction,
    reasons,
    rowsUsed: model.trainingRowCount,
  };
}

export function evaluateModelOnFeatures(
  model: MLBrainModel,
  symbol: string,
  features: Record<string, number | string | boolean>,
): MLPredictionV2 {
  const setupId = `feat_${Date.now()}`;
  const reasons: string[] = [];

  if (!model.enabled || model.rules.length === 0) {
    return {
      symbol,
      setupId,
      modelVersion: model.modelVersion,
      isTrained: false,
      winProbability: null,
      badEntryRisk: 0,
      expectedMovePct: null,
      expectedHoldMinutes: null,
      confidenceAdjustment: 0,
      suggestedAction: 'ALLOW',
      reasons: ['ML brain not trained yet'],
      rowsUsed: model.trainingRowCount,
    };
  }

  let score = 0;
  let maxScore = 0;
  let applicableRules = 0;

  for (const rule of model.rules) {
    const val = Number(features[rule.feature] ?? 0);
    maxScore += rule.weight;
    if ((rule.operator === 'gt' && val > Number(rule.value)) ||
        (rule.operator === 'lt' && val < Number(rule.value)) ||
        (rule.operator === 'eq' && val === Number(rule.value))) {
      score += rule.weight;
      applicableRules++;
    }
  }

  const normalizedScore = maxScore > 0 ? score / maxScore : 0;
  const winProbability = normalizedScore * model.winRateTraining / 100;
  const badEntryRisk = 1 - winProbability;
  let suggestedAction: EntryGateVerdict = 'ALLOW';
  let confidenceAdjustment = 0;

  if (badEntryRisk >= 0.80) {
    suggestedAction = 'BLOCK';
    confidenceAdjustment = -0.3;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% >= 80% -> BLOCK`);
  } else if (badEntryRisk >= 0.65) {
    suggestedAction = 'WAIT';
    confidenceAdjustment = -0.15;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% >= 65% -> WAIT`);
  } else if (badEntryRisk >= 0.50) {
    confidenceAdjustment = -0.05;
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% -> slight confidence reduction`);
  } else {
    reasons.push(`ML badEntryRisk ${(badEntryRisk * 100).toFixed(0)}% < 50% -> ALLOW`);
  }

  return {
    symbol,
    setupId,
    modelVersion: model.modelVersion,
    isTrained: true,
    winProbability: Math.round(winProbability * 10000) / 10000,
    badEntryRisk: Math.round(badEntryRisk * 10000) / 10000,
    expectedMovePct: model.avgPnlTraining,
    expectedHoldMinutes: null,
    confidenceAdjustment: Math.round(confidenceAdjustment * 10000) / 10000,
    suggestedAction,
    reasons,
    rowsUsed: model.trainingRowCount,
  };
}
