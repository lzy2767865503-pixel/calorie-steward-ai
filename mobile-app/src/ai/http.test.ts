import assert from 'node:assert/strict';
import test from 'node:test';

import { AiProviderError } from './errors';
import { requestJson } from './http';
import type { ProviderConfig } from './types';

const config: ProviderConfig = {
  id: 'bounded-http-test',
  displayName: 'Bounded HTTP test',
  kind: 'openai_responses',
  baseUrl: 'https://provider.example/v1',
  visionModel: 'vision-model',
  reportModel: 'report-model',
  apiVersion: '',
  authType: 'bearer',
  customAuthHeader: null,
  timeoutMs: 30_000,
  allowInsecureLocalhost: false,
};

test('chunked responses are cancelled before buffering beyond the byte limit', async () => {
  const chunk = new Uint8Array(700 * 1024).fill(0x61);
  let emittedChunks = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      emittedChunks += 1;
      controller.enqueue(chunk);
      if (emittedChunks === 5) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  await assert.rejects(
    requestJson({
      fetchImpl: async () => new Response(stream, { status: 200 }),
      config,
      credentials: { secret: 'test-key' },
      url: 'https://provider.example/v1/responses',
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'INVALID_JSON',
  );

  assert.equal(cancelled, true);
  assert.ok(emittedChunks < 5);
});

test('response size is measured as UTF-8 bytes rather than string length', async () => {
  const multibyteJson = JSON.stringify({ value: '饮'.repeat(800_000) });

  await assert.rejects(
    requestJson({
      fetchImpl: async () => new Response(multibyteJson, { status: 200 }),
      config,
      credentials: { secret: 'test-key' },
      url: 'https://provider.example/v1/responses',
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'INVALID_JSON',
  );
});

test('cross-origin request URLs are rejected before fetch receives credentials', async () => {
  let fetchCalls = 0;

  await assert.rejects(
    requestJson({
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
      config,
      credentials: { secret: 'must-not-leave-configured-origin' },
      url: 'https://attacker.example/v1/responses',
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'INSECURE_ENDPOINT',
  );

  assert.equal(fetchCalls, 0);
});

test('request URLs with embedded credentials are rejected before fetch', async () => {
  let fetchCalls = 0;

  await assert.rejects(
    requestJson({
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
      config,
      credentials: { secret: 'test-key' },
      url: 'https://username:password@provider.example/v1/responses',
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'INSECURE_ENDPOINT',
  );

  assert.equal(fetchCalls, 0);
});

test('adapter headers cannot inject any standard authentication header', async (t) => {
  for (const header of [
    'Authorization',
    'Proxy-Authorization',
    'X-API-Key',
    'x-goog-api-key',
  ]) {
    await t.test(header, async () => {
      let fetchCalls = 0;
      await assert.rejects(
        requestJson({
          fetchImpl: async () => {
            fetchCalls += 1;
            return new Response('{}', { status: 200 });
          },
          config,
          credentials: { secret: 'test-key' },
          url: 'https://provider.example/v1/responses',
          extraHeaders: { [header]: 'attacker-controlled-value' },
        }),
        (error: unknown) =>
          error instanceof AiProviderError && error.code === 'CONFIG_INVALID',
      );
      assert.equal(fetchCalls, 0);
    });
  }
});

test('adapter headers cannot override a configured custom authentication header', async () => {
  let fetchCalls = 0;
  const customConfig: ProviderConfig = {
    ...config,
    id: 'custom-auth-test',
    kind: 'custom_contract',
    authType: 'custom-header',
    customAuthHeader: 'X-Enterprise-Token',
  };

  await assert.rejects(
    requestJson({
      fetchImpl: async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
      config: customConfig,
      credentials: { secret: 'test-key' },
      url: 'https://provider.example/v1/meal-analysis',
      extraHeaders: { 'x-enterprise-token': 'replacement-value' },
    }),
    (error: unknown) =>
      error instanceof AiProviderError && error.code === 'CONFIG_INVALID',
  );

  assert.equal(fetchCalls, 0);
});
