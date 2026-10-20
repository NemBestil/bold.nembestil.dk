import { afterEach, describe, expect, it, vi } from "vitest";
import { PeerHost } from "../network/PeerHost";
import { INITIAL_MATCH, type TableFrame } from "../shared/types";

vi.mock("peerjs", () => ({ Peer: class { constructor() { throw new Error("Offline signaling"); } } }));
const hosts: PeerHost[] = [];
afterEach(() => { hosts.splice(0).forEach((host) => host.dispose()); vi.useRealTimers(); });
function setup() {
  vi.useFakeTimers();
  const callbacks = { onState: vi.fn(), onStart: vi.fn(), onInput: vi.fn(), onBump: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onReset: vi.fn(), onStatus: vi.fn() };
  const host = new PeerHost(callbacks);
  hosts.push(host);
  const id = host.startLocal({ playerCount: 1, computerOpponent: "normal" });
  const localCallbacks = { onState: vi.fn(), onStatus: vi.fn(), onFrame: vi.fn(), onSound: vi.fn() };
  const local = host.createLocalController(localCallbacks);
  local.start();
  return { host, local, id, callbacks, localCallbacks };
}
describe("phone as authoritative host", () => {
  it("pauses and ends the shared match through the host's logo actions", () => {
    const { host, callbacks, localCallbacks } = setup();
    host.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "playing" });
    expect(host.leaveMatch()?.ok).toBe(false);
    expect(host.pauseMatch()?.ok).toBe(true);
    expect(host.state!.match.phase).toBe("paused");
    expect(callbacks.onPause).toHaveBeenCalledOnce();
    expect(localCallbacks.onState.mock.lastCall?.[0].match.phase).toBe("paused");
    expect(host.leaveMatch()?.ok).toBe(true);
    expect(host.state!.match).toEqual(INITIAL_MATCH);
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(localCallbacks.onState.mock.lastCall?.[0].match.phase).toBe("lobby");
  });
  it("starts singleplayer without importing signaling and keeps the local player connected", () => {
    const { host, local, id, callbacks, localCallbacks } = setup();
    expect(id).toMatch(/^nf-/);
    expect(localCallbacks.onStatus).toHaveBeenCalledWith("connected");
    expect(host.state!.players.filter((p) => !p.computer)).toHaveLength(1);
    local.send({type:"reserve-seat",team:"red",role:"defense"});
    local.send({type:"reserve-seat",team:"red",role:"attack"});
    local.send({ type: "team-name", name: "Hjemmeholdet" });
    local.send({ type: "start-match" });
    expect(callbacks.onStart).toHaveBeenCalledOnce();
    expect(host.state!.match.phase).toBe("countdown");
    vi.advanceTimersByTime(60_000);
    expect(host.state!.players.every((p) => p.connected)).toBe(true);
    expect(callbacks.onPause).not.toHaveBeenCalled();
    host.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "playing" });
    local.send({ type: "rod-input", sequence: 1, rodId: 3, translation: 0.8, angularVelocity: 20, active: false, flick: true });
    expect(callbacks.onInput).toHaveBeenLastCalledWith("red", expect.objectContaining({ rodId: 3, translation: 0.8, flick: true }));
  });
  it("retains the same local session and input when enabling multiplayer fails offline", async () => {
    const { host, local, id, callbacks } = setup();
    local.send({type:"reserve-seat",team:"red",role:"defense"});
    local.send({type:"reserve-seat",team:"red",role:"attack"});
    local.send({ type: "team-name", name: "Hjemmeholdet" });
    const player = host.state!.players.find((p) => !p.computer)!;
    await expect(host.start()).rejects.toThrow("Offline signaling");
    expect(host.state!.sessionId).toBe(id);
    expect(host.state!.teamNames.red).toBe("Hjemmeholdet");
    local.send({ type: "start-match" });
    expect(callbacks.onStart).toHaveBeenCalledOnce();
  });
  it("forwards local cosmetic frames and sounds once, and disposes without timers", () => {
    const { host, localCallbacks, local } = setup();
    const frame: TableFrame = { sequence: 1, time: 10, epoch: 0, phase: "lobby",
      ball: { position: { x: 0, y: 0.033, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
      rods: Array.from({ length: 8 }, () => ({ translation: 0, angle: 0 })),
      kits: { red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" }, blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" } } };
    host.setFrame(frame);
    expect(localCallbacks.onFrame).toHaveBeenCalledOnce();
    host.setSound({ id: 1, kind: "goal", strength: 1 });
    host.setSound({ id: 1, kind: "goal", strength: 1 });
    expect(localCallbacks.onSound).toHaveBeenCalledExactlyOnceWith({ id: 1, kind: "goal", strength: 1 });
    local.dispose();
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not expire the host player when suspended timers resume after a long gap", () => {
    const { host, local } = setup();
    local.send({type:"reserve-seat",team:"red",role:"defense"});
    local.send({type:"reserve-seat",team:"red",role:"attack"});
    local.send({ type: "team-name", name: "Hjemmeholdet" });
    local.send({ type: "start-match" });
    host.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "playing" });
    vi.setSystemTime(Date.now() + 30_000);
    // A new admission also runs expiry, before an interval gets a chance to fire.
    const manager = (host as unknown as { manager: { admit(): unknown } }).manager;
    manager.admit();
    expect(host.state!.players.find((p) => !p.computer)?.connected).toBe(true);
    expect(host.state!.match.phase).toBe("playing");
  });
});
