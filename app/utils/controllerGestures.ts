import type { ControllerPreferences } from "../composables/useControllerPreferences";
import { swipeAngularVelocity } from "../composables/useTouchInput";
import { GAME_CONFIG } from "../../game/GameConfig";

export interface GesturePoint { x: number; z: number; pixelX: number; time: number }
export interface GestureRod { id: number; x: number; translation: number }
interface Crossing {
  rodId: number; translation: number; angularVelocity: number; active: false; flick: true; rotationOnly: true; at: number;
}
interface Gesture { previous: GesturePoint; initialRod?: number; crossed: Set<number>; pending: Crossing[] }

/** Crossed rods get a kick only when a quick, intentional gesture finishes. */
export class ControllerGestureTracker {
  private gestures = new Map<number, Gesture>();

  start(pointer: number, point: GesturePoint, initialRod?: number) {
    this.gestures.set(pointer, { previous: point, initialRod, crossed: new Set(), pending: [] });
  }
  move(pointer: number, point: GesturePoint, owned: readonly GestureRod[], occupied: ReadonlySet<number>, preferences: ControllerPreferences) {
    const gesture = this.gestures.get(pointer);
    if (!gesture || ![point.x, point.z, point.pixelX, point.time].every(Number.isFinite)) return;
    const before = gesture.previous;
    const pixels = point.pixelX - before.pixelX;
    const seconds = Math.max(0.001, (point.time - before.time) / 1000);
    const dx = point.x - before.x;
    if (Math.abs(pixels / seconds) >= 100 && Math.abs(dx) > 1e-8) {
      for (const rod of owned) {
        if (rod.id === gesture.initialRod || gesture.crossed.has(rod.id) || occupied.has(rod.id)) continue;
        const t = (rod.x - before.x) / dx;
        const z = before.z + (point.z - before.z) * t;
        if (t <= 0 || t > 1 || Math.abs(z) > GAME_CONFIG.table.halfWidth) continue;
        gesture.crossed.add(rod.id);
        gesture.pending.push({ rodId: rod.id, translation: rod.translation,
          angularVelocity: swipeAngularVelocity(pixels, seconds, preferences), active: false, flick: true, rotationOnly: true, at: point.time });
      }
    }
    gesture.previous = point;
  }
  finish(pointer: number, point: GesturePoint, owned: readonly GestureRod[], occupied: ReadonlySet<number>, preferences: ControllerPreferences) {
    this.move(pointer, point, owned, occupied, preferences);
    const gesture = this.gestures.get(pointer);
    this.gestures.delete(pointer);
    return (gesture?.pending ?? []).filter((hit) => point.time - hit.at <= 150 &&
      owned.some((rod) => rod.id === hit.rodId) && !occupied.has(hit.rodId)).map(({ at: _, ...input }) => input);
  }
  cancel(pointer: number) { this.gestures.delete(pointer); }
  clear() { this.gestures.clear(); }
}
