import { requestJson, joinProviderUrl } from '../http';
import {
  extractOpenAIResponsesText,
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

export class OpenAIResponsesAdapter extends BaseAiProviderAdapter {
  constructor(config: ProviderConfig, fetchImpl: FetchLike) {
    super(config, fetchImpl);
    this.assertProviderKind('openai_responses');
  }

  async analyzeMeal(
    request: AnalyzeMealRequest,
  ): Promise<AiCallResult<MealAnalysisV1>> {
    this.validateMealRequest(request);
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: joinProviderUrl(this.config.baseUrl, 'responses'),
      body: {
        model: this.config.visionModel,
        store: false,
        instructions: buildMealSystemPrompt(request.photo.locale),
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_image',
                image_url: `data:${request.photo.mimeType};base64,${request.photo.base64Data}`,
                detail: 'high',
              },
              {
                type: 'input_text',
                text: buildMealUserPrompt(request.photo),
              },
            ],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'meal_analysis_v1',
            strict: true,
            schema: MEAL_ANALYSIS_JSON_SCHEMA,
          },
        },
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractOpenAIResponsesText(response.body),
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
      url: joinProviderUrl(this.config.baseUrl, 'responses'),
      body: {
        model: this.config.reportModel,
        store: false,
        instructions: buildReportSystemPrompt(context.locale),
        input: buildReportUserPrompt(context),
        text: {
          format: {
            type: 'json_schema',
            name: 'diet_report_v1',
            strict: true,
            schema: DIET_REPORT_JSON_SCHEMA,
          },
        },
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractOpenAIResponsesText(response.body),
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
