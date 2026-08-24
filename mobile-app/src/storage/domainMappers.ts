import type {
  DiaryDay,
  MealRecord,
  UserProfile,
} from "../domain/types";
import type {
  StoredMeal,
  StoredUserProfile,
  UserProfileWrite,
} from "./types";

/** Converts an active persisted meal into the audit-friendly scoring contract. */
export function storedMealToDomain(meal: StoredMeal): MealRecord {
  if (meal.deletedAtUtc !== null || meal.recordStatus === "archived") {
    throw new Error(`Meal ${meal.id} is not active and cannot enter nutrition scoring.`);
  }
  return {
    id: meal.id,
    capturedAt: meal.capturedAtUtc,
    localDate: meal.localDate,
    timeZone: meal.timeZone,
    nutrients: meal.nutrients,
    components: meal.components.map((component) => ({
      name: component.name,
      category: component.category,
      portionG: component.estimatedGrams,
      preparationTags: component.preparationTags,
    })),
    evidence: meal.nutrientEvidence,
    analysis: {
      providerId: meal.analysis.providerId,
      model: meal.analysis.model,
      promptVersion: meal.analysis.promptVersion,
      analyzedAt: meal.analysis.receivedAtUtc,
      assumptions: meal.analysis.assumptions,
    },
  };
}

export function storedProfileToDomain(profile: StoredUserProfile): UserProfile {
  return {
    id: profile.id,
    populationGroup: profile.populationGroup,
    birthDate: profile.birthDate,
    weightKg: profile.weightKg,
    dailyEnergyTargetKcal: profile.dailyEnergyTargetKcal,
    specialConditions: profile.specialConditions,
  };
}

export function domainProfileToWrite(
  profile: UserProfile,
  locale: string,
): UserProfileWrite {
  return { ...profile, locale };
}

export function storedMealsToDiaryDay(
  localDate: string,
  isComplete: boolean,
  meals: readonly StoredMeal[],
): DiaryDay {
  if (meals.some((meal) => meal.localDate !== localDate)) {
    throw new Error("Cannot build a diary day from meals belonging to another local date.");
  }
  return {
    date: localDate,
    isComplete,
    meals: meals.map(storedMealToDomain),
  };
}

