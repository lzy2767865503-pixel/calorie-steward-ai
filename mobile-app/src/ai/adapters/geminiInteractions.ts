import { joinProviderUrl, requestJson } from '../http';
import {
  extractGeminiInteractionsText,
  extractProviderResponseModel,
  parseStructuredJsonText,
} from '../parsing';
import {
  buildMealSystemPrompt,
  buildMealUserPrompt,
  buildReportSystemPrompt,
  buildReportUserPrompt,
} from '../prompts';
import { DIET_REPORT_JSON_SCHEMA, MEAL_ANALYSIS_JSON_SCHEMA } from '../schemas';
import type {
  AiCallResult,
  AnalyzeMealRequest,
  DietReportV1,
  FetchLike,
  GenerateReportRequest,
  MealAnalysisV1,
  ProviderConfig,
} from '../types';
import { BaseAiProviderAdapter } from './base';

export class GeminiInteractionsAdapter extends BaseAiProviderAdapter {
  constructor(config: ProviderConfig, fetchImpl: FetchLike) {
    super(config, fetchImpl);
    this.assertProviderKind('gemini_interactions');
  }

  private revisionHeaders(): Readonly<Record<string, string>> {
    return this.config.apiVersion.length > 0
      ? { 'Api-Revision': this.config.apiVersion }
      : {};
  }

  async analyzeMeal(
    request: AnalyzeMealRequest,
  ): Promise<AiCallResult<MealAnalysisV1>> {
    this.validateMealRequest(request);
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: joinProviderUrl(this.config.baseUrl, 'interactions'),
      extraHeaders: this.revisionHeaders(),
      body: {
        model: this.config.visionModel,
        store: false,
        stream: false,
        system_instruction: buildMealSystemPrompt(request.photo.locale),
        input: [
          { type: 'text', text: buildMealUserPrompt(request.photo) },
          {
            type: 'image',
            data: request.photo.base64Data,
            mime_type: request.photo.mimeType,
          },
        ],
        response_format: [
          {
            type: 'text',
            mime_type: 'application/json',
            schema: MEAL_ANALYSIS_JSON_SCHEMA,
          },
        ],
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractGeminiInteractionsText(response.body),
          this.config.kind,
        ),
      response.providerRequestId,
    );
    return this.completeMeal(
      {
        payload,
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
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: joinProviderUrl(this.config.baseUrl, 'interactions'),
      extraHeaders: this.revisionHeaders(),
      body: {
        model: this.config.reportModel,
        store: false,
        stream: false,
        system_instruction: buildReportSystemPrompt(context.locale),
        input: buildReportUserPrompt(context),
        response_format: [
          {
            type: 'text',
            mime_type: 'application/json',
            schema: DIET_REPORT_JSON_SCHEMA,
          },
        ],
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractGeminiInteractionsText(response.body),
          this.config.kind,
        ),
      response.providerRequestId,
    );
    return this.completeReport(
      {
        payload,
        actualModel: extractProviderResponseModel(response.body, this.config.kind),
        providerRequestId: response.providerRequestId,
        latencyMs: response.latencyMs,
      },
      this.config.reportModel,
      context,
    );
  }
}
