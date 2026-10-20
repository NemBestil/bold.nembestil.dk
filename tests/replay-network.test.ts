import { describe, expect, it } from "vitest";
import type { ReplayState, TableFrame } from "../shared/types";
import { isServerMessage, isTableFrame } from "../network/MessageProtocol";
import { TableFrameBuffer } from "../network/TableFrameBuffer";

function frame(sequence: number, time: number, replay: ReplayState): TableFrame {
  return { sequence, time, epoch: 1, phase: "replay", replay,
    ball: { position: { x: sequence * 0.1, y: 0.04, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    rods: Array.from({ length: 8 }, () => ({ translation: 0, angle: 0 })),
    kits: { red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" }, blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" } } };
}
const replay: ReplayState = { progress: 0.5, slowMotion: true, remaining: 2, fade: 0.5, summary: true, goalIndex: 2, goalCount: 5 };

describe("replay cinematics over the table stream", () => {
  it("accepts bounded replay and montage metadata with the existing frame schema", () => {
    expect(isServerMessage({ type: "table-frame", frame: frame(1, 100, replay) })).toBe(true);
    expect(isTableFrame(frame(1, 100, { progress: 0, slowMotion: false }))).toBe(true);
    const legacy = frame(1, 100, replay);
    delete legacy.replay;
    expect(isTableFrame(legacy)).toBe(true);
  });
  it.each([
    { remaining: Infinity }, { remaining: 9 }, { fade: -0.1 }, { fade: 1.1 },
    { progress: NaN }, { goalIndex: 0 }, { goalIndex: 6 }, { goalCount: 20 },
    { goalIndex: 1.5 }, { summary: "yes" }, { url: "https://example.com" },
  ])("rejects invalid replay metadata %j", (patch) => {
    expect(isTableFrame(frame(1, 100, { ...replay, ...patch } as ReplayState))).toBe(false);
  });
  it("transports the full-match source clock, historical scores and goal effects without sharing mutable metadata", () => {
    const full: ReplayState = { progress: 0.5, slowMotion: false, fullMatch: true, mode: "full", playing: true, time: 60, duration: 120, scores: { red: 2, blue: 1 }, goalIndex: 3, goalCount: 5, goalTeam: "red" };
    expect(isTableFrame(frame(1, 100, full))).toBe(true);
    const buffer = new TableFrameBuffer();
    buffer.push(frame(1, 100, full), 1_000);
    buffer.push(frame(2, 200, { ...full, time: 61 }), 1_100);
    full.scores!.red = 8;
    const shown = buffer.sample(1_095)!;
    expect(shown.replay!.time).toBeCloseTo(60.55);
    expect(shown.replay!.scores).toEqual({ red: 2, blue: 1 });
    shown.replay!.scores!.red = 9;
    expect(buffer.sample(1_095)!.replay!.scores!.red).toBe(2);
    for (const patch of [{ time: 121 }, { duration: -1 }, { mode: "unknown" }, { playing: 1 }, { scores: { red: 2.5, blue: 1 } }, { goalTeam: "other" }, { goalIndex: undefined }])
      expect(isTableFrame(frame(3, 300, { ...full, ...patch } as ReplayState))).toBe(false);
  });
  it("interpolates the fade and final zoom clock with the displayed pose and copies metadata", () => {
    const buffer = new TableFrameBuffer();
    const first = frame(1, 100, { ...replay, progress: 0.5, remaining: 2, fade: 0 });
    const second = frame(2, 200, { ...replay, progress: 0.75, remaining: 1, fade: 1 });
    buffer.push(first, 1_000);
    buffer.push(second, 1_100);
    first.replay!.fade = 0.8;
    second.replay!.remaining = 0;
    const shown = buffer.sample(1_095)!;
    expect(shown.ball.position.x).toBeCloseTo(0.155);
    expect(shown.replay!.progress).toBeCloseTo(0.6375);
    expect(shown.replay!.remaining).toBeCloseTo(1.45);
    expect(shown.replay!.fade).toBeCloseTo(0.55);
    shown.replay!.fade = 0;
    expect(buffer.sample(1_095)!.replay!.fade).toBeCloseTo(0.55);
  });
  it("cuts to the next archived goal without interpolating positions or fading across its boundary", () => {
    const buffer = new TableFrameBuffer();
    buffer.push(frame(1, 100, { ...replay, goalIndex: 1, fade: 1 }), 1_000);
    buffer.push(frame(2, 200, { ...replay, goalIndex: 2, progress: 0, remaining: 8, fade: 1 }), 1_100);
    const shown = buffer.sample(1_100)!;
    expect(shown.ball.position.x).toBe(0.2);
    expect(shown.replay!.goalIndex).toBe(2);
    expect(shown.replay!.remaining).toBe(8);
  });
});
