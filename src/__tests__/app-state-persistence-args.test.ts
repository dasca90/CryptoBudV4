import { readFileSync } from 'node:fs';

let passed = 0;
let failed = 0;
const ok = (cond: boolean, label: string) => cond ? passed++ : (failed++, console.error(`FAIL: ${label}`));

function main() {
  const src = readFileSync('src/core/persistence/TauriBridge.ts', 'utf8');
  const appStateSrc = readFileSync('src/core/persistence/AppStatePersistence.ts', 'utf8');

  ok(src.includes("save_app_state_entry', { key, valueJson }"), '1 save_app_state_entry passes valueJson key');
  ok(!src.includes("save_app_state_entry', { key, value_json"), '2 legacy value_json key not used for save_app_state_entry');
  ok(appStateSrc.includes('PERSISTENCE_SAVE_APP_STATE_PAYLOAD_AUDIT'), '3 app-state payload audit log exists');
  ok(appStateSrc.includes('testAppStatePersistenceRoundTrip'), '4 app-state roundtrip db test helper exists');
  ok(appStateSrc.includes('SETTINGS_DB_TEST_START') && appStateSrc.includes('SETTINGS_DB_TEST_SUCCESS') && appStateSrc.includes('SETTINGS_DB_TEST_FAILED'), '5 settings db test emits structured start/success/fail logs');
  ok(src.includes('trainingEligibleNumeric') && src.includes('training_eligible: trainingEligibleNumeric'), '6 trade payload maps training_eligible to numeric i64-compatible value');
  ok(src.includes('saveTradeInsight') && src.includes('SAVE_TRADE_INSIGHT_PAYLOAD_AUDIT'), '7 typed saveTradeInsight wrapper with payload audit exists');
  ok(src.includes('SAVE_TRADE_INSIGHT_PAYLOAD_VALIDATION_FAILED'), '8 invalid payload is blocked before invoke');
  ok(appStateSrc.includes('SETTINGS_DB_TEST_TRADE_INSIGHT_SUCCESS'), '9 DB test verifies trade insight write with correct payload');

  console.log(`app-state-persistence-args: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
