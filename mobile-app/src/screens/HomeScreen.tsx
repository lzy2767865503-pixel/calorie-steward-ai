import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  BottomNav,
  Card,
  EmptyState,
  MetricBar,
  Notice,
  ScoreBadge,
  type BottomTab,
} from "../ui/components";
import {
  ENTERPRISE_ENVIRONMENT_LABELS,
  type EnterpriseWorkspace,
} from "../enterprise/deployment";
import { officialAttribution } from "../brand/officialAttribution";
import { useI18n } from "../i18n";
import { colors, radius, shadows, spacing, textStyles } from "../ui/theme";

export type HomeMealView = {
  id: string;
  timeLabel: string;
  name: string;
  calories: number;
  lower: number;
  upper: number;
  confidence: number;
};

export type HomeSummaryView = {
  calories: number;
  caloriesLower: number;
  caloriesUpper: number;
  proteinG: number | null;
  carbohydrateG: number | null;
  fatG: number | null;
  fruitVegetableG: number | null;
  fiberG: number | null;
  score: number | null;
  scoreLower: number | null;
  scoreUpper: number | null;
  scoreCoverage: number;
  scoreLabel: string;
  recordedMeals: number;
};

export function HomeScreen({
  dateLabel,
  summary,
  meals,
  apiLabel,
  apiVerified,
  enterpriseWorkspace,
  isDayComplete,
  onCapture,
  onDayCompleteChange,
  onMealPress,
  onTabChange,
}: {
  dateLabel: string;
  summary: HomeSummaryView;
  meals: HomeMealView[];
  apiLabel: string;
  apiVerified: boolean;
  enterpriseWorkspace?: EnterpriseWorkspace | null;
  isDayComplete: boolean;
  onCapture: () => void;
  onDayCompleteChange: (complete: boolean) => void;
  onMealPress?: (id: string) => void;
  onTabChange: (tab: BottomTab) => void;
}) {
  const { language, t } = useI18n();
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark}>
                <Ionicons name="nutrition-outline" size={24} color={colors.teal} />
              </View>
              <View>
                <Text style={styles.brand}>{t("卡路里管家", "Calorie Steward")}</Text>
                <Text style={styles.date}>
                  {enterpriseWorkspace?.organizationName ?? dateLabel}
                </Text>
              </View>
            </View>
            <View style={[styles.apiPill, apiVerified ? styles.apiPillVerified : styles.apiPillPending]}>
              <View style={[styles.apiDot, apiVerified ? styles.apiDotVerified : styles.apiDotPending]} />
              <Text style={styles.apiPillText} numberOfLines={1}>
                {enterpriseWorkspace
                  ? apiVerified ? t("企业服务在线", "Enterprise service online") : t("企业服务待验证", "Enterprise service pending")
                  : apiLabel}
              </Text>
            </View>
          </View>

          <Text style={styles.developerCredit}>{officialAttribution(language)}</Text>

          {enterpriseWorkspace ? (
            <View style={styles.workspaceStrip}>
              <View style={styles.workspaceIdentity}>
                <Ionicons name="business-outline" size={16} color={colors.teal} />
                <Text style={styles.workspaceText} numberOfLines={1}>
                  {enterpriseWorkspace.workspaceId}
                </Text>
              </View>
              <View style={[
                styles.environmentBadge,
                enterpriseWorkspace.environment === "production"
                  ? styles.environmentProduction
                  : styles.environmentStaging,
              ]}>
                <Text style={styles.environmentText}>
                  {language === "zh"
                    ? ENTERPRISE_ENVIRONMENT_LABELS[enterpriseWorkspace.environment]
                    : enterpriseWorkspace.environment === "production" ? "Production" : "Staging"}
                </Text>
              </View>
              <Text style={styles.workspaceDate}>{dateLabel}</Text>
            </View>
          ) : null}

          {!apiVerified ? (
            <Notice title={t("API 尚未通过真实照片验证", "API has not passed a real-photo check")} tone="warning">
              {t("下一张照片会进行首次真实调用。只有图片和结构化数据都通过，才能记录。", "The next photo will make the first live request. A record is saved only if both the image and structured data pass validation.")}
            </Notice>
          ) : null}

          <Card style={styles.todayCard}>
            <View style={styles.todayTop}>
              <View style={styles.totalCopy}>
                <Text style={styles.eyebrow}>{t("今日累计", "TODAY")}</Text>
                <View style={styles.totalRow}>
                  <Text style={styles.total}>{Math.round(summary.calories)}</Text>
                  <Text style={styles.totalUnit}>kcal</Text>
                </View>
                <Text style={styles.totalRange}>
                  {t(`估算范围 ${Math.round(summary.caloriesLower)}–${Math.round(summary.caloriesUpper)} kcal`, `Estimated range ${Math.round(summary.caloriesLower)}–${Math.round(summary.caloriesUpper)} kcal`)}
                </Text>
                <Text style={styles.mealCount}>{t(`${summary.recordedMeals} 餐已记录`, `${summary.recordedMeals} meals recorded`)}</Text>
              </View>
              <ScoreBadge score={summary.score} label={summary.scoreLabel} coverage={summary.scoreCoverage} />
            </View>
            <View style={styles.scoreRange}>
              <Ionicons name="analytics-outline" size={16} color={colors.teal} />
              <Text style={styles.scoreRangeText}>
                {summary.scoreLower === null || summary.scoreUpper === null
                  ? t("当前资料不足以估算分数；缺失数据不按 0 处理", "There is not enough data to estimate a score; missing data is not counted as zero")
                  : t(`今日评分范围 ${Math.round(summary.scoreLower)}–${Math.round(summary.scoreUpper)}；缺失数据不按 0 处理`, `Today's score range is ${Math.round(summary.scoreLower)}–${Math.round(summary.scoreUpper)}; missing data is not counted as zero`)}
              </Text>
            </View>
            <View style={styles.completeRow}>
              <View style={styles.completeCopy}>
                <Text style={styles.completeTitle}>{t("今天已经全部记完", "Everything is logged today")}</Text>
                <Text style={styles.completeBody}>{t("只有你确认无遗漏，今日分数才从暂定变为有效。", "Today's score becomes valid only after you confirm nothing is missing.")}</Text>
              </View>
              <Switch
                accessibilityLabel={t("标记今天所有餐食已记录", "Mark all meals logged today")}
                value={isDayComplete}
                onValueChange={onDayCompleteChange}
                trackColor={{ false: "#BCC6D2", true: colors.tealBright }}
                thumbColor={colors.white}
              />
            </View>
          </Card>

          <View style={styles.captureSection}>
            <Text style={styles.eyebrow}>{t("唯一记录方式", "THE ONLY LOGGING METHOD")}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t("拍摄餐食并用AI分析", "Photograph meal and analyze with AI")}
              onPress={onCapture}
              style={({ pressed }) => [styles.captureButton, pressed && styles.capturePressed]}
            >
              <View style={styles.captureIcon}>
                <Ionicons name="camera" size={31} color={colors.ink} />
              </View>
              <View style={styles.captureCopy}>
                <Text style={styles.captureTitle}>{t("拍照识别这一餐", "Photograph this meal")}</Text>
                <Text style={styles.captureSubtitle}>{t("拍完立即识别 · 确认份量 · 自动记录", "Instant analysis · Confirm portion · Auto-log")}</Text>
              </View>
              <Ionicons name="arrow-forward" size={23} color={colors.white} />
            </Pressable>
          </View>

          <Card>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.eyebrow}>{t("饮食结构快照", "DIET SNAPSHOT")}</Text>
                <Text style={styles.sectionTitle}>{t("今日营养累计", "Today's nutrition")}</Text>
              </View>
              <Text style={styles.referenceLabel}>{t("WHO/FAO 成人参考", "WHO/FAO adult reference")}</Text>
            </View>
            <View style={styles.metrics}>
              <MetricBar label={t("水果与蔬菜", "Fruit & vegetables")} value={summary.fruitVegetableG} target={400} unit="g" />
              <MetricBar label={t("膳食纤维", "Dietary fiber")} value={summary.fiberG} target={25} unit="g" />
              <View style={styles.macroRow}>
                <Macro label={t("蛋白质", "Protein")} value={summary.proteinG} color={colors.success} />
                <Macro label={t("碳水", "Carbs")} value={summary.carbohydrateG} color={colors.teal} />
                <Macro label={t("脂肪", "Fat")} value={summary.fatG} color={colors.warning} />
              </View>
            </View>
          </Card>

          <View style={styles.mealsSection}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.eyebrow}>{t("原始记录", "SOURCE RECORDS")}</Text>
                <Text style={styles.sectionTitle}>{t("今日餐食", "Today's meals")}</Text>
              </View>
              <Text style={styles.referenceLabel}>{t("同源用于所有周期", "One source for every period")}</Text>
            </View>
            {meals.length === 0 ? (
              <Card>
                <EmptyState
                  icon="camera-outline"
                  title={t("今天还没有记录", "No meals logged today")}
                  body={t("拍一张餐食照片，你的日、周、月、年统计会同时更新。", "Photograph a meal to update daily, weekly, monthly, and yearly totals together.")}
                />
              </Card>
            ) : (
              <View style={styles.mealList}>
                {meals.map((meal) => (
                  <Pressable
                    key={meal.id}
                    accessibilityRole="button"
                    accessibilityLabel={t(`删除餐食 ${meal.name}`, `Delete meal ${meal.name}`)}
                    onPress={() => onMealPress?.(meal.id)}
                    style={({ pressed }) => [styles.mealRow, pressed && styles.capturePressed]}
                  >
                    <View style={styles.mealIcon}>
                      <Ionicons name="restaurant-outline" size={20} color={colors.teal} />
                    </View>
                    <View style={styles.mealCopy}>
                      <Text style={styles.mealName}>{meal.name}</Text>
                      <Text style={styles.mealMeta}>
                        {meal.timeLabel} · {Math.round(meal.lower)}–{Math.round(meal.upper)} kcal · {t(`置信 ${Math.round(meal.confidence * 100)}%`, `${Math.round(meal.confidence * 100)}% confidence`)}
                      </Text>
                    </View>
                    <Text style={styles.mealCalories}>{Math.round(meal.calories)}</Text>
                    <View style={styles.deleteIcon}>
                      <Ionicons name="trash-outline" size={17} color={colors.danger} />
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          <Notice title={t("这是估算，不是实验室测量", "This is an estimate, not a lab measurement")} tone="info">
            {t("单张照片看不见隐藏油、盐和精确克重。App 保留范围、置信度和假设，不把 620 kcal 说成精确到 1 kcal。", "One photo cannot reveal hidden oil, salt, or exact weight. The app keeps ranges, confidence, and assumptions instead of presenting 620 kcal as exact to 1 kcal.")}
          </Notice>
        </ScrollView>
        <BottomNav current="home" onChange={onTabChange} />
      </View>
    </SafeAreaView>
  );
}

function Macro({ label, value, color }: { label: string; value: number | null; color: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.macro}>
      <View style={[styles.macroDot, { backgroundColor: color }]} />
      <Text style={styles.macroValue}>{value === null ? t("未知", "Unknown") : `${Math.round(value)} g`}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandMark: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: { ...textStyles.section, color: colors.ink },
  date: { ...textStyles.caption, color: colors.muted },
  developerCredit: { ...textStyles.caption, color: colors.muted, marginTop: -spacing.sm },
  apiPill: {
    maxWidth: 145,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  workspaceStrip: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: -spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 9, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.surface },
  workspaceIdentity: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  workspaceText: { ...textStyles.caption, color: colors.text, fontWeight: "700", flexShrink: 1 },
  environmentBadge: { borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4 },
  environmentProduction: { backgroundColor: colors.successSoft },
  environmentStaging: { backgroundColor: colors.warningSoft },
  environmentText: { fontSize: 12, lineHeight: 15, fontWeight: "800", color: colors.ink },
  workspaceDate: { ...textStyles.caption, color: colors.muted },
  apiPillVerified: { backgroundColor: colors.successSoft },
  apiPillPending: { backgroundColor: colors.warningSoft },
  apiDot: { width: 7, height: 7, borderRadius: 4 },
  apiDotVerified: { backgroundColor: colors.success },
  apiDotPending: { backgroundColor: colors.warning },
  apiPillText: { ...textStyles.caption, color: colors.text, flexShrink: 1 },
  todayCard: { backgroundColor: colors.surface },
  todayTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  totalCopy: { flex: 1 },
  eyebrow: { ...textStyles.eyebrow, color: colors.teal, marginBottom: 4 },
  totalRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs },
  total: { fontSize: 43, lineHeight: 49, color: colors.inkStrong, fontWeight: "900", letterSpacing: -1.5 },
  totalUnit: { ...textStyles.bodyStrong, color: colors.ink },
  totalRange: { ...textStyles.caption, color: colors.muted },
  mealCount: { ...textStyles.caption, color: colors.teal, marginTop: 4 },
  scoreRange: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  scoreRangeText: { ...textStyles.caption, color: colors.muted, flex: 1 },
  completeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  completeCopy: { flex: 1 },
  completeTitle: { ...textStyles.caption, color: colors.text, fontWeight: "700" },
  completeBody: { fontSize: 12, lineHeight: 16, color: colors.muted, marginTop: 2 },
  captureSection: { gap: spacing.xs },
  captureButton: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.ink,
    ...shadows.floating,
  },
  capturePressed: { opacity: 0.78, transform: [{ scale: 0.993 }] },
  captureIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.tealBright,
    alignItems: "center",
    justifyContent: "center",
  },
  captureCopy: { flex: 1 },
  captureTitle: { ...textStyles.bodyStrong, color: colors.white, fontSize: 17 },
  captureSubtitle: { ...textStyles.caption, color: "#C8D7E8", marginTop: 2 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: spacing.sm },
  sectionTitle: { ...textStyles.section, color: colors.inkStrong },
  referenceLabel: { ...textStyles.caption, color: colors.muted, textAlign: "right", flexShrink: 1 },
  metrics: { gap: spacing.md, marginTop: spacing.md },
  macroRow: { flexDirection: "row", gap: spacing.xs },
  macro: { flex: 1, alignItems: "center", padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.background },
  macroDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  macroValue: { ...textStyles.bodyStrong, color: colors.text },
  macroLabel: { ...textStyles.caption, color: colors.muted },
  mealsSection: { gap: spacing.sm },
  mealList: { borderRadius: radius.lg, backgroundColor: colors.surface, overflow: "hidden", ...shadows.card },
  mealRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  mealIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  mealCopy: { flex: 1 },
  mealName: { ...textStyles.bodyStrong, color: colors.text },
  mealMeta: { ...textStyles.caption, color: colors.muted, marginTop: 2 },
  mealCalories: { ...textStyles.bodyStrong, color: colors.ink, fontVariant: ["tabular-nums"] },
  deleteIcon: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.dangerSoft },
});
