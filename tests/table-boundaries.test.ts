import { describe, expect, it } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";
import { playingSurfaceHeight } from "../game/table/PlayingSurface";

const dt = C.physics.timestep;

function disableFigures(physics: PhysicsWorld) {
  for (const rod of physics.rods)
    for (let i = 0; i < rod.body.numColliders(); i++)
      rod.body.collider(i).setEnabled(false);
}

describe("raised table boards", () => {
  it.each([-1, 1])(
    "rebounds elevated shots along side %i, including above the serving opening",
    async (side) => {
      const physics = await PhysicsWorld.create();
      try {
        disableFigures(physics);
        for (const x of [-0.9, 0, 0.9]) {
          physics.ball.setTranslation({ x, y: 0.34, z: side * 0.6 }, true);
          physics.ball.setLinvel({ x: 0, y: 0, z: side * 6 }, true);
          physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
          let rebounded = false;
          for (let step = 0; step < 40; step++) {
            physics.step(dt, 1.5);
            expect(Math.abs(physics.ball.translation().z)).toBeLessThan(C.table.halfWidth);
            if (physics.ball.linvel().z * side < 0) {
              rebounded = true;
              break;
            }
          }
          expect(rebounded).toBe(true);
        }
      } finally {
        physics.dispose();
      }
    },
  );

  it.each([-1, 1])(
    "rebounds elevated shots at end %i on both wings and above the goal",
    async (end) => {
      const physics = await PhysicsWorld.create();
      try {
        disableFigures(physics);
        for (const z of [-0.5, 0, 0.5]) {
          physics.ball.setTranslation({ x: end * 1.24, y: 0.34, z }, true);
          physics.ball.setLinvel({ x: end * 6, y: 0, z: 0 }, true);
          physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
          let rebounded = false;
          for (let step = 0; step < 40; step++) {
            physics.step(dt, 1.5);
            expect(Math.abs(physics.ball.translation().x)).toBeLessThan(C.table.halfLength);
            if (physics.ball.linvel().x * end < 0) {
              rebounded = true;
              break;
            }
          }
          expect(rebounded).toBe(true);
        }
      } finally {
        physics.dispose();
      }
    },
  );
});

describe("passing lanes beside the boards", () => {
  it.each([-1, 1])(
    "keeps every row clear of side %i and lets the whole ball pass the outer players",
    async (side) => {
      const physics = await PhysicsWorld.create();
      try {
        for (const rod of physics.rods)
          physics.input(rod.layout.team, {
            rodId: rod.layout.id,
            translation: side * 100,
            angularVelocity: 0,
            active: false,
            flick: true,
          });
        for (let step = 0; step < 30; step++) physics.step(dt, 1.5);
        physics.drainBallTouches();

        // Isolate geometric passage from the ramp's normal inward gravity roll.
        physics.world.gravity = { x: 0, y: 0, z: 0 };
        const wallInnerEdge = C.table.wallZ - C.table.wallThickness / 2;
        for (const rod of physics.rods) {
          expect(rod.body.translation().z).toBeCloseTo(side * rod.layout.travel, 6);
          const outerFoot = Math.abs(rod.body.translation().z) +
            (rod.layout.count - 1) * rod.layout.spacing / 2 + C.figure.footHalfSize;
          // The ball is 6.6 cm across: a 3–4 cm total gap would still trap it.
          expect(wallInnerEdge - outerFoot).toBeGreaterThanOrEqual(C.ball.radius * 2 + 0.017);

          const x = rod.layout.x - 0.15;
          const z = side * (wallInnerEdge - C.ball.radius - 0.004);
          physics.ball.setTranslation({ x, y: playingSurfaceHeight(x, z) + C.ball.radius + 0.0001, z }, true);
          physics.ball.setLinvel({ x: 6, y: 0, z: 0 }, true);
          physics.ball.setAngvel({ x: 0, y: 0, z: -6 / C.ball.radius }, true);
          let passed = false;
          for (let step = 0; step < 60; step++) {
            physics.step(dt, 1.5);
            expect(physics.drainBallTouches()).toEqual([]);
            expect(physics.ball.linvel().x).toBeGreaterThan(0);
            if (physics.ball.translation().x > rod.layout.x + 0.1) {
              passed = true;
              break;
            }
          }
          expect(passed).toBe(true);
        }
      } finally {
        physics.dispose();
      }
    },
  );
});
