import type { TableFrame, TableQuaternion } from "../shared/types";
import { isTableFrame } from "./MessageProtocol";

const INTERPOLATION_DELAY = 45;
const MAX_SAMPLES = 5;
const MAX_INTERPOLATION_GAP = 200;

/** A short playout buffer between received host poses; never extrapolates physics. */
export const CONTROLLER_FRAME_BUFFER_OPTIONS = {
  smoothClock: true,
  interpolationDelay: 25,
  interpolateBall: true,
} as const;

interface ReceivedFrame {
  frame: TableFrame;
  arrivalTime: number;
}

/** A small visual-only buffer. Missing packets freeze the table; they never simulate it. */
export class TableFrameBuffer {
  private frames: ReceivedFrame[] = [];
  private playhead?: { time: number; now: number };

  constructor(private options: { smoothClock?: boolean; interpolationDelay?: number; interpolateBall?: boolean } = {}) {}

  push(frame: TableFrame, arrivalTime = performance.now()): boolean {
    if (!isTableFrame(frame) || !Number.isFinite(arrivalTime)) return false;
    const latest = this.frames.at(-1);
    if (latest && frame.sequence <= latest.frame.sequence) return false;
    if (
      latest &&
      (frame.epoch !== latest.frame.epoch ||
        frame.phase !== latest.frame.phase ||
        frame.replay?.goalIndex !== latest.frame.replay?.goalIndex ||
        frame.replay?.summary !== latest.frame.replay?.summary ||
        frame.time <= latest.frame.time ||
        frame.time - latest.frame.time > MAX_INTERPOLATION_GAP ||
        arrivalTime < latest.arrivalTime ||
        arrivalTime - latest.arrivalTime > MAX_INTERPOLATION_GAP)
    ) {
      this.frames.length = 0;
      this.playhead = undefined;
    }
    this.frames.push({ frame: copyFrame(frame), arrivalTime });
    if (this.frames.length > MAX_SAMPLES) this.frames.shift();
    return true;
  }

  sample(now = performance.now()): TableFrame | null {
    const latest = this.frames.at(-1);
    const first = this.frames[0];
    if (!latest || !first) return null;
    // Translate the phone's clock into host time without requiring synchronized clocks.
    const elapsed = Number.isFinite(now)
      ? Math.max(0, now - latest.arrivalTime)
      : 0;
    const desired = latest.frame.time + elapsed - (this.options.interpolationDelay ?? INTERPOLATION_DELAY);
    let target = desired;
    if (this.options.smoothClock && Number.isFinite(now)) {
      if (this.playhead) {
        const step = Math.max(0, now - this.playhead.now);
        const next = this.playhead.time + step;
        // Arrival jitter changes playback speed gently instead of jumping the clock.
        const rate = Math.max(0.85, Math.min(1.15, 1 + (desired - next) / 150));
        target = Math.min(latest.frame.time, this.playhead.time + step * rate);
      }
      this.playhead = { time: target, now };
    }
    if (target <= first.frame.time) return this.finish(copyFrame(first.frame));
    if (target >= latest.frame.time) return this.finish(copyFrame(latest.frame));
    for (let index = 1; index < this.frames.length; index++) {
      const previous = this.frames[index - 1]!.frame;
      const next = this.frames[index]!.frame;
      if (target > next.time) continue;
      return this.finish(interpolate(
        previous,
        next,
        (target - previous.time) / (next.time - previous.time),
        this.options.interpolateBall !== false,
      ));
    }
    return this.finish(copyFrame(latest.frame));
  }

  private finish(frame: TableFrame): TableFrame {
    if (this.options.interpolateBall === false) {
      const ball = this.frames.at(-1)!.frame.ball;
      frame.ball = { position: { ...ball.position }, rotation: { ...ball.rotation } };
    }
    return frame;
  }

  clear(): void {
    this.frames.length = 0;
    this.playhead = undefined;
  }

  isStale(now = performance.now(), maxAge = 500): boolean {
    const latest = this.frames.at(-1);
    return (
      !latest || !Number.isFinite(now) || now - latest.arrivalTime > maxAge
    );
  }
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function interpolate(a: TableFrame, b: TableFrame, t: number, interpolateBall: boolean): TableFrame {
  const frame = copyFrame(b);
  frame.time = mix(a.time, b.time, t);
  if (interpolateBall) {
    frame.ball.position = {
      x: mix(a.ball.position.x, b.ball.position.x, t),
      y: mix(a.ball.position.y, b.ball.position.y, t),
      z: mix(a.ball.position.z, b.ball.position.z, t),
    };
    frame.ball.rotation = slerp(a.ball.rotation, b.ball.rotation, t);
  }
  if (a.camera && b.camera && frame.camera) {
    frame.camera.position = {
      x: mix(a.camera.position.x, b.camera.position.x, t),
      y: mix(a.camera.position.y, b.camera.position.y, t),
      z: mix(a.camera.position.z, b.camera.position.z, t),
    };
    frame.camera.rotation = slerp(a.camera.rotation, b.camera.rotation, t);
  }
  frame.rods = a.rods.map((rod, index) => ({
    translation: mix(rod.translation, b.rods[index]!.translation, t),
    // Host angles are continuous. Wrapping them would reverse full-speed kicks.
    angle: mix(rod.angle, b.rods[index]!.angle, t),
  }));
  if (a.replay && b.replay && frame.replay) {
    frame.replay.progress = mix(a.replay.progress, b.replay.progress, t);
    if (a.replay.time !== undefined && b.replay.time !== undefined)
      frame.replay.time = mix(a.replay.time, b.replay.time, t);
    if (a.replay.remaining !== undefined && b.replay.remaining !== undefined)
      frame.replay.remaining = mix(a.replay.remaining, b.replay.remaining, t);
    if (a.replay.fade !== undefined && b.replay.fade !== undefined)
      frame.replay.fade = mix(a.replay.fade, b.replay.fade, t);
  }
  return frame;
}

// Copy plain fields explicitly so callers may also pass a Vue reactive frame.
function copyFrame(frame: TableFrame): TableFrame {
  return {
    ...frame,
    ball: {
      position: { ...frame.ball.position },
      rotation: { ...frame.ball.rotation },
    },
    rods: frame.rods.map((rod) => ({ ...rod })),
    kits: { red: { ...frame.kits.red }, blue: { ...frame.kits.blue } },
    ...(frame.scores ? { scores: { ...frame.scores } } : {}),
    ...(frame.camera ? { camera: { ...frame.camera, position: { ...frame.camera.position }, rotation: { ...frame.camera.rotation } } } : {}),
    ...(frame.replay ? { replay: { ...frame.replay, ...(frame.replay.scores ? { scores: { ...frame.replay.scores } } : {}) } } : {}),
  };
}

function normalized(q: TableQuaternion): TableQuaternion {
  const length = Math.hypot(q.x, q.y, q.z, q.w);
  if (length < 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

function slerp(
  from: TableQuaternion,
  to: TableQuaternion,
  t: number,
): TableQuaternion {
  const a = normalized(from);
  let b = normalized(to);
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  // q and -q represent the same rotation; use the shortest arc, including at identity.
  if (dot < 0) {
    b = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    dot = -dot;
  }
  if (dot > 0.9995)
    return normalized({
      x: mix(a.x, b.x, t),
      y: mix(a.y, b.y, t),
      z: mix(a.z, b.z, t),
      w: mix(a.w, b.w, t),
    });
  const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
  const scale = Math.sin(angle);
  const before = Math.sin((1 - t) * angle) / scale;
  const after = Math.sin(t * angle) / scale;
  return normalized({
    x: a.x * before + b.x * after,
    y: a.y * before + b.y * after,
    z: a.z * before + b.z * after,
    w: a.w * before + b.w * after,
  });
}
