import { GAME_CONFIG as C, ROD_LAYOUT } from "../GameConfig";
import { clamp, type Vector3 } from "./GameRules";
import type { RodInput, Team } from "../../shared/types";
import { playingSurfaceHeight } from "../table/PlayingSurface";

export type ComputerLevel = "beginner" | "normal" | "advanced";
export interface ComputerObservation {
  ball: { position: Vector3; velocity: Vector3 };
  rods: readonly {
    id: number;
    translation: number;
    angle: number;
    velocity: number;
    /** Actual downward contact that stopped this rod in the authoritative physics. */
    pinnedDirection?: number;
  }[];
}

export const COMPUTER_LEVELS = {
  beginner: {
    reaction: 0.28,
    switchDelay: 1,
    maxRods: 1,
    acceleration: 2,
    decision: 0.12,
    movement: 0.7,
    error: 0.07,
    shotSpeed: 13,
    shotDuration: 0.25,
    cooldown: 0.8,
    prediction: 0,
  },
  normal: {
    reaction: 0.14,
    switchDelay: 0.5,
    maxRods: 1,
    acceleration: 4,
    decision: 0.06,
    movement: 2,
    error: 0.025,
    shotSpeed: 22,
    shotDuration: 0.22,
    cooldown: 0.5,
    prediction: 0.4,
  },
  advanced: {
    reaction: 0.065,
    switchDelay: 0.25,
    maxRods: 2,
    acceleration: 8,
    decision: 0.025,
    movement: 4,
    error: 0.006,
    shotSpeed: 32,
    shotDuration: 0.2,
    cooldown: 0.32,
    prediction: 0.65,
  },
} as const;

type RodLayout = (typeof ROD_LAYOUT)[number];
type Recovery = { direction: number; startAngle: number; elapsed: number };
type RodPlan = {
  target: number;
  stroke: number;
  cooldown: number;
  error: number;
  speed: number;
  pinTime: number;
  pinDirection: number;
  recovery?: Recovery;
};
const PIN_REACTION = 0.25;

/** Reflect a projected rolling trajectory from the two physical side bands. */
export function predictedBallZ(
  position: Vector3,
  velocity: Vector3,
  rodX: number,
  horizon: number,
) {
  const crossing =
    Math.abs(velocity.x) > 0.1 ? (rodX - position.x) / velocity.x : 0;
  const time = clamp(crossing, 0, horizon);
  const half = C.table.halfWidth - C.ball.radius;
  const period = half * 4;
  const folded =
    (((position.z + velocity.z * time + half) % period) + period) % period;
  return folded <= half * 2 ? folded - half : half * 3 - folded;
}

function figureTarget(
  layout: RodLayout,
  intercept: number,
  translation: number,
) {
  let target = 0;
  let best = Infinity;
  for (let i = 0; i < layout.count; i++) {
    const base = (i - (layout.count - 1) / 2) * layout.spacing;
    const candidate = clamp(intercept - base, -layout.travel, layout.travel);
    const miss = Math.abs(intercept - base - candidate);
    const cost = miss * 8 + Math.abs(candidate - translation);
    if (cost < best) {
      best = cost;
      target = candidate;
    }
  }
  return target;
}

/** Delayed perception and ordinary rod inputs, run only by the authoritative host. */
export class ComputerOpponent {
  private layouts: readonly RodLayout[];
  private clock = 0;
  private nextDecision = 0;
  private nextSwitch = 0;
  private sequence = 0;
  private history: { time: number; ball: ComputerObservation["ball"] }[] = [];
  private plans = new Map<number, RodPlan>();

  constructor(
    readonly level: ComputerLevel,
    private random: () => number = Math.random,
    readonly team: Team = "blue",
    readonly rodIds: readonly number[] = [0, 1, 2, 3],
  ) {
    this.layouts = ROD_LAYOUT.filter((rod) => rod.team === team && rodIds.includes(rod.id));
  }

  reset() {
    this.clock = 0;
    this.nextDecision = 0;
    this.nextSwitch = 0;
    this.history.length = 0;
    this.plans.clear();
  }

  update(dt: number, observation: ComputerObservation): RodInput[] {
    const profile = COMPUTER_LEVELS[this.level];
    this.history.push({ time: this.clock, ball: {
      position: { ...observation.ball.position }, velocity: { ...observation.ball.velocity },
    } });
    this.clock += dt;
    const seenAt = this.clock - profile.reaction;
    while (this.history.length > 1 && this.history[1]!.time <= seenAt) this.history.shift();
    const perceived = this.history[0];
    const ballSpeed = Math.hypot(observation.ball.velocity.x, observation.ball.velocity.y, observation.ball.velocity.z);
    const grounded = Math.abs(observation.ball.position.y - C.ball.radius - playingSurfaceHeight(observation.ball.position.x, observation.ball.position.z)) < 0.012;
    const pinned = (rod: ComputerObservation["rods"][number]) =>
      !!rod.pinnedDirection && ballSpeed <= C.ball.stuckSpeed && grounded && Math.abs(rod.velocity) < 0.1;
    // A real contact already felt by this computer's rod does not wait for its
    // delayed visual perception. Its 250 ms recovery starts with the pin itself.
    const feltPin = observation.rods.some((rod) => this.rodIds.includes(rod.id) && pinned(rod));
    if ((!perceived || perceived.time > seenAt) && !feltPin) return [];
    const inputs: RodInput[] = [];
    const { position, velocity } = perceived && perceived.time <= seenAt ? perceived.ball : observation.ball;

    if (this.clock >= this.nextSwitch && ![...this.plans].some(([id, plan]) =>
      plan.stroke > 0 || plan.recovery || plan.pinTime > 0 ||
      observation.rods.find((rod) => rod.id === id)?.pinnedDirection)) {
      const chosen = [...this.layouts].sort((a, b) => {
        const cost = (rod: RodLayout) => Math.abs(rod.x - position.x) - (this.plans.has(rod.id) ? 0.05 : 0);
        return cost(a) - cost(b);
      }).slice(0, profile.maxRods);
      const selected = new Set<number>(chosen.map((rod) => rod.id));
      for (const [id] of this.plans) {
        if (selected.has(id)) continue;
        const rod = observation.rods.find((rod) => rod.id === id);
        const layout = this.layouts.find((rod) => rod.id === id)!;
        if (rod) inputs.push({ sequence: ++this.sequence, rodId: id,
          translation: clamp(rod.translation / layout.travel, -1, 1), angularVelocity: 0, active: false });
        this.plans.delete(id);
      }
      for (const layout of chosen) {
        if (this.plans.has(layout.id)) continue;
        const rod = observation.rods.find((rod) => rod.id === layout.id);
        if (rod) this.plans.set(layout.id, { target: rod.translation, stroke: 0, cooldown: 0,
          error: (clamp(this.random(), 0, 1) * 2 - 1) * profile.error, speed: 0, pinTime: 0, pinDirection: 0 });
      }
      this.nextSwitch = this.clock + profile.switchDelay;
      this.nextDecision = this.clock;
    }
    for (const [id, plan] of this.plans) {
      plan.stroke = Math.max(0, plan.stroke - dt);
      plan.cooldown = Math.max(0, plan.cooldown - dt);
      const rod = observation.rods.find((candidate) => candidate.id === id);
      if (!rod) continue;
      if (plan.recovery) {
        plan.recovery.elapsed += dt;
        const travel = (rod.angle - plan.recovery.startAngle) * plan.recovery.direction;
        // Retract and continue around the rod before attempting the opposite
        // side. Returning to neutral early would repeat the same downward pin.
        if ((travel >= Math.PI * 1.5 && ballSpeed > C.ball.stuckSpeed) ||
            travel >= Math.PI * 2 + 0.35 || plan.recovery.elapsed >= 2) {
          plan.recovery = undefined;
          plan.cooldown = profile.cooldown;
        }
      }
      const pin = Math.sign(rod.pinnedDirection ?? 0);
      if (pin && pinned(rod)) {
        plan.pinTime = pin === plan.pinDirection ? plan.pinTime + dt : dt;
        plan.pinDirection = pin;
        plan.target = rod.translation;
        plan.speed = 0;
        if (plan.pinTime + 1e-9 >= PIN_REACTION) {
          plan.recovery = { direction: -pin, startAngle: rod.angle, elapsed: 0 };
          plan.stroke = 0;
          plan.cooldown = profile.cooldown;
          plan.pinTime = 0;
        }
      } else {
        plan.pinTime = 0;
        plan.pinDirection = 0;
      }
    }
    if (this.clock >= this.nextDecision) {
      this.nextDecision = this.clock + profile.decision;
      for (const layout of this.layouts) {
        const plan = this.plans.get(layout.id);
        const rod = observation.rods.find((candidate) => candidate.id === layout.id);
        if (!plan || !rod) continue;
        if (plan.recovery || plan.pinTime > 0) continue;
        const intercept = predictedBallZ(position, velocity, layout.x, profile.prediction) + plan.error;
        const target = figureTarget(layout, intercept, rod.translation);
        // A held aiming error and a dead zone avoid fresh random sideways corrections.
        if (Math.abs(target - plan.target) > 0.015) plan.target = target;
        const aligned = Array.from({ length: layout.count }, (_, index) =>
          Math.abs((index - (layout.count - 1) / 2) * layout.spacing + rod.translation - position.z))
          .some((distance) => distance < C.figure.footHalfSize + C.ball.radius - 0.012);
        if (plan.cooldown <= 0 && aligned && position.y < 0.14 && Math.abs(position.x - layout.x) < 0.14) {
          plan.stroke = profile.shotDuration;
          plan.cooldown = profile.cooldown;
        }
      }
    }
    for (const layout of this.layouts) {
      const plan = this.plans.get(layout.id);
      const rod = observation.rods.find((candidate) => candidate.id === layout.id);
      if (!plan || !rod) continue;
      if (plan.recovery) { plan.target = rod.translation; plan.speed = 0; }
      const delta = plan.target - rod.translation;
      const desired = Math.abs(delta) < 0.004 ? 0 : clamp(delta * 6, -profile.movement, profile.movement);
      plan.speed += clamp(desired - plan.speed, -profile.acceleration * dt, profile.acceleration * dt);
      const movement = clamp(plan.speed * dt, -Math.abs(delta), Math.abs(delta));
      const error = Math.atan2(Math.sin(rod.angle), Math.cos(rod.angle));
      inputs.push({ sequence: ++this.sequence, rodId: layout.id,
        translation: clamp((rod.translation + movement) / layout.travel, -1, 1),
        angularVelocity: plan.recovery ? plan.recovery.direction * profile.shotSpeed :
          plan.stroke > 0 ? (this.team === "red" ? 1 : -1) * profile.shotSpeed :
          Math.abs(error) < 0.02 ? 0 : clamp(-error * 8, -14, 14), active: true });
    }
    return inputs;
  }
}
