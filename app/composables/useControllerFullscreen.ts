import { computed, onBeforeUnmount, ref, watch } from "vue";

interface ScreenWakeLock extends EventTarget {
  readonly released?: boolean;
  release(): Promise<void>;
}

export interface ControllerFullscreenEnvironment {
  document: EventTarget & { hidden: boolean };
  window: EventTarget;
  isFullscreen: () => boolean;
  requestFullscreen?: (options: FullscreenOptions) => Promise<void> | void;
  lockOrientation?: () => Promise<void>;
  requestWakeLock?: () => Promise<ScreenWakeLock>;
  isStandalone?: () => boolean;
}

/** Fullscreen requests happen only in gesture handlers, never in a retry loop. */
export function createControllerFullscreen(
  environment?: ControllerFullscreenEnvironment,
) {
  const desired = ref(true);
  const active = ref(
    !!environment &&
      (environment.isFullscreen() || !!environment.isStandalone?.()),
  );
  const supported = ref(
    !!environment?.requestFullscreen || !!environment?.isStandalone?.(),
  );
  const awake = ref(false);
  const wakeSupported = ref(!!environment?.requestWakeLock);
  const fallback =
    "På iPhone kan du vælge Del → Tilføj til hjemmeskærm og åbne Nem Bold derfra for fuldskærm.";
  const message = ref(
    supported.value
      ? "Fuldskærm aktiveres, når du gør dig klar. Hvis browseren forlader den, gendannes den ved næste tryk."
      : `Browseren understøtter ikke fuldskærm her. ${fallback}`,
  );
  let disposed = false;
  let entering = false;
  let wakeDesired = false;
  let pageActive = true;
  let generation = 0;
  let wakeRequest: symbol | undefined;
  let wakeLock: ScreenWakeLock | undefined;
  let wakeReleaseListener: (() => void) | undefined;

  function syncFullscreen() {
    if (disposed || !environment) return;
    const wasActive = active.value;
    active.value = environment.isFullscreen() || !!environment.isStandalone?.();
    if (wasActive && !active.value) {
      // The user's fullscreen preference survives the browser/OS leaving fullscreen.
      message.value =
        "Tryk på controlleren eller fuldskærmsikonet for at vende tilbage til fuldskærm.";
    }
  }

  function releaseWakeLock() {
    generation++;
    wakeRequest = undefined;
    const current = wakeLock;
    if (current && wakeReleaseListener)
      current.removeEventListener("release", wakeReleaseListener);
    wakeLock = undefined;
    wakeReleaseListener = undefined;
    awake.value = false;
    if (current)
      void current.release().catch(() => {
        /* The browser may have released it already. */
      });
  }

  async function ensureWakeLock() {
    if (
      disposed ||
      !environment?.requestWakeLock ||
      !wakeDesired ||
      !pageActive ||
      environment.document.hidden ||
      wakeRequest ||
      (wakeLock && !wakeLock.released)
    )
      return;
    const token = Symbol("screen wake lock");
    const requestGeneration = generation;
    wakeRequest = token;
    try {
      const acquired = await environment.requestWakeLock();
      if (
        disposed ||
        requestGeneration !== generation ||
        !wakeDesired ||
        !pageActive ||
        environment.document.hidden
      ) {
        await acquired.release().catch(() => {});
        return;
      }
      wakeLock = acquired;
      awake.value = !acquired.released;
      wakeReleaseListener = () => {
        if (wakeLock !== acquired) return;
        wakeLock = undefined;
        wakeReleaseListener = undefined;
        awake.value = false;
      };
      acquired.addEventListener("release", wakeReleaseListener, { once: true });
    } catch {
      // Low battery, insecure contexts or system policy may reject wake locks.
      if (requestGeneration === generation && !disposed) awake.value = false;
    } finally {
      if (wakeRequest === token) wakeRequest = undefined;
    }
  }

  function setKeepAwake(value: boolean) {
    if (disposed) return;
    wakeDesired = value;
    if (value) void ensureWakeLock();
    else releaseWakeLock();
  }

  async function enterFromGesture() {
    if (disposed || !environment) return;
    desired.value = true;
    syncFullscreen();
    void ensureWakeLock();
    if (active.value || entering) return;
    if (!environment.requestFullscreen) {
      message.value = `Browseren understøtter ikke fuldskærm her. ${fallback}`;
      return;
    }
    entering = true;
    try {
      // This call stays before the first await, preserving transient user activation.
      const request = environment.requestFullscreen({ navigationUI: "hide" });
      await request;
      if (disposed) return;
      syncFullscreen();
      message.value =
        "Fuldskærm er aktiv. Hvis browseren forlader den, gendannes den ved næste tryk.";
      try {
        await environment.lockOrientation?.();
      } catch {
        /* Orientation lock is optional. */
      }
    } catch {
      if (!disposed)
        message.value = `Fuldskærm kunne ikke aktiveres. Prøv fuldskærmsikonet igen. ${fallback}`;
    } finally {
      entering = false;
    }
  }

  function visibility() {
    if (!environment) return;
    syncFullscreen();
    if (environment.document.hidden) releaseWakeLock();
    else void ensureWakeLock();
  }
  function pagehide() {
    pageActive = false;
    releaseWakeLock();
  }
  function pageshow() {
    pageActive = true;
    visibility();
  }
  environment?.document.addEventListener("fullscreenchange", syncFullscreen);
  environment?.document.addEventListener(
    "webkitfullscreenchange",
    syncFullscreen,
  );
  environment?.document.addEventListener("visibilitychange", visibility);
  environment?.window.addEventListener("pagehide", pagehide);
  environment?.window.addEventListener("pageshow", pageshow);

  function dispose() {
    if (disposed) return;
    disposed = true;
    releaseWakeLock();
    environment?.document.removeEventListener(
      "fullscreenchange",
      syncFullscreen,
    );
    environment?.document.removeEventListener(
      "webkitfullscreenchange",
      syncFullscreen,
    );
    environment?.document.removeEventListener("visibilitychange", visibility);
    environment?.window.removeEventListener("pagehide", pagehide);
    environment?.window.removeEventListener("pageshow", pageshow);
  }

  return {
    desired,
    active,
    supported,
    awake,
    wakeSupported,
    message,
    enterFromGesture,
    setKeepAwake,
    dispose,
  };
}

export function useControllerFullscreen(keepAwake: () => boolean) {
  const gameText = useGameText();
  let environment: ControllerFullscreenEnvironment | undefined;
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const browserDocument = document as Document & {
      webkitFullscreenElement?: Element | null;
    };
    const browserNavigator = navigator as Navigator & { standalone?: boolean };
    const orientation = screen.orientation as ScreenOrientation & {
      lock?: (value: string) => Promise<void>;
    };
    const requestFullscreen = root.requestFullscreen
      ? (options: FullscreenOptions) => root.requestFullscreen(options)
      : root.webkitRequestFullscreen
        ? () => root.webkitRequestFullscreen!()
        : undefined;
    environment = {
      document,
      window,
      isFullscreen: () =>
        !!(
          document.fullscreenElement || browserDocument.webkitFullscreenElement
        ),
      isStandalone: () =>
        !!window.matchMedia?.("(display-mode: standalone)").matches ||
        browserNavigator.standalone === true,
      requestFullscreen,
      lockOrientation: orientation?.lock
        ? () => orientation.lock!("landscape")
        : undefined,
      requestWakeLock: navigator.wakeLock?.request
        ? () => navigator.wakeLock.request("screen")
        : undefined,
    };
  }
  const fullscreen = createControllerFullscreen(environment);
  watch(keepAwake, fullscreen.setKeepAwake, { immediate: true });
  onBeforeUnmount(fullscreen.dispose);
  return { ...fullscreen, message: computed(() => gameText(fullscreen.message.value)) };
}
