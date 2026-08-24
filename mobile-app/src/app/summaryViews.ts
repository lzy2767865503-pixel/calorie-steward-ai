import { aggregateMeals } from "../domain/aggregation";
import { evaluateDiaryDay } from "../domain/periods";
import type {
  DiaryDay,
  NutrientRange,
  PeriodEvaluation,
  ScoreMetricKey,
  UserProfile,
} from "../domain/types";
import type { HomeMealView, HomeSummaryView } from "../screens/HomeScreen";
import type {
  FindingView,
  PeriodSummaryView,
  TrendPointView,
} from "../screens/ReportsScreen";
import type { StoredMeal } from "../storage";
import { copy as localizedCopy, localeTag, type AppLanguage } from "../i18n";
import { formatTime } from "./dates";

function estimate(range: NutrientRange | null): number | null {
  return range?.estimate ?? null;
}

/**
 * Counts meals from the already paginated diary result. Report screens must
 * not issue a second, oversized repository query just to obtain this number.
 */
export function countMealsInDiaryDays(days: readonly DiaryDay[]): number {
  return days.reduce((total, day) => total + day.meals.length, 0);
}

function scoreLabel(evaluation: PeriodEvaluation, language: AppLanguage): string {
  if (evaluation.score.score === null) return localizedCopy(language, "资料不足", "Insufficient data");
  return evaluation.score.isValid
    ? localizedCopy(language, "有效得分", "Valid score")
    : localizedCopy(language, "暂定得分", "Provisional score");
}

export function homeSummaryView(
  day: DiaryDay,
  storedMeals: readonly StoredMeal[],
  profile: UserProfile,
  language: AppLanguage = "zh",
): { summary: HomeSummaryView; meals: HomeMealView[] } {
  const totals = aggregateMeals(day.meals);
  const evaluation = evaluateDiaryDay(day, profile);
  const score = evaluation.score.score;
  const calories = totals.caloriesKcal;
  const summary: HomeSummaryView = {
    calories: calories?.estimate ?? 0,
    caloriesLower: calories?.low ?? 0,
    caloriesUpper: calories?.high ?? 0,
    proteinG: estimate(totals.proteinG),
    carbohydrateG: estimate(totals.carbohydrateG),
    fatG: estimate(totals.totalFatG),
    fruitVegetableG: estimate(totals.fruitVegetableG),
    fiberG: estimate(totals.fiberG),
    score: score?.estimate ?? null,
    scoreLower: score?.low ?? null,
    scoreUpper: score?.high ?? null,
    scoreCoverage: evaluation.score.coverage,
    scoreLabel: scoreLabel(evaluation, language),
    recordedMeals: storedMeals.length,
  };
  return {
    summary,
    meals: storedMeals.map((meal) => ({
      id: meal.id,
      timeLabel: formatTime(meal.capturedAtUtc, meal.timeZone, localeTag(language)),
      name: meal.mealName,
      calories: meal.nutrients.caloriesKcal?.estimate ?? 0,
      lower: meal.nutrients.caloriesKcal?.low ?? 0,
      upper: meal.nutrients.caloriesKcal?.high ?? 0,
      confidence: meal.confidence,
    })),
  };
}

const SCORE_TO_FINDING: Readonly<Record<ScoreMetricKey, { title: [string, string]; concern: [string, string]; good: [string, string] }>> = {
  fruit_vegetables: {
    title: ["水果与蔬菜", "Fruit & vegetables"],
    concern: ["周期日均低于 400 g，可以先在一餐中加一份蔬菜或整果。", "The daily average is below 400 g. Start by adding one serving of vegetables or whole fruit to a meal."],
    good: ["周期平均达到成人参考量。", "The period average meets the adult reference."],
  },
  fiber: {
    title: ["膳食纤维", "Dietary fiber"],
    concern: ["纤维偏低，优先考虑全谷物、豆类、蔬菜和整果。", "Fiber is low. Prioritize whole grains, legumes, vegetables, and whole fruit."],
    good: ["纤维日均达到成人参考量。", "Daily fiber meets the adult reference."],
  },
  carbohydrate_share: {
    title: ["碳水化合物结构", "Carbohydrate balance"],
    concern: ["碳水供能比例偏离 45–75% 参考带，需结合全谷/精制主食构成解读。", "Carbohydrate energy is outside the 45–75% reference band; interpret it alongside whole-grain and refined-staple choices."],
    good: ["碳水供能比例处于成人参考带。", "Carbohydrate energy is within the adult reference band."],
  },
  protein_adequacy: {
    title: ["蛋白质", "Protein"],
    concern: ["蛋白质参考达成度偏低，可考虑豆类、鱼、蛋、奶或适量瘦肉。", "Protein adequacy is low. Consider legumes, fish, eggs, dairy, or moderate lean meat."],
    good: ["蛋白质参考达成度良好。", "Protein adequacy is good."],
  },
  total_fat_share: {
    title: ["总脂肪与油腻程度", "Total fat and oiliness"],
    concern: ["总脂肪供能比偏离 15–30% 参考带；如偏高，优先减少油炸、浓汁和可见油。", "Total fat energy is outside the 15–30% band. If high, reduce fried foods, rich sauces, and visible oil first."],
    good: ["总脂肪供能比处于成人参考带。", "Total fat energy is within the adult reference band."],
  },
  saturated_fat_share: {
    title: ["饱和脂肪", "Saturated fat"],
    concern: ["饱和脂肪供能比可能偏高，可减少肥肉、加工肉和高饱和脂肪烹调脂。", "Saturated fat energy may be high. Reduce fatty meat, processed meat, and cooking fats high in saturated fat."],
    good: ["饱和脂肪供能比处于参考上限内。", "Saturated fat energy is within the reference limit."],
  },
  trans_fat_share: {
    title: ["反式脂肪", "Trans fat"],
    concern: ["反式脂肪估算偏高，应优先避免工业反式脂肪来源。", "Estimated trans fat is high. Prioritize avoiding industrial trans-fat sources."],
    good: ["反式脂肪估算处于参考上限内。", "Estimated trans fat is within the reference limit."],
  },
  free_sugar_share: {
    title: ["游离糖", "Free sugars"],
    concern: ["游离糖供能比可能偏高，可先从含糖饮料和甜品减量。", "Free-sugar energy may be high. Start by reducing sugary drinks and desserts."],
    good: ["游离糖供能比位于参考上限内。", "Free-sugar energy is within the reference limit."],
  },
  sodium: {
    title: ["钠与偏咸程度", "Sodium and saltiness"],
    concern: ["钠日均估算可能超过 2,000 mg，可从汤底、蘸料、加工食品和额外加盐下手。", "Estimated daily sodium may exceed 2,000 mg. Start with soup bases, dips, processed foods, and added salt."],
    good: ["钠日均估算位于成人参考上限内。", "Estimated daily sodium is within the adult reference limit."],
  },
};

function findingsFor(evaluation: PeriodEvaluation, language: AppLanguage): FindingView[] {
  return evaluation.score.metrics.map((metric) => {
    const copy = SCORE_TO_FINDING[metric.key];
    if (metric.score === null) {
      return {
        id: metric.key,
        title: localizedCopy(language, copy.title[0], copy.title[1]),
        detail: localizedCopy(language, "这个周期的照片无法支持该指标，不按 0 处理。", "Photos from this period cannot support this metric; it is not counted as zero."),
        status: "unknown",
      };
    }
    const value = metric.score.estimate;
    return {
      id: metric.key,
      title: localizedCopy(language, copy.title[0], copy.title[1]),
      detail: value >= 85
        ? localizedCopy(language, copy.good[0], copy.good[1])
        : localizedCopy(language, copy.concern[0], copy.concern[1]),
      status: value >= 85 ? "good" : value >= 65 ? "watch" : "concern",
    };
  });
}

export function periodSummaryView(args: {
  evaluation: PeriodEvaluation;
  label: string;
  mealCount: number;
  days: readonly DiaryDay[];
  profile: UserProfile;
  language?: AppLanguage;
}): PeriodSummaryView {
  const { evaluation } = args;
  const language = args.language ?? "zh";
  const aggregate = evaluation.aggregate;
  const score = evaluation.score.score;
  const trends: TrendPointView[] = args.days.map((day) => {
    const daily = evaluateDiaryDay(day, args.profile);
    return {
      label: day.date.slice(5),
      score: daily.score.score?.estimate ?? null,
      calories: aggregateMeals(day.meals).caloriesKcal?.estimate ?? 0,
    };
  });
  return {
    label: args.label,
    score: score?.estimate ?? null,
    scoreLower: score?.low ?? null,
    scoreUpper: score?.high ?? null,
    coverage: evaluation.score.coverage,
    scoreLabel: scoreLabel(evaluation, language),
    validDays: evaluation.completeDayCount,
    observedDays: evaluation.elapsedDayCount,
    mealCount: args.mealCount,
    averageCalories: estimate(aggregate.nutrients.caloriesKcal.dailyAverage),
    averageFruitVegetableG: estimate(aggregate.nutrients.fruitVegetableG.dailyAverage),
    averageFiberG: estimate(aggregate.nutrients.fiberG.dailyAverage),
    averageSodiumMg: estimate(aggregate.nutrients.sodiumMg.dailyAverage),
    averageFatEnergyPercent: estimate(aggregate.energyShares.totalFat.energyPercent),
    averageCarbohydrateEnergyPercent: estimate(aggregate.energyShares.carbohydrate.energyPercent),
    averageSaturatedFatEnergyPercent: estimate(aggregate.energyShares.saturatedFat.energyPercent),
    trends,
    findings: findingsFor(evaluation, language),
  };
}
