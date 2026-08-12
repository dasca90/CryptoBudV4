import { isTauriAvailable, tauriDb, type NativeBinanceSignature, type NativeCredentialStatus } from './TauriBridge';

export type CredentialSecurityState =
  | 'NOT_CONFIGURED'
  | 'SECURE'
  | 'MIGRATION_REQUIRED'
  | 'SECURE_STORE_UNAVAILABLE'
  | 'ERROR';

export interface CredentialSecurityStatus extends NativeCredentialStatus {
  state: CredentialSecurityState;
  legacyCredentialDetected: boolean;
  migrationRequired: boolean;
  providerHealthy: boolean;
  errorCode?: string;
}

export interface SecureCredentialBackend {
  save(apiKey: string, apiSecret: string): Promise<NativeCredentialStatus>;
  status(): Promise<NativeCredentialStatus>;
  delete(): Promise<void>;
  sign(payload: string, includeApiKey?: boolean): Promise<NativeBinanceSignature>;
}

function safeCode(error: unknown, fallback: string): string {
  const value = error instanceof Error ? error.message : String(error);
  const match = value.match(/(?:SECURE_STORE_[A-Z_]+|CREDENTIALS_NOT_CONFIGURED|SECURE_SIGNING_FAILED)/);
  return match?.[0] ?? fallback;
}

export const tauriSecureCredentialBackend: SecureCredentialBackend = {
  async save(apiKey, apiSecret) {
    if (!await isTauriAvailable()) throw new Error('SECURE_STORE_UNAVAILABLE');
    return tauriDb.saveBinanceCredentials(apiKey, apiSecret);
  },
  async status() {
    if (!await isTauriAvailable()) throw new Error('SECURE_STORE_UNAVAILABLE');
    return tauriDb.getBinanceCredentialStatus();
  },
  async delete() {
    if (!await isTauriAvailable()) throw new Error('SECURE_STORE_UNAVAILABLE');
    return tauriDb.deleteBinanceCredentials();
  },
  async sign(payload, includeApiKey) {
    if (!await isTauriAvailable()) throw new Error('SECURE_STORE_UNAVAILABLE');
    return tauriDb.signBinancePayload(payload, includeApiKey);
  },
};

export class SecureCredentialStore {
  constructor(private readonly backend: SecureCredentialBackend = tauriSecureCredentialBackend) {}

  saveBinanceCredentials(apiKey: string, apiSecret: string): Promise<NativeCredentialStatus> {
    return this.backend.save(apiKey, apiSecret);
  }

  deleteBinanceCredentials(): Promise<void> { return this.backend.delete(); }
  signBinancePayload(payload: string, includeApiKey = false): Promise<NativeBinanceSignature> { return this.backend.sign(payload, includeApiKey); }

  async getCredentialStatus(): Promise<CredentialSecurityStatus> {
    try {
      const status = await this.backend.status();
      return {
        ...status,
        state: status.configured && status.storageSecure ? 'SECURE' : 'NOT_CONFIGURED',
        legacyCredentialDetected: false,
        migrationRequired: false,
        providerHealthy: status.storageSecure,
      };
    } catch (error) {
      const errorCode = safeCode(error, 'SECURE_STORE_UNAVAILABLE');
      return {
        state: errorCode === 'SECURE_STORE_UNAVAILABLE' ? 'SECURE_STORE_UNAVAILABLE' : 'ERROR',
        configured: false,
        storageSecure: false,
        provider: 'unavailable',
        platform: 'unknown',
        maskedApiKey: null,
        legacyCredentialDetected: false,
        migrationRequired: false,
        providerHealthy: false,
        errorCode,
      };
    }
  }
}

export function normalizeSecureCredentialError(error: unknown, fallback: string): Error {
  return new Error(safeCode(error, fallback));
}
