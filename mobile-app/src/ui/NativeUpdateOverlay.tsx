import Ionicons from "@expo/vector-icons/Ionicons";
import { Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { androidUpdatePromptCopy, type AndroidUpdate } from "../app/nativeUpdate";
import { officialAttribution } from "../brand/officialAttribution";
import type { AppLanguage } from "../i18n";
import { PrimaryButton } from "./components";
import { colors, radius, shadows, spacing, textStyles } from "./theme";

export type AndroidUpdateGateFailure = "runtime_identity" | "gate_storage";

export function NativeUpdateOverlay({
  language,
  update,
  gateFailure,
  checking,
  actionError,
  onUpdate,
  onRetry,
  onRemindLater,
}: {
  language: AppLanguage;
  update: AndroidUpdate | null;
  gateFailure: AndroidUpdateGateFailure | null;
  checking: boolean;
  actionError: string | null;
  onUpdate: (update: AndroidUpdate) => void;
  onRetry: () => void;
  onRemindLater: (update: AndroidUpdate) => void;
}) {
  const visible = update !== null || gateFailure !== null;
  if (!visible) return null;

  const copy = update ? androidUpdatePromptCopy(language, update) : null;
  const blocking = gateFailure !== null || update?.required === true;
  const failureTitle = language === "zh" ? "无法验证更新安全状态" : "Update security status unavailable";
  const failureMessage = gateFailure === "runtime_identity"
    ? (language === "zh"
      ? "无法从系统确认当前安装包的官方包名、版本号或 Build。App 已暂停使用，请重新安装官方版本后重试。"
      : "The system could not confirm this installation's official package id, version, or build. App use is paused; reinstall the official build and retry.")
    : (language === "zh"
      ? "无法读取本机的强制更新门禁记录。为防止绕过已知安全更新，App 已暂停使用，请重试。"
      : "The on-device required-update gate could not be read. App use is paused to prevent bypassing a known security update; retry.");

  return (
    <Modal
      visible
      animationType="fade"
      presentationStyle="fullScreen"
      statusBarTranslucent={false}
      onRequestClose={blocking ? () => undefined : () => update && onRemindLater(update)}
    >
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.card} accessibilityRole="alert">
            <View style={styles.iconWrap}>
              <Ionicons name="shield-checkmark" size={34} color={colors.white} />
            </View>
            <Text style={styles.eyebrow}>
              {blocking
                ? (language === "zh" ? "安全更新门禁" : "SECURITY UPDATE GATE")
                : (language === "zh" ? "新版本已上线" : "NEW VERSION AVAILABLE")}
            </Text>
            <Text style={styles.title}>{copy?.title ?? failureTitle}</Text>
            <Text style={styles.body}>{copy?.message ?? failureMessage}</Text>
            {actionError ? (
              <View style={styles.errorBox}>
                <Ionicons name="alert-circle" size={20} color={colors.danger} />
                <Text style={styles.errorText}>{actionError}</Text>
              </View>
            ) : null}
            <View style={styles.actions}>
              {update ? (
                <PrimaryButton
                  label={copy?.updateNow ?? (language === "zh" ? "立即更新" : "Update now")}
                  icon="download-outline"
                  onPress={() => onUpdate(update)}
                />
              ) : null}
              {blocking ? (
                <PrimaryButton
                  label={checking
                    ? (language === "zh" ? "正在重新检查…" : "Checking again…")
                    : (copy?.retry ?? (language === "zh" ? "重试" : "Retry"))}
                  icon="refresh"
                  variant="secondary"
                  disabled={checking}
                  onPress={onRetry}
                />
              ) : update ? (
                <PrimaryButton
                  label={copy?.remindLater ?? (language === "zh" ? "稍后提醒" : "Remind me later")}
                  icon="time-outline"
                  variant="secondary"
                  onPress={() => onRemindLater(update)}
                />
              ) : null}
            </View>
            <Text style={styles.footnote}>
              {language === "zh"
                ? "本功能只验证公开版本记录和官方不可变下载地址；下载由外部浏览器处理。"
                : "This feature validates the public release record and immutable official URL only; the external browser handles the download."}
            </Text>
            <Text style={styles.credit}>{officialAttribution(language)}</Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.line,
    padding: spacing.xl,
    ...shadows.floating,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.ink,
    marginBottom: spacing.lg,
  },
  eyebrow: { ...textStyles.eyebrow, color: colors.teal, marginBottom: spacing.xs },
  title: { ...textStyles.title, color: colors.inkStrong, marginBottom: spacing.md },
  body: { ...textStyles.body, color: colors.text },
  errorBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.dangerSoft,
  },
  errorText: { ...textStyles.caption, color: colors.danger, flex: 1 },
  actions: { gap: spacing.sm, marginTop: spacing.xl },
  footnote: { ...textStyles.caption, color: colors.muted, marginTop: spacing.lg },
  credit: { ...textStyles.caption, color: colors.ink, fontWeight: "700", marginTop: spacing.sm },
});
