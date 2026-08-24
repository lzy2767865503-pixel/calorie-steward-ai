import assert from "node:assert/strict";
import test from "node:test";

import type { DiaryDay, MealRecord } from "../domain/types";
import { countMealsInDiaryDays } from "./summaryViews";

test("report meal counts reuse complete paginated diary data beyond 5,000 rows", () => {
  const meal = {} as MealRecord;
  const days: DiaryDay[] = [
    {
      date: "2025-01-01",
      isComplete: true,
      meals: Array.from({ length: 5_000 }, () => meal),
    },
    {
      date: "2025-01-02",
      isComplete: true,
      meals: Array.from({ length: 1_001 }, () => meal),
    },
  ];

  assert.equal(countMealsInDiaryDays(days), 6_001);
});
