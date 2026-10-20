import { GAME_CONFIG as C } from "../GameConfig";
import type { RodInput, Team } from "../../shared/types";

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}
export interface RodState {
  angle: number;
  velocity: number;
  translation: number;
  target: number;
  desiredVelocity: number;
  active: boolean;
  age: number;
  releaseAge: number;
  upsideDownLocked: boolean;
}
export const createRodState = (): RodState => ({
  angle: 0,
  velocity: 0,
  translation: 0,
  target: 0,
  desiredVelocity: 0,
  active: false,
  age: 0,
  releaseAge: 0,
  upsideDownLocked: false,
});
export const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

function lockUpsideDownOnRelease(state: RodState) {
  // Measure from the inverted position after wrapping any number of full turns.
  const fromUpsideDown = Math.atan2(
    Math.sin(state.angle - Math.PI),
    Math.cos(state.angle - Math.PI),
  );
  if (Math.abs(fromUpsideDown) <= Math.PI / 18 + 1e-12) {
    state.upsideDownLocked = true;
    state.velocity = 0;
    state.desiredVelocity = 0;
  }
}

export function applyRodInput(
  state: RodState,
  input: RodInput,
  travel: number,
) {
  const wasLocked = state.upsideDownLocked;
  const released = (state.active && !input.active) || Boolean(input.flick);
  if (input.active || input.flick) state.upsideDownLocked = false;
  // A crossed-rod flick changes rotation only. Its cosmetic frame position can
  // lag behind a vertical gesture that has already committed a newer target.
  if (!(input.rotationOnly && input.flick && !input.active))
    state.target = input.active || input.flick
      ? clamp(input.translation, -1, 1) * travel
      : state.translation;
  state.desiredVelocity = clamp(
    input.angularVelocity,
    -C.rods.maxAngularVelocity,
    C.rods.maxAngularVelocity,
  );
  // A short flick can start and finish between physics ticks. Its release carries
  // the measured momentum; ordinary releases preserve the existing velocity.
  if (!input.active && input.flick) state.velocity = state.desiredVelocity;
  if (released) {
    state.releaseAge = 0;
    // A completed flick also counts as a release. If it started from a locked
    // rod, it is the new touch that frees the figure and must retain its spin.
    if (!wasLocked && !input.active) lockUpsideDownOnRelease(state);
  }
  state.active = input.active;
  state.age = 0;
}
export function advanceRod(state: RodState, dt: number, damping: number) {
  state.age += dt;
  if (state.active && state.age > C.rods.inputTimeout) {
    state.active = false;
    state.target = state.translation;
    state.releaseAge = 0;
    lockUpsideDownOnRelease(state);
  }
  const diff = state.target - state.translation;
  state.translation += clamp(
    diff,
    -C.rods.maxTranslationSpeed * dt,
    C.rods.maxTranslationSpeed * dt,
  );
  if (state.active)
    state.velocity += clamp(
      state.desiredVelocity - state.velocity,
      -C.rods.maxAngularAcceleration * dt,
      C.rods.maxAngularAcceleration * dt,
    );
  else {
    state.releaseAge += dt;
    if (state.upsideDownLocked) {
      state.velocity = 0;
      return;
    }
    const error = Math.atan2(Math.sin(state.angle), Math.cos(state.angle));
    // A perfectly upright figure is an unstable balance. A tiny disturbance
    // lets it fall rather than remaining numerically balanced indefinitely.
    if (Math.abs(error) > Math.PI - 0.001 && Math.abs(state.velocity) < 0.05)
      state.velocity = -Math.sign(error) * 0.12;
    state.velocity -= C.rods.passiveGravity * Math.sin(state.angle) * dt;
    const drag = state.releaseAge <= C.rods.inertiaGrace
      ? damping : C.rods.passiveDamping + damping * 0.3;
    state.velocity *= Math.exp(-drag * dt);
    if (
      Math.abs(error) < C.rods.settleAngle &&
      Math.abs(state.velocity) < C.rods.settleSpeed
    ) {
      state.angle = Math.round(state.angle / (Math.PI * 2)) * (Math.PI * 2);
      state.velocity = 0;
    }
  }
  state.angle += state.velocity * dt;
}
export function scoringTeam(position: Vector3): Team | null {
  if (
    Math.abs(position.z) > C.table.goalHalfWidth - C.ball.radius * 0.25 ||
    position.y > C.table.goalHeight ||
    position.y < -0.05
  )
    return null;
  if (position.x > C.table.goalLine + C.ball.radius) return "red";
  if (position.x < -C.table.goalLine - C.ball.radius) return "blue";
  return null;
}
export function isOutOfBounds(position: Vector3) {
  return (
    Math.abs(position.x) > C.table.outLength ||
    Math.abs(position.z) > C.table.outWidth ||
    position.y < C.table.outFloor
  );
}
/** Side 1 is the red player's side; side -1 is the blue player's side. */
export function servingState(side: number, random = Math.random) {
  const angle =
    ((random() * 2 - 1) * C.serving.randomnessDegrees * Math.PI) / 180;
  return {
    position: {
      x: 0,
      y: C.ball.radius + C.table.surfaceRise + 0.008,
      z: side * (C.table.halfWidth + 0.1),
    },
    velocity: {
      x: Math.sin(angle) * C.serving.speed,
      y: 0,
      z: -side * Math.cos(angle) * C.serving.speed,
    },
  };
}
export function canBump(
  phase: string,
  cooldown: number,
  ballSpeed: number,
) {
  return phase === "playing" && cooldown <= 0 && ballSpeed <= C.ball.stuckSpeed;
}
