import assert from "node:assert/strict";
import test from "node:test";

import {
  REPORT_SCHEMA_VERSION,
  REPORT_SCORE_INPUT_VERSION,
  assertReportInputRevisionCurrent,
  currentReportCacheExpectation,
  reportMatchesCacheExpectation,
} from "./reportCachePolicy";

const current = currentReportCacheExpectation(41, "en-US", "a".repeat(64));

test("meal/profile/diary epochs invalidate day, week, month and year caches", () => {
  for (const periodType of ["day", "week", "month", "year"] as const) {
    const cached = { ...current, periodType };
    assert.equal(reportMatchesCacheExpectation(cached, current), true);
    assert.equal(
      reportMatchesCacheExpectation(cached, { ...current, inputRevision: 42 }),
      false,
      `${periodType} cache must not survive a persisted dietary mutation`,
    );
  }
});

test("locale, deterministic score, prompt and schema versions are cache inputs", () => {
  const cached = { ...current };
  assert.equal(reportMatchesCacheExpectation(cached, { ...current, locale: "zh-CN" }), false);
  assert.equal(reportMatchesCacheExpectation(cached, { ...current, scoreInputVersion: `${REPORT_SCORE_INPUT_VERSION}.next` }), false);
  assert.equal(reportMatchesCacheExpectation(cached, { ...current, promptVersion: "diet-report.v2" }), false);
  assert.equal(reportMatchesCacheExpectation(cached, { ...current, inputFingerprint: "b".repeat(64) }), false);
  assert.equal(reportMatchesCacheExpectation(cached, { ...current, reportSchemaVersion: `${REPORT_SCHEMA_VERSION}.next` }), false);
});

test("an in-flight report is rejected when delete-all advances the durable epoch", () => {
  assert.throws(
    () => assertReportInputRevisionCurrent(7, 8),
    /changed while the AI report was running/,
  );
  assert.doesNotThrow(() => assertReportInputRevisionCurrent(8, 8));
});
