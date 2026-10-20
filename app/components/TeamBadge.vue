<script setup lang="ts">
import type { Team } from "../../shared/types";
defineProps<{ team: Team; size?: string }>();
const { t } = useI18n();
</script>
<template>
  <span class="team-badge" :class="team" :style="{ width: size, height: size }" role="img" :aria-label="t(`core.teams.${team}`)" />
</template>
<style scoped>
.team-badge { display: inline-block; flex: 0 0 auto; width: 24px; height: 24px; border: 2px solid #ffffff50; border-radius: 50%; background: #d9473f; box-shadow: inset 0 -4px 8px #0002; }
.team-badge.blue { background: #4383bb; }
</style>
