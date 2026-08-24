package com.clinicalclarity.app.data.database

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import com.clinicalclarity.app.domain.model.MAX_CALORIE_GOAL_KCAL
import com.clinicalclarity.app.domain.model.MIN_CALORIE_GOAL_KCAL
import com.clinicalclarity.app.domain.model.EstimateStatus
import com.clinicalclarity.app.domain.model.MealEstimate
import com.clinicalclarity.app.domain.model.MealSourceKind
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject

enum class MealRecordStatus {
    CONFIRMED,
    LEGACY_UNVERIFIED,
}

sealed interface SaveMealResult {
    val id: Long

    data class Inserted(override val id: Long) : SaveMealResult
    data class AlreadyExists(override val id: Long) : SaveMealResult
}

data class StoredMealLog(
    val id: Long,
    val entryId: String,
    val scanId: String,
    val recordedAtEpochMs: Long,
    val localDate: LocalDate,
    val recordedZoneId: String,
    val recordedOffsetSeconds: Int,
    val mealType: String,
    val pointKcal: Int,
    val lowKcal: Int,
    val highKcal: Int,
    val confidence: Double,
    val sourceLabel: String,
    val sourceKind: MealSourceKind,
    val modelVersion: String,
    val datasetVersion: String,
    val assumptions: List<String>,
    val recordStatus: MealRecordStatus,
    val isConfirmed: Boolean,
    val isDemo: Boolean,
    val goalKcalAtLog: Int?,
    val deletedAtEpochMs: Long?,
)

data class StoredGoalEvent(
    val id: Long,
    val changeId: String,
    val effectiveAtEpochMs: Long,
    val localDate: LocalDate,
    val recordedZoneId: String,
    val recordedOffsetSeconds: Int,
    val goalKcal: Int?,
)

class MealLogStore(
    context: Context,
    private val clock: Clock = Clock.systemUTC(),
    private val zoneProvider: () -> ZoneId = { ZoneId.systemDefault() },
) : SQLiteOpenHelper(context, DATABASE_NAME, null, DATABASE_VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE meal_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id TEXT NOT NULL UNIQUE,
                recorded_at INTEGER NOT NULL,
                local_date TEXT NOT NULL,
                recorded_zone_id TEXT NOT NULL,
                recorded_offset_seconds INTEGER NOT NULL,
                meal_type TEXT NOT NULL,
                estimated_kcal INTEGER NOT NULL,
                low_kcal INTEGER NOT NULL,
                high_kcal INTEGER NOT NULL,
                confidence REAL NOT NULL,
                scan_id TEXT NOT NULL UNIQUE,
                image_path TEXT,
                source_label TEXT NOT NULL,
                source_kind TEXT NOT NULL,
                model_version TEXT NOT NULL,
                dataset_version TEXT NOT NULL,
                items_json TEXT NOT NULL,
                assumptions_json TEXT NOT NULL,
                record_status TEXT NOT NULL,
                is_confirmed INTEGER NOT NULL,
                is_demo INTEGER NOT NULL,
                goal_kcal_at_log INTEGER,
                deleted_at INTEGER,
                CHECK (low_kcal <= estimated_kcal AND estimated_kcal <= high_kcal),
                CHECK (is_confirmed IN (0, 1)),
                CHECK (is_demo IN (0, 1))
            )
            """.trimIndent(),
        )
        createIndexes(db)
        createGoalHistoryTable(db)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        if (oldVersion < 2) {
            db.execSQL("ALTER TABLE meal_log ADD COLUMN assumptions_json TEXT NOT NULL DEFAULT '[]'")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0")
        }
        if (oldVersion < 3) {
            db.execSQL("ALTER TABLE meal_log ADD COLUMN entry_id TEXT")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN local_date TEXT")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN recorded_zone_id TEXT")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN recorded_offset_seconds INTEGER")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'LEGACY_UNKNOWN'")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN record_status TEXT NOT NULL DEFAULT 'LEGACY_UNVERIFIED'")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN is_confirmed INTEGER NOT NULL DEFAULT 0")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN goal_kcal_at_log INTEGER")
            db.execSQL("ALTER TABLE meal_log ADD COLUMN deleted_at INTEGER")
            backfillLegacyIdentityAndLocalTime(db)
            db.execSQL("CREATE UNIQUE INDEX IF NOT EXISTS idx_meal_log_entry_id ON meal_log(entry_id)")
            createIndexes(db)
        }
        if (oldVersion < 4) {
            createGoalHistoryTable(db)
        }
    }

    fun save(
        estimate: MealEstimate,
        goalKcal: Int?,
        mealType: String? = null,
    ): SaveMealResult {
        require(!estimate.isDemo) { "演示结果不能写入餐食日志" }
        require(estimate.status == EstimateStatus.REQUIRES_CONFIRMATION) {
            "只能记录经用户确认的待确认结果"
        }
        require(
            estimate.sourceKind != MealSourceKind.NUTRITION_LABEL_OCR &&
                estimate.sourceKind != MealSourceKind.OFFLINE_DEMO &&
                estimate.sourceKind != MealSourceKind.LEGACY_UNKNOWN,
        ) { "该来源尚未完成人工确认流程" }
        require(estimate.lowKcal <= estimate.estimatedKcal && estimate.estimatedKcal <= estimate.highKcal) {
            "热量范围契约无效"
        }
        require(goalKcal == null || goalKcal in MIN_CALORIE_GOAL_KCAL..MAX_CALORIE_GOAL_KCAL) {
            "每日目标无效"
        }

        // One instant and one zone snapshot drive every persisted time field and meal classification.
        val recordedAt = clock.instant()
        val zoneId = zoneProvider()
        val localTime = recordedAt.atZone(zoneId)
        val entryId = UUID.randomUUID().toString()
        val values = ContentValues().apply {
            put("entry_id", entryId)
            put("recorded_at", recordedAt.toEpochMilli())
            put("local_date", localTime.toLocalDate().toString())
            put("recorded_zone_id", zoneId.id)
            put("recorded_offset_seconds", localTime.offset.totalSeconds)
            put("meal_type", mealType?.takeIf(String::isNotBlank) ?: inferMealType(localTime))
            put("estimated_kcal", estimate.estimatedKcal)
            put("low_kcal", estimate.lowKcal)
            put("high_kcal", estimate.highKcal)
            put("confidence", estimate.confidence)
            put("scan_id", estimate.scanId)
            // Meal photos stay temporary unless a future explicit retention consent flow is added.
            putNull("image_path")
            put("source_label", estimate.sourceLabel)
            put("source_kind", estimate.sourceKind.name)
            put("model_version", estimate.modelVersion)
            put("dataset_version", estimate.datasetVersion)
            put("items_json", itemsJson(estimate))
            put("assumptions_json", JSONArray(estimate.assumptions).toString())
            put("record_status", MealRecordStatus.CONFIRMED.name)
            put("is_confirmed", 1)
            put("is_demo", 0)
            if (goalKcal == null) putNull("goal_kcal_at_log") else put("goal_kcal_at_log", goalKcal)
            putNull("deleted_at")
        }
        val insertedId = writableDatabase.insertWithOnConflict(
            "meal_log",
            null,
            values,
            SQLiteDatabase.CONFLICT_IGNORE,
        )
        if (insertedId != -1L) return SaveMealResult.Inserted(insertedId)

        val existingId = findIdByScanId(estimate.scanId)
            ?: error("记录写入冲突，但无法找到原记录")
        return SaveMealResult.AlreadyExists(existingId)
    }

    /** Reads by the local date captured at save time; the end is exclusive. */
    fun listActive(start: LocalDate, endExclusive: LocalDate): List<StoredMealLog> {
        require(start < endExclusive) { "日期范围必须是 [start, endExclusive)" }
        return readableDatabase.rawQuery(
            """
            SELECT $SELECT_COLUMNS FROM meal_log
            WHERE local_date >= ? AND local_date < ?
              AND record_status = ? AND is_confirmed = 1 AND is_demo = 0 AND deleted_at IS NULL
            ORDER BY local_date ASC, recorded_at ASC, id ASC
            """.trimIndent(),
            arrayOf(start.toString(), endExclusive.toString(), MealRecordStatus.CONFIRMED.name),
        ).use(::readRows)
    }

    fun listRecent(limit: Int = 8): List<StoredMealLog> {
        require(limit in 1..100) { "limit 必须在 1–100 之间" }
        return readableDatabase.rawQuery(
            """
            SELECT $SELECT_COLUMNS FROM meal_log
            WHERE record_status = ? AND is_confirmed = 1 AND is_demo = 0 AND deleted_at IS NULL
            ORDER BY recorded_at DESC, id DESC LIMIT ?
            """.trimIndent(),
            arrayOf(MealRecordStatus.CONFIRMED.name, limit.toString()),
        ).use(::readRows)
    }

    fun recordGoalSetting(goalKcal: Int?) {
        require(goalKcal == null || goalKcal in MIN_CALORIE_GOAL_KCAL..MAX_CALORIE_GOAL_KCAL) {
            "每日目标无效"
        }
        val effectiveAt = clock.instant()
        val zoneId = zoneProvider()
        val local = effectiveAt.atZone(zoneId)
        val values = ContentValues().apply {
            put("change_id", UUID.randomUUID().toString())
            put("effective_at", effectiveAt.toEpochMilli())
            put("local_date", local.toLocalDate().toString())
            put("recorded_zone_id", zoneId.id)
            put("recorded_offset_seconds", local.offset.totalSeconds)
            if (goalKcal == null) putNull("goal_kcal") else put("goal_kcal", goalKcal)
        }
        writableDatabase.insertOrThrow("goal_history", null, values)
    }

    /** Current user-set reference line; null means never set or explicitly restored to unset. */
    fun currentGoalKcal(): Int? = readableDatabase.rawQuery(
        "SELECT goal_kcal FROM goal_history ORDER BY effective_at DESC, id DESC LIMIT 1",
        null,
    ).use { cursor ->
        if (!cursor.moveToFirst() || cursor.isNull(0)) null else cursor.getInt(0)
    }

    /** Returns all goal events before the exclusive stored-local-date boundary. */
    fun listGoalEvents(endExclusive: LocalDate): List<StoredGoalEvent> = readableDatabase.rawQuery(
        """
        SELECT id, change_id, effective_at, local_date, recorded_zone_id,
               recorded_offset_seconds, goal_kcal
        FROM goal_history
        WHERE local_date < ?
        ORDER BY local_date ASC, effective_at ASC, id ASC
        """.trimIndent(),
        arrayOf(endExclusive.toString()),
    ).use { cursor ->
        buildList {
            while (cursor.moveToNext()) {
                add(
                    StoredGoalEvent(
                        id = cursor.long("id"),
                        changeId = cursor.string("change_id"),
                        effectiveAtEpochMs = cursor.long("effective_at"),
                        localDate = LocalDate.parse(cursor.string("local_date")),
                        recordedZoneId = cursor.string("recorded_zone_id"),
                        recordedOffsetSeconds = cursor.int("recorded_offset_seconds"),
                        goalKcal = cursor.intOrNull("goal_kcal"),
                    ),
                )
            }
        }
    }

    /** First date on which this installation has verified tracking evidence. */
    fun trackingStartDate(): LocalDate? {
        val mealStart = readableDatabase.rawQuery(
            """
            SELECT MIN(local_date) FROM meal_log
            WHERE record_status = ? AND is_confirmed = 1 AND is_demo = 0 AND deleted_at IS NULL
            """.trimIndent(),
            arrayOf(MealRecordStatus.CONFIRMED.name),
        ).use { cursor -> if (cursor.moveToFirst() && !cursor.isNull(0)) LocalDate.parse(cursor.getString(0)) else null }
        val goalStart = readableDatabase.rawQuery(
            "SELECT MIN(local_date) FROM goal_history",
            null,
        ).use { cursor -> if (cursor.moveToFirst() && !cursor.isNull(0)) LocalDate.parse(cursor.getString(0)) else null }
        return listOfNotNull(mealStart, goalStart).minOrNull()
    }

    fun softDelete(id: Long): Boolean {
        val values = ContentValues().apply { put("deleted_at", clock.instant().toEpochMilli()) }
        return writableDatabase.update(
            "meal_log",
            values,
            "id = ? AND deleted_at IS NULL",
            arrayOf(id.toString()),
        ) == 1
    }

    fun restore(id: Long): Boolean {
        val values = ContentValues().apply { putNull("deleted_at") }
        return writableDatabase.update(
            "meal_log",
            values,
            "id = ? AND deleted_at IS NOT NULL",
            arrayOf(id.toString()),
        ) == 1
    }

    fun purge(id: Long): Boolean = writableDatabase.delete(
        "meal_log",
        "id = ? AND deleted_at IS NOT NULL",
        arrayOf(id.toString()),
    ) == 1

    fun purgeAllSoftDeleted(): Int = writableDatabase.delete(
        "meal_log",
        "deleted_at IS NOT NULL",
        null,
    )

    fun deleteAllPermanently(): Int = writableDatabase.delete("meal_log", null, null)

    private fun findIdByScanId(scanId: String): Long? = readableDatabase.rawQuery(
        "SELECT id FROM meal_log WHERE scan_id = ? LIMIT 1",
        arrayOf(scanId),
    ).use { cursor -> if (cursor.moveToFirst()) cursor.getLong(0) else null }

    private fun readRows(cursor: Cursor): List<StoredMealLog> = buildList {
        while (cursor.moveToNext()) {
            add(
                StoredMealLog(
                    id = cursor.long("id"),
                    entryId = cursor.stringOrNull("entry_id") ?: "legacy-${cursor.long("id")}",
                    scanId = cursor.string("scan_id"),
                    recordedAtEpochMs = cursor.long("recorded_at"),
                    localDate = LocalDate.parse(cursor.string("local_date")),
                    recordedZoneId = cursor.stringOrNull("recorded_zone_id") ?: ZoneOffset.UTC.id,
                    recordedOffsetSeconds = cursor.intOrNull("recorded_offset_seconds") ?: 0,
                    mealType = cursor.string("meal_type"),
                    pointKcal = cursor.int("estimated_kcal"),
                    lowKcal = cursor.int("low_kcal"),
                    highKcal = cursor.int("high_kcal"),
                    confidence = cursor.double("confidence"),
                    sourceLabel = cursor.string("source_label"),
                    sourceKind = enumValueOrDefault(cursor.string("source_kind"), MealSourceKind.LEGACY_UNKNOWN),
                    modelVersion = cursor.string("model_version"),
                    datasetVersion = cursor.string("dataset_version"),
                    assumptions = parseStringArray(cursor.string("assumptions_json")),
                    recordStatus = enumValueOrDefault(cursor.string("record_status"), MealRecordStatus.LEGACY_UNVERIFIED),
                    isConfirmed = cursor.int("is_confirmed") == 1,
                    isDemo = cursor.int("is_demo") == 1,
                    goalKcalAtLog = cursor.intOrNull("goal_kcal_at_log"),
                    deletedAtEpochMs = cursor.longOrNull("deleted_at"),
                ),
            )
        }
    }

    private fun backfillLegacyIdentityAndLocalTime(db: SQLiteDatabase) {
        val fallbackZone = zoneProvider()
        db.rawQuery("SELECT id, recorded_at FROM meal_log", null).use { cursor ->
            val idIndex = cursor.getColumnIndexOrThrow("id")
            val recordedAtIndex = cursor.getColumnIndexOrThrow("recorded_at")
            while (cursor.moveToNext()) {
                val id = cursor.getLong(idIndex)
                val instant = Instant.ofEpochMilli(cursor.getLong(recordedAtIndex))
                val local = instant.atZone(fallbackZone)
                val values = ContentValues().apply {
                    put("entry_id", "legacy-$id")
                    put("local_date", local.toLocalDate().toString())
                    put("recorded_zone_id", fallbackZone.id)
                    put("recorded_offset_seconds", local.offset.totalSeconds)
                }
                db.update("meal_log", values, "id = ?", arrayOf(id.toString()))
            }
        }
    }

    private fun createIndexes(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS idx_meal_log_active_local_date
            ON meal_log(record_status, is_confirmed, is_demo, deleted_at, local_date)
            """.trimIndent(),
        )
    }

    private fun createGoalHistoryTable(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE IF NOT EXISTS goal_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                change_id TEXT NOT NULL UNIQUE,
                effective_at INTEGER NOT NULL,
                local_date TEXT NOT NULL,
                recorded_zone_id TEXT NOT NULL,
                recorded_offset_seconds INTEGER NOT NULL,
                goal_kcal INTEGER
            )
            """.trimIndent(),
        )
        db.execSQL(
            """
            CREATE INDEX IF NOT EXISTS idx_goal_history_local_date
            ON goal_history(local_date, effective_at, id)
            """.trimIndent(),
        )
    }

    private fun inferMealType(localTime: ZonedDateTime): String = when (localTime.hour) {
        in 5..10 -> "早餐"
        in 11..15 -> "午餐"
        in 16..21 -> "晚餐"
        else -> "加餐"
    }

    private fun itemsJson(estimate: MealEstimate): String = JSONArray(
        estimate.items.map { item ->
            JSONObject()
                .put("name", item.name)
                .put("grams", item.estimatedGrams)
                .put("kcal", item.estimatedKcal)
                .put("quality", item.qualityGrade)
        },
    ).toString()

    private fun parseStringArray(json: String): List<String> = runCatching {
        val array = JSONArray(json)
        List(array.length()) { index -> array.getString(index) }
    }.getOrDefault(emptyList())

    private inline fun <reified T : Enum<T>> enumValueOrDefault(raw: String, fallback: T): T =
        enumValues<T>().firstOrNull { it.name == raw } ?: fallback

    private fun Cursor.index(name: String): Int = getColumnIndexOrThrow(name)
    private fun Cursor.string(name: String): String = getString(index(name))
    private fun Cursor.stringOrNull(name: String): String? = index(name).let { if (isNull(it)) null else getString(it) }
    private fun Cursor.long(name: String): Long = getLong(index(name))
    private fun Cursor.longOrNull(name: String): Long? = index(name).let { if (isNull(it)) null else getLong(it) }
    private fun Cursor.int(name: String): Int = getInt(index(name))
    private fun Cursor.intOrNull(name: String): Int? = index(name).let { if (isNull(it)) null else getInt(it) }
    private fun Cursor.double(name: String): Double = getDouble(index(name))

    private companion object {
        const val DATABASE_NAME = "meal_log.sqlite"
        const val DATABASE_VERSION = 4
        const val SELECT_COLUMNS = """
            id, entry_id, scan_id, recorded_at, local_date, recorded_zone_id,
            recorded_offset_seconds, meal_type, estimated_kcal, low_kcal, high_kcal,
            confidence, source_label, source_kind, model_version, dataset_version,
            assumptions_json, record_status, is_confirmed, is_demo, goal_kcal_at_log, deleted_at
        """
    }
}
