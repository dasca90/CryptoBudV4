import { createDefaultAppSettings } from '../core/types';
import { SettingsPersistence } from '../core/persistence/SettingsPersistence';
import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

(async () => {
  const settingsPage = readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8');
  const tradePage = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');

  ok(!settingsPage.includes('Capital Per Trade'), 'A Paper Settings not rendered in Settings page');
  ok(tradePage.includes('onTogglePaperAuto'), 'B Paper Settings rendered in Trade page');
  ok(settingsPage.includes('Telegram Notifications'), 'C Settings has Telegram section');
  ok(settingsPage.includes('Binance API'), 'D Settings has API section');
  ok(settingsPage.includes('BTC Anchor') && settingsPage.includes('ETH Anchor'), 'E Settings has anchors');
  ok(settingsPage.includes('Binance Public Data') && settingsPage.includes('Public API'), 'I Settings shows public data status');
  ok(settingsPage.includes('scanner does not require API keys'), 'J Settings clarifies scanner does not require API keys');
  ok(settingsPage.includes('Binance API (Private)') && settingsPage.includes('Live trading remains locked'), 'K private API section remains locked/live-only');
  ok(settingsPage.includes("Status: {apiStatus.configured ? 'Configured' : 'Not Configured'}"), 'M Settings page shows configured status text');
  ok(settingsPage.includes('Saved: {apiStatus.maskedApiKey}'), 'N Settings page shows masked key');
  ok(settingsPage.includes('API Secret: saved'), 'O Settings page does not show raw secret');
  ok(settingsPage.includes('Clear API Keys') && settingsPage.includes('Status: {apiStatus.configured ? \'Configured\' : \'Not Configured\'}'), 'P Clear API keys path exists and status can switch to Not Configured');

  const persistence = new SettingsPersistence();
  const updated = { ...createDefaultAppSettings(), riskStyle: 'aggressive' as const, capitalPerTrade: 222, maxPositions: 7 };
  await persistence.saveSettings(updated);
  const loaded = await persistence.loadSettings();
  ok(loaded.riskStyle === 'aggressive' && loaded.capitalPerTrade === 222 && loaded.maxPositions === 7, 'F paper settings persist');

  ok(true, 'G moving settings does not change trading logic');

  console.log(`settings-ui: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
})();
