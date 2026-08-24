export const ENTERPRISE_POLICY_VERSION = "diet-enterprise-client.v1";
export const DATA_TRANSFER_CONSENT_VERSION = "diet-data-transfer.v2";

export type DataTransferConsentReceipt = Readonly<{
  version: typeof DATA_TRANSFER_CONSENT_VERSION;
  acceptedAtUtc: string;
  scope: string;
  dataCategories: readonly ["meal_photo", "aggregated_diet_report"];
}>;

export type EnterpriseEnvironment = "production" | "staging";
export type EnterpriseDataRegion =
  | "provider_managed"
  | "malaysia"
  | "singapore"
  | "eu";

export type EnterpriseWorkspace = Readonly<{
  organizationName: string;
  workspaceId: string;
  environment: EnterpriseEnvironment;
  dataRegion: EnterpriseDataRegion;
  policyVersion: typeof ENTERPRISE_POLICY_VERSION;
}>;

export const ENTERPRISE_ENVIRONMENT_LABELS: Readonly<
  Record<EnterpriseEnvironment, string>
> = {
  production: "生产环境",
  staging: "测试环境",
};

export const ENTERPRISE_REGION_LABELS: Readonly<
  Record<EnterpriseDataRegion, string>
> = {
  provider_managed: "由企业管理员声明",
  malaysia: "马来西亚",
  singapore: "新加坡",
  eu: "欧盟",
};

const WORKSPACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function isEnterpriseEnvironment(value: unknown): value is EnterpriseEnvironment {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ENTERPRISE_ENVIRONMENT_LABELS, value)
  );
}

function isEnterpriseDataRegion(value: unknown): value is EnterpriseDataRegion {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(ENTERPRISE_REGION_LABELS, value)
  );
}

function normalizeOrganizationName(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

export function enterpriseWorkspaceFromInput(input: {
  organizationName: string;
  workspaceId: string;
  environment: EnterpriseEnvironment;
  dataRegion: EnterpriseDataRegion;
}): EnterpriseWorkspace {
  if (CONTROL_CHARACTER_PATTERN.test(input.organizationName)) {
    throw new Error("企业名称应为 2–80 个可见字符。");
  }
  const organizationName = normalizeOrganizationName(input.organizationName);
  const workspaceId = input.workspaceId.trim();
  if (
    organizationName.length < 2 ||
    organizationName.length > 80
  ) {
    throw new Error("企业名称应为 2–80 个可见字符。");
  }
  if (!WORKSPACE_ID_PATTERN.test(workspaceId)) {
    throw new Error("工作区 ID 应为 2–64 位字母、数字、点、下划线或短横线。");
  }
  if (!isEnterpriseEnvironment(input.environment)) {
    throw new Error("企业环境无效。");
  }
  if (!isEnterpriseDataRegion(input.dataRegion)) {
    throw new Error("数据区域声明无效。");
  }
  return {
    organizationName,
    workspaceId,
    environment: input.environment,
    dataRegion: input.dataRegion,
    policyVersion: ENTERPRISE_POLICY_VERSION,
  };
}

export function validateEnterpriseWorkspace(value: unknown): EnterpriseWorkspace {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("企业工作区身份缺失或格式无效。");
  }
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.organizationName !== "string" ||
    typeof raw.workspaceId !== "string" ||
    !isEnterpriseEnvironment(raw.environment) ||
    !isEnterpriseDataRegion(raw.dataRegion) ||
    raw.policyVersion !== ENTERPRISE_POLICY_VERSION
  ) {
    throw new Error("企业工作区身份或策略版本无效。");
  }
  const canonical = enterpriseWorkspaceFromInput({
    organizationName: raw.organizationName,
    workspaceId: raw.workspaceId,
    environment: raw.environment,
    dataRegion: raw.dataRegion,
  });
  if (
    canonical.organizationName !== raw.organizationName ||
    canonical.workspaceId !== raw.workspaceId
  ) {
    throw new Error("企业工作区身份不是规范格式。");
  }
  return canonical;
}

export function enterpriseWorkspaceScope(
  workspace: EnterpriseWorkspace,
): string {
  const validated = validateEnterpriseWorkspace(workspace);
  return JSON.stringify({
    organizationName: validated.organizationName,
    workspaceId: validated.workspaceId,
    environment: validated.environment,
    dataRegion: validated.dataRegion,
    policyVersion: validated.policyVersion,
  });
}
