import { readFileSync, readdirSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { normalizeGameLocale, translateGameText } from "../shared/runtimeMessages";

const readSource = (path: string) => {
  const raw = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const script = path.endsWith(".vue") ? /<script setup[^>]*>([\s\S]*?)<\/script>/u.exec(raw)?.[1] ?? "" : raw;
  return ts.createSourceFile(path, script, ts.ScriptTarget.Latest, true);
};

describe("per-device runtime language", () => {
  it.each([
    [undefined, "en"], ["", "en"], ["en-US", "en"], ["fr", "en"], ["de-DE", "en"],
    ["da", "da"], ["DA-dk", "da"], ["tr", "tr"], ["tr-TR", "tr"], ["TR_tr", "tr"],
  ])("normalizes %s with an English unsupported-language fallback", (input, expected) => {
    expect(normalizeGameLocale(input)).toBe(expected);
  });

  it("renders the same canonical wire notice independently for every screen and after language changes", () => {
    const notice = "Kampen er sat på pause";
    const wire = Object.freeze({ notice });
    expect(translateGameText(wire.notice, "en")).toBe("The match is paused");
    expect(translateGameText(wire.notice, "tr")).toBe("Maç duraklatıldı");
    expect(translateGameText(wire.notice, "da")).toBe(notice);
    expect(translateGameText(wire.notice, "en")).toBe("The match is paused");
    expect(translateGameText(wire.notice, "unsupported")).toBe("The match is paused");
    expect(wire.notice).toBe(notice);
  });

  it("uses readable translated transport status labels without changing raw status codes", () => {
    expect(translateGameText("connecting", "da")).toBe("Forbinder…");
    expect(translateGameText("reconnecting", "en")).toBe("Reconnecting…");
    expect(translateGameText("connected", "tr")).toBe("Bağlandı");
    expect(translateGameText("error", "tr")).toBe("Bağlantı hatası");
  });

  it.each(["Kampen er sat på pause", "Rødt hold & venner", "Vi vinder sammen", "Øvet boldklub ⚽", "A (B)!"])("preserves the complete custom team name %s inside goals and results", name => {
    expect(translateGameText(`Mål til ${name}!`, "en")).toBe(`Goal for ${name}!`);
    expect(translateGameText(`Mål til ${name}!`, "tr")).toBe(`${name} gol attı!`);
    expect(translateGameText(`${name} vinder!`, "en")).toBe(`${name} wins!`);
    expect(translateGameText(`${name} vinder!`, "tr")).toBe(`${name} kazandı!`);
    expect(translateGameText(`Mål til ${name}!`, "da")).toBe(`Mål til ${name}!`);
  });

  it("preserves ambiguous legacy messages instead of translating part of a custom name", () => {
    // These strings can each describe either a goal or a winning custom name.
    for (const notice of ["Mål til Blå? vinder!", "Mål til Lag vinder!"]) {
      expect(translateGameText(notice, "en")).toBe(notice);
      expect(translateGameText(notice, "tr")).toBe(notice);
    }
  });

  it("only translates anchored complete patterns and preserves unknown technical diagnostics", () => {
    for (const text of ["WebGL context lost (0x0001)", "Log: Mål til Lag! (debug)", "Lag vinder! extra", "__proto__", ""]) {
      expect(translateGameText(text, "en")).toBe(text);
      expect(translateGameText(text, "tr")).toBe(text);
      expect(translateGameText(text, "da")).toBe(text);
    }
  });

  it("translates all generated presentation counts, computer levels and shared-control labels", () => {
    for (const count of [0, 1, 2, 3, 4]) {
      expect(translateGameText(`${count} stænger`, "en")).toBe(`${count} ${count === 1 ? "rod" : "rods"}`);
      expect(translateGameText(`${count} stænger`, "tr")).toBe(`${count} çubuk`);
      expect(translateGameText(`${count} telefoner`, "en")).toBe(`${count} ${count === 1 ? "phone" : "phones"}`);
      expect(translateGameText(`${count} telefoner`, "tr")).toBe(`${count} telefon`);
      const phone = count === 1 ? "telefon" : "telefoner";
      for (const level of ["Begynder", "Almindelig", "Øvet"]) {
        const text = `${count} ${phone} mod computer · ${level}`;
        expect(translateGameText(text, "en")).toBe(`${count} ${count === 1 ? "phone" : "phones"} vs computer · ${translateGameText(level, "en")}`);
        expect(translateGameText(text, "tr")).toBe(`${count} telefon bilgisayara karşı · ${translateGameText(level, "tr")}`);
      }
      expect(translateGameText(`${count} ${phone} · delt med computer`, "en")).toBe(`${count} ${count === 1 ? "phone" : "phones"} · shared with computer`);
      expect(translateGameText(`${count} ${phone} · delt med computer`, "tr")).toBe(`${count} telefon · bilgisayarla paylaşılıyor`);
    }
  });

  it("translates complete fullscreen fallback combinations without leaving a Danish suffix", () => {
    const iphone = "På iPhone kan du vælge Del → Tilføj til hjemmeskærm og åbne Nem Bold derfra for fuldskærm.";
    for (const prefix of ["Browseren understøtter ikke fuldskærm her.", "Fuldskærm kunne ikke aktiveres. Prøv fuldskærmsikonet igen."]) {
      for (const locale of ["en", "tr"] as const) {
        expect(translateGameText(`${prefix} ${iphone}`, locale)).toBe(`${translateGameText(prefix, locale)} ${translateGameText(iphone, locale)}`);
        expect(translateGameText(`${prefix} ${iphone}`, locale)).not.toContain("fuldskærm");
      }
    }
  });
});

describe("runtime source translation coverage", () => {
  it("covers every canonical runtime sentence in network, engine and both presentation helpers", () => {
    const files = [
      ...readdirSync(new URL("../network", import.meta.url)).filter(file => file.endsWith(".ts")).map(file => `network/${file}`),
      "game/GameEngine.ts", "shared/replayFile.ts", "app/utils/matchPresentation.ts", "app/composables/useControllerFullscreen.ts",
      "app/components/ControllerSession.vue", "app/components/DesktopTable.vue", "app/components/PhoneHost.vue",
      "app/components/host/ReplayDownload.vue", "app/pages/replay.vue",
    ];
    const missing: string[] = [];
    const protocolLiterals = new Set(["POST", "X-Nemfuss-Turn", "NFC"]);
    for (const path of files) {
      const source = readSource(path);
      function visit(node: ts.Node) {
        if (ts.isStringLiteralLike(node) && /^[A-ZÆØÅ]/u.test(node.text) && !protocolLiterals.has(node.text)) {
          for (const locale of ["en", "tr"] as const)
            if (translateGameText(node.text, locale) === node.text && !(locale === "en" && node.text === "Computer")) missing.push(`${path}: ${locale}: ${node.text}`);
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    expect(missing).toEqual([]);
  });

  it("covers every replay validation detail at its actual call site", () => {
    const source = readSource("shared/replayFile.ts");
    const labelArguments = { invalid: 0, object: 2, number: 3, integer: 3, choice: 2, plainText: 2 } as const;
    const labels = new Set<string>();
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && Object.hasOwn(labelArguments, node.expression.text)) {
        const index = labelArguments[node.expression.text as keyof typeof labelArguments];
        const label = node.arguments[index];
        if (label && ts.isStringLiteral(label)) labels.add(label.text);
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    expect(labels.size).toBeGreaterThan(35);
    for (const label of labels) {
      const canonical = `Replayfilen er ugyldig (${label}).`;
      const en = translateGameText(canonical, "en"), tr = translateGameText(canonical, "tr");
      expect(en, label).toMatch(/^The replay file is invalid \(.+\)\.$/u);
      expect(tr, label).toMatch(/^Tekrar dosyası geçersiz \(.+\)\.$/u);
      expect(translateGameText(canonical, "da")).toBe(canonical);
    }
    expect(translateGameText("Replayfilen er ugyldig (målstilling).", "en")).toBe("The replay file is invalid (score).");
    expect(translateGameText("Replayfilen er ugyldig (målstilling).", "tr")).toBe("Tekrar dosyası geçersiz (skor).");
    expect(translateGameText("Replayfilen er ugyldig (unknown detail).", "en")).toBe("The replay file is invalid.");
  });
});
