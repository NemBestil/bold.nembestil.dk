import { GAME_CONFIG as C } from "../GameConfig";

const core = C.figure.footHalfSize - C.figure.footEdgeBevel;
const exponent = C.figure.footExponent;
const segments = 64;
const signedPower = (value: number, power: number) =>
  Math.sign(value) * Math.abs(value) ** power;

/** Shared superellipse core, rounded by the same 5 mm rim in physics and visuals. */
export function footCoreVertices(): Float32Array {
  const positions: number[] = [];
  for (const y of [-core, core])
    for (let i = 0; i < segments; i++) {
      const theta = i * Math.PI * 2 / segments;
      positions.push(
        core * signedPower(Math.cos(theta), 2 / exponent),
        y,
        core * signedPower(Math.sin(theta), 2 / exponent),
      );
    }
  return new Float32Array(positions);
}

export function footRenderMesh() {
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: { y: number; offset: number }[] = [];
  const bevel = C.figure.footEdgeBevel;
  for (const side of [-1, 1])
    for (let step = 0; step <= 4; step++) {
      const theta = side < 0 ? -Math.PI / 2 + step * Math.PI / 8 : step * Math.PI / 8;
      rings.push({ y: side * core + bevel * Math.sin(theta), offset: bevel * Math.cos(theta) });
    }
  for (const ring of rings)
    for (let i = 0; i < segments; i++) {
      const theta = i * Math.PI * 2 / segments;
      const x = signedPower(Math.cos(theta), 2 / exponent);
      const z = signedPower(Math.sin(theta), 2 / exponent);
      const nx = signedPower(x, exponent - 1), nz = signedPower(z, exponent - 1);
      const magnitude = Math.hypot(nx, nz);
      positions.push(core * x + ring.offset * nx / magnitude, ring.y, core * z + ring.offset * nz / magnitude);
    }
  for (let ring = 0; ring < rings.length - 1; ring++)
    for (let i = 0; i < segments; i++) {
      const a = ring * segments + i, b = ring * segments + (i + 1) % segments;
      indices.push(a, a + segments, b, b, a + segments, b + segments);
    }
  const bottom = positions.length / 3;
  positions.push(0, -C.figure.footHalfSize, 0, 0, C.figure.footHalfSize, 0);
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(bottom, i, next);
    indices.push(bottom + 1, (rings.length - 1) * segments + next, (rings.length - 1) * segments + i);
  }
  return { positions: new Float32Array(positions), indices };
}

type Point = { x: number; y: number; z: number };
/** Normal at the actual sphere/profile contact, including the ball and rounded rim. */
export function footStrikingNormal(lateralOffset: number, side: number) {
  const offset = Math.min(Math.abs(lateralOffset), core + C.figure.footEdgeBevel + C.ball.radius);
  let low = 0, high = core;
  for (let iteration = 0; iteration < 32; iteration++) {
    const z = (low + high) / 2;
    const x = core * Math.max(0, 1 - (z / core) ** exponent) ** (1 / exponent);
    const nx = x ** (exponent - 1), nz = z ** (exponent - 1);
    const normalZ = nz / Math.hypot(nx, nz);
    if (z + (C.figure.footEdgeBevel + C.ball.radius) * normalZ < offset) low = z;
    else high = z;
  }
  const z = (low + high) / 2;
  const x = core * Math.max(0, 1 - (z / core) ** exponent) ** (1 / exponent);
  const nx = x ** (exponent - 1), nz = z ** (exponent - 1);
  const length = Math.hypot(nx, nz);
  return { x: Math.sign(side) * nx / length, z: Math.sign(lateralOffset) * nz / length };
}
/** Closest point on the convex X/Z superellipse; used only beside a grounded ball. */
function closestProfile(x: number, z: number) {
  if ((Math.abs(x) / core) ** exponent + (Math.abs(z) / core) ** exponent <= 1)
    return { x, z };
  const px = Math.abs(x), pz = Math.abs(z);
  const distance = (theta: number) => {
    const dx = core * Math.cos(theta) ** (2 / exponent) - px;
    const dz = core * Math.sin(theta) ** (2 / exponent) - pz;
    return dx * dx + dz * dz;
  };
  let low = 0, high = Math.PI / 2;
  for (let i = 0; i < 28; i++) {
    const a = (2 * low + high) / 3, b = (low + 2 * high) / 3;
    if (distance(a) < distance(b)) high = b;
    else low = a;
  }
  // Include exact face centers; avoiding an angular epsilon keeps central shots straight.
  let theta = (low + high) / 2;
  if (distance(0) < distance(theta)) theta = 0;
  if (distance(Math.PI / 2) < distance(theta)) theta = Math.PI / 2;
  return {
    x: Math.sign(x) * core * Math.cos(theta) ** (2 / exponent),
    z: Math.sign(z) * core * Math.sin(theta) ** (2 / exponent),
  };
}

function footContact(angle: number, translation: number, rodX: number, offset: number, ball: Point) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const dx = ball.x - rodX, dy = ball.y - C.table.rodHeight;
  const x = cos * dx + sin * dy;
  const y = -sin * dx + cos * dy - C.figure.footY;
  const z = ball.z - translation - offset;
  const nearest = closestProfile(x, z);
  const nx = x - nearest.x;
  const ny = y - Math.max(-core, Math.min(core, y));
  const nz = z - nearest.z;
  const length = Math.hypot(nx, ny, nz);
  const normal = length > 1e-8
    ? { x: (cos * nx - sin * ny) / length, y: (sin * nx + cos * ny) / length, z: nz / length }
    : { x: 0, y: -1, z: 0 };
  return {
    distance: length - C.figure.footEdgeBevel - C.ball.radius,
    normal,
    leverX: dx - normal.x * C.ball.radius,
    leverY: dy - normal.y * C.ball.radius,
  };
}

export interface GroundedFootRotation {
  fromAngle: number;
  toAngle: number;
  fromTranslation: number;
  toTranslation: number;
  rodX: number;
  figureOffsets: readonly number[];
  ball: Point;
  surfaceHeight: number;
  /** Keep an existing pin while pressure is held, but release immediately on retraction. */
  heldDirection?: number;
}

/** Pure sweep shared by host physics and the locally held controller rod. */
export function limitGroundedFootRotation(input: GroundedFootRotation) {
  const { fromAngle, toAngle, fromTranslation, toTranslation, rodX, ball } = input;
  const delta = toAngle - fromAngle;
  const direction = Math.sign(delta) || input.heldDirection || 0;
  const free = { angle: toAngle, blocked: false, direction };
  if (!direction || ball.y > input.surfaceHeight + C.ball.radius + 0.008 ||
      ball.y < input.surfaceHeight + C.ball.radius - 0.012 ||
      Math.abs(ball.x - rodX) > 0.28) return free;
  const intervals = Math.max(1, Math.ceil(Math.abs(delta) / 0.018), Math.ceil(Math.abs(toTranslation - fromTranslation) / 0.008));
  for (const offset of input.figureOffsets) {
    if (Math.abs(ball.z - toTranslation - offset) > C.figure.footHalfSize + C.ball.radius + Math.abs(toTranslation - fromTranslation)) continue;
    for (let step = 0; step <= intervals; step++) {
      const fraction = step / intervals;
      const angle = fromAngle + delta * fraction;
      const translation = fromTranslation + (toTranslation - fromTranslation) * fraction;
      const contact = footContact(angle, translation, rodX, offset, ball);
      // Downward face pressure traps a ball against the pitch; side strikes stay free.
      if (contact.distance > 0.0005 || contact.normal.y > -0.4 || direction * contact.leverX >= -0.002) continue;
      const approach = direction * (-contact.leverY * contact.normal.x + contact.leverX * contact.normal.y);
      if (approach <= 0) continue;
      let low = Math.max(0, (step - 1) / intervals), high = fraction;
      for (let iteration = 0; iteration < 12 && high > low; iteration++) {
        const middle = (low + high) / 2;
        const test = footContact(fromAngle + delta * middle, fromTranslation + (toTranslation - fromTranslation) * middle, rodX, offset, ball);
        if (test.distance <= 0.0005) high = middle;
        else low = middle;
      }
      return { angle: fromAngle + delta * low, blocked: true, direction };
    }
  }
  return free;
}
