import { describe, expect, it } from "vitest";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import type { TableFrame } from "../shared/types";
import { TABLE_VIEW, controllerTouchZones, normalizedRodPosition, tableViewport } from "../app/components/controller/tableProjection";

function frame(): TableFrame {
  return {
    sequence: 1, time: 100, epoch: 1, phase: "playing",
    ball: { position: { x: 0.5, y: C.ball.radius, z: -0.3 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    rods: ROD_LAYOUT.map(() => ({ translation: 0, angle: 0 })),
    kits: {
      red: { primaryColor: "#de1234", secondaryColor: "#ffffff" },
      blue: { primaryColor: "#1267de", secondaryColor: "#dddddd" },
    },
  };
}

describe("live controller table", () => {
  it("gives each team exactly its own four touch areas in actual board order", () => {
    for (const team of ["red", "blue"] as const) {
      const zones = controllerTouchZones(team);
      expect(zones.map((zone) => zone.id)).toEqual(team === "red" ? [0, 1, 2, 3] : [3, 2, 1, 0]);
      expect(zones.every((zone) => ROD_LAYOUT[zone.index]!.team === team)).toBe(true);
      expect(zones[0]!.left).toBe(-TABLE_VIEW.halfLength);
      expect(zones.at(-1)!.right).toBe(TABLE_VIEW.halfLength);
      zones.forEach((zone, index) => {
        expect(zone.x).toBeGreaterThan(zone.left);
        expect(zone.x).toBeLessThan(zone.right);
        if (index) expect(zone.left).toBe(zones[index - 1]!.right);
      });
    }
  });

  it("fits every rail and both recessed goals in portrait and landscape", () => {
    for (const [width, height] of [[844, 270], [360, 600], [1512, 820]]) {
      const view = tableViewport(width!, height!);
      expect(view.left).toBeGreaterThanOrEqual(0);
      expect(view.top).toBeGreaterThanOrEqual(0);
      expect(view.left + view.width).toBeLessThanOrEqual(width!);
      expect(view.top + view.height + TABLE_VIEW.labelHeight).toBeLessThanOrEqual(height!);
      for (const x of [-C.table.goalBackX, C.table.goalBackX])
        expect(Math.abs(x * view.scale)).toBeLessThan(view.width / 2);
      expect(C.table.wallZ * view.scale).toBeLessThan(view.height / 2);
    }
  });

  it("normalizes each host rod using its own travel when a new finger lands", () => {
    const snapshot = frame();
    ROD_LAYOUT.forEach((rod, index) => {
      snapshot.rods[index]!.translation = rod.travel / 2;
      expect(normalizedRodPosition(snapshot, index)).toBeCloseTo(0.5);
    });
    snapshot.rods[0]!.translation = 3;
    expect(normalizedRodPosition(snapshot, 0)).toBe(1);
    expect(normalizedRodPosition(null, 0)).toBe(0);
  });

});
