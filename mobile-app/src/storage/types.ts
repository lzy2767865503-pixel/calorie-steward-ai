import type {
  FoodCategory,
  NutrientEvidenceMap,
  PopulationGroup,
  SpecialCondition,
} from "../domain/types";

export type PeriodType = "day" | "week" | "month" | "year";

export type MealRecordStatus = "confirmed" | "corrected" | "archived";

export interface NutrientRangeValue {
  low: number;
  estimate: number;
  high: number;
}

/** A null field means the photo/API response did not provide usable evidence. */
export interface StoredNutrientTotals {
  caloriesKcal: NutrientRangeValue | null;
  proteinG: NutrientRangeValue | null;
  carbohydrateG: NutrientRangeValue | null;
  totalFatG: NutrientRangeValue | null;
  saturatedFatG: NutrientRangeValue | null;
  transFatG: NutrientRangeValue | null;
  freeSugarG: NutrientRangeValue | null;
  fiberG: NutrientRangeValue | null;
  sodiumMg: NutrientRangeValue | null;
  fruitVegetableG: NutrientRangeValue | null;
}

export interface MealComponentWrite {
  id: string;
  name: string;
  category: FoodCategory;
  preparationTags: readonly string[];
  sortOrder: number;
  estimatedGrams: NutrientRangeValue | null;
  confidence: number;
  nutrients: StoredNutrientTotals;
  assumptions: readonly string[];
}

export interface MealAnalysisMetadataWrite {
  id: string;
  providerId: string;
  providerKind: string;
  model: string;
  endpointHost: string | null;
  providerRequestId: string | null;
  analysisSchemaVersion: string;
  promptVersion: string;
  status: "ok";
  requestStartedAtUtc: string | null;
  receivedAtUtc: string;
  latencyMs: number;
  /** Validated structured AI result only; never a raw HTTP body, key, or image. */
  normalizedResult: Readonly<Record<string, unknown>>;
  assumptions: readonly string[];
  warnings: readonly string[];
}

export interface MealWrite {
  id: string;
  capturedAtUtc: string;
  localDate: string;
  timeZone: string;
  utcOffsetMinutes: number;
  mealName: string;
  mealSlot: string | null;
  recordStatus: MealRecordStatus;
  confirmedAtUtc: string;
  confidence: number;
  dataCoverage: number;
  nutrients: StoredNutrientTotals;
  nutrientEvidence: NutrientEvidenceMap;
  /** Local sandbox URI only. Image bytes are never stored in SQLite. */
  photoUri: string | null;
  photoSha256: string | null;
  components: readonly MealComponentWrite[];
  analysis: MealAnalysisMetadataWrite;
}

export interface StoredMeal extends MealWrite {
  revision: number;
  createdAtUtc: string;
  updatedAtUtc: string;
  deletedAtUtc: string | null;
}

export interface ReportWrite {
  id: string;
  periodType: PeriodType;
  periodStartLocalDate: string;
  periodEndLocalDateExclusive: string;
  generatedAtUtc: string;
  score: number;
  scoreConfidence: number;
  dataCoverage: number;
  totals: StoredNutrientTotals;
  scoreResult: Readonly<Record<string, unknown>>;
  /** Validated DietReport contract, without request credentials or photos. */
  normalizedReport: Readonly<Record<string, unknown>>;
  narrative: string;
  recommendations: readonly string[];
  providerId: string;
  providerKind: string;
  model: string;
  providerRequestId: string | null;
  reportSchemaVersion: string;
  promptVersion: string;
  /** Persisted dietary-input epoch captured before the AI request. */
  inputRevision: number;
  /** Exact output locale used by the report prompt. */
  locale: string;
  /** Version of deterministic scoring/target inputs supplied to the prompt. */
  scoreInputVersion: string;
  /** SHA-256 of the exact non-secret aggregate context supplied to the AI. */
  inputFingerprint: string;
}

export interface StoredReport extends ReportWrite {
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface StoredUserProfile {
  id: string;
  birthDate: string | null;
  weightKg: number | null;
  dailyEnergyTargetKcal: number | null;
  populationGroup: PopulationGroup;
  specialConditions: readonly SpecialCondition[];
  locale: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export type UserProfileWrite = Omit<StoredUserProfile, "createdAtUtc" | "updatedAtUtc">;

export interface SettingRecord<T = unknown> {
  key: string;
  value: T;
  updatedAtUtc: string;
}

export interface DiaryDayStatus {
  localDate: string;
  isComplete: boolean;
  completedAtUtc: string | null;
  updatedAtUtc: string | null;
}

export interface MealListOptions {
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
}

export interface ApiSecretStatus {
  providerId: string;
  configured: boolean;
  last4: string | null;
  masked: string | null;
}

export interface PortableMealExport {
  id: string;
  capturedAtUtc: string;
  localDate: string;
  timeZone: string;
  utcOffsetMinutes: number;
  mealName: string;
  mealSlot: string | null;
  recordStatus: MealRecordStatus;
  confirmedAtUtc: string;
  confidence: number;
  dataCoverage: number;
  nutrients: StoredNutrientTotals;
  nutrientEvidence: NutrientEvidenceMap;
  components: readonly MealComponentWrite[];
  analysis: {
    assumptions: readonly string[];
    warnings: readonly string[];
  };
}

export interface PortableReportExport {
  id: string;
  periodType: PeriodType;
  periodStartLocalDate: string;
  periodEndLocalDateExclusive: string;
  generatedAtUtc: string;
  score: number;
  scoreConfidence: number;
  dataCoverage: number;
  totals: StoredNutrientTotals;
  narrative: string;
  recommendations: readonly string[];
}

export interface PortableDataExport {
  format: "diet-steward-export";
  formatVersion: 2;
  schemaVersion: number;
  exportedAtUtc: string;
  privacy: {
    containsApiSecrets: false;
    containsRawPhotos: false;
  };
  profile: StoredUserProfile | null;
  settings: readonly SettingRecord[];
  diaryDays: readonly DiaryDayStatus[];
  meals: readonly PortableMealExport[];
  reports: readonly PortableReportExport[];
}
