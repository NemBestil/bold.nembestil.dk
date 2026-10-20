import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, type MatchSettings, type PlayerState } from "../shared/types";
import { canJoinTeam, canSetTeamControl, controlledRole, humanTeamCapacity, matchModeLabel, modeSettingsChange, phoneCountOptions, teamControlLabel, teamControlPatch } from "../app/utils/matchPresentation";
import { controllerTouchZones } from "../app/components/controller/tableProjection";
import { reactive } from "vue";

function player(id: string, team: PlayerState["team"], rodIds = [0, 1, 2, 3], computer = false): PlayerState {
  return { id, team, rodIds, computer, clubId: null, ready: false, connected: true, admin: false, rematch: false };
}
describe("multiplayer and computer presentation", () => {
  it("translates each presentation call independently and keeps Danish defaults compatible", () => {
    expect(controlledRole([0, 1], "en")).toBe("Defense · goalkeeper and defense");
    expect(controlledRole([0, 1], "tr")).toBe("Savunma · kaleci ve savunma");
    expect(controlledRole([0, 1])).toBe("Forsvar · målmand og forsvar");
    expect(teamControlLabel({ computer: "defense", level: "normal" }, "en")).toBe("Computer defense");
    expect(teamControlLabel({ computer: "defense", level: "normal" }, "tr")).toBe("Bilgisayar savunmada");
    const settings = { ...DEFAULT_SETTINGS, computerOpponent: "advanced" as const };
    expect(matchModeLabel(settings, "en")).toBe("2 phones vs computer · Advanced");
    expect(matchModeLabel(settings, "tr")).toBe("2 telefon bilgisayara karşı · İleri");
    expect(matchModeLabel(settings)).toBe("2 telefoner mod computer · Øvet");
  });
  it("keeps two-phone teams single-seat and allows either 2-v-1 arrangement with three phones", () => {
    expect(humanTeamCapacity(DEFAULT_SETTINGS, "red")).toBe(1);
    expect(canJoinTeam(DEFAULT_SETTINGS, [player("r", "red"), player("new", null)], "red", "new")).toBe(false);
    expect(canJoinTeam(DEFAULT_SETTINGS, [player("r", "red"), player("new", null)], "blue", "new")).toBe(true);
    const three = { ...DEFAULT_SETTINGS, playerCount: 3 as const };
    for (const team of ["red", "blue"] as const)
      expect(canJoinTeam(three, [player("first", team), player("new", null)], team, "new")).toBe(true);
    expect(canJoinTeam(three, [player("a", "red"), player("b", "red"), player("c", "blue"), player("new", null)], "blue", "new")).toBe(false);
  });

  it("shows computer capacity as human red seats and protects the blue side", () => {
    const settings = { ...DEFAULT_SETTINGS, playerCount: 2 as const, computerOpponent: "advanced" as const };
    const roster = [player("cpu", "blue", [0, 1, 2, 3], true), player("r", "red"), player("new", null)];
    expect(humanTeamCapacity(settings, "blue")).toBe(0);
    expect(canJoinTeam(settings, roster, "blue", "new")).toBe(false);
    expect(canJoinTeam(settings, roster, "red", "new")).toBe(true);
    expect(matchModeLabel(settings)).toBe("2 telefoner mod computer · Øvet");
  });

  it("defaults the first computer selection to solo and preserves enough seats for two existing phones", () => {
    expect(modeSettingsChange(DEFAULT_SETTINGS, true, 0)).toMatchObject({ playerCount: 1, computerOpponent: "normal", teamControls: { red: { computer: "off" }, blue: { computer: "full", level: "normal" } } });
    expect(modeSettingsChange(DEFAULT_SETTINGS, true, 1)).toMatchObject({ playerCount: 1, computerOpponent: "normal" });
    expect(modeSettingsChange(DEFAULT_SETTINGS, true, 2)).toMatchObject({ playerCount: 2, computerOpponent: "normal" });
    expect(modeSettingsChange({ ...DEFAULT_SETTINGS, playerCount: 1, computerOpponent: "normal" }, false)).toMatchObject({ playerCount: 2, computerOpponent: "off", teamControls: { red: { computer: "off" }, blue: { computer: "off" } } });
  });

  it("allows either color to be fully computer-controlled and offers only feasible phone counts", () => {
    const settings: MatchSettings = { ...DEFAULT_SETTINGS, teamControls: { red: { computer: "full", level: "advanced" }, blue: { computer: "off", level: "normal" } } };
    expect(humanTeamCapacity(settings, "red")).toBe(0);
    expect(humanTeamCapacity(settings, "blue")).toBe(2);
    expect(phoneCountOptions(settings)).toEqual([1, 2]);
    expect(canJoinTeam(settings, [player("new", null)], "red", "new")).toBe(false);
    expect(canJoinTeam(settings, [player("new", null)], "blue", "new")).toBe(true);
    const both: MatchSettings = { ...settings, playerCount: 0, teamControls: { red: { computer: "full", level: "advanced" }, blue: { computer: "full", level: "beginner" } } };
    expect(phoneCountOptions(both)).toEqual([0]);
    expect(matchModeLabel(both)).toBe("Computer mod computer");
  });

  it("keeps complementary human roles available in hybrid teams and creates plain canonical patches from reactive UI state", () => {
    const settings = reactive<MatchSettings>({ ...DEFAULT_SETTINGS, teamControls: { red: { computer: "defense", level: "advanced" }, blue: { computer: "attack", level: "beginner" } } });
    expect(phoneCountOptions(settings)).toEqual([2]);
    expect(humanTeamCapacity(settings, "red")).toBe(1);
    expect(humanTeamCapacity(settings, "blue")).toBe(1);
    expect(controllerTouchZones("red", [2, 3]).map((rod) => rod.id)).toEqual([2, 3]);
    expect(controllerTouchZones("blue", [0, 1]).map((rod) => rod.id)).toEqual([1, 0]);
    const patch = teamControlPatch(settings, "red", { computer: "full" });
    expect(patch).toMatchObject({ playerCount: 1, teamControls: { red: { computer: "full", level: "advanced" }, blue: { computer: "attack", level: "beginner" } } });
    expect(settings.teamControls!.red.computer).toBe("defense");
    expect(() => structuredClone(patch)).not.toThrow();
  });

  it("keeps CPU choices available when existing humans can move sides, but never removes their last available seat", () => {
    expect(canSetTeamControl(DEFAULT_SETTINGS, "red", "full", 2)).toBe(true);
    expect(canSetTeamControl({ ...DEFAULT_SETTINGS, playerCount: 4 }, "red", "defense", 3)).toBe(true);
    expect(canSetTeamControl({ ...DEFAULT_SETTINGS, playerCount: 4 }, "red", "defense", 4)).toBe(false);
    const solo: MatchSettings = { ...DEFAULT_SETTINGS, playerCount: 1, computerOpponent: "normal" };
    expect(canSetTeamControl(solo, "red", "full", 1)).toBe(false);
    expect(canSetTeamControl(solo, "red", "full", 0)).toBe(true);
  });

  it("only exposes each teammate's assigned rods without expanding into partner touch regions", () => {
    const defense = controllerTouchZones("red", [0, 1]);
    const attack = controllerTouchZones("red", [2, 3]);
    expect(defense.map((rod) => rod.id)).toEqual([0, 1]);
    expect(attack.map((rod) => rod.id)).toEqual([2, 3]);
    expect(defense.at(-1)!.right).toBe(attack[0]!.left);
    expect(controllerTouchZones("blue", [2, 3]).map((rod) => rod.id)).toEqual([3, 2]);
    expect(controlledRole([0, 1])).toContain("Forsvar");
    expect(controlledRole([2, 3])).toContain("Angreb");
    expect(controlledRole([0, 1, 2, 3])).toBe("Alle fire stænger");
  });
});
