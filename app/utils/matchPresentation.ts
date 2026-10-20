import type { MatchSettings, PlayerState, Team, TeamControl } from "../../shared/types";
import { humanPlayerBounds, humanTeamCapacity as teamCapacity, normalizeMatchSettings, resolveTeamControls } from "../../shared/matchSettings";
import { translateGameText } from "../../shared/runtimeMessages";

export const computerLevels = { beginner: "Begynder", normal: "Almindelig", advanced: "Øvet" } as const;
export function humanTeamCapacity(settings: MatchSettings, team: Team) {
  return teamCapacity(settings, team);
}
export function canJoinTeam(settings: MatchSettings, players: readonly PlayerState[], team: Team, playerId: string) {
  if (players.find((player) => player.id === playerId)?.team === team) return true;
  if (players.filter((player) => !player.computer && player.team && player.id !== playerId).length >= settings.playerCount) return false;
  return players.filter((player) => !player.computer && player.team === team && player.id !== playerId).length < humanTeamCapacity(settings, team);
}
export function modeSettingsChange(settings: MatchSettings, computer: boolean, humanCount = 0): Partial<MatchSettings> {
  const teamControls: Record<Team, TeamControl> = { red: { computer: "off", level: "normal" }, blue: { computer: computer ? "full" : "off", level: "normal" } };
  const next = normalizeMatchSettings(settings, { teamControls, playerCount: computer ? (humanCount > 1 ? 2 : 1) : Math.max(2, settings.playerCount) as MatchSettings["playerCount"] });
  return { teamControls: next.teamControls, computerOpponent: next.computerOpponent, playerCount: next.playerCount };
}
export function teamControlPatch(settings: MatchSettings, team: Team, patch: Partial<TeamControl>): Partial<MatchSettings> {
  const current = resolveTeamControls(settings);
  const controls = { red: { ...current.red }, blue: { ...current.blue } };
  controls[team] = { ...controls[team], ...patch };
  const next = normalizeMatchSettings(settings, { teamControls: controls });
  return { teamControls: controls, playerCount: next.playerCount };
}
export function canSetTeamControl(settings: MatchSettings, team: Team, computer: TeamControl["computer"], humanCount: number) {
  const patch = teamControlPatch(settings, team, { computer });
  return humanCount <= (patch.playerCount ?? settings.playerCount);
}
export function phoneCountOptions(settings: MatchSettings) {
  const { min, max } = humanPlayerBounds(settings);
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}
export function teamControlLabel(control: TeamControl, locale = "da") {
  return translateGameText({ off: "Mennesker", full: "Computer", defense: "CPU i forsvar", attack: "CPU i angreb" }[control.computer], locale);
}
export function controlledRole(rodIds: readonly number[], locale = "da") {
  const label = rodIds.length === 4 ? "Alle fire stænger"
    : rodIds.includes(0) && rodIds.includes(1) ? "Forsvar · målmand og forsvar"
    : rodIds.includes(2) && rodIds.includes(3) ? "Angreb · midtbane og angreb"
    : rodIds.length ? `${rodIds.length} stænger` : "Vælg et hold";
  return translateGameText(label, locale);
}
export function matchModeLabel(settings: MatchSettings, locale = "da") {
  const controls = resolveTeamControls(settings);
  const label = controls.red.computer === "full" && controls.blue.computer === "full" ? "Computer mod computer"
    : controls.red.computer === "off" && controls.blue.computer === "off" ? `${settings.playerCount} telefoner`
    : controls.red.computer === "off" && controls.blue.computer === "full" ? `${settings.playerCount} ${settings.playerCount === 1 ? "telefon" : "telefoner"} mod computer · ${computerLevels[controls.blue.level]}`
    : `${settings.playerCount} ${settings.playerCount === 1 ? "telefon" : "telefoner"} · delt med computer`;
  return translateGameText(label, locale);
}
