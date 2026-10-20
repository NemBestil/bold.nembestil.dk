import { parseIceServers } from "../shared/iceServers";

const FETCH_TIMEOUT = 7_000;
const REFRESH_MARGIN = 5 * 60_000;
const RETRY_DELAY = 60_000;

function directConfiguration(): RTCConfiguration {
  return {
    iceTransportPolicy: "all",
    iceServers: [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }],
  };
}

/** One credential lease per peer; refreshes also cover hosts left open between games. */
export class IceConfiguration {
  private config = directConfiguration();
  private expiresAt = 0;
  private retryAt = 0;
  private pending?: Promise<RTCConfiguration>;
  private request?: AbortController;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(private onRefresh: (config: RTCConfiguration) => void) {}

  get(): Promise<RTCConfiguration> {
    if (this.disposed || this.expiresAt - Date.now() > REFRESH_MARGIN ||
      (Date.now() < this.retryAt && (!this.expiresAt || Date.now() < this.expiresAt)))
      return Promise.resolve(this.config);
    if (!this.pending) {
      this.pending = this.fetchConfiguration().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.request?.abort();
  }

  private async fetchConfiguration(): Promise<RTCConfiguration> {
    const controller = new AbortController();
    this.request = controller;
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const response = await fetch("/api/ice-servers", {
        method: "POST",
        headers: { "X-Nemfuss-Turn": "1" },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("TURN unavailable");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object") throw new Error("Invalid TURN configuration");
      const { iceServers, expiresAt } = body as Record<string, unknown>;
      const servers = parseIceServers(iceServers);
      if (
        !servers?.some((server) => [server.urls].flat().some((url) => /^turns?:/.test(url))) ||
        typeof expiresAt !== "number" || !Number.isFinite(expiresAt) ||
        expiresAt <= Date.now() + REFRESH_MARGIN ||
        expiresAt > Date.now() + 48 * 60 * 60_000
      ) throw new Error("Invalid TURN configuration");
      if (this.disposed) return this.config;
      this.config = { iceServers: servers, iceTransportPolicy: "all" };
      this.expiresAt = expiresAt;
      this.retryAt = 0;
      this.onRefresh(this.config);
      this.schedule(expiresAt - Date.now() - REFRESH_MARGIN);
    } catch {
      if (!this.disposed) {
        // Preserve a still-valid lease during an outage; never reuse expired credentials.
        if (this.expiresAt !== 0 && this.expiresAt <= Date.now()) {
          this.config = directConfiguration();
          this.expiresAt = 0;
          this.onRefresh(this.config);
        }
        const delay = Math.min(RETRY_DELAY, this.expiresAt > Date.now() ? this.expiresAt - Date.now() : RETRY_DELAY);
        this.retryAt = Date.now() + delay;
        this.schedule(delay);
      }
    } finally {
      clearTimeout(timeout);
      if (this.request === controller) this.request = undefined;
    }
    return this.config;
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.get(); }, Math.max(1_000, delay));
  }
}
