import { CryptoDigestAlgorithm, digestStringAsync, randomUUID } from "expo-crypto";
import * as Sharing from "expo-sharing";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import {
  createAiProvider,
  REPORT_PROMPT_VERSION,
  type AiCallResult,
  type DietReportV1,
  type MealAnalysisV1,
  type ReportContextV1,
  type ReportMetricClassification,
  type ReportMetricId,
  type ReportMetricInputV1,
} from "./src/ai";
import {
  AI_CONFIG_SETTING_KEY,
  RETAIN_PHOTOS_SETTING_KEY,
  canReuseSavedCredential,
  credentialScopeForSaved,
  draftConsentCoversCredentialScope,
  endpointHost,
  hasCurrentDataTransferConsent,
  hasScopedCredentialId,
  providerConfigFromDraft,
  savedConfigurationToDraft,
  type SavedAiConfiguration,
} from "./src/app/providerConfig";
import {
  API_PROVIDER_TRANSITION_SETTING_KEY,
  EnterpriseTransitionPendingError,
  createPendingEnterpriseTransition,
  isPendingEnterpriseTransition,
  recoverTransitionTargetProviderId,
  executeEnterpriseTransition,
  resumeEnterpriseTransition,
} from "./src/app/providerTransitionLifecycle";
import {
  currentReportCacheExpectation,
  REPORT_SCHEMA_VERSION,
  REPORT_SCORE_INPUT_VERSION,
} from "./src/app/reportCachePolicy";
import { deviceTimeZone, formatLocalDateChinese, localDateFor, todayLocalDate, utcOffsetMinutesNow } from "./src/app/dates";
import { userFacingError } from "./src/app/errors";
import {
  MealCommitFlowError,
  MealCommitIndeterminateError,
  commitMealAfterTemporaryPhotoCleanup,
  refreshAfterCommittedMeal,
} from "./src/app/mealCommit";
import { analysisToReview, createMealWrite } from "./src/app/mealMapping";
import { reconcileTransientCaptureFiles } from "./src/app/captureLifecycle";
import {
  PENDING_PRIVATE_FILE_CLEANUP_SETTING_KEY,
  createPendingFileCleanupManager,
} from "./src/app/pendingFileCleanup";
import {
  createExportFileUri,
  deleteLocalPhoto,
  listRetainedMealPhotoUris,
  listTransientCapturePhotoUris,
  privateFileCleanupRoots,
  retainMealPhoto,
  writeExportFile,
} from "./src/app/photoFiles";
import {
  countMealsInDiaryDays,
  homeSummaryView,
  periodSummaryView,
} from "./src/app/summaryViews";
import {
  addCalendarDays,
  createCalendarPeriod,
  evaluateCalendarPeriod,
} from "./src/domain/periods";
import type {
  NutrientRange,
  PeriodEvaluation,
  ScoreMetricKey,
  UserProfile,
} from "./src/domain/types";
import { AnalysisScreen } from "./src/screens/AnalysisScreen";
import {
  ApiSetupScreen,
  type ApiSetupDraft,
} from "./src/screens/ApiSetupScreen";
import { CameraScreen, type PreparedPhoto } from "./src/screens/CameraScreen";
import {
  HomeScreen,
  type HomeMealView,
  type HomeSummaryView,
} from "./src/screens/HomeScreen";
import {
  ReportsScreen,
  type GeneratedReportView,
  type PeriodSummaryView,
  type ReportPeriod,
} from "./src/screens/ReportsScreen";
import { ReviewScreen } from "./src/screens/ReviewScreen";
import {
  SettingsScreen,
  type ProfileDraft,
} from "./src/screens/SettingsScreen";
import {
  advanceReportInputRevision,
  beginApiConfigurationTransition,
  commitApiConfigurationTransition,
  createPortableDataExport,
  deleteSetting,
  getApiSecretStatus,
  getDatabase,
  getLatestReport,
  getMealById,
  getMostRecentlyUpdatedProfile,
  getSetting,
  getReportInputRevision,
  listMealsByLocalDateRange,
  loadDiaryDay,
  loadDiaryDays,
  readApiSecret,
  replaceApiSecret,
  retireApiConfiguration,
  retryPendingApiSecretCleanups,
  purgeMeal,
  saveMealBundle,
  saveProfile,
  saveReport,
  setDiaryDayComplete,
  setSetting,
  stageApiSecretCleanup,
  storedProfileToDomain,
  type StoredMeal,
  type StoredNutrientTotals,
  type StoredReport,
} from "./src/storage";
import type { BottomTab } from "./src/ui/components";
import { colors, spacing, textStyles } from "./src/ui/theme";
import { officialAttribution } from "./src/brand/officialAttribution";
import {
  I18nProvider,
  LANGUAGE_PREFERENCE_SETTING_KEY,
  copy as localizedCopy,
  localeTag,
  resolveLanguage,
  systemLanguage,
  useI18n,
  type AppLanguage,
  type LanguagePreference,
} from "./src/i18n";

type AppScreen = "boot" | "setup" | "home" | "camera" | "analysis" | "review" | "reports" | "settings";

function emptyHome(language: AppLanguage): HomeSummaryView {
  return {
  calories: 0,
  caloriesLower: 0,
  caloriesUpper: 0,
  proteinG: null,
  carbohydrateG: null,
  fatG: null,
  fruitVegetableG: null,
  fiberG: null,
  score: null,
  scoreLower: null,
  scoreUpper: null,
  scoreCoverage: 0,
  scoreLabel: localizedCopy(language, "资料不足", "Insufficient data"),
  recordedMeals: 0,
  };
}

const DEFAULT_PROFILE: UserProfile = {
  id: "primary-profile",
  populationGroup: "healthy_adult",
  birthDate: null,
  weightKg: null,
  dailyEnergyTargetKcal: null,
  specialConditions: [],
};

const pendingPrivateFileCleanup = createPendingFileCleanupManager({
  roots: privateFileCleanupRoots,
  read: () => getSetting<unknown>(PENDING_PRIVATE_FILE_CLEANUP_SETTING_KEY),
  write: async (uris) => {
    await setSetting(PENDING_PRIVATE_FILE_CLEANUP_SETTING_KEY, [...uris]);
  },
  remove: async () => {
    await deleteSetting(PENDING_PRIVATE_FILE_CLEANUP_SETTING_KEY);
  },
  deleteFile: deleteLocalPhoto,
});

let startupOrphanReconciliationComplete = false;
let startupTransientCaptureReconciliationComplete = false;

async function reconcileOrphanedRetainedMealPhotos(): Promise<number> {
  if (startupOrphanReconciliationComplete) return 0;
  const database = await getDatabase();
  const [files, rows] = await Promise.all([
    listRetainedMealPhotoUris(),
    database.getAllAsync<{ photo_uri: string }>(
      "SELECT photo_uri FROM meals WHERE photo_uri IS NOT NULL",
    ),
  ]);
  const referenced = new Set(rows.map((row) => row.photo_uri));
  const orphaned = files.filter((uri) => !referenced.has(uri));
  for (const uri of orphaned) {
    // A crash at any point is safe: the next launch scans the fixed private
    // directory again, and deletion itself verifies that the file is absent.
    await deleteLocalPhoto(uri);
  }
  startupOrphanReconciliationComplete = true;
  return orphaned.length;
}

async function requirePendingPrivateFileCleanup(language: AppLanguage = "zh"): Promise<void> {
  if (!startupTransientCaptureReconciliationComplete) {
    const captureResult = await reconcileTransientCaptureFiles({
      list: listTransientCapturePhotoUris,
      cleanup: pendingPrivateFileCleanup,
    });
    if (captureResult.remaining > 0) {
      throw new Error(localizedCopy(
        language,
        `有 ${captureResult.remaining} 个拍摄临时文件尚未确认删除。为保护数据，App 已暂停拍照与导出；请重启后重试。`,
        `${captureResult.remaining} temporary capture files have not been confirmed deleted. Camera and export are paused to protect your data; restart and try again.`,
      ));
    }
    startupTransientCaptureReconciliationComplete = true;
  }
  const result = await pendingPrivateFileCleanup.retryAll();
  if (result.remaining > 0) {
    throw new Error(localizedCopy(
      language,
      `有 ${result.remaining} 个私密临时文件尚未删除。为保护数据，App 已暂停拍照与导出；请重启后重试。`,
      `${result.remaining} private temporary files have not been deleted. Camera and export are paused to protect your data; restart and try again.`,
    ));
  }
  await reconcileOrphanedRetainedMealPhotos();
}

/**
 * Enterprise-managed mode cannot retain meal photos. Files are erased before
 * their database references so an interrupted cleanup remains retryable on
 * the next launch or setup save.
 */
async function purgeAllRetainedMealPhotos(language: AppLanguage = "zh"): Promise<number> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ id: string; photo_uri: string }>(
    "SELECT id, photo_uri FROM meals WHERE photo_uri IS NOT NULL ORDER BY id",
  );
  if (rows.length === 0) return 0;

  const deletions = await Promise.allSettled(
    rows.map(({ photo_uri }) => deleteLocalPhoto(photo_uri)),
  );
  const failed = deletions.filter((result) => result.status === "rejected").length;
  if (failed > 0) {
    throw new Error(localizedCopy(
      language,
      `有 ${failed} 个历史照片文件未能删除。数据库引用仍保留，可重试；企业模式尚未启用。`,
      `${failed} historical photo files could not be deleted. Database references were retained for retry, and enterprise mode was not enabled.`,
    ));
  }

  const now = new Date().toISOString();
  await database.withExclusiveTransactionAsync(async (transaction) => {
    const updated = await transaction.runAsync(
      `UPDATE meals
       SET photo_uri = NULL,
           photo_sha256 = NULL,
           revision = revision + 1,
           updated_at_utc = ?
       WHERE photo_uri IS NOT NULL`,
      now,
    );
    if (updated.changes > 0) {
      await advanceReportInputRevision(transaction, now);
    }
  });
  const remaining = await database.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) AS count FROM meals WHERE photo_uri IS NOT NULL OR photo_sha256 IS NOT NULL",
  );
  if (!remaining || remaining.count !== 0) {
    throw new Error(localizedCopy(
      language,
      "历史照片清理尚未完成；企业配置不会提交，下次启动会从持久日志继续。",
      "Historical-photo cleanup is incomplete. Enterprise configuration will not be committed and the durable journal will resume it on next startup.",
    ));
  }
  return rows.length;
}

function profileToDraft(profile: UserProfile): ProfileDraft {
  return {
    weightKg: profile.weightKg === null ? "" : String(profile.weightKg),
    dailyEnergyTargetKcal:
      profile.dailyEnergyTargetKcal === null ? "" : String(profile.dailyEnergyTargetKcal),
    populationGroup: profile.populationGroup,
  };
}

function providerDisplayName(value: string, language: AppLanguage): string {
  if (value === "\u4f01\u4e1a\u6258\u7ba1\u7f51\u5173") return localizedCopy(language, value, "Enterprise-managed gateway");
  if (value === "OpenAI \u517c\u5bb9\u63a5\u53e3") return localizedCopy(language, value, "OpenAI-compatible API");
  return value;
}

function periodDisplayLabel(period: ReportPeriod, evaluation: PeriodEvaluation, language: AppLanguage): string {
  if (period === "day") return formatLocalDateChinese(evaluation.period.startDate, localeTag(language));
  if (period === "week") return localizedCopy(language, `${evaluation.period.startDate} 至 ${evaluation.period.endDate}`, `${evaluation.period.startDate} to ${evaluation.period.endDate}`);
  if (period === "month") return localizedCopy(language, `${evaluation.period.startDate.slice(0, 7)} 月报`, `${evaluation.period.startDate.slice(0, 7)} monthly report`);
  return localizedCopy(language, `${evaluation.period.startDate.slice(0, 4)} 年报`, `${evaluation.period.startDate.slice(0, 4)} yearly report`);
}

function effectivePeriodEnd(evaluation: PeriodEvaluation): string {
  return evaluation.period.endDate < evaluation.period.asOfDate
    ? evaluation.period.endDate
    : evaluation.period.asOfDate;
}

function rangeCoverage(observed: number, eligible: number): number {
  return eligible <= 0 ? 0 : Math.max(0, Math.min(1, observed / eligible));
}

function classifyMetric(args: {
  value: NutrientRange;
  targetMin: number | null;
  targetMax: number | null;
  coverage: number;
  confidence: number;
}): ReportMetricClassification {
  if (args.coverage === 0 || args.confidence === 0) return "insufficient_data";
  if (args.targetMin !== null && args.value.high < args.targetMin) return "below_target";
  if (args.targetMax !== null && args.value.low > args.targetMax) return "above_target";
  if (
    (args.targetMin !== null && args.value.low < args.targetMin) ||
    (args.targetMax !== null && args.value.high > args.targetMax)
  ) {
    return "indeterminate";
  }
  return args.targetMin !== null || args.targetMax !== null ? "within_target" : "no_target";
}

const SCORE_METRIC_TO_REPORT: Readonly<Record<ScoreMetricKey, ReportMetricId>> = {
  fruit_vegetables: "fruit_vegetable",
  fiber: "fiber",
  carbohydrate_share: "carbohydrate",
  protein_adequacy: "protein",
  total_fat_share: "fat",
  saturated_fat_share: "saturated_fat",
  trans_fat_share: "trans_fat",
  free_sugar_share: "free_sugars",
  sodium: "sodium",
};

function reportContext(args: {
  evaluation: PeriodEvaluation;
  period: ReportPeriod;
  profile: UserProfile;
  mealCount: number;
  timeZone: string;
  language: AppLanguage;
}): ReportContextV1 {
  const { evaluation } = args;
  const aggregate = evaluation.aggregate;
  const score = evaluation.score.score;
  if (score === null) throw new Error(localizedCopy(args.language, "当前资料不足，无法生成可审计的 AI 报告。", "There is not enough data to generate an auditable AI report."));

  const metrics: ReportMetricInputV1[] = [];
  const addMetric = (
    metricId: ReportMetricId,
    unit: string,
    value: NutrientRange | null,
    observed: number,
    eligible: number,
    targetMin: number | null,
    targetMax: number | null,
  ) => {
    if (value === null) return;
    const coverage = rangeCoverage(observed, eligible);
    const confidence = Math.max(0, Math.min(1, coverage * (1 - Math.min(1, (value.high - value.low) / Math.max(value.estimate, 1)))));
    metrics.push({
      metric_id: metricId,
      unit,
      available: true,
      value: value.estimate,
      lower: value.low,
      upper: value.high,
      target_min_available: targetMin !== null,
      target_min: targetMin ?? 0,
      target_max_available: targetMax !== null,
      target_max: targetMax ?? 0,
      trend: "insufficient_data",
      coverage,
      confidence,
      classification: classifyMetric({ value, targetMin, targetMax, coverage, confidence }),
    });
  };

  addMetric(
    "energy",
    "kcal/day",
    aggregate.nutrients.caloriesKcal.dailyAverage,
    aggregate.nutrients.caloriesKcal.observedDayCount,
    aggregate.nutrients.caloriesKcal.eligibleDayCount,
    args.profile.dailyEnergyTargetKcal,
    args.profile.dailyEnergyTargetKcal,
  );
  addMetric("protein", "g/day", aggregate.nutrients.proteinG.dailyAverage, aggregate.nutrients.proteinG.observedDayCount, aggregate.nutrients.proteinG.eligibleDayCount, args.profile.weightKg === null ? null : args.profile.weightKg * 0.83, null);
  addMetric("carbohydrate", "% energy", aggregate.energyShares.carbohydrate.energyPercent, aggregate.energyShares.carbohydrate.observedDayCount, aggregate.energyShares.carbohydrate.eligibleDayCount, 45, 75);
  addMetric("fat", "% energy", aggregate.energyShares.totalFat.energyPercent, aggregate.energyShares.totalFat.observedDayCount, aggregate.energyShares.totalFat.eligibleDayCount, 15, 30);
  addMetric("saturated_fat", "% energy", aggregate.energyShares.saturatedFat.energyPercent, aggregate.energyShares.saturatedFat.observedDayCount, aggregate.energyShares.saturatedFat.eligibleDayCount, null, 10);
  addMetric("trans_fat", "% energy", aggregate.energyShares.transFat.energyPercent, aggregate.energyShares.transFat.observedDayCount, aggregate.energyShares.transFat.eligibleDayCount, null, 1);
  addMetric("free_sugars", "% energy", aggregate.energyShares.freeSugar.energyPercent, aggregate.energyShares.freeSugar.observedDayCount, aggregate.energyShares.freeSugar.eligibleDayCount, null, 10);
  addMetric("fiber", "g/day", aggregate.nutrients.fiberG.dailyAverage, aggregate.nutrients.fiberG.observedDayCount, aggregate.nutrients.fiberG.eligibleDayCount, 25, null);
  addMetric("sodium", "mg/day", aggregate.nutrients.sodiumMg.dailyAverage, aggregate.nutrients.sodiumMg.observedDayCount, aggregate.nutrients.sodiumMg.eligibleDayCount, null, 2000);
  addMetric("fruit_vegetable", "g/day", aggregate.nutrients.fruitVegetableG.dailyAverage, aggregate.nutrients.fruitVegetableG.observedDayCount, aggregate.nutrients.fruitVegetableG.eligibleDayCount, 400, null);
  addMetric("data_coverage", "ratio", { low: evaluation.score.coverage, estimate: evaluation.score.coverage, high: evaluation.score.coverage }, evaluation.completeDayCount, evaluation.elapsedDayCount, 0.7, null);
  addMetric("health_score", "score/100", score, evaluation.completeDayCount, evaluation.elapsedDayCount, 70, 100);

  return {
    period: args.period,
    period_start: evaluation.period.startDate,
    period_end: effectivePeriodEnd(evaluation),
    locale: localeTag(args.language),
    timezone: args.timeZone,
    logged_days: evaluation.completeDayCount,
    expected_days: evaluation.elapsedDayCount,
    meal_count: args.mealCount,
    health_score: score.estimate,
    data_coverage: evaluation.score.coverage,
    goal:
      args.profile.dailyEnergyTargetKcal === null
        ? localizedCopy(args.language, "WHO/FAO 健康成人通用饮食结构参考", "WHO/FAO general healthy-adult diet structure reference")
        : localizedCopy(args.language, `用户设置的热量参考 ${args.profile.dailyEnergyTargetKcal} kcal/day`, `User calorie reference ${args.profile.dailyEnergyTargetKcal} kcal/day`),
    dietary_preferences: [],
    metrics,
    score_components: evaluation.score.metrics
      .filter((metric) => metric.score !== null)
      .map((metric) => ({
        metric_id: SCORE_METRIC_TO_REPORT[metric.key],
        score: metric.score?.estimate ?? 0,
        weight: metric.weight,
      })),
  };
}

function reportView(data: DietReportV1, generatedAt: string, language: AppLanguage): GeneratedReportView {
  return {
    summary: data.summary,
    patterns: data.patterns.map((pattern) => ({
      kind: pattern.kind === "watch" ? "neutral" : pattern.kind,
      statement: pattern.statement,
      evidence: pattern.evidence,
    })),
    suggestions: data.suggestions.map((suggestion) => ({
      priority: suggestion.priority,
      action: suggestion.action,
      reason: suggestion.reason,
    })),
    uncertaintyNote: data.uncertainty_note,
    generatedAtLabel: localizedCopy(language, `生成于 ${new Intl.DateTimeFormat(localeTag(language), { dateStyle: "medium", timeStyle: "short" }).format(new Date(generatedAt))}`, `Generated ${new Intl.DateTimeFormat(localeTag(language), { dateStyle: "medium", timeStyle: "short" }).format(new Date(generatedAt))}`),
  };
}

function reportFromStored(report: StoredReport | null, language: AppLanguage): GeneratedReportView | null {
  if (!report) return null;
  const value = report.normalizedReport;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const candidate = value as Partial<DietReportV1>;
  if (
    candidate.schema_version !== "diet_report.v1" ||
    typeof candidate.summary !== "string" ||
    !Array.isArray(candidate.patterns) ||
    !Array.isArray(candidate.suggestions) ||
    typeof candidate.uncertainty_note !== "string"
  ) {
    return null;
  }
  const containsChinese = /[\u3400-\u9fff]/u.test(candidate.summary);
  if ((language === "en" && containsChinese) || (language === "zh" && !containsChinese)) {
    return null;
  }
  return reportView(candidate as DietReportV1, report.generatedAtUtc, language);
}

function averagesToStored(evaluation: PeriodEvaluation): StoredNutrientTotals {
  const nutrients = evaluation.aggregate.nutrients;
  return {
    caloriesKcal: nutrients.caloriesKcal.dailyAverage,
    proteinG: nutrients.proteinG.dailyAverage,
    carbohydrateG: nutrients.carbohydrateG.dailyAverage,
    totalFatG: nutrients.totalFatG.dailyAverage,
    saturatedFatG: nutrients.saturatedFatG.dailyAverage,
    transFatG: nutrients.transFatG.dailyAverage,
    freeSugarG: nutrients.freeSugarG.dailyAverage,
    fiberG: nutrients.fiberG.dailyAverage,
    sodiumMg: nutrients.sodiumMg.dailyAverage,
    fruitVegetableG: nutrients.fruitVegetableG.dailyAverage,
  };
}

async function reportInputFingerprint(
  context: ReportContextV1,
  config: SavedAiConfiguration["config"] | null,
): Promise<string> {
  return digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    JSON.stringify({
      context,
      provider: config
        ? {
            id: config.id,
            kind: config.kind,
            baseUrl: config.baseUrl,
            reportModel: config.reportModel,
            authType: config.authType,
          }
        : null,
    }),
  );
}

export default function App() {
  const detectedSystemLanguage = useMemo(systemLanguage, []);
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>("system");
  const language = resolveLanguage(languagePreference, detectedSystemLanguage);
  const [screen, setScreen] = useState<AppScreen>("boot");
  const [returnAfterSetup, setReturnAfterSetup] = useState<AppScreen>("home");
  const [configuration, setConfiguration] = useState<SavedAiConfiguration | null>(null);
  const [providerTransitionBlocking, setProviderTransitionBlocking] = useState(false);
  const [secretHint, setSecretHint] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile>(DEFAULT_PROFILE);
  const [retainPhotos, setRetainPhotos] = useState(false);
  const [homeSummary, setHomeSummary] = useState<HomeSummaryView>(() => emptyHome(language));
  const [homeMeals, setHomeMeals] = useState<HomeMealView[]>([]);
  const [todayComplete, setTodayComplete] = useState(false);
  const [photo, setPhoto] = useState<PreparedPhoto | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AiCallResult<MealAnalysisV1> | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupSaving, setSetupSaving] = useState(false);
  const [savingMeal, setSavingMeal] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [period, setPeriod] = useState<ReportPeriod>("week");
  const [periodSummary, setPeriodSummary] = useState<PeriodSummaryView | null>(null);
  const [periodEvaluation, setPeriodEvaluation] = useState<PeriodEvaluation | null>(null);
  const [periodMealCount, setPeriodMealCount] = useState(0);
  const [periodInputRevision, setPeriodInputRevision] = useState<number | null>(null);
  const [periodInputFingerprint, setPeriodInputFingerprint] = useState<string | null>(null);
  const [generatedReport, setGeneratedReport] = useState<GeneratedReportView | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const analysisRun = useRef(0);
  const reportRun = useRef(0);
  const reportLoadRun = useRef(0);

  const invalidateReportWork = () => {
    reportRun.current += 1;
    reportLoadRun.current += 1;
    setGeneratingReport(false);
    setPeriodInputRevision(null);
    setPeriodInputFingerprint(null);
    setGeneratedReport(null);
  };

  const timeZone = useMemo(deviceTimeZone, []);
  const today = todayLocalDate(timeZone);

  useEffect(() => {
    void bootstrap();
    // The bootstrap is intentionally one-shot; native storage is the source of truth afterwards.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const bootstrap = async () => {
    if (Platform.OS === "web") {
      setSetupError(localizedCopy(language, "浏览器只用于检查首页设计，不接收或保存真实 API Key。请在 Android/iOS App 中配置。", "The browser preview is for interface review only and never accepts or stores a real API key. Configure it in the Android or iOS app."));
      setScreen("setup");
      return;
    }
    let bootstrapLanguage = language;
    try {
      await getDatabase();
      const storedLanguagePreference = await getSetting<LanguagePreference>(LANGUAGE_PREFERENCE_SETTING_KEY);
      const storedPreference = storedLanguagePreference?.value;
      const activePreference: LanguagePreference =
        storedPreference === "zh" || storedPreference === "en" || storedPreference === "system"
          ? storedPreference
          : "system";
      const activeLanguage = resolveLanguage(activePreference, detectedSystemLanguage);
      bootstrapLanguage = activeLanguage;
      setLanguagePreference(activePreference);
      await requirePendingPrivateFileCleanup(activeLanguage);
      const [initialSavedConfig, storedProfile, retainSetting, transitionRecord] = await Promise.all([
        getSetting<SavedAiConfiguration>(AI_CONFIG_SETTING_KEY),
        getMostRecentlyUpdatedProfile(),
        getSetting<boolean>(RETAIN_PHOTOS_SETTING_KEY),
        getSetting<unknown>(API_PROVIDER_TRANSITION_SETTING_KEY),
      ]);
      let savedConfig = initialSavedConfig;
      const transition = transitionRecord?.value;
      if (transition !== undefined && !isPendingEnterpriseTransition(transition)) {
        setConfiguration(savedConfig?.value ?? null);
        setProviderTransitionBlocking(true);
        setSetupError(localizedCopy(
          activeLanguage,
          "检测到损坏的企业切换日志。为避免误删凭据或照片，App 已暂停连接；请重新保存接口设置。",
          "A corrupt enterprise-transition journal was found. Connection is paused to avoid deleting credentials or photos; save the API setup again.",
        ));
        setScreen("setup");
        return;
      }
      const protectedCredentialIds = [
        savedConfig?.value?.config.id,
        transition?.targetConfiguration.config.id,
      ].filter((value): value is string => typeof value === "string");
      await retryPendingApiSecretCleanups(protectedCredentialIds);

      if (transition) {
        const target = transition.targetConfiguration;
        createAiProvider(target.config);
        if (!hasScopedCredentialId(target) || !hasCurrentDataTransferConsent(target)) {
          throw new Error("Pending enterprise transition has invalid credential scope or consent.");
        }
        const targetSecret = await getApiSecretStatus(target.config.id);
        if (!targetSecret.configured) {
          setConfiguration(savedConfig?.value ?? null);
          setProviderTransitionBlocking(true);
          setSetupError(localizedCopy(
            activeLanguage,
            "企业切换曾中断，且目标工作区凭据已丢失。历史照片可能已部分清理；请重新输入工作区 Token 以安全完成。",
            "The enterprise transition was interrupted and its target workspace credential is missing. Historical photos may be partially cleared; re-enter the workspace token to finish safely.",
          ));
          setScreen("setup");
          return;
        }
        try {
          await resumeEnterpriseTransition({
            purgeAndVerifyHistoricalPhotos: async () => {
              await purgeAllRetainedMealPhotos(activeLanguage);
            },
            commitConfigurationAndClearJournal: async () => {
              await commitApiConfigurationTransition(
                AI_CONFIG_SETTING_KEY,
                target,
                target.config.id,
                transition.previousProviderId,
                API_PROVIDER_TRANSITION_SETTING_KEY,
              );
            },
          });
          savedConfig = await getSetting<SavedAiConfiguration>(AI_CONFIG_SETTING_KEY);
          await retryPendingApiSecretCleanups([target.config.id]);
        } catch (error) {
          if (error instanceof EnterpriseTransitionPendingError) {
            setConfiguration(savedConfig?.value ?? null);
            setProviderTransitionBlocking(true);
            setSetupError(localizedCopy(
              activeLanguage,
              "企业切换尚未完成：历史照片可能已部分删除，但旧连接不会被当作正常状态继续使用。持久日志会在下次启动继续清理并提交。",
              "Enterprise transition is incomplete: historical photos may be partially deleted, and the old connection will not be treated as normal. The durable journal will resume cleanup and commit on next startup.",
            ));
            setScreen("setup");
            return;
          }
          throw error;
        }
      }
      let activeProfile = storedProfile ? storedProfileToDomain(storedProfile) : DEFAULT_PROFILE;
      const activeLocale = localeTag(activeLanguage);
      if (!storedProfile || storedProfile.locale !== activeLocale) {
        const synchronized = await saveProfile({ ...activeProfile, locale: activeLocale });
        activeProfile = storedProfileToDomain(synchronized);
      }
      setProfile(activeProfile);
      const managed = savedConfig?.value?.setupProviderKind === "enterprise";
      if (managed) {
        await purgeAllRetainedMealPhotos(activeLanguage);
      }
      const mayRetainPhotos = !managed && retainSetting?.value === true;
      setRetainPhotos(mayRetainPhotos);
      if (managed && retainSetting?.value === true) {
        await setSetting(RETAIN_PHOTOS_SETTING_KEY, false);
      }

      if (savedConfig?.value) {
        createAiProvider(savedConfig.value.config);
        if (!hasScopedCredentialId(savedConfig.value)) {
          setConfiguration(savedConfig.value);
          setSecretHint(null);
          setSetupError(localizedCopy(activeLanguage, "安全升级后，旧凭据无法证明属于当前接口。请重新输入该服务的 API 凭据并确认发送目标。", "After the security upgrade, the saved credential cannot be proven to belong to this endpoint. Re-enter a credential for this service and confirm the transfer destination."));
          setScreen("setup");
          return;
        }
        const secret = await getApiSecretStatus(savedConfig.value.config.id);
        if (!secret.configured) {
          setSetupError(localizedCopy(activeLanguage, "找到 API 配置，但 Keychain/Keystore 中没有对应凭据。", "An API configuration was found, but its credential is missing from Keychain/Keystore."));
          setScreen("setup");
          return;
        }
        if (!hasCurrentDataTransferConsent(savedConfig.value)) {
          setConfiguration(savedConfig.value);
          setSecretHint(secret.masked);
          setSetupError(localizedCopy(activeLanguage, "数据发送说明已升级：AI 报告还会发送聚合饮食指标。请确认当前网关和两类数据后继续。", "The data-transfer notice has changed: AI reports also send aggregated diet metrics. Confirm the current gateway and both data categories to continue."));
          setScreen("setup");
          return;
        }
        setConfiguration(savedConfig.value);
        setSecretHint(secret.masked);
        await refreshToday(activeProfile, activeLanguage);
        setScreen("home");
      } else {
        setScreen("setup");
      }
    } catch (error) {
      setSetupError(userFacingError(error, bootstrapLanguage));
      setScreen("setup");
    }
  };

  const refreshToday = async (activeProfile = profile, activeLanguage = language) => {
    if (Platform.OS === "web") return;
    const [day, storedMeals] = await Promise.all([
      loadDiaryDay(today),
      listMealsByLocalDateRange(today, addCalendarDays(today, 1), { limit: 5_000 }),
    ]);
    const view = homeSummaryView(day, storedMeals, activeProfile, activeLanguage);
    setHomeSummary(view.summary);
    setHomeMeals(view.meals);
    setTodayComplete(day.isComplete);
  };

  const saveApiSetup = async (draft: ApiSetupDraft) => {
    if (Platform.OS === "web") {
      setSetupError(localizedCopy(language, "为避免密钥落入浏览器存储，预览版禁止保存。请使用 Android/iOS App。", "Saving is disabled in the browser preview so credentials never enter browser storage. Use the Android or iOS app."));
      return;
    }
    invalidateReportWork();
    setSetupSaving(true);
    setSetupError(null);
    let stagedCredentialId: string | null = null;
    let previousSecretForRollback: string | null = null;
    let configurationCommitted = false;
    let transitionJournalCommitted = false;
    try {
      await requirePendingPrivateFileCleanup(language);
      const existingTransitionRecord = await getSetting<unknown>(API_PROVIDER_TRANSITION_SETTING_KEY);
      const existingTransition = isPendingEnterpriseTransition(existingTransitionRecord?.value)
        ? existingTransitionRecord.value
        : null;
      const priorTransitionTargetId = recoverTransitionTargetProviderId(
        existingTransitionRecord?.value,
      );
      const next = providerConfigFromDraft(draft, {
        previous: configuration,
        newCredentialId: `provider-${randomUUID()}`,
      });
      createAiProvider(next.config);
      if (
        !draftConsentCoversCredentialScope(draft) ||
        draft.consentScope !== credentialScopeForSaved(next)
      ) {
        throw new Error(localizedCopy(language, "接口或发送目标已变更，请重新确认照片发送范围和费用责任。", "The endpoint or transfer destination changed. Confirm the photo scope and billing responsibility again."));
      }
      const mayReuseExistingCredential = canReuseSavedCredential(configuration, draft);
      const previousCredentialId =
        configuration?.config.id ?? existingTransition?.previousProviderId ?? null;
      let nextSecretHint: string;
      if (draft.apiKey.trim()) {
        if (previousCredentialId === next.config.id) {
          previousSecretForRollback = await readApiSecret(next.config.id);
        } else {
          // Register the fresh id before writing SecureStore. If the process
          // stops before config commit, startup can erase the staged orphan.
          await stageApiSecretCleanup(next.config.id);
        }
        stagedCredentialId = next.config.id;
        const status = await replaceApiSecret(next.config.id, draft.apiKey);
        if (!status.masked) throw new Error(localizedCopy(language, "新 API 凭据未能安全保存。", "The new API credential could not be stored securely."));
        nextSecretHint = status.masked;
      } else {
        if (!mayReuseExistingCredential) {
          throw new Error(localizedCopy(language, "接口、域名或鉴权方式已变更，请输入该目标专用的新 API 凭据。", "The endpoint, domain, or authentication method changed. Enter a new credential dedicated to this destination."));
        }
        const status = await getApiSecretStatus(next.config.id);
        if (!status.configured || !status.masked) throw new Error(localizedCopy(language, "未找到可保留的 API 凭据。", "No reusable API credential was found."));
        nextSecretHint = status.masked;
      }

      const enteringEnterprise =
        next.setupProviderKind === "enterprise" &&
        configuration?.setupProviderKind !== "enterprise";
      if (enteringEnterprise) {
        const journal = createPendingEnterpriseTransition({
          targetConfiguration: next,
          previousProviderId: previousCredentialId,
        });
        if (
          priorTransitionTargetId &&
          priorTransitionTargetId !== next.config.id
        ) {
          await stageApiSecretCleanup(priorTransitionTargetId);
        }
        await executeEnterpriseTransition({
          persistJournal: async () => {
            await beginApiConfigurationTransition(
              API_PROVIDER_TRANSITION_SETTING_KEY,
              journal,
              next.config.id,
            );
            transitionJournalCommitted = true;
          },
          purgeAndVerifyHistoricalPhotos: async () => {
            await purgeAllRetainedMealPhotos(language);
          },
          commitConfigurationAndClearJournal: async () => {
            await commitApiConfigurationTransition(
              AI_CONFIG_SETTING_KEY,
              next,
              next.config.id,
              previousCredentialId,
              API_PROVIDER_TRANSITION_SETTING_KEY,
            );
          },
        });
      } else {
        if (
          priorTransitionTargetId &&
          priorTransitionTargetId !== next.config.id
        ) {
          await stageApiSecretCleanup(priorTransitionTargetId);
        }
        if (next.setupProviderKind === "enterprise") {
          await purgeAllRetainedMealPhotos(language);
        }
        await commitApiConfigurationTransition(
          AI_CONFIG_SETTING_KEY,
          next,
          next.config.id,
          previousCredentialId,
          existingTransitionRecord ? API_PROVIDER_TRANSITION_SETTING_KEY : null,
        );
      }
      configurationCommitted = true;
      if (next.setupProviderKind === "enterprise") {
        setRetainPhotos(false);
        try {
          await setSetting(RETAIN_PHOTOS_SETTING_KEY, false);
        } catch {
          Alert.alert(localizedCopy(language, "照片策略待同步", "Photo policy sync pending"), localizedCopy(language, "企业模式已启用且本次不会保留照片；本机设置将在下次启动时再次修正。", "Enterprise mode is active and this photo will not be retained. The local setting will be corrected again at the next launch."));
        }
      }
      const cleanup = await retryPendingApiSecretCleanups([next.config.id]);
      if (cleanup.remaining > 0) {
        Alert.alert(
          localizedCopy(language, "旧凭据待自动清理", "Old credential cleanup pending"),
          localizedCopy(language, "新连接已保存。旧作用域凭据的标识已保留在本机重试队列，下次启动会继续删除。", "The new connection is saved. The old scoped credential id remains in the on-device retry queue and deletion will resume at next startup."),
        );
      }
      setSecretHint(nextSecretHint);
      setConfiguration(next);
      setProviderTransitionBlocking(false);
      setScreen("camera");
    } catch (error) {
      if (!configurationCommitted && stagedCredentialId && !transitionJournalCommitted) {
        if (previousSecretForRollback !== null) {
          await replaceApiSecret(stagedCredentialId, previousSecretForRollback).catch(() => undefined);
        } else {
          const protectedIds = configuration?.config.id ? [configuration.config.id] : [];
          await retryPendingApiSecretCleanups(protectedIds).catch(() => undefined);
        }
      }
      setSetupError(
        error instanceof EnterpriseTransitionPendingError
          ? localizedCopy(
              language,
              "企业切换尚未完成：历史照片可能已部分永久删除，目标凭据和切换日志仍安全保留。旧连接不会被当作正常状态继续使用；请重启以自动续作。",
              "Enterprise transition is incomplete: historical photos may be partially and permanently deleted, while the target credential id and transition journal remain safely retained. The old connection will not be treated as normal; restart to resume automatically.",
            )
          : userFacingError(error, language),
      );
      if (error instanceof EnterpriseTransitionPendingError) {
        setSecretHint(null);
        setProviderTransitionBlocking(true);
      }
    } finally {
      setSetupSaving(false);
    }
  };

  const analyzePhoto = async (nextPhoto: PreparedPhoto) => {
    const active = configuration;
    if (!hasScopedCredentialId(active) || !hasCurrentDataTransferConsent(active)) {
      try {
        await pendingPrivateFileCleanup.deleteRegistered(nextPhoto.uri);
        setSetupError(localizedCopy(language, "请先完成当前接口的凭据绑定，并确认照片与聚合饮食报告的数据发送范围。", "Bind a credential to the current endpoint and confirm the transfer scope for meal photos and aggregated diet reports first."));
      } catch {
        setSetupError(localizedCopy(language, "接口尚未完成授权，本次重编码照片也未能确认删除。清理记录已保留，请重启 App 后重试。", "The API is not authorized and deletion of this re-encoded photo could not be confirmed. Its cleanup record is retained; restart the app and try again."));
      }
      setScreen("setup");
      return;
    }
    const runId = ++analysisRun.current;
    setPhoto(nextPhoto);
    setAnalysisResult(null);
    setAnalysisError(null);
    setScreen("analysis");
    try {
      await requirePendingPrivateFileCleanup(language);
      const secret = await readApiSecret(active.config.id);
      if (!secret) throw new Error(localizedCopy(language, "Keychain/Keystore 中的 API 凭据已丢失。", "The API credential is missing from Keychain/Keystore."));
      const adapter = createAiProvider(active.config);
      const padding = nextPhoto.base64.endsWith("==") ? 2 : nextPhoto.base64.endsWith("=") ? 1 : 0;
      const byteLength = Math.floor((nextPhoto.base64.length * 3) / 4) - padding;
      const result = await adapter.analyzeMeal({
        credentials: { secret },
        photo: {
          base64Data: nextPhoto.base64,
          byteLength,
          mimeType: nextPhoto.mimeType,
          sanitized: true,
          capturedAt: nextPhoto.capturedAt,
          locale: localeTag(language),
          timezone: timeZone,
        },
      });
      if (analysisRun.current !== runId) return;
      const verified: SavedAiConfiguration = {
        ...active,
        verifiedAt: active.verifiedAt ?? new Date().toISOString(),
      };
      if (verified.verifiedAt !== active.verifiedAt) {
        await setSetting(AI_CONFIG_SETTING_KEY, verified);
        setConfiguration(verified);
      }
      setAnalysisResult(result);
      setScreen("review");
    } catch (error) {
      if (analysisRun.current !== runId) return;
      setAnalysisError(userFacingError(error, language));
      setScreen("analysis");
    }
  };

  const cancelPhotoFlow = async (destination: "home" | "camera" = "home") => {
    analysisRun.current += 1;
    let cleanupFailed = false;
    if (photo) {
      try {
        await pendingPrivateFileCleanup.deleteRegistered(photo.uri);
      } catch {
        cleanupFailed = true;
      }
    }
    setPhoto(null);
    setAnalysisResult(null);
    setAnalysisError(null);
    setScreen(cleanupFailed ? "home" : destination);
    if (cleanupFailed) {
      Alert.alert(
        localizedCopy(language, "照片清理待重试", "Photo cleanup pending"),
        localizedCopy(language, "本次重编码照片未能确认删除，但清理记录已安全保留。为避免继续累积临时文件，请重启 App 后再拍照。", "Deletion of this re-encoded photo could not be confirmed, but its cleanup record is safely retained. Restart the app before taking another photo to avoid accumulating temporary files."),
      );
    }
  };

  const confirmMeal = async (portionFactor: number) => {
    if (!photo || !analysisResult || !configuration) return;
    invalidateReportWork();
    setSavingMeal(true);
    let retainedUri: string | null = null;
    let retainedSha256: string | null = null;
    let commitReconciledAfterError = false;
    try {
      const draftMeal = createMealWrite({
        result: analysisResult,
        photo,
        config: configuration.config,
        localDate: localDateFor(photo.capturedAt, timeZone),
        timeZone,
        utcOffsetMinutes: utcOffsetMinutesNow(),
        portionFactor,
        language,
        retainedPhotoUri: null,
      });
      if (retainPhotos) {
        const retained = await retainMealPhoto(
          photo.uri,
          draftMeal.id,
          pendingPrivateFileCleanup.enqueue,
        );
        retainedUri = retained.uri;
        retainedSha256 = retained.sha256;
      }
      const commitResult = await commitMealAfterTemporaryPhotoCleanup({
        temporaryPhotoUri: photo.uri,
        retainedPhotoUri: retainedUri,
        deletePrivateFile: pendingPrivateFileCleanup.deleteRegistered,
        queuePrivateFileCleanup: pendingPrivateFileCleanup.enqueue,
        commitMeal: async () => {
          await saveMealBundle({
            ...draftMeal,
            photoUri: retainedUri,
            photoSha256: retainedSha256,
          });
        },
        verifyCommittedMeal: async () =>
          (await getMealById(draftMeal.id, true)) !== null,
      });
      commitReconciledAfterError = commitResult.reconciledAfterCommitError;
    } catch (error) {
      if (error instanceof MealCommitIndeterminateError) {
        setPhoto(null);
        setAnalysisResult(null);
        setAnalysisError(null);
        setScreen("home");
        Alert.alert(
          localizedCopy(language, "保存状态待确认·请勿重复记录", "Save status uncertain · Do not log again"),
          localizedCopy(language, `临时照片已删除，但数据库在提交后无法完成核对。${retainedUri ? "App 已保留可能被记录引用的照片副本；" : "当前策略未保留照片副本；"}请重启后先检查首页，不要立即重拍。`, `The temporary photo was deleted, but the database could not verify the commit. ${retainedUri ? "The app retained a copy that may be referenced by the record. " : "The current policy retained no photo copy. "}Restart and check the home screen before taking another photo.`),
        );
        return;
      }
      const flowError = error instanceof MealCommitFlowError ? error : null;
      if (flowError?.temporaryPhotoDeleted) {
        setPhoto(null);
        setAnalysisResult(null);
        setAnalysisError(null);
        setScreen("camera");
        Alert.alert(
          localizedCopy(language, "记录未写入·请重新拍照", "Record not saved · Retake photo"),
          localizedCopy(language, `临时照片已安全删除，但数据库提交失败，未生成重复记录。${userFacingError(flowError.originalError, language)}`, `The temporary photo was securely deleted, but the database commit failed and no duplicate record was created. ${userFacingError(flowError.originalError, language)}`),
        );
      } else {
        Alert.alert(
          localizedCopy(language, "记录未写入", "Record not saved"),
          localizedCopy(language, `${userFacingError(flowError?.originalError ?? error, language)} 重编码后的临时照片仍在当前页可重试；清理记录未丢失。`, `${userFacingError(flowError?.originalError ?? error, language)} The re-encoded temporary photo remains available on this screen for retry, and its cleanup record is intact.`),
        );
      }
      return;
    } finally {
      setSavingMeal(false);
    }

    // Everything below is explicitly post-commit. Its failure must never enter
    // the "record not written" branch above or encourage a duplicate retry.
    setPhoto(null);
    setAnalysisResult(null);
    setAnalysisError(null);
    setScreen("home");
    if (commitReconciledAfterError) {
      Alert.alert(
        localizedCopy(language, "记录已保存·已自动核对", "Record saved · Verified automatically"),
        localizedCopy(language, "数据库在提交后报告了关闭异常，但 App 已通过餐食 ID 确认记录存在。不需要重复记录。", "The database reported a close error after commit, but the app confirmed the record by meal ID. Do not log it again."),
      );
    }
    const refreshError = await refreshAfterCommittedMeal(() => refreshToday());
    if (refreshError) {
      Alert.alert(
        localizedCopy(language, "记录已保存·首页待刷新", "Record saved · Home refresh pending"),
        localizedCopy(language, `${userFacingError(refreshError, language)} 本次餐食已安全写入，不要重复记录；重新打开首页即可刷新。`, `${userFacingError(refreshError, language)} This meal was safely saved. Do not log it again; reopen Home to refresh.`),
      );
    }
  };

  const navigateTab = (tab: BottomTab) => {
    if (tab === "home") {
      void refreshToday();
      setScreen("home");
    } else if (tab === "reports") {
      setScreen("reports");
      void loadPeriod(period);
    } else {
      setScreen("settings");
    }
  };

  const loadPeriod = async (
    nextPeriod: ReportPeriod,
    activeProfile = profile,
    activeLanguage = language,
    includeCachedReport = true,
  ) => {
    if (Platform.OS === "web") return;
    const loadRunId = ++reportLoadRun.current;
    try {
      const spec = createCalendarPeriod(nextPeriod, today, today);
      const endInclusive = spec.endDate < today ? spec.endDate : today;
      const endExclusive = addCalendarDays(endInclusive, 1);
      let stable: {
        days: Awaited<ReturnType<typeof loadDiaryDays>>;
        mealCount: number;
        evaluation: PeriodEvaluation;
        profile: UserProfile;
        inputRevision: number;
        inputFingerprint: string;
      } | null = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const before = await getReportInputRevision();
        // The repository pages the complete period. Bracketing it with the
        // persisted epoch prevents a mixed read while a meal/profile/day write commits.
        const [days, storedProfile] = await Promise.all([
          loadDiaryDays(spec.startDate, endExclusive),
          getMostRecentlyUpdatedProfile(),
        ]);
        const afterRead = await getReportInputRevision();
        if (before !== afterRead) continue;
        const snapshotProfile = storedProfile
          ? storedProfileToDomain(storedProfile)
          : activeProfile;
        const mealCount = countMealsInDiaryDays(days);
        const evaluation = evaluateCalendarPeriod(days, snapshotProfile, spec);
        const context = evaluation.score.score === null
          ? null
          : reportContext({
              evaluation,
              period: nextPeriod,
              profile: snapshotProfile,
              mealCount,
              timeZone,
              language: activeLanguage,
            });
        const inputFingerprint = context
          ? await reportInputFingerprint(context, configuration?.config ?? null)
          : "0".repeat(64);
        const afterFingerprint = await getReportInputRevision();
        if (afterFingerprint !== afterRead) continue;
        stable = {
          days,
          mealCount,
          evaluation,
          profile: snapshotProfile,
          inputRevision: afterRead,
          inputFingerprint,
        };
        break;
      }
      if (!stable) {
        throw new Error(localizedCopy(activeLanguage, "记录正在变化，请稍后重新打开报告。", "Dietary records are changing; reopen Reports in a moment."));
      }
      if (reportLoadRun.current !== loadRunId) return;
      const { days, mealCount, evaluation, profile: snapshotProfile, inputRevision, inputFingerprint } = stable;
      const summary = periodSummaryView({
        evaluation,
        label: periodDisplayLabel(nextPeriod, evaluation, activeLanguage),
        mealCount,
        days,
        profile: snapshotProfile,
        language: activeLanguage,
      });
      const cached = includeCachedReport
        ? await getLatestReport(
            nextPeriod,
            spec.startDate,
            endExclusive,
            currentReportCacheExpectation(
              inputRevision,
              localeTag(activeLanguage),
              inputFingerprint,
            ),
          )
        : null;
      if (reportLoadRun.current !== loadRunId) return;
      setPeriod(nextPeriod);
      setPeriodMealCount(mealCount);
      setPeriodEvaluation(evaluation);
      setPeriodInputRevision(inputRevision);
      setPeriodInputFingerprint(inputFingerprint);
      setPeriodSummary(summary);
      setGeneratedReport(reportFromStored(cached, activeLanguage));
      setReportError(null);
    } catch (error) {
      if (reportLoadRun.current === loadRunId) {
        setReportError(userFacingError(error, activeLanguage));
      }
    }
  };

  const generateAiReport = async () => {
    if (
      !hasScopedCredentialId(configuration) ||
      !hasCurrentDataTransferConsent(configuration) ||
      !periodEvaluation ||
      periodInputRevision === null ||
      periodInputFingerprint === null
    ) {
      setReportError(localizedCopy(language, "当前缺少 API 或周期数据。", "The current API or period data is missing."));
      return;
    }
    const runId = ++reportRun.current;
    const activeConfiguration = configuration;
    const activeEvaluation = periodEvaluation;
    const activePeriod = period;
    const activeProfile = profile;
    const activeMealCount = periodMealCount;
    const activeLanguage = language;
    const capturedInputRevision = periodInputRevision;
    const capturedInputFingerprint = periodInputFingerprint;
    setGeneratingReport(true);
    setReportError(null);
    try {
      const secret = await readApiSecret(activeConfiguration.config.id);
      if (!secret) throw new Error(localizedCopy(activeLanguage, "Keychain/Keystore 中的 API 凭据已丢失。", "The API credential is missing from Keychain/Keystore."));
      const context = reportContext({
        evaluation: activeEvaluation,
        period: activePeriod,
        profile: activeProfile,
        mealCount: activeMealCount,
        timeZone,
        language: activeLanguage,
      });
      const requestFingerprint = await reportInputFingerprint(
        context,
        activeConfiguration.config,
      );
      if (requestFingerprint !== capturedInputFingerprint) {
        throw new Error(localizedCopy(activeLanguage, "报告输入已变化，请重新打开报告页。", "Report inputs changed; reopen Reports."));
      }
      const result = await createAiProvider(activeConfiguration.config).generateReport({
        context,
        credentials: { secret },
      });
      if (reportRun.current !== runId) return;
      const generatedAt = new Date().toISOString();
      const score = activeEvaluation.score.score;
      if (score === null) throw new Error(localizedCopy(activeLanguage, "评分资料不足，报告不会写入。", "There is not enough scoring data, so the report will not be saved."));
      const endExclusive = addCalendarDays(effectivePeriodEnd(activeEvaluation), 1);
      const stored = await saveReport({
        id: randomUUID(),
        periodType: activePeriod,
        periodStartLocalDate: activeEvaluation.period.startDate,
        periodEndLocalDateExclusive: endExclusive,
        generatedAtUtc: generatedAt,
        score: score.estimate,
        scoreConfidence: Math.max(0, Math.min(1, activeEvaluation.score.coverage * (1 - Math.min(1, (score.high - score.low) / 100)))),
        dataCoverage: activeEvaluation.score.coverage,
        totals: averagesToStored(activeEvaluation),
        scoreResult: {
          score: activeEvaluation.score,
          period: activeEvaluation.period,
        },
        normalizedReport: JSON.parse(JSON.stringify(result.data)) as Record<string, unknown>,
        narrative: result.data.summary,
        recommendations: result.data.suggestions.map((item) => item.action),
        providerId: activeConfiguration.config.id,
        providerKind: result.metadata.provider_kind,
        model: result.metadata.model,
        providerRequestId: result.metadata.provider_request_id,
        reportSchemaVersion: REPORT_SCHEMA_VERSION,
        promptVersion: REPORT_PROMPT_VERSION,
        inputRevision: capturedInputRevision,
        locale: localeTag(activeLanguage),
        scoreInputVersion: REPORT_SCORE_INPUT_VERSION,
        inputFingerprint: capturedInputFingerprint,
      });
      if (reportRun.current !== runId) return;
      setGeneratedReport(reportView(result.data, stored.generatedAtUtc, activeLanguage));
    } catch (error) {
      if (reportRun.current === runId) {
        setReportError(userFacingError(error, activeLanguage));
      }
    } finally {
      if (reportRun.current === runId) setGeneratingReport(false);
    }
  };

  const saveProfileDraft = async (draft: ProfileDraft) => {
    invalidateReportWork();
    setSavingProfile(true);
    try {
      const next: UserProfile = {
        ...profile,
        populationGroup: draft.populationGroup,
        weightKg: draft.weightKg.trim() ? Number(draft.weightKg) : null,
        dailyEnergyTargetKcal: draft.dailyEnergyTargetKcal.trim()
          ? Number(draft.dailyEnergyTargetKcal)
          : null,
        specialConditions: [],
      };
      const stored = await saveProfile({ ...next, locale: localeTag(language) });
      const domain = storedProfileToDomain(stored);
      setProfile(domain);
      await refreshToday(domain);
      Alert.alert(localizedCopy(language, "已保存", "Saved"), localizedCopy(language, "之后的评分会使用新参考，原始餐食记录未被改动。", "Future scores will use the new reference. Source meal records were not changed."));
    } catch (error) {
      Alert.alert(localizedCopy(language, "个人化参考未保存", "Personal reference not saved"), userFacingError(error, language));
    } finally {
      setSavingProfile(false);
    }
  };

  const setDayComplete = async (complete: boolean) => {
    invalidateReportWork();
    try {
      await setDiaryDayComplete(today, complete);
      await refreshToday();
    } catch (error) {
      Alert.alert(localizedCopy(language, "无法更新完整日", "Could not update day completion"), userFacingError(error, language));
    }
  };

  const editApi = () => {
    setReturnAfterSetup("settings");
    setSetupError(null);
    setScreen("setup");
  };

  const removeApi = () => {
    if (!configuration) return;
    const credentialId = configuration.config.id;
    Alert.alert(localizedCopy(language, "删除 API 凭据？", "Delete API credential?"), localizedCopy(language, "删除后餐食记录仍保留，但无法继续拍照或生成 AI 报告。", "Meal records will remain, but photo analysis and AI reports will stop working."), [
      { text: localizedCopy(language, "取消", "Cancel"), style: "cancel" },
      {
        text: localizedCopy(language, "删除", "Delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              invalidateReportWork();
              await retireApiConfiguration(AI_CONFIG_SETTING_KEY, credentialId);
              setConfiguration(null);
              setSecretHint(null);
              setReturnAfterSetup("home");
              setScreen("setup");
              const cleanup = await retryPendingApiSecretCleanups();
              if (cleanup.remaining > 0) {
                Alert.alert(
                  localizedCopy(language, "凭据删除将在启动时重试", "Credential deletion will retry at startup"),
                  localizedCopy(language, "API 配置已移除；Keychain/Keystore 删除失败时，凭据标识仍保留在持久重试队列。", "The API configuration was removed. If Keychain/Keystore deletion failed, its credential id remains in the durable retry queue."),
                );
              }
            } catch (error) {
              Alert.alert(localizedCopy(language, "凭据未删除", "Credential not deleted"), userFacingError(error, language));
            }
          })();
        },
      },
    ]);
  };

  const exportData = async () => {
    let exportUri: string | null = null;
    try {
      await requirePendingPrivateFileCleanup(language);
      const exported = await createPortableDataExport();
      exportUri = createExportFileUri(randomUUID());
      await pendingPrivateFileCleanup.registerAndUse(exportUri, async (uri) => {
        await writeExportFile(uri, JSON.stringify(exported, null, 2));
        if (!(await Sharing.isAvailableAsync())) {
          throw new Error(localizedCopy(language, "该设备没有可用的分享面板。", "No share sheet is available on this device."));
        }
        await Sharing.shareAsync(uri, {
          mimeType: "application/json",
          dialogTitle: localizedCopy(language, "导出饮食管家记录", "Export Diet Steward records"),
        });
      });
    } catch (error) {
      Alert.alert(localizedCopy(language, "导出失败", "Export failed"), userFacingError(error, language));
    } finally {
      if (exportUri) {
        try {
          const cleanup = await pendingPrivateFileCleanup.retryAll();
          if (cleanup.remaining > 0) {
            Alert.alert(
              localizedCopy(language, "临时导出文件待清理", "Temporary export cleanup pending"),
              localizedCopy(language, "导出流程已结束，但系统未能确认临时 JSON 已删除。App 已加入本机重试队列，下次启动会在拍照前再清理。", "Export finished, but the system could not confirm deletion of the temporary JSON file. It was added to the on-device retry queue and will be cleaned before camera use at the next launch."),
            );
          }
        } catch (cleanupError) {
          Alert.alert(
            localizedCopy(language, "私密文件清理未完成", "Private-file cleanup incomplete"),
            localizedCopy(language, `${userFacingError(cleanupError, language)} 待清理地址已在写入文件前登记；请立即重启 App 并暂停新的拍照或导出。`, `${userFacingError(cleanupError, language)} The cleanup URI was registered before writing. Restart the app now and pause new photo or export operations.`),
          );
        }
      }
    }
  };

  const deleteAllDietData = () => {
    Alert.alert(localizedCopy(language, "删除全部饮食记录？", "Delete all diet records?"), localizedCopy(language, "将删除餐食、日完整状态和 AI 报告。API 配置和个人化参考保留。该操作无法恢复。", "This deletes meals, day-completion states, and AI reports. API configuration and personal references remain. This cannot be undone."), [
      { text: localizedCopy(language, "取消", "Cancel"), style: "cancel" },
      {
        text: localizedCopy(language, "永久删除", "Delete permanently"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              invalidateReportWork();
              const database = await getDatabase();
              const photoRows = await database.getAllAsync<{ photo_uri: string | null }>(
                "SELECT photo_uri FROM meals WHERE photo_uri IS NOT NULL",
              );
              const photoDeletions = await Promise.allSettled(
                photoRows.map(({ photo_uri }) => deleteLocalPhoto(photo_uri)),
              );
              const failedPhotos = photoDeletions.filter((result) => result.status === "rejected").length;
              if (failedPhotos > 0) {
                throw new Error(localizedCopy(language, `${failedPhotos} 个照片文件未能删除。饮食记录及照片引用均已保留，可稍后重试。`, `${failedPhotos} photo files could not be deleted. Diet records and photo references were retained for a later retry.`));
              }
              await database.withExclusiveTransactionAsync(async (transaction) => {
                await transaction.execAsync("DELETE FROM reports; DELETE FROM diary_days; DELETE FROM meals;");
                await advanceReportInputRevision(transaction);
              });
              await database.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");
              await refreshToday();
              setPeriodSummary(null);
              setGeneratedReport(null);
              Alert.alert(localizedCopy(language, "已删除", "Deleted"), localizedCopy(language, "餐食、日状态、报告和照片已从本机移除。", "Meals, day states, reports, and photos were removed from this device."));
            } catch (error) {
              Alert.alert(localizedCopy(language, "未完成删除", "Deletion incomplete"), userFacingError(error, language));
            }
          })();
        },
      },
    ]);
  };

  const deleteMeal = (id: string) => {
    Alert.alert(localizedCopy(language, "删除这一餐？", "Delete this meal?"), localizedCopy(language, "删除后当日完整状态会自动变为未完成，所有周期会重算。", "The day will be marked incomplete and every period will be recalculated."), [
      { text: localizedCopy(language, "取消", "Cancel"), style: "cancel" },
      {
        text: localizedCopy(language, "删除", "Delete"),
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              invalidateReportWork();
              const meal = await getMealById(id, true);
              if (!meal) return;
              // Erase the file first. If that fails, the meal row and URI stay
              // intact, making the privacy cleanup safely retryable.
              await deleteLocalPhoto(meal.photoUri);
              await purgeMeal(id);
              await refreshToday();
              setPeriodSummary(null);
              setPeriodEvaluation(null);
              setGeneratedReport(null);
            } catch (error) {
              Alert.alert(localizedCopy(language, "记录未删除", "Record not deleted"), userFacingError(error, language));
            }
          })();
        },
      },
    ]);
  };

  const changeLanguagePreference = async (nextPreference: LanguagePreference) => {
    const nextLanguage = resolveLanguage(nextPreference, detectedSystemLanguage);
    invalidateReportWork();
    try {
      await setSetting(LANGUAGE_PREFERENCE_SETTING_KEY, nextPreference);
      setLanguagePreference(nextPreference);
      let activeProfile = profile;
      if (Platform.OS !== "web") {
        const stored = await saveProfile({ ...profile, locale: localeTag(nextLanguage) });
        activeProfile = storedProfileToDomain(stored);
        setProfile(activeProfile);
        await refreshToday(activeProfile, nextLanguage);
        if (screen === "reports") {
          await loadPeriod(period, activeProfile, nextLanguage, false);
        } else {
          setGeneratedReport(null);
        }
      }
    } catch (error) {
      Alert.alert(
        localizedCopy(nextLanguage, "语言设置未完整保存", "Language setting not fully saved"),
        userFacingError(error, nextLanguage),
      );
    }
  };

  const setupInitial = configuration ? savedConfigurationToDraft(configuration) : undefined;
  const fallbackPeriod: PeriodSummaryView = {
    label: localizedCopy(language, "正在读取记录", "Loading records"),
    score: null,
    scoreLower: null,
    scoreUpper: null,
    coverage: 0,
    scoreLabel: localizedCopy(language, "资料不足", "Insufficient data"),
    validDays: 0,
    observedDays: 0,
    mealCount: 0,
    averageCalories: null,
    averageFruitVegetableG: null,
    averageFiberG: null,
    averageSodiumMg: null,
    averageFatEnergyPercent: null,
    averageCarbohydrateEnergyPercent: null,
    averageSaturatedFatEnergyPercent: null,
    trends: [],
    findings: [],
  };

  return (
    <I18nProvider language={language} preference={languagePreference}>
    <SafeAreaProvider>
      <StatusBar style={screen === "camera" ? "light" : "dark"} />
      {screen === "boot" ? <BootScreen /> : null}
      {screen === "setup" ? (
        <ApiSetupScreen
          {...(setupInitial ? { initial: setupInitial } : {})}
          existingSecretHint={secretHint}
          existingCredentialScope={
            hasScopedCredentialId(configuration)
              ? credentialScopeForSaved(configuration)
              : null
          }
          error={setupError}
          saving={setupSaving}
          onSubmit={saveApiSetup}
          {...(hasScopedCredentialId(configuration) && !providerTransitionBlocking
            ? { onCancel: () => setScreen(returnAfterSetup) }
            : {})}
        />
      ) : null}
      {screen === "home" ? (
        <HomeScreen
          dateLabel={formatLocalDateChinese(today, localeTag(language))}
          summary={homeSummary}
          meals={homeMeals}
          apiLabel={configuration ? providerDisplayName(configuration.config.displayName, language) : localizedCopy(language, "未配置 API", "API not configured")}
          apiVerified={Boolean(configuration?.verifiedAt)}
          enterpriseWorkspace={configuration?.enterpriseWorkspace ?? null}
          isDayComplete={todayComplete}
          onCapture={() => setScreen(configuration ? "camera" : "setup")}
          onDayCompleteChange={(complete) => void setDayComplete(complete)}
          onMealPress={deleteMeal}
          onTabChange={navigateTab}
        />
      ) : null}
      {screen === "camera" ? (
        <CameraScreen
          captureCleanup={pendingPrivateFileCleanup}
          onCancel={() => setScreen("home")}
          onPhoto={analyzePhoto}
        />
      ) : null}
      {screen === "analysis" && photo ? (
        <AnalysisScreen
          photoUri={photo.uri}
          providerLabel={configuration ? providerDisplayName(configuration.config.displayName, language) : "AI API"}
          error={analysisError}
          {...(analysisError ? { onRetry: () => void analyzePhoto(photo) } : {})}
          onCancel={() => void cancelPhotoFlow(analysisError ? "camera" : "home")}
        />
      ) : null}
      {screen === "review" && photo && analysisResult && configuration ? (
        <ReviewScreen
          photoUri={photo.uri}
          analysis={analysisToReview(analysisResult.data)}
          providerLabel={providerDisplayName(configuration.config.displayName, language)}
          model={analysisResult.metadata.model}
          saving={savingMeal}
          onBack={() => void cancelPhotoFlow("camera")}
          onConfirm={confirmMeal}
        />
      ) : null}
      {screen === "reports" ? (
        <ReportsScreen
          period={period}
          summary={periodSummary ?? fallbackPeriod}
          report={generatedReport}
          generating={generatingReport}
          reportError={reportError}
          onPeriodChange={(next) => void loadPeriod(next)}
          onGenerateReport={() => void generateAiReport()}
          onTabChange={navigateTab}
        />
      ) : null}
      {screen === "settings" && configuration ? (
        <SettingsScreen
          providerLabel={providerDisplayName(configuration.config.displayName, language)}
          endpointLabel={`${endpointHost(configuration.config)} · ${configuration.config.visionModel}`}
          secretHint={secretHint}
          apiVerified={Boolean(configuration.verifiedAt)}
          verifiedAt={configuration.verifiedAt}
          enterpriseWorkspace={configuration.enterpriseWorkspace ?? null}
          profile={profileToDraft(profile)}
          retainPhotos={retainPhotos}
          savingProfile={savingProfile}
          languagePreference={languagePreference}
          onEditApi={editApi}
          onDeleteApi={removeApi}
          onSaveProfile={saveProfileDraft}
          onLanguagePreferenceChange={changeLanguagePreference}
          onRetainPhotosChange={(value) => {
            if (configuration.setupProviderKind === "enterprise") {
              setRetainPhotos(false);
              Alert.alert(localizedCopy(language, "由企业策略管理", "Managed by enterprise policy"), localizedCopy(language, "企业托管模式不保留原始餐食照片。", "Enterprise-managed mode does not retain original meal photos."));
              return;
            }
            setRetainPhotos(value);
            void setSetting(RETAIN_PHOTOS_SETTING_KEY, value).catch((error) =>
              Alert.alert(localizedCopy(language, "照片设置未保存", "Photo setting not saved"), userFacingError(error, language)),
            );
          }}
          onExport={() => void exportData()}
          onDeleteAllData={deleteAllDietData}
          onTabChange={navigateTab}
        />
      ) : null}
    </SafeAreaProvider>
    </I18nProvider>
  );
}

function BootScreen() {
  const { language, t } = useI18n();
  return (
    <SafeAreaView style={styles.boot}>
      <View style={styles.bootMark}>
        <ActivityIndicator color={colors.teal} size="large" />
      </View>
      <Text style={styles.bootTitle}>{t("饮食管家", "Diet Steward")}</Text>
      <Text style={styles.bootBody}>{t("正在打开本机记录和安全凭据…", "Opening on-device records and secure credentials…")}</Text>
      <Text style={styles.bootCredit}>{officialAttribution(language)}</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  boot: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  bootMark: {
    width: 76,
    height: 76,
    borderRadius: 24,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  bootTitle: { ...textStyles.title, color: colors.inkStrong, marginTop: spacing.lg },
  bootBody: { ...textStyles.body, color: colors.muted, textAlign: "center", marginTop: spacing.xs },
  bootCredit: { ...textStyles.caption, color: colors.muted, textAlign: "center", marginTop: spacing.md },
});
