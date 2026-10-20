import * as THREE from "three";
import { GAME_CONFIG as C } from "../GameConfig";
import { createPlayingSurfaceMesh } from "../table/PlayingSurface";

/** The grass follows exactly the same planes and heights as the ball collider. */
export function createPlayingSurfaceGeometry() {
  const { halfLength, halfWidth } = C.table;
  const { vertices, indices } = createPlayingSurfaceMesh({ halfLength, halfWidth });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  const uv = new Float32Array(vertices.length / 3 * 2);
  for (let index = 0; index < vertices.length / 3; index++) {
    uv[index * 2] = (vertices[index * 3]! + halfLength) / (2 * halfLength);
    uv[index * 2 + 1] = (halfWidth - vertices[index * 3 + 2]!) / (2 * halfWidth);
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geometry.computeVertexNormals();
  return geometry;
}
