export const PROVIDER_KINDS = [
  'openai_responses',
  'openai_chat_compatible',
  'gemini_interactions',
  'anthropic_messages',
  'custom_contract',
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const AUTH_TYPES = [
  'bearer',
  'x-api-key',
  'x-goog-api-key',
  'custom-header',
  'none',
] as const;

export type AuthType = (typeof AUTH_TYPES)[number];

/**
 * Provider configuration is safe to persist. The actual secret is supplied at
 * call time from Keychain/Keystore and must never be put in this object.
 */
export interface ProviderConfig {
  id: string;
  displayName: string;
  kind: ProviderKind;
  baseUrl: string;
  visionModel: string;
  reportModel: string;
  apiVersion: string;
  authType: AuthType;
  customAuthHeader: string | null;
  timeoutMs: number;
  allowInsecureLocalhost: boolean;
}

export interface ProviderCredentials {
  /** Resolved only for the duration of an API call. */
  secret: string;
}

export const PHOTO_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type PhotoMimeType = (typeof PHOTO_MIME_TYPES)[number];

export interface PhotoInput {
  /** Raw standard base64 without a data URL prefix or whitespace. */
  base64Data: string;
  byteLength: number;
  mimeType: PhotoMimeType;
  /** True only after decode/re-encode removed EXIF and other source metadata. */
  sanitized: true;
  capturedAt: string;
  locale: string;
  timezone: string;
}

export const NUTRIENT_EVIDENCE_KINDS = [
  'visual_estimate',
  'label_ocr',
  'trusted_database',
  'unsupported',
] as const;

export type NutrientEvidenceKind = (typeof NUTRIENT_EVIDENCE_KINDS)[number];

export interface NutrientEstimate {
  available: boolean;
  value: number;
  lower: number;
  upper: number;
  confidence: number;
  evidence: NutrientEvidenceKind;
}

export const MEAL_ANALYSIS_STATUSES = [
  'ok',
  'not_food',
  'needs_retake',
  'unquantifiable',
] as const;

export type MealAnalysisStatus = (typeof MEAL_ANALYSIS_STATUSES)[number];

export const COMPONENT_VISIBILITIES = [
  'visible',
  'partially_hidden',
  'inferred',
] as const;

export type ComponentVisibility = (typeof COMPONENT_VISIBILITIES)[number];

export interface MealComponentV1 {
  name: string;
  preparation: string;
  visibility: ComponentVisibility;
  weight_g: NutrientEstimate;
  energy_kcal: NutrientEstimate;
  protein_g: NutrientEstimate;
  carbohydrate_g: NutrientEstimate;
  fat_g: NutrientEstimate;
}

export interface MealNutrientTotalsV1 {
  energy_kcal: NutrientEstimate;
  protein_g: NutrientEstimate;
  carbohydrate_g: NutrientEstimate;
  fat_g: NutrientEstimate;
  saturated_fat_g: NutrientEstimate;
  trans_fat_g: NutrientEstimate;
  fiber_g: NutrientEstimate;
  free_sugars_g: NutrientEstimate;
  sodium_mg: NutrientEstimate;
  fruit_vegetable_g: NutrientEstimate;
}

export interface MealAnalysisQualityV1 {
  image_quality: number;
  identification_confidence: number;
  portion_confidence: number;
  nutrition_confidence: number;
  data_coverage: number;
  retake_recommended: boolean;
  assumptions: string[];
  uncertainties: string[];
}

export interface MealAnalysisV1 {
  schema_version: 'meal_analysis.v1';
  status: MealAnalysisStatus;
  meal_name: string;
  components: MealComponentV1[];
  totals: MealNutrientTotalsV1;
  quality: MealAnalysisQualityV1;
}

export const REPORT_PERIODS = ['day', 'week', 'month', 'year'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_METRIC_IDS = [
  'energy',
  'protein',
  'carbohydrate',
  'fat',
  'saturated_fat',
  'trans_fat',
  'fiber',
  'free_sugars',
  'sodium',
  'fruit_vegetable',
  'meal_regularity',
  'data_coverage',
  'health_score',
] as const;

export type ReportMetricId = (typeof REPORT_METRIC_IDS)[number];

export const REPORT_TRENDS = ['up', 'down', 'stable', 'insufficient_data'] as const;
export type ReportTrend = (typeof REPORT_TRENDS)[number];

export const REPORT_METRIC_CLASSIFICATIONS = [
  'below_target',
  'within_target',
  'above_target',
  'indeterminate',
  'no_target',
  'insufficient_data',
] as const;
export type ReportMetricClassification =
  (typeof REPORT_METRIC_CLASSIFICATIONS)[number];

export interface ReportMetricInputV1 {
  metric_id: ReportMetricId;
  unit: string;
  available: boolean;
  value: number;
  lower: number;
  upper: number;
  target_min_available: boolean;
  target_min: number;
  target_max_available: boolean;
  target_max: number;
  trend: ReportTrend;
  coverage: number;
  confidence: number;
  classification: ReportMetricClassification;
}

export interface ReportScoreComponentInputV1 {
  metric_id: ReportMetricId;
  score: number;
  weight: number;
}

/**
 * Contains aggregates only. Names, email addresses, exact location and raw
 * photos must not be included in this context.
 */
export interface ReportContextV1 {
  period: ReportPeriod;
  period_start: string;
  period_end: string;
  locale: string;
  timezone: string;
  logged_days: number;
  expected_days: number;
  meal_count: number;
  health_score: number;
  data_coverage: number;
  goal: string;
  dietary_preferences: string[];
  metrics: ReportMetricInputV1[];
  score_components: ReportScoreComponentInputV1[];
}

export const REPORT_PATTERN_KINDS = ['positive', 'watch', 'concern'] as const;
export type ReportPatternKind = (typeof REPORT_PATTERN_KINDS)[number];

export interface DietReportPatternV1 {
  kind: ReportPatternKind;
  metric_id: ReportMetricId;
  statement: string;
  evidence: string;
}

export const REPORT_SUGGESTION_CATEGORIES = [
  'vegetables',
  'fruit',
  'protein',
  'whole_grains',
  'fat_quality',
  'sugar',
  'sodium',
  'portion',
  'meal_timing',
  'recording_quality',
] as const;

export type ReportSuggestionCategory =
  (typeof REPORT_SUGGESTION_CATEGORIES)[number];

export interface DietReportSuggestionV1 {
  priority: 1 | 2 | 3;
  category: ReportSuggestionCategory;
  metric_id: ReportMetricId;
  action: string;
  reason: string;
}

export interface DietReportV1 {
  schema_version: 'diet_report.v1';
  period: ReportPeriod;
  summary: string;
  patterns: DietReportPatternV1[];
  suggestions: DietReportSuggestionV1[];
  uncertainty_note: string;
}

export interface AiCallMetadata {
  provider_kind: ProviderKind;
  requested_model: string;
  /** Actual provider-returned model when available; requested model otherwise. */
  model: string;
  actual_model: string | null;
  provider_request_id: string | null;
  received_at: string;
  latency_ms: number;
}

export interface AiCallResult<T> {
  data: T;
  metadata: AiCallMetadata;
}

export interface AnalyzeMealRequest {
  photo: PhotoInput;
  credentials: ProviderCredentials;
}

export interface GenerateReportRequest {
  context: ReportContextV1;
  credentials: ProviderCredentials;
}

export interface ProviderConnectionTestResult {
  ok: true;
  provider_kind: ProviderKind;
  model: string;
  provider_request_id: string | null;
  latency_ms: number;
  schema_version: 'meal_analysis.v1';
}

export interface AiProviderAdapter {
  readonly config: ProviderConfig;

  analyzeMeal(request: AnalyzeMealRequest): Promise<AiCallResult<MealAnalysisV1>>;

  generateReport(request: GenerateReportRequest): Promise<AiCallResult<DietReportV1>>;

  /**
   * Performs an actual multimodal structured-output call using the supplied
   * photo. It never substitutes a ping, models-list request or demo response.
   */
  testConnection(
    request: AnalyzeMealRequest,
  ): Promise<ProviderConnectionTestResult>;
}

export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
