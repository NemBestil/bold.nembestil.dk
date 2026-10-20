import { onMounted, ref, watch } from "vue";

export interface ControllerPreferences {
  translationSensitivity: number;
  rotationSensitivity: number;
  inverted: boolean;
  goodGraphics: boolean;
}
export const DEFAULT_CONTROLLER_PREFERENCES: Readonly<ControllerPreferences> = {
  translationSensitivity: 1,
  rotationSensitivity: 1,
  inverted: true,
  goodGraphics: false,
};
export const CONTROLLER_PREFERENCES_KEY = "nemfuss:controller-preferences";
const SCHEMA_VERSION = 2;
type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function saveControllerPreferences(
  storage: PreferenceStorage,
  preferences: ControllerPreferences,
) {
  try {
    storage.setItem(CONTROLLER_PREFERENCES_KEY, JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      translationSensitivity: preferences.translationSensitivity,
      rotationSensitivity: preferences.rotationSensitivity,
      inverted: preferences.inverted,
      goodGraphics: preferences.goodGraphics,
    }));
  } catch {
    /* Storage is optional in private browsing. */
  }
}

export function loadControllerPreferences(storage: PreferenceStorage): ControllerPreferences {
  const preferences = { ...DEFAULT_CONTROLLER_PREFERENCES };
  let saved: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(storage.getItem(CONTROLLER_PREFERENCES_KEY) || "null");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      saved = parsed as Record<string, unknown>;
  } catch {
    /* Missing, invalid or unavailable storage uses the current defaults. */
  }
  for (const key of ["translationSensitivity", "rotationSensitivity"] as const) {
    const value = saved[key];
    if (typeof value === "number" && Number.isFinite(value))
      preferences[key] = Math.max(0.3, Math.min(3, value));
  }
  const current = saved.schemaVersion === SCHEMA_VERSION;
  if (current && typeof saved.inverted === "boolean")
    preferences.inverted = saved.inverted;
  if (typeof saved.goodGraphics === "boolean") preferences.goodGraphics = saved.goodGraphics;
  // Legacy values were auto-saved, so they do not identify a deliberate direction choice.
  // Adopt the requested new horizontal default once while preserving sensitivities.
  if (!current) saveControllerPreferences(storage, preferences);
  return preferences;
}

export function useControllerPreferences() {
  const preferences = ref<ControllerPreferences>({ ...DEFAULT_CONTROLLER_PREFERENCES });
  onMounted(() => {
    try {
      preferences.value = loadControllerPreferences(localStorage);
    } catch {
      /* Even accessing localStorage can be blocked. */
    }
  });
  watch(preferences, (value) => {
    try {
      saveControllerPreferences(localStorage, value);
    } catch {
      /* Even accessing localStorage can be blocked. */
    }
  }, { deep: true, flush: "sync" });
  return preferences;
}
