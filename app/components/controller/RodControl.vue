<script setup lang="ts">
import type { ControllerPreferences } from "../../composables/useControllerPreferences";
const { t } = useI18n();
const gameText = useGameText();
const props = defineProps<{
  rodId: number;
  label: string;
  count: number;
  preferences: ControllerPreferences;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  input: [
    input: {
      rodId: number;
      translation: number;
      angularVelocity: number;
      active: boolean;
    },
  ];
}>();
const touch = useTouchInput(
  () => props.preferences,
  (input) => emit("input", { rodId: props.rodId, ...input }),
);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) touch.release();
  },
);
</script>
<template>
  <div
    class="rod-control"
    :class="{ active: touch.active.value, disabled }"
    :aria-label="t('controller.touchInstructions', { label: gameText(label) })"
    role="group"
    @pointerdown="!disabled && touch.down($event)"
    @pointermove="touch.move"
    @pointerup="touch.release"
    @pointercancel="touch.release"
    @lostpointercapture="touch.release"
  >
    <span class="rod-number">0{{ rodId + 1 }}</span
    ><span class="rod-direction top">↕</span>
    <div
      class="rod-visual"
      :style="{ transform: `translateY(${touch.translation.value * 32}px)` }"
    >
      <span class="rod-shaft" /><span
        v-for="n in count"
        :key="n"
        class="mini-player"
        :style="{
          top: `${20 + (n * 58) / (count + 1)}%`,
          transform: `translate(-50%, -50%) rotate(${touch.angularVelocity.value * 2}deg)`,
        }"
      />
    </div>
    <span class="rod-direction bottom">↔</span>
    <div class="rod-label">
      <strong>{{ gameText(label) }}</strong
      ><span>{{ t(count === 1 ? 'controller.onePlayer' : 'controller.manyPlayers', { count }) }}</span>
    </div>
  </div>
</template>
