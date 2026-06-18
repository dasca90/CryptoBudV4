import { useState, useEffect, useRef } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EquityCurveChart } from '../../components/charts/EquityCurveChart';
import { formatLocalTime } from '../../utils/timeFormatter';
import type { Journal } from '../../core/persistence/Journal';
import type { MLBrainModel, ImportedMLRow, MlRuntimeMode, MlRuntimeGuardState, MlRuntimeEvent } from '../../core/types';
import { importMLJson } from '../../core/ml/ml-importer';
import { trainMLModel } from '../../core/ml/ml-trainer';
import { logger } from '../../utils/logger';

interface Props {
  journal: Journal;
  onExportML: () => void;
  onExportTraining: () => void;
  onExportAdvisory: () => void;
  onExportExcluded: () => void;
  equityHistory: { time: number; equity: number }[];
  brain: MLBrainModel | null;
  onBrainUpdate: (brain: MLBrainModel) => void;
  importedRows: ImportedMLRow[];
  onImportedRowsUpdate: (rows: ImportedMLRow[]) => void;
  guardState: MlRuntimeGuardState;
  events: MlRuntimeEvent[];
  onRuntimeModeChange: (mode: MlRuntimeMode) => void;
}

type BrainStatus = 'UNTRAINED' | 'TRAINED' | 'ERROR';

const MODE_OPTIONS: { key: MlRuntimeMode; label: string; desc: string }[] = [
  { key: 'off', label: 'Off', desc: 'ML loaded but does not affect trading.' },
  { key: 'shadow_only', label: 'Shadow Only', desc: 'ML runs and records what it would do, but does not affect trading.' },
  { key: 'advisory_only', label: 'Advisory Only', desc: 'ML gives visible advice, but cannot change trading decisions.' },
  { key: 'active_guarded', label: 'Active Guarded', desc: 'ML can downgrade entries or trigger guarded exits. ML cannot force BUY.' },
];

const MODE_STYLE: Record<MlRuntimeMode, { bg: string; border: string; text: string }> = {
  off: { bg: 'rgba(72,79,88,0.2)', border: '#484f58', text: '#8b949e' },
  shadow_only: { bg: 'rgba(0,234,255,0.08)', border: 'rgba(0,234,255,0.25)', text: '#00eaff' },
  advisory_only: { bg: 'rgba(210,153,34,0.08)', border: 'rgba(210,153,34,0.25)', text: '#d29922' },
  active_guarded: { bg: 'rgba(248,81,73,0.1)', border: 'rgba(248,81,73,0.35)', text: '#f85149' },
};

function eventRowColor(ev: MlRuntimeEvent): string {
  if (ev.mode === 'active_guarded' && ev.wouldHaveChangedDecision) return '#f85149';
  if (ev.mode === 'active_guarded' && ev.exitTriggered) return '#bc8cff';
  if (ev.mode === 'advisory_only') return '#d29922';
  if (ev.mode === 'shadow_only') return '#00eaff';
  return '#484f58';
}

function eventRowBg(ev: MlRuntimeEvent): string {
  if (ev.exitTriggered) return 'rgba(188,140,255,0.06)';
  if (ev.mode === 'active_guarded' && ev.wouldHaveChangedDecision) return 'rgba(248,81,73,0.06)';
  return 'transparent';
}

export function MLLabPage({
  journal, onExportML, onExportTraining, onExportAdvisory, onExportExcluded,
  equityHistory, brain, onBrainUpdate, importedRows, onImportedRowsUpdate,
  guardState, events, onRuntimeModeChange,
}: Props) {
  const [, forceUpdate] = useState(0);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [trainResult, setTrainResult] = useState<string | null>(null);
  const [trainSuccess, setTrainSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [training, setTraining] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 10000);
    return () => clearInterval(interval);
  }, []);

  const counts = journal.computeMLCounts();
  const summary = journal.computeSummary();

  const brainStatus: BrainStatus = !brain ? 'UNTRAINED' : brain.enabled ? 'TRAINED' : 'UNTRAINED';

  const bars = [
    { label: 'GOOD', count: counts.good, color: '#3fb950', pct: counts.totalTrades > 0 ? (counts.good / counts.totalTrades) * 100 : 0 },
    { label: 'MEDIUM', count: counts.medium, color: '#d29922', pct: counts.totalTrades > 0 ? (counts.medium / counts.totalTrades) * 100 : 0 },
    { label: 'BAD', count: counts.bad, color: '#f85149', pct: counts.totalTrades > 0 ? (counts.bad / counts.totalTrades) * 100 : 0 },
  ];

  // Compute trade PnL history from closed trades
  const tradePnLHistory = (() => {
    const closed = journal.getClosedTrades();
    if (closed.length === 0) return [];
    const sorted = [...closed].sort((a, b) => new Date(a.entryTime).getTime() - new Date(b.entryTime).getTime());
    let cumulative = 0;
    return sorted.map((t, i) => {
      cumulative += t.pnl ?? 0;
      return {
        tradeNumber: i + 1,
        cumulativePnl: Math.round(cumulative * 100) / 100,
        tradePnl: Math.round((t.pnl ?? 0) * 100) / 100,
        symbol: t.coin.replace('USDT', ''),
      };
    });
  })();

  const handleImport = async () => {
    fileInputRef.current?.click();
  };

  const handleLoadJournalTraining = async () => {
    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const text = await journal.exportTrainingRows();
      const json = JSON.parse(text);
      const result = importMLJson(json);

      if (result.errors.length > 0 && result.rows.length === 0) {
        setError(result.errors.join(', '));
        return;
      }

      onImportedRowsUpdate(result.rows);
      setImportResult(
        'Loaded from Journal: ' + result.totalRows + ' rows, ' +
        result.goodRows + ' GOOD, ' +
        result.mediumRows + ' MEDIUM, ' +
        result.badRows + ' BAD',
      );
      logger.info(`ML_DIRECT_JOURNAL_TRAINING_ROWS_LOADED rows=${result.totalRows} good=${result.goodRows} medium=${result.mediumRows} bad=${result.badRows} accepted=${result.acceptedRows} rejected=${result.rejectedRows}`);

      if (result.warnings.length > 0) {
        setError(result.warnings.join(', '));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError('Load from Journal failed: ' + msg);
      logger.error('ML_DIRECT_JOURNAL_LOAD_FAILED: ' + msg);
    } finally {
      setImporting(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError(null);
    setImportResult(null);

    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const result = importMLJson(json);

      if (result.format === 'UNKNOWN') {
        setError(result.errors.join(', '));
        setImporting(false);
        return;
      }

      onImportedRowsUpdate(result.rows);
      setImportResult('Imported ' + result.totalRows + ' rows: ' + result.goodRows + ' GOOD, ' + result.mediumRows + ' MEDIUM, ' + result.badRows + ' BAD (format: ' + result.format + ')');

      if (result.errors.length > 0) {
        setError(result.errors.join(', '));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError('Import failed: ' + msg);
      logger.error('ML_IMPORT_FAILED: ' + msg);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const eligibleForTraining = importedRows.filter(r => r.trainingEligible && r.dataQuality === 'GOOD').length;
  const canTrain = eligibleForTraining > 0 && !training;

  const handleTrain = () => {
    if (!canTrain) {
      const reason = eligibleForTraining === 0 ? 'No GOOD eligible rows available.' : 'No imported rows to train on. Import data first.';
      setError(reason);
      logger.info(`ML_TRAINING_BLOCKED reason=${reason} eligibleRows=${eligibleForTraining} timestamp=${new Date().toISOString()}`);
      return;
    }

    const currentMode = guardState.mode;
    logger.info(`ML_TRAIN_BUTTON_CLICKED eligibleRows=${eligibleForTraining} currentModelStatus=${brainStatus} currentMlRuntimeMode=${currentMode} timestamp=${new Date().toISOString()}`);

    setTraining(true);
    setError(null);
    setTrainResult(null);
    setTrainSuccess(false);

    try {
      const result = trainMLModel(importedRows);
      onBrainUpdate(result.model);
      setTrainResult('Trained: ' + result.trainingRows + ' training rows, ' + result.model.rules.length + ' rules, accuracy ' + (result.accuracy ?? 'N/A') + '%');
      setTrainSuccess(true);

      logger.info(`ML_TRAINING_COMPLETED trainingRows=${result.trainingRows} modelVersion=${result.modelVersion} currentMlRuntimeMode=${currentMode} activeTradingChanged=false timestamp=${new Date().toISOString()}`);

      if (result.warnings.length > 0) {
        setError(result.warnings.join(', '));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError('Training failed: ' + msg);
      logger.error('ML_TRAIN_FAILED: ' + msg);
    } finally {
      setTraining(false);
    }
  };

  const goodImported = importedRows.filter(r => r.dataQuality === 'GOOD').length;
  const mediumImported = importedRows.filter(r => r.dataQuality === 'MEDIUM').length;
  const badImported = importedRows.filter(r => r.dataQuality === 'BAD').length;

  const recentEvents = events.slice(-25).reverse();
  const { mode, brainLoaded, modelTrained, counters } = guardState;
  const modeStyle = MODE_STYLE[mode] ?? MODE_STYLE.shadow_only;
  const isSafe = mode !== 'active_guarded';

  const modeLabel = MODE_OPTIONS.find(o => o.key === mode)?.label ?? 'Shadow Only';

  const netPnl = tradePnLHistory.length > 0
    ? tradePnLHistory[tradePnLHistory.length - 1].cumulativePnl
    : 0;

  return (
    <div className="ml-lab-layout">
      <div className="page-panel">
        {/* ── ROW 1: DATASET OVERVIEW + DATA QUALITY ── */}
        <div className="panel-section-title">ML Dataset Overview</div>

        <div className="ml-counts-grid">
          <div className="ml-count-card">
            <div className="ml-count-value">{counts.totalTrades}</div>
            <div className="ml-count-label">Total Closed Trades</div>
          </div>
          <div className="ml-count-card">
            <div className="ml-count-value" style={{ color: '#3fb950' }}>{counts.trainingEligible}</div>
            <div className="ml-count-label">
              <StatusBadge variant="TRAINING" size="sm" /> Eligible
            </div>
          </div>
          <div className="ml-count-card">
            <div className="ml-count-value" style={{ color: '#d29922' }}>{counts.advisoryOnly}</div>
            <div className="ml-count-label">
              <StatusBadge variant="ADVISORY" size="sm" /> Advisory Only
            </div>
          </div>
          <div className="ml-count-card">
            <div className="ml-count-value" style={{ color: '#8b949e' }}>{counts.excluded}</div>
            <div className="ml-count-label">
              <StatusBadge variant="EXCLUDED" size="sm" /> Excluded
            </div>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="panel-section-title">Data Quality Breakdown</div>
          <div className="ml-bar-chart">
            {bars.map(b => (
              <div key={b.label} className="ml-bar-row">
                <span style={{ width: 60, fontSize: 11 }}>
                  <StatusBadge variant={b.label as 'GOOD' | 'MEDIUM' | 'BAD'} size="sm" />
                </span>
                <div className="ml-bar-track">
                  <div className="ml-bar-fill" style={{ width: b.pct + '%', background: b.color }} />
                </div>
                <span style={{ width: 40, textAlign: 'right', fontSize: 11, color: '#8b949e' }}>{b.count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── ROW 2: ML TRAINING CARD + BRAIN STATUS ── */}
        <div style={{ marginTop: 16 }}>
          <div className="ml-training-card">
            <div className="panel-section-title">ML TRAINING</div>
            <div className="ml-training-body">
              <div className="ml-training-stats">
                <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                  <div className="ml-count-label">Model Status</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                    <StatusBadge
                      variant={brainStatus === 'TRAINED' ? 'TRAINING' : brainStatus === 'UNTRAINED' ? 'EXCLUDED' : 'BLOCK'}
                      size="sm"
                    /> {brainStatus}
                  </div>
                </div>
                <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                  <div className="ml-count-label">Eligible Rows</div>
                  <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4, color: eligibleForTraining > 0 ? '#3fb950' : '#8b949e' }}>
                    {eligibleForTraining}
                  </div>
                </div>
                {brain?.trainingRowCount != null && brain.trainingRowCount > 0 && (
                  <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                    <div className="ml-count-label">Rows Used</div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>{brain.trainingRowCount}</div>
                  </div>
                )}
                {brain?.winRateTraining != null && brain.winRateTraining > 0 && (
                  <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                    <div className="ml-count-label">Win Rate</div>
                    <div style={{ fontSize: 14, marginTop: 4, color: brain.winRateTraining >= 50 ? '#3fb950' : '#f85149' }}>
                      {brain.winRateTraining}%
                    </div>
                  </div>
                )}
              </div>
              <div className="ml-training-action">
                <button
                  className="btn btn-green ml-train-main-btn"
                  onClick={handleTrain}
                  disabled={!canTrain}
                >
                  {training ? 'Training...' : trainSuccess ? 'Retrain ML Model' : brainStatus === 'TRAINED' ? 'Retrain ML Model' : 'Train ML Model'}
                </button>
                {!canTrain && !training && (
                  <div style={{ fontSize: 10, color: '#f85149', marginTop: 4, textAlign: 'center' }}>
                    No GOOD eligible rows available.
                  </div>
                )}
              </div>
            </div>
            {trainResult && (
              <div style={{ fontSize: 11, color: '#3fb950', marginTop: 6 }}>{trainResult}</div>
            )}
            <div style={{ fontSize: 10, color: '#8b949e', marginTop: 6 }}>
              Uses only GOOD eligible rows. Training is manual only. ML Runtime Mode controls whether ML affects trading.
            </div>
          </div>
        </div>

        {/* ── IMPORTED DATA ── */}
        {importedRows.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div className="panel-section-title">Imported ML Data</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 6 }}>
              <div className="ml-count-card" style={{ padding: '6px 10px' }}>
                <div className="ml-count-label">Total</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{importedRows.length}</div>
              </div>
              <div className="ml-count-card" style={{ padding: '6px 10px' }}>
                <div className="ml-count-label" style={{ color: '#3fb950' }}>GOOD</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{goodImported}</div>
              </div>
              <div className="ml-count-card" style={{ padding: '6px 10px' }}>
                <div className="ml-count-label" style={{ color: '#d29922' }}>MEDIUM</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{mediumImported}</div>
              </div>
              <div className="ml-count-card" style={{ padding: '6px 10px' }}>
                <div className="ml-count-label" style={{ color: '#f85149' }}>BAD</div>
                <div style={{ fontSize: 13, marginTop: 2 }}>{badImported}</div>
              </div>
            </div>
          </div>
        )}

        {importResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#3fb950' }}>{importResult}</div>
        )}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f85149' }}>{error}</div>
        )}

        {/* ── IMPORT / EXPORT BUTTONS (compact) ── */}
        <div style={{ marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={handleImport} disabled={importing}>
            {importing ? 'Importing...' : 'Import JSON'}
          </button>
          <button className="btn btn-sm btn-green" onClick={handleLoadJournalTraining} disabled={importing}>
            Load Journal Training
          </button>
          <button className="btn btn-sm btn-outline" onClick={onExportML}>Export Dataset</button>
          <button className="btn btn-sm btn-outline" onClick={onExportTraining}>Export Training</button>
          <button className="btn btn-sm btn-outline" onClick={onExportAdvisory}>Export Advisory</button>
          <button className="btn btn-sm btn-outline" onClick={onExportExcluded}>Export Excluded</button>
        </div>

        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

        <div style={{ marginTop: 8, fontSize: 11, color: '#d29922' }}>
          ML cannot force BUY. ML can only WAIT/BLOCK/reduce confidence.
        </div>

        {/* ── ML RUNTIME MODE SELECTOR ── */}
        <div style={{ marginTop: 16 }}>
          <div className="panel-section-title">ML Runtime Mode</div>
          <div className="ml-mode-selector">
            {MODE_OPTIONS.map(opt => (
              <button
                key={opt.key}
                className={`ml-mode-btn${mode === opt.key ? ' ml-mode-btn--active' : ''}`}
                style={mode === opt.key ? {
                  background: MODE_STYLE[opt.key].bg,
                  borderColor: MODE_STYLE[opt.key].border,
                  color: MODE_STYLE[opt.key].text,
                } : undefined}
                onClick={() => onRuntimeModeChange(opt.key)}
                title={opt.desc}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 10, color: '#8b949e', marginTop: 4 }}>
            {MODE_OPTIONS.find(o => o.key === mode)?.desc}
          </div>
        </div>

        {/* ── TWO-COLUMN: SAFETY + DECISIONS ── */}
        <div className="ml-panels-row" style={{ marginTop: 12 }}>
          <div className="ml-safety-panel">
            <div className="panel-section-title" style={{ color: isSafe ? '#3fb950' : '#f85149' }}>
              {isSafe ? 'SAFE' : 'ACTIVE'} — ML Runtime Safety
            </div>
            <div className="ml-safety-grid">
              <div className="ml-safety-item">
                <span className="ml-safety-label">Mode</span>
                <span className="ml-safety-value" style={{ color: modeStyle.text }}>
                  {modeLabel.toUpperCase()}
                </span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">Brain Loaded</span>
                <span className="ml-safety-value">{brainLoaded ? 'YES' : 'NO'}</span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">Model Status</span>
                <span className="ml-safety-value">{modelTrained ? 'TRAINED' : 'UNTRAINED'}</span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">ML Influence</span>
                <span className="ml-safety-value" style={{ color: isSafe ? '#3fb950' : '#f85149' }}>
                  {mode === 'off' ? 'Disabled' : mode === 'shadow_only' ? 'Observation only' : mode === 'advisory_only' ? 'Advisory only' : 'Active'}
                </span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">Can Force BUY</span>
                <span className="ml-safety-value" style={{ color: '#3fb950' }}>NO</span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">Can Block BUY</span>
                <span className="ml-safety-value" style={{ color: !isSafe ? '#f85149' : '#3fb950' }}>
                  {!isSafe ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">Can Trigger SELL</span>
                <span className="ml-safety-value" style={{ color: !isSafe ? '#f85149' : '#3fb950' }}>
                  {!isSafe ? 'YES' : 'NO'}
                </span>
              </div>
              <div className="ml-safety-item">
                <span className="ml-safety-label">Persisted</span>
                <span className="ml-safety-value">{guardState.persisted ? 'OK' : 'NO'}</span>
              </div>
              {guardState.lastModeChangeAt && (
                <div className="ml-safety-item">
                  <span className="ml-safety-label">Last Changed</span>
                  <span className="ml-safety-value" style={{ fontSize: 10 }}>
                    {formatLocalTime(guardState.lastModeChangeAt, { format: 'time' })}
                  </span>
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              <div className="panel-section-title">Counters</div>
              <div className="ml-counter-grid">
                <div className="ml-counter-item">
                  <span className="ml-counter-value" style={{ color: '#00eaff' }}>{counters.shadowDecisions}</span>
                  <span className="ml-counter-label">Shadow</span>
                </div>
                <div className="ml-counter-item">
                  <span className="ml-counter-value" style={{ color: '#d29922' }}>{counters.advisoryEvents}</span>
                  <span className="ml-counter-label">Advisory</span>
                </div>
                <div className="ml-counter-item">
                  <span className="ml-counter-value" style={{ color: '#f85149' }}>{counters.activeDowngrades}</span>
                  <span className="ml-counter-label">Downgrades</span>
                </div>
                <div className="ml-counter-item">
                  <span className="ml-counter-value" style={{ color: '#bc8cff' }}>{counters.mlExitTriggers}</span>
                  <span className="ml-counter-label">ML Exits</span>
                </div>
                <div className="ml-counter-item">
                  <span className="ml-counter-value" style={{ color: '#8b949e' }}>{counters.blockedMutations}</span>
                  <span className="ml-counter-label">Blocked</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ml-decisions-panel">
            <div className="panel-section-title">
              ML Shadow Decisions / Advisory Events
            </div>
            {recentEvents.length === 0 ? (
              <div className="empty-state">No ML events yet. Events appear when the scanner runs and ML evaluates trades.</div>
            ) : (
              <div className="ml-events-table-wrapper">
                <div className="ml-events-table">
                  <div className="ml-events-row ml-events-header">
                    <span style={{ width: 80 }}>Time</span>
                    <span style={{ width: 80 }}>Symbol</span>
                    <span style={{ width: 70 }}>Original</span>
                    <span style={{ width: 70 }}>ML Pred</span>
                    <span style={{ width: 70 }}>Brain</span>
                    <span style={{ width: 90 }}>Would Change To</span>
                    <span style={{ width: 90 }}>Actual</span>
                    <span style={{ width: 60 }}>Mode</span>
                    <span style={{ flex: 1 }}>Reason</span>
                  </div>
                  {recentEvents.map(ev => (
                    <div key={ev.id} className="ml-events-row" style={{ background: eventRowBg(ev) }}>
                      <span style={{ width: 80, color: '#8b949e' }}>{new Date(ev.timestamp).toLocaleTimeString('en-US', { hour12: false })}</span>
                      <span style={{ width: 80, fontWeight: 600 }}>{ev.symbol}</span>
                      <span style={{ width: 70, color: '#c9d1d9' }}>{ev.originalDecision}</span>
                      <span style={{ width: 70, color: ev.mlPrediction === 'SELL' ? '#f85149' : ev.mlPrediction === 'BUY' ? '#3fb950' : '#8b949e' }}>
                        {ev.mlPrediction ?? '-'}
                      </span>
                      <span style={{ width: 70, color: ev.brainVerdict === 'BLOCK' ? '#f85149' : ev.brainVerdict === 'WAIT' ? '#d29922' : '#8b949e' }}>
                        {ev.brainVerdict ?? '-'}
                      </span>
                      <span style={{ width: 90, color: eventRowColor(ev) }}>
                        {ev.wouldHaveChangedDecision ? (ev.wouldHaveChangedTo ?? '-') : '-'}
                      </span>
                      <span style={{ width: 90, fontSize: 10, color: '#c9d1d9' }}>{ev.actualDecisionApplied}</span>
                      <span style={{ width: 60, fontSize: 9, color: MODE_STYLE[ev.mode]?.text ?? '#8b949e' }}>
                        {ev.mode === 'active_guarded' ? 'ACTIVE' : ev.mode === 'advisory_only' ? 'ADVSRY' : 'SHADOW'}
                      </span>
                      <span style={{ flex: 1, fontSize: 10, color: '#8b949e' }}>{ev.reason ?? ''}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── BOTTOM: IMPACT SUMMARY + EQUITY CURVE ── */}
        <div style={{ marginTop: 12 }}>
          <div className="panel-section-title">ML Impact Summary</div>
          <div className="ml-impact-grid">
            <div className="ml-impact-card">
              <span className="ml-impact-value">{counters.shadowDecisions + counters.advisoryEvents + counters.activeDowngrades + counters.mlExitTriggers}</span>
              <span className="ml-impact-label">Total Evaluations</span>
            </div>
            <div className="ml-impact-card">
              <span className="ml-impact-value" style={{ color: '#00eaff' }}>{counters.shadowDecisions}</span>
              <span className="ml-impact-label">Would-have-blocked (shadow)</span>
            </div>
            <div className="ml-impact-card">
              <span className="ml-impact-value" style={{ color: '#f85149' }}>{counters.activeDowngrades}</span>
              <span className="ml-impact-label">Actual blocked by ML</span>
            </div>
            <div className="ml-impact-card">
              <span className="ml-impact-value" style={{ color: '#bc8cff' }}>{counters.mlExitTriggers}</span>
              <span className="ml-impact-label">ML exit signals</span>
            </div>
            <div className="ml-impact-card">
              <span className="ml-impact-value" style={{ color: '#8b949e' }}>{counters.blockedMutations + counters.upgradeAttemptsBlocked}</span>
              <span className="ml-impact-label">Upgrades blocked</span>
            </div>
          </div>
          <div style={{ fontSize: 10, color: '#3fb950', marginTop: 6 }}>
            ML cannot upgrade to BUY — this protection is always active.
          </div>
        </div>

        {/* ── EQUITY CURVE AS COMPACT CARD ── */}
        <div style={{ marginTop: 16 }}>
          <EquityCurveChart
            data={equityHistory}
            tradePnL={tradePnLHistory}
            winRate={summary.winRate as number}
            totalTrades={summary.totalTrades as number}
            totalPnl={netPnl}
            height={160}
          />
        </div>
      </div>
    </div>
  );
}
