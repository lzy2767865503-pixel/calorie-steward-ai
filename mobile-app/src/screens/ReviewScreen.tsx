import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Card, IconButton, Notice, PrimaryButton } from "../ui/components";
import { useI18n } from "../i18n";
import { colors, radius, spacing, textStyles } from "../ui/theme";

export type UiRange = {
  available: boolean;
  value: number;
  lower: number;
  upper: number;
  confidence: number;
};

export type UiMealComponent = {
  name: string;
  preparation: string;
  weightG: UiRange;
  energyKcal: UiRange;
};

export type UiMealAnalysis = {
  mealName: string;
  components: UiMealComponent[];
  totals: {
    energyKcal: UiRange;
    proteinG: UiRange;
    carbohydrateG: UiRange;
    fatG: UiRange;
    saturatedFatG: UiRange;
    fiberG: UiRange;
    freeSugarsG: UiRange;
    sodiumMg: UiRange;
    fruitVegetableG: UiRange;
  };
  quality: {
    imageQuality: number;
    identificationConfidence: number;
    portionConfidence: number;
    nutritionConfidence: number;
    dataCoverage: number;
    assumptions: string[];
    uncertainties: string[];
  };
};

function scaled(value: number, factor: number) {
  return Math.round(value * factor);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function ReviewScreen({
  photoUri,
  analysis,
  providerLabel,
  model,
  saving = false,
  onBack,
  onConfirm,
}: {
  photoUri: string;
  analysis: UiMealAnalysis;
  providerLabel: string;
  model: string;
  saving?: boolean;
  onBack: () => void;
  onConfirm: (portionFactor: number) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const [portionFactor, setPortionFactor] = useState(1);
  const portionChoices = [
    { factor: 0.85, label: t("实际偏少", "A little less"), helper: "-15%" },
    { factor: 1, label: t("AI 估计", "AI estimate"), helper: t("不调整", "No change") },
    { factor: 1.15, label: t("实际偏多", "A little more"), helper: "+15%" },
  ] as const;
  const energy = analysis.totals.energyKcal;
  const nutritionConfidence = analysis.quality.nutritionConfidence;
  const adjusted = useMemo(
    () => ({
      value: scaled(energy.value, portionFactor),
      lower: scaled(energy.lower, portionFactor),
      upper: scaled(energy.upper, portionFactor),
    }),
    [energy.lower, energy.upper, energy.value, portionFactor],
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.topBar}>
          <IconButton icon="arrow-back" label={t("返回重拍", "Retake photo")} onPress={onBack} />
          <View style={styles.providerPill}>
            <View style={styles.providerDot} />
            <Text style={styles.providerText}>{t(`${providerLabel} 实时结果`, `${providerLabel} live result`)}</Text>
          </View>
        </View>

        <Image source={{ uri: photoUri }} style={styles.photo} resizeMode="cover" />

        <View style={styles.resultHeader}>
          <Text style={styles.mealName}>{analysis.mealName}</Text>
          <View style={styles.calorieRow}>
            <Text style={styles.calorie}>{adjusted.value}</Text>
            <Text style={styles.calorieUnit}>kcal</Text>
          </View>
          <Text style={styles.range}>{t(`合理估算范围 ${adjusted.lower}–${adjusted.upper} kcal`, `Estimated range ${adjusted.lower}–${adjusted.upper} kcal`)}</Text>
          <View style={styles.confidenceRow}>
            <Text style={styles.confidence}>{t(`AI 营养置信 ${percent(nutritionConfidence)}`, `AI nutrition confidence ${percent(nutritionConfidence)}`)}</Text>
            <Text style={styles.dot}>·</Text>
            <Text style={styles.coverage}>{t(`字段覆盖 ${percent(analysis.quality.dataCoverage)}`, `Field coverage ${percent(analysis.quality.dataCoverage)}`)}</Text>
          </View>
        </View>

        <Card>
          <Text style={styles.cardEyebrow}>{t("一步校正份量", "ONE-STEP PORTION CHECK")}</Text>
          <Text style={styles.cardTitle}>{t("照片中的实际份量接近哪一档？", "Which option best matches the actual portion?")}</Text>
          <Text style={styles.cardBody}>{t("这不是新增食物入口，只是防止单张照片把克重看偏。", "This does not add food manually; it only corrects possible weight bias from one photo.")}</Text>
          <View style={styles.portionRow}>
            {portionChoices.map((choice) => {
              const selected = choice.factor === portionFactor;
              return (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  key={choice.factor}
                  onPress={() => setPortionFactor(choice.factor)}
                  style={[styles.portionChoice, selected && styles.portionChoiceSelected]}
                >
                  <Text style={[styles.portionLabel, selected && styles.portionLabelSelected]}>{choice.label}</Text>
                  <Text style={styles.portionHelper}>{choice.helper}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <Card>
          <View style={styles.listHeader}>
            <Text style={styles.cardTitle}>{t("识别食物", "Identified foods")}</Text>
            <Text style={styles.listCount}>{t(`${analysis.components.length} 项`, `${analysis.components.length} items`)}</Text>
          </View>
          <View style={styles.componentList}>
            {analysis.components.map((component, index) => (
              <View key={`${component.name}-${index}`} style={styles.componentRow}>
                <View style={styles.componentIndex}>
                  <Text style={styles.componentIndexText}>{index + 1}</Text>
                </View>
                <View style={styles.componentCopy}>
                  <Text style={styles.componentName}>{component.name}</Text>
                  <Text style={styles.componentPrep}>{component.preparation && component.preparation.toLowerCase() !== "unknown" ? component.preparation : t("烹饪方式未确定", "Preparation not determined")}</Text>
                </View>
                <View style={styles.componentNumbers}>
                  <Text style={styles.componentKcal}>{scaled(component.energyKcal.value, portionFactor)} kcal</Text>
                  <Text style={styles.componentWeight}>{t(`约 ${scaled(component.weightG.value, portionFactor)} g`, `about ${scaled(component.weightG.value, portionFactor)} g`)}</Text>
                </View>
              </View>
            ))}
          </View>
        </Card>

        <Card>
          <Text style={styles.cardEyebrow}>{t("营养快照", "NUTRITION SNAPSHOT")}</Text>
          <View style={styles.nutrientGrid}>
            <Nutrient label={t("蛋白质", "Protein")} value={analysis.totals.proteinG} factor={portionFactor} unit="g" />
            <Nutrient label={t("碳水", "Carbs")} value={analysis.totals.carbohydrateG} factor={portionFactor} unit="g" />
            <Nutrient label={t("脂肪", "Fat")} value={analysis.totals.fatG} factor={portionFactor} unit="g" />
            <Nutrient label={t("饱和脂肪", "Saturated fat")} value={analysis.totals.saturatedFatG} factor={portionFactor} unit="g" />
            <Nutrient label={t("膳食纤维", "Dietary fiber")} value={analysis.totals.fiberG} factor={portionFactor} unit="g" />
            <Nutrient label={t("钠", "Sodium")} value={analysis.totals.sodiumMg} factor={portionFactor} unit="mg" />
          </View>
        </Card>

        {analysis.quality.assumptions.length || analysis.quality.uncertainties.length ? (
          <Notice title={t("照片无法直接证明的部分", "Details the photo cannot prove")} tone="warning">
            {[...analysis.quality.assumptions, ...analysis.quality.uncertainties].slice(0, 4).join(t("；", "; "))}
          </Notice>
        ) : null}

        <Notice title={t("分数和总计不交给 AI", "AI does not control scores or totals")} tone="info">
          {t("点击记录后，App 会用本地规则重新计算日、周、月、年数据和 DietScore；模型不能自己改分。", "After saving, the app recalculates daily, weekly, monthly, and yearly data and DietScore using local rules. The model cannot change the score.")}
        </Notice>

        <View style={styles.actions}>
          <PrimaryButton
            label={t("确认并记录这一餐", "Confirm and save meal")}
            icon="checkmark"
            loading={saving}
            onPress={() => void onConfirm(portionFactor)}
          />
          <PrimaryButton label={t("重新拍照", "Retake photo")} icon="camera-outline" variant="secondary" onPress={onBack} />
        </View>

        <Text style={styles.modelMeta}>
          {t(`识别来源 ${providerLabel} · ${model} · meal_analysis.v1`, `Recognition source ${providerLabel} · ${model} · meal_analysis.v1`)}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Nutrient({ label, value, factor, unit }: { label: string; value: UiRange; factor: number; unit: string }) {
  const { t } = useI18n();
  return (
    <View style={[styles.nutrient, !value.available && styles.nutrientUnavailable]}>
      <Text style={styles.nutrientLabel}>{label}</Text>
      <Text style={styles.nutrientValue}>
        {value.available ? `${Math.round(value.value * factor * 10) / 10} ${unit}` : t("未知", "Unknown")}
      </Text>
      <Text style={styles.nutrientRange}>
        {value.available ? `${Math.round(value.lower * factor)}–${Math.round(value.upper * factor)}` : t("不按 0 计入", "Not counted as zero")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: 48, gap: spacing.lg },
  topBar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  providerPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    paddingVertical: 8,
    paddingHorizontal: 11,
  },
  providerDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  providerText: { ...textStyles.caption, color: colors.success },
  photo: { width: "100%", aspectRatio: 1.52, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt },
  resultHeader: { alignItems: "center", marginTop: -spacing.xs },
  mealName: { ...textStyles.bodyStrong, color: colors.text },
  calorieRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.xs, marginTop: 2 },
  calorie: { ...textStyles.hero, color: colors.inkStrong, fontSize: 52, lineHeight: 58, fontVariant: ["tabular-nums"] },
  calorieUnit: { ...textStyles.section, color: colors.ink },
  range: { ...textStyles.bodyStrong, color: colors.text },
  confidenceRow: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 5 },
  confidence: { ...textStyles.caption, color: colors.teal },
  coverage: { ...textStyles.caption, color: colors.muted },
  dot: { color: colors.muted },
  cardEyebrow: { ...textStyles.eyebrow, color: colors.teal, marginBottom: 4 },
  cardTitle: { ...textStyles.bodyStrong, color: colors.text },
  cardBody: { ...textStyles.caption, color: colors.muted, marginTop: 4 },
  portionRow: { flexDirection: "row", gap: 7, marginTop: spacing.md },
  portionChoice: {
    flex: 1,
    minHeight: 64,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.background,
    paddingHorizontal: 5,
  },
  portionChoiceSelected: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  portionLabel: { fontSize: 12, lineHeight: 16, fontWeight: "700", color: colors.text, textAlign: "center" },
  portionLabelSelected: { color: colors.teal },
  portionHelper: { fontSize: 12, lineHeight: 16, color: colors.muted, marginTop: 2 },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  listCount: { ...textStyles.caption, color: colors.muted },
  componentList: { marginTop: spacing.sm },
  componentRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
  },
  componentIndex: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tealSoft,
  },
  componentIndexText: { ...textStyles.caption, color: colors.teal, fontWeight: "800" },
  componentCopy: { flex: 1 },
  componentName: { ...textStyles.bodyStrong, color: colors.text },
  componentPrep: { ...textStyles.caption, color: colors.muted },
  componentNumbers: { alignItems: "flex-end" },
  componentKcal: { ...textStyles.caption, color: colors.text, fontWeight: "700" },
  componentWeight: { ...textStyles.caption, color: colors.muted },
  nutrientGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm },
  nutrient: { width: "48%", borderRadius: radius.sm, backgroundColor: colors.background, padding: spacing.sm },
  nutrientUnavailable: { opacity: 0.62 },
  nutrientLabel: { ...textStyles.caption, color: colors.muted },
  nutrientValue: { ...textStyles.bodyStrong, color: colors.text, marginTop: 2 },
  nutrientRange: { fontSize: 12, lineHeight: 16, color: colors.muted },
  actions: { gap: spacing.sm },
  modelMeta: { ...textStyles.caption, color: colors.muted, textAlign: "center" },
});
