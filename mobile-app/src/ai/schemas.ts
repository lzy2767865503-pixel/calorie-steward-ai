import {
  COMPONENT_VISIBILITIES,
  MEAL_ANALYSIS_STATUSES,
  NUTRIENT_EVIDENCE_KINDS,
  REPORT_METRIC_IDS,
  REPORT_PATTERN_KINDS,
  REPORT_PERIODS,
  REPORT_SUGGESTION_CATEGORIES,
} from './types';

/**
 * Deliberately limited to the JSON Schema intersection supported by OpenAI,
 * Gemini and Anthropic. Range and cross-field checks are enforced locally in
 * validation.ts because provider-side schema support is not sufficient for
 * nutrition safety.
 */
const estimateSchema = {
  type: 'object',
  additionalProperties: false,
  description:
    'A bounded visual estimate. Available values require positive confidence and a non-zero uncertainty interval; unavailable values require zero value/lower/upper/confidence.',
  properties: {
    available: { type: 'boolean' },
    value: { type: 'number' },
    lower: { type: 'number' },
    upper: { type: 'number' },
    confidence: {
      type: 'number',
      description: 'Confidence from 0 to 1.',
    },
    evidence: { type: 'string', enum: [...NUTRIENT_EVIDENCE_KINDS] },
  },
  required: ['available', 'value', 'lower', 'upper', 'confidence', 'evidence'],
} as const;

const componentSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    preparation: {
      type: 'string',
      description: 'Visible or strongly supported preparation method; otherwise unknown.',
    },
    visibility: { type: 'string', enum: [...COMPONENT_VISIBILITIES] },
    weight_g: estimateSchema,
    energy_kcal: estimateSchema,
    protein_g: estimateSchema,
    carbohydrate_g: estimateSchema,
    fat_g: estimateSchema,
  },
  required: [
    'name',
    'preparation',
    'visibility',
    'weight_g',
    'energy_kcal',
    'protein_g',
    'carbohydrate_g',
    'fat_g',
  ],
} as const;

export const MEAL_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema_version: {
      type: 'string',
      enum: ['meal_analysis.v1'],
    },
    status: {
      type: 'string',
      enum: [...MEAL_ANALYSIS_STATUSES],
      description:
        'Use ok only when the image contains food and a defensible bounded nutrition estimate can be made.',
    },
    meal_name: { type: 'string' },
    components: {
      type: 'array',
      items: componentSchema,
      description: 'All visible and materially inferred food components.',
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        energy_kcal: estimateSchema,
        protein_g: estimateSchema,
        carbohydrate_g: estimateSchema,
        fat_g: estimateSchema,
        saturated_fat_g: estimateSchema,
        trans_fat_g: estimateSchema,
        fiber_g: estimateSchema,
        free_sugars_g: estimateSchema,
        sodium_mg: estimateSchema,
        fruit_vegetable_g: estimateSchema,
      },
      required: [
        'energy_kcal',
        'protein_g',
        'carbohydrate_g',
        'fat_g',
        'saturated_fat_g',
        'trans_fat_g',
        'fiber_g',
        'free_sugars_g',
        'sodium_mg',
        'fruit_vegetable_g',
      ],
    },
    quality: {
      type: 'object',
      additionalProperties: false,
      properties: {
        image_quality: {
          type: 'number',
          description: 'Image usability from 0 to 1.',
        },
        identification_confidence: { type: 'number' },
        portion_confidence: { type: 'number' },
        nutrition_confidence: { type: 'number' },
        data_coverage: {
          type: 'number',
          description:
            'Exactly the number of available totals nutrient fields divided by the 10 requested totals fields.',
        },
        retake_recommended: { type: 'boolean' },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
        },
        uncertainties: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: [
        'image_quality',
        'identification_confidence',
        'portion_confidence',
        'nutrition_confidence',
        'data_coverage',
        'retake_recommended',
        'assumptions',
        'uncertainties',
      ],
    },
  },
  required: [
    'schema_version',
    'status',
    'meal_name',
    'components',
    'totals',
    'quality',
  ],
} as const;

export const DIET_REPORT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schema_version: {
      type: 'string',
      enum: ['diet_report.v1'],
    },
    period: { type: 'string', enum: [...REPORT_PERIODS] },
    summary: {
      type: 'string',
      description:
        'Untrusted draft text; the application deterministically replaces it from validated aggregates.',
    },
    patterns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: [...REPORT_PATTERN_KINDS] },
          metric_id: { type: 'string', enum: [...REPORT_METRIC_IDS] },
          statement: {
            type: 'string',
            description:
              'Untrusted draft text; the application deterministically replaces it.',
          },
          evidence: {
            type: 'string',
            description:
              'Untrusted draft text; the application replaces it with deterministic aggregate evidence.',
          },
        },
        required: ['kind', 'metric_id', 'statement', 'evidence'],
      },
    },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          priority: { type: 'integer', enum: [1, 2, 3] },
          category: {
            type: 'string',
            enum: [...REPORT_SUGGESTION_CATEGORIES],
          },
          metric_id: { type: 'string', enum: [...REPORT_METRIC_IDS] },
          action: {
            type: 'string',
            description:
              'Untrusted draft text; the application replaces it with a bounded food-based action.',
          },
          reason: {
            type: 'string',
            description:
              'Untrusted draft text; the application replaces it with deterministic aggregate evidence.',
          },
        },
        required: ['priority', 'category', 'metric_id', 'action', 'reason'],
      },
    },
    uncertainty_note: {
      type: 'string',
      description:
        'Untrusted draft text; the application replaces it with a deterministic coverage caveat.',
    },
  },
  required: [
    'schema_version',
    'period',
    'summary',
    'patterns',
    'suggestions',
    'uncertainty_note',
  ],
} as const;
