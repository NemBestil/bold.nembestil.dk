import { describe, expect, it } from "vitest";
import {
  CONTROLLER_PREFERENCES_KEY,
  DEFAULT_CONTROLLER_PREFERENCES,
  loadControllerPreferences,
  saveControllerPreferences,
} from "../app/composables/useControllerPreferences";

function storage(raw: string | null = null) {
  const values = new Map<string, string>();
  if (raw !== null) values.set(CONTROLLER_PREFERENCES_KEY, raw);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("controller preferences", () => {
  it("uses the reversed horizontal direction by default and persists its schema", () => {
    const store = storage();
    expect(loadControllerPreferences(store)).toEqual({
      translationSensitivity: 1, rotationSensitivity: 1, inverted: true, goodGraphics: false,
    });
    expect(JSON.parse(store.getItem(CONTROLLER_PREFERENCES_KEY)!)).toEqual({
      schemaVersion: 2, translationSensitivity: 1, rotationSensitivity: 1, inverted: true, goodGraphics: false,
    });
  });

  it("migrates legacy auto-saved direction once while preserving sensitivity choices", () => {
    const store = storage(JSON.stringify({
      translationSensitivity: 1.7, rotationSensitivity: 2.1, inverted: false,
    }));
    const migrated = loadControllerPreferences(store);
    expect(migrated).toEqual({ translationSensitivity: 1.7, rotationSensitivity: 2.1, inverted: true, goodGraphics: false });
    migrated.inverted = false;
    saveControllerPreferences(store, migrated);
    expect(loadControllerPreferences(store)).toEqual({
      translationSensitivity: 1.7, rotationSensitivity: 2.1, inverted: false, goodGraphics: false,
    });
  });

  it.each([false, true])("retains an explicit current direction choice of %s after reload", (inverted) => {
    const store = storage();
    saveControllerPreferences(store, { translationSensitivity: 0.6, rotationSensitivity: 2.4, inverted, goodGraphics: true });
    expect(loadControllerPreferences(store)).toEqual({
      translationSensitivity: 0.6, rotationSensitivity: 2.4, inverted, goodGraphics: true,
    });
  });
  it.each([false, true])("remembers the device's explicit good graphics choice of %s across new sessions", goodGraphics => {
    const store = storage();
    const firstSession = loadControllerPreferences(store);
    firstSession.goodGraphics = goodGraphics;
    saveControllerPreferences(store, firstSession);
    const reopened = loadControllerPreferences(store);
    expect(reopened.goodGraphics).toBe(goodGraphics);
    reopened.goodGraphics = !goodGraphics;
    saveControllerPreferences(store, reopened);
    expect(loadControllerPreferences(store).goodGraphics).toBe(!goodGraphics);
  });

  it("clamps legacy sensitivities and ignores invalid fields during migration", () => {
    const store = storage(JSON.stringify({
      translationSensitivity: -100, rotationSensitivity: 10, inverted: "false",
    }));
    expect(loadControllerPreferences(store)).toEqual({
      translationSensitivity: 0.3, rotationSensitivity: 3, inverted: true, goodGraphics: false,
    });
    const invalid = storage(JSON.stringify({
      schemaVersion: 2, translationSensitivity: "2", rotationSensitivity: null, inverted: "false",
    }));
    expect(loadControllerPreferences(invalid)).toEqual(DEFAULT_CONTROLLER_PREFERENCES);
  });

  it.each(["broken json", "null", "[]", "42"])("recovers from malformed storage: %s", (raw) => {
    expect(loadControllerPreferences(storage(raw))).toEqual(DEFAULT_CONTROLLER_PREFERENCES);
  });

  it("keeps controls usable when browser storage is blocked", () => {
    const blocked = {
      getItem() { throw new Error("Storage blocked"); },
      setItem() { throw new Error("Storage blocked"); },
    };
    expect(loadControllerPreferences(blocked)).toEqual(DEFAULT_CONTROLLER_PREFERENCES);
    expect(() => saveControllerPreferences(blocked, { ...DEFAULT_CONTROLLER_PREFERENCES })).not.toThrow();
    const loaded = loadControllerPreferences(storage());
    loaded.inverted = false;
    expect(DEFAULT_CONTROLLER_PREFERENCES.inverted).toBe(true);
  });
});
