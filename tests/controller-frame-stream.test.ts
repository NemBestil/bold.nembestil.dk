import { describe, expect, it, vi } from "vitest";
import { effect, ref, stop } from "vue";
import { ControllerFrameStream } from "../network/ControllerFrameStream";
import { TableFrameBuffer } from "../network/TableFrameBuffer";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import type { TableFrame } from "../shared/types";

function frame(sequence = 1): TableFrame {
  return {
    sequence, time: sequence * 1000 / 60, epoch: 1, phase: "playing",
    ball: { position: { x: 0, y: C.ball.radius, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    rods: ROD_LAYOUT.map(() => ({ translation: 0, angle: 0 })),
    kits: { red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" }, blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" } },
  };
}

describe("controller frame stream", () => {
  it("delivers every arriving snapshot synchronously to active views", () => {
    const stream = new ControllerFrameStream();
    const first = vi.fn(), second = vi.fn();
    stream.subscribe(first);
    stream.subscribe(second);
    expect(first).toHaveBeenLastCalledWith(null, 0);
    const poses = [frame(1), frame(2), frame(3)];
    for (const pose of poses) {
      stream.push(pose, pose.time + 10);
      expect(stream.latest).toBe(pose);
      expect(first).toHaveBeenLastCalledWith(pose, pose.time + 10);
      expect(second).toHaveBeenLastCalledWith(pose, pose.time + 10);
    }
    expect(first).toHaveBeenCalledTimes(4);
    expect(second).toHaveBeenCalledTimes(4);
  });

  it("retains the receipt time when a view mounts after the snapshot arrived", () => {
    const stream = new ControllerFrameStream();
    const buffer = new TableFrameBuffer();
    const pose = frame();
    stream.push(pose, 100);
    stream.subscribe((next, arrival) => { if (next) buffer.push(next, arrival); });
    expect(buffer.sample(200)?.ball).toEqual(pose.ball);
    expect(buffer.isStale(601)).toBe(true);
  });

  it("unsubscribes a removed view without affecting the next mounted view", () => {
    const stream = new ControllerFrameStream();
    const removed = vi.fn();
    const unsubscribe = stream.subscribe(removed);
    stream.push(frame(1), 20);
    unsubscribe();
    unsubscribe();
    stream.push(frame(2), 40);
    const mounted = vi.fn();
    stream.subscribe(mounted);
    expect(removed).toHaveBeenCalledTimes(2);
    expect(mounted).toHaveBeenLastCalledWith(stream.latest, 40);
    stream.clear();
    expect(removed).toHaveBeenCalledTimes(2);
    expect(mounted).toHaveBeenLastCalledWith(null, 0);
  });

  it("clears both the retained pose and a view's buffer on disconnect before reconnecting", () => {
    const stream = new ControllerFrameStream();
    const buffer = new TableFrameBuffer();
    stream.subscribe((next, arrival) => {
      if (next) buffer.push(next, arrival);
      else buffer.clear();
    });
    stream.push(frame(20), 100);
    expect(buffer.sample(100)).not.toBeNull();
    stream.clear();
    expect(stream.latest).toBeNull();
    expect(buffer.sample(100)).toBeNull();
    expect(buffer.isStale(100)).toBe(true);
    const lateView = vi.fn();
    stream.subscribe(lateView);
    expect(lateView).toHaveBeenLastCalledWith(null, 0);
    // A new host connection can start its sequence again after the clear.
    const reconnected = frame(1);
    stream.push(reconnected, 200);
    expect(buffer.sample(200)?.sequence).toBe(1);
    expect(lateView).toHaveBeenLastCalledWith(reconnected, 200);
  });

  it("only invalidates reactive availability at connection transitions, not at snapshot frequency", () => {
    const stream = new ControllerFrameStream();
    const hasFrame = ref(false);
    const availability: boolean[] = [];
    const observer = effect(() => { availability.push(hasFrame.value); });
    const unsubscribe = stream.subscribe((next) => { hasFrame.value = !!next; });
    for (let sequence = 1; sequence <= 120; sequence++) stream.push(frame(sequence), sequence * 1000 / 60);
    expect(availability).toEqual([false, true]);
    stream.clear();
    stream.clear();
    expect(availability).toEqual([false, true, false]);
    unsubscribe();
    stop(observer);
  });
});
