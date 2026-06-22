import { strict as assert } from 'node:assert';
import { logger } from '../utils/logger';
import { MarketScanner } from '../core/scanner/MarketScanner';
import { MarketDataFeed } from '../utils/MarketDataFeed';
import { PositionManager } from '../core/positions/PositionManager';
import { buildAirScannerMemoryAuditSnapshot } from '../features/air-scanner-lab/utils/airScannerMemoryAudit';

function writeAuditBurst(prefix: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    logger.info(`${prefix}_AUDIT iteration=${index}`);
  }
}

async function main() {
  logger.clear();
  logger.setMaxLogs(2000);
  logger.setMaxInternalAuditLogs(5000);

  for (const hours of [12, 24, 48]) {
    writeAuditBurst(`SOAK_${hours}H_VISIBLE_AND_INTERNAL`, hours * 140);
    assert.ok(logger.getStats().currentLogCount <= 2000, `${hours}h visible log ring remains bounded`);
    assert.ok(logger.getStats().currentInternalAuditCount <= 5000, `${hours}h internal audit ring remains bounded`);
  }

  const scanner = new MarketScanner();
  for (let i = 0; i < 100; i += 1) scanner.startCandidateRevalidationLoop();
  assert.equal(scanner.getRuntimeMemoryStats().revalidationLoopActive, true, 'duplicate scanner revalidation starts coalesce to one loop');
  scanner.stopCandidateRevalidationLoop();
  assert.equal(scanner.getRuntimeMemoryStats().revalidationLoopActive, false, 'scanner revalidation loop stops cleanly');
  scanner.destroy();

  const feed = MarketDataFeed.getInstance();
  const unsubs: Array<() => void> = [];
  for (let i = 0; i < 25; i += 1) {
    unsubs.push(feed.subscribe('SOAKUSDT', () => {}));
  }
  assert.equal(feed.getActiveIntervalCount(), 1, 'many listeners for one symbol share one market-data interval');
  assert.equal(feed.getActiveSubscriptionCount(), 25, 'all listeners are tracked');
  for (const unsub of unsubs) unsub();
  assert.equal(feed.getActiveSubscriptionCount(), 0, 'market-data listeners unsubscribe');
  assert.equal(feed.getActiveIntervalCount(), 0, 'market-data interval is cleared after last unsubscribe');

  const positions = new PositionManager();
  positions.addPosition('SOAKUSDT', {
    coin: 'SOAKUSDT',
    quantity: 1,
    avgEntryPrice: 100,
    currentPrice: 100,
    pnl: 0,
    pnlPercent: 0,
    unrealizedPnlPercent: 0,
    mode: 'AUTO',
    openedAt: Date.now(),
    highestPrice: 100,
    highestPriceSinceTp: 100,
  } as any);
  for (let i = 0; i < 500; i += 1) {
    positions.updatePosition('SOAKUSDT', { currentPrice: 100 + i * 0.01 } as any);
  }
  const positionUpdateLogs = logger.getLogs().filter((entry) => entry.message.startsWith('POSITION_MANAGER_UPDATE: SOAKUSDT'));
  assert.ok(positionUpdateLogs.length <= 1, 'position update audit is rate-limited during compressed price ticks');

  const scene = {
    traverse(visitor: (node: unknown) => void) {
      visitor({ isMesh: true, geometry: {}, material: {} });
    },
  };
  const air = buildAirScannerMemoryAuditSnapshot({
    root: scene,
    renderer: { info: { memory: { geometries: 1, textures: 0 } } },
    lightningEffectCount: 0,
    pulseImpactCount: 0,
    rafActive: true,
  });
  assert.equal(air.airScannerMeshCount, 1, 'air scanner object audit counts scene objects');
  assert.ok(air.airScannerGeometryCount <= 1, 'air scanner geometry count remains bounded in synthetic scene');

  console.log('overnight-soak-memory.test.ts passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
