import { AiProviderError } from '../errors';
import { joinProviderUrl, requestJson } from '../http';
import {
  extractAnthropicText,
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

const ANTHROPIC_CLIENT_HEADERS = Object.freeze({
  'anthropic-version': '2023-06-01',
  'anthropic-dangerous-direct-browser-access': 'true',
});

export class AnthropicMessagesAdapter extends BaseAiProviderAdapter {
  constructor(config: ProviderConfig, fetchImpl: FetchLike) {
    super(config, fetchImpl);
    this.assertProviderKind('anthropic_messages');
  }

  async analyzeMeal(
    request: AnalyzeMealRequest,
  ): Promise<AiCallResult<MealAnalysisV1>> {
    this.validateMealRequest(request);
    if (request.photo.base64Data.length > 10 * 1024 * 1024) {
      throw new AiProviderError({
        code: 'BAD_REQUEST',
        providerKind: this.config.kind,
        message: 'Anthropic accepts at most 10 MB of base64-encoded image data.',
      });
    }
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: joinProviderUrl(this.config.baseUrl, 'messages'),
      extraHeaders: {
        ...ANTHROPIC_CLIENT_HEADERS,
        'anthropic-version': this.config.apiVersion,
      },
      body: {
        model: this.config.visionModel,
        max_tokens: 6_000,
        system: buildMealSystemPrompt(request.photo.locale),
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: request.photo.mimeType,
                  data: request.photo.base64Data,
                },
              },
              {
                type: 'text',
                text: buildMealUserPrompt(request.photo),
              },
            ],
          },
        ],
        output_config: {
          format: {
            type: 'json_schema',
            schema: MEAL_ANALYSIS_JSON_SCHEMA,
          },
        },
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractAnthropicText(response.body),
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
      url: joinProviderUrl(this.config.baseUrl, 'messages'),
      extraHeaders: {
        ...ANTHROPIC_CLIENT_HEADERS,
        'anthropic-version': this.config.apiVersion,
      },
      body: {
        model: this.config.reportModel,
        max_tokens: 4_000,
        system: buildReportSystemPrompt(context.locale),
        messages: [
          {
            role: 'user',
            content: buildReportUserPrompt(context),
          },
        ],
        output_config: {
          format: {
            type: 'json_schema',
            schema: DIET_REPORT_JSON_SCHEMA,
          },
        },
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractAnthropicText(response.body),
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
