import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createDefaultMicroScalperSettings } from '../core/scalper/MicroScalperTypes';
import { loadPersistedScalperSettings, persistScalperSettings } from '../core/scalper/MicroScalperPersistence';
import { disableScalper, enableScalper, evaluateScalpSignal, getMicroScalperState, updateScalperSettings } from '../core/scalper/MicroScalperEngine';

let passed = 0;
let failed = 0;
function ok(cond: boolean, msg: string) { if (cond) { passed++; } else { failed++; console.log('  FAIL: ' + msg); } }
function eq<T>(a: T, b: T, msg: string) { ok(a === b, `${msg} (got=${String(a)} expected=${String(b)})`); }

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
  clear() { this.data.clear(); }
}

async function run() {
  console.log('\n--- Micro Scalper Settings ---');
  const localStorage = new MemoryStorage();
  (globalThis as any).window = { localStorage };

  const defaults = createDefaultMicroScalperSettings();
  eq(defaults.scanEverySec, 5, 'default scanEverySec');
  eq(defaults.pollEverySec, 3, 'default pollEverySec');
  eq(defaults.stalePriceSec, 10, 'default stalePriceSec');
  ok(!('capitalPerScalp' in (defaults as any)), 'capitalPerScalp removed from canonical settings');
  ok(!('cooldownAfterLossMs' in (defaults as any)), 'micro cooldown loss removed from canonical settings');

  updateScalperSettings({ ...defaults, scanEverySec: 1, pollEverySec: 120, stalePriceSec: 120 });
  let st = getMicroScalperState().settings;
  eq(st.scanEverySec, 1, 'scanEverySec accepts 1');
  eq(st.pollEverySec, 120, 'pollEverySec accepts 120');
  eq(st.stalePriceSec, 120, 'stalePriceSec accepts 120');

  updateScalperSettings({ ...st, scanEverySec: 999, pollEverySec: 0, stalePriceSec: -5 });
  st = getMicroScalperState().settings;
  eq(st.scanEverySec, 120, 'scanEverySec clamps to 120');
  eq(st.pollEverySec, 1, 'pollEverySec clamps to 1');
  eq(st.stalePriceSec, 1, 'stalePriceSec clamps to 1');

  persistScalperSettings({ ...st, scanEverySec: 120, pollEverySec: 77, stalePriceSec: 42 });
  const hydrated = loadPersistedScalperSettings();
  eq(hydrated.scanEverySec, 120, 'hydrated scanEverySec keeps user value');
  eq(hydrated.pollEverySec, 77, 'hydrated pollEverySec keeps user value');
  eq(hydrated.stalePriceSec, 42, 'hydrated stalePriceSec keeps user value');

  enableScalper();
  updateScalperSettings({ ...hydrated, stalePriceSec: 1, minVolumeRelative: 0.5, minMomentumPct: 0.1, maxSpreadPct: 1.0 });
  const blockedStale = evaluateScalpSignal({
    symbol: 'ABCUSDT',
    riskGroup: 'high_risk',
    price: 1,
    priceAgeMs: 2500,
    spreadPct: 0.1,
    volumeRelative: 2,
    momentumPct: 2,
  });
  eq(blockedStale, null, 'runtime uses stalePriceSec for freshness blocking');
  disableScalper();
  const blockedDisabled = evaluateScalpSignal({
    symbol: 'XYZUSDT',
    riskGroup: 'very_high_risk',
    price: 1,
    priceAgeMs: 1000,
    spreadPct: 0.05,
    volumeRelative: 5,
    momentumPct: 3,
  });
  eq(blockedDisabled, null, 'disabled scalper does not create executable micro candidate');

  const panelPath = path.resolve(process.cwd(), 'src/components/trade-v4/MicroScalperPanel.tsx');
  const panelSource = readFileSync(panelPath, 'utf8');
  ok(!panelSource.includes('Capital/Trade'), 'Capital/Trade input removed from Micro Scalper UI');
  ok(panelSource.includes('Smart Cooldown: shared with AutoBots'), 'shared cooldown label shown in Micro Scalper UI');

  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

void run();
