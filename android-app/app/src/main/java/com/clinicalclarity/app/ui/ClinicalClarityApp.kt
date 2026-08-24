package com.clinicalclarity.app.ui

import android.graphics.BitmapFactory
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.outlined.HealthAndSafety
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.clinicalclarity.app.domain.model.EstimatedFoodItem
import com.clinicalclarity.app.domain.model.EstimateStatus
import com.clinicalclarity.app.domain.model.MealEstimate
import com.clinicalclarity.app.domain.model.MealSourceKind
import com.clinicalclarity.app.domain.model.ScanUiState
import com.clinicalclarity.app.ui.scan.CameraCapture
import com.clinicalclarity.app.ui.theme.ClinicalLine
import com.clinicalclarity.app.ui.theme.ClinicalMuted
import com.clinicalclarity.app.ui.theme.ClinicalNavy
import com.clinicalclarity.app.ui.theme.ClinicalNavyStrong
import com.clinicalclarity.app.ui.theme.ClinicalSoft
import com.clinicalclarity.app.ui.theme.ClinicalSuccess
import com.clinicalclarity.app.ui.theme.ClinicalTeal
import com.clinicalclarity.app.ui.theme.ClinicalWarning
import com.clinicalclarity.app.ui.theme.ClinicalWarningSoft
import kotlin.math.roundToInt

@Composable
fun ClinicalClarityApp(viewModel: MainViewModel) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val scanMode by viewModel.scanMode.collectAsStateWithLifecycle()
    val portionMultiplier by viewModel.portionMultiplier.collectAsStateWithLifecycle()
    val destination by viewModel.destination.collectAsStateWithLifecycle()
    val dashboard by viewModel.dashboard.collectAsStateWithLifecycle()
    val history by viewModel.history.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) {
        viewModel.refreshStatistics()
    }

    LaunchedEffect(viewModel) {
        viewModel.notices.collect { current ->
        val result = snackbarHostState.showSnackbar(
            message = current.message,
            actionLabel = current.actionLabel,
            withDismissAction = current.actionLabel != null,
        )
        if (result == SnackbarResult.ActionPerformed) {
            current.restoreMealId?.let(viewModel::restoreMeal)
        } else {
            current.purgeMealId?.let(viewModel::purgeMeal)
        }
        }
    }

    Surface(modifier = Modifier.fillMaxSize(), color = Color.White) {
        Scaffold(
            containerColor = Color.White,
            snackbarHost = { SnackbarHost(snackbarHostState) },
        ) { scaffoldPadding ->
            AnimatedContent(
                targetState = destination to uiState,
                label = "scan-state",
                modifier = Modifier.padding(bottom = scaffoldPadding.calculateBottomPadding()),
            ) { (activeDestination, state) ->
                when (state) {
                    ScanUiState.Ready -> when (activeDestination) {
                        AppDestination.HOME -> HomeScreen(
                            state = dashboard,
                            onOpenHotScan = { viewModel.openScanner(ScanMode.HOT_MEAL) },
                            onOpenPackagedScan = { viewModel.openScanner(ScanMode.PACKAGED) },
                            onOpenHistory = viewModel::openHistory,
                            onSetGoal = viewModel::setGoalKcal,
                            onClearGoal = viewModel::clearGoalKcal,
                            onDeleteMeal = viewModel::deleteMeal,
                        )
                        AppDestination.SCAN -> ScanScreen(
                            scanMode = scanMode,
                            todayKcal = dashboard.todayStats?.interval?.pointKcal ?: 0L,
                            onBack = viewModel::returnHome,
                            onModeChange = viewModel::setScanMode,
                            onCaptured = viewModel::analyzeCapturedPhoto,
                            onPicked = viewModel::analyzePickedPhoto,
                            onBarcode = viewModel::onBarcodeDetected,
                            onCameraError = viewModel::reportCameraError,
                        )
                        AppDestination.HISTORY -> HistoryScreen(
                            state = history,
                            onBack = viewModel::returnHome,
                            onPeriod = viewModel::selectHistoryPeriod,
                            onMovePeriod = viewModel::moveHistoryPeriod,
                            onToday = viewModel::resetHistoryToToday,
                            onDeleteMeal = viewModel::deleteMeal,
                            onClearAll = viewModel::clearAllMealRecords,
                        )
                    }
                    is ScanUiState.Analyzing -> AnalyzingScreen(state.message, viewModel::reset)
                    is ScanUiState.Result -> ResultScreen(
                        estimate = state.estimate,
                        saved = state.saved,
                        saving = state.saving,
                        portionMultiplier = portionMultiplier,
                        onPortionChange = viewModel::adjustCurrentPortion,
                        onSave = viewModel::saveCurrentResult,
                        onRetry = viewModel::reset,
                        onHome = viewModel::returnHome,
                    )
                    is ScanUiState.Error -> ErrorScreen(state.message, viewModel::reset)
                }
            }
        }
    }
}

@Composable
private fun ScanScreen(
    scanMode: ScanMode,
    todayKcal: Long,
    onBack: () -> Unit,
    onModeChange: (ScanMode) -> Unit,
    onCaptured: (java.io.File) -> Unit,
    onPicked: (android.net.Uri) -> Unit,
    onBarcode: (String) -> Unit,
    onCameraError: (String) -> Unit,
) {
    BackHandler(onBack = onBack)
    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) onPicked(uri)
    }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 10.dp),
    ) {
        BrandHeader(
            trailing = if (todayKcal > 0) "今日 $todayKcal kcal" else null,
            onBack = onBack,
        )
        Spacer(Modifier.height(20.dp))
        Text(
            text = "拍一张，看清这一餐",
            color = ClinicalNavyStrong,
            fontSize = 27.sp,
            fontWeight = FontWeight.ExtraBold,
        )
        Spacer(Modifier.height(7.dp))
        Text(
            text = "热量以范围和可信度呈现，不伪装成实验室精度。",
            color = ClinicalMuted,
            fontSize = 14.sp,
            lineHeight = 21.sp,
        )
        Spacer(Modifier.height(18.dp))
        ScanModeSelector(selected = scanMode, onSelected = onModeChange)
        Spacer(Modifier.height(16.dp))
        CameraCapture(
            scanMode = scanMode,
            onCaptured = onCaptured,
            onBarcode = onBarcode,
            onOpenGallery = {
                photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            },
            onError = onCameraError,
        )
        Spacer(Modifier.height(16.dp))
    }
}

@Composable
private fun ScanModeSelector(selected: ScanMode, onSelected: (ScanMode) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ClinicalSoft)
            .padding(4.dp),
    ) {
        ModeButton(
            label = "热食拍照",
            icon = { Icon(Icons.Outlined.Restaurant, contentDescription = null, modifier = Modifier.size(18.dp)) },
            selected = selected == ScanMode.HOT_MEAL,
            onClick = { onSelected(ScanMode.HOT_MEAL) },
            modifier = Modifier.weight(1f),
        )
        ModeButton(
            label = "包装食品",
            icon = { Icon(Icons.Outlined.Inventory2, contentDescription = null, modifier = Modifier.size(18.dp)) },
            selected = selected == ScanMode.PACKAGED,
            onClick = { onSelected(ScanMode.PACKAGED) },
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
private fun ModeButton(
    label: String,
    icon: @Composable () -> Unit,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    TextButton(
        onClick = onClick,
        modifier = modifier.height(44.dp),
        shape = RoundedCornerShape(9.dp),
        colors = ButtonDefaults.textButtonColors(
            containerColor = if (selected) Color.White else Color.Transparent,
            contentColor = if (selected) ClinicalNavy else ClinicalMuted,
        ),
    ) {
        icon()
        Spacer(Modifier.width(7.dp))
        Text(label, fontWeight = if (selected) FontWeight.Bold else FontWeight.Medium)
    }
}

@Composable
private fun AnalyzingScreen(message: String, onCancel: () -> Unit) {
    BackHandler(onBack = onCancel)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(28.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier
                .size(104.dp)
                .background(ClinicalSoft, CircleShape),
        ) {
            CircularProgressIndicator(color = ClinicalTeal, strokeWidth = 5.dp, modifier = Modifier.size(62.dp))
            Icon(Icons.Outlined.Restaurant, contentDescription = null, tint = ClinicalNavy, modifier = Modifier.size(28.dp))
        }
        Spacer(Modifier.height(28.dp))
        Text("正在建立科学估算", color = ClinicalNavyStrong, fontSize = 24.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(10.dp))
        Text(message, color = ClinicalMuted, fontSize = 15.sp, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text("识别食物 → 估算重量 → 匹配营养库", color = ClinicalTeal, fontSize = 12.sp)
        Spacer(Modifier.height(26.dp))
        TextButton(onClick = onCancel) { Text("取消", color = ClinicalNavy) }
    }
}

@Composable
private fun ErrorScreen(message: String, onRetry: () -> Unit) {
    BackHandler(onBack = onRetry)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .padding(28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(52.dp))
        Spacer(Modifier.height(18.dp))
        Text("这张照片还无法计算", color = ClinicalNavyStrong, fontSize = 23.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(10.dp))
        Text(message, color = ClinicalMuted, textAlign = TextAlign.Center, lineHeight = 22.sp)
        Spacer(Modifier.height(26.dp))
        Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(containerColor = ClinicalNavy),
            shape = RoundedCornerShape(12.dp),
        ) {
            Icon(Icons.Outlined.CameraAlt, contentDescription = null)
            Spacer(Modifier.width(8.dp))
            Text("重新拍摄")
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ResultScreen(
    estimate: MealEstimate,
    saved: Boolean,
    saving: Boolean,
    portionMultiplier: Double,
    onPortionChange: (Double) -> Unit,
    onSave: () -> Unit,
    onRetry: () -> Unit,
    onHome: () -> Unit,
) {
    var evidenceOpen by remember { mutableStateOf(false) }
    val isOcrDraft = estimate.status == EstimateStatus.OCR_DRAFT ||
        estimate.sourceKind == MealSourceKind.NUTRITION_LABEL_OCR
    val isBarcode = estimate.sourceKind == MealSourceKind.PACKAGED_BARCODE
    val canSave = !estimate.isDemo && estimate.status == EstimateStatus.REQUIRES_CONFIRMATION
    BackHandler(onBack = onRetry)

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp),
    ) {
        BrandHeader(onBack = onRetry)
        Spacer(Modifier.height(12.dp))
        MealHero(imagePath = estimate.imagePath, isDemo = estimate.isDemo, isOcrDraft = isOcrDraft)

        if (isOcrDraft) {
            HonestStatusBanner(
                title = "OCR 草稿·当前禁止记录",
                detail = "数字来自当前照片，但本版未提供字段与份量确认页，因此不会写入历史。",
                warning = true,
            )
        } else if (estimate.isDemo) {
            val isOfflineFallback = estimate.sourceKind == MealSourceKind.OFFLINE_DEMO
            HonestStatusBanner(
                title = if (isOfflineFallback) {
                    "离线演示结果，不是本次照片的真实结论"
                } else {
                    "服务端演示结果，尚未进入真实识别模式"
                },
                detail = if (isOfflineFallback) {
                    "本地无法取得可验证的视觉结论，${estimate.estimatedKcal} kcal 只是界面演示餐例。"
                } else {
                    "后端已连接，但本次响应明确标记 isDemo=true；${estimate.estimatedKcal} kcal 不会写入历史。"
                },
                warning = true,
            )
        } else if (isBarcode) {
            HonestStatusBanner(
                title = "按 ${formatPortion(portionMultiplier)} 个包装标准份计算",
                detail = "营养数值已精确匹配条码；请用下方份数选择自报你的实际摄入（未称重）。",
                warning = false,
            )
        } else if (!estimate.isDemo && estimate.sourceKind == MealSourceKind.HOT_MEAL_API) {
            HonestStatusBanner(
                title = "整体份量为初始视觉估算的 ${formatPortion(portionMultiplier)} 倍",
                detail = "可用下方按钮调整整体份量。若食物项目本身明显不符，请重新拍摄，不要记录。",
                warning = false,
            )
        }

        if (canSave && (isBarcode || estimate.sourceKind == MealSourceKind.HOT_MEAL_API)) {
            PortionSelector(
                estimate = estimate,
                multiplier = portionMultiplier,
                isBarcode = isBarcode,
                enabled = !saved && !saving,
                onSelected = onPortionChange,
            )
        }

        CalorieSummary(estimate)
        FoodBreakdown(estimate.items)
        Spacer(Modifier.height(14.dp))
        Button(
            onClick = onSave,
            enabled = !saved && !saving && canSave,
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = if (saved) ClinicalSuccess else ClinicalNavy,
                disabledContainerColor = if (saved) ClinicalSuccess else Color(0xFF98A2B3),
                disabledContentColor = Color.White,
            ),
        ) {
            if (saved) {
                Icon(Icons.Outlined.CheckCircle, contentDescription = null)
                Spacer(Modifier.width(8.dp))
            }
            Text(
                when {
                    saved -> "已记录到今日餐食"
                    saving -> "正在安全记录…"
                    isOcrDraft -> "OCR 草稿不可记录"
                    estimate.isDemo -> "演示结果不可记录"
                    isBarcode -> "确认 ${formatPortion(portionMultiplier)} 个标准份并记录"
                    else -> "食物与份量无误，确认记录"
                },
                fontSize = if (isBarcode && !saved) 15.sp else 17.sp,
                fontWeight = FontWeight.Bold,
            )
        }
        TextButton(
            onClick = { evidenceOpen = true },
            modifier = Modifier.fillMaxWidth(),
        ) {
            Icon(Icons.Outlined.Info, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(7.dp))
            Text("查看估算依据", color = ClinicalNavy, fontWeight = FontWeight.Bold)
        }
        TextButton(onClick = onRetry, modifier = Modifier.fillMaxWidth()) {
            Text("重新拍摄", color = ClinicalMuted)
        }
        TextButton(onClick = onHome, modifier = Modifier.fillMaxWidth()) {
            Text("返回今日总览", color = ClinicalTeal, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
    }

    if (evidenceOpen) {
        EvidenceSheet(estimate = estimate, onDismiss = { evidenceOpen = false })
    }
}

@Composable
private fun PortionSelector(
    estimate: MealEstimate,
    multiplier: Double,
    isBarcode: Boolean,
    enabled: Boolean,
    onSelected: (Double) -> Unit,
) {
    val choices = if (isBarcode) listOf(0.5, 1.0, 1.5, 2.0) else listOf(0.5, 0.75, 1.0, 1.25, 1.5)
    val totalGrams = estimate.items.sumOf(EstimatedFoodItem::estimatedGrams).roundToInt()
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp)
            .background(ClinicalSoft, RoundedCornerShape(12.dp))
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (isBarcode) "自报吃了几个标准份" else "整体份量调整",
                color = ClinicalNavyStrong,
                fontSize = 13.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            Text("当前约 $totalGrams g", color = ClinicalMuted, fontSize = 11.sp)
        }
        Spacer(Modifier.height(7.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            choices.forEach { choice ->
                val selected = kotlin.math.abs(choice - multiplier) < 0.001
                TextButton(
                    onClick = { onSelected(choice) },
                    enabled = enabled,
                    modifier = Modifier
                        .weight(1f)
                        .height(38.dp)
                        .semantics { this.selected = selected },
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.textButtonColors(
                        containerColor = if (selected) ClinicalNavy else Color.White,
                        contentColor = if (selected) Color.White else ClinicalNavy,
                    ),
                ) {
                    Text(
                        if (isBarcode) formatPortion(choice) else "${formatPortion(choice)}×",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        Text(
            if (isBarcode) "克重和热量随自报份数同比调整；范围按自报份数的 0.75–1.25 倍显示，未称重。" else "所有食物克重与热量范围同比调整；仍是估算，不是称重。",
            color = ClinicalMuted,
            fontSize = 9.sp,
            modifier = Modifier.padding(top = 5.dp),
        )
    }
}

@Composable
internal fun BrandHeader(trailing: String? = null, onBack: (() -> Unit)? = null) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .height(54.dp),
    ) {
        if (onBack != null) {
            IconButton(onClick = onBack, modifier = Modifier.align(Alignment.CenterStart)) {
                Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "返回上一页", tint = ClinicalNavy)
            }
        }
        Row(
            modifier = Modifier.align(Alignment.Center),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Outlined.HealthAndSafety, contentDescription = null, tint = ClinicalTeal, modifier = Modifier.size(29.dp))
            Spacer(Modifier.width(9.dp))
            Column {
                Text(
                    "Clinical Clarity",
                    color = ClinicalNavy,
                    fontSize = 21.sp,
                    lineHeight = 22.sp,
                    fontWeight = FontWeight.ExtraBold,
                )
                Text("科学估算每一餐", color = Color(0xFF7A7F89), fontSize = 10.sp, letterSpacing = 1.sp)
            }
        }
        if (trailing != null) {
            Text(
                trailing,
                color = ClinicalTeal,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.align(Alignment.CenterEnd),
            )
        }
    }
}

@Composable
private fun MealHero(imagePath: String?, isDemo: Boolean, isOcrDraft: Boolean) {
    val bitmap = remember(imagePath) {
        imagePath?.let { path -> BitmapFactory.decodeFile(path)?.asImageBitmap() }
    }
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .aspectRatio(1.82f)
            .clip(RoundedCornerShape(14.dp))
            .background(
                Brush.linearGradient(
                    listOf(Color(0xFFD9E6E9), Color(0xFFF0D7A5), Color(0xFFA8B77A)),
                ),
            ),
        contentAlignment = Alignment.Center,
    ) {
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = "待估算餐食照片",
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Outlined.Restaurant, contentDescription = null, tint = ClinicalNavy, modifier = Modifier.size(46.dp))
                Spacer(Modifier.height(8.dp))
                Text(
                    when {
                        isOcrDraft -> "OCR 草稿"
                        isDemo -> "演示餐食"
                        else -> "条码营养记录"
                    },
                    color = ClinicalNavy,
                    fontWeight = FontWeight.Bold,
                )
            }
        }
    }
}

@Composable
private fun HonestStatusBanner(title: String, detail: String, warning: Boolean) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp)
            .background(if (warning) ClinicalWarningSoft else Color(0xFFEAF7F8), RoundedCornerShape(10.dp))
            .padding(horizontal = 13.dp, vertical = 10.dp),
    ) {
        Text(title, color = if (warning) ClinicalWarning else ClinicalNavy, fontWeight = FontWeight.Bold, fontSize = 13.sp)
        Spacer(Modifier.height(3.dp))
        Text(detail, color = ClinicalMuted, fontSize = 11.sp, lineHeight = 16.sp)
    }
}

@Composable
private fun CalorieSummary(estimate: MealEstimate) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 14.dp, vertical = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(
                estimate.estimatedKcal.toString(),
                color = ClinicalNavyStrong,
                fontSize = 62.sp,
                lineHeight = 62.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = (-2).sp,
            )
            Spacer(Modifier.width(7.dp))
            Text("kcal", color = ClinicalNavyStrong, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 7.dp))
        }
        Text(
            when {
                estimate.status == EstimateStatus.OCR_DRAFT -> "OCR 读取草稿（未核对）"
                estimate.isDemo -> "演示餐例数值（非本次结论）"
                else -> "本餐科学估算"
            },
            color = Color(0xFF5F636B),
            fontSize = 17.sp,
            modifier = Modifier.padding(top = 3.dp, bottom = 10.dp),
        )
        EstimateRange(estimate)
        Text(
            "${estimate.lowKcal}–${estimate.highKcal} kcal",
            color = Color(0xFF3B4048),
            fontSize = 18.sp,
            fontWeight = FontWeight.Medium,
        )
        Spacer(Modifier.height(7.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("模型内部评分（未校准） ", color = ClinicalMuted, fontSize = 11.sp)
            Text("${(estimate.confidence * 100).roundToInt()}%", color = ClinicalTeal, fontWeight = FontWeight.Bold, fontSize = 13.sp)
            Text("  ·  ", color = ClinicalMuted, fontSize = 13.sp)
            Text(
                estimate.sourceLabel,
                color = ClinicalTeal,
                fontWeight = FontWeight.Bold,
                fontSize = 12.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
        }
    }
}

@Composable
private fun EstimateRange(estimate: MealEstimate) {
    val span = (estimate.highKcal - estimate.lowKcal).coerceAtLeast(0)
    val pointFraction = if (span == 0) {
        0.5f
    } else {
        ((estimate.estimatedKcal - estimate.lowKcal).toFloat() / span.toFloat()).coerceIn(0f, 1f)
    }
    BoxWithConstraints(
        modifier = Modifier.width(292.dp).height(18.dp),
        contentAlignment = Alignment.CenterStart,
    ) {
        Box(Modifier.fillMaxWidth().height(4.dp).background(Color(0xFFD8DCE2), CircleShape))
        Box(Modifier.fillMaxWidth().height(4.dp).background(ClinicalTeal.copy(alpha = 0.65f), CircleShape))
        Box(
            Modifier
                .offset(x = (maxWidth - 12.dp) * pointFraction)
                .size(12.dp)
                .background(ClinicalTeal, CircleShape),
        )
    }
}

@Composable
private fun FoodBreakdown(items: List<EstimatedFoodItem>) {
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 10.dp, vertical = 7.dp),
        ) {
            Text("识别食物", color = ClinicalMuted, fontSize = 11.sp, modifier = Modifier.weight(1.5f))
            Text("估算重量", color = ClinicalMuted, fontSize = 11.sp, textAlign = TextAlign.End, modifier = Modifier.weight(0.72f))
            Text("热量贡献", color = ClinicalMuted, fontSize = 11.sp, textAlign = TextAlign.End, modifier = Modifier.weight(0.92f))
        }
        HorizontalDivider(color = ClinicalLine)
        items.take(6).forEachIndexed { index, item ->
            FoodRow(item = item, dotColor = FOOD_COLORS[index % FOOD_COLORS.size])
            HorizontalDivider(color = ClinicalLine)
        }
        if (items.size > 6) {
            Text(
                "其余 ${items.size - 6} 项也已纳入上方总热量与范围。",
                color = ClinicalMuted,
                fontSize = 11.sp,
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 9.dp),
            )
            HorizontalDivider(color = ClinicalLine)
        }
        if (items.isEmpty()) {
            Text("未返回食物分项", color = ClinicalMuted, modifier = Modifier.padding(16.dp))
        }
    }
}

@Composable
private fun FoodRow(item: EstimatedFoodItem, dotColor: Color) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .padding(horizontal = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(modifier = Modifier.weight(1.5f), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(9.dp).background(dotColor, CircleShape))
            Spacer(Modifier.width(9.dp))
            Text(item.name, color = ClinicalNavyStrong, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Text(
            "${item.estimatedGrams.roundToInt()} g",
            color = ClinicalNavyStrong,
            fontSize = 13.sp,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(0.72f),
        )
        Column(modifier = Modifier.weight(0.82f), horizontalAlignment = Alignment.End) {
            Text("${item.estimatedKcal.roundToInt()} kcal", color = ClinicalNavyStrong, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            Text("${item.sharePercent}%", color = Color(0xFF8B9099), fontSize = 10.sp)
        }
        Text(item.qualityGrade, color = Color(0xFF98A2B3), fontSize = 10.sp, modifier = Modifier.width(17.dp), textAlign = TextAlign.End)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun EvidenceSheet(estimate: MealEstimate, onDismiss: () -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = Color.White,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .navigationBarsPadding()
                .padding(horizontal = 22.dp, vertical = 8.dp),
        ) {
            Text("本餐估算依据", color = ClinicalNavyStrong, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
            Spacer(Modifier.height(6.dp))
            Text("每个数字都保留数据版本、模型版本和主要假设。", color = ClinicalMuted, fontSize = 13.sp)
            Spacer(Modifier.height(12.dp))
            EvidenceRow("营养数据", estimate.sourceLabel)
            EvidenceRow("识别模型", estimate.modelVersion)
            EvidenceRow("数据版本", estimate.datasetVersion)
            EvidenceRow("估算范围", "${estimate.lowKcal}–${estimate.highKcal} kcal")
            EvidenceRow("模型内部评分（未校准）", "${(estimate.confidence * 100).roundToInt()}%")
            if (estimate.assumptions.isNotEmpty()) {
                Spacer(Modifier.height(14.dp))
                Text("主要假设", color = ClinicalNavy, fontWeight = FontWeight.Bold)
                estimate.assumptions.forEach { assumption ->
                    Text("• $assumption", color = ClinicalMuted, fontSize = 13.sp, lineHeight = 20.sp, modifier = Modifier.padding(top = 5.dp))
                }
            }
            Spacer(Modifier.height(16.dp))
            Text(
                when {
                    estimate.status == EstimateStatus.OCR_DRAFT ->
                        "当前数字来自这张照片的 OCR 读取，不是界面演示餐例；但字段和份量未人工核对，因此禁止记录。"
                    estimate.isDemo ->
                        "当前为明确标记的演示餐例数据，不是本次照片的可验证结论，禁止记录。"
                    else ->
                        "结果为科学估算，并非实验室检测或医疗建议。烹调油、酱汁及不可见配料可能造成偏差。"
                },
                color = if (estimate.isDemo || estimate.status == EstimateStatus.OCR_DRAFT) ClinicalWarning else Color(0xFF525866),
                fontSize = 12.sp,
                lineHeight = 18.sp,
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(10.dp))
                    .background(if (estimate.isDemo || estimate.status == EstimateStatus.OCR_DRAFT) ClinicalWarningSoft else ClinicalSoft)
                    .padding(13.dp),
            )
            Spacer(Modifier.height(14.dp))
        }
    }
}

@Composable
private fun EvidenceRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, color = ClinicalMuted, fontSize = 13.sp, modifier = Modifier.weight(0.8f))
        Text(value, color = ClinicalNavyStrong, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.End, modifier = Modifier.weight(1.2f))
    }
    HorizontalDivider(color = ClinicalLine)
}

private val FOOD_COLORS = listOf(
    Color(0xFFE7C98C),
    Color(0xFFF3C85C),
    Color(0xFFA9BF77),
    Color(0xFFEF9B35),
    Color(0xFF72B5AA),
    Color(0xFFC9A9D9),
)

private fun formatPortion(value: Double): String =
    if (value % 1.0 == 0.0) value.toInt().toString() else value.toString().trimEnd('0').trimEnd('.')
