import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onRequest } from "../functions/api/ice-servers";
import { parseIceServers } from "../shared/iceServers";

const origin = "https://nemfuss.pages.dev";
const env = { TURN_KEY_ID: "test-key", TURN_KEY_API_TOKEN: "test-api-token" };
const cloudflareResponse = {
  iceServers: [
    { urls: ["stun:stun.cloudflare.com:3478"] },
    {
      urls: [
        "turn:turn.cloudflare.com:3478?transport=udp",
        "turn:turn.cloudflare.com:3478?transport=tcp",
        "turns:turn.cloudflare.com:443?transport=tcp",
        "turn:turn.cloudflare.com:53?transport=udp",
      ],
      username: "temporary-user",
      credential: "temporary-password",
    },
  ],
};

function call(headers: Record<string, string> = {}, method = "POST", bindings: Partial<typeof env> = env) {
  const request = new Request(`${origin}/api/ice-servers`, {
    method,
    headers: { Origin: origin, "X-Nemfuss-Turn": "1", "Sec-Fetch-Site": "same-origin", ...headers },
  });
  return onRequest({ request, env: bindings } as Parameters<typeof onRequest>[0]);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(cloudflareResponse)));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("TURN credential endpoint", () => {
  it("issues separate no-store temporary credentials with a fixed TTL and removes browser-blocked ports", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      "https://rtc.live.cloudflare.com/v1/turn/keys/test-key/credentials/generate-ice-servers",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer test-api-token", "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: 86400 }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(await response.json()).toEqual({
      iceServers: [cloudflareResponse.iceServers[0], {
        ...cloudflareResponse.iceServers[1],
        urls: cloudflareResponse.iceServers[1]!.urls.slice(0, 3),
      }],
      expiresAt: 1_000_000 + 86_400_000,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["GET", "OPTIONS", "PUT"])("rejects %s without requesting credentials", async (method) => {
    const response = await call({}, method);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { Origin: "https://attacker.example" },
    { Origin: "null" },
    { Origin: "" },
    { "X-Nemfuss-Turn": "" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
  ])("rejects requests outside the same-origin browser flow: %j", async (headers) => {
    const response = await call(headers);
    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows browsers without Sec-Fetch-Site when Origin and the custom header match", async () => {
    const request = new Request(`${origin}/api/ice-servers`, {
      method: "POST", headers: { Origin: origin, "X-Nemfuss-Turn": "1" },
    });
    const response = await onRequest({ request, env } as Parameters<typeof onRequest>[0]);
    expect(response.status).toBe(200);
  });

  it.each([{}, { TURN_KEY_ID: "test-key" }, { TURN_KEY_API_TOKEN: "test-api-token" }])(
    "returns a generic unavailable response for missing deployment secrets", async (bindings) => {
      const response = await call({}, "POST", bindings);
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('{"error":"Relay temporarily unavailable"}');
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not expose upstream errors or permanent tokens", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("test-api-token provider diagnostic", { status: 401 }));
    const response = await call();
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('{"error":"Relay temporarily unavailable"}');
  });

  it.each([
    { iceServers: [] },
    { iceServers: [{ urls: "stun:stun.cloudflare.com:3478" }] },
    { iceServers: [{ urls: "turn:turn.cloudflare.com:3478" }] },
    { iceServers: [{ urls: "https://attacker.example", username: "user", credential: "pass" }] },
    { iceServers: cloudflareResponse.iceServers, extraSecret: "ignored" },
  ])("accepts only validated relay credentials and strips unrelated provider data", async (payload) => {
    vi.mocked(fetch).mockResolvedValue(Response.json(payload));
    const response = await call();
    expect(response.status).toBe("extraSecret" in payload ? 200 : 502);
    expect(await response.text()).not.toContain("ignored");
  });

  it("rejects oversized upstream responses before returning any credentials", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ...cloudflareResponse, oversized: "x".repeat(33 * 1024),
    })));
    const response = await call();
    expect(response.status).toBe(502);
  });

  it("aborts a stalled credential request within five seconds and clears its timer", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    }));
    const pending = call();
    await vi.advanceTimersByTimeAsync(5_000);
    const response = await pending;
    expect(response.status).toBe(502);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ICE server validation", () => {
  it("keeps safe ICE URLs and credentials while dropping unrecognized fields", () => {
    expect(parseIceServers([{ urls: "turns:turn.cloudflare.com:443?transport=tcp", username: "user", credential: "password", secret: "drop" }]))
      .toEqual([{ urls: ["turns:turn.cloudflare.com:443?transport=tcp"], username: "user", credential: "password" }]);
  });

  it.each([
    null, [], Array.from({ length: 9 }, () => ({ urls: "stun:stun.cloudflare.com:3478" })),
    [{ urls: "turn:turn.cloudflare.com:3478", username: "user" }],
    [{ urls: "turn:turn.cloudflare.com:3478", username: {}, credential: "password" }],
    [{ urls: ["stun:stun.cloudflare.com:3478", "https://attacker.example"] }],
    [{ urls: "stun:user@stun.cloudflare.com:3478" }],
    [{ urls: "stun:stun.cloudflare.com:65536" }],
    [{ urls: "stun:stun.cloudflare.com:3478/path" }],
    [{ urls: "stun:stun.cloudflare.com:3478?transport=other" }],
    [{ urls: "stun:stun.cloudflare.com:53" }],
    [{ urls: ["stun:stun.cloudflare.com:3478", 42] }],
  ])("rejects malformed, unbounded or unusable server lists: %j", (value) => {
    expect(parseIceServers(value)).toBeUndefined();
  });
});
