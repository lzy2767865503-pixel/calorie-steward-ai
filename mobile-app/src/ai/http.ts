import { AiProviderError } from './errors';
import type {
  FetchLike,
  ProviderConfig,
  ProviderCredentials,
  ProviderKind,
} from './types';
import { validateCredentials, validateProviderConfig } from './validation';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function oversizedResponse(
  providerKind: ProviderKind,
  requestId: string | null,
): AiProviderError {
  return new AiProviderError({
    code: 'INVALID_JSON',
    providerKind,
    message: 'The provider response exceeded the safe size limit.',
    providerRequestId: requestId,
  });
}

async function readBoundedResponseText(
  response: Response,
  providerKind: ProviderKind,
  requestId: string | null,
): Promise<string> {
  const body = response.body;
  if (body !== null && typeof body.getReader === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let byteLength = 0;
    let text = '';
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        byteLength += chunk.value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          try {
            await reader.cancel('response size limit exceeded');
          } catch {
            // The size violation remains authoritative even if cancellation fails.
          }
          throw oversizedResponse(providerKind, requestId);
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
      return text;
    } catch (error) {
      if (error instanceof AiProviderError) {
        throw error;
      }
      try {
        await reader.cancel('invalid response body');
      } catch {
        // The stream may already be closed or errored.
      }
      throw new AiProviderError({
        code: 'INVALID_JSON',
        providerKind,
        message: 'The provider response was not valid UTF-8 JSON.',
        providerRequestId: requestId,
        cause: error,
      });
    } finally {
      reader.releaseLock();
    }
  }

  // Some React Native fetch implementations do not expose a readable stream.
  // Content-Length is checked before this fallback; the byte check prevents
  // parsing an oversized payload, although a non-streaming runtime must first
  // allocate the ArrayBuffer supplied by its fetch implementation.
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_RESPONSE_BYTES) {
    throw oversizedResponse(providerKind, requestId);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new AiProviderError({
      code: 'INVALID_JSON',
      providerKind,
      message: 'The provider response was not valid UTF-8 JSON.',
      providerRequestId: requestId,
      cause: error,
    });
  }
}

export interface JsonHttpResult {
  body: unknown;
  providerRequestId: string | null;
  latencyMs: number;
}

const RESERVED_AUTH_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-goog-api-key',
]);

function validateRequestTarget(config: ProviderConfig, requestUrl: string): URL {
  const configuredUrl = validateProviderConfig(config);
  let target: URL;
  try {
    target = new URL(requestUrl);
  } catch {
    throw new AiProviderError({
      code: 'INSECURE_ENDPOINT',
      providerKind: config.kind,
      message: 'The provider request URL must be an absolute secure URL.',
    });
  }

  if (
    target.origin !== configuredUrl.origin ||
    target.username.length > 0 ||
    target.password.length > 0 ||
    target.hash.length > 0
  ) {
    throw new AiProviderError({
      code: 'INSECURE_ENDPOINT',
      providerKind: config.kind,
      message: 'The provider request URL must remain on the configured secure origin.',
    });
  }
  return target;
}

function assertExtraHeadersDoNotOverrideAuthentication(
  config: ProviderConfig,
  extraHeaders: Readonly<Record<string, string>> | undefined,
): void {
  if (extraHeaders === undefined) return;
  const reserved = new Set(RESERVED_AUTH_HEADER_NAMES);
  if (config.customAuthHeader !== null) {
    reserved.add(config.customAuthHeader.toLowerCase());
  }
  const conflictingHeader = Object.keys(extraHeaders).find((header) =>
    reserved.has(header.toLowerCase()),
  );
  if (conflictingHeader !== undefined) {
    throw new AiProviderError({
      code: 'CONFIG_INVALID',
      providerKind: config.kind,
      message: 'Provider adapter headers must not set or override authentication headers.',
    });
  }
}

export function joinProviderUrl(baseUrl: string, relativePath: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const path = relativePath.replace(/^\/+/, '');
  return `${base}/${path}`;
}

export function buildAuthHeaders(
  config: ProviderConfig,
  credentials: ProviderCredentials,
): Record<string, string> {
  validateCredentials(config, credentials);
  switch (config.authType) {
    case 'bearer':
      return { Authorization: `Bearer ${credentials.secret}` };
    case 'x-api-key':
      return { 'x-api-key': credentials.secret };
    case 'x-goog-api-key':
      return { 'x-goog-api-key': credentials.secret };
    case 'custom-header':
      if (config.customAuthHeader === null) {
        throw new AiProviderError({
          code: 'CONFIG_INVALID',
          providerKind: config.kind,
          message: 'Custom authentication header is missing.',
        });
      }
      return { [config.customAuthHeader]: credentials.secret };
    case 'none':
      return {};
  }
}

function requestIdFromHeaders(headers: Headers): string | null {
  return (
    headers.get('x-request-id') ??
    headers.get('request-id') ??
    headers.get('anthropic-request-id') ??
    headers.get('x-goog-request-id') ??
    null
  );
}

function providerErrorHint(responseText: string): string {
  try {
    const root = JSON.parse(responseText) as unknown;
    if (typeof root !== 'object' || root === null || Array.isArray(root)) return '';
    const error = (root as Record<string, unknown>).error;
    if (typeof error !== 'object' || error === null || Array.isArray(error)) return '';
    const detail = error as Record<string, unknown>;
    return [detail.code, detail.type, detail.message]
      .filter((value): value is string => typeof value === 'string')
      .join(' ')
      .toLowerCase()
      .slice(0, 1_000);
  } catch {
    return '';
  }
}

function httpError(
  providerKind: ProviderKind,
  status: number,
  requestId: string | null,
  responseText: string,
): AiProviderError {
  const hint = providerErrorHint(responseText);
  if (status === 401) {
    return new AiProviderError({
      code: 'AUTH_FAILED',
      providerKind,
      message: 'The provider rejected the credential.',
      httpStatus: status,
      providerRequestId: requestId,
    });
  }
  if (status === 403) {
    return new AiProviderError({
      code: 'PERMISSION_DENIED',
      providerKind,
      message: 'The credential does not have access to this model or operation.',
      httpStatus: status,
      providerRequestId: requestId,
    });
  }
  if (status === 404) {
    return new AiProviderError({
      code: 'MODEL_UNSUPPORTED',
      providerKind,
      message: 'The configured endpoint or model is unavailable.',
      httpStatus: status,
      providerRequestId: requestId,
    });
  }
  if (
    status === 402 ||
    (status === 429 && /quota|balance|billing|credit|insufficient/.test(hint))
  ) {
    return new AiProviderError({
      code: 'BALANCE_EXHAUSTED',
      providerKind,
      message: 'The provider account has insufficient balance or quota.',
      httpStatus: status,
      providerRequestId: requestId,
    });
  }
  if (status === 408 || status === 429) {
    return new AiProviderError({
      code: status === 429 ? 'RATE_LIMITED' : 'TIMEOUT',
      providerKind,
      message:
        status === 429
          ? 'The provider rate limit was reached.'
          : 'The provider timed out while processing the request.',
      retryable: true,
      httpStatus: status,
      providerRequestId: requestId,
    });
  }
  if (status >= 500) {
    return new AiProviderError({
      code: 'PROVIDER_UNAVAILABLE',
      providerKind,
      message: 'The provider is temporarily unavailable.',
      retryable: true,
      httpStatus: status,
      providerRequestId: requestId,
    });
  }
  return new AiProviderError({
    code: 'BAD_REQUEST',
    providerKind,
    message: 'The provider rejected the request. Check the endpoint, model, and structured-output support.',
    httpStatus: status,
    providerRequestId: requestId,
  });
}

export async function requestJson(args: {
  fetchImpl: FetchLike;
  config: ProviderConfig;
  credentials: ProviderCredentials;
  url: string;
  method?: 'GET' | 'POST';
  body?: unknown;
  extraHeaders?: Readonly<Record<string, string>>;
}): Promise<JsonHttpResult> {
  const targetUrl = validateRequestTarget(args.config, args.url);
  assertExtraHeadersDoNotOverrideAuthentication(args.config, args.extraHeaders);
  const authHeaders = buildAuthHeaders(args.config, args.credentials);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...authHeaders,
    ...args.extraHeaders,
  };
  if (args.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.config.timeoutMs);
  const startedAt = Date.now();

  try {
    const init: RequestInit = {
      method: args.method ?? 'POST',
      headers,
      signal: controller.signal,
      redirect: 'error',
    };
    if (args.body !== undefined) {
      init.body = JSON.stringify(args.body);
    }

    const response = await args.fetchImpl(targetUrl.toString(), init);
    const requestId = requestIdFromHeaders(response.headers);
    const declaredLength = response.headers.get('content-length');
    if (declaredLength !== null) {
      const parsedLength = Number(declaredLength);
      if (Number.isFinite(parsedLength) && parsedLength > MAX_RESPONSE_BYTES) {
        throw oversizedResponse(args.config.kind, requestId);
      }
    }

    if (response.redirected) {
      throw new AiProviderError({
        code: 'INSECURE_ENDPOINT',
        providerKind: args.config.kind,
        message: 'Provider redirects are not allowed for credential-bearing requests.',
        providerRequestId: requestId,
      });
    }

    const responseText = await readBoundedResponseText(
      response,
      args.config.kind,
      requestId,
    );
    if (!response.ok) {
      throw httpError(args.config.kind, response.status, requestId, responseText);
    }
    if (responseText.length === 0) {
      throw new AiProviderError({
        code: 'INVALID_JSON',
        providerKind: args.config.kind,
        message: 'The provider returned an empty response.',
        providerRequestId: requestId,
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(responseText) as unknown;
    } catch (error) {
      throw new AiProviderError({
        code: 'INVALID_JSON',
        providerKind: args.config.kind,
        message: 'The provider did not return valid JSON.',
        providerRequestId: requestId,
        cause: error,
      });
    }
    return {
      body,
      providerRequestId: requestId,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }
    if (
      controller.signal.aborted ||
      (typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError')
    ) {
      throw new AiProviderError({
        code: 'TIMEOUT',
        providerKind: args.config.kind,
        message: 'The provider request exceeded the configured timeout.',
        retryable: true,
        cause: error,
      });
    }
    throw new AiProviderError({
      code: 'NETWORK_ERROR',
      providerKind: args.config.kind,
      message: 'The provider could not be reached securely.',
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
  }
}
