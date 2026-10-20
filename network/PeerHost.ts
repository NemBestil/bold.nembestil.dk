import type { DataConnection, Peer } from "peerjs";
import type { GameSoundEvent, MatchSettings, MatchSnapshot, TableFrame } from "../shared/types";
import type { ControllerTransport, ControllerTransportCallbacks } from "./ControllerTransport";
import {
  isClientEnvelope,
  isTableFrame,
  isGameSoundEvent,
  NETWORK_CONFIG,
  PROTOCOL_VERSION,
  type ServerMessage,
} from "./MessageProtocol";
import {
  SessionManager,
  type ActionResult,
  type SessionCallbacks,
} from "./SessionManager";
import { createSecureId } from "./identifiers";
import { IceConfiguration } from "./IceConfiguration";
import { VisualFrameChannel } from "./VisualFrameChannel";

interface HostCallbacks extends SessionCallbacks {
  onStatus: (status: string, error?: string) => void;
}

interface ConnectionRecord {
  playerId?: string;
  spectator?: boolean;
  rejected?: boolean;
  acceptedAt: number;
  openedAt?: number;
  lastSeen?: number;
  windowStart: number;
  messages: number;
  frameCredits?: number;
  frameCreditAt?: number;
  visualFrames?: VisualFrameChannel;
}

/** The desktop owns the lobby and physics. PeerJS Cloud is signaling only. */
export class PeerHost {
  private peer?: Peer;
  private manager?: SessionManager;
  private connections = new Map<DataConnection, ConnectionRecord>();
  private playerConnections = new Map<string, DataConnection>();
  private timer?: ReturnType<typeof setInterval>;
  private delays = new Set<ReturnType<typeof setTimeout>>();
  private destroyed = false;
  private pendingMatch?: MatchSnapshot;
  private latestFrame?: TableFrame;
  private localControllers = new Map<string, ControllerTransportCallbacks>();
  private networkStart?: Promise<string>;
  private latestSoundId = -1;
  private readonly ice = new IceConfiguration((config) => {
    if (this.peer) this.peer.options.config = config;
    for (const connection of this.connections.keys()) {
      const rtc = connection.peerConnection;
      if (rtc && rtc.signalingState !== "closed") {
        try { rtc.setConfiguration(config); } catch { /* Reconnect obtains fresh ICE settings. */ }
      }
    }
  });

  constructor(private callbacks: HostCallbacks) {}

  get state() {
    return this.manager?.state;
  }

  async start(): Promise<string> {
    if (this.networkStart) return this.networkStart;
    this.startLocal();
    const attempt = this.openNetwork().catch((error) => {
      if (this.networkStart === attempt) {
        this.peer?.removeAllListeners();
        this.peer?.destroy();
        this.peer = undefined;
        this.networkStart = undefined;
      }
      throw error;
    });
    this.networkStart = attempt;
    return attempt;
  }

  /** An in-memory host needs neither signaling nor a connection to itself. */
  startLocal(settings?: Partial<MatchSettings>): string {
    if (this.destroyed) throw new Error("Sessionen er lukket.");
    if (!this.manager) {
      const sessionId = `nf-${createSecureId()}`;
      this.manager = new SessionManager(
        sessionId,
        {
          ...this.callbacks,
          onState: (state) => {
            this.callbacks.onState(state);
            this.broadcast({ type: "state", state });
            for (const [id, callbacks] of this.localControllers)
              callbacks.onState(structuredClone(state), id);
          },
        },
        createSecureId,
      );
      if (this.pendingMatch) this.manager.setMatch(this.pendingMatch);
      this.timer = setInterval(() => this.tick(), 1000);
    }
    if (settings) {
      const result = this.manager.configureLobbySettings(settings);
      if (!result.ok) throw new Error(result.message);
    }
    this.callbacks.onState(this.manager.state);
    return this.manager.sessionId;
  }

  private async openNetwork(): Promise<string> {
    this.callbacks.onStatus("connecting");
    const [{ Peer: PeerConstructor }, config] = await Promise.all([
      import("peerjs"), this.ice.get(),
    ]);
    if (this.destroyed) throw new Error("Sessionen er lukket.");
    const sessionId = this.manager!.sessionId;
    const peer = new PeerConstructor(sessionId, { debug: 0, config });
    this.peer = peer;
    peer.on("connection", (connection) =>
      this.peer === peer ? this.acceptConnection(connection) : connection.close(),
    );
    peer.on("disconnected", () => {
      if (this.destroyed || this.peer !== peer) return;
      this.callbacks.onStatus(
        "reconnecting",
        "Signaleringsforbindelsen genoprettes. Eksisterende spilforbindelser kan fortsætte.",
      );
      this.later(() => {
        if (this.peer === peer && peer.disconnected && !peer.destroyed)
          peer.reconnect();
      }, NETWORK_CONFIG.reconnectDelay);
    });
    peer.on("error", (err) => {
      if (!this.destroyed && this.peer === peer)
        this.callbacks.onStatus("error", this.explainError(err.type));
    });
    peer.on("close", () => {
      if (!this.destroyed && this.peer === peer) {
        this.peer = undefined;
        this.networkStart = undefined;
        this.callbacks.onStatus(
          "error",
          "Netværksinvitationen blev lukket. Åbn den igen for at forbinde flere telefoner.",
        );
      }
    });
    return new Promise<string>((resolve, reject) => {
      const timeout = this.later(() => {
        if (this.peer === peer) this.callbacks.onStatus(
          "error",
          "PeerJS Cloud svarer ikke. Kontrollér internetforbindelsen, og prøv igen.",
        );
        reject(new Error("Signaleringsserveren svarede ikke."));
      }, NETWORK_CONFIG.connectionTimeout);
      peer.on("open", (id) => {
        if (this.peer !== peer || this.destroyed) return;
        clearTimeout(timeout);
        this.delays.delete(timeout);
        this.callbacks.onStatus("connected");
        this.callbacks.onState(this.manager!.state);
        resolve(id);
      });
      peer.once("error", (err) => {
        clearTimeout(timeout);
        this.delays.delete(timeout);
        reject(new Error(this.explainError(err.type)));
      });
      peer.once("close", () => {
        clearTimeout(timeout);
        this.delays.delete(timeout);
        reject(new Error("Netværksinvitationen blev lukket."));
      });
    });
  }

  setMatch(snapshot: MatchSnapshot) {
    this.pendingMatch = snapshot;
    this.manager?.setMatch(snapshot);
  }

  configureLobby(patch: Partial<MatchSettings>): ActionResult {
    return (
      this.manager?.configureLobbySettings(patch) ?? {
        ok: false,
        code: "not-started",
        message: "Vent på, at host-sessionen er forbundet.",
      }
    );
  }

  pauseMatch() { return this.manager?.pauseMatch(); }
  leaveMatch() { return this.manager?.leaveMatch(); }

  createLocalController(callbacks: ControllerTransportCallbacks): ControllerTransport {
    let playerId: string | undefined;
    let disposed = false;
    const start = () => {
      if (disposed || this.destroyed || playerId) return;
      this.startLocal();
      const admission = this.manager!.admitLocal();
      if ("ok" in admission) {
        callbacks.onStatus("error", admission.message);
        return;
      }
      playerId = admission.playerId;
      this.localControllers.set(playerId, callbacks);
      callbacks.onStatus("connected");
      callbacks.onState(this.manager!.state, playerId);
      if (this.latestFrame) callbacks.onFrame?.(structuredClone(this.latestFrame));
    };
    return {
      start,
      reconnect: () => {
        if (disposed || this.destroyed) return;
        if (!playerId) return start();
        callbacks.onStatus("connected");
        callbacks.onState(this.manager!.state, playerId);
      },
      send: (message) => {
        if (disposed || this.destroyed || !playerId) return;
        const result = this.manager!.handle(playerId, message);
        if (!result.ok && !["stale-input", "inactive"].includes(result.code ?? ""))
          callbacks.onStatus("connected", result.message);
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        if (playerId) {
          this.localControllers.delete(playerId);
          if (!this.destroyed) this.manager?.disconnect(playerId);
        }
      },
    };
  }

  setSound(event: GameSoundEvent): void {
    if (this.destroyed || !isGameSoundEvent(event) || event.id <= this.latestSoundId) return;
    this.latestSoundId = event.id;
    this.broadcast({ type: "game-sound", event });
    for (const callbacks of this.localControllers.values()) callbacks.onSound?.({ ...event });
  }

  /** Visual updates may be dropped; lobby, input and heartbeat never wait for them. */
  setFrame(frame: TableFrame): void {
    if (
      this.destroyed ||
      !isTableFrame(frame) ||
      (this.latestFrame && frame.sequence <= this.latestFrame.sequence)
    )
      return;
    this.latestFrame = structuredClone(frame);
    for (const callbacks of this.localControllers.values()) callbacks.onFrame?.(structuredClone(frame));
    const now = performance.now();
    for (const [connection, record] of this.connections)
      this.sendFrame(connection, record, now);
  }

  dispose() {
    this.destroyed = true;
    this.ice.dispose();
    if (this.timer) clearInterval(this.timer);
    for (const delay of this.delays) clearTimeout(delay);
    this.delays.clear();
    for (const [connection, record] of this.connections) {
      record.visualFrames?.dispose();
      connection.removeAllListeners();
      connection.close();
    }
    this.connections.clear();
    this.playerConnections.clear();
    this.localControllers.clear();
    this.latestFrame = undefined;
    this.peer?.removeAllListeners();
    this.peer?.destroy();
    this.peer = undefined;
    this.manager?.dispose();
  }

  private acceptConnection(connection: DataConnection) {
    if (
      this.destroyed ||
      this.connections.size >= NETWORK_CONFIG.maxPendingConnections
    ) {
      connection.close();
      return;
    }
    const now = Date.now();
    const record: ConnectionRecord = {
      acceptedAt: now,
      ...(connection.open ? { openedAt: now, lastSeen: now } : {}),
      windowStart: now,
      messages: 0,
    };
    this.connections.set(connection, record);
    const openVisualFrames = () => {
      record.visualFrames ??= new VisualFrameChannel(connection.peerConnection, "sender");
    };
    if (connection.open) openVisualFrames();
    // PeerJS announces incoming offers before ICE/TURN has opened the data channel.
    connection.on("open", () => {
      if (!this.connections.has(connection) || record.openedAt !== undefined) return;
      record.openedAt = Date.now();
      record.lastSeen = record.openedAt;
      openVisualFrames();
    });
    connection.on("data", (raw) => {
      if (!this.connections.has(connection) || record.rejected || record.openedAt === undefined) return;
      const at = Date.now();
      if (at - record.windowStart >= 1000) {
        record.windowStart = at;
        record.messages = 0;
      }
      if (++record.messages > NETWORK_CONFIG.maxMessagesPerSecond) {
        this.reject(
          connection,
          "rate-limit",
          "Der blev sendt for mange beskeder. Forbind igen.",
        );
        return;
      }
      if (typeof raw === "object" && raw !== null && "type" in raw && raw.type === "hello" &&
        "version" in raw && raw.version !== PROTOCOL_VERSION) {
        this.reject(connection, "protocol-version", "Bord og controller bruger forskellige udgaver. Åbn forsiden igen og del det nye link.");
        return;
      }
      if (!isClientEnvelope(raw)) {
        this.send(connection, {
          type: "error",
          code: "invalid-message",
          message: "Ugyldig netværksbesked.",
        });
        return;
      }
      record.lastSeen = at;
      if (!record.playerId && !record.spectator) {
        if (raw.type !== "hello") {
          this.reject(
            connection,
            "handshake",
            "Forbindelsen blev ikke godkendt.",
          );
          return;
        }
        if (raw.role === "spectator") {
          record.spectator = true;
          this.send(connection, { type: "spectator-welcome", state: this.manager!.state });
          this.sendFrame(connection, record, performance.now());
          return;
        }
        const admission = this.manager!.admit(raw.token, at);
        if ("ok" in admission) {
          this.reject(
            connection,
            admission.code ?? "denied",
            admission.message ?? "Adgang afvist.",
          );
          return;
        }
        record.playerId = admission.playerId;
        // An expired transport may close after its token has already reconnected.
        // Retire it without disconnecting the replacement player's admission.
        const previous = this.playerConnections.get(admission.playerId);
        this.playerConnections.set(admission.playerId, connection);
        if (previous && previous !== connection) {
          this.connections.get(previous)?.visualFrames?.dispose();
          this.connections.delete(previous);
          previous.removeAllListeners();
          previous.close();
        }
        this.send(connection, {
          type: "welcome",
          playerId: admission.playerId,
          token: admission.token,
          state: this.manager!.state,
        });
        this.sendFrame(connection, record, performance.now());
        this.broadcast({ type: "state", state: this.manager!.state });
      } else if (raw.type === "hello") {
        this.send(connection, {
          type: "error",
          code: "handshake",
          message: "Forbindelsen er allerede godkendt.",
        });
      } else if (raw.type === "ping") {
        if (record.playerId) this.manager!.touch(record.playerId, at);
        this.send(connection, { type: "pong", at: raw.at });
      } else if (record.spectator) {
        this.send(connection, { type: "error", code: "spectator-only", message: "Denne skærm viser kampen. Brug en telefon til at spille." });
      } else {
        const result = this.manager!.handle(record.playerId!, raw, at);
        // Stale packets are expected during throttling/reconnect and need no UI error.
        if (
          !result.ok &&
          result.code !== "stale-input" &&
          result.code !== "inactive"
        )
          this.send(connection, {
            type: "error",
            code: result.code ?? "rejected",
            message: result.message ?? "Beskeden blev afvist.",
          });
      }
    });
    connection.on("close", () => this.dropConnection(connection));
    connection.on("error", () => {
      this.dropConnection(connection);
      connection.close();
    });
  }

  private tick() {
    const now = Date.now();
    for (const id of this.localControllers.keys()) this.manager?.touch(id, now);
    for (const [connection, record] of this.connections) {
      if (
        (record.openedAt === undefined
          ? now - record.acceptedAt >= NETWORK_CONFIG.connectionTimeout
          : (!record.playerId && !record.spectator && now - record.openedAt >= NETWORK_CONFIG.handshakeTimeout) ||
            (record.lastSeen !== undefined && now - record.lastSeen > NETWORK_CONFIG.heartbeatTimeout))
      ) {
        this.dropConnection(connection);
        connection.close();
      }
    }
    this.manager?.expire(now);
  }

  private dropConnection(connection: DataConnection) {
    const record = this.connections.get(connection);
    if (!record) return;
    record.visualFrames?.dispose();
    this.connections.delete(connection);
    if (
      record.playerId &&
      this.playerConnections.get(record.playerId) === connection
    ) {
      this.playerConnections.delete(record.playerId);
      this.manager?.disconnect(record.playerId);
    }
  }

  private reject(connection: DataConnection, code: string, message: string) {
    const record = this.connections.get(connection);
    if (record) record.rejected = true;
    this.send(connection, { type: "error", code, message, fatal: true });
    this.later(() => {
      this.dropConnection(connection);
      connection.close();
    }, 200);
  }

  private broadcast(message: ServerMessage) {
    for (const [connection, record] of this.connections)
      if (record.playerId || record.spectator) this.send(connection, message);
  }

  private sendFrame(
    connection: DataConnection,
    record: ConnectionRecord,
    now: number,
  ) {
    if (
      !this.latestFrame ||
      !connection.open ||
      record.rejected ||
      (!record.playerId && !record.spectator) ||
      (record.playerId && this.playerConnections.get(record.playerId) !== connection)
    )
      return;
    // Preserve a 60 Hz average across render jitter instead of halving a 16.5 ms stream.
    // At most one extra frame can accumulate. Borrow half a stream tick for the
    // short 11/14 ms draws on 90/144 Hz displays, repaying it on later long draws.
    record.frameCredits = Math.min(
      2,
      (record.frameCredits ?? 1) +
        Math.max(0, now - (record.frameCreditAt ?? now)) /
          NETWORK_CONFIG.tableFrameInterval,
    );
    record.frameCreditAt = now;
    if (record.frameCredits < 0.5 - 1e-9) return;
    const visualDelivery = record.visualFrames?.send(this.latestFrame);
    if (visualDelivery === "sent") { record.frameCredits--; return; }
    if (visualDelivery === "dropped") return;
    // Older peers keep using the original channel. Once the native channel is
    // acknowledged, its congestion never spills snapshots into reliable traffic.
    if (
      (connection.dataChannel?.bufferedAmount ?? 0) > NETWORK_CONFIG.maxFrameBufferedBytes ||
      ("bufferSize" in connection && typeof connection.bufferSize === "number" && connection.bufferSize > 0)
    ) return;
    record.frameCredits--;
    this.send(connection, { type: "table-frame", frame: this.latestFrame });
  }

  private send(connection: DataConnection, message: ServerMessage) {
    if (!connection.open) return;
    try {
      connection.send(message);
    } catch {
      this.dropConnection(connection);
      connection.close();
    }
  }

  private later(fn: () => void, ms: number) {
    const handle = setTimeout(() => {
      this.delays.delete(handle);
      if (!this.destroyed) fn();
    }, ms);
    this.delays.add(handle);
    return handle;
  }

  private explainError(type: string) {
    if (type === "browser-incompatible")
      return "Browseren understøtter ikke WebRTC. Brug en nyere Safari, Chrome, Firefox eller Edge.";
    if (
      type === "network" ||
      type === "server-error" ||
      type === "socket-error"
    )
      return "PeerJS Cloud kunne ikke kontaktes. Kontrollér internetforbindelsen.";
    if (type === "unavailable-id")
      return "Sessions-id er allerede i brug. Genindlæs siden for at oprette en ny session.";
    return "Der opstod en forbindelsesfejl. Kontrollér netværket, og prøv igen.";
  }
}
