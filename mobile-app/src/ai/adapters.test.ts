import assert from 'node:assert/strict';
import test from 'node:test';

import { AnthropicMessagesAdapter } from './adapters/anthropic';
import {
  CUSTOM_CONTRACT_VERSION,
  CustomContractAdapter,
} from './adapters/customContract';
import { GeminiInteractionsAdapter } from './adapters/geminiInteractions';
import { OpenAICompatibleChatAdapter } from './adapters/openaiChat';
import { OpenAIResponsesAdapter } from './adapters/openaiResponses';
import { AiProviderError } from './errors';
import { validContext, validMeal } from './__tests__/fixtures';
import type {
  FetchLike,
  PhotoInput,
  ProviderConfig,
  ProviderKind,
} from './types';

interface CapturedCall {
  url: string;
  init: RequestInit;
}

function photo(): PhotoInput {
  const base64Data =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  const bytes = Buffer.from(base64Data, 'base64');
  return {
    base64Data,
    byteLength: bytes.length,
    mimeType: 'image/png',
    sanitized: true,
    capturedAt: '2026-08-24T12:30:00+08:00',
    locale: 'zh-CN',
    timezone: 'Asia/Kuala_Lumpur',
  };
}

function config(kind: ProviderKind): ProviderConfig {
  const base: ProviderConfig = {
    id: `${kind}-1`,
    displayName: kind,
    kind,
    baseUrl: 'https://provider.example/v1',
    visionModel: 'vision-model',
    reportModel: 'report-model',
    apiVersion: '',
    authType: 'bearer',
    customAuthHeader: null,
    timeoutMs: 30_000,
    allowInsecureLocalhost: false,
  };
  if (kind === 'gemini_interactions') {
    return {
      ...base,
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiVersion: '2026-05-20',
      authType: 'x-goog-api-key',
    };
  }
  if (kind === 'anthropic_messages') {
    return {
      ...base,
      baseUrl: 'https://api.anthropic.com/v1',
      apiVersion: '2023-06-01',
      authType: 'x-api-key',
    };
  }
  if (kind === 'custom_contract') {
    return {
      ...base,
      baseUrl: 'https://custom.example/api',
    };
  }
  return base;
}

function jsonResponse(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), { status, headers });
}

function captureFetch(
  responder: (call: CapturedCall) => Response | Promise<Response>,
): { fetchImpl: FetchLike; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    assert.ok(init);
    const call = { url: String(input), init };
    calls.push(call);
    return responder(call);
  };
  return { fetchImpl, calls };
}

function requestBody(call: CapturedCall): Record<string, unknown> {
  assert.equal(typeof call.init.body, 'string');
  return JSON.parse(call.init.body as string) as Record<string, unknown>;
}

function customManifest(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    contract_version: CUSTOM_CONTRACT_VERSION,
    meal_analysis_path: '/api/meal-analysis',
    diet_report_path: '/api/diet-report',
    max_image_bytes: 10 * 1024 * 1024,
    image_mime_types: ['image/jpeg', 'image/png', 'image/webp'],
    auth_type: 'bearer',
    auth_header: null,
    ...overrides,
  };
}

test('OpenAI Responses connection test sends the real image and strict schema', async () => {
  const meal = validMeal();
  const mock = captureFetch(() =>
    jsonResponse(
      {
        status: 'completed',
        model: 'vision-model-2026-08-01',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(meal) }],
          },
        ],
      },
      200,
      { 'x-request-id': 'req_openai' },
    ),
  );
  const adapter = new OpenAIResponsesAdapter(
    config('openai_responses'),
    mock.fetchImpl,
  );

  const result = await adapter.testConnection({
    photo: photo(),
    credentials: { secret: 'test-key' },
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider_request_id, 'req_openai');
  assert.equal(result.model, 'vision-model-2026-08-01');
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0]!.url, 'https://provider.example/v1/responses');
  const body = requestBody(mock.calls[0]!);
  assert.equal(body.store, false);
  const input = body.input as Array<Record<string, unknown>>;
  const content = input[0]!.content as Array<Record<string, unknown>>;
  assert.equal(content[0]!.type, 'input_image');
  assert.equal(
    content[0]!.image_url,
    `data:image/png;base64,${photo().base64Data}`,
  );
  const text = body.text as Record<string, unknown>;
  const format = text.format as Record<string, unknown>;
  assert.equal(format.type, 'json_schema');
  assert.equal(format.strict, true);
  assert.ok(format.schema);
  assert.doesNotMatch(JSON.stringify(body), /test-key/);
  const headers = new Headers(mock.calls[0]!.init.headers);
  assert.equal(headers.get('authorization'), 'Bearer test-key');
});

test('OpenAI-compatible Chat sends vision with broadly supported JSON mode', async () => {
  const mock = captureFetch(() =>
    jsonResponse({
      choices: [
        {
          finish_reason: 'stop',
          message: {
            role: 'assistant',
            refusal: null,
            content: JSON.stringify(validMeal()),
          },
        },
      ],
    }),
  );
  const adapter = new OpenAICompatibleChatAdapter(
    config('openai_chat_compatible'),
    mock.fetchImpl,
  );

  const result = await adapter.analyzeMeal({
    photo: photo(),
    credentials: { secret: 'chat-key' },
  });

  assert.equal(result.data.status, 'ok');
  assert.equal(mock.calls[0]!.url, 'https://provider.example/v1/chat/completions');
  const body = requestBody(mock.calls[0]!);
  const messages = body.messages as Array<Record<string, unknown>>;
  const userContent = messages[1]!.content as Array<Record<string, unknown>>;
  const imageUrl = userContent[0]!.image_url as Record<string, unknown>;
  assert.equal(
    imageUrl.url,
    `data:image/png;base64,${photo().base64Data}`,
  );
  const responseFormat = body.response_format as Record<string, unknown>;
  assert.equal(responseFormat.type, 'json_object');
  assert.equal('json_schema' in responseFormat, false);
  assert.equal('store' in body, false);
  assert.equal('detail' in imageUrl, false);
});

test('authentication failure is fail-closed and performs no fallback call', async () => {
  const mock = captureFetch(() => jsonResponse({ error: { message: 'bad key' } }, 401));
  const adapter = new OpenAIResponsesAdapter(
    config('openai_responses'),
    mock.fetchImpl,
  );

  await assert.rejects(
    adapter.analyzeMeal({
      photo: photo(),
      credentials: { secret: 'wrong-key' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'AUTH_FAILED',
  );
  assert.equal(mock.calls.length, 1);
});

test('OpenAI-compatible insufficient balance is surfaced as a distinct fail-closed error', async () => {
  const mock = captureFetch(() =>
    jsonResponse(
      { error: { type: 'insufficient_balance', message: 'Insufficient Balance' } },
      402,
      { 'x-request-id': 'req_no_balance' },
    ),
  );
  const adapter = new OpenAICompatibleChatAdapter(
    config('openai_chat_compatible'),
    mock.fetchImpl,
  );

  await assert.rejects(
    adapter.analyzeMeal({
      photo: photo(),
      credentials: { secret: 'chat-key' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.code === 'BALANCE_EXHAUSTED' &&
      error.httpStatus === 402 &&
      error.providerRequestId === 'req_no_balance',
  );
  assert.equal(mock.calls.length, 1);
});

test('adapter owns a frozen config snapshot and resists endpoint mutation', async () => {
  const mutableConfig = config('openai_responses');
  const mock = captureFetch(() =>
    jsonResponse({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(validMeal()) }],
        },
      ],
    }),
  );
  const adapter = new OpenAIResponsesAdapter(mutableConfig, mock.fetchImpl);

  mutableConfig.baseUrl = 'http://attacker.invalid/steal';
  mutableConfig.visionModel = 'swapped-model';
  await adapter.analyzeMeal({
    photo: photo(),
    credentials: { secret: 'private-key' },
  });

  assert.equal(mock.calls[0]!.url, 'https://provider.example/v1/responses');
  assert.equal(requestBody(mock.calls[0]!).model, 'vision-model');
  assert.equal(Object.isFrozen(adapter.config), true);
});

test('public adapter constructors reject a mismatched provider kind', () => {
  assert.throws(
    () =>
      new OpenAIResponsesAdapter(
        config('anthropic_messages'),
        async () => jsonResponse({}),
      ),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'CONFIG_INVALID',
  );
});

test('a needs-retake model result is never returned as a recordable meal', async () => {
  const needsRetake = validMeal();
  needsRetake.status = 'needs_retake';
  needsRetake.quality.retake_recommended = true;
  const mock = captureFetch(() =>
    jsonResponse(
      {
        status: 'completed',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(needsRetake) }],
          },
        ],
      },
      200,
      { 'x-request-id': 'req_retake' },
    ),
  );
  const adapter = new OpenAIResponsesAdapter(
    config('openai_responses'),
    mock.fetchImpl,
  );

  await assert.rejects(
    adapter.analyzeMeal({
      photo: photo(),
      credentials: { secret: 'test-key' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError &&
      error.code === 'NEEDS_RETAKE' &&
      error.providerRequestId === 'req_retake',
  );
  const connection = await adapter.testConnection({
    photo: photo(),
    credentials: { secret: 'test-key' },
  });
  assert.equal(connection.ok, true);
  assert.equal(connection.provider_request_id, 'req_retake');
  assert.equal(mock.calls.length, 2);
});

test('Gemini Interactions uses inline image input and current response format array', async () => {
  const mock = captureFetch(() =>
    jsonResponse({
      id: 'int_1',
      status: 'completed',
      steps: [
        { type: 'user_input', status: 'done', content: [] },
        {
          type: 'model_output',
          content: [{ type: 'text', text: JSON.stringify(validMeal()) }],
        },
      ],
    }),
  );
  const adapter = new GeminiInteractionsAdapter(
    config('gemini_interactions'),
    mock.fetchImpl,
  );

  const result = await adapter.analyzeMeal({
    photo: photo(),
    credentials: { secret: 'gemini-key' },
  });

  assert.equal(result.data.schema_version, 'meal_analysis.v1');
  const body = requestBody(mock.calls[0]!);
  assert.equal(body.store, false);
  const input = body.input as Array<Record<string, unknown>>;
  assert.deepEqual(input[1], {
    type: 'image',
    data: photo().base64Data,
    mime_type: 'image/png',
  });
  assert.ok(Array.isArray(body.response_format));
  const headers = new Headers(mock.calls[0]!.init.headers);
  assert.equal(headers.get('x-goog-api-key'), 'gemini-key');
  assert.equal(headers.get('api-revision'), '2026-05-20');
});

test('Anthropic refusal is rejected instead of being parsed or recorded', async () => {
  const mock = captureFetch(() =>
    jsonResponse({
      id: 'msg_1',
      stop_reason: 'refusal',
      content: [{ type: 'text', text: JSON.stringify(validMeal()) }],
    }),
  );
  const adapter = new AnthropicMessagesAdapter(
    config('anthropic_messages'),
    mock.fetchImpl,
  );

  await assert.rejects(
    adapter.analyzeMeal({
      photo: photo(),
      credentials: { secret: 'anthropic-key' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'REFUSAL',
  );
  assert.equal(mock.calls.length, 1);
  const body = requestBody(mock.calls[0]!);
  const outputConfig = body.output_config as Record<string, unknown>;
  assert.ok(outputConfig.format);
});

test('Anthropic success uses the image and structured-output contract', async () => {
  const mock = captureFetch(() =>
    jsonResponse(
      {
        id: 'msg_success',
        model: 'claude-actual',
        role: 'assistant',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(validMeal()) }],
      },
      200,
      { 'request-id': 'req_anthropic' },
    ),
  );
  const adapter = new AnthropicMessagesAdapter(
    config('anthropic_messages'),
    mock.fetchImpl,
  );

  const result = await adapter.analyzeMeal({
    photo: photo(),
    credentials: { secret: 'anthropic-key' },
  });

  assert.equal(result.metadata.actual_model, 'claude-actual');
  assert.equal(result.metadata.provider_request_id, 'req_anthropic');
  const body = requestBody(mock.calls[0]!);
  const messages = body.messages as Array<Record<string, unknown>>;
  const content = messages[0]!.content as Array<Record<string, unknown>>;
  const image = content[0]!.source as Record<string, unknown>;
  assert.equal(image.type, 'base64');
  assert.equal(image.data, photo().base64Data);
  const headers = new Headers(mock.calls[0]!.init.headers);
  assert.equal(headers.get('anthropic-version'), '2023-06-01');
});

test('custom contract verifies its manifest and correlates the structured response', async () => {
  const mock = captureFetch((call) => {
    if (call.url === 'https://custom.example/api/.well-known/diet-ai.json') {
      return jsonResponse(customManifest());
    }
    const body = requestBody(call);
    return jsonResponse({
      contract_version: CUSTOM_CONTRACT_VERSION,
      request_id: body.request_id,
      operation: 'meal_analysis',
      schema_version: 'meal_analysis.v1',
      model: 'custom-actual-model',
      result: validMeal(),
    });
  });
  const adapter = new CustomContractAdapter(
    config('custom_contract'),
    mock.fetchImpl,
  );

  const result = await adapter.analyzeMeal({
    photo: photo(),
    credentials: { secret: 'custom-key' },
  });

  assert.equal(result.data.status, 'ok');
  assert.equal(result.metadata.provider_request_id, null);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[1]!.url, 'https://custom.example/api/meal-analysis');
  const body = requestBody(mock.calls[1]!);
  assert.equal(body.contract_version, CUSTOM_CONTRACT_VERSION);
  assert.equal(body.operation, 'meal_analysis');
  assert.ok(body.output_schema);
  const image = body.image as Record<string, unknown>;
  assert.equal(image.data, photo().base64Data);
});

test('custom contract rejects manifest routes outside the consented tenant base path', async () => {
  const escapingManifests = [
    customManifest({ meal_analysis_path: '/other-tenant/meal-analysis' }),
    customManifest({ diet_report_path: '/api-sibling/diet-report' }),
    customManifest({ meal_analysis_path: '/api/%252e%252e/admin' }),
  ];

  for (const manifest of escapingManifests) {
    const mock = captureFetch((call) => {
      assert.equal(call.url, 'https://custom.example/api/.well-known/diet-ai.json');
      return jsonResponse(manifest);
    });
    const adapter = new CustomContractAdapter(
      config('custom_contract'),
      mock.fetchImpl,
    );

    await assert.rejects(
      adapter.analyzeMeal({
        photo: photo(),
        credentials: { secret: 'custom-key' },
      }),
      (error: unknown) =>
        error instanceof AiProviderError && error.code === 'CONTRACT_MISMATCH',
    );
    assert.equal(mock.calls.length, 1);
    assert.equal(
      new Headers(mock.calls[0]!.init.headers).get('authorization'),
      'Bearer custom-key',
    );
  }
});

test('report generation sends only validated aggregates and accepts referenced metrics', async () => {
  const report = {
    schema_version: 'diet_report.v1',
    period: 'day',
    summary: 'Energy intake was within the configured range.',
    patterns: [
      {
        kind: 'positive',
        metric_id: 'energy',
        statement: 'Energy was within range.',
        evidence: 'The aggregate was between its configured minimum and maximum.',
      },
    ],
    suggestions: [
      {
        priority: 3,
        category: 'portion',
        metric_id: 'energy',
        action: 'Keep portions consistent with today.',
        reason: 'The energy aggregate was within its configured range.',
      },
    ],
    uncertainty_note: 'This report covers logged meals only.',
  };
  const mock = captureFetch(() =>
    jsonResponse({
      status: 'completed',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(report) }],
        },
      ],
    }),
  );
  const adapter = new OpenAIResponsesAdapter(
    config('openai_responses'),
    mock.fetchImpl,
  );

  const result = await adapter.generateReport({
    context: validContext(),
    credentials: { secret: 'test-key' },
  });

  assert.equal(result.data.period, 'day');
  assert.match(result.data.summary, /应用核验/);
  assert.notEqual(result.data.summary, report.summary);
  assert.notEqual(result.data.suggestions[0]!.action, report.suggestions[0]!.action);
  const body = requestBody(mock.calls[0]!);
  assert.equal(typeof body.input, 'string');
  assert.match(body.input as string, /"health_score":80/);
  assert.doesNotMatch(body.input as string, /base64|image_url|captured_at/);
});

test('raw OpenAI Responses rejects SDK-only top-level output_text', async () => {
  const mock = captureFetch(() =>
    jsonResponse({
      status: 'completed',
      output_text: JSON.stringify(validMeal()),
      output: [],
    }),
  );
  const adapter = new OpenAIResponsesAdapter(
    config('openai_responses'),
    mock.fetchImpl,
  );

  await assert.rejects(
    adapter.analyzeMeal({
      photo: photo(),
      credentials: { secret: 'test-key' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'CONTRACT_MISMATCH',
  );
});

test('raw Gemini Interactions rejects SDK-only top-level output_text', async () => {
  const mock = captureFetch(() =>
    jsonResponse({
      status: 'completed',
      output_text: JSON.stringify(validMeal()),
      steps: [],
    }),
  );
  const adapter = new GeminiInteractionsAdapter(
    config('gemini_interactions'),
    mock.fetchImpl,
  );

  await assert.rejects(
    adapter.analyzeMeal({
      photo: photo(),
      credentials: { secret: 'test-key' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'CONTRACT_MISMATCH',
  );
});
