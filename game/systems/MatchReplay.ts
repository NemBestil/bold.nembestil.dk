import type { MatchRecording, MatchReplayGoal, ReplayState, Team } from "../../shared/types";
import type { PackedMatchRecording } from "../../shared/replayFile";
import { interpolateReplayFrames, type ReplayFrame, type ReplayPose } from "./GoalReplay";

const STRIDE = 25; // time, ball xyz + quaternion, eight rod pairs, rally number
const MAX_FRAMES = 32_768;
const GOAL_HOLD = 1.6;
const FADE = 0.2;
const EPSILON = 1e-7;
interface ArchivedGoal extends MatchReplayGoal { frame: ReplayFrame; rally: number }

/** A whole match uses at most 3.2 MB of packed transforms. Long matches retain
 * their beginning while the sampling interval gradually doubles. */
export class MatchReplayRecorder {
  private data = new Float32Array(MAX_FRAMES * STRIDE);
  private count = 0;
  private clock = 0;
  private nextSample = 0;
  private sampleInterval = 1 / 30;
  private rallyStart = 0;
  private rally = 0;
  private markers: ArchivedGoal[] = [];
  get duration() { return this.clock; }
  get frameCount() { return this.count; }
  get goals(): readonly ArchivedGoal[] { return this.markers; }
  get metadata(): MatchRecording {
    return { duration: this.duration, goals: this.markers.map(({ frame: _, rally: _rally, ...goal }) => ({ ...goal, scores: { ...goal.scores } })) };
  }
  toArchive(): PackedMatchRecording {
    return {
      duration: this.clock,
      sampleInterval: this.sampleInterval,
      frames: Array.from(this.data.subarray(0, this.count * STRIDE)),
      goals: structuredClone(this.markers),
    };
  }
  /** The file codec validates the archive before it reaches this read-only restore. */
  static fromArchive(archive: PackedMatchRecording): MatchReplayRecorder {
    const recorder = new MatchReplayRecorder();
    recorder.data.set(archive.frames);
    recorder.count = archive.frames.length / STRIDE;
    recorder.clock = archive.duration;
    recorder.sampleInterval = archive.sampleInterval;
    recorder.nextSample = recorder.clock + recorder.sampleInterval;
    recorder.markers = structuredClone(archive.goals);
    recorder.rally = recorder.value(recorder.count - 1, 24);
    return recorder;
  }
  clear() {
    this.count = 0;
    this.clock = this.nextSample = this.rallyStart = 0;
    this.sampleInterval = 1 / 30;
    this.markers = [];
    this.rally = 0;
  }
  beginRally(pose: ReplayPose) {
    this.rallyStart = this.clock;
    this.rally++;
    this.append(pose);
    this.nextSample = this.clock + this.sampleInterval;
  }
  record(dt: number, pose: ReplayPose) {
    this.clock += dt;
    if (this.clock + EPSILON < this.nextSample) return;
    this.append(pose);
    this.nextSample = this.clock + this.sampleInterval;
  }
  goal(team: Team, scores: Record<Team, number>, pose: ReplayPose) {
    this.append(pose);
    this.markers.push({
      index: this.markers.length + 1,
      time: this.clock,
      team,
      scores: { ...scores },
      start: Math.max(this.rallyStart, this.clock - 4),
      end: this.clock,
      frame: this.copyPose(pose),
      rally: this.rally,
    });
  }
  sample(time: number): ReplayFrame {
    if (!this.count) throw new Error("The match has no recorded frames");
    // Match metadata uses doubles, while frame timestamps are packed as Float32.
    // Compare in the same precision so an exact serve cut selects its new rally.
    const packedTime = Math.fround(time);
    let lo = 0;
    let hi = this.count - 1;
    if (packedTime <= this.value(0, 0)) return this.read(0);
    if (packedTime >= this.value(hi, 0)) return this.read(hi);
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (this.value(mid, 0) <= packedTime) lo = mid;
      else hi = mid;
    }
    if (this.value(hi, 24) !== this.value(lo, 24)) return this.read(lo);
    return interpolateReplayFrames([this.read(lo), this.read(hi)], time);
  }
  rallyAt(time: number) {
    if (!this.count) return 0;
    const packedTime = Math.fround(time);
    let lo = 0, hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.value(mid, 0) <= packedTime) lo = mid + 1;
      else hi = mid;
    }
    return this.value(Math.max(0, lo - 1), 24);
  }
  private value(index: number, offset: number) { return this.data[index * STRIDE + offset]!; }
  private read(index: number): ReplayFrame {
    const v = (offset: number) => this.value(index, offset);
    return {
      time: v(0),
      ball: { position: { x: v(1), y: v(2), z: v(3) }, rotation: { x: v(4), y: v(5), z: v(6), w: v(7) } },
      rods: Array.from({ length: 8 }, (_, rod) => ({ translation: v(8 + rod * 2), angle: v(9 + rod * 2) })),
    };
  }
  private copyPose(pose: ReplayPose): ReplayFrame {
    return { time: this.clock, ball: { position: { ...pose.ball.position }, rotation: { ...pose.ball.rotation } }, rods: pose.rods.map(rod => ({ ...rod })) };
  }
  private append(pose: ReplayPose) {
    if (this.count === MAX_FRAMES) {
      let write = 1;
      for (let read = 2; read < this.count; read += 2) {
        this.data.copyWithin(write * STRIDE, read * STRIDE, (read + 1) * STRIDE);
        write++;
      }
      this.count = write;
      this.sampleInterval *= 2;
    }
    const base = this.count++ * STRIDE;
    const p = pose.ball.position, q = pose.ball.rotation;
    this.data.set([this.clock, p.x, p.y, p.z, q.x, q.y, q.z, q.w], base);
    for (let rod = 0; rod < 8; rod++) {
      this.data[base + 8 + rod * 2] = pose.rods[rod]?.translation ?? 0;
      this.data[base + 9 + rod * 2] = pose.rods[rod]?.angle ?? 0;
    }
    this.data[base + 24] = this.rally;
  }
}

export interface MatchReplaySample {
  frame: ReplayFrame;
  replay: ReplayState;
  done: boolean;
  cut: number;
  goals: Team[];
}

/** Playback only reads recorded poses. Goal dwell and slowmotion do not alter
 * the source timeline or the final match result. */
export class MatchReplayPlayer {
  time = 0;
  playing = true;
  private goalIndex = 0;
  private hold = 0;
  private cut = 0;
  private activeGoal: ArchivedGoal | null = null;
  private fadeIn = 0;
  private finished = false;
  private sourceRally = -1;
  constructor(readonly recording: MatchReplayRecorder, public mode: "highlights" | "full") {
    if (mode === "highlights") this.enterHighlight(0);
  }
  setMode(mode: "highlights" | "full") {
    if (mode === this.mode) return;
    this.mode = mode;
    this.finished = false;
    this.cut++;
    this.fadeIn = this.hold = 0;
    this.activeGoal = null;
    if (mode === "highlights") {
      const goal = this.recording.goals.findIndex(goal => goal.time >= this.time - EPSILON);
      this.enterHighlight(goal < 0 ? this.recording.goals.length - 1 : goal);
    }
  }
  seek(time: number) {
    this.mode = "full";
    this.time = Math.max(0, Math.min(this.recording.duration, time));
    this.playing = false;
    this.finished = false;
    this.cut++;
    this.fadeIn = 0;
    this.activeGoal = this.recording.goals.find(goal => Math.abs(goal.time - this.time) < 0.02) ?? null;
    this.hold = this.activeGoal ? GOAL_HOLD : 0;
  }
  seekHighlight(index: number): boolean {
    const goal = this.recording.goals.find(marker => marker.index === index);
    if (!goal) return false;
    this.seek(goal.start);
    // A short highlight can start at the previous goal's timestamp. The click
    // selects the following buildup, rather than holding that preceding goal.
    this.activeGoal = null;
    this.hold = 0;
    this.goalIndex = index - 1;
    return true;
  }
  advance(dt: number): MatchReplaySample {
    const goals: Team[] = [];
    if (this.playing && !this.finished) {
      let remaining = Math.max(0, dt);
      while (remaining > EPSILON && !this.finished) {
        if (this.hold > 0) {
          const used = Math.min(this.hold, remaining);
          this.hold = Math.max(0, this.hold - used);
          remaining -= used;
          if (this.hold > EPSILON) break;
          this.hold = 0;
          if (this.mode === "highlights") {
            if (this.goalIndex + 1 === this.recording.goals.length) { this.finished = true; break; }
            this.enterHighlight(this.goalIndex + 1);
          } else {
            this.activeGoal = null;
            if (this.time >= this.recording.duration - EPSILON) { this.finished = true; break; }
          }
          continue;
        }
        const nextGoal = this.mode === "highlights"
          ? this.recording.goals[this.goalIndex]
          : this.recording.goals.find(goal => goal.time > this.time + EPSILON);
        const boundary = nextGoal?.time ?? this.recording.duration;
        const slowMotion = this.mode === "highlights" && boundary - this.time <= 1 + EPSILON;
        const speed = slowMotion ? 1 / 3 : 1;
        const untilSlow = this.mode === "highlights" && !slowMotion ? Math.max(0, boundary - 1 - this.time) : Infinity;
        const sourceStep = Math.min(remaining * speed, Math.max(0, boundary - this.time), untilSlow);
        const used = sourceStep / speed;
        this.time += sourceStep;
        remaining -= used;
        this.fadeIn = Math.max(0, this.fadeIn - used);
        if (this.time >= boundary - EPSILON) {
          this.time = boundary;
          if (nextGoal) {
            this.activeGoal = nextGoal;
            this.goalIndex = nextGoal.index - 1;
            this.hold = GOAL_HOLD;
            goals.push(nextGoal.team);
          } else this.finished = true;
        } else if (used <= EPSILON) {
          // Floating point rounding at the slowmotion boundary.
          this.time = Math.min(boundary, this.time + EPSILON * 2);
        }
      }
    }
    const goal = this.activeGoal;
    const lastScored = [...this.recording.goals].reverse().find(marker => marker.time <= this.time + EPSILON);
    const currentGoal = this.mode === "highlights" ? this.recording.goals[this.goalIndex] : goal ?? this.recording.goals.find(marker => marker.time > this.time + EPSILON) ?? this.recording.goals.at(-1);
    const fade = this.mode === "highlights"
      ? Math.max(this.fadeIn / FADE, this.hold > 0 && this.goalIndex < this.recording.goals.length - 1 && this.hold < FADE ? 1 - this.hold / FADE : 0)
      : 0;
    const slowMotion = this.mode === "highlights" && !this.hold && (currentGoal?.time ?? 0) - this.time <= 1 + EPSILON;
    const sourceRemaining = Math.max(0, (currentGoal?.time ?? 0) - this.time);
    const remaining = this.finished ? 0 : this.hold || (sourceRemaining > 1 ? sourceRemaining - 1 + 3 + GOAL_HOLD : sourceRemaining * 3 + GOAL_HOLD);
    const replay: ReplayState = {
      progress: this.recording.duration ? this.time / this.recording.duration : 0,
      slowMotion,
      fade,
      fullMatch: true,
      mode: this.mode,
      playing: this.playing && !this.finished,
      time: this.time,
      duration: this.recording.duration,
      scores: { ...(lastScored?.scores ?? { red: 0, blue: 0 }) },
      goalIndex: currentGoal?.index ?? 1,
      goalCount: this.recording.goals.length,
      ...(this.mode === "highlights" ? { summary: true, remaining: Math.min(8, remaining) } : {}),
      ...(goal && this.hold > 0 ? { goalTeam: goal.team } : {}),
    };
    const sourceRally = goal && this.hold > 0 ? goal.rally : this.recording.rallyAt(this.time);
    if (sourceRally !== this.sourceRally) { this.sourceRally = sourceRally; this.cut++; }
    return { frame: goal && this.hold > 0 ? goal.frame : this.recording.sample(this.time), replay, done: this.finished, cut: this.cut, goals };
  }
  private enterHighlight(index: number) {
    this.goalIndex = Math.max(0, index);
    const goal = this.recording.goals[this.goalIndex];
    this.time = goal?.start ?? 0;
    this.activeGoal = null;
    this.hold = 0;
    this.fadeIn = index > 0 ? FADE : 0;
    this.cut++;
  }
}
