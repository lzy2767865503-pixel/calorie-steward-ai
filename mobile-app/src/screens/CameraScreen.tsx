import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions, type CameraType } from "expo-camera";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { IconButton, Notice, PrimaryButton } from "../ui/components";
import {
  CaptureCancelledError,
  CaptureCleanupError,
  prepareCapturePhoto,
  type CaptureCleanup,
  type PreparedCapturePhoto,
} from "../app/captureLifecycle";
import { useI18n } from "../i18n";
import { colors, radius, spacing, textStyles } from "../ui/theme";

export type PreparedPhoto = PreparedCapturePhoto;

export function CameraScreen({
  onCancel,
  onPhoto,
  captureCleanup,
}: {
  onCancel: () => void;
  onPhoto: (photo: PreparedPhoto) => Promise<void> | void;
  captureCleanup: CaptureCleanup;
}) {
  const { language, t } = useI18n();
  const cameraRef = useRef<CameraView | null>(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<CameraType>("back");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRequested = useRef(false);
  const busyRef = useRef(false);

  const cancelCamera = () => {
    cancelRequested.current = true;
    // A native capture cannot always be cancelled mid-call. Keep this screen
    // mounted until the returned file has been journaled and cleaned.
    if (!busyRef.current) onCancel();
  };

  const takePhoto = async () => {
    if (!cameraRef.current || busyRef.current) return;
    cancelRequested.current = false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const activeCamera = cameraRef.current;
      const prepared = await prepareCapturePhoto({
        capture: () =>
          activeCamera.takePictureAsync({
            quality: 0.9,
            exif: false,
            skipProcessing: false,
          }),
        sanitize: async (captured) =>
          manipulateAsync(
            captured.uri,
            captured.width > 1600 ? [{ resize: { width: 1600 } }] : [],
            { base64: true, compress: 0.82, format: SaveFormat.JPEG },
          ),
        cleanup: captureCleanup,
        isCancelled: () => cancelRequested.current,
      });
      if (cancelRequested.current) {
        await captureCleanup.deleteRegistered(prepared.uri);
        onCancel();
        return;
      }
      // Ownership transfers here. Every cancel/retry/save branch in App uses
      // the same journal-backed deleteRegistered operation.
      await onPhoto(prepared);
    } catch (caught) {
      if (caught instanceof CaptureCancelledError) {
        onCancel();
        return;
      }
      if (cancelRequested.current && !(caught instanceof CaptureCleanupError)) {
        onCancel();
        return;
      }
      if (caught instanceof CaptureCleanupError) {
        setError(t("临时照片未能确认删除。App 会在下次启动扫描自有拍摄缓存并重试；请重启后再拍照。", "Temporary-photo deletion could not be confirmed. The app will scan its own capture cache and retry on the next launch; restart before taking another photo."));
        return;
      }
      const rawMessage = caught instanceof Error ? caught.message.trim() : "";
      const messageMatchesLanguage = language === "zh"
        ? /[\u3400-\u9fff]/u.test(rawMessage)
        : rawMessage.length > 0 && !/[\u3400-\u9fff]/u.test(rawMessage);
      setError(messageMatchesLanguage ? rawMessage : t("拍照处理失败，请重试。", "Photo processing failed. Please try again."));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <ActivityIndicator color={colors.teal} />
        <Text style={styles.permissionBody}>{t("正在检查相机权限…", "Checking camera permission…")}</Text>
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.permissionScreen}>
        <View style={styles.permissionIcon}>
          <Ionicons name="camera-outline" size={34} color={colors.teal} />
        </View>
        <Text style={styles.permissionTitle}>{t("只需要相机权限", "Only camera access is needed")}</Text>
        <Text style={styles.permissionBody}>
          {t("卡路里管家只用相机拍摄餐食。不申请位置、通讯录或麦克风权限。", "Calorie Steward uses the camera only for meal photos. It does not request location, contacts, or microphone access.")}
        </Text>
        <View style={styles.permissionActions}>
          <PrimaryButton label={t("允许相机", "Allow camera")} icon="camera-outline" onPress={() => void requestPermission()} />
          <PrimaryButton label={t("返回", "Back")} icon="arrow-back" variant="secondary" onPress={onCancel} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing={facing} animateShutter />
      <SafeAreaView style={styles.overlay}>
        <View style={styles.topBar}>
          <IconButton icon="close" label={t("取消拍照", "Cancel camera")} tone="dark" onPress={cancelCamera} />
          <View style={styles.liveLabel}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>{t("AI 餐食分析", "AI MEAL ANALYSIS")}</Text>
          </View>
          <IconButton
            icon="camera-reverse-outline"
            label={t("切换摄像头", "Switch camera")}
            tone="dark"
            onPress={() => setFacing((current) => (current === "back" ? "front" : "back"))}
          />
        </View>

        <View style={styles.guideArea} pointerEvents="none">
          <View style={styles.guideFrame}>
            <View style={[styles.corner, styles.cornerTopLeft]} />
            <View style={[styles.corner, styles.cornerTopRight]} />
            <View style={[styles.corner, styles.cornerBottomLeft]} />
            <View style={[styles.corner, styles.cornerBottomRight]} />
          </View>
          <View style={styles.tipCard}>
            <Ionicons name="sunny-outline" size={17} color={colors.white} />
            <Text style={styles.tipText}>{t("餐盘放平、光线充足，尽量拍全整份量", "Keep the plate level, use good light, and capture the full portion")}</Text>
          </View>
        </View>

        <View style={styles.bottomArea}>
          {error ? (
            <View style={styles.errorWrap}>
              <Notice tone="danger" title={t("未完成拍照", "Photo not completed")}>{error}</Notice>
            </View>
          ) : null}
          <Text style={styles.privacyText}>
            {t("原始相机文件只在 App 缓存中短暂停留并登记清理；App 另行重编码、移除 EXIF/GPS，只把重编码 JPEG 发给你选择的 AI。删除失败会在下次启动重试。", "The raw camera file stays briefly in app cache and is registered for cleanup. The app separately re-encodes it, removes EXIF/GPS, and sends only the re-encoded JPEG to your selected AI. Failed deletion is retried on the next launch.")}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("拍照并分析", "Take photo and analyze")}
            accessibilityState={{ busy }}
            disabled={busy}
            onPress={() => void takePhoto()}
            style={({ pressed }) => [styles.shutterOuter, pressed && !busy && styles.shutterPressed]}
          >
            <View style={styles.shutterInner}>
              {busy ? <ActivityIndicator color={colors.ink} /> : <Ionicons name="sparkles" size={27} color={colors.ink} />}
            </View>
          </Pressable>
          <Text style={styles.shutterLabel}>{busy ? t("正在安全处理…", "Processing securely…") : t("拍照并识别", "Capture and identify")}</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.black },
  overlay: { flex: 1, justifyContent: "space-between" },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  liveLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: "rgba(2, 13, 28, 0.58)",
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.tealBright },
  liveText: { ...textStyles.caption, color: colors.white, fontWeight: "700" },
  guideArea: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.xl },
  guideFrame: { width: "100%", aspectRatio: 1.08, position: "relative" },
  corner: { position: "absolute", width: 45, height: 45, borderColor: colors.white },
  cornerTopLeft: { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 16 },
  cornerTopRight: { right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 16 },
  cornerBottomLeft: { left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 16 },
  cornerBottomRight: { right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 16 },
  tipCard: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: "rgba(2, 13, 28, 0.68)",
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  tipText: { ...textStyles.caption, color: colors.white, flexShrink: 1 },
  bottomArea: {
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    backgroundColor: "rgba(2, 13, 28, 0.53)",
    paddingTop: spacing.md,
  },
  privacyText: { ...textStyles.caption, color: "#E6EDF5", textAlign: "center", marginBottom: spacing.md },
  shutterOuter: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 3,
    borderColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 66,
    height: 66,
    borderRadius: 33,
    backgroundColor: colors.white,
    alignItems: "center",
    justifyContent: "center",
  },
  shutterPressed: { transform: [{ scale: 0.94 }] },
  shutterLabel: { ...textStyles.caption, color: colors.white, marginTop: spacing.xs },
  errorWrap: { width: "100%", marginBottom: spacing.sm },
  permissionScreen: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  permissionIcon: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  permissionTitle: { ...textStyles.section, color: colors.inkStrong, textAlign: "center" },
  permissionBody: { ...textStyles.body, color: colors.muted, textAlign: "center", marginTop: spacing.sm },
  permissionActions: { width: "100%", gap: spacing.sm, marginTop: spacing.xl },
});
