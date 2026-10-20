import { describe, expect, it, vi } from "vitest";
import { COMPUTER_LEVELS, ComputerOpponent, predictedBallZ, type ComputerLevel, type ComputerObservation } from "../game/systems/ComputerOpponent";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import { GameEngine } from "../game/GameEngine";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import { advanceRod, applyRodInput, createRodState } from "../game/systems/GameRules";
import { DEFAULT_SETTINGS, type FootballClub, type Team } from "../shared/types";

const dt = C.physics.timestep;
const levels: ComputerLevel[] = ["beginner", "normal", "advanced"];
function observation(x = -0.75, z = 0, team: Team = "blue"): ComputerObservation {
  return {
    ball: { position: { x, y: 0.033, z }, velocity: { x: 0, y: 0, z: 0 } },
    rods: ROD_LAYOUT.filter((rod) => rod.team === team).map((rod) => ({
      id: rod.id, translation: 0, angle: 0, velocity: 0,
    })),
  };
}

describe("computer opponent decisions", () => {
  it.each(levels.flatMap(level => (["red", "blue"] as const).map(team => ({ level, team }))))(
    "reverses its own stationary downward pin after 250 ms at $level on $team",
    ({ level, team }) => {
      const sign = team === "red" ? 1 : -1;
      const layout = ROD_LAYOUT.find(rod => rod.team === team && rod.id === 3)!;
      const computer = new ComputerOpponent(level, () => 0.5, team, [3]);
      const pose = observation(layout.x - sign * 0.1, 0, team);
      pose.rods = [{ id: 3, translation: 0, angle: -sign * 0.8, velocity: 0, pinnedDirection: sign }];
      for (let tick = 1; tick < 30; tick++) {
        const action = computer.update(dt, pose).find(action => action.rodId === 3)!;
        expect(action.angularVelocity * sign).toBeGreaterThanOrEqual(0);
      }
      const reversed = computer.update(dt, pose).find(action => action.rodId === 3)!;
      expect(reversed.angularVelocity).toBe(-sign * COMPUTER_LEVELS[level].shotSpeed);
      expect(reversed.translation).toBe(0);
      expect(reversed.active).toBe(true);
      // Reset clears felt contact/recovery, including the ordinary reaction timer.
      computer.reset();
      pose.rods[0]!.pinnedDirection = undefined;
      expect(computer.update(dt, pose)).toEqual([]);
    },
  );

  it("requires a continuous real pin, ignores moving and airborne balls, and never recovers someone else's rod", () => {
    const computer = new ComputerOpponent("advanced", () => 0.5, "red", [3]);
    const layout = ROD_LAYOUT.find(rod => rod.team === "red" && rod.id === 3)!;
    const pose = observation(layout.x - 0.1, 0, "red");
    pose.rods = [{ id: 3, translation: 0, angle: -0.8, velocity: 0, pinnedDirection: 1 }];
    for (let tick = 0; tick < 20; tick++) computer.update(dt, pose);
    pose.ball.velocity.x = C.ball.stuckSpeed + 0.001;
    for (let tick = 0; tick < 50; tick++) computer.update(dt, pose);
    pose.ball.velocity.x = 0;
    pose.ball.position.y = 0.4;
    for (let tick = 0; tick < 50; tick++) {
      const action = computer.update(dt, pose).find(action => action.rodId === 3)!;
      expect(action.angularVelocity).toBeGreaterThanOrEqual(0);
    }
    pose.ball.position.y = C.ball.radius;
    for (let tick = 0; tick < 29; tick++) {
      const action = computer.update(dt, pose).find(action => action.rodId === 3)!;
      expect(action.angularVelocity).toBeGreaterThanOrEqual(0);
    }
    expect(computer.update(dt, pose).find(action => action.rodId === 3)!.angularVelocity).toBeLessThan(0);
    const other = new ComputerOpponent("beginner", () => 0.5, "red", [0]);
    for (let tick = 0; tick < 120; tick++) expect(other.update(dt, pose)).toEqual([]);
  });

  it.each(levels)("uses delayed perception and ordinary bounded blue-rod inputs at %s", (level) => {
    const computer = new ComputerOpponent(level, () => 0.5);
    const pose = observation();
    for (let i = 0; i < Math.floor(COMPUTER_LEVELS[level].reaction / dt); i++)
      expect(computer.update(dt, pose)).toEqual([]);
    const actions = computer.update(dt, pose);
    expect(actions).toHaveLength(level === "advanced" ? 2 : 1);
    expect(actions.every(action=>[0,1,2,3].includes(action.rodId))).toBe(true);
    expect(actions.filter((action) => action.active)).toHaveLength(level === "advanced" ? 2 : 1);
    expect(actions.find((action) => action.rodId === 3)!.angularVelocity).toBe(-COMPUTER_LEVELS[level].shotSpeed);
    for (const action of actions) {
      expect(Math.abs(action.translation)).toBeLessThanOrEqual(1);
      expect(Math.abs(action.angularVelocity)).toBeLessThanOrEqual(C.rods.maxAngularVelocity);
      expect(action.flick).toBeUndefined();
    }
    computer.reset();
    expect(computer.update(dt, pose)).toEqual([]);
  });

  it.each([
    ["red", [0, 1, 2, 3]],
    ["blue", [0, 1, 2, 3]],
    ["red", [0, 1]],
    ["blue", [0, 1]],
    ["red", [2, 3]],
    ["blue", [2, 3]],
  ] as const)("moves only one beginner rod at a time for %s with rods %j", (team, rodIds) => {
    const computer = new ComputerOpponent("beginner", () => 0.5, team, rodIds);
    const layouts = ROD_LAYOUT.filter((rod) => rod.team === team && (rodIds as readonly number[]).includes(rod.id));
    const states = new Map(layouts.map((layout) => [layout.id, createRodState()]));
    const pose = observation(0, 0.11, team);
    const selected = new Set<number>();
    for (const nearest of layouts) {
      pose.ball.position.x = nearest.x;
      for (let i = 0; i < Math.ceil((COMPUTER_LEVELS.beginner.reaction + COMPUTER_LEVELS.beginner.switchDelay + 0.4) / dt); i++) {
        pose.rods = layouts.map((layout) => ({ id: layout.id, ...states.get(layout.id)! }));
        const actions = computer.update(dt, pose);
        if (!actions.length) continue;
        expect(actions.filter((action) => action.active)).toHaveLength(1);
        for (const action of actions) {
          const layout = layouts.find((layout) => layout.id === action.rodId)!;
          const state = states.get(action.rodId)!;
          const before = state.translation;
          applyRodInput(state, action, layout.travel);
          if (!action.active) {
            expect(state.target).toBe(before);
            expect(state.desiredVelocity).toBe(0);
          }
          advanceRod(state, dt, DEFAULT_SETTINGS.rotationDamping);
          if (!action.active) expect(state.translation).toBe(before);
        }
        expect(Array.from(states.values()).filter((state) => state.active)).toHaveLength(1);
      }
      const active = layouts.filter((layout) => states.get(layout.id)!.active);
      expect(active.map((layout) => layout.id)).toEqual([nearest.id]);
      selected.add(active[0]!.id);
    }
    expect(selected).toEqual(new Set(rodIds));
  });

  it("does not select unobserved or unassigned beginner rods", () => {
    const pose = observation();
    pose.rods = [];
    const missing = new ComputerOpponent("beginner", () => 0.5);
    const unassigned = new ComputerOpponent("beginner", () => 0.5, "blue", []);
    for (let i = 0; i < 60; i++) {
      expect(missing.update(dt, pose)).toEqual([]);
      expect(unassigned.update(dt, observation())).toEqual([]);
    }
  });

  it("makes advanced opponents react sooner, move faster and aim more accurately", () => {
    const goalkeeperTravel = ROD_LAYOUT.find((rod) => rod.team === "blue" && rod.id === 0)!.travel;
    const results = levels.map((level) => {
      const computer = new ComputerOpponent(level, () => 1);
      const pose = observation(1.23, 0.12);
      let first = Infinity;
      let firstMovement = 0;
      let target = 0;
      for (let i = 0; i < 180; i++) {
        const actions = computer.update(dt, pose);
        const goalkeeper = actions.find((action) => action.rodId === 0);
        if (!goalkeeper) continue;
        const physical = goalkeeper.translation * goalkeeperTravel;
        if (!Number.isFinite(first)) {
          first = (i + 1) * dt;
          firstMovement = physical;
        }
        pose.rods = pose.rods.map((rod) => rod.id === 0 ? { ...rod, translation: physical } : rod);
        target = physical;
      }
      return { first, firstMovement, miss: Math.abs(target - pose.ball.position.z) };
    });
    expect(results[0]!.first).toBeGreaterThan(results[1]!.first);
    expect(results[1]!.first).toBeGreaterThan(results[2]!.first);
    expect(results[2]!.firstMovement).toBeGreaterThan(results[1]!.firstMovement);
    expect(results[1]!.firstMovement).toBeGreaterThan(results[0]!.firstMovement);
    expect(results[0]!.miss).toBeGreaterThan(results[1]!.miss);
    expect(results[1]!.miss).toBeGreaterThan(results[2]!.miss);
  });

  it.each([["beginner",1,1],["normal",0.5,1],["advanced",0.25,2]] as const)("respects the %s switch delay and active rod budget",(level,delay,budget)=>{
    const computer=new ComputerOpponent(level,()=>.5,"red");
    const pose=observation(-1.3,0.16,"red");
    let time=0,previous="",lastSwitch=-Infinity,switches=0;
    for(let frame=0;frame<120*8;frame++){
      time+=dt;
      pose.ball.position.x=frame%360<180 ? -1.3 : .75;
      const actions=computer.update(dt,pose);
      const selected=actions.filter(action=>action.active).map(action=>action.rodId).sort().join();
      if(!selected) continue;
      expect(actions.filter(action=>action.active).length).toBeLessThanOrEqual(budget);
      if(selected!==previous){expect(time-lastSwitch).toBeGreaterThanOrEqual(delay-2*dt);lastSwitch=time;previous=selected;switches++;}
    }
    expect(switches).toBeGreaterThan(2);
  });
  it("holds its aiming error instead of drawing new jitter every decision",()=>{
    const random=vi.fn(()=>.6);const computer=new ComputerOpponent("beginner",random,"red",[0]);
    const pose=observation(-1.3,.12,"red");let previousSpeed=0,previous=0;
    const travel=ROD_LAYOUT.find(rod=>rod.team==="red"&&rod.id===0)!.travel;
    for(let frame=0;frame<120*4;frame++){
      for(const action of computer.update(dt,pose)){
        const translated=action.translation*travel;
        const speed=(translated-previous)/dt;
        expect(Math.abs(speed-previousSpeed)).toBeLessThanOrEqual(2*dt+1e-6);
        previous=translated;previousSpeed=speed;
        pose.rods=pose.rods.map(rod=>rod.id===0?{...rod,translation:translated}:rod);
      }
    }
    expect(random).toHaveBeenCalledOnce();
    expect(Math.abs(previousSpeed)).toBeLessThan(.002);
  });

  it("predicts a side-band bounce without reading or moving a physics body", () => {
    const position = { x: 0, y: 0.033, z: 0.65 };
    const velocity = { x: 2, y: 0, z: 1 };
    const predicted = predictedBallZ(position, velocity, 1, 0.6);
    expect(predicted).toBeCloseTo(2 * (C.table.halfWidth - C.ball.radius) - 1.15);
    expect(position).toEqual({ x: 0, y: 0.033, z: 0.65 });
  });

  it("does not kick at a distant or airborne ball and returns raised feet toward neutral", () => {
    const computer = new ComputerOpponent("advanced", () => 0.5);
    const pose = observation(0);
    pose.ball.position.y = 0.5;
    pose.rods = pose.rods.map((rod) => ({ ...rod, angle: 0.6 }));
    let actions = computer.update(dt, pose);
    for (let i = 0; i < 20; i++) actions = computer.update(dt, pose);
    expect(actions).toHaveLength(2);
    for (const action of actions) expect(action.angularVelocity).toBeCloseTo(-4.8);
  });
});

async function game(level: ComputerLevel) {
  const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.stubGlobal("document", { addEventListener() {}, removeEventListener() {}, hidden: false });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  const physics = await PhysicsWorld.create();
  const view = {
    settings() {}, shake() {}, dispose() {}, render() {},
    table: { setClubs() {}, counters: { red: { setScore() {} }, blue: { setScore() {} } } },
  };
  const engine = Reflect.construct(GameEngine, [physics, view, () => {}]) as GameEngine;
  const club: FootballClub = { id: "test", name: "Test", country: "Danmark", primaryColor: "#ff0000", secondaryColor: "#ffffff" };
  engine.start({ ...DEFAULT_SETTINGS, computerOpponent: level, playerCount: 1 }, { red: club, blue: club });
  const step = (engine as unknown as { step(dt: number): void }).step;
  const tick = (seconds: number) => { for (let i = 0; i < Math.ceil(seconds / dt); i++) step(dt); };
  return {
    engine, physics, step, tick,
    dispose() { engine.dispose(); random.mockRestore(); vi.unstubAllGlobals(); },
  };
}

describe("authoritative computer play", () => {
  it.each(levels)("hits a real ball using the same rod physics at %s", async (level) => {
    const match = await game(level);
    try {
      match.tick(3.75);
      expect(match.engine.snapshot.phase).toBe("playing");
      match.physics.ball.setTranslation({ x: -0.75, y: 0.0331, z: 0 }, true);
      match.physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      match.physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      const input = vi.spyOn(match.physics, "input");
      let furthest = -0.75;
      for (let i = 0; i < 240; i++) {
        match.step(dt);
        furthest = Math.min(furthest, match.physics.ball.translation().x);
      }
      expect(input.mock.calls.some(([team]) => team === "blue")).toBe(true);
      expect(furthest).toBeLessThan(-0.85);
      const attacker = match.physics.rods.find((rod) => rod.layout.team === "blue" && rod.layout.id === 3)!;
      expect(Math.abs(attacker.state.angle)).toBeGreaterThan(0.1);
    } finally { match.dispose(); }
  });

  it("freezes computer inputs during pause, countdown and replay and blocks human blue commands", async () => {
    const match = await game("advanced");
    try {
      const input = vi.spyOn(match.physics, "input");
      match.tick(1);
      expect(input).not.toHaveBeenCalled();
      match.tick(3);
      input.mockClear();
      match.engine.input("blue", { rodId: 0, sequence: 1, translation: 1, angularVelocity: 35, active: true });
      expect(input).not.toHaveBeenCalled();
      match.engine.pause();
      const ball = match.physics.ball.translation();
      const angles = match.physics.rods.map((rod) => rod.state.angle);
      match.tick(2);
      expect(input).not.toHaveBeenCalled();
      expect(match.physics.ball.translation()).toEqual(ball);
      expect(match.physics.rods.map((rod) => rod.state.angle)).toEqual(angles);
      match.engine.resume();
      match.tick(3);
      expect(input).not.toHaveBeenCalled();
      match.tick(0.3);
      expect(input).toHaveBeenCalled();
      match.physics.ball.setTranslation({ x: 1.6, y: 0.04, z: 0 }, true);
      match.step(dt);
      expect(match.engine.snapshot.phase).toBe("goal");
      input.mockClear();
      match.tick(C.match.goalDuration + 0.4);
      expect(match.engine.snapshot.phase).toBe("replay");
      expect(input).not.toHaveBeenCalled();
      match.engine.reset();
      input.mockClear();
      match.tick(2);
      expect(input).not.toHaveBeenCalled();
    } finally { match.dispose(); }
  });
});
