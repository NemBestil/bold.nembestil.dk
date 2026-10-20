export function isTouchDevice(points: number, coarsePointer: boolean) {
  return points > 0 || coarsePointer;
}

/** A touch-capable laptop remains a desktop screen; iPad desktop mode is mobile. */
export function isMobileControllerDevice(userAgent: string, points: number) {
  return /Android|iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && points > 1);
}

/** Extract only a session ID; shared and legacy URLs never navigate to another site. */
export function joinSessionFromLink(value: string): string | null {
  const text = value.trim();
  const valid = (id: string) => /^nf-[a-zA-Z0-9-]+$/.test(id) && id.length <= 128;
  if (valid(text)) return text;
  try {
    const url = new URL(text, "https://local.invalid");
    const id = url.searchParams.get("session") || "";
    return (/\/$/.test(url.pathname) || /\/controller\/?$/.test(url.pathname)) && valid(id) ? id : null;
  } catch { return null; }
}
