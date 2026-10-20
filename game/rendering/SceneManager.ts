import * as THREE from "three";
import { GAME_CONFIG as C } from "../GameConfig";
import { TableModel } from "./TableModel";
import { addTableLighting } from "./TableLighting";
import type { MatchSettings } from "../../shared/types";

import { HostCameraRig } from "./HostCamera";
import { ReplayFade } from "./ReplayFade";
import type { GameView } from "./GameView";
import { bindCanvasLabel } from "./CanvasAccessibility";
import type { MatchPhase, ReplayState, TableFrame } from "../../shared/types";
export { CAMERA_CONFIG, cameraFocus, cameraDistance, cameraZoom, cameraPose, cameraSafeZoom, cameraBlend } from "./HostCamera";

export class SceneManager implements GameView {
  readonly scene = new THREE.Scene();
  private cameraRig = new HostCameraRig(
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  readonly camera = this.cameraRig.camera;
  readonly renderer: THREE.WebGLRenderer;
  readonly table: TableModel;
  private observer: ResizeObserver;
  private light: THREE.DirectionalLight;
  private shakeTime = 0;
  private disposed = false;
  private fade = new ReplayFade();
  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    this.table = new TableModel();
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, C.rendering.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    this.renderer.setClearColor(0x101710, 0);
    this.renderer.domElement.style.cssText =
      "width:100%;height:100%;display:block;outline:none";
    bindCanvasLabel(this.renderer.domElement, container);
    this.renderer.domElement.setAttribute("role", "img");
    container.appendChild(this.renderer.domElement);
    this.scene.add(this.table.group);
    this.light = addTableLighting(this.scene, C.rendering.shadowSize);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    this.resize();
    void this.table.loadOptionalShell();
  }
  private resize = () => {
    if (this.disposed) return;
    const width = Math.max(1, this.container.clientWidth),
      height = Math.max(1, this.container.clientHeight);
    this.cameraRig.resize(width / height);
    this.renderer.setSize(width, height, false);
  };
  settings(settings: MatchSettings) {
    const ratio =
      settings.graphics === "low"
        ? 1
        : settings.graphics === "high"
          ? 2
          : C.rendering.maxPixelRatio;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    this.renderer.shadowMap.enabled = settings.graphics !== "low";
    this.light.castShadow = settings.graphics !== "low";
    this.resize();
  }
  shake(duration = 0.25) {
    this.shakeTime = duration;
  }
  captureCamera(): NonNullable<TableFrame["camera"]> {
    return { position: { x: this.camera.position.x, y: this.camera.position.y, z: this.camera.position.z },
      rotation: { x: this.camera.quaternion.x, y: this.camera.quaternion.y, z: this.camera.quaternion.z, w: this.camera.quaternion.w },
      aspect: this.camera.aspect, fov: this.camera.fov };
  }
  render(dt: number, phase: MatchPhase = "playing", replay?: ReplayState, camera?: TableFrame["camera"]) {
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    this.cameraRig.update(dt, this.table.ball.position, phase, replay);
    if (camera) {
      this.camera.position.copy(camera.position);
      this.camera.quaternion.copy(camera.rotation);
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.max(1, camera.aspect / this.camera.aspect)));
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
    }
    if (this.shakeTime > 0 && !this.cameraRig.reducedMotion) {
      const amplitude = this.shakeTime * 0.055;
      this.camera.position.x += Math.sin(this.shakeTime * 100) * amplitude;
      this.camera.position.y += Math.cos(this.shakeTime * 130) * amplitude;
    }
    this.table.counters.red.update(dt);
    this.table.counters.blue.update(dt);
    this.table.updateCameraTransparency(this.camera.position, dt);
    this.renderer.render(this.scene, this.camera);
    this.fade.render(this.renderer, replay);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.observer.disconnect();
    this.table.dispose();
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh && object.parent === this.scene) {
        object.geometry.dispose();
        for (const material of Array.isArray(object.material)
          ? object.material
          : [object.material])
          material.dispose();
      }
    });
    this.light.shadow.map?.dispose();
    this.fade.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
