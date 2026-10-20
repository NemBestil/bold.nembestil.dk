<script setup lang="ts">
import type { MatchSettings, Team, TeamControl } from "../../../shared/types";
import { resolveTeamControls } from "../../../shared/matchSettings";
import { canSetTeamControl, teamControlPatch } from "../../utils/matchPresentation";
const { t } = useI18n();
const props = defineProps<{ settings: MatchSettings; team: Team; disabled?: boolean; rosterLocked?: boolean; levelLocked?: boolean; humanCount?: number }>();
const emit = defineEmits<{ change: [patch: Partial<MatchSettings>] }>();
const control = computed(() => resolveTeamControls(props.settings)[props.team]);
function change(patch: Partial<TeamControl>) { emit("change", teamControlPatch(props.settings, props.team, patch)); }
</script>
<template>
  <fieldset class="team-control-fields">
    <legend>{{ t(team === 'red' ? 'controller.redTeam' : 'controller.blueTeam') }}</legend>
    <div class="field-row"><label :for="`control-${team}`">{{ t('controller.control') }}</label><select :id="`control-${team}`" :value="control.computer" :disabled="disabled || rosterLocked" @change="change({ computer: ($event.target as HTMLSelectElement).value as TeamControl['computer'] })">
      <option value="off" :disabled="!canSetTeamControl(settings, team, 'off', humanCount ?? 0)">{{ t('controller.humans') }}</option><option value="full" :disabled="!canSetTeamControl(settings, team, 'full', humanCount ?? 0)">{{ t('controller.computerFull') }}</option><option value="defense" :disabled="!canSetTeamControl(settings, team, 'defense', humanCount ?? 0)">{{ t('controller.computerDefense') }}</option><option value="attack" :disabled="!canSetTeamControl(settings, team, 'attack', humanCount ?? 0)">{{ t('controller.computerAttack') }}</option>
    </select></div>
    <div v-if="control.computer !== 'off'" class="field-row"><label :for="`level-${team}`">{{ t('controller.computerLevel') }}</label><select :id="`level-${team}`" :value="control.level" :disabled="disabled || levelLocked" @change="change({ level: ($event.target as HTMLSelectElement).value as TeamControl['level'] })"><option value="beginner">{{ t('controller.levelBeginner') }}</option><option value="normal">{{ t('controller.levelNormal') }}</option><option value="advanced">{{ t('controller.levelAdvanced') }}</option></select></div>
    <p class="settings-note">{{ t(control.computer === 'full' ? 'controller.computerFullHelp' : control.computer === 'defense' ? 'controller.computerDefenseHelp' : control.computer === 'attack' ? 'controller.computerAttackHelp' : 'controller.humanControlHelp') }}</p>
  </fieldset>
</template>
<style scoped>
.team-control-fields { display: grid; gap: 16px; padding: 16px; border: 1px solid #d2f35c22; border-radius: 7px; }
.team-control-fields legend { padding: 0 7px; color: #c7dea9; font-size: 12px; font-weight: 700; }
.team-control-fields select { max-width: 65%; }
</style>
