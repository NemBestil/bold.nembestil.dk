/** Structural WebRTC type shared by browsers and the Pages Functions runtime. */
export interface RTCIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const MAX_SERVERS = 8;
const MAX_URLS = 16;
const MAX_URL_LENGTH = 512;
const MAX_CREDENTIAL_LENGTH = 2048;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validCredential(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_CREDENTIAL_LENGTH;
}

function parseUrl(value: unknown): { url: string; turn: boolean; blocked: boolean } | undefined {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return;
  const match = /^(stun|stuns|turn|turns):([a-z\d.-]+|\[[a-f\d:]+\])(?::(\d{1,5}))?(?:\?transport=(udp|tcp))?$/i.exec(value);
  if (!match) return;
  const [, protocol, host, port] = match;
  if (!protocol || !host || (port && (+port < 1 || +port > 65535))) return;
  if (!host.startsWith("[") && !host.split(".").every((label) =>
    /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label))) return;
  try {
    // Validate IP literals too; the grammar above excludes credentials, paths and fragments.
    new URL(`http://${host}${port ? `:${port}` : ""}`);
  } catch {
    return;
  }
  return { url: value, turn: protocol.toLowerCase().startsWith("turn"), blocked: Number(port) === 53 };
}

/** Accept a bounded ICE server list, stripping browser-blocked port 53 and extra fields. */
export function parseIceServers(value: unknown): RTCIceServer[] | undefined {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SERVERS) return;
  const servers: RTCIceServer[] = [];
  for (const entry of value) {
    if (!record(entry)) return;
    const urls = typeof entry.urls === "string" ? [entry.urls] : entry.urls;
    if (!Array.isArray(urls) || urls.length === 0 || urls.length > MAX_URLS) return;
    const parsed = urls.map(parseUrl);
    if (parsed.some((url) => !url)) return;
    if (entry.username !== undefined && !validCredential(entry.username)) return;
    if (entry.credential !== undefined && !validCredential(entry.credential)) return;
    if (parsed.some((url) => url?.turn) &&
      (!validCredential(entry.username) || !validCredential(entry.credential))) return;
    const allowedUrls = parsed.flatMap((url) => url && !url.blocked ? [url.url] : []);
    if (!allowedUrls.length) continue;
    servers.push({
      urls: allowedUrls,
      ...(typeof entry.username === "string" ? { username: entry.username } : {}),
      ...(typeof entry.credential === "string" ? { credential: entry.credential } : {}),
    });
  }
  return servers.length ? servers : undefined;
}
