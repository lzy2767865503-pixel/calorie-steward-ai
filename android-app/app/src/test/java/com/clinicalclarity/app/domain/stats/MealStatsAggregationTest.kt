package com.clinicalclarity.app.domain.stats

import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MealStatsAggregationTest {
    @Test
    fun `calendar windows use anchor dates Monday weeks and half-open ends`() {
        val day = StatsWindows.forAnchor(StatsPeriod.DAY, LocalDate.of(2025, 12, 31))
        assertEquals(LocalDate.of(2025, 12, 31), day.startDateInclusive)
        assertEquals(LocalDate.of(2026, 1, 1), day.endDateExclusive)

        val week = StatsWindows.forAnchor(StatsPeriod.WEEK, LocalDate.of(2025, 12, 31))
        assertEquals(LocalDate.of(2025, 12, 29), week.startDateInclusive)
        assertEquals(LocalDate.of(2026, 1, 5), week.endDateExclusive)
        assertTrue(week.contains(LocalDate.of(2025, 12, 29)))
        assertTrue(week.contains(LocalDate.of(2026, 1, 4)))
        assertFalse(week.contains(LocalDate.of(2026, 1, 5)))

        val month = StatsWindows.forAnchor(StatsPeriod.MONTH, LocalDate.of(2024, 2, 19))
        assertEquals(LocalDate.of(2024, 2, 1), month.startDateInclusive)
        assertEquals(LocalDate.of(2024, 3, 1), month.endDateExclusive)
        assertEquals(29, month.calendarDayCount)

        val year = StatsWindows.forAnchor(StatsPeriod.YEAR, LocalDate.of(2024, 8, 1))
        assertEquals(LocalDate.of(2024, 1, 1), year.startDateInclusive)
        assertEquals(LocalDate.of(2025, 1, 1), year.endDateExclusive)
        assertEquals(366, year.calendarDayCount)
    }

    @Test
    fun `Kuala Lumpur instant day is half-open and exactly twenty four hours`() {
        val window = StatsWindows
            .forAnchor(StatsPeriod.DAY, LocalDate.of(2026, 1, 1))
            .toInstantWindow(ZoneId.of("Asia/Kuala_Lumpur"))

        assertEquals(
            Instant.parse("2025-12-31T16:00:00Z").toEpochMilli(),
            window.startEpochMsInclusive,
        )
        assertEquals(
            Instant.parse("2026-01-01T16:00:00Z").toEpochMilli(),
            window.endEpochMsExclusive,
        )
        assertEquals(
            24L,
            Duration.ofMillis(window.endEpochMsExclusive - window.startEpochMsInclusive).toHours(),
        )
        assertTrue(window.contains(window.startEpochMsInclusive))
        assertTrue(window.contains(window.endEpochMsExclusive - 1L))
        assertFalse(window.contains(window.endEpochMsExclusive))
    }

    @Test
    fun `New York instant days honor spring and fall daylight saving boundaries`() {
        val zone = ZoneId.of("America/New_York")
        val spring = StatsWindows
            .forAnchor(StatsPeriod.DAY, LocalDate.of(2026, 3, 8))
            .toInstantWindow(zone)
        val fall = StatsWindows
            .forAnchor(StatsPeriod.DAY, LocalDate.of(2026, 11, 1))
            .toInstantWindow(zone)

        assertEquals(
            23L,
            Duration.ofMillis(spring.endEpochMsExclusive - spring.startEpochMsInclusive).toHours(),
        )
        assertEquals(
            25L,
            Duration.ofMillis(fall.endEpochMsExclusive - fall.startEpochMsInclusive).toHours(),
        )
        assertTrue(spring.contains(spring.startEpochMsInclusive))
        assertFalse(spring.contains(spring.endEpochMsExclusive))
        assertTrue(fall.contains(fall.endEpochMsExclusive - 1L))
        assertFalse(fall.contains(fall.endEpochMsExclusive))
    }

    @Test
    fun `aggregation uses stored local date instead of current zone reinterpretation`() {
        val localDate = LocalDate.of(2026, 1, 1)
        val record = record(
            id = 1L,
            date = localDate,
            zoneId = "Asia/Kuala_Lumpur",
            time = LocalTime.of(0, 15),
            point = 500L,
            low = 450L,
            high = 550L,
        )
        // The same instant is still December 31 in New York, but the persisted meal date remains
        // January 1 and must drive the chart bucket.
        assertEquals(
            LocalDate.of(2025, 12, 31),
            Instant.ofEpochMilli(record.recordedAtEpochMs)
                .atZone(ZoneId.of("America/New_York"))
                .toLocalDate(),
        )

        val result = MealStatsAggregator.aggregate(StatsPeriod.DAY, localDate, listOf(record))

        assertEquals(1L, result.recordCount)
        assertEquals(500L, result.interval.pointKcal)
        assertEquals(localDate, result.highestDay?.date)
    }

    @Test
    fun `week crossing a year includes both calendar years but excludes its end`() {
        val result = MealStatsAggregator.aggregate(
            period = StatsPeriod.WEEK,
            anchor = LocalDate.of(2025, 12, 31),
            records = listOf(
                record(1L, LocalDate.of(2025, 12, 28), point = 100L),
                record(2L, LocalDate.of(2025, 12, 29), point = 200L),
                record(3L, LocalDate.of(2025, 12, 31), point = 300L),
                record(4L, LocalDate.of(2026, 1, 4), point = 400L),
                record(5L, LocalDate.of(2026, 1, 5), point = 800L),
            ),
        )

        assertEquals(7, result.days.size)
        assertEquals(7, result.trend.size)
        assertEquals(3L, result.recordCount)
        assertEquals(900L, result.interval.pointKcal)
        assertEquals(LocalDate.of(2026, 1, 4), result.highestDay?.date)
    }

    @Test
    fun `month day buckets and year month buckets include zero gaps`() {
        val month = MealStatsAggregator.aggregate(
            StatsPeriod.MONTH,
            LocalDate.of(2025, 2, 17),
            listOf(record(1L, LocalDate.of(2025, 2, 28), point = 320L)),
        )
        assertEquals(28, month.days.size)
        assertEquals(28, month.trend.size)
        assertEquals(0L, month.trend.first().recordCount)
        assertEquals(320L, month.trend.last().interval.pointKcal)

        val year = MealStatsAggregator.aggregate(
            StatsPeriod.YEAR,
            LocalDate.of(2024, 7, 10),
            listOf(
                record(2L, LocalDate.of(2024, 2, 29), point = 290L),
                record(3L, LocalDate.of(2024, 12, 31), point = 310L),
                record(4L, LocalDate.of(2025, 1, 1), point = 999L),
            ),
        )
        assertEquals(366, year.days.size)
        assertEquals(StatsBucketUnit.MONTH, year.bucketUnit)
        assertEquals(12, year.trend.size)
        assertEquals(290L, year.trend[1].interval.pointKcal)
        assertEquals(310L, year.trend[11].interval.pointKcal)
        assertEquals(600L, year.interval.pointKcal)
        assertEquals(2L, year.recordCount)
    }

    @Test
    fun `only confirmed non-demo non-deleted rows with persisted calendar metadata count`() {
        val date = LocalDate.of(2026, 8, 18)
        val valid = record(1L, date, point = 100L)
        val records = listOf(
            valid,
            valid.copy(id = 2L, confirmed = false, pointKcal = 200L, lowKcal = 180L, highKcal = 220L),
            valid.copy(id = 3L, confirmed = null, pointKcal = 300L, lowKcal = 280L, highKcal = 320L),
            valid.copy(id = 4L, isDemo = true, pointKcal = 400L, lowKcal = 380L, highKcal = 420L),
            valid.copy(id = 5L, deletedAtEpochMs = 1L, pointKcal = 500L, lowKcal = 480L, highKcal = 520L),
            valid.copy(id = 6L, storedLocalDate = null, pointKcal = 600L, lowKcal = 580L, highKcal = 620L),
            valid.copy(id = 7L, storedZoneId = null, pointKcal = 700L, lowKcal = 680L, highKcal = 720L),
            valid.copy(id = 8L, storedOffsetSeconds = null, pointKcal = 800L, lowKcal = 780L, highKcal = 820L),
        )

        val result = MealStatsAggregator.aggregate(StatsPeriod.DAY, date, records)

        assertEquals(1L, result.recordCount)
        assertEquals(KcalInterval(100L, 90L, 110L), result.interval)
        assertEquals(1, result.coverage.recordedDayCount)
    }

    @Test
    fun `point low and high totals remain Long beyond Int range`() {
        val date = LocalDate.of(2026, 8, 18)
        val result = MealStatsAggregator.aggregate(
            StatsPeriod.DAY,
            date,
            listOf(
                record(
                    id = 1L,
                    date = date,
                    point = 3_000_000_000L,
                    low = 2_900_000_000L,
                    high = 3_100_000_000L,
                ),
                record(
                    id = 2L,
                    date = date,
                    point = 3_000_000_000L,
                    low = 2_900_000_000L,
                    high = 3_100_000_000L,
                    time = LocalTime.of(18, 0),
                ),
            ),
        )

        assertEquals(6_000_000_000L, result.interval.pointKcal)
        assertEquals(5_800_000_000L, result.interval.lowKcal)
        assertEquals(6_200_000_000L, result.interval.highKcal)
        assertEquals(2L, result.recordCount)
    }

    @Test
    fun `average uses only recorded days highest day is deterministic and coverage uses calendar days`() {
        val monday = LocalDate.of(2026, 8, 17)
        val result = MealStatsAggregator.aggregate(
            StatsPeriod.WEEK,
            monday,
            listOf(
                record(1L, monday, point = 400L, low = 300L, high = 500L),
                record(2L, monday.plusDays(2), point = 400L, low = 350L, high = 450L),
            ),
        )

        assertEquals(800L, result.interval.pointKcal)
        assertEquals(400.0, result.averagePerRecordedDay?.pointKcal ?: -1.0, 0.0)
        assertEquals(325.0, result.averagePerRecordedDay?.lowKcal ?: -1.0, 0.0)
        assertEquals(475.0, result.averagePerRecordedDay?.highKcal ?: -1.0, 0.0)
        assertEquals(monday, result.highestDay?.date)
        assertEquals(7, result.coverage.calendarDayCount)
        assertEquals(2, result.coverage.recordedDayCount)
        assertEquals(2.0 / 7.0, result.coverage.recordedDayShare, 1e-12)
    }

    @Test
    fun `empty period has complete zero trend and no average or highest day`() {
        val result = MealStatsAggregator.aggregate(
            StatsPeriod.WEEK,
            LocalDate.of(2026, 8, 18),
            emptyList(),
        )

        assertEquals(KcalInterval.ZERO, result.interval)
        assertEquals(0L, result.recordCount)
        assertEquals(7, result.days.size)
        assertEquals(7, result.trend.size)
        assertTrue(result.trend.all { it.interval == KcalInterval.ZERO })
        assertNull(result.averagePerRecordedDay)
        assertNull(result.highestDay)
        assertEquals(0.0, result.coverage.recordedDayShare, 0.0)
        assertEquals(0.0, result.goalCoverage.configuredGoalShare, 0.0)
    }

    @Test
    fun `current month coverage excludes future days without changing totals or trend`() {
        val anchor = LocalDate.of(2026, 8, 18)
        val result = MealStatsAggregator.aggregate(
            period = StatsPeriod.MONTH,
            anchor = anchor,
            records = listOf(
                record(1L, LocalDate.of(2026, 8, 1), point = 100L),
                record(2L, LocalDate.of(2026, 8, 18), point = 200L),
                record(3L, LocalDate.of(2026, 8, 25), point = 300L),
            ),
            asOf = anchor,
        )

        assertEquals(LocalDate.of(2026, 8, 1), result.coverage.observedStartDateInclusive)
        assertEquals(LocalDate.of(2026, 8, 19), result.coverage.observedEndDateExclusive)
        assertEquals(18, result.coverage.calendarDayCount)
        assertEquals(2, result.coverage.recordedDayCount)
        assertEquals(2.0 / 18.0, result.coverage.recordedDayShare, 1e-12)
        // Coverage clipping must not silently redefine the selected calendar period.
        assertEquals(600L, result.interval.pointKcal)
        assertEquals(3L, result.recordCount)
        assertEquals(31, result.trend.size)
        assertEquals(300L, result.trend[24].interval.pointKcal)
    }

    @Test
    fun `coverage excludes days before tracking began without changing period totals`() {
        val anchor = LocalDate.of(2026, 8, 18)
        val result = MealStatsAggregator.aggregate(
            period = StatsPeriod.MONTH,
            anchor = anchor,
            records = listOf(
                record(1L, LocalDate.of(2026, 8, 5), point = 100L),
                record(2L, LocalDate.of(2026, 8, 10), point = 200L),
                record(3L, LocalDate.of(2026, 8, 18), point = 300L),
            ),
            asOf = anchor,
            trackingStart = LocalDate.of(2026, 8, 10),
        )

        assertEquals(LocalDate.of(2026, 8, 10), result.coverage.observedStartDateInclusive)
        assertEquals(LocalDate.of(2026, 8, 19), result.coverage.observedEndDateExclusive)
        assertEquals(9, result.coverage.calendarDayCount)
        assertEquals(2, result.coverage.recordedDayCount)
        assertEquals(2.0 / 9.0, result.coverage.recordedDayShare, 1e-12)
        assertEquals(600L, result.interval.pointKcal)
        assertEquals(3L, result.recordCount)
    }

    @Test
    fun `coverage permits an empty observation window and avoids division by zero`() {
        val result = MealStatsAggregator.aggregate(
            period = StatsPeriod.MONTH,
            anchor = LocalDate.of(2026, 8, 18),
            records = listOf(record(1L, LocalDate.of(2026, 8, 12), point = 500L)),
            asOf = LocalDate.of(2026, 8, 5),
            trackingStart = LocalDate.of(2026, 8, 10),
        )

        assertEquals(LocalDate.of(2026, 8, 10), result.coverage.observedStartDateInclusive)
        assertEquals(LocalDate.of(2026, 8, 10), result.coverage.observedEndDateExclusive)
        assertEquals(0, result.coverage.calendarDayCount)
        assertEquals(0, result.coverage.recordedDayCount)
        assertEquals(0.0, result.coverage.recordedDayShare, 0.0)
        assertTrue(result.coverage.recordedDayShare.isFinite())
        assertEquals(500L, result.interval.pointKcal)
        assertEquals(1L, result.recordCount)
    }

    @Test
    fun `goal assessment distinguishes definite point possible and not reached with shares`() {
        val monday = LocalDate.of(2026, 1, 5)
        val records = listOf(
            record(1L, monday, point = 2_100L, low = 2_000L, high = 2_200L, goal = 2_000L),
            record(2L, monday.plusDays(1), point = 2_050L, low = 1_900L, high = 2_200L, goal = 2_000L),
            record(3L, monday.plusDays(2), point = 1_900L, low = 1_800L, high = 2_100L, goal = 2_000L),
            record(4L, monday.plusDays(3), point = 1_700L, low = 1_600L, high = 1_900L, goal = 2_000L),
            record(5L, monday.plusDays(4), point = 900L, low = 800L, high = 1_000L, goal = null),
        )

        val result = MealStatsAggregator.aggregate(StatsPeriod.WEEK, monday, records)
        val assessments = result.days.take(4).map { it.goalAssessment!! }

        assertEquals(GoalReachStatus.DEFINITELY_REACHED, assessments[0].status)
        assertEquals(GoalReachStatus.POINT_ESTIMATE_REACHED, assessments[1].status)
        assertEquals(GoalReachStatus.POSSIBLY_REACHED, assessments[2].status)
        assertEquals(GoalReachStatus.NOT_REACHED, assessments[3].status)
        assertEquals(1.05, assessments[0].share.pointShare, 1e-12)
        assertEquals(1.0, assessments[0].share.lowShare, 1e-12)
        assertEquals(1.1, assessments[0].share.highShare, 1e-12)
        assertEquals(5, result.goalCoverage.recordedDayCount)
        assertEquals(4, result.goalCoverage.daysWithGoalCount)
        assertEquals(1, result.goalCoverage.definitelyReachedDayCount)
        assertEquals(1, result.goalCoverage.pointEstimateReachedDayCount)
        assertEquals(1, result.goalCoverage.possiblyReachedDayCount)
        assertEquals(1, result.goalCoverage.notReachedDayCount)
        assertEquals(0.8, result.goalCoverage.configuredGoalShare, 1e-12)
    }

    @Test
    fun `latest record on a day controls the goal snapshot`() {
        val date = LocalDate.of(2026, 8, 18)
        val result = MealStatsAggregator.aggregate(
            StatsPeriod.DAY,
            date,
            listOf(
                record(
                    id = 1L,
                    date = date,
                    time = LocalTime.of(8, 0),
                    point = 1_000L,
                    low = 900L,
                    high = 1_100L,
                    goal = 1_500L,
                ),
                record(
                    id = 2L,
                    date = date,
                    time = LocalTime.of(18, 0),
                    point = 800L,
                    low = 700L,
                    high = 900L,
                    goal = 2_500L,
                ),
            ),
        )

        val assessment = result.selectedDayGoalAssessment!!
        assertEquals(2_500L, assessment.goalKcal)
        assertEquals(KcalInterval(1_800L, 1_600L, 2_000L), assessment.interval)
        assertEquals(GoalReachStatus.NOT_REACHED, assessment.status)
    }

    @Test
    fun `latest null goal snapshot means the recorded day has no usable goal`() {
        val date = LocalDate.of(2026, 8, 18)
        val result = MealStatsAggregator.aggregate(
            StatsPeriod.DAY,
            date,
            listOf(
                record(
                    id = 1L,
                    date = date,
                    time = LocalTime.of(8, 0),
                    point = 500L,
                    goal = 2_000L,
                ),
                record(
                    id = 2L,
                    date = date,
                    time = LocalTime.of(18, 0),
                    point = 600L,
                    goal = null,
                ),
            ),
        )

        assertNull(result.selectedDayGoalAssessment)
        assertEquals(1, result.goalCoverage.recordedDayCount)
        assertEquals(0, result.goalCoverage.daysWithGoalCount)
        assertEquals(0.0, result.goalCoverage.configuredGoalShare, 0.0)
    }

    @Test
    fun `goal history uses latest same-day event and carries it forward`() {
        val january1 = LocalDate.of(2026, 1, 1)
        val history = listOf(
            goalEvent(1L, january1, LocalTime.of(7, 0), 2_000L),
            // A user can change the goal after a meal; the latest event on that stored local date
            // is authoritative for the day's goal display.
            goalEvent(2L, january1, LocalTime.of(20, 0), 1_800L),
            goalEvent(3L, january1.plusDays(5), LocalTime.of(9, 0), 2_100L),
        ).reversed()

        assertNull(GoalHistoryResolver.snapshotForDate(january1.minusDays(1), history))
        assertEquals(2L, GoalHistoryResolver.snapshotForDate(january1, history)?.id)
        assertEquals(1_800L, GoalHistoryResolver.goalForDate(january1, history))
        assertEquals(1_800L, GoalHistoryResolver.goalForDate(january1.plusDays(4), history))
        assertEquals(2_100L, GoalHistoryResolver.goalForDate(january1.plusDays(5), history))
    }

    @Test
    fun `goal history cancellation remains effective until a later goal event`() {
        val january1 = LocalDate.of(2026, 1, 1)
        val history = listOf(
            goalEvent(1L, january1, LocalTime.of(8, 0), 2_000L),
            goalEvent(2L, january1.plusDays(2), LocalTime.of(12, 0), null),
            goalEvent(3L, january1.plusDays(5), LocalTime.of(8, 0), 2_200L),
        )

        val cancellation = GoalHistoryResolver.snapshotForDate(january1.plusDays(2), history)
        assertEquals(2L, cancellation?.id)
        assertNull(cancellation?.goalKcal)
        assertNull(GoalHistoryResolver.goalForDate(january1.plusDays(4), history))
        assertEquals(2_200L, GoalHistoryResolver.goalForDate(january1.plusDays(5), history))
    }

    @Test
    fun `goal history breaks an equal instant tie by larger event id`() {
        val date = LocalDate.of(2026, 8, 18)
        val event = goalEvent(10L, date, LocalTime.NOON, 1_900L)
        val correction = event.copy(id = 11L, goalKcal = 2_100L)

        val resolved = GoalHistoryResolver.snapshotForDate(date, listOf(correction, event))

        assertEquals(11L, resolved?.id)
        assertEquals(2_100L, resolved?.goalKcal)
    }

    @Test
    fun `soft delete removes a record from every period and undo restores its interval`() {
        val date = LocalDate.of(2026, 8, 18)
        val active = record(90L, date, point = 640L, low = 570L, high = 720L)

        StatsPeriod.entries.forEach { period ->
            val before = MealStatsAggregator.aggregate(period, date, listOf(active))
            val deleted = MealStatsAggregator.aggregate(
                period,
                date,
                listOf(active.copy(deletedAtEpochMs = active.recordedAtEpochMs + 1L)),
            )
            val restored = MealStatsAggregator.aggregate(
                period,
                date,
                listOf(active.copy(deletedAtEpochMs = null)),
            )

            assertEquals(1L, before.recordCount)
            assertEquals(KcalInterval.ZERO, deleted.interval)
            assertEquals(0L, deleted.recordCount)
            assertEquals(KcalInterval(640L, 570L, 720L), restored.interval)
            assertEquals(1L, restored.recordCount)
        }
    }

    private fun record(
        id: Long,
        date: LocalDate,
        point: Long,
        low: Long = point - 10L,
        high: Long = point + 10L,
        goal: Long? = null,
        zoneId: String = "Asia/Kuala_Lumpur",
        time: LocalTime = LocalTime.NOON,
    ): MealStatsRecordProjection {
        val zone = ZoneId.of(zoneId)
        val zonedDateTime = date.atTime(time).atZone(zone)
        return MealStatsRecordProjection(
            id = id,
            recordedAtEpochMs = zonedDateTime.toInstant().toEpochMilli(),
            storedLocalDate = date,
            storedZoneId = zone.id,
            storedOffsetSeconds = zonedDateTime.offset.totalSeconds,
            pointKcal = point,
            lowKcal = low,
            highKcal = high,
            confirmed = true,
            isDemo = false,
            deletedAtEpochMs = null,
            goalSnapshotKcal = goal,
        )
    }

    private fun goalEvent(
        id: Long,
        date: LocalDate,
        time: LocalTime,
        goalKcal: Long?,
        zoneId: String = "Asia/Kuala_Lumpur",
    ): GoalHistorySnapshot {
        val effectiveAt = date.atTime(time).atZone(ZoneId.of(zoneId)).toInstant()
        return GoalHistorySnapshot(
            id = id,
            effectiveAtEpochMs = effectiveAt.toEpochMilli(),
            storedLocalDate = date,
            goalKcal = goalKcal,
        )
    }
}
