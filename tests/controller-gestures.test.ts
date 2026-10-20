import { describe, expect, it } from "vitest";
import { ControllerGestureTracker } from "../app/utils/controllerGestures";
import { DEFAULT_CONTROLLER_PREFERENCES } from "../app/composables/useControllerPreferences";
import { ROD_LAYOUT } from "../game/GameConfig";

const own = ROD_LAYOUT.filter((rod) => rod.team === "red").map((rod) => ({ id: rod.id, x: rod.x, translation: 0.3 }));
const point = (x: number, z: number, time: number) => ({ x, z, time, pixelX: x * 200 });
const prefs = { ...DEFAULT_CONTROLLER_PREFERENCES };

describe("swipes across controlled rods", () => {
  it("captures a complete fast swipe without a move event and only kicks unoccupied assigned rods", () => {
    const tracker = new ControllerGestureTracker();
    tracker.start(1, point(-1.4, 0, 0), 0);
    const hits = tracker.finish(1, point(1, 0, 8), own, new Set([1]), prefs);
    expect(hits.map((hit) => hit.rodId)).toEqual([2, 3]);
    expect(hits.every((hit) => hit.flick && hit.rotationOnly && !hit.active && hit.angularVelocity === -35 && hit.translation === 0.3)).toBe(true);
    const split = new ControllerGestureTracker();
    split.start(2, point(-1.4, 0, 0));
    expect(split.finish(2, point(1.4, 0, 8), own.filter((rod) => rod.id < 2), new Set(), prefs).map((hit) => hit.rodId)).toEqual([0, 1]);
  });

  it("hits each rod once per gesture even when the finger crosses it again", () => {
    const tracker = new ControllerGestureTracker();
    tracker.start(1, point(-1.4, 0, 0), 0);
    tracker.move(1, point(1.4, 0, 8), own, new Set(), prefs);
    tracker.move(1, point(-1.4, 0, 16), own, new Set(), prefs);
    expect(tracker.finish(1, point(-1.4, 0, 20), own, new Set(), prefs).map((hit) => hit.rodId)).toEqual([1, 2, 3]);
  });

  it("never kicks from a cancelled or abandoned gesture, or after a long hold", () => {
    const tracker = new ControllerGestureTracker();
    tracker.start(1, point(-1.4, 0, 0));
    tracker.move(1, point(1.4, 0, 8), own, new Set(), prefs);
    tracker.cancel(1);
    expect(tracker.finish(1, point(1.4, 0, 9), own, new Set(), prefs)).toEqual([]);
    tracker.start(2, point(-1.4, 0, 0));
    tracker.move(2, point(1.4, 0, 8), own, new Set(), prefs);
    expect(tracker.finish(2, point(1.4, 0, 250), own, new Set(), prefs)).toEqual([]);
    tracker.start(3, point(-1.4, 0, 0));
    tracker.move(3, point(1.4, 0, 8), own, new Set(), prefs);
    tracker.clear();
    expect(tracker.finish(3, point(1.4, 0, 9), own, new Set(), prefs)).toEqual([]);
  });

  it("checks ownership and finger occupancy again at release", () => {
    const tracker = new ControllerGestureTracker();
    tracker.start(1, point(-1.4, 0, 0));
    tracker.move(1, point(1.4, 0, 8), own, new Set(), prefs);
    expect(tracker.finish(1, point(1.4, 0, 10), own.filter((rod) => rod.id >= 2), new Set([3]), prefs).map((hit) => hit.rodId)).toEqual([2]);
  });

  it("requires a fast crossing inside the pitch and preserves inversion only on X", () => {
    const outside = new ControllerGestureTracker();
    outside.start(1, point(-1.4, 0.76, 0));
    expect(outside.finish(1, point(1.4, 0.76, 8), own, new Set(), prefs)).toEqual([]);
    const slow = new ControllerGestureTracker();
    slow.start(1, point(-1.4, 0, 0));
    expect(slow.finish(1, point(1.4, 0, 10_000), own, new Set(), prefs)).toEqual([]);
    const normal = new ControllerGestureTracker();
    normal.start(1, point(-1.4, -0.3, 0));
    const hits = normal.finish(1, point(1.4, 0.3, 8), own, new Set(), { ...prefs, inverted: false });
    expect(hits).toHaveLength(4);
    expect(hits.every((hit) => hit.angularVelocity === 35)).toBe(true);
  });
});
