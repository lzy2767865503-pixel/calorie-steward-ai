import Ionicons from "@expo/vector-icons/Ionicons";
import { useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
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
  credentialScopeForDraft,
  draftConsentCoversCredentialScope,
  resetDraftAuthorizationIfScopeChanges,
} from "../app/providerConfig";
import {
  ENTERPRISE_ENVIRONMENT_LABELS,
  ENTERPRISE_REGION_LABELS,
  enterpriseWorkspaceFromInput,
  type EnterpriseDataRegion,
  type EnterpriseEnvironment,
} from "../enterprise/deployment";
import { Notice, PrimaryButton } from "../ui/components";
import { officialAttribution } from "../brand/officialAttribution";
import { useI18n } from "../i18n";
import { colors, radius, spacing, textStyles } from "../ui/theme";

export type SetupProviderKind = "enterprise" | "openai" | "openai_compatible" | "gemini" | "anthropic" | "custom";
export type SetupProtocol = "responses" | "chat_completions" | "custom_contract" | "gemini_interactions" | "anthropic_messages";

export type ApiSetupDraft = {
  providerKind: SetupProviderKind;
  protocol: SetupProtocol;
  baseUrl: string;
  visionModel: string;
  reportModel: string;
  apiKey: string;
  organizationName: string;
  workspaceId: string;
  environment: EnterpriseEnvironment;
  dataRegion: EnterpriseDataRegion;
  consentAccepted: boolean;
  consentScope: string | null;
  /** Explicit acknowledgement of irreversible local-photo cleanup in enterprise mode. */
  historicalPhotoPurgeAccepted: boolean;
};

type ProviderOption = {
  id: SetupProviderKind;
  label: string;
  description: string;
  icon: "aperture-outline" | "sparkles-outline" | "cloud-outline" | "server-outline" | "shield-checkmark-outline";
  baseUrl: string;
  protocol: SetupProtocol;
  visionModel?: string;
  reportModel?: string;
};

const providerOptions: ProviderOption[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "Responses + strict JSON Schema",
    icon: "aperture-outline",
    baseUrl: "https://api.openai.com/v1",
    protocol: "responses",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    description: "Interactions + structured output",
    icon: "sparkles-outline",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    protocol: "gemini_interactions",
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    description: "Messages + Vision",
    icon: "cloud-outline",
    baseUrl: "https://api.anthropic.com/v1",
    protocol: "anthropic_messages",
  },
  {
    id: "openai_compatible",
    label: "OpenAI-compatible",
    description: "Self-hosted proxy or compatible cloud",
    icon: "server-outline",
    baseUrl: "",
    protocol: "chat_completions",
  },
  {
    id: "custom",
    label: "Diet AI Contract",
    description: "Build against the app's public contract",
    icon: "server-outline",
    baseUrl: "",
    protocol: "custom_contract",
  },
];

const enterpriseOption: ProviderOption = {
  id: "enterprise",
  label: "Enterprise-managed gateway",
  description: "Organization proxy · Short-lived token · Policy binding",
  icon: "shield-checkmark-outline",
  baseUrl: "",
  protocol: "custom_contract",
  visionModel: "managed-vision",
  reportModel: "managed-report",
};

function providerForKind(kind: SetupProviderKind): ProviderOption {
  return kind === "enterprise"
    ? enterpriseOption
    : providerOptions.find((item) => item.id === kind) ?? providerOptions[0]!;
}

function defaultDraft(initial?: Partial<ApiSetupDraft>): ApiSetupDraft {
  const providerKind = initial?.providerKind ?? "enterprise";
  const provider = providerForKind(providerKind);
  return {
    providerKind,
    protocol: initial?.protocol ?? provider.protocol,
    baseUrl: initial?.baseUrl ?? provider.baseUrl,
    visionModel: initial?.visionModel ?? provider.visionModel ?? "",
    reportModel: initial?.reportModel ?? provider.reportModel ?? "",
    apiKey: "",
    organizationName: initial?.organizationName ?? "",
    workspaceId: initial?.workspaceId ?? "",
    environment: initial?.environment ?? "production",
    dataRegion: initial?.dataRegion ?? "provider_managed",
    consentAccepted: initial?.consentAccepted ?? false,
    consentScope: initial?.consentScope ?? null,
    historicalPhotoPurgeAccepted: initial?.historicalPhotoPurgeAccepted ?? false,
  };
}

function isSecureEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return __DEV__ && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function ApiSetupScreen({
  initial,
  existingSecretHint,
  existingCredentialScope,
  error,
  saving = false,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<ApiSetupDraft>;
  existingSecretHint?: string | null;
  existingCredentialScope?: string | null;
  error?: string | null;
  saving?: boolean;
  onSubmit: (draft: ApiSetupDraft) => Promise<void> | void;
  onCancel?: () => void;
}) {
  const { language, t } = useI18n();
  const [draft, setDraft] = useState(() => defaultDraft(initial));
  const [showKey, setShowKey] = useState(false);
  const [touched, setTouched] = useState(false);

  const localizedProvider = (option: ProviderOption): ProviderOption => {
    if (option.id === "openai") return { ...option, description: t("Responses + 严格 JSON Schema", "Responses + strict JSON Schema") };
    if (option.id === "gemini") return { ...option, description: t("Interactions + 结构化输出", "Interactions + structured output") };
    if (option.id === "openai_compatible") return { ...option, label: t("OpenAI 兼容", "OpenAI-compatible"), description: t("自建代理、兼容云服务", "Self-hosted proxy or compatible cloud") };
    if (option.id === "custom") return { ...option, description: t("按 App 公开契约自建接口", "Build against the app's public contract") };
    if (option.id === "enterprise") return { ...option, label: t("企业托管网关", "Enterprise-managed gateway"), description: t("组织代理 · 短期 Token · 策略绑定", "Organization proxy · Short-lived token · Policy binding") };
    return option;
  };
  const localizedProviderOptions = providerOptions.map(localizedProvider);
  const selectedProvider = localizedProvider(providerForKind(draft.providerKind));
  const isEnterprise = draft.providerKind === "enterprise";
  const currentCredentialScope = credentialScopeForDraft(draft);
  const mayReuseExistingSecret = Boolean(
    existingSecretHint &&
      existingCredentialScope &&
      currentCredentialScope === existingCredentialScope,
  );
  const consentCoversCurrentScope = draftConsentCoversCredentialScope(draft);
  const keySatisfied = draft.apiKey.trim().length > 0 || mayReuseExistingSecret;
  const endpointValid = isSecureEndpoint(draft.baseUrl.trim());
  const enterpriseIdentityValid = useMemo(() => {
    if (!isEnterprise) return true;
    try {
      enterpriseWorkspaceFromInput(draft);
      return true;
    } catch {
      return false;
    }
  }, [draft, isEnterprise]);
  const canSubmit =
    endpointValid &&
    enterpriseIdentityValid &&
    draft.visionModel.trim().length > 0 &&
    keySatisfied &&
    consentCoversCurrentScope &&
    (!isEnterprise || draft.historicalPhotoPurgeAccepted) &&
    !saving;

  const validationMessage = useMemo(() => {
    if (!touched) return null;
    if (!endpointValid) return t("请填写 HTTPS API 地址（调试环境仅允许 localhost）。", "Enter an HTTPS API address (localhost is allowed only in development).") ;
    if (!enterpriseIdentityValid) return t("请检查企业名称、工作区 ID、环境和数据区域声明。", "Check the organization name, workspace ID, environment, and declared data region.");
    if (!draft.visionModel.trim()) return t("请填写支持图片的模型名称。", "Enter the name of a vision-capable model.");
    if (!keySatisfied) return t("请填写 API Key 或代理 Token。", "Enter an API key or proxy token.");
    if (!consentCoversCurrentScope) return t("请先确认照片发送范围和费用责任。", "Confirm the photo transfer scope and billing responsibility first.");
    if (isEnterprise && !draft.historicalPhotoPurgeAccepted) return t("请确认切换企业模式会永久删除本机保留的历史餐食照片。", "Confirm that switching to enterprise mode permanently deletes retained historical meal photos from this device.");
    return null;
  }, [consentCoversCurrentScope, draft.historicalPhotoPurgeAccepted, draft.visionModel, endpointValid, enterpriseIdentityValid, isEnterprise, keySatisfied, t, touched]);

  const chooseProvider = (option: ProviderOption) => {
    setDraft((current) =>
      resetDraftAuthorizationIfScopeChanges(current, {
        ...current,
        providerKind: option.id,
        protocol: option.protocol,
        baseUrl: option.baseUrl,
        visionModel: option.visionModel ?? "",
        reportModel: option.reportModel ?? "",
        historicalPhotoPurgeAccepted: false,
      }),
    );
  };

  const chooseDeploymentMode = (mode: "enterprise" | "personal") => {
    chooseProvider(mode === "enterprise" ? enterpriseOption : providerOptions[0]!);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboardArea}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="nutrition-outline" size={27} color={colors.teal} />
            </View>
            <View>
              <Text style={styles.brandName}>{t("卡路里管家", "Calorie Steward")}</Text>
              <Text style={styles.brandTagline}>{t("智能卡路里管家", "AI CALORIE JOURNAL")}</Text>
            </View>
          </View>

          <Text style={styles.developerCredit}>{officialAttribution(language)}</Text>

          <Text style={styles.title}>{t("连接企业 AI 服务", "Connect an enterprise AI service")}</Text>
          <Text style={styles.lede}>
            {t("企业员工只需组织网关和短期 Token；个人用户仍可在高级模式自行连接 AI 服务。", "Enterprise users need only an organization gateway and short-lived token. Individual users can still connect their own AI service in advanced mode.")}
          </Text>

          <Notice title={t("真实调用，失败即停止", "Live API calls; stop on failure")} tone="info">
            {t("照片识别和报告都通过已确认的 API 完成；返回数据不合格时不会生成虚假卡路里。", "Photo recognition and reports use the confirmed API. Invalid responses never produce fabricated calories.")}
          </Notice>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("1 · 选择部署方式", "1 · Choose deployment mode")}</Text>
            <View style={styles.modeGrid}>
              <ModeCard
                title={t("企业托管", "Enterprise")}
                description={t("推荐 · 连接组织网关", "Recommended · Organization gateway")}
                icon="business-outline"
                selected={isEnterprise}
                onPress={() => chooseDeploymentMode("enterprise")}
              />
              <ModeCard
                title={t("个人高级", "Personal advanced")}
                description={t("自行选择厂商与模型", "Choose your own provider and model")}
                icon="construct-outline"
                selected={!isEnterprise}
                onPress={() => chooseDeploymentMode("personal")}
              />
            </View>
          </View>

          {!isEnterprise ? <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t("2 · 选择 AI 服务", "2 · Choose AI service")}</Text>
            <View style={styles.providerGrid}>
              {localizedProviderOptions.map((option) => {
                const selected = option.id === draft.providerKind;
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    key={option.id}
                    onPress={() => chooseProvider(option)}
                    style={({ pressed }) => [
                      styles.providerCard,
                      selected && styles.providerCardSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons name={option.icon} size={22} color={selected ? colors.teal : colors.muted} />
                    <Text style={[styles.providerName, selected && styles.providerNameSelected]}>{option.label}</Text>
                    <Text style={styles.providerDescription}>{option.description}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View> : null}

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{isEnterprise ? "2" : "3"} · {t("连接信息", "Connection details")}</Text>
            {isEnterprise ? (
              <>
                <View style={styles.managedBanner}>
                  <View style={styles.managedIcon}>
                    <Ionicons name="shield-checkmark-outline" size={22} color={colors.teal} />
                  </View>
                  <View style={styles.managedCopy}>
                    <Text style={styles.managedTitle}>{t("企业托管连接", "Enterprise-managed connection")}</Text>
                    <Text style={styles.managedBody}>{t("模型、密钥和费用由组织网关管理；手机只保存工作区 Token。", "The organization gateway manages models, keys, and billing; the phone stores only a workspace token.")}</Text>
                  </View>
                </View>
                <Field
                  label={t("企业 / 组织名称", "Company / organization name")}
                  value={draft.organizationName}
                  placeholder={t("例如 LAI Systems", "e.g. LAI Systems")}
                  onChangeText={(organizationName) =>
                    setDraft((current) =>
                      resetDraftAuthorizationIfScopeChanges(current, {
                        ...current,
                        organizationName,
                      }),
                    )
                  }
                />
                <Field
                  label={t("工作区 ID", "Workspace ID")}
                  value={draft.workspaceId}
                  placeholder={t("例如 nutrition-pilot", "e.g. nutrition-pilot")}
                  autoCapitalize="none"
                  onChangeText={(workspaceId) =>
                    setDraft((current) =>
                      resetDraftAuthorizationIfScopeChanges(current, { ...current, workspaceId }),
                    )
                  }
                />
                <ChoiceField
                  label={t("运行环境", "Environment")}
                  value={draft.environment}
                  options={language === "zh" ? ENTERPRISE_ENVIRONMENT_LABELS : { production: "Production", staging: "Staging" }}
                  onChange={(environment) =>
                    setDraft((current) =>
                      resetDraftAuthorizationIfScopeChanges(current, { ...current, environment }),
                    )
                  }
                />
                <ChoiceField
                  label={t("数据区域（管理员声明）", "Data region (administrator-declared)")}
                  value={draft.dataRegion}
                  options={language === "zh" ? ENTERPRISE_REGION_LABELS : { provider_managed: "Declared by administrator", malaysia: "Malaysia", singapore: "Singapore", eu: "European Union" }}
                  onChange={(dataRegion) =>
                    setDraft((current) =>
                      resetDraftAuthorizationIfScopeChanges(current, { ...current, dataRegion }),
                    )
                  }
                />
              </>
            ) : null}
            <Field
              label={isEnterprise ? t("企业网关地址", "Enterprise gateway URL") : t("API 地址", "API URL")}
              value={draft.baseUrl}
              placeholder="https://api.example.com"
              autoCapitalize="none"
              keyboardType="url"
              onChangeText={(baseUrl) =>
                setDraft((current) =>
                  resetDraftAuthorizationIfScopeChanges(current, { ...current, baseUrl }),
                )
              }
            />

            {!isEnterprise && draft.providerKind === "openai_compatible" ? (
              <View style={styles.protocolRow}>
                {(["responses", "chat_completions"] as const).map((protocol) => {
                  const selected = draft.protocol === protocol;
                  return (
                    <Pressable
                      key={protocol}
                      onPress={() =>
                        setDraft((current) =>
                          resetDraftAuthorizationIfScopeChanges(current, {
                            ...current,
                            protocol,
                          }),
                        )
                      }
                      style={[styles.protocolChip, selected && styles.protocolChipSelected]}
                    >
                      <Text style={[styles.protocolText, selected && styles.protocolTextSelected]}>
                        {protocol === "responses" ? "Responses" : "Chat Completions"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {!isEnterprise ? <>
              <Field
                label={t("图片识别模型", "Vision model")}
                value={draft.visionModel}
                placeholder={t(`${selectedProvider.label} 中支持图片的模型 ID`, `Vision-capable model ID for ${selectedProvider.label}`)}
                autoCapitalize="none"
                onChangeText={(visionModel) => setDraft((current) => ({ ...current, visionModel }))}
              />
              <Field
                label={t("报告模型（可选）", "Report model (optional)")}
                value={draft.reportModel}
                placeholder={t("留空则使用同一模型", "Leave blank to use the same model")}
                autoCapitalize="none"
                onChangeText={(reportModel) => setDraft((current) => ({ ...current, reportModel }))}
              />
            </> : null}
            <View style={styles.fieldGroup}>
              <View style={styles.fieldLabelRow}>
                <Text style={styles.fieldLabel}>{isEnterprise ? t("工作区 Token", "Workspace token") : "API Key / Token"}</Text>
                {mayReuseExistingSecret ? <Text style={styles.secretHint}>{t(`已保存 ${existingSecretHint}`, `Saved ${existingSecretHint}`)}</Text> : null}
              </View>
              <View style={styles.secretInputRow}>
                <TextInput
                  accessibilityLabel="API Key"
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry={!showKey}
                  style={styles.secretInput}
                  value={draft.apiKey}
                  placeholder={mayReuseExistingSecret ? t("留空保留原凭据", "Leave blank to keep saved credential") : t("仅存入 Keychain / Keystore", "Stored only in Keychain / Keystore")}
                  placeholderTextColor="#93A0B1"
                  onChangeText={(apiKey) => setDraft((current) => ({ ...current, apiKey }))}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={showKey ? t("隐藏密钥", "Hide secret") : t("显示密钥", "Show secret")}
                  onPress={() => setShowKey((current) => !current)}
                  style={styles.eyeButton}
                >
                  <Ionicons name={showKey ? "eye-off-outline" : "eye-outline"} size={20} color={colors.muted} />
                </Pressable>
              </View>
              <Text style={styles.helper}>
                {isEnterprise
                  ? t("请使用企业网关签发的短期、可撤销 Token；不要填写 AI 厂商主 Key。", "Use a short-lived, revocable token issued by the enterprise gateway. Do not enter the AI provider's master key.")
                  : t("推荐填写自建 HTTPS 代理的短期 Token；手机直接保存厂商主 Key 仅适合个人使用。", "A short-lived token from your own HTTPS proxy is recommended. Saving a provider master key directly on the phone is suitable only for personal use.")}
              </Text>
            </View>
          </View>

          {isEnterprise ? (
            <View style={styles.consentCard}>
              <View style={styles.consentCopy}>
                <Text style={styles.consentTitle}>{t("永久清理本机历史照片", "Permanently clear retained photos")}</Text>
                <Text style={styles.consentBody}>
                  {t(
                    "切换企业模式前，App 会永久删除本机仍保留的历史餐食照片（饮食数值记录保留）。清理会写入可恢复日志；若中断，下次启动会继续，并明确提示部分完成状态。",
                    "Before enterprise mode is committed, the app permanently deletes retained historical meal photos from this device (dietary records remain). Cleanup is journaled and resumes after interruption with a clear partial-completion notice.",
                  )}
                </Text>
              </View>
              <Switch
                accessibilityLabel={t("确认永久删除本机历史餐食照片", "Confirm permanent deletion of retained historical meal photos")}
                value={draft.historicalPhotoPurgeAccepted}
                onValueChange={(historicalPhotoPurgeAccepted) =>
                  setDraft((current) => ({ ...current, historicalPhotoPurgeAccepted }))
                }
                trackColor={{ false: "#BCC6D2", true: colors.tealBright }}
                thumbColor={colors.white}
              />
            </View>
          ) : null}

          <View style={styles.consentCard}>
            <View style={styles.consentCopy}>
              <Text style={styles.consentTitle}>{t("发送前确认", "Confirm before sending")}</Text>
              <Text style={styles.consentBody}>
                {isEnterprise
                  ? t(`我知道餐食照片及生成报告所需的聚合饮食指标会发送到 ${draft.organizationName || "待填写组织"} / ${draft.baseUrl || "待填写网关"}；区域由管理员声明，App 无法验证服务端保留政策。`, `I understand that meal photos and aggregated diet metrics needed for reports will be sent to ${draft.organizationName || "organization not entered"} / ${draft.baseUrl || "gateway not entered"}. The region is administrator-declared, and the app cannot verify server retention policies.`)
                  : t(`我知道餐食照片及生成报告所需的聚合饮食指标会发送到 ${selectedProvider.label} / ${draft.baseUrl || "待填写域名"}，调用费用由我的 API 账户承担。`, `I understand that meal photos and aggregated diet metrics needed for reports will be sent to ${selectedProvider.label} / ${draft.baseUrl || "domain not entered"}, and my API account is responsible for usage charges.`)}
              </Text>
            </View>
            <Switch
              accessibilityLabel={t("同意照片发送和费用说明", "Agree to photo transfer and billing notice")}
              value={consentCoversCurrentScope}
              onValueChange={(consentAccepted) =>
                setDraft((current) => ({
                  ...current,
                  consentAccepted,
                  consentScope:
                    consentAccepted ? credentialScopeForDraft(current) : null,
                }))
              }
              trackColor={{ false: "#BCC6D2", true: colors.tealBright }}
              thumbColor={colors.white}
            />
          </View>

          <Notice title={t("企业能力边界", "Enterprise capability boundary")} tone="warning">
            {t("本版本提供托管网关接入、工作区绑定和本机治理记录；SSO、员工权限、集中审计、数据驻留证明仍需要企业后端配合。", "This version provides managed-gateway access, workspace binding, and on-device governance records. SSO, staff permissions, centralized audit, and data-residency proof still require an enterprise backend.")}
          </Notice>

          {error || validationMessage ? (
            <View style={styles.errorBlock}>
              <Notice title={t("还不能继续", "Cannot continue yet")} tone="danger">
                {error ?? validationMessage}
              </Notice>
            </View>
          ) : null}

          <View style={styles.actions}>
            <PrimaryButton
              label={t("连接并拍真实测试照片", "Connect and take a real test photo")}
              icon="camera-outline"
              loading={saving}
              disabled={!canSubmit}
              onPress={() => {
                setTouched(true);
                if (canSubmit) void onSubmit({ ...draft, baseUrl: draft.baseUrl.trim().replace(/\/$/, "") });
              }}
            />
            {onCancel ? (
              <PrimaryButton label={t("取消", "Cancel")} icon="close" variant="secondary" onPress={onCancel} />
            ) : null}
          </View>
          <Text style={styles.footer}>
            {t("首次照片必须真实通过图片 + 结构化输出校验，之后才会把接口标记为可用。", "The first photo must pass real image and structured-output validation before the API is marked usable.")}
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Field({ label, ...props }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        {...props}
        autoCorrect={false}
        style={styles.input}
        placeholderTextColor="#93A0B1"
      />
    </View>
  );
}

function ModeCard({
  title,
  description,
  icon,
  selected,
  onPress,
}: {
  title: string;
  description: string;
  icon: "business-outline" | "construct-outline";
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useI18n();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.modeCard,
        selected && styles.modeCardSelected,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.modeIcon, selected && styles.modeIconSelected]}>
        <Ionicons name={icon} size={22} color={selected ? colors.white : colors.teal} />
      </View>
      <Text style={[styles.modeTitle, selected && styles.modeTitleSelected]}>{title}</Text>
      <Text style={styles.modeDescription}>{description}</Text>
      {selected ? (
        <View style={styles.selectedBadge}>
          <Ionicons name="checkmark" size={13} color={colors.white} />
          <Text style={styles.selectedBadgeText}>{t("已选择", "Selected")}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function ChoiceField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Readonly<Record<T, string>>;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.protocolRow} accessibilityRole="radiogroup">
        {(Object.keys(options) as T[]).map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected }}
              onPress={() => onChange(option)}
              style={[styles.protocolChip, selected && styles.protocolChipSelected]}
            >
              <Text style={[styles.protocolText, selected && styles.protocolTextSelected]}>
                {options[option]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardArea: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: 48, gap: spacing.lg },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  brandMark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.tealSoft,
  },
  brandName: { ...textStyles.section, color: colors.ink },
  brandTagline: { ...textStyles.eyebrow, color: colors.muted, marginTop: 2 },
  developerCredit: { ...textStyles.caption, color: colors.muted, marginTop: -spacing.sm },
  title: { ...textStyles.title, color: colors.inkStrong, marginTop: spacing.xs },
  lede: { ...textStyles.body, color: colors.muted, marginTop: -spacing.md },
  section: { gap: spacing.sm },
  sectionLabel: { ...textStyles.eyebrow, color: colors.teal },
  modeGrid: { flexDirection: "row", gap: spacing.sm },
  modeCard: {
    flex: 1,
    minHeight: 150,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  modeCardSelected: { borderWidth: 2, borderColor: colors.teal, backgroundColor: colors.tealSoft },
  modeIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.tealSoft },
  modeIconSelected: { backgroundColor: colors.teal },
  modeTitle: { ...textStyles.bodyStrong, color: colors.text, marginTop: spacing.sm },
  modeTitleSelected: { color: colors.ink },
  modeDescription: { ...textStyles.caption, color: colors.muted, marginTop: 3 },
  selectedBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 3, marginTop: spacing.sm, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: colors.teal },
  selectedBadgeText: { fontSize: 12, lineHeight: 16, fontWeight: "800", color: colors.white },
  providerGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  providerCard: {
    width: "48%",
    minHeight: 116,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  providerCardSelected: { borderColor: colors.teal, borderWidth: 2, backgroundColor: colors.tealSoft },
  providerName: { ...textStyles.bodyStrong, color: colors.text, marginTop: spacing.xs },
  providerNameSelected: { color: colors.ink },
  providerDescription: { ...textStyles.caption, color: colors.muted, marginTop: 2 },
  pressed: { opacity: 0.7 },
  managedBanner: { flexDirection: "row", gap: spacing.sm, alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.teal, backgroundColor: colors.tealSoft },
  managedIcon: { width: 40, height: 40, borderRadius: 13, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  managedCopy: { flex: 1 },
  managedTitle: { ...textStyles.bodyStrong, color: colors.ink },
  managedBody: { ...textStyles.caption, color: colors.muted, marginTop: 2 },
  fieldGroup: { gap: 6 },
  fieldLabelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  fieldLabel: { ...textStyles.caption, color: colors.text, fontWeight: "700" },
  secretHint: { ...textStyles.caption, color: colors.success },
  input: {
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 15,
  },
  secretInputRow: {
    minHeight: 50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
  },
  secretInput: { flex: 1, paddingHorizontal: 14, color: colors.text, fontSize: 15 },
  eyeButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center" },
  helper: { ...textStyles.caption, color: colors.muted },
  protocolRow: { flexDirection: "row", gap: spacing.xs },
  protocolChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: colors.surface,
  },
  protocolChipSelected: { borderColor: colors.teal, backgroundColor: colors.tealSoft },
  protocolText: { ...textStyles.caption, color: colors.muted },
  protocolTextSelected: { color: colors.teal, fontWeight: "800" },
  consentCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  consentCopy: { flex: 1 },
  consentTitle: { ...textStyles.bodyStrong, color: colors.text },
  consentBody: { ...textStyles.caption, color: colors.muted, marginTop: 3 },
  errorBlock: { marginTop: -spacing.xs },
  actions: { gap: spacing.sm },
  footer: { ...textStyles.caption, color: colors.muted, textAlign: "center" },
});
