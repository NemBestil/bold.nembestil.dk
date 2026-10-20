import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GAME_CONFIG as C } from "../game/GameConfig";
import { createPlayingSurfaceGeometry } from "../game/rendering/PlayingSurfaceGeometry";
import { playingSurfaceHeight } from "../game/table/PlayingSurface";

describe("visible sloped playing surface", () => {
  it("uses the physical side and triangular corner heights over the whole grass pitch", () => {
    const geometry = createPlayingSurfaceGeometry();
    const position = geometry.getAttribute("position");
    const indices = geometry.getIndex()!;
    let highest = 0;
    for (let index = 0; index < position.count; index++) {
      const x = position.getX(index), y = position.getY(index), z = position.getZ(index);
      expect(y).toBeCloseTo(playingSurfaceHeight(x, z), 7);
      expect(Math.abs(x)).toBeLessThanOrEqual(C.table.halfLength + 1e-6);
      expect(Math.abs(z)).toBeLessThanOrEqual(C.table.halfWidth + 1e-6);
      highest = Math.max(highest, y);
    }
    expect(highest).toBeCloseTo(0.022, 7);
    const point = (index: number) => new THREE.Vector3().fromBufferAttribute(position, indices.getX(index));
    for (let index = 0; index < indices.count; index += 3) {
      const a = point(index), b = point(index + 1), c = point(index + 2);
      const center = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      // A triangle cannot bridge a crease or turn a triangular corner into a curved ramp.
      expect(center.y).toBeCloseTo(playingSurfaceHeight(center.x, center.z), 7);
      expect(b.sub(a).cross(c.sub(a)).y).toBeGreaterThan(0);
    }
    geometry.dispose();
  });

  it("keeps the existing pitch markings correctly aligned across each ramp", () => {
    const geometry = createPlayingSurfaceGeometry();
    const position = geometry.getAttribute("position");
    const uv = geometry.getAttribute("uv");
    for (let index = 0; index < position.count; index++) {
      expect(uv.getX(index) * 2 * C.table.halfLength - C.table.halfLength)
        .toBeCloseTo(position.getX(index), 6);
      expect(C.table.halfWidth - uv.getY(index) * 2 * C.table.halfWidth)
        .toBeCloseTo(position.getZ(index), 6);
    }
    expect((C.table.halfWidth - C.table.sideSlopeStart) / (2 * C.table.halfWidth) * 512)
      .toBeCloseTo(24);
    geometry.dispose();
  });
});
