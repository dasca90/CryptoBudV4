import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const panel = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
const css = readFileSync('src/components/trade-v4/trade-v4.css', 'utf8');
const page = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');

ok(panel.includes('TOP_CANDIDATES_SCROLL_LAYOUT_AUDIT'), '1 detailed scroll layout audit log exists');
ok(panel.includes('TOP_CANDIDATES_SCROLL_SYNC_WARNING'), '2 scroll sync warning log exists');
ok(panel.includes('requestAnimationFrame') && panel.includes('syncWithRaf'), '3 scroll sync uses requestAnimationFrame guard');
ok(panel.includes('syncSourceRef') && panel.includes("'wrap' | 'top'"), '4 bidirectional sync has source lock');
ok(panel.includes('top-candidates-scrollbar-top') && panel.includes('topScrollbarRef'), '5 top horizontal scrollbar exists and is referenced');
ok(panel.includes('top-candidates-columns-sticky'), '6 columns header row has sticky class');
ok(panel.includes('top-candidates-legend-sticky'), '7 legend/info row has sticky class');
ok(css.includes('.top-candidates-scrollbar-top') && css.includes('position: sticky'), '8 top scrollbar is sticky in CSS');
ok(css.includes('.top-candidates-columns-sticky') && css.includes('top: 10px'), '9 columns header is sticky below top scrollbar');
ok(css.includes('.top-candidates-scroll') && css.includes('overscroll-behavior: contain'), '10 scroll remains internal to top candidates container');
ok(panel.includes("viewMode === 'compact'") && panel.includes("viewMode === 'detailed'"), '11 compact/detailed mode still wired');
ok(panel.includes('setSourceFilter') && panel.includes('<select value={sourceFilter}'), '12 filter dropdown still wired');
ok(page.includes('data-testid="market-groups-workspace"') && page.indexOf('data-testid="market-groups-workspace"') > page.indexOf('data-testid="top-candidates-panel"'), '13 Market Groups stays below Top Candidates (no overlap)');
ok(page.includes('data-testid="top-candidates-panel"') && page.includes('SELECTED COIN'), '14 selected coin layout remains present');

console.log(`top-candidates-detailed-scroll-sync: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
