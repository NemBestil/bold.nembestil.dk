import { parseIceServers } from "../../shared/iceServers";

const CREDENTIAL_TTL_SECONDS = 86_400;
const UPSTREAM_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 32 * 1024;

function json(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("Response too large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (request.method !== "POST")
    return json({ error: "Method not allowed" }, 405, { Allow: "POST" });

  const site = request.headers.get("Sec-Fetch-Site");
  if (request.headers.get("Origin") !== new URL(request.url).origin ||
    request.headers.get("X-Nemfuss-Turn") !== "1" ||
    (site !== null && site !== "same-origin"))
    return json({ error: "Forbidden" }, 403);

  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN)
    return json({ error: "Relay temporarily unavailable" }, 503);

  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), UPSTREAM_TIMEOUT_MS);
  const issuedAt = Date.now();
  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: CREDENTIAL_TTL_SECONDS }),
        signal: abort.signal,
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      return json({ error: "Relay temporarily unavailable" }, 502);
    }
    const raw = await readResponse(response);
    const iceServers = parseIceServers(
      raw && typeof raw === "object" && "iceServers" in raw ? raw.iceServers : undefined,
    );
    if (!iceServers || !iceServers.some((server) =>
      (typeof server.urls === "string" ? [server.urls] : server.urls).some((url) => /^turns?:/i.test(url))))
      return json({ error: "Relay temporarily unavailable" }, 502);
    return json({ iceServers, expiresAt: issuedAt + CREDENTIAL_TTL_SECONDS * 1000 });
  } catch {
    return json({ error: "Relay temporarily unavailable" }, 502);
  } finally {
    clearTimeout(timeout);
  }
};
