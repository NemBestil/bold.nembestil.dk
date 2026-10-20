import { describe, expect, it } from "vitest";
import { ControllerPrediction } from "../network/ControllerPrediction";
import { CONTROLLER_FRAME_BUFFER_OPTIONS, TableFrameBuffer } from "../network/TableFrameBuffer";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import type { TableFrame } from "../shared/types";

function frame(time = 0): TableFrame {
  return {
    sequence: Math.round(time * 10), time, epoch: 1, phase: "playing",
    ball: { position: { x: 0, y: C.ball.radius, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    rods: ROD_LAYOUT.map(() => ({ translation: 0, angle: 0 })),
    kits: { red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" }, blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" } },
  };
}
const input = { rodId: 3, translation: 1, angularVelocity: 10, active: true };

describe("controller visual prediction", () => {
  it.each([-1, 1])("brakes a held downward stroke locally in direction %i without predicting the ball", (side) => {
    const prediction = new ControllerPrediction();
    const host = (time: number) => {
      const pose = frame(time);
      pose.ball.position = { x: ROD_LAYOUT[5]!.x + side * 0.1, y: C.ball.radius, z: 0 };
      pose.rods[5]!.angle = time === 0 ? side : -side * 2;
      return pose;
    };
    prediction.sample(host(0), 0, 1.5);
    let firstBlocked = 0;
    for (let tick = 1; tick <= 60; tick++) {
      const time = tick * 1000 / 60;
      prediction.input("red", [3], { rodId: 3, translation: 0, angularVelocity: -side * 35, active: true }, time);
      const source = host(time);
      const shown = prediction.sample(source, time, 1.5)!;
      expect(shown.ball).toEqual(source.ball);
      if (tick === 30) firstBlocked = shown.rods[5]!.angle;
    }
    const blocked = prediction.currentFrame!.rods[5]!.angle;
    expect(blocked * side).toBeGreaterThan(0.1);
    expect(blocked * side).toBeLessThan(1);
    expect(blocked).toBeCloseTo(firstBlocked, 4);
    // Reversing the player's own input retracts the foot immediately.
    for (let tick = 61; tick <= 72; tick++) {
      const time = tick * 1000 / 60;
      prediction.input("red", [3], { rodId: 3, translation: 0, angularVelocity: side * 20, active: true }, time);
      prediction.sample(host(time), time, 1.5);
    }
    expect((prediction.currentFrame!.rods[5]!.angle - blocked) * side).toBeGreaterThan(0.2);
  });

  it.each([30, 60, 120])("moves held rods locally at %i fps and ignores conflicting host poses until release", (fps) => {
    const prediction = new ControllerPrediction();
    prediction.sample(frame(), 0, 1.5);
    for (let tick = 1; tick <= fps / 5; tick++) {
      const time = tick * 1000 / fps;
      prediction.input("red", [3], input, time);
      const host = frame(time);
      host.rods[5]!.translation = -0.1;
      const result = prediction.sample(host, time, 1.5)!;
      expect(result.rods[5]!.translation).toBeGreaterThan(0);
      expect(result.rods[5]!.angle).toBeGreaterThan(0);
      expect(host.rods[5]!.translation).toBe(-0.1);
      expect(result.rods[2]).toEqual(host.rods[2]);
    }
    expect(prediction.currentFrame!.rods[5]!.translation).toBeCloseTo(ROD_LAYOUT[5]!.travel);
    prediction.input("red", [3], { ...input, active: false }, 200);
    const released = prediction.sample(frame(216), 216, 1.5)!;
    expect(released.rods[5]!.translation).toBeGreaterThan(0);
    const positions: number[] = [];
    for (let time = 232; time <= 600; time += 16) {
      const pose = prediction.sample(frame(time), time, 1.5)!;
      if (time >= 384) positions.push(pose.rods[5]!.translation);
    }
    expect(positions.at(-1)).toBeCloseTo(0, 3);
    expect(positions[1]).toBeGreaterThan(0);
    expect(positions[1]).toBeLessThan(positions[0]!);
  });

  it("keeps local prediction limited to the player's owned rods", () => {
    const prediction = new ControllerPrediction();
    prediction.sample(frame(), 0, 1.5);
    prediction.input("red", [0], input, 0);
    expect(prediction.sample(frame(16), 16, 1.5)!.rods[5]).toEqual({ translation: 0, angle: 0 });
  });

  it("waits for the measured round trip before reconciling a released rod", () => {
    const quick = new ControllerPrediction(), delayed = new ControllerPrediction();
    for (const prediction of [quick, delayed]) {
      prediction.sample(frame(), 0, 1.5);
      prediction.input("red", [3], input, 0);
      prediction.sample(frame(16), 16, 1.5);
      prediction.input("red", [3], { ...input, active: false }, 16);
    }
    for (let time = 32; time <= 208; time += 16) {
      quick.sample(frame(time), time, 1.5, true, 0);
      delayed.sample(frame(time), time, 1.5, true, 200);
    }
    expect(quick.currentFrame!.rods[5]!.translation).toBeLessThan(0.005);
    expect(delayed.currentFrame!.rods[5]!.translation).toBeGreaterThan(0.1);
  });

  it("never predicts a ball strike and copies host position and rotation exactly", () => {
    const prediction = new ControllerPrediction();
    const host = (time: number) => {
      const value = frame(time);
      value.rods[5]!.angle = -0.35;
      value.ball.position.x = 0.7;
      return value;
    };
    prediction.sample(host(0), 0, 1.5);
    for (let time = 16; time <= 112; time += 16) {
      prediction.input("red", [3], { ...input, translation: 0, angularVelocity: 20 }, time);
      const original = host(time);
      expect(prediction.sample(original, time, 1.5)!.ball).toEqual(original.ball);
    }
    expect(prediction.currentFrame!.rods[5]!.angle).toBeGreaterThan(-0.35);
    const original = host(128);
    original.ball.position = { x: -0.4, y: 0.2, z: 0.3 };
    original.ball.rotation = { x: 0, y: 0, z: 1, w: 0 };
    prediction.input("red", [3], { ...input, translation: 0, active: false }, 112);
    const next = prediction.sample(original, 128, 1.5)!;
    expect(next.ball).toEqual(original.ball);
    next.ball.position.x = 9;
    next.ball.rotation.w = 1;
    expect(original.ball.position.x).toBe(-0.4);
    expect(original.ball.rotation.w).toBe(0);
  });

  it("holds the last ball pose between packets while owned rods keep moving", () => {
    const prediction = new ControllerPrediction();
    const host = frame();
    prediction.sample(host, 0, 1.5);
    for (let time = 16; time <= 160; time += 16) {
      prediction.input("red", [3], input, time);
      expect(prediction.sample(host, time, 1.5)!.ball).toEqual(host.ball);
    }
    expect(prediction.currentFrame!.rods[5]!.angle).toBeGreaterThan(0);
  });

  it.each(["paused", "replay", "epoch", "disconnected", "gap"])("clears predictions on %s", (change) => {
    const prediction = new ControllerPrediction();
    prediction.sample(frame(), 0, 1.5);
    prediction.input("red", [3], input, 0);
    prediction.sample(frame(16), 16, 1.5);
    const next = frame(32);
    if (change === "paused" || change === "replay") next.phase = change;
    if (change === "epoch") next.epoch++;
    const now = change === "gap" ? 500 : 32;
    expect(prediction.sample(next, now, 1.5, change !== "disconnected")!.rods).toEqual(next.rods);
    expect(prediction.sample(frame(now + 16), now + 16, 1.5)!.rods[5]!.translation).toBe(0);
  });
});

describe("controller playback under jitter", () => {
  it("plays ball and remote rods on one host timeline while a held rod responds locally", () => {
    const buffer = new TableFrameBuffer(CONTROLLER_FRAME_BUFFER_OPTIONS);
    const prediction = new ControllerPrediction();
    const first = frame(0), second = frame(1000 / 60), third = frame(2000 / 60);
    second.ball.position.x = 0.1;
    third.ball.position.x = 0.2;
    second.rods[2]!.angle = 0.4;
    third.rods[2]!.angle = 0.8;
    buffer.push(first, 10);
    prediction.sample(buffer.sample(10), 10, 1.5);
    prediction.input("red", [3], input, 10);
    buffer.push(second, 10 + 1000 / 60);
    buffer.push(third, 10 + 2000 / 60);
    const result = prediction.sample(buffer.sample(10 + 2000 / 60), 10 + 2000 / 60, 1.5)!;
    expect(result.ball.position.x).toBeCloseTo(0.05);
    expect(result.rods[2]!.angle).toBeCloseTo(0.2);
    expect(result.rods[5]!.translation).toBeGreaterThan(0);
    expect(third.rods[5]!.translation).toBe(0);
    // Missing network frames hold the last host pose instead of inventing a flight.
    expect(prediction.sample(buffer.sample(250), 250, 1.5)!.ball.position.x).toBe(0.2);
  });

  it("keeps rods smooth but the ball unfiltered despite alternating packet delays", () => {
    const buffer = new TableFrameBuffer({ smoothClock: true, interpolationDelay: 65, interpolateBall: false });
    const packets = Array.from({ length: 35 }, (_, index) => {
      const value = frame(index * 1000 / 30);
      value.sequence = index;
      value.ball.position.x = value.time / 1000;
      value.rods[0]!.translation = value.time / 1000;
      return { value, arrival: value.time + (index % 2 ? 25 : 5) };
    });
    let nextPacket = 0;
    let previous = 0;
    const increments: number[] = [];
    for (let now = 0; now <= 1000; now += 1000 / 60) {
      while (nextPacket < packets.length && packets[nextPacket]!.arrival <= now) {
        const packet = packets[nextPacket++]!;
        buffer.push(packet.value, packet.arrival);
      }
      const pose = buffer.sample(now);
      if (pose && now > 200) increments.push(pose.rods[0]!.translation - previous);
      if (pose) {
        previous = pose.rods[0]!.translation;
        expect(pose.ball).toEqual(packets[nextPacket - 1]!.value.ball);
      }
    }
    expect(Math.min(...increments)).toBeGreaterThan(0.013);
    expect(Math.max(...increments)).toBeLessThan(0.02);
    expect(buffer.isStale(1500)).toBe(true);
  });

  it.each(["playing", "replay"] as const)("uses the latest exact ball pose while rods are buffered during %s", (phase) => {
    const buffer = new TableFrameBuffer({ interpolationDelay: 65, interpolateBall: false });
    const before = frame(1000), after = frame(1050);
    before.phase = after.phase = phase;
    after.ball.position = { x: 0.6, y: 0.12, z: -0.4 };
    after.ball.rotation = { x: 0, y: 0, z: 1, w: 0 };
    after.rods[0] = { translation: 0.2, angle: 2 };
    buffer.push(before, 1000);
    buffer.push(after, 1050);
    for (const now of [1050, 1070, 1200]) expect(buffer.sample(now)!.ball).toEqual(after.ball);
    const between = buffer.sample(1070)!;
    expect(between.rods[0]!.angle).toBeGreaterThan(0);
    expect(between.rods[0]!.angle).toBeLessThan(2);
    between.ball.rotation.w = 1;
    expect(buffer.sample(1070)!.ball.rotation.w).toBe(0);
  });
});
