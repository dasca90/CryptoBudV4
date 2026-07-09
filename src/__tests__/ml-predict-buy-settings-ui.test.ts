import { strict as assert } from 'assert';
import { readFileSync } from 'fs';
import { DEFAULT_ML_PREDICT_BUY_SETTINGS, loadMLPredictBuySettings, normalizeMLPredictBuySettings, saveMLPredictBuySettings, setMLStore } from '../core/ml/ml-brain-store';

const page = readFileSync('src/ui/pages/MLLabPage.tsx', 'utf8');
assert(page.includes('ML Predict / Buy'), 'ML Lab exposes ML Predict / Buy card');
assert(page.includes('Predict Only'), 'ML Lab exposes Predict Only mode');
assert(page.includes('Suggest BUY'), 'ML Lab exposes Suggest BUY mode');
assert(page.includes('Auto Buy'), 'ML Lab exposes Auto Buy mode');
assert(page.includes('Rows used below Auto Buy threshold'), 'ML Lab warns when AUTO_BUY rows are too low');
assert(page.includes('Low sample size. ML Predict / Buy is experimental.'), 'ML Lab shows low sample warning');
assert(!page.includes('AUTO_BUY_DEMO'), 'ML Lab does not introduce DEMO-only Auto Buy wording');
assert(!page.includes('AUTO_BUY_LIVE_LOCKED'), 'ML Lab does not introduce LIVE-locked Auto Buy wording');

const memory = new Map<string, string>();
setMLStore({
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => { memory.set(key, value); },
  removeItem: (key) => { memory.delete(key); },
});

assert.deepEqual(loadMLPredictBuySettings(), DEFAULT_ML_PREDICT_BUY_SETTINGS, 'missing settings default to fail-closed OFF');

const invalid = normalizeMLPredictBuySettings({
  mlPredictBuyEnabled: true,
  mlPredictBuyMode: 'AUTO_BUY_DEMO' as any,
});
assert.equal(invalid.mlPredictBuyMode, 'OFF', 'invalid mode normalizes to OFF');
assert.equal(invalid.mlPredictBuyEnabled, false, 'invalid mode disables ML Predict / Buy');

saveMLPredictBuySettings({
  ...DEFAULT_ML_PREDICT_BUY_SETTINGS,
  mlPredictBuyEnabled: true,
  mlPredictBuyMode: 'AUTO_BUY',
});
const loaded = loadMLPredictBuySettings();
assert.equal(loaded.mlPredictBuyMode, 'AUTO_BUY', 'valid settings persist mode');
assert.equal(loaded.mlPredictBuyEnabled, true, 'valid settings persist enabled flag');
assert.equal(loaded.minTrainingRowsForAutoBuy, 100, 'Auto Buy row threshold persists globally');

console.log('ml-predict-buy-settings-ui tests passed');
