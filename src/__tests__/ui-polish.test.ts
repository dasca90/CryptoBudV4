import { readFileSync } from 'node:fs';

let p = 0, f = 0;
const ok = (c: boolean, m: string) => { if (c) p++; else { f++; console.error('FAIL', m); } };

(() => {
  const trade = readFileSync('src/ui/pages/TradePage.tsx', 'utf8');
  const settings = readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8');
  const journal = readFileSync('src/ui/pages/JournalPage.tsx', 'utf8');
  const ml = readFileSync('src/ui/pages/MLLabPage.tsx', 'utf8');
  const logs = readFileSync('src/ui/pages/LogsPage.tsx', 'utf8');
  const tradeV4 = readFileSync('src/components/trade-v4/TradeV4Page.tsx', 'utf8');
  const topCand = readFileSync('src/components/trade-v4/TopCandidatesPanel.tsx', 'utf8');

  ok(tradeV4.includes('SelectedCoinInspector') && tradeV4.includes('AirScanner3D'), 'A TradeV4 core panels render');
  ok(!settings.includes('PAPER TRADING'), 'B Paper settings not in Settings page');
  ok(topCand.includes('Status') && topCand.includes('Strategy'), 'D Watch Pool table shows Status and Strategy columns');
  ok(topCand.includes('No BUY —'), 'E No BUY summary appears');
  ok(trade.includes('scalperStartDisabled'), 'F Watchlist disabled state exists');
  ok(journal.includes('Winners') && journal.includes('Losers') && journal.includes('Training eligible'), 'H Journal filters exist');
  ok(ml.includes('ML cannot force BUY. ML can only WAIT/BLOCK/reduce confidence.'), 'I ML warning exists');
  ok(logs.includes('SCANNER') && logs.includes('RISK') && logs.includes('TELEGRAM'), 'J Logs category filters exist');
  ok(settings.includes('Binance API') && settings.includes('Telegram Notifications') && settings.includes('BTC Anchor') && settings.includes('Reset ML Brain'), 'K Settings keeps API/Telegram/Anchors/Reset');
  ok(settings.includes('Live trading is disabled by default') || settings.includes('Live remains locked'), 'L Live start remains safety-gated');
  ok(journal.includes('No trades yet.') && logs.includes('No logs yet.'), 'M Empty states render');

  console.log(`ui-polish: ${p} passed, ${f} failed`);
  if (f > 0) process.exit(1);
})();

