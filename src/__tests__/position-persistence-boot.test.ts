import { Journal } from '../core/persistence/Journal';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string): void { this.map.set(key, value); }
  removeItem(key: string): void { this.map.delete(key); }
  clear(): void { this.map.clear(); }
}

async function main() {
  const memoryStorage = new MemoryStorage();
  (globalThis as any).localStorage = memoryStorage;

  const journal = new Journal();
  const primaryKey = 'cryptobud_v4:open_positions_primary';
  const backupKey = 'cryptobud_v4:open_positions_critical';

  // 1) writes blocked before hydration
  await journal.saveOpenPosition('t1', 'SKYUSDT', JSON.stringify({ coin: 'SKYUSDT' }), undefined);
  ok(memoryStorage.getItem(primaryKey) === null, '1 write blocked before hydration (primary unchanged)');
  ok(memoryStorage.getItem(backupKey) === null, '2 write blocked before hydration (backup unchanged)');

  // 2) critical backup restore when primary empty
  const backupRows = [{ trade_id: 't2', symbol: 'DOGEUSDT', position_json: JSON.stringify({ coin: 'DOGEUSDT' }), buy_snapshot_json: null }];
  memoryStorage.setItem(primaryKey, JSON.stringify([]));
  memoryStorage.setItem(backupKey, JSON.stringify(backupRows));
  const restored = await journal.loadOpenPositions();
  ok(restored.length === 1 && restored[0].symbol === 'DOGEUSDT', '3 restores open positions from critical backup');

  // 3) writes allowed after hydration
  journal.markOpenPositionsHydrated();
  await journal.saveOpenPosition('t3', 'XLMUSDT', JSON.stringify({ coin: 'XLMUSDT' }), undefined);
  const afterHydration = JSON.parse(memoryStorage.getItem(primaryKey) || '[]');
  ok(afterHydration.some((r: any) => r.symbol === 'XLMUSDT'), '4 write allowed after hydration');

  // 4) snapshot payload is persisted and restorable from open-position storage
  const snapshot = { symbol: 'BNBUSDT', selectedStrategy: 'balanced', tp1: 2, tp2: 4, sl: 1.5 };
  await journal.saveOpenPosition('t4', 'BNBUSDT', JSON.stringify({ coin: 'BNBUSDT', avgEntryPrice: 650 }), JSON.stringify(snapshot));
  const loadedWithSnapshot = await journal.loadOpenPositions();
  const bnbRow = loadedWithSnapshot.find((r) => r.symbol === 'BNBUSDT');
  ok(!!bnbRow?.buy_snapshot_json, '5 open position storage keeps buy_snapshot_json for new positions');
  ok((bnbRow?.buy_snapshot_json || '').includes('"selectedStrategy":"balanced"'), '6 buy_snapshot_json keeps snapshot content for restore');

  console.log(`position-persistence-boot: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
