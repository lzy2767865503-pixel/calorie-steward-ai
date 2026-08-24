package com.clinicalclarity.app.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.CameraAlt
import androidx.compose.material.icons.outlined.ChevronLeft
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import com.clinicalclarity.app.data.database.StoredMealLog
import com.clinicalclarity.app.domain.model.MAX_CALORIE_GOAL_KCAL
import com.clinicalclarity.app.domain.model.MIN_CALORIE_GOAL_KCAL
import com.clinicalclarity.app.domain.stats.KcalInterval
import com.clinicalclarity.app.domain.stats.MealStatsResult
import com.clinicalclarity.app.domain.stats.StatsPeriod
import com.clinicalclarity.app.domain.stats.StatsTrendBucket
import com.clinicalclarity.app.ui.theme.ClinicalLine
import com.clinicalclarity.app.ui.theme.ClinicalMuted
import com.clinicalclarity.app.ui.theme.ClinicalNavy
import com.clinicalclarity.app.ui.theme.ClinicalNavyStrong
import com.clinicalclarity.app.ui.theme.ClinicalSoft
import com.clinicalclarity.app.ui.theme.ClinicalTeal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.roundToLong

@Composable
internal fun HomeScreen(
    state: DashboardUiState,
    onOpenHotScan: () -> Unit,
    onOpenPackagedScan: () -> Unit,
    onOpenHistory: () -> Unit,
    onSetGoal: (Int) -> Unit,
    onClearGoal: () -> Unit,
    onDeleteMeal: (Long) -> Unit,
) {
    var goalDialogOpen by remember { mutableStateOf(false) }
    val interval = state.todayStats?.interval ?: KcalInterval.ZERO

    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 10.dp),
    ) {
        BrandHeader(trailing = state.date.format(CHINESE_MONTH_DAY))
        Spacer(Modifier.height(18.dp))
        Text("今日总览", color = ClinicalNavyStrong, fontSize = 27.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(6.dp))
        Text(
            "只统计你亲自确认的真实记录；演示和 OCR 草稿永不计入。",
            color = ClinicalMuted,
            fontSize = 13.sp,
            lineHeight = 19.sp,
        )
        Spacer(Modifier.height(16.dp))

        TodayOverviewCard(
            interval = interval,
            goalKcal = state.goalKcal,
            goalIsUserSet = state.goalIsUserSet,
            loading = state.loading,
            error = state.error,
            onEditGoal = { goalDialogOpen = true },
        )
        Spacer(Modifier.height(14.dp))

        Button(
            onClick = onOpenHotScan,
            modifier = Modifier.fillMaxWidth().height(56.dp),
            shape = RoundedCornerShape(13.dp),
            colors = ButtonDefaults.buttonColors(containerColor = ClinicalNavy),
        ) {
            Icon(Icons.Outlined.CameraAlt, contentDescription = null)
            Spacer(Modifier.width(9.dp))
            Text("拍照识别一餐", fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(9.dp))
        OutlinedButton(
            onClick = onOpenPackagedScan,
            modifier = Modifier.fillMaxWidth().height(50.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.outlinedButtonColors(contentColor = ClinicalNavy),
        ) {
            Icon(Icons.Outlined.Inventory2, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
            Text("扫码或拍包装标签", fontWeight = FontWeight.Bold)
        }

        Spacer(Modifier.height(22.dp))
        SectionTitle("最近记录", "查看统计", onOpenHistory)
        Spacer(Modifier.height(5.dp))
        if (state.recentMeals.isEmpty() && !state.loading) {
            EmptyRecords()
        } else {
            state.recentMeals.take(4).forEach { meal ->
                MealLogRow(meal = meal, showDate = true, onDelete = { onDeleteMeal(meal.id) })
            }
        }
        TextButton(onClick = onOpenHistory, modifier = Modifier.fillMaxWidth()) {
            Icon(Icons.Outlined.BarChart, contentDescription = null, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(7.dp))
            Text("打开日 / 周 / 月 / 年统计", color = ClinicalTeal, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(8.dp))
    }

    if (goalDialogOpen) {
        GoalDialog(
            currentGoal = state.goalKcal,
            onDismiss = { goalDialogOpen = false },
            onSave = { value ->
                onSetGoal(value)
                goalDialogOpen = false
            },
            onClear = {
                onClearGoal()
                goalDialogOpen = false
            },
        )
    }
}

@Composable
private fun TodayOverviewCard(
    interval: KcalInterval,
    goalKcal: Int,
    goalIsUserSet: Boolean,
    loading: Boolean,
    error: String?,
    onEditGoal: () -> Unit,
) {
    val remainingLow = goalKcal.toLong() - interval.highKcal
    val remainingHigh = goalKcal.toLong() - interval.lowKcal
    val progress = (interval.pointKcal.toDouble() / goalKcal.toDouble()).coerceIn(0.0, 1.0).toFloat()

    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(18.dp),
        color = ClinicalSoft,
        border = androidx.compose.foundation.BorderStroke(1.dp, ClinicalLine),
    ) {
        Column(modifier = Modifier.padding(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = Modifier.weight(1f)) {
                    Text("已摄入（估算中值）", color = ClinicalMuted, fontSize = 12.sp)
                    Row(verticalAlignment = Alignment.Bottom) {
                        Text(
                            if (loading || error != null) "—" else interval.pointKcal.toString(),
                            color = ClinicalNavyStrong,
                            fontSize = 44.sp,
                            lineHeight = 48.sp,
                            fontWeight = FontWeight.ExtraBold,
                        )
                        Text(" kcal", color = ClinicalNavy, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 7.dp))
                    }
                }
                TextButton(onClick = onEditGoal) {
                    Icon(Icons.Outlined.Edit, contentDescription = null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text(
                        if (goalIsUserSet) "参考线 $goalKcal" else "设置可选参考线",
                        color = ClinicalTeal,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
            Text(
                when {
                    loading -> "正在更新今日区间…"
                    error != null -> "今日统计暂不可用：$error"
                    else -> "各餐估算范围相加：${interval.lowKcal}–${interval.highKcal} kcal"
                },
                color = ClinicalMuted,
                fontSize = 12.sp,
            )
            if (goalIsUserSet) {
                Spacer(Modifier.height(14.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(8.dp)
                        .clip(CircleShape)
                        .background(Color(0xFFDDE4EA)),
                ) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth(progress)
                            .height(8.dp)
                            .background(ClinicalTeal, CircleShape),
                    )
                }
                Spacer(Modifier.height(11.dp))
                Text(
                    when {
                        loading -> "统计更新中…"
                        error != null -> "未显示旧的今日数据"
                        else -> relativeGoalRangeLabel(remainingLow, remainingHigh)
                    },
                    color = ClinicalNavyStrong,
                    fontSize = 17.sp,
                    fontWeight = FontWeight.Bold,
                )
                Text("差值由摄入下限/上限计算，不使用单一精确剩余值。", color = ClinicalMuted, fontSize = 10.sp)
                Spacer(Modifier.height(8.dp))
                Text("这是你在本机设定的参考线，不是个性化医疗或减重建议。", color = ClinicalMuted, fontSize = 10.sp, lineHeight = 15.sp)
            } else {
                Spacer(Modifier.height(13.dp))
                Text(
                    "尚未设置每日参考线：今日只显示摄入与估算范围，不计算进度或剩余预算。2000 kcal 只是设置对话框的初始示例。",
                    color = ClinicalMuted,
                    fontSize = 10.sp,
                    lineHeight = 15.sp,
                    modifier = Modifier.background(Color.White, RoundedCornerShape(8.dp)).padding(9.dp),
                )
            }
        }
    }
}

@Composable
internal fun HistoryScreen(
    state: HistoryUiState,
    onBack: () -> Unit,
    onPeriod: (StatsPeriod) -> Unit,
    onMovePeriod: (Int) -> Unit,
    onToday: () -> Unit,
    onDeleteMeal: (Long) -> Unit,
    onClearAll: () -> Unit,
) {
    var clearAllDialogOpen by remember { mutableStateOf(false) }
    BackHandler(onBack = onBack)
    Column(
        modifier = Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 10.dp),
    ) {
        BrandHeader(onBack = onBack)
        Spacer(Modifier.height(14.dp))
        Text("摄入统计", color = ClinicalNavyStrong, fontSize = 27.sp, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(5.dp))
        Text("按每条记录保存时的当地日期分组。", color = ClinicalMuted, fontSize = 12.sp)
        Spacer(Modifier.height(15.dp))
        PeriodSelector(selected = state.period, onSelected = onPeriod)
        Spacer(Modifier.height(10.dp))
        PeriodNavigator(state = state, onMove = onMovePeriod, onToday = onToday)
        Spacer(Modifier.height(14.dp))

        if (state.loading && state.stats == null) {
            Box(Modifier.fillMaxWidth().height(220.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = ClinicalTeal)
            }
        } else if (state.error != null) {
            Text(state.error, color = Color(0xFFB42318), modifier = Modifier.padding(vertical = 24.dp))
        } else {
            state.stats?.let { stats ->
                HistorySummary(stats)
                Spacer(Modifier.height(18.dp))
                Text("趋势", color = ClinicalNavyStrong, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.height(8.dp))
                TrendChart(stats)
                Text(
                    if (state.period == StatsPeriod.YEAR) {
                        "深色=估算中值，浅色=上限，细线=下限。年视图按月汇总；柱下为已记录日/可观察日，覆盖不同的月总量不宜直接比较。"
                    } else {
                        "深色=估算中值，浅色=上限，细线=下限；‘未观察’表示未来，或当前保留记录/参考线设置的最早日期之前，不等于 0 kcal。"
                    },
                    color = ClinicalMuted,
                    fontSize = 10.sp,
                    lineHeight = 15.sp,
                )
                Spacer(Modifier.height(20.dp))
                SectionTitle("期间记录", "${state.meals.size} 条", null)
                if (state.meals.isEmpty()) {
                    EmptyRecords()
                } else {
                    state.meals.take(30).forEach { meal ->
                        MealLogRow(meal = meal, showDate = true, onDelete = { onDeleteMeal(meal.id) })
                    }
                    if (state.meals.size > 30) {
                        Text(
                            "当前显示最近 30 条，统计已包含全部 ${state.meals.size} 条。",
                            color = ClinicalMuted,
                            fontSize = 11.sp,
                            modifier = Modifier.padding(vertical = 10.dp),
                        )
                    }
                }
                Spacer(Modifier.height(12.dp))
                TextButton(onClick = { clearAllDialogOpen = true }, modifier = Modifier.fillMaxWidth()) {
                    Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(17.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("永久清空全部本地餐食记录", color = Color(0xFFB42318), fontWeight = FontWeight.Bold)
                }
            }
        }
        Spacer(Modifier.height(12.dp))
    }

    if (clearAllDialogOpen) {
        AlertDialog(
            onDismissRequest = { clearAllDialogOpen = false },
            title = { Text("永久清空餐食记录？", color = ClinicalNavyStrong, fontWeight = FontWeight.Bold) },
            text = { Text("这会立即删除所有餐食、时间、来源与假设数据，无法撤销。你设定的每日参考线不受影响。", color = ClinicalMuted) },
            confirmButton = {
                TextButton(
                    onClick = {
                        clearAllDialogOpen = false
                        onClearAll()
                    },
                ) { Text("确认永久清空", color = Color(0xFFB42318), fontWeight = FontWeight.Bold) }
            },
            dismissButton = { TextButton(onClick = { clearAllDialogOpen = false }) { Text("取消") } },
        )
    }
}

@Composable
private fun HistorySummary(stats: MealStatsResult) {
    val average = stats.averagePerRecordedDay
    val highest = stats.highestDay
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        color = ClinicalSoft,
        border = androidx.compose.foundation.BorderStroke(1.dp, ClinicalLine),
    ) {
        Column(modifier = Modifier.padding(17.dp)) {
            Text("期间总计（各餐范围相加）", color = ClinicalMuted, fontSize = 11.sp)
            Row(verticalAlignment = Alignment.Bottom) {
                Text(stats.interval.pointKcal.toString(), color = ClinicalNavyStrong, fontSize = 38.sp, fontWeight = FontWeight.ExtraBold)
                Text(" kcal", color = ClinicalNavy, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
            }
            Text(
                "${stats.interval.lowKcal}–${stats.interval.highKcal} kcal",
                color = ClinicalTeal,
                fontWeight = FontWeight.Bold,
                fontSize = 14.sp,
            )
            Spacer(Modifier.height(13.dp))
            HorizontalDivider(color = ClinicalLine)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatCell(
                    label = "有记录日平均",
                    value = average?.let { "${it.pointKcal.roundToLong()} kcal" } ?: "—",
                    detail = average?.let { "${it.lowKcal.roundToLong()}–${it.highKcal.roundToLong()}" } ?: "无记录",
                    modifier = Modifier.weight(1f),
                )
                StatCell(
                    label = "按中值最高日",
                    value = highest?.let { "${it.interval.pointKcal} kcal" } ?: "—",
                    detail = highest?.date?.format(CHINESE_MONTH_DAY) ?: "无记录",
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                StatCell(
                    label = "相对参考线（区间）",
                    value = "有参考线 ${stats.goalCoverage.daysWithGoalCount}/${stats.goalCoverage.recordedDayCount} 日",
                    detail = "下限到 ${stats.goalCoverage.definitelyReachedDayCount} · 仅中值到 ${stats.goalCoverage.pointEstimateReachedDayCount} · 仅上限到 ${stats.goalCoverage.possiblyReachedDayCount} · 未到 ${stats.goalCoverage.notReachedDayCount}",
                    modifier = Modifier.weight(1f),
                )
                StatCell(
                    label = "记录数",
                    value = "${stats.recordCount} 条",
                    detail = "已记录 ${stats.coverage.recordedDayCount}/${stats.coverage.calendarDayCount} 个可观察日",
                    modifier = Modifier.weight(1f),
                )
            }
            Spacer(Modifier.height(12.dp))
            Text(
                "平均只除以有记录的天数，未记录日不会被当成 0 kcal。可观察窗口从当前保留记录或参考线设置中的最早日期开始，并排除未来日；若没有更早目标设置，删除/撤销最早记录会相应改变窗口。参考线不表示健康成功或失败。",
                color = ClinicalMuted,
                fontSize = 10.sp,
                lineHeight = 15.sp,
            )
        }
    }
}

@Composable
private fun StatCell(label: String, value: String, detail: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier) {
        Text(label, color = ClinicalMuted, fontSize = 10.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(3.dp))
        Text(value, color = ClinicalNavyStrong, fontSize = 15.sp, fontWeight = FontWeight.Bold)
        Text(detail, color = ClinicalMuted, fontSize = 10.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 13.sp)
    }
}

@Composable
private fun PeriodSelector(selected: StatsPeriod, onSelected: (StatsPeriod) -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(ClinicalSoft)
            .padding(4.dp),
    ) {
        StatsPeriod.entries.forEach { period ->
            val active = period == selected
            TextButton(
                onClick = { onSelected(period) },
                modifier = Modifier
                    .weight(1f)
                    .height(40.dp)
                    .semantics { this.selected = active },
                shape = RoundedCornerShape(9.dp),
                colors = ButtonDefaults.textButtonColors(
                    containerColor = if (active) Color.White else Color.Transparent,
                    contentColor = if (active) ClinicalNavy else ClinicalMuted,
                ),
            ) {
                Text(period.chineseLabel(), fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
            }
        }
    }
}

@Composable
private fun PeriodNavigator(state: HistoryUiState, onMove: (Int) -> Unit, onToday: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        IconButton(onClick = { onMove(-1) }) {
            Icon(Icons.Outlined.ChevronLeft, contentDescription = "上一期", tint = ClinicalNavy)
        }
        Text(
            periodTitle(state),
            color = ClinicalNavyStrong,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.weight(1f),
        )
        TextButton(onClick = onToday) { Text("今日", color = ClinicalTeal, fontWeight = FontWeight.Bold) }
        IconButton(onClick = { onMove(1) }) {
            Icon(Icons.Outlined.ChevronRight, contentDescription = "下一期", tint = ClinicalNavy)
        }
    }
}

@Composable
private fun TrendChart(stats: MealStatsResult) {
    val buckets = stats.trend
    val period = stats.period
    val maxHigh = buckets.maxOfOrNull { it.interval.highKcal }?.coerceAtLeast(1L) ?: 1L
    val barWidth = when {
        buckets.size <= 7 -> 20.dp
        buckets.size <= 12 -> 13.dp
        else -> 6.dp
    }
    Surface(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        color = Color.White,
        border = androidx.compose.foundation.BorderStroke(1.dp, ClinicalLine),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().height(168.dp).padding(horizontal = 9.dp, vertical = 10.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            buckets.forEachIndexed { index, bucket ->
                val observedStart = bucket.startDateInclusive.coerceAtLeast(stats.coverage.observedStartDateInclusive)
                val observedEnd = bucket.endDateExclusive.coerceAtMost(stats.coverage.observedEndDateExclusive)
                val observableDays = if (observedEnd > observedStart) {
                    ChronoUnit.DAYS.between(observedStart, observedEnd).toInt()
                } else {
                    0
                }
                TrendBar(
                    bucket = bucket,
                    maxHigh = maxHigh,
                    width = barWidth,
                    label = trendLabel(index, buckets.size, bucket, period),
                    observableDayCount = observableDays,
                    coverageLabel = when {
                        observableDays == 0 -> "未观察"
                        period == StatsPeriod.YEAR -> "${bucket.recordedDayCount}/${observableDays}日"
                        buckets.size <= 12 -> "${bucket.recordCount}餐"
                        bucket.recordCount > 0L -> "•"
                        else -> "无"
                    },
                    modifier = Modifier.weight(1f),
                )
            }
        }
    }
}

@Composable
private fun TrendBar(
    bucket: StatsTrendBucket,
    maxHigh: Long,
    width: Dp,
    label: String,
    coverageLabel: String,
    observableDayCount: Int,
    modifier: Modifier = Modifier,
) {
    val highHeight = 112.dp * (bucket.interval.highKcal.toFloat() / maxHigh.toFloat())
    val pointHeight = 112.dp * (bucket.interval.pointKcal.toFloat() / maxHigh.toFloat())
    val lowHeight = 112.dp * (bucket.interval.lowKcal.toFloat() / maxHigh.toFloat())
    Column(
        modifier = modifier.semantics {
            contentDescription = if (observableDayCount == 0) {
                "${bucket.startDateInclusive}，未观察"
            } else if (bucket.recordCount == 0L) {
                "${bucket.startDateInclusive}，无记录"
            } else {
                "${bucket.startDateInclusive}，${bucket.recordCount} 餐，已记录 ${bucket.recordedDayCount}/$observableDayCount 个可观察日，${bucket.interval.lowKcal} 到 ${bucket.interval.highKcal} 千卡，中值 ${bucket.interval.pointKcal}"
            }
        },
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(modifier = Modifier.fillMaxWidth().height(112.dp), contentAlignment = Alignment.BottomCenter) {
            Box(
                Modifier
                    .width(width)
                    .height(highHeight)
                    .background(ClinicalTeal.copy(alpha = 0.20f), RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)),
            )
            Box(
                Modifier
                    .width(width)
                    .height(pointHeight)
                    .background(ClinicalTeal.copy(alpha = 0.82f), RoundedCornerShape(topStart = 4.dp, topEnd = 4.dp)),
            )
            Box(Modifier.width(width + 3.dp).height(lowHeight)) {
                Box(Modifier.fillMaxWidth().height(1.dp).align(Alignment.TopCenter).background(ClinicalNavy))
            }
            if (observableDayCount == 0) {
                Box(Modifier.size(6.dp).border(1.dp, Color(0xFFD0D5DD), CircleShape))
            } else if (bucket.recordCount == 0L) {
                Box(Modifier.size(6.dp).background(Color(0xFFD0D5DD), CircleShape))
            } else if (bucket.interval.highKcal == 0L) {
                Box(Modifier.size(7.dp).border(1.dp, ClinicalTeal, CircleShape))
            }
        }
        Spacer(Modifier.height(5.dp))
        Text(label, color = ClinicalMuted, fontSize = 8.sp, maxLines = 1)
        Text(
            coverageLabel,
            color = if (bucket.recordCount > 0L) ClinicalTeal else Color(0xFF98A2B3),
            fontSize = 9.sp,
            maxLines = 1,
        )
    }
}

@Composable
private fun MealLogRow(meal: StoredMealLog, showDate: Boolean, onDelete: () -> Unit) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            modifier = Modifier.size(38.dp).background(Color(0xFFEAF7F8), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Outlined.Restaurant, contentDescription = null, tint = ClinicalTeal, modifier = Modifier.size(19.dp))
        }
        Spacer(Modifier.width(10.dp))
        Column(modifier = Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(meal.mealType, color = ClinicalNavyStrong, fontWeight = FontWeight.Bold, fontSize = 14.sp)
                Spacer(Modifier.width(7.dp))
                Text(
                    buildString {
                        if (showDate) append(meal.localDate.format(SHORT_DATE)).append("  ")
                        append(recordedLocalTime(meal))
                    },
                    color = ClinicalMuted,
                    fontSize = 10.sp,
                )
            }
            Text(
                "${meal.pointKcal} kcal  ·  ${meal.lowKcal}–${meal.highKcal}",
                color = ClinicalNavy,
                fontSize = 13.sp,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                "${meal.sourceLabel}  ·  ${meal.modelVersion}  ·  ${meal.datasetVersion}",
                color = ClinicalMuted,
                fontSize = 9.sp,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            meal.assumptions.firstOrNull()?.let { assumption ->
                Text(
                    "假设：$assumption",
                    color = Color(0xFF7A7F89),
                    fontSize = 9.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        IconButton(onClick = onDelete) {
            Icon(Icons.Outlined.DeleteOutline, contentDescription = "删除记录", tint = Color(0xFF98A2B3))
        }
    }
    HorizontalDivider(color = ClinicalLine)
}

@Composable
private fun EmptyRecords() {
    Column(
        modifier = Modifier.fillMaxWidth().padding(vertical = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(Icons.Outlined.History, contentDescription = null, tint = Color(0xFFB1BAC7), modifier = Modifier.size(34.dp))
        Spacer(Modifier.height(8.dp))
        Text("还没有已确认的记录", color = ClinicalMuted, fontSize = 13.sp)
    }
}

@Composable
private fun SectionTitle(title: String, action: String, onAction: (() -> Unit)?) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(title, color = ClinicalNavyStrong, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.weight(1f))
        if (onAction != null) {
            TextButton(onClick = onAction) { Text(action, color = ClinicalTeal, fontWeight = FontWeight.Bold, fontSize = 12.sp) }
        } else {
            Text(action, color = ClinicalMuted, fontSize = 12.sp)
        }
    }
}

@Composable
private fun GoalDialog(
    currentGoal: Int,
    onDismiss: () -> Unit,
    onSave: (Int) -> Unit,
    onClear: () -> Unit,
) {
    var text by remember(currentGoal) { mutableStateOf(currentGoal.toString()) }
    val parsed = text.toIntOrNull()
    val valid = parsed != null && parsed in MIN_CALORIE_GOAL_KCAL..MAX_CALORIE_GOAL_KCAL
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("设置每日参考目标", color = ClinicalNavyStrong, fontWeight = FontWeight.Bold) },
        text = {
            Column {
                OutlinedTextField(
                    value = text,
                    onValueChange = { value -> text = value.filter(Char::isDigit).take(5) },
                    label = { Text("kcal / 天") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    "允许 $MIN_CALORIE_GOAL_KCAL–$MAX_CALORIE_GOAL_KCAL kcal。每条记录会保存确认时的不可变目标快照；统计参考线以每个当地日期最后一次目标设置为准，同日稍后修改会更新当日比较，不会改动更早日期。",
                    color = ClinicalMuted,
                    fontSize = 11.sp,
                    lineHeight = 16.sp,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { if (valid) onSave(requireNotNull(parsed)) }, enabled = valid) {
                Text("保存", fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onClear) { Text("恢复未设置") }
                TextButton(onClick = onDismiss) { Text("取消") }
            }
        },
    )
}

private fun StatsPeriod.chineseLabel(): String = when (this) {
    StatsPeriod.DAY -> "日"
    StatsPeriod.WEEK -> "周"
    StatsPeriod.MONTH -> "月"
    StatsPeriod.YEAR -> "年"
}

private fun periodTitle(state: HistoryUiState): String {
    val stats = state.stats
    return when (state.period) {
        StatsPeriod.DAY -> state.anchor.format(CHINESE_FULL_DATE)
        StatsPeriod.WEEK -> stats?.window?.let {
            "${it.startDateInclusive.format(SHORT_DATE)} – ${it.endDateExclusive.minusDays(1).format(SHORT_DATE)}"
        } ?: state.anchor.format(CHINESE_FULL_DATE)
        StatsPeriod.MONTH -> state.anchor.format(CHINESE_YEAR_MONTH)
        StatsPeriod.YEAR -> "${state.anchor.year} 年"
    }
}

private fun trendLabel(
    index: Int,
    count: Int,
    bucket: StatsTrendBucket,
    period: StatsPeriod,
): String {
    val show = count <= 12 || index == 0 || index == count - 1 || index == count / 2 || index % 7 == 0
    if (!show) return ""
    return if (period == StatsPeriod.YEAR) "${bucket.startDateInclusive.monthValue}月" else "${bucket.startDateInclusive.dayOfMonth}"
}

private fun recordedLocalTime(meal: StoredMealLog): String = runCatching {
    Instant.ofEpochMilli(meal.recordedAtEpochMs)
        .atOffset(ZoneOffset.ofTotalSeconds(meal.recordedOffsetSeconds))
        .format(TIME_FORMAT)
}.getOrDefault("—")

private fun relativeGoalRangeLabel(lowDifference: Long, highDifference: Long): String = when {
    lowDifference >= 0L -> "距离参考线 $lowDifference–$highDifference kcal"
    highDifference <= 0L -> "超出参考线 ${-highDifference}–${-lowDifference} kcal"
    else -> "估算区间跨过参考线（$lowDifference 至 +$highDifference kcal）"
}

private val CHINESE_MONTH_DAY = DateTimeFormatter.ofPattern("M月d日", Locale.SIMPLIFIED_CHINESE)
private val CHINESE_FULL_DATE = DateTimeFormatter.ofPattern("yyyy年M月d日", Locale.SIMPLIFIED_CHINESE)
private val CHINESE_YEAR_MONTH = DateTimeFormatter.ofPattern("yyyy年M月", Locale.SIMPLIFIED_CHINESE)
private val SHORT_DATE = DateTimeFormatter.ofPattern("M/d", Locale.SIMPLIFIED_CHINESE)
private val TIME_FORMAT = DateTimeFormatter.ofPattern("HH:mm", Locale.SIMPLIFIED_CHINESE)
