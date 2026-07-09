import assert from 'node:assert';
import { callAiProviderGateway } from '../core/ai/providers/AiProviderGateway';
import { parseAiProviderResponseText } from '../core/ai/providers/AiProviderResponseParser';

const apiKey = 'sk-test-gateway';

function response(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

const parsedOpenAi = parseAiProviderResponseText(JSON.stringify({
  choices: [{ message: { content: '{"ok":true}' } }],
}));
assert.strictEqual(parsedOpenAi.responseParsed, true, 'parser extracts choices[0].message.content');
assert.deepStrictEqual(parsedOpenAi.parsedJson, { ok: true });
assert.strictEqual(parsedOpenAi.contentSource, 'choices[0].message.content');

const parsedFence = parseAiProviderResponseText(JSON.stringify({
  choices: [{ message: { content: '```json\n{"ok":true}\n```' } }],
}));
assert.strictEqual(parsedFence.responseParsed, true, 'parser strips markdown json fences');

const parsedLooseJson = parseAiProviderResponseText(JSON.stringify({
  choices: [{ message: { content: 'Result:\n{ missionId: "m", decisions: [], }' } }],
}));
assert.strictEqual(parsedLooseJson.responseParsed, true, 'parser repairs common JS-like JSON response');
assert.deepStrictEqual(parsedLooseJson.parsedJson, { missionId: 'm', decisions: [] });

let retryCalls = 0;
const retry = await callAiProviderGateway({
  provider: 'OpenCode Go',
  model: 'deepseek-v4-flash',
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey,
  requestKind: 'mission',
  includeResponseFormat: true,
  messages: [{ role: 'user', content: 'return json' }],
  fetchImpl: async (_url, init) => {
    retryCalls++;
    const body = JSON.parse(String(init?.body));
    if (retryCalls === 1) {
      assert.deepStrictEqual(body.response_format, { type: 'json_object' });
      return response({ error: { message: 'unsupported parameter response_format' } }, 400);
    }
    assert.strictEqual(body.response_format, undefined);
    return response({ choices: [{ message: { content: '{"missionId":"m","decisions":[]}' } }] });
  },
  validateJson: (json) => Array.isArray((json as any)?.decisions) ? { valid: true } : { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' },
});
assert.strictEqual(retry.ok, true, 'gateway retries once without response_format');
assert.strictEqual(retry.retryCount, 1);
assert.strictEqual(retryCalls, 2);

let parseRetryCalls = 0;
const parseRetry = await callAiProviderGateway({
  provider: 'OpenCode Go',
  model: 'deepseek-v4-flash',
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey,
  requestKind: 'mission',
  maxRetries: 1,
  messages: [{ role: 'user', content: 'return mission json' }],
  invalidJsonRepairMessage: '{"instruction":"return only valid mission json"}',
  fetchImpl: async (_url, init) => {
    parseRetryCalls++;
    const body = JSON.parse(String(init?.body));
    if (parseRetryCalls === 1) {
      assert.strictEqual(body.messages.length, 1);
      return response({ choices: [{ message: { content: 'I would choose to wait, but this is not JSON.' } }] });
    }
    assert.strictEqual(body.messages.length, 3, 'invalid JSON retry appends assistant preview and repair instruction');
    assert.strictEqual(body.messages[2].content, '{"instruction":"return only valid mission json"}');
    return response({ choices: [{ message: { content: '{"missionId":"m","decisions":[]}' } }] });
  },
  validateJson: (json) => Array.isArray((json as any)?.decisions) ? { valid: true } : { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' },
});
assert.strictEqual(parseRetry.ok, true, 'gateway retries parse/schema failures once');
assert.strictEqual(parseRetry.retryCount, 1);
assert.strictEqual(parseRetryCalls, 2);

const timeout = await callAiProviderGateway({
  provider: 'OpenCode Go',
  model: 'deepseek-v4-flash',
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey,
  requestKind: 'mission',
  timeoutMs: 10,
  maxRetries: 0,
  messages: [{ role: 'user', content: 'slow' }],
  fetchImpl: async () => {
    const err = new Error('aborted');
    err.name = 'AbortError';
    throw err;
  },
});
assert.strictEqual(timeout.ok, false);
assert.strictEqual(timeout.failureReason, 'AI_PROVIDER_TIMEOUT', 'timeout returns exact AI_PROVIDER_TIMEOUT');

const rateLimited = await callAiProviderGateway({
  provider: 'OpenCode Go',
  model: 'deepseek-v4-flash',
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey,
  requestKind: 'mission',
  maxRetries: 0,
  messages: [{ role: 'user', content: 'rate limited' }],
  fetchImpl: async () => response('slow down', 429),
});
assert.strictEqual(rateLimited.ok, false);
assert.strictEqual(rateLimited.failureReason, 'AI_PROVIDER_HTTP_429', 'HTTP 429 returns exact reason');

const invalidJson = await callAiProviderGateway({
  provider: 'OpenCode Go',
  model: 'deepseek-v4-flash',
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey,
  requestKind: 'mission',
  maxRetries: 0,
  messages: [{ role: 'user', content: 'bad json' }],
  fetchImpl: async () => response({ choices: [{ message: { content: 'not json' } }] }),
});
assert.strictEqual(invalidJson.ok, false);
assert.strictEqual(invalidJson.failureReason, 'AI_PROVIDER_PARSE_FAILED');

const invalidSchema = await callAiProviderGateway({
  provider: 'OpenCode Go',
  model: 'deepseek-v4-flash',
  apiUrl: 'https://opencode.ai/zen/go/v1/chat/completions',
  apiKey,
  requestKind: 'mission',
  maxRetries: 0,
  messages: [{ role: 'user', content: 'schema' }],
  fetchImpl: async () => response({ choices: [{ message: { content: '{"missionId":"m"}' } }] }),
  validateJson: (json) => Array.isArray((json as any)?.decisions) ? { valid: true } : { valid: false, failureReason: 'AI_PROVIDER_SCHEMA_INVALID' },
});
assert.strictEqual(invalidSchema.ok, false);
assert.strictEqual(invalidSchema.failureReason, 'AI_PROVIDER_SCHEMA_INVALID');

console.log('AI provider gateway tests PASSED.');
