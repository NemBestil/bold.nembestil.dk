import type { TableFrame } from "../shared/types";

type FrameSubscriber = (frame: TableFrame | null, arrivalTime: number) => void;

/** Delivers visual snapshots directly without putting every pose into Vue state. */
export class ControllerFrameStream {
  private frame: TableFrame | null = null;
  private arrivalTime = 0;
  private subscribers = new Set<FrameSubscriber>();

  get latest(): TableFrame | null { return this.frame; }

  push(frame: TableFrame, arrivalTime = performance.now()): void {
    this.frame = frame;
    this.arrivalTime = arrivalTime;
    for (const subscriber of this.subscribers) subscriber(frame, arrivalTime);
  }

  /** New views receive the latest pose with its original receipt time. */
  subscribe(subscriber: FrameSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.frame, this.arrivalTime);
    return () => { this.subscribers.delete(subscriber); };
  }

  clear(): void {
    if (!this.frame) return;
    this.frame = null;
    this.arrivalTime = 0;
    for (const subscriber of this.subscribers) subscriber(null, 0);
  }
}
