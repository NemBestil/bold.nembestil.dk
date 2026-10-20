import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IceConfiguration } from "../network/IceConfiguration";

const servers = [
  { urls: ["stun:stun.cloudflare.com:3478"] },
  {
    urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
    username: "temporary-user", credential: "temporary-credential",
  },
];
const leases: IceConfiguration[] = [];
function lease(onRefresh = vi.fn()) {
  const instance = new IceConfiguration(onRefresh);
  leases.push(instance);
  return instance;
}
function response(expiresAt = Date.now() + 86_400_000) {
  return Response.json({ iceServers: servers, expiresAt });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(response())));
});
afterEach(() => {
  for (const instance of leases.splice(0)) instance.dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ICE credential lifecycle", () => {
  it("shares concurrent requests within one peer and permits both direct and relay paths", async () => {
    const config = lease();
    const [first, second] = await Promise.all([config.get(), config.get()]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledWith("/api/ice-servers", expect.objectContaining({
      method: "POST", headers: { "X-Nemfuss-Turn": "1" }, cache: "no-store", credentials: "same-origin",
    }));
    expect(first).toBe(second);
    expect(first).toEqual({ iceTransportPolicy: "all", iceServers: servers });
    await config.get();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([404, 502, 503])("retains direct connectivity when credential endpoint returns %s", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    const configuration = await lease().get();
    expect(configuration.iceTransportPolicy).toBe("all");
    expect(JSON.stringify(configuration.iceServers)).toContain("stun:");
    expect(JSON.stringify(configuration.iceServers)).not.toContain("turn:");
  });

  it.each([
    { iceServers: servers, expiresAt: 0 },
    { iceServers: [{ urls: "turn:turn.cloudflare.com:3478" }], expiresAt: 90_000_000 },
    { iceServers: [{ urls: "https://attacker.example" }], expiresAt: 90_000_000 },
    { iceServers: servers, expiresAt: 1_000_000 + 49 * 3_600_000 },
  ])("ignores malformed or expired provider data", async (body) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(body));
    expect(JSON.stringify((await lease().get()).iceServers)).not.toContain("credential");
  });

  it("aborts a stalled request and continues with STUN", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const result = lease().get();
    await vi.advanceTimersByTimeAsync(7_000);
    expect((await result).iceServers).toEqual(expect.arrayContaining([
      expect.objectContaining({ urls: expect.arrayContaining(["stun:stun.cloudflare.com:3478"]) }),
    ]));
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
  });

  it("refreshes before expiry and notifies existing and future connection owners", async () => {
    const onRefresh = vi.fn();
    const config = lease(onRefresh);
    vi.mocked(fetch).mockResolvedValueOnce(response(Date.now() + 600_000));
    await config.get();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenCalledTimes(2);
    expect(onRefresh).toHaveBeenLastCalledWith({ iceTransportPolicy: "all", iceServers: servers });
  });

  it("keeps still-valid credentials on refresh failure, then removes them at expiry", async () => {
    const onRefresh = vi.fn();
    const config = lease(onRefresh);
    vi.mocked(fetch).mockResolvedValueOnce(response(Date.now() + 600_000));
    const initial = await config.get();
    vi.mocked(fetch).mockRejectedValue(new Error("outage"));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(await config.get()).toBe(initial);
    expect(onRefresh).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(JSON.stringify((await config.get()).iceServers)).not.toContain("credential");
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it("cancels in-flight requests and prevents refresh callbacks after disposal", async () => {
    const onRefresh = vi.fn();
    let resolve!: (response: Response) => void;
    vi.mocked(fetch).mockReturnValue(new Promise((done) => { resolve = done; }));
    const config = lease(onRefresh);
    const pending = config.get();
    config.dispose();
    resolve(response());
    await pending;
    expect(vi.mocked(fetch).mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
