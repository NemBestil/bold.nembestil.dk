import { describe, expect, it } from "vitest";
import {
  advanceRod,
  applyRodInput,
  canBump,
  createRodState,
  isOutOfBounds,
  scoringTeam,
  servingState,
} from "../game/systems/GameRules";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";

describe("rods and natural momentum", () => {
  it("builds eight independent rods and exactly 22 players", () => {
    expect(ROD_LAYOUT).toHaveLength(8);
    expect(ROD_LAYOUT.reduce((sum, rod) => sum + rod.count, 0)).toBe(22);
  });
  it("retains spin after release and accumulates angles beyond one turn", () => {
    const state = createRodState();
    state.velocity = 30;
    applyRodInput(
      state,
      {
        rodId: 0,
        sequence: 1,
        translation: 0,
        angularVelocity: 0,
        active: false,
      },
      0.5,
    );
    advanceRod(state, 1 / 120, 1.5);
    expect(state.velocity).toBeGreaterThan(29);
    let furthest = state.angle;
    for (let i = 1; i < 360; i++) {
      advanceRod(state, 1 / 120, 1.5);
      furthest = Math.max(furthest, state.angle);
    }
    expect(furthest).toBeGreaterThan(2 * Math.PI);
    expect(state.angle).toBe(2 * Math.PI);
    expect(state.velocity).toBe(0);
  });
  it("limits reversal acceleration and physical translation speed", () => {
    const state = createRodState();
    state.velocity = 30;
    applyRodInput(
      state,
      {
        rodId: 0,
        sequence: 1,
        translation: 1,
        angularVelocity: -35,
        active: true,
      },
      0.6,
    );
    advanceRod(state, 1 / 120, 1.5);
    expect(state.velocity).toBeGreaterThan(0);
    expect(state.translation).toBeLessThanOrEqual(
      C.rods.maxTranslationSpeed / 120,
    );
  });
  it("stops translation immediately on release while preserving the current position", () => {
    const state = createRodState();
    state.translation = 0.15;
    state.target = 0.5;
    applyRodInput(
      state,
      {
        rodId: 0,
        sequence: 1,
        translation: 1,
        angularVelocity: 0,
        active: false,
      },
      0.6,
    );
    advanceRod(state, 1 / 120, 1.5);
    expect(state.translation).toBe(0.15);
  });
  it("stops stale active inputs without stopping angular momentum abruptly", () => {
    const state = createRodState();
    state.active = true;
    state.velocity = 20;
    state.desiredVelocity = 20;
    advanceRod(state, 0.25, 1.5);
    expect(state.active).toBe(false);
    expect(state.velocity).toBeGreaterThan(0);
  });
});
describe("scoring and table boundaries", () => {
  it("only counts the ball after it passes completely through the goal mouth", () => {
    expect(scoringTeam({ x: 1.49, y: 0.05, z: 0 })).toBeNull();
    expect(scoringTeam({ x: 1.6, y: 0.05, z: 0 })).toBe("red");
    expect(scoringTeam({ x: -1.6, y: 0.05, z: 0 })).toBe("blue");
    expect(scoringTeam({ x: 1.6, y: 0.4, z: 0 })).toBeNull();
    expect(scoringTeam({ x: 1.6, y: 0.05, z: 0.5 })).toBeNull();
  });
  it("permits high balls over the field but detects a ball beyond the table", () => {
    expect(isOutOfBounds({ x: 0, y: 3, z: 0 })).toBe(false);
    expect(isOutOfBounds({ x: 0, y: 0.3, z: 1.2 })).toBe(true);
    expect(isOutOfBounds({ x: 0, y: -1, z: 0 })).toBe(true);
  });
});
describe("serving and bump rules", () => {
  it("serves from a side opening toward the pitch with at most five degrees of variation", () => {
    for (const side of [-1, 1])
      for (const random of [0, 0.5, 1]) {
        const serve = servingState(side, () => random);
        expect(Math.abs(serve.position.z)).toBeGreaterThan(C.table.halfWidth);
        expect(serve.velocity.z * side).toBeLessThan(0);
        expect(
          Math.abs(Math.atan2(serve.velocity.x, Math.abs(serve.velocity.z))),
        ).toBeLessThanOrEqual((5 * Math.PI) / 180 + 1e-9);
      }
  });
  it("permits bump only for an almost stationary ball while retaining its shared cooldown", () => {
    expect(canBump("playing",0,0)).toBe(true);
    expect(canBump("playing",0,C.ball.stuckSpeed)).toBe(true);
    expect(canBump("playing",0,C.ball.stuckSpeed + 0.001)).toBe(false);
    expect(canBump("playing",1,0)).toBe(false);
    expect(canBump("paused",0,0)).toBe(false);
    expect(canBump("serving",0,0)).toBe(false);
  });
});
describe("Rapier integration", () => {
  it("rolls a physical serve through the unobstructed serving hole", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.serve(1);
      for (let i = 0; i < 45; i++) physics.step(1 / 120, 1.5);
      const p = physics.ball.translation();
      expect(p.z).toBeLessThan(C.table.halfWidth - 0.15);
      expect(p.y).toBeGreaterThan(0);
      expect(p.y).toBeLessThan(0.1);
    } finally {
      physics.dispose();
    }
  });
  it("keeps a fast rotating foot contact controlled by the shared ball speed limit", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.ball.setTranslation({ x: 0.77, y: 0.034, z: 0 }, true);
      const rod = physics.rods.find(
        (r) => r.layout.team === "red" && r.layout.id === 3,
      )!;
      rod.state.angle = Math.PI * 1.25;
      rod.state.velocity = 35;
      rod.body.setRotation(
        {
          x: 0,
          y: 0,
          z: Math.sin(rod.state.angle / 2),
          w: Math.cos(rod.state.angle / 2),
        },
        true,
      );
      let maxHeight = 0;
      let maxSpeed = 0;
      let touched = false;
      for (let i = 0; i < 120; i++) {
        physics.input("red", {
          rodId: 3,
          sequence: i,
          translation: 0,
          angularVelocity: 35,
          active: true,
        });
        physics.step(1 / 120, 1.5);
        maxHeight = Math.max(maxHeight, physics.ball.translation().y);
        const velocity = physics.ball.linvel();
        maxSpeed = Math.max(maxSpeed, Math.hypot(velocity.x, velocity.y, velocity.z));
        touched ||= physics.drainBallTouches().length > 0;
      }
      expect(touched).toBe(true);
      expect(maxSpeed).toBeGreaterThan(0.1);
      expect(maxSpeed).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
      expect(maxHeight).toBeLessThan(C.table.wallHeight);
    } finally {
      physics.dispose();
    }
  });
  it("preserves the ball when rods are neutralized and resets for another match", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.serve(-1);
      for (let i = 0; i < 20; i++) physics.step(1 / 120, 1.5);
      const position = physics.ball.translation();
      physics.neutralize();
      expect(physics.ball.translation()).toEqual(position);
      physics.resetRods();
      physics.parkBall();
      expect(physics.ball.linvel()).toEqual({ x: 0, y: 0, z: 0 });
      expect(physics.rods.every((rod) => rod.state.angle === 0)).toBe(true);
    } finally {
      physics.dispose();
    }
  });
});

// Run the authoritative engine with a headless renderer. Real Rapier bodies are retained;
// only animation scheduling and display resources are replaced for deterministic rules tests.
import { vi } from "vitest";
import { GameEngine } from "../game/GameEngine";
import { decodeReplayFile, encodeReplayFile, type ReplayFileData } from "../shared/replayFile";
import { getTeamIdentities } from "../shared/teamIdentity";
import {
  DEFAULT_SETTINGS,
  type FootballClub,
  type GameSoundEvent,
  type TableFrame,
} from "../shared/types";
async function headlessEngine(options: { renderFps?: number; onAnimationFrame?: (callback: FrameRequestCallback) => number } = {}) {
  vi.stubGlobal("document", {
    addEventListener() {},
    removeEventListener() {},
    hidden: false,
  });
  vi.stubGlobal("requestAnimationFrame", options.onAnimationFrame ?? (() => 1));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const physics = await PhysicsWorld.create();
  const frames: TableFrame[] = [];
  const sounds: GameSoundEvent[] = [];
  const view = {
    settings() {},
    shake() {},
    dispose() {},
    render: vi.fn(),
    table: {
      ball: { position: { set: vi.fn() }, quaternion: { set: vi.fn() } },
      rods: physics.rods.map(() => ({
        position: { z: 0 },
        rotation: { z: 0 },
      })),
      setClubs() {},
      getKits: () => ({
        red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" },
        blue: { primaryColor: "#4e99d3", secondaryColor: "#ffffff" },
      }),
      counters: { red: { setScore() {} }, blue: { setScore() {} } },
    },
  };
  const engine = Reflect.construct(GameEngine, [
    physics,
    view,
    () => {},
    (frame: TableFrame) => frames.push(frame),
    (sound: GameSoundEvent) => sounds.push(sound),
    options.renderFps,
  ]) as GameEngine;
  const step = (engine as unknown as { step(dt: number): void }).step;
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.ceil(seconds * 120); i++) step(1 / 120);
  };
  const club: FootballClub = {
    id: "test",
    name: "Test FC",
    country: "Danmark",
    primaryColor: "#f00",
    secondaryColor: "#fff",
  };
  engine.start(
    { ...DEFAULT_SETTINGS, goalsToWin: 3 },
    { red: club, blue: club },
  );
  return {
    engine,
    physics,
    tick,
    step,
    club,
    view,
    frames,
    sounds,
    render: (engine as unknown as { render(dt: number): void }).render,
    cleanup: () => {
      engine.dispose();
      vi.unstubAllGlobals();
    },
  };
}
describe("authoritative match lifecycle", () => {
  it("counts down 3–2–1 after a goal replay, freezes the ball, and safely resumes the next serve after pause", async () => {
    const { engine, physics, tick, step, cleanup } = await headlessEngine();
    try {
      tick(4.2);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      for (let i = 0; i < (C.match.goalDuration + C.replay.maxDuration + 0.1) * 120 && ["goal", "replay"].includes(engine.snapshot.phase); i++)
        step(C.physics.timestep);
      expect(engine.snapshot.phase).toBe("countdown");
      expect(engine.snapshot.notice).toBe("Ny bold om");
      expect(engine.snapshot.countdown).toBe(3);
      const goalPosition = physics.ball.translation();
      tick(1.01);
      expect(engine.snapshot.countdown).toBe(2);
      tick(1);
      expect(engine.snapshot.countdown).toBe(1);
      expect(physics.ball.translation()).toEqual(goalPosition);
      expect(engine.bump()).toBe(false);
      engine.pause();
      tick(10);
      engine.resume();
      tick(C.match.countdownDuration + 0.01);
      expect(engine.snapshot.phase).toBe("serving");
      expect(physics.ball.translation()).not.toEqual(goalPosition);
      tick(C.serving.duration);
      expect(engine.snapshot.phase).toBe("playing");
      expect(engine.snapshot.scores).toEqual({ red: 1, blue: 0 });
    } finally { cleanup(); }
  });
  it("streams the displayed ball and all rods at 60 Hz with continuous angles and actual kit colors", async () => {
    const { physics, render, frames, cleanup } = await headlessEngine();
    try {
      physics.ball.setTranslation({ x: 0.54, y: 0.12, z: -0.23 }, true);
      physics.rods[2]!.state.translation = 0.16;
      physics.rods[2]!.state.angle = 7 * Math.PI;
      for (let i = 0; i < 60; i++) render(1 / 60);
      expect(frames).toHaveLength(60);
      const frame = frames.at(-1)!;
      expect(frame.sequence).toBe(60);
      expect(frame.phase).toBe("countdown");
      expect(frame.ball.position.x).toBeCloseTo(0.54);
      expect(frame.ball.position.z).toBeCloseTo(-0.23);
      expect(frame.rods).toHaveLength(8);
      expect(frame.rods[2]).toEqual({ translation: 0.16, angle: 7 * Math.PI });
      expect(frame.kits.blue.primaryColor).toBe("#4e99d3");
      physics.rods[2]!.state.angle = 0;
      expect(frame.rods[2]!.angle).toBe(7 * Math.PI);
    } finally { cleanup(); }
  });
  it("keeps a 60 Hz visual cadence across render jitter without replaying stale frames after a stall", async () => {
    const { render, frames, cleanup } = await headlessEngine({ renderFps: 120 });
    try {
      // A faster screen and alternating frame durations must not raise the stream rate.
      for (let i = 0; i < 240; i++)
        render(1 / 120 + (i % 2 ? -0.0005 : 0.0005));
      expect(frames.length).toBeGreaterThanOrEqual(119);
      expect(frames.length).toBeLessThanOrEqual(121);
      const beforeStall = frames.length;
      render(0.5);
      expect(frames).toHaveLength(beforeStall + 1);
      const afterStall = frames.length;
      for (let i = 0; i < 4; i++) render(0.001);
      // The half-second stall produces one current pose, never a queued burst.
      expect(frames.length - afterStall).toBeLessThanOrEqual(1);
    } finally { cleanup(); }
  });
  it.each([60, 90, 120, 144])("streams every scheduled 60 Hz draw on a %s Hz display without a second rate gate", async (displayHz) => {
    let now = 0;
    let nextFrame: FrameRequestCallback | undefined;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    const { frames, view, cleanup } = await headlessEngine({
      onAnimationFrame: (callback) => { nextFrame = callback; return 1; },
    });
    try {
      for (let tick = 1; tick <= displayHz * 2; tick++) {
        now = tick * 1_000 / displayHz;
        nextFrame!(now);
      }
      expect(view.render.mock.calls.length).toBeGreaterThanOrEqual(119);
      expect(view.render.mock.calls.length).toBeLessThanOrEqual(121);
      expect(frames).toHaveLength(view.render.mock.calls.length);
      expect(frames.at(-1)!.time).toBeCloseTo(now);
      const beforeStall = frames.length;
      now += 500;
      nextFrame!(now);
      expect(frames).toHaveLength(beforeStall + 1);
      // No missed-frame backlog may drain as several short catch-up draws.
      const afterStall = frames.length;
      for (let tick = 1; tick <= displayHz; tick++) {
        now += 1_000 / displayHz;
        nextFrame!(now);
      }
      expect(frames.length - afterStall).toBeGreaterThanOrEqual(59);
      expect(frames.length - afterStall).toBeLessThanOrEqual(61);
      expect(frames).toHaveLength(view.render.mock.calls.length);
    } finally { cleanup(); clock.mockRestore(); }
  });
  it("marks new serves and resets as discontinuities without resetting frame sequence", async () => {
    const { engine, render, tick, frames, cleanup } = await headlessEngine();
    try {
      render(1 / 60);
      const countdown = frames.at(-1)!;
      tick(3.05);
      render(1 / 60);
      const serve = frames.at(-1)!;
      expect(serve.phase).toBe("serving");
      expect(serve.epoch).toBeGreaterThan(countdown.epoch);
      engine.reset();
      render(1 / 60);
      const reset = frames.at(-1)!;
      expect(reset.phase).toBe("lobby");
      expect(reset.epoch).toBeGreaterThan(serve.epoch);
      expect(reset.sequence).toBeGreaterThan(serve.sequence);
    } finally { cleanup(); }
  });
  it("replays recorded transforms while physics and score stay frozen, then serves only once", async () => {
    const { engine, physics, tick, step, view, render, frames, cleanup } =
      await headlessEngine();
    try {
      tick(4.2);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      const scoredPosition = physics.ball.translation();
      tick(C.match.goalDuration + 0.05);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay?.slowMotion).toBe(true);
      render(1 / 60);
      expect(view.table.ball.position.set).toHaveBeenCalled();
      const displayed = view.table.ball.position.set.mock.lastCall;
      expect(frames.at(-1)!.phase).toBe("replay");
      expect(frames.at(-1)!.replay).toEqual(engine.snapshot.replay);
      expect(frames.at(-1)!.replay?.remaining).toBeGreaterThan(0);
      expect(frames.at(-1)!.replay?.fade).toBe(0);
      expect(frames.at(-1)!.replay?.summary).toBeUndefined();
      expect(view.render).toHaveBeenLastCalledWith(
        1 / 60,
        "replay",
        engine.snapshot.replay,
      );
      expect(Object.values(frames.at(-1)!.ball.position)).toEqual(displayed);
      expect(displayed).not.toEqual([
        scoredPosition.x,
        scoredPosition.y,
        scoredPosition.z,
      ]);
      tick(0.4);
      expect(physics.ball.translation()).toEqual(scoredPosition);
      expect(engine.snapshot.scores).toEqual({ red: 1, blue: 0 });
      expect(engine.bump()).toBe(false);
      engine.input("red", {
        sequence: 9,
        rodId: 0,
        translation: 1,
        angularVelocity: 35,
        active: true,
      });
      expect(
        physics.rods.find(
          (rod) => rod.layout.team === "red" && rod.layout.id === 0,
        )!.state.active,
      ).toBe(false);
      tick(engine.snapshot.replay!.remaining! + 0.01);
      expect(engine.snapshot.phase).toBe("countdown");
      tick(C.match.countdownDuration + C.serving.duration);
      expect(engine.snapshot.phase).toBe("playing");
      expect(engine.snapshot.replay).toBeUndefined();
      expect(engine.snapshot.scores).toEqual({ red: 1, blue: 0 });
    } finally {
      cleanup();
    }
  });
  it("pauses and resumes replay without replaying the goal or counting paused wall time", async () => {
    const { engine, physics, tick, step, cleanup } = await headlessEngine();
    try {
      tick(4.2);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      tick(C.match.goalDuration + 0.25);
      const progress = engine.snapshot.replay!.progress;
      engine.pause();
      tick(20);
      expect(engine.snapshot.phase).toBe("paused");
      expect(engine.snapshot.replay!.progress).toBe(progress);
      engine.resume();
      tick(C.match.countdownDuration + 0.01);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay!.progress).toBeCloseTo(progress, 1);
      tick(C.replay.maxDuration + C.match.countdownDuration + 1);
      expect(engine.snapshot.phase).toBe("playing");
      expect(engine.snapshot.scores.red).toBe(1);
    } finally {
      cleanup();
    }
  });
  it("recovers an out ball during serving instead of waiting for active play", async () => {
    const { engine, physics, tick, step, cleanup } = await headlessEngine();
    try {
      tick(3.1);
      expect(engine.snapshot.phase).toBe("serving");
      physics.ball.setTranslation({ x: 0, y: 0.3, z: 1.3 }, true);
      step(C.physics.timestep);
      expect(engine.snapshot.phase).toBe("out");
      expect(engine.snapshot.scores).toEqual({ red: 0, blue: 0 });
    } finally {
      cleanup();
    }
  });
  it("counts each goal once, finishes at the target and can restart without leaked scores", async () => {
    const { engine, physics, tick, step, club, cleanup } =
      await headlessEngine();
    try {
      expect(engine.snapshot.phase).toBe("countdown");
      tick(4);
      expect(engine.snapshot.phase).toBe("playing");
      for (let goal = 1; goal <= 3; goal++) {
        physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
        step(1 / 120);
        expect(engine.snapshot.scores.red).toBe(goal);
        expect(engine.snapshot.scoringTeam).toBe("red");
        if (goal < 3) {
          expect(engine.snapshot.phase).toBe("goal");
          tick(0.2);
          expect(engine.snapshot.scores.red).toBe(goal);
          tick(
            C.match.goalDuration + C.replay.maxDuration +
            C.match.countdownDuration + C.serving.duration,
          );
          expect(engine.snapshot.phase).toBe("playing");
          expect(engine.snapshot.scoringTeam).toBeNull();
        }
      }
      expect(engine.snapshot.phase).toBe("goal");
      tick(C.match.goalDuration + C.replay.maxDuration * 3 + 0.9);
      expect(engine.snapshot.phase).toBe("finished");
      expect(engine.snapshot.winner).toBe("red");
      engine.start(
        { ...DEFAULT_SETTINGS, goalsToWin: 3 },
        { red: club, blue: club },
      );
      expect(engine.snapshot.scores).toEqual({ red: 0, blue: 0 });
      expect(engine.snapshot.winner).toBeNull();
      expect(engine.snapshot.scoringTeam).toBeNull();
      expect(engine.snapshot.phase).toBe("countdown");
    } finally {
      cleanup();
    }
  });
  it("shows all three archived goals with their goal effect while authoritative score and physics stay frozen", async () => {
    const { engine, physics, tick, step, render, frames, sounds, cleanup } =
      await headlessEngine();
    try {
      tick(4);
      for (let goal = 1; goal <= 3; goal++) {
        physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
        step(C.physics.timestep);
        expect(engine.snapshot.phase).toBe("goal");
        if (goal < 3) {
          for (let frame = 0; frame < 15 * 120 && engine.snapshot.phase !== "playing"; frame++)
            step(C.physics.timestep);
          expect(engine.snapshot.phase).toBe("playing");
        }
      }
      const physicsStep = vi.spyOn(physics, "step");
      const frozenPosition = physics.ball.translation();
      const soundCount = sounds.length;
      tick(C.match.goalDuration + 0.01);
      expect(engine.snapshot.replay).toMatchObject({
        summary: true,
        goalIndex: 1,
        goalCount: 3,
        fade: 0,
      });
      expect(engine.snapshot.notice).toBe("Kampens mål");
      const order: number[] = [];
      let previousGoal = 0;
      let previousEpoch = -1;
      let sawFade = false;
      for (let frame = 0; frame < (3 * C.replay.maxDuration + 1) * 120; frame++) {
        if (engine.snapshot.phase === "finished") break;
        const replay = engine.snapshot.replay!;
        expect(replay.summary).toBe(true);
        if (replay.goalIndex !== order.at(-1)) order.push(replay.goalIndex!);
        sawFade ||= replay.fade! > 0;
        render(1 / 120);
        const shown = frames.at(-1)!;
        expect(shown.replay).toMatchObject({ summary: true, goalCount: 3 });
        if (shown.replay!.goalIndex! > previousGoal) {
          expect(shown.epoch).toBeGreaterThan(previousEpoch);
          previousGoal = shown.replay!.goalIndex!;
          previousEpoch = shown.epoch;
        }
        expect(engine.snapshot.scores).toEqual({ red: 3, blue: 0 });
        expect(engine.bump()).toBe(false);
        step(C.physics.timestep);
      }
      expect(order).toEqual([1, 2, 3]);
      expect(sawFade).toBe(true);
      expect(engine.snapshot.phase).toBe("finished");
      expect(engine.snapshot.replay).toBeUndefined();
      expect(engine.snapshot.winner).toBe("red");
      expect(physics.ball.translation()).toEqual(frozenPosition);
      expect(physicsStep).not.toHaveBeenCalled();
      expect(sounds).toHaveLength(soundCount + 3);
      expect(sounds.filter((sound) => sound.kind === "goal")).toHaveLength(6);
      render(1 / 30);
      expect(frames.at(-1)!.phase).toBe("finished");
      expect(frames.at(-1)!.epoch).toBeGreaterThan(previousEpoch);
      expect(frames.at(-1)!.replay).toBeUndefined();
    } finally {
      cleanup();
    }
  });
  it("pauses a montage fade and resumes the same goal before clearing highlights on reset and rematch", async () => {
    const { engine, physics, tick, step, club, render, frames, cleanup } =
      await headlessEngine();
    let now = 10_000;
    const clock = vi.spyOn(performance, "now").mockImplementation(() => now);
    try {
      engine.start(
        { ...DEFAULT_SETTINGS, goalsToWin: 2 },
        { red: club, blue: club },
      );
      tick(4);
      for (let goal = 1; goal <= 2; goal++) {
        physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
        step(C.physics.timestep);
        if (goal === 1)
          for (let frame = 0; frame < 15 * 120 && engine.snapshot.phase !== "playing"; frame++)
            step(C.physics.timestep);
      }
      tick(C.match.goalDuration + 0.01);
      for (let frame = 0; frame < C.replay.maxDuration * 120 && !engine.snapshot.replay!.fade; frame++)
        step(C.physics.timestep);
      const paused = engine.snapshot.replay!;
      expect(paused.fade).toBeGreaterThan(0);
      engine.pause();
      now += 60_000;
      tick(60);
      expect(engine.snapshot.replay).toEqual(paused);
      render(1 / 30);
      expect(frames.at(-1)!.phase).toBe("paused");
      expect(frames.at(-1)!.replay).toEqual(paused);
      engine.resume();
      now += C.match.countdownDuration * 1000;
      // Stop at the instant replay is restored, before advancing its clock.
      for (let frame = 0; frame < 4 * 120 && engine.snapshot.phase === "countdown"; frame++)
        step(C.physics.timestep);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay).toEqual(paused);
      tick(0.5);
      expect(engine.snapshot.replay!.goalIndex).toBe(2);
      engine.reset();
      expect(engine.snapshot.phase).toBe("lobby");
      expect(engine.snapshot.replay).toBeUndefined();
      expect((engine as unknown as { highlights: unknown[] }).highlights).toHaveLength(0);
      engine.start(
        { ...DEFAULT_SETTINGS, goalsToWin: 1 },
        { red: club, blue: club },
      );
      tick(C.match.countdownDuration + 0.01);
      physics.ball.setTranslation({ x: -1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      expect(engine.snapshot.scoringTeam).toBe("blue");
      tick(C.match.goalDuration + 0.01);
      expect(engine.snapshot.replay).toMatchObject({
        summary: true,
        goalIndex: 1,
        goalCount: 1,
      });
      expect(engine.snapshot.scores).toEqual({ red: 0, blue: 1 });
    } finally {
      clock.mockRestore();
      cleanup();
    }
  });
  it("retains the match for host scrubbing after highlights, keeps final scores, and cuts outgoing frames at the next replay serve", async () => {
    const { engine, physics, tick, step, club, render, frames, sounds, cleanup } = await headlessEngine();
    try {
      engine.start({ ...DEFAULT_SETTINGS, goalsToWin: 2 }, { red: club, blue: club });
      tick(4);
      for (let goal = 1; goal <= 2; goal++) {
        physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
        step(C.physics.timestep);
        if (goal === 1) for (let frame = 0; frame < 20 * 120 && engine.snapshot.phase !== "playing"; frame++) step(C.physics.timestep);
      }
      tick(C.match.goalDuration + 20);
      expect(engine.snapshot.phase).toBe("finished");
      const archive = engine.matchRecording!;
      expect(archive.goals).toHaveLength(2);
      const sourceDuration = archive.duration;
      const frozen = physics.ball.translation();
      const physicsStep = vi.spyOn(physics, "step");
      engine.startMatchReplay("full");
      expect(engine.snapshot.replay).toMatchObject({ fullMatch: true, mode: "full", playing: true, scores: { red: 0, blue: 0 } });
      engine.seekMatchReplay(archive.goals[0]!.time);
      expect(engine.snapshot.replay).toMatchObject({ playing: false, goalTeam: "red", scores: { red: 1, blue: 0 } });
      render(1 / 60);
      const goalEpoch = frames.at(-1)!.epoch;
      expect(frames.at(-1)!.scores).toEqual({ red: 1, blue: 0 });
      const soundCount = sounds.length;
      tick(10);
      expect(engine.snapshot.replay!.time).toBe(archive.goals[0]!.time);
      expect(sounds).toHaveLength(soundCount);
      engine.setMatchReplayPlaying(true);
      tick(C.match.goalDuration + 0.02);
      render(1 / 60);
      expect(frames.at(-1)!.epoch).toBeGreaterThan(goalEpoch);
      expect(engine.snapshot.scores).toEqual({ red: 2, blue: 0 });
      expect(engine.snapshot.winner).toBe("red");
      expect(physics.ball.translation()).toEqual(frozen);
      expect(physicsStep).not.toHaveBeenCalled();
      engine.stopMatchReplay();
      render(1 / 60);
      expect(frames.at(-1)!.scores).toEqual({ red: 2, blue: 0 });
      expect(engine.snapshot.phase).toBe("finished");
      expect(engine.matchRecording!.duration).toBe(sourceDuration);
      engine.reset();
      expect(engine.matchRecording).toBeNull();
    } finally { cleanup(); }
  });
  it("opens a clicked highlight at its buildup and resumes only its own scoring effect", async () => {
    const { engine, physics, tick, step, club, sounds, cleanup } = await headlessEngine();
    try {
      engine.start({ ...DEFAULT_SETTINGS, goalsToWin: 2 }, { red: club, blue: club });
      tick(4);
      for (let goal = 1; goal <= 2; goal++) {
        tick(0.15);
        physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
        step(C.physics.timestep);
        if (goal === 1) for (let frame = 0; frame < 20 * 120 && engine.snapshot.phase !== "playing"; frame++) step(C.physics.timestep);
      }
      tick(C.match.goalDuration + 20);
      expect(engine.snapshot.phase).toBe("finished");
      const goals = engine.matchRecording!.goals;
      const selected = goals[1]!;
      expect(selected.start).toBe(goals[0]!.time);
      expect(selected.start).toBeLessThan(selected.time);
      const physicsStep = vi.spyOn(physics, "step");
      const heardBefore = sounds.filter(sound => sound.kind === "goal").length;

      engine.seekMatchReplayHighlight(selected.index);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay).toMatchObject({ time: selected.start, playing: false, mode: "full", goalIndex: 2, scores: { red: 1, blue: 0 } });
      expect(engine.snapshot.replay!.goalTeam).toBeUndefined();
      tick(2);
      expect(engine.snapshot.replay!.time).toBe(selected.start);
      expect(sounds.filter(sound => sound.kind === "goal")).toHaveLength(heardBefore);
      engine.pause();
      engine.seekMatchReplayHighlight(selected.index);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay).toMatchObject({ time: selected.start, playing: false });
      engine.setMatchReplayPlaying(true);
      tick(selected.time - selected.start + 0.02);
      expect(engine.snapshot.replay).toMatchObject({ goalTeam: "red", scores: { red: 2, blue: 0 } });
      expect(sounds.filter(sound => sound.kind === "goal")).toHaveLength(heardBefore + 1);
      expect(physicsStep).not.toHaveBeenCalled();
      expect(engine.snapshot.scores).toEqual({ red: 2, blue: 0 });
      expect(engine.snapshot.winner).toBe("red");
    } finally { cleanup(); }
  });
  it("stops replay audio on navigation and allows postmatch controls to leave the global pause screen", async () => {
    const { engine, physics, tick, step, club, cleanup } = await headlessEngine();
    try {
      engine.start({ ...DEFAULT_SETTINGS, goalsToWin: 1 }, { red: club, blue: club });
      tick(4);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      tick(C.match.goalDuration + 0.01);
      const audio = (engine as unknown as { audio: { stop(): void } }).audio;
      const stop = vi.spyOn(audio, "stop");
      engine.seekMatchReplay(engine.matchRecording!.goals[0]!.time);
      expect(stop).toHaveBeenCalledTimes(1);
      stop.mockClear();
      engine.setMatchReplayPlaying(false);
      expect(stop).toHaveBeenCalledTimes(1);
      stop.mockClear();
      engine.setMatchReplayMode("highlights");
      expect(stop).toHaveBeenCalledTimes(1);
      engine.pause();
      expect(engine.snapshot.phase).toBe("paused");
      stop.mockClear();
      engine.seekMatchReplay(0);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay).toMatchObject({ time: 0, playing: false, mode: "full" });
      expect(stop).toHaveBeenCalledTimes(1);
      engine.pause();
      engine.setMatchReplayMode("highlights");
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay!.mode).toBe("highlights");
      engine.pause();
      engine.setMatchReplayPlaying(true);
      expect(engine.snapshot.phase).toBe("replay");
      expect(engine.snapshot.replay!.playing).toBe(true);
      engine.pause();
      stop.mockClear();
      engine.stopMatchReplay();
      expect(engine.snapshot.phase).toBe("finished");
      expect(engine.snapshot.scores).toEqual({ red: 1, blue: 0 });
      expect(stop).toHaveBeenCalledTimes(1);
    } finally { cleanup(); }
  });
  it("does not let archive controls resume or change a paused live match", async () => {
    const { engine, physics, tick, step, cleanup } = await headlessEngine();
    try {
      tick(4);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      engine.pause();
      const paused = engine.snapshot;
      engine.startMatchReplay("full");
      engine.seekMatchReplay(0);
      engine.seekMatchReplayHighlight(1);
      engine.setMatchReplayMode("highlights");
      engine.setMatchReplayPlaying(true);
      engine.stopMatchReplay();
      expect(engine.snapshot).toEqual(paused);
    } finally { cleanup(); }
  });
  it("downloads and reopens a completed match with its original settings, fixed teams, goal effects, and frozen physics", async () => {
    const { getTeamIdentities } = await import("../shared/teamIdentity");
    const { encodeReplayFile, decodeReplayFile } = await import("../shared/replayFile");
    const { engine, physics, tick, step, render, frames, sounds, cleanup } = await headlessEngine();
    try {
      const teams = getTeamIdentities({ red: "Sofaens mestre", blue: "Blå lyn" });
      const originalSettings = { ...DEFAULT_SETTINGS, goalsToWin: 3, rotationDamping: 2 };
      engine.start(originalSettings, teams);
      expect(engine.exportMatchReplay()).toBeNull();
      tick(4);
      for (let goal = 1; goal <= 3; goal++) {
        physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
        step(C.physics.timestep);
        if (goal < 3) for (let frame = 0; frame < 20 * 120 && engine.snapshot.phase !== "playing"; frame++) step(C.physics.timestep);
      }
      tick(C.match.goalDuration + 30);
      expect(engine.snapshot.phase).toBe("finished");
      engine.updateSettings({ ...DEFAULT_SETTINGS, goalsToWin: 5, rotationDamping: 4 });
      const portable = engine.exportMatchReplay()!;
      expect(portable.settings).toEqual(originalSettings);
      expect(portable.teams).toEqual(teams);
      portable.teams.red.name = "Changed copy";
      portable.recording.goals[0]!.scores.red = 99;
      portable.recording.frames[1] = 99;
      const exported = engine.exportMatchReplay()!;
      expect(exported.teams.red.name).toBe("Sofaens mestre");
      expect(exported.recording.goals[0]!.scores.red).toBe(1);
      expect(exported.recording.frames[1]).not.toBe(99);
      const { blob } = await encodeReplayFile(exported);
      const saved = await decodeReplayFile(blob);
      engine.start(DEFAULT_SETTINGS, teams);
      const live = engine.snapshot;
      expect(engine.loadMatchReplay(saved)).toBe(false);
      expect(engine.snapshot).toEqual(live);
      engine.reset();
      expect(engine.loadMatchReplay(saved)).toBe(true);
      expect(engine.snapshot).toMatchObject({ phase: "replay", scores: { red: 3, blue: 0 }, winner: "red", replay: { mode: "full", playing: true } });
      const physicsStep = vi.spyOn(physics, "step");
      const firstGoal = saved.recording.goals[0]!;
      engine.seekMatchReplay(firstGoal.time);
      expect(engine.snapshot.replay).toMatchObject({ playing: false, goalTeam: "red", scores: { red: 1, blue: 0 } });
      render(1 / 60);
      expect(frames.at(-1)!.ball).toEqual(firstGoal.frame.ball);
      expect(frames.at(-1)!.goalsToWin).toBe(3);
      const soundCount = sounds.filter(event => event.kind === "goal").length;
      engine.seekMatchReplay(0);
      engine.setMatchReplayPlaying(true);
      tick(firstGoal.time + 0.02);
      expect(sounds.filter(event => event.kind === "goal")).toHaveLength(soundCount + 1);
      expect(physicsStep).not.toHaveBeenCalled();
      engine.stopMatchReplay();
      expect(engine.snapshot).toMatchObject({ phase: "finished", scores: { red: 3, blue: 0 }, winner: "red" });
      expect(engine.exportMatchReplay()!.settings.goalsToWin).toBe(3);
    } finally { cleanup(); }
  });
  it("applies the selected ball speed at start and during settings changes, then retains it in a downloaded replay", async () => {
    const { engine, physics, tick, step, club, cleanup } = await headlessEngine();
    try {
      engine.start({ ...DEFAULT_SETTINGS, goalsToWin: 1, ballSpeed: 0.5 }, { red: club, blue: club });
      physics.serve(1);
      const speed = () => Math.hypot(...Object.values(physics.ball.linvel()));
      expect(speed()).toBeCloseTo(C.serving.speed * 0.5, 5);
      engine.updateSettings({ ...DEFAULT_SETTINGS, goalsToWin: 1, ballSpeed: 2 });
      expect(speed()).toBeCloseTo(C.serving.speed * 0.5, 5);
      physics.serve(1);
      expect(speed()).toBeCloseTo(C.serving.speed * 2, 5);
      engine.updateSettings({ ...DEFAULT_SETTINGS, goalsToWin: 1, ballSpeed: 0.5 });
      expect(speed()).toBeCloseTo(C.ball.maxSpeed * 0.5, 5);
      tick(4);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      expect(engine.snapshot.winner).toBe("red");
      const saved = engine.exportMatchReplay()!;
      expect(saved.settings.ballSpeed).toBe(0.5);
      engine.reset();
      const setBallSpeed = vi.spyOn(physics, "setBallSpeed");
      expect(engine.loadMatchReplay(saved)).toBe(true);
      expect(setBallSpeed).toHaveBeenLastCalledWith(0.5);
    } finally { cleanup(); }
  });
  it("publishes and records a real unheld rod deflection for controllers and saved replay", async () => {
    const { engine, physics, tick, step, render, frames, club, cleanup } = await headlessEngine();
    try {
      engine.start({ ...DEFAULT_SETTINGS, goalsToWin: 1 }, { red: club, blue: club });
      tick(4);
      const index = physics.rods.findIndex(rod => rod.layout.team === "red" && rod.layout.id === 3);
      const rod = physics.rods[index]!;
      for (const other of physics.rods)
        if (other !== rod) for (let i = 0; i < other.body.numColliders(); i++) other.body.collider(i).setEnabled(false);
      physics.ball.setTranslation({ x: rod.layout.x - 0.18, y: C.ball.radius + 0.0001, z: 0 }, true);
      physics.ball.setLinvel({ x: C.ball.maxSpeed, y: 0, z: 0 }, true);
      physics.ball.setAngvel({ x: 0, y: 0, z: -C.ball.maxSpeed / C.ball.radius }, true);
      let deflected = false;
      for (let i = 0; i < 100; i++) {
        step(C.physics.timestep);
        if (Math.abs(rod.state.angle) > 0.35) { deflected = true; break; }
      }
      expect(deflected).toBe(true);
      render(1 / 60);
      expect(frames.at(-1)!.rods[index]!.angle).toBe(rod.state.angle);
      expect(frames.at(-1)!.rods[index]!.translation).toBe(rod.state.translation);
      // Allow at least one packed recording sample of the deflected pose.
      for (let i = 0; i < 5; i++) step(C.physics.timestep);
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(C.physics.timestep);
      const saved = engine.exportMatchReplay()!;
      expect(saved.recording.frames.some((value, i) => i % 25 === 9 + index * 2 && Math.abs(value) > 0.25)).toBe(true);
    } finally { cleanup(); }
  });
  it("only advances archive time during live serving and play, and publishes bump eligibility when all ball movement stops", async () => {
    const { engine, physics, tick, step, cleanup } = await headlessEngine();
    try {
      tick(4);
      const recorder = (engine as unknown as { matchRecorder: { duration: number } }).matchRecorder;
      const beforePause = recorder.duration;
      engine.pause();
      tick(10);
      engine.resume();
      for (let frame = 0; frame < 4 * 120 && engine.snapshot.phase === "countdown"; frame++) step(C.physics.timestep);
      expect(recorder.duration).toBe(beforePause);
      vi.spyOn(physics, "step").mockImplementation(() => {});
      physics.ball.setTranslation({ x: 0, y: 0.05, z: 0 }, true);
      physics.ball.setLinvel({ x: 0, y: C.ball.stuckSpeed + 0.01, z: 0 }, true);
      step(C.physics.timestep);
      expect(engine.snapshot.bumpAvailable).toBe(false);
      expect(engine.bump()).toBe(false);
      physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      step(C.physics.timestep);
      expect(engine.snapshot.bumpAvailable).toBe(true);
      expect(engine.bump()).toBe(true);
      expect(engine.bump()).toBe(false);
      expect(recorder.duration).toBeGreaterThan(beforePause);
    } finally { cleanup(); }
  });
  it("retains all nineteen bounded highlights in a first-to-ten match", async () => {
    const { engine, physics, tick, step, club, cleanup } = await headlessEngine();
    try {
      engine.start(
        { ...DEFAULT_SETTINGS, goalsToWin: 10 },
        { red: club, blue: club },
      );
      tick(4);
      for (let goal = 1; goal <= 19; goal++) {
        physics.ball.setTranslation({
          x: goal % 2 ? 1.6 : -1.6,
          y: 0.05,
          z: 0,
        }, true);
        step(C.physics.timestep);
        expect(engine.snapshot.phase).toBe("goal");
        expect((engine as unknown as { highlights: unknown[] }).highlights)
          .toHaveLength(goal);
        if (goal < 19) {
          for (let frame = 0; frame < 15 * 120 && engine.snapshot.phase !== "playing"; frame++)
            step(C.physics.timestep);
          expect(engine.snapshot.phase).toBe("playing");
        }
      }
      tick(C.match.goalDuration + 0.01);
      expect(engine.snapshot.scores).toEqual({ red: 10, blue: 9 });
      expect(engine.snapshot.replay).toMatchObject({
        summary: true,
        goalIndex: 1,
        goalCount: 19,
      });
      engine.dispose();
      expect((engine as unknown as { highlights: unknown[] }).highlights).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
  it("preserves the ball and points across a pause and resumes through a countdown", async () => {
    const { engine, physics, tick, cleanup } = await headlessEngine();
    try {
      tick(4);
      const position = physics.ball.translation();
      engine.pause();
      expect(engine.snapshot.phase).toBe("paused");
      tick(2);
      expect(physics.ball.translation()).toEqual(position);
      engine.resume();
      expect(engine.snapshot.phase).toBe("countdown");
      tick(3.01);
      expect(engine.snapshot.phase).toBe("playing");
      expect(engine.snapshot.scores).toEqual({ red: 0, blue: 0 });
      expect(Math.abs(physics.ball.translation().z - position.z)).toBeLessThan(
        0.1,
      );
    } finally {
      cleanup();
    }
  });
  it("continues an interrupted serve from its current position and remaining time", async () => {
    const { engine, physics, tick, cleanup } = await headlessEngine();
    try {
      tick(3.2);
      expect(engine.snapshot.phase).toBe("serving");
      const position = physics.ball.translation();
      engine.pause();
      tick(1);
      engine.resume();
      tick(3.01);
      expect(engine.snapshot.phase).toBe("serving");
      expect(Math.abs(physics.ball.translation().z - position.z)).toBeLessThan(
        0.05,
      );
      tick(0.6);
      expect(engine.snapshot.phase).toBe("playing");
    } finally {
      cleanup();
    }
  });
  it.each(["goal", "out"] as const)(
    "restores the remaining %s announcement time after pause",
    async (phase) => {
      const { engine, physics, tick, step, cleanup } = await headlessEngine();
      try {
        tick(4);
        physics.ball.setTranslation(
          phase === "goal"
            ? { x: 1.6, y: 0.05, z: 0 }
            : { x: 0, y: 0.3, z: 1.3 },
          true,
        );
        step(1 / 120);
        tick(
          (phase === "goal" ? C.match.goalDuration : C.match.outDuration) - 0.3,
        );
        const notice = engine.snapshot.notice;
        engine.pause();
        engine.resume();
        tick(3.01);
        expect(engine.snapshot.phase).toBe(phase);
        expect(engine.snapshot.notice).toBe(notice);
        tick(0.4);
        expect(engine.snapshot.phase).toBe(
          phase === "goal" ? "replay" : "serving",
        );
      } finally {
        cleanup();
      }
    },
  );
  it("can disconnect again during a resume countdown without losing the saved ball", async () => {
    const { engine, physics, tick, cleanup } = await headlessEngine();
    try {
      tick(4);
      const position = physics.ball.translation();
      engine.pause();
      engine.resume();
      tick(1);
      engine.pause();
      engine.resume();
      tick(3.01);
      expect(engine.snapshot.phase).toBe("playing");
      expect(Math.abs(physics.ball.translation().z - position.z)).toBeLessThan(
        0.1,
      );
    } finally {
      cleanup();
    }
  });
  it("announces out-of-bounds without awarding a goal and serves again", async () => {
    const { engine, physics, tick, step, cleanup } = await headlessEngine();
    try {
      tick(4);
      physics.ball.setTranslation({ x: 0, y: 0.3, z: 1.3 }, true);
      step(1 / 120);
      expect(engine.snapshot.phase).toBe("out");
      expect(engine.snapshot.scores).toEqual({ red: 0, blue: 0 });
      tick(2.3);
      expect(engine.snapshot.phase).toBe("playing");
      expect(engine.snapshot.scores).toEqual({ red: 0, blue: 0 });
    } finally {
      cleanup();
    }
  });
});
