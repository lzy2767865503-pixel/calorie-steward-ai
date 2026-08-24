package com.clinicalclarity.app.data.database

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.clinicalclarity.app.BuildConfig
import com.clinicalclarity.app.data.barcode.Gtin
import com.clinicalclarity.app.domain.model.FoodRecord
import com.clinicalclarity.app.domain.repository.FoodCatalog
import java.io.File
import java.io.FileOutputStream
import java.nio.file.AtomicMoveNotSupportedException
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.security.MessageDigest

class AssetFoodCatalog(private val context: Context) : FoodCatalog {
    private val database: SQLiteDatabase by lazy { openDatabase() }

    override fun count(): Int = database.rawQuery("SELECT COUNT(*) FROM food", null).use {
        if (it.moveToFirst()) it.getInt(0) else 0
    }

    override fun findByBarcode(barcode: String): FoodRecord? {
        val normalized = Gtin.normalize(barcode) ?: return null
        return database.rawQuery(
            "SELECT * FROM food WHERE barcode_gtin14 = ? AND active = 1 LIMIT 1",
            arrayOf(normalized),
        ).use(::firstOrNull)
    }

    override fun findById(id: Long): FoodRecord? = database.rawQuery(
        "SELECT * FROM food WHERE id = ? LIMIT 1",
        arrayOf(id.toString()),
    ).use(::firstOrNull)

    override fun search(query: String, limit: Int): List<FoodRecord> {
        val normalized = query.trim()
        if (normalized.isEmpty()) return emptyList()
        require(normalized.length <= MAX_SEARCH_QUERY_LENGTH) {
            "搜索词不能超过 $MAX_SEARCH_QUERY_LENGTH 个字符"
        }
        require(limit in 1..MAX_SEARCH_RESULT_LIMIT) {
            "搜索结果上限需在 1–$MAX_SEARCH_RESULT_LIMIT 之间"
        }
        val pattern = literalLikePattern(normalized)
        return database.rawQuery(
            """
            SELECT food.* FROM food
            WHERE food.active = 1
              AND (
                food.name_en LIKE ? ESCAPE '\'
                OR food.name_zh LIKE ? ESCAPE '\'
                OR food.name_ms LIKE ? ESCAPE '\'
                OR EXISTS (
                    SELECT 1 FROM food_alias
                    WHERE food_alias.food_id = food.id
                      AND food_alias.alias LIKE ? ESCAPE '\'
                )
              )
            ORDER BY food.quality_rank ASC, food.name_en ASC
            LIMIT ?
            """.trimIndent(),
            arrayOf(pattern, pattern, pattern, pattern, limit.toString()),
        ).use { cursor -> buildList { while (cursor.moveToNext()) add(cursor.toFoodRecord()) } }
    }

    private fun openDatabase(): SQLiteDatabase {
        val target = File(context.noBackupFilesDir, DATABASE_NAME)
        target.parentFile?.mkdirs()
        if (!databaseFileIsCurrent(target)) {
            installPackagedDatabase(target)
        }
        return SQLiteDatabase.openDatabase(target.path, null, SQLiteDatabase.OPEN_READONLY)
    }

    private fun databaseFileIsCurrent(file: File): Boolean {
        if (!file.isFile || file.length() == 0L) return false
        if (!fileMatchesSha256(file, BuildConfig.DATASET_SHA256)) return false
        return runCatching {
            SQLiteDatabase.openDatabase(file.path, null, SQLiteDatabase.OPEN_READONLY).use { db ->
                val schemaVersion = db.rawQuery("PRAGMA user_version", null).use { cursor ->
                    if (cursor.moveToFirst()) cursor.getInt(0) else 0
                }
                val metadata = db.rawQuery(
                    """
                    SELECT key, value FROM dataset_metadata
                    WHERE key IN ('dataset_version', 'schema_version', 'record_count')
                    """.trimIndent(),
                    null,
                ).use { cursor ->
                    buildMap {
                        while (cursor.moveToNext()) put(cursor.getString(0), cursor.getString(1))
                    }
                }
                val actualRecordCount = db.rawQuery("SELECT COUNT(*) FROM food", null).use { cursor ->
                    if (cursor.moveToFirst()) cursor.getInt(0) else 0
                }
                catalogMetadataIsCompatible(
                    pragmaSchemaVersion = schemaVersion,
                    metadataSchemaVersion = metadata["schema_version"]?.toIntOrNull(),
                    datasetVersion = metadata["dataset_version"],
                    metadataRecordCount = metadata["record_count"]?.toIntOrNull(),
                    actualRecordCount = actualRecordCount,
                    expectedSchemaVersion = BuildConfig.DATASET_SCHEMA_VERSION,
                    expectedDatasetVersion = BuildConfig.DATASET_VERSION,
                    expectedRecordCount = BuildConfig.DATASET_RECORD_COUNT,
                )
            }
        }.getOrDefault(false)
    }

    private fun installPackagedDatabase(target: File) {
        val parent = requireNotNull(target.parentFile) { "无法确定食物库安装目录" }
        val temporary = File.createTempFile("clinical_clarity_", ".sqlite", parent)
        try {
            context.assets.open("databases/$DATABASE_NAME").use { input ->
                FileOutputStream(temporary, false).use { output ->
                    input.copyTo(output)
                    output.flush()
                    output.fd.sync()
                }
            }
            check(databaseFileIsCurrent(temporary)) {
                "打包食物库版本与应用不匹配：${BuildConfig.DATASET_VERSION}"
            }
            try {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING,
                )
            } catch (_: AtomicMoveNotSupportedException) {
                Files.move(
                    temporary.toPath(),
                    target.toPath(),
                    StandardCopyOption.REPLACE_EXISTING,
                )
            }
        } finally {
            temporary.delete()
        }
    }

    private fun firstOrNull(cursor: Cursor): FoodRecord? = if (cursor.moveToFirst()) cursor.toFoodRecord() else null

    private fun Cursor.toFoodRecord() = FoodRecord(
        id = getLong(getColumnIndexOrThrow("id")),
        sourceId = getString(getColumnIndexOrThrow("source_id")),
        name = preferredName(),
        category = stringOrEmpty("category"),
        dataType = stringOrEmpty("data_type"),
        energyKcalPer100g = getDouble(getColumnIndexOrThrow("energy_kcal_100g")),
        proteinGPer100g = nullableDouble("protein_g_100g"),
        carbohydrateGPer100g = nullableDouble("carbohydrate_g_100g"),
        fatGPer100g = nullableDouble("fat_g_100g"),
        fibreGPer100g = nullableDouble("fibre_g_100g"),
        sodiumMgPer100g = nullableDouble("sodium_mg_100g"),
        servingGrams = nullableDouble("serving_g"),
        barcode = nullableString("barcode"),
        brand = nullableString("brand"),
        sourceName = getString(getColumnIndexOrThrow("source_name")),
        sourceUrl = getString(getColumnIndexOrThrow("source_url")),
        qualityGrade = getString(getColumnIndexOrThrow("quality_grade")),
        datasetVersion = getString(getColumnIndexOrThrow("dataset_version")),
    )

    private fun Cursor.preferredName(): String =
        nullableString("name_zh")?.takeIf(String::isNotBlank)
            ?: nullableString("name_en")
            ?: nullableString("name_ms")
            ?: "未命名食物"

    private fun Cursor.stringOrEmpty(column: String) = nullableString(column).orEmpty()

    private fun Cursor.nullableString(column: String): String? {
        val index = getColumnIndex(column)
        return if (index < 0 || isNull(index)) null else getString(index)
    }

    private fun Cursor.nullableDouble(column: String): Double? {
        val index = getColumnIndex(column)
        return if (index < 0 || isNull(index)) null else getDouble(index)
    }

    companion object {
        const val DATABASE_NAME = "clinical_clarity_foods.sqlite"
        const val MAX_SEARCH_QUERY_LENGTH = 100
        const val MAX_SEARCH_RESULT_LIMIT = 100
    }
}

internal fun catalogMetadataIsCompatible(
    pragmaSchemaVersion: Int,
    metadataSchemaVersion: Int?,
    datasetVersion: String?,
    metadataRecordCount: Int?,
    actualRecordCount: Int,
    expectedSchemaVersion: Int,
    expectedDatasetVersion: String,
    expectedRecordCount: Int,
): Boolean =
    pragmaSchemaVersion >= expectedSchemaVersion &&
        metadataSchemaVersion == pragmaSchemaVersion &&
        datasetVersion == expectedDatasetVersion &&
        metadataRecordCount == expectedRecordCount &&
        actualRecordCount == expectedRecordCount

internal fun literalLikePattern(value: String): String = buildString(value.length + 2) {
    append('%')
    value.forEach { character ->
        if (character == '\\' || character == '%' || character == '_') append('\\')
        append(character)
    }
    append('%')
}

internal fun fileMatchesSha256(file: File, expectedSha256: String): Boolean {
    if (!file.isFile || expectedSha256.length != 64) return false
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().buffered().use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val count = input.read(buffer)
            if (count < 0) break
            if (count > 0) digest.update(buffer, 0, count)
        }
    }
    val actual = digest.digest().joinToString("") { byte ->
        "%02x".format(byte.toInt() and 0xff)
    }
    return actual.equals(expectedSha256, ignoreCase = true)
}
