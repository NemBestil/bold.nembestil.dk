import type { ReplayFrame } from "../game/systems/GoalReplay";
import type { ComputerLevel, FootballClub, MatchReplayGoal, MatchSettings, SeatId, Team, TeamControl } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { getTeamIdentity, isTeamName } from "./teamIdentity";

/** Version 1 uses the recorder's packed transforms: time, ball xyz/quaternion,
 * eight translation/angle pairs, then rally. Goal poses stay exact after thinning. */
export interface PackedMatchRecording {
  duration: number;
  sampleInterval: number;
  frames: number[];
  goals: (MatchReplayGoal & { frame: ReplayFrame; rally: number })[];
}
export interface ReplayFileData {
  format: "nem-bold-replay";
  version: 1;
  createdAt: string;
  teams: Record<Team, FootballClub>;
  settings: MatchSettings;
  recording: PackedMatchRecording;
}

// A one-hour match is thinned by the recorder, so its size does not grow with
// duration. These limits also leave ample room for its JSON representation.
export const REPLAY_FILE_LIMITS = {
  inputBytes: 24 * 1024 * 1024,
  expandedBytes: 48 * 1024 * 1024,
  frames: 32_768,
  duration: 24 * 60 * 60,
} as const;
const STRIDE = 25;
const TIME_TOLERANCE = 0.02; // Float32 timestamps at the 24-hour limit.
const MAX_RALLIES = 100_000;
const teams = ["red", "blue"] as const;
const levels = ["beginner", "normal", "advanced"] as const;

function invalid(detail: string): never { throw new Error(`Replayfilen er ugyldig (${detail}).`); }
function object(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(label);
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) invalid(label);
  return result;
}
function number(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) invalid(label);
  return value;
}
function integer(value: unknown, min: number, max: number, label: string): number {
  const result = number(value, min, max, label);
  if (!Number.isInteger(result)) invalid(label);
  return result;
}
function choice<T extends string>(value: unknown, options: readonly T[], label: string): T {
  if (typeof value !== "string" || !options.includes(value as T)) invalid(label);
  return value as T;
}
function plainText(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069<>]/u.test(value)) invalid(label);
  return value;
}
function teamIdentity(value: unknown, team: Team): FootballClub {
  const input = object(value, ["id", "name", "shortName", "country", "league", "logoUrl", "primaryColor", "secondaryColor", "source", "aliases"], "hold");
  if (!isTeamName(input.name)) invalid("holdnavn");
  // Only the bounded name is portable. Team side, colors and every rendered
  // asset come from our fixed identities; imported legacy club data is ignored.
  return getTeamIdentity(team, input.name);
}

function settings(value: unknown): MatchSettings {
  const input = object(value, ["playerCount", "computerOpponent", "teamControls", "computerLevels", "goalsToWin", "graphics", "ballSpeed", "rotationDamping", "bumpStrength"], "indstillinger");
  const result: MatchSettings = {
    playerCount: integer(input.playerCount, 0, 4, "antal spillere") as MatchSettings["playerCount"],
    computerOpponent: choice(input.computerOpponent, ["off", ...levels], "computermodstander"),
    goalsToWin: integer(input.goalsToWin, 1, 100, "målgrænse"),
    graphics: choice(input.graphics, ["low", "normal", "high"], "grafik"),
    ballSpeed: input.ballSpeed === undefined ? DEFAULT_SETTINGS.ballSpeed : number(input.ballSpeed, 0.5, 2, "boldens fart"),
    rotationDamping: number(input.rotationDamping, 0.1, 8, "rotationsdæmpning"),
    bumpStrength: number(input.bumpStrength, 0.01, 0.5, "bumpstyrke"),
  };
  if (input.teamControls !== undefined) {
    const controls = object(input.teamControls, teams, "holdstyring");
    const read = (team: Team): TeamControl => {
      const control = object(controls[team], ["computer", "level"], "holdstyring");
      return { computer: choice(control.computer, ["off", "full", "defense", "attack"], "computerstyring"), level: choice(control.level, levels, "computerniveau") };
    };
    result.teamControls = { red: read("red"), blue: read("blue") };
  }
  if (input.computerLevels !== undefined) {
    const seats: SeatId[] = ["red-defense", "red-attack", "blue-defense", "blue-attack"];
    const inputLevels = object(input.computerLevels, seats, "computerniveauer");
    result.computerLevels = Object.fromEntries(seats.map(seat => [seat, choice(inputLevels[seat], levels, "computerniveau")])) as Record<SeatId, ComputerLevel>;
  }
  return result;
}

function quaternion(x: unknown, y: unknown, z: unknown, w: unknown) {
  const result = { x: number(x, -1.001, 1.001, "rotation"), y: number(y, -1.001, 1.001, "rotation"), z: number(z, -1.001, 1.001, "rotation"), w: number(w, -1.001, 1.001, "rotation") };
  const length = Math.hypot(result.x, result.y, result.z, result.w);
  if (Math.abs(length - 1) > 0.01) invalid("rotation");
  return result;
}
function goalFrame(value: unknown, time: number): ReplayFrame {
  const frame = object(value, ["time", "ball", "rods"], "målposition");
  const frameTime = number(frame.time, 0, REPLAY_FILE_LIMITS.duration, "måltid");
  if (Math.abs(frameTime - time) > 1e-6) invalid("måltid");
  const ball = object(frame.ball, ["position", "rotation"], "bold");
  const position = object(ball.position, ["x", "y", "z"], "boldposition");
  const rotation = object(ball.rotation, ["x", "y", "z", "w"], "boldrotation");
  if (!Array.isArray(frame.rods) || frame.rods.length !== 8) invalid("stænger");
  return {
    time: frameTime,
    ball: {
      position: { x: number(position.x, -100, 100, "boldposition"), y: number(position.y, -100, 100, "boldposition"), z: number(position.z, -100, 100, "boldposition") },
      rotation: quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
    },
    rods: frame.rods.map(value => {
      const rod = object(value, ["translation", "angle"], "stang");
      return { translation: number(rod.translation, -2, 2, "stangposition"), angle: number(rod.angle, -100_000_000, 100_000_000, "stangvinkel") };
    }),
  };
}

function recording(value: unknown, target: number): PackedMatchRecording {
  const input = object(value, ["duration", "sampleInterval", "frames", "goals"], "optagelse");
  const duration = number(input.duration, 0, REPLAY_FILE_LIMITS.duration, "varighed");
  const sampleInterval = number(input.sampleInterval, 1 / 120, 60, "billedinterval");
  if (!Array.isArray(input.frames) || !input.frames.length || input.frames.length % STRIDE || input.frames.length > REPLAY_FILE_LIMITS.frames * STRIDE) invalid("billeder");
  if (!Array.isArray(input.goals) || input.goals.length > target * 2 - 1) invalid("mål");
  const inputFrames: unknown[] = input.frames;
  const frames: number[] = new Array(inputFrames.length);
  let lastTime = -1, lastRally = 0;
  const rallyRanges = new Map<number, { start: number; end: number }>();
  for (let offset = 0; offset < inputFrames.length; offset += STRIDE) {
    const at = (index: number) => inputFrames[offset + index];
    const time = number(at(0), 0, duration + TIME_TOLERANCE, "billedtid");
    const rally = integer(at(24), 1, MAX_RALLIES, "boldrunde");
    if (time < lastTime || rally < lastRally) invalid("billedrækkefølge");
    if (!offset && time > TIME_TOLERANCE) invalid("starttid");
    const range = rallyRanges.get(rally);
    if (range) range.end = time;
    else rallyRanges.set(rally, { start: time, end: time });
    frames[offset] = time;
    for (let index = 1; index <= 3; index++) frames[offset + index] = number(at(index), -100, 100, "boldposition");
    const q = quaternion(at(4), at(5), at(6), at(7));
    frames[offset + 4] = q.x;
    frames[offset + 5] = q.y;
    frames[offset + 6] = q.z;
    frames[offset + 7] = q.w;
    for (let rod = 0; rod < 8; rod++) {
      frames[offset + 8 + rod * 2] = number(at(8 + rod * 2), -2, 2, "stangposition");
      frames[offset + 9 + rod * 2] = number(at(9 + rod * 2), -100_000_000, 100_000_000, "stangvinkel");
    }
    frames[offset + 24] = rally;
    lastTime = time;
    lastRally = rally;
  }
  if (duration - lastTime > sampleInterval + TIME_TOLERANCE) invalid("sluttid");
  let previousTime = -1, previousRally = 0;
  const scores = { red: 0, blue: 0 };
  const goals = input.goals.map((value, i): PackedMatchRecording["goals"][number] => {
    const goal = object(value, ["index", "time", "team", "scores", "start", "end", "frame", "rally"], "mål");
    const index = integer(goal.index, i + 1, i + 1, "målnummer");
    const time = number(goal.time, 0, duration, "måltid");
    const start = number(goal.start, 0, time, "målstart");
    const end = number(goal.end, time, time, "målslutning");
    const rally = integer(goal.rally, 1, lastRally, "målboldrunde");
    if (time <= previousTime || start < previousTime - 1e-6 || rally <= previousRally || scores.red >= target || scores.blue >= target) invalid("målrækkefølge");
    // A very short rally may disappear during thinning. Its exact goal pose is
    // still archived, so only check a packed range when that rally survived.
    const range = rallyRanges.get(rally);
    if (range && (time < range.start - sampleInterval - TIME_TOLERANCE || time > range.end + sampleInterval + TIME_TOLERANCE)) invalid("målboldrunde");
    const team = choice(goal.team, teams, "målhold");
    const inputScores = object(goal.scores, teams, "målstilling");
    scores[team]++;
    for (const side of teams) if (integer(inputScores[side], 0, target, "målstilling") !== scores[side]) invalid("målstilling");
    previousTime = time;
    previousRally = rally;
    return { index, time, start, end, rally, team, scores: { ...scores }, frame: goalFrame(goal.frame, time) };
  });
  return { duration, sampleInterval, frames, goals };
}

/** Copies only recognized, bounded data. Imported URLs and catalogue overrides
 * never reach rendering, and no recording data can start a network session. */
export function validateReplayFile(value: unknown): ReplayFileData {
  const input = object(value, ["format", "version", "createdAt", "teams", "settings", "recording"], "format");
  if (input.format !== "nem-bold-replay" || input.version !== 1) invalid("formatversion");
  const createdAt = plainText(input.createdAt, 40, "dato");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) invalid("dato");
  const inputTeams = object(input.teams, teams, "hold");
  const matchSettings = settings(input.settings);
  return {
    format: "nem-bold-replay", version: 1, createdAt,
    teams: { red: teamIdentity(inputTeams.red, "red"), blue: teamIdentity(inputTeams.blue, "blue") },
    settings: matchSettings,
    recording: recording(input.recording, matchSettings.goalsToWin),
  };
}

async function boundedBytes(stream: ReadableStream<Uint8Array>, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel().catch(() => {});
        throw new Error("Replayfilen er for stor.");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

/** Browser-native gzip with a plain JSON fallback for older browsers. */
export async function encodeReplayFile(value: ReplayFileData): Promise<{ blob: Blob; filename: string }> {
  const data = validateReplayFile(value);
  const plain = new Blob([JSON.stringify(data)], { type: "application/json" });
  if (plain.size > REPLAY_FILE_LIMITS.inputBytes) throw new Error("Replayfilen er for stor.");
  let blob = plain;
  let extension = "json";
  if (typeof CompressionStream !== "undefined") {
    // Constructor support is feature-detected too: some older engines expose
    // the interface but do not implement gzip.
    let compressor: CompressionStream | undefined;
    try { compressor = new CompressionStream("gzip"); } catch { /* Use JSON. */ }
    if (compressor) {
      const bytes = await boundedBytes(plain.stream().pipeThrough(compressor), REPLAY_FILE_LIMITS.inputBytes);
      blob = new Blob([bytes], { type: "application/gzip" });
      extension = "json.gz";
    }
  }
  return { blob, filename: `nem-bold-${data.createdAt.slice(0, 19).replace(/[:T]/g, "-")}.${extension}` };
}

/** Reads a local File/Blob only. Count decompressed bytes as they arrive instead
 * of materializing an unbounded Response, including for compressed zip bombs. */
export async function decodeReplayFile(blob: Blob): Promise<ReplayFileData> {
  if (!blob.size || blob.size > REPLAY_FILE_LIMITS.inputBytes) throw new Error("Replayfilen er tom eller for stor.");
  const header = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  let stream = blob.stream();
  if (header[0] === 0x1f && header[1] === 0x8b) {
    if (typeof DecompressionStream === "undefined") throw new Error("Denne browser kan ikke åbne komprimerede replays. Prøv en nyere browser.");
    try { stream = stream.pipeThrough(new DecompressionStream("gzip")); }
    catch { throw new Error("Denne browser kan ikke åbne komprimerede replays. Prøv en nyere browser."); }
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try { bytes = await boundedBytes(stream, REPLAY_FILE_LIMITS.expandedBytes); }
  catch (error) {
    if (error instanceof Error && error.message === "Replayfilen er for stor.") throw error;
    throw new Error("Replayfilen kunne ikke pakkes ud.");
  }
  let value: unknown;
  try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("Replayfilen indeholder ikke gyldige replaydata."); }
  return validateReplayFile(value);
}
