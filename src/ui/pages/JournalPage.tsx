import { useEffect, useMemo, useRef, useState } from 'react';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { Journal } from '../../core/persistence/Journal';
import type { DataQuality, TradeRecord } from '../../core/types';
import {
  botReportToJson,
  botReportToMarkdown,
  formatReportDuration,
  generateBotReport,
  reportFormatters,
  type BotReport,
  type BotReportWindowHours,
} from '../../lib/reports/botReportGenerator';
import {
  chooseReportFolder,
  deleteSavedBotReport,
  getSelectedReportFolderName,
  loadSavedBotReports,
  openReportJsonFile,
  saveBotReport,
  type SavedBotReport,
} from '../../lib/reports/reportStorage';
import type { JournalFilter } from '../../state/ui-store';
import { logger } from '../../utils/logger';
import { useVirtualWindow } from '../../lib/ui/virtualization';

interface Props {
  journal: Journal;
}

const FILTERS: { key: JournalFilter; label: string }[] = [
  { key: 'ALL', label: 'All' },
  { key: 'WINNERS', label: 'Winners' },
  { key: 'LOSERS', label: 'Losers' },
  { key: 'GOOD', label: 'GOOD only' },
  { key: 'MEDIUM', label: 'MEDIUM' },
  { key: 'BAD', label: 'BAD' },
  { key: 'training', label: 'Training eligible' },
  { key: 'excluded', label: 'Excluded' },
];
const JOURNAL_ROW_HEIGHT = 25;
const JOURNAL_VIRTUALIZATION_THRESHOLD = 40;

export function JournalPage({ journal }: Props) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [filter, setFilter] = useState<JournalFilter>('ALL');
  const [reportWindow, setReportWindow] = useState<BotReportWindowHours>(12);
  const [report, setReport] = useState<BotReport | null>(null);
  const [savedReports, setSavedReports] = useState<SavedBotReport[]>(() => loadSavedBotReports());
  const [reportFolderName, setReportFolderName] = useState<string | null>(() => getSelectedReportFolderName());
  const [reportStorageStatus, setReportStorageStatus] = useState<string | null>(null);
  const lastJournalVirtualAuditRef = useRef(0);

  useEffect(() => {
    setTrades(journal.getTrades());
    const interval = setInterval(() => setTrades(journal.getTrades()), 2000);
    return () => clearInterval(interval);
  }, [journal]);

  const filtered = useMemo(() => trades.filter(t => {
    if (filter === 'ALL') return true;
    if (filter === 'WINNERS') return (t.pnl ?? 0) > 0;
    if (filter === 'LOSERS') return (t.pnl ?? 0) < 0;
    if (filter === 'GOOD') return t.mlQuality?.dataQuality === 'GOOD';
    if (filter === 'MEDIUM') return t.mlQuality?.dataQuality === 'MEDIUM';
    if (filter === 'BAD') return t.mlQuality?.dataQuality === 'BAD';
    if (filter === 'training') return t.trainingEligible === true;
    if (filter === 'excluded') return t.mlQuality?.mlUse === 'excluded';
    return true;
  }), [filter, trades]);
  const orderedTrades = useMemo(() => filtered.slice().reverse(), [filtered]);
  const journalVirtual = useVirtualWindow({
    total: orderedTrades.length,
    rowHeight: JOURNAL_ROW_HEIGHT,
    threshold: JOURNAL_VIRTUALIZATION_THRESHOLD,
    overscan: 8,
  });
  const visibleJournalRows = useMemo(
    () => orderedTrades.slice(journalVirtual.startIndex, journalVirtual.endIndex),
    [orderedTrades, journalVirtual.startIndex, journalVirtual.endIndex],
  );

  useEffect(() => {
    const now = Date.now();
    if (now - lastJournalVirtualAuditRef.current < 5000) return;
    lastJournalVirtualAuditRef.current = now;
    logger.info(`VIRTUALIZED_TABLE_RENDER_AUDIT: table=journal enabled=${String(journalVirtual.isVirtualized)} visibleRows=${journalVirtual.visibleCount} totalRows=${orderedTrades.length} threshold=${JOURNAL_VIRTUALIZATION_THRESHOLD} fullDatasetPreserved=true exportUsesFullFilteredDataset=true`);
  }, [journalVirtual.isVirtualized, journalVirtual.visibleCount, orderedTrades.length]);

  const qualityVariant = (q: DataQuality | undefined) => {
    if (q === 'GOOD') return 'GOOD' as const;
    if (q === 'MEDIUM') return 'MEDIUM' as const;
    return 'BAD' as const;
  };

  const createReport = (windowHours: BotReportWindowHours) => {
    const generatedAt = new Date().toISOString();
    logger.info('REPORT_GENERATION_REQUESTED', { windowHours, generatedAt });
    const nextReport = generateBotReport({
      windowHours,
      trades: journal.getTrades(),
      logs: logger.getLogs(),
      generatedAt,
    });
    setReportWindow(windowHours);
    setReport(nextReport);
    logger.info('REPORT_DATA_SOURCE_AUDIT', auditPayload(nextReport));
    logger.info('REPORT_GENERATED_SUMMARY', {
      ...auditPayload(nextReport),
      realizedPnlUsd: nextReport.performance.realizedPnlUsd,
      winRatePct: nextReport.performance.winRatePct,
    });
    if (nextReport.dataAudit.missingDataSources.length > 0 || nextReport.notEnoughData) {
      logger.warn('REPORT_GENERATION_INCOMPLETE_DATA', auditPayload(nextReport));
    }
  };

  const copyReport = async () => {
    if (!report) return;
    await navigator.clipboard?.writeText(botReportToMarkdown(report));
    logger.info('REPORT_EXPORT_AUDIT', { ...auditPayload(report), format: 'clipboard' });
  };

  const exportReport = (format: 'json' | 'markdown') => {
    if (!report) return;
    const body = format === 'json' ? botReportToJson(report) : botReportToMarkdown(report);
    const blob = new Blob([body], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cryptobud-report-${report.windowHours}h-${report.generatedAt.replace(/[:.]/g, '-')}.${format === 'json' ? 'json' : 'md'}`;
    anchor.click();
    URL.revokeObjectURL(url);
    logger.info('REPORT_EXPORT_AUDIT', { ...auditPayload(report), format });
  };

  const chooseFolder = async () => {
    setReportStorageStatus(null);
    const name = await chooseReportFolder();
    setReportFolderName(name);
    setReportStorageStatus(name ? `Folder selected: ${name}` : 'Folder picker is not available in this runtime. Reports will still be saved in the app list.');
    logger.info('REPORT_FOLDER_SELECTION_AUDIT', { folderSelected: Boolean(name), folderName: name ?? 'unavailable' });
  };

  const saveCurrentReport = async () => {
    if (!report) return;
    const result = await saveBotReport(report);
    setSavedReports(loadSavedBotReports());
    setReportFolderName(result.folderName);
    setReportStorageStatus(result.fileSaved
      ? `Saved in app list and folder: ${result.folderName}`
      : `Saved in app list. Folder file save skipped: ${result.fallbackReason}`);
    logger.info('REPORT_SAVE_AUDIT', {
      ...auditPayload(report),
      savedReportId: result.saved.id,
      fileSaved: result.fileSaved,
      folderName: result.folderName,
      fallbackReason: result.fallbackReason,
    });
  };

  const openReportFile = async () => {
    const opened = await openReportJsonFile();
    if (!opened) {
      setReportStorageStatus('Open file is not available in this runtime, or no report was selected.');
      return;
    }
    setReport(opened);
    setReportWindow(opened.windowHours);
    setReportStorageStatus(`Opened report from file: Last ${opened.windowHours}h`);
    logger.info('REPORT_OPEN_FILE_AUDIT', auditPayload(opened));
  };

  const loadSavedReport = (saved: SavedBotReport) => {
    setReport(saved.report);
    setReportWindow(saved.report.windowHours);
    setReportStorageStatus(`Loaded saved report: ${saved.name}`);
    logger.info('REPORT_LOAD_SAVED_AUDIT', { savedReportId: saved.id, ...auditPayload(saved.report) });
  };

  const removeSavedReport = (id: string) => {
    setSavedReports(deleteSavedBotReport(id));
    setReportStorageStatus('Saved report removed from app list.');
    logger.info('REPORT_DELETE_SAVED_AUDIT', { savedReportId: id });
  };

  return (
    <div className="journal-split-layout">
      <div className="page-panel journal-left-panel" data-testid="journal-trade-panel">
        <div className="panel-section-title">Trade Journal</div>

        <div className="filter-bar">
          {FILTERS.map(f => (
            <button
              key={f.key}
              className={`btn btn-sm ${filter === f.key ? 'btn-green' : 'btn-outline'}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: 11, color: '#8b949e' }}>
            {filtered.length} of {trades.length} trades
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty-state">No trades yet.</div>
        ) : (
          <div className="journal-table-wrapper" ref={journalVirtual.scrollRef} onScroll={journalVirtual.onScroll} data-virtualized={journalVirtual.isVirtualized ? 'true' : 'false'}>
            <div className="journal-table">
              <div className="journal-row journal-header">
                <span>Symbol</span><span>Mode</span><span>Adapter</span><span>Strategy</span>
                <span>Entry</span><span>Exit</span><span>PnL</span><span>Exit Reason</span>
                <span>Quality</span><span>ML Use</span><span>Training</span>
              </div>
              {journalVirtual.topSpacerPx > 0 && <div className="virtual-spacer" style={{ height: journalVirtual.topSpacerPx }} />}
              {visibleJournalRows.map((t, i) => (
                <div key={t.tradeId ?? `${journalVirtual.startIndex + i}-${t.coin}-${t.entryTime}`} className="journal-row" style={{ color: t.pnl && t.pnl > 0 ? '#3fb950' : t.pnl && t.pnl < 0 ? '#f85149' : '#c9d1d9' }}>
                  <span style={{ fontWeight: 600 }}>{t.coin.replace('USDT', '')}</span>
                  <span>{t.mode}</span>
                  <span>{t.adapter}</span>
                  <span style={{ fontSize: 10 }}>{t.strategy}</span>
                  <span>${t.entryPrice.toFixed(2)}</span>
                  <span>{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '-'}</span>
                  <span>{t.pnl ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : '-'}</span>
                  <span style={{ fontSize: 10 }}>{t.closeSnapshot?.exitReason ?? '-'}</span>
                  <span><StatusBadge variant={qualityVariant(t.mlQuality?.dataQuality)} size="sm" /></span>
                  <span style={{ fontSize: 10 }}>{t.mlQuality?.mlUse ?? '-'}</span>
                  <span>{t.trainingEligible ? 'yes' : '-'}</span>
                </div>
              ))}
              {journalVirtual.bottomSpacerPx > 0 && <div className="virtual-spacer" style={{ height: journalVirtual.bottomSpacerPx }} />}
            </div>
          </div>
        )}
      </div>

      <div className="page-panel journal-report-panel" data-testid="journal-report-panel">
        <div className="journal-report-header">
          <div>
            <div className="panel-section-title">Bot/App Reports</div>
            <div className="journal-report-subtitle">Real journal and runtime logs only</div>
          </div>
          <select
            className="select-sm"
            value={reportWindow}
            onChange={(event) => setReportWindow(Number(event.target.value) as BotReportWindowHours)}
          >
            <option value={12}>Last 12h</option>
            <option value={24}>Last 24h</option>
          </select>
        </div>

        <div className="journal-report-actions">
          <button className="btn btn-sm btn-green" onClick={() => createReport(12)}>Generate 12h Report</button>
          <button className="btn btn-sm btn-green" onClick={() => createReport(24)}>Generate 24h Report</button>
          <button className="btn btn-sm btn-outline" onClick={() => createReport(reportWindow)}>Refresh Report</button>
          <button className="btn btn-sm btn-outline" onClick={chooseFolder}>Choose Folder</button>
          <button className="btn btn-sm btn-outline" onClick={saveCurrentReport} disabled={!report}>Save Report</button>
          <button className="btn btn-sm btn-outline" onClick={openReportFile}>Open JSON</button>
          <button className="btn btn-sm btn-outline" onClick={copyReport} disabled={!report}>Copy Report</button>
          <button className="btn btn-sm btn-outline" onClick={() => exportReport('json')} disabled={!report}>Export JSON</button>
          <button className="btn btn-sm btn-outline" onClick={() => exportReport('markdown')} disabled={!report}>Export TXT / Markdown</button>
        </div>

        <SavedReportsPanel
          folderName={reportFolderName}
          status={reportStorageStatus}
          savedReports={savedReports}
          onLoad={loadSavedReport}
          onDelete={removeSavedReport}
        />

        <ReportView report={report} />
      </div>
    </div>
  );
}

function SavedReportsPanel({
  folderName,
  status,
  savedReports,
  onLoad,
  onDelete,
}: {
  folderName: string | null;
  status: string | null;
  savedReports: SavedBotReport[];
  onLoad: (report: SavedBotReport) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section className="journal-saved-reports">
      <div className="journal-saved-reports-head">
        <div>
          <strong>Saved Reports</strong>
          <span>{folderName ? `Folder: ${folderName}` : 'No folder selected'}</span>
        </div>
        <span>{savedReports.length} saved</span>
      </div>
      {status && <div className="journal-report-storage-status">{status}</div>}
      {savedReports.length > 0 && (
        <div className="journal-saved-report-list">
          {savedReports.slice(0, 5).map((saved) => (
            <div className="journal-saved-report-row" key={saved.id}>
              <button className="journal-saved-report-main" onClick={() => onLoad(saved)} title={saved.name}>
                <strong>{saved.name}</strong>
                <span>{formatReportDate(saved.savedAt)} | PnL {reportFormatters.money(saved.report.performance.realizedPnlUsd)} | Win {reportFormatters.percent(saved.report.performance.winRatePct)}</span>
              </button>
              <button className="btn btn-sm btn-outline" onClick={() => onDelete(saved.id)}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function auditPayload(report: BotReport) {
  return {
    windowHours: report.windowHours,
    tradesFound: report.dataAudit.tradesFound,
    closedTradesFound: report.dataAudit.closedTradesFound,
    logsFound: report.dataAudit.logsFound,
    scannerEventsFound: report.dataAudit.scannerEventsFound,
    missingDataSources: report.dataAudit.missingDataSources,
    generatedAt: report.generatedAt,
  };
}

function ReportView({ report }: { report: BotReport | null }) {
  if (!report) {
    return (
      <div className="journal-report-empty">
        Generate a 12h or 24h report to inspect bot activity, scanner blocks, PnL, and app health.
      </div>
    );
  }

  return (
    <div className="journal-report-body">
      {report.notEnoughData && (
        <div className="journal-report-warning">
          <strong>Not enough data for this report window.</strong>
          <div>{report.dataAudit.missingDataSources.join(', ') || 'No persisted report data found.'}</div>
        </div>
      )}

      <div className="journal-report-card-grid">
        <ReportMetric label="Window" value={`${report.windowHours}h`} />
        <ReportMetric label="Mode" value={report.mode} />
        <ReportMetric label="Trades opened" value={report.performance.tradesOpened} />
        <ReportMetric label="Trades closed" value={report.performance.tradesClosed} />
        <ReportMetric label="Win rate" value={reportFormatters.percent(report.performance.winRatePct)} tone={profitTone(report.performance.realizedPnlUsd)} />
        <ReportMetric label="Realized PnL" value={reportFormatters.money(report.performance.realizedPnlUsd)} tone={profitTone(report.performance.realizedPnlUsd)} />
      </div>

      <section className="journal-report-section">
        <h3>Summary</h3>
        <div className="journal-summary-grid">
          <SummaryItem label="Start" value={formatReportDate(report.startTime)} />
          <SummaryItem label="End" value={formatReportDate(report.endTime)} />
          <SummaryItem label="AutoBots" {...humanizeSummaryValue(report.summary.autobotsStatus, 'autobots')} />
          <SummaryItem label="Micro Scalper" {...humanizeSummaryValue(report.summary.microScalperStatus, 'scalper')} />
          <SummaryItem label="Entry Confirmation" {...humanizeSummaryValue(report.summary.entryConfirmationMode, 'entry')} />
          <SummaryItem label="BTC/ETH Anchor" {...humanizeSummaryValue(report.summary.anchorStatus, 'anchor')} />
        </div>
      </section>

      <section className="journal-report-section">
        <h3>Trading Performance</h3>
        <div className="journal-report-metric-row">
          <ReportMetric label="Open now" value={report.performance.currentlyOpen} />
          <ReportMetric label="Wins / Losses" value={`${report.performance.winningClosedTrades} / ${report.performance.losingClosedTrades}`} />
          <ReportMetric label="Avg PnL %" value={reportFormatters.percent(report.performance.realizedPnlPct)} />
          <ReportMetric label="Fees" value={reportFormatters.money(report.performance.feesUsd)} />
        </div>
        <div className="journal-report-metric-row">
          <ReportMetric label="Best" value={report.performance.bestTrade ?? 'Unavailable'} tone="good" />
          <ReportMetric label="Worst" value={report.performance.worstTrade ?? 'Unavailable'} tone="bad" />
          <ReportMetric label="Avg hold" value={formatReportDuration(report.performance.avgHoldMs)} />
          <ReportMetric label="Fastest / Longest" value={`${formatReportDuration(report.performance.fastestSellMs)} / ${formatReportDuration(report.performance.longestTradeMs)}`} />
        </div>
      </section>

      <ReportTable title="Strategy Breakdown" rows={report.strategyBreakdown} score={false} />
      <ReportTable title="Risk Group Breakdown" rows={report.riskGroupBreakdown} score />

      <section className="journal-report-section">
        <h3>Smart Professional Analysis</h3>
        <div className="journal-report-metric-row">
          <ReportMetric label="Analyzed" value={valueOrUnavailable(report.professionalAnalysis.candidatesAnalyzed)} />
          <ReportMetric label="STRONG_BUY" value={valueOrUnavailable(report.professionalAnalysis.strongBuyCount)} tone="good" />
          <ReportMetric label="WAIT" value={valueOrUnavailable(report.professionalAnalysis.waitCount)} tone="warn" />
          <ReportMetric label="AVOID" value={valueOrUnavailable(report.professionalAnalysis.avoidCount)} tone="bad" />
          <ReportMetric label="Avg pro score" value={valueOrUnavailable(report.professionalAnalysis.averageProfessionalScore)} />
        </div>
        <BlockerList title="Top blockers" blockers={report.professionalAnalysis.topBlockers} />
      </section>

      <section className="journal-report-section">
        <h3>Scanner / Pipeline</h3>
        <div className="journal-report-metric-row">
          <ReportMetric label="Scan cycles" value={valueOrUnavailable(report.scannerPipeline.scanCycles)} />
          <ReportMetric label="Scanned" value={valueOrUnavailable(report.scannerPipeline.candidatesScanned)} />
          <ReportMetric label="Promoted" value={valueOrUnavailable(report.scannerPipeline.candidatesPromoted)} tone="good" />
          <ReportMetric label="Blocked" value={valueOrUnavailable(report.scannerPipeline.candidatesBlocked)} tone="warn" />
          <ReportMetric label="BUY approved" value={valueOrUnavailable(report.scannerPipeline.buyApprovedCount)} tone="good" />
          <ReportMetric label="BUY blocked" value={valueOrUnavailable(report.scannerPipeline.buyBlockedCount)} tone="bad" />
        </div>
        <BlockerList title="Common blockers" blockers={report.scannerPipeline.commonBlockers} />
      </section>

      <section className="journal-report-section">
        <h3>App Health</h3>
        <div className="journal-report-metric-row">
          <ReportMetric label="Warnings" value={report.appHealth.warningsCount} tone={report.appHealth.warningsCount > 0 ? 'warn' : undefined} />
          <ReportMetric label="Errors" value={report.appHealth.errorsCount} tone={report.appHealth.errorsCount > 0 ? 'bad' : undefined} />
          <ReportMetric label="Stale price" value={report.appHealth.stalePriceEvents} />
          <ReportMetric label="Persistence" value={report.appHealth.persistenceErrors} />
          <ReportMetric label="Rejected orders" value={report.appHealth.rejectedOrders} />
          <ReportMetric label="Perf warnings" value={report.appHealth.performanceWarnings} />
        </div>
      </section>

      <section className="journal-report-conclusion">
        <h3>Conclusion</h3>
        <p>{report.conclusion}</p>
      </section>
    </div>
  );
}

function ReportMetric({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`journal-report-metric ${tone ? `metric-${tone}` : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SummaryItem({
  label,
  value,
  detail,
  tone,
  raw,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: 'good' | 'bad' | 'warn' | 'muted';
  raw?: string;
}) {
  return (
    <div className={`journal-summary-item ${tone ? `summary-${tone}` : ''}`} title={raw}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function ReportTable({ title, rows, score }: { title: string; rows: BotReport['strategyBreakdown']; score: boolean }) {
  return (
    <section className="journal-report-section">
      <h3>{title}</h3>
      <div className={`journal-report-table ${score ? 'with-score' : ''}`}>
        <div className="journal-report-table-row journal-report-table-head">
          <span>Name</span><span>Buys</span><span>Sells</span><span>W/L</span><span>PnL</span><span>Avg</span>{score && <span>Score</span>}
        </div>
        {rows.map((row) => (
          <div className="journal-report-table-row" key={row.key}>
            <span>{row.label}</span>
            <span>{row.buys}</span>
            <span>{row.sells}</span>
            <span>{row.wins}/{row.losses}</span>
            <span className={profitTone(row.pnlUsd)}>{reportFormatters.money(row.pnlUsd)}</span>
            <span>{reportFormatters.money(row.avgPnlUsd)}</span>
            {score && <span>{valueOrUnavailable(row.avgScore ?? null)}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}

function BlockerList({ title, blockers }: { title: string; blockers: Array<{ reason: string; count: number }> }) {
  return (
    <div className="journal-report-blockers">
      <span>{title}</span>
      {blockers.length === 0 ? (
        <strong>Unavailable</strong>
      ) : blockers.slice(0, 5).map((blocker) => (
        <strong key={blocker.reason}>{blocker.reason}: {blocker.count}</strong>
      ))}
    </div>
  );
}

function valueOrUnavailable(value: number | null): string | number {
  if (value === null) return 'Unavailable';
  return Number.isInteger(value) ? value : value.toFixed(2);
}

function profitTone(value: number | null): 'good' | 'bad' | undefined {
  if (value === null || value === 0) return undefined;
  return value > 0 ? 'good' : 'bad';
}

function formatReportDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function humanizeSummaryValue(
  rawValue: string,
  kind: 'autobots' | 'scalper' | 'entry' | 'anchor',
): { value: string; detail?: string; tone?: 'good' | 'bad' | 'warn' | 'muted'; raw?: string } {
  if (!rawValue || rawValue === 'Unavailable') {
    return { value: 'Unavailable', detail: 'No data in this window', tone: 'muted' };
  }

  const raw = rawValue.replace(/\s+/g, ' ').trim();
  const upper = raw.toUpperCase();
  const counts = extractSummaryCounts(raw);
  const blocker = extractPrimaryBlocker(raw);

  if (kind === 'autobots') {
    if (upper.includes('RUNNING') || upper.includes('ACTIVE')) {
      return { value: 'Running', detail: counts || blocker || 'Latest runtime log found', tone: 'good', raw };
    }
    if (upper.includes('STOP') || upper.includes('DISABLED') || upper.includes('BLOCK')) {
      return { value: upper.includes('DISABLED') ? 'Disabled' : 'Blocked', detail: blocker || compactLogLabel(raw), tone: 'warn', raw };
    }
    return { value: compactLogLabel(raw), detail: blocker || counts, tone: 'muted', raw };
  }

  if (kind === 'scalper') {
    if (upper.includes('SCALPER') && (upper.includes('RUNNING') || upper.includes('ACTIVE') || upper.includes('BUY') || upper.includes('CANDIDATE'))) {
      return { value: 'Active', detail: counts || compactLogLabel(raw), tone: 'good', raw };
    }
    if (upper.includes('DISABLED') || upper.includes('BLOCK')) {
      return { value: upper.includes('DISABLED') ? 'Disabled' : 'Blocked', detail: blocker || compactLogLabel(raw), tone: 'warn', raw };
    }
    return { value: compactLogLabel(raw), detail: blocker || counts, tone: 'muted', raw };
  }

  if (kind === 'entry') {
    if (upper.includes('ALLOW') || upper.includes('APPROVED') || upper.includes('PASSED')) {
      return { value: 'Approving entries', detail: counts || compactLogLabel(raw), tone: 'good', raw };
    }
    if (upper.includes('BLOCK')) {
      return { value: 'Blocking entries', detail: blocker || compactLogLabel(raw), tone: 'bad', raw };
    }
    if (upper.includes('WAIT')) {
      return { value: 'Waiting for confirmation', detail: blocker || compactLogLabel(raw), tone: 'warn', raw };
    }
    return { value: compactLogLabel(raw), detail: blocker || counts, tone: 'muted', raw };
  }

  if (upper.includes('BLOCK') || upper.includes('DUMP') || upper.includes('RISK_OFF')) {
    return { value: 'Blocking risk', detail: blocker || compactLogLabel(raw), tone: 'bad', raw };
  }
  if (upper.includes('OK') || upper.includes('ALLOW') || upper.includes('SAFE')) {
    return { value: 'Clear', detail: compactLogLabel(raw), tone: 'good', raw };
  }
  return { value: compactLogLabel(raw), detail: blocker || counts, tone: 'muted', raw };
}

function compactLogLabel(raw: string): string {
  const prefix = raw.split(':')[0]?.replaceAll('_', ' ').trim();
  if (!prefix) return 'Latest log found';
  return prefix.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 42);
}

function extractSummaryCounts(raw: string): string | undefined {
  const parts: string[] = [];
  const candidates = raw.match(/(\d+)\s+candidates?/i)?.[1] ?? raw.match(/totalCandidates[=:]\s*(\d+)/i)?.[1];
  const buy = raw.match(/(\d+)\s+BUY/i)?.[1] ?? raw.match(/buyCount[=:]\s*(\d+)/i)?.[1];
  const wait = raw.match(/(\d+)\s+WAIT/i)?.[1] ?? raw.match(/waitCount[=:]\s*(\d+)/i)?.[1];
  const block = raw.match(/(\d+)\s+BLOCK/i)?.[1] ?? raw.match(/blockCount[=:]\s*(\d+)/i)?.[1];
  if (candidates) parts.push(`${candidates} candidates`);
  if (buy) parts.push(`${buy} buy`);
  if (wait) parts.push(`${wait} wait`);
  if (block) parts.push(`${block} block`);
  return parts.length > 0 ? parts.join(' / ') : undefined;
}

function extractPrimaryBlocker(raw: string): string | undefined {
  const normalized = raw.replaceAll('_', ' ');
  const blockReason = normalized.match(/(?:blockReason|topReasons|reason|finalNoBuyReason)[=:\s]+([^|,;]+)/i)?.[1]?.trim();
  if (blockReason) return blockReason.slice(0, 80);
  if (/stale price/i.test(normalized)) return 'Stale price';
  if (/spread/i.test(normalized)) return 'Spread too high';
  if (/no tp room/i.test(normalized)) return 'No TP room';
  if (/safe pullback/i.test(normalized)) return 'Waiting for safe pullback';
  if (/duplicate/i.test(normalized)) return 'Duplicate/open position';
  if (/anchor/i.test(normalized)) return 'BTC/ETH anchor';
  return undefined;
}
