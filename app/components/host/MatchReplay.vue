<script setup lang="ts">
import type { ReplayState, Team } from "../../../shared/types";
const { t } = useI18n();

const props = defineProps<{
  recording: {
    duration: number;
    goals: readonly { index: number; time: number; team: Team; scores: Record<Team, number>; start: number; end: number }[];
  };
  replay: ReplayState;
}>();
const emit = defineEmits<{
  playing: [playing: boolean];
  seek: [time: number];
  highlight: [index: number];
  mode: [mode: "highlights" | "full"];
  close: [];
}>();
const time = computed(() => props.replay.time ?? 0);
const duration = computed(() => props.recording.duration);
function clock(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function percent(seconds: number) {
  return `${Math.max(0, Math.min(100, seconds / Math.max(0.001, duration.value) * 100))}%`;
}
function seek(event: Event) { emit("seek", Number((event.target as HTMLInputElement).value)); }
function mode(event: Event) { emit("mode", (event.target as HTMLInputElement).checked ? "highlights" : "full"); }
</script>

<template>
  <section class="host-replay-controls" :aria-label="t('controller.replayControls')">
    <div class="replay-controls-row">
      <UButton :icon="replay.playing ? 'i-lucide-pause' : 'i-lucide-play'" color="neutral" variant="soft"
        :aria-label="t(replay.playing ? 'controller.pauseReplay' : 'controller.playReplay')" @click="emit('playing', !replay.playing)" />
      <span class="replay-clock">{{ clock(time) }} <span>/ {{ clock(duration) }}</span></span>
      <label class="replay-auto"><input type="checkbox" :checked="replay.mode === 'highlights'" @change="mode" /> {{ t('controller.skipGoals') }}</label>
      <slot name="download" />
      <UButton color="neutral" variant="ghost" class="replay-close" @click="emit('close')">{{ t('controller.showResult') }}</UButton>
    </div>
    <div class="replay-timeline">
      <div class="replay-segments" aria-hidden="true">
        <span v-for="goal in recording.goals" :key="goal.index" :class="goal.team"
          :style="{ left: percent(goal.start), width: percent(goal.end - goal.start) }" />
      </div>
      <input type="range" min="0" :max="duration" step="0.05" :value="time" :disabled="duration <= 0"
        :aria-label="t('controller.replayTime')" :aria-valuetext="t('controller.timeOf', { current: clock(time), duration: clock(duration) })" @input="seek" />
      <div class="replay-markers">
        <button v-for="goal in recording.goals" :key="goal.index" type="button" :class="goal.team"
          :style="{ left: percent(goal.time) }"
          :aria-label="t('controller.goalMarker', { index: goal.index, time: clock(goal.time), score: `${goal.scores.red}–${goal.scores.blue}` })"
          :title="t('controller.goalMarkerTitle', { index: goal.index, time: clock(goal.time), score: `${goal.scores.red}–${goal.scores.blue}` })"
          @click="emit('highlight', goal.index)">{{ goal.index }}</button>
      </div>
    </div>
    <p>{{ t('controller.timelineHelp') }}</p>
  </section>
</template>

<style scoped>
.host-replay-controls { position: absolute; z-index: 5; inset: auto 24px 18px; max-width: 900px; margin-inline: auto; padding: 12px 16px; color: #eef3e7; border: 1px solid #d2f35c40; border-radius: 10px; background: #121d12f2; box-shadow: 0 8px 30px #0004; }
.replay-controls-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.replay-clock { font-size: 13px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.replay-clock > span { color: #9cae90; }
.replay-auto { display: flex; align-items: center; gap: 7px; margin-left: auto; font-size: 12px; cursor: pointer; }
.replay-auto input { accent-color: var(--nf-accent); width: 16px; height: 16px; }
.replay-close { font-size: 11px; }
.replay-timeline { position: relative; margin: 12px 10px 0; height: 48px; }
.replay-timeline > input { position: relative; z-index: 2; display: block; width: 100%; height: 22px; margin: 0; cursor: pointer; accent-color: var(--nf-accent); background: transparent; appearance: none; }
.replay-timeline > input::-webkit-slider-runnable-track { height: 5px; border-radius: 4px; background: #ffffff20; }
.replay-timeline > input::-webkit-slider-thumb { appearance: none; width: 15px; height: 15px; margin-top: -5px; border: 2px solid #121d12; border-radius: 50%; background: var(--nf-accent); box-shadow: 0 0 0 1px var(--nf-accent); }
.replay-timeline > input::-moz-range-track { height: 5px; border-radius: 4px; background: #ffffff20; }
.replay-timeline > input::-moz-range-thumb { width: 12px; height: 12px; border: 2px solid #121d12; border-radius: 50%; background: var(--nf-accent); }
.replay-timeline > input:focus-visible { outline: 2px solid var(--nf-accent); outline-offset: 3px; border-radius: 4px; }
.replay-segments { position: absolute; inset: 8px 0 auto; height: 6px; }
.replay-segments > span { position: absolute; height: 100%; border-radius: 3px; background: #d9473faa; }
.replay-segments > .blue { background: #4383bbcc; }
.replay-markers { position: relative; height: 24px; }
.replay-markers button { position: absolute; top: 0; min-width: 22px; height: 22px; padding: 0 3px; transform: translateX(-50%); border: 1px solid #e77970; border-radius: 5px; color: #fff; background: #69332d; font-size: 10px; font-variant-numeric: tabular-nums; cursor: pointer; }
.replay-markers button.blue { background: #244865; border-color: #78a5ce; }
.replay-markers button:hover { filter: brightness(1.3); }
.replay-markers button:focus-visible { outline: 2px solid var(--nf-accent); outline-offset: 3px; }
.host-replay-controls > p { margin: 5px 0 0; font-size: 10px; line-height: 1.4; color: #9cae90; }
@media (max-width: 760px), (max-height: 600px) {
  .host-replay-controls { inset: auto 10px 10px; padding: 9px 12px; }
  .replay-controls-row { gap: 8px; }
  .replay-auto { font-size: 10px; }
  .replay-close { font-size: 10px; padding-inline: 4px; }
  .replay-clock { font-size: 11px; }
  .host-replay-controls > p { display: none; }
  .replay-timeline { margin-top: 7px; }
}
</style>
