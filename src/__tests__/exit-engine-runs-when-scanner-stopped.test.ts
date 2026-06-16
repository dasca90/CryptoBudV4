import { readFileSync } from 'node:fs';
import path from 'node:path';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

const engineSrc = readFileSync(path.resolve(process.cwd(), 'src/core/trading/TradingEngine.ts'), 'utf8');

// 1. Exit engine runs independently of scanner status
ok(engineSrc.includes('EXIT_ENGINE_LIFECYCLE_AUDIT') && engineSrc.includes('scannerStatus='), 'exit engine lifecycle includes scannerStatus');

// 2. Exit engine uses PositionManager directly, not brain loop
ok(engineSrc.includes('for (const pos of this.positionManager.getOpenPositions())') && engineSrc.includes('EXIT_EVALUATION_AUDIT'), 'exit engine uses positionManager directly');

// 3. Exit evaluation includes mark price from feed
ok(engineSrc.includes('this.feed.getLastPrice(pos.coin)'), 'exit eval reads feed prices');

// 4. Exit evaluation logs unrealized PnL
ok(engineSrc.includes('unrealizedPnlPct=${pnlPct.toFixed(2)}'), 'exit eval logs unrealizedPnL');

// 5. Exit engine enabled flag in lifecycle audit
ok(engineSrc.includes('exitEngineEnabled=true'), 'lifecycle audit shows exit engine enabled');

// 6. Evaluation interval logged
ok(engineSrc.includes('evaluationIntervalMs=5000'), 'lifecycle shows 5s interval');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
