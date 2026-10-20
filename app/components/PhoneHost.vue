<script setup lang="ts">
import type { GameEngine } from "../../game/GameEngine";
import type { PeerHost } from "../../network/PeerHost";
import type { ControllerTransportFactory } from "../../network/ControllerTransport";
import type { SessionState } from "../../shared/types";
import { DEFAULT_SETTINGS, INITIAL_MATCH } from "../../shared/types";
import { DEFAULT_TEAM_NAMES } from "../../shared/teamIdentity";
import { sessionLink } from "../utils/sessionLink";

const emit = defineEmits<{ exit: [] }>();
const { t, locale } = useI18n();
const gameText = useGameText();
const teamName = useTeamName();
const staging = ref<HTMLElement>();
const engine = shallowRef<GameEngine>();
const factory = shallowRef<ControllerTransportFactory>();
const state = shallowRef<SessionState>({ sessionId: "", players: [], teamNames: { ...DEFAULT_TEAM_NAMES }, settings: { ...DEFAULT_SETTINGS }, match: structuredClone(INITIAL_MATCH) });
const loadingError = ref("");
const invitationError = ref("");
const invitationConnecting = ref(false);
const online = ref(false);
let host: PeerHost | undefined;
let disposed = false;
let initializing = false;
const joinUrl = computed(() => online.value && state.value.sessionId && import.meta.client
  ? sessionLink(location.origin, useRuntimeConfig().app.baseURL, state.value.sessionId) : "");
async function invite() {
  if (!host || invitationConnecting.value || disposed) return;
  invitationConnecting.value = true;
  invitationError.value = "";
  try { await host.start(); if (!disposed) online.value = true; }
  catch (error) {
    if (!disposed) invitationError.value = error instanceof Error ? error.message : "Forbindelsen til de andre telefoner kunne ikke åbnes.";
  } finally { if (!disposed) invitationConnecting.value = false; }
}
async function initialize() {
  if (initializing || disposed || !staging.value) return;
  initializing = true;
  loadingError.value = "";
  try {
    const [{ GameEngine: Engine }, { PeerHost: Host }] = await Promise.all([
      import("../../game/GameEngine"), import("../../network/PeerHost"),
    ]);
    if (disposed) return;
    const created = await Engine.createMobile(staging.value,
      (snapshot) => host?.setMatch(snapshot),
      (frame) => host?.setFrame(frame),
      (sound) => host?.setSound(sound));
    if (disposed) { created.dispose(); return; }
    engine.value = created;
    created.setTeamNameFormatter(teamName, locale.value);
    host = new Host({
      onState: (next) => { if (!disposed) state.value = next; },
      onStatus: (status, message) => {
        if (disposed) return;
        online.value = status === "connected";
        invitationError.value = message || "";
      },
      onStart: (settings, clubs) => created.start(settings, clubs),
      onInput: (team, input) => created.input(team, input),
      onBump: () => created.bump(), onPause: () => created.pause(),
      onResume: () => created.resume(), onReset: () => created.reset(),
    });
    host.startLocal();
    host.setMatch(created.snapshot);
    factory.value = (callbacks) => host!.createLocalController(callbacks);
    void invite();
  } catch (error) {
    host?.dispose(); host = undefined;
    engine.value?.dispose(); engine.value = undefined;
    if (!disposed) loadingError.value = error instanceof Error ? error.message : "Bordet kunne ikke åbnes på denne enhed.";
  } finally { initializing = false; }
}
watch(() => JSON.stringify(state.value.settings), () => engine.value?.updateSettings(state.value.settings));
watch(locale, () => engine.value?.setTeamNameFormatter(teamName, locale.value));
onMounted(() => { void initialize(); });
onBeforeUnmount(() => {
  disposed = true;
  host?.dispose();
  engine.value?.dispose();
});
</script>

<template>
  <div class="phone-host">
    <div ref="staging" class="host-scene-staging" aria-hidden="true" />
    <ControllerSession v-if="factory && engine && state.sessionId"
      :session-id="state.sessionId" :transport-factory="factory" :external-view="engine.mobileView || undefined"
      :host-engine="engine" hosting multiplayer :join-url="joinUrl"
      :invitation-error="invitationError" :invitation-connecting="invitationConnecting"
      @exit="emit('exit')" @retry-invitation="invite" />
    <main v-else class="phone-host-loading">
      <LanguageSwitcher class="phone-language-switcher" />
      <BrandLogo />
      <template v-if="loadingError"><h1>{{ t('ui.phone.failed') }}</h1><p role="alert">{{ gameText(loadingError) }}</p><UButton @click="initialize">{{ t('ui.common.retry') }}</UButton></template>
      <template v-else><UIcon name="i-lucide-loader-circle" class="size-8 animate-spin" /><h1>{{ t('ui.phone.preparing') }}</h1><p>{{ t('ui.phone.description') }}</p></template>
      <UButton variant="ghost" color="neutral" @click="emit('exit')">{{ t('ui.common.back') }}</UButton>
    </main>
  </div>
</template>

<style scoped>
.host-scene-staging { position: fixed; width: 2px; height: 2px; left: -20px; top: -20px; overflow: hidden; pointer-events: none; }
.phone-host-loading { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 22px; padding: 30px; }
.phone-host-loading h1 { font-size: 25px; font-weight: 700; line-height: 1.2; }
.phone-host-loading p { color: #9bb28a; font-size: 12px; line-height: 1.7; max-width: 450px; }
.phone-host-loading > .phone-language-switcher { position: absolute; top: max(20px, env(safe-area-inset-top)); right: max(20px, env(safe-area-inset-right)); }
</style>
