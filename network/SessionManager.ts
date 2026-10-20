import { DEFAULT_SETTINGS, INITIAL_MATCH } from "../shared/types";
import { computerAssignments, defaultComputerLevels, SEAT_RODS, SEAT_ROLES, seatLevel, seatOwner } from "../shared/matchSettings";
import type {
  FootballClub,
  MatchSettings,
  MatchSnapshot,
  PlayerState,
  RodInput,
  SessionState,
  Team,
  SeatRole,
} from "../shared/types";
import {
  isClientEnvelope,
  isSettingsPatch,
  NETWORK_CONFIG,
} from "./MessageProtocol";
import { createSecureId } from "./identifiers";
import { DEFAULT_TEAM_NAMES, getTeamIdentities, normalizeTeamName } from "../shared/teamIdentity";

export interface SessionCallbacks {
  onState: (state: SessionState) => void;
  onStart: (settings: MatchSettings, clubs: Record<Team, FootballClub>) => void;
  onInput: (team: Team, input: RodInput) => void;
  onBump: (team: Team) => void;
  onPause: () => void;
  onResume: () => void;
  onReset: () => void;
}

interface PrivatePlayer {
  state: PlayerState;
  token: string;
  lastSeen: number;
  disconnectedAt: number | null;
  lastInput: number[];
  lastBump: number;
  lastInputAt: number[];
  translations: number[];
  teamSelectedAt: number;
}

export interface Admission {
  playerId: string;
  token: string;
  reconnected: boolean;
}
export interface ActionResult {
  ok: boolean;
  code?: string;
  message?: string;
}
const success = (): ActionResult => ({ ok: true });
const error = (code: string, message: string): ActionResult => ({
  ok: false,
  code,
  message,
});
const copy = <T>(value: T): T => structuredClone(value);

/** Authoritative lobby and match permissions, independent of Vue and transport. */
export class SessionManager {
  private players = new Map<string, PrivatePlayer>();
  private settings: MatchSettings = { ...DEFAULT_SETTINGS, playerCount: 0, computerLevels: defaultComputerLevels(), teamControls: { red: { computer: "full", level: "beginner" }, blue: { computer: "full", level: "beginner" } } };
  private match: MatchSnapshot = copy(INITIAL_MATCH);
  private reconnectPause = false;
  private matchStarted = false;
  private disposed = false;
  private localPlayers = new Set<string>();
  private captains = new Map<Team, string>();
  private teamNames: Record<Team, string> = { ...DEFAULT_TEAM_NAMES };
  private nextTeamSelection = 0;

  constructor(
    readonly sessionId: string,
    private callbacks: SessionCallbacks,
    private makeId: () => string = createSecureId,
  ) {}

  get state(): SessionState {
    return copy({
      sessionId: this.sessionId,
      players: [...this.players.values()]
        .map((p) => p.state)
        .concat(this.computerPlayers()),
      teamNames: this.teamNames,
      settings: this.settings,
      match: this.match,
    });
  }

  admit(token?: string, now = Date.now()): Admission | ActionResult {
    this.expire(now);
    if (this.disposed) return error("closed", "Sessionen er lukket.");
    if (token) {
      const player = [...this.players.values()].find((p) => p.token === token);
      if (!player)
        return error(
          "invalid-token",
          "Din tidligere plads er udløbet. Forbind igen for at vælge en ny plads.",
        );
      if (player.state.connected)
        return error(
          "already-connected",
          "Denne spiller er allerede forbundet.",
        );
      player.state.connected = true;
      player.disconnectedAt = null;
      player.lastSeen = now;
      player.lastInput.fill(-1);
      player.lastInputAt.fill(0);
      player.lastBump = -1;
      this.assignAdmin();
      this.emit();
      return {
        playerId: player.state.id,
        token: player.token,
        reconnected: true,
      };
    }
    const allRolesTaken = (["red", "blue"] as const).every((team) => SEAT_ROLES.every((role) =>
      [...this.players.values()].some((p) => p.state.team === team && SEAT_RODS[role].every((rod) => p.state.rodIds.includes(rod)))));
    if (this.players.size >= 4 || allRolesTaken)
      return error(
        "full",
        "Alle pladser ved bordet er optaget af spillere.",
      );
    if (this.match.phase !== "lobby")
      return error(
        "match-locked",
        "Kampen er i gang. Brug den oprindelige telefon til at genoprette forbindelsen.",
      );
    const id = this.makeId();
    const player: PrivatePlayer = {
      state: {
        id,
        team: null,
        ready: false,
        connected: true,
        admin: false,
        rematch: false,
        rodIds: [],
      },
      token: this.makeId(),
      lastSeen: now,
      disconnectedAt: null,
      lastInput: [-1, -1, -1, -1],
      lastBump: -1,
      lastInputAt: [0, 0, 0, 0],
      translations: [0, 0, 0, 0],
      teamSelectedAt: 0,
    };
    this.players.set(id, player);
    this.synchronizeRoster();
    this.assignAdmin();
    this.emit();
    return { playerId: id, token: player.token, reconnected: false };
  }

  /** A player on this host has no remote heartbeat that can time out. */
  admitLocal(now = Date.now()): Admission | ActionResult {
    const admission = this.admit(undefined, now);
    if (!("ok" in admission)) this.localPlayers.add(admission.playerId);
    return admission;
  }

  touch(playerId: string, now = Date.now()) {
    const player = this.players.get(playerId);
    if (player?.state.connected) player.lastSeen = now;
  }

  disconnect(playerId: string, now = Date.now()) {
    const player = this.players.get(playerId);
    if (!player?.state.connected) return;
    player.state.connected = false;
    player.state.ready = false;
    player.disconnectedAt = now;
    // The winning goal and its replays still use goal/replay/paused phases.
    // A departing phone only changes the roster once the result is settled.
    if (this.match.winner !== null || this.match.phase === "finished") {
      this.emit();
      return;
    }
    this.neutralizePlayer(player);
    if (this.match.phase === "countdown" && !this.matchStarted) {
      this.match = copy(INITIAL_MATCH);
      this.players.forEach((p) => {
        p.state.ready = false;
      });
      this.callbacks.onReset();
    } else if (this.match.phase !== "lobby") {
      this.reconnectPause = true;
      this.players.forEach((p) => {
        p.state.ready = false;
      });
      this.match.phase = "paused";
      this.match.notice =
        "Forbindelsen blev afbrudt. Vent på alle telefoner; den første controller kan så fortsætte kampen.";
      this.callbacks.onPause();
    }
    if (this.match.phase === "lobby") this.assignAdmin();
    this.emit();
  }

  expire(now = Date.now()) {
    for (const player of this.players.values()) {
      if (
        player.state.connected &&
        !this.localPlayers.has(player.state.id) &&
        now - player.lastSeen > NETWORK_CONFIG.heartbeatTimeout
      )
        this.disconnect(player.state.id, now);
    }
    let removed = false;
    if (this.match.phase === "lobby") {
      for (const [id, player] of this.players) {
        if (
          player.disconnectedAt !== null &&
          now - player.disconnectedAt >= NETWORK_CONFIG.lobbyReservationTimeout
        ) {
          this.players.delete(id);
          this.localPlayers.delete(id);
          removed = true;
        }
      }
    }
    if (removed) {
      this.synchronizeRoster();
      this.assignAdmin();
      this.emit();
    }
  }

  handle(playerId: string, raw: unknown, now = Date.now()): ActionResult {
    if (!isClientEnvelope(raw) || raw.type === "hello")
      return error("invalid-message", "Ugyldig besked.");
    const player = this.players.get(playerId);
    if (!player?.state.connected)
      return error("not-connected", "Spilleren er ikke forbundet.");
    player.lastSeen = now;
    switch (raw.type) {
      case "ping":
        return success();
      case "reserve-seat":
        return this.reserveSeat(player, raw.team, raw.role);
      case "reserve-team": {
        const free = SEAT_ROLES.filter((role) => !seatOwner(this.state.players.filter((p) => p.id !== playerId), raw.team, role));
        if (!free.length) return error("team-taken", "Holdets pladser er optaget.");
        return this.reserveRoles(player, raw.team, free);
      }
      case "start-match":
        return this.startMatch(player);
      case "set-computer-level": {
        if (!["lobby", "paused", "finished"].includes(this.match.phase)) return error("locked", "Computerniveauet kan ændres før kampen eller under en pause.");
        if (seatOwner(this.state.players, raw.team, raw.role)) return error("human-seat", "Denne plads styres af en spiller.");
        return this.applySettings({ computerLevels: { ...defaultComputerLevels(), ...this.settings.computerLevels, [`${raw.team}-${raw.role}`]: raw.level } });
      }
      case "team-name": {
        const team = player.state.team;
        if (this.match.phase !== "lobby") return error("locked", "Holdnavnet vælges før kampen.");
        if (!team || this.captains.get(team) !== playerId) return error("captain-only", "Den første spiller på holdet vælger holdnavnet.");
        this.teamNames[team] = normalizeTeamName(raw.name) || DEFAULT_TEAM_NAMES[team];
        this.emit();
        return success();
      }
      case "set-ready": {
        if (
          !raw.ready &&
          this.match.phase === "countdown" &&
          !this.matchStarted
        ) {
          this.match = copy(INITIAL_MATCH);
          player.state.ready = false;
          this.callbacks.onReset();
          this.emit();
          return success();
        }
        if (this.match.phase !== "lobby" && this.match.phase !== "paused")
          return error("locked", "Kampen er allerede startet.");
        if (raw.ready && !player.state.team)
          return error("incomplete", "Vælg hold, før du melder klar.");
        player.state.ready = raw.ready;
        this.emit();
        if (this.match.phase === "paused" && player.state.admin) this.maybeStart();
        return success();
      }
      case "rod-input": {
        if (this.match.phase !== "playing" || !player.state.team)
          return error("inactive", "Kampen er ikke aktiv.");
        if (!player.state.rodIds.includes(raw.rodId))
          return error(
            "rod-not-owned",
            "Denne stang styres af din medspiller.",
          );
        if (raw.sequence <= player.lastInput[raw.rodId]!)
          return error("stale-input", "Input er forældet.");
        player.lastInput[raw.rodId] = raw.sequence;
        // Releases always pass through, even when sent immediately after a move.
        if (
          raw.active &&
          now - player.lastInputAt[raw.rodId]! <
            NETWORK_CONFIG.inputInterval * 0.8
        )
          return success();
        player.lastInputAt[raw.rodId] = now;
        if (!raw.rotationOnly) player.translations[raw.rodId] = raw.translation;
        const {
          sequence,
          rodId,
          translation,
          angularVelocity,
          active,
          flick,
          rotationOnly,
        } = raw;
        this.callbacks.onInput(player.state.team, {
          sequence,
          rodId,
          translation,
          angularVelocity,
          active,
          ...(flick === undefined ? {} : { flick }),
          ...(rotationOnly === undefined ? {} : { rotationOnly }),
        });
        return success();
      }
      case "table-bump": {
        if (raw.sequence <= player.lastBump)
          return error("stale-input", "Bump er forældet.");
        player.lastBump = raw.sequence;
        if (
          this.match.phase !== "playing" ||
          !this.match.bumpAvailable ||
          this.match.bumpCooldown > 0 ||
          !player.state.team
        )
          return error(
            "bump-unavailable",
            "Bump kræver, at bolden næsten ligger stille, og at pausen mellem bump er udløbet.",
          );
        this.callbacks.onBump(player.state.team);
        return success();
      }
      case "update-settings": {
        if (!player.state.admin)
          return error(
            "admin-only",
            "Kun lobbyadministratoren kan ændre fælles indstillinger.",
          );
        if (Object.keys(raw.settings).some((key) => !["goalsToWin", "ballSpeed", "rotationDamping", "bumpStrength", "computerLevels"].includes(key))) return error("invalid-settings", "Pladser vælges på controlleren; grafik vælges på hver skærm.");
        return this.applySettings(raw.settings);
      }
      case "pause": {
        if (raw.paused) {
          return this.pauseMatch();
        } else {
          if (this.match.phase !== "paused") return success();
          if (!this.hasParticipants())
            return error(
              "missing-player",
              "Alle telefoner skal være forbundet og have valgt en plads.",
            );
          if (!player.state.admin) return error("admin-only", "Den første controller genoptager kampen.");
          this.players.forEach((p) => { p.state.ready = true; });
          this.emit();
          this.maybeStart();
        }
        return success();
      }
      case "rematch": {
        if (this.match.phase !== "finished")
          return error("inactive", "Kampen er ikke slut endnu.");
        player.state.rematch = true;
        this.emit();
        if (
          this.hasParticipants() &&
          [...this.players.values()].every(
            (p) => p.state.connected && p.state.rematch,
          )
        ) {
          this.players.forEach((p) => {
            p.state.ready = true;
            p.state.rematch = false;
          });
          this.match = copy(INITIAL_MATCH);
          this.maybeStart();
        }
        return success();
      }
      case "leave-match":
        return this.leaveMatch();
      case "new-match": {
        if (this.match.phase !== "finished")
          return error(
            "inactive",
            "Afslut kampen, før der startes en ny kamp.",
          );
        return this.resetMatch();
      }
    }
  }

  pauseMatch(): ActionResult {
    if (this.match.phase === "lobby" || this.match.phase === "finished")
      return error("inactive", "Der er ingen aktiv kamp at pause.");
    if (this.match.phase !== "paused") {
      this.match.phase = "paused";
      this.match.notice = "Kampen er sat på pause";
      this.neutralizeAll();
      this.callbacks.onPause();
      this.emit();
    }
    return success();
  }

  leaveMatch(): ActionResult {
    if (this.match.phase !== "paused")
      return error("inactive", "Sæt kampen på pause, før den forlades.");
    return this.resetMatch();
  }

  private resetMatch(): ActionResult {
    this.match = copy(INITIAL_MATCH);
    this.matchStarted = false;
    this.reconnectPause = false;
    this.players.forEach((p) => {
      p.state.ready = false;
      p.state.rematch = false;
    });
    this.synchronizeRoster();
    this.callbacks.onReset();
    this.assignAdmin();
    this.emit();
    return success();
  }

  setMatch(snapshot: MatchSnapshot) {
    if (this.disposed) return;
    if (snapshot.phase === "playing" || snapshot.phase === "serving")
      this.matchStarted = true;
    this.match = copy(snapshot);
    if (this.match.winner !== null || this.match.phase === "finished")
      this.reconnectPause = false;
    if (this.reconnectPause && this.match.phase === "paused")
      this.match.notice =
        "Forbindelsen blev afbrudt. Vent på alle telefoner; den første controller kan så fortsætte kampen.";
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.players.clear();
    this.localPlayers.clear();
    this.captains.clear();
  }

  /** Trusted host setup before phones join; it uses the same rules as the lobby admin. */
  configureLobbySettings(patch: Partial<MatchSettings>): ActionResult {
    if (this.disposed) return error("closed", "Sessionen er lukket.");
    if (this.match.phase !== "lobby")
      return error(
        "lobby-only",
        "Antal spillere og computer vælges i lobbyen før kampen.",
      );
    return this.applySettings(patch);
  }

  private applySettings(patch: Partial<MatchSettings>): ActionResult {
    if (!isSettingsPatch(patch)) return error("invalid-settings", "Spilindstillingerne er ugyldige.");
    if (!["lobby", "paused", "finished"].includes(this.match.phase)) return error("locked", "Indstillinger kan ændres før kampen eller under en pause.");
    this.settings = { ...this.settings, ...copy(patch) };
    this.synchronizeRoster();
    this.emit();
    return success();
  }

  private reserveSeat(player: PrivatePlayer, team: Team, role: SeatRole): ActionResult {
    const own = player.state.team === team ? SEAT_ROLES.filter((candidate) => SEAT_RODS[candidate].every((id) => player.state.rodIds.includes(id))) : [];
    const roles = own.includes(role) ? own.filter((candidate) => candidate !== role) : [...own, role];
    return this.reserveRoles(player, team, roles);
  }

  private reserveRoles(player: PrivatePlayer, team: Team, roles: readonly SeatRole[]): ActionResult {
    if (this.match.phase !== "lobby") return error("locked", "Pladser vælges før kampen.");
    const others = this.state.players.filter((p) => p.id !== player.state.id);
    if (roles.some((role) => seatOwner(others, team, role))) return error("seat-taken", "Pladsen er allerede taget af en anden spiller.");
    if (roles.length && player.state.team !== team) player.teamSelectedAt = ++this.nextTeamSelection;
    if (!roles.length) player.teamSelectedAt = 0;
    player.state.team = roles.length ? team : null;
    player.state.rodIds = SEAT_ROLES.filter((role) => roles.includes(role)).flatMap((role) => [...SEAT_RODS[role]]);
    player.state.ready = false;
    this.synchronizeRoster();
    this.emit();
    return success();
  }

  private startMatch(player: PrivatePlayer): ActionResult {
    if (!player.state.admin) return error("admin-only", "Den første controller starter kampen.");
    if (!["lobby", "paused"].includes(this.match.phase)) return error("inactive", "Kampen er allerede startet.");
    if (!this.hasParticipants()) return error("incomplete", "Alle tilsluttede telefoner skal vælge en ledig plads først.");
    this.players.forEach((p) => { p.state.ready = true; });
    this.maybeStart();
    return success();
  }

  private computerPlayers(): PlayerState[] {
    return computerAssignments(this.settings).map(({ team, rodIds }) => ({
      id: `computer-${team}-${rodIds.join("")}`, team,
      ready: true, connected: true, admin: false, rematch: false, computer: true, rodIds,
    }));
  }

  private synchronizeRoster() {
    const humans = [...this.players.values()];
    this.settings.playerCount = humans.length as MatchSettings["playerCount"];
    this.settings.computerLevels ??= defaultComputerLevels();
    const controls = {} as NonNullable<MatchSettings["teamControls"]>;
    for (const team of ["red", "blue"] as const) {
      const members = humans.filter((p) => p.state.team === team).sort((a, b) => a.teamSelectedAt - b.teamSelectedAt);
      const captain = this.captains.get(team);
      if (!members.some((p) => p.state.id === captain)) {
        if (members[0]) this.captains.set(team, members[0].state.id);
        else this.captains.delete(team);
      }
      const occupied = new Set(members.flatMap((p) => p.state.rodIds));
      const defense = occupied.has(0), attack = occupied.has(2);
      controls[team] = { computer: !defense && !attack ? "full" : !defense ? "defense" : !attack ? "attack" : "off", level: seatLevel(this.settings, team, "defense") };
      for (const member of members) {
        member.state.teamCaptain = this.captains.get(team) === member.state.id;
      }
    }
    for (const player of humans.filter((p) => !p.state.team)) {
      player.state.rodIds = [];
      player.state.teamCaptain = false;
    }
    this.settings.teamControls = controls;
    this.settings.computerOpponent = controls.blue.computer === "full" ? controls.blue.level : "off";
  }

  private hasParticipants() {
    return this.players.size > 0 && [...this.players.values()].every((p) =>
      p.state.connected && p.state.team && p.state.rodIds.length);
  }

  private maybeStart() {
    const players = [...this.players.values()];
    if (
      !this.hasParticipants() ||
      !players.every(
        (p) =>
          p.state.connected && p.state.ready && p.state.team,
      )
    )
      return;
    if (this.match.phase === "paused") {
      this.reconnectPause = false;
      this.match.phase = "countdown";
      this.match.notice = "";
      this.callbacks.onResume();
      this.emit();
    } else if (this.match.phase === "lobby") {
      this.matchStarted = false;
      this.match = { ...copy(INITIAL_MATCH), phase: "countdown" };
      this.players.forEach((p) => {
        p.lastInput.fill(-1);
        p.lastBump = -1;
        p.state.rematch = false;
      });
      this.emit();
      this.callbacks.onStart(copy(this.settings), getTeamIdentities(this.teamNames));
    }
  }

  private assignAdmin() {
    const current = [...this.players.values()].find(
      (p) => p.state.admin && p.state.connected,
    );
    const next =
      current ?? [...this.players.values()].find((p) => p.state.connected);
    this.players.forEach((p) => {
      p.state.admin = p === next;
    });
  }

  private neutralizePlayer(player: PrivatePlayer) {
    if (!player.state.team) return;
    for (const rodId of player.state.rodIds)
      this.callbacks.onInput(player.state.team, {
        sequence: player.lastInput[rodId]! + 1,
        rodId,
        translation: player.translations[rodId] ?? 0,
        angularVelocity: 0,
        active: false,
      });
  }

  private neutralizeAll() {
    for (const player of this.players.values()) this.neutralizePlayer(player);
  }
  private emit() {
    if (!this.disposed) this.callbacks.onState(this.state);
  }
}
