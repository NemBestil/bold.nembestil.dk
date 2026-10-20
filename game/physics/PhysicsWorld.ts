import RAPIER from "@dimforge/rapier3d-compat";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../GameConfig";
import {
  advanceRod,
  applyRodInput,
  createRodState,
  type RodState,
  servingState,
} from "../systems/GameRules";
import type { RodInput, Team } from "../../shared/types";
import { superellipseFootCollider } from "./FootShape";
import { footStrikingNormal, limitGroundedFootRotation } from "./FootProfile";
import { createPlayingSurfaceMesh, playingSurfaceHeight } from "../table/PlayingSurface";

let initialization: Promise<void> | undefined;
// Figures are constrained by their bearings and input limits. Their new free
// rotation exchanges momentum with the ball, without adding board/figure jams.
const COLLISION_GROUPS = { ball: 0x0001_0006, figure: 0x0002_0001, table: 0x0004_0001 };
export interface BallImpact {
  kind: "kick" | "wall";
  strength: number;
}
export class PhysicsWorld {
  world: RAPIER.World;
  ball: RAPIER.RigidBody;
  private ballCollider: RAPIER.Collider;
  private servingGates = new Map<number, RAPIER.Collider>();
  private servingSide: number | null = null;
  private events = new RAPIER.EventQueue(true);
  private figureRods = new Map<number, number>();
  private footFigures = new Map<number, { rodIndex: number; offset: number }>();
  private activeFootAims = new Map<number, { x: number; z: number; minimumSpeed: number }>();
  private activeFigureContacts = new Map<number, number>();
  private ballTouches: number[] = [];
  private soundWalls = new Set<number>();
  private impacts: BallImpact[] = [];
  private impactTime = 0;
  private lastImpacts = new Map<string, number>();
  private groundedPins = new Map<number, number>();
  private pinReleases = new Map<number, { direction: number; foot: number; clearSince?: number }>();
  private ballSpeedLimit: number = C.ball.maxSpeed;
  private ballSpeedScale = 1;
  private spentStrikes = new Map<number, { clearSince?: number }>();
  private intentionalReleaseUntil = new Map<number, number>();
  private poweredRods = new Set<number>();
  rods: {
    body: RAPIER.RigidBody;
    state: RodState;
    layout: (typeof ROD_LAYOUT)[number];
  }[] = [];
  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: C.physics.gravity, z: 0 });
    this.world.timestep = C.physics.timestep;
    this.world.integrationParameters.maxCcdSubsteps = 4;
    this.world.integrationParameters.numSolverIterations = 8;
    const fixed = (
      x: number,
      y: number,
      z: number,
      hx: number,
      hy: number,
      hz: number,
    ) => {
      const collider = this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setTranslation(x, y, z)
          .setCollisionGroups(COLLISION_GROUPS.table)
          .setRestitution(0.45)
          .setFriction(0.4),
      );
      this.soundWalls.add(collider.handle);
      return collider;
    };
    // A single shared mesh joins the flat pitch, raised borders and corner ramps.
    // Its goal and serving extensions have no lips or gaps; gravity alone rolls
    // a resting ball back down the slopes, with no corrective ball impulses.
    const surface = createPlayingSurfaceMesh();
    this.world.createCollider(
      RAPIER.ColliderDesc.trimesh(
        surface.vertices,
        surface.indices,
        RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.ORIENTED,
      )
        .setCollisionGroups(COLLISION_GROUPS.table)
        .setRestitution(0.45)
        .setFriction(0.4),
    );
    const segmentHalf = (C.table.halfLength - C.table.servingHoleHalfWidth) / 2;
    for (const side of [-1, 1]) {
      for (const sign of [-1, 1])
        fixed(
          sign * (segmentHalf + C.table.servingHoleHalfWidth),
          C.table.wallHeight / 2,
          side * C.table.wallZ,
          segmentHalf,
          C.table.wallHeight / 2,
          C.table.wallThickness / 2,
        );
      fixed(
        0,
        (C.table.wallHeight + C.table.servingHoleHeight) / 2,
        side * C.table.wallZ,
        C.table.servingHoleHalfWidth,
        (C.table.wallHeight - C.table.servingHoleHeight) / 2,
        C.table.wallThickness / 2,
      );
      // A real serving flap prevents the opposite hole from becoming an exit.
      // Only the selected entrance opens, until the ball has fully crossed it.
      this.servingGates.set(
        side,
        fixed(
          0,
          C.table.servingHoleHeight / 2,
          side * C.table.wallZ,
          C.table.servingHoleHalfWidth,
          C.table.servingHoleHeight / 2,
          C.table.wallThickness / 2,
        ),
      );
      const goalWingHalf = (C.table.halfWidth - C.table.goalHalfWidth) / 2;
      for (const sign of [-1, 1])
        fixed(
          side * C.table.endWallX,
          C.table.wallHeight / 2,
          sign * (C.table.goalHalfWidth + goalWingHalf),
          0.055,
          C.table.wallHeight / 2,
          goalWingHalf,
        );
      fixed(
        side * C.table.endWallX,
        (C.table.wallHeight + C.table.goalHeight) / 2,
        0,
        0.055,
        (C.table.wallHeight - C.table.goalHeight) / 2,
        C.table.goalHalfWidth,
      );
      fixed(
        side * C.table.goalBackX,
        0.1,
        0,
        0.035,
        0.1,
        C.table.goalHalfWidth,
      );
      fixed(side * 1.61, 0.1, C.table.goalHalfWidth + 0.025, 0.15, 0.1, 0.025);
      fixed(side * 1.61, 0.1, -C.table.goalHalfWidth - 0.025, 0.15, 0.1, 0.025);
    }
    for (const layout of ROD_LAYOUT) {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
          layout.x,
          C.table.rodHeight,
          0,
        ).lockTranslations().enabledRotations(false, false, true)
          .setGravityScale(0).setCanSleep(false)
          .setAdditionalMassProperties(1, { x: 0, y: 0, z: 0 },
            { x: C.rods.passiveAngularInertia, y: C.rods.passiveAngularInertia, z: C.rods.passiveAngularInertia },
            { x: 0, y: 0, z: 0, w: 1 }),
      );
      for (let p = 0; p < layout.count; p++) {
        const z = (p - (layout.count - 1) / 2) * layout.spacing;
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(
            C.figure.bodyHalfWidth,
            C.figure.bodyHalfHeight,
            C.figure.bodyHalfDepth,
          )
            .setTranslation(0, C.figure.bodyY, z)
            .setDensity(0)
            .setCollisionGroups(COLLISION_GROUPS.figure)
            .setFriction(0.35)
            .setRestitution(0.4),
          body,
        );
        const foot = this.world.createCollider(
          superellipseFootCollider()
            .setTranslation(0, C.figure.footY, z)
            .setDensity(0)
            .setCollisionGroups(COLLISION_GROUPS.figure)
            .setFriction(C.figure.footFriction)
            .setRestitution(C.figure.footRestitution),
          body,
        );
        this.footFigures.set(foot.handle, { rodIndex: this.rods.length, offset: z });
        this.world.createCollider(
          RAPIER.ColliderDesc.ball(C.figure.headRadius).setTranslation(
            0,
            C.figure.headY,
            z,
          ).setDensity(0).setCollisionGroups(COLLISION_GROUPS.figure),
          body,
        );
      }
      const rodIndex = this.rods.length;
      for (let i = 0; i < body.numColliders(); i++)
        this.figureRods.set(body.collider(i).handle, rodIndex);
      this.rods.push({ body, state: createRodState(), layout });
    }
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0.07, C.ball.radius + 0.005, -0.04)
        .setCcdEnabled(true)
        .setCanSleep(true)
        .setLinearDamping(C.ball.linearDamping)
        .setAngularDamping(C.ball.angularDamping),
    );
    this.ballCollider = this.world.createCollider(
      RAPIER.ColliderDesc.ball(C.ball.radius)
        .setCollisionGroups(COLLISION_GROUPS.ball)
        .setActiveEvents(
          RAPIER.ActiveEvents.COLLISION_EVENTS |
            RAPIER.ActiveEvents.CONTACT_FORCE_EVENTS,
        )
        .setContactForceEventThreshold(0.01)
        .setMass(C.ball.mass)
        .setRestitution(C.ball.restitution)
        .setFriction(C.ball.friction),
      this.ball,
    );
  }
  static async create() {
    initialization ??= RAPIER.init();
    await initialization;
    return new PhysicsWorld();
  }
  input(team: Team, input: RodInput) {
    const index = this.rods.findIndex(
      (r) => r.layout.team === team && r.layout.id === input.rodId,
    );
    const rod = this.rods[index];
    if (rod) {
      const released = !input.active && (rod.state.active || input.flick);
      applyRodInput(rod.state, input, rod.layout.travel);
      if (released) this.intentionalReleaseUntil.set(index, this.impactTime + C.rods.inertiaGrace);
      else if (input.active) this.intentionalReleaseUntil.delete(index);
    }
  }
  groundedPinDirection(team: Team, rodId: number): number | undefined {
    const index = this.rods.findIndex((rod) => rod.layout.team === team && rod.layout.id === rodId);
    return this.groundedPins.get(index);
  }
  private get baseBallSpeed() { return C.ball.maxSpeed * this.ballSpeedScale; }
  setBallSpeed(multiplier = 1) {
    const previous = this.baseBallSpeed;
    this.ballSpeedScale = Number.isFinite(multiplier) ? Math.max(0.5, Math.min(2, multiplier)) : 1;
    // Preserve the relative allowance of a legitimately boosted flight. Raising
    // the setting never adds velocity; lowering it immediately enforces the cap.
    this.ballSpeedLimit *= this.baseBallSpeed / previous;
    this.capBallSpeed();
  }
  step(dt: number, damping: number) {
    const current = this.ball.linvel();
    if (Math.hypot(current.x, current.y, current.z) <= this.baseBallSpeed + 1e-6)
      this.ballSpeedLimit = this.baseBallSpeed;
    this.capBallSpeed();
    // Gravity cannot wake a suspended body. A ball on a raised pitch surface
    // must remain free to roll down, even after Rapier classifies it as at rest.
    if (this.ball.isSleeping()) {
      const position = this.ball.translation();
      if (Math.abs(position.x) <= C.table.halfLength &&
          Math.abs(position.z) <= C.table.halfWidth &&
          playingSurfaceHeight(position.x, position.z) > 1e-6)
        this.ball.wakeUp();
    }
    const velocityBeforeImpact = this.ball.linvel();
    this.impactTime += dt;
    this.rearmSeparatedStrikes();
    this.closeEnteredServingGate();
    let pinned = false;
    const ballPosition = this.ball.translation();
    const surfaceHeight = playingSurfaceHeight(ballPosition.x, ballPosition.z);
    const rodPosesBeforeStep = this.rods.map((rod) => ({ angle: rod.state.angle, translation: rod.state.translation }));
    this.poweredRods.clear();
    for (const [index, rod] of this.rods.entries()) {
      const fromAngle = rod.state.angle, fromTranslation = rod.state.translation;
      advanceRod(rod.state, dt, damping);
      const controlled = rod.state.active || (this.intentionalReleaseUntil.get(index) ?? -Infinity) >= this.impactTime;
      if (controlled) this.poweredRods.add(index);
      this.releasePinWithSlide(index, (rod.state.translation - fromTranslation) / dt);
      const figureOffsets: number[] = [];
      if (Math.abs(ballPosition.x - rod.layout.x) <= 0.28)
        for (let player = 0; player < rod.layout.count; player++)
          if (rod.body.collider(player * 3 + 1).isEnabled())
            figureOffsets.push((player - (rod.layout.count - 1) / 2) * rod.layout.spacing);
      const limit = limitGroundedFootRotation({
        fromAngle, toAngle: rod.state.angle,
        fromTranslation, toTranslation: rod.state.translation,
        rodX: rod.layout.x,
        figureOffsets,
        ball: ballPosition, surfaceHeight,
        heldDirection: this.groundedPins.get(index) ?? this.pinReleases.get(index)?.direction,
      });
      if (controlled && limit.blocked && this.ball.linvel().y < 0.3) {
        rod.state.angle = limit.angle;
        rod.state.velocity = 0;
        // The foot still cannot rotate down through a rolling release. Only
        // its former ball-stopping constraint is released by the side gesture.
        if (this.pinReleases.has(index)) this.groundedPins.delete(index);
        else {
          this.groundedPins.set(index, limit.direction);
          pinned = true;
        }
      } else this.groundedPins.delete(index);
      // A held player supplies its own motor. An unheld rod has finite inertia
      // and can receive a real angular impulse, without sliding out of its bearings.
      const kinematic = rod.state.active || (controlled && (limit.blocked || rod.state.translation !== fromTranslation));
      rod.body.setBodyType(kinematic ? RAPIER.RigidBodyType.KinematicPositionBased : RAPIER.RigidBodyType.Dynamic, true);
      if (kinematic) {
        rod.body.setNextKinematicTranslation({ x: rod.layout.x, y: C.table.rodHeight, z: rod.state.translation });
        rod.body.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(rod.state.angle / 2), w: Math.cos(rod.state.angle / 2) });
      } else {
        rod.state.translation = rod.state.target = fromTranslation;
        // advanceRod calculated gravity/damping and a prospective angle. Only
        // Rapier integrates that velocity for a free rod, avoiding a second turn.
        const freeAngle = rod.state.velocity === 0 ? rod.state.angle : fromAngle;
        rod.state.angle = freeAngle;
        const rotation = rod.body.rotation();
        const bodyAngle = 2 * Math.atan2(rotation.z, rotation.w);
        if (Math.abs(Math.atan2(Math.sin(bodyAngle - freeAngle), Math.cos(bodyAngle - freeAngle))) > 1e-5)
          rod.body.setRotation({ x: 0, y: 0, z: Math.sin(freeAngle / 2), w: Math.cos(freeAngle / 2) }, true);
        // Axis locks reject forces, but a kinematic body's last translation
        // velocity must also be discarded when its motor is released.
        rod.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rod.body.setAngvel({ x: 0, y: 0, z: rod.state.velocity }, true);
      }
    }
    if (pinned) this.stopBall();
    this.world.step(this.events);
    if (pinned) this.stopBall();
    this.closeEnteredServingGate();
    this.collectBallTouches(ballPosition, rodPosesBeforeStep, velocityBeforeImpact);
    this.collectBallImpacts(velocityBeforeImpact);
    for (const rod of this.rods) {
      if (!rod.body.isDynamic()) continue;
      const rotation = rod.body.rotation();
      const angle = 2 * Math.atan2(rotation.z, rotation.w);
      rod.state.velocity = rod.body.angvel().z;
      // An untouched inverted latch keeps its exact chosen angle rather than
      // accumulating Float32 quaternion round-off. Real contact can unlock it.
      if (!rod.state.upsideDownLocked || Math.abs(rod.state.velocity) > 1e-6)
        rod.state.angle += Math.atan2(Math.sin(angle - rod.state.angle), Math.cos(angle - rod.state.angle));
      if (rod.state.upsideDownLocked && Math.abs(rod.state.velocity) > 0.05) rod.state.upsideDownLocked = false;
    }
    if (pinned) this.stopBall();
    this.capBallSpeed();
  }
  private stopBall() {
    this.ballSpeedLimit = this.baseBallSpeed;
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  private releasePinWithSlide(rodIndex: number, lateralSpeed: number) {
    const direction = this.groundedPins.get(rodIndex);
    if (direction === undefined || this.pinReleases.has(rodIndex) || Math.abs(lateralSpeed) <= 0.03) return;
    const incoming = this.ball.linvel();
    if (Math.hypot(incoming.x, incoming.y, incoming.z) > C.ball.stuckSpeed) return;
    const rod = this.rods[rodIndex]!;
    for (let figure = 0; figure < rod.layout.count; figure++) {
      const foot = rod.body.collider(figure * 3 + 1);
      // The previous tick's geometric pin must also be a real enabled foot
      // beside this ball; a stale pin cannot move a ball elsewhere on the pitch.
      if (!foot.isEnabled()) continue;
      const contact = foot.contactShape(this.ballCollider.shape, this.ball.translation(), this.ball.rotation(), 0.002);
      if (!contact || contact.normal1.y > -0.4) continue;
      const speed = Math.min(C.ball.pinReleaseMaxSpeed * this.ballSpeedScale, Math.abs(lateralSpeed) * C.ball.pinReleaseSpeedGain);
      const z = Math.sign(lateralSpeed) * speed;
      const x = Math.sign(rod.layout.x - this.ball.translation().x) * speed * C.ball.pinReleaseInwardRatio;
      this.pinReleases.set(rodIndex, { direction, foot: foot.handle });
      this.groundedPins.delete(rodIndex);
      this.spentStrikes.set(rodIndex, {});
      this.ballSpeedLimit = this.baseBallSpeed;
      this.ball.applyImpulse({ x: (x - incoming.x) * this.ball.mass(), y: 0, z: (z - incoming.z) * this.ball.mass() }, true);
      this.ball.setAngvel({ x: z / C.ball.radius, y: 0, z: -x / C.ball.radius }, true);
      return;
    }
  }
  private capBallSpeed() {
    const v = this.ball.linvel();
    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > this.ballSpeedLimit) {
      const scale = this.ballSpeedLimit / speed;
      this.ball.setLinvel(
        { x: v.x * scale, y: v.y * scale, z: v.z * scale },
        true,
      );
    }
    const angular = this.ball.angvel();
    const spin = Math.hypot(angular.x, angular.y, angular.z);
    const maxSpin = this.ballSpeedLimit / C.ball.radius;
    if (spin > maxSpin) {
      const scale = maxSpin / spin;
      this.ball.setAngvel({ x: angular.x * scale, y: angular.y * scale, z: angular.z * scale }, true);
    }
  }
  private rearmSeparatedStrikes() {
    for (const [index, release] of this.pinReleases) {
      const foot = this.world.getCollider(release.foot);
      if (foot?.isEnabled() && foot.contactCollider(this.ballCollider, 0.01)) release.clearSince = undefined;
      else if (release.clearSince === undefined) release.clearSince = this.impactTime;
      else if (this.impactTime - release.clearSince >= 0.025) this.pinReleases.delete(index);
    }
    for (const [index, encounter] of this.spentStrikes) {
      const rod = this.rods[index]!;
      let nearby = false;
      for (let figure = 0; figure < rod.layout.count; figure++) {
        const foot = rod.body.collider(figure * 3 + 1);
        if (foot.isEnabled() && foot.contactCollider(this.ballCollider, 0.01)) { nearby = true; break; }
      }
      if (nearby) encounter.clearSince = undefined;
      else if (encounter.clearSince === undefined) encounter.clearSince = this.impactTime;
      else if (this.impactTime - encounter.clearSince >= 0.025) this.spentStrikes.delete(index);
    }
  }
  private closeEnteredServingGate() {
    if (this.servingSide === null) return;
    const insideEdge = C.table.wallZ - C.table.wallThickness / 2;
    if (
      this.ball.translation().z * this.servingSide + C.ball.radius <
      insideEdge
    ) {
      this.servingGates.get(this.servingSide)!.setEnabled(true);
      this.servingSide = null;
    }
  }
  private closeServingGates() {
    for (const gate of this.servingGates.values()) gate.setEnabled(true);
    this.servingSide = null;
  }
  private collectBallTouches(ballBefore: { x: number; y: number; z: number }, rodsBefore: { angle: number; translation: number }[], incoming: { x: number; y: number; z: number }) {
    const previouslyTouching = new Set(this.activeFigureContacts.values());
    const beganThisStep = new Set<number>();
    this.events.drainCollisionEvents((first, second, started) => {
      const other =
        first === this.ballCollider.handle
          ? second
          : second === this.ballCollider.handle
            ? first
            : undefined;
      if (other === undefined) return;
      if (!this.world.getCollider(other)?.isEnabled()) return;
      const rodIndex = this.figureRods.get(other);
      if (rodIndex === undefined) return;
      if (started) {
        this.activeFigureContacts.set(other, rodIndex);
        if (!previouslyTouching.has(rodIndex)) beganThisStep.add(rodIndex);
        const foot = this.footFigures.get(other);
        if (foot) {
          const rod = this.rods[foot.rodIndex]!;
          const before = rodsBefore[foot.rodIndex]!;
          const localX = Math.cos(before.angle) * (ballBefore.x - rod.layout.x) + Math.sin(before.angle) * (ballBefore.y - C.table.rodHeight);
          const normal = footStrikingNormal(ballBefore.z - before.translation - foot.offset, localX);
          let x = normal.x * Math.cos(before.angle), z = normal.z;
          const magnitude = Math.hypot(x, z);
          const footVelocityX = -rod.state.velocity * (ballBefore.y - C.table.rodHeight);
          const footVelocityZ = (rod.state.translation - before.translation) / C.physics.timestep;
          const drivenSpeed = magnitude > 1e-6 ? (footVelocityX * x + footVelocityZ * z) / magnitude : 0;
          const movementSpeed = Math.hypot(footVelocityX, footVelocityZ);
          const driven = this.poweredRods.has(foot.rodIndex) && movementSpeed > 0.03 && !this.groundedPins.has(foot.rodIndex) && !this.pinReleases.has(foot.rodIndex);
          const transfer = driven && !this.spentStrikes.has(foot.rodIndex);
          const measuredSpeed = Math.hypot(incoming.x, incoming.y, incoming.z);
          const incomingSpeed = measuredSpeed > C.ball.stuckSpeed ? measuredSpeed : 0;
          if (transfer) {
            this.spentStrikes.set(foot.rodIndex, {});
            this.ballSpeedLimit = this.baseBallSpeed + incomingSpeed;
          }
          if (driven && magnitude > 1e-6) {
            const weight = C.ball.rodDirectionInfluence * Math.min(1, movementSpeed / this.baseBallSpeed);
            x = x / magnitude * (1 - weight) + footVelocityX / movementSpeed * weight;
            z = z / magnitude * (1 - weight) + footVelocityZ / movementSpeed * weight;
          }
          this.activeFootAims.set(other, {
            x, z,
            // A swept fast foot can cross the ball within one solver step. Its
            // real closing motion still transfers a bounded, normal-directed kick.
            minimumSpeed: transfer && drivenSpeed > 0.03 ? Math.min(this.ballSpeedLimit,
              incomingSpeed + Math.min(this.baseBallSpeed, Math.max(0, drivenSpeed) * 0.7)) : 0,
          });
        }
      } else {
        this.activeFigureContacts.delete(other);
        this.activeFootAims.delete(other);
      }
    });
    for (const [handle, normal] of this.activeFootAims) {
      if (!this.world.getCollider(handle)?.isEnabled()) {
        this.activeFootAims.delete(handle);
        this.activeFigureContacts.delete(handle);
        continue;
      }
      const figure = this.footFigures.get(handle)!;
      this.resolveFootStrike(figure.rodIndex, normal);
    }
    for (const rodIndex of beganThisStep) {
      this.ballTouches.push(rodIndex);
      // Keep bounded even when a caller is not recording a replay.
      if (this.ballTouches.length > ROD_LAYOUT.length) this.ballTouches.shift();
    }
  }
  private resolveFootStrike(rodIndex: number, normal: { x: number; z: number; minimumSpeed: number }) {
    // Transfer the stroke once. Keeping this as a speed floor for the whole
    // contact would continually power a ball squeezed between a stopped foot
    // and a board, even after the player has stopped rotating the rod.
    const minimumSpeed = normal.minimumSpeed;
    normal.minimumSpeed = 0;
    if (!this.poweredRods.has(rodIndex) || this.groundedPins.has(rodIndex) || this.pinReleases.has(rodIndex)) return;
    const velocity = this.ball.linvel();
    const horizontalSpeed = Math.max(minimumSpeed, Math.hypot(velocity.x, velocity.z));
    if (horizontalSpeed < 0.03) return;
    const nx = normal.x, nz = normal.z;
    const magnitude = Math.hypot(nx, nz);
    // The solver and real foot motion supply speed. Aim blends the shared
    // superellipse normal with a bounded contribution from the actual stroke.
    if (magnitude < 1e-6 || (minimumSpeed <= 0.03 && velocity.x * nx + velocity.z * nz <= 0)) return;
    this.ball.setLinvel({ x: horizontalSpeed * nx / magnitude, y: velocity.y, z: horizontalSpeed * nz / magnitude }, true);
  }
  /** Distinct ball/figure contact starts, indexed like `rods`; floor/walls are excluded. */
  drainBallTouches(): number[] {
    return this.ballTouches.splice(0);
  }
  private collectBallImpacts(before: { x: number; y: number; z: number }) {
    const candidates = new Map<string, BallImpact>();
    this.events.drainContactForceEvents((event) => {
      const first = event.collider1(),
        second = event.collider2();
      const handle =
        first === this.ballCollider.handle
          ? second
          : second === this.ballCollider.handle
            ? first
            : undefined;
      if (handle === undefined) return;
      if (!this.world.getCollider(handle)?.isEnabled()) return;
      const rod = this.figureRods.get(handle);
      const kind =
        rod !== undefined
          ? "kick"
          : this.soundWalls.has(handle)
            ? "wall"
            : undefined;
      if (!kind) return;
      const collider = this.world.getCollider(handle);
      const normal = event.maxForceDirection();
      let point = this.ball.translation();
      this.world.contactPair(this.ballCollider, collider, (manifold) => {
        if (manifold.numSolverContacts())
          point = manifold.solverContactPoint(0);
      });
      const other = collider.parent()?.velocityAtPoint(point) ?? {
        x: 0,
        y: 0,
        z: 0,
      };
      const speed = Math.abs(
        (before.x - other.x) * normal.x +
          (before.y - other.y) * normal.y +
          (before.z - other.z) * normal.z,
      );
      if (speed < 0.35 || event.totalForceMagnitude() < 0.04) return;
      const key = kind === "kick" ? `kick:${rod}` : "wall";
      const strength = Math.min(1, speed / 10);
      if ((candidates.get(key)?.strength ?? -1) < strength)
        candidates.set(key, { kind, strength });
    });
    for (const [key, impact] of candidates) {
      if (this.impactTime - (this.lastImpacts.get(key) ?? -Infinity) < 0.08)
        continue;
      this.lastImpacts.set(key, this.impactTime);
      this.impacts.push(impact);
      if (this.impacts.length > 16) this.impacts.shift();
    }
  }
  drainImpacts(): BallImpact[] {
    return this.impacts.splice(0);
  }

  neutralize(team?: Team, rodIds?: readonly number[]) {
    for (const [index, rod] of this.rods.entries()) {
      if (
        (team && rod.layout.team !== team) ||
        (rodIds && !rodIds.includes(rod.layout.id))
      )
        continue;
      rod.state.active = false;
      rod.state.desiredVelocity = 0;
      rod.state.velocity = 0;
      rod.state.target = rod.state.translation;
      rod.state.releaseAge = 0;
      this.intentionalReleaseUntil.delete(index);
    }
  }
  resetRods() {
    this.groundedPins.clear();
    this.pinReleases.clear();
    this.spentStrikes.clear();
    this.intentionalReleaseUntil.clear();
    this.poweredRods.clear();
    for (const rod of this.rods) {
      rod.state = createRodState();
      rod.body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
      rod.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rod.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rod.body.setTranslation(
        { x: rod.layout.x, y: C.table.rodHeight, z: 0 },
        true,
      );
      rod.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
      rod.body.setNextKinematicTranslation({
        x: rod.layout.x,
        y: C.table.rodHeight,
        z: 0,
      });
      rod.body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 });
    }
  }
  serve(side: number) {
    this.ballSpeedLimit = this.baseBallSpeed;
    this.spentStrikes.clear();
    this.groundedPins.clear();
    this.pinReleases.clear();
    this.impacts.length = 0;
    this.lastImpacts.clear();
    this.closeServingGates();
    this.servingSide = side < 0 ? -1 : 1;
    this.servingGates.get(this.servingSide)!.setEnabled(false);
    this.ballTouches.length = 0;
    this.activeFigureContacts.clear();
    this.activeFootAims.clear();
    this.events.clear();
    const serve = servingState(this.servingSide);
    const velocity = { x: serve.velocity.x * this.ballSpeedScale, y: serve.velocity.y * this.ballSpeedScale, z: serve.velocity.z * this.ballSpeedScale };
    this.ball.setTranslation(serve.position, true);
    this.ball.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    this.ball.setLinvel(velocity, true);
    this.capBallSpeed();
    this.ball.setAngvel(
      {
        x: velocity.z / C.ball.radius,
        y: 0,
        z: -velocity.x / C.ball.radius,
      },
      true,
    );
  }
  parkBall() {
    this.ballSpeedLimit = this.baseBallSpeed;
    this.spentStrikes.clear();
    this.groundedPins.clear();
    this.pinReleases.clear();
    this.impacts.length = 0;
    this.lastImpacts.clear();
    this.closeServingGates();
    this.ballTouches.length = 0;
    this.activeFigureContacts.clear();
    this.activeFootAims.clear();
    this.events.clear();
    this.ball.setTranslation(
      { x: 0.07, y: C.ball.radius + 0.004, z: -0.04 },
      true,
    );
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
  bump(strength: number) {
    this.ballSpeedLimit = this.baseBallSpeed;
    const p = this.ball.translation();
    const angle = Math.random() * Math.PI * 2;
    const sideX = Math.abs(p.x) > 1.1 ? -Math.sign(p.x) : Math.cos(angle);
    const sideZ = Math.abs(p.z) > 0.55 ? -Math.sign(p.z) : Math.sin(angle);
    // A fraction of the setting becomes an impulse because the ball weighs 28 g.
    this.ball.applyImpulse(
      {
        x: sideX * strength * 0.22,
        y: strength * 0.11,
        z: sideZ * strength * 0.22,
      },
      true,
    );
    this.capBallSpeed();
  }
  dispose() {
    this.spentStrikes.clear();
    this.groundedPins.clear();
    this.pinReleases.clear();
    this.intentionalReleaseUntil.clear();
    this.poweredRods.clear();
    this.impacts.length = 0;
    this.lastImpacts.clear();
    this.soundWalls.clear();
    this.events.free();
    this.servingGates.clear();
    this.figureRods.clear();
    this.footFigures.clear();
    this.activeFigureContacts.clear();
    this.activeFootAims.clear();
    this.ballTouches.length = 0;
    this.world.free();
  }
}
