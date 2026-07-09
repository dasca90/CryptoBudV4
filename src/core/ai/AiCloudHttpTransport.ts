export interface AiCloudTransportResponse {
  status: number;
  ok: boolean;
  text: string;
  transport: 'tauri_native' | 'browser_fetch' | 'injected_fetch';
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

interface NativeAiCloudHttpPostResponse {
  status: number;
  body: string;
}

export async function postAiCloudJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  fetchImpl?: FetchLike,
  signal?: AbortSignal,
): Promise<AiCloudTransportResponse> {
  if (!fetchImpl) {
    const native = await tryNativeAiCloudPost(url, apiKey, body, timeoutMs);
    if (native) return native;
  }

  const response = await (fetchImpl ?? fetch)(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  return {
    status: response.status,
    ok: response.ok,
    text: await response.text(),
    transport: fetchImpl ? 'injected_fetch' : 'browser_fetch',
  };
}

export async function tryPostJsonFromRequestInit(url: string, init: RequestInit, timeoutMs: number): Promise<Response | null> {
  const apiKey = extractBearerToken(init.headers);
  if (!apiKey) return null;
  if (String(init.method ?? 'GET').toUpperCase() !== 'POST') return null;
  if (!isLikelyJsonRequest(init.headers, init.body)) return null;

  let body: unknown;
  try {
    body = typeof init.body === 'string' ? JSON.parse(init.body) : init.body;
  } catch {
    return null;
  }

  const result = await postAiCloudJson(url, apiKey, body, timeoutMs);
  return new Response(result.text, { status: result.status });
}

async function tryNativeAiCloudPost(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
): Promise<AiCloudTransportResponse | null> {
  if (!isTauriRuntime()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const response = await invoke<NativeAiCloudHttpPostResponse>('ai_cloud_http_post', {
      request: {
        url,
        apiKey,
        body,
        timeoutMs,
      },
    });
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: response.body,
      transport: 'tauri_native',
    };
  } catch (err) {
    if (isMissingNativeCommand(err) || isUnavailableNativeTransport(err)) return null;
    throw err;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).__TAURI_INTERNALS__);
}

function isMissingNativeCommand(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err);
  return /command.*not found|unknown command|not allowed/i.test(message);
}

function isUnavailableNativeTransport(err: unknown): boolean {
  const message = String(err instanceof Error ? err.message : err);
  return /AI_NATIVE_HTTP_CLIENT_ERROR|URL scheme.*not allowed|unsupported.*scheme|No TLS|TLS backend|builder error/i.test(message);
}

function extractBearerToken(headers: RequestInit['headers']): string {
  const authorization = readHeader(headers, 'authorization');
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function isLikelyJsonRequest(headers: RequestInit['headers'], body: BodyInit | null | undefined): boolean {
  const contentType = readHeader(headers, 'content-type');
  return typeof body === 'string' && /json/i.test(contentType);
}

function readHeader(headers: RequestInit['headers'], name: string): string {
  if (!headers) return '';
  if (headers instanceof Headers) return headers.get(name) ?? '';
  const lowerName = name.toLowerCase();
  if (Array.isArray(headers)) {
    const found = headers.find(([key]) => key.toLowerCase() === lowerName);
    return found?.[1] ?? '';
  }
  const record = headers as Record<string, string>;
  const key = Object.keys(record).find((candidate) => candidate.toLowerCase() === lowerName);
  return key ? String(record[key] ?? '') : '';
}
