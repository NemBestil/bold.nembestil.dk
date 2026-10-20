import { afterEach, describe, expect, it, vi } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { GameLoop } from "../game/GameLoop";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("independent rendering and physics rates", () => {
  it.each([30, 60])("draws at %i fps on a 120 Hz screen while retaining 120 Hz physics", (fps) => {
    let nextFrame: FrameRequestCallback;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      nextFrame = callback;
      return 1;
    });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const step = vi.fn();
    const render = vi.fn();
    const loop = new GameLoop(step, render, fps);
    loop.start();
    for (let frame = 1; frame <= 120; frame++) nextFrame!(frame * 1000 / 120);
    expect(render).toHaveBeenCalledTimes(fps);
    expect(step.mock.calls.length).toBeGreaterThanOrEqual(119);
    expect(step.mock.calls.length).toBeLessThanOrEqual(120);
    expect(step.mock.calls.every(([dt]) => dt === C.physics.timestep)).toBe(true);
    expect(render.mock.calls.slice(1).every(([dt]) => Math.abs(dt - 1 / fps) < 1e-9)).toBe(true);
    loop.dispose();
    expect(cancel).toHaveBeenCalledWith(1);
  });

  it.each([60, 90, 120, 144].flatMap((hz) => [30, 60].map((fps) => ({ hz, fps }))))(
    "retains $fps fps across a $hz Hz screen without discarding render cadence",
    ({ hz, fps }) => {
      let nextFrame: FrameRequestCallback;
      let now = 10_000;
      const start = now;
      const draws: { at: number; dt: number }[] = [];
      vi.spyOn(performance, "now").mockImplementation(() => now);
      vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
      vi.stubGlobal("cancelAnimationFrame", vi.fn());
      const step = vi.fn();
      const loop = new GameLoop(step, (dt) => { draws.push({ at: now, dt }); }, fps);
      loop.start();
      for (let frame = 1; frame <= hz * 3; frame++) {
        now = start + frame * 1000 / hz;
        nextFrame!(now);
      }
      expect(draws).toHaveLength(fps * 3);
      expect(step.mock.calls.length).toBeGreaterThanOrEqual(359);
      expect(step.mock.calls.length).toBeLessThanOrEqual(360);
      expect(step.mock.calls.every(([dt]) => dt === C.physics.timestep)).toBe(true);
      for (let index = 0; index < draws.length; index++) {
        const draw = draws[index]!;
        const previous = draws[index - 1]?.at ?? start;
        // Animation time comes from actual display frames, not the ideal deadline.
        expect(draw.dt).toBeCloseTo((draw.at - previous) / 1000, 10);
        expect(draw.dt).toBeGreaterThan(0);
        expect(draw.dt * 1000).toBeLessThanOrEqual(1000 / fps + 1000 / hz + 1e-8);
      }
      expect(draws.reduce((total, draw) => total + draw.dt, 0)).toBeCloseTo(3, 8);
      loop.dispose();
    },
  );

  it("skips missed render deadlines after a long pause and bounds physics catch-up", () => {
    let nextFrame: FrameRequestCallback;
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const step = vi.fn(), render = vi.fn();
    const loop = new GameLoop(step, render, 60);
    loop.start();
    nextFrame!(1000 / 60);
    const physicsBeforePause = step.mock.calls.length;
    const resumed = 5000 + 1000 / 60;
    nextFrame!(resumed);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith(C.physics.maxFrameTime);
    expect(step.mock.calls.length - physicsBeforePause).toBeLessThanOrEqual(C.physics.maxSteps);
    // A late tick skips its old deadlines instead of spending subsequent frames catching up.
    for (const elapsed of [1, 2, 4, 8]) nextFrame!(resumed + elapsed);
    expect(render).toHaveBeenCalledTimes(2);
    nextFrame!(resumed + 1000 / 60);
    expect(render).toHaveBeenCalledTimes(3);
    expect(render).toHaveBeenLastCalledWith(expect.closeTo(1 / 60, 10));
    loop.dispose();
  });

  it("starts from the current clock and resets the baseline when restarted", () => {
    let nextFrame: FrameRequestCallback;
    let now = 100_000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
    const cancel = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", cancel);
    const render = vi.fn();
    const loop = new GameLoop(vi.fn(), render, 60);
    loop.start();
    nextFrame!(now + 1);
    expect(render).not.toHaveBeenCalled();
    nextFrame!(now + 1000 / 60);
    expect(render).toHaveBeenLastCalledWith(expect.closeTo(1 / 60, 10));
    loop.dispose();
    now += 60_000;
    loop.start();
    nextFrame!(now + 1);
    expect(render).toHaveBeenCalledTimes(1);
    nextFrame!(now + 1000 / 60);
    expect(render).toHaveBeenCalledTimes(2);
    expect(render).toHaveBeenLastCalledWith(expect.closeTo(1 / 60, 10));
    loop.dispose();
    expect(cancel).toHaveBeenCalledTimes(2);
  });
});
