import type { MatchPhase, MatchSettings, ReplayState, TableFrame } from "../../shared/types";
import type { TableModel } from "./TableModel";

/** A single authoritative table renderer, independent of the chosen camera UI. */
export interface GameView {
  readonly table: TableModel;
  settings(settings: MatchSettings): void;
  shake(duration?: number): void;
  render(dt: number, phase?: MatchPhase, replay?: ReplayState): void;
  captureCamera?(): NonNullable<TableFrame["camera"]>;
  dispose(): void;
}
