import { GAME_CONFIG as C } from "../GameConfig";

export interface ReplayVector {
  x: number;
  y: number;
  z: number;
}
export interface ReplayQuaternion extends ReplayVector {
  w: number;
}
export interface ReplayPose {
  ball: { position: ReplayVector; rotation: ReplayQuaternion };
  rods: { translation: number; angle: number }[];
}
export interface ReplayFrame extends ReplayPose {
  time: number;
}
interface TouchWindow {
  rod: number;
  time: number;
  frames: ReplayFrame[];
}
interface Segment {
  frames: ReplayFrame[];
  start: number;
  end: number;
  speed: number;
  slowMotion: boolean;
}
export interface ReplaySample {
  frame: ReplayFrame;
  segment: number;
  slowMotion: boolean;
  done: boolean;
  progress: number;
  remaining: number;
}

export interface MontageSample extends ReplaySample {
  fade: number;
  summary: true;
  goalIndex: number;
  goalCount: number;
}

export function interpolateReplayFrames(frames: ReplayFrame[], time: number): ReplayFrame {
  if (time <= frames[0]!.time) return frames[0]!;
  if (time >= frames.at(-1)!.time) return frames.at(-1)!;
  let lo = 0;
  let hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid]!.time <= time) lo = mid;
    else hi = mid;
  }
  const a = frames[lo]!;
  const b = frames[hi]!;
  const t = (time - a.time) / (b.time - a.time);
  const mix = (x: number, y: number) => x + (y - x) * t;
  const qa = a.ball.rotation;
  const qb = b.ball.rotation;
  const sign =
    qa.x * qb.x + qa.y * qb.y + qa.z * qb.z + qa.w * qb.w < 0 ? -1 : 1;
  const q = {
    x: mix(qa.x, qb.x * sign),
    y: mix(qa.y, qb.y * sign),
    z: mix(qa.z, qb.z * sign),
    w: mix(qa.w, qb.w * sign),
  };
  const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return {
    time,
    ball: {
      position: {
        x: mix(a.ball.position.x, b.ball.position.x),
        y: mix(a.ball.position.y, b.ball.position.y),
        z: mix(a.ball.position.z, b.ball.position.z),
      },
      rotation: {
        x: q.x / length,
        y: q.y / length,
        z: q.z / length,
        w: q.w / length,
      },
    },
    rods: a.rods.map((rod, i) => ({
      translation: mix(rod.translation, b.rods[i]!.translation),
      angle: mix(rod.angle, b.rods[i]!.angle),
    })),
  };
}
const interpolate = interpolateReplayFrames;

/** Recorded transforms are played back visually; Rapier never re-simulates a goal. */
export class GoalReplay {
  readonly duration: number;
  constructor(private segments: Segment[]) {
    const footage = segments.reduce((sum, s) => sum + s.end - s.start, 0);
    const originalDuration = segments.reduce(
      (sum, s) => sum + (s.end - s.start) / s.speed,
      0,
    );
    // Retiming stretches actual motion, keeping the final second slower than
    // the touch windows. Very short goals remain short instead of holding a pose.
    this.duration = Math.min(C.replay.maxDuration, footage * 4);
    const retiming = originalDuration / this.duration;
    for (const segment of segments) segment.speed *= retiming;
  }
  sample(elapsed: number): ReplaySample {
    if (elapsed >= this.duration) {
      const last = this.segments.at(-1)!;
      return {
        frame: interpolate(last.frames, last.end),
        segment: this.segments.length - 1,
        slowMotion: last.slowMotion,
        done: true,
        progress: 1,
        remaining: 0,
      };
    }
    let remaining = Math.max(0, elapsed);
    for (const [index, segment] of this.segments.entries()) {
      const duration = (segment.end - segment.start) / segment.speed;
      if (remaining < duration)
        return {
          segment: index,
          frame: interpolate(
            segment.frames,
            segment.start + remaining * segment.speed,
          ),
          slowMotion: segment.slowMotion,
          done: false,
          progress: Math.min(1, Math.max(0, elapsed) / this.duration),
          remaining: Math.max(0, this.duration - Math.max(0, elapsed)),
        };
      remaining -= duration;
    }
    const last = this.segments.at(-1)!;
    return {
      frame: interpolate(last.frames, last.end),
      segment: this.segments.length - 1,
      slowMotion: last.slowMotion,
      done: true,
      progress: 1,
      remaining: 0,
    };
  }
}

/** Every recorded goal plays once, with the cut hidden at full black. */
export class GoalMontage {
  static readonly fadeDuration = 0.2;
  readonly duration: number;
  private readonly goals: readonly GoalReplay[];

  constructor(goals: readonly GoalReplay[]) {
    if (!goals.length) throw new Error("A goal montage needs at least one goal");
    this.goals = [...goals];
    this.duration =
      goals.reduce((sum, goal) => sum + goal.duration, 0) +
      (goals.length - 1) * GoalMontage.fadeDuration * 2;
  }

  sample(elapsed: number): MontageSample {
    if (elapsed >= this.duration) return this.completed();
    let cursor = Math.max(0, elapsed);
    for (const [index, goal] of this.goals.entries()) {
      const metadata = {
        summary: true as const,
        goalIndex: index + 1,
        goalCount: this.goals.length,
      };
      if (index > 0) {
        if (cursor < GoalMontage.fadeDuration)
          return {
            ...goal.sample(0),
            ...metadata,
            done: false,
            fade: 1 - cursor / GoalMontage.fadeDuration,
          };
        cursor -= GoalMontage.fadeDuration;
      }
      if (cursor < goal.duration)
        return { ...goal.sample(cursor), ...metadata, fade: 0 };
      cursor -= goal.duration;
      if (index < this.goals.length - 1) {
        if (cursor < GoalMontage.fadeDuration)
          return {
            ...goal.sample(goal.duration),
            ...metadata,
            done: false,
            fade: cursor / GoalMontage.fadeDuration,
          };
        cursor -= GoalMontage.fadeDuration;
      }
    }
    return this.completed();
  }

  private completed(): MontageSample {
    const last = this.goals.at(-1)!;
    return {
      ...last.sample(last.duration),
      summary: true,
      goalIndex: this.goals.length,
      goalCount: this.goals.length,
      done: true,
      fade: 0,
    };
  }
}

/** Keep two short contact windows and the final second, even in very long rallies. */
export class ReplayRecorder {
  private time = 0;
  private recent: ReplayFrame[] = [];
  private touches: TouchWindow[] = [];
  get bufferedFrameCount() {
    return (
      this.recent.length +
      this.touches.reduce((sum, touch) => sum + touch.frames.length, 0)
    );
  }
  record(dt: number, pose: ReplayPose, touchedRods: number[]) {
    this.time += dt;
    const frame: ReplayFrame = {
      time: this.time,
      ball: {
        position: { ...pose.ball.position },
        rotation: { ...pose.ball.rotation },
      },
      rods: pose.rods.map((rod) => ({ ...rod })),
    };
    this.recent.push(frame);
    while (
      this.recent.length > 1 &&
      this.recent[1]!.time < this.time - C.replay.recentHistory
    )
      this.recent.shift();
    for (const touch of this.touches)
      if (this.time <= touch.time + C.replay.touchFollowThrough)
        touch.frames.push(frame);
    for (const rod of new Set(touchedRods)) {
      // PhysicsWorld already groups a continuous contact into one event. Two
      // separated impacts on the same rod are still two genuine touches.
      this.touches.push({
        rod,
        time: this.time,
        frames: this.recent.filter(
          (f) => f.time >= this.time - C.replay.touchLeadIn,
        ),
      });
      if (this.touches.length > 2) this.touches.shift();
    }
  }
  build(): GoalReplay | null {
    if (this.recent.length < 2) return null;
    const end = this.recent.at(-1)!.time;
    const slowStart = Math.max(
      this.recent[0]!.time,
      end - C.replay.slowMotionSeconds,
    );
    const intervals = this.touches.map((touch) => ({
      start: touch.frames[0]!.time,
      end: touch.frames.at(-1)!.time,
    }));
    intervals.push({ start: slowStart, end });
    intervals.sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const interval of intervals) {
      const previous = merged.at(-1);
      if (previous && interval.start <= previous.end + 1e-6)
        previous.end = Math.max(previous.end, interval.end);
      else merged.push({ ...interval });
    }
    const frames = [
      ...new Map(
        [...this.touches.flatMap((t) => t.frames), ...this.recent].map(
          (frame) => [frame.time, frame],
        ),
      ).values(),
    ].sort((a, b) => a.time - b.time);
    const segments: Segment[] = [];
    for (const interval of merged) {
      const cuts = [
        interval.start,
        ...(interval.start < slowStart && interval.end > slowStart
          ? [slowStart]
          : []),
        interval.end,
      ];
      for (let i = 0; i < cuts.length - 1; i++) {
        const start = cuts[i]!;
        const finish = cuts[i + 1]!;
        if (finish - start < 1e-6) continue;
        const window = [
          interpolate(frames, start),
          ...frames.filter((f) => f.time > start && f.time < finish),
          interpolate(frames, finish),
        ];
        const slowMotion = start >= slowStart - 1e-6;
        segments.push({
          start,
          end: finish,
          frames: window,
          slowMotion,
          speed: slowMotion ? C.replay.slowMotionSpeed : 1,
        });
      }
    }
    return segments.length ? new GoalReplay(segments) : null;
  }
  clear() {
    this.time = 0;
    this.recent = [];
    this.touches = [];
  }
}
