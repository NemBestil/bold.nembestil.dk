import type { GameSoundEvent } from "../../shared/types";

const samples = {
  goal: "goal-cheer.mp3",
  whistle: "referee-whistle.mp3",
} as const;

/** Local playback only. Physics and networking decide when a sound exists. */
export class GameAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<AudioScheduledSourceNode, GainNode>();
  private loading?: Promise<void>;
  private abort = new AbortController();
  private disposed = false;
  private isMuted = false;
  private lastId = -1;
  private lastImpact = -Infinity;
  private noise?: AudioBuffer;

  constructor(private assetBase = "/") {}

  get muted() {
    return this.isMuted;
  }

  /** Must be called directly by a user gesture; never replays sounds missed while locked. */
  async unlock(): Promise<void> {
    if (this.disposed) return;
    try {
      if (!this.context) {
        const globals = globalThis as typeof globalThis & {
          webkitAudioContext?: typeof AudioContext;
        };
        const Context = globals.AudioContext ?? globals.webkitAudioContext;
        if (!Context) return;
        this.context = new Context();
        this.master = this.context.createGain();
        this.master.gain.value = this.isMuted ? 0 : 0.7;
        this.master.connect(this.context.destination);
      }
      // Resume before the first await, while the browser still recognizes the gesture.
      const resumed = this.context.resume();
      this.loading ??= this.loadSamples(this.context).finally(() => {
        this.loading = undefined;
      });
      await Promise.all([resumed, this.loading]);
    } catch {
      // Restricted browsers remain playable and can retry on the next gesture.
    }
  }

  setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.master && this.context)
      this.master.gain.setValueAtTime(
        muted ? 0 : 0.7,
        this.context.currentTime,
      );
    if (muted) this.stop();
  }

  play(event: GameSoundEvent): void {
    if (
      this.disposed ||
      !Number.isSafeInteger(event.id) ||
      event.id <= this.lastId ||
      !Number.isFinite(event.strength)
    )
      return;
    this.lastId = event.id;
    const context = this.context;
    if (this.isMuted || !context || context.state !== "running" || !this.master)
      return;
    const strength = Math.max(0, Math.min(1, event.strength));
    if (event.kind === "kick" || event.kind === "wall") {
      if (context.currentTime - this.lastImpact < 0.025) return;
      this.lastImpact = context.currentTime;
      this.impact(event.kind, strength);
      return;
    }
    const buffer = this.buffers.get(event.kind);
    if (buffer) {
      const source = context.createBufferSource();
      source.buffer = buffer;
      this.voice(
        source,
        event.kind === "goal" ? 0.85 : 0.65,
        Math.min(buffer.duration, event.kind === "goal" ? 2.7 : 1.3),
      );
    } else if (event.kind === "whistle") this.whistle();
  }

  stop(): void {
    for (const [source, gain] of this.voices) {
      try {
        source.stop();
      } catch {
        /* Already ended. */
      }
      source.disconnect();
      gain.disconnect();
    }
    this.voices.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.stop();
    this.buffers.clear();
    this.noise = undefined;
    this.master?.disconnect();
    void this.context?.close().catch(() => {});
    this.context = undefined;
  }

  private async loadSamples(context: AudioContext): Promise<void> {
    await Promise.all(
      Object.entries(samples).map(async ([kind, file]) => {
        if (this.buffers.has(kind)) return;
        try {
          const response = await fetch(
            `${this.assetBase.replace(/\/$/, "")}/audio/${file}`,
            { signal: this.abort.signal },
          );
          if (!response.ok) return;
          const buffer = await context.decodeAudioData(
            await response.arrayBuffer(),
          );
          if (!this.disposed) this.buffers.set(kind, buffer);
        } catch {
          /* Impact synthesis and a whistle fallback need no downloaded assets. */
        }
      }),
    );
  }

  private voice(
    source: AudioScheduledSourceNode,
    volume: number,
    duration: number,
  ) {
    const context = this.context!;
    while (this.voices.size >= 12) {
      const [oldest, gain] = this.voices.entries().next().value!;
      try {
        oldest.stop();
      } catch {
        /* Ended. */
      }
      oldest.disconnect();
      gain.disconnect();
      this.voices.delete(oldest);
    }
    const gain = context.createGain();
    const now = context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      volume,
      now + Math.min(0.015, duration / 4),
    );
    gain.gain.setValueAtTime(volume, now + Math.max(0.02, duration - 0.15));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain);
    gain.connect(this.master!);
    this.voices.set(source, gain);
    source.onended = () => {
      this.voices.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(now);
    source.stop(now + duration);
  }

  private impact(kind: "kick" | "wall", strength: number) {
    const context = this.context!;
    const volume = Math.pow(strength, 0.65) * (kind === "kick" ? 0.7 : 0.52);
    const oscillator = context.createOscillator();
    const now = context.currentTime;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(kind === "kick" ? 165 : 480, now);
    oscillator.frequency.exponentialRampToValueAtTime(
      kind === "kick" ? 55 : 170,
      now + 0.075,
    );
    this.voice(oscillator, volume, kind === "kick" ? 0.11 : 0.075);
    if (!this.noise) {
      this.noise = context.createBuffer(
        1,
        Math.ceil(context.sampleRate * 0.13),
        context.sampleRate,
      );
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] =
          (Math.random() * 2 - 1) * Math.exp(-i / (context.sampleRate * 0.012));
    }
    const noise = context.createBufferSource();
    noise.buffer = this.noise;
    this.voice(noise, volume * (kind === "kick" ? 0.5 : 0.9), 0.06);
  }

  private whistle() {
    for (const frequency of [2850, 3320]) {
      const oscillator = this.context!.createOscillator();
      oscillator.frequency.value = frequency;
      this.voice(oscillator, 0.1, 0.7);
    }
  }
}
