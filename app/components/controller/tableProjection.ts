import { ROD_LAYOUT } from "../../../game/GameConfig";
import type { TableFrame, Team } from "../../../shared/types";

export const TABLE_VIEW = { halfLength: 1.82, halfWidth: 0.97, labelHeight: 27 } as const;
const labels = ["Målmand", "Forsvar", "Midtbane", "Angreb"];

/** The two phones share the host's X/Z coordinates, so blue's rods are reversed. */
export function controllerTouchZones(team: Team, rodIds: readonly number[] = [0, 1, 2, 3]) {
  const own = ROD_LAYOUT.map((rod, index) => ({ ...rod, index }))
    .filter((rod) => rod.team === team)
    .sort((a, b) => a.x - b.x);
  return own.map((rod, index) => {
    const left = index === 0 ? -TABLE_VIEW.halfLength : (own[index - 1]!.x + rod.x) / 2;
    const right = index === own.length - 1 ? TABLE_VIEW.halfLength : (rod.x + own[index + 1]!.x) / 2;
    return { ...rod, label: labels[rod.id]!, left, right };
  }).filter((rod) => rodIds.includes(rod.id));
}

export function tableViewport(width: number, height: number) {
  const scale = Math.max(1, Math.min(
    Math.max(1, width - 8) / (TABLE_VIEW.halfLength * 2),
    Math.max(1, height - TABLE_VIEW.labelHeight - 8) / (TABLE_VIEW.halfWidth * 2),
  ));
  const boardWidth = TABLE_VIEW.halfLength * 2 * scale;
  const boardHeight = TABLE_VIEW.halfWidth * 2 * scale;
  return {
    scale,
    left: (width - boardWidth) / 2,
    top: (height - boardHeight - TABLE_VIEW.labelHeight) / 2,
    width: boardWidth,
    height: boardHeight,
    x: width / 2,
    z: (height - TABLE_VIEW.labelHeight) / 2,
  };
}

export function normalizedRodPosition(frame: TableFrame | null, index: number) {
  const layout = ROD_LAYOUT[index];
  const physical = frame?.rods[index]?.translation;
  return layout && typeof physical === "number" && Number.isFinite(physical)
    ? Math.max(-1, Math.min(1, physical / layout.travel)) : 0;
}
