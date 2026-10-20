<script setup lang="ts">
import type { FootballClub, MatchSnapshot, Team } from "../../../shared/types";
import type { ControllerPreferences } from "../../composables/useControllerPreferences";
import type { ControllerScene } from "../../../game/rendering/ControllerScene";
import type { MobileHostScene } from "../../../game/rendering/MobileHostScene";
import { CONTROLLER_FRAME_BUFFER_OPTIONS, TableFrameBuffer } from "../../../network/TableFrameBuffer";
import type { ControllerFrameStream } from "../../../network/ControllerFrameStream";
import { ControllerPrediction } from "../../../network/ControllerPrediction";
import { TABLE_VIEW, controllerTouchZones, normalizedRodPosition, tableViewport } from "./tableProjection";
import type { TouchSample } from "../../composables/useTouchInput";
import { ControllerGestureTracker } from "../../utils/controllerGestures";
const { t, locale } = useI18n();

const props = defineProps<{
  team: Team;
  frameStream: ControllerFrameStream;
  match: MatchSnapshot;
  goalsToWin: number;
  clubs?: Record<Team, FootballClub>;
  preferences: ControllerPreferences;
  rodIds: readonly number[];
  externalView?: MobileHostScene;
  automaticRodIds?: readonly number[];
  rotationDamping: number;
  roundTripMs: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  input: [input: TouchSample & { rodId: number }];
}>();
const stage = ref<HTMLElement>();
const canvasContainer = ref<HTMLElement>();
const buffer = new TableFrameBuffer(CONTROLLER_FRAME_BUFFER_OPTIONS);
const prediction = new ControllerPrediction();
const hasFrame = ref(false);
const stale = ref(true);
const sceneReady = ref(false);
const graphicsError = ref(false);
const announcementTeam = computed(() => props.match.phase === "goal" ? props.match.scoringTeam : props.match.phase === "replay" ? props.match.replay?.goalTeam : undefined);
const size = ref({ width: 1, height: 1 });
const zones = computed(() => controllerTouchZones(props.team, props.rodIds));
const partnerZones = computed(() => controllerTouchZones(props.team).filter((rod) => !props.rodIds.includes(rod.id)));
const viewport = computed(() => tableViewport(size.value.width, size.value.height));
const activeRods = new Set<number>();
const gestures = new ControllerGestureTracker();
const controlsDisabled = computed(() => !!props.disabled || !hasFrame.value || stale.value || !sceneReady.value);
let observer: ResizeObserver | undefined;
let animation = 0;
let scene: ControllerScene | undefined;
let previousRender = 0;
let initializing = false;
let disposed = false;

const notice = computed(() => {
  if (!sceneReady.value) return "";
  if (!hasFrame.value) return t("controller.waitingTable");
  if (stale.value) return t("controller.tableConnecting");
  if (props.match.phase === "replay") {
    const replay = props.match.replay;
    const title = replay?.summary ? t("controller.goalSummary", { index: replay.goalIndex ?? 1, count: replay.goalCount ?? 0 }) : t(replay?.fullMatch ? "controller.matchReplay" : "controller.goalReplay");
    return replay?.slowMotion ? t("controller.slowMotion", { title }) : title;
  }
  if (props.match.phase === "countdown") return t(props.match.notice === "Ny bold om" ? "controller.newBallIn" : "controller.readyIn", { count: props.match.countdown });
  if (props.match.phase === "serving") return t("controller.serving");
  if (props.match.phase === "out") return t("controller.ballOut");
  return "";
});
function rodLabel(id: number) {
  return t(`controller.${["goalkeeper", "defense", "midfield", "attack"][id]}`);
}

function markActive(rod: number, active: boolean) {
  if (active) activeRods.add(rod);
  else activeRods.delete(rod);
}
function gesturePoint(event: PointerEvent) {
  const rect = stage.value!.getBoundingClientRect();
  return { x: (event.clientX - rect.left - stage.value!.clientLeft - viewport.value.x) / viewport.value.scale,
    z: (event.clientY - rect.top - stage.value!.clientTop - viewport.value.z) / viewport.value.scale,
    pixelX: event.clientX, time: performance.now() };
}
function gestureRods() {
  return zones.value.map((rod) => ({ id: rod.id, x: rod.x, translation: currentPosition(rod.index) }));
}
function currentPosition(index: number) { return normalizedRodPosition(prediction.currentFrame ?? props.frameStream.latest, index); }
function previewInput(input: TouchSample & { rodId: number }) {
  if (!props.externalView && !controlsDisabled.value) prediction.input(props.team, props.rodIds, input);
}
function gestureDown(event: PointerEvent) {
  if (controlsDisabled.value || (event.pointerType === "mouse" && event.button !== 0)) return;
  const id = (event.target as Element | null)?.closest("[data-rod-id]")?.getAttribute("data-rod-id");
  gestures.start(event.pointerId, gesturePoint(event), id == null ? undefined : Number(id));
}
function gestureMove(event: PointerEvent) {
  if (!controlsDisabled.value) gestures.move(event.pointerId, gesturePoint(event), gestureRods(), activeRods, props.preferences);
}
function gestureUp(event: PointerEvent) {
  if (controlsDisabled.value) return gestures.cancel(event.pointerId);
  for (const input of gestures.finish(event.pointerId, gesturePoint(event), gestureRods(), activeRods, props.preferences)) {
    previewInput(input);
    emit("input", input);
  }
}
const clearGestures = () => { gestures.clear(); prediction.clear(); };
watch(() => props.frameStream, (stream, _previous, onCleanup) => {
  buffer.clear();
  clearGestures();
  onCleanup(stream.subscribe((frame, arrivalTime) => {
    // The stream bypasses Vue's render queue; only availability is reactive.
    hasFrame.value = !!frame;
    if (frame) buffer.push(frame, arrivalTime);
    else {
      buffer.clear();
      clearGestures();
      stale.value = true;
    }
  }));
}, { immediate: true, flush: "sync" });
const visibility = () => { if (document.hidden) clearGestures(); };
const cancelGesture = (event: PointerEvent) => gestures.cancel(event.pointerId);
watch(controlsDisabled, (disabled) => { if (disabled) clearGestures(); });
watch(() => props.rodIds.join(","), clearGestures);
function resize() {
  if (!stage.value) return;
  size.value = { width: Math.max(1, stage.value.clientWidth), height: Math.max(1, stage.value.clientHeight) };
  scene?.resize(size.value.width, size.value.height, viewport.value);
  props.externalView?.resize(size.value.width, size.value.height, viewport.value);
}
function render(now: number) {
  const dt = previousRender ? Math.min(0.1, Math.max(0, (now - previousRender) / 1000)) : 0;
  previousRender = now;
  stale.value = buffer.isStale(now);
  if (scene) {
    try {
      // Play received host poses together; held rods retain immediate local control.
      const frame = prediction.sample(buffer.sample(now), now, props.rotationDamping, !props.disabled && !stale.value, props.roundTripMs);
      scene.render(frame, dt, activeRods, frame?.scores ?? props.match.replay?.scores ?? props.match.scores, props.goalsToWin);
    } catch {
      failScene();
    }
  }
  animation = requestAnimationFrame(render);
}
function failScene() {
  if (disposed) return;
  sceneReady.value = false;
  graphicsError.value = true;
  scene?.dispose();
  scene = undefined;
  props.externalView?.detach();
}
async function createScene() {
  if (initializing || disposed || !canvasContainer.value) return;
  initializing = true;
  graphicsError.value = false;
  try {
    if (props.externalView) {
      props.externalView.setTeam(props.team);
      props.externalView.attach(canvasContainer.value, size.value.width, size.value.height, viewport.value);
      sceneReady.value = true;
      return;
    }
    // Load the shared 3D renderer only after the lobby starts a match.
    const { ControllerScene: Scene } = await import("../../../game/rendering/ControllerScene");
    if (disposed) return;
    scene = new Scene(canvasContainer.value, props.team);
    scene.setGoodGraphics(props.preferences.goodGraphics);
    scene.resize(size.value.width, size.value.height, viewport.value);
    if (props.clubs) scene.setClubs(props.clubs, locale.value);
    sceneReady.value = true;
  } catch {
    if (!disposed) failScene();
  } finally {
    initializing = false;
  }
}
watch(() => props.team, (team) => { prediction.clear(); scene?.setTeam(team); props.externalView?.setTeam(team); });
watch(() => props.preferences.goodGraphics, (enabled) => scene?.setGoodGraphics(enabled));
watch(() => props.clubs, (clubs) => {
  if (clubs) scene?.setClubs(clubs, locale.value);
});
watch(locale, () => { if (props.clubs) scene?.setClubs(props.clubs, locale.value); });
onMounted(() => {
  resize();
  observer = new ResizeObserver(resize);
  if (stage.value) observer.observe(stage.value);
  animation = requestAnimationFrame(render);
  void createScene();
  window.addEventListener("blur", clearGestures);
  window.addEventListener("pagehide", clearGestures);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pointerup", gestureUp);
  window.addEventListener("pointercancel", cancelGesture);
});
onBeforeUnmount(() => {
  disposed = true;
  cancelAnimationFrame(animation);
  observer?.disconnect();
  scene?.dispose();
  props.externalView?.detach();
  buffer.clear();
  clearGestures();
  window.removeEventListener("blur", clearGestures);
  window.removeEventListener("pagehide", clearGestures);
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pointerup", gestureUp);
  window.removeEventListener("pointercancel", cancelGesture);
});
</script>

<template>
  <section ref="stage" class="controller-table" :aria-label="t('controller.tableAria')"
    @pointerdown.capture="gestureDown" @pointermove.capture="gestureMove" @pointerup.capture="gestureUp"
    @pointercancel.capture="gestures.cancel($event.pointerId)" @lostpointercapture.capture="gestures.cancel($event.pointerId)">
    <div ref="canvasContainer" class="table-canvas" :aria-label="t('controller.tableAria')" @webglcontextlost.capture.prevent="failScene" />
    <div
      class="table-touch-layer"
      :style="{
        left: `${viewport.left}px`,
        top: `${viewport.top}px`,
        width: `${viewport.width}px`,
        height: `${viewport.height + TABLE_VIEW.labelHeight}px`,
      }"
    >
      <ControllerTouchZone
        v-for="zone in zones"
        :key="`${team}-${zone.id}`"
        :rod-id="zone.id"
        :label="rodLabel(zone.id)"
        :preferences="preferences"
        :position="0"
        :current-position="() => currentPosition(zone.index)"
        :pixels-per-meter="viewport.scale"
        :travel="zone.travel"
        :disabled="controlsDisabled"
        :style="{
          left: `${((zone.left + TABLE_VIEW.halfLength) / (TABLE_VIEW.halfLength * 2)) * 100}%`,
          width: `${((zone.right - zone.left) / (TABLE_VIEW.halfLength * 2)) * 100}%`,
        }"
        @input="emit('input', $event)"
        @preview="previewInput"
        @active="markActive"
      />
      <span v-for="zone in partnerZones" :key="`partner-${zone.id}`" class="partner-rod-label"
        :style="{ left: `${((zone.x + TABLE_VIEW.halfLength) / (TABLE_VIEW.halfLength * 2)) * 100}%` }">{{ rodLabel(zone.id) }} · {{ automaticRodIds?.includes(zone.id) ? 'CPU' : t('controller.partner') }}</span>
    </div>
    <div v-if="!sceneReady" class="table-loading" :role="graphicsError ? 'alert' : 'status'">
      <template v-if="graphicsError">
        <p>{{ t('controller.tableError') }}</p>
        <UButton size="sm" @click="createScene">{{ t('controller.retry') }}</UButton>
      </template>
      <template v-else>
        <UIcon name="i-lucide-loader-circle" class="size-6 animate-spin" />
        <span>{{ t('controller.openingTable') }}</span>
      </template>
    </div>
    <div v-if="sceneReady && !stale && announcementTeam" class="table-goal" role="status" aria-live="polite">
      <GoalAnnouncement :team="announcementTeam" :club="clubs?.[announcementTeam]" />
    </div>
    <span v-if="notice" class="table-phase-notice" :class="{ stale }" role="status">{{ notice }}</span>
  </section>
</template>

<style scoped>
.controller-table {
  position: relative;
  flex: 1;
  min-height: 130px;
  min-width: 0;
  margin-top: 2px;
  overflow: hidden;
  border: 1px solid #d5e3c115;
  border-radius: 9px;
  background: radial-gradient(ellipse at 50% 45%, #273b26, #172619 75%);
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.table-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.table-touch-layer { position: absolute; }
.partner-rod-label { position: absolute; bottom: 6px; transform: translateX(-50%); color: #8d9d7f; font-size: 8px; white-space: nowrap; pointer-events: none; }
.table-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px;
  text-align: center;
  color: #e2f7ac;
  background: #172619e8;
  font-size: 12px;
}
.table-phase-notice {
  position: absolute;
  top: 7px;
  left: 50%;
  transform: translateX(-50%);
  padding: 5px 10px;
  border-radius: 5px;
  background: #14200eed;
  border: 1px solid #d2f35c50;
  color: #e2f7ac;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  white-space: nowrap;
  pointer-events: none;
}
.table-phase-notice.stale { color: #e7d4a4; border-color: #e7d4a450; }
.table-goal { position: absolute; inset: 0; display: grid; place-items: center; padding: 12px; background: #101810b0; pointer-events: none; }
</style>
