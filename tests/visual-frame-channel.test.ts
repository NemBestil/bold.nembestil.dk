import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataConnection } from "peerjs";
import {
  VisualFrameChannel,
  VISUAL_FRAME_CHANNEL_ID,
  VISUAL_FRAME_CHANNEL_LABEL,
  VISUAL_FRAME_CHANNEL_READY,
} from "../network/VisualFrameChannel";
import { PeerController } from "../network/PeerController";
import { PeerHost } from "../network/PeerHost";
import { DEFAULT_SETTINGS, INITIAL_MATCH, type TableFrame } from "../shared/types";

const transport = vi.hoisted(() => ({ peers: [] as EventEmitter[], connections: [] as unknown[] }));

class NativeChannel extends EventTarget {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  send = vi.fn();
  close = vi.fn(() => { this.readyState = "closed"; this.dispatchEvent(new Event("close")); });
  open() { this.readyState = "open"; this.dispatchEvent(new Event("open")); }
  receive(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data })); }
}

class NativeConnection {
  channel = new NativeChannel();
  createDataChannel = vi.fn(() => this.channel as unknown as RTCDataChannel);
  asRTC() { return this as unknown as RTCPeerConnection; }
}

class ReliableConnection extends EventEmitter {
  open = true;
  dataChannel = { bufferedAmount: 0 };
  bufferSize = 0;
  native = new NativeConnection();
  peerConnection = this.native.asRTC();
  send = vi.fn();
  close = vi.fn(() => { this.open = false; this.emit("close"); });
}

vi.mock("peerjs", async () => {
  const { EventEmitter } = await import("node:events");
  return { Peer: class extends EventEmitter {
    destroyed = false;
    disconnected = false;
    options = {};
    constructor() { super(); transport.peers.push(this); Promise.resolve().then(() => this.emit("open", "phone")); }
    connect() { const connection = new ReliableConnection(); transport.connections.push(connection); return connection; }
    destroy() { this.destroyed = true; }
    reconnect() {}
  } };
});

function frame(sequence = 1): TableFrame {
  return {
    sequence, time: sequence * 1000 / 60, epoch: 0, phase: "playing",
    ball: { position: { x: 0, y: 0.05, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } },
    rods: Array.from({ length: 8 }, () => ({ translation: 0, angle: 0 })),
    kits: { red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" }, blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" } },
  };
}
const envelope = (sequence = 1) => JSON.stringify({ type: "table-frame", frame: frame(sequence) });
const state = () => ({ sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: { ...DEFAULT_SETTINGS }, match: structuredClone(INITIAL_MATCH) });

beforeEach(() => {
  vi.useFakeTimers();
  transport.peers.length = transport.connections.length = 0;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("optional visual data channel", () => {
  it("uses a negotiated unordered channel without retransmissions and waits for the exact receiver acknowledgement", () => {
    const connection = new NativeConnection();
    const sender = new VisualFrameChannel(connection.asRTC(), "sender");
    expect(connection.createDataChannel).toHaveBeenCalledWith(VISUAL_FRAME_CHANNEL_LABEL, {
      negotiated: true, id: VISUAL_FRAME_CHANNEL_ID, ordered: false, maxRetransmits: 0,
    });
    expect(sender.send(frame())).toBe("unavailable");
    connection.channel.open();
    connection.channel.receive("ready");
    expect(sender.send(frame())).toBe("unavailable");
    connection.channel.receive(VISUAL_FRAME_CHANNEL_READY);
    expect(sender.send(frame())).toBe("sent");
    expect(connection.channel.send).toHaveBeenCalledExactlyOnceWith(envelope());
    sender.dispose();
  });

  it("acknowledges on open and delivers only valid snapshot envelopes", () => {
    const connection = new NativeConnection();
    const onFrame = vi.fn();
    const receiver = new VisualFrameChannel(connection.asRTC(), "receiver", onFrame);
    connection.channel.open();
    expect(connection.channel.send).toHaveBeenCalledExactlyOnceWith(VISUAL_FRAME_CHANNEL_READY);
    for (const raw of ["{", "x".repeat(16_301), new ArrayBuffer(8), JSON.stringify({ type: "pong", at: 1 }), JSON.stringify({ type: "table-frame", frame: { sequence: 1 } })])
      connection.channel.receive(raw);
    expect(onFrame).not.toHaveBeenCalled();
    connection.channel.receive(envelope());
    expect(onFrame).toHaveBeenCalledExactlyOnceWith(frame());
    receiver.dispose();
  });

  it("drops snapshots whenever one is already queued and recovers without accumulating a backlog", () => {
    const connection = new NativeConnection();
    const sender = new VisualFrameChannel(connection.asRTC(), "sender");
    connection.channel.open(); connection.channel.receive(VISUAL_FRAME_CHANNEL_READY);
    connection.channel.bufferedAmount = 1;
    for (let sequence = 1; sequence <= 100; sequence++) expect(sender.send(frame(sequence))).toBe("dropped");
    expect(connection.channel.send).not.toHaveBeenCalled();
    connection.channel.bufferedAmount = 0;
    expect(sender.send(frame(101))).toBe("sent");
    expect(connection.channel.send).toHaveBeenCalledExactlyOnceWith(envelope(101));
    sender.dispose();
  });

  it("retries a lost acknowledgement until a native snapshot confirms delivery, then stops", async () => {
    const connection = new NativeConnection();
    const receiver = new VisualFrameChannel(connection.asRTC(), "receiver", vi.fn());
    connection.channel.open();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connection.channel.send).toHaveBeenCalledTimes(3);
    connection.channel.receive(envelope());
    await vi.advanceTimersByTimeAsync(1_000);
    expect(connection.channel.send).toHaveBeenCalledTimes(3);
    receiver.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("falls back on unsupported APIs, creation errors and send errors, and detaches listeners on disposal", () => {
    expect(new VisualFrameChannel(undefined, "sender").send(frame())).toBe("unavailable");
    const failed = new NativeConnection();
    failed.createDataChannel.mockImplementation(() => { throw new Error("id unavailable"); });
    expect(new VisualFrameChannel(failed.asRTC(), "sender").send(frame())).toBe("unavailable");
    const connection = new NativeConnection();
    const sender = new VisualFrameChannel(connection.asRTC(), "sender");
    connection.channel.open(); connection.channel.receive(VISUAL_FRAME_CHANNEL_READY);
    connection.channel.send.mockImplementation(() => { throw new Error("closed"); });
    expect(sender.send(frame())).toBe("unavailable");
    expect(connection.channel.close).toHaveBeenCalledOnce();
    connection.channel.readyState = "open";
    connection.channel.receive(VISUAL_FRAME_CHANNEL_READY);
    expect(sender.send(frame())).toBe("unavailable");
    sender.dispose();
    expect(connection.channel.close).toHaveBeenCalledOnce();
    const receiverConnection = new NativeConnection();
    const onFrame = vi.fn();
    const receiver = new VisualFrameChannel(receiverConnection.asRTC(), "receiver", onFrame);
    receiverConnection.channel.open();
    receiverConnection.channel.dispatchEvent(new Event("error"));
    receiverConnection.channel.readyState = "open";
    receiverConnection.channel.receive(envelope());
    expect(onFrame).not.toHaveBeenCalled();
    receiver.dispose();
  });
});

describe("visual channel transport integration", () => {
  it("retains reliable fallback until capability acknowledgement and never falls back for native congestion", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const host = new PeerHost({ onState: vi.fn(), onStatus: vi.fn(), onInput: vi.fn(), onStart: vi.fn(), onBump: vi.fn(), onPause: vi.fn(), onResume: vi.fn(), onReset: vi.fn() });
    host.startLocal();
    const connection = new ReliableConnection();
    (host as unknown as { acceptConnection(connection: DataConnection): void }).acceptConnection(connection as unknown as DataConnection);
    connection.emit("data", { type: "hello", version: 3 });
    connection.native.channel.open();
    const reliableFrames = () => connection.send.mock.calls.map(([message]) => message).filter(message => message.type === "table-frame");
    host.setFrame(frame(1));
    now = 20; host.setFrame(frame(2));
    expect(reliableFrames().map(message => message.frame.sequence)).toEqual([1, 2]);
    connection.native.channel.receive(VISUAL_FRAME_CHANNEL_READY);
    now = 40; host.setFrame(frame(3));
    expect(connection.native.channel.send).toHaveBeenLastCalledWith(envelope(3));
    connection.native.channel.bufferedAmount = 1;
    now = 60; host.setFrame(frame(4));
    expect(reliableFrames()).toHaveLength(2);
    connection.emit("data", { type: "ping", at: 123 });
    expect(connection.send).toHaveBeenLastCalledWith({ type: "pong", at: 123 });
    connection.native.channel.close();
    now = 80; host.setFrame(frame(5));
    expect(reliableFrames().at(-1)?.frame.sequence).toBe(5);
    host.dispose();
    expect(connection.close).toHaveBeenCalledOnce();
  });

  it("gates native frames on welcome, deduplicates both transports together, and cleans up on reconnect", async () => {
    const onFrame = vi.fn(), onState = vi.fn();
    const controller = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState, onStatus: vi.fn(), onFrame });
    controller.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as ReliableConnection;
    connection.emit("open");
    connection.native.channel.open();
    connection.native.channel.receive(envelope(10));
    expect(onFrame).not.toHaveBeenCalled();
    connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: state() });
    connection.native.channel.receive(envelope(2));
    connection.native.channel.receive(envelope(1));
    connection.emit("data", { type: "table-frame", frame: frame(2) });
    connection.emit("data", { type: "table-frame", frame: frame(3) });
    connection.native.channel.receive(envelope(4));
    expect(onFrame.mock.calls.map(([value]) => value.sequence)).toEqual([2, 3, 4]);
    connection.emit("data", { type: "state", state: state() });
    expect(onState).toHaveBeenCalledTimes(2);
    controller.reconnect();
    expect(connection.native.channel.close).toHaveBeenCalledOnce();
    await vi.dynamicImportSettled();
    const replacement = transport.connections[1] as ReliableConnection;
    replacement.emit("open"); replacement.native.channel.open();
    replacement.emit("data", { type: "welcome", playerId: "player", token: "token", state: state() });
    replacement.native.channel.receive(envelope(1));
    expect(onFrame.mock.calls.at(-1)?.[0].sequence).toBe(1);
    controller.dispose();
    expect(replacement.native.channel.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
