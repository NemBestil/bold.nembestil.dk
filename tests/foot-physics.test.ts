import { describe, expect, it } from "vitest";
import RAPIER from "@dimforge/rapier3d-compat";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { footRenderMesh, footCoreVertices } from "../game/physics/FootProfile";
import { PhysicsWorld } from "../game/physics/PhysicsWorld";

/** Read the first free velocity, before any other figure or table wall is reached. */
async function strike(
  offset: number,
  speed: number,
  direction: number,
  rotating = true,
  startDistance = 0.09,
  startHeight: number = C.ball.radius + 0.0001,
) {
  const physics = await PhysicsWorld.create();
  try {
    const attacker = physics.rods.find(
      (rod) => rod.layout.team === "red" && rod.layout.id === 3,
    )!;
    for (const rod of physics.rods)
      if (rod !== attacker)
        for (let i = 0; i < rod.body.numColliders(); i++)
          rod.body.collider(i).setEnabled(false);
    expect(attacker.body.collider(4).shape.type).toBe(
      RAPIER.ShapeType.RoundConvexPolyhedron,
    );
    if (rotating) {
      attacker.state.angle = -direction * 0.5;
      attacker.state.velocity = direction * speed;
      attacker.state.desiredVelocity = direction * speed;
      attacker.state.active = true;
      attacker.body.setRotation({
        x: 0,
        y: 0,
        z: Math.sin(attacker.state.angle / 2),
        w: Math.cos(attacker.state.angle / 2),
      }, true);
    } else attacker.state.active = true;
    physics.ball.setTranslation({
      x: attacker.layout.x + direction * (rotating ? startDistance : -0.18),
      y: startHeight,
      z: offset,
    }, true);
    physics.ball.setLinvel({ x: rotating ? 0 : direction * speed, y: 0, z: 0 }, true);
    physics.ball.setAngvel({
      x: 0,
      y: 0,
      z: rotating ? 0 : -direction * speed / C.ball.radius,
    }, true);
    let touches = 0;
    for (let step = 0; step < 50; step++) {
      // Keep the controlled test stroke active, like a held swipe.
      attacker.state.age = 0;
      physics.step(C.physics.timestep, 1.5);
      touches += physics.drainBallTouches().length;
      if (!touches) continue;
      let contacting = false;
      for (let i = 0; i < attacker.body.numColliders(); i++)
        physics.world.contactPair(
          physics.ball.collider(0),
          attacker.body.collider(i),
          (manifold) => {
            if (manifold.numSolverContacts()) contacting = true;
          },
        );
      // CCD may announce a grazing contact before a solver impulse exists.
      const velocity = physics.ball.linvel();
      const struck = !rotating || velocity.x * direction > 0.5;
      if (!contacting && struck) break;
    }
    const velocity = physics.ball.linvel();
    return {
      touches,
      x: velocity.x,
      y: velocity.y,
      z: velocity.z,
      angle: Math.atan2(velocity.z, Math.abs(velocity.x)) * 180 / Math.PI,
    };
  } finally {
    physics.dispose();
  }
}

describe("superellipse figure feet", () => {
  it("retains floor clearance and presents a flatter center with curved superellipse shoulders", async () => {
    const physics = await PhysicsWorld.create();
    try {
      const foot = physics.rods[0]!.body.collider(1);
      const center = foot.translation();
      const radius = C.figure.footHalfSize;
      const bottom = foot.castRay(
        new RAPIER.Ray({ x: center.x, y: 0, z: center.z }, { x: 0, y: 1, z: 0 }),
        1, false,
      );
      expect(bottom).toBeGreaterThan(0.016);
      expect(bottom).toBeLessThan(0.020);
      const vertices = footCoreVertices();
      const y = Array.from(vertices).filter((_, index) => index % 3 === 1);
      expect(center.y + Math.min(...y) - C.figure.footEdgeBevel).toBeCloseTo(0.018, 6);
      for (const angle of [0, 0.2, 0.5, 0.8, 1.2, Math.PI / 2, Math.PI, 4]) {
        const dx = Math.cos(angle), dz = Math.sin(angle);
        const hit = foot.castRayAndGetNormal(new RAPIER.Ray(
          { x: center.x + dx * 0.2, y: center.y, z: center.z + dz * 0.2 },
          { x: -dx, y: 0, z: -dz },
        ), 1, false);
        expect(hit).not.toBeNull();
        const reach = 0.2 - hit!.timeOfImpact;
        expect(reach).toBeGreaterThanOrEqual(radius - 0.001);
        expect(reach).toBeLessThan(radius * 1.2);
        const coreX = dx * reach - C.figure.footEdgeBevel * hit!.normal.x;
        const coreZ = dz * reach - C.figure.footEdgeBevel * hit!.normal.z;
        const coreSize = radius - C.figure.footEdgeBevel;
        expect((Math.abs(coreX) / coreSize) ** C.figure.footExponent + (Math.abs(coreZ) / coreSize) ** C.figure.footExponent).toBeCloseTo(1, 1);
      }
    } finally {
      physics.dispose();
    }
  });

  it.each([6, 12, 20, 24, 35])(
    "aims a real %i rad/s stroke progressively outward from both sides of the foot",
    async (speed) => {
      const opposite: { x: number; z: number; angle: number }[] = [];
      for (const direction of [1, -1]) {
        const center = await strike(0, speed, direction);
        expect(center.touches).toBe(1);
        expect(center.x * direction).toBeGreaterThan(0.7);
        expect(Math.abs(center.angle)).toBeLessThan(1);
        let previousAngle = 0;
        for (const offset of [0.02, 0.04, 0.06]) {
          const positive = await strike(offset, speed, direction);
          const negative = await strike(-offset, speed, direction);
          expect(positive.touches).toBe(1);
          expect(negative.touches).toBe(1);
          expect(positive.x * direction).toBeGreaterThan(0.5);
          expect(positive.z).toBeGreaterThan(0);
          expect(positive.angle).toBeGreaterThan(previousAngle + 0.5);
          expect(positive.angle).toBeCloseTo(-negative.angle, 3);
          expect(positive.x).toBeCloseTo(negative.x, 3);
          if (offset === 0.04) expect(positive.angle).toBeGreaterThan(12);
          if (offset === 0.06) expect(positive.angle).toBeGreaterThan(25);
          previousAngle = positive.angle;
          if (direction === 1) opposite.push(positive);
          else {
            const mirror = opposite[[0.02, 0.04, 0.06].indexOf(offset)]!;
            expect(positive.angle).toBeCloseTo(mirror.angle, 2);
            expect(positive.x).toBeCloseTo(-mirror.x, 3);
            expect(positive.z).toBeCloseTo(mirror.z, 3);
          }
        }
      }
    },
  );

  it("keeps the combined profile and rod aiming consistent across slow and fast real strokes", async () => {
    for (const offset of [0.02, 0.04, 0.06]) {
      const expected = (await strike(offset, 6, 1)).angle;
      for (const speed of [6, 12, 24, 35]) {
        const result = await strike(offset, speed, 1);
        expect(Math.abs(result.angle - expected)).toBeLessThan(2.5);
      }
    }
  });

  it("renders the same reach and floor clearance as the rounded physical profile", () => {
    const { positions } = footRenderMesh();
    const component = (axis: number) => Array.from(positions).filter((_, index) => index % 3 === axis);
    for (const axis of [0, 1, 2]) {
      expect(Math.min(...component(axis))).toBeCloseTo(-C.figure.footHalfSize, 6);
      expect(Math.max(...component(axis))).toBeCloseTo(C.figure.footHalfSize, 6);
    }
    expect(C.table.rodHeight + C.figure.footY - C.figure.footHalfSize).toBeCloseTo(0.018, 6);
  });

  it.each([6, 12, 20, 24, 35])(
    "keeps %i rad/s center hits straight across different contact timings",
    async (speed) => {
      for (const direction of [1, -1])
        for (const distance of [0.09, 0.1, 0.11])
          for (const height of [0.0331, 0.034]) {
            const result = await strike(0, speed, direction, true, distance, height);
            expect(result.touches).toBeGreaterThanOrEqual(1);
            expect(result.x * direction).toBeGreaterThan(0.7);
            expect(Math.abs(result.angle)).toBeLessThan(0.5);
          }
    },
  );

  it.each([1, 3, 7])(
    "also deflects rolling %i m/s impacts through real contact normals",
    async (speed) => {
      for (const direction of [1, -1]) {
        const center = await strike(0, speed, direction, false);
        const left = await strike(-0.04, speed, direction, false);
        const right = await strike(0.04, speed, direction, false);
        expect(center.x * direction).toBeLessThan(0);
        expect(Math.abs(center.angle)).toBeLessThan(1);
        expect(right.touches).toBe(1);
        expect(left.touches).toBe(1);
        expect(right.angle).toBeGreaterThan(15);
        // Triangle-floor contact rounding remains well below a visible aiming change.
        expect(Math.abs(left.angle + right.angle)).toBeLessThan(0.01);
      }
    },
  );

  it("caps even the hardest stroke at a 2.5 second pitch crossing", async () => {
    expect(C.ball.maxSpeed).toBe((2 * C.table.halfLength) / 2.5);
    for (const speed of [6, 12, 24, 35]) {
      const shot = await strike(0, speed, 1);
      expect(shot.x).toBeGreaterThan(0.7);
      expect(Math.hypot(shot.x, shot.y, shot.z)).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
    }
  });

  it("leaves a missed ball untouched instead of steering it toward a shot direction", async () => {
    const missed = await strike(0.09, 12, 1);
    expect(missed.touches).toBe(0);
    expect(Math.abs(missed.x)).toBeLessThan(0.0001);
    expect(Math.abs(missed.z)).toBeLessThan(0.0001);
  });
});

describe("downward foot pressure", () => {
  it.each([-1, 1])("brakes and traps real downward strokes in direction %i, then lets the player retract", async (direction) => {
    for (const speed of [6, 12, 35])
      for (const offset of [0, 0.04, 0.06]) {
        const physics = await PhysicsWorld.create();
        try {
          const rod = physics.rods.find((candidate) => candidate.layout.team === "red" && candidate.layout.id === 3)!;
          for (const other of physics.rods)
            if (other !== rod)
              for (let i = 0; i < other.body.numColliders(); i++) other.body.collider(i).setEnabled(false);
          rod.state.angle = -direction * 1.2;
          rod.state.velocity = direction * speed;
          rod.state.desiredVelocity = direction * speed;
          rod.state.active = true;
          rod.body.setRotation({ x: 0, y: 0, z: Math.sin(rod.state.angle / 2), w: Math.cos(rod.state.angle / 2) }, true);
          const initial = { x: rod.layout.x - direction * 0.1, y: C.ball.radius + 0.0001, z: offset };
          physics.ball.setTranslation(initial, true);
          physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
          physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
          let blockedAngle: number | undefined;
          for (let step = 0; step < 150; step++) {
            rod.state.age = 0;
            physics.step(C.physics.timestep, 1.5);
            if (rod.state.velocity === 0 && blockedAngle === undefined) blockedAngle = rod.state.angle;
            if (blockedAngle !== undefined) {
              expect(Math.abs(rod.state.angle - blockedAngle)).toBeLessThan(0.02);
              expect(rod.body.rotation().z).toBeCloseTo(Math.sin(rod.state.angle / 2), 6);
              const velocity = physics.ball.linvel();
              expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBe(0);
            }
          }
          expect(blockedAngle).toBeDefined();
          const position = physics.ball.translation();
          expect(Math.hypot(position.x - initial.x, position.z - initial.z)).toBeLessThan(0.002);
          // Keeping the foot in place also keeps a stopped ball quiet.
          rod.state.desiredVelocity = 0;
          for (let step = 0; step < 30; step++) {
            rod.state.age = 0;
            physics.step(C.physics.timestep, 1.5);
          }
          expect(Math.abs(rod.state.angle - blockedAngle!)).toBeLessThan(0.02);
          rod.state.desiredVelocity = -direction * 12;
          for (let step = 0; step < 15; step++) {
            rod.state.age = 0;
            physics.step(C.physics.timestep, 1.5);
          }
          expect((rod.state.angle - blockedAngle!) * direction).toBeLessThan(-0.5);
        } finally { physics.dispose(); }
      }
  });
});

describe("sideways release from a trapped ball", () => {
  function positionAndTrap(physics: PhysicsWorld, rod: PhysicsWorld["rods"][number], direction: number, offset: number) {
    rod.state.angle = -direction * 1.2;
    rod.state.velocity = rod.state.desiredVelocity = direction * 12;
    rod.state.active = true;
    rod.body.setRotation({ x: 0, y: 0, z: Math.sin(rod.state.angle / 2), w: Math.cos(rod.state.angle / 2) }, true);
    physics.ball.setTranslation({ x: rod.layout.x - direction * 0.1, y: C.ball.radius + 0.0001, z: offset }, true);
    physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (let tick = 0; tick < 120 && physics.groundedPinDirection("red", 3) === undefined; tick++) {
      rod.state.age = 0;
      physics.step(C.physics.timestep, 1.5);
    }
    expect(physics.groundedPinDirection("red", 3)).toBe(direction);
  }
  async function trapBall(direction: number, offset = 0) {
    const physics = await PhysicsWorld.create();
    const rod = physics.rods.find((candidate) => candidate.layout.team === "red" && candidate.layout.id === 3)!;
    for (const other of physics.rods)
      if (other !== rod)
        for (let i = 0; i < other.body.numColliders(); i++) other.body.collider(i).setEnabled(false);
    positionAndTrap(physics, rod, direction, offset);
    return { physics, rod };
  }
  function slide(physics: PhysicsWorld, rod: PhysicsWorld["rods"][number], velocity: number) {
    rod.state.age = 0;
    rod.state.target = rod.state.translation + velocity * C.physics.timestep;
    physics.step(C.physics.timestep, 1.5);
  }

  it.each([-1, 1])("rolls a pin from side %i with mirrored gestures and a small correction toward the rod", async (direction) => {
    for (const lateralDirection of [-1, 1])
      for (const offset of [0, 0.06]) {
        const { physics, rod } = await trapBall(direction, offset);
        try {
          const before = { ...physics.ball.translation() };
          const angle = rod.state.angle;
          slide(physics, rod, lateralDirection * 0.25);
          const velocity = physics.ball.linvel(), position = physics.ball.translation();
          expect(velocity.z * lateralDirection).toBeGreaterThan(0.25);
          expect(velocity.z * lateralDirection).toBeLessThanOrEqual(0.25 * C.ball.pinReleaseSpeedGain);
          expect(velocity.x * direction).toBeGreaterThan(0);
          expect(Math.abs(velocity.x / velocity.z)).toBeCloseTo(C.ball.pinReleaseInwardRatio, 3);
          expect(Math.abs(position.x - rod.layout.x)).toBeLessThan(Math.abs(before.x - rod.layout.x));
          expect((position.z - before.z) * lateralDirection).toBeGreaterThan(0);
          // Movement is integrated by Rapier, with no position jump out of the foot.
          expect(Math.hypot(position.x - before.x, position.z - before.z)).toBeLessThan(C.ball.maxSpeed * C.physics.timestep);
          expect(Math.abs(Math.abs(physics.ball.angvel().x * C.ball.radius) - Math.abs(velocity.z))).toBeLessThan(0.002);
          expect(physics.groundedPinDirection("red", 3)).toBeUndefined();
          expect(Math.abs(rod.state.angle - angle)).toBeLessThan(0.002);
          expect(rod.state.velocity).toBe(0);
        } finally { physics.dispose(); }
      }
  });

  it("bounds a fast release and gives only one impulse while the same foot remains nearby", async () => {
    const { physics, rod } = await trapBall(1);
    try {
      slide(physics, rod, 8);
      const velocity = physics.ball.linvel();
      expect(velocity.z).toBeGreaterThan(C.ball.pinReleaseMaxSpeed * 0.9);
      expect(velocity.z).toBeLessThanOrEqual(C.ball.pinReleaseMaxSpeed);
      expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBeLessThan(C.ball.maxSpeed);
    } finally { physics.dispose(); }

    const held = await trapBall(1);
    try {
      slide(held.physics, held.rod, 0.25);
      // Cancel momentum while it is still at the same real foot, as another
      // obstacle could. Continuing or reversing the gesture cannot pump it.
      held.physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      held.physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      held.rod.state.desiredVelocity = 0;
      for (let tick = 0; tick < 12; tick++) {
        slide(held.physics, held.rod, (tick % 2 ? -1 : 1) * 0.25);
        const velocity = held.physics.ball.linvel();
        expect(Math.hypot(velocity.x, velocity.z)).toBeLessThan(0.01);
      }
    } finally { held.physics.dispose(); }
  });

  it("leaves an unmoved pin quiet and does not release a remote ball or a disabled foot", async () => {
    const { physics, rod } = await trapBall(1);
    try {
      for (let tick = 0; tick < 12; tick++) {
        slide(physics, rod, 0.01);
        const velocity = physics.ball.linvel();
        expect(Math.hypot(velocity.x, velocity.y, velocity.z)).toBe(0);
      }
      physics.ball.setTranslation({ x: 0, y: C.ball.radius + 0.0001, z: 0 }, true);
      slide(physics, rod, 0.25);
      expect(Math.hypot(physics.ball.linvel().x, physics.ball.linvel().z)).toBeLessThan(0.0001);
    } finally { physics.dispose(); }

    const disabled = await trapBall(1);
    try {
      disabled.rod.state.desiredVelocity = 0;
      disabled.rod.body.collider(4).setEnabled(false);
      slide(disabled.physics, disabled.rod, 0.25);
      expect(Math.hypot(disabled.physics.ball.linvel().x, disabled.physics.ball.linvel().z)).toBeLessThan(0.0001);
    } finally { disabled.physics.dispose(); }
  });

  it("allows a new release after a true clearance or a new serve, park, or rod reset", async () => {
    for (const reset of ["clearance", "serve", "park", "rods"] as const) {
      const { physics, rod } = await trapBall(1);
      try {
        slide(physics, rod, 0.25);
        rod.state.desiredVelocity = 0;
        if (reset === "clearance") {
          for (let tick = 0; tick < 75; tick++) slide(physics, rod, 0);
        } else if (reset === "serve") physics.serve(1);
        else if (reset === "park") physics.parkBall();
        else physics.resetRods();
        // Start a separate real pin at this rod, after the previous encounter.
        positionAndTrap(physics, rod, 1, rod.state.translation);
        slide(physics, rod, -0.25);
        expect(physics.ball.linvel().z).toBeLessThan(-0.25);
      } finally { physics.dispose(); }
    }
  });
});

describe("ball speed budget", () => {
  const speed = (value: { x: number; y: number; z: number }) => Math.hypot(value.x, value.y, value.z);
  async function singleAttacker() {
    const physics = await PhysicsWorld.create();
    const rod = physics.rods.find((candidate) => candidate.layout.team === "red" && candidate.layout.id === 3)!;
    for (const other of physics.rods)
      if (other !== rod)
        for (let i = 0; i < other.body.numColliders(); i++) other.body.collider(i).setEnabled(false);
    return { physics, rod };
  }
  function drivenHit(physics: PhysicsWorld, rod: PhysicsWorld["rods"][number], incomingSpeed: number) {
    rod.state.angle = -0.5;
    rod.state.velocity = rod.state.desiredVelocity = 35;
    rod.state.active = true;
    rod.body.setRotation({ x: 0, y: 0, z: Math.sin(-0.25), w: Math.cos(-0.25) }, true);
    physics.ball.setTranslation({ x: rod.layout.x + 0.09, y: C.ball.radius + 0.0001, z: 0 }, true);
    physics.ball.setLinvel({ x: -incomingSpeed, y: 0, z: 0 }, true);
    physics.ball.setAngvel({ x: 0, y: 0, z: incomingSpeed / C.ball.radius }, true);
    for (let tick = 0; tick < 30; tick++) {
      rod.state.age = 0;
      const incoming = speed(physics.ball.linvel());
      physics.step(C.physics.timestep, 1.5);
      if (physics.drainBallTouches().includes(physics.rods.indexOf(rod)))
        return { incoming: incoming > C.ball.stuckSpeed ? incoming : 0, outgoing: speed(physics.ball.linvel()) };
    }
    throw new Error("The real driven foot did not hit the ball");
  }

  it.each([0, 0.5, C.ball.maxSpeed])("allows incoming %i m/s to add to the base limit for one real strike", async (incomingSpeed) => {
    const { physics, rod } = await singleAttacker();
    try {
      const hit = drivenHit(physics, rod, incomingSpeed);
      const maximum = C.ball.maxSpeed + hit.incoming;
      expect(hit.outgoing).toBeCloseTo(maximum, 5);
      for (let tick = 0; tick < 8; tick++) {
        rod.state.age = 0;
        physics.step(C.physics.timestep, 1.5);
        expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(maximum + 1e-6);
        if (incomingSpeed > 0) expect(speed(physics.ball.linvel())).toBeGreaterThan(C.ball.maxSpeed + 0.1);
      }
    } finally { physics.dispose(); }
  });

  it("uses the actual already-boosted incoming speed on a later separate strike", async () => {
    const { physics, rod } = await singleAttacker();
    try {
      const first = drivenHit(physics, rod, 1);
      // The previous shot has physically left this rod before another encounter.
      physics.ball.setTranslation({ x: -0.3, y: 0.2, z: 0 }, true);
      physics.ball.setLinvel({ x: first.outgoing, y: 0, z: 0 }, true);
      rod.state.velocity = rod.state.desiredVelocity = 0;
      for (let tick = 0; tick < 6; tick++) {
        rod.state.age = 0;
        physics.step(C.physics.timestep, 1.5);
        physics.drainBallTouches();
      }
      const second = drivenHit(physics, rod, speed(physics.ball.linvel()));
      expect(second.incoming).toBeGreaterThan(C.ball.maxSpeed + 0.5);
      expect(second.outgoing).toBeCloseTo(C.ball.maxSpeed + second.incoming, 5);
      expect(second.outgoing).toBeGreaterThan(first.outgoing + 0.5);
    } finally { physics.dispose(); }
  });

  it("gives a stationary foot no incoming-speed bonus", async () => {
    const { physics, rod } = await singleAttacker();
    try {
      physics.ball.setTranslation({ x: rod.layout.x - 0.079, y: C.ball.radius + 0.0001, z: 0 }, true);
      physics.ball.setLinvel({ x: 0.8, y: 0, z: 0 }, true);
      physics.ball.setAngvel({ x: 0, y: 0, z: -0.8 / C.ball.radius }, true);
      physics.step(C.physics.timestep, 1.5);
      expect(physics.drainBallTouches()).toContain(physics.rods.indexOf(rod));
      physics.ball.setTranslation({ x: -0.3, y: 0.2, z: 0 }, true);
      physics.ball.setLinvel({ x: 4, y: 0, z: 0 }, true);
      physics.step(C.physics.timestep, 1.5);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
    } finally { physics.dispose(); }
  });

  it("does not renew a contact bonus until the ball has genuinely left the foot", async () => {
    const { physics, rod } = await singleAttacker();
    try {
      const hit = drivenHit(physics, rod, 0.5);
      const maximum = C.ball.maxSpeed + hit.incoming;
      const atContact = { ...physics.ball.translation() };
      const angle = rod.state.angle;
      // Reproduce alternating collision start/end reports near the same foot.
      // The shallow positional jitter never clears its 10 mm encounter margin.
      for (let tick = 0; tick < 24; tick++) {
        rod.state.age = 0;
        rod.state.angle = angle;
        rod.state.velocity = rod.state.desiredVelocity = 0.2;
        rod.state.active = true;
        rod.body.setRotation({ x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) }, true);
        physics.ball.setTranslation({ ...atContact, x: atContact.x + (tick % 2 ? 0.004 : 0) }, true);
        physics.ball.setLinvel({ x: maximum, y: 0, z: 0 }, true);
        physics.step(C.physics.timestep, 1.5);
        expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(maximum + 1e-6);
      }
    } finally { physics.dispose(); }
  });

  it("resets a boosted flight on stopping, serving, and bumping instead of carrying an old allowance", async () => {
    const { physics, rod } = await singleAttacker();
    try {
      drivenHit(physics, rod, 1);
      physics.ball.setTranslation({ x: -0.3, y: C.ball.radius, z: 0 }, true);
      physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      physics.step(C.physics.timestep, 1.5);
      physics.ball.setLinvel({ x: 5, y: 0, z: 0 }, true);
      physics.step(C.physics.timestep, 1.5);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
      physics.serve(1);
      physics.bump(100);
      expect(speed(physics.ball.linvel())).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
      physics.parkBall();
      expect(speed(physics.ball.linvel())).toBe(0);
    } finally { physics.dispose(); }
  });

  it.each([-1, 1])("adds a mirrored lateral gesture to a real contact arriving from direction %i", async (direction) => {
    const outgoing: { x: number; y: number; z: number }[] = [];
    for (const slide of [-1, 0, 1]) {
      const { physics, rod } = await singleAttacker();
      try {
        physics.ball.setTranslation({ x: rod.layout.x - direction * 0.079, y: C.ball.radius + 0.0001, z: 0 }, true);
        physics.ball.setLinvel({ x: direction * 0.8, y: 0, z: 0 }, true);
        physics.ball.setAngvel({ x: 0, y: 0, z: -direction * 0.8 / C.ball.radius }, true);
        rod.state.active = true;
        rod.state.target = slide * 0.3 * C.physics.timestep;
        physics.step(C.physics.timestep, 1.5);
        expect(physics.drainBallTouches()).toContain(physics.rods.indexOf(rod));
        const velocity = physics.ball.linvel();
        expect(velocity.x * direction).toBeLessThan(0);
        outgoing.push({ ...velocity });
      } finally { physics.dispose(); }
    }
    expect(outgoing[0]!.z).toBeLessThan(-0.02);
    expect(Math.abs(outgoing[1]!.z)).toBeLessThan(0.001);
    expect(outgoing[2]!.z).toBeGreaterThan(0.02);
    expect(outgoing[0]!.z).toBeCloseTo(-outgoing[2]!.z, 5);
    expect(outgoing[0]!.x).toBeCloseTo(outgoing[2]!.x, 5);
  });

  it.each(["red", "blue"] as const)("does not keep powering a ball against the board after the %s goalkeeper stops", async (team) => {
    const physics = await PhysicsWorld.create();
    try {
      const rod = physics.rods.find((candidate) => candidate.layout.team === team && candidate.layout.id === 0)!;
      const direction = team === "red" ? -1 : 1;
      const index = physics.rods.indexOf(rod);
      for (const other of physics.rods)
        if (other !== rod)
          for (let i = 0; i < other.body.numColliders(); i++) other.body.collider(i).setEnabled(false);
      rod.state.translation = rod.state.target = 0.25;
      rod.state.angle = 0;
      rod.state.velocity = rod.state.desiredVelocity = direction * 24;
      rod.state.active = true;
      rod.body.setTranslation({ x: rod.layout.x, y: C.table.rodHeight, z: 0.25 }, true);
      physics.ball.setTranslation({ x: rod.layout.x + direction * 0.09, y: C.ball.radius + 0.0001, z: 0.25 }, true);
      physics.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
      physics.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
      let struck = false;
      for (let step = 0; step < 30 && !struck; step++) {
        rod.state.age = 0;
        physics.step(C.physics.timestep, 1.5);
        struck = physics.drainBallTouches().includes(index);
      }
      expect(struck).toBe(true);
      expect(Math.hypot(...Object.values(physics.ball.linvel()))).toBeGreaterThan(0.5);
      const heldAngle = rod.state.angle;
      for (let step = 0; step < 360; step++) {
        rod.state.age = 0;
        rod.state.velocity = rod.state.desiredVelocity = 0;
        physics.step(C.physics.timestep, 1.5);
        expect(rod.state.angle).toBe(heldAngle);
        if (step > 120)
          expect(Math.hypot(...Object.values(physics.ball.linvel()))).toBeLessThan(0.1);
      }
      expect(Math.hypot(...Object.values(physics.ball.linvel()))).toBeLessThan(0.01);
    } finally { physics.dispose(); }
  });

  it("caps serving and bump impulses immediately, including spin", async () => {
    const physics = await PhysicsWorld.create();
    try {
      const assertSpeed = () => {
        const v = physics.ball.linvel(), a = physics.ball.angvel();
        expect(Math.hypot(v.x, v.y, v.z)).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
        expect(Math.hypot(a.x, a.y, a.z) * C.ball.radius).toBeLessThanOrEqual(C.ball.maxSpeed + 1e-6);
      };
      physics.serve(1);
      assertSpeed();
      physics.bump(100);
      assertSpeed();
      physics.ball.setAngvel({ x: 0, y: 10000, z: 0 }, true);
      physics.ball.setLinvel({ x: 100, y: 0, z: 0 }, true);
      const before = physics.ball.translation();
      physics.step(C.physics.timestep, 1.5);
      assertSpeed();
      expect(Math.abs(physics.ball.translation().x - before.x)).toBeLessThan(C.ball.maxSpeed * C.physics.timestep + 0.001);
    } finally { physics.dispose(); }
  });
});
