import { GAME_CONFIG as C } from "../GameConfig";

export interface SurfaceBounds {
  halfLength: number;
  halfWidth: number;
}

interface Point {
  x: number;
  z: number;
}
interface Plane {
  x: number;
  z: number;
  constant: number;
}

const epsilon = 1e-9;
const evaluate = (plane: Plane, point: Point) =>
  plane.x * point.x + plane.z * point.z + plane.constant;

/** The border rises from the painted touchlines; corner ramps meet it without a step. */
export function playingSurfaceHeight(x: number, z: number): number {
  const { halfLength, halfWidth, surfaceRise, cornerRise, sideSlopeStart, cornerRampLength } =
    C.table;
  const edgeX = Math.min(Math.abs(x), halfLength);
  const edgeZ = Math.min(Math.abs(z), halfWidth);
  const side = (edgeZ - sideSlopeStart) / (halfWidth - sideSlopeStart);
  const corner =
    1 - (halfLength - edgeX + halfWidth - edgeZ) / cornerRampLength;
  // Taking the higher plane joins the ramps, rather than doubling the corner height.
  return Math.max(0, surfaceRise * side, cornerRise * corner);
}

/** Clip a convex polygon to the side on which its surface plane is highest. */
function clip(polygon: Point[], own: Plane, other: Plane): Point[] {
  const output: Point[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const start = polygon[i]!;
    const end = polygon[(i + 1) % polygon.length]!;
    const from = evaluate(own, start) - evaluate(other, start);
    const to = evaluate(own, end) - evaluate(other, end);
    const startInside = from >= -epsilon;
    const endInside = to >= -epsilon;
    if (startInside) output.push(start);
    if (startInside !== endInside) {
      const t = from / (from - to);
      output.push({
        x: start.x + (end.x - start.x) * t,
        z: start.z + (end.z - start.z) * t,
      });
    }
  }
  return output;
}

/**
 * One continuous, upward-facing surface for both rendering and the fixed Rapier collider.
 * The default includes the goal floors and serving tunnels. Custom bounds trim the same
 * planes to the visible grass. Polygon clipping retains the exact triangular corner faces.
 */
export function createPlayingSurfaceMesh(
  bounds: SurfaceBounds = {
    halfLength: C.table.floorHalfLength,
    halfWidth: C.table.floorHalfWidth,
  },
): { vertices: Float32Array; indices: Uint32Array } {
  const { halfLength, halfWidth, surfaceRise, cornerRise, sideSlopeStart, cornerRampLength } =
    C.table;
  const cuts = (bound: number, edge: number) =>
    [-bound, -edge, edge, bound]
      .filter((value) => Math.abs(value) <= bound)
      .filter((value, index, values) => index === 0 || value !== values[index - 1]);
  const xs = cuts(bounds.halfLength, halfLength);
  const zs = cuts(bounds.halfWidth, halfWidth);
  const polygons: Point[][] = [];
  for (let xi = 0; xi < xs.length - 1; xi++) {
    for (let zi = 0; zi < zs.length - 1; zi++) {
      const left = xs[xi]!, right = xs[xi + 1]!;
      const near = zs[zi]!, far = zs[zi + 1]!;
      // Outside the pitch the surface continues at the edge height. In particular,
      // there is no raised lip in either goal and no step in a serving entrance.
      const clampedAxis = (middle: number, edge: number) =>
        Math.abs(middle) > edge
          ? { scale: 0, offset: Math.sign(middle) * edge }
          : { scale: 1, offset: 0 };
      const x = clampedAxis((left + right) / 2, halfLength);
      const z = clampedAxis((near + far) / 2, halfWidth);
      const planes: Plane[] = [{ x: 0, z: 0, constant: 0 }];
      for (const sign of [-1, 1]) {
        const sideGradient = surfaceRise / (halfWidth - sideSlopeStart);
        planes.push({
          x: 0,
          z: sign * z.scale * sideGradient,
          constant: (sign * z.offset - sideSlopeStart) * sideGradient,
        });
        for (const other of [-1, 1]) {
          const cornerGradient = cornerRise / cornerRampLength;
          planes.push({
            x: sign * x.scale * cornerGradient,
            z: other * z.scale * cornerGradient,
            constant:
              cornerRise +
              (sign * x.offset + other * z.offset - halfLength - halfWidth) *
                cornerGradient,
          });
        }
      }
      const unique = planes.filter(
        (plane, index) =>
          !planes.slice(0, index).some(
            (other) =>
              Math.abs(plane.x - other.x) < epsilon &&
              Math.abs(plane.z - other.z) < epsilon &&
              Math.abs(plane.constant - other.constant) < epsilon,
          ),
      );
      for (const plane of unique) {
        let polygon: Point[] = [
          { x: left, z: near }, { x: left, z: far },
          { x: right, z: far }, { x: right, z: near },
        ];
        for (const other of unique) {
          if (other !== plane) polygon = clip(polygon, plane, other);
          if (polygon.length < 3) break;
        }
        const area = polygon.reduce((total, point, index) => {
          const next = polygon[(index + 1) % polygon.length]!;
          return total + point.x * next.z - next.x * point.z;
        }, 0);
        if (Math.abs(area) > epsilon) polygons.push(polygon);
      }
    }
  }

  const vertices: number[] = [];
  const indices: number[] = [];
  const points = new Map<string, number>();
  const vertex = (point: Point) => {
    const key = `${Math.round(point.x / epsilon)},${Math.round(point.z / epsilon)}`;
    let index = points.get(key);
    if (index === undefined) {
      index = vertices.length / 3;
      points.set(key, index);
      vertices.push(point.x, playingSurfaceHeight(point.x, point.z), point.z);
    }
    return index;
  };
  for (const polygon of polygons) for (const point of polygon) vertex(point);
  const boundaryPoints: Point[] = [];
  for (let i = 0; i < vertices.length; i += 3)
    boundaryPoints.push({ x: vertices[i]!, z: vertices[i + 2]! });

  for (const polygon of polygons) {
    const boundary: number[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const start = polygon[i]!, end = polygon[(i + 1) % polygon.length]!;
      const dx = end.x - start.x, dz = end.z - start.z;
      const lengthSquared = dx * dx + dz * dz;
      if (lengthSquared < epsilon ** 2) continue;
      // Split shared edges at every neighboring vertex, avoiding T-junctions between
      // the pitch and its extensions and allowing Rapier to fix internal normals.
      const edge = boundaryPoints.flatMap((point) => {
        const t = ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSquared;
        const distance = Math.abs((point.x - start.x) * dz - (point.z - start.z) * dx);
        return t >= -epsilon && t < 1 - epsilon && distance < epsilon
          ? [{ t, index: vertex(point) }]
          : [];
      });
      edge.sort((a, b) => a.t - b.t);
      boundary.push(...edge.map((entry) => entry.index));
    }
    const center = vertex({
      x: polygon.reduce((sum, point) => sum + point.x, 0) / polygon.length,
      z: polygon.reduce((sum, point) => sum + point.z, 0) / polygon.length,
    });
    for (let i = 0; i < boundary.length; i++)
      indices.push(center, boundary[i]!, boundary[(i + 1) % boundary.length]!);
  }
  return { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) };
}
