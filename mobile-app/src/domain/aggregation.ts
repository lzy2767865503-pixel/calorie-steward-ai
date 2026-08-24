import { addRanges, assertNutrientRange, divideRange, ratioRange } from './ranges';
import {
  ENERGY_SHARE_FIELDS,
  NUTRIENT_FIELDS,
  emptyNutrientTotals,
  type DiaryDay,
  type EnergyShareAggregate,
  type EnergyShareAggregates,
  type EnergyShareField,
  type MealRecord,
  type NutrientField,
  type NutrientFieldAggregate,
  type NutrientFieldAggregates,
  type NutrientRange,
  type NutrientTotals,
  type PeriodNutritionAggregate,
} from './types';

const ENERGY_SHARE_CONFIG: Readonly<
  Record<EnergyShareField, { nutrient: NutrientField; kcalPerGram: number }>
> = {
  protein: { nutrient: 'proteinG', kcalPerGram: 4 },
  carbohydrate: { nutrient: 'carbohydrateG', kcalPerGram: 4 },
  totalFat: { nutrient: 'totalFatG', kcalPerGram: 9 },
  saturatedFat: { nutrient: 'saturatedFatG', kcalPerGram: 9 },
  transFat: { nutrient: 'transFatG', kcalPerGram: 9 },
  freeSugar: { nutrient: 'freeSugarG', kcalPerGram: 4 },
};

function sumMealField(
  meals: readonly MealRecord[],
  field: NutrientField,
): NutrientRange | null {
  if (meals.length === 0) {
    return null;
  }
  const ranges: NutrientRange[] = [];
  for (const meal of meals) {
    const value = meal.nutrients[field];
    if (value === null) {
      // The day's total is unknown if any consumed meal lacks this nutrient.
      return null;
    }
    assertNutrientRange(value, `${meal.id}.${field}`);
    ranges.push(value);
  }
  return addRanges(ranges);
}

export function aggregateMeals(meals: readonly MealRecord[]): NutrientTotals {
  if (meals.length === 0) {
    return emptyNutrientTotals();
  }
  return {
    caloriesKcal: sumMealField(meals, 'caloriesKcal'),
    proteinG: sumMealField(meals, 'proteinG'),
    carbohydrateG: sumMealField(meals, 'carbohydrateG'),
    totalFatG: sumMealField(meals, 'totalFatG'),
    saturatedFatG: sumMealField(meals, 'saturatedFatG'),
    transFatG: sumMealField(meals, 'transFatG'),
    freeSugarG: sumMealField(meals, 'freeSugarG'),
    fiberG: sumMealField(meals, 'fiberG'),
    sodiumMg: sumMealField(meals, 'sodiumMg'),
    fruitVegetableG: sumMealField(meals, 'fruitVegetableG'),
  };
}

function aggregateNutrientField(
  dailyTotals: readonly NutrientTotals[],
  field: NutrientField,
): NutrientFieldAggregate {
  const observed: NutrientRange[] = [];
  for (const totals of dailyTotals) {
    const range = totals[field];
    if (range !== null) {
      observed.push(range);
    }
  }
  return {
    dailyAverage:
      observed.length === 0
        ? null
        : divideRange(addRanges(observed), observed.length),
    observedDayCount: observed.length,
    eligibleDayCount: dailyTotals.length,
  };
}

function aggregateEnergyShare(
  dailyTotals: readonly NutrientTotals[],
  field: EnergyShareField,
): EnergyShareAggregate {
  const config = ENERGY_SHARE_CONFIG[field];
  const nutrientRanges: NutrientRange[] = [];
  const energyRanges: NutrientRange[] = [];

  for (const totals of dailyTotals) {
    const nutrient = totals[config.nutrient];
    const energy = totals.caloriesKcal;
    if (nutrient === null || energy === null || energy.low <= 0) {
      continue;
    }
    nutrientRanges.push(nutrient);
    energyRanges.push(energy);
  }

  if (nutrientRanges.length === 0) {
    return {
      energyPercent: null,
      observedDayCount: 0,
      eligibleDayCount: dailyTotals.length,
    };
  }

  return {
    energyPercent: ratioRange(
      addRanges(nutrientRanges),
      addRanges(energyRanges),
      config.kcalPerGram * 100,
    ),
    observedDayCount: nutrientRanges.length,
    eligibleDayCount: dailyTotals.length,
  };
}

function aggregateNutrientFields(
  dailyTotals: readonly NutrientTotals[],
): NutrientFieldAggregates {
  return Object.fromEntries(
    NUTRIENT_FIELDS.map((field) => [
      field,
      aggregateNutrientField(dailyTotals, field),
    ]),
  ) as unknown as NutrientFieldAggregates;
}

function aggregateEnergyShares(
  dailyTotals: readonly NutrientTotals[],
): EnergyShareAggregates {
  return Object.fromEntries(
    ENERGY_SHARE_FIELDS.map((field) => [
      field,
      aggregateEnergyShare(dailyTotals, field),
    ]),
  ) as unknown as EnergyShareAggregates;
}

/**
 * Re-aggregates raw meal nutrient ranges. The caller decides which days are
 * eligible (for example, only complete days in a calendar period).
 */
export function aggregateDiaryDays(
  days: readonly DiaryDay[],
): PeriodNutritionAggregate {
  const seenDates = new Set<string>();
  const dailyTotals: NutrientTotals[] = [];

  for (const day of days) {
    if (seenDates.has(day.date)) {
      throw new Error(`Duplicate diary day: ${day.date}`);
    }
    seenDates.add(day.date);
    for (const meal of day.meals) {
      if (meal.localDate !== day.date) {
        throw new Error(
          `Meal ${meal.id} belongs to ${meal.localDate}, not diary day ${day.date}.`,
        );
      }
    }
    dailyTotals.push(aggregateMeals(day.meals));
  }

  return {
    nutrients: aggregateNutrientFields(dailyTotals),
    energyShares: aggregateEnergyShares(dailyTotals),
    eligibleDayCount: dailyTotals.length,
  };
}

export function hasAnyNutrientData(aggregate: PeriodNutritionAggregate): boolean {
  return NUTRIENT_FIELDS.some(
    (field) => aggregate.nutrients[field].dailyAverage !== null,
  );
}
