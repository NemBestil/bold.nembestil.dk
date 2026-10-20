import { afterEach, describe, expect, it, vi } from "vitest";
import { GameEngine } from "../game/GameEngine";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import { SessionManager, type Admission } from "../network/SessionManager";
import type { FootballClub, MatchSettings, MatchSnapshot, Team } from "../shared/types";

const club: FootballClub = {
  id: "integration-club", name: "Integration FC", country: "Danmark",
  primaryColor: "#ff0000", secondaryColor: "#ffffff",
};
const now = 100_000;
const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Keep the actual session permissions, match lifecycle and Rapier world together. */
async function match(settings: Partial<MatchSettings>, teams: Team[]) {
  vi.spyOn(Math,"random").mockReturnValue(0.5);
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, hidden: false });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  let engine: GameEngine;
  let id = 0;
  const manager = new SessionManager("integration", {
    onState() {},
    onStart: (settings, clubs) => engine.start(settings, clubs),
    onInput: (team, input) => engine.input(team, input),
    onBump: () => engine.bump(),
    onPause: () => engine.pause(),
    onResume: () => engine.resume(),
    onReset: () => engine.reset(),
  }, () => `participant-${++id}`);
  expect(manager.configureLobbySettings(settings).ok).toBe(true);
  const physics = await PhysicsWorld.create();
  const view = {
    settings() {}, shake() {}, dispose() {}, render() {},
    table: {
      ball: { position: { set() {} }, quaternion: { set() {} } },
      rods: physics.rods.map(() => ({ position: { z: 0 }, rotation: { z: 0 } })),
      setClubs() {},
      counters: { red: { setScore() {} }, blue: { setScore() {} } },
    },
  };
  engine = Reflect.construct(GameEngine, [physics, view, (snapshot: MatchSnapshot) => manager.setMatch(snapshot)]) as GameEngine;
  cleanup.push(() => { engine.dispose(); manager.dispose(); });
  const players = teams.map((team) => {
    const admission = manager.admit(undefined, now) as Admission;
    expect(admission.playerId).toBeTruthy();
    const before=manager.state.players.filter(p=>!p.computer&&p.team===team);
    expect(manager.handle(admission.playerId, { type: "reserve-seat", team, role: before.length ? "attack" : "defense" }, now).ok).toBe(true);
    if(teams.filter(candidate=>candidate===team).length===1) manager.handle(admission.playerId,{type:"reserve-seat",team,role:"attack"},now);
    if(!before.length) expect(manager.handle(admission.playerId,{type:"team-name",name:club.name},now).ok).toBe(true);
    return admission;
  });
  expect(manager.handle(players[0]!.playerId,{type:"start-match"},now).ok).toBe(true);
  const step = (engine as unknown as { step(dt: number): void }).step;
  const tick = (seconds: number) => {
    for (let i = 0; i < Math.ceil(seconds / C.physics.timestep); i++) step(C.physics.timestep);
  };
  tick(4);
  expect(engine.snapshot.phase).toBe("playing");
  expect(manager.state.match.phase).toBe("playing");
  physics.ball.setTranslation({ x: 0, y: C.ball.radius + 0.01, z: 0.6 }, true);
  physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  return { manager, engine, physics, players, tick };
}

describe("multiplayer sessions with authoritative physics", () => {
  it.each([3, 4] as const)("delivers a fast flick only to its owner's rod in a %i-phone match", async (playerCount) => {
    const teams: Team[] = playerCount === 3 ? ["red", "red", "blue"] : ["red", "red", "blue", "blue"];
    const { manager, physics, players, tick } = await match({ playerCount }, teams);
    expect(manager.state.players.find((p) => p.id === players[0]!.playerId)?.rodIds).toEqual([0, 1]);
    expect(manager.state.players.find((p) => p.id === players[1]!.playerId)?.rodIds).toEqual([2, 3]);
    if (playerCount === 3)
      expect(manager.state.players.find((p) => p.id === players[2]!.playerId)?.rodIds).toEqual([0, 1, 2, 3]);
    const flick = {
      type: "rod-input", sequence: 1, rodId: 2, translation: 0.7,
      angularVelocity: 16, active: false, flick: true,
    };
    const rod = physics.rods.find((r) => r.layout.team === "red" && r.layout.id === 2)!;
    expect(manager.handle(players[0]!.playerId, flick, now).code).toBe("rod-not-owned");
    expect(rod.state.velocity).toBe(0);
    expect(manager.handle(players[1]!.playerId, flick, now).ok).toBe(true);
    // The release must retain momentum even without a single intervening physics tick.
    expect(rod.state.velocity).toBe(16);
    // A second finger crossing the rod sees an older frame. Its spin must not
    // replace the first finger's just-committed vertical destination.
    expect(manager.handle(players[1]!.playerId, {
      ...flick, sequence: 2, translation: 0, angularVelocity: 20, rotationOnly: true,
    }, now + 1).ok).toBe(true);
    expect(rod.state.target).toBeCloseTo(0.7 * rod.layout.travel);
    expect(rod.state.velocity).toBe(20);
    tick(0.025);
    expect(rod.state.angle).toBeGreaterThan(0.2);
    expect(rod.state.translation).toBeGreaterThan(0);
    expect(physics.rods.filter((r) => r.layout.team === "blue").every((r) => r.state.velocity === 0)).toBe(true);
  });

  it("pauses a shared-team game on disconnect and waits for every human to reconnect and ready", async () => {
    const { manager, engine, physics, players, tick } = await match({ playerCount: 4 }, ["red", "red", "blue", "blue"]);
    manager.disconnect(players[1]!.playerId, now + 10);
    expect(engine.snapshot.phase).toBe("paused");
    const ball = physics.ball.translation();
    tick(1);
    expect(physics.ball.translation()).toEqual(ball);
    for (const player of [players[0]!, players[2]!, players[3]!])
      manager.handle(player.playerId, { type: "set-ready", ready: true }, now + 20);
    expect(engine.snapshot.phase).toBe("paused");
    expect(manager.admit(players[1]!.token, now + 30)).toMatchObject({ reconnected: true });
    expect(manager.state.players.find((p) => p.id === players[1]!.playerId)?.rodIds).toEqual([2, 3]);
    manager.handle(players[0]!.playerId, { type: "start-match" }, now + 40);
    expect(engine.snapshot.phase).toBe("countdown");
    tick(C.match.countdownDuration + 0.05);
    expect(engine.snapshot.phase).toBe("playing");
  });

  it("starts one phone against the computer and moves real blue rods only while playing", async () => {
    const { manager, engine, physics, players, tick } = await match({ playerCount: 1, computerOpponent: "normal" }, ["red"]);
    expect(players).toHaveLength(1);
    expect(manager.state.players.find((p) => p.computer)).toMatchObject({
      team: "blue", connected: true, ready: true, rodIds: [0, 1, 2, 3],
    });
    physics.ball.setTranslation({ x: 0.95, y: C.ball.radius + 0.01, z: 0.4 }, true);
    tick(2);
    expect(physics.rods.some((r) => r.layout.team === "blue" && Math.abs(r.state.translation) > 0.02)).toBe(true);
    expect(physics.rods.filter((r) => r.layout.team === "red").every((r) => r.state.translation === 0)).toBe(true);
    expect(manager.handle(players[0]!.playerId, { type: "pause", paused: true }, now + 500).ok).toBe(true);
    const poses = physics.rods.map((r) => ({ angle: r.state.angle, translation: r.state.translation }));
    tick(2);
    expect(physics.rods.map((r) => ({ angle: r.state.angle, translation: r.state.translation }))).toEqual(poses);
    expect(engine.snapshot.phase).toBe("paused");
  });
});
