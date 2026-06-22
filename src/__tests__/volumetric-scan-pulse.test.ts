import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  getPulseDrawCallEstimate,
  getScanImpactColor,
  getVolumetricScanPulseFrame,
  resolveScanPulseMode,
  updateSpherePulseImpacts,
  type PulseSphereFrame,
} from '../features/air-scanner-lab/components/VolumetricScanPulse';

const start = getVolumetricScanPulseFrame(0.1, true);
const mid = getVolumetricScanPulseFrame(1.7, true);
const end = getVolumetricScanPulseFrame(3.2, true);
assert.ok(mid.radius > start.radius, 'pulse radius expands over time');
assert.ok(end.radius > mid.radius, 'pulse keeps expanding until fade-out');

const frames: PulseSphereFrame[] = [
  { symbol: 'WAITUSDT', state: 'wait', position: [3.1, 1.1, 0], opacity: 1 },
  { symbol: 'BUYUSDT', state: 'buy_ready', position: [6.6, 1.1, 0], opacity: 1 },
];
const pulse = { ...getVolumetricScanPulseFrame(1.2, true), pulseId: 7, radius: 3.08, active: true };
const firstHit = updateSpherePulseImpacts({ frames, pulse, previous: new Map(), nowMs: 1_000, tolerance: 0.08 });
assert.equal(firstHit.hitCount, 1, 'sphere hit triggers when pulse reaches radius');
assert.equal(firstHit.impacts.get('WAITUSDT')?.pulseId, 7, 'hit stores pulse id');
assert.equal(firstHit.impacts.get('WAITUSDT')?.impactState, 'scannedWait', 'wait sphere gets wait impact state');
assert.equal(getScanImpactColor('scannedBuyReady'), '#ff62ff', 'buy-ready impact uses electric highlight');

const repeatedHit = updateSpherePulseImpacts({ frames, pulse, previous: firstHit.impacts, nowMs: 1_050, tolerance: 0.08 });
assert.equal(repeatedHit.hitCount, 0, 'same pulse does not retrigger sphere impact');
assert.ok((repeatedHit.impacts.get('WAITUSDT')?.intensity ?? 0) < 1, 'impact intensity decays over time');

const nextPulseHit = updateSpherePulseImpacts({ frames, pulse: { ...pulse, pulseId: 8 }, previous: repeatedHit.impacts, nowMs: 1_100, tolerance: 0.08 });
assert.equal(nextPulseHit.hitCount, 1, 'new pulse can hit the same sphere once');

assert.equal(resolveScanPulseMode('low').mode, 'low_ring', 'low quality uses simple ring');
assert.equal(resolveScanPulseMode('balanced').mode, 'balanced_volume', 'balanced quality uses volumetric ring');
assert.equal(resolveScanPulseMode('high').mode, 'high_volume', 'high quality enables enhanced effects');
assert.deepEqual(resolveScanPulseMode('high', 30), { mode: 'balanced_volume', degradedForPerformance: true }, 'high degrades to balanced under low FPS');
assert.deepEqual(resolveScanPulseMode('balanced', 30), { mode: 'low_ring', degradedForPerformance: true }, 'balanced degrades to low under low FPS');
assert.ok(getPulseDrawCallEstimate('balanced_volume', 4) < 20, 'balanced draw call estimate stays lightweight');

assert.deepEqual(frames[0], { symbol: 'WAITUSDT', state: 'wait', position: [3.1, 1.1, 0], opacity: 1 }, 'pulse visual detection does not mutate candidate/sphere input');

const scannerScene = readFileSync('src/features/air-scanner-lab/components/ScannerScene.tsx', 'utf8');
assert.ok(scannerScene.includes('VolumetricScanPulse'), 'scanner scene renders dedicated volumetric pulse component');
assert.ok(scannerScene.includes('SCANNER_PULSE_VISUAL_AUDIT'), 'scanner pulse emits non-spammy visual audit');

for (const file of [
  'src/core/scanner/MarketScanner.ts',
  'src/core/scanner/ExecutionPlanner.ts',
  'src/core/trading/TradingEngine.ts',
  'src/core/strategy-audit/strategy-audit-builder.ts',
]) {
  const src = readFileSync(file, 'utf8');
  assert.equal(src.includes('VolumetricScanPulse'), false, `${file} does not import visual pulse code`);
  assert.equal(src.includes('SCANNER_PULSE_VISUAL_AUDIT'), false, `${file} does not own visual pulse audit`);
}

console.log('volumetric-scan-pulse.test.ts passed');
