<script setup lang="ts">
import type { FootballClub, SessionState, Team, SeatRole } from "../../shared/types";
import type { ControllerTransport, ControllerTransportCallbacks, ControllerTransportFactory } from "../../network/ControllerTransport";
import { ControllerFrameStream } from "../../network/ControllerFrameStream";
import type { MobileHostScene } from "../../game/rendering/MobileHostScene";
import type { GameEngine } from "../../game/GameEngine";
import { GameAudio } from "../../game/audio/GameAudio";
import { computerAssignments, SEAT_ROLES, SEAT_RODS, seatOwner, seatLevel } from "../../shared/matchSettings";
import { DEFAULT_SETTINGS, INITIAL_MATCH } from "../../shared/types";
import type { TouchSample } from "../composables/useTouchInput";
import { controlledRole } from "../utils/matchPresentation";
import { DEFAULT_TEAM_NAMES, getTeamIdentities, getTeamIdentity, TEAM_NAME_MAX_LENGTH } from "../../shared/teamIdentity";
import JoinCard from "./JoinCard.vue";
import { createQrImage } from "../utils/qrCode";

const { t, locale } = useI18n();
const gameText = useGameText();
const teamName = useTeamName();

const props = defineProps<{ sessionId: string; transportFactory?: ControllerTransportFactory; externalView?: MobileHostScene; hostEngine?: GameEngine; hosting?: boolean; multiplayer?: boolean; joinUrl?: string; invitationError?: string; invitationConnecting?: boolean }>();
const emit = defineEmits<{ exit: []; retryInvitation: [] }>();
const sessionId = computed(() => props.sessionId);
const invitationOpen = ref(false);
const invitationQr = ref("");
const copiedInvitation = ref(false);
let invitationCopyTimer: ReturnType<typeof setTimeout> | undefined;
const muted = ref(!props.hostEngine);
const audioEnabled = ref(false);
const remoteAudio = props.hostEngine ? undefined : new GameAudio(useRuntimeConfig().app.baseURL);
remoteAudio?.setMuted(true);
function unlockAudio() {
  if (props.hostEngine) { audioEnabled.value = true; void props.hostEngine.unlockAudio(); }
  else if (!muted.value) { audioEnabled.value = true; void remoteAudio?.unlock(); }
}
function toggleAudio() {
  setAudio(!audioEnabled.value || muted.value);
}
function setAudio(enabled: boolean) {
  muted.value = !enabled;
  if (props.hostEngine) props.hostEngine.setMuted(muted.value);
  else remoteAudio?.setMuted(muted.value);
  if (!muted.value) unlockAudio();
}
watch(() => props.joinUrl, async (url) => {
  invitationQr.value = "";
  copiedInvitation.value = false;
  if (!url) return;
  const qr = await createQrImage(url);
  if (!disposed && props.joinUrl === url) invitationQr.value = qr;
}, { immediate: true });
async function copyInvitation() {
  if (!props.joinUrl) return;
  try {
    await navigator.clipboard.writeText(props.joinUrl);
    copiedInvitation.value = true;
    clearTimeout(invitationCopyTimer);
    invitationCopyTimer = setTimeout(() => { copiedInvitation.value = false; }, 2000);
  } catch {
    copiedInvitation.value = false;
    error.value = "Linket kunne ikke kopieres. Scan QR-koden for at forbinde til bordet.";
  }
}
function openInvitation() {
  releaseAll();
  if (inGame.value && phase.value !== "paused") controller?.send({ type: "pause", paused: true });
  invitationOpen.value = true;
}
const state = ref<SessionState>({
  sessionId: "",
  players: [],
  teamNames: { ...DEFAULT_TEAM_NAMES },
  settings: { ...DEFAULT_SETTINGS },
  match: { ...INITIAL_MATCH, scores: { red: 0, blue: 0 } },
});
const playerId = ref("");
const status = ref("Forbinder til bordet…");
const error = ref("");
const connected = ref(false);
const leavingForHome = ref(false);
const settingsOpen = ref(false);
const settingsTab = ref<"personal" | "match">("personal");
const player = computed(() =>
  state.value.players.find((p) => p.id === playerId.value),
);
const selectedClub = computed(() => player.value?.team ? getTeamIdentity(player.value.team, state.value.teamNames?.[player.value.team]) : undefined);
const rodIds = computed(() => player.value?.rodIds ?? []);
const teamNameLocked = computed(() => !player.value?.teamCaptain || phase.value !== "lobby");
const teamNameDraft = ref("");
const editingTeamName = ref(false);
function syncTeamName() {
  const team = player.value?.team;
  const name = team ? state.value.teamNames?.[team] : "";
  teamNameDraft.value = team && name !== DEFAULT_TEAM_NAMES[team] ? name || "" : "";
}
watch(() => [player.value?.team, state.value.teamNames?.red, state.value.teamNames?.blue], () => {
  if (!editingTeamName.value) syncTeamName();
});
const role = computed(() => controlledRole(rodIds.value, locale.value));
const automaticRodIds = computed(() => computerAssignments(state.value.settings).filter((assignment) => assignment.team === player.value?.team).flatMap((assignment) => assignment.rodIds));
const humans = computed(() => state.value.players.filter((p) => !p.computer));
const phase = computed(() => state.value.match.phase);
const inGame = computed(() => !["lobby", "finished"].includes(phase.value));
const visibleScores = computed(() => state.value.match.replay?.scores ?? state.value.match.scores);
const recording = computed(() => { void state.value.match; return props.hostEngine?.matchRecording ?? null; });
const hostArchiveReplay = computed(() => !!props.hostEngine && !!state.value.match.replay?.fullMatch);
function startHostReplay(mode: "highlights" | "full") { unlockAudio(); props.hostEngine?.startMatchReplay(mode); }
const frameStream = new ControllerFrameStream();
const roundTripMs = ref(80);
const tableClubs = computed<Record<Team, FootballClub> | undefined>(() => {
  if (!inGame.value) return undefined;
  return getTeamIdentities({
    red: teamName("red", state.value.teamNames.red),
    blue: teamName("blue", state.value.teamNames.blue),
  });
});
const preferences = useControllerPreferences();
watch(() => preferences.value.goodGraphics, (enabled) => props.externalView?.setGoodGraphics(enabled), { immediate: true });
const fullscreen = useControllerFullscreen(
  () => connected.value && (!!player.value?.ready || inGame.value),
);
let controller: ControllerTransport | undefined;
let sequence = 0;
let disposed = false;
const heldRodIds = new Set<number>();
function sendInput(input: TouchSample & { rodId: number }) {
  if (!rodIds.value.includes(input.rodId)) return;
  if ((input.active || input.flick) && (phase.value !== "playing" || !connected.value || settingsOpen.value)) return;
  if (input.active) heldRodIds.add(input.rodId);
  else heldRodIds.delete(input.rodId);
  // PeerController owns the single rate limit; releases and final flicks bypass its queue.
  controller?.send({ type: "rod-input", sequence: ++sequence, ...input });
}
function releaseAll() {
  const releaseIds = new Set([...rodIds.value, ...heldRodIds]);
  heldRodIds.clear();
  for (const rodId of releaseIds)
    controller?.send({
      type: "rod-input",
      rodId,
      sequence: ++sequence,
      translation: 0,
      angularVelocity: 0,
      active: false,
    });
}
function bump() {
  if (state.value.match.bumpAvailable && connected.value)
    controller?.send({ type: "table-bump", sequence: ++sequence });
}
function reserveSeat(team: Team, role: SeatRole) {
  const owner = seatOwner(state.value.players, team, role);
  if (owner && owner.id !== playerId.value) return;
  error.value = "";
  controller?.send({ type: "reserve-seat", team, role });
}
function editTeamName(event: Event) {
  const input = event.target as HTMLInputElement;
  teamNameDraft.value = Array.from(input.value.normalize("NFC")).slice(0, TEAM_NAME_MAX_LENGTH).join("");
  input.value = teamNameDraft.value;
}
function saveTeamName() {
  editingTeamName.value = false;
  if (!teamNameLocked.value) { error.value = ""; controller?.send({ type: "team-name", name: teamNameDraft.value }); }
}
function computerLevel(team: Team, role: SeatRole, event: Event) {
  controller?.send({ type: "set-computer-level", team, role, level: (event.target as HTMLSelectElement).value as "beginner" | "normal" | "advanced" });
}
function startMatch() {
  saveTeamName();
  unlockAudio();
  void fullscreen.enterFromGesture();
  controller?.send({ type: "start-match" });
}
const allSeated = computed(() => humans.value.every((person) => person.connected && person.team && person.rodIds.length));
function openSettings() {
  releaseAll();
  settingsOpen.value = true;
  if (inGame.value && phase.value !== "paused")
    controller?.send({ type: "pause", paused: true });
}
function pause() {
  releaseAll();
  if (phase.value === "paused") void fullscreen.enterFromGesture();
  controller?.send({ type: "pause", paused: phase.value !== "paused" });
}
function resumeMatch() {
  void fullscreen.enterFromGesture();
  controller?.send({ type: "pause", paused: false });
}
function rematch() {
  void fullscreen.enterFromGesture();
  controller?.send({ type: "rematch" });
}
function leaveMatch() {
  releaseAll();
  controller?.send({ type: "leave-match" });
}
function returnHome() {
  if (props.hosting) emit("exit");
  else reloadNuxtApp({ path: "/" });
}
function logoClick(event: MouseEvent) {
  event.preventDefault();
  if (leavingForHome.value) return;
  if (phase.value === "paused") {
    if (!connected.value) return;
    leavingForHome.value = true;
    leaveMatch();
  } else if (inGame.value) {
    releaseAll();
    controller?.send({ type: "pause", paused: true });
  } else returnHome();
}
function keepFullscreenOnTouch(event: PointerEvent) {
  if (!(event.target as Element | null)?.closest('[data-audio-toggle]')) unlockAudio();
  // Gameplay touches can restore fullscreen after the OS leaves it.
  if (
    inGame.value &&
    fullscreen.desired.value &&
    (event.target as Element | null)?.closest(".rod-control")
  )
    void fullscreen.enterFromGesture();
}
function visibility() {
  if (document.hidden) releaseAll();
}

onMounted(async () => {
  if (!sessionId.value || sessionId.value.length > 128) {
    error.value =
      "Forbindelseslinket mangler en gyldig session. Scan QR-koden på bordets skærm.";
    return;
  }
  const callbacks: ControllerTransportCallbacks = {
    onState: (next, id) => {
      state.value = next;
      playerId.value = id;
      connected.value = !!next.players.find((p) => p.id === id)?.connected;
      // Wait for the host to broadcast the reset before closing this connection.
      if (leavingForHome.value && next.match.phase === "lobby") {
        leavingForHome.value = false;
        returnHome();
      }
    },
    onFrame: (frame) => {
      frameStream.push(frame);
    },
    onSound: (event) => remoteAudio?.play(event),
    onLatency: (elapsed) => { roundTripMs.value = Math.min(400, Math.max(elapsed, roundTripMs.value * 0.8)); },
    onStatus: (value, message) => {
      status.value = value;
      error.value = message || "";
      if (message || value !== "connected") leavingForHome.value = false;
      connected.value = value === "connected";
      if (!connected.value) frameStream.clear();
    },
  };
  if (props.transportFactory) controller = props.transportFactory(callbacks);
  else {
    const { PeerController: Controller } = await import("../../network/PeerController");
    if (disposed) return;
    controller = new Controller({ ...callbacks, sessionId: sessionId.value });
  }
  controller.start();
  window.addEventListener("blur", releaseAll);
  document.addEventListener("visibilitychange", visibility);
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(invitationCopyTimer);
  releaseAll();
  controller?.dispose();
  frameStream.clear();
  remoteAudio?.dispose();
  window.removeEventListener("blur", releaseAll);
  document.removeEventListener("visibilitychange", visibility);
});
watch(phase, (next, before) => {
  if (next !== before) {
    releaseAll();
    if (next === "countdown") settingsOpen.value = false;
    if (["paused", "lobby"].includes(next)) remoteAudio?.stop();
  }
});
watch(() => rodIds.value.join(","), releaseAll);
watch(() => state.value.match.replay, (next, before) => {
  if (before?.fullMatch && (!next?.fullMatch || !next.playing || (before.goalTeam && !next.goalTeam))) remoteAudio?.stop();
});

</script>

<template>
  <main
    class="controller-page"
    :class="[player?.team || '', { 'controller-playing': inGame }]"
    @pointerdown.capture="keepFullscreenOnTouch"
  >
    <div class="controller-content">
    <header class="controller-header">
      <BrandLogo interactive :aria-label="phase === 'paused' ? t('controller.endAndHome') : inGame ? t('controller.pauseMatch') : t('controller.goHome')" @click="logoClick" />
      <div v-if="inGame" class="controller-club">
        <TeamBadge v-if="player?.team" :team="player.team" size="22px" /><strong>{{
          player?.team ? teamName(player.team, selectedClub?.name) : ""
        }}</strong>
      </div>
      <div v-if="inGame" class="controller-live-score" :aria-label="t('controller.score')">
        <span class="score-red">{{ visibleScores.red }}</span><small>:</small><span class="score-blue">{{ visibleScores.blue }}</span>
      </div>
      <div class="controller-header-actions">
        <LanguageSwitcher />
        <span class="connection-pill"
          ><i :class="{ online: connected }" />{{
            connected ? (hosting ? t('controller.yourTable') : t('controller.connected')) : t('controller.connecting')
          }}</span
        ><UButton
          v-if="inGame"
          :icon="phase === 'paused' ? 'i-lucide-play' : 'i-lucide-pause'"
          color="neutral"
          variant="ghost"
          :aria-label="phase === 'paused' ? t('controller.continue') : t('controller.pause')"
          @click="pause"
        /><UButton
          v-if="hosting && multiplayer && inGame" icon="i-lucide-qr-code" color="neutral" variant="ghost" :aria-label="t('controller.invite')" @click="openInvitation" />
        <UButton data-audio-toggle :icon="!audioEnabled || muted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'" color="neutral" variant="ghost" :aria-label="!audioEnabled ? t('controller.enableSound') : muted ? t('controller.soundOn') : t('controller.soundOff')" @click="toggleAudio" />
        <UButton
          v-if="
            inGame && fullscreen.supported.value && !fullscreen.active.value
          "
          icon="i-lucide-maximize"
          color="neutral"
          variant="ghost"
          :aria-label="t('controller.returnFullscreen')"
          @click="fullscreen.enterFromGesture"
        /><UButton
          icon="i-lucide-settings-2"
          color="neutral"
          variant="ghost"
          :aria-label="t('controller.settings')"
          @click="openSettings"
        />
      </div>
    </header>
    <div v-if="error" class="error-banner" role="alert">
      {{ gameText(error) }}<button :aria-label="t('controller.closeMessage')" @click="error = ''">×</button>
    </div>

    <div v-if="phase === 'finished'" class="controller-result">
      <div class="eyebrow">{{ t('controller.matchFinished') }}</div>
      <TeamBadge v-if="player?.team" :team="player.team" size="88px" />
      <h1>
        {{
          state.match.winner === player?.team
            ? t('controller.victory')
            : t('controller.rematchHope')
        }}
      </h1>
      <div class="final-score">
        {{ state.match.scores.red }}<span>:</span>{{ state.match.scores.blue }}
      </div>
      <template v-if="hostEngine && recording?.goals.length">
        <UButton block size="lg" icon="i-lucide-play" @click="startHostReplay('full')">{{ t('controller.watchFull') }}</UButton>
        <UButton block size="lg" variant="outline" color="neutral" @click="startHostReplay('highlights')">{{ t('controller.watchGoals') }}</UButton>
        <HostReplayDownload :engine="hostEngine" />
      </template>
      <UButton
        block
        size="xl"
        :disabled="player?.rematch || !connected"
        @click="rematch"
        >{{ player?.rematch ? t('controller.waitingOpponent') : t('controller.playAgain')
        }}<UIcon name="i-lucide-rotate-ccw" /></UButton
      ><UButton
        block
        size="lg"
        variant="ghost"
        color="neutral"
        @click="controller?.send({ type: 'new-match' })"
        >{{ t('controller.backStart') }}</UButton
      >
    </div>

    <template v-else-if="inGame"
      ><div class="rotate-hint">
        <UIcon name="i-lucide-smartphone" /><span
          >{{ t('controller.rotatePhone') }}</span
        ><button
          v-if="fullscreen.supported.value"
          @click="fullscreen.enterFromGesture"
        >
          {{ t('controller.fullscreen') }} ↗
        </button>
      </div>
      <ControllerTableView
        :team="player?.team || 'red'"
        :frame-stream="frameStream"
        :match="state.match"
        :goals-to-win="state.settings.goalsToWin"
        :clubs="tableClubs"
        :preferences="preferences"
        :rod-ids="rodIds"
        :external-view="externalView"
        :automatic-rod-ids="automaticRodIds"
        :rotation-damping="state.settings.rotationDamping"
        :round-trip-ms="roundTripMs"
        :disabled="phase !== 'playing' || !connected || settingsOpen"
        @input="sendInput"
      />
      <HostMatchReplay v-if="hostArchiveReplay && state.match.replay && recording" class="phone-match-replay"
        :recording="recording" :replay="state.match.replay"
        @playing="hostEngine?.setMatchReplayPlaying($event)" @seek="hostEngine?.seekMatchReplay($event)" @highlight="hostEngine?.seekMatchReplayHighlight($event)"
        @mode="hostEngine?.setMatchReplayMode($event)" @close="hostEngine?.stopMatchReplay()">
        <template #download><HostReplayDownload v-if="hostEngine" :engine="hostEngine" compact /></template>
      </HostMatchReplay>
      <footer v-else class="controller-bottom">
        <span>↕ {{ t('controller.move') }} <span class="muted">/</span> ↔ {{ t('controller.rotate') }} <span class="opponent-hint">· {{ role }}</span></span
        ><UButton
          :disabled="!state.match.bumpAvailable || !connected"
          :variant="state.match.bumpAvailable ? 'solid' : 'soft'"
          :title="t('controller.bumpHint')"
          size="sm"
          icon="i-lucide-vibrate"
          @click="bump"
          >{{
            state.match.bumpCooldown > 0
              ? t('controller.bumpWait', { seconds: Math.ceil(state.match.bumpCooldown) })
              : t('controller.bump')
          }}</UButton
        >
      </footer>
      <div
        v-if="
          phase === 'paused' ||
          !connected
        "
        class="controller-game-notice"
        aria-live="polite"
      >
        <template v-if="!connected"
          ><UIcon name="i-lucide-wifi-off" />
          <h2>{{ t('controller.reconnecting') }}</h2>
          <p>{{ t('controller.savedScore') }}</p></template
        ><template v-else
          ><span class="eyebrow">{{ t('controller.matchPaused') }}</span>
          <h2>{{ t('controller.breather') }}</h2>
          <p>{{ gameText(state.match.notice) }}</p>
          <UButton size="lg" :disabled="!player?.admin" @click="resumeMatch">{{
            player?.admin ? t('controller.continueMatch') : t('controller.waitingFirst')
          }}</UButton>
          <UButton size="lg" color="neutral" variant="ghost" @click="leaveMatch">{{ t('controller.leaveMatch') }}</UButton>
          <p>{{ t('controller.endsForEveryone') }}</p></template
        >
      </div></template
    >

    <section v-else class="controller-setup" :class="{ 'controller-host-setup': hosting && multiplayer }">
      <JoinCard v-if="hosting && multiplayer" class="controller-join-card" compact retryable
        :join-url="joinUrl" :qr="invitationQr" :copied="copiedInvitation"
        :connecting="invitationConnecting" :error="gameText(invitationError || '')"
        @copy="copyInvitation" @retry="emit('retryInvitation')" />
      <div class="setup-intro">
        <span class="eyebrow">{{ t('controller.yourPlace') }}</span>
        <h1>{{ t('controller.chooseIntroTop') }}<br />{{ t('controller.chooseIntroBottom') }}</h1>
        <p>{{ t('controller.chooseDescription') }}</p>
      </div>
      <div class="setup-section-title">
        <span>01</span>
        <h2>{{ t('controller.chooseTeam') }}</h2>
      </div>
      <div class="seat-selector">
        <section v-for="team in ['red', 'blue'] as const" :key="team" :class="team">
          <h3><span class="team-orb" />{{ teamName(team, state.teamNames?.[team]) }}</h3>
          <div class="seat-pair">
            <div v-for="seat in SEAT_ROLES" :key="seat" class="seat-card">
              <button :aria-pressed="player?.team === team && SEAT_RODS[seat].every(id => rodIds.includes(id))" :class="{ selected: player?.team === team && SEAT_RODS[seat].every(id => rodIds.includes(id)) }"
                :disabled="!connected || (!!seatOwner(state.players, team, seat) && seatOwner(state.players, team, seat)?.id !== playerId)"
                @click="reserveSeat(team, seat)">
                <UIcon :name="seat === 'defense' ? 'i-lucide-shield' : 'i-lucide-zap'" /><strong>{{ seat === 'defense' ? t('controller.defense') : t('controller.attack') }}</strong>
                <small>{{ seatOwner(state.players, team, seat)?.id === playerId ? t('controller.yourSeat') : seatOwner(state.players, team, seat) ? t('controller.occupied') : t('controller.takeSeat') }}</small>
              </button>
              <label v-if="!seatOwner(state.players, team, seat)" class="seat-computer">{{ t('controller.computer') }}
                <select :aria-label="t('controller.computerLevelAria', { team: teamName(team), role: t(`controller.${seat}`) })" :value="seatLevel(state.settings, team, seat)" :disabled="!connected" @change="computerLevel(team, seat, $event)"><option value="beginner">{{ t('controller.easy') }}</option><option value="normal">{{ t('controller.medium') }}</option><option value="advanced">{{ t('controller.hard') }}</option></select>
              </label>
            </div>
          </div>
        </section>
      </div>
      <p class="controller-role" v-if="player?.team">{{ t('controller.controlling') }} <strong>{{ role }}</strong></p>
      <p class="admin-note">{{ t('controller.bothRoles') }}</p>
      <template v-if="player?.team">
        <div class="setup-section-title"><span>02</span><h2>{{ t('controller.teamName') }}</h2></div>
        <label class="team-name-label" for="team-name">{{ t(player.team === 'red' ? 'controller.redTeam' : 'controller.blueTeam') }}
          <input id="team-name" :value="teamNameDraft" :placeholder="teamName(player.team)" :disabled="!connected || teamNameLocked"
            maxlength="50" autocomplete="off" enterkeyhint="done" @focus="editingTeamName = true" @input="editTeamName"
            @blur="saveTeamName" @keydown.enter.prevent="($event.target as HTMLInputElement).blur()" />
          <span>{{ Array.from(teamNameDraft).length }} / {{ TEAM_NAME_MAX_LENGTH }}</span>
        </label>
        <p class="admin-note">{{ t(player.teamCaptain ? 'controller.captainOwn' : 'controller.captainOther') }}</p>
      </template>
      <div class="setup-settings-summary">
        <div>
          <UIcon name="i-lucide-sliders-horizontal" /><strong
            >{{ t('controller.firstToGoals', { count: state.settings.goalsToWin }) }}</strong
          ><span>{{
            t('controller.bumpInfo')
          }}</span>
        </div>
        <UButton
          variant="ghost"
          color="neutral"
          size="sm"
          @click="
            settingsTab = 'match';
            openSettings();
          "
          >{{ t(player?.admin ? 'controller.adjust' : 'controller.viewRules') }} →</UButton
        >
      </div>
      <p v-if="!player?.admin" class="admin-note">
        {{ t('controller.firstControlsSettings') }}
      </p>
      <div class="ready-area">
        <UButton v-if="player?.admin" block size="xl" :disabled="!connected || !player?.team || !allSeated" @click="startMatch">{{ t('controller.startMatch') }} <UIcon name="i-lucide-arrow-up-right" /></UButton>
        <p>{{ t(!player?.team ? 'controller.chooseRoles' : player.admin ? (allSeated ? 'controller.chooseStart' : 'controller.missingSeat') : 'controller.readyWaiting') }}</p>
      </div>
      <NuxtLink to="/about" class="controller-about"
        >{{ t('controller.about') }} ↗</NuxtLink
      >
    </section>

    <div
      v-if="settingsOpen"
      class="dialog-backdrop"
      @click.self="settingsOpen = false"
    >
      <section
        class="dialog-card settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <button
          class="dialog-close"
          :aria-label="t('controller.closeSettings')"
          @click="settingsOpen = false"
        >
          ×</button
        ><span class="eyebrow">{{ t('controller.makeYours') }}</span>
        <h2 id="settings-title">{{ t('controller.settings') }}</h2>
        <div class="settings-tabs">
          <button
            :class="{ active: settingsTab === 'personal' }"
            @click="settingsTab = 'personal'"
          >
            {{ t('controller.yourController') }}</button
          ><button
            :class="{ active: settingsTab === 'match' }"
            @click="settingsTab = 'match'"
          >
            {{ t('controller.matchRules') }}
          </button>
        </div>
        <template v-if="settingsTab === 'match'"
          ><p class="settings-note">
            {{
              player?.admin
                ? t('controller.adminRules')
                : t('controller.adminOnly')
            }}
          </p>
          <SetupMatchSettings
            :settings="state.settings"
            :disabled="!player?.admin"
            :human-count="humans.length"
            :players="state.players"


            @change="
              controller?.send({ type: 'update-settings', settings: $event })
            "
        /></template>
        <div v-else class="settings-fields">
          <div class="field-row"><label for="controller-sound">{{ t('controller.deviceSound') }}</label><USwitch id="controller-sound" :model-value="!muted" @update:model-value="setAudio" /></div>
          <div class="field-row"><label for="controller-graphics">{{ t(preferences.goodGraphics ? 'controller.goodGraphics' : 'controller.ordinaryGraphics') }}</label><USwitch id="controller-graphics" v-model="preferences.goodGraphics" :aria-label="t('controller.graphicsAria')" /></div>
          <p class="settings-note">{{ t('controller.replayGraphics') }}</p>
          <div class="slider-field">
            <label
              >{{ t('controller.movementSensitivity') }}
              <span
                >{{ preferences.translationSensitivity.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}×</span
              ></label
            ><USlider
              v-model="preferences.translationSensitivity"
              :min="0.3"
              :max="3"
              :step="0.1"
            />
          </div>
          <div class="slider-field">
            <label
              >{{ t('controller.rotationSensitivity') }}
              <span
                >{{ preferences.rotationSensitivity.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }}×</span
              ></label
            ><USlider
              v-model="preferences.rotationSensitivity"
              :min="0.3"
              :max="3"
              :step="0.1"
            />
          </div>
          <div class="field-row">
            <label for="invert">{{ t('controller.invertSwipe') }}</label
            ><USwitch id="invert" v-model="preferences.inverted" />
          </div>
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-maximize"
            @click="fullscreen.enterFromGesture"
            >{{
              t(fullscreen.active.value ? 'controller.fullscreenActive' : 'controller.openFullscreen')
            }}</UButton
          >
        </div>
        <UButton
          block
          size="lg"
          class="settings-done"
          @click="settingsOpen = false"
          >{{ t('controller.done') }}</UButton
        >
      </section>
    </div>
    </div>
    <div v-if="invitationOpen" class="dialog-backdrop invitation-backdrop" @click.self="invitationOpen = false">
      <section class="dialog-card invitation-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-title">
        <button class="dialog-close" :aria-label="t('controller.closeInvitation')" @click="invitationOpen = false">×</button>
        <h2 id="invite-title" class="sr-only">{{ t('controller.invite') }}</h2>
        <JoinCard class="invitation-card" compact retryable :join-url="joinUrl" :qr="invitationQr" :copied="copiedInvitation"
          :connecting="invitationConnecting" :error="gameText(invitationError || '')"
          @copy="copyInvitation" @retry="emit('retryInvitation')" />
      </section>
    </div>

  </main>
</template>

<style scoped>
.team-name-label { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; margin-bottom: 12px; color: #a8bd95; font-size: 12px; }
.team-name-label input { grid-column: 1 / -1; grid-row: 2; width: 100%; padding: 13px 14px; border: 1px solid #d9ecc440; border-radius: 7px; color: #edf2e6; background: #142012; font-size: 16px; }
.team-name-label input::placeholder { color: #96a58b; }
.team-name-label input:disabled { opacity: .75; }
.team-name-label input:focus-visible { outline: 2px solid #d2f35c; outline-offset: 2px; }
.team-name-label > span { font-size: 10px; font-variant-numeric: tabular-nums; }
.controller-page .phone-match-replay { position: relative; inset: auto; flex: 0 0 auto; width: auto; max-width: none; margin: 7px max(12px, env(safe-area-inset-left)) 8px; }
.controller-content { display: contents; }
.controller-join-card { margin-bottom: 28px; }
.controller-host-setup { padding-top: 18px; }
.invitation-card { margin-top: 18px; }
.invitation-backdrop { z-index: 200; }
.controller-role { margin: 9px 0; font-size: 11px; color: #a8bf94; line-height: 1.6; }
.controller-role strong { color: #e3f3cb; }
.controller-live-score {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-left: auto;
  margin-right: auto;
  padding: 3px 12px;
  border: 1px solid #d5e3c11a;
  border-radius: 5px;
  background: #0f1c10;
  font-variant-numeric: tabular-nums;
  font-size: 22px;
  font-weight: 750;
  line-height: 1;
}
.controller-live-score small { color: #77896a; font-size: 14px; }
.score-red { color: #ef907b; }
.score-blue { color: #8abef0; }
.opponent-hint { color: #718468; font-size: 7px; }
@media (max-width: 720px) {
  .opponent-hint { display: none; }
  .controller-live-score { padding: 3px 8px; gap: 7px; font-size: 19px; }
}
@media (max-width: 600px) {
  .controller-header { gap: 4px; }
  .controller-header :deep(.brand-image) { height: 36px; }
  .controller-playing .controller-header :deep(.brand-image) { height: 28px; }
  .controller-header-actions { gap: 2px; }
  .controller-header .connection-pill { display: none; }
  .controller-live-score { margin-inline: 3px; font-size: 17px; padding: 3px 6px; }
}
@media (orientation: landscape) and (max-height: 500px) {
  .controller-playing .controller-header { height: 38px; min-height: 38px; }
  .controller-playing .controller-header :deep(.brand-image) { height: 26px; }
  .controller-bottom { height: 34px; min-height: 34px; }
}
</style>
