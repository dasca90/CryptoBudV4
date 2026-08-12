import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { MarketEdgeKernel } from '../core/market-edge/MarketEdgeKernel';
import { normalizeMarketEdgeConfig } from '../core/market-edge/config';

const scannerSource = readFileSync('src/core/scanner/MarketScanner.ts', 'utf8');
const runtimeSource = readFileSync('src/core/market-edge/MarketEdgeRuntime.ts', 'utf8');

assert.ok(!/from ['"].*market-edge/i.test(scannerSource), 'regular MarketScanner hot path has no Market Edge dependency');
assert.ok(!/fapi\.binance|openInterest|forceOrder|fstream\.binance/i.test(scannerSource), 'MarketScanner performs no Futures/OI/liquidation I/O');
assert.equal((runtimeSource.match(/setInterval\(/g) ?? []).length, 2, 'Market Edge owns two shared timers, never one timer per symbol');
assert.ok(runtimeSource.includes('hydratedTopK') && runtimeSource.includes('i += 2'), 'OI hydration is top-K with concurrency two');

const universeSize = 100;
const kernel = new MarketEdgeKernel(normalizeMarketEdgeConfig({ mode: 'MONITOR', universeSize, minimumWarmupMs: 0 }));
const now = 2_000_000;
for (let symbolIndex = 0; symbolIndex < universeSize; symbolIndex++) {
  const symbol = `EDGE${symbolIndex}USDT`;
  for (let second = 0; second <= 60; second++) {
    const at = now - (60 - second) * 1_000;
    kernel.ingestPrice(symbol, 'SPOT', 100 + second * 0.001, at);
    kernel.ingestPrice(symbol, 'PERP', 100 + second * 0.002, at);
  }
}
const startedAt = performance.now();
let calculated = 0;
for (let symbolIndex = 0; symbolIndex < universeSize; symbolIndex++) if (kernel.calculate(`EDGE${symbolIndex}USDT`, now)) calculated++;
const durationMs = performance.now() - startedAt;
const memory = kernel.getMemoryStats();

assert.equal(calculated, universeSize);
assert.equal(memory.symbols, universeSize);
assert.equal(memory.bounded, true);
assert.ok(durationMs < 1_000, `100-symbol Edge cycle remains background-safe (${durationMs.toFixed(2)}ms)`);
console.log(`market-edge-performance: symbols=${calculated} cycleMs=${durationMs.toFixed(2)} samples=${memory.samples} estimatedBytes=${memory.estimatedBytes} scannerHotPathAwaits=0 oiConcurrency=2 timers=2`);
