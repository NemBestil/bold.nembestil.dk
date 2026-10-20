import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type {
  SessionCallbacks,
  SessionManager,
} from "../network/SessionManager";
import type { ServerMessage } from "../network/MessageProtocol";
import { NETWORK_CONFIG } from "../network/MessageProtocol";
import { INITIAL_MATCH } from "../shared/types";
import { PeerHost } from "../network/PeerHost";
import { PeerController } from "../network/PeerController";
import { createSecureId } from "../network/identifiers";

const transport = vi.hoisted(() => ({
  peers: [] as unknown[],
  connections: [] as unknown[],
}));

vi.mock("peerjs", async () => {
  const { EventEmitter } = await import("node:events");
  class Connection extends EventEmitter {
    open = true;
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
      options: { config?: RTCConfiguration };
      constructor(id?: string | object, options?: { config?: RTCConfiguration }) {
        super();
        this.id = typeof id === "string" ? id : "controller-peer";
        this.options = typeof id === "object" ? id : options ?? {};
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

interface FakePeer extends EventEmitter {
  options: { config?: RTCConfiguration };
  connect: ReturnType<typeof vi.fn>;
  destroyed: boolean;
}
interface FakeConnection extends EventEmitter {
  open: boolean;
  dataChannel: { bufferedAmount: number };
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}
class IncomingConnection extends EventEmitter implements FakeConnection {
  open = true;
  dataChannel = { bufferedAmount: 0 };
  send = vi.fn();
  close = vi.fn(() => {
    this.open = false;
    this.emit("close");
  });
}
function callbacks(): SessionCallbacks {
  return {
    onState: vi.fn(),
    onStart: vi.fn(),
    onInput: vi.fn(),
    onBump: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onReset: vi.fn(),
  };
}
function welcome(connection: FakeConnection) {
  return connection.send.mock.calls
    .map((call) => call[0] as ServerMessage)
    .find((message) => message.type === "welcome") as Extract<
    ServerMessage,
    { type: "welcome" }
  >;
}

beforeEach(() => {
  transport.peers.length = 0;
  transport.connections.length = 0;
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
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("creates unpredictable UUID-shaped IDs on LAN HTTP with getRandomValues when randomUUID is unavailable", () => {
  const getRandomValues = vi.fn((array: Uint8Array) => {
    array.fill(0xab);
    return array;
  });
  vi.stubGlobal("crypto", { getRandomValues });
  expect(createSecureId()).toBe("abababab-abab-4bab-abab-abababababab");
  expect(getRandomValues).toHaveBeenCalledOnce();
});

describe("PeerHost transport ownership", () => {
  it("allows a slow TURN negotiation before starting the application handshake timeout", async () => {
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    await host.start();
    const peer = transport.peers[0] as FakePeer;
    const connection = new IncomingConnection();
    connection.open = false;
    peer.emit("connection", connection);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(connection.close).not.toHaveBeenCalled();

    connection.open = true;
    connection.emit("open");
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.handshakeTimeout - 1_000);
    expect(connection.close).not.toHaveBeenCalled();
    connection.emit("data", { type: "hello", version: 3 });
    expect(welcome(connection)?.playerId).toBeTruthy();
    expect(host.state?.players[0]?.connected).toBe(true);
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a data channel that never opens by the negotiation timeout", async () => {
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    await host.start();
    const peer = transport.peers[0] as FakePeer;
    const connection = new IncomingConnection();
    connection.open = false;
    peer.emit("connection", connection);
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.connectionTimeout - 1);
    expect(connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.close).toHaveBeenCalledOnce();
    expect(host.state?.players.filter(player=>!player.computer)).toHaveLength(0);
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("expires the hello handshake from channel opening rather than offer acceptance", async () => {
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    await host.start();
    const peer = transport.peers[0] as FakePeer;
    const connection = new IncomingConnection();
    connection.open = false;
    peer.emit("connection", connection);
    await vi.advanceTimersByTimeAsync(10_000);
    connection.open = true;
    connection.emit("open");
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.handshakeTimeout - 1);
    expect(connection.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(connection.close).toHaveBeenCalledOnce();
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("configures Cloudflare TURN on host and phone without forcing relay traffic", async () => {
    const iceServers = [{ urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "temporary", credential: "temporary" }];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({
      iceServers, expiresAt: Date.now() + 86_400_000,
    }))));
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    await host.start();
    const controller = new PeerController({ sessionId: host.state!.sessionId, onState: vi.fn(), onStatus: vi.fn() });
    controller.start();
    await vi.dynamicImportSettled();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(transport.peers).toHaveLength(2);
    for (const peer of transport.peers as FakePeer[])
      expect(peer.options.config).toEqual({ iceServers, iceTransportPolicy: "all" });
    controller.dispose();
    host.dispose();
  });

  it("refreshes a long-running host's ICE settings without replacing the session or Peer", async () => {
    let generation = 0;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(Response.json({
      iceServers: [{ urls: "turn:turn.cloudflare.com:3478?transport=udp", username: `lease-${++generation}`, credential: "temporary" }],
      expiresAt: Date.now() + 600_000,
    }))));
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    const id = await host.start();
    const peer = transport.peers[0] as FakePeer;
    expect(peer.options.config!.iceServers![0]!.username).toBe("lease-1");
    await vi.advanceTimersByTimeAsync(300_000);
    expect(peer.options.config!.iceServers![0]!.username).toBe("lease-2");
    expect(transport.peers).toEqual([peer]);
    expect(host.state!.sessionId).toBe(id);
    host.dispose();
  });

  it("does not create a host or phone Peer after disposal during credential fetching", async () => {
    const resolvers: ((response: Response) => void)[] = [];
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise((resolve) => resolvers.push(resolve))));
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    const started = host.start();
    const rejected = expect(started).rejects.toThrow("Sessionen er lukket");
    const controller = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn() });
    controller.start();
    host.dispose();
    controller.dispose();
    for (const resolve of resolvers) resolve(new Response(null, { status: 503 }));
    await rejected;
    await vi.dynamicImportSettled();
    expect(transport.peers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never fetches TURN credentials for local play", () => {
    vi.stubGlobal("fetch", vi.fn());
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    host.startLocal();
    expect(fetch).not.toHaveBeenCalled();
    host.dispose();
  });
  it("reopens a closed invitation without replacing the phone's local session", async () => {
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    const id = host.startLocal({ playerCount: 1, computerOpponent: "normal" });
    const local = host.createLocalController({ onState: vi.fn(), onStatus: vi.fn() });
    local.start();
    const localId = host.state!.players.find((p) => !p.computer)!.id;
    await host.start();
    const first = transport.peers[0] as FakePeer;
    first.emit("close");
    expect(await host.start()).toBe(id);
    expect(transport.peers).toHaveLength(2);
    expect(host.state!.players.find((p) => p.id === localId)?.connected).toBe(true);
    expect(host.state!.sessionId).toBe(id);
    host.dispose();
  });
  it("admits an unseated controller and lets it select roles without host setup",async()=>{
    const host=new PeerHost({...callbacks(),onStatus:vi.fn()});await host.start();
    const peer=transport.peers[0] as FakePeer;const connection=new IncomingConnection();peer.emit("connection",connection);connection.emit("data",{type:"hello",version: 3});
    expect(welcome(connection).state.players.find(player=>!player.computer)).toMatchObject({team:null,rodIds:[],admin:true});
    connection.emit("data",{type:"reserve-seat",team:"red",role:"attack"});
    expect(host.state?.players.find(player=>!player.computer)).toMatchObject({team:"red",rodIds:[2,3]});
    host.dispose();expect(vi.getTimerCount()).toBe(0);
  });

  it("admits four real transports after host setup and rejects a fifth without evicting players", async () => {
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    await host.start();
    expect(host.configureLobby({ playerCount: 4 }).ok).toBe(true);
    const peer = transport.peers[0] as FakePeer;
    const connections = Array.from(
      { length: 5 },
      () => new IncomingConnection(),
    );
    for (const connection of connections) {
      peer.emit("connection", connection);
      connection.emit("data", { type: "hello", version: 3 });
    }
    expect(
      connections.slice(0, 4).every((connection) => !!welcome(connection)),
    ).toBe(true);
    expect(welcome(connections[4]!)).toBeUndefined();
    expect(host.state?.players.filter(player=>!player.computer)).toHaveLength(4);
    expect(host.state?.players.filter(player=>!player.computer)).toHaveLength(4);
    expect(host.state?.players.filter(player=>!player.computer)).toHaveLength(4);
    host.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not let a late close from an expired transport disconnect its token-authenticated replacement", async () => {
    const actions = callbacks();
    const host = new PeerHost({ ...actions, onStatus: vi.fn() });
    await host.start();
    const peer = transport.peers[0] as FakePeer;
    const original = new IncomingConnection();
    peer.emit("connection", original);
    original.emit("data", { type: "hello", version: 3 });
    const admission = welcome(original);
    expect(admission.token).toBeTruthy();
    host.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "playing" });

    // The authoritative lease expired just before the transport's close event.
    vi.setSystemTime(Date.now() + NETWORK_CONFIG.heartbeatTimeout + 1);
    const manager = (host as unknown as { manager: SessionManager }).manager;
    manager.expire();
    expect(manager.state.players[0]?.connected).toBe(false);

    const replacement = new IncomingConnection();
    peer.emit("connection", replacement);
    replacement.emit("data", {
      type: "hello",
      version: 3,
      token: admission.token,
    });
    expect(welcome(replacement).playerId).toBe(admission.playerId);
    original.emit("close");
    expect(manager.state.players[0]?.connected).toBe(true);
    expect(original.close).toHaveBeenCalledOnce();
    replacement.emit("close");
    expect(manager.state.players[0]?.connected).toBe(false);
    host.dispose();
  });

  it.each(["replay", "paused"] as const)("cleans up a departing controller without changing a completed %s", async (phase) => {
    const actions = callbacks();
    const onStatus = vi.fn();
    const host = new PeerHost({ ...actions, onStatus });
    await host.start();
    const peer = transport.peers[0] as FakePeer;
    const departing = new IncomingConnection(), remaining = new IncomingConnection();
    for (const connection of [departing, remaining]) {
      peer.emit("connection", connection);
      connection.emit("data", { type: "hello", version: 3 });
    }
    const playerId = welcome(departing).playerId;
    departing.emit("data", { type: "reserve-seat", team: "red", role: "defense" });
    remaining.emit("data", { type: "reserve-seat", team: "blue", role: "attack" });
    departing.emit("data", { type: "start-match" });
    host.setMatch({ ...structuredClone(INITIAL_MATCH), phase: "playing" });
    const completed = {
      ...structuredClone(INITIAL_MATCH),
      phase,
      scores: { red: 5, blue: 3 },
      winner: "red" as const,
      notice: "Mål 4/8",
      replay: {
        progress: 0.5,
        slowMotion: false,
        fullMatch: true,
        mode: "full" as const,
        playing: phase === "replay",
        time: 50,
        duration: 100,
        goalIndex: 4,
        goalCount: 8,
        scores: { red: 2, blue: 2 },
      },
    };
    host.setMatch(completed);
    onStatus.mockClear();
    (actions.onInput as ReturnType<typeof vi.fn>).mockClear();
    departing.send.mockClear();
    remaining.send.mockClear();

    departing.close();

    expect(host.state?.players.find(player => player.id === playerId)?.connected).toBe(false);
    expect(host.state?.match).toEqual(completed);
    expect(remaining.send).toHaveBeenCalledWith(expect.objectContaining({
      type: "state",
      state: expect.objectContaining({ match: completed }),
    }));
    expect(departing.send).not.toHaveBeenCalled();
    expect(onStatus).not.toHaveBeenCalled();
    expect(actions.onInput).not.toHaveBeenCalled();
    expect(actions.onPause).not.toHaveBeenCalled();
    expect(actions.onResume).not.toHaveBeenCalled();
    expect(actions.onReset).not.toHaveBeenCalled();
    host.dispose();
    expect(departing.close).toHaveBeenCalledOnce();
    expect(remaining.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("makes a rejected handshake terminal and releases every transport on disposal", async () => {
    const host = new PeerHost({ ...callbacks(), onStatus: vi.fn() });
    await host.start();
    const peer = transport.peers[0] as FakePeer;
    const first = new IncomingConnection();
    peer.emit("connection", first);
    first.emit("data", { type: "reserve-team", team: "red" });
    first.emit("data", { type: "hello", version: 3 });
    expect(welcome(first)).toBeUndefined();
    expect(first.send).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", fatal: true }),
    );
    await vi.advanceTimersByTimeAsync(200);
    expect(first.close).toHaveBeenCalledOnce();
    const second = new IncomingConnection();
    peer.emit("connection", second);
    second.emit("data", { type: "hello", version: 3 });
    expect(welcome(second)).toBeDefined();
    host.dispose();
    expect(second.close).toHaveBeenCalledOnce();
    expect(peer.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

it("delivers live sound events only after welcome and rejects stale or malformed sounds", async () => {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  const onSound = vi.fn();
  const client = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn(), onSound });
  client.start();
  await vi.dynamicImportSettled();
  const connection = transport.connections[0] as FakeConnection;
  connection.emit("open");
  const sound = { type: "game-sound", event: { id: 1, kind: "goal", strength: 1 } };
  connection.emit("data", sound);
  expect(onSound).not.toHaveBeenCalled();
  connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} } });
  connection.emit("data", sound);
  connection.emit("data", sound);
  connection.emit("data", { type: "game-sound", event: { id: 2, kind: "wall", strength: Infinity } });
  expect(onSound).toHaveBeenCalledExactlyOnceWith(sound.event);
  client.dispose();
});

describe("PeerController delivery", () => {
  it("sends the first input and already spaced 30 Hz samples without adding another input interval", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const client = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn() });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} } });
    const inputs = () => connection.send.mock.calls.map(([message]) => message).filter((message) => message.type === "rod-input");
    for (let sequence = 1; sequence <= 30; sequence++) {
      if (sequence > 1) await vi.advanceTimersByTimeAsync(Math.ceil(NETWORK_CONFIG.inputInterval));
      client.send({ type: "rod-input", rodId: 0, sequence, translation: sequence / 30, angularVelocity: 0, active: true });
      expect(inputs()).toHaveLength(sequence);
      expect(inputs().at(-1)?.sequence).toBe(sequence);
    }
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("replaces burst samples while waiting only for the remainder of the current rod's rate window", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const client = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn() });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} } });
    const move = { type: "rod-input" as const, rodId: 0, sequence: 1, translation: 0, angularVelocity: 0, active: true };
    const inputs = () => connection.send.mock.calls.map(([message]) => message).filter((message) => message.type === "rod-input");
    client.send(move);
    await vi.advanceTimersByTimeAsync(10);
    client.send({ ...move, sequence: 2, translation: 0.2 });
    await vi.advanceTimersByTimeAsync(10);
    client.send({ ...move, sequence: 3, translation: 0.3 });
    client.send({ ...move, rodId: 1, sequence: 4, translation: 0.4 });
    expect(inputs().map((input) => input.sequence)).toEqual([1, 4]);
    await vi.advanceTimersByTimeAsync(Math.floor(NETWORK_CONFIG.inputInterval) - 20);
    expect(inputs().map((input) => input.sequence)).toEqual([1, 4]);
    await vi.advanceTimersByTimeAsync(1);
    expect(inputs().map((input) => input.sequence)).toEqual([1, 4, 3]);
    client.dispose();
  });

  it("discards a queued move when the finger returns to the last transmitted pose", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const client = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn() });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} } });
    const move = { type: "rod-input" as const, rodId: 0, sequence: 1, translation: 0, angularVelocity: 0, active: true };
    client.send(move);
    client.send({ ...move, sequence: 2, translation: 0.2 });
    client.send({ ...move, sequence: 3 });
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.inputInterval + 1);
    expect(connection.send.mock.calls.map(([message]) => message).filter((message) => message.type === "rod-input")).toEqual([move]);
    client.dispose();
  });

  it("coalesces a 120 Hz input stream to 30 updates per rod and sends the latest queued pose", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const client = new PeerController({ sessionId: `nf-${crypto.randomUUID()}`, onState: vi.fn(), onStatus: vi.fn() });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", { type: "welcome", playerId: "player", token: "token", state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} } });
    const inputs = () => connection.send.mock.calls.map(([message]) => message).filter((message) => message.type === "rod-input");
    let sequence = 0;
    for (let sample = 0; sample < 120; sample++) {
      for (const rodId of [0, 1]) client.send({ type: "rod-input", sequence: ++sequence, rodId, translation: sample / 120, angularVelocity: sample / 4, active: true });
      await vi.advanceTimersByTimeAsync(1000 / 120);
    }
    for (const rodId of [0, 1]) {
      const sent = inputs().filter((input) => input.rodId === rodId);
      expect(sent.length).toBeGreaterThanOrEqual(28);
      expect(sent.length).toBeLessThanOrEqual(31);
    }
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.inputInterval + 1);
    for (const rodId of [0, 1]) expect(inputs().filter((input) => input.rodId === rodId).at(-1)).toMatchObject({ translation: 119 / 120, angularVelocity: 119 / 4 });
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes the final same-rod move before an intentional flick without flushing another finger", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus: vi.fn(),
    });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", {
      type: "welcome",
      playerId: "player",
      token: "token",
      state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} },
    });
    const finalMove = {
      type: "rod-input" as const,
      rodId: 0,
      sequence: 3,
      translation: 0.8,
      angularVelocity: 28,
      active: true,
    };
    client.send({ ...finalMove, sequence: 1, translation: 0 });
    client.send({ ...finalMove, rodId: 1, sequence: 2, translation: 0 });
    connection.send.mockClear();
    const otherFinger = { ...finalMove, rodId: 1, sequence: 4 };
    client.send(finalMove);
    client.send(otherFinger);
    const flick = {
      ...finalMove,
      sequence: 5,
      active: false,
      flick: true,
      rotationOnly: true,
    };
    client.send(flick);
    const inputs = () =>
      connection.send.mock.calls
        .map(([message]) => message)
        .filter((message) => message.type === "rod-input");
    expect(inputs()).toEqual([finalMove, flick]);
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.inputInterval + 1);
    expect(inputs()).toEqual([finalMove, flick, otherFinger]);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("deduplicates a stationary active input briefly but permits its safety refresh after 100 ms", async () => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus: vi.fn(),
    });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", {
      type: "welcome",
      playerId: "player",
      token: "token",
      state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} },
    });
    const move = {
      type: "rod-input" as const,
      rodId: 0,
      sequence: 1,
      translation: 0.5,
      angularVelocity: 30,
      active: true,
    };
    client.send(move);
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.inputInterval + 1);
    client.send({ ...move, sequence: 2 });
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.inputInterval + 1);
    let inputs = connection.send.mock.calls
      .map((call) => call[0])
      .filter((message) => message.type === "rod-input");
    expect(inputs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(100);
    client.send({ ...move, sequence: 3 });
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.inputInterval + 1);
    inputs = connection.send.mock.calls
      .map((call) => call[0])
      .filter((message) => message.type === "rod-input");
    expect(inputs).toHaveLength(2);
    client.dispose();
  });

  it("sends release immediately and drops the older pending move; persists only its session token", async () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", storage);
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus: vi.fn(),
    });
    client.start();
    await vi.dynamicImportSettled();
    const connection = transport.connections[0] as FakeConnection;
    connection.emit("open");
    connection.emit("data", {
      type: "welcome",
      playerId: "player",
      token: "secret-token",
      state: { sessionId: "session", players: [], teamNames: { red: "Rød", blue: "Blå" }, settings: {}, match: {} },
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      expect.stringMatching(/^nemfuss:session:nf-/),
      "secret-token",
    );
    const move = {
      type: "rod-input" as const,
      rodId: 0,
      sequence: 1,
      translation: 0.5,
      angularVelocity: 30,
      active: true,
    };
    client.send({ ...move, translation: 0 });
    connection.send.mockClear();
    client.send({ ...move, sequence: 2 });
    client.send({ ...move, sequence: 3, active: false });
    await vi.advanceTimersByTimeAsync(30);
    const inputs = connection.send.mock.calls
      .map((call) => call[0])
      .filter((message) => message.type === "rod-input");
    expect(inputs).toEqual([{ ...move, sequence: 3, active: false }]);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears an expired token and retries without it, preserving the rejection reason", async () => {
    const storage = {
      getItem: vi.fn(() => "expired-token"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const onStatus = vi.fn();
    vi.stubGlobal("localStorage", storage);
    const client = new PeerController({
      sessionId: `nf-${crypto.randomUUID()}`,
      onState: vi.fn(),
      onStatus,
    });
    client.start();
    await vi.dynamicImportSettled();
    const first = transport.connections[0] as FakeConnection;
    first.emit("open");
    expect(first.send).toHaveBeenCalledWith({
      type: "hello",
      version: 3,
      token: "expired-token",
    });
    first.emit("data", {
      type: "error",
      code: "invalid-token",
      message: "Pladsen er udløbet.",
      fatal: true,
    });
    expect(onStatus).toHaveBeenLastCalledWith(
      "reconnecting",
      "Pladsen er udløbet.",
    );
    expect(storage.removeItem).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(NETWORK_CONFIG.reconnectDelay);
    const second = transport.connections[1] as FakeConnection;
    second.emit("open");
    expect(second.send).toHaveBeenCalledWith({ type: "hello", version: 3 });
    client.dispose();
  });
});
