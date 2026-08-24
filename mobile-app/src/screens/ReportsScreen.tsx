import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { BottomNav, Card, EmptyState, MetricBar, Notice, PrimaryButton, ScoreBadge, type BottomTab } from "../ui/components";
import { useI18n } from "../i18n";
import { colors, radius, spacing, textStyles } from "../ui/theme";

export type ReportPeriod = "day" | "week" | "month" | "year";

export type TrendPointView = {
  label: string;
  score: number | null;
  calories: number;
};

export type FindingView = {
  id: string;
  title: string;
  detail: string;
  status: "good" | "watch" | "concern" | "unknown";
};

export type GeneratedReportView = {
  summary: string;
  patterns: Array<{ kind: "positive" | "concern" | "neutral"; statement: string; evidence: string }>;
  suggestions: Array<{ priority: number; action: string; reason: string }>;
  uncertaintyNote: string;
  generatedAtLabel: string;
};

export type PeriodSummaryView = {
  label: string;
  score: number | null;
  scoreLower: number | null;
  scoreUpper: number | null;
  coverage: number;
  scoreLabel: string;
  validDays: number;
  observedDays: number;
  mealCount: number;
  averageCalories: number | null;
  averageFruitVegetableG: number | null;
  averageFiberG: number | null;
  averageSodiumMg: number | null;
  averageFatEnergyPercent: number | null;
  averageCarbohydrateEnergyPercent: number | null;
  averageSaturatedFatEnergyPercent: number | null;
  trends: TrendPointView[];
  findings: FindingView[];
};

export function ReportsScreen({
  period,
  summary,
  report,
  generating,
  reportError,
  onPeriodChange,
  onGenerateReport,
  onTabChange,
}: {
  period: ReportPeriod;
  summary: PeriodSummaryView;
  report?: GeneratedReportView | null;
  generating?: boolean;
  reportError?: string | null;
  onPeriodChange: (period: ReportPeriod) => void;
  onGenerateReport: () => void;
  onTabChange: (tab: BottomTab) => void;
}) {
  const { t } = useI18n();
  const periods: Array<{ id: ReportPeriod; label: string }> = [
    { id: "day", label: t("日", "Day") },
    { id: "week", label: t("周", "Week") },
    { id: "month", label: t("月", "Month") },
    { id: "year", label: t("年", "Year") },
  ];
  const hasData = summary.mealCount > 0;
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>{t("身体饮食管家", "AI NUTRITION JOURNAL")}</Text>
              <Text style={styles.title}>{t("饮食报告", "Diet reports")}</Text>
              <Text style={styles.subtitle}>{t("总量和评分本机重算，AI 只写解释与建议", "Totals and scores are recalculated on device; AI writes only explanations and suggestions")}</Text>
            </View>
            <View style={styles.reportIcon}>
              <Ionicons name="analytics-outline" size={26} color={colors.teal} />
            </View>
          </View>

          <View style={styles.periodTabs}>
            {periods.map((item) => {
              const selected = item.id === period;
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  onPress={() => onPeriodChange(item.id)}
                  style={[styles.periodTab, selected && styles.periodTabSelected]}
                >
                  <Text style={[styles.periodText, selected && styles.periodTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {!hasData ? (
            <Card>
              <EmptyState icon="analytics-outline" title={t("这个周期还没有可分析记录", "No records to analyze for this period")} body={t("拍照并确认餐食后，这里会从原始记录重新聚合，不会拿日分数简单平均。", "After a meal is photographed and confirmed, this view re-aggregates the source records instead of simply averaging daily scores.")} />
            </Card>
          ) : (
            <>
              <Card>
                <View style={styles.scoreTop}>
                  <ScoreBadge score={summary.score} label={summary.scoreLabel} coverage={summary.coverage} />
                  <View style={styles.scoreCopy}>
                    <Text style={styles.cardEyebrow}>{summary.label}</Text>
                    <Text style={styles.scoreTitle}>{t("饮食结构评分", "Diet structure score")}</Text>
                    <Text style={styles.scoreRange}>
                      {summary.scoreLower === null || summary.scoreUpper === null
                        ? t("资料不足，暂无评分范围", "Insufficient data for a score range")
                        : t(`不确定范围 ${Math.round(summary.scoreLower)}–${Math.round(summary.scoreUpper)}`, `Uncertainty range ${Math.round(summary.scoreLower)}–${Math.round(summary.scoreUpper)}`)}
                    </Text>
                    <Text style={styles.scoreMeta}>
                      {t(`${summary.mealCount} 餐 · ${summary.validDays}/${summary.observedDays} 有效日 · 日均 ${summary.averageCalories === null ? "未知" : `${Math.round(summary.averageCalories)} kcal`}`, `${summary.mealCount} meals · ${summary.validDays}/${summary.observedDays} valid days · daily average ${summary.averageCalories === null ? "unknown" : `${Math.round(summary.averageCalories)} kcal`}`)}
                    </Text>
                  </View>
                </View>
                {summary.validDays < 7 && period !== "day" ? (
                  <View style={styles.provisional}>
                    <Ionicons name="hourglass-outline" size={17} color={colors.warning} />
                    <Text style={styles.provisionalText}>
                      {t("累计至少 7 个有效日后启用稳定滚动分；当前是暂定分。", "A stable rolling score starts after at least 7 valid days; the current score is provisional.")}
                    </Text>
                  </View>
                ) : null}
              </Card>

              <Card>
                <View style={styles.cardHeading}>
                  <View>
                    <Text style={styles.cardEyebrow}>{t("趋势", "TREND")}</Text>
                    <Text style={styles.cardTitle}>{t("DietScore 变化", "DietScore trend")}</Text>
                  </View>
                  <Text style={styles.chartLegend}>{t("每日用原始营养重算", "Recalculated daily from source nutrition")}</Text>
                </View>
                <TrendChart points={summary.trends} />
              </Card>

              <Card>
                <Text style={styles.cardEyebrow}>{t("与 WHO/FAO 成人参考对照", "WHO/FAO ADULT REFERENCE")}</Text>
                <Text style={styles.cardTitle}>{t("周期日均", "Daily average for period")}</Text>
                <View style={styles.metrics}>
                  <MetricBar label={t("水果与蔬菜", "Fruit & vegetables")} value={summary.averageFruitVegetableG} target={400} unit="g" />
                  <MetricBar label={t("膳食纤维", "Dietary fiber")} value={summary.averageFiberG} target={25} unit="g" />
                  <MetricBar
                    label={t("钠（上限）", "Sodium (limit)")}
                    value={summary.averageSodiumMg}
                    target={2000}
                    unit="mg"
                    tone={summary.averageSodiumMg !== null && summary.averageSodiumMg > 2000 ? "danger" : "teal"}
                  />
                </View>
                <View style={styles.ratioGrid}>
                  <Ratio label={t("碳水供能", "Carb energy")} value={summary.averageCarbohydrateEnergyPercent} target="45–75%" />
                  <Ratio label={t("脂肪供能", "Fat energy")} value={summary.averageFatEnergyPercent} target="15–30%" />
                  <Ratio label={t("饱和脂肪", "Saturated fat")} value={summary.averageSaturatedFatEnergyPercent} target="≤10%" />
                </View>
              </Card>

              <Card>
                <Text style={styles.cardEyebrow}>{t("本地规则先找问题", "LOCAL RULES FIRST")}</Text>
                <Text style={styles.cardTitle}>{t("饮食结构判断", "Diet structure findings")}</Text>
                <View style={styles.findings}>
                  {summary.findings.map((finding) => (
                    <Finding key={finding.id} finding={finding} />
                  ))}
                </View>
              </Card>
            </>
          )}

          <Card style={styles.aiCard}>
            <View style={styles.aiHeader}>
              <View style={styles.aiIcon}>
                <Ionicons name="sparkles" size={23} color={colors.teal} />
              </View>
              <View style={styles.aiHeaderCopy}>
                <Text style={styles.cardEyebrow}>{t("AI 饮食管家", "AI DIET STEWARD")}</Text>
                <Text style={styles.cardTitle}>{t("生成这个周期的人话报告", "Generate a plain-language report")}</Text>
              </View>
            </View>
            <Text style={styles.aiPrivacy}>
              {t("只发送本机已计算的匿名汇总、分数和覆盖率；不再发照片，不发姓名或位置。", "Only anonymous on-device aggregates, scores, and coverage are sent. No photo, name, or location is sent for reports.")}
            </Text>

            {report ? (
              <View style={styles.generatedReport}>
                <Text style={styles.reportSummary}>{report.summary}</Text>
                {report.patterns.map((pattern, index) => (
                  <View key={`${pattern.statement}-${index}`} style={styles.patternRow}>
                    <Ionicons
                      name={pattern.kind === "positive" ? "checkmark-circle-outline" : pattern.kind === "concern" ? "alert-circle-outline" : "information-circle-outline"}
                      size={19}
                      color={pattern.kind === "positive" ? colors.success : pattern.kind === "concern" ? colors.warning : colors.teal}
                    />
                    <View style={styles.patternCopy}>
                      <Text style={styles.patternStatement}>{pattern.statement}</Text>
                      <Text style={styles.patternEvidence}>{pattern.evidence}</Text>
                    </View>
                  </View>
                ))}
                {report.suggestions.length ? (
                  <View style={styles.suggestions}>
                    <Text style={styles.suggestionHeading}>{t("下个周期先做这些", "Try these next period")}</Text>
                    {[...report.suggestions].sort((a, b) => a.priority - b.priority).map((suggestion) => (
                      <View key={`${suggestion.priority}-${suggestion.action}`} style={styles.suggestionRow}>
                        <Text style={styles.suggestionNumber}>{suggestion.priority}</Text>
                        <View style={styles.suggestionCopy}>
                          <Text style={styles.suggestionAction}>{suggestion.action}</Text>
                          <Text style={styles.suggestionReason}>{suggestion.reason}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
                <Text style={styles.uncertainty}>{report.uncertaintyNote}</Text>
                <Text style={styles.generatedAt}>{report.generatedAtLabel}</Text>
              </View>
            ) : null}

            {reportError ? (
              <Notice title={t("AI 报告未生成", "AI report was not generated")} tone="danger">{reportError}</Notice>
            ) : null}

            <PrimaryButton
              label={report ? t("调用 API 更新报告", "Update report via API") : t("调用 API 生成报告", "Generate report via API")}
              icon="sparkles"
              loading={Boolean(generating)}
              disabled={!hasData || summary.score === null}
              onPress={onGenerateReport}
            />
          </Card>

          <Notice title={t("DietScore v1.1 是照片可观察产品分，不是 WHO 官方分数", "DietScore v1.1 is a photo-observable product score, not an official WHO score")} tone="info">
            {t("基准来自 WHO/FAO；本 App 只对照片和结构化证据可支持的果蔬、纤维、碳水、蛋白质和总脂肪评分。饱和脂肪、反式脂肪、游离糖和钠保持未知，不补 0 也不猜测。暂不适用于儿童、孕哺期或临床饮食用户。", "The references come from WHO/FAO. The app scores only fruit and vegetables, fiber, carbohydrate, protein, and total fat when supported by the photo and structured evidence. Saturated fat, trans fat, free sugar, and sodium stay unknown—never filled with zero or guessed. It is not intended for children, pregnancy/breastfeeding, or clinical diets.")}
          </Notice>
        </ScrollView>
        <BottomNav current="reports" onChange={onTabChange} />
      </View>
    </SafeAreaView>
  );
}

function TrendChart({ points }: { points: TrendPointView[] }) {
  const { t } = useI18n();
  const visible = points.slice(-14);
  if (!visible.length) return <Text style={styles.noTrend}>{t("暂无足够数据", "Not enough data yet")}</Text>;
  return (
    <View style={styles.chart}>
      {visible.map((point, index) => {
        const score = point.score ?? 0;
        return (
          <View key={`${point.label}-${index}`} style={styles.chartColumn}>
            <View style={styles.chartTrack}>
              <View style={[styles.chartBar, { height: `${Math.max(4, score)}%`, opacity: point.score === null ? 0.18 : 1 }]} />
            </View>
            <Text style={styles.chartLabel} numberOfLines={1}>{point.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

function Ratio({ label, value, target }: { label: string; value: number | null; target: string }) {
  const { t } = useI18n();
  return (
    <View style={styles.ratio}>
      <Text style={styles.ratioLabel}>{label}</Text>
      <Text style={styles.ratioValue}>{value === null ? t("未知", "Unknown") : `${Math.round(value)}%`}</Text>
      <Text style={styles.ratioTarget}>{t(`参考 ${target}`, `Reference ${target}`)}</Text>
    </View>
  );
}

function Finding({ finding }: { finding: FindingView }) {
  const palette = {
    good: [colors.successSoft, colors.success, "checkmark-circle-outline"],
    watch: [colors.warningSoft, colors.warning, "eye-outline"],
    concern: [colors.dangerSoft, colors.danger, "alert-circle-outline"],
    unknown: [colors.surfaceAlt, colors.muted, "help-circle-outline"],
  } as const;
  const [backgroundColor, color, icon] = palette[finding.status];
  return (
    <View style={[styles.finding, { backgroundColor }]}>
      <Ionicons name={icon} size={21} color={color} />
      <View style={styles.findingCopy}>
        <Text style={[styles.findingTitle, { color }]}>{finding.title}</Text>
        <Text style={styles.findingDetail}>{finding.detail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.lg },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md },
  eyebrow: { ...textStyles.eyebrow, color: colors.teal, marginBottom: 3 },
  title: { ...textStyles.title, color: colors.inkStrong },
  subtitle: { ...textStyles.caption, color: colors.muted, marginTop: 4 },
  reportIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  periodTabs: { flexDirection: "row", borderRadius: radius.md, padding: 4, backgroundColor: colors.surfaceAlt },
  periodTab: { flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  periodTabSelected: { backgroundColor: colors.surface },
  periodText: { ...textStyles.bodyStrong, color: colors.muted },
  periodTextSelected: { color: colors.teal },
  scoreTop: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  scoreCopy: { flex: 1 },
  cardEyebrow: { ...textStyles.eyebrow, color: colors.teal, marginBottom: 4 },
  cardTitle: { ...textStyles.section, color: colors.inkStrong },
  scoreTitle: { ...textStyles.section, color: colors.inkStrong },
  scoreRange: { ...textStyles.bodyStrong, color: colors.teal, marginTop: 5 },
  scoreMeta: { ...textStyles.caption, color: colors.muted, marginTop: 5 },
  provisional: { flexDirection: "row", gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line, marginTop: spacing.md, paddingTop: spacing.sm },
  provisionalText: { ...textStyles.caption, color: colors.warning, flex: 1 },
  cardHeading: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: spacing.md },
  chartLegend: { ...textStyles.caption, color: colors.muted, flexShrink: 1, textAlign: "right" },
  chart: { height: 154, flexDirection: "row", alignItems: "flex-end", gap: 5, marginTop: spacing.lg },
  chartColumn: { flex: 1, height: "100%", alignItems: "center" },
  chartTrack: { flex: 1, width: "100%", justifyContent: "flex-end", backgroundColor: colors.surfaceAlt, borderRadius: 6, overflow: "hidden" },
  chartBar: { width: "100%", backgroundColor: colors.teal, borderRadius: 6 },
  chartLabel: { fontSize: 11, lineHeight: 14, color: colors.muted, marginTop: 5 },
  noTrend: { ...textStyles.caption, color: colors.muted, textAlign: "center", paddingVertical: spacing.xl },
  metrics: { gap: spacing.md, marginTop: spacing.md },
  ratioGrid: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  ratio: { flex: 1, borderRadius: radius.sm, padding: spacing.sm, backgroundColor: colors.background },
  ratioLabel: { fontSize: 12, lineHeight: 15, color: colors.muted, fontWeight: "600" },
  ratioValue: { ...textStyles.bodyStrong, color: colors.text, marginTop: 3 },
  ratioTarget: { fontSize: 11, lineHeight: 14, color: colors.muted },
  findings: { gap: spacing.xs, marginTop: spacing.md },
  finding: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.sm, borderRadius: radius.sm },
  findingCopy: { flex: 1 },
  findingTitle: { ...textStyles.bodyStrong },
  findingDetail: { ...textStyles.caption, color: colors.text, marginTop: 2 },
  aiCard: { gap: spacing.md },
  aiHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  aiIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  aiHeaderCopy: { flex: 1 },
  aiPrivacy: { ...textStyles.caption, color: colors.muted },
  generatedReport: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  reportSummary: { ...textStyles.body, color: colors.text },
  patternRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  patternCopy: { flex: 1 },
  patternStatement: { ...textStyles.bodyStrong, color: colors.text },
  patternEvidence: { ...textStyles.caption, color: colors.muted, marginTop: 2 },
  suggestions: { gap: spacing.xs, marginTop: spacing.sm },
  suggestionHeading: { ...textStyles.bodyStrong, color: colors.ink },
  suggestionRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: spacing.xs },
  suggestionNumber: { width: 25, height: 25, borderRadius: 13, textAlign: "center", textAlignVertical: "center", lineHeight: 25, backgroundColor: colors.tealSoft, color: colors.teal, fontWeight: "800" },
  suggestionCopy: { flex: 1 },
  suggestionAction: { ...textStyles.bodyStrong, color: colors.text },
  suggestionReason: { ...textStyles.caption, color: colors.muted },
  uncertainty: { ...textStyles.caption, color: colors.warning, backgroundColor: colors.warningSoft, padding: spacing.sm, borderRadius: radius.sm },
  generatedAt: { ...textStyles.caption, color: colors.muted, textAlign: "right" },
});
