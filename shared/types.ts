export type Team = "red" | "blue";
export type ComputerLevel = "beginner" | "normal" | "advanced";
export type SeatRole = "defense" | "attack";
export type SeatId = `${Team}-${SeatRole}`;
export interface TeamControl {
  computer: "off" | "full" | "defense" | "attack";
  level: ComputerLevel;
}
export interface GameSoundEvent {
  id: number;
  kind: "kick" | "wall" | "goal" | "whistle";
  strength: number;
}
export type MatchPhase =
  | "lobby"
  | "countdown"
  | "serving"
  | "playing"
  | "goal"
  | "replay"
  | "out"
  | "paused"
  | "finished";

export interface FootballClub {
  id: string;
  name: string;
  shortName?: string;
  country: string;
  league?: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  source?: string;
  aliases?: string[];
}

export interface MatchSettings {
  playerCount: 0 | 1 | 2 | 3 | 4;
  computerOpponent: "off" | "beginner" | "normal" | "advanced";
  teamControls?: Record<Team, TeamControl>;
  computerLevels?: Record<SeatId, ComputerLevel>;
  goalsToWin: number;
  graphics: "low" | "normal" | "high";
  ballSpeed: number;
  rotationDamping: number;
  bumpStrength: number;
}

export interface RodInput {
  sequence: number;
  rodId: number;
  translation: number;
  angularVelocity: number;
  active: boolean;
  flick?: boolean;
  rotationOnly?: boolean;
}

export interface TableVector {
  x: number;
  y: number;
  z: number;
}
export interface TableQuaternion extends TableVector {
  w: number;
}
export interface ReplayState {
  progress: number;
  slowMotion: boolean;
  remaining?: number;
  fade?: number;
  summary?: boolean;
  goalIndex?: number;
  goalCount?: number;
  /** Playback of the archived match; authoritative match scores stay final. */
  fullMatch?: boolean;
  mode?: "highlights" | "full";
  playing?: boolean;
  time?: number;
  duration?: number;
  scores?: Record<Team, number>;
  goalTeam?: Team;
}
export interface MatchReplayGoal {
  index: number;
  time: number;
  team: Team;
  scores: Record<Team, number>;
  start: number;
  end: number;
}
export interface MatchRecording {
  duration: number;
  goals: MatchReplayGoal[];
}
/** Host transforms; controllers may predict owned rods but never the ball. */
export interface TableFrame {
  sequence: number;
  time: number;
  epoch: number;
  phase: MatchPhase;
  ball: { position: TableVector; rotation: TableQuaternion };
  rods: { translation: number; angle: number }[];
  kits: Record<Team, { primaryColor: string; secondaryColor: string }>;
  replay?: ReplayState;
  scores?: Record<Team, number>;
  goalsToWin?: number;
  camera?: { position: TableVector; rotation: TableQuaternion; aspect: number; fov: number };
}

export interface MatchSnapshot {
  phase: MatchPhase;
  scores: Record<Team, number>;
  countdown: number;
  winner: Team | null;
  scoringTeam?: Team | null;
  bumpAvailable: boolean;
  bumpCooldown: number;
  notice: string;
  replay?: ReplayState;
}

export interface PlayerState {
  id: string;
  team: Team | null;
  /** Older saved rosters may carry a club ID; live sessions use teamNames. */
  clubId?: string | null;
  ready: boolean;
  connected: boolean;
  admin: boolean;
  rematch: boolean;
  rodIds: number[];
  computer?: boolean;
  teamCaptain?: boolean;
}

export interface SessionState {
  sessionId: string;
  players: PlayerState[];
  teamNames: Record<Team, string>;
  settings: MatchSettings;
  match: MatchSnapshot;
}

export const DEFAULT_SETTINGS: MatchSettings = {
  playerCount: 2,
  computerOpponent: "off",
  goalsToWin: 5,
  graphics: "normal",
  ballSpeed: 1,
  rotationDamping: 1.5,
  bumpStrength: 0.15,
};

export const INITIAL_MATCH: MatchSnapshot = {
  phase: "lobby",
  scores: { red: 0, blue: 0 },
  countdown: 3,
  winner: null,
  scoringTeam: null,
  bumpAvailable: false,
  bumpCooldown: 0,
  notice: "",
};
