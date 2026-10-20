import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  CAMERA_CONFIG,
  cameraBlend,
  cameraDistance,
  cameraFocus,
  cameraPose,
  cameraSafeZoom,
  cameraZoom,
} from "../game/rendering/SceneManager";
import { HostCameraRig, lobbyCameraPose, replayCameraProgress } from "../game/rendering/HostCamera";
import { GAME_CONFIG as C } from "../game/GameConfig";

const aspects = [0.6, 0.8, 1, 1.3, 1.6, 2.4];

function view(aspect: number, focus: { x: number; z: number }, zoom = 1) {
  const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 35);
  const pose = cameraPose(aspect, focus, zoom);
  camera.position.set(pose.x, pose.y, pose.z);
  camera.lookAt(focus.x, CAMERA_CONFIG.lookY, focus.z);
  camera.updateMatrixWorld();
  return camera;
}

function visible(point: THREE.Vector3, camera: THREE.Camera, margin = 0.98) {
  const screen = point.clone().project(camera);
  expect(Math.abs(screen.x)).toBeLessThan(margin);
  expect(Math.abs(screen.y)).toBeLessThan(margin);
  expect(screen.z).toBeLessThan(1);
}

describe("ball-follow camera", () => {
  it("shows the full field, both goals, counters and cabinet feet at midfield", () => {
    const points: THREE.Vector3[] = [];
    for (const x of [-1.74, 1.74])
      for (const z of [-0.94, 0.94])
        points.push(new THREE.Vector3(x, -0.25, z));
    for (const x of [-1.17, 1.17])
      for (const z of [-0.65, 0.65]) points.push(new THREE.Vector3(x, -1, z));
    for (const x of [-1.61, 1.61])
      for (const z of [-0.7, 0.7]) points.push(new THREE.Vector3(x, 0.45, z));
    expect(cameraZoom(0)).toBe(1);
    for (const aspect of aspects) {
      const camera = view(aspect, cameraFocus({ x: 0, z: 0 }), cameraZoom(0));
      for (const point of points) visible(point, camera);
    }
  });

  it("zooms noticeably into either end while keeping the ball and active goal visible", () => {
    expect(cameraZoom(1.4)).toBeGreaterThan(1.5);
    expect(cameraZoom(-1.4)).toBe(cameraZoom(1.4));
    expect(cameraZoom(0.8)).toBeGreaterThan(cameraZoom(0.4));
    expect(cameraZoom(1.1)).toBeGreaterThan(cameraZoom(0.8));
    for (const aspect of aspects)
      for (const x of [-1.4, 1.4])
        for (const z of [-0.75, 0.75]) {
          const ball = { x, y: 0.033, z };
          const focus = cameraFocus(ball);
          const zoom = cameraSafeZoom(aspect, focus, cameraZoom(x), ball);
          expect(zoom).toBeGreaterThan(1.5);
          const camera = view(aspect, focus, zoom);
          visible(new THREE.Vector3(x, ball.y, z), camera, 0.9);
          for (const goalZ of [-0.23, 0.23])
            visible(new THREE.Vector3(Math.sign(x) * 1.74, 0.22, goalZ), camera, 0.9);
          const wide = view(aspect, focus);
          expect(camera.position.distanceTo(new THREE.Vector3(focus.x, CAMERA_CONFIG.lookY, focus.z)))
            .toBeLessThan(wide.position.distanceTo(new THREE.Vector3(focus.x, CAMERA_CONFIG.lookY, focus.z)) * 0.67);
        }
  });

  it("keeps a maximum-speed cross-table pass visible while the camera catches up", () => {
    for (const aspect of aspects)
      for (const rate of [30, 120]) {
        let focus = cameraFocus({ x: -1.4, z: -0.75 });
        let zoom = cameraZoom(-1.4);
        for (let frame = 0; frame <= rate / 3; frame++) {
          const x = Math.min(1.4, -1.4 + (frame / rate) * 12);
          const z = Math.min(0.75, -0.75 + (frame / rate) * 6);
          const ball = { x, y: 0.033, z };
          const target = cameraFocus(ball);
          const blend = cameraBlend(1 / rate);
          focus = {
            x: focus.x + (target.x - focus.x) * blend,
            z: focus.z + (target.z - focus.z) * blend,
          };
          zoom += (cameraZoom(x) - zoom) * blend;
          zoom = cameraSafeZoom(aspect, focus, zoom, ball);
          visible(new THREE.Vector3(x, ball.y, z), view(aspect, focus, zoom), 0.9);
        }
      }
  });

  it("moves and zooms smoothly at the same speed on 30 Hz and 120 Hz screens", () => {
    const follow = (rate: number) => {
      let value = 0;
      for (let i = 0; i < rate; i++)
        value += (1 - value) * cameraBlend(1 / rate);
      return value;
    };
    expect(follow(30)).toBeCloseTo(follow(120), 10);
    expect(cameraBlend(1 / 60)).toBeGreaterThan(0);
    expect(cameraBlend(1 / 60)).toBeLessThan(0.1);
  });

  it("keeps a stable wide view when reduced motion is requested", () => {
    for (const x of [-1.4, 0, 1.4]) {
      expect(cameraFocus({ x, z: 0.75 }, true)).toEqual({ x: 0, z: 0 });
      expect(cameraZoom(x, true)).toBe(1);
    }
  });

  it("never chases an escaped ball or invalid sample outside the table", () => {
    expect(cameraFocus({ x: 100, z: -100 })).toEqual(
      cameraFocus({ x: 1.4, z: -0.75 }),
    );
    expect(cameraFocus({ x: NaN, z: Infinity })).toEqual({ x: 0, z: 0 });
    expect(cameraZoom(NaN)).toBe(1);
    expect(cameraZoom(Infinity)).toBe(1);
    expect(cameraDistance(1.2499)).toBeCloseTo(cameraDistance(1.2501), 3);
  });
});

describe("lobby camera orbit", () => {
  it("continuously orbits the whole table at a slow constant speed", () => {
    const rig = new HostCameraRig();
    rig.resize(1.6);
    rig.update(0, { x: 0, y: 0.033, z: 0 }, "lobby");
    const start = rig.camera.position.clone();
    for (let i = 0; i < 600; i++) rig.update(1 / 60, { x: 0, y: 0.033, z: 0 }, "lobby");
    expect(rig.camera.position.distanceTo(start)).toBeGreaterThan(1);
    expect(rig.camera.position.y).toBeCloseTo(start.y);
    expect(Math.hypot(rig.camera.position.x, rig.camera.position.z)).toBeCloseTo(Math.hypot(start.x, start.z));
    for (const aspect of aspects)
      for (let seconds = 0; seconds < 90; seconds += 3) {
        const camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 35);
        const pose = lobbyCameraPose(aspect, seconds);
        camera.position.set(pose.x, pose.y, pose.z);
        camera.lookAt(0, CAMERA_CONFIG.lookY, 0);
        camera.updateMatrixWorld();
        for (const x of [-1.74, 1.74])
          for (const z of [-0.94, 0.94])
            for (const y of [-0.25, 0.45]) visible(new THREE.Vector3(x, y, z), camera, 0.99);
      }
  });

  it("stops the orbit smoothly at kickoff and keeps reduced-motion views still", () => {
    const rig = new HostCameraRig();
    rig.resize(1.6);
    for (let i = 0; i < 1200; i++) rig.update(1 / 60, { x: 0, y: 0.033, z: 0 }, "lobby");
    const before = rig.camera.position.clone();
    rig.update(1 / 60, { x: 0, y: 0.033, z: 0 }, "countdown");
    expect(rig.camera.position.distanceTo(before)).toBeLessThan(0.5);
    for (let i = 0; i < 180; i++) rig.update(1 / 60, { x: 0, y: 0.033, z: 0 }, "countdown");
    const settled = cameraPose(1.6, { x: 0, z: 0 });
    expect(rig.camera.position.toArray()).toEqual([settled.x, settled.y, settled.z]);
    const reduced = new HostCameraRig(true);
    reduced.resize(1.6);
    reduced.update(0, { x: 0, y: 0.033, z: 0 }, "lobby");
    const fixed = reduced.camera.matrixWorld.toArray();
    for (let i = 0; i < 600; i++) reduced.update(1 / 60, { x: 1.4, y: 0.033, z: 0.7 }, "lobby");
    expect(reduced.camera.matrixWorld.toArray()).toEqual(fixed);
    reduced.update(1, { x: 1.4, y: 0.033, z: 0.7 }, "replay");
    expect(reduced.camera.matrixWorld.toArray()).toEqual(fixed);
  });
});

describe("replay close-up camera", () => {
  it("reserves the extra zoom for the final two playback seconds of each goal clip", () => {
    expect(replayCameraProgress()).toBe(0);
    expect(replayCameraProgress(NaN)).toBe(0);
    expect(replayCameraProgress(8)).toBe(0);
    expect(replayCameraProgress(2)).toBe(0);
    expect(replayCameraProgress(1.25)).toBeCloseTo(0.5);
    expect(replayCameraProgress(0.5)).toBe(1);
    expect(replayCameraProgress(0)).toBe(1);
    for (const aspect of aspects)
      for (const direction of [-1, 1]) {
        const rig = new HostCameraRig();
        rig.resize(aspect);
        const ball = { x: direction * 1.3, y: C.ball.radius, z: 0.15 };
        for (let frame = 0; frame < 240; frame++) rig.update(1 / 60, ball);
        const playingHeight = rig.camera.position.y;
        for (let frame = 0; frame <= 480; frame++) {
          const remaining = 8 - frame / 60;
          rig.update(1 / 60, ball, "replay", {
            progress: frame / 480, slowMotion: remaining < 2,
            remaining, summary: true, goalIndex: 2, goalCount: 4,
          });
          if (remaining >= 2) expect(rig.camera.position.y).toBeCloseTo(playingHeight, 5);
          visible(new THREE.Vector3(ball.x, ball.y, ball.z), rig.camera, 0.9);
          for (const goalZ of [-C.table.goalHalfWidth, C.table.goalHalfWidth])
            for (const goalY of [0, C.table.goalHeight])
              visible(new THREE.Vector3(direction * C.table.goalBackX, goalY, goalZ), rig.camera, 0.9);
        }
        expect(rig.camera.position.y).toBeLessThan(playingHeight * 0.85);
      }
  });

  it("keeps a sudden pass visible even when it starts from the tightest close-up", () => {
    for (const aspect of aspects)
      for (const rate of [30, 120]) {
        const rig = new HostCameraRig();
        rig.resize(aspect);
        const replay = { progress: 0.95, slowMotion: true, remaining: 0.4 };
        for (let frame = 0; frame < rate * 2; frame++)
          rig.update(1 / rate, { x: -1.4, y: 0.033, z: -0.75 }, "replay", replay);
        for (let frame = 0; frame <= rate / 3; frame++) {
          const ball = {
            x: Math.min(1.4, -1.4 + frame / rate * 12),
            y: C.ball.radius,
            z: Math.min(0.75, -0.75 + frame / rate * 6),
          };
          rig.update(1 / rate, ball, "replay", replay);
          visible(new THREE.Vector3(ball.x, ball.y, ball.z), rig.camera, 0.93);
        }
      }
  });

  it("leaves reduced-motion framing fixed throughout the close-up and handles invalid samples", () => {
    const rig = new HostCameraRig(true);
    rig.resize(1.6);
    const start = rig.camera.matrixWorld.toArray();
    for (let frame = 0; frame < 480; frame++)
      rig.update(1 / 60, { x: 1.4, y: 0.4, z: 0.7 }, "replay", {
        progress: frame / 480, slowMotion: true, remaining: 8 - frame / 60,
      });
    expect(rig.camera.matrixWorld.toArray()).toEqual(start);
    const animated = new HostCameraRig();
    animated.update(1 / 60, { x: NaN, y: NaN, z: Infinity }, "replay", {
      progress: 1, slowMotion: true, remaining: 0,
    });
    expect(animated.camera.matrixWorld.toArray().every(Number.isFinite)).toBe(true);
  });
});
