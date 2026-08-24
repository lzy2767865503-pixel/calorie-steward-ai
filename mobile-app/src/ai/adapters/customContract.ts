import { AiProviderError } from '../errors';
import { requestJson } from '../http';
import { extractProviderResponseModel } from '../parsing';
import {
  MEAL_PROMPT_VERSION,
  REPORT_PROMPT_VERSION,
  buildMealSystemPrompt,
  buildMealUserPrompt,
  buildReportSystemPrompt,
  buildReportUserPrompt,
  reportContextForProvider,
} from '../prompts';
import { DIET_REPORT_JSON_SCHEMA, MEAL_ANALYSIS_JSON_SCHEMA } from '../schemas';
import {
  AUTH_TYPES,
  PHOTO_MIME_TYPES,
  type AiCallResult,
  type AnalyzeMealRequest,
  type AuthType,
  type DietReportV1,
  type FetchLike,
  type GenerateReportRequest,
  type MealAnalysisV1,
  type PhotoMimeType,
  type ProviderConfig,
  type ProviderCredentials,
} from '../types';
import { BaseAiProviderAdapter } from './base';

export const CUSTOM_CONTRACT_VERSION = 'diet-ai.custom.v1';
export const CUSTOM_MANIFEST_PATH = '/.well-known/diet-ai.json';

const AMBIGUOUS_PATH_ENCODING = /%(?:25|2e|2f|5c)/i;

interface CustomManifestV1 {
  contract_version: typeof CUSTOM_CONTRACT_VERSION;
  meal_analysis_path: string;
  diet_report_path: string;
  max_image_bytes: number;
  image_mime_types: PhotoMimeType[];
  auth_type: AuthType;
  auth_header: string | null;
}

type JsonObject = Record<string, unknown>;

function contractError(message: string): never {
  throw new AiProviderError({
    code: 'CONTRACT_MISMATCH',
    providerKind: 'custom_contract',
    message,
  });
}

function asObject(value: unknown, label: string): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    contractError(`${label} must be an object.`);
  }
  return value as JsonObject;
}

function exactKeys(object: JsonObject, expected: readonly string[], label: string): void {
  const expectedSet = new Set(expected);
  if (
    expected.some((key) => !(key in object)) ||
    Object.keys(object).some((key) => !expectedSet.has(key))
  ) {
    contractError(`${label} fields do not match ${CUSTOM_CONTRACT_VERSION}.`);
  }
}

function normalizedTenantBase(baseUrl: string): URL {
  const base = new URL(baseUrl);
  if (AMBIGUOUS_PATH_ENCODING.test(base.pathname)) {
    contractError('Configured provider base path contains ambiguous path encoding.');
  }
  base.pathname = base.pathname.replace(/\/+$/, '') || '/';
  base.search = '';
  base.hash = '';
  return base;
}

function isInsideTenantPath(basePath: string, targetPath: string): boolean {
  return (
    basePath === '/' ||
    targetPath === basePath ||
    targetPath.startsWith(`${basePath}/`)
  );
}

function manifestUrl(baseUrl: string): string {
  const base = normalizedTenantBase(baseUrl);
  base.pathname = `${base.pathname === '/' ? '' : base.pathname}${CUSTOM_MANIFEST_PATH}`;
  return base.toString();
}

function endpointUrl(baseUrl: string, path: unknown, label: string): string {
  if (
    typeof path !== 'string' ||
    !path.startsWith('/') ||
    path.includes('\\') ||
    path.includes('?') ||
    path.includes('#') ||
    AMBIGUOUS_PATH_ENCODING.test(path)
  ) {
    contractError(
      `${label} must be an unambiguous absolute path without query or fragment.`,
    );
  }
  const base = normalizedTenantBase(baseUrl);
  const endpoint = new URL(path, base.origin);
  if (
    endpoint.origin !== base.origin ||
    endpoint.username ||
    endpoint.password ||
    !isInsideTenantPath(base.pathname, endpoint.pathname)
  ) {
    contractError(`${label} must stay inside the configured provider base path.`);
  }
  return endpoint.toString();
}

function requestId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `diet-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

export class CustomContractAdapter extends BaseAiProviderAdapter {
  private manifestPromise: Promise<CustomManifestV1> | null = null;

  constructor(config: ProviderConfig, fetchImpl: FetchLike) {
    super(config, fetchImpl);
    this.assertProviderKind('custom_contract');
  }

  private async manifest(credentials: ProviderCredentials): Promise<CustomManifestV1> {
    if (this.manifestPromise === null) {
      this.manifestPromise = this.loadManifest(credentials);
    }
    try {
      return await this.manifestPromise;
    } catch (error) {
      this.manifestPromise = null;
      throw error;
    }
  }

  private async loadManifest(credentials: ProviderCredentials): Promise<CustomManifestV1> {
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials,
      url: manifestUrl(this.config.baseUrl),
      method: 'GET',
    });
    const root = asObject(response.body, 'Custom provider manifest');
    exactKeys(
      root,
      [
        'contract_version',
        'meal_analysis_path',
        'diet_report_path',
        'max_image_bytes',
        'image_mime_types',
        'auth_type',
        'auth_header',
      ],
      'Custom provider manifest',
    );
    if (root.contract_version !== CUSTOM_CONTRACT_VERSION) {
      contractError(`Custom provider must implement ${CUSTOM_CONTRACT_VERSION}.`);
    }
    if (
      typeof root.max_image_bytes !== 'number' ||
      !Number.isInteger(root.max_image_bytes) ||
      root.max_image_bytes < 16 ||
      root.max_image_bytes > 100 * 1024 * 1024
    ) {
      contractError('Manifest max_image_bytes is invalid.');
    }
    if (
      !Array.isArray(root.image_mime_types) ||
      root.image_mime_types.length === 0 ||
      new Set(root.image_mime_types).size !== root.image_mime_types.length ||
      root.image_mime_types.some(
        (value) =>
          typeof value !== 'string' ||
          !PHOTO_MIME_TYPES.includes(value as PhotoMimeType),
      )
    ) {
      contractError('Manifest image_mime_types must be a unique supported list.');
    }
    if (
      typeof root.auth_type !== 'string' ||
      !AUTH_TYPES.includes(root.auth_type as AuthType) ||
      root.auth_type !== this.config.authType
    ) {
      contractError('Manifest auth_type does not match the saved provider configuration.');
    }
    const expectedHeader =
      this.config.authType === 'custom-header' ? this.config.customAuthHeader : null;
    if (root.auth_header !== expectedHeader) {
      contractError('Manifest auth_header does not match the saved provider configuration.');
    }

    endpointUrl(this.config.baseUrl, root.meal_analysis_path, 'meal_analysis_path');
    endpointUrl(this.config.baseUrl, root.diet_report_path, 'diet_report_path');
    return {
      contract_version: CUSTOM_CONTRACT_VERSION,
      meal_analysis_path: root.meal_analysis_path as string,
      diet_report_path: root.diet_report_path as string,
      max_image_bytes: root.max_image_bytes,
      image_mime_types: root.image_mime_types as PhotoMimeType[],
      auth_type: root.auth_type as AuthType,
      auth_header: root.auth_header as string | null,
    };
  }

  async analyzeMeal(
    request: AnalyzeMealRequest,
  ): Promise<AiCallResult<MealAnalysisV1>> {
    this.validateMealRequest(request);
    const manifest = await this.manifest(request.credentials);
    if (request.photo.byteLength > manifest.max_image_bytes) {
      contractError('Photo exceeds the custom provider manifest image limit.');
    }
    if (!manifest.image_mime_types.includes(request.photo.mimeType)) {
      contractError('Photo MIME type is not accepted by the custom provider manifest.');
    }

    const clientRequestId = requestId();
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: endpointUrl(
        this.config.baseUrl,
        manifest.meal_analysis_path,
        'meal_analysis_path',
      ),
      body: {
        contract_version: CUSTOM_CONTRACT_VERSION,
        request_id: clientRequestId,
        operation: 'meal_analysis',
        schema_version: 'meal_analysis.v1',
        prompt_version: MEAL_PROMPT_VERSION,
        model: this.config.visionModel,
        image: {
          data: request.photo.base64Data,
          mime_type: request.photo.mimeType,
          byte_length: request.photo.byteLength,
          sanitized: true,
        },
        context: {
          locale: request.photo.locale,
        },
        system_prompt: buildMealSystemPrompt(request.photo.locale),
        user_prompt: buildMealUserPrompt(request.photo),
        output_schema: MEAL_ANALYSIS_JSON_SCHEMA,
      },
    });
    const result = this.parsePayload(
      () =>
        this.contractResult(
          response.body,
          clientRequestId,
          'meal_analysis',
          'meal_analysis.v1',
        ),
      response.providerRequestId,
    );
    return this.completeMeal(
      {
        payload: result,
        actualModel: extractProviderResponseModel(response.body, this.config.kind),
        providerRequestId: response.providerRequestId,
        latencyMs: response.latencyMs,
      },
      this.config.visionModel,
      request.photo.locale,
    );
  }

  async generateReport(
    request: GenerateReportRequest,
  ): Promise<AiCallResult<DietReportV1>> {
    const context = this.validatedReportContext(request);
    const manifest = await this.manifest(request.credentials);
    const clientRequestId = requestId();
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: endpointUrl(
        this.config.baseUrl,
        manifest.diet_report_path,
        'diet_report_path',
      ),
      body: {
        contract_version: CUSTOM_CONTRACT_VERSION,
        request_id: clientRequestId,
        operation: 'diet_report',
        schema_version: 'diet_report.v1',
        prompt_version: REPORT_PROMPT_VERSION,
        model: this.config.reportModel,
        context: reportContextForProvider(context),
        system_prompt: buildReportSystemPrompt(context.locale),
        user_prompt: buildReportUserPrompt(context),
        output_schema: DIET_REPORT_JSON_SCHEMA,
      },
    });
    const result = this.parsePayload(
      () =>
        this.contractResult(
          response.body,
          clientRequestId,
          'diet_report',
          'diet_report.v1',
        ),
      response.providerRequestId,
    );
    return this.completeReport(
      {
        payload: result,
        actualModel: extractProviderResponseModel(response.body, this.config.kind),
        providerRequestId: response.providerRequestId,
        latencyMs: response.latencyMs,
      },
      this.config.reportModel,
      context,
    );
  }

  private contractResult(
    body: unknown,
    expectedRequestId: string,
    operation: 'meal_analysis' | 'diet_report',
    schemaVersion: 'meal_analysis.v1' | 'diet_report.v1',
  ): unknown {
    const root = asObject(body, 'Custom provider response');
    exactKeys(
      root,
      [
        'contract_version',
        'request_id',
        'operation',
        'schema_version',
        'model',
        'result',
      ],
      'Custom provider response',
    );
    if (
      root.contract_version !== CUSTOM_CONTRACT_VERSION ||
      root.request_id !== expectedRequestId ||
      root.operation !== operation ||
      root.schema_version !== schemaVersion
    ) {
      contractError('Custom provider response correlation or version check failed.');
    }
    if (typeof root.model !== 'string' || root.model.trim().length === 0) {
      contractError('Custom provider response must identify the actual model.');
    }
    return root.result;
  }
}
