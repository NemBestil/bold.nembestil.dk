export function sessionIdFromQuery(value: unknown): string {
  return typeof value === "string" && /^nf-[a-f0-9-]{36}$/i.test(value) ? value : "";
}

export function sessionLink(origin: string, base: string, sessionId: string): string {
  const url = new URL(base, origin);
  url.searchParams.set("session", sessionId);
  return url.href;
}
