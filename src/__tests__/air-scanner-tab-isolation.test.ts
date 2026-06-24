import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

const uiStore = read('src', 'state', 'ui-store.ts');
const mainTabs = read('src', 'components', 'layout', 'MainTabs.tsx');
const app = read('src', 'App.tsx');
const tradeV4 = read('src', 'components', 'trade-v4', 'TradeV4Page.tsx');
const airScannerPage = read('src', 'ui', 'pages', 'AirScannerPage.tsx');
const airScanner3d = read('src', 'components', 'trade-v4', 'AirScanner3D.tsx');
const airScannerCanvas = read('src', 'features', 'air-scanner-lab', 'AirScannerCanvas.tsx');
const memoryLifecycle = read('src', 'core', 'diagnostics', 'memoryLifecycle.ts');
const pkg = read('package.json');

assert.ok(uiStore.includes("'air-scanner'"), 'MainTab includes isolated air-scanner tab');
assert.ok(mainTabs.includes("{ key: 'air-scanner', label: '3D Scanner' }"), 'MainTabs exposes 3D Scanner tab');
assert.ok(app.includes("case 'air-scanner':") && app.includes('<AirScannerPage engine={engine} store={store} />'), 'App renders AirScannerPage only for 3D Scanner tab');

assert.equal(tradeV4.includes('import { AirScanner3D }'), false, 'TradeV4Page does not import AirScanner3D');
assert.equal(tradeV4.includes('<AirScanner3D'), false, 'TradeV4Page does not mount AirScanner3D');
assert.equal(tradeV4.includes('<AirScannerProductionPreview'), false, 'TradeV4Page does not mount WebGL scanner preview');
assert.equal(tradeV4.includes('data-testid="air-scanner-3d-panel"'), false, 'Trade tab no longer owns 3D panel test id');
assert.ok(tradeV4.includes('data-testid="trade-scanner-status-panel"'), 'Trade tab shows lightweight 2D scanner status');
assert.ok(tradeV4.includes('visualScannerMounted=false'), 'Trade tab performance audit reports visual scanner unmounted');

assert.ok(airScannerPage.includes('lazy(() => import'), 'AirScannerPage lazy-loads 3D code');
assert.ok(airScannerPage.includes('<AirScanner3DView') && airScannerPage.includes('<AirScannerProductionPreview'), 'AirScannerPage owns legacy and lab visual renderers');
assert.ok(airScannerPage.includes("document.addEventListener('visibilitychange'"), 'AirScannerPage pauses by visibility');
assert.ok(airScannerPage.includes("document.removeEventListener('visibilitychange'"), 'AirScannerPage cleans visibility listener');
assert.ok(airScannerPage.includes('active={animationFrameActive}'), 'legacy 3D animation runs only when tab/page visible and scanner running');
assert.ok(airScannerPage.includes('AIR_SCANNER_TAB_STATE_AUDIT'), 'AirScannerPage emits tab state audit');
assert.equal(airScannerPage.includes('BinancePublicClient'), false, 'visual page does not call Binance client');
assert.equal(airScannerPage.includes('fetch('), false, 'visual page does not fetch market data');
assert.equal(airScannerPage.includes('executeManualBuy'), false, 'visual page does not execute buys');
assert.equal(airScannerPage.includes('executeManualSell'), false, 'visual page does not execute sells');
assert.equal(airScannerPage.includes('submitOrder'), false, 'visual page does not submit orders');

assert.ok(airScanner3d.includes('AIR_SCANNER_CLEANUP_AUDIT'), 'legacy 3D scanner emits cleanup audit');
assert.ok(airScannerCanvas.includes('AIR_SCANNER_CLEANUP_AUDIT'), 'WebGL scanner emits cleanup audit');
assert.ok(airScannerCanvas.includes('forceContextLoss'), 'WebGL scanner releases context when possible');
assert.ok(memoryLifecycle.includes('airScannerMounted') && memoryLifecycle.includes('MEMORY_HEALTH_AUDIT'), 'memory watchdog includes airScannerMounted');
assert.ok(app.includes("const airScannerMounted = activeTab === 'air-scanner'") && app.includes('airScannerMounted,'), 'watchdog reports scanner mounted only on isolated tab');
assert.ok(app.includes('airScannerObjectCount: airScannerMounted') && app.includes(': 0'), 'watchdog reports zero scanner objects on Trade tab');
assert.ok(pkg.includes('test:air-scanner-tab-isolation'), 'package exposes isolation regression test');

console.log('air-scanner-tab-isolation tests passed');
