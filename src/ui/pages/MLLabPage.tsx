import { useState, useEffect, useRef } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { EquityCurveChart } from '../../components/charts/EquityCurveChart';
import { formatLocalTime } from '../../utils/timeFormatter';
import type { Journal } from '../../core/persistence/Journal';
import type { MLBrainModel, ImportedMLRow } from '../../core/types';
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
}

type BrainStatus = 'UNTRAINED' | 'TRAINED' | 'ERROR';

export function MLLabPage({
  journal, onExportML, onExportTraining, onExportAdvisory, onExportExcluded,
  equityHistory, brain, onBrainUpdate, importedRows, onImportedRowsUpdate,
}: Props) {
  const [, forceUpdate] = useState(0);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [trainResult, setTrainResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [training, setTraining] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const interval = setInterval(() => forceUpdate(n => n + 1), 3000);
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

  const handleImport = async () => {
    fileInputRef.current?.click();
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

  const handleTrain = () => {
    if (importedRows.length === 0) {
      setError('No imported rows to train on. Import data first.');
      return;
    }

    setTraining(true);
    setError(null);
    setTrainResult(null);

    try {
      const result = trainMLModel(importedRows);
      onBrainUpdate(result.model);
      setTrainResult('Trained: ' + result.trainingRows + ' training rows, ' + result.model.rules.length + ' rules, accuracy ' + (result.accuracy ?? 'N/A') + '%');

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

  return (
    <div className="ml-lab-layout">
      <div className="page-panel">
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

        <div style={{ marginTop: 16 }}>
          <div className="panel-section-title">ML Brain Status</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
            <div className="ml-count-card" style={{ padding: '8px 12px' }}>
              <div className="ml-count-label">Status</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>
                <StatusBadge variant={brainStatus === 'TRAINED' ? 'TRAINING' : brainStatus === 'UNTRAINED' ? 'EXCLUDED' : 'BLOCK'} size="sm" /> {brainStatus}
              </div>
            </div>
            {brain && (
              <>
                <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                  <div className="ml-count-label">Model Version</div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>{brain.modelVersion}</div>
                </div>
                <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                  <div className="ml-count-label">Training Rows</div>
                  <div style={{ fontSize: 14, marginTop: 4 }}>{brain.trainingRowCount}</div>
                </div>
                {brain.enabled && (
                  <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                    <div className="ml-count-label">Win Rate (Train)</div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>{brain.winRateTraining}%</div>
                  </div>
                )}
              </>
            )}
          </div>
          {brain && brain.trainedAt && (
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 6 }}>
              Last trained: {formatLocalTime(brain.trainedAt, { format: 'full' })}
            </div>
          )}
          {brain?.lastImportSummary && (
            <div style={{ fontSize: 11, color: '#8b949e', marginTop: 4 }}>
              Import: {brain.lastImportSummary}
            </div>
          )}
        </div>

        {importedRows.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <div className="panel-section-title">Imported ML Data</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                <div className="ml-count-label">Total Imported</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{importedRows.length}</div>
              </div>
              <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                <div className="ml-count-label" style={{ color: '#3fb950' }}>GOOD</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{goodImported}</div>
              </div>
              <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                <div className="ml-count-label" style={{ color: '#d29922' }}>MEDIUM</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{mediumImported}</div>
              </div>
              <div className="ml-count-card" style={{ padding: '8px 12px' }}>
                <div className="ml-count-label" style={{ color: '#f85149' }}>BAD</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>{badImported}</div>
              </div>
            </div>
          </div>
        )}

        {importResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#3fb950' }}>{importResult}</div>
        )}
        {trainResult && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#3fb950' }}>{trainResult}</div>
        )}
        {error && (
          <div style={{ marginTop: 8, fontSize: 12, color: '#f85149' }}>{error}</div>
        )}

        <div style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-sm" onClick={handleImport} disabled={importing}>
            {importing ? 'Importing...' : 'Import JSON'}
          </button>
          <button className="btn btn-sm btn-green" onClick={handleTrain} disabled={training || importedRows.length === 0}>
            {training ? 'Training...' : 'Train from GOOD rows'}
          </button>
          <button className="btn btn-sm btn-outline" onClick={onExportML}>Export Full Dataset</button>
          <button className="btn btn-sm btn-green" onClick={onExportTraining}>Export Training Rows</button>
          <button className="btn btn-sm btn-yellow" onClick={onExportAdvisory}>Export Advisory Rows</button>
          <button className="btn btn-sm btn-outline" onClick={onExportExcluded}>Export Excluded Rows</button>
        </div>

        <input ref={fileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFileChange} />

        <div style={{ marginTop: 10, fontSize: 11, color: '#d29922' }}>
          ML cannot force BUY. ML can only WAIT/BLOCK/reduce confidence.
        </div>

        <div style={{ marginTop: 16 }}>
          <div className="panel-section-title">Equity Curve</div>
          <EquityCurveChart data={equityHistory} height={100} />
        </div>

        <div style={{ marginTop: 12, fontSize: 11, color: '#484f58' }}>
          Summary: {String(summary.totalTrades)} trades {summary.winRate as number}% win rate {summary.totalPnl as number} PnL
        </div>
      </div>
    </div>
  );
}
