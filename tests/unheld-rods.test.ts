import { describe, expect, it } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";

const dt = C.physics.timestep;
const speed = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
async function isolatedRod() {
  const physics = await PhysicsWorld.create();
  const rod = physics.rods.find(candidate => candidate.layout.team === "red" && candidate.layout.id === 3)!;
  for (const other of physics.rods) if (other !== rod)
    for (let i = 0; i < other.body.numColliders(); i++) other.body.collider(i).setEnabled(false);
  return { physics, rod };
}
function pose(rod: PhysicsWorld["rods"][number], angle: number) {
  rod.state.angle = angle;
  rod.body.setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }, true);
}
function roll(physics: PhysicsWorld, x: number, velocity: number) {
  physics.ball.setTranslation({ x, y: C.ball.radius + 0.0001, z: 0 }, true);
  physics.ball.setLinvel({ x: velocity, y: 0, z: 0 }, true);
  physics.ball.setAngvel({ x: 0, y: 0, z: -velocity / C.ball.radius }, true);
}

describe("finite inertia of unheld rods", () => {
  it.each([-1, 1])("lets a fast ball push a free rod aside in direction %i, while a held rod stays firm", async direction => {
    for (const held of [false, true]) {
      const { physics, rod } = await isolatedRod();
      try {
        rod.state.active = held;
        roll(physics, rod.layout.x - direction * 0.18, direction * C.ball.maxSpeed);
        let previous = { ...physics.ball.translation() };
        let touched = false, passed = false, deflection = 0;
        let firstContactSpeed = Infinity;
        for (let tick = 0; tick < 100; tick++) {
          rod.state.age = 0;
          physics.step(dt, 1.5);
          const position = physics.ball.translation(), velocity = physics.ball.linvel();
          if (physics.drainBallTouches().includes(physics.rods.indexOf(rod))) {
            if (!touched) firstContactSpeed = speed(velocity);
            touched = true;
          }
          deflection = Math.max(deflection, rod.state.angle * direction);
          expect(speed(velocity)).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
          expect(Math.hypot(position.x - previous.x, position.y - previous.y, position.z - previous.z)).toBeLessThan(C.ball.maxSpeed * dt + 0.0005);
          expect(rod.body.translation().x).toBeCloseTo(rod.layout.x, 6);
          expect(rod.body.translation().y).toBeCloseTo(C.table.rodHeight, 6);
          expect(rod.body.translation().z).toBeCloseTo(rod.state.translation, 6);
          expect(rod.body.rotation().x).toBe(0);
          expect(rod.body.rotation().y).toBe(0);
          if ((position.x - rod.layout.x) * direction > 0.12) {
            expect(touched).toBe(true);
            expect(velocity.x * direction).toBeGreaterThan(0);
            expect(speed(velocity)).toBeLessThan(C.ball.maxSpeed * 0.6);
            passed = true;
            break;
          }
          previous = { ...position };
        }
        expect(touched).toBe(true);
        expect(firstContactSpeed).toBeLessThan(C.ball.maxSpeed * 0.85);
        expect(passed).toBe(!held);
        if (held) {
          expect(deflection).toBe(0);
          expect(physics.ball.linvel().x * direction).toBeLessThan(0);
        } else {
          expect(deflection).toBeGreaterThan(0.8);
          expect(rod.body.isDynamic()).toBe(true);
          for (let i = 0; i < rod.body.numColliders(); i++) expect(rod.body.collider(i).isEnabled()).toBe(true);
        }
      } finally { physics.dispose(); }
    }
  });

  it("gives a slow ball a smaller physical deflection without letting it pass", async () => {
    const { physics, rod } = await isolatedRod();
    try {
      roll(physics, rod.layout.x - 0.18, 0.5);
      let maxAngle = 0, contacts = 0;
      for (let tick = 0; tick < 120; tick++) {
        physics.step(dt, 1.5);
        contacts += physics.drainBallTouches().length;
        maxAngle = Math.max(maxAngle, rod.state.angle);
        expect(physics.ball.translation().x - rod.layout.x).toBeLessThan(0.12);
      }
      expect(contacts).toBeGreaterThan(0);
      expect(maxAngle).toBeGreaterThan(0.2);
      expect(maxAngle).toBeLessThan(0.7);
    } finally { physics.dispose(); }
  });

  it("retains power from an intentional released flick while identical passive rotation earns no bonus", async () => {
    for (const intentional of [false, true]) {
      const { physics, rod } = await isolatedRod();
      try {
        pose(rod, -0.5);
        rod.state.velocity = 35;
        if (intentional) physics.input("red", { rodId: 3, sequence: 1, translation: 0, angularVelocity: 35, active: false, flick: true });
        roll(physics, rod.layout.x + 0.09, -0.5);
        let hit = false;
        for (let tick = 0; tick < 30; tick++) {
          const incoming = speed(physics.ball.linvel());
          physics.step(dt, 1.5);
          if (physics.drainBallTouches().includes(physics.rods.indexOf(rod))) {
            expect(rod.state.active).toBe(false);
            expect(rod.body.isDynamic()).toBe(true);
            expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(C.ball.maxSpeed + (intentional ? incoming : 0) + 1e-6);
            if (intentional) expect(speed(physics.ball.linvel())).toBeGreaterThan(C.ball.maxSpeed);
            hit = true;
            break;
          }
        }
        expect(hit).toBe(true);
      } finally { physics.dispose(); }
    }
  });

  it("lets an actually earned fast flight pass another free rod without adding a new strike allowance", async () => {
    const physics = await PhysicsWorld.create();
    try {
      const striker = physics.rods.find(rod => rod.layout.team === "red" && rod.layout.id === 3)!;
      const free = physics.rods.find(rod => rod.layout.team === "blue" && rod.layout.id === 1)!;
      for (const rod of physics.rods) if (rod !== striker && rod !== free)
        for (let i = 0; i < rod.body.numColliders(); i++) rod.body.collider(i).setEnabled(false);
      free.state.translation = free.state.target = free.layout.spacing / 2;
      free.body.setTranslation({ x: free.layout.x, y: C.table.rodHeight, z: free.state.translation }, true);
      pose(striker, -0.5);
      striker.state.active = true;
      striker.state.velocity = striker.state.desiredVelocity = 35;
      roll(physics, striker.layout.x + 0.09, -C.ball.maxSpeed);
      let allowance: number | undefined, passiveIncoming: number | undefined, passed = false;
      for (let tick = 0; tick < 180; tick++) {
        striker.state.age = 0;
        const incoming = speed(physics.ball.linvel());
        physics.step(dt, 1.5);
        const touches = physics.drainBallTouches();
        if (allowance === undefined && touches.includes(physics.rods.indexOf(striker))) allowance = C.ball.maxSpeed + incoming;
        if (passiveIncoming === undefined && touches.includes(physics.rods.indexOf(free))) passiveIncoming = incoming;
        if (physics.ball.translation().x > free.layout.x + 0.12) {
          expect(passiveIncoming).toBeGreaterThan(C.ball.maxSpeed);
          expect(speed(physics.ball.linvel())).toBeLessThan(passiveIncoming!);
          expect(speed(physics.ball.linvel())).toBeGreaterThan(C.ball.maxSpeed);
          passed = true;
          break;
        }
      }
      expect(passed).toBe(true);
      // A free-space overspeed probe reveals the retained allowance: the passive
      // encounter must not turn its incoming momentum into another powered hit.
      physics.ball.setTranslation({ x: 0, y: 0.1, z: 0 }, true);
      physics.ball.setLinvel({ x: 100, y: 0, z: 0 }, true);
      physics.step(dt, 1.5);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(allowance! + 1e-6);
      expect(speed(physics.ball.linvel())).toBeGreaterThan(allowance! * 0.98);
    } finally { physics.dispose(); }
  });

  it.each([-1, 1])("uses existing potential energy for a passive falling contact from side %i without granting shot power", async sign => {
    const { physics, rod } = await isolatedRod();
    try {
      pose(rod, sign * 1.2);
      roll(physics, rod.layout.x + sign * 0.1, 0);
      const energy = () => {
        const v = physics.ball.linvel(), w = physics.ball.angvel();
        return 0.5 * C.ball.mass * speed(v) ** 2 + 0.2 * C.ball.mass * C.ball.radius ** 2 * speed(w) ** 2 +
          C.ball.mass * -C.physics.gravity * (physics.ball.translation().y - C.ball.radius) +
          0.5 * C.rods.passiveAngularInertia * rod.state.velocity ** 2 +
          C.rods.passiveAngularInertia * C.rods.passiveGravity * (1 - Math.cos(rod.state.angle));
      };
      const initialEnergy = energy();
      let contacts = 0;
      for (let tick = 0; tick < 240; tick++) {
        physics.step(dt, 1.5);
        contacts += physics.drainBallTouches().length;
        expect(energy()).toBeLessThanOrEqual(initialEnergy + 0.00001);
        expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
        expect(physics.groundedPinDirection("red", 3)).toBeUndefined();
      }
      expect(contacts).toBeGreaterThan(0);
      physics.ball.setTranslation({ x: 0, y: 0.1, z: 0 }, true);
      physics.ball.setLinvel({ x: 100, y: 0, z: 0 }, true);
      physics.step(dt, 1.5);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
    } finally { physics.dispose(); }
  });

  it("makes stale touches free, and lets a real airborne head contact unlock a parked inverted rod", async () => {
    const { physics, rod } = await isolatedRod();
    try {
      physics.input("red", { rodId: 3, sequence: 1, translation: 0, angularVelocity: 0, active: true });
      rod.state.age = C.rods.inputTimeout;
      roll(physics, rod.layout.x - 0.085, C.ball.maxSpeed);
      for (let tick = 0; tick < 12; tick++) physics.step(dt, 1.5);
      expect(rod.state.active).toBe(false);
      expect(rod.body.isDynamic()).toBe(true);
      expect(rod.state.angle).toBeGreaterThan(0.05);
      physics.resetRods();
      physics.parkBall();
      pose(rod, Math.PI);
      physics.input("red", { rodId: 3, sequence: 2, translation: 0, angularVelocity: 0, active: true });
      physics.input("red", { rodId: 3, sequence: 3, translation: 0, angularVelocity: 0, active: false });
      for (let tick = 0; tick < 120; tick++) physics.step(dt, 1.5);
      expect(rod.state.angle).toBe(Math.PI);
      expect(rod.state.upsideDownLocked).toBe(true);
      physics.ball.setTranslation({ x: rod.layout.x - 0.1, y: C.table.rodHeight - C.figure.headY, z: 0 }, true);
      physics.ball.setLinvel({ x: C.ball.maxSpeed, y: 0, z: 0 }, true);
      for (let tick = 0; tick < 40; tick++) physics.step(dt, 1.5);
      expect(rod.state.upsideDownLocked).toBe(false);
      expect(Math.abs(rod.state.angle - Math.PI)).toBeGreaterThan(0.05);
    } finally { physics.dispose(); }
  });
});

describe("ball speed multiplier", () => {
  it.each([0.5, 1, 2])("scales serve, ordinary caps, and actual incoming-hit allowance at %ix", async multiplier => {
    const { physics, rod } = await isolatedRod();
    try {
      physics.setBallSpeed(multiplier);
      const base = C.ball.maxSpeed * multiplier;
      physics.serve(1);
      expect(speed(physics.ball.linvel())).toBeCloseTo(C.serving.speed * multiplier, 6);
      expect(speed(physics.ball.angvel())).toBeCloseTo(C.serving.speed * multiplier / C.ball.radius, 5);
      physics.parkBall();
      pose(rod, -0.5);
      rod.state.active = true;
      rod.state.velocity = rod.state.desiredVelocity = 35;
      roll(physics, rod.layout.x + 0.09, -base * 0.6);
      let hit = false;
      for (let tick = 0; tick < 30; tick++) {
        rod.state.age = 0;
        const incoming = speed(physics.ball.linvel());
        physics.step(dt, 1.5);
        if (physics.drainBallTouches().includes(physics.rods.indexOf(rod))) {
          expect(speed(physics.ball.linvel())).toBeCloseTo(base + incoming, 5);
          expect(speed(physics.ball.linvel())).toBeGreaterThan(base);
          hit = true;
          break;
        }
      }
      expect(hit).toBe(true);
      physics.parkBall();
      physics.bump(20);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(base + 1e-6);
      physics.ball.setTranslation({ x: 0, y: 0.1, z: 0 }, true);
      physics.ball.setLinvel({ x: 100, y: 0, z: 0 }, true);
      physics.step(dt, 1.5);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(base + 1e-6);
    } finally { physics.dispose(); }
  });

  it("clamps settings, caps immediately when lowering, and never accelerates an existing ball when raising", async () => {
    const { physics } = await isolatedRod();
    try {
      physics.ball.setLinvel({ x: 0.8, y: 0, z: 0 }, true);
      physics.setBallSpeed(2);
      expect(physics.ball.linvel().x).toBeCloseTo(0.8);
      physics.setBallSpeed(0.01);
      expect(speed(physics.ball.linvel())).toBeCloseTo(C.ball.maxSpeed * 0.5);
      physics.setBallSpeed(100);
      physics.serve(1);
      expect(speed(physics.ball.linvel())).toBeCloseTo(C.serving.speed * 2);
      physics.setBallSpeed(Number.NaN);
      physics.serve(1);
      expect(speed(physics.ball.linvel())).toBeCloseTo(C.serving.speed);
    } finally { physics.dispose(); }
  });
});
