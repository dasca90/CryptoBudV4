import type { AiProviderName } from './AiTakeoverTypes';

export type AiCloudTestStatus = 'NOT_TESTED' | 'TESTING' | 'SUCCESS' | 'FAILED';

export interface AiCloudTestResult {
  status: AiCloudTestStatus;
  provider: AiProviderName;
  model: string;
  endpointDisplay: string;
  apiUrlHost: string;
  apiUrlPath: string;
  lastTestedAt: number;
  latencyMs: number | null;
  httpStatus: number | null;
  responseParsed: boolean;
  schemaValid: boolean;
  errorName: string | null;
  errorMessage: string | null;
  failureReason: string | null;
}
