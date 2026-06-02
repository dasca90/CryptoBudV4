import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const panel = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');
const css = readFileSync('src/components/trade-v4/trade-v4.css', 'utf8');
const page = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');

ok(panel.includes('top-candidates-scrollbar-top') && panel.includes('topScrollbarRef'), '1 top horizontal scrollbar exists and is referenced');
ok(panel.includes('syncFromWrap') && panel.includes('syncFromTop'), '2 top and body horizontal scroll are synchronized');
ok(panel.includes('top-candidates-columns-sticky'), '3 columns header row has sticky class');
ok(panel.includes('top-candidates-legend-sticky'), '4 legend/info row has sticky class');
ok(css.includes('.top-candidates-scrollbar-top') && css.includes('position: sticky'), '5 top scrollbar is sticky in CSS');
ok(css.includes('.top-candidates-columns-sticky') && css.includes('top: 10px'), '6 columns header is sticky below top scrollbar');
ok(css.includes('.top-candidates-scroll') && css.includes('overscroll-behavior: contain'), '7 scroll remains internal to top candidates container');
ok(panel.includes("viewMode === 'compact'") && panel.includes("viewMode === 'detailed'"), '8 compact/detailed mode still wired');
ok(panel.includes('setSourceFilter') && panel.includes('<select value={sourceFilter}'), '9 filter dropdown still wired');
ok(page.includes('data-testid="market-groups-workspace"') && page.indexOf('data-testid="market-groups-workspace"') > page.indexOf('data-testid="top-candidates-panel"'), '10 Market Groups stays below Top Candidates (no overlap)');

console.log(`top-candidates-sticky-scrollbar: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
