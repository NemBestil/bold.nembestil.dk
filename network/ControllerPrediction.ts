import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import { advanceRod, applyRodInput, clamp, createRodState, type RodState } from "../game/systems/GameRules";
import type { RodInput, TableFrame, Team } from "../shared/types";
import { CONTROLLER_FRAME_BUFFER_OPTIONS } from "./TableFrameBuffer";
import { limitGroundedFootRotation } from "../game/physics/FootProfile";
import { playingSurfaceHeight } from "../game/table/PlayingSurface";

type LocalRod = { state: RodState; lastInput: number; blockedDirection?: number };
const FIGURE_OFFSETS = ROD_LAYOUT.map((rod) => Array.from({ length: rod.count }, (_, i) => (i - (rod.count - 1) / 2) * rod.spacing));
const CORRECTION_RATE = 40;
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Predicts owned rods only; the ball remains on the host's received timeline. */
export class ControllerPrediction {
  currentFrame: TableFrame | null = null;
  private previousHost: TableFrame | null = null;
  private previousTime?: number;
  private rods = new Map<number, LocalRod>();

  input(team: Team, owned: readonly number[], input: Omit<RodInput, "sequence">, now = performance.now()) {
    if (!this.currentFrame || this.currentFrame.phase !== "playing" || !owned.includes(input.rodId)) return;
    const index = ROD_LAYOUT.findIndex((rod) => rod.team === team && rod.id === input.rodId);
    if (index < 0 || (!input.active && !input.flick && !this.rods.has(index))) return;
    let local = this.rods.get(index);
    if (!local) {
      const pose = this.currentFrame.rods[index]!;
      local = { state: { ...createRodState(), ...pose, target: pose.translation }, lastInput: now };
      this.rods.set(index, local);
    }
    applyRodInput(local.state, { ...input, sequence: 0 }, ROD_LAYOUT[index]!.travel);
    local.lastInput = now;
  }

  sample(frame: TableFrame | null, now: number, damping: number, enabled = true, roundTripMs = 80): TableFrame | null {
    const before = this.previousHost;
    const gap = this.previousTime === undefined ? 0 : now - this.previousTime;
    const discontinuity = !frame || !before || frame.epoch !== before.epoch ||
      frame.phase !== before.phase || frame.time < before.time || gap < 0 || gap > 200;
    if (!enabled || frame?.phase !== "playing" || discontinuity) this.clear();
    this.previousTime = now;
    this.previousHost = frame;
    if (!frame) return this.currentFrame = null;
    const result = { ...frame, ball: { position: { ...frame.ball.position }, rotation: { ...frame.ball.rotation } }, rods: frame.rods.map((rod) => ({ ...rod })) };
    if (!enabled || frame.phase !== "playing" || discontinuity) return this.currentFrame = result;
    const dt = Math.min(0.1, Math.max(0, gap / 1000));
    // Include playback buffering and one host-stream tick in the response budget.
    const grace = clamp(roundTripMs + CONTROLLER_FRAME_BUFFER_OPTIONS.interpolationDelay + 1000 / C.rendering.tableStreamFps, 100, 250);
    const steps = Math.max(1, Math.ceil(dt / C.physics.timestep));
    const step = dt / steps;
    for (let substep = 0; substep < steps; substep++) {
      for (const [index, local] of this.rods) {
        // The host cannot correct a held rod. After release, blend it back once
        // its final input has had time to reach the host and return in the stream.
        if (!local.state.active && now - local.lastInput > grace) {
          const target = frame.rods[index]!;
          const blend = 1 - Math.exp(-CORRECTION_RATE * step);
          local.state.translation = mix(local.state.translation, target.translation, blend);
          const error = Math.atan2(Math.sin(target.angle - local.state.angle), Math.cos(target.angle - local.state.angle));
          local.state.angle += error * blend;
          local.state.velocity *= 1 - blend;
          local.state.target = local.state.translation;
        } else {
          const fromAngle = local.state.angle, fromTranslation = local.state.translation;
          advanceRod(local.state, step, damping);
          const ball = frame.ball.position;
          const limit = limitGroundedFootRotation({ fromAngle, toAngle: local.state.angle,
            fromTranslation, toTranslation: local.state.translation, rodX: ROD_LAYOUT[index]!.x,
            figureOffsets: FIGURE_OFFSETS[index]!, ball, surfaceHeight: playingSurfaceHeight(ball.x, ball.z),
            heldDirection: local.blockedDirection });
          if (limit.blocked) {
            local.state.angle = limit.angle;
            local.state.velocity = 0;
            local.blockedDirection = limit.direction;
          } else local.blockedDirection = undefined;
        }
      }
    }
    for (const [index, local] of this.rods) {
      result.rods[index] = { translation: local.state.translation, angle: local.state.angle };
      const target = frame.rods[index]!;
      if (!local.state.active && now - local.lastInput > grace + 250 &&
        Math.abs(local.state.translation - target.translation) < 0.001 &&
        Math.abs(Math.atan2(Math.sin(local.state.angle - target.angle), Math.cos(local.state.angle - target.angle))) < 0.002)
        this.rods.delete(index);
    }
    this.currentFrame = result;
    return result;
  }

  clear() {
    this.rods.clear();
    this.currentFrame = null;
    this.previousHost = null;
    this.previousTime = undefined;
  }
}
