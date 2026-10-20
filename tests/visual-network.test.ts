import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reactive } from "vue";
import { GameLoop } from "../game/GameLoop";
import {
  isServerMessage,
  isTableFrame,
  NETWORK_CONFIG,
} from "../network/MessageProtocol";
import { PeerController } from "../network/PeerController";
import { PeerHost } from "../network/PeerHost";
import { TableFrameBuffer } from "../network/TableFrameBuffer";
import {
  DEFAULT_SETTINGS,
  INITIAL_MATCH,
  type TableFrame,
} from "../shared/types";

const transport = vi.hoisted(() => ({
  peers: [] as unknown[],
  connections: [] as unknown[],
}));

vi.mock("peerjs", async () => {
  const { EventEmitter } = await import("node:events");
  class Connection extends EventEmitter {
    open = true;
    bufferSize = 0;
    dataChannel = { bufferedAmount: 0 };
    send = vi.fn();
    close = vi.fn(() => {
      this.open = false;
      this.emit("close");
    });
  }
  return {
    Peer: class extends EventEmitter {
      id: string;
      destroyed = false;
      disconnected = false;
      options: { config?: RTCConfiguration } = {};
      constructor(id?: string | object) {
        super();
        this.id = typeof id === "string" ? id : "controller-peer";
        transport.peers.push(this);
        Promise.resolve().then(() => this.emit("open", this.id));
      }
      connect = vi.fn(() => {
        const connection = new Connection();
        transport.connections.push(connection);
        return connection;
      });
      destroy = vi.fn(() => {
        this.destroyed = true;
        this.emit("close");
      });
      reconnect = vi.fn(() => {
        this.disconnected = false;
        this.emit("open", this.id);
      });
    },
  };
});

class IncomingConnection extends EventEmitter {
  open = true;
  bufferSize = 0;
  dataChannel = { bufferedAmount: 0 };
  send = vi.fn();
  close = vi.fn(() => {
    this.open = false;
    this.emit("close");
  });
}
type FakeConnection = IncomingConnection;

function frame(sequence = 1, time = 1_000): TableFrame {
  return {
    sequence,
    time,
    epoch: 0,
    phase: "playing",
    ball: {
      position: { x: 0, y: 0.05, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
    },
    rods: Array.from({ length: 8 }, () => ({ translation: 0, angle: 0 })),
    kits: {
      red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" },
      blue: { primaryColor: "#0000ff", secondaryColor: "#ffffff" },
    },
  };
}
const state = () => ({
  sessionId: "session",
  players: [],
  teamNames: { red: "Rød", blue: "Blå" },
  settings: { ...DEFAULT_SETTINGS },
  match: structuredClone(INITIAL_MATCH),
});
const welcomeMessage = () => ({
  type: "welcome",
  playerId: "player",
  token: "token",
  state: state(),
});
function hostCallbacks() {
  return {
    onState: vi.fn(),
    onStart: vi.fn(),
    onInput: vi.fn(),
    onBump: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onReset: vi.fn(),
    onStatus: vi.fn(),
  };
}
function sentFrames(connection: FakeConnection): TableFrame[] {
  return connection.send.mock.calls
    .map(([message]) => message)
    .filter((message) => message.type === "table-frame")
    .map((message) => message.frame);
}

let monotonic = 0;
beforeEach(() => {
  transport.peers.length = 0;
  transport.connections.length = 0;
  monotonic = 0;
  vi.useFakeTimers({
    toFake: [
      "Date",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ],
  });
  vi.setSystemTime(100_000);
  vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("cosmetic packet validation", () => {
  it("accepts bounded transforms, continuous angles and replay phases", () => {
    const value = frame();
    value.phase = "replay";
    value.rods[0]!.angle = 20 * Math.PI;
    expect(isTableFrame(value)).toBe(true);
    expect(isServerMessage({ type: "table-frame", frame: value })).toBe(true);
    expect(
      isServerMessage({
        type: "table-frame",
        frame: value,
        command: "physics",
      }),
    ).toBe(false);
  });

  it.each([
    [
      "negative sequence",
      (value: TableFrame) => {
        value.sequence = -1;
      },
    ],
    [
      "fractional sequence",
      (value: TableFrame) => {
        value.sequence = 1.5;
      },
    ],
    [
      "unsafe sequence",
      (value: TableFrame) => {
        value.sequence = Number.MAX_SAFE_INTEGER + 1;
      },
    ],
    [
      "invalid epoch",
      (value: TableFrame) => {
        value.epoch = Infinity;
      },
    ],
    [
      "invalid time",
      (value: TableFrame) => {
        value.time = NaN;
      },
    ],
    [
      "missing rod",
      (value: TableFrame) => {
        value.rods.pop();
      },
    ],
    [
      "extra rod",
      (value: TableFrame) => {
        value.rods.push({ translation: 0, angle: 0 });
      },
    ],
    [
      "unbounded translation",
      (value: TableFrame) => {
        value.rods[0]!.translation = 100;
      },
    ],
    [
      "nonfinite angle",
      (value: TableFrame) => {
        value.rods[0]!.angle = Infinity;
      },
    ],
    [
      "nonfinite position",
      (value: TableFrame) => {
        value.ball.position.x = NaN;
      },
    ],
    [
      "unbounded position",
      (value: TableFrame) => {
        value.ball.position.z = 101;
      },
    ],
    [
      "zero quaternion",
      (value: TableFrame) => {
        value.ball.rotation.w = 0;
      },
    ],
    [
      "invalid quaternion",
      (value: TableFrame) => {
        value.ball.rotation.x = 1;
      },
    ],
    [
      "style as color",
      (value: TableFrame) => {
        value.kits.red.primaryColor = "url(https://example.com)";
      },
    ],
    [
      "missing color",
      (value: TableFrame) => {
        delete (value.kits.blue as Partial<typeof value.kits.blue>)
          .secondaryColor;
      },
    ],
    [
      "invalid phase",
      (value: TableFrame) => {
        Object.assign(value, { phase: "simulate" });
      },
    ],
    [
      "extra payload",
      (value: TableFrame) => {
        Object.assign(value.ball, { velocity: [1, 2, 3] });
      },
    ],
  ])("rejects %s", (_name, mutate) => {
    const value = frame();
    mutate(value);
    expect(isTableFrame(value)).toBe(false);
    expect(isServerMessage({ type: "table-frame", frame: value })).toBe(false);
  });
});

describe("PeerController latency", () => {
  it("reports round-trip delay from heartbeats only after admission", async () => {
    const onLatency = vi.fn();
    const controller = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn(), onLatency });
    controller.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as IncomingConnection;
    const now = Date.now();
    connection.emit("data", { type: "pong", at: now - 120 });
    expect(onLatency).not.toHaveBeenCalled();
    connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: state() });
    connection.emit("data", { type: "pong", at: now - 120 });
    expect(onLatency).toHaveBeenLastCalledWith(120);
    connection.emit("data", { type: "pong", at: now + 1 });
    expect(onLatency).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
});

describe("TableFrameBuffer", () => {
  it("interpolates in host time despite a different phone clock, including quaternion and continuous rod rotation", () => {
    const buffer = new TableFrameBuffer();
    const before = frame(1, 10_000);
    before.rods[0]!.angle = 2 * Math.PI + 0.1;
    const after = frame(2, 10_050);
    after.ball.position = { x: 1, y: 0.15, z: -0.5 };
    after.ball.rotation = { x: 0, y: 0, z: 1, w: 0 };
    after.rods[0] = { translation: 0.4, angle: 4 * Math.PI + 0.1 };
    buffer.push(before, 1_000);
    buffer.push(after, 1_050);
    const sampled = buffer.sample(1_070)!;
    expect(sampled.time).toBe(10_025);
    expect(sampled.ball.position.x).toBeCloseTo(0.5);
    expect(sampled.ball.position.y).toBeCloseTo(0.1);
    expect(sampled.ball.position.z).toBeCloseTo(-0.25);
    expect(sampled.ball.rotation.z).toBeCloseTo(Math.SQRT1_2);
    expect(sampled.ball.rotation.w).toBeCloseTo(Math.SQRT1_2);
    expect(sampled.rods[0]!.translation).toBeCloseTo(0.2);
    expect(sampled.rods[0]!.angle).toBeCloseTo(3 * Math.PI + 0.1);
  });

  it("normalizes equivalent opposite-sign quaternions without rotating or producing NaN", () => {
    const buffer = new TableFrameBuffer();
    const after = frame(2, 1_050);
    after.ball.rotation.w = -1;
    buffer.push(frame(1, 1_000), 1_000);
    buffer.push(after, 1_050);
    expect(buffer.sample(1_070)!.ball.rotation).toEqual({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    });
  });

  it("freezes at the newest frame during gaps, reports staleness and retains only a bounded history", () => {
    const buffer = new TableFrameBuffer();
    expect(buffer.isStale()).toBe(true);
    expect(buffer.sample()).toBeNull();
    for (let index = 0; index < 100; index++) {
      const value = frame(index, index * 50);
      value.ball.position.x = index / 100;
      buffer.push(value, index * 50);
    }
    expect(
      (buffer as unknown as { frames: unknown[] }).frames.length,
    ).toBeLessThanOrEqual(5);
    expect(buffer.sample(5_500)!.ball.position.x).toBe(0.99);
    expect(buffer.isStale(5_450)).toBe(false);
    expect(buffer.isStale(5_451)).toBe(true);
    expect(buffer.sample(50_000)!.ball.position.x).toBe(0.99);
  });

  it.each(["epoch", "rewind", "phase", "source gap", "arrival gap"])(
    "snaps across a %s discontinuity",
    (cut) => {
      const buffer = new TableFrameBuffer();
      buffer.push(frame(1, 1_000), 100);
      const after = frame(2, 1_033);
      after.ball.position.x = 1;
      let arrival = 133;
      if (cut === "epoch") after.epoch++;
      if (cut === "rewind") after.time = 500;
      if (cut === "phase") after.phase = "replay";
      if (cut === "source gap") after.time = 1_500;
      if (cut === "arrival gap") arrival = 500;
      buffer.push(after, arrival);
      expect(buffer.sample(arrival)!.ball.position.x).toBe(1);
    },
  );

  it("rejects invalid/out-of-order frames and protects its stored poses from consumers and Vue proxies", () => {
    const buffer = new TableFrameBuffer();
    const value = reactive(frame(5));
    expect(buffer.push(value, 100)).toBe(true);
    value.ball.position.x = 2;
    const sampled = buffer.sample(100)!;
    expect(sampled.ball.position.x).toBe(0);
    sampled.ball.position.x = 3;
    expect(buffer.sample(100)!.ball.position.x).toBe(0);
    expect(buffer.push(frame(5), 110)).toBe(false);
    expect(buffer.push(frame(4), 110)).toBe(false);
    expect(buffer.push(frame(6), NaN)).toBe(false);
    const invalid = frame(6);
    invalid.rods = [];
    expect(buffer.push(invalid, 110)).toBe(false);
    buffer.clear();
    expect(buffer.sample()).toBeNull();
    expect(buffer.isStale()).toBe(true);
    expect(buffer.push(frame(0, 0), 0)).toBe(true);
  });
});

describe("PeerHost table stream", () => {
  it.each([60, 90, 120, 144])("delivers every 60 Hz scheduled pose on a %s Hz display, including short render intervals", async (displayHz) => {
    let nextFrame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { nextFrame = callback; return 1; });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const host = new PeerHost(hostCallbacks());
    await host.start();
    const peer = transport.peers[0] as EventEmitter;
    const connection = new IncomingConnection();
    peer.emit("connection", connection);
    connection.emit("data", { type: "hello", version: 3 });
    let sequence = 0;
    const loop = new GameLoop(() => {}, () => host.setFrame(frame(++sequence, monotonic)), 60);
    loop.start();
    try {
      for (let tick = 1; tick <= displayHz * 2; tick++) {
        monotonic = tick * 1_000 / displayHz;
        nextFrame!(monotonic);
      }
      expect(sequence).toBeGreaterThanOrEqual(119);
      expect(sequence).toBeLessThanOrEqual(121);
      expect(sentFrames(connection)).toHaveLength(sequence);
      expect(sentFrames(connection).at(-1)!.time).toBeCloseTo(monotonic);
      const beforeStall = sequence;
      monotonic += 500;
      nextFrame!(monotonic);
      expect(sequence).toBe(beforeStall + 1);
      expect(sentFrames(connection)).toHaveLength(sequence);
    } finally { loop.dispose(); host.dispose(); }
  });

  it("admits before streaming, caps at 60 Hz, drops queued visual frames and keeps state/pong delivery independent", async () => {
    const host = new PeerHost(hostCallbacks());
    const initial = frame(0, 0);
    host.setFrame(initial);
    initial.ball.position.x = 2;
    await host.start();
    const peer = transport.peers[0] as EventEmitter;
    const admitted = new IncomingConnection();
    const pending = new IncomingConnection();
    const rejected = new IncomingConnection();
    peer.emit("connection", admitted);
    peer.emit("connection", pending);
    peer.emit("connection", rejected);
    rejected.emit("data", { type: "reserve-team", team: "red" });
    admitted.emit("data", { type: "hello", version: 3 });
    const welcomeIndex = admitted.send.mock.calls.findIndex(
      ([message]) => message.type === "welcome",
    );
    expect(admitted.send.mock.calls[welcomeIndex + 1]![0].type).toBe(
      "table-frame",
    );
    expect(sentFrames(admitted)[0]!.ball.position.x).toBe(0);
    for (let index = 1; index <= 34; index++) {
      monotonic = index;
      host.setFrame(frame(index, index));
    }
    expect(sentFrames(admitted).map((value) => value.sequence)).toEqual([
      0, 9, 25,
    ]);
    expect(sentFrames(pending)).toEqual([]);
    expect(sentFrames(rejected)).toEqual([]);

    admitted.dataChannel.bufferedAmount =
      NETWORK_CONFIG.maxFrameBufferedBytes + 1;
    monotonic = 70;
    host.setFrame(frame(35, 70));
    expect(sentFrames(admitted)).toHaveLength(3);
    host.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "playing" });
    expect(admitted.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "state" }),
    );
    admitted.emit("data", { type: "ping", at: 100_000 });
    expect(admitted.send).toHaveBeenCalledWith({ type: "pong", at: 100_000 });
    admitted.dataChannel.bufferedAmount = 0;
    admitted.bufferSize = 1;
    monotonic = 105;
    host.setFrame(frame(36, 105));
    expect(sentFrames(admitted)).toHaveLength(3);
    admitted.bufferSize = 0;
    monotonic = 140;
    host.setFrame(frame(37, 140));
    expect(sentFrames(admitted).map((value) => value.sequence)).toEqual([
      0, 9, 25, 37,
    ]);
    host.setFrame(frame(36, 141));
    expect(sentFrames(admitted)).toHaveLength(4);
    host.dispose();
    host.setFrame(frame(38, 200));
    expect(sentFrames(admitted)).toHaveLength(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maintains 60 Hz across render jitter while bounding bursts and discarding buffered history", async () => {
    const host = new PeerHost(hostCallbacks());
    host.setFrame(frame(0, 0));
    await host.start();
    const peer = transport.peers[0] as EventEmitter;
    const connection = new IncomingConnection();
    peer.emit("connection", connection);
    connection.emit("data", { type: "hello", version: 3 });
    for (let index = 1; index <= 60; index++) {
      monotonic =
        index * NETWORK_CONFIG.tableFrameInterval + (index % 2 ? -0.2 : 0.2);
      host.setFrame(frame(index, monotonic));
    }
    expect(sentFrames(connection)).toHaveLength(61);
    connection.send.mockClear();
    const start = monotonic;
    for (let index = 1; index <= 1_000; index++) {
      monotonic = start + index;
      host.setFrame(frame(60 + index, monotonic));
    }
    expect(sentFrames(connection).length).toBeGreaterThanOrEqual(59);
    expect(sentFrames(connection).length).toBeLessThanOrEqual(62);
    connection.send.mockClear();
    connection.dataChannel.bufferedAmount = NETWORK_CONFIG.maxFrameBufferedBytes + 1;
    for (let index = 1; index <= 60; index++) {
      monotonic += NETWORK_CONFIG.tableFrameInterval;
      host.setFrame(frame(1_060 + index, monotonic));
    }
    expect(sentFrames(connection)).toEqual([]);
    connection.dataChannel.bufferedAmount = 0;
    host.setFrame(frame(1_121, monotonic));
    // Only the current pose survives congestion, with at most one spare frame credit.
    expect(sentFrames(connection).map((value) => value.sequence)).toEqual([1_121]);
    for (let index = 1; index <= 20; index++)
      host.setFrame(frame(1_121 + index, monotonic));
    expect(sentFrames(connection).length).toBeLessThanOrEqual(2);
    host.dispose();
  });

  it("delivers the latest cached pose after a reconnect welcome and never sends to the retired transport", async () => {
    const host = new PeerHost(hostCallbacks());
    await host.start();
    const peer = transport.peers[0] as EventEmitter;
    const original = new IncomingConnection();
    peer.emit("connection", original);
    original.emit("data", { type: "hello", version: 3 });
    const welcome = original.send.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === "welcome");
    host.setFrame(frame(1));
    original.close();
    monotonic = 40;
    host.setFrame(frame(2, 1_040));
    const replacement = new IncomingConnection();
    peer.emit("connection", replacement);
    replacement.emit("data", {
      type: "hello",
      version: 3,
      token: welcome.token,
    });
    expect(sentFrames(replacement).map((value) => value.sequence)).toEqual([2]);
    monotonic = 80;
    host.setFrame(frame(3, 1_080));
    expect(sentFrames(original).map((value) => value.sequence)).toEqual([1]);
    expect(sentFrames(replacement).map((value) => value.sequence)).toEqual([
      2, 3,
    ]);
    host.dispose();
    expect(replacement.listenerCount("data")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("PeerController table stream", () => {
  it("retains 30 Hz control input while receiving a 60 Hz visual stream", async () => {
    const onFrame = vi.fn();
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus: vi.fn(),
      onFrame,
    });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", welcomeMessage());
    expect(NETWORK_CONFIG.inputInterval).toBeCloseTo(1000 / 30);
    expect(NETWORK_CONFIG.tableFrameInterval).toBeCloseTo(1000 / 60);
    for (let sequence = 1; sequence <= 60; sequence++) {
      if (sequence > 1) await vi.advanceTimersByTimeAsync(1000 / 60);
      monotonic = sequence * NETWORK_CONFIG.tableFrameInterval;
      connection.emit("data", { type: "table-frame", frame: frame(sequence, monotonic) });
      client.send({ type: "rod-input", rodId: 0, sequence, translation: sequence / 60, angularVelocity: 0, active: true });
    }
    const inputs = connection.send.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === "rod-input");
    expect(onFrame).toHaveBeenCalledTimes(60);
    expect(inputs.length).toBeGreaterThanOrEqual(29);
    expect(inputs.length).toBeLessThanOrEqual(31);
    expect(inputs.at(-1).sequence).toBeGreaterThanOrEqual(58);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("dispatches validated increasing frames only after welcome, resetting order after reconnect", async () => {
    const onFrame = vi.fn();
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus: vi.fn(),
      onFrame,
    });
    client.start();
    await vi.dynamicImportSettled();
    const first = transport.connections[0] as FakeConnection;
    first.emit("open");
    first.emit("data", { type: "table-frame", frame: frame(100) });
    expect(onFrame).not.toHaveBeenCalled();
    first.emit("data", welcomeMessage());
    for (const sequence of [2, 2, 1, 3])
      first.emit("data", { type: "table-frame", frame: frame(sequence) });
    const invalid = frame(4);
    invalid.ball.position.x = NaN;
    first.emit("data", { type: "table-frame", frame: invalid });
    first.emit("data", { type: "table-frame", frame: frame(4) });
    expect(onFrame.mock.calls.map(([value]) => value.sequence)).toEqual([
      2, 3, 4,
    ]);
    first.close();
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.reconnectDelay);
    const second = transport.connections[1] as FakeConnection;
    second.emit("open");
    second.emit("data", welcomeMessage());
    second.emit("data", { type: "table-frame", frame: frame(0) });
    first.emit("data", { type: "table-frame", frame: frame(101) });
    expect(onFrame.mock.calls.map(([value]) => value.sequence)).toEqual([
      2, 3, 4, 0,
    ]);
    client.dispose();
    expect(second.listenerCount("data")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let visual updates conceal a failed critical heartbeat", async () => {
    const onStatus = vi.fn();
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus,
      onFrame: vi.fn(),
    });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", welcomeMessage());
    for (let sequence = 1; sequence <= 34; sequence++) {
      await vi.advanceTimersByTimeAsync(300);
      connection.emit("data", {
        type: "table-frame",
        frame: frame(sequence, sequence * 300),
      });
    }
    expect(connection.close).toHaveBeenCalledOnce();
    expect(onStatus).toHaveBeenCalledWith("reconnecting", expect.any(String));
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('desktop spectators',()=>{
  it('joins a full game, receives authoritative poses and cannot issue player or host commands',async()=>{
    const callbacks=hostCallbacks();const host=new PeerHost(callbacks);await host.start();
    const peer=transport.peers[0] as EventEmitter;
    const phones=Array.from({length:4},()=>new IncomingConnection());
    for(const connection of phones){peer.emit('connection',connection);connection.emit('data',{type:'hello',version: 3});}
    host.setMatch({...structuredClone(INITIAL_MATCH),phase:'playing'});
    const before=host.state;
    const viewer=new IncomingConnection();peer.emit('connection',viewer);viewer.emit('data',{type:'hello',version: 3,role:'spectator'});
    expect(viewer.send).toHaveBeenCalledWith({type:'spectator-welcome',state:before});
    for(const message of [{type:'reserve-seat',team:'red',role:'defense'},{type:'start-match'},{type:'pause',paused:true},{type:'update-settings',settings:{goalsToWin:10}},{type:'rod-input',rodId:0,sequence:1,translation:1,angularVelocity:20,active:true}]) viewer.emit('data',message);
    expect(host.state).toEqual(before);
    expect(callbacks.onInput).not.toHaveBeenCalled();expect(callbacks.onStart).not.toHaveBeenCalled();expect(callbacks.onPause).not.toHaveBeenCalled();
    const pose={...frame(),camera:{position:{x:2,y:3,z:4},rotation:{x:0,y:0,z:0,w:1},aspect:1.6,fov:38},scores:{red:2,blue:1},goalsToWin:5};
    host.setFrame(pose);
    expect(sentFrames(viewer)).toEqual([pose]);
    viewer.close();expect(host.state).toEqual(before);host.dispose();expect(vi.getTimerCount()).toBe(0);
  });
  it('does not load or store controller credentials and sends only its read-only hello and heartbeat',async()=>{
    const storage={getItem:vi.fn(()=>'controller-token'),setItem:vi.fn(),removeItem:vi.fn()};vi.stubGlobal('localStorage',storage);
    const onState=vi.fn(),onFrame=vi.fn();const viewer=new PeerController({sessionId:`nf-${crypto.randomUUID()}`,role:'spectator',onState,onFrame,onStatus:vi.fn()});viewer.start();await vi.dynamicImportSettled();
    const connection=transport.connections[0] as FakeConnection;connection.emit('open');
    expect(connection.send).toHaveBeenCalledWith({type:'hello',version: 3,role:'spectator'});
    connection.emit('data',{type:'spectator-welcome',state:state()});
    connection.emit('data',{type:'table-frame',frame:frame()});
    expect(onState).toHaveBeenCalledWith(state(),'');expect(onFrame).toHaveBeenCalledOnce();
    viewer.send({type:'start-match'});viewer.send({type:'pause',paused:true});
    expect(connection.send).toHaveBeenCalledTimes(1);expect(storage.getItem).not.toHaveBeenCalled();expect(storage.setItem).not.toHaveBeenCalled();viewer.dispose();
  });
  it('interpolates host camera transforms and isolates scores and camera objects from callers',()=>{
    const first={...frame(1,1000),camera:{position:{x:2,y:3,z:4},rotation:{x:0,y:0,z:0,w:1},aspect:1.6,fov:38},scores:{red:1,blue:0},goalsToWin:5};
    const second=structuredClone(first);second.sequence=2;second.time=1100;second.camera.position.x=4;
    const buffer=new TableFrameBuffer();buffer.push(first,1000);buffer.push(second,1100);
    const sampled=buffer.sample(1100)!;
    expect(sampled.camera!.position.x).toBeGreaterThan(2);expect(sampled.camera!.position.x).toBeLessThan(4);
    sampled.camera!.position.x=99;sampled.scores!.red=99;
    expect(buffer.sample(1100)!.scores!.red).toBe(1);expect(buffer.sample(1100)!.camera!.position.x).toBeLessThan(4);
  });
  it.each([
    {camera:{position:{x:2,y:3,z:4},rotation:{x:0,y:0,z:0,w:1},aspect:NaN,fov:38}},
    {camera:{position:{x:Infinity,y:3,z:4},rotation:{x:0,y:0,z:0,w:1},aspect:1.6,fov:38}},
    {scores:{red:999,blue:0}},{goalsToWin:999},
  ])('rejects unbounded spectator metadata %j',extra=>expect(isTableFrame({...frame(),...extra})).toBe(false));
});
