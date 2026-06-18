import type {
  ImportedMLRow, MLImportResult, MLImportFormat, MLRowSource,
  MLImportValidationResult, TradingMode,
} from '../types';
import { evaluateImportedRowQuality } from './ml-import-quality';
import { logger } from '../../utils/logger';

let importCounter = 0;

function generateRowId(source: MLRowSource): string {
  importCounter++;
  return `${source}_${Date.now()}_${importCounter}`;
}

export function detectImportFormat(json: unknown): MLImportFormat {
  if (!json || typeof json !== 'object') return 'UNKNOWN';

  const obj = json as Record<string, unknown>;

  if (obj.schemaVersion && typeof obj.schemaVersion === 'string' && obj.schemaVersion.startsWith('cryptobud-v4-ml-dataset')) {
    return 'V4_DATASET';
  }

  if (obj.rows && Array.isArray(obj.rows)) {
    if (obj.schemaVersion && typeof obj.schemaVersion === 'string' && obj.schemaVersion.startsWith('cryptobud-v4-ml-dataset')) {
      return 'V4_DATASET';
    }
  }

  if (obj.trades && Array.isArray(obj.trades)) {
    return 'V3_REPORT';
  }

  if (Array.isArray(obj)) {
    const first = obj[0] as Record<string, unknown> | undefined;
    if (first && first.schemaVersion && typeof first.schemaVersion === 'string') {
      return 'V4_DATASET';
    }
  }

  if (obj.tradeId || obj.tradeSnapshot || obj.strategySnapshot) {
    return 'V3_REPORT';
  }

  if (obj.buySnapshot || obj.closeSnapshot) {
    return 'V3_REPORT';
  }

  return 'UNKNOWN';
}

function safeStr(v: unknown, fallback?: string | null): string {
  if (v === undefined || v === null) return fallback ?? '';
  return String(v);
}

function safeNum(v: unknown, fallback = 0): number {
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return isNaN(n) ? fallback : n;
}

function safeBool(v: unknown, fallback = false): boolean {
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return fallback;
}

function inferMode(strategy: string, symbol: string): TradingMode {
  if (!strategy) return 'AUTO';
  if (strategy.toLowerCase().includes('scalp')) return 'SCALPER';
  if (strategy.toLowerCase().includes('manual')) return 'MANUAL';
  return 'AUTO';
}

function safeMode(v: unknown, fallback: TradingMode = 'AUTO'): TradingMode {
  if (v === 'AUTO' || v === 'MANUAL' || v === 'SCALPER') return v;
  if (typeof v === 'string') return inferMode(v, '');
  return fallback;
}

function extractFeatures(row: Record<string, unknown>): Record<string, number | string | boolean> {
  const features: Record<string, number | string | boolean> = {};
  const featureKeys = [
    'spreadPct', 'volumeRel', 'dipPercent', 'reboundPercent',
    'm5Change', 'm15Change', 'h1Change', 'change24h',
    'confidence', 'momentum', 'priceFresh', 'bookFresh',
    'tpRoomOk', 'reboundConfirmed', 'momentumConfirmed',
  ];
  for (const key of featureKeys) {
    if (row[key] !== undefined) {
      features[key] = row[key] as number | string | boolean;
    }
  }
  features.marketRegime = safeStr(row.marketRegime, 'unknown');
  features.btcRegime = safeStr(row.btcRegime, 'unknown');
  features.strategy = safeStr(row.strategy, 'unknown');
  return features;
}

function extractOutcomeLabels(row: Record<string, unknown>): Record<string, number | string | boolean> {
  return {
    pnlPercent: safeNum(row.pnlPercent),
    hitTp1: safeBool(row.hitTp1),
    hitTp2: safeBool(row.hitTp2),
    hitStopLoss: safeBool(row.hitStopLoss),
    exitReason: safeStr(row.exitReason, ''),
    mfePercent: safeNum(row.mfePercent),
    maePercent: safeNum(row.maePercent),
  };
}

export function normalizeV3Report(json: Record<string, unknown>): ImportedMLRow[] {
  const rows: ImportedMLRow[] = [];
  const rawTrades = json.trades || json.orders || [];

  if (!Array.isArray(rawTrades) || rawTrades.length === 0) {
    const single = tryExtractSingleRow(json, 'v3_report');
    if (single) rows.push(single);
    return rows;
  }

  for (const t of rawTrades) {
    const trade = (typeof t === 'object' && t !== null) ? t as Record<string, unknown> : {};
    const buySnap = (trade.buySnapshot && typeof trade.buySnapshot === 'object') ? trade.buySnapshot as Record<string, unknown> : {};
    const closeSnap = (trade.closeSnapshot && typeof trade.closeSnapshot === 'object') ? trade.closeSnapshot as Record<string, unknown> : {};

    const realMarketPriceAtClose = safeNum(closeSnap.realMarketPriceAtClose ?? trade.realMarketPriceAtClose);
    const isRealMarketPriceAtClose = safeBool(closeSnap.isRealMarketPrice ?? trade.isRealMarketPriceAtClose ?? trade.priceValidationStatus === 'REAL') || safeStr(closeSnap.executionQuality) === 'CLEAN_REAL_MARKET_PRICE';

    const row: ImportedMLRow = {
      rowId: generateRowId('v3_report'),
      source: 'v3_report',
      sourceFileName: safeStr(json.sourceFileName),
      importedAt: new Date().toISOString(),
      symbol: safeStr(trade.symbol || buySnap.symbol || json.symbol),
      mode: safeMode(buySnap.mode ?? trade.mode, 'AUTO'),
      adapter: safeStr(buySnap.adapter || trade.adapter || 'Demo'),
      riskGroup: safeStr(buySnap.riskGroup ?? trade.riskGroup ?? null, null) || null,
      strategy: safeStr(buySnap.selectedStrategy || trade.strategy || json.strategy || ''),
      confidence: safeNum(buySnap.confidence ?? trade.mlConfidence ?? json.confidence, 0.5),
      marketRegime: safeStr(buySnap.marketRegime ?? trade.marketRegime ?? json.marketRegime, null) || null,
      btcRegime: safeStr(buySnap.btcRegime ?? trade.btcRegime ?? json.btcRegime, null) || null,
      spreadPct: safeNum(buySnap.spreadPct ?? json.spreadPct, 0),
      volumeRel: safeNum(buySnap.volumeRel ?? json.volumeRel, 1),
      priceFresh: safeBool(buySnap.priceFresh ?? json.priceFresh, true),
      bookFresh: safeBool(buySnap.bookFresh ?? json.bookFresh, true),
      tpRoomOk: safeBool(buySnap.tpRoomOk ?? json.tpRoomOk, true),
      reboundConfirmed: safeBool(buySnap.reboundConfirmed ?? json.reboundConfirmed, false),
      momentumConfirmed: safeBool(buySnap.momentumConfirmed ?? json.momentumConfirmed, false),
      dipPercent: safeNum(buySnap.dipPercent ?? json.dipPercent, 0),
      reboundPercent: safeNum(buySnap.reboundPercent ?? json.reboundPercent, 0),
      m5Change: safeNum(buySnap.m5Change ?? json.m5Change, 0),
      m15Change: safeNum(buySnap.m15Change ?? json.m15Change, 0),
      h1Change: safeNum(buySnap.h1Change ?? json.h1Change, 0),
      change24h: safeNum(buySnap.change24h ?? json.change24h, 0),
      pnlPercent: safeNum(trade.pnlPercent ?? closeSnap.pnlPercent ?? json.pnlPercent),
      exitReason: safeStr(closeSnap.exitReason ?? trade.exitReason ?? json.exitReason, null) || null,
      hitTp1: safeBool(closeSnap.tp1Hit ?? trade.hitTp1 ?? json.hitTp1),
      hitTp2: safeBool(closeSnap.tp2Hit ?? trade.hitTp2 ?? json.hitTp2),
      hitStopLoss: safeBool(closeSnap.exitReason === 'STOP_LOSS' || trade.hitStopLoss || json.hitStopLoss),
      mfePercent: safeNum(closeSnap.mfePercent ?? trade.mfePercent ?? json.mfePercent),
      maePercent: safeNum(closeSnap.maePercent ?? trade.maePercent ?? json.maePercent),
      realMarketPriceAtBuy: safeNum(buySnap.realMarketPriceAtBuy ?? trade.realMarketPriceAtBuy ?? 0),
      realMarketPriceAtClose,
      isRealMarketPriceAtClose,
      predictionFeatures: extractFeatures({ ...json, ...trade, ...buySnap }),
      outcomeLabels: extractOutcomeLabels({ ...json, ...trade, ...closeSnap }),
      dataQuality: 'MEDIUM',
      mlUse: 'advisory_only',
      trainingWeight: 0,
      trainingEligible: false,
      reasons: [],
      warnings: [],
    };

    const quality = evaluateImportedRowQuality(row);
    row.dataQuality = quality.dataQuality;
    row.mlUse = quality.mlUse;
    row.trainingWeight = quality.trainingWeight;
    row.trainingEligible = quality.trainingEligible;
    row.reasons = quality.reasons;
    row.warnings = quality.warnings;

    rows.push(row);
  }

  return rows;
}

export function normalizeV4Dataset(json: Record<string, unknown>): ImportedMLRow[] {
  const rows: ImportedMLRow[] = [];
  const rawRows = json.rows;
  if (!Array.isArray(rawRows)) return rows;

  for (const r of rawRows) {
    const row = (typeof r === 'object' && r !== null) ? r as Record<string, unknown> : {};

    const predictionFeatures = (row.predictionFeatures && typeof row.predictionFeatures === 'object')
      ? row.predictionFeatures as Record<string, number | string | boolean>
      : extractFeatures(row);

    const outcomeLabels = (row.outcomeLabels && typeof row.outcomeLabels === 'object')
      ? row.outcomeLabels as Record<string, number | string | boolean>
      : extractOutcomeLabels(row);

    const feature = (key: string, fallback?: unknown) => predictionFeatures[key] ?? fallback;
    const outcome = (key: string, fallback?: unknown) => outcomeLabels[key] ?? fallback;
    const resolvedExitReason = safeStr(row.exitReason ?? outcome('exitReason'), null) || null;
    const resolvedRealClosePrice = safeNum(
      row.realMarketPriceAtClose ?? outcome('realMarketPriceAtClose') ?? row.exitPrice ?? outcome('exitPrice'),
    );
    const resolvedExecutionQuality = safeStr(row.executionQuality ?? outcome('executionQuality'), '');
    const exportedQuality = safeStr(row.dataQuality ?? outcome('dataQuality'), '');
    const exportedTrainingEligible = safeBool(row.trainingEligible ?? outcome('trainingEligible'), false);
    const resolvedIsRealClose = safeBool(
      row.isRealMarketPriceAtClose ?? outcome('isRealMarketPriceAtClose'),
      (resolvedExecutionQuality === 'CLEAN_REAL_MARKET_PRICE' || (exportedQuality === 'GOOD' && exportedTrainingEligible)) && resolvedRealClosePrice > 0,
    );

    const imr: ImportedMLRow = {
      rowId: generateRowId('v4_dataset'),
      source: 'v4_dataset',
      sourceFileName: safeStr(json.sourceFileName),
      importedAt: new Date().toISOString(),
      symbol: safeStr(row.symbol),
      mode: safeMode(row.mode, 'AUTO'),
      adapter: safeStr(row.adapter, 'Demo'),
      riskGroup: safeStr(row.riskGroup ?? feature('riskGroup', null), null) || null,
      strategy: safeStr(row.strategy || row.selectedStrategy || feature('strategy', '')),
      confidence: safeNum(row.confidence ?? feature('confidence'), 0.5),
      marketRegime: safeStr(row.marketRegime ?? feature('marketRegime', null), null) || null,
      btcRegime: safeStr(row.btcRegime ?? feature('btcRegime', null), null) || null,
      spreadPct: safeNum(row.spreadPct ?? feature('spreadPct'), 0),
      volumeRel: safeNum(row.volumeRel ?? feature('volumeRel'), 1),
      priceFresh: safeBool(row.priceFresh ?? feature('priceFresh'), true),
      bookFresh: safeBool(row.bookFresh ?? feature('bookFresh'), true),
      tpRoomOk: safeBool(row.tpRoomOk ?? feature('tpRoomOk'), true),
      reboundConfirmed: safeBool(row.reboundConfirmed ?? feature('reboundConfirmed'), false),
      momentumConfirmed: safeBool(row.momentumConfirmed ?? feature('momentumConfirmed'), false),
      dipPercent: safeNum(row.dipPercent ?? feature('dipPercent'), 0),
      reboundPercent: safeNum(row.reboundPercent ?? feature('reboundPercent'), 0),
      m5Change: safeNum(row.m5Change ?? feature('m5Change'), 0),
      m15Change: safeNum(row.m15Change ?? feature('m15Change'), 0),
      h1Change: safeNum(row.h1Change ?? feature('h1Change'), 0),
      change24h: safeNum(row.change24h ?? feature('change24h'), 0),
      pnlPercent: safeNum(row.pnlPercent ?? outcome('pnlPercent')),
      exitReason: resolvedExitReason,
      hitTp1: safeBool(row.hitTp1 ?? outcome('hitTp1')),
      hitTp2: safeBool(row.hitTp2 ?? outcome('hitTp2')),
      hitStopLoss: safeBool(row.hitStopLoss ?? outcome('hitStopLoss') ?? resolvedExitReason === 'STOP_LOSS'),
      mfePercent: safeNum(row.mfePercent ?? outcome('mfePercent')),
      maePercent: safeNum(row.maePercent ?? outcome('maePercent')),
      realMarketPriceAtBuy: safeNum(row.realMarketPriceAtBuy ?? feature('realMarketPriceAtBuy'), 0),
      realMarketPriceAtClose: resolvedRealClosePrice,
      isRealMarketPriceAtClose: resolvedIsRealClose,
      predictionFeatures,
      outcomeLabels,
      dataQuality: 'MEDIUM',
      mlUse: 'advisory_only',
      trainingWeight: 0,
      trainingEligible: false,
      reasons: [],
      warnings: [],
    };

    const quality = evaluateImportedRowQuality(imr);
    imr.dataQuality = quality.dataQuality;
    imr.mlUse = quality.mlUse;
    imr.trainingWeight = quality.trainingWeight;
    imr.trainingEligible = quality.trainingEligible;
    imr.reasons = quality.reasons;
    imr.warnings = quality.warnings;

    rows.push(imr);
  }

  return rows;
}

function tryExtractSingleRow(json: Record<string, unknown>, source: MLRowSource): ImportedMLRow | null {
  if (!json.symbol && !json.tradeId) return null;
  const row = { ...json } as Record<string, unknown>;
  const buySnap = (row.buySnapshot && typeof row.buySnapshot === 'object') ? row.buySnapshot as Record<string, unknown> : {};
  const closeSnap = (row.closeSnapshot && typeof row.closeSnapshot === 'object') ? row.closeSnapshot as Record<string, unknown> : {};

  const realMarketPriceAtClose = safeNum(closeSnap.realMarketPriceAtClose ?? row.realMarketPriceAtClose);
  const isRealMarketPriceAtClose = safeBool(closeSnap.isRealMarketPrice ?? row.isRealMarketPriceAtClose ?? true);

  const imr: ImportedMLRow = {
    rowId: generateRowId(source),
    source,
    sourceFileName: safeStr(json.sourceFileName),
    importedAt: new Date().toISOString(),
    symbol: safeStr(row.symbol || buySnap.symbol),
    mode: safeMode(buySnap.mode ?? row.mode, 'AUTO'),
    adapter: safeStr(buySnap.adapter || row.adapter || 'Demo'),
    riskGroup: safeStr(buySnap.riskGroup ?? row.riskGroup ?? null, null) || null,
    strategy: safeStr(buySnap.selectedStrategy || row.strategy || ''),
    confidence: safeNum(buySnap.confidence ?? row.mlConfidence ?? row.confidence, 0.5),
    marketRegime: safeStr(buySnap.marketRegime ?? row.marketRegime, null) || null,
    btcRegime: safeStr(buySnap.btcRegime ?? row.btcRegime, null) || null,
    spreadPct: safeNum(buySnap.spreadPct ?? row.spreadPct, 0),
    volumeRel: safeNum(buySnap.volumeRel ?? row.volumeRel, 1),
    priceFresh: safeBool(buySnap.priceFresh ?? row.priceFresh, true),
    bookFresh: safeBool(buySnap.bookFresh ?? row.bookFresh, true),
    tpRoomOk: safeBool(buySnap.tpRoomOk ?? row.tpRoomOk, true),
    reboundConfirmed: safeBool(buySnap.reboundConfirmed ?? row.reboundConfirmed, false),
    momentumConfirmed: safeBool(buySnap.momentumConfirmed ?? row.momentumConfirmed, false),
    dipPercent: safeNum(buySnap.dipPercent ?? row.dipPercent, 0),
    reboundPercent: safeNum(buySnap.reboundPercent ?? row.reboundPercent, 0),
    m5Change: safeNum(buySnap.m5Change ?? row.m5Change, 0),
    m15Change: safeNum(buySnap.m15Change ?? row.m15Change, 0),
    h1Change: safeNum(buySnap.h1Change ?? row.h1Change, 0),
    change24h: safeNum(buySnap.change24h ?? row.change24h, 0),
    pnlPercent: safeNum(closeSnap.pnlPercent ?? row.pnlPercent),
    exitReason: safeStr(closeSnap.exitReason ?? row.exitReason, null) || null,
    hitTp1: safeBool(closeSnap.tp1Hit ?? row.hitTp1),
    hitTp2: safeBool(closeSnap.tp2Hit ?? row.hitTp2),
    hitStopLoss: safeBool(closeSnap.exitReason === 'STOP_LOSS' || row.hitStopLoss || row.exitReason === 'STOP_LOSS'),
    mfePercent: safeNum(closeSnap.mfePercent ?? row.mfePercent),
    maePercent: safeNum(closeSnap.maePercent ?? row.maePercent),
    realMarketPriceAtBuy: safeNum(buySnap.realMarketPriceAtBuy ?? row.realMarketPriceAtBuy, 0),
    realMarketPriceAtClose,
    isRealMarketPriceAtClose,
    predictionFeatures: extractFeatures({ ...row, ...buySnap }),
    outcomeLabels: extractOutcomeLabels({ ...row, ...closeSnap }),
    dataQuality: 'MEDIUM',
    mlUse: 'advisory_only',
    trainingWeight: 0,
    trainingEligible: false,
    reasons: [],
    warnings: [],
  };

  const quality = evaluateImportedRowQuality(imr);
  imr.dataQuality = quality.dataQuality;
  imr.mlUse = quality.mlUse;
  imr.trainingWeight = quality.trainingWeight;
  imr.trainingEligible = quality.trainingEligible;
  imr.reasons = quality.reasons;
  imr.warnings = quality.warnings;

  return imr;
}

export function validateImportedRows(rows: ImportedMLRow[]): MLImportValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  let accepted = 0;
  let rejected = 0;

  for (const row of rows) {
    if (!row.symbol || !row.strategy || row.pnlPercent === undefined || row.pnlPercent === null) {
      rejected++;
      errors.push(`Row ${row.rowId}: missing required fields (symbol/strategy/pnl)`);
    } else {
      accepted++;
    }
  }

  if (rows.length === 0) {
    warnings.push('No rows found in import');
  }

  if (accepted === 0 && rows.length > 0) {
    errors.push('All rows rejected');
  }

  return {
    valid: errors.length === 0,
    acceptedRows: accepted,
    rejectedRows: rejected,
    warnings,
    errors,
  };
}

export function importMLJson(json: unknown): MLImportResult {
  logger.info('ML_IMPORT_STARTED');

  const importId = `import_${Date.now()}`;
  const importedAt = new Date().toISOString();

  const format = detectImportFormat(json);
  logger.info(`ML_IMPORT_FORMAT_DETECTED: ${format}`);

  if (format === 'UNKNOWN') {
    logger.error('ML_IMPORT_FAILED: unknown format');
    return {
      importId,
      importedAt,
      format,
      totalRows: 0,
      acceptedRows: 0,
      rejectedRows: 0,
      goodRows: 0,
      mediumRows: 0,
      badRows: 0,
      warnings: [],
      errors: ['Unknown JSON format. Expected V3 report or V4 dataset.'],
      rows: [],
    };
  }

  let rows: ImportedMLRow[] = [];

  try {
    if (format === 'V3_REPORT') {
      rows = normalizeV3Report(json as Record<string, unknown>);
    } else {
      rows = normalizeV4Dataset(json as Record<string, unknown>);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`ML_IMPORT_FAILED: ${msg}`);
    return {
      importId,
      importedAt,
      format,
      totalRows: 0,
      acceptedRows: 0,
      rejectedRows: 0,
      goodRows: 0,
      mediumRows: 0,
      badRows: 0,
      warnings: [],
      errors: [msg],
      rows: [],
    };
  }

  const validation = validateImportedRows(rows);
  const goodRows = rows.filter(r => r.dataQuality === 'GOOD').length;
  const mediumRows = rows.filter(r => r.dataQuality === 'MEDIUM').length;
  const badRows = rows.filter(r => r.dataQuality === 'BAD').length;

  logger.info(`ML_IMPORT_COMPLETED: ${rows.length} rows (${goodRows} GOOD, ${mediumRows} MEDIUM, ${badRows} BAD)`);

  if (badRows > 0) {
    logger.info(`ML_IMPORT_ROWS_REJECTED: ${badRows} BAD rows excluded from training`);
  }

  return {
    importId,
    importedAt,
    format,
    totalRows: rows.length,
    acceptedRows: validation.acceptedRows,
    rejectedRows: validation.rejectedRows,
    goodRows,
    mediumRows,
    badRows,
    warnings: validation.warnings,
    errors: validation.errors,
    rows,
  };
}
