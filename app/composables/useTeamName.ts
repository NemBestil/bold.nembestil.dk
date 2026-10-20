import type { Team } from "../../shared/types";
import { DEFAULT_TEAM_NAMES } from "#shared/teamIdentity";

export function useTeamName() {
  const { t } = useI18n();
  return (team: Team, name?: string | null) => !name || name === DEFAULT_TEAM_NAMES[team] ? t(`core.teams.${team}`) : name;
}
