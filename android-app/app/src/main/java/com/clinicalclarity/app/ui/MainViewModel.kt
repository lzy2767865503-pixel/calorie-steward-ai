package com.clinicalclarity.app.ui

import android.app.Application
import android.net.Uri
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.clinicalclarity.app.ClinicalClarityApplication
import com.clinicalclarity.app.data.barcode.Gtin
import com.clinicalclarity.app.data.database.SaveMealResult
import com.clinicalclarity.app.data.database.StoredMealLog
import com.clinicalclarity.app.data.image.NutritionLabelReadout
import com.clinicalclarity.app.domain.model.DEFAULT_CALORIE_GOAL_KCAL
import com.clinicalclarity.app.domain.model.EstimatedFoodItem
import com.clinicalclarity.app.domain.model.EstimateStatus
import com.clinicalclarity.app.domain.model.MealEstimate
import com.clinicalclarity.app.domain.model.MealSourceKind
import com.clinicalclarity.app.domain.model.ScanUiState
import com.clinicalclarity.app.domain.goal.GoalWriteCommit
import com.clinicalclarity.app.domain.goal.GoalWriteSequencer
import com.clinicalclarity.app.domain.stats.MealStatsAggregator
import com.clinicalclarity.app.domain.stats.GoalHistoryResolver
import com.clinicalclarity.app.domain.stats.GoalHistorySnapshot
import com.clinicalclarity.app.domain.stats.MealStatsRecordProjection
import com.clinicalclarity.app.domain.stats.MealStatsResult
import com.clinicalclarity.app.domain.stats.StatsPeriod
import com.clinicalclarity.app.domain.stats.StatsWindows
import java.io.File
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

enum class ScanMode { HOT_MEAL, PACKAGED }

enum class AppDestination { HOME, SCAN, HISTORY }

data class AppNotice(
    val message: String,
    val actionLabel: String? = null,
    val restoreMealId: Long? = null,
    val purgeMealId: Long? = null,
)

data class DashboardUiState(
    val goalKcal: Int = DEFAULT_CALORIE_GOAL_KCAL,
    val goalIsUserSet: Boolean = false,
    val date: LocalDate = LocalDate.now(),
    val todayStats: MealStatsResult? = null,
    val recentMeals: List<StoredMealLog> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

data class HistoryUiState(
    val period: StatsPeriod = StatsPeriod.WEEK,
    val anchor: LocalDate = LocalDate.now(),
    val stats: MealStatsResult? = null,
    val meals: List<StoredMealLog> = emptyList(),
    val loading: Boolean = true,
    val error: String? = null,
)

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val container = (application as ClinicalClarityApplication).container
    private val barcodeLookupRunning = AtomicBoolean(false)
    private val saveRunning = AtomicBoolean(false)
    private var saveOperationId = 0L
    private val statsRequestId = AtomicLong(0L)
    private val goalWriteSequencer = GoalWriteSequencer()
    private val mealWriteMutex = Mutex()
    private var photoOperationId = 0L
    private var activeInputFile: File? = null
    private var baseResultEstimate: MealEstimate? = null

    private val _uiState = MutableStateFlow<ScanUiState>(ScanUiState.Ready)
    val uiState: StateFlow<ScanUiState> = _uiState.asStateFlow()

    private val _destination = MutableStateFlow(AppDestination.HOME)
    val destination: StateFlow<AppDestination> = _destination.asStateFlow()

    private val _scanMode = MutableStateFlow(ScanMode.HOT_MEAL)
    val scanMode: StateFlow<ScanMode> = _scanMode.asStateFlow()

    private val _portionMultiplier = MutableStateFlow(1.0)
    val portionMultiplier: StateFlow<Double> = _portionMultiplier.asStateFlow()

    private val _notices = MutableSharedFlow<AppNotice>(extraBufferCapacity = 32)
    val notices: SharedFlow<AppNotice> = _notices.asSharedFlow()

    private val _goalKcal = MutableStateFlow(DEFAULT_CALORIE_GOAL_KCAL)
    val goalKcal: StateFlow<Int> = _goalKcal.asStateFlow()
    private val _goalIsUserSet = MutableStateFlow(false)
    private var persistedGoalSnapshotKcal: Int? = null
    private var goalStateInitialized = false

    private val _dashboard = MutableStateFlow(DashboardUiState())
    val dashboard: StateFlow<DashboardUiState> = _dashboard.asStateFlow()

    private val _history = MutableStateFlow(HistoryUiState())
    val history: StateFlow<HistoryUiState> = _history.asStateFlow()

    init {
        val initialization = goalWriteSequencer.initializationRequest()
        viewModelScope.launch {
            runCatching {
                // An undo snackbar cannot survive process death, so stale soft-deleted rows must not
                // become an indefinite hidden copy of private meal data.
                performMealWrite { container.mealLogStore.purgeAllSoftDeleted() }
            }.onFailure { error -> postNotice(AppNotice(error.userFacingMessage())) }

            runCatching {
                goalWriteSequencer.initialize(initialization) {
                    withContext(Dispatchers.IO) { container.mealLogStore.currentGoalKcal() }
                }
            }.onSuccess { commit ->
                if (commit is GoalWriteCommit.Applied) {
                    applyPersistedGoal(commit.persistedGoalKcal)
                    refreshStatistics()
                }
            }.onFailure { error ->
                postNotice(AppNotice(error.userFacingMessage()))
                refreshStatistics()
            }
        }
        viewModelScope.launch {
            var observedDate = currentLocalDate()
            while (isActive) {
                delay(MIDNIGHT_CHECK_INTERVAL_MS)
                val date = currentLocalDate()
                if (date != observedDate) {
                    observedDate = date
                    refreshStatistics()
                }
            }
        }
    }

    fun openScanner(mode: ScanMode = ScanMode.HOT_MEAL) {
        clearActiveAnalysis()
        _scanMode.value = mode
        _uiState.value = ScanUiState.Ready
        _destination.value = AppDestination.SCAN
    }

    fun openHistory() {
        clearActiveAnalysis()
        _uiState.value = ScanUiState.Ready
        _destination.value = AppDestination.HISTORY
        refreshStatistics()
    }

    fun returnHome() {
        clearActiveAnalysis()
        _uiState.value = ScanUiState.Ready
        _destination.value = AppDestination.HOME
        refreshStatistics()
    }

    fun setScanMode(mode: ScanMode) {
        _scanMode.value = mode
    }

    fun setGoalKcal(value: Int) {
        submitGoalSetting(value)
    }

    fun clearGoalKcal() {
        submitGoalSetting(null)
    }

    private fun submitGoalSetting(goalKcal: Int?) {
        val request = goalWriteSequencer.request(goalKcal)
        viewModelScope.launch {
            try {
                val commit = goalWriteSequencer.commit(request) { requestedGoal ->
                    withContext(Dispatchers.IO) {
                        container.mealLogStore.recordGoalSetting(requestedGoal)
                        container.mealLogStore.currentGoalKcal()
                    }
                }
                if (commit is GoalWriteCommit.Applied) {
                    applyPersistedGoal(commit.persistedGoalKcal)
                    refreshStatistics()
                }
            } catch (error: Throwable) {
                val reconciled = runCatching {
                    goalWriteSequencer.reconcile(request) {
                        withContext(Dispatchers.IO) { container.mealLogStore.currentGoalKcal() }
                    }
                }.getOrNull()
                if (reconciled is GoalWriteCommit.Applied) {
                    applyPersistedGoal(reconciled.persistedGoalKcal)
                    refreshStatistics()
                }
                postNotice(AppNotice(error.userFacingMessage()))
            }
        }
    }

    fun selectHistoryPeriod(period: StatsPeriod) {
        if (_history.value.period == period) return
        _history.value = _history.value.copy(period = period, loading = true, error = null)
        refreshStatistics()
    }

    fun moveHistoryPeriod(direction: Int) {
        if (direction == 0) return
        val current = _history.value
        val anchor = when (current.period) {
            StatsPeriod.DAY -> current.anchor.plusDays(direction.toLong())
            StatsPeriod.WEEK -> current.anchor.plusWeeks(direction.toLong())
            StatsPeriod.MONTH -> current.anchor.plusMonths(direction.toLong())
            StatsPeriod.YEAR -> current.anchor.plusYears(direction.toLong())
        }
        _history.value = current.copy(anchor = anchor, loading = true, error = null)
        refreshStatistics()
    }

    fun resetHistoryToToday() {
        _history.value = _history.value.copy(
            anchor = currentLocalDate(),
            loading = true,
            error = null,
        )
        refreshStatistics()
    }

    fun refreshStatistics() {
        val requestId = statsRequestId.incrementAndGet()
        val today = currentLocalDate()
        val historySnapshot = _history.value
        val historyWindow = StatsWindows.forAnchor(historySnapshot.period, historySnapshot.anchor)
        _dashboard.value = _dashboard.value.copy(
            goalKcal = _goalKcal.value,
            goalIsUserSet = _goalIsUserSet.value,
            date = today,
            todayStats = null,
            recentMeals = emptyList(),
            loading = true,
            error = null,
        )
        _history.value = historySnapshot.copy(
            stats = null,
            meals = emptyList(),
            loading = true,
            error = null,
        )

        viewModelScope.launch {
            runCatching {
                withContext(Dispatchers.IO) {
                    val todayRecords = container.mealLogStore.listActive(today, today.plusDays(1))
                    val historyRecords = container.mealLogStore.listActive(
                        historyWindow.startDateInclusive,
                        historyWindow.endDateExclusive,
                    )
                    val recent = container.mealLogStore.listRecent()
                    val goalEndExclusive = maxOf(today.plusDays(1), historyWindow.endDateExclusive)
                    val goalHistory = container.mealLogStore.listGoalEvents(goalEndExclusive).map { event ->
                        GoalHistorySnapshot(
                            id = event.id,
                            effectiveAtEpochMs = event.effectiveAtEpochMs,
                            storedLocalDate = event.localDate,
                            goalKcal = event.goalKcal?.toLong(),
                        )
                    }
                    val trackingStart = container.mealLogStore.trackingStartDate() ?: today
                    StatisticsSnapshot(
                        today = MealStatsAggregator.aggregate(
                            StatsPeriod.DAY,
                            today,
                            todayRecords.map { it.toStatsProjection(goalHistory) },
                            asOf = today,
                            trackingStart = trackingStart,
                        ),
                        recent = recent,
                        history = MealStatsAggregator.aggregate(
                            historySnapshot.period,
                            historySnapshot.anchor,
                            historyRecords.map { it.toStatsProjection(goalHistory) },
                            asOf = today,
                            trackingStart = trackingStart,
                        ),
                        historyRecords = historyRecords.sortedByDescending(StoredMealLog::recordedAtEpochMs),
                    )
                }
            }.onSuccess { snapshot ->
                if (statsRequestId.get() != requestId) return@onSuccess
                _dashboard.value = DashboardUiState(
                    goalKcal = _goalKcal.value,
                    goalIsUserSet = _goalIsUserSet.value,
                    date = today,
                    todayStats = snapshot.today,
                    recentMeals = snapshot.recent,
                    loading = false,
                    error = null,
                )
                _history.value = historySnapshot.copy(
                    stats = snapshot.history,
                    meals = snapshot.historyRecords,
                    loading = false,
                    error = null,
                )
            }.onFailure { error ->
                if (statsRequestId.get() != requestId) return@onFailure
                val message = error.userFacingMessage()
                _dashboard.value = _dashboard.value.copy(
                    todayStats = null,
                    recentMeals = emptyList(),
                    loading = false,
                    error = message,
                )
                _history.value = historySnapshot.copy(
                    stats = null,
                    meals = emptyList(),
                    loading = false,
                    error = message,
                )
            }
        }
    }

    fun deleteMeal(id: Long) {
        viewModelScope.launch {
            runCatching { performMealWrite { container.mealLogStore.softDelete(id) } }
                .onSuccess { deleted ->
                    if (deleted) {
                        refreshStatistics()
                        postNotice(AppNotice(
                            message = "记录已移除；撤销窗口结束后将永久删除",
                            actionLabel = "撤销",
                            restoreMealId = id,
                            purgeMealId = id,
                        ))
                    }
                }
                .onFailure { error -> postNotice(AppNotice(error.userFacingMessage())) }
        }
    }

    fun restoreMeal(id: Long) {
        viewModelScope.launch {
            runCatching { performMealWrite { container.mealLogStore.restore(id) } }
                .onSuccess { restored ->
                    if (restored) {
                        refreshStatistics()
                        postNotice(AppNotice("记录已恢复"))
                    }
                }
                .onFailure { error -> postNotice(AppNotice(error.userFacingMessage())) }
        }
    }

    fun purgeMeal(id: Long) {
        viewModelScope.launch { performMealWrite { container.mealLogStore.purge(id) } }
    }

    fun clearAllMealRecords() {
        // UNDISPATCHED acquires the shared meal-write gate in click order. If a confirmation save
        // is already in flight, this permanent clear runs after it and removes that row as well.
        viewModelScope.launch(start = CoroutineStart.UNDISPATCHED) {
            runCatching { performMealWrite { container.mealLogStore.deleteAllPermanently() } }
                .onSuccess { deletedCount ->
                    refreshStatistics()
                    postNotice(AppNotice("已永久清除 $deletedCount 条本地餐食记录。"))
                }
                .onFailure { error -> postNotice(AppNotice(error.userFacingMessage())) }
        }
    }

    fun analyzeCapturedPhoto(file: File) {
        if (_uiState.value !is ScanUiState.Ready) {
            deleteStagedImage(file)
            return
        }
        beginPhotoAnalysis(file, _scanMode.value)
    }

    fun analyzePickedPhoto(uri: Uri) {
        if (_uiState.value !is ScanUiState.Ready) return
        val operationId = nextPhotoOperation()
        val mode = _scanMode.value
        _uiState.value = ScanUiState.Analyzing("正在安全处理照片…")
        viewModelScope.launch {
            var stagedFile: File? = null
            runCatching {
                stagedFile = withContext(Dispatchers.IO) { copyUriToCache(uri) }
                val file = requireNotNull(stagedFile)
                if (!isCurrentPhotoOperation(operationId)) {
                    deleteStagedImage(file)
                    return@runCatching
                }
                activeInputFile = file
                val estimate = analyzePhotoInternal(file, mode)
                deliverPhotoResult(operationId, file, estimate)
            }.onFailure { error ->
                failPhotoOperation(operationId, stagedFile, error)
            }
        }
    }

    fun onBarcodeDetected(value: String) {
        if (_uiState.value !is ScanUiState.Ready) return
        val notifyOnMiss = _scanMode.value == ScanMode.PACKAGED
        if (!barcodeLookupRunning.compareAndSet(false, true)) return
        viewModelScope.launch {
            try {
                val normalized = Gtin.normalize(value)
                if (normalized == null) {
                    if (notifyOnMiss) {
                        postNotice(AppNotice("条码格式或校验位无效，请对准完整条码重试。"))
                    }
                    return@launch
                }
                val food = withContext(Dispatchers.IO) { container.foodCatalog.findByBarcode(normalized) }
                if (food == null) {
                    if (notifyOnMiss) {
                        postNotice(AppNotice("条码 $normalized 尚未收录，可拍摄营养标签进行 OCR 核对。"))
                    }
                } else {
                    showResult(container.mealAnalyzerRepository.fromPackagedFood(food))
                }
            } catch (error: Throwable) {
                postNotice(AppNotice(error.userFacingMessage()))
            } finally {
                barcodeLookupRunning.set(false)
            }
        }
    }

    fun reportCameraError(message: String) {
        postNotice(AppNotice(message))
    }

    fun saveCurrentResult() {
        val current = _uiState.value as? ScanUiState.Result ?: return
        if (current.saved || current.saving) return
        if (!saveRunning.compareAndSet(false, true)) {
            postNotice(AppNotice("上一条记录仍在保存，请稍候。"))
            return
        }
        val estimate = current.estimate
        val confirmedPortionMultiplier = _portionMultiplier.value
        val confirmedGoalSnapshot = persistedGoalSnapshotKcal
        if (!goalStateInitialized) {
            saveRunning.set(false)
            postNotice(AppNotice("正在读取本地参考目标，请稍候再确认。"))
            return
        }
        if (
            estimate.isDemo ||
            estimate.status != EstimateStatus.REQUIRES_CONFIRMATION ||
            estimate.sourceKind == MealSourceKind.NUTRITION_LABEL_OCR
        ) {
            saveRunning.set(false)
            postNotice(AppNotice("演示或 OCR 草稿必须完成人工确认后才能记录。"))
            return
        }
        saveOperationId += 1L
        val operationId = saveOperationId
        _uiState.value = current.copy(saving = true)
        // Start undispatched so the meal-write mutex is acquired before a later clear-all request.
        viewModelScope.launch(start = CoroutineStart.UNDISPATCHED) {
            runCatching {
                val confirmedEstimate = estimate.copy(
                    assumptions = estimate.assumptions + when (estimate.sourceKind) {
                        MealSourceKind.PACKAGED_BARCODE ->
                            "用户确认实际摄入 ${formatMultiplier(confirmedPortionMultiplier)} 个标签标准份"
                        MealSourceKind.HOT_MEAL_API ->
                            "用户确认食物项目，并采用视觉估算整体份量的 ${formatMultiplier(confirmedPortionMultiplier)} 倍"
                        else -> "用户确认当前食物与份量"
                    },
                )
                performMealWrite {
                    container.mealLogStore.save(
                        confirmedEstimate,
                        goalKcal = confirmedGoalSnapshot,
                    )
                }
            }.onSuccess { result ->
                val stillShowingThisResult = isCurrentSaveOperation(operationId, estimate.scanId)
                if (stillShowingThisResult) {
                    _uiState.value = current.copy(saved = true, saving = false)
                } else {
                    postNotice(AppNotice("记录已完成并更新今日统计。"))
                }
                refreshStatistics()
                if (result is SaveMealResult.AlreadyExists) {
                    postNotice(AppNotice("这条结果已记录，没有重复计入。"))
                }
            }.onFailure { error ->
                if (isCurrentSaveOperation(operationId, estimate.scanId)) {
                    _uiState.value = current.copy(saving = false)
                }
                postNotice(AppNotice(error.userFacingMessage()))
            }
            saveRunning.set(false)
        }
    }

    /** Returns to a ready scanner after a result, error, or cancellation. */
    fun reset() {
        clearActiveAnalysis()
        _uiState.value = ScanUiState.Ready
        _destination.value = AppDestination.SCAN
    }

    fun adjustCurrentPortion(multiplier: Double) {
        require(multiplier in 0.5..2.0) { "份量系数需在 0.5–2.0 之间" }
        val current = _uiState.value as? ScanUiState.Result ?: return
        if (
            current.saved || current.saving || saveRunning.get() ||
            current.estimate.isDemo || current.estimate.status != EstimateStatus.REQUIRES_CONFIRMATION
        ) return
        val base = baseResultEstimate ?: return
        _portionMultiplier.value = multiplier
        _uiState.value = current.copy(estimate = base.scaledBy(multiplier))
    }

    private fun beginPhotoAnalysis(file: File, mode: ScanMode) {
        val operationId = nextPhotoOperation(file)
        _uiState.value = ScanUiState.Analyzing(
            if (mode == ScanMode.PACKAGED) "正在读取包装营养标签…" else "正在识别食物和估算份量…",
        )
        viewModelScope.launch {
            runCatching { analyzePhotoInternal(file, mode) }
                .onSuccess { estimate -> deliverPhotoResult(operationId, file, estimate) }
                .onFailure { error -> failPhotoOperation(operationId, file, error) }
        }
    }

    private suspend fun analyzePhotoInternal(file: File, mode: ScanMode): MealEstimate = when (mode) {
        ScanMode.HOT_MEAL -> withContext(Dispatchers.IO) {
            container.mealAnalyzerRepository.analyzeHotMeal(file)
        }
        ScanMode.PACKAGED -> analyzeNutritionLabelInternal(file)
    }

    private fun deliverPhotoResult(operationId: Long, file: File, estimate: MealEstimate) {
        if (isCurrentPhotoOperation(operationId)) {
            activeInputFile = file
            showResult(estimate)
        } else {
            deleteStagedImage(file)
        }
    }

    private fun failPhotoOperation(operationId: Long, file: File?, error: Throwable) {
        deleteStagedImage(file)
        if (isCurrentPhotoOperation(operationId)) {
            activeInputFile = null
            _uiState.value = ScanUiState.Error(error.userFacingMessage())
        }
    }

    private suspend fun analyzeNutritionLabelInternal(file: File): MealEstimate {
        val readout = withContext(Dispatchers.IO) { container.nutritionLabelOcr.recognize(file) }
        return labelReadoutToEstimate(readout, file)
            ?: error("未能稳定读取 kcal 数值。请保持标签平整、光线充足后重拍。")
    }

    private fun labelReadoutToEstimate(readout: NutritionLabelReadout, file: File): MealEstimate? {
        val kcalValue = readout.energyKcal ?: return null
        val grams = readout.servingGrams ?: 100.0
        val isPer100g = readout.energyBasis == "100g"
        val kcal = if (isPer100g) kcalValue * grams / 100.0 else kcalValue
        val rounded = kcal.roundToInt()
        return MealEstimate(
            scanId = "ocr-${UUID.randomUUID()}",
            imagePath = file.path,
            estimatedKcal = rounded,
            lowKcal = (kcal * 0.95).roundToInt(),
            highKcal = (kcal * 1.05).roundToInt(),
            confidence = readout.confidence,
            items = listOf(
                EstimatedFoodItem(
                    foodId = null,
                    name = "包装食品（标签待核对）",
                    estimatedGrams = grams,
                    estimatedKcal = kcal,
                    sharePercent = 100,
                    confidence = readout.confidence,
                    qualityGrade = "OCR",
                ),
            ),
            assumptions = buildList {
                add("OCR 读取 ${kcalValue.roundToInt()} kcal / ${readout.energyBasis}")
                add("按 ${grams.roundToInt()} g 份量计算")
                add("保存前请人工对照包装标签")
            },
            modelVersion = "mlkit-label-ocr-v1",
            datasetVersion = "package-label-live",
            sourceLabel = "包装营养标签 OCR · 未人工确认",
            isDemo = true,
            sourceKind = MealSourceKind.NUTRITION_LABEL_OCR,
            status = EstimateStatus.OCR_DRAFT,
        )
    }

    private fun copyUriToCache(uri: Uri): File {
        val resolver = getApplication<Application>().contentResolver
        val target = File(getApplication<Application>().cacheDir, "picked_${System.currentTimeMillis()}.jpg")
        return try {
            resolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "无法打开所选照片" }
                target.outputStream().use(input::copyTo)
            }
            target
        } catch (error: Throwable) {
            target.delete()
            throw error
        }
    }

    private fun nextPhotoOperation(file: File? = null): Long {
        photoOperationId += 1
        activeInputFile = file
        return photoOperationId
    }

    private fun isCurrentPhotoOperation(operationId: Long): Boolean = photoOperationId == operationId

    private fun clearActiveAnalysis() {
        photoOperationId += 1
        saveOperationId += 1L
        val resultImage = (_uiState.value as? ScanUiState.Result)?.estimate?.imagePath?.let(::File)
        deleteStagedImage(activeInputFile)
        if (resultImage != activeInputFile) deleteStagedImage(resultImage)
        activeInputFile = null
        baseResultEstimate = null
        _portionMultiplier.value = 1.0
    }

    private fun deleteStagedImage(file: File?) {
        if (file == null) return
        runCatching {
            val cacheDirectory = getApplication<Application>().cacheDir.canonicalFile
            val candidate = file.canonicalFile
            val generatedByApp = candidate.name.startsWith("capture_") || candidate.name.startsWith("picked_")
            if (candidate.parentFile == cacheDirectory && generatedByApp && candidate.isFile) {
                candidate.delete()
            }
        }
    }

    private fun currentLocalDate(): LocalDate = LocalDate.now(ZoneId.systemDefault())

    private fun StoredMealLog.toStatsProjection(
        goalHistory: List<GoalHistorySnapshot>,
    ): MealStatsRecordProjection {
        val goalEvent = GoalHistoryResolver.snapshotForDate(localDate, goalHistory)
        val resolvedGoal = if (goalEvent == null) goalKcalAtLog?.toLong() else goalEvent.goalKcal
        return MealStatsRecordProjection(
        id = id,
        recordedAtEpochMs = recordedAtEpochMs,
        storedLocalDate = localDate,
        storedZoneId = recordedZoneId,
        storedOffsetSeconds = recordedOffsetSeconds,
        pointKcal = pointKcal.toLong(),
        lowKcal = lowKcal.toLong(),
        highKcal = highKcal.toLong(),
        confirmed = isConfirmed,
        isDemo = isDemo,
        deletedAtEpochMs = deletedAtEpochMs,
        goalSnapshotKcal = resolvedGoal,
        )
    }

    private fun showResult(estimate: MealEstimate) {
        saveOperationId += 1L
        baseResultEstimate = estimate
        _portionMultiplier.value = 1.0
        _uiState.value = ScanUiState.Result(estimate)
    }

    private fun MealEstimate.scaledBy(multiplier: Double): MealEstimate = copy(
        estimatedKcal = scaleInt(estimatedKcal, multiplier),
        lowKcal = scaleInt(lowKcal, multiplier),
        highKcal = scaleInt(highKcal, multiplier),
        items = items.map { item ->
            item.copy(
                estimatedGrams = item.estimatedGrams * multiplier,
                estimatedKcal = item.estimatedKcal * multiplier,
            )
        },
        assumptions = assumptions.filterNot { it.startsWith(USER_PORTION_ASSUMPTION_PREFIX) } +
            "$USER_PORTION_ASSUMPTION_PREFIX ${formatMultiplier(multiplier)} 倍计算",
    )

    private fun scaleInt(value: Int, multiplier: Double): Int =
        (value.toDouble() * multiplier).coerceIn(0.0, Int.MAX_VALUE.toDouble()).roundToInt()

    private fun formatMultiplier(value: Double): String =
        if (value % 1.0 == 0.0) value.toInt().toString() else value.toString().trimEnd('0').trimEnd('.')

    private fun isCurrentSaveOperation(operationId: Long, scanId: String): Boolean {
        val current = _uiState.value as? ScanUiState.Result ?: return false
        return saveOperationId == operationId && current.estimate.scanId == scanId && current.saving
    }

    private fun applyPersistedGoal(goalKcal: Int?) {
        persistedGoalSnapshotKcal = goalKcal
        goalStateInitialized = true
        _goalKcal.value = goalKcal ?: DEFAULT_CALORIE_GOAL_KCAL
        _goalIsUserSet.value = goalKcal != null
    }

    private suspend fun <T> performMealWrite(block: () -> T): T = mealWriteMutex.withLock {
        withContext(Dispatchers.IO) { block() }
    }

    private fun postNotice(notice: AppNotice) {
        _notices.tryEmit(notice)
    }

    private fun Throwable.userFacingMessage(): String = message
        ?.takeIf { it.isNotBlank() }
        ?: "处理失败，请重试。"

    override fun onCleared() {
        clearActiveAnalysis()
    }

    private data class StatisticsSnapshot(
        val today: MealStatsResult,
        val recent: List<StoredMealLog>,
        val history: MealStatsResult,
        val historyRecords: List<StoredMealLog>,
    )

    private companion object {
        const val MIDNIGHT_CHECK_INTERVAL_MS = 60_000L
        const val USER_PORTION_ASSUMPTION_PREFIX = "用户份量调整：按初始识别值的"
    }
}
