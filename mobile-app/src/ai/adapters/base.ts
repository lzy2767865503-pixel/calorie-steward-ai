import { AiProviderError } from '../errors';
import {
  normalizeDietReportPayload,
  normalizeMealAnalysisPayload,
} from '../normalization';
import type {
  AiCallMetadata,
  AiCallResult,
  AiProviderAdapter,
  AnalyzeMealRequest,
  DietReportV1,
  FetchLike,
  GenerateReportRequest,
  MealAnalysisV1,
  ProviderConfig,
  ProviderConnectionTestResult,
  ReportContextV1,
} from '../types';
import {
  assertRecordableMealAnalysis,
  validateDietReport,
  validateMealAnalysis,
  validatePhotoInput,
  validateProviderConfig,
  validateReportContext,
} from '../validation';

export interface RawProviderResult {
  payload: unknown;
  actualModel: string | null;
  providerRequestId: string | null;
  latencyMs: number;
}

export abstract class BaseAiProviderAdapter implements AiProviderAdapter {
  readonly config: ProviderConfig;
  protected readonly fetchImpl: FetchLike;

  constructor(config: ProviderConfig, fetchImpl: FetchLike) {
    const ownedConfig = { ...config };
    validateProviderConfig(ownedConfig);
    this.config = Object.freeze(ownedConfig);
    this.fetchImpl = fetchImpl;
  }

  protected assertProviderKind(expected: ProviderConfig['kind']): void {
    if (this.config.kind !== expected) {
      throw new AiProviderError({
        code: 'CONFIG_INVALID',
        providerKind: this.config.kind,
        message: `Adapter requires provider kind ${expected}.`,
      });
    }
  }

  abstract analyzeMeal(
    request: AnalyzeMealRequest,
  ): Promise<AiCallResult<MealAnalysisV1>>;

  abstract generateReport(
    request: GenerateReportRequest,
  ): Promise<AiCallResult<DietReportV1>>;

  async testConnection(
    request: AnalyzeMealRequest,
  ): Promise<ProviderConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const result = await this.analyzeMeal(request);
      return {
        ok: true,
        provider_kind: result.metadata.provider_kind,
        model: result.metadata.model,
        provider_request_id: result.metadata.provider_request_id,
        latency_ms: result.metadata.latency_ms,
        schema_version: result.data.schema_version,
      };
    } catch (error) {
      if (
        error instanceof AiProviderError &&
        (error.code === 'NOT_FOOD' ||
          error.code === 'NEEDS_RETAKE' ||
          error.code === 'UNQUANTIFIABLE')
      ) {
        // These statuses prove that authentication, multimodal input and the
        // structured response contract all worked. They only mean the supplied
        // photo is not recordable as a meal.
        return {
          ok: true,
          provider_kind: this.config.kind,
          model: this.config.visionModel,
          provider_request_id: error.providerRequestId,
          latency_ms: Math.max(0, Date.now() - startedAt),
          schema_version: 'meal_analysis.v1',
        };
      }
      throw error;
    }
  }

  protected validateMealRequest(request: AnalyzeMealRequest): void {
    validatePhotoInput(request.photo, this.config.kind);
  }

  protected validatedReportContext(request: GenerateReportRequest) {
    return validateReportContext(request.context, this.config.kind);
  }

  protected completeMeal(
    raw: RawProviderResult,
    model: string,
    locale = 'zh-CN',
  ): AiCallResult<MealAnalysisV1> {
    try {
      const data = validateMealAnalysis(
        normalizeMealAnalysisPayload(raw.payload, locale),
        this.config.kind,
      );
      assertRecordableMealAnalysis(data, this.config.kind);
      return { data, metadata: this.metadata(model, raw) };
    } catch (error) {
      throw this.withProviderContext(error, raw.providerRequestId);
    }
  }

  protected parsePayload(
    parser: () => unknown,
    providerRequestId: string | null,
  ): unknown {
    try {
      return parser();
    } catch (error) {
      throw this.withProviderContext(error, providerRequestId);
    }
  }

  protected completeReport(
    raw: RawProviderResult,
    model: string,
    context: ReportContextV1,
  ): AiCallResult<DietReportV1> {
    try {
      const data = validateDietReport(
        normalizeDietReportPayload(raw.payload, context),
        this.config.kind,
        context.period,
        context.metrics,
        context,
      );
      return { data, metadata: this.metadata(model, raw) };
    } catch (error) {
      throw this.withProviderContext(error, raw.providerRequestId);
    }
  }

  private metadata(model: string, raw: RawProviderResult): AiCallMetadata {
    return {
      provider_kind: this.config.kind,
      requested_model: model,
      model: raw.actualModel ?? model,
      actual_model: raw.actualModel,
      provider_request_id: raw.providerRequestId,
      received_at: new Date().toISOString(),
      latency_ms: raw.latencyMs,
    };
  }

  private withProviderContext(error: unknown, requestId: string | null): unknown {
    if (!(error instanceof AiProviderError) || error.providerRequestId !== null) {
      return error;
    }
    return new AiProviderError({
      code: error.code,
      providerKind: error.providerKind,
      message: error.message,
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      providerRequestId: requestId,
      cause: error,
    });
  }
}
