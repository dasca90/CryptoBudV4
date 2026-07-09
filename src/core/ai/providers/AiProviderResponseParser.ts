export interface AiProviderParsedResponse {
  responseParsed: boolean;
  rawContent: string;
  parsedJson: unknown | null;
  responseShape: string;
  contentSource: string;
  contentPreviewSafe: string;
  failureReason: string | null;
}

export function parseAiProviderResponseText(text: string): AiProviderParsedResponse {
  const envelope = parseJson(text);
  const payload = envelope.ok ? extractResponsePayload(envelope.value) : text;
  const contentSource = envelope.ok ? describeContentSource(envelope.value) : 'raw_text';
  const responseShape = envelope.ok ? describeResponseShape(envelope.value) : 'raw_text';
  const rawContent = normalizeContent(payload);
  const parsed = parseJsonPayloadFromText(rawContent);
  return {
    responseParsed: parsed.ok,
    rawContent,
    parsedJson: parsed.ok ? parsed.value : null,
    responseShape,
    contentSource,
    contentPreviewSafe: safePreview(rawContent),
    failureReason: parsed.ok ? null : 'AI_PROVIDER_PARSE_FAILED',
  };
}

export function extractJsonObjectFromProviderText(text: string): unknown | null {
  const parsed = parseJsonPayloadFromText(text);
  return parsed.ok ? parsed.value : null;
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
      if (nested !== obj[key]) return nested;
    }
  }
  return envelope;
}

function normalizeContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const text = value.map((part) => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      const obj = part as Record<string, unknown>;
      const maybeText = obj.text ?? obj.content ?? obj.value;
      return typeof maybeText === 'string' ? maybeText : '';
    }).filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  return JSON.stringify(value);
}

function parseJsonPayloadFromText(value: string): { ok: true; value: unknown } | { ok: false } {
  const fenced = stripJsonFence(value);
  const parsed = parseJson(fenced);
  if (parsed.ok) return parsed;
  const embedded = extractFirstJsonObject(fenced);
  if (!embedded) return { ok: false };
  const embeddedParsed = parseJson(embedded);
  if (embeddedParsed.ok) return embeddedParsed;
  return parseLooseJsonObject(embedded);
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

function parseLooseJsonObject(value: string): { ok: true; value: unknown } | { ok: false } {
  const repaired = value
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/([{,]\s*)([A-Za-z_$][\w$-]*)(\s*:)/g, '$1"$2"$3')
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_match, inner: string) => `"${inner.replace(/"/g, '\\"')}"`);
  return parseJson(repaired);
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
    } else if (char === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) return value.slice(start, index + 1);
    }
  }
  return null;
}

function describeResponseShape(value: unknown): string {
  if (!value || typeof value !== 'object') return typeof value;
  const obj = value as any;
  if (Array.isArray(obj?.choices)) return 'openai_chat_completion';
  if (obj.output_text !== undefined) return 'output_text';
  if (obj.message?.content !== undefined) return 'message_content';
  if (obj.content !== undefined) return 'content';
  return 'direct_json';
}

function describeContentSource(value: unknown): string {
  const obj = value as any;
  if (obj?.choices?.[0]?.message?.content !== undefined) return 'choices[0].message.content';
  if (obj?.choices?.[0]?.text !== undefined) return 'choices[0].text';
  if (obj?.output_text !== undefined) return 'output_text';
  if (obj?.message?.content !== undefined) return 'message.content';
  if (obj?.content !== undefined) return 'content';
  return 'direct_json';
}

function safePreview(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer_[redacted]').slice(0, 160);
}
