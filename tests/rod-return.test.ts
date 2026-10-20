import { describe, expect, it } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { advanceRod, applyRodInput, createRodState } from "../game/systems/GameRules";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";

describe("released figures return to foot-down", () => {
  it.each([0.4, 1.5, 4])("settles all release angles and momentum within three seconds at damping %s", (damping) => {
    for (const angle of [0, 0.3, Math.PI / 2, Math.PI, Math.PI + 0.001, 5, Math.PI * 9])
      for (const velocity of [-35, -20, 0, 20, 35]) {
        const state = createRodState();
        state.angle = angle;
        state.velocity = velocity;
        let previous = angle;
        for (let i = 0; i < 360; i++) {
          advanceRod(state, C.physics.timestep, damping);
          // Falling uses continuous rotation, including complete turns.
          expect(Math.abs(state.angle - previous)).toBeLessThan(0.4);
          previous = state.angle;
        }
        expect(Math.abs(Math.sin(state.angle / 2))).toBeLessThan(0.001);
        expect(state.velocity).toBe(0);
      }
  });

  it("lets an exactly upright figure fall without jumping its angle", () => {
    const state = createRodState();
    state.angle = Math.PI;
    advanceRod(state, C.physics.timestep, 1.5);
    expect(state.angle).toBeLessThan(Math.PI);
    expect(state.angle).toBeGreaterThan(Math.PI - 0.01);
    for (let i = 1; i < 360; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.angle).toBe(0);
  });

  it("leaves an actively held upright rod under the player's control", () => {
    const state = createRodState();
    state.angle = Math.PI;
    for (let i = 0; i < 360; i++) {
      applyRodInput(state, { sequence: i, rodId: 0, translation: 0, angularVelocity: 0, active: true }, 0.59);
      advanceRod(state, C.physics.timestep, 1.5);
    }
    expect(state.angle).toBe(Math.PI);
    expect(state.active).toBe(true);
  });

  it("falls after a stale active input and preserves momentum on an ordinary release", () => {
    const state = createRodState();
    state.angle = Math.PI / 2;
    applyRodInput(state, { sequence: 1, rodId: 0, translation: 0, angularVelocity: 0, active: true }, 0.59);
    for (let i = 0; i < 390; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.active).toBe(false);
    expect(state.velocity).toBe(0);
    expect(state.angle).toBe(0);
    state.velocity = 24;
    applyRodInput(state, { sequence: 2, rodId: 0, translation: 0, angularVelocity: 0, active: false }, 0.59);
    expect(state.velocity).toBe(24);
  });
});

describe("upside-down figure parking", () => {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const input = (active: boolean, angularVelocity = 0) => ({
    rodId: 0, translation: 0, angularVelocity, active,
  });

  it.each([170, 175, 180, 185, 190, -170, -180, -190, 540, -540])(
    "parks a figure released at %s° until another touch, without snapping its angle",
    (degrees) => {
      const state = createRodState();
      state.angle = radians(degrees);
      state.translation = 0.12;
      applyRodInput(state, input(true), 0.25);
      state.velocity = 6;
      applyRodInput(state, input(false), 0.25);
      for (let i = 0; i < 3600; i++) advanceRod(state, C.physics.timestep, 1.5);
      expect(state.angle).toBe(radians(degrees));
      expect(state.velocity).toBe(0);
      expect(state.translation).toBe(0.12);
      expect(state.upsideDownLocked).toBe(true);
    },
  );

  it.each([169, 191, -169, -191])("returns a figure released outside the parking band at %s°", (degrees) => {
    const state = createRodState();
    state.angle = radians(degrees);
    applyRodInput(state, input(true), 0.25);
    applyRodInput(state, input(false), 0.25);
    for (let i = 0; i < 360; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.upsideDownLocked).toBe(false);
    expect(Math.abs(Math.sin(state.angle / 2))).toBeLessThan(0.001);
    expect(state.velocity).toBe(0);
  });

  it("unlocks on touch and lets the player rotate and slide the rod again", () => {
    const state = createRodState();
    state.angle = Math.PI;
    applyRodInput(state, input(true), 0.25);
    applyRodInput(state, input(false), 0.25);
    applyRodInput(state, { ...input(true, 12), translation: 1 }, 0.25);
    for (let i = 0; i < 15; i++) {
      applyRodInput(state, { ...input(true, 12), translation: 1 }, 0.25);
      advanceRod(state, C.physics.timestep, 1.5);
    }
    expect(state.upsideDownLocked).toBe(false);
    expect(state.angle).toBeGreaterThan(Math.PI + radians(10));
    expect(state.translation).toBe(0.25);
    applyRodInput(state, input(false), 0.25);
    for (let i = 0; i < 360; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(Math.abs(Math.sin(state.angle / 2))).toBeLessThan(0.001);
  });

  it("unlocks a completed short flick even when no active frame arrived", () => {
    const state = createRodState();
    state.angle = Math.PI;
    applyRodInput(state, input(true), 0.25);
    applyRodInput(state, input(false), 0.25);
    applyRodInput(state, { ...input(false, 24), flick: true }, 0.25);
    expect(state.upsideDownLocked).toBe(false);
    expect(state.velocity).toBe(24);
    advanceRod(state, C.physics.timestep, 1.5);
    expect(state.angle).toBeGreaterThan(Math.PI);
  });

  it("does not catch a released spin merely passing through the upside-down sector", () => {
    const state = createRodState();
    state.angle = radians(160);
    state.velocity = 24;
    applyRodInput(state, input(true, 24), 0.25);
    applyRodInput(state, { ...input(false, 24), flick: true }, 0.25);
    let crossedUpsideDown = false;
    for (let i = 0; i < 15; i++) {
      advanceRod(state, C.physics.timestep, 1.5);
      if (state.angle > Math.PI) crossedUpsideDown = true;
      expect(state.upsideDownLocked).toBe(false);
    }
    expect(crossedUpsideDown).toBe(true);
  });

  it("keeps an active spin controllable through the parking sector", () => {
    const state = createRodState();
    state.angle = radians(175);
    state.velocity = 12;
    for (let i = 0; i < 12; i++) {
      applyRodInput(state, input(true, 12), 0.25);
      advanceRod(state, C.physics.timestep, 1.5);
      expect(state.upsideDownLocked).toBe(false);
    }
    expect(state.angle).toBeGreaterThan(radians(190));
  });

  it("parks after an upside-down touch times out and ignores later neutral packets", () => {
    const state = createRodState();
    state.angle = Math.PI;
    applyRodInput(state, input(true), 0.25);
    for (let i = 0; i < 390; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.active).toBe(false);
    expect(state.upsideDownLocked).toBe(true);
    applyRodInput(state, input(false), 0.25);
    for (let i = 0; i < 360; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.angle).toBe(Math.PI);
    expect(createRodState().upsideDownLocked).toBe(false);
  });

  it("holds the actual kinematic figure upside down and releases it on the next touch", async () => {
    const physics = await PhysicsWorld.create();
    try {
      const rod = physics.rods.find((candidate) => candidate.layout.team === "red" && candidate.layout.id === 0)!;
      rod.state.angle = radians(185);
      physics.input("red", input(true));
      physics.input("red", input(false));
      for (let i = 0; i < 1200; i++) physics.step(C.physics.timestep, 1.5);
      expect(rod.state.angle).toBe(radians(185));
      expect(rod.body.rotation().z).toBeCloseTo(Math.sin(radians(185) / 2), 6);
      physics.input("red", input(true, -12));
      physics.step(C.physics.timestep, 1.5);
      expect(rod.state.upsideDownLocked).toBe(false);
      expect(rod.state.angle).toBeLessThan(radians(185));
    } finally { physics.dispose(); }
  });
});

describe("gesture commits between physics ticks", () => {
  it("applies a complete short flick immediately, including its last translation", async () => {
    const physics = await PhysicsWorld.create();
    try {
      const rod = physics.rods.find((candidate) => candidate.layout.team === "red" && candidate.layout.id === 0)!;
      physics.input("red", { sequence: 1, rodId: 0, translation: 0, angularVelocity: 0, active: true });
      physics.input("red", { sequence: 2, rodId: 0, translation: 0.8, angularVelocity: 30, active: true });
      physics.input("red", { sequence: 3, rodId: 0, translation: 0.8, angularVelocity: 30, active: false, flick: true });
      expect(rod.state.velocity).toBe(30);
      physics.step(C.physics.timestep, 1.5);
      expect(rod.state.angle).toBeGreaterThan(0.2);
      expect(rod.state.translation).toBeGreaterThan(0.05);
      for (let i = 0; i < 12; i++) physics.step(C.physics.timestep, 1.5);
      expect(rod.state.translation).toBeCloseTo(rod.layout.travel * 0.8);
      expect(rod.body.translation().z).toBeCloseTo(rod.state.translation);
      for (let i = 0; i < 360; i++) physics.step(C.physics.timestep, 1.5);
      expect(Math.abs(Math.sin(rod.state.angle / 2))).toBeLessThan(0.001);
    } finally { physics.dispose(); }
  });

  it("commits a quick vertical gesture with no horizontal spin and clamps flick speed", () => {
    const state = createRodState();
    applyRodInput(state, { sequence: 1, rodId: 0, translation: -1, angularVelocity: 0, active: false, flick: true }, 0.59);
    for (let i = 0; i < 10; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.translation).toBe(-0.59);
    expect(state.velocity).toBe(0);
    applyRodInput(state, { sequence: 2, rodId: 0, translation: -1, angularVelocity: 999, active: false, flick: true }, 0.59);
    expect(state.velocity).toBe(C.rods.maxAngularVelocity);
  });

  it("keeps a committed vertical target when a second finger flicks across an older frame", () => {
    const state = createRodState();
    applyRodInput(state, { sequence: 1, rodId: 0, translation: 0.8, angularVelocity: 0, active: false, flick: true }, 0.59);
    applyRodInput(state, { sequence: 2, rodId: 0, translation: 0, angularVelocity: 30, active: false, flick: true, rotationOnly: true }, 0.59);
    expect(state.translation).toBe(0);
    expect(state.target).toBe(0.8 * 0.59);
    expect(state.velocity).toBe(30);
    for (let i = 0; i < 12; i++) advanceRod(state, C.physics.timestep, 1.5);
    expect(state.translation).toBeCloseTo(0.8 * 0.59);
    expect(state.angle).toBeGreaterThan(1);
  });
});
