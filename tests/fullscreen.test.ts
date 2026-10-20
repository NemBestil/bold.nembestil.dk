import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createControllerFullscreen,
  type ControllerFullscreenEnvironment,
} from "../app/composables/useControllerFullscreen";

class FakeWakeLock extends EventTarget {
  released = false;
  release = vi.fn(async () => {
    this.released = true;
    this.dispatchEvent(new Event("release"));
  });
}

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));
const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function fixture(overrides: Partial<ControllerFullscreenEnvironment> = {}) {
  const document = Object.assign(new EventTarget(), { hidden: false });
  const window = new EventTarget();
  let fullscreen = false;
  const requestFullscreen = vi.fn(async (_options: FullscreenOptions) => {
    fullscreen = true;
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  const lockOrientation = vi.fn().mockResolvedValue(undefined);
  const environment = {
    document,
    window,
    isFullscreen: () => fullscreen,
    requestFullscreen,
    lockOrientation,
    ...overrides,
  };
  const controller = createControllerFullscreen(environment);
  cleanup.push(controller.dispose);
  return {
    controller,
    document,
    window,
    requestFullscreen,
    lockOrientation,
    leaveFullscreen() {
      fullscreen = false;
      document.dispatchEvent(new Event("fullscreenchange"));
    },
  };
}

describe("controller fullscreen and awake lifecycle", () => {
  it("requests fullscreen synchronously from a gesture with navigation UI hidden", async () => {
    const { controller, requestFullscreen, lockOrientation } = fixture();
    expect(requestFullscreen).not.toHaveBeenCalled();
    const entering = controller.enterFromGesture();
    expect(requestFullscreen).toHaveBeenCalledExactlyOnceWith({
      navigationUI: "hide",
    });
    await entering;
    expect(controller.active.value).toBe(true);
    expect(lockOrientation).toHaveBeenCalledOnce();
  });

  it("keeps the preference after an OS exit and waits for the next gesture to reenter", async () => {
    const { controller, requestFullscreen, leaveFullscreen, document, window } =
      fixture();
    await controller.enterFromGesture();
    leaveFullscreen();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(controller.active.value).toBe(false);
    expect(controller.desired.value).toBe(true);
    expect(requestFullscreen).toHaveBeenCalledOnce();
    await controller.enterFromGesture();
    expect(requestFullscreen).toHaveBeenCalledTimes(2);
    expect(controller.active.value).toBe(true);
  });

  it("offers an iPhone homescreen fallback without throwing when fullscreen is unavailable or denied", async () => {
    const unsupported = fixture({ requestFullscreen: undefined }).controller;
    await unsupported.enterFromGesture();
    expect(unsupported.supported.value).toBe(false);
    expect(unsupported.active.value).toBe(false);
    expect(unsupported.message.value).toContain("Tilføj til hjemmeskærm");
    const denied = fixture({
      requestFullscreen: vi
        .fn()
        .mockRejectedValue(new Error("permission denied")),
    }).controller;
    await denied.enterFromGesture();
    expect(denied.active.value).toBe(false);
    expect(denied.message.value).toContain("kunne ikke aktiveres");
  });

  it("treats an installed standalone app as fullscreen without another browser request", async () => {
    const { controller, requestFullscreen } = fixture({
      isStandalone: () => true,
    });
    await controller.enterFromGesture();
    expect(controller.active.value).toBe(true);
    expect(controller.supported.value).toBe(true);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("deduplicates simultaneous touches and avoids orientation work after disposal", async () => {
    let grant!: () => void;
    const request = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          grant = resolve;
        }),
    );
    const { controller, lockOrientation } = fixture({
      requestFullscreen: request,
    });
    const entering = controller.enterFromGesture();
    void controller.enterFromGesture();
    expect(request).toHaveBeenCalledOnce();
    controller.dispose();
    grant();
    await entering;
    expect(lockOrientation).not.toHaveBeenCalled();
  });

  it("keeps the screen awake only while desired and reacquires after visibility returns", async () => {
    const first = new FakeWakeLock(),
      second = new FakeWakeLock();
    const requestWakeLock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const { controller, document } = fixture({ requestWakeLock });
    expect(requestWakeLock).not.toHaveBeenCalled();
    controller.setKeepAwake(true);
    await settle();
    expect(controller.awake.value).toBe(true);
    document.hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(first.release).toHaveBeenCalledOnce();
    expect(controller.awake.value).toBe(false);
    document.hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
    expect(controller.awake.value).toBe(true);
    controller.setKeepAwake(false);
    expect(second.release).toHaveBeenCalledOnce();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
  });

  it("releases on pagehide and resumes on pageshow without forcing fullscreen", async () => {
    const first = new FakeWakeLock(),
      second = new FakeWakeLock();
    const requestWakeLock = vi
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const { controller, window, requestFullscreen } = fixture({
      requestWakeLock,
    });
    controller.setKeepAwake(true);
    await settle();
    window.dispatchEvent(new Event("pagehide"));
    expect(first.release).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("pageshow"));
    await settle();
    expect(controller.awake.value).toBe(true);
    expect(requestFullscreen).not.toHaveBeenCalled();
    controller.dispose();
    expect(second.release).toHaveBeenCalledOnce();
    window.dispatchEvent(new Event("pageshow"));
    expect(requestWakeLock).toHaveBeenCalledTimes(2);
  });

  it("releases a wake lock that arrives after unmount instead of leaking it", async () => {
    let grant!: (lock: FakeWakeLock) => void;
    const requestWakeLock = vi.fn(
      () =>
        new Promise<FakeWakeLock>((resolve) => {
          grant = resolve;
        }),
    );
    const { controller } = fixture({ requestWakeLock });
    controller.setKeepAwake(true);
    controller.dispose();
    const lock = new FakeWakeLock();
    grant(lock);
    await settle();
    expect(lock.release).toHaveBeenCalledOnce();
    expect(controller.awake.value).toBe(false);
  });

  it("survives wake-lock rejection while fullscreen and gameplay can continue", async () => {
    const { controller } = fixture({
      requestWakeLock: vi.fn().mockRejectedValue(new Error("low battery")),
    });
    controller.setKeepAwake(true);
    await controller.enterFromGesture();
    expect(controller.active.value).toBe(true);
    expect(controller.awake.value).toBe(false);
  });
});
