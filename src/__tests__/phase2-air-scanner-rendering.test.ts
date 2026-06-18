import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_GRAPHICS_QUALITY, getGraphicsQualityConfig, normalizeGraphicsQuality } from '../features/air-scanner-lab/state/airScannerVisualState';
import { getSpatialCollisionPairs, type SpatialCollisionPoint } from '../features/air-scanner-lab/components/ScannerScene';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

assert.equal(DEFAULT_GRAPHICS_QUALITY, 'balanced', 'graphics quality defaults to Balanced');
assert.equal(normalizeGraphicsQuality('medium'), 'balanced', 'legacy medium quality migrates to Balanced');
assert.equal(normalizeGraphicsQuality('ultra'), 'high', 'legacy ultra quality migrates to High');
assert.equal(normalizeGraphicsQuality('bad-value'), 'balanced', 'unknown quality falls back to Balanced');

const low = getGraphicsQualityConfig('low');
const balanced = getGraphicsQualityConfig('balanced');
const high = getGraphicsQualityConfig('high');
assert.equal(low.bloom, false, 'Low disables bloom');
assert.equal(balanced.bloom, true, 'Balanced keeps reduced bloom');
assert.ok(balanced.bloomIntensity < high.bloomIntensity, 'Balanced bloom is reduced versus High');
assert.ok(low.dpr[1] < balanced.dpr[1] && balanced.dpr[1] < high.dpr[1], 'DPR scales low < balanced < high');
assert.equal(low.useCheapOrbMaterial, true, 'Low uses cheaper orb material');
assert.equal(high.useCheapOrbMaterial, false, 'High allows full orb material');

const particleTrail = read('src/features/air-scanner-lab/components/ParticleTrail.tsx');
assert.ok(particleTrail.includes('<instancedMesh'), 'ParticleTrail uses InstancedMesh architecture');
assert.ok(!particleTrail.includes('offsets.map((offset, index) =>') && !particleTrail.includes('<mesh key={`${offset.phase}-${index}`}'), 'ParticleTrail no longer renders one mesh per particle');
assert.ok(particleTrail.includes('setMatrixAt'), 'ParticleTrail updates instance matrices per frame');

const ambientParticles = read('src/features/air-scanner-lab/components/AmbientScannerParticles.tsx');
assert.ok(ambientParticles.includes('<instancedMesh'), 'AmbientScannerParticles uses InstancedMesh architecture');
assert.ok(ambientParticles.includes('setMatrixAt'), 'AmbientScannerParticles updates instance matrices per frame');
assert.ok(!ambientParticles.includes('particles.map((particle, index) =>'), 'AmbientScannerParticles no longer renders one mesh per ambient particle');

const nearbyPoints: SpatialCollisionPoint[] = [
  { x: 0, y: 0, z: 0 },
  { x: 0.2, y: 0, z: 0.1 },
  { x: 7, y: 0, z: 7 },
  { x: 7.25, y: 0, z: 7.1 },
  { x: 14, y: 0, z: 14 },
];
const pairs = getSpatialCollisionPairs(nearbyPoints, 1);
assert.ok(pairs.some(([a, b]) => a === 0 && b === 1), 'spatial partition includes nearby first pair');
assert.ok(pairs.some(([a, b]) => a === 2 && b === 3), 'spatial partition includes nearby second pair');
assert.ok(!pairs.some(([a, b]) => a === 0 && b === 4), 'spatial partition skips distant pair');
assert.ok(pairs.length < (nearbyPoints.length * (nearbyPoints.length - 1)) / 2, 'spatial partition reduces pair checks versus brute force');

const scannerScene = read('src/features/air-scanner-lab/components/ScannerScene.tsx');
assert.ok(scannerScene.includes('GRAPHICS_PERFORMANCE_AUDIT'), 'ScannerScene emits graphics performance telemetry');
assert.ok(scannerScene.includes('THREE_D_RENDER_LOOP_AUDIT'), 'ScannerScene emits render loop telemetry');
assert.ok(scannerScene.includes('GRAPHICS_EFFECT_COST_AUDIT'), 'ScannerScene emits effect cost telemetry');
assert.ok(scannerScene.includes('PERFORMANCE_MODE_RECOMMENDATION'), 'ScannerScene emits performance recommendations');
assert.ok(scannerScene.includes('IS_DEV &&'), 'graphics telemetry is dev-gated');

const productionPreview = read('src/features/air-scanner-lab/AirScannerProductionPreview.tsx');
assert.ok(productionPreview.includes('quality?: AirScannerQuality') && productionPreview.includes('normalizeGraphicsQuality(props.quality ?? storedQuality)'), 'production preview accepts persisted graphics quality from Trade V4');

const tradeV4Page = read('src/components/trade-v4/TradeV4Page.tsx');
assert.ok(tradeV4Page.includes('GRAPHICS_QUALITY_STORAGE_KEY') && tradeV4Page.includes('setGraphicsQuality'), 'Trade V4 exposes persisted graphics quality control');
assert.ok(tradeV4Page.includes('<option value="low">Low</option>') && tradeV4Page.includes('<option value="balanced">Balanced</option>') && tradeV4Page.includes('<option value="high">High</option>'), 'Trade V4 graphics quality supports Low/Balanced/High');
assert.ok(tradeV4Page.includes('quality={graphicsQuality}'), 'Trade V4 passes graphics quality into 3D production preview');

for (const file of [
  'src/core/scanner/MarketScanner.ts',
  'src/core/scanner/ScannerBrainService.ts',
  'src/core/trading/TradingEngine.ts',
]) {
  const src = read(file);
  assert.ok(!src.includes('GRAPHICS_PERFORMANCE_AUDIT'), `${file} was not touched for graphics telemetry`);
  assert.ok(!src.includes('GRAPHICS_QUALITY_STORAGE_KEY'), `${file} has no graphics quality persistence leakage`);
}

console.log('phase2-air-scanner-rendering.test.ts passed');
