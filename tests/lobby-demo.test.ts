import { afterEach, describe, expect, it, vi } from "vitest";
import { Quaternion, Vector3 } from "three";
import { GameEngine } from "../game/GameEngine";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { GameAudio } from "../game/audio/GameAudio";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import { ComputerOpponent } from "../game/systems/ComputerOpponent";
import { isOutOfBounds } from "../game/systems/GameRules";
import { LobbyDemo } from "../game/systems/LobbyDemo";
import {
  DEFAULT_SETTINGS,
  INITIAL_MATCH,
  type FootballClub,
  type Team,
} from "../shared/types";

const dt = C.physics.timestep;
const club: FootballClub = {
  id: "test",
  name: "Test FC",
  country: "Danmark",
  primaryColor: "#ff0000",
  secondaryColor: "#ffffff",
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function placeBall(physics: PhysicsWorld, x: number, y = 0.04, z = 0) {
  physics.ball.setTranslation({ x, y, z }, true);
  physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

async function game() {
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  const listeners = new Map<string, () => void>();
  const document = {
    hidden: false,
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const physics = await PhysicsWorld.create();
  const view = {
    settings: vi.fn(),
    render: vi.fn(),
    shake: vi.fn(),
    dispose: vi.fn(),
    table: {
      setClubs: vi.fn(),
      getKits: () => ({
        red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" },
        blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" },
      }),
      ball: { position: new Vector3(), quaternion: new Quaternion() },
      rods: physics.rods.map(() => ({ position: new Vector3(), rotation: { z: 0 } })),
      counters: {
        red: { setScore: vi.fn() },
        blue: { setScore: vi.fn() },
      },
    },
  };
  const snapshot = vi.fn(), frame = vi.fn(), sound = vi.fn();
  const engine = Reflect.construct(GameEngine, [physics, view, snapshot, frame, sound]) as GameEngine;
  const internal = engine as unknown as { step(dt: number): void; render(dt: number): void };
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.ceil(seconds / dt); i++) internal.step(dt);
  };
  const score = (team: Team) => {
    placeBall(physics, team === "red" ? 1.6 : -1.6);
    internal.step(dt);
  };
  return { engine, physics, view, snapshot, frame, sound, document, listeners, internal, tick, score };
}

describe("quiet lobby demonstration", () => {
  it("plays both beginner teams while retaining the lobby and streaming its pose to spectator screens", async () => {
    const match = await game();
    const play = vi.spyOn(GameAudio.prototype, "play");
    const computer = vi.spyOn(ComputerOpponent.prototype, "update");
    try {
      match.engine.startLobbyDemo();
      match.engine.updateSettings({
        ...DEFAULT_SETTINGS,
        goalsToWin: 10,
        graphics: "low",
        teamControls: {
          red: { computer: "full", level: "advanced" },
          blue: { computer: "full", level: "normal" },
        },
      });
      placeBall(match.physics, 0, 0.04, 0.12);
      match.tick(1);
      const opponents = new Set(computer.mock.contexts.map((opponent) => `${opponent.team}:${opponent.level}`));
      expect(opponents).toEqual(new Set(["red:beginner", "blue:beginner"]));
      for (const result of computer.mock.results) {
        expect(result.type).toBe("return");
        expect(result.value.filter((input: { active: boolean }) => input.active).length).toBeLessThanOrEqual(1);
      }
      for (const team of ["red", "blue"] as const)
        expect(match.physics.rods.filter((rod) => rod.layout.team === team && rod.state.active)).toHaveLength(1);
      expect(match.physics.rods.some((rod) => Math.abs(rod.state.translation) > 0.01)).toBe(true);
      expect(match.engine.snapshot).toEqual(INITIAL_MATCH);
      expect(match.snapshot.mock.calls.every(([snapshot]) => snapshot.phase === "lobby")).toBe(true);
      match.internal.render(1 / 60);
      expect(match.view.render).toHaveBeenLastCalledWith(1 / 60, "lobby", undefined);
      expect(match.frame).toHaveBeenCalledWith(expect.objectContaining({phase:"lobby",scores:expect.any(Object),goalsToWin:5}));
      expect(match.sound).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(match.view.shake).not.toHaveBeenCalled();
      expect(match.view.settings).toHaveBeenLastCalledWith(expect.objectContaining({ graphics: "low" }));
    } finally {
      match.engine.dispose();
    }
  });

  it("counts on the table and resets both scores at five without goal, replay or countdown presentation", async () => {
    const match = await game();
    const play = vi.spyOn(GameAudio.prototype, "play");
    try {
      match.engine.startLobbyDemo();
      match.score("blue");
      match.score("blue");
      for (let score = 1; score <= 5; score++) {
        match.score("red");
        expect(match.view.table.counters.red.setScore.mock.calls.at(-1)?.slice(0, 2))
          .toEqual([score === 5 ? 0 : score, 5]);
        expect(match.engine.snapshot).toEqual(INITIAL_MATCH);
        expect(isOutOfBounds(match.physics.ball.translation())).toBe(false);
      }
      expect(match.view.table.counters.blue.setScore.mock.calls.at(-1)?.slice(0, 2)).toEqual([0, 5]);
      match.tick(0.3);
      match.internal.render(1 / 60);
      expect(match.snapshot.mock.calls.every(([snapshot]) => snapshot.phase === "lobby" && !snapshot.replay && snapshot.winner === null)).toBe(true);
      expect(match.view.render).toHaveBeenLastCalledWith(1 / 60, "lobby", undefined);
      expect(match.frame).toHaveBeenCalledWith(expect.objectContaining({phase:"lobby",scores:expect.any(Object),goalsToWin:5}));
      expect(match.sound).not.toHaveBeenCalled();
      expect(play).not.toHaveBeenCalled();
      expect(match.view.shake).not.toHaveBeenCalled();
    } finally {
      match.engine.dispose();
    }
  });

  it("hands control to an ordinary match and restores a fresh demo on returning to the lobby", async () => {
    const match = await game();
    const computer = vi.spyOn(ComputerOpponent.prototype, "update");
    try {
      match.engine.startLobbyDemo();
      match.score("red");
      match.tick(0.4);
      computer.mockClear();
      match.engine.start({ ...DEFAULT_SETTINGS, goalsToWin: 10 }, { red: club, blue: club });
      expect(match.engine.snapshot.phase).toBe("countdown");
      expect(match.engine.snapshot.scores).toEqual({ red: 0, blue: 0 });
      match.tick(4);
      expect(match.engine.snapshot.phase).toBe("playing");
      expect(computer).not.toHaveBeenCalled();
      expect(match.sound.mock.calls.some(([event]) => event.kind === "whistle")).toBe(true);
      match.internal.render(1 / 60);
      expect(match.frame).toHaveBeenCalled();
      match.score("red");
      expect(match.engine.snapshot.phase).toBe("goal");
      expect(match.sound.mock.calls.some(([event]) => event.kind === "goal")).toBe(true);

      match.engine.reset();
      match.frame.mockClear();
      match.sound.mockClear();
      computer.mockClear();
      match.tick(0.4);
      match.internal.render(1 / 60);
      expect(match.engine.snapshot).toEqual(INITIAL_MATCH);
      expect(new Set(computer.mock.contexts.map((opponent) => `${opponent.team}:${opponent.level}`)))
        .toEqual(new Set(["red:beginner", "blue:beginner"]));
      expect(match.view.table.counters.red.setScore.mock.calls.at(-1)?.slice(0, 2)).toEqual([0, 5]);
      expect(match.frame).toHaveBeenCalledWith(expect.objectContaining({phase:"lobby",scores:expect.any(Object),goalsToWin:5}));
      expect(match.sound).not.toHaveBeenCalled();
    } finally {
      match.engine.dispose();
    }
  });

  it("freezes the background demonstration in hidden tabs without changing the public lobby", async () => {
    const match = await game();
    try {
      match.engine.startLobbyDemo();
      match.tick(0.4);
      match.document.hidden = true;
      match.listeners.get("visibilitychange")?.();
      const ball = match.physics.ball.translation();
      const rods = match.physics.rods.map((rod) => ({ ...rod.state }));
      match.tick(2);
      expect(match.physics.ball.translation()).toEqual(ball);
      expect(match.physics.rods.map((rod) => rod.state)).toEqual(rods);
      expect(match.engine.snapshot).toEqual(INITIAL_MATCH);
      match.document.hidden = false;
      match.listeners.get("visibilitychange")?.();
      match.tick(0.2);
      expect(match.physics.ball.translation()).not.toEqual(ball);
    } finally {
      match.engine.dispose();
    }
  });

  it("quietly serves another ball when one escapes or remains stuck", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const physics = await PhysicsWorld.create();
    const serve = vi.spyOn(physics, "serve");
    const demo = new LobbyDemo(physics);
    try {
      serve.mockClear();
      placeBall(physics, 0, -1);
      expect(demo.step(dt)).toBe(false);
      expect(serve).toHaveBeenCalledTimes(1);
      expect(isOutOfBounds(physics.ball.translation())).toBe(false);
      serve.mockClear();
      placeBall(physics, 0, C.ball.radius);
      for (let i = 0; i < 12 / dt && !serve.mock.calls.length; i++) demo.step(dt);
      expect(serve).toHaveBeenCalled();
      expect(demo.scores).toEqual({ red: 0, blue: 0 });
    } finally {
      physics.dispose();
    }
  });
});
