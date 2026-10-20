import type {
  MatchSettings,
  RodInput,
  SessionState,
  TableFrame,
  Team,
  SeatRole,
  ComputerLevel,
  GameSoundEvent,
  ReplayState,
} from "../shared/types";
import { GAME_CONFIG } from "../game/GameConfig";
import { isTeamName } from "../shared/teamIdentity";

export const PROTOCOL_VERSION = 3;
export const NETWORK_CONFIG = {
  heartbeatInterval: 2_000,
  heartbeatTimeout: 9_000,
  handshakeTimeout: 8_000,
  lobbyReservationTimeout: 15_000,
  reconnectDelay: 1_500,
  maxReconnectDelay: 8_000,
  connectionTimeout: 15_000,
  inputInterval: 1000 / GAME_CONFIG.rendering.controllerFps,
  activeInputRefresh: 100,
  maxBufferedBytes: 64 * 1024,
  tableFrameInterval: 1000 / GAME_CONFIG.rendering.tableStreamFps,
  maxFrameBufferedBytes: 4 * 1024,
  maxPendingConnections: 24,
  maxMessagesPerSecond: 400,
} as const;

export type ClientMessage =
  | { type: "reserve-team"; team: Team }
  | { type: "reserve-seat"; team: Team; role: SeatRole }
  | { type: "start-match" }
  | { type: "set-computer-level"; team: Team; role: SeatRole; level: ComputerLevel }
  | { type: "team-name"; name: string }
  | { type: "set-ready"; ready: boolean }
  | ({ type: "rod-input" } & RodInput)
  | { type: "table-bump"; sequence: number }
  | { type: "update-settings"; settings: Partial<MatchSettings> }
  | { type: "pause"; paused: boolean }
  | { type: "rematch" }
  | { type: "new-match" }
  | { type: "leave-match" };

export type ClientEnvelope =
  | ClientMessage
  | { type: "hello"; version: number; token?: string; role?: "spectator" }
  | { type: "ping"; at: number };

export type ServerMessage =
  | { type: "welcome"; playerId: string; token: string; state: SessionState }
  | { type: "spectator-welcome"; state: SessionState }
  | { type: "state"; state: SessionState }
  | { type: "table-frame"; frame: TableFrame }
  | { type: "game-sound"; event: GameSoundEvent }
  | { type: "pong"; at: number }
  | { type: "error"; code: string; message: string; fatal?: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fields(value: Record<string, unknown>, allowed: string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

const sequence = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const numberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= min &&
  value <= max;

export function isSettingsPatch(
  value: unknown,
): value is Partial<MatchSettings> {
  if (
    !record(value) ||
    !fields(value, [
      "goalsToWin",
      "graphics",
      "ballSpeed",
      "rotationDamping",
      "bumpStrength",
      "playerCount",
      "computerOpponent",
      "teamControls",
      "computerLevels",
    ])
  )
    return false;
  if (!Object.keys(value).length) return false;
  return (
    (value.playerCount === undefined ||
      [0, 1, 2, 3, 4].includes(value.playerCount as number)) &&
    (value.teamControls === undefined || isTeamControls(value.teamControls)) &&
    (value.computerLevels === undefined || (record(value.computerLevels) &&
      fields(value.computerLevels, ["red-defense", "red-attack", "blue-defense", "blue-attack"]) &&
      ["red-defense", "red-attack", "blue-defense", "blue-attack"].every((seat) => ["beginner", "normal", "advanced"].includes((value.computerLevels as Record<string, string>)[seat]!)))) &&
    (value.computerOpponent === undefined ||
      ["off", "beginner", "normal", "advanced"].includes(
        value.computerOpponent as string,
      )) &&
    (value.goalsToWin === undefined ||
      [3, 5, 10].includes(value.goalsToWin as number)) &&
    (value.graphics === undefined ||
      ["low", "normal", "high"].includes(value.graphics as string)) &&
    (value.ballSpeed === undefined || numberIn(value.ballSpeed, 0.5, 2)) &&
    (value.rotationDamping === undefined ||
      numberIn(value.rotationDamping, 0.1, 8)) &&
    (value.bumpStrength === undefined ||
      numberIn(value.bumpStrength, 0.01, 0.5))
  );
}

/** Validate at the trust boundary. The player's team is never accepted from input. */
export function isClientEnvelope(value: unknown): value is ClientEnvelope {
  if (!record(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "hello":
      return (
        fields(value, ["type", "version", "token", "role"]) &&
        value.version === PROTOCOL_VERSION &&
        (value.role === undefined || (value.role === "spectator" && value.token === undefined)) &&
        (value.token === undefined ||
          (typeof value.token === "string" && value.token.length <= 100))
      );
    case "ping":
      return (
        fields(value, ["type", "at"]) &&
        numberIn(value.at, 0, Number.MAX_SAFE_INTEGER)
      );
    case "reserve-team":
      return (
        fields(value, ["type", "team"]) &&
        (value.team === "red" || value.team === "blue")
      );
    case "reserve-seat":
      return fields(value, ["type", "team", "role"]) &&
        ["red", "blue"].includes(value.team as string) && ["defense", "attack"].includes(value.role as string);
    case "set-computer-level":
      return fields(value, ["type", "team", "role", "level"]) &&
        ["red", "blue"].includes(value.team as string) && ["defense", "attack"].includes(value.role as string) &&
        ["beginner", "normal", "advanced"].includes(value.level as string);
    case "team-name":
      return fields(value, ["type", "name"]) && isTeamName(value.name);
    case "set-ready":
      return (
        fields(value, ["type", "ready"]) && typeof value.ready === "boolean"
      );
    case "rod-input":
      return (
        fields(value, [
          "type",
          "sequence",
          "rodId",
          "translation",
          "angularVelocity",
          "active",
          "flick",
          "rotationOnly",
        ]) &&
        sequence(value.sequence) &&
        Number.isInteger(value.rodId) &&
        numberIn(value.rodId, 0, 3) &&
        numberIn(value.translation, -1, 1) &&
        numberIn(value.angularVelocity, -35, 35) &&
        typeof value.active === "boolean" &&
        (value.flick === undefined ||
          (value.active === false && typeof value.flick === "boolean")) &&
        (value.rotationOnly === undefined ||
          (typeof value.rotationOnly === "boolean" &&
            (!value.rotationOnly ||
              (value.active === false && value.flick === true))))
      );
    case "table-bump":
      return fields(value, ["type", "sequence"]) && sequence(value.sequence);
    case "update-settings":
      return (
        fields(value, ["type", "settings"]) && isSettingsPatch(value.settings)
      );
    case "pause":
      return (
        fields(value, ["type", "paused"]) && typeof value.paused === "boolean"
      );
    case "rematch":
    case "new-match":
    case "leave-match":
    case "start-match":
      return fields(value, ["type"]);
    default:
      return false;
  }
}

export function isServerMessage(value: unknown): value is ServerMessage {
  if (!record(value)) return false;
  if (value.type === "game-sound")
    return fields(value, ["type", "event"]) && isGameSoundEvent(value.event);
  if (value.type === "table-frame")
    return fields(value, ["type", "frame"]) && isTableFrame(value.frame);
  if (value.type === "error")
    return typeof value.code === "string" && typeof value.message === "string";
  if (value.type === "pong") return typeof value.at === "number";
  if (value.type === "state" || value.type === "welcome" || value.type === "spectator-welcome") {
    if (
      !record(value.state) ||
      !Array.isArray(value.state.players) ||
      !record(value.state.teamNames) ||
      !isTeamName(value.state.teamNames.red) ||
      !isTeamName(value.state.teamNames.blue) ||
      !record(value.state.settings) ||
      !record(value.state.match)
    )
      return false;
    return (
      value.type !== "welcome" ||
      (typeof value.playerId === "string" && typeof value.token === "string")
    );
  }
  return false;
}

function isTeamControls(value: unknown) {
  return record(value) && fields(value, ["red", "blue"]) && ["red", "blue"].every((team) => {
    const control = value[team];
    return record(control) && fields(control, ["computer", "level"]) &&
      ["off", "full", "defense", "attack"].includes(control.computer as string) &&
      ["beginner", "normal", "advanced"].includes(control.level as string);
  });
}

export function isGameSoundEvent(value: unknown): value is GameSoundEvent {
  return record(value) && fields(value, ["id", "kind", "strength"]) && sequence(value.id) &&
    ["kick", "wall", "goal", "whistle"].includes(value.kind as string) && numberIn(value.strength, 0, 1);
}

export function isReplayState(value: unknown): value is ReplayState {
  if (!record(value) || !fields(value, ["progress", "slowMotion", "remaining", "fade", "summary", "goalIndex", "goalCount", "fullMatch", "mode", "playing", "time", "duration", "scores", "goalTeam"]) ||
    !numberIn(value.progress, 0, 1) || typeof value.slowMotion !== "boolean" ||
    (value.remaining !== undefined && !numberIn(value.remaining, 0, 8.1)) ||
    (value.fade !== undefined && !numberIn(value.fade, 0, 1)) ||
    (value.summary !== undefined && typeof value.summary !== "boolean") ||
    (value.fullMatch !== undefined && typeof value.fullMatch !== "boolean") ||
    (value.mode !== undefined && !["highlights", "full"].includes(value.mode as string)) ||
    (value.playing !== undefined && typeof value.playing !== "boolean") ||
    (value.time !== undefined && !numberIn(value.time, 0, Number.MAX_SAFE_INTEGER)) ||
    (value.duration !== undefined && !numberIn(value.duration, 0, Number.MAX_SAFE_INTEGER)) ||
    (value.scores !== undefined && (!record(value.scores) || !fields(value.scores, ["red", "blue"]) || !Number.isInteger(value.scores.red) || !Number.isInteger(value.scores.blue) || !numberIn(value.scores.red, 0, 10) || !numberIn(value.scores.blue, 0, 10))) ||
    (value.goalTeam !== undefined && !["red", "blue"].includes(value.goalTeam as string))) return false;
  if (value.fullMatch === true && (value.mode === undefined || value.playing === undefined || value.time === undefined || value.duration === undefined || value.scores === undefined || (value.time as number) > (value.duration as number))) return false;
  const numbered = value.fullMatch === true || value.summary === true || value.goalIndex !== undefined || value.goalCount !== undefined;
  return !numbered || (Number.isInteger(value.goalIndex) && Number.isInteger(value.goalCount) &&
    numberIn(value.goalIndex, 1, 19) && numberIn(value.goalCount, 1, 19) && value.goalIndex <= value.goalCount);
}

/** Bounded cosmetic transforms only: no objects, URLs or physics inputs. */
export function isTableFrame(value: unknown): value is TableFrame {
  if (
    !record(value) ||
    !fields(value, [
      "sequence",
      "time",
      "epoch",
      "phase",
      "ball",
      "rods",
      "kits",
      "replay",
      "scores",
      "goalsToWin",
      "camera",
    ]) ||
    !sequence(value.sequence) ||
    !sequence(value.epoch) ||
    (value.scores !== undefined && (!record(value.scores) || !fields(value.scores, ["red", "blue"]) || !numberIn(value.scores.red, 0, 10) || !numberIn(value.scores.blue, 0, 10))) ||
    (value.goalsToWin !== undefined && ![3, 5, 10].includes(value.goalsToWin as number)) ||
    (value.camera !== undefined && (!record(value.camera) || !fields(value.camera, ["position", "rotation", "aspect", "fov"]) || !isFramePosition(value.camera.position) || !isFrameRotation(value.camera.rotation) || !numberIn(value.camera.aspect, 0.1, 20) || !numberIn(value.camera.fov, 1, 150))) ||
    (value.replay !== undefined && !isReplayState(value.replay)) ||
    !numberIn(value.time, 0, Number.MAX_SAFE_INTEGER) ||
    ![
      "lobby",
      "countdown",
      "serving",
      "playing",
      "goal",
      "replay",
      "out",
      "paused",
      "finished",
    ].includes(value.phase as string) ||
    !record(value.ball) ||
    !fields(value.ball, ["position", "rotation"]) ||
    !isFramePosition(value.ball.position) ||
    !isFrameRotation(value.ball.rotation) ||
    !Array.isArray(value.rods) ||
    value.rods.length !== 8 ||
    !value.rods.every(
      (rod) =>
        record(rod) &&
        fields(rod, ["translation", "angle"]) &&
        numberIn(rod.translation, -2, 2) &&
        numberIn(rod.angle, -1e9, 1e9),
    ) ||
    !record(value.kits) ||
    !fields(value.kits, ["red", "blue"])
  )
    return false;

  return ["red", "blue"].every((team) => {
    const kit = (value.kits as Record<string, unknown>)[team];
    return (
      record(kit) &&
      fields(kit, ["primaryColor", "secondaryColor"]) &&
      [kit.primaryColor, kit.secondaryColor].every(
        (color) => typeof color === "string" && /^#[\da-f]{6}$/i.test(color),
      )
    );
  });
}

function isFramePosition(value: unknown) {
  return (
    record(value) &&
    fields(value, ["x", "y", "z"]) &&
    [value.x, value.y, value.z].every((axis) => numberIn(axis, -100, 100))
  );
}

function isFrameRotation(value: unknown) {
  if (!record(value) || !fields(value, ["x", "y", "z", "w"])) return false;
  const components = [value.x, value.y, value.z, value.w];
  if (!components.every((axis) => numberIn(axis, -1.001, 1.001))) return false;
  const magnitude = Math.hypot(...(components as number[]));
  return magnitude >= 0.99 && magnitude <= 1.01;
}
