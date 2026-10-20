<script setup lang="ts">
import type { FootballClub, MatchSettings, SessionState, Team } from "../../shared/types";
import { DEFAULT_SETTINGS, INITIAL_MATCH } from "../../shared/types";
import { SEAT_ROLES, seatOwner } from "../../shared/matchSettings";
import type { GameEngine } from "../../game/GameEngine";
import type { RemoteTable } from "../../game/rendering/RemoteTable";
import type { PeerHost } from "../../network/PeerHost";
import type { PeerController } from "../../network/PeerController";
import { GameAudio } from "../../game/audio/GameAudio";
import { DEFAULT_TEAM_NAMES, getTeamIdentity } from "../../shared/teamIdentity";
import { sessionLink } from "../utils/sessionLink";
import JoinCard from "./JoinCard.vue";
import { createQrImage } from "../utils/qrCode";

const props = defineProps<{ sessionId?: string }>();
const { t, locale } = useI18n();
const gameText = useGameText();
const teamName = useTeamName();
const state = shallowRef<SessionState>({ sessionId: props.sessionId || "", players: [], teamNames: { ...DEFAULT_TEAM_NAMES }, settings: { ...DEFAULT_SETTINGS }, match: structuredClone(INITIAL_MATCH) });
const canvas = ref<HTMLElement>();
const qr = ref("");
const error = ref("");
const copied = ref(false);
const goodGraphics = ref(true);
const graphicsStorageKey = "nemfuss:desktop-good-graphics";
const audioEnabled = ref(false);
const muted = ref(false);
const lobby = computed(() => state.value.match.phase === "lobby");
const match = computed(() => state.value.match);
const phoneCount = computed(() => state.value.players.filter(player => !player.computer && player.team).length);
const recording = computed(() => { void match.value; return engine?.matchRecording ?? null; });
const replayScores = computed(() => match.value.replay?.scores ?? match.value.scores);
const replayGoalTeam = computed(() => match.value.phase === "replay" ? match.value.replay?.goalTeam : undefined);
const announcementTeam = computed(() => match.value.phase === "goal" ? match.value.scoringTeam : replayGoalTeam.value);
const matchReplay = computed(() => !!match.value.replay?.fullMatch);
const joinUrl = computed(() => state.value.sessionId && import.meta.client ? sessionLink(location.origin, useRuntimeConfig().app.baseURL, state.value.sessionId) : "");
const phaseText = computed(() => match.value.phase === "countdown" && match.value.notice
  ? gameText(match.value.notice)
  : t(match.value.phase === "replay" && match.value.replay?.summary ? "ui.desktop.phase.highlights" : `ui.desktop.phase.${match.value.phase}`));
let engine: GameEngine | undefined;
let remote: RemoteTable | undefined;
let host: PeerHost | undefined;
let viewer: PeerController | undefined;
let audio: GameAudio | undefined;
let disposed = false;
let copyTimer: ReturnType<typeof setTimeout> | undefined;
function settings(value: MatchSettings): MatchSettings { return { ...value, graphics: goodGraphics.value ? "normal" : "low" }; }
function applyGraphics() { engine?.updateSettings(settings(state.value.settings)); remote?.settings(settings(state.value.settings)); }
function club(team: Team): FootballClub { return getTeamIdentity(team, state.value.teamNames?.[team]); }
function unlockAudio(event?: PointerEvent) {
  if (event && (event.target as Element | null)?.closest('[data-audio-toggle]')) return;
  if (engine) { audioEnabled.value = true; void engine.unlockAudio(); }
  if (audio && !muted.value) { audioEnabled.value = true; void audio.unlock(); }
}
function toggleAudio() { muted.value = audioEnabled.value ? !muted.value : false; engine?.setMuted(muted.value); audio?.setMuted(muted.value); if (!muted.value) unlockAudio(); }
function logoClick() {
  if (!host) { reloadNuxtApp({ path: "/" }); return; }
  if (match.value.phase === "paused") {
    if (host.leaveMatch()?.ok) reloadNuxtApp({ path: "/" });
  } else if (!["lobby", "finished"].includes(match.value.phase)) host.pauseMatch();
  else reloadNuxtApp({ path: "/" });
}
function startReplay(mode: "highlights" | "full") { unlockAudio(); engine?.startMatchReplay(mode); }
function replayPlaying(playing: boolean) { engine?.setMatchReplayPlaying(playing); }
function replaySeek(time: number) { engine?.seekMatchReplay(time); }
function replayMode(mode: "highlights" | "full") { engine?.setMatchReplayMode(mode); }
function stopReplay() { engine?.stopMatchReplay(); }
async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { error.value = "Fuldskærm er ikke tilgængelig i denne browser."; } }
async function copyLink() { try { await navigator.clipboard.writeText(joinUrl.value); copied.value = true; clearTimeout(copyTimer); copyTimer = setTimeout(() => { copied.value = false; }, 2000); } catch { error.value = "Linket kunne ikke kopieres. Scan QR-koden for at forbinde til bordet."; } }
watch(joinUrl, async (url) => {
  if (!url) return;
  const image = await createQrImage(url);
  if (!disposed && url === joinUrl.value) qr.value = image;
}, { immediate: true });
watch(goodGraphics, value => {
  applyGraphics();
  try { localStorage.setItem(graphicsStorageKey, String(value)); } catch { /* Keep the choice for this visit when storage is unavailable. */ }
}, { flush: "sync" });
watch(() => match.value.replay, (next, before) => {
  if (before?.fullMatch && (!next?.fullMatch || !next.playing || (before.goalTeam && !next.goalTeam))) audio?.stop();
});
watch(() => JSON.stringify(state.value.settings), applyGraphics);
watch(locale, () => { engine?.setTeamNameFormatter(teamName, locale.value); remote?.setTeamNameFormatter(teamName, locale.value); });
onMounted(async () => {
  try {
    const saved = localStorage.getItem(graphicsStorageKey);
    if (saved === "true" || saved === "false") goodGraphics.value = saved === "true";
  } catch { /* Use the default when device storage is unavailable. */ }
  try {
    if (props.sessionId) {
      const [{ RemoteTable: View }, { PeerController: Viewer }] = await Promise.all([import("../../game/rendering/RemoteTable"), import("../../network/PeerController")]);
      if (disposed) return;
      remote = new View(canvas.value!);
      remote.setTeamNameFormatter(teamName, locale.value);
      audio = new GameAudio(useRuntimeConfig().app.baseURL);
      viewer = new Viewer({ sessionId: props.sessionId, role: "spectator",
        onState: (next) => { state.value = next; remote?.update(next); },
        onStatus: (_status, message) => { error.value = message || ""; },
        onFrame: (frame) => remote?.frame(frame), onSound: (sound) => audio?.play(sound) });
      viewer.start();
      applyGraphics();
    } else {
      const [{ GameEngine: Engine }, { PeerHost: Host }] = await Promise.all([import("../../game/GameEngine"), import("../../network/PeerHost")]);
      if (disposed) return;
      engine = await Engine.create(canvas.value!, (snapshot) => { state.value = { ...state.value, match: snapshot }; host?.setMatch(snapshot); }, (frame) => host?.setFrame(frame), (sound) => host?.setSound(sound));
      if (disposed) { engine.dispose(); return; }
      engine.setTeamNameFormatter(teamName, locale.value);
      applyGraphics();
      engine.startLobbyDemo();
      host = new Host({ onState: (next) => { state.value = next; }, onStatus: (_status, message) => { error.value = message || ""; },
        onStart: (value, clubs) => engine?.start(settings(value), clubs), onInput: (team, input) => engine?.input(team, input),
        onBump: () => { engine?.bump(); }, onPause: () => engine?.pause(), onResume: () => engine?.resume(), onReset: () => engine?.reset() });
      host.startLocal();
      host.setMatch(engine.snapshot);
      await host.start();
      if (disposed) host.dispose();
    }
  } catch (reason) { if (!disposed) error.value = reason instanceof Error ? reason.message : "Bordet kunne ikke åbnes."; }
});
onBeforeUnmount(() => { disposed = true; clearTimeout(copyTimer); host?.dispose(); viewer?.dispose(); engine?.dispose(); remote?.dispose(); audio?.dispose(); });
</script>

<template>
  <main class="host-page" :class="{ 'in-match': !lobby }" @pointerdown.capture="unlockAudio">
    <header class="site-header"><BrandLogo interactive :aria-label="sessionId ? t('ui.common.home') : match.phase === 'paused' ? t('ui.desktop.leave') : !['lobby', 'finished'].includes(match.phase) ? t('ui.desktop.pause') : t('ui.common.home')" @click="logoClick" /><div class="header-actions">
      <LanguageSwitcher />
      <label class="desktop-graphics">{{ t(goodGraphics ? 'ui.common.goodGraphics' : 'ui.common.simpleGraphics') }}<input v-model="goodGraphics" role="switch" :aria-label="t('ui.desktop.graphicsLabel')" type="checkbox" /></label>
      <UButton data-audio-toggle :icon="!audioEnabled || muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" color="neutral" variant="ghost" :aria-label="!audioEnabled ? t('ui.common.enableAudio') : muted ? t('ui.common.unmute') : t('ui.common.mute')" @click="toggleAudio" />
      <UButton icon="i-lucide-maximize" color="neutral" variant="ghost" :aria-label="t('ui.common.fullscreen')" @click="fullscreen" />
    </div></header>
    <div v-if="error" class="error-banner" role="alert">{{ gameText(error) }}</div>
    <section class="host-main">
      <div class="game-stage">
        <div v-if="lobby" class="stage-heading"><div class="eyebrow"><span class="live-dot" /> {{ t('ui.desktop.welcome') }}</div><h1>{{ t('ui.desktop.headline1') }}<br />{{ t('ui.desktop.headline2') }} <em>{{ t('ui.desktop.headline3') }}</em></h1><p>{{ t('ui.desktop.tagline') }}</p></div>
        <div ref="canvas" class="game-canvas" :aria-label="t('ui.desktop.canvas')" />
        <div v-if="lobby" class="stage-bottom"><span><UIcon name="i-lucide-smartphone" /> {{ t('ui.desktop.phoneHandle') }}</span></div>
        <div v-if="!lobby && (!['playing', 'serving', 'replay'].includes(match.phase) || replayGoalTeam)" class="match-overlay" aria-live="polite">
          <template v-if="match.phase === 'countdown'"><div class="eyebrow">{{ phaseText }}</div><span class="countdown-number">{{ Math.max(1, match.countdown) }}</span></template>
          <GoalAnnouncement v-else-if="announcementTeam" :team="announcementTeam" :club="club(announcementTeam)" />
          <template v-else-if="match.phase === 'finished'">
            <TeamBadge v-if="match.winner" :team="match.winner" size="88px" /><h2>{{ match.winner ? teamName(match.winner, club(match.winner).name) : t('ui.common.finished') }}</h2>
            <div class="final-score">{{ match.scores.red }}<span>:</span>{{ match.scores.blue }}</div>
            <div v-if="!sessionId && recording?.goals.length" class="result-replay-actions">
              <UButton icon="i-lucide-play" @click="startReplay('full')">{{ t('ui.common.wholeMatch') }}</UButton>
              <UButton color="neutral" variant="outline" @click="startReplay('highlights')">{{ t('ui.common.allGoals') }}</UButton>
              <HostReplayDownload v-if="engine" :engine="engine" />
            </div>
            <p>{{ t('ui.desktop.continueOnPhones') }}</p>
          </template>
          <template v-else><h2>{{ phaseText }}</h2><p>{{ gameText(match.notice) }}</p></template>
        </div>
        <div v-if="match.phase === 'replay' || (match.phase === 'paused' && match.replay)" class="replay-banner host-replay-banner">
          <div class="host-replay-title"><strong>{{ t(match.replay?.summary ? 'ui.replay.highlights' : matchReplay ? 'ui.replay.match' : 'ui.replay.goalReplay') }}</strong><span v-if="match.replay?.goalCount" class="host-replay-goal">{{ t('ui.replay.goalNumber', { index: match.replay.goalIndex || 1, count: match.replay.goalCount }) }}</span><span v-else>{{ t(match.replay?.slowMotion ? 'ui.replay.slowMotion' : 'ui.replay.lastTouches') }}</span></div>
          <div class="host-replay-score" :aria-label="t('ui.replay.historicalScore')">
            <span class="replay-team red"><TeamBadge team="red" size="24px" /><span>{{ teamName('red', club('red').name) }}</span></span>
            <strong>{{ replayScores.red }} <i>:</i> {{ replayScores.blue }}</strong>
            <span class="replay-team blue"><span>{{ teamName('blue', club('blue').name) }}</span><TeamBadge team="blue" size="24px" /></span>
          </div>
          <div v-if="!matchReplay" class="replay-progress"><i :style="{ transform: `scaleX(${match.replay?.progress || 0})` }" /></div>
        </div>
        <HostMatchReplay v-if="!sessionId && matchReplay && match.replay && recording" :recording="recording" :replay="match.replay"
          @playing="replayPlaying" @seek="replaySeek" @highlight="engine?.seekMatchReplayHighlight($event)" @mode="replayMode" @close="stopReplay">
          <template #download><HostReplayDownload v-if="engine" :engine="engine" compact /></template>
        </HostMatchReplay>
        <div v-if="!lobby && !matchReplay" class="match-status"><span class="live-dot" />{{ phaseText }}</div>
      </div>
      <aside v-if="lobby" class="lobby-panel">
        <JoinCard :join-url="joinUrl" :qr="qr" :copied="copied" @copy="copyLink" />
        <div class="lobby-heading"><span>{{ t('ui.desktop.lineup') }}</span><span>{{ t(phoneCount === 1 ? 'ui.desktop.phone' : 'ui.desktop.phones', { count: phoneCount }) }}</span></div>
        <div class="desktop-team-list"><section v-for="team in ['red', 'blue'] as const" :key="team" :class="team"><h3><TeamBadge :team="team" size="24px" />{{ teamName(team, club(team).name) }}</h3><p v-for="role in SEAT_ROLES" :key="role"><span>{{ t(role === 'defense' ? 'ui.desktop.defense' : 'ui.desktop.attack') }}</span><strong>{{ t(seatOwner(state.players, team, role) ? 'ui.desktop.player' : 'ui.desktop.availableComputer') }}</strong></p></section></div>
        <section class="getting-started" aria-labelledby="getting-started-title">
          <h2 id="getting-started-title">{{ t('ui.start.title') }}</h2>
          <div class="getting-started-scroll" tabindex="0" role="region" :aria-label="t('ui.start.instructions')">
            <ul>
              <li>{{ t('ui.start.step1') }}</li>
              <li>{{ t('ui.start.step2') }}</li>
              <li>{{ t('ui.start.step3') }}</li>
            </ul>
            <UButton to="/about" color="neutral" variant="outline" trailing-icon="i-lucide-arrow-up-right" class="getting-started-link">{{ t('ui.common.readMore') }}</UButton>
          </div>
        </section>
      </aside>
    </section>
    <footer class="site-footer"><span>{{ t('ui.desktop.footer') }}</span><div class="desktop-footer-links"><NuxtLink v-if="!sessionId" to="/replay" target="_blank" rel="noopener" :title="t('ui.desktop.openReplayTab')">{{ t('ui.common.replay') }}</NuxtLink><NuxtLink to="/about">{{ t('ui.common.about') }} ↗</NuxtLink></div></footer>
  </main>
</template>
<style scoped>
.desktop-footer-links { margin-left: auto; display: flex; align-items: center; gap: 30px; }
.desktop-graphics { display: flex; align-items: center; gap: 8px; color: #a5b595; font-size: 10px; white-space: nowrap; cursor: pointer; }
.desktop-graphics input { appearance: none; width: 30px; height: 18px; margin: 0; border: 1px solid #a5b59566; border-radius: 999px; background: #283025; cursor: pointer; transition: background .15s; }
.desktop-graphics input::before { content: ""; display: block; width: 12px; height: 12px; margin: 2px; border-radius: 50%; background: #a5b595; transition: transform .15s; }
.desktop-graphics input:checked { background: #d2f35c; border-color: #d2f35c; }
.desktop-graphics input:checked::before { background: #182018; transform: translateX(12px); }
.desktop-graphics input:focus-visible { outline: 2px solid #d2f35c; outline-offset: 3px; }
.desktop-team-list { display: grid; grid-column: 1 / -1; grid-template-columns: 1fr 1fr; gap: 10px; }
.desktop-team-list section { padding: 12px; border: 1px solid #d9ecc425; border-radius: 7px; min-width: 0; }
.desktop-team-list h3 { display: flex; align-items: center; gap: 6px; font-size: 11px; margin-bottom: 10px; }
.desktop-team-list p { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; line-height: 1.8; color: #a5b595; }
.desktop-team-list .red { border-top-color: #d9473f; }.desktop-team-list .blue { border-top-color: #4383bb; }
.getting-started { display: flex; flex-direction: column; gap: 12px; grid-column: 1 / -1; min-height: 180px; max-height: 340px; margin-top: 14px; padding: 18px; border: 1px solid var(--nf-line); border-radius: 8px; background: #1b231b; }
.getting-started h2 { flex-shrink: 0; font-size: 16px; font-weight: 700; letter-spacing: -.3px; }
.getting-started-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: #939d8d66 transparent; padding-right: 10px; }
.getting-started-scroll:focus-visible { outline: 2px solid var(--nf-accent); outline-offset: 3px; border-radius: 3px; }
.getting-started ul { list-style: disc; padding-left: 17px; color: #aebda2; font-size: 12px; line-height: 1.65; }
.getting-started li + li { margin-top: 9px; }
.getting-started li::marker { color: var(--nf-accent); }
.getting-started-link { margin-top: 14px; }
.result-replay-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; }
.host-replay-banner { min-width: 340px; max-width: min(600px, calc(100% - 40px)); }
.host-replay-banner .host-replay-title { justify-content: space-between; gap: 18px; }
.host-replay-banner .host-replay-goal { margin: 0; color: var(--nf-accent); font-size: 14px; font-weight: 750; letter-spacing: 0.5px; }
.host-replay-score { display: flex; align-items: center; justify-content: space-between; gap: 15px; margin-top: 12px; }
.host-replay-score .replay-team { display: flex; align-items: center; gap: 7px; min-width: 0; margin: 0; }
.host-replay-score .replay-team > span:last-child, .host-replay-score .replay-team.blue > span:first-child { max-width: 130px; margin: 0; font-size: 11px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.host-replay-score > strong { color: #f1f2e7; font-size: 28px; line-height: 1; white-space: nowrap; font-variant-numeric: tabular-nums; }
.host-replay-score > strong > i { color: #a0ae92; font-style: normal; font-size: 20px; }
@media (max-width: 760px), (max-height: 600px) {
  .host-replay-banner { top: 10px; right: 10px; min-width: min(340px, calc(100% - 20px)); padding: 10px 12px; max-width: calc(100% - 20px); }
  .host-replay-score { gap: 8px; }
  .host-replay-score .replay-team > span:last-child, .host-replay-score .replay-team.blue > span:first-child { max-width: 90px; font-size: 9px; }
}
@media (min-width: 761px) and (min-height: 500px) {
  .host-page .lobby-panel { display: flex; flex-direction: column; gap: 0; }
  .host-page .lobby-panel > :not(.getting-started) { flex-shrink: 0; }
  .getting-started { flex: 1 0 160px; min-height: 160px; max-height: none; }
}
</style>
