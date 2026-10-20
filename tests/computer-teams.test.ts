import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPUTER_LEVELS, ComputerOpponent } from "../game/systems/ComputerOpponent";
import { GameEngine } from "../game/GameEngine";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import { DEFAULT_SETTINGS, type Team } from "../shared/types";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("computer-controlled teams and shared rods", () => {
  it.each((["beginner", "normal", "advanced"] as const).flatMap(level =>
    (["red", "blue"] as const).map(team => ({ level, team }))))(
    "frees its own real downward pin after 250 ms and strikes from the other side as $team $level",
    async ({ level, team }) => {
      const physics = await PhysicsWorld.create();
      const computer = new ComputerOpponent(level, () => 0.5, team, [3]);
      const rod = physics.rods.find(candidate => candidate.layout.team === team && candidate.layout.id === 3)!;
      const index = physics.rods.indexOf(rod);
      const sign = team === "red" ? 1 : -1;
      const observe = () => ({
        ball: { position: physics.ball.translation(), velocity: physics.ball.linvel() },
        rods: [{ id: 3, translation: rod.state.translation, angle: rod.state.angle,
          velocity: rod.state.velocity, pinnedDirection: physics.groundedPinDirection(team, 3) }],
      });
      try {
        for (const other of physics.rods)
          if (other !== rod)
            for (let collider = 0; collider < other.body.numColliders(); collider++) other.body.collider(collider).setEnabled(false);
        rod.state.angle = -sign * 1.2;
        rod.body.setRotation({ x: 0, y: 0, z: Math.sin(rod.state.angle / 2), w: Math.cos(rod.state.angle / 2) }, true);
        const initial = { x: rod.layout.x - sign * 0.1, y: C.ball.radius + 0.0001, z: 0 };
        physics.ball.setTranslation(initial, true);
        physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
        physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
        // Let the computer see the ball before starting the physical stroke.
        for (let tick = 0; tick < Math.ceil(COMPUTER_LEVELS[level].reaction / C.physics.timestep); tick++) computer.update(C.physics.timestep, observe());
        let pinnedAt: number | undefined, reversedAt: number | undefined;
        let oppositeTouch = false;
        for (let tick = 0; tick < 120 * 4; tick++) {
          const now = tick * C.physics.timestep;
          const commands = computer.update(C.physics.timestep, observe());
          const command = commands.find(command => command.rodId === 3)!;
          if (pinnedAt !== undefined && reversedAt === undefined && command.angularVelocity * sign < 0) reversedAt = now;
          if (pinnedAt !== undefined && reversedAt === undefined) {
            expect(Math.hypot(...Object.values(physics.ball.linvel()))).toBe(0);
            expect(command.translation).toBeCloseTo(0);
          }
          for (const action of commands) physics.input(team, action);
          physics.step(C.physics.timestep, 1.5);
          const touches = physics.drainBallTouches();
          if (pinnedAt === undefined && physics.groundedPinDirection(team, 3)) pinnedAt = now;
          if (reversedAt !== undefined && touches.includes(index) && physics.ball.linvel().x * sign < -0.2) {
            oppositeTouch = true;
          }
          // Keep sending the computer's ordinary inputs through the whole
          // recovery, including the frames after the first collision impulse.
          if (oppositeTouch && physics.ball.translation().x * sign < initial.x * sign - 0.05) break;
        }
        expect(pinnedAt).toBeDefined();
        expect(reversedAt).toBeDefined();
        expect(reversedAt! - pinnedAt!).toBeCloseTo(0.25, 8);
        expect(oppositeTouch).toBe(true);
        expect(physics.ball.translation().x * sign).toBeLessThan(initial.x * sign - 0.05);
        expect(physics.rods.filter(candidate => candidate !== rod).every(candidate => candidate.state.translation === 0 && candidate.state.angle === 0)).toBe(true);
      } finally { physics.dispose(); }
    },
  );

  it.each(["red", "blue"] as const)(
    "uses only assigned %s rods and kicks toward its opponent",
    (team) => {
      const computer = new ComputerOpponent(
        "advanced",
        () => 0.5,
        team,
        [2, 3],
      );
      const attacker = ROD_LAYOUT.find(
        (rod) => rod.team === team && rod.id === 3,
      )!;
      const sign = team === "red" ? 1 : -1;
      const observation = {
        ball: {
          position: { x: attacker.x + sign * 0.09, y: 0.033, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        },
        rods: ROD_LAYOUT.filter((rod) => rod.team === team).map((rod) => ({
          id: rod.id,
          translation: 0,
          angle: 0,
          velocity: 0,
        })),
      };
      let input = computer.update(1 / 120, observation);
      for (let i = 0; i < 14; i++)
        input = computer.update(1 / 120, observation);
      expect(input.map((action) => action.rodId).sort()).toEqual([2, 3]);
      expect(
        input.find((action) => action.rodId === 3)!.angularVelocity * sign,
      ).toBeGreaterThan(0);
    },
  );

  it("blocks humans only on computer-owned rods and keeps both computers on their own team", async () => {
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
    const engine = Reflect.construct(GameEngine, [
      physics,
      view,
      () => {},
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
      engine.start(
        {
          ...DEFAULT_SETTINGS,
          teamControls: {
            red: { computer: "defense", level: "normal" },
            blue: { computer: "attack", level: "advanced" },
          },
        },
        { red: club, blue: club },
      );
      tick(4);
      const input = vi.spyOn(physics, "input");
      const action = {
        rodId: 0,
        sequence: 1,
        translation: 0.5,
        angularVelocity: 20,
        active: true,
      };
      engine.input("red", action);
      engine.input("blue", { ...action, rodId: 3 });
      expect(input).not.toHaveBeenCalled();
      engine.input("red", { ...action, rodId: 3 });
      engine.input("blue", action);
      expect(input).toHaveBeenCalledTimes(2);
      input.mockClear();
      tick(0.3);
      expect(input).toHaveBeenCalled();
      for (const [team, command] of input.mock.calls)
        expect(team === "red" ? [0, 1] : [2, 3]).toContain(command.rodId);
      engine.pause();
      input.mockClear();
      tick(1);
      expect(input).not.toHaveBeenCalled();
    } finally {
      engine.dispose();
    }
  });

  it.each(["red", "blue"] as const)(
    "makes a real %s computer foot strike using only its own assigned rod",
    async (team: Team) => {
      const physics = await PhysicsWorld.create();
      const computer = new ComputerOpponent("advanced", () => 0.5, team, [3]);
      const attacker = physics.rods.find(
        (rod) => rod.layout.team === team && rod.layout.id === 3,
      )!;
      const sign = team === "red" ? 1 : -1;
      const appliedInputs = vi.spyOn(physics, "input");
      const contacted = new Set<number>();
      const start = attacker.layout.x + sign * 0.09;
      physics.ball.setTranslation({ x: start, y: 0.0331, z: 0 }, true);
      physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      let furthest = start * sign;
      try {
        for (let i = 0; i < 120; i++) {
          const commands = computer.update(C.physics.timestep, {
            ball: {
              position: physics.ball.translation(),
              velocity: physics.ball.linvel(),
            },
            rods: physics.rods
              .filter((rod) => rod.layout.team === team)
              .map((rod) => ({
                id: rod.layout.id,
                translation: rod.state.translation,
                angle: rod.state.angle,
                velocity: rod.state.velocity,
              })),
          });
          for (const input of commands) physics.input(team, input);
          physics.step(C.physics.timestep, 1.5);
          for (const index of physics.drainBallTouches()) contacted.add(index);
          for (const [index, rod] of physics.rods.entries()) {
            if (rod.layout.team === team) continue;
            // An unheld opponent may yield to a real ball collision, but the
            // computer neither commands it nor moves it without that contact.
            expect(rod.state.active).toBe(false);
            expect(rod.state.translation).toBe(0);
            if (Math.abs(rod.state.angle) > 1e-5) expect(contacted.has(index)).toBe(true);
          }
          furthest = Math.max(furthest, physics.ball.translation().x * sign);
        }
        expect(furthest).toBeGreaterThan(start * sign + 0.1);
        expect(contacted.has(physics.rods.indexOf(attacker))).toBe(true);
        expect(appliedInputs).toHaveBeenCalled();
        for (const [controlledTeam, command] of appliedInputs.mock.calls) {
          expect(controlledTeam).toBe(team);
          expect(command.rodId).toBe(3);
        }
      } finally {
        physics.dispose();
      }
    },
  );
});
