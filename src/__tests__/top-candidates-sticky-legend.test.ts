import { readFileSync } from 'node:fs';

let p = 0;
let f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

const src = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');

ok(src.includes("position: 'sticky'") && src.includes('Conf = confidence %'), '1 top legend/info bar is sticky and visible inside card');
ok(src.includes('table-scroll-both top-candidates-scroll') && src.includes("flex: 1"), '2 candidate list remains internal scroll region');
ok(src.indexOf('Conf = confidence %') < src.indexOf('table-scroll-both top-candidates-scroll'), '3 legend is rendered above scroll list');
ok(!src.includes('`r`n'), '4 no injected raw escape fragments remain in UI text');
ok(src.includes('onClick={() => props.onSelectSymbol(c.symbol)}'), '5 row click/select behavior preserved');

console.log(`top-candidates-sticky-legend: ${p} passed, ${f} failed`);
if (f > 0) process.exit(1);
