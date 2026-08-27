import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ENTERPRISE_ENVIRONMENT_LABELS,
  ENTERPRISE_REGION_LABELS,
  type EnterpriseWorkspace,
} from "../enterprise/deployment";
import { officialAttribution } from "../brand/officialAttribution";
import { localeTag, useI18n, type LanguagePreference } from "../i18n";
import { BottomNav, Card, Notice, PrimaryButton, type BottomTab } from "../ui/components";
import { colors, radius, spacing, textStyles } from "../ui/theme";

export type ProfileDraft = {
  weightKg: string;
  dailyEnergyTargetKcal: string;
  populationGroup: "healthy_adult" | "child_or_adolescent" | "pregnant_or_breastfeeding" | "clinical_diet";
};

export function SettingsScreen({
  providerLabel,
  endpointLabel,
  secretHint,
  apiVerified,
  verifiedAt,
  enterpriseWorkspace,
  profile,
  retainPhotos,
  photoRetentionAvailable = true,
  credentialStoreLabel = "SecureStore",
  privacyUrl,
  supportUrl,
  savingProfile,
  languagePreference,
  onEditApi,
  onDeleteApi,
  onSaveProfile,
  onLanguagePreferenceChange,
  onRetainPhotosChange,
  onExport,
  onDeleteAllData,
  onTabChange,
}: {
  providerLabel: string;
  endpointLabel: string;
  secretHint: string | null;
  apiVerified: boolean;
  verifiedAt?: string | null;
  enterpriseWorkspace?: EnterpriseWorkspace | null;
  profile: ProfileDraft;
  retainPhotos: boolean;
  photoRetentionAvailable?: boolean;
  credentialStoreLabel?: string;
  privacyUrl?: string | undefined;
  supportUrl?: string | undefined;
  savingProfile?: boolean;
  languagePreference: LanguagePreference;
  onEditApi: () => void;
  onDeleteApi: () => void;
  onSaveProfile: (profile: ProfileDraft) => Promise<void> | void;
  onLanguagePreferenceChange: (preference: LanguagePreference) => Promise<void> | void;
  onRetainPhotosChange: (value: boolean) => void;
  onExport: () => void;
  onDeleteAllData: () => void;
  onTabChange: (tab: BottomTab) => void;
}) {
  const { language, t } = useI18n();
  const [draft, setDraft] = useState(profile);
  const populationOptions: Array<{ id: ProfileDraft["populationGroup"]; label: string }> = [
    { id: "healthy_adult", label: t("健康成人", "Healthy adult") },
    { id: "child_or_adolescent", label: t("儿童/青少年", "Child/adolescent") },
    { id: "pregnant_or_breastfeeding", label: t("孕哺期", "Pregnancy/breastfeeding") },
    { id: "clinical_diet", label: t("临床饮食", "Clinical diet") },
  ];
  const languageOptions: Array<{ id: LanguagePreference; label: string }> = [
    { id: "system", label: t("跟随系统", "System") },
    { id: "zh", label: t("中文", "中文") },
    { id: "en", label: "English" },
  ];

  useEffect(() => setDraft(profile), [profile]);

  const weight = draft.weightKg.trim() ? Number(draft.weightKg) : null;
  const energy = draft.dailyEnergyTargetKcal.trim() ? Number(draft.dailyEnergyTargetKcal) : null;
  const valid =
    (weight === null || (Number.isFinite(weight) && weight >= 30 && weight <= 350)) &&
    (energy === null || (Number.isFinite(energy) && energy >= 800 && energy <= 6000));

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>{t("智能卡路里管家", "AI CALORIE JOURNAL")}</Text>
              <Text style={styles.title}>{t("设置与隐私", "Settings & privacy")}</Text>
              <Text style={styles.subtitle}>{t("记录主要存于本机；识别与报告数据发送到已确认的服务", "Records stay mainly on device; recognition and report data go only to the confirmed service")}</Text>
            </View>
            <View style={styles.headerIcon}>
              <Ionicons name="shield-checkmark-outline" size={27} color={colors.teal} />
            </View>
          </View>

          <Card>
            <Text style={styles.cardEyebrow}>{t("语言", "LANGUAGE")}</Text>
            <Text style={styles.cardTitle}>{t("界面与 AI 报告语言", "App and AI report language")}</Text>
            <Text style={styles.cardBody}>{t("默认跟随系统；你的选择会保存在本机，直到再次更改或卸载 App。", "The app follows the system by default. Your choice stays on this device until you change it or uninstall the app.")}</Text>
            <View style={styles.choiceGrid}>
              {languageOptions.map((option) => {
                const selected = option.id === languagePreference;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => void onLanguagePreferenceChange(option.id)}
                    style={[styles.choice, selected && styles.choiceSelected]}
                  >
                    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </Card>

          <Card>
            <View style={styles.cardHeader}>
              <View style={[styles.statusIcon, apiVerified ? styles.statusIconGood : styles.statusIconPending]}>
                <Ionicons
                  name={apiVerified ? "checkmark" : "hourglass-outline"}
                  size={22}
                  color={apiVerified ? colors.success : colors.warning}
                />
              </View>
              <View style={styles.cardHeaderCopy}>
                <Text style={styles.cardEyebrow}>AI API</Text>
                <Text style={styles.cardTitle}>{providerLabel}</Text>
                <Text style={styles.cardMeta}>{endpointLabel}</Text>
              </View>
              <View style={[styles.statusPill, apiVerified ? styles.statusPillGood : styles.statusPillPending]}>
                <Text style={[styles.statusText, { color: apiVerified ? colors.success : colors.warning }]}>
                  {apiVerified ? t("已实拍验证", "Photo verified") : t("待实拍验证", "Photo check pending")}
                </Text>
              </View>
            </View>
            <View style={styles.secretRow}>
              <Ionicons name="key-outline" size={18} color={colors.muted} />
              <Text style={styles.secretText}>{secretHint ? t(`凭据 ${secretHint} · 仅 ${credentialStoreLabel}`, `Credential ${secretHint} · ${credentialStoreLabel} only`) : t("未找到凭据", "No credential found")}</Text>
            </View>
            <View style={styles.inlineActions}>
              <View style={styles.flexButton}>
                <PrimaryButton label={t("修改接口", "Edit API")} icon="create-outline" variant="secondary" onPress={onEditApi} />
              </View>
              <View style={styles.flexButton}>
                <PrimaryButton label={t("删除凭据", "Delete credential")} icon="trash-outline" variant="danger" onPress={onDeleteApi} />
              </View>
            </View>
          </Card>

          {enterpriseWorkspace ? (
            <Card>
              <View style={styles.enterpriseHeader}>
                <View style={styles.enterpriseMark}>
                  <Ionicons name="business-outline" size={23} color={colors.teal} />
                </View>
                <View style={styles.cardHeaderCopy}>
                  <Text style={styles.cardEyebrow}>{t("企业工作区", "ENTERPRISE WORKSPACE")}</Text>
                  <Text style={styles.cardTitle}>{enterpriseWorkspace.organizationName}</Text>
                  <Text style={styles.cardMeta}>{enterpriseWorkspace.workspaceId}</Text>
                </View>
                <View
                  style={[
                    styles.environmentPill,
                    enterpriseWorkspace.environment === "production"
                      ? styles.environmentProduction
                      : styles.environmentStaging,
                  ]}
                >
                  <Text style={styles.environmentText}>
                    {language === "zh" ? ENTERPRISE_ENVIRONMENT_LABELS[enterpriseWorkspace.environment] : enterpriseWorkspace.environment === "production" ? "Production" : "Staging"}
                  </Text>
                </View>
              </View>
              <View style={styles.governanceList}>
                <GovernanceRow
                  label={t("数据区域声明", "Declared data region")}
                  value={language === "zh" ? ENTERPRISE_REGION_LABELS[enterpriseWorkspace.dataRegion] : ({ provider_managed: "Declared by administrator", malaysia: "Malaysia", singapore: "Singapore", eu: "European Union" } as const)[enterpriseWorkspace.dataRegion]}
                />
                <GovernanceRow label={t("客户端策略", "Client policy")} value={enterpriseWorkspace.policyVersion} />
                <GovernanceRow
                  label={t("真实照片验证", "Real-photo verification")}
                  value={verifiedAt ? new Date(verifiedAt).toLocaleString(localeTag(language)) : t("尚未完成", "Not completed")}
                />
                <GovernanceRow label={t("凭据范围", "Credential scope")} value={t("工作区 + 环境 + 网关 + 策略版本", "Workspace + environment + gateway + policy version")} />
              </View>
              <Notice title={t("治理边界", "Governance boundary")} tone="info">
                {t("这是设备本机的连接与治理状态，不是不可篡改的企业审计。SSO、人员权限、远程撤销和数据驻留证明需由企业后端提供。", "This is device-local connection and governance status, not an immutable enterprise audit. SSO, staff permissions, remote revocation, and data-residency proof require an enterprise backend.")}
              </Notice>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.cardEyebrow}>{t("个人化参考", "PERSONAL REFERENCE")}</Text>
            <Text style={styles.cardTitle}>{t("评分适用范围", "Score applicability")}</Text>
            <Text style={styles.cardBody}>
              {t("WHO 没有一个适合所有人的统一热量数字。体重只用于计算蛋白质参考，留空则使用供能比例。", "WHO does not define one calorie number for everyone. Weight is used only for the protein reference; leave it blank to use energy ratios.")}
            </Text>

            <Text style={styles.fieldLabel}>{t("人群", "Population group")}</Text>
            <View style={styles.choiceGrid}>
              {populationOptions.map((option) => {
                const selected = draft.populationGroup === option.id;
                return (
                  <Pressable
                    key={option.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    onPress={() => setDraft((current) => ({ ...current, populationGroup: option.id }))}
                    style={[styles.choice, selected && styles.choiceSelected]}
                  >
                    <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.fieldRow}>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("体重 kg（可选）", "Weight kg (optional)")}</Text>
                <TextInput
                  keyboardType="decimal-pad"
                  value={draft.weightKg}
                  onChangeText={(weightKg) => setDraft((current) => ({ ...current, weightKg }))}
                  placeholder={t("例如 70", "e.g. 70")}
                  placeholderTextColor="#93A0B1"
                  style={styles.input}
                />
              </View>
              <View style={styles.fieldHalf}>
                <Text style={styles.fieldLabel}>{t("每日热量参考（可选）", "Daily calorie reference (optional)")}</Text>
                <TextInput
                  keyboardType="number-pad"
                  value={draft.dailyEnergyTargetKcal}
                  onChangeText={(dailyEnergyTargetKcal) => setDraft((current) => ({ ...current, dailyEnergyTargetKcal }))}
                  placeholder={t("例如 2000", "e.g. 2000")}
                  placeholderTextColor="#93A0B1"
                  style={styles.input}
                />
              </View>
            </View>

            {draft.populationGroup !== "healthy_adult" ? (
              <Notice title={t("通用成人分数将停用", "General adult score will be disabled")} tone="warning">
                {t("儿童、孕哺期或临床饮食需要专用基准。App 仍可记录总量，但不会假装给出通用健康分。", "Children, pregnancy/breastfeeding, and clinical diets need dedicated references. The app can still record totals but will not pretend to provide a general health score.")}
              </Notice>
            ) : null}

            {!valid ? (
              <Text style={styles.validation}>{t("请检查数值：体重 30–350 kg，热量参考 800–6,000 kcal。", "Check the values: weight 30–350 kg and calorie reference 800–6,000 kcal.")}</Text>
            ) : null}
            <PrimaryButton
              label={t("保存个人化参考", "Save personal reference")}
              icon="checkmark"
              loading={Boolean(savingProfile)}
              disabled={!valid}
              onPress={() => void onSaveProfile(draft)}
            />
          </Card>

          <Card>
            <Text style={styles.cardEyebrow}>{t("本机数据", "ON-DEVICE DATA")}</Text>
            <Text style={styles.cardTitle}>{t("保留、导出与删除", "Retention, export & deletion")}</Text>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingTitle}>{t("保留重编码后的餐食照片", "Retain re-encoded meal photos")}</Text>
                <Text style={styles.settingBody}>
                  {!photoRetentionAvailable
                    ? t("Windows 版本强制关闭：分析用 JPEG 只在内存中短暂停留，保存结构化记录后即释放。", "Forced off on Windows: the analysis JPEG stays briefly in memory and is released after the structured record is saved.")
                    : enterpriseWorkspace
                    ? t("企业托管模式强制关闭；只保留结构化记录。", "Forced off in enterprise-managed mode; only structured records are retained.")
                    : t("默认关闭。取消、重拍或保存记录时会清理分析用 JPEG；删除失败会在下次启动重试。开启后，餐食记录只保留一份同样重编码的 JPEG。", "Off by default. The analysis JPEG is cleaned on cancel, retake, or save; failed deletion is retried on the next launch. When enabled, a meal record retains one copy of the same re-encoded JPEG.")}
                </Text>
              </View>
              <Switch
                accessibilityLabel={t("保留重编码后的餐食照片", "Retain re-encoded meal photos")}
                value={retainPhotos}
                onValueChange={onRetainPhotosChange}
                disabled={!photoRetentionAvailable || Boolean(enterpriseWorkspace)}
                trackColor={{ false: "#BCC6D2", true: colors.tealBright }}
                thumbColor={colors.white}
              />
            </View>
            <View style={styles.dataActions}>
              <PrimaryButton label={t("导出完整记录 JSON", "Export complete JSON record")} icon="download-outline" variant="secondary" onPress={onExport} />
              <PrimaryButton label={t("删除全部饮食数据", "Delete all diet data")} icon="trash-outline" variant="danger" onPress={onDeleteAllData} />
            </View>
            <Text style={styles.exportNote}>{t("API Key、任何餐食照片、本机照片路径、企业网关和组织策略都不会进入饮食导出 JSON。卸载 App 会删除此设备上的本地记录，请定期导出备份。", "API keys, meal photos, local photo paths, enterprise gateways, and organization policies are excluded from the diet JSON export. Uninstalling deletes local records from this device, so export backups regularly.")}</Text>
          </Card>

          <Card>
            <Text style={styles.cardEyebrow}>DietScore v1.1 · PHOTO-OBSERVABLE</Text>
            <Text style={styles.cardTitle}>{t("透明基准", "Transparent references")}</Text>
            <View style={styles.standardList}>
              <Standard label={t("水果与蔬菜", "Fruit & vegetables")} value={t("≥400 g/日 · 27.27%", "≥400 g/day · 27.27%")} />
              <Standard label={t("天然膳食纤维", "Natural dietary fiber")} value={t("≥25 g/日 · 18.18%", "≥25 g/day · 18.18%")} />
              <Standard label={t("碳水化合物供能", "Carbohydrate energy")} value="45–75% · 18.18%" />
              <Standard label={t("蛋白质充足度", "Protein adequacy")} value={t("体重基准/供能回退 · 18.18%", "Weight reference/energy fallback · 18.18%")} />
              <Standard label={t("总脂肪供能", "Total fat energy")} value="15–30% · 18.18%" />
            </View>
            <Text style={styles.standardNote}>{t("v1.1 将旧版中照片可支持的 55 点基础权重归一化为 100；饱和脂肪、反式脂肪、游离糖和钠仍保持未知，不参与照片分。WHO/FAO 只提供基准，权重与扣分方法是公开的产品算法。", "v1.1 normalizes the 55 base points supported by photo evidence to 100. Saturated fat, trans fat, free sugar, and sodium remain unknown and are excluded from the photo score. WHO/FAO provides references only; the weights and deductions are a public product algorithm.")}</Text>
          </Card>

          <Card>
            <Text style={styles.cardEyebrow}>{t("关于", "ABOUT")}</Text>
            <Text style={styles.cardTitle}>{t("卡路里管家 v1.2.3", "Calorie Steward v1.2.3")}</Text>
            <Text style={styles.developerAttribution}>{officialAttribution(language)}</Text>
            <Text style={styles.cardBody}>{t("这是官方版本的作者署名。官方构建门禁会在署名意外缺失时失败；由于项目开源，第三方 fork 仍可依法修改源代码和界面。", "This is the official build attribution. The official build gate fails if it is accidentally removed. Because the project is open source, third-party forks can still lawfully modify the source and interface.")}</Text>
            {privacyUrl || supportUrl ? (
              <View style={styles.dataActions}>
                {privacyUrl ? (
                  <PrimaryButton
                    label={t("Windows 隐私政策", "Windows privacy policy")}
                    icon="shield-checkmark-outline"
                    variant="secondary"
                    onPress={() => void Linking.openURL(privacyUrl)}
                  />
                ) : null}
                {supportUrl ? (
                  <PrimaryButton
                    label={t("支持与问题反馈", "Support and issue reporting")}
                    icon="help-circle-outline"
                    variant="secondary"
                    onPress={() => void Linking.openURL(supportUrl)}
                  />
                ) : null}
              </View>
            ) : null}
          </Card>

          <Notice title={t("不是医疗诊断", "Not a medical diagnosis")} tone="info">
            {t("卡路里管家用于日常饮食记录和结构观察，不替代医生、营养师、血液检测或称重实验。", "Calorie Steward supports everyday diet logging and pattern awareness. It does not replace a doctor, dietitian, blood test, or weighed-food study.")}
          </Notice>
        </ScrollView>
        <BottomNav current="settings" onChange={onTabChange} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Standard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.standardRow}>
      <Text style={styles.standardLabel}>{label}</Text>
      <Text style={styles.standardValue}>{value}</Text>
    </View>
  );
}

function GovernanceRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.governanceRow}>
      <Text style={styles.governanceLabel}>{label}</Text>
      <Text style={styles.governanceValue}>{value}</Text>
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
  headerIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: colors.tealSoft, alignItems: "center", justifyContent: "center" },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  statusIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  statusIconGood: { backgroundColor: colors.successSoft },
  statusIconPending: { backgroundColor: colors.warningSoft },
  cardHeaderCopy: { flex: 1 },
  cardEyebrow: { ...textStyles.eyebrow, color: colors.teal, marginBottom: 3 },
  cardTitle: { ...textStyles.section, color: colors.inkStrong },
  cardMeta: { ...textStyles.caption, color: colors.muted, marginTop: 2 },
  developerAttribution: { ...textStyles.bodyStrong, color: colors.teal, marginTop: spacing.sm },
  statusPill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 6 },
  statusPillGood: { backgroundColor: colors.successSoft },
  statusPillPending: { backgroundColor: colors.warningSoft },
  statusText: { fontSize: 12, lineHeight: 15, fontWeight: "800" },
  secretRow: { flexDirection: "row", gap: spacing.xs, alignItems: "center", marginTop: spacing.md, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.background },
  secretText: { ...textStyles.caption, color: colors.muted, flex: 1 },
  inlineActions: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.md },
  flexButton: { flex: 1 },
  enterpriseHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  enterpriseMark: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.tealSoft },
  environmentPill: { borderRadius: radius.pill, paddingHorizontal: 9, paddingVertical: 6 },
  environmentProduction: { backgroundColor: colors.successSoft },
  environmentStaging: { backgroundColor: colors.warningSoft },
  environmentText: { fontSize: 12, lineHeight: 15, fontWeight: "800", color: colors.ink },
  governanceList: { marginTop: spacing.md, marginBottom: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  governanceRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  governanceLabel: { ...textStyles.caption, color: colors.muted },
  governanceValue: { ...textStyles.caption, color: colors.text, fontWeight: "700", textAlign: "right", flexShrink: 1 },
  cardBody: { ...textStyles.body, color: colors.muted, marginTop: 5, marginBottom: spacing.md },
  fieldLabel: { ...textStyles.caption, color: colors.text, fontWeight: "700", marginBottom: 6 },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.md },
  choice: { borderRadius: radius.pill, borderWidth: 1, borderColor: colors.line, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.background },
  choiceSelected: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  choiceText: { ...textStyles.caption, color: colors.muted },
  choiceTextSelected: { color: colors.teal, fontWeight: "800" },
  fieldRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  fieldHalf: { flex: 1 },
  input: { minHeight: 48, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, backgroundColor: colors.background, color: colors.text, paddingHorizontal: 12, fontSize: 15 },
  validation: { ...textStyles.caption, color: colors.danger, marginBottom: spacing.sm },
  settingRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, marginTop: spacing.md },
  settingCopy: { flex: 1 },
  settingTitle: { ...textStyles.bodyStrong, color: colors.text },
  settingBody: { ...textStyles.caption, color: colors.muted, marginTop: 3 },
  dataActions: { gap: spacing.sm, marginTop: spacing.md },
  exportNote: { ...textStyles.caption, color: colors.muted, marginTop: spacing.sm },
  standardList: { marginTop: spacing.sm },
  standardRow: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.line },
  standardLabel: { ...textStyles.caption, color: colors.text },
  standardValue: { ...textStyles.caption, color: colors.teal, fontWeight: "700", textAlign: "right" },
  standardNote: { ...textStyles.caption, color: colors.muted, marginTop: spacing.sm },
});
