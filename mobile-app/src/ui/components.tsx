import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { useI18n } from "../i18n";
import { colors, radius, shadows, spacing, textStyles } from "./theme";

type IoniconName = ComponentProps<typeof Ionicons>["name"];

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <View style={styles.screenHeader}>
      <View style={styles.headerCopy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text style={styles.headerTitle}>{title}</Text>
        {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function PrimaryButton({
  label,
  onPress,
  icon = "arrow-forward",
  disabled = false,
  loading = false,
  variant = "primary",
  testID,
}: {
  label: string;
  onPress: () => void;
  icon?: IoniconName;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "secondary" | "danger";
  testID?: string;
}) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      testID={testID}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        styles[`button_${variant}`],
        isDisabled && styles.buttonDisabled,
        pressed && !isDisabled && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.ink : colors.white} />
      ) : (
        <>
          <Text style={[styles.buttonText, variant === "secondary" && styles.buttonTextSecondary]}>
            {label}
          </Text>
          <Ionicons
            name={icon}
            size={20}
            color={variant === "secondary" ? colors.ink : colors.white}
          />
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon,
  label,
  onPress,
  tone = "light",
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  tone?: "light" | "dark";
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        tone === "dark" && styles.iconButtonDark,
        pressed && styles.buttonPressed,
      ]}
    >
      <Ionicons name={icon} size={21} color={tone === "dark" ? colors.white : colors.ink} />
    </Pressable>
  );
}

export function Notice({
  title,
  children,
  tone = "warning",
}: {
  title: string;
  children: ReactNode;
  tone?: "warning" | "info" | "danger" | "success";
}) {
  const palette = {
    warning: [colors.warningSoft, colors.warning, "alert-circle-outline"],
    info: [colors.tealSoft, colors.teal, "information-circle-outline"],
    danger: [colors.dangerSoft, colors.danger, "close-circle-outline"],
    success: [colors.successSoft, colors.success, "checkmark-circle-outline"],
  } as const;
  const [backgroundColor, color, icon] = palette[tone];
  return (
    <View style={[styles.notice, { backgroundColor }]}>
      <Ionicons name={icon} size={21} color={color} />
      <View style={styles.noticeCopy}>
        <Text style={[styles.noticeTitle, { color }]}>{title}</Text>
        <Text style={styles.noticeBody}>{children}</Text>
      </View>
    </View>
  );
}

export function MetricBar({
  label,
  value,
  target,
  unit,
  tone = "teal",
}: {
  label: string;
  value: number | null;
  target: number;
  unit: string;
  tone?: "teal" | "warning" | "danger";
}) {
  const { t } = useI18n();
  const ratio = value !== null && target > 0 ? Math.max(0, Math.min(value / target, 1)) : 0;
  const color = tone === "danger" ? colors.danger : tone === "warning" ? colors.warning : colors.teal;
  return (
    <View style={styles.metric}>
      <View style={styles.metricTop}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Text style={styles.metricValue}>
          {value === null ? t("未知", "Unknown") : `${Math.round(value)} / ${Math.round(target)} ${unit}`}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${ratio * 100}%`, backgroundColor: color, opacity: value === null ? 0 : 1 }]} />
      </View>
    </View>
  );
}

export function ScoreBadge({ score, label, coverage }: { score: number | null; label: string; coverage: number }) {
  const { t } = useI18n();
  const tone = score === null ? colors.muted : score >= 80 ? colors.success : score >= 60 ? colors.teal : score >= 40 ? colors.warning : colors.danger;
  return (
    <View style={[styles.scoreBadge, { borderColor: tone }]} accessibilityLabel={`${label} ${score === null ? t("资料不足", "insufficient data") : t(`${score}分`, `${score} points`)}`}>
      <Text style={[styles.scoreNumber, { color: tone }]}>{score === null ? "--" : Math.round(score)}</Text>
      <Text style={styles.scoreUnit}>/ 100</Text>
      <Text style={styles.scoreLabel}>{label}</Text>
      <Text style={styles.scoreCoverage}>{t(`评分覆盖 ${Math.round(coverage * 100)}%`, `${Math.round(coverage * 100)}% score coverage`)}</Text>
    </View>
  );
}

export function EmptyState({ icon, title, body }: { icon: IoniconName; title: string; body: string }) {
  return (
    <View style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Ionicons name={icon} size={25} color={colors.teal} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
    </View>
  );
}

export type BottomTab = "home" | "reports" | "settings";

export function BottomNav({ current, onChange }: { current: BottomTab; onChange: (tab: BottomTab) => void }) {
  const { t } = useI18n();
  const tabs: Array<{ id: BottomTab; label: string; icon: IoniconName }> = [
    { id: "home", label: t("今日", "Today"), icon: "home-outline" },
    { id: "reports", label: t("报告", "Reports"), icon: "analytics-outline" },
    { id: "settings", label: t("设置", "Settings"), icon: "settings-outline" },
  ];
  return (
    <View style={styles.bottomNav}>
      {tabs.map((tab) => {
        const active = tab.id === current;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [styles.tab, pressed && styles.buttonPressed]}
          >
            <Ionicons name={tab.icon} size={22} color={active ? colors.teal : colors.muted} />
            <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screenHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  headerCopy: { flex: 1 },
  eyebrow: { ...textStyles.eyebrow, color: colors.teal, textTransform: "uppercase", marginBottom: 4 },
  headerTitle: { ...textStyles.title, color: colors.inkStrong },
  headerSubtitle: { ...textStyles.body, color: colors.muted, marginTop: 6 },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  button: {
    minHeight: 56,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  button_primary: { backgroundColor: colors.ink },
  button_secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  button_danger: { backgroundColor: colors.danger },
  buttonDisabled: { opacity: 0.42 },
  buttonPressed: { opacity: 0.76, transform: [{ scale: 0.992 }] },
  buttonText: { ...textStyles.bodyStrong, color: colors.white },
  buttonTextSecondary: { color: colors.ink },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  iconButtonDark: { backgroundColor: "rgba(2, 13, 28, 0.58)", borderColor: "rgba(255,255,255,0.24)" },
  notice: {
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  noticeCopy: { flex: 1 },
  noticeTitle: { ...textStyles.bodyStrong, marginBottom: 2 },
  noticeBody: { ...textStyles.caption, color: colors.text },
  metric: { gap: spacing.xs },
  metricTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  metricLabel: { ...textStyles.caption, color: colors.text },
  metricValue: { ...textStyles.caption, color: colors.muted, fontVariant: ["tabular-nums"] },
  track: { height: 7, backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill },
  scoreBadge: {
    width: 132,
    height: 132,
    borderRadius: 66,
    borderWidth: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  scoreNumber: { fontSize: 35, lineHeight: 38, fontWeight: "900", letterSpacing: -1 },
  scoreUnit: { ...textStyles.caption, color: colors.muted, marginTop: -3 },
  scoreLabel: { ...textStyles.caption, color: colors.text, marginTop: 3, fontWeight: "700" },
  scoreCoverage: { fontSize: 12, lineHeight: 15, color: colors.muted },
  empty: { alignItems: "center", paddingVertical: spacing.xl, paddingHorizontal: spacing.lg },
  emptyIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tealSoft,
    marginBottom: spacing.sm,
  },
  emptyTitle: { ...textStyles.bodyStrong, color: colors.text },
  emptyBody: { ...textStyles.caption, color: colors.muted, textAlign: "center", marginTop: 4 },
  bottomNav: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.line,
    paddingTop: 8,
    paddingBottom: 8,
  },
  tab: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 50 },
  tabLabel: { fontSize: 12, lineHeight: 15, color: colors.muted, fontWeight: "600" },
  tabLabelActive: { color: colors.teal, fontWeight: "800" },
});
