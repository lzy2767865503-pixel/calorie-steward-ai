import { assertValidRange } from "./rowMappers";
import type {
  MealAnalysisMetadataWrite,
  MealWrite,
  ReportWrite,
  StoredNutrientTotals,
} from "./types";

const LOCAL_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SENSITIVE_FIELD_PATTERN = /^(?:authorization|api[_-]?key|access[_-]?token|refresh[_-]?token|secret|password|credential|image[_-]?base64|photo[_-]?base64|raw[_-]?image)$/i;

export function assertLocalDate(value: string, fieldName = "localDate"): void {
  if (!LOCAL_DATE_PATTERN.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${fieldName} is not a real calendar date.`);
  }
}

export function assertUtcTimestamp(value: string, fieldName: string): void {
  if (!value.endsWith("Z") || Number.isNaN(Date.parse(value))) {
    throw new Error(`${fieldName} must be an ISO-8601 UTC timestamp ending in Z.`);
  }
}

export function assertUnitInterval(value: number, fieldName: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0 and 1.`);
  }
}

export function assertScore(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("score must be between 0 and 100.");
  }
}

export function assertNutrients(nutrients: StoredNutrientTotals): void {
  for (const [name, range] of Object.entries(nutrients)) {
    assertValidRange(range, name);
  }
}

export function assertNoSensitivePayload(
  value: unknown,
  fieldName = "payload",
  seen = new Set<object>(),
): void {
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) throw new Error(`${fieldName} must not contain cycles.`);
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      assertNoSensitivePayload(item, `${fieldName}[${index}]`, seen),
    );
  } else {
    for (const [key, nested] of Object.entries(value)) {
      if (SENSITIVE_FIELD_PATTERN.test(key)) {
        throw new Error(`${fieldName} contains forbidden sensitive field ${key}.`);
      }
      assertNoSensitivePayload(nested, `${fieldName}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function assertNonBlank(value: string, fieldName: string): void {
  if (!value.trim()) throw new Error(`${fieldName} must not be blank.`);
}

function assertAnalysis(analysis: MealAnalysisMetadataWrite): void {
  if (analysis.status !== "ok") {
    throw new Error("Only status=ok AI analyses may become permanent meal records.");
  }
  assertNonBlank(analysis.id, "analysis.id");
  assertNonBlank(analysis.providerId, "analysis.providerId");
  assertNonBlank(analysis.providerKind, "analysis.providerKind");
  assertNonBlank(analysis.model, "analysis.model");
  assertNonBlank(analysis.analysisSchemaVersion, "analysis.analysisSchemaVersion");
  assertNonBlank(analysis.promptVersion, "analysis.promptVersion");
  if (analysis.endpointHost && /[\/@?#]/.test(analysis.endpointHost)) {
    throw new Error("analysis.endpointHost must be a host name only, without URL path or credentials.");
  }
  if (!Number.isInteger(analysis.latencyMs) || analysis.latencyMs < 0) {
    throw new Error("analysis.latencyMs must be a non-negative integer.");
  }
  if (analysis.requestStartedAtUtc) {
    assertUtcTimestamp(analysis.requestStartedAtUtc, "analysis.requestStartedAtUtc");
  }
  assertUtcTimestamp(analysis.receivedAtUtc, "analysis.receivedAtUtc");
  assertNoSensitivePayload(analysis.normalizedResult, "analysis.normalizedResult");
}

export function assertMealWrite(meal: MealWrite): void {
  assertNonBlank(meal.id, "meal.id");
  assertUtcTimestamp(meal.capturedAtUtc, "meal.capturedAtUtc");
  assertUtcTimestamp(meal.confirmedAtUtc, "meal.confirmedAtUtc");
  assertLocalDate(meal.localDate);
  assertNonBlank(meal.timeZone, "meal.timeZone");
  assertNonBlank(meal.mealName, "meal.mealName");
  if (
    !Number.isInteger(meal.utcOffsetMinutes) ||
    meal.utcOffsetMinutes < -840 ||
    meal.utcOffsetMinutes > 840
  ) {
    throw new Error("meal.utcOffsetMinutes is outside the valid timezone range.");
  }
  assertUnitInterval(meal.confidence, "meal.confidence");
  assertUnitInterval(meal.dataCoverage, "meal.dataCoverage");
  assertNutrients(meal.nutrients);
  assertNoSensitivePayload(meal.nutrientEvidence, "meal.nutrientEvidence");
  if (meal.photoUri !== null && !meal.photoUri.startsWith("file://")) {
    throw new Error("Raw or remote photos must not be stored in SQLite; save only a sandbox file URI.");
  }
  if (meal.photoSha256 && !/^[a-f0-9]{64}$/i.test(meal.photoSha256)) {
    throw new Error("meal.photoSha256 must be a hexadecimal SHA-256 digest.");
  }
  if ((meal.photoUri === null) !== (meal.photoSha256 === null)) {
    throw new Error("meal.photoUri and meal.photoSha256 must either both exist or both be null.");
  }
  const componentIds = new Set<string>();
  for (const component of meal.components) {
    assertNonBlank(component.id, "component.id");
    if (componentIds.has(component.id)) throw new Error(`Duplicate component id ${component.id}.`);
    componentIds.add(component.id);
    assertNonBlank(component.name, "component.name");
    if (component.preparationTags.some((tag) => !tag.trim())) {
      throw new Error("component.preparationTags must not contain blank values.");
    }
    if (!Number.isInteger(component.sortOrder) || component.sortOrder < 0) {
      throw new Error("component.sortOrder must be a non-negative integer.");
    }
    assertUnitInterval(component.confidence, "component.confidence");
    assertValidRange(component.estimatedGrams, "component.estimatedGrams");
    assertNutrients(component.nutrients);
  }
  assertAnalysis(meal.analysis);
}

export function assertReportWrite(report: ReportWrite): void {
  assertNonBlank(report.id, "report.id");
  assertNonBlank(report.providerId, "report.providerId");
  assertNonBlank(report.providerKind, "report.providerKind");
  assertNonBlank(report.model, "report.model");
  assertNonBlank(report.promptVersion, "report.promptVersion");
  assertNonBlank(report.reportSchemaVersion, "report.reportSchemaVersion");
  assertNonBlank(report.locale, "report.locale");
  assertNonBlank(report.scoreInputVersion, "report.scoreInputVersion");
  if (!/^[a-f0-9]{64}$/i.test(report.inputFingerprint)) {
    throw new Error("report.inputFingerprint must be a SHA-256 digest.");
  }
  if (!Number.isSafeInteger(report.inputRevision) || report.inputRevision < 1) {
    throw new Error("report.inputRevision must be a positive safe integer.");
  }
  assertLocalDate(report.periodStartLocalDate, "report.periodStartLocalDate");
  assertLocalDate(report.periodEndLocalDateExclusive, "report.periodEndLocalDateExclusive");
  if (report.periodStartLocalDate >= report.periodEndLocalDateExclusive) {
    throw new Error("Report period end must be after its start.");
  }
  assertUtcTimestamp(report.generatedAtUtc, "report.generatedAtUtc");
  assertScore(report.score);
  assertUnitInterval(report.scoreConfidence, "report.scoreConfidence");
  assertUnitInterval(report.dataCoverage, "report.dataCoverage");
  assertNutrients(report.totals);
  assertNoSensitivePayload(report.scoreResult, "report.scoreResult");
  assertNoSensitivePayload(report.normalizedReport, "report.normalizedReport");
}
