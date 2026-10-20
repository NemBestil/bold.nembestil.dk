import { GAME_CONFIG as C } from "./GameConfig";

/** Bounded accumulator: background tabs never cause a spiral of catch-up work. */
export class GameLoop {
  private frame = 0;
  private previous = 0;
  private accumulator = 0;
  private lastRender = 0;
  private nextRender = 0;
  private stopped = false;
  constructor(
    private step: (dt: number) => void,
    private render: (dt: number) => void,
    private renderFps: number = C.rendering.targetFps,
  ) {}
  start() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.stopped = false;
    this.previous = performance.now();
    this.accumulator = 0;
    this.lastRender = this.previous;
    this.nextRender = this.previous + 1000 / this.renderFps;
    this.frame = requestAnimationFrame(this.tick);
  }
  private tick = (time: number) => {
    if (this.stopped) return;
    const elapsed = Math.min(
      C.physics.maxFrameTime,
      Math.max(0, (time - this.previous) / 1000),
    );
    this.previous = time;
    this.accumulator += elapsed;
    let steps = 0;
    while (
      this.accumulator >= C.physics.timestep &&
      steps < C.physics.maxSteps
    ) {
      this.step(C.physics.timestep);
      this.accumulator -= C.physics.timestep;
      steps++;
    }
    if (steps === C.physics.maxSteps) this.accumulator = 0;
    if (time + 0.8 >= this.nextRender) {
      this.render(Math.min(C.physics.maxFrameTime, Math.max(0, (time - this.lastRender) / 1000)));
      this.lastRender = time;
      // Keep the target cadence between display refreshes (e.g. 60 on 144 Hz).
      // Skip missed deadlines after a stall instead of rendering a catch-up burst.
      const interval = 1000 / this.renderFps;
      this.nextRender += (Math.floor((time + 0.8 - this.nextRender) / interval) + 1) * interval;
    }
    this.frame = requestAnimationFrame(this.tick);
  };
  dispose() {
    this.stopped = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }
}
