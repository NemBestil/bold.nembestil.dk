import { describe, expect, it } from "vitest";
import { MatchReplayPlayer, MatchReplayRecorder } from "../game/systems/MatchReplay";
import type { ReplayPose } from "../game/systems/GoalReplay";

const pose = (x: number): ReplayPose => ({
  ball: { position: { x, y: 0.04, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  rods: Array.from({ length: 8 }, (_, i) => ({ translation: x / 10, angle: i + x })),
});
function recording() {
  const recorder = new MatchReplayRecorder();
  recorder.beginRally(pose(0));
  for (let frame = 1; frame <= 120; frame++) recorder.record(1 / 30, pose(frame / 30));
  recorder.goal("red", { red: 1, blue: 0 }, pose(4));
  recorder.beginRally(pose(-10));
  for (let frame = 1; frame <= 120; frame++) recorder.record(1 / 30, pose(-10 + frame / 30));
  recorder.goal("blue", { red: 1, blue: 1 }, pose(-6));
  return recorder;
}

describe("whole-match recording", () => {
  it("keeps the whole source timeline, historical goals, and recorded transforms independently of mutable physics poses", () => {
    const recorder = recording();
    expect(recorder.duration).toBeCloseTo(8);
    expect(recorder.metadata.goals).toEqual([
      { index: 1, time: expect.closeTo(4), start: 0, end: expect.closeTo(4), team: "red", scores: { red: 1, blue: 0 } },
      { index: 2, time: expect.closeTo(8), start: expect.closeTo(4), end: expect.closeTo(8), team: "blue", scores: { red: 1, blue: 1 } },
    ]);
    expect(recorder.sample(2).ball.position.x).toBeCloseTo(2, 5);
    expect(recorder.sample(6).ball.position.x).toBeCloseTo(-8, 5);
    const metadata = recorder.metadata;
    metadata.goals[0]!.scores.red = 9;
    expect(recorder.metadata.goals[0]!.scores.red).toBe(1);
    recorder.clear();
    expect(recorder.duration).toBe(0);
    expect(recorder.frameCount).toBe(0);
    expect(recorder.goals).toHaveLength(0);
  });
  it("cuts at a new serve without inventing ball motion across the table", () => {
    const recorder = recording();
    expect(recorder.sample(4 - 0.001).ball.position.x).toBeGreaterThan(3.99);
    expect(recorder.sample(4 + 0.001).ball.position.x).toBeLessThan(-9.99);
  });
  it("restores a portable archive with its exact goal poses, historical scores, and serve cuts", () => {
    const original = recording();
    const restored = MatchReplayRecorder.fromArchive(original.toArchive());
    expect(restored.duration).toBe(original.duration);
    expect(restored.frameCount).toBe(original.frameCount);
    expect(restored.metadata).toEqual(original.metadata);
    for (const time of [0, 2, 3.999, 4.001, 6, 8]) {
      expect(restored.sample(time)).toEqual(original.sample(time));
      expect(restored.rallyAt(time)).toBe(original.rallyAt(time));
    }
    const player = new MatchReplayPlayer(restored, "full");
    for (const goal of original.goals) {
      player.seek(goal.time);
      const sample = player.advance(0);
      expect(sample.frame).toEqual(goal.frame);
      expect(sample.replay).toMatchObject({ goalTeam: goal.team, scores: goal.scores });
      expect(sample.goals).toEqual([]);
    }
    player.seek(3.9);
    player.playing = true;
    expect(player.advance(0.2).goals).toEqual(["red"]);
  });
  it("copies packed transforms and every nested goal pose in both archive directions", () => {
    const original = recording();
    const archive = original.toArchive();
    const restored = MatchReplayRecorder.fromArchive(archive);
    const expected = structuredClone(archive);
    archive.frames[1] = 90;
    archive.goals[0]!.scores.red = 90;
    archive.goals[0]!.frame.ball.position.x = 90;
    archive.goals[0]!.frame.ball.rotation.w = 0;
    archive.goals[0]!.frame.rods[0]!.angle = 90;
    expect(original.toArchive()).toEqual(expected);
    expect(restored.toArchive()).toEqual(expected);
    expect(restored.goals[0]).not.toBe(original.goals[0]);
    expect(restored.goals[0]!.frame.ball.position).not.toBe(original.goals[0]!.frame.ball.position);
    expect(restored.goals[0]!.frame.rods[0]).not.toBe(original.goals[0]!.frame.rods[0]);
    const exportedAgain = restored.toArchive();
    exportedAgain.frames[1] = -90;
    exportedAgain.goals[0]!.frame.ball.position.x = -90;
    exportedAgain.goals[0]!.scores.red = 10;
    expect(restored.toArchive()).toEqual(expected);
  });
  it("bounds memory while retaining the beginning and end of unusually long matches", () => {
    const recorder = new MatchReplayRecorder();
    recorder.beginRally(pose(0));
    for (let frame = 1; frame <= 70_000; frame++) recorder.record(1 / 30, pose(frame / 30));
    recorder.goal("red", { red: 1, blue: 0 }, pose(recorder.duration));
    expect(recorder.frameCount).toBeLessThanOrEqual(32_768);
    expect(recorder.sample(0).ball.position.x).toBe(0);
    expect(recorder.sample(100).ball.position.x).toBeCloseTo(100, 3);
    expect(recorder.sample(recorder.duration).ball.position.x).toBeCloseTo(recorder.duration, 3);
    const restored = MatchReplayRecorder.fromArchive(recorder.toArchive());
    expect(restored.frameCount).toBe(recorder.frameCount);
    expect(restored.toArchive().sampleInterval).toBeGreaterThan(1 / 30);
    expect(restored.metadata).toEqual(recorder.metadata);
    for (const time of [0, 100, recorder.duration]) expect(restored.sample(time)).toEqual(recorder.sample(time));
  });
});

describe("whole-match playback", () => {
  it.each(["full", "highlights"] as const)("opens a selected highlight at its buildup from %s, even when it starts at the preceding goal", mode => {
    const recorder = recording();
    const previous = recorder.goals[0]!, selected = recorder.goals[1]!;
    expect(selected.start).toBe(previous.time);
    expect(selected.start).toBeGreaterThan(0);
    expect(selected.time - selected.start).toBeCloseTo(4);
    const player = new MatchReplayPlayer(recorder, mode);
    player.seek(previous.time);
    expect(player.advance(0).replay.goalTeam).toBe("red");

    expect(player.seekHighlight(selected.index)).toBe(true);
    const buildup = player.advance(20);
    expect(buildup.replay).toMatchObject({ time: selected.start, playing: false, mode: "full", goalIndex: 2, scores: { red: 1, blue: 0 } });
    expect(buildup.replay.goalTeam).toBeUndefined();
    expect(buildup.frame.ball.position.x).toBe(-10);
    expect(buildup.goals).toEqual([]);
    player.playing = true;
    expect(player.advance(0.5).goals).toEqual([]);
    expect(player.advance(0).frame.ball.position.x).toBeCloseTo(-9.5, 4);
    const scored = player.advance(selected.time - selected.start - 0.5 + 0.01);
    expect(scored.goals).toEqual(["blue"]);
    expect(scored.replay).toMatchObject({ goalTeam: "blue", scores: { red: 1, blue: 1 } });
    expect(scored.frame.ball.position.x).toBe(-6);
    expect(player.advance(0.1).goals).toEqual([]);
  });
  it("ignores invalid highlight indices without interrupting playback", () => {
    const player = new MatchReplayPlayer(recording(), "highlights");
    const before = player.advance(0);
    for (const index of [0, -1, 1.5, 3, NaN, Infinity]) {
      expect(player.seekHighlight(index)).toBe(false);
      expect(player.advance(0)).toEqual(before);
    }
  });
  it("automatically plays archive highlights, updates historical scores and emits each goal effect once", () => {
    const player = new MatchReplayPlayer(recording(), "highlights");
    const heard: string[] = [];
    const shown = new Set<number>();
    let lastCut = -1;
    let sawFade = false;
    let done = false;
    let previousRemaining = Infinity;
    let previousGoal = 1;
    for (let frame = 0; frame < 120 * 30; frame++) {
      const sample = player.advance(1 / 120);
      heard.push(...sample.goals);
      if (sample.replay.goalIndex === previousGoal) expect(sample.replay.remaining!).toBeLessThanOrEqual(previousRemaining + 1e-6);
      previousRemaining = sample.replay.remaining!;
      previousGoal = sample.replay.goalIndex!;
      shown.add(sample.replay.goalIndex!);
      sawFade ||= sample.replay.fade! > 0;
      expect(sample.cut).toBeGreaterThanOrEqual(lastCut);
      lastCut = sample.cut;
      if (sample.replay.goalTeam === "red") {
        expect(sample.replay.scores).toEqual({ red: 1, blue: 0 });
        expect(sample.frame.ball.position.x).toBe(4);
      }
      if (sample.done) { done = true; break; }
    }
    expect(done).toBe(true);
    expect(heard).toEqual(["red", "blue"]);
    expect([...shown]).toEqual([1, 2]);
    expect(sawFade).toBe(true);
    expect(player.advance(10).goals).toEqual([]);
  });
  it("seeks and pauses on the authoritative archive, then plays the full match and goals again after seeking backwards", () => {
    const player = new MatchReplayPlayer(recording(), "highlights");
    const initialCut = player.advance(0).cut;
    player.seek(3);
    const sought = player.advance(5);
    expect(sought.replay).toMatchObject({ fullMatch: true, mode: "full", playing: false, time: 3, scores: { red: 0, blue: 0 } });
    expect(sought.frame.ball.position.x).toBeCloseTo(3);
    expect(sought.cut).toBeGreaterThan(initialCut);
    expect(sought.goals).toEqual([]);
    player.playing = true;
    const scored = player.advance(1.1);
    expect(scored.goals).toEqual(["red"]);
    expect(scored.replay.goalTeam).toBe("red");
    expect(player.advance(0.1).goals).toEqual([]);
    player.seek(1);
    player.playing = true;
    expect(player.advance(3.1).goals).toEqual(["red"]);
  });
  it("increments its cut revision when full playback crosses from a goal hold into the next serve", () => {
    const player = new MatchReplayPlayer(recording(), "full");
    player.seek(3.9);
    player.playing = true;
    const goal = player.advance(0.2);
    expect(goal.replay.goalTeam).toBe("red");
    expect(goal.frame.ball.position.x).toBe(4);
    const nextServe = player.advance(1.6);
    expect(nextServe.replay.goalTeam).toBeUndefined();
    expect(nextServe.frame.ball.position.x).toBeLessThan(-9.8);
    expect(nextServe.cut).toBeGreaterThan(goal.cut);
  });
  it("allows a goal marker to show its effect and exact scoring pose while scrubbing without replaying sound", () => {
    const recorder = recording();
    const player = new MatchReplayPlayer(recorder, "full");
    player.seek(recorder.metadata.goals[0]!.time);
    const sample = player.advance(20);
    expect(sample.replay.goalTeam).toBe("red");
    expect(sample.replay.scores).toEqual({ red: 1, blue: 0 });
    expect(sample.frame.ball.position.x).toBe(4);
    expect(sample.goals).toEqual([]);
  });
  it("switches automatic highlights off without jumping and can reselect the next goal clip", () => {
    const player = new MatchReplayPlayer(recording(), "highlights");
    player.advance(2);
    const time = player.time;
    player.setMode("full");
    expect(player.time).toBe(time);
    player.seek(5);
    player.setMode("highlights");
    expect(player.advance(0).replay.goalIndex).toBe(2);
    expect(player.time).toBeCloseTo(4);
  });
});
