import { joinProviderUrl, requestJson } from '../http';
import {
  extractOpenAIChatText,
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

export class OpenAICompatibleChatAdapter extends BaseAiProviderAdapter {
  constructor(config: ProviderConfig, fetchImpl: FetchLike) {
    super(config, fetchImpl);
    if (this.config.kind !== 'openai_chat_compatible') {
      this.assertProviderKind('openai_chat_compatible');
    }
  }

  async analyzeMeal(
    request: AnalyzeMealRequest,
  ): Promise<AiCallResult<MealAnalysisV1>> {
    this.validateMealRequest(request);
    const response = await requestJson({
      fetchImpl: this.fetchImpl,
      config: this.config,
      credentials: request.credentials,
      url: joinProviderUrl(this.config.baseUrl, 'chat/completions'),
      body: {
        model: this.config.visionModel,
        stream: false,
        temperature: 0,
        max_tokens: 6_000,
        messages: [
          {
            role: 'system',
            content: [
              buildMealSystemPrompt(request.photo.locale),
              'Required JSON Schema for this compatible endpoint:',
              JSON.stringify(MEAL_ANALYSIS_JSON_SCHEMA),
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: `data:${request.photo.mimeType};base64,${request.photo.base64Data}`,
                },
              },
              {
                type: 'text',
                text: buildMealUserPrompt(request.photo),
              },
            ],
          },
        ],
        response_format: {
          type: 'json_object',
        },
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractOpenAIChatText(response.body),
          'openai_chat_compatible',
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
      url: joinProviderUrl(this.config.baseUrl, 'chat/completions'),
      body: {
        model: this.config.reportModel,
        stream: false,
        temperature: 0,
        max_tokens: 4_000,
        messages: [
          {
            role: 'system',
            content: [
              buildReportSystemPrompt(context.locale),
              'Required JSON Schema for this compatible endpoint:',
              JSON.stringify(DIET_REPORT_JSON_SCHEMA),
            ].join('\n'),
          },
          {
            role: 'user',
            content: buildReportUserPrompt(context),
          },
        ],
        response_format: {
          type: 'json_object',
        },
      },
    });
    const payload = this.parsePayload(
      () =>
        parseStructuredJsonText(
          extractOpenAIChatText(response.body),
          'openai_chat_compatible',
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
