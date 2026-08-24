package com.clinicalclarity.app.domain.stats

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.temporal.ChronoUnit
import java.time.temporal.TemporalAdjusters

/** Calendar periods used by the meal-history statistics screen. */
enum class StatsPeriod {
    DAY,
    WEEK,
    MONTH,
    YEAR,
}

enum class StatsBucketUnit {
    DAY,
    MONTH,
}

/**
 * A half-open range of stored local dates. End dates are never included.
 *
 * Meal grouping deliberately uses [MealStatsRecordProjection.storedLocalDate], rather than
 * reinterpreting an old instant in the device's current time zone. This keeps a meal attached to
 * the civil date that was persisted when the user confirmed it.
 */
data class StatsDateWindow(
    val startDateInclusive: LocalDate,
    val endDateExclusive: LocalDate,
) {
    init {
        require(startDateInclusive < endDateExclusive) { "Statistics window must not be empty" }
    }

    val calendarDayCount: Int
        get() = ChronoUnit.DAYS.between(startDateInclusive, endDateExclusive).toInt()

    fun contains(date: LocalDate): Boolean =
        date >= startDateInclusive && date < endDateExclusive

    /**
     * Returns query boundaries for records known to use [zoneId]. The duration may be 23, 24, or
     * 25 hours around daylight-saving transitions, so callers must not replace this with a fixed
     * millisecond duration.
     */
    fun toInstantWindow(zoneId: ZoneId): StatsInstantWindow = StatsInstantWindow(
        startEpochMsInclusive = startDateInclusive.atStartOfDay(zoneId).toInstant().toEpochMilli(),
        endEpochMsExclusive = endDateExclusive.atStartOfDay(zoneId).toInstant().toEpochMilli(),
        zoneId = zoneId.id,
    )
}

data class StatsInstantWindow(
    val startEpochMsInclusive: Long,
    val endEpochMsExclusive: Long,
    val zoneId: String,
) {
    init {
        // A civil date can be skipped by a historic zone-rule transition, yielding an empty
        // instant interval. It must never yield a reversed interval.
        require(startEpochMsInclusive <= endEpochMsExclusive)
    }

    fun contains(epochMs: Long): Boolean =
        epochMs >= startEpochMsInclusive && epochMs < endEpochMsExclusive
}

object StatsWindows {
    fun forAnchor(period: StatsPeriod, anchor: LocalDate): StatsDateWindow {
        val start = when (period) {
            StatsPeriod.DAY -> anchor
            StatsPeriod.WEEK -> anchor.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
            StatsPeriod.MONTH -> YearMonth.from(anchor).atDay(1)
            StatsPeriod.YEAR -> LocalDate.of(anchor.year, 1, 1)
        }
        val end = when (period) {
            StatsPeriod.DAY -> start.plusDays(1)
            StatsPeriod.WEEK -> start.plusWeeks(1)
            StatsPeriod.MONTH -> start.plusMonths(1)
            StatsPeriod.YEAR -> start.plusYears(1)
        }
        return StatsDateWindow(start, end)
    }

    fun bucketUnit(period: StatsPeriod): StatsBucketUnit = when (period) {
        StatsPeriod.DAY,
        StatsPeriod.WEEK,
        StatsPeriod.MONTH,
        -> StatsBucketUnit.DAY

        StatsPeriod.YEAR -> StatsBucketUnit.MONTH
    }
}

/**
 * Stable projection of a persisted meal-log row for statistics.
 *
 * Nullable confirmation/calendar fields intentionally represent legacy rows. Legacy rows are not
 * safe to place on a civil-date chart and are therefore excluded until explicitly migrated and
 * confirmed. [storedOffsetSeconds] is the UTC offset captured at confirmation time; it is audit
 * metadata and is not recomputed with a later tzdb version.
 */
data class MealStatsRecordProjection(
    val id: Long,
    val recordedAtEpochMs: Long,
    val storedLocalDate: LocalDate?,
    val storedZoneId: String?,
    val storedOffsetSeconds: Int?,
    val pointKcal: Long,
    val lowKcal: Long,
    val highKcal: Long,
    val confirmed: Boolean?,
    val isDemo: Boolean,
    val deletedAtEpochMs: Long?,
    val goalSnapshotKcal: Long?,
)

/**
 * One persisted goal-history event. A null [goalKcal] is an explicit cancellation, not a missing
 * event. [storedLocalDate] is captured when the event is created so later device-zone changes do
 * not move the change to another civil day.
 */
data class GoalHistorySnapshot(
    val id: Long,
    val effectiveAtEpochMs: Long,
    val storedLocalDate: LocalDate,
    val goalKcal: Long?,
)

/** Resolves the goal in force for a stored local date from an unordered event history. */
object GoalHistoryResolver {
    /**
     * Returns the latest event on or before [date]. Date takes precedence across days; events on
     * the same day are ordered by effective instant and then id. Keeping cancelled snapshots in
     * the result lets callers distinguish "no history yet" from "goal explicitly cancelled".
     */
    fun snapshotForDate(
        date: LocalDate,
        history: Iterable<GoalHistorySnapshot>,
    ): GoalHistorySnapshot? = history
        .asSequence()
        .filter { it.storedLocalDate <= date }
        .maxWithOrNull(
            compareBy<GoalHistorySnapshot> { it.storedLocalDate }
                .thenBy { it.effectiveAtEpochMs }
                .thenBy { it.id },
        )

    fun goalForDate(
        date: LocalDate,
        history: Iterable<GoalHistorySnapshot>,
    ): Long? = snapshotForDate(date, history)?.goalKcal
}

data class KcalInterval(
    val pointKcal: Long,
    val lowKcal: Long,
    val highKcal: Long,
) {
    init {
        require(lowKcal >= 0L) { "Low kcal must be non-negative" }
        require(lowKcal <= pointKcal) { "Low kcal must not exceed point kcal" }
        require(pointKcal <= highKcal) { "Point kcal must not exceed high kcal" }
    }

    operator fun plus(other: KcalInterval): KcalInterval = KcalInterval(
        pointKcal = Math.addExact(pointKcal, other.pointKcal),
        lowKcal = Math.addExact(lowKcal, other.lowKcal),
        highKcal = Math.addExact(highKcal, other.highKcal),
    )

    companion object {
        val ZERO = KcalInterval(pointKcal = 0L, lowKcal = 0L, highKcal = 0L)
    }
}

data class AverageKcalInterval(
    val pointKcal: Double,
    val lowKcal: Double,
    val highKcal: Double,
)

/**
 * Goal status is deliberately interval-aware:
 *
 * - DEFINITELY_REACHED: even the low estimate reaches the goal.
 * - POINT_ESTIMATE_REACHED: the point estimate reaches it, but the low estimate does not.
 * - POSSIBLY_REACHED: only the high estimate reaches it.
 * - NOT_REACHED: even the high estimate stays below it.
 */
enum class GoalReachStatus {
    DEFINITELY_REACHED,
    POINT_ESTIMATE_REACHED,
    POSSIBLY_REACHED,
    NOT_REACHED,
}

data class GoalProgressShare(
    val pointShare: Double,
    val lowShare: Double,
    val highShare: Double,
)

data class GoalAssessment(
    val goalKcal: Long,
    val interval: KcalInterval,
    val status: GoalReachStatus,
    val share: GoalProgressShare,
)

object GoalAssessmentCalculator {
    fun evaluate(interval: KcalInterval, goalKcal: Long): GoalAssessment {
        require(goalKcal > 0L) { "Goal kcal must be positive" }
        val status = when {
            interval.lowKcal >= goalKcal -> GoalReachStatus.DEFINITELY_REACHED
            interval.pointKcal >= goalKcal -> GoalReachStatus.POINT_ESTIMATE_REACHED
            interval.highKcal >= goalKcal -> GoalReachStatus.POSSIBLY_REACHED
            else -> GoalReachStatus.NOT_REACHED
        }
        return GoalAssessment(
            goalKcal = goalKcal,
            interval = interval,
            status = status,
            share = GoalProgressShare(
                pointShare = interval.pointKcal.toDouble() / goalKcal.toDouble(),
                lowShare = interval.lowKcal.toDouble() / goalKcal.toDouble(),
                highShare = interval.highKcal.toDouble() / goalKcal.toDouble(),
            ),
        )
    }
}

data class DailyMealStats(
    val date: LocalDate,
    val interval: KcalInterval,
    val recordCount: Long,
    val goalAssessment: GoalAssessment?,
) {
    val hasRecords: Boolean get() = recordCount > 0L
}

data class RecordingCoverage(
    val observedStartDateInclusive: LocalDate,
    val observedEndDateExclusive: LocalDate,
    val calendarDayCount: Int,
    val recordedDayCount: Int,
    val recordedDayShare: Double,
)

data class GoalCoverage(
    val recordedDayCount: Int,
    val daysWithGoalCount: Int,
    val definitelyReachedDayCount: Int,
    val pointEstimateReachedDayCount: Int,
    val possiblyReachedDayCount: Int,
    val notReachedDayCount: Int,
    /** Share of recorded days that have a usable positive goal snapshot. */
    val configuredGoalShare: Double,
)

data class StatsTrendBucket(
    val startDateInclusive: LocalDate,
    val endDateExclusive: LocalDate,
    val interval: KcalInterval,
    val recordCount: Long,
    val recordedDayCount: Int,
    val goalCoverage: GoalCoverage,
)

data class MealStatsResult(
    val period: StatsPeriod,
    val anchor: LocalDate,
    val window: StatsDateWindow,
    val bucketUnit: StatsBucketUnit,
    val interval: KcalInterval,
    val averagePerRecordedDay: AverageKcalInterval?,
    val highestDay: DailyMealStats?,
    val recordCount: Long,
    val coverage: RecordingCoverage,
    val goalCoverage: GoalCoverage,
    val days: List<DailyMealStats>,
    val trend: List<StatsTrendBucket>,
) {
    /** A direct day-level goal result is meaningful only in DAY mode. */
    val selectedDayGoalAssessment: GoalAssessment?
        get() = if (period == StatsPeriod.DAY) days.single().goalAssessment else null
}

object MealStatsAggregator {
    fun aggregate(
        period: StatsPeriod,
        anchor: LocalDate,
        records: Iterable<MealStatsRecordProjection>,
        asOf: LocalDate? = null,
        trackingStart: LocalDate? = null,
    ): MealStatsResult {
        val window = StatsWindows.forAnchor(period, anchor)
        val accumulators = linkedMapOf<LocalDate, DayAccumulator>()
        var date = window.startDateInclusive
        while (date < window.endDateExclusive) {
            accumulators[date] = DayAccumulator()
            date = date.plusDays(1)
        }

        records.forEach { record ->
            val storedDate = record.eligibleStoredDate() ?: return@forEach
            if (!window.contains(storedDate)) return@forEach
            accumulators.getValue(storedDate).add(record)
        }

        val days = accumulators.map { (localDate, accumulator) ->
            accumulator.toDailyStats(localDate)
        }
        val recordedDays = days.filter(DailyMealStats::hasRecords)
        val interval = recordedDays.fold(KcalInterval.ZERO) { total, day -> total + day.interval }
        val recordCount = recordedDays.fold(0L) { total, day ->
            Math.addExact(total, day.recordCount)
        }
        val average = if (recordedDays.isEmpty()) {
            null
        } else {
            AverageKcalInterval(
                pointKcal = interval.pointKcal.toDouble() / recordedDays.size.toDouble(),
                lowKcal = interval.lowKcal.toDouble() / recordedDays.size.toDouble(),
                highKcal = interval.highKcal.toDouble() / recordedDays.size.toDouble(),
            )
        }
        val highestDay = recordedDays.maxWithOrNull(
            compareBy<DailyMealStats> { it.interval.pointKcal }
                // maxWith chooses the later date on a tie; reverse the date comparison so the
                // earliest equal day wins deterministically.
                .thenByDescending { it.date },
        )
        val observationWindow = observationWindow(
            periodWindow = window,
            asOf = asOf,
            trackingStart = trackingStart,
        )
        val observedRecordedDayCount = recordedDays.count { day ->
            day.date >= observationWindow.startDateInclusive &&
                day.date < observationWindow.endDateExclusive
        }
        val coverage = RecordingCoverage(
            observedStartDateInclusive = observationWindow.startDateInclusive,
            observedEndDateExclusive = observationWindow.endDateExclusive,
            calendarDayCount = observationWindow.calendarDayCount,
            recordedDayCount = observedRecordedDayCount,
            recordedDayShare = if (observationWindow.calendarDayCount == 0) {
                0.0
            } else {
                observedRecordedDayCount.toDouble() / observationWindow.calendarDayCount.toDouble()
            },
        )
        val goalCoverage = goalCoverage(recordedDays)
        val bucketUnit = StatsWindows.bucketUnit(period)
        val trend = when (bucketUnit) {
            StatsBucketUnit.DAY -> days.map { day ->
                trendBucket(day.date, day.date.plusDays(1), listOf(day))
            }

            StatsBucketUnit.MONTH -> buildMonthlyTrend(window, days)
        }

        return MealStatsResult(
            period = period,
            anchor = anchor,
            window = window,
            bucketUnit = bucketUnit,
            interval = interval,
            averagePerRecordedDay = average,
            highestDay = highestDay,
            recordCount = recordCount,
            coverage = coverage,
            goalCoverage = goalCoverage,
            days = days,
            trend = trend,
        )
    }

    private fun buildMonthlyTrend(
        window: StatsDateWindow,
        days: List<DailyMealStats>,
    ): List<StatsTrendBucket> {
        val daysByMonth = days.groupBy { YearMonth.from(it.date) }
        val buckets = mutableListOf<StatsTrendBucket>()
        var month = YearMonth.from(window.startDateInclusive)
        val endMonth = YearMonth.from(window.endDateExclusive.minusDays(1))
        while (month <= endMonth) {
            val start = month.atDay(1).coerceAtLeast(window.startDateInclusive)
            val end = month.plusMonths(1).atDay(1).coerceAtMost(window.endDateExclusive)
            buckets += trendBucket(start, end, daysByMonth[month].orEmpty())
            month = month.plusMonths(1)
        }
        return buckets
    }

    private fun trendBucket(
        startDateInclusive: LocalDate,
        endDateExclusive: LocalDate,
        days: List<DailyMealStats>,
    ): StatsTrendBucket {
        val recordedDays = days.filter(DailyMealStats::hasRecords)
        return StatsTrendBucket(
            startDateInclusive = startDateInclusive,
            endDateExclusive = endDateExclusive,
            interval = recordedDays.fold(KcalInterval.ZERO) { total, day -> total + day.interval },
            recordCount = recordedDays.fold(0L) { total, day ->
                Math.addExact(total, day.recordCount)
            },
            recordedDayCount = recordedDays.size,
            goalCoverage = goalCoverage(recordedDays),
        )
    }

    private fun goalCoverage(recordedDays: List<DailyMealStats>): GoalCoverage {
        val assessments = recordedDays.mapNotNull(DailyMealStats::goalAssessment)
        return GoalCoverage(
            recordedDayCount = recordedDays.size,
            daysWithGoalCount = assessments.size,
            definitelyReachedDayCount = assessments.count {
                it.status == GoalReachStatus.DEFINITELY_REACHED
            },
            pointEstimateReachedDayCount = assessments.count {
                it.status == GoalReachStatus.POINT_ESTIMATE_REACHED
            },
            possiblyReachedDayCount = assessments.count {
                it.status == GoalReachStatus.POSSIBLY_REACHED
            },
            notReachedDayCount = assessments.count {
                it.status == GoalReachStatus.NOT_REACHED
            },
            configuredGoalShare = if (recordedDays.isEmpty()) {
                0.0
            } else {
                assessments.size.toDouble() / recordedDays.size.toDouble()
            },
        )
    }

    /**
     * Coverage observes only period ∩ [trackingStart, asOf + 1 day). It may be empty. This
     * window deliberately affects only RecordingCoverage; totals, trend, average and highest-day
     * calculations retain the full selected-period semantics.
     */
    private fun observationWindow(
        periodWindow: StatsDateWindow,
        asOf: LocalDate?,
        trackingStart: LocalDate?,
    ): ObservationDateWindow {
        val requestedStart = trackingStart ?: periodWindow.startDateInclusive
        val requestedEndExclusive = asOf
            ?.let(::dayAfterForCoverage)
            ?: periodWindow.endDateExclusive

        val boundedStart = requestedStart
            .coerceAtLeast(periodWindow.startDateInclusive)
            .coerceAtMost(periodWindow.endDateExclusive)
        val boundedEnd = requestedEndExclusive
            .coerceAtLeast(periodWindow.startDateInclusive)
            .coerceAtMost(periodWindow.endDateExclusive)
        val nonReversedEnd = boundedEnd.coerceAtLeast(boundedStart)
        return ObservationDateWindow(
            startDateInclusive = boundedStart,
            endDateExclusive = nonReversedEnd,
        )
    }

    private fun dayAfterForCoverage(date: LocalDate): LocalDate =
        if (date == LocalDate.MAX) LocalDate.MAX else date.plusDays(1)

    private fun MealStatsRecordProjection.eligibleStoredDate(): LocalDate? {
        if (confirmed != true || isDemo || deletedAtEpochMs != null) return null
        val localDate = storedLocalDate ?: return null
        if (storedZoneId.isNullOrBlank()) return null
        val offsetSeconds = storedOffsetSeconds ?: return null
        if (offsetSeconds !in MIN_OFFSET_SECONDS..MAX_OFFSET_SECONDS) return null
        if (lowKcal < 0L || lowKcal > pointKcal || pointKcal > highKcal) return null
        return localDate
    }

    private class DayAccumulator {
        private var interval: KcalInterval = KcalInterval.ZERO
        private var recordCount: Long = 0L
        private var latestRecordEpochMs: Long = Long.MIN_VALUE
        private var latestRecordId: Long = Long.MIN_VALUE
        private var latestGoalSnapshot: Long? = null

        fun add(record: MealStatsRecordProjection) {
            interval += KcalInterval(
                pointKcal = record.pointKcal,
                lowKcal = record.lowKcal,
                highKcal = record.highKcal,
            )
            recordCount = Math.addExact(recordCount, 1L)

            // The last confirmed record of a day carries the authoritative goal snapshot for that
            // day. A null/non-positive latest snapshot explicitly means no usable goal was set.
            val isLater = record.recordedAtEpochMs > latestRecordEpochMs ||
                (record.recordedAtEpochMs == latestRecordEpochMs && record.id > latestRecordId)
            if (isLater) {
                latestRecordEpochMs = record.recordedAtEpochMs
                latestRecordId = record.id
                latestGoalSnapshot = record.goalSnapshotKcal?.takeIf { it > 0L }
            }
        }

        fun toDailyStats(date: LocalDate): DailyMealStats = DailyMealStats(
            date = date,
            interval = interval,
            recordCount = recordCount,
            goalAssessment = latestGoalSnapshot?.let { goal ->
                GoalAssessmentCalculator.evaluate(interval, goal)
            },
        )
    }

    private const val MIN_OFFSET_SECONDS = -18 * 60 * 60
    private const val MAX_OFFSET_SECONDS = 18 * 60 * 60

    private data class ObservationDateWindow(
        val startDateInclusive: LocalDate,
        val endDateExclusive: LocalDate,
    ) {
        val calendarDayCount: Int
            get() = ChronoUnit.DAYS.between(startDateInclusive, endDateExclusive).toInt()
    }
}
