import type { TableFrame } from "../shared/types";
import { isServerMessage } from "./MessageProtocol";

export const VISUAL_FRAME_CHANNEL_LABEL = "nemfuss-visual-v1";
export const VISUAL_FRAME_CHANNEL_READY = "nemfuss-visual-v1:ready";
// PeerJS owns the first automatically assigned channel (0 or 1). A negotiated
// channel avoids PeerJS treating another datachannel event as its own transport.
export const VISUAL_FRAME_CHANNEL_ID = 2;
const MAX_MESSAGE_BYTES = 16_300;

/** Optional, disposable snapshots on the existing WebRTC connection. */
export class VisualFrameChannel {
  private channel?: RTCDataChannel;
  private acknowledged = false;
  private readyRetry?: ReturnType<typeof setInterval>;

  constructor(
    connection: RTCPeerConnection | undefined,
    private role: "sender" | "receiver",
    private onFrame?: (frame: TableFrame) => void,
  ) {
    if (typeof connection?.createDataChannel !== "function") return;
    try {
      this.channel = connection.createDataChannel(VISUAL_FRAME_CHANNEL_LABEL, {
        negotiated: true,
        id: VISUAL_FRAME_CHANNEL_ID,
        ordered: false,
        maxRetransmits: 0,
      });
      this.channel.addEventListener("open", this.open);
      this.channel.addEventListener("message", this.message);
      this.channel.addEventListener("close", this.dispose);
      this.channel.addEventListener("error", this.dispose);
      if (this.channel.readyState === "open") this.open();
    } catch {
      this.dispose();
    }
  }

  /** Congestion drops this snapshot; it must never move to the reliable queue. */
  send(frame: TableFrame): "unavailable" | "sent" | "dropped" {
    const channel = this.channel;
    if (this.role !== "sender" || !this.acknowledged || channel?.readyState !== "open")
      return "unavailable";
    if (channel.bufferedAmount > 0) return "dropped";
    try {
      channel.send(JSON.stringify({ type: "table-frame", frame }));
      return "sent";
    } catch {
      this.dispose();
      return "unavailable";
    }
  }

  dispose = () => {
    const channel = this.channel;
    this.channel = undefined;
    this.acknowledged = false;
    if (this.readyRetry) clearInterval(this.readyRetry);
    this.readyRetry = undefined;
    if (!channel) return;
    channel.removeEventListener("open", this.open);
    channel.removeEventListener("message", this.message);
    channel.removeEventListener("close", this.dispose);
    channel.removeEventListener("error", this.dispose);
    try { channel.close(); } catch { /* The owning connection may already be closed. */ }
  };

  private open = () => {
    if (this.role !== "receiver" || this.channel?.readyState !== "open") return;
    this.sendReady();
    // This acknowledgement is also unreliable. Retry until receipt of a native
    // snapshot proves that the sender saw it, including after Wi-Fi packet loss.
    if (this.channel && !this.readyRetry)
      this.readyRetry = setInterval(this.sendReady, 500);
  };

  private sendReady = () => {
    if (this.channel?.readyState !== "open" || this.channel.bufferedAmount > 0) return;
    try { this.channel.send(VISUAL_FRAME_CHANNEL_READY); }
    catch { this.dispose(); }
  };

  private message = (event: MessageEvent) => {
    if (!this.channel || this.channel.readyState !== "open") return;
    if (this.role === "sender") {
      if (event.data === VISUAL_FRAME_CHANNEL_READY) this.acknowledged = true;
      return;
    }
    if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE_BYTES) return;
    let raw: unknown;
    try { raw = JSON.parse(event.data); } catch { return; }
    if (isServerMessage(raw) && raw.type === "table-frame") {
      if (this.readyRetry) clearInterval(this.readyRetry);
      this.readyRetry = undefined;
      this.onFrame?.(raw.frame);
    }
  };
}
