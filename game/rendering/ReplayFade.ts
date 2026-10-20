import * as THREE from "three";
import type { ReplayState } from "../../shared/types";

/** Fade only the rendered table, without covering the surrounding score and controls. */
export class ReplayFade {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2);
  private material = new THREE.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  private quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);

  constructor() {
    this.camera.position.z = 1;
    this.scene.add(this.quad);
  }

  render(renderer: THREE.WebGLRenderer, replay?: ReplayState) {
    const fade = replay?.fade;
    this.material.opacity = fade !== undefined && Number.isFinite(fade)
      ? Math.max(0, Math.min(1, fade)) : 0;
    if (this.material.opacity === 0) return;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    try {
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.autoClear = autoClear;
    }
  }

  dispose() {
    this.quad.geometry.dispose();
    this.material.dispose();
  }
}
