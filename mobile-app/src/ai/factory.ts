import { AnthropicMessagesAdapter } from './adapters/anthropic';
import { CustomContractAdapter } from './adapters/customContract';
import { GeminiInteractionsAdapter } from './adapters/geminiInteractions';
import { OpenAICompatibleChatAdapter } from './adapters/openaiChat';
import { OpenAIResponsesAdapter } from './adapters/openaiResponses';
import { AiProviderError } from './errors';
import type { AiProviderAdapter, FetchLike, ProviderConfig } from './types';
import { validateProviderConfig } from './validation';

function platformFetch(config: ProviderConfig): FetchLike {
  if (typeof globalThis.fetch !== 'function') {
    throw new AiProviderError({
      code: 'CONFIG_INVALID',
      providerKind: config.kind,
      message: 'This runtime does not provide fetch.',
    });
  }
  return globalThis.fetch.bind(globalThis) as FetchLike;
}

export function createAiProvider(
  config: ProviderConfig,
  fetchImpl?: FetchLike,
): AiProviderAdapter {
  validateProviderConfig(config);
  const resolvedFetch = fetchImpl ?? platformFetch(config);
  switch (config.kind) {
    case 'openai_responses':
      return new OpenAIResponsesAdapter(config, resolvedFetch);
    case 'openai_chat_compatible':
      return new OpenAICompatibleChatAdapter(config, resolvedFetch);
    case 'gemini_interactions':
      return new GeminiInteractionsAdapter(config, resolvedFetch);
    case 'anthropic_messages':
      return new AnthropicMessagesAdapter(config, resolvedFetch);
    case 'custom_contract':
      return new CustomContractAdapter(config, resolvedFetch);
    default:
      throw new AiProviderError({
        code: 'CONFIG_INVALID',
        providerKind: 'custom_contract',
        message: 'Unsupported provider kind.',
      });
  }
}
