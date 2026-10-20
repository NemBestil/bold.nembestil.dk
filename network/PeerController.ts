import type { DataConnection, Peer } from "peerjs";
import type { SessionState, TableFrame } from "../shared/types";
import type { ControllerTransportCallbacks } from "./ControllerTransport";
import { IceConfiguration } from "./IceConfiguration";
import { VisualFrameChannel } from "./VisualFrameChannel";
import {
  isServerMessage,
  NETWORK_CONFIG,
  PROTOCOL_VERSION,
  type ClientEnvelope,
  type ClientMessage,
} from "./MessageProtocol";

export interface ControllerCallbacks extends ControllerTransportCallbacks {
  sessionId: string;
  role?: "spectator";
  storageKey?: string;
  onState: (state: SessionState, playerId: string) => void;
  onStatus: (status: string, error?: string) => void;
  onFrame?: (frame: TableFrame) => void;
}

/** Reconnecting input device. It never runs game simulation. */
export class PeerController {
  private peer?: Peer;
  private connection?: DataConnection;
  private visualFrames?: VisualFrameChannel;
  private token?: string;
  private playerId = "";
  private retryTimer?: ReturnType<typeof setTimeout>;
  private connectTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private inputTimer?: ReturnType<typeof setTimeout>;
  private peerOpenTimer?: ReturnType<typeof setTimeout>;
  private pendingInputs = new Map<
    number,
    Extract<ClientMessage, { type: "rod-input" }>
  >();
  private lastInputs = new Map<number, { signature: string; at: number }>();
  private lastSeen = 0;
  private attempt = 0;
  private started = false;
  private destroyed = false;
  private importing = false;
  private connecting = false;
  private welcomed = false;
  private lastFrameSequence = -1;
  private lastSoundId = -1;
  private readonly storageKey: string;
  private readonly ice = new IceConfiguration((config) => {
    if (this.peer) this.peer.options.config = config;
    const connection = this.connection?.peerConnection;
    if (connection && connection.signalingState !== "closed") {
      try { connection.setConfiguration(config); } catch { /* Reconnect obtains fresh ICE settings. */ }
    }
  });

  constructor(private callbacks: ControllerCallbacks) {
    this.storageKey =
      callbacks.storageKey ?? `nemfuss:session:${callbacks.sessionId}`;
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    try {
      if (!this.callbacks.role) this.token = localStorage.getItem(this.storageKey) ?? undefined;
    } catch {
      /* Private browsing may disable storage. */
    }
    this.callbacks.onStatus("connecting");
    this.heartbeat = setInterval(() => {
      if (!this.connection?.open) return;
      if (
        this.lastSeen &&
        Date.now() - this.lastSeen > NETWORK_CONFIG.heartbeatTimeout
      ) {
        this.loseConnection(this.connection);
      } else this.rawSend({ type: "ping", at: Date.now() });
    }, NETWORK_CONFIG.heartbeatInterval);
    void this.createPeer();
  }

  send(message: ClientMessage): void {
    if (!this.welcomed || this.destroyed || this.callbacks.role === "spectator") return;
    if (message.type === "rod-input") {
      if (!message.active) {
        const finalMove = this.pendingInputs.get(message.rodId);
        this.pendingInputs.delete(message.rodId);
        this.lastInputs.delete(message.rodId);
        if (message.flick && finalMove && finalMove.sequence < message.sequence)
          this.rawSend(finalMove);
        this.rawSend(message);
        return;
      }
      const signature = `${message.translation}:${message.angularVelocity}:${message.active}`;
      const previous = this.lastInputs.get(message.rodId);
      if (
        previous?.signature === signature &&
        Date.now() - previous.at < NETWORK_CONFIG.activeInputRefresh
      ) {
        // A finger can return to the last sent pose before a queued move leaves.
        this.pendingInputs.delete(message.rodId);
        return;
      }
      this.pendingInputs.set(message.rodId, message);
      this.flushInputs();
      return;
    }
    this.rawSend(message);
  }

  /** Allows an explicit Retry button without reloading the phone. */
  reconnect(): void {
    if (this.destroyed) return;
    if (!this.started) {
      this.start();
      return;
    }
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    if (this.connection) this.loseConnection(this.connection, false);
    this.attempt = 0;
    if (this.peer && !this.peer.destroyed && !this.peer.disconnected)
      void this.connect();
    else void this.createPeer();
  }

  dispose(): void {
    this.destroyed = true;
    this.ice.dispose();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.inputTimer) clearTimeout(this.inputTimer);
    if (this.peerOpenTimer) clearTimeout(this.peerOpenTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.pendingInputs.clear();
    this.lastInputs.clear();
    this.lastFrameSequence = -1;
    this.visualFrames?.dispose();
    this.visualFrames = undefined;
    this.connection?.removeAllListeners();
    this.connection?.close();
    this.peer?.removeAllListeners();
    this.peer?.destroy();
    this.connection = undefined;
    this.peer = undefined;
  }

  private async createPeer() {
    if (this.destroyed || this.importing) return;
    this.importing = true;
    try {
      const [{ Peer: PeerConstructor }, config] = await Promise.all([
        import("peerjs"), this.ice.get(),
      ]);
      if (this.destroyed) return;
      this.peer?.removeAllListeners();
      this.peer?.destroy();
      const peer = new PeerConstructor({ debug: 0, config });
      this.peer = peer;
      if (this.peerOpenTimer) clearTimeout(this.peerOpenTimer);
      this.peerOpenTimer = setTimeout(() => {
        if (!this.destroyed && this.peer === peer && !this.connection) {
          peer.destroy();
          this.callbacks.onStatus(
            "reconnecting",
            "PeerJS Cloud svarer ikke. Kontrollér internetforbindelsen. Prøver igen…",
          );
          this.scheduleRetry();
        }
      }, NETWORK_CONFIG.connectionTimeout);
      peer.on("open", () => {
        if (this.peerOpenTimer) clearTimeout(this.peerOpenTimer);
        if (!this.destroyed && this.peer === peer) void this.connect();
      });
      peer.on("error", (err) => {
        if (this.destroyed || this.peer !== peer) return;
        const message =
          err.type === "peer-unavailable"
            ? "Hosten er ikke tilgængelig. Hold host-siden åben på den store skærm."
            : err.type === "browser-incompatible"
              ? "Browseren understøtter ikke WebRTC. Brug en nyere browser."
              : "Forbindelsen blev afbrudt. Prøver igen automatisk.";
        this.callbacks.onStatus("reconnecting", message);
        if (!this.connection?.open) this.scheduleRetry();
      });
      peer.on("disconnected", () => {
        if (this.destroyed || this.peer !== peer) return;
        // An established WebRTC channel survives a signaling interruption.
        if (!this.connection?.open)
          this.callbacks.onStatus(
            "reconnecting",
            "Signaleringsforbindelsen genoprettes…",
          );
        try {
          peer.reconnect();
        } catch {
          this.scheduleRetry();
        }
      });
      peer.on("close", () => {
        if (!this.destroyed && this.peer === peer) this.scheduleRetry();
      });
    } catch {
      this.callbacks.onStatus(
        "error",
        "Netværksmodulet kunne ikke indlæses. Prøver igen…",
      );
      this.scheduleRetry();
    } finally {
      this.importing = false;
    }
  }

  private async connect() {
    if (
      this.destroyed ||
      this.connecting ||
      !this.peer ||
      this.peer.destroyed ||
      this.connection?.open
    )
      return;
    if (!/^nf-[a-f0-9-]{36}$/i.test(this.callbacks.sessionId)) {
      this.callbacks.onStatus(
        "error",
        "Sessionslinket er ugyldigt. Scan QR-koden på host-skærmen igen.",
      );
      return;
    }
    const peer = this.peer;
    this.connecting = true;
    let config: RTCConfiguration;
    try {
      // A backgrounded phone may resume after its last credential lease expired.
      config = await this.ice.get();
    } finally {
      this.connecting = false;
    }
    if (this.destroyed || this.peer !== peer || peer.destroyed || peer.disconnected || this.connection?.open) return;
    peer.options.config = config;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    this.visualFrames?.dispose();
    this.visualFrames = undefined;
    this.connection?.removeAllListeners();
    this.connection?.close();
    const connection = peer.connect(this.callbacks.sessionId, {
      reliable: true,
      serialization: "json",
      label: "nemfuss-v2",
    });
    this.connection = connection;
    this.welcomed = false;
    this.lastFrameSequence = -1;
    this.connectTimer = setTimeout(() => {
      if (this.connection === connection && !this.welcomed)
        this.loseConnection(connection);
    }, NETWORK_CONFIG.connectionTimeout);
    connection.on("open", () => {
      if (this.connection !== connection || this.destroyed) return;
      this.visualFrames = new VisualFrameChannel(connection.peerConnection, "receiver", (frame) => {
        if (this.connection === connection && !this.destroyed) this.receiveFrame(frame);
      });
      this.lastSeen = Date.now();
      this.rawSend({
        type: "hello",
        version: PROTOCOL_VERSION,
        ...(this.callbacks.role ? { role: this.callbacks.role } : {}),
        ...(this.token ? { token: this.token } : {}),
      });
    });
    connection.on("data", (raw) => {
      if (
        this.connection !== connection ||
        this.destroyed ||
        !isServerMessage(raw)
      )
        return;
      // A cosmetic stream cannot conceal a stalled handshake/state heartbeat.
      if (raw.type !== "table-frame") this.lastSeen = Date.now();
      if (raw.type === "welcome" || raw.type === "spectator-welcome") {
        if (this.connectTimer) clearTimeout(this.connectTimer);
        if ((raw.type === "spectator-welcome") !== (this.callbacks.role === "spectator")) return;
        this.token = raw.type === "welcome" ? raw.token : undefined;
        this.playerId = raw.type === "welcome" ? raw.playerId : "";
        this.welcomed = true;
        this.attempt = 0;
        this.lastInputs.clear();
        this.lastFrameSequence = -1;
        try {
          if (raw.type === "welcome") localStorage.setItem(this.storageKey, raw.token);
        } catch {
          /* Keep token in memory if persistence is unavailable. */
        }
        this.callbacks.onStatus("connected");
        this.callbacks.onState(raw.state, this.playerId);
      } else if (raw.type === "state") {
        if (this.welcomed) this.callbacks.onState(raw.state, this.playerId);
      } else if (raw.type === "pong") {
        const elapsed = Date.now() - raw.at;
        if (this.welcomed && elapsed >= 0 && elapsed <= NETWORK_CONFIG.heartbeatTimeout)
          this.callbacks.onLatency?.(elapsed);
      } else if (raw.type === "table-frame") {
        this.receiveFrame(raw.frame);
      } else if (raw.type === "game-sound") {
        if (this.welcomed && raw.event.id > this.lastSoundId) {
          this.lastSoundId = raw.event.id;
          this.callbacks.onSound?.(raw.event);
        }
      } else if (raw.type === "error") {
        if (raw.code === "invalid-token") {
          this.token = undefined;
          try {
            localStorage.removeItem(this.storageKey);
          } catch {
            /* Optional storage. */
          }
        }
        this.callbacks.onStatus(
          raw.fatal ? "reconnecting" : "connected",
          raw.message,
        );
        if (raw.fatal) this.loseConnection(connection, true, raw.message);
      }
    });
    connection.on("close", () => this.loseConnection(connection));
    connection.on("error", () => this.loseConnection(connection));
  }

  private receiveFrame(frame: TableFrame) {
    if (!this.welcomed || frame.sequence <= this.lastFrameSequence) return;
    this.lastFrameSequence = frame.sequence;
    this.callbacks.onFrame?.(frame);
  }

  private loseConnection(
    connection: DataConnection,
    retry = true,
    message?: string,
  ) {
    if (this.connection !== connection) return;
    this.visualFrames?.dispose();
    this.visualFrames = undefined;
    this.connection = undefined;
    this.welcomed = false;
    this.lastFrameSequence = -1;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = undefined;
    this.pendingInputs.clear();
    this.lastInputs.clear();
    connection.removeAllListeners();
    connection.close();
    if (!this.destroyed && retry) {
      this.callbacks.onStatus(
        "reconnecting",
        message ?? "Forbindelsen genoprettes automatisk. Kampen venter på dig.",
      );
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    if (this.destroyed || this.retryTimer) return;
    const delay = Math.min(
      NETWORK_CONFIG.maxReconnectDelay,
      NETWORK_CONFIG.reconnectDelay * 1.5 ** this.attempt++,
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.destroyed) return;
      if (!this.peer || this.peer.destroyed) void this.createPeer();
      else if (this.peer.disconnected) {
        try {
          this.peer.reconnect();
        } catch {
          void this.createPeer();
        }
        this.scheduleRetry();
      } else void this.connect();
    }, delay);
  }

  private flushInputs() {
    if (this.inputTimer) clearTimeout(this.inputTimer);
    this.inputTimer = undefined;
    if (!this.welcomed || !this.connection?.open) {
      this.pendingInputs.clear();
      return;
    }
    if (
      (this.connection.dataChannel?.bufferedAmount ?? 0) >
      NETWORK_CONFIG.maxBufferedBytes
    ) {
      this.inputTimer = setTimeout(
        () => this.flushInputs(),
        NETWORK_CONFIG.inputInterval,
      );
      return;
    }
    const now = Date.now();
    let remaining = Infinity;
    for (const [rodId, message] of this.pendingInputs) {
      // Already spaced samples leave immediately; bursts wait only for this rod's window.
      const previous = this.lastInputs.get(rodId);
      const wait = previous
        ? NETWORK_CONFIG.inputInterval - (now - previous.at)
        : 0;
      if (wait > 0) {
        remaining = Math.min(remaining, wait);
        continue;
      }
      this.pendingInputs.delete(rodId);
      this.rawSend(message);
      if (!this.welcomed || !this.connection?.open) return;
      this.lastInputs.set(rodId, {
        signature: `${message.translation}:${message.angularVelocity}:${message.active}`,
        at: now,
      });
    }
    if (this.pendingInputs.size)
      this.inputTimer = setTimeout(
        () => this.flushInputs(),
        Math.max(1, Math.ceil(remaining)),
      );
  }

  private rawSend(message: ClientEnvelope) {
    if (!this.connection?.open || this.destroyed) return;
    try {
      this.connection.send(message);
    } catch {
      this.loseConnection(this.connection);
    }
  }
}
