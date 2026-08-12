import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const scanner = readFileSync(resolve(root, 'src/core/scanner/MarketScanner.ts'), 'utf8');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const tradePage = readFileSync(resolve(root, 'src/ui/pages/TradePage.tsx'), 'utf8');
const tradeV4Page = readFileSync(resolve(root, 'src/components/trade-v4/TradeV4Page.tsx'), 'utf8');
const parameters = readFileSync(resolve(root, 'src/components/trade-v4/TradingParametersCard.tsx'), 'utf8');

assert.equal(scanner.includes('buildUnicornCandidates'), false, 'scanner must not build Unicorn candidates');
assert.equal(scanner.includes('setUnicornHunterSettings'), false, 'scanner must not expose Unicorn settings');
assert.equal(scanner.includes('revalidateUnicornWatchlist'), false, 'scanner must not run a Unicorn watch loop');
assert.equal(app.includes('setUnicornHunterSettings'), false, 'app must not wire Unicorn settings');
assert.equal(tradePage.includes('setUnicornHunterSettings'), false, 'trade page must not wire Unicorn settings');
assert.equal(tradeV4Page.includes('UnicornRadarCard'), false, 'trade UI must not render Unicorn Radar');
assert.equal(parameters.includes('Unicorn Hunter'), false, 'trade settings must not expose Unicorn controls');
assert.equal(existsSync(resolve(root, 'src/core/unicorn/UnicornScoreEngine.ts')), false, 'Unicorn score engine must be removed');

console.log('V6 Unicorn retirement tests passed');
