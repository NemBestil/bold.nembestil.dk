import { describe, expect, it } from "vitest";
import { createLanguageDetection } from "../app/utils/languageDetection";

describe("initial device language and explicit selection", () => {
  it.each(["en", "da"])("keeps the later explicit %s choice after a slow automatic Turkish load", async choice => {
    let finishLoading!: () => void;
    const loading = new Promise<void>(resolve => { finishLoading = resolve; });
    let locale = "en";
    const detection = createLanguageDetection(async () => {
      await loading;
      locale = "tr";
    });
    const automatic = detection.run();
    const explicit = (async () => {
      await detection.ready;
      locale = choice;
    })();
    await Promise.resolve();
    expect(locale).toBe("en");
    finishLoading();
    await Promise.all([automatic, explicit]);
    expect(locale).toBe(choice);
  });

  it("unblocks explicit switching when automatic detection rejects", async () => {
    const detection = createLanguageDetection(async () => { throw new Error("Locale asset unavailable"); });
    let locale = "en";
    const explicit = (async () => { await detection.ready; locale = "da"; })();
    await detection.run();
    await explicit;
    expect(locale).toBe("da");
  });

  it("only runs initial detection once even if initialization is requested twice", async () => {
    let calls = 0, finishLoading!: () => void;
    const loading = new Promise<void>(resolve => { finishLoading = resolve; });
    const detection = createLanguageDetection(async () => { calls++; await loading; });
    const first = detection.run(), second = detection.run();
    expect(calls).toBe(1);
    finishLoading();
    await Promise.all([first, second, detection.ready]);
    await detection.run();
    expect(calls).toBe(1);
  });
});
