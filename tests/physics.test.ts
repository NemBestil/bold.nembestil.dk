import { describe, expect, it, vi } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";

const timestep = C.physics.timestep;
function tick(physics: PhysicsWorld, seconds: number) {
  for (let i = 0; i < Math.ceil(seconds / timestep); i++)
    physics.step(timestep, 1.5);
}

describe("physical serving flaps", () => {
  it.each([-1, 1])(
    "keeps a straight serve from side %i inside the opposite hole",
    async (side) => {
      const physics = await PhysicsWorld.create();
      const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
      try {
        physics.serve(side);
        let entered = false;
        let bounced = false;
        for (let i = 0; i < 6 / timestep; i++) {
          physics.step(timestep, 1.5);
          const position = physics.ball.translation();
          if (Math.abs(position.z) < C.table.halfWidth - C.ball.radius)
            entered = true;
          if (position.z * side < -0.6 && physics.ball.linvel().z * side > 0)
            bounced = true;
          if (entered) {
            expect(Math.abs(position.z)).toBeLessThan(C.table.halfWidth);
            expect(position.y).toBeGreaterThan(0);
          }
        }
        expect(entered).toBe(true);
        expect(bounced).toBe(true);
      } finally {
        random.mockRestore();
        physics.dispose();
      }
    },
  );

  it.each([-1, 1])(
    "closes the used entrance after the entire ball has entered from side %i",
    async (side) => {
      const physics = await PhysicsWorld.create();
      try {
        physics.serve(side);
        tick(physics, 0.25);
        expect(Math.abs(physics.ball.translation().z)).toBeLessThan(
          C.table.halfWidth - C.ball.radius,
        );
        physics.ball.setTranslation(
          { x: 0, y: C.ball.radius, z: side * 0.6 },
          true,
        );
        physics.ball.setLinvel({ x: 0, y: 0, z: side * C.ball.maxSpeed }, true);
        let rebounded = false;
        for (let i = 0; i < 40; i++) {
          physics.step(timestep, 1.5);
          expect(Math.abs(physics.ball.translation().z)).toBeLessThan(
            C.table.halfWidth,
          );
          if (physics.ball.linvel().z * side < 0) rebounded = true;
        }
        expect(rebounded).toBe(true);
      } finally {
        physics.dispose();
      }
    },
  );

  it("keeps repeated serves at both extreme launch angles on the pitch", async () => {
    const physics = await PhysicsWorld.create();
    const random = vi.spyOn(Math, "random");
    try {
      for (const side of [-1, 1]) {
        for (const variation of [0, 0.25, 0.5, 0.75, 1]) {
          random.mockReturnValue(variation);
          physics.serve(side);
          for (let i = 0; i < 3 / timestep; i++) {
            physics.step(timestep, 1.5);
            const position = physics.ball.translation();
            expect(Math.abs(position.z)).toBeLessThan(C.table.floorHalfWidth);
            expect(position.y).toBeGreaterThan(0);
          }
        }
      }
    } finally {
      random.mockRestore();
      physics.dispose();
    }
  });

  it("closes a cancelled serve so a parked match has no open side exit", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.serve(1);
      physics.parkBall();
      physics.ball.setTranslation({ x: 0, y: C.ball.radius, z: 0.6 }, true);
      physics.ball.setLinvel({ x: 0, y: 0, z: C.ball.maxSpeed }, true);
      tick(physics, 0.25);
      expect(Math.abs(physics.ball.translation().z)).toBeLessThan(
        C.table.halfWidth,
      );
      expect(physics.ball.linvel().z).toBeLessThan(0);
    } finally {
      physics.dispose();
    }
  });
});

describe("solid table boundaries", () => {
  it.each([-1, 1])(
    "contains maximum-speed rolling impacts on side %i, including corners",
    async (side) => {
      const physics = await PhysicsWorld.create();
      try {
        // Isolate the table boundaries from valid player kicks that may lift the ball.
        for (const rod of physics.rods)
          for (let i = 0; i < rod.body.numColliders(); i++)
            rod.body.collider(i).setEnabled(false);
        for (const x of [-1.34, -0.82, 0, 0.82, 1.34]) {
          physics.ball.setTranslation(
            { x, y: C.ball.radius, z: side * 0.5 },
            true,
          );
          physics.ball.setLinvel(
            { x: 0, y: 0, z: side * C.ball.maxSpeed },
            true,
          );
          physics.ball.setAngvel(
            { x: (side * C.ball.maxSpeed) / C.ball.radius, y: 0, z: 0 },
            true,
          );
          let rebounded = false;
          // Allow the maximum 1.12 m/s ball enough time to reach the physical board.
          for (let i = 0; i < 75; i++) {
            physics.step(timestep, 1.5);
            expect(Math.abs(physics.ball.translation().z)).toBeLessThan(
              C.table.halfWidth,
            );
            if (physics.ball.linvel().z * side < 0) rebounded = true;
          }
          expect(rebounded).toBe(true);
        }
      } finally {
        physics.dispose();
      }
    },
  );

  it("leaves high trajectories free to pass over the physical wall", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.ball.setTranslation(
        { x: 0, y: C.table.wallHeight + C.ball.radius * 4, z: 0.7 },
        true,
      );
      physics.ball.setLinvel({ x: 0, y: 0, z: C.ball.maxSpeed }, true);
      tick(physics, 0.35);
      expect(physics.ball.translation().z).toBeGreaterThan(
        C.table.floorHalfWidth,
      );
    } finally {
      physics.dispose();
    }
  });
});

describe("replay contact recording", () => {
  it("reports one actual player touch and excludes the floor and walls", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.ball.setTranslation({ x: 0.8, y: 0.034, z: 0 }, true);
      physics.ball.setLinvel({ x: -2, y: 0, z: 0 }, true);
      const blocker = physics.rods.find(rod => rod.layout.team === "red" && rod.layout.id === 3)!;
      blocker.state.active = true;
      const contacts: number[] = [];
      for (let i = 0; i < 25; i++) {
        blocker.state.age = 0;
        physics.step(timestep, 1.5);
        contacts.push(...physics.drainBallTouches());
        expect(physics.drainBallTouches()).toEqual([]);
      }
      const attackingRod = physics.rods.findIndex(
        (rod) => rod.layout.team === "red" && rod.layout.id === 3,
      );
      expect(contacts).toEqual([attackingRod]);
      physics.ball.setTranslation({ x: 0, y: 0.034, z: 0.6 }, true);
      physics.ball.setLinvel({ x: 0, y: 0, z: 5 }, true);
      tick(physics, 0.2);
      expect(physics.drainBallTouches()).toEqual([]);
    } finally {
      physics.dispose();
    }
  });

  it("clears previous contacts before a new ball is served", async () => {
    const physics = await PhysicsWorld.create();
    try {
      physics.ball.setTranslation({ x: 0.8, y: 0.034, z: 0 }, true);
      physics.ball.setLinvel({ x: -2, y: 0, z: 0 }, true);
      tick(physics, 0.1);
      physics.serve(1);
      expect(physics.drainBallTouches()).toEqual([]);
    } finally {
      physics.dispose();
    }
  });
});
