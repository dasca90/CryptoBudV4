import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildAirScannerMemoryAuditSnapshot,
  disposeAirScannerRenderLists,
  disposeAirScannerSceneResources,
  formatAirScannerMemoryAudit,
  getAirScannerCleanupStats,
  recordAirScannerCleanup,
  resetAirScannerMemoryAuditForTests,
} from '../features/air-scanner-lab/utils/airScannerMemoryAudit';

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), 'utf8');

function makeScene(nodes: unknown[]) {
  return {
    traverse(visitor: (node: unknown) => void) {
      for (const node of nodes) visitor(node);
    },
  };
}

resetAirScannerMemoryAuditForTests();

const texture = { isTexture: true };
const geometryA = {};
const geometryB = {};
const materialA = { map: texture };
const materialB = {};
const scene = makeScene([
  { isMesh: true, geometry: geometryA, material: materialA },
  { isInstancedMesh: true, geometry: geometryB, material: [materialA, materialB] },
]);
const snapshot = buildAirScannerMemoryAuditSnapshot({
  root: scene,
  renderer: { info: { memory: { geometries: 2, textures: 1 } } },
  lightningEffectCount: 1,
  pulseImpactCount: 4,
  rafActive: true,
});

assert.equal(snapshot.airScannerMeshCount, 2, 'counts mesh and instanced mesh resources');
assert.equal(snapshot.airScannerMaterialCount, 2, 'deduplicates materials across scene nodes');
assert.equal(snapshot.airScannerGeometryCount, 2, 'counts unique geometries');
assert.equal(snapshot.airScannerTextureCount, 1, 'counts texture-like material properties');
assert.equal(snapshot.lightningEffectCount, 1, 'reports lightning effect count');
assert.equal(snapshot.pulseImpactCount, 4, 'reports active pulse impact count');
assert.equal(snapshot.rafActive, true, 'reports RAF/frameloop active state');
assert.ok(formatAirScannerMemoryAudit(snapshot).startsWith('AIR_SCANNER_MEMORY_AUDIT'), 'formats dev memory audit log');

const cleanup = recordAirScannerCleanup(1234);
assert.equal(cleanup.cleanupCount, 1, 'cleanup counter increments');
assert.deepEqual(getAirScannerCleanupStats(), { cleanupCount: 1, lastAirScannerCleanupAt: 1234 }, 'cleanup timestamp is retained');

let renderListsDisposed = 0;
disposeAirScannerRenderLists({ renderLists: { dispose: () => { renderListsDisposed += 1; } } });
assert.equal(renderListsDisposed, 1, 'renderLists dispose hook is called for WebGL renderer cleanup');

let geometryDisposed = 0;
let materialDisposed = 0;
let textureDisposed = 0;
let removedChildren = 0;
disposeAirScannerSceneResources({
  children: [{}],
  remove: (...objects: unknown[]) => { removedChildren += objects.length; },
  traverse(visitor: (node: unknown) => void) {
    visitor({
      geometry: { dispose: () => { geometryDisposed += 1; } },
      material: { map: { isTexture: true, dispose: () => { textureDisposed += 1; } }, dispose: () => { materialDisposed += 1; } },
    });
  },
});
assert.equal(geometryDisposed, 1, 'scene cleanup disposes geometries');
assert.equal(materialDisposed, 1, 'scene cleanup disposes materials');
assert.equal(textureDisposed, 1, 'scene cleanup disposes material textures');
assert.equal(removedChildren, 1, 'scene cleanup removes children from the scene root');

const airScannerCanvas = read('src/features/air-scanner-lab/AirScannerCanvas.tsx');
assert.ok(airScannerCanvas.includes('AirScannerCanvasMemoryLifecycle'), 'Canvas owns WebGL memory lifecycle component');
assert.ok(airScannerCanvas.includes('disposeAirScannerSceneResources(scene)'), 'Canvas cleanup disposes scene resources');
assert.ok(airScannerCanvas.includes('disposeAirScannerRenderLists(gl)'), 'Canvas cleanup disposes renderer renderLists cache');
assert.ok(airScannerCanvas.includes('removeEventListener'), 'Canvas visibility listener is removed on unmount');
assert.equal(airScannerCanvas.includes('dispose={null}'), false, 'Canvas does not opt out of R3F auto-dispose');

const scannerScene = read('src/features/air-scanner-lab/components/ScannerScene.tsx');
assert.ok(scannerScene.includes('formatAirScannerMemoryAudit') && scannerScene.includes('buildAirScannerMemoryAuditSnapshot'), 'ScannerScene emits Air Scanner memory audit telemetry');
assert.ok(scannerScene.includes('velocityRef.current.clear()'), 'ScannerScene clears velocity cache on cleanup');
assert.ok(scannerScene.includes('scanImpactRef.current.clear()'), 'ScannerScene clears pulse impact cache on cleanup');
assert.ok(scannerScene.includes('pulseHitCountRef.current.clear()'), 'ScannerScene clears pulse hit cache on cleanup');
assert.ok(scannerScene.includes('releaseBuyLightningLock'), 'ScannerScene releases lightning locks on cleanup');
assert.ok(scannerScene.includes('document.removeEventListener("visibilitychange"'), 'ScannerScene removes visibility listener on unmount');
assert.equal(scannerScene.includes('scene.add('), false, 'ScannerScene does not manually add unmanaged objects to the scene');
assert.equal(scannerScene.includes('dispose={null}'), false, 'ScannerScene does not opt out of R3F auto-dispose');

for (const file of [
  'src/features/air-scanner-lab/components/CoinOrb.tsx',
  'src/features/air-scanner-lab/components/CoreEnergy.tsx',
  'src/features/air-scanner-lab/components/HolographicGrid.tsx',
  'src/features/air-scanner-lab/components/ParticleTrail.tsx',
  'src/features/air-scanner-lab/components/AmbientScannerParticles.tsx',
  'src/features/air-scanner-lab/components/LightningArc.tsx',
  'src/features/air-scanner-lab/components/VolumetricScanPulse.tsx',
]) {
  const source = read(file);
  assert.equal(source.includes('dispose={null}'), false, `${file} keeps R3F auto-dispose enabled`);
  assert.equal(source.includes('scene.add('), false, `${file} does not add unmanaged scene objects`);
}

const pulse = read('src/features/air-scanner-lab/components/VolumetricScanPulse.tsx');
assert.ok(pulse.includes('Array.from({ length: 34 }'), 'volumetric pulse particles stay fixed-size');
assert.ok(pulse.includes('age > SCAN_PULSE_IMPACT_DURATION_MS'), 'pulse impacts expire by age');

console.log('air-scanner-webgl-memory.test.ts passed');
