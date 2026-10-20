import { afterEach, describe, expect, it, vi } from "vitest";
import { MatchReplayPlayer, MatchReplayRecorder } from "../game/systems/MatchReplay";
import type { ReplayPose } from "../game/systems/GoalReplay";
import { DEFAULT_SETTINGS } from "../shared/types";
import { getTeamIdentities, getTeamIdentity } from "../shared/teamIdentity";
import { decodeReplayFile, encodeReplayFile, REPLAY_FILE_LIMITS, validateReplayFile, type ReplayFileData } from "../shared/replayFile";

const pose = (x: number, angle = 0): ReplayPose => ({
  ball: { position: { x, y: 0.04, z: 0.1 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
  rods: Array.from({ length: 8 }, (_, rod) => ({ translation: rod / 100, angle: angle + rod })),
});
function replay(): ReplayFileData {
  const recorder = new MatchReplayRecorder();
  recorder.beginRally(pose(0));
  for (let frame = 1; frame <= 60; frame++) recorder.record(1 / 30, pose(frame / 60));
  recorder.goal("blue", { red: 0, blue: 1 }, pose(1));
  recorder.beginRally(pose(-1));
  for (let frame = 1; frame <= 60; frame++) recorder.record(1 / 30, pose(-1 + frame / 60));
  recorder.goal("red", { red: 1, blue: 1 }, pose(0));
  return {
    format: "nem-bold-replay", version: 1, createdAt: "2026-10-20T10:15:30.123Z",
    teams: getTeamIdentities({ red: "Rød", blue: "Vennerne fra Århus" }),
    settings: { ...DEFAULT_SETTINGS },
    recording: recorder.toArchive(),
  };
}
const jsonBlob = (value: unknown) => new Blob([JSON.stringify(value)], { type: "application/json" });

afterEach(() => vi.unstubAllGlobals());

describe("local replay file codec", () => {
  it("roundtrips native gzip and restores transforms, serve cuts, historical scores and goal effects", async () => {
    const source = replay();
    const { blob, filename } = await encodeReplayFile(source);
    expect(filename).toBe("nem-bold-2026-10-20-10-15-30.json.gz");
    expect(Array.from(new Uint8Array(await blob.slice(0, 2).arrayBuffer()))).toEqual([0x1f, 0x8b]);
    expect(blob.size).toBeLessThan(jsonBlob(source).size / 2);
    const loaded = await decodeReplayFile(blob);
    expect(loaded).toEqual(validateReplayFile(source));
    const restored = MatchReplayRecorder.fromArchive(loaded.recording);
    expect(restored.sample(1).ball.position.x).toBeCloseTo(0.5, 5);
    expect(restored.sample(2.001).ball.position.x).toBeLessThan(-0.99);
    const player = new MatchReplayPlayer(restored, "full");
    const firstGoal = player.advance(2.1);
    expect(firstGoal.goals).toEqual(["blue"]);
    expect(firstGoal.replay.scores).toEqual({ red: 0, blue: 1 });
    expect(firstGoal.frame.ball.position.x).toBe(1);
    expect(player.advance(4).goals).toEqual(["red"]);
  });

  it("downloads portable JSON when compression is absent or its gzip constructor is unsupported", async () => {
    const source = replay();
    vi.stubGlobal("CompressionStream", undefined);
    const plain = await encodeReplayFile(source);
    expect(plain.filename).toMatch(/\.json$/);
    expect(plain.blob.type).toBe("application/json");
    expect(await decodeReplayFile(plain.blob)).toEqual(validateReplayFile(source));
    vi.stubGlobal("CompressionStream", class { constructor() { throw new TypeError("unsupported"); } });
    expect((await encodeReplayFile(source)).filename).toMatch(/\.json$/);
  });

  it("loads older version-one files with the default ball speed and stores it on export", async () => {
    const source = replay();
    const { ballSpeed: _ballSpeed, ...legacySettings } = source.settings;
    const legacy = { ...source, settings: legacySettings };
    const loaded = await decodeReplayFile(jsonBlob(legacy));
    expect(loaded.version).toBe(1);
    expect(loaded.settings.ballSpeed).toBe(1);
    vi.stubGlobal("CompressionStream", undefined);
    const { blob } = await encodeReplayFile(loaded);
    expect(JSON.parse(await blob.text()).settings.ballSpeed).toBe(1);
  });

  it.each([0.5, 1, 2])("roundtrips a ball speed multiplier of %s", async ballSpeed => {
    const source = replay();
    source.settings.ballSpeed = ballSpeed;
    expect((await decodeReplayFile((await encodeReplayFile(source)).blob)).settings.ballSpeed).toBe(ballSpeed);
  });

  it("detects compression by content rather than filename or MIME and explains unsupported decompression", async () => {
    const { blob } = await encodeReplayFile(replay());
    expect((await decodeReplayFile(new Blob([blob], { type: "text/plain" }))).version).toBe(1);
    vi.stubGlobal("DecompressionStream", undefined);
    await expect(decodeReplayFile(blob)).rejects.toThrow(/nyere browser/);
    expect((await decodeReplayFile(jsonBlob(replay()))).version).toBe(1);
  });

  it("rejects corrupt compression, invalid UTF-8 and invalid JSON without trusting MIME", async () => {
    await expect(decodeReplayFile(new Blob([new Uint8Array([0x1f, 0x8b, 1, 2, 3])]))).rejects.toThrow(/pakkes ud/);
    await expect(decodeReplayFile(new Blob([new Uint8Array([0xff, 0xfe])]))).rejects.toThrow(/gyldige replaydata/);
    await expect(decodeReplayFile(new Blob(["{\"format\":"]))).rejects.toThrow(/gyldige replaydata/);
    await expect(decodeReplayFile(new Blob([]))).rejects.toThrow(/tom eller for stor/);
  });

  it("rejects oversized input before reading it", async () => {
    const blob = new Blob([new Uint8Array(REPLAY_FILE_LIMITS.inputBytes + 1)]);
    const read = vi.spyOn(blob, "stream");
    await expect(decodeReplayFile(blob)).rejects.toThrow(/for stor/);
    expect(read).not.toHaveBeenCalled();
  });

  it("bounds expanded gzip bytes before parsing a compressed bomb", async () => {
    const plain = new Blob([" ".repeat(REPLAY_FILE_LIMITS.expandedBytes + 1)]);
    const bomb = await new Response(plain.stream().pipeThrough(new CompressionStream("gzip"))).blob();
    expect(bomb.size).toBeLessThan(100_000);
    await expect(decodeReplayFile(bomb)).rejects.toThrow(/for stor/);
  }, 15_000);

  it("accepts a real hour-long thinned recording, duplicate serve timestamps and continuous rod angles", async () => {
    const source = replay();
    const recorder = new MatchReplayRecorder();
    recorder.beginRally(pose(0));
    for (let frame = 1; frame <= 108_000; frame++) recorder.record(1 / 30, pose(Math.sin(frame / 30), frame * 1.5));
    recorder.goal("red", { red: 1, blue: 0 }, pose(0.8, 162_000));
    recorder.beginRally(pose(-0.8, 162_000));
    recorder.record(1 / 30, pose(-0.79, 162_001));
    recorder.goal("blue", { red: 1, blue: 1 }, pose(-0.79, 162_001));
    source.recording = recorder.toArchive();
    const { blob } = await encodeReplayFile(source);
    const loaded = await decodeReplayFile(blob);
    expect(loaded.recording.duration).toBeCloseTo(3600 + 1 / 30, 3);
    expect(loaded.recording.frames.length).toBeLessThanOrEqual(32_768 * 25);
    const restored = MatchReplayRecorder.fromArchive(loaded.recording);
    expect(restored.sample(1000).ball.position.x).toBeCloseTo(Math.sin(1000), 1);
    expect(restored.sample(loaded.recording.duration)).toEqual(recorder.sample(recorder.duration));
    expect(restored.goals.at(-1)!.frame.rods[0]!.angle).toBe(162_001);
  }, 15_000);
});

describe("untrusted replay validation", () => {
  it("keeps custom names while forcing red/blue identities and stripping legacy logos, colors and URLs", () => {
    const source = replay();
    source.teams.red.name = "Hjemmeholdet";
    source.teams.red.id = "bayern-munchen";
    source.teams.red.logoUrl = "https://attacker.test/tracking.svg";
    source.teams.red.primaryColor = "url(https://attacker.test/color)";
    source.teams.blue.logoUrl = "data:image/svg+xml,<svg onload='alert(1)'/>";
    source.teams.blue.source = "https://attacker.test/source";
    source.teams.blue.aliases = ["remote data"];
    const loaded = validateReplayFile(source);
    expect(loaded.teams.red).toEqual(getTeamIdentity("red", "Hjemmeholdet"));
    expect(loaded.teams.blue).toEqual(getTeamIdentity("blue", "Vennerne fra Århus"));
    expect(loaded.teams.red.logoUrl).toBeUndefined();
    expect(loaded.teams.blue.logoUrl).toBeUndefined();
  });

  it("uses the same Unicode name limit and normalization as live teams", async () => {
    const source = replay();
    source.teams.red.name = "⚽".repeat(25);
    source.teams.blue.name = "  A\u030Arhus  ";
    const loaded = await decodeReplayFile((await encodeReplayFile(source)).blob);
    expect(loaded.teams.red.name).toBe("⚽".repeat(25));
    expect(loaded.teams.blue.name).toBe("Århus");
    source.teams.blue.name = "";
    expect(validateReplayFile(source).teams.blue.name).toBe("Blå");
  });

  it("accepts the full valid network settings range", () => {
    const source = replay();
    source.settings.rotationDamping = 0.1;
    source.settings.bumpStrength = 0.01;
    expect(validateReplayFile(source).settings).toEqual(source.settings);
    source.settings.rotationDamping = 8;
    source.settings.bumpStrength = 0.5;
    expect(validateReplayFile(source).settings).toEqual(source.settings);
  });

  const corruptions: [string, (data: ReplayFileData) => void][] = [
    ["future format version", data => { (data as { version: number }).version = 2; }],
    ["invalid calendar date", data => { data.createdAt = "2026-02-31T10:15:30.123Z"; }],
    ["long team name", data => { data.teams.blue.name = "x".repeat(26); }],
    ["control text", data => { data.teams.blue.name = "team\u0007.exe"; }],
    ["invalid graphics mode", data => { data.settings.graphics = "ultra" as "high"; }],
    ["non-finite setting", data => { data.settings.rotationDamping = Infinity; }],
    ["ball speed below minimum", data => { data.settings.ballSpeed = 0.49; }],
    ["ball speed above maximum", data => { data.settings.ballSpeed = 2.01; }],
    ["non-finite ball speed", data => { data.settings.ballSpeed = Infinity; }],
    ["non-numeric ball speed", data => { (data.settings as unknown as Record<string, unknown>).ballSpeed = "1"; }],
    ["partial packed frame", data => { data.recording.frames.pop(); }],
    ["empty frame archive", data => { data.recording.frames = []; }],
    ["excess frame count", data => { data.recording.frames = new Array((REPLAY_FILE_LIMITS.frames + 1) * 25).fill(0); }],
    ["non-finite transform", data => { data.recording.frames[1] = NaN; }],
    ["missing quaternion", data => { data.recording.frames[7] = 0; }],
    ["excessive ball position", data => { data.recording.frames[2] = 1e20; }],
    ["excessive rod translation", data => { data.recording.frames[8] = 20; }],
    ["backward frame times", data => { data.recording.frames[50] = 0; }],
    ["backward rally", data => { data.recording.frames[data.recording.frames.length - 1] = 1; }],
    ["fractional rally", data => { data.recording.frames[24] = 1.5; }],
    ["bad archive end", data => { data.recording.duration += 10; }],
    ["zero sample interval", data => { data.recording.sampleInterval = 0; }],
    ["reordered goals", data => { data.recording.goals.reverse(); }],
    ["score jumps", data => { data.recording.goals[0]!.scores.blue = 2; }],
    ["wrong scoring side", data => { data.recording.goals[0]!.team = "red"; }],
    ["goal frame time mismatch", data => { data.recording.goals[0]!.frame.time += 0.1; }],
    ["goal past duration", data => { data.recording.goals[1]!.time += 10; }],
    ["goal clip past goal", data => { data.recording.goals[0]!.start = 20; }],
    ["goal clip wrong end", data => { data.recording.goals[0]!.end -= 0.1; }],
    ["goal clip overlaps previous rally", data => { data.recording.goals[1]!.start = 0; }],
    ["goal in same rally twice", data => { data.recording.goals[1]!.rally = 1; }],
    ["incomplete goal pose", data => { data.recording.goals[0]!.frame.rods.pop(); }],
    ["goals after winner", data => { data.settings.goalsToWin = 1; }],
    ["prototype key", data => { Object.defineProperty(data, "__proto__", { value: {}, enumerable: true }); }],
  ];
  it.each(corruptions)("rejects %s", (_label, corrupt) => {
    const data = replay();
    corrupt(data);
    expect(() => validateReplayFile(data)).toThrow(/Replayfilen er ugyldig/);
  });

  it("returns detached, sanitized objects rather than retaining mutable imported data", () => {
    const source = replay();
    const loaded = validateReplayFile(source);
    source.recording.frames[1] = 9;
    source.recording.goals[0]!.scores.blue = 5;
    source.recording.goals[0]!.frame.ball.position.x = 10;
    source.teams.blue.name = "Changed";
    expect(loaded.recording.frames[1]).toBe(0);
    expect(loaded.recording.goals[0]!.scores.blue).toBe(1);
    expect(loaded.recording.goals[0]!.frame.ball.position.x).toBe(1);
    expect(loaded.teams.blue.name).toBe("Vennerne fra Århus");
  });
});
