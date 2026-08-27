import Ionicons from "@expo/vector-icons/Ionicons";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  CaptureCancelledError,
  CaptureCleanupError,
  prepareCapturePhoto,
  type CaptureCleanup,
  type PreparedCapturePhoto,
  type RawCapture,
} from "../app/captureLifecycle";
import { useI18n } from "../i18n";
import { calculateSanitizedJpegDimensions } from "../platform/imageSafety";
import { Notice, PrimaryButton } from "../ui/components";
import { colors, spacing, textStyles } from "../ui/theme";

export type PreparedPhoto = PreparedCapturePhoto;

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function readImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("The selected image could not be decoded."));
    image.src = uri;
  });
}

async function chooseImage(): Promise<RawCapture> {
  const file = await new Promise<File>((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.setAttribute("capture", "environment");
    input.addEventListener("cancel", () => reject(new CaptureCancelledError()), { once: true });
    input.onchange = () => {
      const selected = input.files?.[0];
      if (selected) resolve(selected);
      else reject(new CaptureCancelledError());
    };
    input.click();
  });
  if (file.size <= 0 || file.size > MAX_SOURCE_BYTES) {
    throw new Error("Choose an image between 1 byte and 25 MB.");
  }
  if (!SUPPORTED_IMAGE_TYPES.has(file.type.toLowerCase())) {
    throw new Error("Choose a JPEG, PNG, or WebP image.");
  }
  const uri = URL.createObjectURL(file);
  try {
    const dimensions = await readImageDimensions(uri);
    // Reject oversized or decompression-bomb-like dimensions before allocating
    // the output canvas. Chromium still owns the initial guarded image decode.
    calculateSanitizedJpegDimensions(dimensions.width, dimensions.height);
    return { uri, ...dimensions };
  } catch (error) {
    URL.revokeObjectURL(uri);
    throw error;
  }
}

async function reencodeJpeg(raw: RawCapture): Promise<{
  uri: string;
  base64: string;
  width: number;
  height: number;
}> {
  const image = new Image();
  image.src = raw.uri;
  await image.decode();
  const { width, height } = calculateSanitizedJpegDimensions(raw.width, raw.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("The secure image encoder is unavailable.");
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  // Canvas encoding reconstructs pixels and therefore drops EXIF/GPS metadata.
  const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
  const separator = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:image/jpeg;base64,") || separator < 0) {
    throw new Error("The selected image could not be re-encoded as JPEG.");
  }
  return {
    uri: `desktop-memory-photo://${randomUUID()}`,
    base64: dataUrl.slice(separator + 1),
    width,
    height,
  };
}

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRequested = useRef(false);

  const selectPhoto = async () => {
    if (busy) return;
    cancelRequested.current = false;
    setBusy(true);
    setError(null);
    try {
      const prepared = await prepareCapturePhoto({
        capture: chooseImage,
        sanitize: reencodeJpeg,
        cleanup: captureCleanup,
        isCancelled: () => cancelRequested.current,
      });
      if (cancelRequested.current) {
        await captureCleanup.deleteRegistered(prepared.uri);
        onCancel();
        return;
      }
      await onPhoto(prepared);
    } catch (caught) {
      if (caught instanceof CaptureCancelledError) return;
      if (caught instanceof CaptureCleanupError) {
        setError(t(
          "临时照片未能确认从内存释放。请关闭并重新打开 App 后再试。",
          "The temporary photo could not be confirmed released from memory. Close and reopen the app before retrying.",
        ));
        return;
      }
      const raw = caught instanceof Error ? caught.message.trim() : "";
      const matchesLanguage = language === "zh"
        ? /[\u3400-\u9fff]/u.test(raw)
        : raw.length > 0 && !/[\u3400-\u9fff]/u.test(raw);
      setError(matchesLanguage ? raw : t("图片处理失败，请重试。", "Image processing failed. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.iconWrap}>
        <Ionicons name="images-outline" size={42} color={colors.teal} />
      </View>
      <Text style={styles.title}>{t("选择餐食照片", "Select a meal photo")}</Text>
      <Text style={styles.body}>
        {t(
          "Windows 会打开系统文件选择器。App 只在内存中读取图片，缩放并重编码成 JPEG；EXIF/GPS 会被移除，源文件不会复制进 App。",
          "Windows opens the system file picker. The app reads the image in memory, resizes it, and re-encodes it as JPEG. EXIF/GPS is removed and the source file is never copied into the app.",
        )}
      </Text>
      {error ? <Notice tone="danger" title={t("未完成图片处理", "Image not completed")}>{error}</Notice> : null}
      <View style={styles.actions}>
        <PrimaryButton
          label={busy ? t("正在安全处理…", "Processing securely…") : t("选择照片", "Select photo")}
          icon="camera-outline"
          loading={busy}
          disabled={busy}
          onPress={() => void selectPhoto()}
        />
        <PrimaryButton
          label={t("返回", "Back")}
          icon="arrow-back"
          variant="secondary"
          disabled={busy}
          onPress={() => {
            cancelRequested.current = true;
            if (!busy) onCancel();
          }}
        />
      </View>
      {busy ? <ActivityIndicator color={colors.teal} style={styles.busy} /> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
  },
  iconWrap: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: colors.tealSoft,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { ...textStyles.title, color: colors.inkStrong, textAlign: "center" },
  body: { ...textStyles.body, color: colors.muted, textAlign: "center", maxWidth: 620 },
  actions: { width: "100%", maxWidth: 480, gap: spacing.sm, marginTop: spacing.sm },
  busy: { marginTop: spacing.xs },
});
