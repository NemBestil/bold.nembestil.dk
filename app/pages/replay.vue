<script setup lang="ts">
import type { GameEngine } from "../../game/GameEngine";
import type { ReplayFileData } from "../../shared/replayFile";
import type { MatchSnapshot } from "../../shared/types";

const { t, locale } = useI18n();
const gameText = useGameText();
const teamName = useTeamName();
useSeoMeta({ title: () => t("ui.seo.replayTitle"), robots: "noindex, follow" });
const canvas = ref<HTMLElement>();
const picker = ref<HTMLInputElement>();
const engine = shallowRef<GameEngine>();
const file = shallowRef<ReplayFileData>();
const match = shallowRef<MatchSnapshot>();
const loading = ref(false);
const error = ref("");
const muted = ref(true);
const recording = computed(() => { void match.value; return engine.value?.matchRecording; });
const scores = computed(() => match.value?.replay?.scores ?? match.value?.scores ?? { red: 0, blue: 0 });
let disposed = false;

async function openFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const selected = input.files?.[0];
  input.value = "";
  if (!selected || loading.value) return;
  loading.value = true;
  error.value = "";
  try {
    const { decodeReplayFile } = await import("../../shared/replayFile");
    const data = await decodeReplayFile(selected);
    if (disposed) return;
    const result = data.recording.goals.at(-1);
    if (!result || result.scores[result.team] !== data.settings.goalsToWin)
      throw new Error("Filen indeholder ikke en færdig kamp.");
    if (!engine.value) {
      const { GameEngine: Engine } = await import("../../game/GameEngine");
      const view = await Engine.create(canvas.value!, snapshot => { match.value = snapshot; });
      if (disposed) { view.dispose(); return; }
      engine.value = view;
      view.setTeamNameFormatter(teamName, locale.value);
    }
    file.value = data;
    engine.value.setMuted(muted.value);
    engine.value.loadMatchReplay(data);
  } catch (reason) {
    if (!disposed) error.value = reason instanceof Error ? reason.message : "Replayet kunne ikke åbnes. Vælg en replayfil fra Nem Bold.";
  } finally { if (!disposed) loading.value = false; }
}
function toggleAudio() {
  muted.value = !muted.value;
  engine.value?.setMuted(muted.value);
  if (!muted.value) void engine.value?.unlockAudio();
}
function start(mode: "full" | "highlights") {
  if (!muted.value) void engine.value?.unlockAudio();
  engine.value?.startMatchReplay(mode);
}
watch(locale, () => engine.value?.setTeamNameFormatter(teamName, locale.value));
onBeforeUnmount(() => { disposed = true; engine.value?.dispose(); });
</script>

<template>
  <main class="host-page in-match replay-file-page">
    <header class="site-header">
      <BrandLogo />
      <div class="header-actions">
        <LanguageSwitcher />
        <UButton v-if="file" :icon="muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" color="neutral" variant="ghost"
         :aria-label="t(muted ? 'ui.common.unmute' : 'ui.common.mute')" @click="toggleAudio" />
        <NuxtLink to="/">{{ t('ui.common.toGame') }} ↗</NuxtLink>
      </div>
    </header>
    <div v-if="error" class="error-banner" role="alert">{{ gameText(error) }}</div>
    <section class="host-main">
      <div class="game-stage">
        <div ref="canvas" class="game-canvas" :aria-label="t('ui.replay.canvas')" />
        <div v-if="!file" class="replay-file-intro">
          <span class="eyebrow">{{ t('ui.replay.eyebrow') }}</span>
          <h1>{{ t('ui.replay.title') }}</h1>
          <p>{{ t('ui.replay.description') }}</p>
          <UButton size="xl" icon="i-lucide-folder-open" :loading="loading" @click="picker?.click()">{{ t('ui.replay.choose') }}</UButton>
          <p class="replay-file-privacy">{{ t('ui.replay.privacy') }}</p>
        </div>
        <template v-else-if="match">
          <div v-if="match.phase === 'finished'" class="match-overlay">
            <span class="eyebrow">{{ t('ui.replay.finished') }}</span>
            <TeamBadge v-if="match.winner" :team="match.winner" size="88px" />
            <h2>{{ match.winner ? teamName(match.winner, file.teams[match.winner].name) : t('ui.common.finished') }}</h2>
            <div class="final-score">{{ match.scores.red }}<span>:</span>{{ match.scores.blue }}</div>
            <div class="replay-file-actions">
              <UButton icon="i-lucide-play" @click="start('full')">{{ t('ui.common.wholeMatch') }}</UButton>
              <UButton color="neutral" variant="outline" @click="start('highlights')">{{ t('ui.common.allGoals') }}</UButton>
            </div>
          </div>
          <div v-else-if="match.replay" class="replay-file-score" :aria-label="t('ui.replay.historicalScore')">
            <span>{{ t(match.replay.summary ? 'ui.replay.highlights' : 'ui.replay.match') }}<span v-if="match.replay.goalCount"> · {{ t('ui.replay.goalNumber', { index: match.replay.goalIndex || 1, count: match.replay.goalCount }) }}</span></span>
            <div><span>{{ teamName('red', file.teams.red.name) }}</span><strong>{{ scores.red }} : {{ scores.blue }}</strong><span>{{ teamName('blue', file.teams.blue.name) }}</span></div>
          </div>
          <div v-if="match.phase === 'replay' && match.replay?.goalTeam" class="match-overlay">
            <GoalAnnouncement :team="match.replay.goalTeam" :club="file.teams[match.replay.goalTeam]" />
          </div>
          <HostMatchReplay v-if="match.replay && recording" :recording="recording" :replay="match.replay"
            @playing="engine?.setMatchReplayPlaying($event)" @seek="engine?.seekMatchReplay($event)" @highlight="engine?.seekMatchReplayHighlight($event)"
            @mode="engine?.setMatchReplayMode($event)" @close="engine?.stopMatchReplay()" />
        </template>
      </div>
    </section>
    <footer class="site-footer">
      <span>{{ t('ui.replay.footer') }}</span>
      <UButton v-if="file" color="neutral" variant="link" icon="i-lucide-folder-open" :loading="loading" @click="picker?.click()">{{ t('ui.replay.another') }}</UButton>
      <NuxtLink to="/about">{{ t('ui.common.about') }} ↗</NuxtLink>
    </footer>
    <input ref="picker" class="replay-file-picker" type="file" accept=".nembold,.json,.gz,application/gzip,application/json" :aria-label="t('ui.replay.picker')" @change="openFile" />
  </main>
</template>

<style scoped>
.replay-file-page { height: 100dvh; min-height: 0; }
.replay-file-page .host-main { flex: 1 1 0; min-height: 0; grid-template-columns: minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); }
.replay-file-page .game-stage { min-height: 0; }
.replay-file-page .header-actions a { font-size: 12px; color: #aebda2; }
.replay-file-intro { position: absolute; inset: 0; z-index: 2; display: flex; flex-direction: column; justify-content: center; align-items: center; gap: 22px; padding: 24px; text-align: center; }
.replay-file-intro h1 { font-size: clamp(32px, 5vw, 60px); font-weight: 750; letter-spacing: -1px; }
.replay-file-intro p { max-width: 420px; font-size: 14px; color: #aebda2; line-height: 1.7; }
.replay-file-intro .replay-file-privacy { font-size: 11px; }
.replay-file-actions { display: flex; flex-wrap: wrap; gap: 12px; justify-content: center; }
.replay-file-picker { display: none; }
.replay-file-score { position: absolute; top: 18px; left: 50%; transform: translateX(-50%); z-index: 4; width: min(580px, calc(100% - 30px)); padding: 12px 18px; border: 1px solid #d2f35c40; border-radius: 8px; background: #121d12eb; }
.replay-file-score > span { display: block; color: #d2f35c; font-size: 11px; text-align: center; letter-spacing: .6px; }
.replay-file-score > div { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 10px; }
.replay-file-score > div > span { flex: 1; min-width: 0; font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.replay-file-score > div > span:last-child { text-align: right; }
.replay-file-score strong { font-size: 25px; white-space: nowrap; font-variant-numeric: tabular-nums; }
@media (max-width: 760px), (max-height: 600px) {
  .replay-file-page .site-header { height: 60px; padding-inline: 16px; }
  .replay-file-page .host-main { padding: 8px; }
  .replay-file-page .site-footer { min-height: 40px; padding: 6px 16px; }
  .replay-file-page .site-footer > span { display: none; }
}
</style>
