import RAPIER from "@dimforge/rapier3d-compat";
import { describe, expect, it } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import {
  createPlayingSurfaceMesh,
  playingSurfaceHeight,
} from "../game/table/PlayingSurface";
import { scoringTeam } from "../game/systems/GameRules";

const dt = C.physics.timestep;
function tick(physics: PhysicsWorld, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds / dt); i++) physics.step(dt, 1.5);
}
function disableFigures(physics: PhysicsWorld) {
  for (const rod of physics.rods)
    for (let i = 0; i < rod.body.numColliders(); i++)
      rod.body.collider(i).setEnabled(false);
}
function restBall(physics: PhysicsWorld, x: number, z: number) {
  physics.ball.setTranslation(
    { x, y: playingSurfaceHeight(x, z) + C.ball.radius + 0.0001, z },
    true,
  );
  physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
}

describe("shared playing surface", () => {
  it("rises 2cm beyond the touchlines and 2.2cm in all four broad triangular corners", () => {
    for (const side of [-1, 1]) {
      expect(playingSurfaceHeight(0, side * C.table.sideSlopeStart)).toBe(0);
      expect(playingSurfaceHeight(0, side * C.table.halfWidth)).toBeCloseTo(0.02, 12);
      expect(playingSurfaceHeight(
        0, side * (C.table.sideSlopeStart + C.table.halfWidth) / 2,
      )).toBeCloseTo(0.01, 12);
      for (const end of [-1, 1]) {
        expect(playingSurfaceHeight(
          end * C.table.halfLength, side * C.table.halfWidth,
        )).toBeCloseTo(0.022, 12);
        const diagonal = C.table.cornerRampLength / 2;
        expect(playingSurfaceHeight(
          end * (C.table.halfLength - diagonal),
          side * (C.table.halfWidth - diagonal),
        )).toBeCloseTo(0, 12);
        expect(playingSurfaceHeight(
          end * (C.table.halfLength - diagonal / 2),
          side * (C.table.halfWidth - diagonal / 2),
        )).toBeCloseTo(0.011, 12);
      }
    }
  });

  it.each([
    { halfLength: C.table.halfLength, halfWidth: C.table.halfWidth },
    { halfLength: C.table.floorHalfLength, halfWidth: C.table.floorHalfWidth },
  ])("triangulates the whole $halfLength × $halfWidth surface without seams or hidden overlaps", (bounds) => {
    const { vertices, indices } = createPlayingSurfaceMesh(bounds);
    const edges = new Map<string, number>();
    let area = 0;
    for (let i = 0; i < indices.length; i += 3) {
      const points = Array.from(indices.slice(i, i + 3), (index) => ({
        x: vertices[index * 3]!, y: vertices[index * 3 + 1]!, z: vertices[index * 3 + 2]!,
      }));
      const [a, b, c] = points as [typeof points[number], typeof points[number], typeof points[number]];
      const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
      expect(normalY).toBeGreaterThan(0);
      area += normalY / 2;
      // Each triangle lies on the same analytic plane as its rendered surface.
      for (const weights of [[1, 0, 0], [1 / 3, 1 / 3, 1 / 3], [0.2, 0.5, 0.3]]) {
        const interpolate = (axis: "x" | "y" | "z") =>
          points.reduce((sum, point, j) => sum + point[axis] * weights[j]!, 0);
        expect(interpolate("y")).toBeCloseTo(
          playingSurfaceHeight(interpolate("x"), interpolate("z")), 7,
        );
      }
      for (let edge = 0; edge < 3; edge++) {
        const first = indices[i + edge]!, second = indices[i + (edge + 1) % 3]!;
        const key = [first, second].sort((x, y) => x - y).join(":");
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect(area).toBeCloseTo(bounds.halfLength * bounds.halfWidth * 4, 6);
    for (const [key, count] of edges) {
      if (count === 2) continue;
      expect(count).toBe(1);
      const [a, b] = key.split(":").map(Number);
      const onBoundary = ([0, 2] as const).some((axis) => {
        const bound = axis === 0 ? bounds.halfLength : bounds.halfWidth;
        return Math.abs(Math.abs(vertices[a! * 3 + axis]!) - bound) < 1e-7 &&
          Math.abs(vertices[a! * 3 + axis]! - vertices[b! * 3 + axis]!) < 1e-7;
      });
      expect(onBoundary).toBe(true);
    }
  });
});

describe("physical border and corner ramps", () => {
  it.each([[-1, -1], [-1, 1], [1, -1], [1, 1]])(
    "returns an asleep ball from the extreme corner (%i, %i) to defense in about two seconds",
    async (end, side) => {
      const physics = await PhysicsWorld.create();
      try {
        disableFigures(physics);
        const x = end * (C.table.halfLength - C.ball.radius - 0.001);
        const z = side * (C.table.halfWidth - C.ball.radius - 0.001);
        restBall(physics, x, z);
        // Reproduce the low-energy state that Rapier may park on a static ramp.
        physics.ball.sleep();
        let reached = 0;
        for (let step = 1; step <= 300; step++) {
          physics.step(dt, 1.5);
          const position = physics.ball.translation();
          if (position.x * end <= 1.05 && position.z * side < 0.55) {
            reached = step * dt;
            break;
          }
        }
        expect(reached).toBeGreaterThan(1.4);
        expect(reached).toBeLessThan(2.3);
        expect(physics.ball.isSleeping()).toBe(false);
        expect(physics.drainBallTouches()).toEqual([]);
        expect(physics.drainImpacts()).toEqual([]);
      } finally { physics.dispose(); }
    },
  );

  it.each([[-1, -1], [-1, 1], [1, -1], [1, 1]])(
    "lets a ball rolling up corner (%i, %i) turn around and roll diagonally back down",
    async (end, side) => {
      const physics = await PhysicsWorld.create();
      try {
        disableFigures(physics);
        restBall(physics, end * 1.2, side * 0.61);
        physics.ball.setLinvel({ x: end * 0.2, y: 0, z: side * 0.2 }, true);
        physics.ball.setAngvel({ x: side * 0.2 / C.ball.radius, y: 0, z: -end * 0.2 / C.ball.radius }, true);
        let peakX = 1.2, peakZ = 0.61;
        for (let step = 0; step < 240; step++) {
          physics.step(dt, 1.5);
          const position = physics.ball.translation();
          peakX = Math.max(peakX, position.x * end);
          peakZ = Math.max(peakZ, position.z * side);
        }
        const position = physics.ball.translation();
        expect(peakX).toBeGreaterThan(1.21);
        expect(peakZ).toBeGreaterThan(0.62);
        expect(position.x * end).toBeLessThan(peakX - 0.08);
        expect(position.z * side).toBeLessThan(peakZ - 0.08);
        expect(physics.ball.linvel().x * end).toBeLessThan(-0.03);
        expect(physics.ball.linvel().z * side).toBeLessThan(-0.03);
      } finally { physics.dispose(); }
    },
  );

  it("leaves a sleeping ball on the flat pitch undisturbed", async () => {
    const physics = await PhysicsWorld.create();
    try {
      disableFigures(physics);
      restBall(physics, 0.45, 0.2);
      physics.ball.sleep();
      const position = physics.ball.translation();
      tick(physics, 2);
      expect(physics.ball.translation()).toEqual(position);
      expect(physics.ball.isSleeping()).toBe(true);
    } finally { physics.dispose(); }
  });
  it.each([-1, 1])("rolls a stationary ball inward from touchline %i using gravity", async (side) => {
    const physics = await PhysicsWorld.create();
    try {
      disableFigures(physics);
      const x = 0.45;
      const z = side * (C.table.halfWidth - 0.04);
      restBall(physics, x, z);
      tick(physics, 0.5);
      const position = physics.ball.translation();
      expect(position.z * side).toBeLessThan(C.table.sideSlopeStart - 0.02);
      expect(physics.ball.linvel().z * side).toBeLessThan(-0.05);
      expect(physics.ball.angvel().x * side).toBeLessThan(-0.5);
      // Contacts at a triangulated seam can introduce sub-millimeter solver drift.
      expect(Math.abs(position.x - x)).toBeLessThan(0.002);
      expect(position.y).toBeGreaterThan(C.ball.radius - 0.002);
      expect(physics.drainImpacts()).toEqual([]);
    } finally {
      physics.dispose();
    }
  });

  it.each([[-1, -1], [-1, 1], [1, -1], [1, 1]])(
    "rolls down and away from corner (%i, %i) without a kick or bump",
    async (end, side) => {
      const physics = await PhysicsWorld.create();
      try {
        disableFigures(physics);
        const x = end * (C.table.halfLength - 0.05);
        const z = side * (C.table.halfWidth - 0.045);
        restBall(physics, x, z);
        tick(physics, 0.8);
        const position = physics.ball.translation();
        expect(position.x * end).toBeLessThan(Math.abs(x) - 0.04);
        expect(position.z * side).toBeLessThan(Math.abs(z) - 0.04);
        expect(physics.ball.linvel().x * end).toBeLessThan(-0.05);
        expect(physics.ball.linvel().z * side).toBeLessThan(-0.05);
        expect(position.y).toBeGreaterThan(C.ball.radius - 0.002);
        expect(physics.drainBallTouches()).toEqual([]);
      } finally {
        physics.dispose();
      }
    },
  );

  it("retains a flat center and does not inject movement into a resting ball", async () => {
    const physics = await PhysicsWorld.create();
    try {
      disableFigures(physics);
      restBall(physics, 0.45, 0.2);
      tick(physics, 2);
      expect(physics.ball.translation().x).toBeCloseTo(0.45, 4);
      expect(physics.ball.translation().z).toBeCloseTo(0.2, 4);
      expect(Math.hypot(...Object.values(physics.ball.linvel()))).toBeLessThan(0.001);
    } finally {
      physics.dispose();
    }
  });

  it.each([-1, 1])("keeps goal %i flat and lets a grounded shot cross the goal line", async (end) => {
    const physics = await PhysicsWorld.create();
    try {
      disableFigures(physics);
      for (const z of [-C.table.goalHalfWidth + C.ball.radius, 0, C.table.goalHalfWidth - C.ball.radius]) {
        expect(playingSurfaceHeight(end * C.table.goalLine, z)).toBe(0);
        restBall(physics, end * 1.3, z);
        physics.ball.setLinvel({ x: end * C.ball.maxSpeed, y: 0, z: 0 }, true);
        physics.ball.setAngvel({ x: 0, y: 0, z: -end * C.ball.maxSpeed / C.ball.radius }, true);
        let scored = false;
        for (let step = 0; step < 45; step++) {
          physics.step(dt, 1.5);
          if (scoringTeam(physics.ball.translation()) === (end > 0 ? "red" : "blue"))
            scored = true;
          expect(physics.ball.translation().y).toBeLessThan(C.ball.radius + 0.005);
        }
        expect(scored).toBe(true);
      }
    } finally {
      physics.dispose();
    }
  });

  it("uses the shared mesh for real collider heights across slopes, seams and extensions", async () => {
    const physics = await PhysicsWorld.create();
    try {
      disableFigures(physics);
      physics.ball.collider(0).setEnabled(false);
      // Ignore table walls: all samples are on open pitch, goal floor or the serve tunnel.
      physics.serve(1);
      tick(physics, dt);
      for (const [x, z] of [
        [0.45, 0.2], [0.45, 0.68], [0.45, 0.715],
        [1.34, 0.6], [-1.34, 0.6], [1.34, -0.6], [-1.34, -0.6],
        [1.6, 0], [-1.6, 0], [0, 0.85],
      ]) {
        const hit = physics.world.castRay(
          new RAPIER.Ray({ x: x!, y: 0.02, z: z! }, { x: 0, y: -1, z: 0 }),
          0.1, true,
        );
        expect(hit).not.toBeNull();
        expect(0.02 - hit!.timeOfImpact).toBeCloseTo(playingSurfaceHeight(x!, z!), 7);
      }
    } finally {
      physics.dispose();
    }
  });
});

describe("goalkeeper travel", () => {
  it.each(["red", "blue"] as const)("limits the actual %s goalkeeper center to two centimeters outside the goal", async (team) => {
    const physics = await PhysicsWorld.create();
    try {
      const goalie = physics.rods.find((rod) => rod.layout.team === team && rod.layout.id === 0)!;
      const limit = C.table.goalHalfWidth + 0.02;
      for (const direction of [-1, 1]) {
        physics.input(team, { rodId: 0, translation: direction * 100, angularVelocity: 0, active: false, flick: true });
        tick(physics, 0.15);
        expect(goalie.state.target).toBeCloseTo(direction * limit, 8);
        expect(goalie.body.translation().z).toBeCloseTo(direction * limit, 7);
      }
      // Outfield rows leave a full ball lane beside their outermost figure.
      expect(physics.rods.find((rod) => rod.layout.team === team && rod.layout.id === 1)!.layout.travel)
        .toBeCloseTo(0.305, 8);
    } finally {
      physics.dispose();
    }
  });
});
