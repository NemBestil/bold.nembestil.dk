import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { computed } from "vue";
import { createI18n } from "vue-i18n";
import { describe, expect, it, vi } from "vitest";
import da from "../i18n/locales/da";
import en from "../i18n/locales/en";
import tr from "../i18n/locales/tr";
import { LANGUAGE_COOKIE, preferredLanguage, savedLanguage } from "../app/utils/language";

const dictionaries = { da, en, tr };
const locales = ["da", "en", "tr"] as const;

function flatten(messages: Record<string, unknown>, prefix = ""): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(messages)) {
    const path = prefix + key;
    if (typeof value === "string") result[path] = value;
    else if (value && typeof value === "object" && !Array.isArray(value)) Object.assign(result, flatten(value as Record<string, unknown>, path + "."));
    else throw new Error(`Invalid translation value at ${path}`);
  }
  return result;
}
const messages = { da: flatten(da), en: flatten(en), tr: flatten(tr) };
const parameters = (message: string) => [...new Set([...message.matchAll(/\{(\w+)\}/gu)].map(match => match[1]!))].sort();

describe("complete UI dictionaries", () => {
  it.each(locales)("provides the same nonempty keys and named parameters in %s", locale => {
    expect(Object.keys(messages[locale]).sort()).toEqual(Object.keys(messages.en).sort());
    expect(Object.keys(messages[locale]).length).toBeGreaterThan(200);
    for (const [key, message] of Object.entries(messages[locale])) {
      expect(message.trim(), `${locale}.${key}`).not.toBe("");
      expect(parameters(message), `${locale}.${key}`).toEqual(parameters(messages.en[key]!));
    }
  });

  it.each(locales)("compiles and interpolates every %s message using the real Vue I18n runtime", locale => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const i18n = createI18n({ legacy: false, locale, fallbackLocale: "en", messages: dictionaries });
      for (const [key, message] of Object.entries(messages[locale])) {
        const values = Object.fromEntries(parameters(message).map(name => [name, name === "count" ? 3 : `VALUE_${name}`]));
        const translated = i18n.global.t(key, values);
        expect(translated, `${locale}.${key}`).not.toBe(key);
        expect(translated.trim(), `${locale}.${key}`).not.toBe("");
        expect(translated, `${locale}.${key}`).not.toMatch(/\{\w+\}/u);
        for (const value of Object.values(values)) expect(translated, `${locale}.${key}`).toContain(String(value));
      }
      expect(warnings.mock.calls, `${locale}: fallback or compilation warning`).toEqual([]);
      expect(errors.mock.calls, `${locale}: message compilation error`).toEqual([]);
    } finally {
      warnings.mockRestore();
      errors.mockRestore();
    }
  });

  it("updates existing labels and interpolated goal counts when the same instance changes language", () => {
    const i18n = createI18n({ legacy: false, locale: "en", fallbackLocale: "en", messages: dictionaries });
    const title = computed(() => i18n.global.t("ui.start.title"));
    const goal = computed(() => i18n.global.t("ui.replay.goalNumber", { index: 2, count: 5 }));
    expect([title.value, goal.value]).toEqual(["Getting started", "GOAL 2 / 5"]);
    i18n.global.locale.value = "tr";
    expect([title.value, goal.value]).toEqual(["Başlarken", "GOL 2 / 5"]);
    i18n.global.locale.value = "da";
    expect([title.value, goal.value]).toEqual(["Kom godt i gang", "MÅL 2 / 5"]);
  });

  it("resolves literal translation keys throughout app scripts, templates, conditionals, and rich-text keypaths", () => {
    const files: string[] = [];
    function walk(directory: URL) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
        if (entry.isDirectory()) walk(path);
        else if (/\.(?:vue|ts)$/u.test(entry.name)) files.push(fileURLToPath(path));
      }
    }
    walk(new URL("../app/", import.meta.url));
    const referenced = new Set<string>();
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      // Include literal branches such as t(condition ? 'x.a' : 'x.b') and
      // i18n-t keypath attributes, not only the first argument of simple t().
      for (const match of source.matchAll(/(["'`])((?:core|controller|ui)\.[\w.-]+)\1/gu)) {
        const key = match[2]!;
        referenced.add(key);
        for (const locale of locales) if (!Object.hasOwn(messages[locale], key)) missing.push(`${file}: ${locale}.${key}`);
      }
    }
    expect(referenced.size).toBeGreaterThan(150);
    expect(referenced.has("ui.about.credit")).toBe(true);
    expect(missing).toEqual([]);
  });
});

describe("per-device language preference", () => {
  it.each([
    ["da-DK", "da"], ["DA-dk", "da"], ["da_GL", "da"],
    ["en-GB", "en"], ["EN_us", "en"], ["en-AU", "en"],
    ["tr-TR", "tr"], ["TR_tr", "tr"], ["tr-CY", "tr"],
  ] as const)("recognizes the supported browser language %s", (language, expected) => {
    expect(preferredLanguage([language])).toBe(expected);
  });

  it.each([
    [["de-DE", "tr-TR", "da-DK"], "tr"],
    [["fr-FR", "da-DK", "tr-TR"], "da"],
    [["en-US", "da-DK"], "en"],
    [["tr-TR", "en-GB"], "tr"],
  ] as const)("respects navigator order %j", (languages, expected) => {
    expect(preferredLanguage(languages)).toBe(expected);
  });

  it.each(["da", "en", "tr"] as const)("lets a saved %s choice override the browser's first preference", saved => {
    const cookies = `analytics=abc; ${LANGUAGE_COOKIE}=${saved}; unrelated=true`;
    expect(savedLanguage(cookies)).toBe(saved);
    expect(preferredLanguage(["fr-FR", saved === "tr" ? "da-DK" : "tr-TR"], savedLanguage(cookies))).toBe(saved);
  });

  it("reads encoded choices and matches the complete cookie name", () => {
    expect(savedLanguage(`ignored-${LANGUAGE_COOKIE}=da; ${LANGUAGE_COOKIE}-extra=en`)).toBeUndefined();
    expect(savedLanguage(`other=one=two; ${LANGUAGE_COOKIE}=%74%72; last=yes`)).toBe("tr");
    expect(preferredLanguage(["da-DK"], savedLanguage(`${LANGUAGE_COOKIE}=%74%72`))).toBe("tr");
  });

  it.each([[], ["fr-FR", "de-DE"], ["", "xx"], ["enough", "daisy", "tree"]].map(languages => ({ languages })))("falls back to English for unsupported preferences $languages", ({ languages }) => {
    expect(preferredLanguage(languages)).toBe("en");
    expect(preferredLanguage(languages, "unsupported")).toBe("en");
  });

  it.each(["", "other=true", `${LANGUAGE_COOKIE}=%`, `${LANGUAGE_COOKIE}=%E0%A4%A`])("ignores a missing or malformed language cookie %s", cookies => {
    expect(savedLanguage(cookies)).toBeUndefined();
    expect(preferredLanguage(["tr-TR"], savedLanguage(cookies))).toBe("tr");
  });

  it("ignores unsupported saved choices while still honoring a supported browser preference", () => {
    const saved = savedLanguage(`${LANGUAGE_COOKIE}=fr`);
    expect(preferredLanguage(["de-DE", "da-DK"], saved)).toBe("da");
    expect(preferredLanguage(["de-DE", "fr-FR"], saved)).toBe("en");
  });
});
