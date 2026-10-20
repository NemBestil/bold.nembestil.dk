import { describe, expect, it } from "vitest";
import { GAME_CONFIG as C } from "../game/GameConfig";
import {
  GoalMontage,
  ReplayRecorder,
  type ReplayPose,
} from "../game/systems/GoalReplay";

const rate = 120;
function pose(time: number): ReplayPose {
  return {
    ball: {
      position: { x: time, y: 0.04, z: time / 2 },
      rotation: { x: 0, y: Math.sin(time / 2), z: 0, w: Math.cos(time / 2) },
    },
    rods: [{ angle: time * 40, translation: Math.sin(time) * 0.1 }],
  };
}
function recordRally(seconds: number, touches = new Map<number, number[]>()) {
  const recorder = new ReplayRecorder();
  for (let frame = 1; frame <= seconds * rate; frame++)
    recorder.record(1 / rate, pose(frame / rate), touches.get(frame) ?? []);
  return recorder;
}

describe("goal replay timeline", () => {
  it("preserves the last two touches through long idle gaps and cuts directly between them", () => {
    const replay = recordRally(
      12,
      new Map([
        [2 * rate, [0]],
        [4 * rate, [1]],
        [8 * rate, [5]],
      ]),
    ).build()!;
    const sourcePositions: number[] = [];
    for (let elapsed = 0; elapsed < replay.duration; elapsed += 1 / rate)
      sourcePositions.push(replay.sample(elapsed).frame.ball.position.x);

    expect(replay.duration).toBe(C.replay.maxDuration);
    expect(sourcePositions[0]).toBeGreaterThanOrEqual(3.7);
    expect(sourcePositions.some((x) => Math.abs(x - 4) < 0.02)).toBe(true);
    expect(sourcePositions.some((x) => Math.abs(x - 8) < 0.02)).toBe(true);
    expect(sourcePositions.some((x) => Math.abs(x - 2) < 0.1)).toBe(false);
    expect(
      sourcePositions.every(
        (x) => x < 4.91 || (x >= 7.7 - 1e-6 && x < 8.91) || x >= 11 - 1e-6,
      ),
    ).toBe(true);
    expect(
      sourcePositions.some(
        (x, index) => index > 0 && x - sourcePositions[index - 1]! > 2,
      ),
    ).toBe(true);
    expect(replay.sample(replay.duration).frame.ball.position.x).toBe(12);
  });

  it("counts rapid but distinct impacts on the same rod as the last two touches", () => {
    const replay = recordRally(
      10,
      new Map([
        [2 * rate, [0]],
        [6 * rate, [5]],
        [6 * rate + 6, [5]],
      ]),
    ).build()!;
    // The older touch at two seconds must be discarded even though the final
    // pair happened only 50 ms apart on the same player's rod.
    expect(replay.sample(0).frame.ball.position.x).toBeGreaterThan(5.7);
    expect(replay.sample(replay.duration - 1.5).slowMotion).toBe(true);
    expect(replay.sample(replay.duration).frame.ball.position.x).toBe(10);
  });

  it("does not count duplicate collider reports from one step as two touches", () => {
    const replay = recordRally(
      10,
      new Map([
        [2 * rate, [0]],
        [6 * rate, [5, 5]],
      ]),
    ).build()!;
    expect(replay.sample(0).frame.ball.position.x).toBeGreaterThanOrEqual(1.7);
    expect(replay.sample(0).frame.ball.position.x).toBeLessThan(2);
  });

  it("retimes real footage to eight seconds while keeping the final source second three times slower", () => {
    const replay = recordRally(
      6,
      new Map([
        [2 * rate, [0]],
        [3 * rate, [5]],
      ]),
    ).build()!;
    let lo = 0;
    let hi = replay.duration;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (replay.sample(mid).slowMotion) hi = mid;
      else lo = mid;
    }
    const slowStart = hi;
    const slowDuration = replay.duration - slowStart;
    expect(replay.duration).toBe(8);
    expect(replay.sample(slowStart - 0.001).slowMotion).toBe(false);
    expect(replay.sample(slowStart + 0.001).slowMotion).toBe(true);
    expect(replay.sample(slowStart).frame.ball.position.x).toBeCloseTo(5, 8);
    expect(replay.sample(slowStart + slowDuration / 2).frame.ball.position.x)
      .toBeCloseTo(5.5, 8);
    const normalSpeed =
      (replay.sample(0.2).frame.time - replay.sample(0.1).frame.time) / 0.1;
    const slowSpeed =
      (replay.sample(slowStart + 0.2).frame.time -
        replay.sample(slowStart + 0.1).frame.time) / 0.1;
    expect(normalSpeed / slowSpeed).toBeCloseTo(3, 8);
    expect(replay.sample(replay.duration - 0.01).frame.time).toBeLessThan(6);
    const end = replay.sample(replay.duration);
    expect(end.done).toBe(true);
    expect(end.progress).toBe(1);
    expect(end.remaining).toBe(0);
    expect(end.frame.ball.position.x).toBe(6);
  });

  it("uses only the available footage for a rally shorter than one second", () => {
    const replay = recordRally(0.4).build()!;
    expect(replay.duration).toBeLessThan(1.6);
    expect(replay.duration).toBeGreaterThan(1.5);
    expect(replay.sample(0).slowMotion).toBe(true);
    expect(replay.sample(replay.duration / 2).slowMotion).toBe(true);
    expect(replay.sample(replay.duration).frame.ball.position.x).toBeCloseTo(
      0.4,
      7,
    );
    expect(replay.sample(-1).progress).toBe(0);
  });

  it("normalizes quaternion interpolation and preserves continuous multi-turn rod angles", () => {
    const recorder = new ReplayRecorder();
    const first = pose(0);
    first.ball.rotation = { x: 0, y: 0, z: 0, w: 1 };
    first.rods[0] = { translation: 0, angle: 10 * Math.PI };
    recorder.record(0.5, first, []);
    const second = pose(1);
    // Equivalent quaternion signs must not make the replay spin the long way.
    second.ball.rotation = { x: 0, y: 0, z: -Math.SQRT1_2, w: -Math.SQRT1_2 };
    second.rods[0] = { translation: 0.2, angle: 10 * Math.PI + Math.PI / 2 };
    recorder.record(0.5, second, []);
    const replay = recorder.build()!;
    const midpoint = replay.sample(replay.duration / 2).frame;
    expect(Math.hypot(...Object.values(midpoint.ball.rotation))).toBeCloseTo(
      1,
      10,
    );
    expect(midpoint.ball.rotation.z).toBeCloseTo(Math.sin(Math.PI / 8), 10);
    expect(midpoint.ball.rotation.w).toBeCloseTo(Math.cos(Math.PI / 8), 10);
    expect(midpoint.rods[0]!.angle).toBeCloseTo(10 * Math.PI + Math.PI / 4, 10);
    expect(midpoint.rods[0]!.translation).toBeCloseTo(0.1, 10);
  });
});

describe("replay recording lifecycle", () => {
  it("keeps bounded history during a three-minute rally without losing old touches", () => {
    const recorder = recordRally(
      180,
      new Map([
        [2 * rate, [0]],
        [4 * rate, [5]],
      ]),
    );
    expect(recorder.bufferedFrameCount).toBeLessThan(600);
    const replay = recorder.build()!;
    expect(replay.sample(0).frame.ball.position.x).toBeLessThan(2);
    expect(replay.sample(replay.duration).frame.ball.position.x).toBe(180);
    expect(replay.duration).toBeLessThanOrEqual(C.replay.maxDuration);
  });

  it("clears the previous rally completely before recording the next serve", () => {
    const recorder = recordRally(
      10,
      new Map([
        [2 * rate, [0]],
        [6 * rate, [5]],
      ]),
    );
    recorder.clear();
    expect(recorder.bufferedFrameCount).toBe(0);
    expect(recorder.build()).toBeNull();
    for (let i = 1; i <= 48; i++) {
      const frame = pose(i / rate);
      frame.ball.position.x += 100;
      recorder.record(1 / rate, frame, []);
    }
    const next = recorder.build()!;
    expect(next.sample(0).frame.ball.position.x).toBeGreaterThan(100);
    expect(next.sample(next.duration).frame.ball.position.x).toBeCloseTo(
      100.4,
      7,
    );
  });

  it("records copies of mutable physics poses instead of retaining live references", () => {
    const recorder = new ReplayRecorder();
    const livePose = pose(1);
    recorder.record(0.1, livePose, [0]);
    livePose.ball.position.x = 2;
    livePose.rods[0]!.angle = 80;
    recorder.record(0.1, livePose, []);
    livePose.ball.position.x = 99;
    const replay = recorder.build()!;
    expect(replay.sample(0).frame.ball.position.x).toBe(1);
    expect(replay.sample(replay.duration).frame.ball.position.x).toBe(2);
    expect(replay.sample(0).frame.rods[0]!.angle).toBe(40);
  });
});

describe("match goal montage", () => {
  function goal(offset: number, seconds = 0.4) {
    const recorder = new ReplayRecorder();
    for (let frame = 1; frame <= seconds * rate; frame++) {
      const recorded = pose(frame / rate);
      recorded.ball.position.x += offset;
      recorder.record(1 / rate, recorded, []);
    }
    return recorder.build()!;
  }

  it("plays every goal once in order without interpolating across the black cut", () => {
    const goals = [goal(0), goal(100), goal(200)];
    const montage = new GoalMontage(goals);
    expect(montage.duration).toBeCloseTo(
      goals.reduce((sum, clip) => sum + clip.duration, 0) + 0.8,
      10,
    );
    const order: number[] = [];
    for (let time = 0; time < montage.duration; time += 1 / rate) {
      const sample = montage.sample(time);
      if (sample.goalIndex !== order.at(-1)) order.push(sample.goalIndex);
      expect(sample.done).toBe(false);
      expect(sample.goalCount).toBe(3);
      expect(sample.summary).toBe(true);
      const offset = (sample.goalIndex - 1) * 100;
      expect(sample.frame.ball.position.x).toBeGreaterThan(offset);
      expect(sample.frame.ball.position.x).toBeLessThanOrEqual(offset + 0.4);
    }
    expect(order).toEqual([1, 2, 3]);
    const end = montage.sample(montage.duration);
    expect(end.done).toBe(true);
    expect(end.goalIndex).toBe(3);
    expect(end.progress).toBe(1);
    expect(end.remaining).toBe(0);
    expect(end.fade).toBe(0);
    expect(end.frame.ball.position.x).toBeCloseTo(200.4, 8);
  });

  it("fades out the old goal and in the new goal for 0.2 seconds each", () => {
    const first = goal(0);
    const second = goal(100, 0.8);
    const montage = new GoalMontage([first, second]);
    const out = montage.sample(first.duration + 0.1);
    expect(out.goalIndex).toBe(1);
    expect(out.fade).toBeCloseTo(0.5, 8);
    expect(out.remaining).toBe(0);
    expect(out.done).toBe(false);
    const black = montage.sample(first.duration + 0.2 + 1e-9);
    expect(black.goalIndex).toBe(2);
    expect(black.fade).toBeCloseTo(1, 7);
    expect(black.remaining).toBe(second.duration);
    const into = montage.sample(first.duration + 0.3);
    expect(into.goalIndex).toBe(2);
    expect(into.fade).toBeCloseTo(0.5, 8);
    expect(into.progress).toBe(0);
    const playing = montage.sample(first.duration + 0.5);
    expect(playing.fade).toBe(0);
    expect(playing.progress).toBeGreaterThan(0);
    expect(playing.remaining).toBeCloseTo(second.duration - 0.1, 8);
  });

  it("plays a one-goal match as one clip without a redundant fade or second replay", () => {
    const only = goal(0);
    const montage = new GoalMontage([only]);
    expect(montage.duration).toBe(only.duration);
    expect(montage.sample(0).fade).toBe(0);
    expect(montage.sample(only.duration / 2).frame)
      .toEqual(only.sample(only.duration / 2).frame);
    expect(montage.sample(only.duration).done).toBe(true);
    expect(montage.sample(only.duration).goalCount).toBe(1);
  });
});
