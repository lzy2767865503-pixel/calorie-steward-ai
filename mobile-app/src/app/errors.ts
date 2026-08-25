import { isAiProviderError } from "../ai";
import { copy, type AppLanguage } from "../i18n";

const ERROR_MESSAGES: Record<string, readonly [string, string]> = {
  CONFIG_INVALID: ["API 配置不完整，请检查地址、模型和协议。", "API configuration is incomplete. Check the URL, model, and protocol."],
  INSECURE_ENDPOINT: ["凭据请求必须使用 HTTPS，且不允许跨域重定向。", "Credential requests must use HTTPS and cannot redirect across origins."],
  AUTH_MISSING: ["未找到 API Key / Token。", "No API key or token was found."],
  AUTH_FAILED: ["API 凭据被拒绝，请更换或检查权限。", "The API credential was rejected. Replace it or check its permissions."],
  PERMISSION_DENIED: ["该凭据没有使用此模型或图片功能的权限。", "This credential cannot use the selected model or vision feature."],
  RATE_LIMITED: ["API 已达速率或配额限制，请稍后使用同一服务重试。", "The API reached a rate or quota limit. Retry the same service later."],
  BALANCE_EXHAUSTED: ["API 账户余额或可用额度不足，请检查服务商账单。", "The API account has insufficient balance or quota. Check provider billing."],
  MODEL_UNSUPPORTED: ["端点或模型不支持当前的图片结构化请求。", "The endpoint or model does not support this structured vision request."],
  BAD_REQUEST: ["API 拒绝了当前请求格式。", "The API rejected the current request format."],
  NETWORK_ERROR: ["无法安全连接 API，请检查网络和地址。", "A secure API connection could not be established. Check the network and URL."],
  TIMEOUT: ["API 在 60 秒内没有完成。", "The API did not finish within 60 seconds."],
  PROVIDER_UNAVAILABLE: ["AI 服务暂时不可用。", "The AI service is temporarily unavailable."],
  INVALID_JSON: ["AI 没有返回唯一且完整的结构化 JSON。", "The AI did not return one complete structured JSON result."],
  SCHEMA_INVALID: ["AI 返回字段与 meal_analysis.v1 不匹配。", "The AI response does not match meal_analysis.v1."],
  SEMANTIC_INVALID: ["AI 返回的范围、热量或营养数值不自洽。", "The AI returned inconsistent ranges, calories, or nutrition values."],
  REFUSAL: ["AI 拒绝了这次请求。", "The AI refused this request."],
  INCOMPLETE: ["AI 输出未完成，因此不记录。", "The AI output was incomplete, so no record was saved."],
  NOT_FOOD: ["照片中没有可识别的餐食。", "No recognizable meal was found in the photo."],
  NEEDS_RETAKE: ["图片的光线、角度或清晰度不足，需要重拍。", "The lighting, angle, or clarity is insufficient. Retake the photo."],
  UNQUANTIFIABLE: ["能看到食物，但不能负责任地界定份量范围。", "Food is visible, but a defensible portion range cannot be estimated."],
  CONTRACT_MISMATCH: ["自建接口未按 Diet AI Contract 返回数据。", "The custom endpoint did not follow the Diet AI Contract."],
};

export function userFacingError(error: unknown, language: AppLanguage = "zh"): string {
  if (isAiProviderError(error)) {
    const message = ERROR_MESSAGES[error.code];
    const base = message ? copy(language, message[0], message[1]) : error.message;
    return error.providerRequestId ? `${base} (Request ID: ${error.providerRequestId})` : base;
  }
  if (error instanceof Error && error.message.trim()) {
    const containsChinese = /[\u3400-\u9fff]/u.test(error.message);
    if ((language === "zh" && containsChinese) || (language === "en" && !containsChinese)) {
      return error.message;
    }
    return copy(
      language,
      "操作未能安全完成，没有写入未确认的记录。",
      "The operation could not be completed safely. No unconfirmed record was written.",
    );
  }
  return copy(language, "发生未知错误，没有写入任何记录。", "An unknown error occurred. No record was written.");
}
