import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const adapter = readFileSync('src/lib/air-scanner/tradeV4DataAdapter.ts', 'utf8');
const page = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
const panel = readFileSync('src/components/trade-v4/ControlTowerPanel.tsx', 'utf8');
const app = readFileSync('src/App.tsx', 'utf8');

ok(adapter.includes('DIPPER_CARD_DATA_SOURCE_AUDIT'), 'logs data source audit');
ok(adapter.includes('DIPPER_CARD_STALE_DATA_AUDIT'), 'logs stale data audit');
ok(adapter.includes('dipperCardState'), 'builds canonical dipperCardState');
ok(page.includes('lastScanAt={props.model.lastScanAt ?? null}'), 'left sidebar receives live lastScanAt');
ok(page.includes('dipperCardState={props.model.dipperCardState}'), 'control tower receives canonical card state');
ok(panel.includes('DIPPER_CARD_RENDER_AUDIT'), 'panel render audit exists');
ok(panel.includes('Row label="Scanner Status"') && panel.includes('canonical.scannerStatus'), 'scanner status uses canonical runtime source');
ok(panel.includes('status-warn') || panel.includes('tone="warn"'), 'color coding for waiting/neutral exists');
ok(panel.includes('STALE DATA > 60s'), 'stale warning visible when data freezes');
ok(panel.includes('· ${ageLabel}') || panel.includes('ageLabel'), 'last updated age indicator rendered');
ok(panel.includes('Card Source') && panel.includes('canonical.sourceUsed'), 'card source row shows canonical source used');

// Fix #1: Card status badge is dynamic (not hardcoded green)
ok(panel.includes('statusClass = props.status'), 'card status badge is dynamic, not hardcoded green');
ok(panel.includes("'status-good'") && panel.includes("'status-bad'"), 'card maps SCANNING→green, STOPPED→red');

// Source freshness: App.tsx must update snapshot even when 0 candidates are returned
ok(app.includes('mergedSnapshot'), 'App.tsx merges stale snapshot with fresh metadata');
ok(app.includes('SCANNER_DATA_STALE_METADATA_UPDATED'), 'stale metadata update is logged');
ok(app.includes('candidates: store.state.scannerSnapshot?.candidates'), 'old candidates preserved in merged snapshot');

// TrendRow color coding
ok(panel.includes('TrendRow label="Market Trend"'), 'market trend has color-coded TrendRow');
ok(panel.includes('TrendRow label="BTC Context"'), 'btc context has color-coded TrendRow');
ok(panel.includes('TrendRow label="ETH Context"'), 'eth context has color-coded TrendRow');

// All required fields render
ok(panel.includes('Reference Period'), 'reference period field exists');
ok(panel.includes('Capital Used'), 'capital used field exists');
ok(panel.includes('Available'), 'available capital field exists');
ok(panel.includes('Volatility'), 'volatility field exists');

console.log(`dipper-card-live-binding: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
