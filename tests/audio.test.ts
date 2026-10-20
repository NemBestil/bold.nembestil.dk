import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { GameAudio } from "../game/audio/GameAudio";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import { GameEngine } from "../game/GameEngine";
import { GAME_CONFIG } from "../game/GameConfig";
import { playingSurfaceHeight } from "../game/table/PlayingSurface";
import {
  DEFAULT_SETTINGS,
  INITIAL_MATCH,
  type GameSoundEvent,
} from "../shared/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function audioContext() {
  const nodes: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    buffer?: { duration: number };
  }[] = [];
  const gains: number[][] = [];
  const context = {
    state: "suspended",
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    close: vi.fn(async () => {
      context.state = "closed";
    }),
    decodeAudioData: vi.fn(async () => ({ duration: 5 })),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      getChannelData: () => new Float32Array(length),
    })),
    createGain: vi.fn(() => {
      const values: number[] = [];
      gains.push(values);
      return {
        gain: {
          value: 0,
          setValueAtTime: (v: number) => values.push(v),
          linearRampToValueAtTime: (v: number) => values.push(v),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      };
    }),
    createBufferSource: vi.fn(() => source()),
    createOscillator: vi.fn(() => ({
      ...source(),
      frequency: {
        value: 0,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
    })),
  };
  function source() {
    const node = {
      buffer: undefined,
      start: vi.fn(),
      stop: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
    };
    nodes.push(node);
    return node;
  }
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return context;
      }
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })),
  );
  return { context, nodes, gains };
}

describe("user-activated sound playback", () => {
  it("does not fetch/create audio before a gesture or replay sounds missed while locked", async () => {
    const { context, nodes } = audioContext();
    const audio = new GameAudio("/game/");
    audio.play({ id: 1, kind: "goal", strength: 1 });
    expect(context.resume).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    await audio.unlock();
    expect(context.resume).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith(
      "/game/audio/goal-cheer.mp3",
      expect.any(Object),
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    audio.play({ id: 1, kind: "goal", strength: 1 });
    expect(nodes).toHaveLength(0);
    audio.play({ id: 2, kind: "goal", strength: 1 });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.stop).toHaveBeenCalledWith(2.7);
    await audio.unlock();
    expect(fetch).toHaveBeenCalledTimes(2);
    audio.dispose();
  });

  it("scales impact volume, uses different kick/rail tones and suppresses duplicates/floods", async () => {
    const { context, gains } = audioContext();
    const audio = new GameAudio();
    await audio.unlock();
    audio.play({ id: 1, kind: "kick", strength: 0.1 });
    const soft = Math.max(...gains[1]!);
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    audio.play({ id: 1, kind: "kick", strength: 1 });
    audio.play({ id: 2, kind: "kick", strength: 1 });
    expect(context.createOscillator).toHaveBeenCalledTimes(1);
    context.currentTime = 0.1;
    audio.play({ id: 3, kind: "kick", strength: 0.9 });
    expect(Math.max(...gains[3]!)).toBeGreaterThan(soft * 2);
    context.currentTime = 0.2;
    audio.play({ id: 4, kind: "wall", strength: 0.9 });
    const tones = context.createOscillator.mock.results.map(
      (result) => result.value.frequency.setValueAtTime.mock.calls[0]![0],
    );
    expect(tones).toEqual([165, 165, 480]);
    audio.dispose();
  });

  it("stops active effects on mute/dispose and does not buffer muted events", async () => {
    const { context, nodes } = audioContext();
    const audio = new GameAudio();
    await audio.unlock();
    audio.play({ id: 1, kind: "goal", strength: 1 });
    audio.setMuted(true);
    expect(audio.muted).toBe(true);
    expect(nodes[0]!.stop).toHaveBeenCalledTimes(2);
    audio.play({ id: 2, kind: "goal", strength: 1 });
    expect(nodes).toHaveLength(1);
    audio.setMuted(false);
    audio.play({ id: 2, kind: "goal", strength: 1 });
    expect(nodes).toHaveLength(1);
    audio.dispose();
    audio.dispose();
    expect(context.close).toHaveBeenCalledOnce();
  });

  it("retains synthesized impacts when sample loading fails", async () => {
    const { context } = audioContext();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const audio = new GameAudio();
    await audio.unlock();
    audio.play({ id: 1, kind: "kick", strength: 0.6 });
    expect(context.createOscillator).toHaveBeenCalledOnce();
    audio.play({ id: 2, kind: "whistle", strength: 1 });
    expect(context.createOscillator).toHaveBeenCalledTimes(3);
    audio.dispose();
  });

  it("ships small real recordings with individual CC0 sources", () => {
    for (const file of ["goal-cheer.mp3", "referee-whistle.mp3"]) {
      expect(
        fs.statSync(new URL(`../public/audio/${file}`, import.meta.url)).size,
      ).toBeGreaterThan(8_000);
      expect(
        fs.statSync(new URL(`../public/audio/${file}`, import.meta.url)).size,
      ).toBeLessThan(40_000);
    }
    const licenses = fs.readFileSync(
      new URL("../public/audio/LICENSES.md", import.meta.url),
      "utf8",
    );
    expect(licenses).toContain("CC0 1.0");
    expect(licenses).toContain("/sounds/346685/");
    expect(licenses).toContain("/sounds/218318/");
  });
});

describe("real collision-driven sounds", () => {
  it("ignores rolling floor contacts and grades side-wall impacts by relative speed", async () => {
    const strengths: number[] = [];
    for (const speed of [0.5, 0.8, GAME_CONFIG.ball.maxSpeed]) {
      const physics = await PhysicsWorld.create();
      try {
        for (const rod of physics.rods)
          for (let i = 0; i < rod.body.numColliders(); i++)
            rod.body.collider(i).setEnabled(false);
        physics.ball.setTranslation({ x: 0.8, y: 0.034, z: 0 }, true);
        physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < 120; i++) physics.step(1 / 120, 1.5);
        expect(physics.drainImpacts()).toEqual([]);
        physics.ball.setTranslation({ x: 0.8, y: playingSurfaceHeight(0.8, 0.71) + GAME_CONFIG.ball.radius + 0.0001, z: 0.71 }, true);
        physics.ball.setLinvel({ x: 0, y: 0, z: speed }, true);
        physics.ball.setAngvel({ x: speed / 0.033, y: 0, z: 0 }, true);
        const impacts = [];
        for (let i = 0; i < 0.3 * 120; i++) {
          physics.step(1 / 120, 1.5);
          impacts.push(...physics.drainImpacts());
        }
        expect(impacts[0]?.kind).toBe("wall");
        strengths.push(impacts[0]!.strength);
        expect(impacts.filter((impact) => impact.kind === "wall")).toHaveLength(
          1,
        );
      } finally {
        physics.dispose();
      }
    }
    expect(strengths[1]).toBeGreaterThan(strengths[0]! * 1.25);
    expect(strengths[2]).toBeGreaterThan(strengths[1]! * 1.2);
  });

  it("reports actual rotating foot strength, without treating misses as kicks", async () => {
    const strengths: number[] = [];
    for (const speed of [6, 24]) {
      const physics = await PhysicsWorld.create();
      try {
        const attacker = physics.rods.find(
          (rod) => rod.layout.team === "red" && rod.layout.id === 3,
        )!;
        for (const rod of physics.rods)
          if (rod !== attacker)
            for (let i = 0; i < rod.body.numColliders(); i++)
              rod.body.collider(i).setEnabled(false);
        attacker.state.angle = -0.5;
        attacker.state.velocity = speed;
        attacker.body.setRotation(
          { x: 0, y: 0, z: Math.sin(-0.25), w: Math.cos(-0.25) },
          true,
        );
        physics.ball.setTranslation({ x: 0.75, y: 0.0331, z: 0 }, true);
        physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
        const impacts = [];
        for (let i = 0; i < 15; i++) {
          physics.input("red", {
            sequence: i,
            rodId: 3,
            translation: 0,
            angularVelocity: speed,
            active: true,
          });
          physics.step(1 / 120, 1.5);
          impacts.push(...physics.drainImpacts());
        }
        expect(impacts[0]?.kind).toBe("kick");
        strengths.push(impacts[0]!.strength);
        expect(physics.drainImpacts()).toEqual([]);
        physics.ball.setTranslation({ x: 0, y: 0.0331, z: 0 }, true);
        physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
        for (let i = 0; i < 30; i++) {
          physics.input("red", {
            sequence: 100 + i,
            rodId: 3,
            translation: 0,
            angularVelocity: speed,
            active: true,
          });
          physics.step(1 / 120, 1.5);
        }
        expect(physics.drainImpacts()).toEqual([]);
      } finally {
        physics.dispose();
      }
    }
    expect(strengths[1]).toBeGreaterThan(strengths[0]! * 3);
  });
});

describe("authoritative sound phases", () => {
  it("whistles once, cheers once, and creates no new sound while paused or replaying", async () => {
    vi.stubGlobal("document", {
      addEventListener() {},
      removeEventListener() {},
      hidden: false,
    });
    vi.stubGlobal("requestAnimationFrame", () => 1);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const physics = await PhysicsWorld.create();
    const view = {
      settings() {},
      render() {},
      shake() {},
      dispose() {},
      table: {
        setClubs() {},
        counters: { red: { setScore() {} }, blue: { setScore() {} } },
      },
    };
    const events: GameSoundEvent[] = [];
    const engine = Reflect.construct(GameEngine, [
      physics,
      view,
      () => {},
      undefined,
      (event: GameSoundEvent) => events.push(event),
    ]) as GameEngine;
    const step = (engine as unknown as { step(dt: number): void }).step;
    const tick = (seconds: number) => {
      for (let i = 0; i < Math.ceil(seconds * 120); i++) step(1 / 120);
    };
    const club = {
      id: "test",
      name: "FC",
      country: "Danmark",
      primaryColor: "#ff0000",
      secondaryColor: "#ffffff",
    };
    try {
      engine.start(DEFAULT_SETTINGS, { red: club, blue: club });
      tick(3.1);
      expect(events.filter((event) => event.kind === "whistle")).toHaveLength(
        1,
      );
      engine.pause();
      const paused = events.length;
      tick(5);
      expect(events).toHaveLength(paused);
      engine.resume();
      tick(4);
      expect(events.filter((event) => event.kind === "whistle")).toHaveLength(
        1,
      );
      physics.ball.setTranslation({ x: 1.6, y: 0.05, z: 0 }, true);
      step(1 / 120);
      expect(events.filter((event) => event.kind === "goal")).toHaveLength(1);
      const goal = events.length;
      tick(GAME_CONFIG.match.goalDuration + 0.1);
      expect(engine.snapshot.phase).toBe("replay");
      expect(events).toHaveLength(goal);
      expect(events.map((event) => event.id)).toEqual(
        events.map((_event, i) => i + 1),
      );
    } finally {
      engine.dispose();
    }
  });
});
