export type SupportedLanguage = "en" | "zh" | "ms" | "id";
export type LanguagePreference = SupportedLanguage | "system";

/** Resolve system language without changing an explicitly selected preference. */
export function resolveLanguagePreference(preference: LanguagePreference, browserLanguage = ""): SupportedLanguage {
  if (preference !== "system") return preference;
  const code = browserLanguage.toLowerCase().split(/[-_]/, 1)[0];
  return code === "zh" || code === "ms" || code === "id" ? code : "en";
}
