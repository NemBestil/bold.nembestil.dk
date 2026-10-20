<script setup lang="ts">
import type { FootballClub, Team } from "../../shared/types";

defineProps<{ club?: FootballClub; team: Team }>();
const { t } = useI18n();
const teamName = useTeamName();
</script>

<template>
  <div class="goal-announcement">
    <span class="eyebrow">{{ t('ui.goal.title') }}</span>
    <TeamBadge :team="team" size="clamp(48px, 12vmin, 88px)" />
    <h2>{{ teamName(team, club?.name) }}<span>{{ t('ui.goal.scored') }}</span></h2>
  </div>
</template>

<style scoped>
.goal-announcement { display: flex; flex-direction: column; align-items: center; gap: clamp(6px, 1.5vmin, 14px); max-width: 100%; text-align: center; }
.goal-announcement h2 { margin: 0; font-size: clamp(22px, 4.5vmin, 56px); font-weight: 750; letter-spacing: -0.04em; line-height: 1.1; color: #f1f2e9; overflow-wrap: anywhere; }
.goal-announcement h2 span { display: block; margin-top: 5px; font-size: 0.6em; font-weight: 500; letter-spacing: 0; color: var(--nf-accent); }
</style>
