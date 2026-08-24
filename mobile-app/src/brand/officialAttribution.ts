import type { AppLanguage } from "../i18n";

export const OFFICIAL_DEVELOPER_NAME_LATIN = "LAI ZEYU";
export const OFFICIAL_DEVELOPER_NAME_CHINESE = "来泽宇";
export const OFFICIAL_ATTRIBUTION_EN = "Developed by LAI ZEYU 来泽宇";
export const OFFICIAL_ATTRIBUTION_ZH = "由 LAI ZEYU 来泽宇 开发";

export function officialAttribution(language: AppLanguage): string {
  return language === "zh" ? OFFICIAL_ATTRIBUTION_ZH : OFFICIAL_ATTRIBUTION_EN;
}
