<script setup lang="ts">
import type { MatchSettings, PlayerState } from "../../../shared/types";
const { t, locale } = useI18n();
defineProps<{ settings: MatchSettings; disabled?: boolean; humanCount?: number; players?: PlayerState[] }>();
const emit = defineEmits<{ change: [settings: Partial<MatchSettings>] }>();
</script>
<template>
  <div class="settings-fields">
    <div class="field-row"><label for="goals">{{ t('controller.firstTo') }}</label><select id="goals" :value="settings.goalsToWin" :disabled="disabled" @change="emit('change', { goalsToWin: Number(($event.target as HTMLSelectElement).value) })"><option v-for="count in [3, 5, 10]" :key="count" :value="count">{{ t('controller.goalsOption', { count }) }}</option></select></div>
    <div class="slider-field"><label>{{ t('controller.ballSpeed') }} <span>{{ settings.ballSpeed.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}×</span></label><USlider :aria-label="t('controller.ballSpeed')" :model-value="settings.ballSpeed" :min="0.5" :max="2" :step="0.1" :disabled="disabled" @update:model-value="emit('change', { ballSpeed: Number($event) })" /></div>
  </div>
</template>
