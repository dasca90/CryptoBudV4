import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, msg: string) => {
  if (cond) passed++;
  else {
    failed++;
    console.error('FAIL', msg);
  }
};

const src = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');

const symbolIdx = src.indexOf('>Symbol</span>');
const trendIdx = src.indexOf('>Trend</span>');
const strategyIdx = src.indexOf('>Strategy</span>');
const confScoreIdx = src.indexOf('>Conf Score</span>');
const whyIdx = src.indexOf('>Why</span>');
const statusIdx = src.indexOf('>Status</span>');

ok(symbolIdx >= 0, 'symbol column exists');
ok(trendIdx > symbolIdx, 'trend is after symbol');
ok(strategyIdx > trendIdx, 'strategy is after trend');
ok(confScoreIdx > strategyIdx, 'confidence score is immediately after strategy area');
ok(whyIdx > confScoreIdx, 'why column is after confidence score');
ok(statusIdx > whyIdx, 'status remains visible after why');
ok(src.includes('compactGridCols =') && src.includes('detailedGridCols ='), 'compact/detailed grid definitions exist');
ok(src.includes("minWidth: viewMode === 'compact' ? 0 : 1280"), 'compact mode does not force wide horizontal table');
ok(src.includes('TOP_CANDIDATES_LAYOUT_AUDIT'), 'layout audit log exists');
ok(src.includes('horizontalScrollNeededForConfidence='), 'layout audit includes confidence visibility check');
ok(src.includes('resolveWhyNoBuy') && src.includes('BUY_READY') && src.includes('WAITING_FOR_REBOUND') && src.includes('BLOCKED_BY_SPREAD'), 'why resolver includes canonical reason mapping');
ok(src.includes('onClick={() => props.onSelectSymbol(c.symbol)}'), 'row select behavior remains');
ok(src.includes('<option value="All">All</option>') && src.includes('<option value="Dipper">Dipper</option>'), 'filter dropdown remains');

console.log(`top-candidates-column-order: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
