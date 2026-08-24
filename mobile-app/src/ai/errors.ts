import type { ProviderKind } from './types';

export const AI_ERROR_CODES = [
  'CONFIG_INVALID',
  'INSECURE_ENDPOINT',
  'AUTH_MISSING',
  'AUTH_FAILED',
  'PERMISSION_DENIED',
  'RATE_LIMITED',
  'BALANCE_EXHAUSTED',
  'MODEL_UNSUPPORTED',
  'BAD_REQUEST',
  'NETWORK_ERROR',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'INVALID_JSON',
  'SCHEMA_INVALID',
  'SEMANTIC_INVALID',
  'REFUSAL',
  'INCOMPLETE',
  'NOT_FOOD',
  'NEEDS_RETAKE',
  'UNQUANTIFIABLE',
  'CONTRACT_MISMATCH',
] as const;

export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

export class AiProviderError extends Error {
  readonly code: AiErrorCode;
  readonly providerKind: ProviderKind;
  readonly retryable: boolean;
  readonly httpStatus: number | null;
  readonly providerRequestId: string | null;

  constructor(args: {
    code: AiErrorCode;
    message: string;
    providerKind: ProviderKind;
    retryable?: boolean;
    httpStatus?: number | null;
    providerRequestId?: string | null;
    cause?: unknown;
  }) {
    super(args.message, args.cause === undefined ? undefined : { cause: args.cause });
    this.name = 'AiProviderError';
    this.code = args.code;
    this.providerKind = args.providerKind;
    this.retryable = args.retryable ?? false;
    this.httpStatus = args.httpStatus ?? null;
    this.providerRequestId = args.providerRequestId ?? null;
  }
}

export function isAiProviderError(error: unknown): error is AiProviderError {
  return error instanceof AiProviderError;
}
