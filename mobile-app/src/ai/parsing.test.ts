import assert from 'node:assert/strict';
import test from 'node:test';

import { AiProviderError } from './errors';
import { extractOpenAIChatText, parseStructuredJsonText } from './parsing';

test('structured parser accepts one JSON object surrounded by provider prose', () => {
  assert.deepEqual(
    parseStructuredJsonText(
      'Here is the estimate:\n{"status":"ok","calories":420}\nHope this helps.',
      'openai_chat_compatible',
    ),
    { status: 'ok', calories: 420 },
  );
});

test('structured parser still rejects ambiguous multiple JSON objects', () => {
  assert.throws(
    () =>
      parseStructuredJsonText(
        '{"status":"ok"}\n{"status":"not_food"}',
        'openai_chat_compatible',
      ),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'INVALID_JSON',
  );
});

test('chat response text parts are joined for compatible multimodal providers', () => {
  const text = extractOpenAIChatText({
    choices: [
      {
        finish_reason: 'stop',
        message: {
          content: [
            { type: 'text', text: '{"status":' },
            { type: 'text', text: '"ok"}' },
          ],
        },
      },
    ],
  });

  assert.equal(text, '{"status":"ok"}');
});

test('compatible chat accepts complete JSON even when finish reason is absent or length', () => {
  for (const finishReason of [undefined, null, 'length']) {
    const choice: Record<string, unknown> = {
      message: { content: '{"status":"ok"}' },
    };
    if (finishReason !== undefined) choice.finish_reason = finishReason;
    const text = extractOpenAIChatText({ choices: [choice] });
    assert.deepEqual(
      parseStructuredJsonText(text, 'openai_chat_compatible'),
      { status: 'ok' },
    );
  }
});

test('compatible chat still rejects a truncated JSON body during parsing', () => {
  const text = extractOpenAIChatText({
    choices: [
      {
        finish_reason: 'length',
        message: { content: '{"status":"ok"' },
      },
    ],
  });
  assert.throws(
    () => parseStructuredJsonText(text, 'openai_chat_compatible'),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'INVALID_JSON',
  );
});

test('compatible chat rejects every explicit refusal shape', () => {
  for (const refusal of ['declined', true, { reason: 'policy' }]) {
    assert.throws(
      () =>
        extractOpenAIChatText({
          choices: [
            {
              finish_reason: 'stop',
              message: { refusal, content: '{"status":"ok"}' },
            },
          ],
        }),
      (error: unknown) =>
        error instanceof AiProviderError && error.code === 'REFUSAL',
    );
  }
});
