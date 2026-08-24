import type { NutrientRange } from './types';

export function assertNutrientRange(
  range: NutrientRange,
  label = 'nutrient range',
): void {
  const values = [range.low, range.estimate, range.high];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} must contain only finite numbers.`);
  }
  if (range.low < 0) {
    throw new Error(`${label} cannot contain negative amounts.`);
  }
  if (range.low > range.estimate || range.estimate > range.high) {
    throw new Error(`${label} must satisfy low <= estimate <= high.`);
  }
}

export function exactRange(value: number): NutrientRange {
  const range = { low: value, estimate: value, high: value };
  assertNutrientRange(range);
  return range;
}

export function addRanges(ranges: readonly NutrientRange[]): NutrientRange {
  if (ranges.length === 0) {
    throw new Error('Cannot add an empty list of ranges.');
  }

  let low = 0;
  let estimate = 0;
  let high = 0;
  for (const range of ranges) {
    assertNutrientRange(range);
    low += range.low;
    estimate += range.estimate;
    high += range.high;
  }
  return { low, estimate, high };
}

export function divideRange(
  range: NutrientRange,
  divisor: number,
): NutrientRange {
  assertNutrientRange(range);
  if (!Number.isFinite(divisor) || divisor <= 0) {
    throw new Error('Range divisor must be a positive finite number.');
  }
  return {
    low: range.low / divisor,
    estimate: range.estimate / divisor,
    high: range.high / divisor,
  };
}

/**
 * Computes a conservative ratio interval. Correlation between numerator and
 * denominator is intentionally not assumed.
 */
export function ratioRange(
  numerator: NutrientRange,
  denominator: NutrientRange,
  multiplier = 1,
): NutrientRange | null {
  assertNutrientRange(numerator, 'ratio numerator');
  assertNutrientRange(denominator, 'ratio denominator');
  if (denominator.low <= 0 || denominator.estimate <= 0) {
    return null;
  }
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error('Ratio multiplier must be a non-negative finite number.');
  }

  return {
    low: (numerator.low / denominator.high) * multiplier,
    estimate: (numerator.estimate / denominator.estimate) * multiplier,
    high: (numerator.high / denominator.low) * multiplier,
  };
}

export function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Maps a value interval through a possibly non-monotonic scoring function. */
export function mapRangeToScore(
  range: NutrientRange,
  scoringFunction: (value: number) => number,
  criticalPoints: readonly number[] = [],
): NutrientRange {
  assertNutrientRange(range, 'scoring input');
  const candidates = [range.low, range.estimate, range.high];
  for (const point of criticalPoints) {
    if (point >= range.low && point <= range.high) {
      candidates.push(point);
    }
  }

  const scored = candidates.map((value) =>
    clamp(scoringFunction(value), 0, 1) * 100,
  );
  const estimate = clamp(scoringFunction(range.estimate), 0, 1) * 100;
  return {
    low: Math.min(...scored),
    estimate,
    high: Math.max(...scored),
  };
}
