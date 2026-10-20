import type { ComputerLevel, MatchSettings, PlayerState, SeatId, SeatRole, Team, TeamControl } from "./types";

export const SEAT_RODS: Record<SeatRole, readonly number[]> = { defense: [0, 1], attack: [2, 3] };
export const SEAT_ROLES: readonly SeatRole[] = ["defense", "attack"];
export function seatOwner(players: readonly PlayerState[], team: Team, role: SeatRole) {
  return players.find((player) => !player.computer && player.team === team && SEAT_RODS[role].every((rod) => player.rodIds.includes(rod)));
}
export function seatLevel(settings: MatchSettings, team: Team, role: SeatRole): ComputerLevel {
  return settings.computerLevels?.[`${team}-${role}`] ?? resolveTeamControls(settings)[team].level;
}
export function defaultComputerLevels(): Record<SeatId, ComputerLevel> {
  return { "red-defense": "beginner", "red-attack": "beginner", "blue-defense": "beginner", "blue-attack": "beginner" };
}

export function resolveTeamControls(settings: MatchSettings): Record<Team, TeamControl> {
  return settings.teamControls ?? {
    red: { computer: "off", level: "normal" },
    blue: { computer: settings.computerOpponent === "off" ? "off" : "full", level: settings.computerOpponent === "off" ? "normal" : settings.computerOpponent },
  };
}
export function computerAssignments(settings: MatchSettings): { team: Team; level: ComputerLevel; rodIds: number[] }[] {
  const controls = resolveTeamControls(settings);
  return (["red", "blue"] as const).flatMap((team) => {
    const control = controls[team];
    if (settings.computerLevels && control.computer === "full" && seatLevel(settings, team, "defense") === seatLevel(settings, team, "attack")) return [{ team, level: seatLevel(settings, team, "defense"), rodIds: [0, 1, 2, 3] }];
    if (settings.computerLevels) return SEAT_ROLES.flatMap((role) => {
      const automatic = control.computer === "full" || control.computer === role;
      return automatic ? [{ team, level: seatLevel(settings, team, role), rodIds: [...SEAT_RODS[role]] }] : [];
    });
    return control.computer === "off" ? [] : [{ team, level: control.level,
      rodIds: control.computer === "full" ? [0, 1, 2, 3] : control.computer === "defense" ? [0, 1] : [2, 3] }];
  });
}
export function humanPlayerBounds(settings: MatchSettings) {
  const controls = resolveTeamControls(settings);
  let min = 0, max = 0;
  for (const team of ["red", "blue"] as const) {
    const mode = controls[team].computer;
    if (mode !== "full") { min++; max += mode === "off" ? 2 : 1; }
  }
  return { min, max };
}
export function humanTeamCapacity(settings: MatchSettings, team: Team) {
  const controls = resolveTeamControls(settings);
  if (controls[team].computer === "full") return 0;
  if (controls[team].computer !== "off") return 1;
  const other = team === "red" ? "blue" : "red";
  return Math.min(2, Math.max(1, settings.playerCount - (controls[other].computer === "full" ? 0 : 1)));
}
export function normalizeMatchSettings(current: MatchSettings, patch: Partial<MatchSettings>): MatchSettings {
  const next = { ...current, ...patch };
  if (patch.teamControls) {
    next.teamControls = structuredClone(patch.teamControls);
    next.computerOpponent = next.teamControls.blue.computer === "full" ? next.teamControls.blue.level : "off";
  } else if (patch.computerOpponent !== undefined) {
    delete next.teamControls;
  } else if (!next.teamControls && patch.playerCount !== undefined) {
    if (patch.playerCount === 1 && next.computerOpponent === "off") next.computerOpponent = "normal";
    else if (patch.playerCount > 2) next.computerOpponent = "off";
  }
  const bounds = humanPlayerBounds(next);
  next.playerCount = Math.max(bounds.min, Math.min(bounds.max, next.playerCount)) as MatchSettings["playerCount"];
  return next;
}
