import RAPIER from "@dimforge/rapier3d-compat";
import { GAME_CONFIG as C } from "../GameConfig";
import { footCoreVertices } from "./FootProfile";

/** The physical n=4 profile has a flat center and progressively angled shoulders. */
export function superellipseFootCollider() {
  return RAPIER.ColliderDesc.roundConvexHull(footCoreVertices(), C.figure.footEdgeBevel)!;
}
