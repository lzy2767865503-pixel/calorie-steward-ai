import { AiProviderError } from './errors';
import type { ProviderKind } from './types';

type JsonObject = Record<string, unknown>;

function objectValue(
  value: unknown,
  providerKind: ProviderKind,
  label: string,
): JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind,
      message: `${label} did not match the documented provider response shape.`,
    });
  }
  return value as JsonObject;
}

function structuredText(
  value: unknown,
  providerKind: ProviderKind,
  label: string,
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AiProviderError({
      code: 'INCOMPLETE',
      providerKind,
      message: `${label} did not contain a structured text result.`,
    });
  }
  return value;
}

export function parseStructuredJsonText(
  text: string,
  providerKind: ProviderKind,
): unknown {
  let trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1] !== undefined) {
    trimmed = fenced[1].trim();
  }

  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"' && depth > 0) {
      inString = true;
    } else if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(trimmed.slice(start, index + 1));
        start = -1;
      }
    }
  }
  if (depth !== 0 || candidates.length !== 1) {
    throw new AiProviderError({
      code: 'INVALID_JSON',
      providerKind,
      message: 'Structured output did not contain exactly one complete JSON object.',
    });
  }
  try {
    return JSON.parse(candidates[0]!) as unknown;
  } catch (error) {
    throw new AiProviderError({
      code: 'INVALID_JSON',
      providerKind,
      message: 'Structured output was not valid JSON.',
      cause: error,
    });
  }
}

export function extractProviderResponseModel(
  body: unknown,
  providerKind: ProviderKind,
): string | null {
  const root = objectValue(body, providerKind, 'Provider response');
  if (root.model === undefined || root.model === null) {
    return null;
  }
  if (
    typeof root.model !== 'string' ||
    root.model.trim().length === 0 ||
    root.model.length > 200 ||
    /\p{Cc}/u.test(root.model)
  ) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind,
      message: 'Provider response model identifier is invalid.',
    });
  }
  return root.model;
}

export function extractOpenAIResponsesText(body: unknown): string {
  const kind: ProviderKind = 'openai_responses';
  const root = objectValue(body, kind, 'OpenAI Responses API');
  if (root.status !== 'completed') {
    throw new AiProviderError({
      code: root.status === 'failed' ? 'PROVIDER_UNAVAILABLE' : 'INCOMPLETE',
      providerKind: kind,
      message: 'OpenAI did not complete the structured response.',
      retryable: root.status === 'failed',
    });
  }

  const texts: string[] = [];
  let refused = false;
  if (Array.isArray(root.output)) {
    for (const itemValue of root.output) {
      if (typeof itemValue !== 'object' || itemValue === null || Array.isArray(itemValue)) {
        continue;
      }
      const item = itemValue as JsonObject;
      if (!Array.isArray(item.content)) {
        continue;
      }
      for (const contentValue of item.content) {
        if (typeof contentValue !== 'object' || contentValue === null || Array.isArray(contentValue)) {
          continue;
        }
        const content = contentValue as JsonObject;
        if (content.type === 'refusal') {
          refused = true;
        } else if (content.type === 'output_text' && typeof content.text === 'string') {
          texts.push(content.text);
        }
      }
    }
  }
  if (refused) {
    throw new AiProviderError({
      code: 'REFUSAL',
      providerKind: kind,
      message: 'OpenAI refused to process this request.',
    });
  }
  if (texts.length === 0) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind: kind,
      message: 'OpenAI did not return a structured output.',
    });
  }
  return structuredText(texts.join(''), kind, 'OpenAI Responses API');
}

export function extractOpenAIChatText(
  body: unknown,
  kind: 'openai_chat_compatible' = 'openai_chat_compatible',
): string {
  const root = objectValue(body, kind, 'OpenAI-compatible Chat API');
  if (!Array.isArray(root.choices) || root.choices.length !== 1) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind: kind,
      message: 'Chat completion must contain exactly one choice.',
    });
  }
  const choice = objectValue(root.choices[0], kind, 'Chat completion choice');
  const message = objectValue(choice.message, kind, 'Chat completion message');
  const refusal = message.refusal;
  if (
    refusal !== undefined &&
    refusal !== null &&
    refusal !== false &&
    refusal !== ''
  ) {
    throw new AiProviderError({
      code: 'REFUSAL',
      providerKind: kind,
      message: 'The chat provider refused to process this request.',
    });
  }
  if (choice.finish_reason === 'content_filter') {
    throw new AiProviderError({
      code: 'REFUSAL',
      providerKind: kind,
      message: 'The chat provider filtered this request.',
    });
  }
  const chatText =
    typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content
            .filter(
              (part): part is JsonObject =>
                typeof part === 'object' && part !== null && !Array.isArray(part),
            )
            .filter(
              (part) =>
                (part.type === 'text' || part.type === 'output_text') &&
                typeof part.text === 'string',
            )
            .map((part) => part.text as string)
            .join('')
        : message.content;
  return structuredText(chatText, kind, 'Chat completion');
}

export function extractGeminiInteractionsText(body: unknown): string {
  const kind: ProviderKind = 'gemini_interactions';
  const root = objectValue(body, kind, 'Gemini Interactions API');
  if (root.status !== 'completed') {
    throw new AiProviderError({
      code: 'INCOMPLETE',
      providerKind: kind,
      message: 'Gemini did not complete the structured interaction.',
    });
  }
  const texts: string[] = [];
  if (Array.isArray(root.steps)) {
    for (const stepValue of root.steps) {
      if (typeof stepValue !== 'object' || stepValue === null || Array.isArray(stepValue)) {
        continue;
      }
      const step = stepValue as JsonObject;
      if (step.type !== 'model_output') {
        continue;
      }
      if (
        step.status !== undefined &&
        step.status !== 'done' &&
        step.status !== 'completed'
      ) {
        throw new AiProviderError({
          code: 'INCOMPLETE',
          providerKind: kind,
          message: 'Gemini model output did not complete.',
        });
      }
      if (!Array.isArray(step.content)) {
        continue;
      }
      for (const contentValue of step.content) {
        if (typeof contentValue !== 'object' || contentValue === null || Array.isArray(contentValue)) {
          continue;
        }
        const content = contentValue as JsonObject;
        if (content.type === 'text' && typeof content.text === 'string') {
          texts.push(content.text);
        }
      }
    }
  }
  if (texts.length === 0) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind: kind,
      message: 'Gemini did not return a structured output.',
    });
  }
  return structuredText(texts.join(''), kind, 'Gemini Interactions API');
}

export function extractAnthropicText(body: unknown): string {
  const kind: ProviderKind = 'anthropic_messages';
  const root = objectValue(body, kind, 'Anthropic Messages API');
  if (root.stop_reason !== 'end_turn') {
    throw new AiProviderError({
      code: root.stop_reason === 'refusal' ? 'REFUSAL' : 'INCOMPLETE',
      providerKind: kind,
      message: 'Anthropic did not complete the structured response.',
    });
  }
  if (!Array.isArray(root.content)) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind: kind,
      message: 'Anthropic response content was missing.',
    });
  }
  const texts = root.content
    .filter(
      (item): item is JsonObject =>
        typeof item === 'object' && item !== null && !Array.isArray(item),
    )
    .filter((item) => item.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text as string);
  if (texts.length === 0) {
    throw new AiProviderError({
      code: 'CONTRACT_MISMATCH',
      providerKind: kind,
      message: 'Anthropic did not return a structured output.',
    });
  }
  return structuredText(texts.join(''), kind, 'Anthropic Messages API');
}
