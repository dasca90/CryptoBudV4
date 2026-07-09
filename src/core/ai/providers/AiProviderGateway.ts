import type { AiProviderName } from '../AiTakeoverTypes';
import type { AiCloudTransportResponse } from '../AiCloudHttpTransport';
import { postAiCloudJson } from '../AiCloudHttpTransport';
import { getDefaultAiCloudApiUrl, normalizeAiCloudApiUrl } from '../AiCloudApiSettings';
import { logger } from '../../../utils/logger';
import { parseAiProviderResponseText } from './AiProviderResponseParser';
import { AiProviderRequestQueue } from './AiProviderRequestQueue';
import { AiProviderRateLimiter } from './AiProviderRateLimiter';
import { setAiProviderHealth, type AiProviderHealthStatus } from './AiProviderHealth';

export const AI_CLOUD_TEST_TIMEOUT_MS = 12000;
export const AI_MISSION_PROVIDER_TIMEOUT_MS = 30000;
export const AI_MISSION_MAX_PROVIDER_RETRIES = 1;
export const AI_MISSION_TOP_K = 3;

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export type AiProviderFailureReason =
  | 'AI_PROVIDER_NOT_CONFIGURED'
  | 'AI_PROVIDER_MODEL_MISSING'
  | 'AI_PROVIDER_API_URL_MISSING'
  | 'AI_PROVIDER_INVALID_URL'
  | 'AI_PROVIDER_TIMEOUT'
  | 'AI_PROVIDER_HTTP_ERROR'
  | 'AI_PROVIDER_HTTP_401'
  | 'AI_PROVIDER_HTTP_403'
  | 'AI_PROVIDER_HTTP_404'
  | 'AI_PROVIDER_HTTP_429'
  | 'AI_PROVIDER_RATE_LIMITED'
  | 'AI_PROVIDER_PARSE_FAILED'
  | 'AI_PROVIDER_SCHEMA_INVALID'
  | 'AI_PROVIDER_NETWORK_ERROR'
  | 'AI_PROVIDER_UNAVAILABLE';

export interface AiProviderGatewayRequest {
  provider: AiProviderName;
  model: string;
  apiUrl?: string;
  apiKey?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  requestKind: 'test' | 'mission' | 'decision';
  missionId?: string;
  candidateCount?: number;
  topK?: number;
  timeoutMs?: number;
  maxRetries?: number;
  includeResponseFormat?: boolean;
  maxTokens?: number;
  temperature?: number;
  invalidJsonRepairMessage?: string;
  fetchImpl?: FetchLike;
  validateJson?: (json: unknown) => { valid: boolean; failureReason?: AiProviderFailureReason | string };
}

export interface AiProviderGatewayResult {
  ok: boolean;
  rawText: string;
  parsedJson: unknown | null;
  failureReason: AiProviderFailureReason | string | null;
  httpStatus: number | null;
  durationMs: number;
  retryCount: number;
  responseParsed: boolean;
  schemaValid: boolean;
  responseShape: string;
  contentSource: string;
  contentPreviewSafe: string;
  providerHealth: AiProviderHealthStatus;
  apiUrlHost: string;
  apiUrlPath: string;
  transport: string;
}

const queue = new AiProviderRequestQueue();
const limiter = new AiProviderRateLimiter();

export function callAiProviderGateway(request: AiProviderGatewayRequest): Promise<AiProviderGatewayResult> {
  return queue.enqueue(() => callAiProviderGatewayNow(request));
}

async function callAiProviderGatewayNow(request: AiProviderGatewayRequest): Promise<AiProviderGatewayResult> {
  const startedAt = Date.now();
  const timeoutMs = request.timeoutMs ?? (request.requestKind === 'test' ? AI_CLOUD_TEST_TIMEOUT_MS : AI_MISSION_PROVIDER_TIMEOUT_MS);
  const maxRetries = request.maxRetries ?? AI_MISSION_MAX_PROVIDER_RETRIES;
  const apiUrl = normalizeAiCloudApiUrl(request.apiUrl || getDefaultAiCloudApiUrl(request.provider), request.provider);
  const endpoint = describeApiUrl(apiUrl);
  const model = request.model.trim();
  const apiKey = (request.apiKey ?? '').trim();
  const context = {
    provider: request.provider,
    model: model || 'none',
    apiUrlHost: endpoint.host,
    apiUrlPath: endpoint.path,
    requestKind: request.requestKind,
    missionId: request.missionId ?? 'none',
    candidateCount: request.candidateCount ?? 0,
    topK: request.topK ?? 0,
    concurrency: 1,
    timeoutMs,
  };

  const validationFailure = validateGatewayRequest(request, apiUrl, model, apiKey);
  if (validationFailure) {
    const result = buildFailure(request, endpoint, startedAt, timeoutMs, validationFailure, null, 0, 'none');
    emitGatewayResponseAudit(result, context, false);
    setHealthFromResult(request, result);
    return result;
  }

  logger.info(formatAudit('AI_PROVIDER_GATEWAY_REQUEST_AUDIT', {
    ...context,
    callCount: 1,
    retryCount: 0,
    apiKeyPresent: apiKey.length > 0,
    promptChars: request.messages.reduce((sum, msg) => sum + msg.content.length, 0),
    invariantOk: true,
  }));

  await limiter.wait();

  let retryCount = 0;
  let includeResponseFormat = request.includeResponseFormat === true;
  let lastResult: AiProviderGatewayResult | null = null;
  let messages = request.messages;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const attemptStartedAt = Date.now();
    try {
      const response = await postWithTimeout(apiUrl, apiKey, buildBody(request, model, includeResponseFormat, messages), timeoutMs, request.fetchImpl);
      const retryWithoutFormat = includeResponseFormat && !response.ok && isResponseFormatRejected(response.status, response.text);
      if (retryWithoutFormat) {
        retryCount++;
        includeResponseFormat = false;
        logger.warn(formatAudit('AI_PROVIDER_GATEWAY_RETRY_AUDIT', {
          ...context,
          retryCount,
          retryWithoutResponseFormat: true,
          httpStatus: response.status,
          failureReason: 'AI_PROVIDER_RESPONSE_FORMAT_UNSUPPORTED',
          invariantOk: true,
        }));
        continue;
      }

      if (!response.ok) {
        const failureReason = mapHttpFailure(response.status);
        lastResult = buildFailure(request, endpoint, startedAt, timeoutMs, failureReason, response.status, retryCount, response.transport);
        if (response.status >= 500 && attempt < maxRetries) {
          retryCount++;
          logger.warn(formatAudit('AI_PROVIDER_GATEWAY_RETRY_AUDIT', {
            ...context,
            retryCount,
            httpStatus: response.status,
            failureReason,
            invariantOk: true,
          }));
          continue;
        }
        emitGatewayResponseAudit(lastResult, context, false);
        setHealthFromResult(request, lastResult);
        return lastResult;
      }

      const parsed = parseAiProviderResponseText(response.text);
      const schema = parsed.responseParsed && request.validateJson
        ? request.validateJson(parsed.parsedJson)
        : { valid: parsed.responseParsed, failureReason: parsed.failureReason ?? 'AI_PROVIDER_PARSE_FAILED' };
      const result: AiProviderGatewayResult = {
        ok: parsed.responseParsed && schema.valid,
        rawText: parsed.rawContent,
        parsedJson: parsed.parsedJson,
        failureReason: parsed.responseParsed ? (schema.valid ? null : schema.failureReason ?? 'AI_PROVIDER_SCHEMA_INVALID') : 'AI_PROVIDER_PARSE_FAILED',
        httpStatus: response.status,
        durationMs: Date.now() - startedAt,
        retryCount,
        responseParsed: parsed.responseParsed,
        schemaValid: schema.valid,
        responseShape: parsed.responseShape,
        contentSource: parsed.contentSource,
        contentPreviewSafe: parsed.contentPreviewSafe,
        providerHealth: parsed.responseParsed && schema.valid ? 'OK' : 'FAILED',
        apiUrlHost: endpoint.host,
        apiUrlPath: endpoint.path,
        transport: response.transport,
      };
      logger.info(formatAudit('AI_PROVIDER_RESPONSE_PARSE_AUDIT', {
        ...context,
        responseShape: result.responseShape,
        contentSource: result.contentSource,
        contentPreviewSafe: result.contentPreviewSafe,
        responseParsed: result.responseParsed,
        failureReason: result.failureReason ?? 'none',
        invariantOk: true,
      }));
      logger.info(formatAudit('AI_PROVIDER_SCHEMA_VALIDATION_AUDIT', {
        ...context,
        schemaValid: result.schemaValid,
        failureReason: result.failureReason ?? 'none',
        invariantOk: true,
      }));
      if (!result.ok && attempt < maxRetries && shouldRetryInvalidProviderJson(result.failureReason)) {
        retryCount++;
        messages = buildInvalidJsonRetryMessages(request, messages, result);
        logger.warn(formatAudit('AI_PROVIDER_GATEWAY_RETRY_AUDIT', {
          ...context,
          retryCount,
          retryAfterInvalidJson: true,
          responseShape: result.responseShape,
          contentSource: result.contentSource,
          contentPreviewSafe: result.contentPreviewSafe,
          failureReason: result.failureReason ?? 'AI_PROVIDER_PARSE_FAILED',
          invariantOk: true,
        }));
        continue;
      }
      emitGatewayResponseAudit(result, context, result.ok);
      setHealthFromResult(request, result);
      return result;
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      const failureReason: AiProviderFailureReason = timedOut ? 'AI_PROVIDER_TIMEOUT' : 'AI_PROVIDER_NETWORK_ERROR';
      lastResult = buildFailure(request, endpoint, startedAt, timeoutMs, failureReason, null, retryCount, 'network');
      if (timedOut) {
        logger.warn(formatAudit('AI_PROVIDER_GATEWAY_TIMEOUT_AUDIT', {
          ...context,
          durationMs: Date.now() - attemptStartedAt,
          retryCount,
          failureReason,
          invariantOk: true,
        }));
      }
      if (attempt < maxRetries) {
        retryCount++;
        logger.warn(formatAudit('AI_PROVIDER_GATEWAY_RETRY_AUDIT', {
          ...context,
          retryCount,
          failureReason,
          invariantOk: true,
        }));
        continue;
      }
    }
  }

  const result = lastResult ?? buildFailure(request, endpoint, startedAt, timeoutMs, 'AI_PROVIDER_UNAVAILABLE', null, retryCount, 'none');
  emitGatewayResponseAudit(result, context, false);
  setHealthFromResult(request, result);
  return result;
}

async function postWithTimeout(apiUrl: string, apiKey: string, body: unknown, timeoutMs: number, fetchImpl?: FetchLike): Promise<AiCloudTransportResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await postAiCloudJson(apiUrl, apiKey, body, timeoutMs, fetchImpl, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function buildBody(
  request: AiProviderGatewayRequest,
  model: string,
  includeResponseFormat: boolean,
  messages: AiProviderGatewayRequest['messages'],
): Record<string, unknown> {
  return {
    model,
    messages,
    temperature: request.temperature ?? 0,
    max_tokens: request.maxTokens ?? (request.requestKind === 'test' ? 80 : 1200),
    ...(includeResponseFormat ? { response_format: { type: 'json_object' } } : {}),
  };
}

function shouldRetryInvalidProviderJson(reason: AiProviderGatewayResult['failureReason']): boolean {
  return reason === 'AI_PROVIDER_PARSE_FAILED' || reason === 'AI_PROVIDER_SCHEMA_INVALID';
}

function buildInvalidJsonRetryMessages(
  request: AiProviderGatewayRequest,
  messages: AiProviderGatewayRequest['messages'],
  result: AiProviderGatewayResult,
): AiProviderGatewayRequest['messages'] {
  const repair = request.invalidJsonRepairMessage
    ?? 'Your previous answer was not valid machine JSON for this request. Return only one minified JSON object. No markdown, no prose, no code fence.';
  return [
    ...messages,
    {
      role: 'assistant',
      content: result.rawText.slice(0, 800),
    },
    {
      role: 'user',
      content: repair,
    },
  ];
}

function validateGatewayRequest(request: AiProviderGatewayRequest, apiUrl: string, model: string, apiKey: string): AiProviderFailureReason | null {
  if (request.provider === 'OFF') return 'AI_PROVIDER_NOT_CONFIGURED';
  if (!model) return 'AI_PROVIDER_MODEL_MISSING';
  if (!apiUrl) return 'AI_PROVIDER_API_URL_MISSING';
  if (!apiKey) return 'AI_PROVIDER_NOT_CONFIGURED';
  if (apiKey.includes('...') || apiKey.includes('*')) return 'AI_PROVIDER_NOT_CONFIGURED';
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:' && request.provider !== 'Ollama Local') return 'AI_PROVIDER_INVALID_URL';
  } catch {
    return 'AI_PROVIDER_INVALID_URL';
  }
  return null;
}

function buildFailure(
  request: AiProviderGatewayRequest,
  endpoint: { host: string; path: string },
  startedAt: number,
  _timeoutMs: number,
  failureReason: AiProviderFailureReason | string,
  httpStatus: number | null,
  retryCount: number,
  transport: string,
): AiProviderGatewayResult {
  return {
    ok: false,
    rawText: '',
    parsedJson: null,
    failureReason,
    httpStatus,
    durationMs: Math.max(0, Date.now() - startedAt),
    retryCount,
    responseParsed: false,
    schemaValid: false,
    responseShape: 'none',
    contentSource: 'none',
    contentPreviewSafe: 'none',
    providerHealth: healthFromFailure(failureReason),
    apiUrlHost: endpoint.host,
    apiUrlPath: endpoint.path,
    transport,
  };
}

function setHealthFromResult(request: AiProviderGatewayRequest, result: AiProviderGatewayResult): void {
  if (!request.fetchImpl && (result.failureReason === 'AI_PROVIDER_HTTP_429' || result.failureReason === 'AI_PROVIDER_RATE_LIMITED')) limiter.backoff(30000);
  setAiProviderHealth({
    status: result.ok
      ? (request.requestKind === 'test' ? 'TESTED_OK' : 'OK')
      : result.providerHealth,
    provider: request.provider,
    model: request.model,
    failureReason: result.failureReason,
  });
}

function emitGatewayResponseAudit(result: AiProviderGatewayResult, context: Record<string, unknown>, success: boolean): void {
  const fields = {
    ...context,
    durationMs: result.durationMs,
    retryCount: result.retryCount,
    httpStatus: result.httpStatus ?? 'n/a',
    responseShape: result.responseShape,
    contentSource: result.contentSource,
    contentPreviewSafe: result.contentPreviewSafe,
    responseParsed: result.responseParsed,
    schemaValid: result.schemaValid,
    providerHealth: result.providerHealth,
    success,
    failureReason: result.failureReason ?? 'none',
    buyIntentCreated: false,
    submitAttempted: false,
    positionMutated: false,
    journalMutated: false,
    invariantOk: true,
  };
  const line = formatAudit('AI_PROVIDER_GATEWAY_RESPONSE_AUDIT', fields);
  success ? logger.info(line) : logger.warn(line);
}

function mapHttpFailure(status: number): AiProviderFailureReason {
  if (status === 401) return 'AI_PROVIDER_HTTP_401';
  if (status === 403) return 'AI_PROVIDER_HTTP_403';
  if (status === 404) return 'AI_PROVIDER_HTTP_404';
  if (status === 429) return 'AI_PROVIDER_HTTP_429';
  return 'AI_PROVIDER_HTTP_ERROR';
}

function healthFromFailure(reason: string): AiProviderHealthStatus {
  if (reason === 'AI_PROVIDER_NOT_CONFIGURED' || reason === 'AI_PROVIDER_MODEL_MISSING' || reason === 'AI_PROVIDER_API_URL_MISSING') return 'NOT_CONFIGURED';
  if (reason === 'AI_PROVIDER_TIMEOUT') return 'TIMEOUT';
  if (reason === 'AI_PROVIDER_HTTP_429' || reason === 'AI_PROVIDER_RATE_LIMITED') return 'RATE_LIMITED';
  if (reason.startsWith('AI_PROVIDER_HTTP_5') || reason === 'AI_PROVIDER_NETWORK_ERROR') return 'DEGRADED';
  return 'FAILED';
}

function isResponseFormatRejected(status: number, text: string): boolean {
  if (status !== 400 && status !== 422) return false;
  const lower = text.toLowerCase();
  return lower.includes('response_format')
    || lower.includes('json_object')
    || lower.includes('unsupported parameter')
    || lower.includes('unknown parameter')
    || lower.includes('invalid parameter');
}

function describeApiUrl(apiUrl: string): { host: string; path: string } {
  try {
    const url = new URL(apiUrl);
    return { host: url.host, path: `${url.pathname}${url.search}` || '/' };
  } catch {
    return { host: 'invalid_url', path: 'invalid_url' };
  }
}

function formatAudit(name: string, fields: Record<string, unknown>): string {
  const body = Object.entries(fields)
    .map(([key, value]) => `${key}=${sanitizeToken(value)}`)
    .join(' ');
  return `${name}: ${body}`;
}

function sanitizeToken(value: unknown): string {
  return String(value ?? 'none').replace(/\s+/g, '_').replace(/[^\w./:-]+/g, '_').slice(0, 240) || 'none';
}
