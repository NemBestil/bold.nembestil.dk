<script setup lang="ts">
import type { ControllerPreferences } from "../../composables/useControllerPreferences";
import type { TouchSample } from "../../composables/useTouchInput";
const { t } = useI18n();
const gameText = useGameText();

const props = defineProps<{
  rodId: number;
  label: string;
  preferences: ControllerPreferences;
  position: number;
  currentPosition?: () => number;
  pixelsPerMeter: number;
  travel: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  input: [input: TouchSample & { rodId: number }];
  active: [rodId: number, active: boolean];
  preview: [input: TouchSample & { rodId: number }];
}>();
const touch = useTouchInput(
  () => props.preferences,
  (input) => {
    emit("active", props.rodId, input.active);
    emit("input", { rodId: props.rodId, ...input });
  },
  () => ({ pixelsPerMeter: props.pixelsPerMeter, travel: props.travel }),
  (input) => emit("preview", { rodId: props.rodId, ...input }),
);
watch(() => props.disabled, (disabled) => {
  if (disabled) touch.release();
});
function down(event: PointerEvent) {
  if (props.disabled) return;
  touch.syncTranslation(props.currentPosition?.() ?? props.position);
  touch.down(event);
}
</script>

<template>
  <div
    class="rod-control table-touch-zone"
    :data-rod-id="rodId"
    :class="{ active: touch.active.value, 'zone-disabled': disabled }"
    :aria-label="t('controller.touchInstructions', { label: gameText(label) })"
    role="group"
    @pointerdown="down"
    @pointermove="touch.move"
    @pointerup="touch.release"
    @pointercancel="touch.release"
    @lostpointercapture="touch.release"
  >
    <span class="touch-zone-label"><small>0{{ rodId + 1 }}</small>{{ gameText(label) }}<i>↕ ↔</i></span>
  </div>
</template>

<style scoped>
.table-touch-zone {
  position: absolute;
  top: 0;
  bottom: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  overflow: visible;
  box-shadow: none;
}
.table-touch-zone + .table-touch-zone {
  border-left: 1px dashed #d2f35c18;
}
.table-touch-zone.active {
  background: #d2f35c0b;
  box-shadow: inset 0 -2px #d2f35c;
}
.touch-zone-label {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  color: #dce8cd;
  font-size: 9px;
  white-space: nowrap;
  font-weight: 600;
}
.touch-zone-label small { color: #b8d18c; font-size: 8px; }
.touch-zone-label i { color: #7d936c; font-style: normal; font-size: 9px; }
.active .touch-zone-label { color: #e1fb9d; }
@media (max-width: 520px) {
  .touch-zone-label { gap: 3px; font-size: 8px; }
  .touch-zone-label i, .touch-zone-label small { display: none; }
}
</style>
