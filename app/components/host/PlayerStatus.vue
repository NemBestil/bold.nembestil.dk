<script setup lang="ts">
import type { MatchSettings, PlayerState, Team, TeamControl } from "../../../shared/types";
import { teamControlLabel } from "../../utils/matchPresentation";
const { t, locale } = useI18n();
const teamName = useTeamName();
const props = defineProps<{ team: Team; player?: PlayerState; players?: PlayerState[]; computerLevel?: MatchSettings["computerOpponent"]; control?: TeamControl; configurable?: boolean }>();
const emit = defineEmits<{ configure: [team: Team] }>();
const members = computed(() => props.players ?? (props.player ? [props.player] : []));
const allReady = computed(() => members.value.length > 0 && members.value.every((p) => p.ready && p.connected));
const sideLabel = computed(() => t(props.team === "red" ? "controller.redTeam" : "controller.blueTeam"));
function levelLabel(level: MatchSettings["computerOpponent"] | undefined) {
  return t(level === "beginner" ? "controller.levelBeginner" : level === "normal" ? "controller.levelNormal" : level === "advanced" ? "controller.levelAdvanced" : "controller.computer");
}
function memberRole(member: PlayerState) {
  return t(member.rodIds.length === 4 ? "controller.allRods" : member.rodIds.includes(0) ? "controller.defense" : "controller.attack");
}
function memberStatus(member: PlayerState) {
  return t(!member.connected ? "controller.disconnected" : member.ready ? "controller.ready" : "controller.choosing");
}
const summary = computed(() => {
  const member = members.value[0];
  if (!member) return t("controller.scanToJoin");
  if (member.computer) return t("controller.computerSummary", { level: levelLabel(props.computerLevel), team: sideLabel.value });
  if (members.value.length > 1) return t("controller.sharedPhones", { count: members.value.length });
  return `${memberRole(member)} · ${memberStatus(member)}`;
});
const readiness = computed(() => !members.value.length ? t("controller.emptySeat") : members.value.every(member => member.computer) ? t("controller.computerUpper") : t("controller.readyCount", {
  ready: members.value.filter(member => !member.computer && member.ready && member.connected).length,
  total: members.value.filter(member => !member.computer).length,
  cpu: members.value.some(member => member.computer) ? " · CPU" : "",
}));
</script>
<template>
  <div class="player-status" :class="[team, { 'is-ready': allReady, 'configurable-team': configurable }]"
    :role="configurable ? 'button' : undefined" :tabindex="configurable ? 0 : undefined"
    :aria-label="configurable ? t('controller.configureTeam', { team: teamName(team) }) : undefined"
    :title="configurable && control ? t('controller.clickConfigure', { control: teamControlLabel(control, locale) }) : undefined"
    @click="configurable && emit('configure', team)" @keydown.enter.prevent="configurable && emit('configure', team)" @keydown.space.prevent="configurable && emit('configure', team)">
    <div class="player-status-top">
      <span class="team-label"><i />{{ sideLabel.toLocaleUpperCase(locale) }} <span v-if="configurable">↗</span></span>
      <span class="tiny-label">{{ readiness }}</span>
    </div>
    <div class="player-status-content">
      <TeamBadge :team="team" size="30px" />
      <div><strong>{{ teamName(team) }}</strong><p>{{ summary }}</p></div>
    </div>
    <div v-if="members.length > 1" class="team-members">
      <div v-for="(member, index) in members" :key="member.id" :class="{ ready: member.ready && member.connected }">
        <span>{{ member.computer ? 'CPU' : index + 1 }} · {{ memberRole(member) }}</span>
        <strong>{{ member.computer ? levelLabel(computerLevel) : memberStatus(member) }}</strong>
      </div>
    </div>
  </div>
</template>

<style scoped>
.team-members { margin-top: 7px; display: grid; gap: 4px; }
.team-members > div { display: flex; align-items: center; justify-content: space-between; gap: 5px; color: #91a280; font-size: 8px; line-height: 1.35; }
.team-members strong { font-size: 7px; color: #8b997c; }
.team-members .ready strong { color: #d2f35c; }
.configurable-team { cursor: pointer; }
.configurable-team:hover { border-color: #d2f35c55; }
.configurable-team:focus-visible { outline: 2px solid #d2f35c; outline-offset: 2px; }
</style>
