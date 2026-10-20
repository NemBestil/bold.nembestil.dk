import * as THREE from "three";
import { GAME_CONFIG as C } from "../GameConfig";
import type { MatchPhase, ReplayState } from "../../shared/types";

export const CAMERA_CONFIG = {
  position: { x: 2.45, y: 3.5, z: 3.4 },
  lookY: -0.12,
  portraitFit: 1.25,
  followX: 0.64,
  followZ: 0.25,
  followResponse: 4,
  zoomStart: 0.35,
  zoomEnd: 1.25,
  endZoom: 1.58,
  replayZoom: 2.1,
  replayCloseSeconds: 2,
  replayFullyCloseSeconds: 0.5,
  framingMargin: 0.87,
  lobbyOrbitSpeed: Math.PI / 45,
} as const;

/** Keep tracking bounded to the playable surface, including when the ball flies out. */
export function cameraFocus(
  ball: { x: number; z: number },
  reducedMotion = false,
) {
  if (reducedMotion) return { x: 0, z: 0 };
  const x = Number.isFinite(ball.x) ? ball.x : 0;
  const z = Number.isFinite(ball.z) ? ball.z : 0;
  return {
    x:
      Math.max(-C.table.halfLength, Math.min(C.table.halfLength, x)) *
      CAMERA_CONFIG.followX,
    z:
      Math.max(-C.table.halfWidth, Math.min(C.table.halfWidth, z)) *
      CAMERA_CONFIG.followZ,
  };
}

export function cameraDistance(aspect: number) {
  return Math.max(1, CAMERA_CONFIG.portraitFit / Math.max(0.1, aspect));
}

/** Stay wide in midfield, then ease into the goalmouth as the attack develops. */
export function cameraZoom(ballX: number, reducedMotion = false) {
  if (reducedMotion) return 1;
  const x = Number.isFinite(ballX) ? Math.abs(ballX) : 0;
  const progress = Math.max(
    0,
    Math.min(
      1,
      (x - CAMERA_CONFIG.zoomStart) /
        (CAMERA_CONFIG.zoomEnd - CAMERA_CONFIG.zoomStart),
    ),
  );
  const ease = progress * progress * (3 - 2 * progress);
  return 1 + (CAMERA_CONFIG.endZoom - 1) * ease;
}

export function cameraPose(
  aspect: number,
  focus: { x: number; z: number },
  zoom = 1,
) {
  const distance = cameraDistance(aspect) / Math.max(1, zoom);
  return {
    x: CAMERA_CONFIG.position.x * distance + focus.x,
    y:
      CAMERA_CONFIG.lookY +
      (CAMERA_CONFIG.position.y - CAMERA_CONFIG.lookY) * distance,
    z: CAMERA_CONFIG.position.z * distance + focus.z,
  };
}

/** The close-up follows playback time, including each clip in the final montage. */
export function replayCameraProgress(remaining?: number) {
  if (remaining === undefined || !Number.isFinite(remaining)) return 0;
  const progress = Math.max(0, Math.min(1,
    (CAMERA_CONFIG.replayCloseSeconds - remaining) /
    (CAMERA_CONFIG.replayCloseSeconds - CAMERA_CONFIG.replayFullyCloseSeconds),
  ));
  return progress * progress * (3 - 2 * progress);
}

/** Allow the camera to catch up with a fast pass without losing the ball. */
export function cameraSafeZoom(
  aspect: number,
  focus: { x: number; z: number },
  zoom: number,
  ball: { x: number; y: number; z: number },
) {
  const bx = CAMERA_CONFIG.position.x;
  const by = CAMERA_CONFIG.position.y - CAMERA_CONFIG.lookY;
  const bz = CAMERA_CONFIG.position.z;
  const horizontal = Math.hypot(bx, bz);
  const length = Math.hypot(horizontal, by);
  const tangent = Math.tan((38 * Math.PI) / 360);
  const x = Math.max(
    -C.table.halfLength,
    Math.min(C.table.halfLength, Number.isFinite(ball.x) ? ball.x : 0),
  );
  const z = Math.max(
    -C.table.halfWidth,
    Math.min(C.table.halfWidth, Number.isFinite(ball.z) ? ball.z : 0),
  );
  const points = [{ x, y: Math.max(0.033, Math.min(0.7, ball.y || 0)), z }];
  if (Math.abs(x) > CAMERA_CONFIG.zoomStart) {
    for (const goalZ of [-C.table.goalHalfWidth, C.table.goalHalfWidth])
      for (const goalY of [0, C.table.goalHeight])
        points.push({
          x: Math.sign(x) * C.table.goalBackX,
          y: goalY,
          z: goalZ,
        });
  }
  let minimumDistance = 0;
  for (const point of points) {
    const rx = point.x - focus.x;
    const ry = point.y - CAMERA_CONFIG.lookY;
    const rz = point.z - focus.z;
    const right = (rx * bz - rz * bx) / horizontal;
    const up =
      (-rx * by * bx) / (horizontal * length) +
      (ry * horizontal) / length -
      (rz * by * bz) / (horizontal * length);
    const depth = (rx * bx + ry * by + rz * bz) / length;
    const requiredDepth =
      Math.max(Math.abs(right) / Math.max(0.1, aspect), Math.abs(up)) /
      (tangent * CAMERA_CONFIG.framingMargin);
    minimumDistance = Math.max(minimumDistance, (requiredDepth + depth) / length);
  }
  return Math.max(
    1,
    Math.min(zoom, cameraDistance(aspect) / Math.max(0.001, minimumDistance)),
  );
}

export function cameraBlend(dt: number) {
  return (
    1 - Math.exp(-CAMERA_CONFIG.followResponse * Math.max(0, Math.min(0.1, dt)))
  );
}

/** A slow continuous lap around the full table before the match starts. */
export function lobbyCameraPose(aspect: number, seconds: number, reducedMotion = false) {
  const distance = cameraDistance(aspect);
  const angle = Math.atan2(CAMERA_CONFIG.position.x, CAMERA_CONFIG.position.z) +
    (reducedMotion ? 0 : seconds * CAMERA_CONFIG.lobbyOrbitSpeed);
  const radius = Math.hypot(CAMERA_CONFIG.position.x, CAMERA_CONFIG.position.z);
  return {
    x: Math.sin(angle) * radius * distance,
    y: CAMERA_CONFIG.lookY + (CAMERA_CONFIG.position.y - CAMERA_CONFIG.lookY) * distance,
    z: Math.cos(angle) * radius * distance,
  };
}

/** Shared host/replay camera; controllers use it only for the recorded replay. */
export class HostCameraRig {
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 35);
  private follow = new THREE.Vector3();
  private followTarget = new THREE.Vector3();
  private targetPosition = new THREE.Vector3();
  private zoom = 1;
  private lobbyTime = 0;
  private phase: MatchPhase = "playing";
  private transition = 0;

  constructor(readonly reducedMotion = false) {
    this.resize(1);
  }

  resize(aspect: number) {
    this.camera.aspect = Math.max(0.1, aspect);
    this.camera.updateProjectionMatrix();
    this.applyPose(0);
  }

  update(dt: number, ball: { x: number; y: number; z: number }, phase: MatchPhase = "playing", replay?: ReplayState) {
    const elapsed = Math.max(0, Math.min(0.1, dt));
    if (this.phase === "lobby" && phase !== "lobby") this.transition = 1.2;
    this.phase = phase;
    const blend = cameraBlend(elapsed);
    if (phase === "lobby") {
      if (!this.reducedMotion) this.lobbyTime += elapsed;
      this.followTarget.set(0, 0, 0);
      this.follow.lerp(this.followTarget, blend);
      this.zoom += (1 - this.zoom) * blend;
    } else {
      const focus = cameraFocus(ball, this.reducedMotion);
      const close = !this.reducedMotion && ["replay", "paused", "countdown"].includes(phase)
        ? replayCameraProgress(replay?.remaining) : 0;
      if (close > 0) {
        const x = Math.max(-C.table.halfLength, Math.min(C.table.halfLength,
          Number.isFinite(ball.x) ? ball.x : 0));
        const z = Math.max(-C.table.halfWidth, Math.min(C.table.halfWidth,
          Number.isFinite(ball.z) ? ball.z : 0));
        const actionX = x * 0.72 + Math.sign(x) * C.table.goalLine * 0.28;
        focus.x += (actionX - focus.x) * close;
        focus.z += (z * 0.55 - focus.z) * close;
      }
      this.followTarget.set(focus.x, 0, focus.z);
      this.follow.lerp(this.followTarget, blend);
      const wideZoom = cameraZoom(ball.x, this.reducedMotion);
      const targetZoom = wideZoom + (CAMERA_CONFIG.replayZoom - wideZoom) * close;
      this.zoom += (targetZoom - this.zoom) * blend;
      this.zoom = cameraSafeZoom(this.camera.aspect, this.follow, this.zoom, ball);
    }
    this.applyPose(elapsed);
  }

  private applyPose(dt: number) {
    const lobby = this.phase === "lobby";
    const pose = lobby
      ? lobbyCameraPose(this.camera.aspect, this.lobbyTime, this.reducedMotion)
      : cameraPose(this.camera.aspect, this.follow, this.zoom);
    this.targetPosition.set(pose.x, pose.y, pose.z);
    if (!lobby && this.transition > 0 && !this.reducedMotion) {
      this.transition = Math.max(0, this.transition - dt);
      this.camera.position.lerp(this.targetPosition, 1 - Math.exp(-5 * dt));
    } else this.camera.position.copy(this.targetPosition);
    this.camera.lookAt(lobby ? 0 : this.follow.x, CAMERA_CONFIG.lookY, lobby ? 0 : this.follow.z);
    this.camera.updateMatrixWorld();
  }
}
