import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTouchInput } from "../app/composables/useTouchInput";
import { DEFAULT_CONTROLLER_PREFERENCES } from "../app/composables/useControllerPreferences";

const preferences = { ...DEFAULT_CONTROLLER_PREFERENCES };
const controllers: ReturnType<typeof createTouchInput>[] = [];
function controller(geometry?: { pixelsPerMeter: number; travel: number }) {
  let timestamp = 0;
  const send = vi.fn();
  const touch = createTouchInput(
    () => preferences,
    send,
    () => timestamp,
    geometry ? () => geometry : undefined,
  );
  controllers.push(touch);
  return {
    touch,
    send,
    at: (time: number) => {
      timestamp = time;
    },
  };
}
function panel() {
  return {
    clientHeight: 250,
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  } as unknown as HTMLElement;
}
function pointer(id: number, target: HTMLElement, x = 0, y = 0, type = "pointermove") {
  return {
    pointerId: id,
    type,
    pointerType: "touch",
    button: 0,
    currentTarget: target,
    clientX: x,
    clientY: y,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent;
}
beforeEach(() => {
  vi.useFakeTimers();
  Object.assign(preferences, DEFAULT_CONTROLLER_PREFERENCES);
});
afterEach(() => {
  controllers.splice(0).forEach((touch) => touch.dispose());
  vi.useRealTimers();
});

describe("mobile rod pointer input", () => {
  it("previews pointer movement immediately while network input remains at 30 Hz", () => {
    const preview = vi.fn(), send = vi.fn();
    let now = 0;
    const touch = createTouchInput(() => preferences, send, () => now, undefined, preview);
    controllers.push(touch);
    const target = panel();
    touch.down(pointer(100, target));
    now = 8;
    touch.move(pointer(100, target, 15, 20));
    expect(send).toHaveBeenCalledTimes(1);
    expect(preview.mock.lastCall?.[0]).toMatchObject({ active: true, translation: 0.2 });
    expect(preview.mock.lastCall?.[0].angularVelocity).not.toBe(0);
    now = 34;
    vi.advanceTimersByTime(34);
    expect(send.mock.lastCall?.[0]).toEqual(preview.mock.lastCall?.[0]);
  });
  it("keeps independent ownership for simultaneous fingers and rejects duplicate ownership", () => {
    const first = controller(),
      second = controller(),
      target = panel();
    first.touch.down(pointer(1, target));
    second.touch.down(pointer(1, target));
    expect(second.touch.active.value).toBe(false);
    second.touch.down(pointer(2, target));
    first.touch.down(pointer(3, target));
    expect(first.touch.active.value).toBe(true);
    expect(second.touch.active.value).toBe(true);
    first.touch.move(pointer(2, target, 50, 50));
    expect(first.touch.translation.value).toBe(0);
    first.touch.release(pointer(1, target));
    expect(second.touch.active.value).toBe(true);
  });

  it("translates and rotates in one diagonal swipe and keeps position on release", () => {
    const { touch, send, at } = controller(),
      target = panel();
    touch.down(pointer(4, target));
    at(40);
    touch.move(pointer(4, target, 20, 40));
    expect(touch.translation.value).toBeCloseTo(0.4);
    expect(touch.angularVelocity.value).toBeCloseTo(-17.5);
    touch.release(pointer(4, target));
    expect(send.mock.lastCall?.[0]).toMatchObject({
      active: false,
      translation: 0.4,
    });
    expect(send.mock.lastCall?.[0].angularVelocity).toBeLessThan(0);
    touch.down(pointer(5, target, 120, 120));
    expect(touch.translation.value).toBeCloseTo(0.4);
  });

  it("measures the same swipe speed on 60 Hz and 240 Hz pointer devices", () => {
    const first = controller(),
      second = controller(),
      target = panel();
    first.touch.down(pointer(6, target));
    first.at(4);
    first.touch.move(pointer(6, target, 1, 0));
    second.touch.down(pointer(7, target));
    second.at(16);
    second.touch.move(pointer(7, target, 4, 0));
    expect(first.touch.angularVelocity.value).toBeCloseTo(
      second.touch.angularVelocity.value,
    );
    expect(first.touch.angularVelocity.value).toBeCloseTo(-8.75);
  });

  it("coalesces rapid pointer moves into 30 updates per second, including the local host", () => {
    const { touch, send, at } = controller(), target = panel();
    touch.down(pointer(25, target));
    for (let time = 4; time <= 1000; time += 4) {
      at(time);
      vi.advanceTimersByTime(4);
      touch.move(pointer(25, target, time / 20, time / 100));
    }
    // The initial press is immediate; intermediate pointer samples stay local.
    expect(send.mock.calls.length).toBeGreaterThanOrEqual(29);
    expect(send.mock.calls.length).toBeLessThanOrEqual(31);
    expect(send.mock.calls.every(([input]) => input.active)).toBe(true);
    expect(send.mock.lastCall?.[0].translation).toBeGreaterThan(0.09);
    expect(touch.angularVelocity.value).toBeCloseTo(-1.75);
  });

  it("samples the newest move and refreshes a stationary held rod without waiting for another pointer event", () => {
    const { touch, send, at } = controller(), target = panel();
    touch.down(pointer(26, target));
    at(8); touch.move(pointer(26, target, 1, 10));
    at(16); touch.move(pointer(26, target, 2, 20));
    expect(send).toHaveBeenCalledTimes(1);
    at(34); vi.advanceTimersByTime(34);
    expect(send.mock.lastCall?.[0]).toMatchObject({ translation: 0.2, active: true });
    const count = send.mock.calls.length;
    at(150); vi.advanceTimersByTime(116);
    expect(send.mock.calls.length).toBeGreaterThan(count);
    expect(send.mock.lastCall?.[0]).toMatchObject({ translation: 0.2, active: true });
  });

  it("releases exactly once on cancellation/lostcapture and stops publishing afterward", () => {
    const { touch, send, at } = controller(),
      target = panel(),
      event = pointer(8, target);
    target.releasePointerCapture = () => touch.release(event);
    touch.down(event);
    at(20);
    touch.move(pointer(8, target, 10, 20));
    touch.release(event);
    touch.release(event);
    expect(send.mock.calls.filter(([input]) => !input.active)).toHaveLength(1);
    const count = send.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(send).toHaveBeenCalledTimes(count);
    expect(touch.active.value).toBe(false);
  });

  it("handles rejected pointer capture, inverted movement and clamping safely", () => {
    const { touch, at } = controller(),
      target = panel();
    target.setPointerCapture = () => {
      throw new Error("Pointer already ended");
    };
    expect(() => touch.down(pointer(9, target))).not.toThrow();
    preferences.inverted = true;
    at(10);
    touch.move(pointer(9, target, 1000, 1000));
    expect(touch.translation.value).toBe(1);
    expect(touch.angularVelocity.value).toBe(-35);
    touch.dispose();
    expect(touch.active.value).toBe(false);
  });

  it.each([false, true])("changes only horizontal rotation when inversion is %s", (inverted) => {
    preferences.inverted = inverted;
    const { touch, at } = controller(), target = panel();
    const direction = inverted ? -1 : 1;
    touch.down(pointer(11, target, 100, 100));
    at(40);
    touch.move(pointer(11, target, 120, 140));
    expect(touch.translation.value).toBeCloseTo(0.4);
    expect(touch.angularVelocity.value).toBeCloseTo(17.5 * direction);
    at(80);
    touch.move(pointer(11, target, 100, 100));
    expect(touch.translation.value).toBeCloseTo(0);
    expect(touch.angularVelocity.value).toBeCloseTo(-17.5 * direction);
    at(100);
    touch.move(pointer(11, target, 100, 80));
    expect(touch.translation.value).toBeCloseTo(-0.2);
    expect(touch.angularVelocity.value).toBeCloseTo(0);
  });

  it("starts a fresh gesture at the host position without changing an active finger", () => {
    const { touch, send, at } = controller(), target = panel();
    touch.syncTranslation(-0.7);
    touch.down(pointer(10, target));
    expect(send.mock.lastCall?.[0].translation).toBe(-0.7);
    touch.syncTranslation(0.8);
    at(20);
    touch.move(pointer(10, target, 0, 10));
    expect(touch.translation.value).toBeCloseTo(-0.6);
    touch.release();
    touch.syncTranslation(2);
    expect(touch.translation.value).toBe(1);
    touch.syncTranslation(Number.NaN);
    expect(touch.translation.value).toBe(1);
  });

  it("maps finger pixels directly to physical movement for every rod travel and display scale", () => {
    const target = panel();
    for (const [pixelsPerMeter, travel] of [[150, 0.59], [250, 0.115], [400, 0.34]]) {
      const { touch, at } = controller({ pixelsPerMeter: pixelsPerMeter!, travel: travel! });
      touch.syncTranslation(0.1);
      touch.down(pointer(20, target, 0, 100));
      at(8);
      touch.move(pointer(20, target, 0, 110));
      expect((touch.translation.value - 0.1) * travel!).toBeCloseTo(10 / pixelsPerMeter!);
      touch.release();
    }
  });

  it("anchors displacement through a clamped edge without accumulating drift", () => {
    const { touch, at } = controller({ pixelsPerMeter: 200, travel: 0.5 }), target = panel();
    touch.syncTranslation(0.8);
    touch.down(pointer(21, target, 0, 0));
    at(5); touch.move(pointer(21, target, 0, 100));
    expect(touch.translation.value).toBe(1);
    at(10); touch.move(pointer(21, target, 0, 50));
    expect(touch.translation.value).toBe(1);
    at(15); touch.move(pointer(21, target, 0, 10));
    expect(touch.translation.value).toBeCloseTo(0.9);
    at(20); touch.move(pointer(21, target, 0, -30));
    expect(touch.translation.value).toBeCloseTo(0.5);
  });

  it("publishes a complete sub-frame diagonal swipe before its immediate flick release", () => {
    const { touch, send, at } = controller({ pixelsPerMeter: 200, travel: 0.5 }), target = panel();
    touch.down(pointer(22, target, 0, 0, "pointerdown"));
    at(8);
    touch.release(pointer(22, target, 6, 20, "pointerup"));
    expect(send.mock.calls.map(([input]) => input.active)).toEqual([true, true, false]);
    expect(send.mock.calls[1]![0]).toMatchObject({ translation: 0.2 });
    expect(send.mock.calls[1]![0].angularVelocity).toBeCloseTo(-26.25);
    expect(send.mock.lastCall?.[0]).toMatchObject({ translation: 0.2, active: false, flick: true });
    expect(send.mock.lastCall?.[0].angularVelocity).toBeCloseTo(-26.25);
    expect(send.mock.lastCall?.[0].rotationOnly).toBeUndefined();
  });

  it("flushes a move already sampled by the finger before a same-position quick release", () => {
    const { touch, send, at } = controller({ pixelsPerMeter: 200, travel: 0.5 }), target = panel();
    touch.down(pointer(27, target, 0, 0, "pointerdown"));
    at(8); touch.move(pointer(27, target, 6, 20));
    expect(send).toHaveBeenCalledTimes(1);
    at(10); touch.release(pointer(27, target, 6, 20, "pointerup"));
    expect(send.mock.calls.map(([input]) => input.active)).toEqual([true, true, false]);
    expect(send.mock.calls[1]![0]).toMatchObject({ translation: 0.2 });
    expect(send.mock.calls[1]![0].angularVelocity).toBeCloseTo(-26.25);
    expect(send.mock.lastCall?.[0]).toMatchObject({ translation: 0.2, active: false, flick: true });
    expect(send.mock.lastCall?.[0].angularVelocity).toBeCloseTo(-26.25);
  });

  it("commits a quick vertical release without inventing rotation", () => {
    const { touch, send, at } = controller({ pixelsPerMeter: 200, travel: 0.5 }), target = panel();
    touch.down(pointer(23, target));
    at(6); touch.release(pointer(23, target, 0, -20, "pointerup"));
    expect(send.mock.lastCall?.[0]).toMatchObject({ translation: -0.2, angularVelocity: 0, flick: true, active: false });
  });

  it.each(["pointercancel", "lostpointercapture", undefined])("does not create a release kick after %s", (type) => {
    const { touch, send, at } = controller(), target = panel();
    touch.down(pointer(24, target));
    at(5); touch.move(pointer(24, target, 6, 0));
    touch.release(type ? pointer(24, target, 20, 0, type) : undefined);
    expect(send.mock.lastCall?.[0]).toMatchObject({ active: false });
    expect(send.mock.lastCall?.[0].flick).toBeUndefined();
  });
});
