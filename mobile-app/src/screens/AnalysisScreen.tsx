import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Notice, PrimaryButton } from "../ui/components";
import { useI18n } from "../i18n";
import { colors, radius, spacing, textStyles } from "../ui/theme";

export function AnalysisScreen({
  photoUri,
  providerLabel,
  error,
  onRetry,
  onCancel,
}: {
  photoUri: string;
  providerLabel: string;
  error?: string | null;
  onRetry?: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.imageWrap}>
          <Image source={{ uri: photoUri }} style={styles.image} resizeMode="cover" />
          {!error ? (
            <View style={styles.scanLineWrap}>
              <View style={styles.scanLine} />
            </View>
          ) : null}
        </View>
        <View style={styles.copy}>
          <View style={[styles.icon, error && styles.iconError]}>
            <Ionicons
              name={error ? "alert-circle-outline" : "sparkles"}
              size={30}
              color={error ? colors.danger : colors.teal}
            />
          </View>
          <Text style={styles.title}>{error ? t("这次没有生成记录", "No record was created") : t("正在理解这餐饭", "Understanding this meal")}</Text>
          <Text style={styles.body}>
            {error
              ? t("App 已停止，没有使用固定数据或上一张照片充数。", "The app stopped safely. It did not substitute fixed data or a previous photo.")
              : t(`${providerLabel} 正在识别食物、分量、隐藏用油假设和营养范围。`, `${providerLabel} is identifying foods, portions, hidden-oil assumptions, and nutrition ranges.`)}
          </Text>
        </View>

        {error ? (
          <Notice title={t("这次暂时无法读取", "Could not use this response")} tone="danger">
            {error}
          </Notice>
        ) : (
          <View style={styles.steps}>
            <Step icon="scan-outline" label={t("检查图片质量", "Checking image quality")} />
            <Step icon="restaurant-outline" label={t("识别食物和估算克重", "Identifying foods and estimating weight")} />
            <Step icon="shield-checkmark-outline" label={t("本机校验数值与区间", "Validating values and ranges on device")} />
          </View>
        )}

        <View style={styles.actions}>
          {error && onRetry ? (
            <PrimaryButton label={t("重新调用同一 API", "Retry the same API")} icon="refresh" onPress={onRetry} />
          ) : null}
          <PrimaryButton
            label={error ? t("返回重拍", "Retake photo") : t("取消本次分析", "Cancel analysis")}
            icon="close"
            variant="secondary"
            onPress={onCancel}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

function Step({ icon, label }: { icon: "scan-outline" | "restaurant-outline" | "shield-checkmark-outline"; label: string }) {
  return (
    <View style={styles.step}>
      <Ionicons name={icon} size={19} color={colors.teal} />
      <Text style={styles.stepText}>{label}</Text>
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.muted} />
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: "center" },
  imageWrap: {
    width: "100%",
    aspectRatio: 1.45,
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceAlt,
  },
  image: { width: "100%", height: "100%" },
  scanLineWrap: { ...StyleSheet.absoluteFill, justifyContent: "center" },
  scanLine: {
    height: 3,
    backgroundColor: colors.tealBright,
    ...Platform.select({
      web: { boxShadow: `0 0 8px ${colors.tealBright}` },
      ios: {
        shadowColor: colors.tealBright,
        shadowRadius: 8,
        shadowOpacity: 1,
      },
      android: { elevation: 2 },
    }),
  },
  copy: { alignItems: "center" },
  icon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.sm,
  },
  iconError: { backgroundColor: colors.dangerSoft },
  title: { ...textStyles.section, color: colors.inkStrong, textAlign: "center" },
  body: { ...textStyles.body, color: colors.muted, textAlign: "center", marginTop: spacing.xs },
  steps: { gap: spacing.xs },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 47,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
  },
  stepText: { ...textStyles.caption, color: colors.text, flex: 1 },
  actions: { gap: spacing.sm },
});
