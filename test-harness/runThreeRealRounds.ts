import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

import { OpenAICompatibleChatAdapter } from '../mobile-app/src/ai/adapters/openaiChat';
import { AiProviderError } from '../mobile-app/src/ai/errors';
import type {
  PhotoInput,
  ProviderConfig,
} from '../mobile-app/src/ai/types';
import { startCodexVisionProxy } from './codexVisionProxy';

interface RoundSpec {
  environmentVariable: string;
  image: string;
  expectation: 'recordable_meal' | 'reject_not_food';
}

const rounds: RoundSpec[] = [
  {
    environmentVariable: 'DIET_STEWARD_MEAL_IMAGE_1',
    image: 'chicken-rice.png',
    expectation: 'recordable_meal',
  },
  {
    environmentVariable: 'DIET_STEWARD_MEAL_IMAGE_2',
    image: 'yogurt-fruit-bowl.png',
    expectation: 'recordable_meal',
  },
  {
    environmentVariable: 'DIET_STEWARD_NON_FOOD_IMAGE',
    image: 'empty-plate.png',
    expectation: 'reject_not_food',
  },
];

function mimeTypeForPath(path: string): PhotoInput['mimeType'] {
  const extension = extname(path).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.png') return 'image/png';
  if (extension === '.webp') return 'image/webp';
  throw new Error(`Unsupported test image extension for ${basename(path)}. Use JPEG, PNG or WebP.`);
}

function photoFromImage(path: string, bytes: Buffer): PhotoInput {
  return {
    base64Data: bytes.toString('base64'),
    byteLength: bytes.byteLength,
    mimeType: mimeTypeForPath(path),
    sanitized: true,
    capturedAt: new Date().toISOString(),
    locale: 'zh-CN',
    timezone: 'Asia/Kuala_Lumpur',
  };
}

async function main(): Promise<void> {
  const harnessRoot = resolve('test-harness');
  const proxy = await startCodexVisionProxy();
  const config: ProviderConfig = {
    id: 'openai-compatible-real-e2e',
    displayName: 'Codex local vision (OpenAI-compatible)',
    kind: 'openai_chat_compatible',
    baseUrl: proxy.baseUrl,
    visionModel: 'codex-local-vision',
    reportModel: 'codex-local-vision',
    apiVersion: '',
    authType: 'bearer',
    customAuthHeader: null,
    timeoutMs: 120_000,
    allowInsecureLocalhost: true,
  };
  const adapter = new OpenAICompatibleChatAdapter(
    config,
    (input, init) => fetch(input, init),
  );
  const evidence = {
    run_id: `three-real-rounds-${Date.now()}`,
    started_at: new Date().toISOString(),
    inference_backend: 'Codex authenticated local proxy (real vision inference, not mock)',
    protocol_under_test: 'OpenAI-compatible chat/completions',
    provider_model_requested: config.visionModel,
    note: 'This harness validates the shipped generic adapter and parser without storing or using a user API key. The inference backend is local Codex vision, not a live paid provider.',
    rounds: [] as Array<Record<string, unknown>>,
    passed: false,
  };

  try {
    for (const [index, spec] of rounds.entries()) {
      const configuredPath = process.env[spec.environmentVariable]?.trim();
      const path = configuredPath
        ? resolve(configuredPath)
        : join(harnessRoot, 'images', spec.image);
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        throw new Error(
          `Missing round ${index + 1} image. Set ${spec.environmentVariable} to a JPEG, PNG or WebP you own or are licensed to use. ` +
            `The public repository intentionally does not distribute regression images.`,
        );
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const started = Date.now();
      try {
        const result = await adapter.analyzeMeal({
          photo: photoFromImage(path, bytes),
          credentials: { secret: 'local-harness-only' },
        });
        const pass = spec.expectation === 'recordable_meal' && result.data.status === 'ok';
        evidence.rounds.push({
          round: index + 1,
          image: basename(path),
          image_sha256: sha256,
          expectation: spec.expectation,
          observed: 'recordable_meal',
          pass,
          elapsed_ms: Date.now() - started,
          provider_request_id: result.metadata.provider_request_id,
          actual_model: result.metadata.actual_model,
          meal_name: result.data.meal_name,
          component_count: result.data.components.length,
          energy_kcal: result.data.totals.energy_kcal,
          protein_g: result.data.totals.protein_g,
          carbohydrate_g: result.data.totals.carbohydrate_g,
          fat_g: result.data.totals.fat_g,
          data_coverage: result.data.quality.data_coverage,
          nutrition_confidence: result.data.quality.nutrition_confidence,
          uncertainties: result.data.quality.uncertainties,
        });
      } catch (error) {
        if (error instanceof AiProviderError) {
          const pass =
            spec.expectation === 'reject_not_food' && error.code === 'NOT_FOOD';
          evidence.rounds.push({
            round: index + 1,
            image: basename(path),
            image_sha256: sha256,
            expectation: spec.expectation,
            observed: `rejected:${error.code}`,
            pass,
            elapsed_ms: Date.now() - started,
            provider_request_id: error.providerRequestId,
            provider_kind: error.providerKind,
            http_status: error.httpStatus,
          });
          continue;
        }
        throw error;
      }
    }
    evidence.passed =
      evidence.rounds.length === rounds.length &&
      evidence.rounds.every((round) => round.pass === true);
    const resultsDir = join(harnessRoot, 'results');
    await mkdir(resultsDir, { recursive: true });
    const outputPath = join(resultsDir, 'three-real-rounds.latest.json');
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify({ outputPath, ...evidence }, null, 2));
    if (!evidence.passed) process.exitCode = 1;
  } finally {
    await proxy.close();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});
