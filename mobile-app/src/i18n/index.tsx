import { createContext, useContext, useMemo, type ReactNode } from "react";

export type AppLanguage = "zh" | "en";
export type LanguagePreference = "system" | AppLanguage;

export const LANGUAGE_PREFERENCE_SETTING_KEY = "app.language_preference.v1";

export function languageFromLocale(locale: string | null | undefined): AppLanguage {
  return locale?.trim().toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function systemLanguage(): AppLanguage {
  try {
    return languageFromLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return "en";
  }
}

export function resolveLanguage(
  preference: LanguagePreference,
  detected: AppLanguage = systemLanguage(),
): AppLanguage {
  return preference === "system" ? detected : preference;
}

export function localeTag(language: AppLanguage): "zh-CN" | "en-US" {
  return language === "zh" ? "zh-CN" : "en-US";
}

export function copy(language: AppLanguage, chinese: string, english: string): string {
  return language === "zh" ? chinese : english;
}

type I18nContextValue = {
  language: AppLanguage;
  preference: LanguagePreference;
  t: (chinese: string, english: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  language,
  preference,
  children,
}: {
  language: AppLanguage;
  preference: LanguagePreference;
  children: ReactNode;
}) {
  const value = useMemo<I18nContextValue>(
    () => ({
      language,
      preference,
      t: (chinese, english) => copy(language, chinese, english),
    }),
    [language, preference],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
