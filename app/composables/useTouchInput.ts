import { onBeforeUnmount, ref } from "vue";
import type { ControllerPreferences } from "./useControllerPreferences";
import { GAME_CONFIG } from "../../game/GameConfig";

export type TouchSample = {
  translation: number;
  angularVelocity: number;
  active: boolean;
  flick?: boolean;
  rotationOnly?: boolean;
};
export interface TouchGeometry { pixelsPerMeter: number; travel: number }
export function swipeAngularVelocity(pixels: number, seconds: number, p: ControllerPreferences) {
  if (pixels === 0) return 0;
  const velocity = (pixels / Math.max(seconds, 0.001)) * TOUCH_CONFIG.radiansPerPixel * p.rotationSensitivity * (p.inverted ? -1 : 1);
  return Math.max(-GAME_CONFIG.rods.maxAngularVelocity, Math.min(GAME_CONFIG.rods.maxAngularVelocity, velocity));
}
// Pointer IDs belong to exactly one rod, even when a finger crosses another panel.
const owners = new Map<number, symbol>();
const TOUCH_CONFIG = {
  frequency: GAME_CONFIG.rendering.controllerFps,
  translationHeight: 0.4,
  minimumTranslationPixels: 50,
  radiansPerPixel: 0.035,
  idleDelayMs: 65,
  idleDamping: 30,
  minimumSpin: 0.1,
};

/** Input controller without lifecycle hooks, also used by deterministic pointer tests. */
export function createTouchInput(
  preferences: () => ControllerPreferences,
  send: (input: TouchSample) => void,
  now = () => performance.now(),
  geometry?: () => TouchGeometry,
  preview?: (input: TouchSample) => void,
) {
  const active = ref(false);
  const translation = ref(0);
  const angularVelocity = ref(0);
  const owner = Symbol("rod pointer");
  let pointerId: number | null = null;
  let x = 0;
  let y = 0;
  let time = 0;
  let startY = 0;
  let startTranslation = 0;
  let translationPixels = 100;
  let changed = false;
  let pendingMovement = false;
  let lastMove = 0;
  let lastPublish = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let element: HTMLElement | null = null;
  let disposed = false;

  function publish(flick = false) {
    const timestamp = now();
    const idleTime =
      Math.max(
        0,
        timestamp - Math.max(lastPublish, lastMove + TOUCH_CONFIG.idleDelayMs),
      ) / 1000;
    if (idleTime > 0)
      angularVelocity.value *= Math.exp(-TOUCH_CONFIG.idleDamping * idleTime);
    if (Math.abs(angularVelocity.value) < TOUCH_CONFIG.minimumSpin)
      angularVelocity.value = 0;
    lastPublish = timestamp;
    pendingMovement = false;
    const input = {
      translation: translation.value,
      angularVelocity: angularVelocity.value,
      active: active.value,
      ...(flick ? { flick: true } : {}),
    };
    preview?.(input);
    send(input);
  }

  function down(event: PointerEvent) {
    if (disposed || pointerId !== null || owners.has(event.pointerId)) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.currentTarget as HTMLElement | null;
    if (!target) return;
    event.preventDefault();
    pointerId = event.pointerId;
    owners.set(pointerId, owner);
    element = target;
    try {
      element.setPointerCapture(pointerId);
    } catch {
      /* Window release listeners remain a fallback. */
    }
    x = event.clientX;
    y = event.clientY;
    startY = event.clientY;
    startTranslation = translation.value;
    const measured = geometry?.();
    translationPixels = measured && Number.isFinite(measured.pixelsPerMeter) && measured.pixelsPerMeter > 0 && measured.travel > 0
      ? measured.pixelsPerMeter * measured.travel
      : Math.max(element.clientHeight * TOUCH_CONFIG.translationHeight, TOUCH_CONFIG.minimumTranslationPixels);
    changed = false;
    pendingMovement = false;
    time = lastMove = lastPublish = now();
    angularVelocity.value = 0;
    active.value = true;
    publish();
    timer = setInterval(publish, 1000 / TOUCH_CONFIG.frequency);
  }

  function move(event: PointerEvent) {
    if (event.pointerId !== pointerId || !element || !active.value) return;
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY))
      return;
    event.preventDefault();
    const timestamp = now();
    const dt = Math.max((timestamp - time) / 1000, 0.001);
    const p = preferences();
    changed ||= event.clientX !== x || event.clientY !== y;
    translation.value = Math.max(
      -1,
      Math.min(
        1,
        startTranslation +
          ((event.clientY - startY) / translationPixels) *
            p.translationSensitivity,
      ),
    );
    angularVelocity.value = swipeAngularVelocity(event.clientX - x, dt, p);
    x = event.clientX;
    y = event.clientY;
    time = lastMove = timestamp;
    // Keep measuring every pointer event; the timer sends only the newest pose.
    pendingMovement = true;
    preview?.({ translation: translation.value, angularVelocity: angularVelocity.value, active: true });
  }

  function release(event?: PointerEvent) {
    if (event && event.pointerId !== pointerId) return;
    if (pointerId === null) return;
    const intentional = event?.type === "pointerup";
    // A short swipe can finish before either the input timer or the next physics tick.
    if (intentional && event && (event.clientX !== x || event.clientY !== y)) move(event);
    if (intentional && pendingMovement) publish();
    clearInterval(timer);
    timer = undefined;
    const id = pointerId;
    const target = element;
    // Clear ownership before capture release can dispatch lostpointercapture again.
    pointerId = null;
    element = null;
    if (owners.get(id) === owner) owners.delete(id);
    active.value = false;
    // The host freezes physical translation and preserves spin inertia on release.
    publish(intentional && changed);
    try {
      if (target?.hasPointerCapture(id)) target.releasePointerCapture(id);
    } catch {
      /* Pointer already ended. */
    }
  }

  function dispose() {
    release();
    disposed = true;
  }
  function syncTranslation(value: number) {
    // A new gesture starts at the actual host position, including after replay or serving.
    if (!active.value && Number.isFinite(value))
      translation.value = Math.max(-1, Math.min(1, value));
  }
  return {
    active,
    translation,
    angularVelocity,
    down,
    move,
    release,
    syncTranslation,
    dispose,
  };
}

export function useTouchInput(
  preferences: () => ControllerPreferences,
  send: (input: TouchSample) => void,
  geometry?: () => TouchGeometry,
  preview?: (input: TouchSample) => void,
) {
  const touch = createTouchInput(preferences, send, undefined, geometry, preview);
  const release = () => touch.release();
  const visibility = () => {
    if (document.hidden) touch.release();
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pointerup", touch.release);
    window.addEventListener("pointercancel", touch.release);
    window.addEventListener("blur", release);
    window.addEventListener("pagehide", release);
    document.addEventListener("visibilitychange", visibility);
  }
  onBeforeUnmount(() => {
    touch.dispose();
    if (typeof window === "undefined") return;
    window.removeEventListener("pointerup", touch.release);
    window.removeEventListener("pointercancel", touch.release);
    window.removeEventListener("blur", release);
    window.removeEventListener("pagehide", release);
    document.removeEventListener("visibilitychange", visibility);
  });
  return touch;
}
