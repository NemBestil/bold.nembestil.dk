import type { GameSoundEvent, SessionState, TableFrame } from "../shared/types";
import type { ClientMessage } from "./MessageProtocol";

export interface ControllerTransportCallbacks {
  onState: (state: SessionState, playerId: string) => void;
  onStatus: (status: string, error?: string) => void;
  onFrame?: (frame: TableFrame) => void;
  onSound?: (event: GameSoundEvent) => void;
  onLatency?: (roundTripMs: number) => void;
}
export interface ControllerTransport {
  start(): void;
  send(message: ClientMessage): void;
  dispose(): void;
  reconnect(): void;
}
export type ControllerTransportFactory = (callbacks: ControllerTransportCallbacks) => ControllerTransport;
