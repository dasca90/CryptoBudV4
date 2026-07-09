import { logger } from '../../utils/logger';
import type { AiCloudApiSettings } from './AiCloudApiSettings';
import { createDefaultAiCloudApiSettings, maskAiApiKey, normalizeAiCloudApiUrl } from './AiCloudApiSettings';
import type { AiCloudTestResult } from './AiCloudTestTypes';
import { callAiProviderGateway, AI_CLOUD_TEST_TIMEOUT_MS } from './providers/AiProviderGateway';

export const AI_CLOUD_TEST_STORAGE_KEY = 'cryptobud_v5_ai_cloud_test';

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const SYSTEM_PROMPT = 'You are a connectivity test for CryptoBud. Return only minified JSON. No markdown. No prose.';
const USER_PROMPT = 'Return exactly: {"ok":true,"message":"ai_cloud_test_success"}';

type AiCloudTestRequestBody = {
  model: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  temperature: 0;
  max_tokens: 80;
  response_format?: { type: 'json_object' };
};

export function createNotTestedAiCloudTestResult(settings: AiCloudApiSettings = createDefaultAiCloudApiSettings()): AiCloudTestResult {
  const endpoint = describeApiUrl(normalizeAiCloudApiUrl(settings.apiUrl, settings.provider));
  return {
    status: 'NOT_TESTED',
    provider: settings.provider,
    model: settings.model,
    endpointDisplay: endpoint.display,
    apiUrlHost: endpoint.host,
    apiUrlPath: endpoint.path,
    lastTestedAt: 0,
    latencyMs: null,
    httpStatus: null,
    responseParsed: false,
    schemaValid: false,
    errorName: null,
    errorMessage: null,
    failureReason: null,
  };
}

export function loadAiCloudTestResult(): AiCloudTestResult {
  try {
    const raw = localStorage.getItem(AI_CLOUD_TEST_STORAGE_KEY);
    if (!raw) return createNotTestedAiCloudTestResult();
    return { ...createNotTestedAiCloudTestResult(), ...JSON.parse(raw) } as AiCloudTestResult;
  } catch {
    return createNotTestedAiCloudTestResult();
  }
}

export function saveAiCloudTestResult(result: AiCloudTestResult): void {
  localStorage.setItem(AI_CLOUD_TEST_STORAGE_KEY, JSON.stringify(result));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cryptobud_v5_ai_cloud_test_updated', { detail: result }));
  }
}

export function clearAiCloudTestResult(): AiCloudTestResult {
  const result = createNotTestedAiCloudTestResult();
  localStorage.removeItem(AI_CLOUD_TEST_STORAGE_KEY);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cryptobud_v5_ai_cloud_test_updated', { detail: result }));
  }
  return result;
}

export function describeApiUrl(apiUrl: string): { host: string; path: string; display: string } {
  const trimmed = apiUrl.trim();
  if (!trimmed) return { host: 'none', path: 'none', display: 'n/a' };
  try {
    const url = new URL(trimmed);
    const path = `${url.pathname}${url.search}` || '/';
    return {
      host: url.host,
      path,
      display: `${url.host}${shortenPath(path)}`,
    };
  } catch {
    return { host: 'invalid_url', path: 'invalid_url', display: 'invalid URL' };
  }
}

export async function testAiCloudConnectivity(settings: AiCloudApiSettings, fetchImpl: FetchLike = fetch): Promise<AiCloudTestResult> {
  const startedAt = Date.now();
  const apiUrl = normalizeAiCloudApiUrl(settings.apiUrl, settings.provider);
  const endpoint = describeApiUrl(apiUrl);
  const apiKey = settings.apiKey.trim();
  const safeContext = {
    provider: settings.provider,
    model: settings.model.trim() || 'none',
    apiUrlHost: endpoint.host,
    apiUrlPath: endpoint.path,
    apiKeyPresent: apiKey.length > 0,
    apiKeyMasked: maskAiApiKey(apiKey) ?? 'none',
    transport: fetchImpl === fetch ? 'auto' : 'injected_fetch',
    requestStartedAt: new Date(startedAt).toISOString(),
  };

  const validationFailure = validateSettings(settings);
  if (validationFailure) {
    const result = buildResult(settings, endpoint, startedAt, null, false, false, {
      errorName: 'AiCloudTestValidationError',
      errorMessage: validationFailure,
      failureReason: validationFailure,
    });
    logger.warn(formatAudit('AI_CLOUD_TEST_FAILED_AUDIT', {
      ...safeContext,
      requestEndedAt: new Date(result.lastTestedAt).toISOString(),
      durationMs: result.latencyMs ?? 0,
      httpStatus: 'n/a',
      success: false,
      responseParsed: false,
      schemaValid: false,
      errorName: result.errorName,
      errorMessage: result.errorMessage,
      failureReason: result.failureReason,
      invariantOk: true,
    }));
    return result;
  }

  logger.info(formatAudit('AI_CLOUD_TEST_REQUEST_AUDIT', {
    ...safeContext,
    timeoutMs: AI_CLOUD_TEST_TIMEOUT_MS,
    success: 'pending',
    invariantOk: true,
  }));

  try {
    const gateway = await callAiProviderGateway({
      provider: settings.provider,
      model: settings.model.trim(),
      apiUrl,
      apiKey,
      requestKind: 'test',
      timeoutMs: AI_CLOUD_TEST_TIMEOUT_MS,
      includeResponseFormat: true,
      maxTokens: 80,
      messages: buildAiCloudTestRequestBody(settings.model.trim(), false).messages,
      fetchImpl: fetchImpl === fetch ? undefined : fetchImpl,
      validateJson: (json) => {
        const value = json as Record<string, unknown>;
        return value?.ok === true && value?.message === 'ai_cloud_test_success'
          ? { valid: true }
          : { valid: false, failureReason: 'AI_TEST_RESPONSE_SCHEMA_INVALID' };
      },
    });
    safeContext.transport = gateway.transport;

    if (!gateway.ok) {
      const failureReason = mapGatewayFailureToTestFailure(gateway.failureReason ?? 'AI_PROVIDER_UNAVAILABLE');
      const result = buildResult(settings, endpoint, startedAt, gateway.httpStatus, gateway.responseParsed, false, {
        errorName: failureReason === 'AI_TEST_TIMEOUT' ? 'AbortError' : 'AiCloudGatewayError',
        errorMessage: sanitizeSecret(gateway.contentPreviewSafe || failureReason, apiKey),
        failureReason,
      });
      emitResponseAudit(result, safeContext);
      emitFailureAudit(result, safeContext);
      return result;
    }

    const result = buildResult(settings, endpoint, startedAt, gateway.httpStatus, true, true);
    emitResponseAudit(result, safeContext);
    logger.info(formatAudit('AI_CLOUD_TEST_SUCCESS_AUDIT', {
      ...safeContext,
      requestEndedAt: new Date(result.lastTestedAt).toISOString(),
      durationMs: result.latencyMs ?? 0,
      httpStatus: result.httpStatus ?? 'n/a',
      success: true,
      responseParsed: true,
      schemaValid: true,
      errorName: 'none',
      errorMessage: 'none',
      failureReason: 'none',
      invariantOk: true,
    }));
    return result;
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    const failureReason = isTimeout ? 'AI_TEST_TIMEOUT' : normalizeReason(err instanceof Error ? err.message : String(err));
    const result = buildResult(settings, endpoint, startedAt, null, false, false, {
      errorName: err instanceof Error ? err.name : 'Error',
      errorMessage: sanitizeSecret(isTimeout ? 'AI_TEST_TIMEOUT' : err instanceof Error ? err.message : String(err), apiKey),
      failureReason,
    });
    emitFailureAudit(result, safeContext);
    return result;
  }
}

function buildAiCloudTestRequestBody(model: string, includeResponseFormat: boolean): AiCloudTestRequestBody {
  return {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: USER_PROMPT },
    ],
    temperature: 0,
    max_tokens: 80,
    ...(includeResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
  };
}

function validateSettings(settings: AiCloudApiSettings): string | null {
  if (settings.provider === 'OFF') return 'AI_TEST_PROVIDER_OFF';
  if (!settings.model.trim()) return 'AI_TEST_MODEL_MISSING';
  if (!settings.apiUrl.trim()) return 'AI_TEST_API_URL_MISSING';
  if (!settings.apiKey.trim()) return 'AI_TEST_API_KEY_MISSING';
  if (isMaskedOrPartialApiKey(settings.apiKey)) return 'AI_TEST_API_KEY_MASKED_OR_PARTIAL';
  const normalizedUrl = normalizeAiCloudApiUrl(settings.apiUrl, settings.provider);
  try {
    const url = new URL(normalizedUrl);
    if (url.protocol !== 'https:') return 'AI_TEST_INVALID_URL';
  } catch {
    return 'AI_TEST_INVALID_URL';
  }
  return null;
}

function buildResult(
  settings: AiCloudApiSettings,
  endpoint: { host: string; path: string; display: string },
  startedAt: number,
  httpStatus: number | null,
  responseParsed: boolean,
  schemaValid: boolean,
  failure?: { errorName: string; errorMessage: string; failureReason: string },
): AiCloudTestResult {
  const endedAt = Date.now();
  return {
    status: failure ? 'FAILED' : 'SUCCESS',
    provider: settings.provider,
    model: settings.model.trim(),
    endpointDisplay: endpoint.display,
    apiUrlHost: endpoint.host,
    apiUrlPath: endpoint.path,
    lastTestedAt: endedAt,
    latencyMs: Math.max(0, endedAt - startedAt),
    httpStatus,
    responseParsed,
    schemaValid,
    errorName: failure?.errorName ?? null,
    errorMessage: failure?.errorMessage ?? null,
    failureReason: failure?.failureReason ?? null,
  };
}

function emitResponseAudit(result: AiCloudTestResult, safeContext: Record<string, unknown>): void {
  logger.info(formatAudit('AI_CLOUD_TEST_RESPONSE_AUDIT', {
    ...safeContext,
    requestEndedAt: new Date(result.lastTestedAt).toISOString(),
    durationMs: result.latencyMs ?? 0,
    httpStatus: result.httpStatus ?? 'n/a',
    success: result.status === 'SUCCESS',
    responseParsed: result.responseParsed,
    schemaValid: result.schemaValid,
    errorName: result.errorName ?? 'none',
    errorMessage: result.errorMessage ?? 'none',
    failureReason: result.failureReason ?? 'none',
    invariantOk: true,
  }));
}

function emitFailureAudit(result: AiCloudTestResult, safeContext: Record<string, unknown>): void {
  logger.warn(formatAudit('AI_CLOUD_TEST_FAILED_AUDIT', {
    ...safeContext,
    requestEndedAt: new Date(result.lastTestedAt).toISOString(),
    durationMs: result.latencyMs ?? 0,
    httpStatus: result.httpStatus ?? 'n/a',
    success: false,
    responseParsed: result.responseParsed,
    schemaValid: result.schemaValid,
    errorName: result.errorName ?? 'none',
    errorMessage: result.errorMessage ?? 'none',
    failureReason: result.failureReason ?? 'none',
    invariantOk: true,
  }));
}

function parseExpectedAiTestResponse(text: string): { responseParsed: boolean; schemaValid: boolean; errorMessage: string } {
  const envelope = parseJson(text);
  if (!envelope.ok) return { responseParsed: false, schemaValid: false, errorMessage: 'AI_TEST_RESPONSE_SCHEMA_INVALID' };
  const candidate = extractResponsePayload(envelope.value);
  const payload = normalizeAiTestPayload(candidate);
  if (!payload.ok) return { responseParsed: false, schemaValid: false, errorMessage: 'AI_TEST_RESPONSE_SCHEMA_INVALID' };
  const value = payload.value as Record<string, unknown>;
  const schemaValid = value?.ok === true && value?.message === 'ai_cloud_test_success';
  return {
    responseParsed: true,
    schemaValid,
    errorMessage: schemaValid ? 'none' : 'AI_TEST_RESPONSE_SCHEMA_INVALID',
  };
}

function extractResponsePayload(envelope: unknown): unknown {
  const obj = envelope as any;
  const content = obj?.choices?.[0]?.message?.content
    ?? obj?.choices?.[0]?.text
    ?? obj?.output_text
    ?? obj?.message?.content
    ?? obj?.content;
  if (content !== undefined) return content;
  for (const key of ['data', 'response', 'result', 'body']) {
    if (obj?.[key] !== undefined) {
      const nested = extractResponsePayload(obj[key]);
      if (nested !== obj[key] || isExpectedAiTestPayload(nested)) return nested;
    }
  }
  return envelope;
}

function normalizeAiTestPayload(value: unknown): { ok: true; value: unknown } | { ok: false } {
  if (typeof value === 'string') return parseJsonPayloadFromText(value);
  if (Array.isArray(value)) {
    const direct = value.find((part) => isExpectedAiTestPayload(part));
    if (direct) return { ok: true, value: direct };

    const text = value.map(extractTextPart).filter(Boolean).join('\n').trim();
    return text ? parseJsonPayloadFromText(text) : { ok: false };
  }
  if (value && typeof value === 'object') {
    if (isExpectedAiTestPayload(value)) return { ok: true, value };
    const nested = value as Record<string, unknown>;
    if (nested.text !== undefined) return normalizeAiTestPayload(nested.text);
    if (nested.content !== undefined) return normalizeAiTestPayload(nested.content);
  }
  return { ok: true, value };
}

function parseJsonPayloadFromText(value: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = stripJsonFence(value);
  const parsed = parseJson(fenced);
  if (parsed.ok) return parsed;

  const embeddedJson = extractFirstJsonObject(fenced);
  return embeddedJson ? parseJson(embeddedJson) : { ok: false };
}

function extractTextPart(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const part = value as Record<string, unknown>;
  const text = part.text ?? part.content ?? part.value;
  return typeof text === 'string' ? text : '';
}

function isExpectedAiTestPayload(value: unknown): boolean {
  const obj = value as Record<string, unknown>;
  return !!obj && typeof obj === 'object' && obj.ok === true && obj.message === 'ai_cloud_test_success';
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function extractFirstJsonObject(value: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\' && inString) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === '{') {
      if (depth === 0) start = index;
      depth++;
      continue;
    }
    if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function mapHttpFailure(status: number): string {
  if (status === 401) return '401 Unauthorized - invalid API key or wrong OpenCode product endpoint';
  if (status === 403) return '403 Forbidden - provider rejected request';
  if (status === 404) return '404 Not Found - bad endpoint or model route';
  if (status === 429) return '429 Rate Limit - provider rate limit';
  if (status >= 500) return `HTTP ${status} provider error`;
  return `HTTP ${status} provider error`;
}

function mapGatewayFailureToTestFailure(reason: string): string {
  if (reason === 'AI_PROVIDER_TIMEOUT') return 'AI_TEST_TIMEOUT';
  if (reason === 'AI_PROVIDER_HTTP_401') return '401 Unauthorized - invalid API key or wrong OpenCode product endpoint';
  if (reason === 'AI_PROVIDER_HTTP_403') return '403 Forbidden - provider rejected request';
  if (reason === 'AI_PROVIDER_HTTP_404') return '404 Not Found - bad endpoint or model route';
  if (reason === 'AI_PROVIDER_HTTP_429' || reason === 'AI_PROVIDER_RATE_LIMITED') return '429 Rate Limit - provider rate limit';
  if (reason === 'AI_PROVIDER_PARSE_FAILED' || reason === 'AI_PROVIDER_SCHEMA_INVALID') return 'AI_TEST_RESPONSE_SCHEMA_INVALID';
  if (reason === 'AI_PROVIDER_NETWORK_ERROR') return 'Failed to fetch';
  return reason;
}

function isMaskedOrPartialApiKey(value: string): boolean {
  return value.includes('...') || value.includes('*');
}

function normalizeReason(message: string): string {
  if (/failed to fetch/i.test(message)) return 'Failed to fetch';
  if (/network/i.test(message)) return 'Network error / Failed to fetch';
  return sanitizeToken(message) || 'AI_TEST_NETWORK_ERROR';
}

function sanitizeSecret(value: string, secret: string): string {
  const trimmedSecret = secret.trim();
  const withoutSecret = trimmedSecret ? value.split(trimmedSecret).join('[redacted]') : value;
  return withoutSecret.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function sanitizeToken(value: unknown): string {
  return String(value ?? 'none').replace(/\s+/g, '_').replace(/[^\w./:-]+/g, '_').slice(0, 240) || 'none';
}

function formatAudit(name: string, fields: Record<string, unknown>): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${sanitizeToken(value)}`)
    .join(' ');
  return `${name}: ${body}`;
}

function shortenPath(path: string): string {
  if (path.length <= 48) return path;
  return `${path.slice(0, 24)}...${path.slice(-18)}`;
}
