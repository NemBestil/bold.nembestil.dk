/** Finish initial device detection before applying a later explicit choice.
 * A failed automatic load must never prevent the user from switching manually. */
export function createLanguageDetection(apply: () => Promise<unknown>) {
  let started = false;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  return {
    ready,
    async run() {
      if (started) return ready;
      started = true;
      try { await apply(); }
      catch { /* Manual switching can retry even when initial detection fails. */ }
      finally { finish(); }
    },
  };
}
