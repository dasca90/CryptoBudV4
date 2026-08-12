const CREDENTIAL_FIELD = /^(?:api_?secret|binance_?secret|secret|signature|x-mbx-apikey|authorization|credentials?|secure-store-payload)$/i;
const API_KEY_FIELD = /^(?:api_?key|binance_?api_?key)$/i;

export function sanitizeCredentialArtifact<T>(value: T, depth = 0): T {
  if (depth > 12 || value == null) return value;
  if (Array.isArray(value)) return value.map(item => sanitizeCredentialArtifact(item, depth + 1)) as T;
  if (typeof value !== 'object') return value;
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_FIELD.test(key)) continue;
    if (API_KEY_FIELD.test(key)) {
      if (typeof nested === 'string' && nested.length >= 4) output.maskedApiKey = `****${nested.slice(-4)}`;
      continue;
    }
    output[key] = sanitizeCredentialArtifact(nested, depth + 1);
  }
  return output as T;
}

export function sanitizeCredentialArtifactJson(json: string): string {
  try { return JSON.stringify(sanitizeCredentialArtifact(JSON.parse(json)), null, 2); }
  catch {
    return json
      .replace(/(["']?(?:apiSecret|api_secret|secret|signature|X-MBX-APIKEY)["']?\s*[:=]\s*["']?)[^\s,"'}&]+/gi, '$1[REDACTED]')
      .replace(/([?&]signature=)[^&\s]+/gi, '$1[REDACTED]');
  }
}
