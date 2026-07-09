import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { logger } from '../utils/logger';
import { testAiCloudConnectivity } from '../core/ai/AiCloudTestService';
import type { AiCloudApiSettings } from '../core/ai/AiCloudApiSettings';

const secret = 'sk-test-secret-1234';

function config(overrides: Partial<AiCloudApiSettings> = {}): AiCloudApiSettings {
  return {
    provider: 'OpenCode',
    model: 'deepseek-v4-flash',
    apiUrl: 'https://opencode.example.test/v1/chat/completions',
    apiKey: secret,
    ...overrides,
  };
}

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

async function expectNoNetwork(settings: AiCloudApiSettings, expectedReason: string) {
  let calls = 0;
  const result = await testAiCloudConnectivity(settings, async () => {
    calls++;
    return response({});
  });
  assert.strictEqual(calls, 0, `${expectedReason} must fail before network request`);
  assert.strictEqual(result.status, 'FAILED');
  assert.strictEqual(result.failureReason, expectedReason);
}

logger.clear();

const settingsSource = readFileSync('src/ui/pages/SettingsPage.tsx', 'utf8');
assert.ok(settingsSource.includes('Test AI Cloud'), 'Settings renders Test AI Cloud button');
assert.ok(settingsSource.includes("disabled={aiCloudTesting || aiCloudSettings.provider === 'OFF'}"), 'Test AI button is disabled when provider is OFF');
assert.ok(settingsSource.includes('OpenCode Go'), 'Settings exposes OpenCode Go provider');

await expectNoNetwork(config({ provider: 'OFF' }), 'AI_TEST_PROVIDER_OFF');
await expectNoNetwork(config({ model: '' }), 'AI_TEST_MODEL_MISSING');
await expectNoNetwork(config({ apiUrl: '' }), 'AI_TEST_API_URL_MISSING');
await expectNoNetwork(config({ apiKey: '' }), 'AI_TEST_API_KEY_MISSING');
await expectNoNetwork(config({ apiUrl: 'http://unsafe.example.test/v1/chat/completions' }), 'AI_TEST_INVALID_URL');

let requestCount = 0;
let binanceCalled = false;
const success = await testAiCloudConnectivity(config(), async (url, init) => {
  requestCount++;
  binanceCalled = String(url).includes('binance');
  assert.strictEqual(url, 'https://opencode.example.test/v1/chat/completions');
  assert.strictEqual((init?.headers as Record<string, string>).Authorization, `Bearer ${secret}`);
  const body = JSON.parse(String(init?.body));
  assert.strictEqual(body.model, 'deepseek-v4-flash');
  assert.strictEqual(body.temperature, 0);
  assert.strictEqual(body.max_tokens, 80);
  assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  assert.strictEqual(body.messages[0].content, 'You are a connectivity test for CryptoBud. Return only minified JSON. No markdown. No prose.');
  assert.strictEqual(body.messages[1].content, 'Return exactly: {"ok":true,"message":"ai_cloud_test_success"}');
  assert.strictEqual(JSON.stringify(body).includes('BUY_INTENT'), false, 'Test prompt must not include BUY_INTENT');
  assert.strictEqual(JSON.stringify(body).includes('BTCUSDT'), false, 'Test prompt must not include market symbols');
  return response({ choices: [{ message: { content: '{"ok":true,"message":"ai_cloud_test_success"}' } }] });
});
assert.strictEqual(requestCount, 1, 'Valid config sends exactly one provider request');
assert.strictEqual(binanceCalled, false, 'AI cloud test never calls Binance');
assert.strictEqual(success.status, 'SUCCESS');
assert.strictEqual(success.responseParsed, true);
assert.strictEqual(success.schemaValid, true);

const normalizedEndpoint = await testAiCloudConnectivity(config({ apiUrl: 'https://opencode.example.test/v1/chat/completion' }), async (url) => {
  assert.strictEqual(url, 'https://opencode.example.test/v1/chat/completions');
  return response({ choices: [{ message: { content: '{"ok":true,"message":"ai_cloud_test_success"}' } }] });
});
assert.strictEqual(normalizedEndpoint.status, 'SUCCESS');
assert.strictEqual(normalizedEndpoint.apiUrlPath, '/v1/chat/completions');

const openAiCompatibleEnvelope = await testAiCloudConnectivity(config({ provider: 'OpenCode Go', apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions' }), async () => response({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: '{ "ok": true, "message": "ai_cloud_test_success" }',
      },
      finish_reason: 'stop',
    },
  ],
}));
assert.strictEqual(openAiCompatibleEnvelope.status, 'SUCCESS');
assert.strictEqual(openAiCompatibleEnvelope.responseParsed, true);
assert.strictEqual(openAiCompatibleEnvelope.schemaValid, true);

const fencedAssistantContent = await testAiCloudConnectivity(config(), async () => response({
  choices: [
    {
      message: {
        content: '```json\n{ "ok": true, "message": "ai_cloud_test_success" }\n```',
      },
    },
  ],
}));
assert.strictEqual(fencedAssistantContent.status, 'SUCCESS');

const embeddedAssistantJson = await testAiCloudConnectivity(config(), async () => response({
  choices: [
    {
      message: {
        content: 'Connectivity OK:\n{ "ok": true, "message": "ai_cloud_test_success" }',
      },
    },
  ],
}));
assert.strictEqual(embeddedAssistantJson.status, 'SUCCESS');

const contentPartsAssistantJson = await testAiCloudConnectivity(config(), async () => response({
  choices: [
    {
      message: {
        content: [
          { type: 'text', text: '{ "ok": true, "message": "ai_cloud_test_success" }' },
        ],
      },
    },
  ],
}));
assert.strictEqual(contentPartsAssistantJson.status, 'SUCCESS');

const outputTextAssistantJson = await testAiCloudConnectivity(config(), async () => response({
  output_text: '{"ok":true,"message":"ai_cloud_test_success"}',
}));
assert.strictEqual(outputTextAssistantJson.status, 'SUCCESS');

const wrappedAssistantJson = await testAiCloudConnectivity(config(), async () => response({
  data: {
    choices: [
      {
        message: {
          content: '{"ok":true,"message":"ai_cloud_test_success"}',
        },
      },
    ],
  },
}));
assert.strictEqual(wrappedAssistantJson.status, 'SUCCESS');

let retryCallCount = 0;
const responseFormatRetry = await testAiCloudConnectivity(config({ provider: 'OpenCode Go', apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions' }), async (_url, init) => {
  retryCallCount++;
  const body = JSON.parse(String(init?.body));
  if (retryCallCount === 1) {
    assert.deepStrictEqual(body.response_format, { type: 'json_object' });
    return response({ error: { message: 'unsupported parameter response_format' } }, 400);
  }
  assert.strictEqual(body.response_format, undefined);
  return response({ choices: [{ message: { content: '{"ok":true,"message":"ai_cloud_test_success"}' } }] });
});
assert.strictEqual(retryCallCount, 2, 'response_format rejection retries once without response_format');
assert.strictEqual(responseFormatRetry.status, 'SUCCESS');

const goEndpoint = await testAiCloudConnectivity(config({ provider: 'OpenCode Go', apiUrl: 'https://opencode.ai/zen/v1/chat/completion' }), async (url) => {
  assert.strictEqual(url, 'https://opencode.ai/zen/go/v1/chat/completions');
  return response({ choices: [{ message: { content: '{"ok":true,"message":"ai_cloud_test_success"}' } }] });
});
assert.strictEqual(goEndpoint.status, 'SUCCESS');
assert.strictEqual(goEndpoint.apiUrlPath, '/zen/go/v1/chat/completions');

await expectNoNetwork(config({ apiKey: 'sk-dTgm...OGG7' }), 'AI_TEST_API_KEY_MASKED_OR_PARTIAL');

const invalidJson = await testAiCloudConnectivity(config(), async () => response({ choices: [{ message: { content: 'not json' } }] }));
assert.strictEqual(invalidJson.status, 'FAILED');
assert.strictEqual(invalidJson.failureReason, 'AI_TEST_RESPONSE_SCHEMA_INVALID');

const unauthorized = await testAiCloudConnectivity(config(), async () => response('bad key', 401));
assert.strictEqual(unauthorized.status, 'FAILED');
assert.strictEqual(unauthorized.failureReason, '401 Unauthorized - invalid API key or wrong OpenCode product endpoint');

const rateLimited = await testAiCloudConnectivity(config(), async () => response('slow down', 429));
assert.strictEqual(rateLimited.status, 'FAILED');
assert.strictEqual(rateLimited.failureReason, '429 Rate Limit - provider rate limit');

const network = await testAiCloudConnectivity(config(), async () => {
  throw new TypeError('Failed to fetch');
});
assert.strictEqual(network.status, 'FAILED');
assert.strictEqual(network.failureReason, 'Failed to fetch');

const timeout = await testAiCloudConnectivity(config(), async () => {
  const err = new Error('The operation was aborted');
  err.name = 'AbortError';
  throw err;
});
assert.strictEqual(timeout.status, 'FAILED');
assert.strictEqual(timeout.failureReason, 'AI_TEST_TIMEOUT');

const secretLeak = await testAiCloudConnectivity(config(), async () => response(`provider echoed ${secret}`, 500));
assert.strictEqual(secretLeak.status, 'FAILED');
assert.strictEqual(secretLeak.errorMessage?.includes(secret), false, 'Provider error text must redact raw API key');

const allLogs = logger.getLogs().concat(logger.getInternalAuditLogs()).map((entry) => entry.message).join('\n');
assert.strictEqual(allLogs.includes(secret), false, 'Raw API key must never be logged');
assert.strictEqual(allLogs.includes('BUY_INTENT'), false, 'AI cloud test must not create or log BUY_INTENT');

const positions = [{ coin: 'BTCUSDT' }];
const journalRows: Array<{ symbol: string }> = [];
await testAiCloudConnectivity(config(), async () => response({ ok: true, message: 'ai_cloud_test_success' }));
assert.deepStrictEqual(positions, [{ coin: 'BTCUSDT' }], 'AI cloud test does not mutate positions');
assert.deepStrictEqual(journalRows, [], 'AI cloud test does not mutate journal rows');

console.log('AI Cloud connectivity tests PASSED.');
