import type { FootballClub, Team } from "./types";

export const TEAM_NAME_MAX_LENGTH = 25;
export const DEFAULT_TEAM_NAMES: Readonly<Record<Team, string>> = {
  red: "Rød",
  blue: "Blå",
};

export function normalizeTeamName(name: string): string {
  return name.trim().normalize("NFC");
}

/** Empty names restore the side's default; names are counted as Unicode codepoints. */
export function isTeamName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const name = normalizeTeamName(value);
  return [...name].length <= TEAM_NAME_MAX_LENGTH && !/[\u0000-\u001f\u007f-\u009f]/u.test(name);
}

export function getTeamIdentity(team: Team, name = ""): FootballClub {
  return {
    id: team,
    name: (isTeamName(name) && normalizeTeamName(name)) || DEFAULT_TEAM_NAMES[team],
    country: "",
    primaryColor: team === "red" ? "#d9473f" : "#4383bb",
    secondaryColor: team === "red" ? "#f1e9d7" : "#e6ddc6",
  };
}

export function getTeamIdentities(names: Partial<Record<Team, string>> = {}): Record<Team, FootballClub> {
  return { red: getTeamIdentity("red", names.red), blue: getTeamIdentity("blue", names.blue) };
}
