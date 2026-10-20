export const LANGUAGES = [
  { code: "en", name: "English", flag: "/flags/en.svg" },
  { code: "da", name: "Dansk", flag: "/flags/da.svg" },
  { code: "tr", name: "Türkçe", flag: "/flags/tr.svg" },
] as const;
export type AppLanguage = (typeof LANGUAGES)[number]["code"];
export const LANGUAGE_COOKIE = "nem-bold-language";
export function isAppLanguage(value: unknown): value is AppLanguage {
  return LANGUAGES.some(language => language.code === value);
}
/** Browser preferences are ordered; a saved explicit choice takes precedence. */
export function preferredLanguage(languages: readonly string[], saved?: string): AppLanguage {
  if (isAppLanguage(saved)) return saved;
  for (const language of languages) {
    const code = language.toLowerCase().split(/[-_]/)[0];
    if (isAppLanguage(code)) return code;
  }
  return "en";
}
export function savedLanguage(cookies: string): string | undefined {
  const value = cookies.split(";").map(cookie => cookie.trim()).find(cookie => cookie.startsWith(`${LANGUAGE_COOKIE}=`))?.slice(LANGUAGE_COOKIE.length + 1);
  try { return value === undefined ? undefined : decodeURIComponent(value); } catch { return undefined; }
}
