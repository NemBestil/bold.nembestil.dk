import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ReplayFade } from "../game/rendering/ReplayFade";
import { SceneManager } from "../game/rendering/SceneManager";
import { HostCameraRig } from "../game/rendering/HostCamera";

describe("table replay fade", () => {
  it("uses the same replay metadata for the host camera and its overlay", () => {
    const cameraRig = new HostCameraRig();
    const updateCamera = vi.spyOn(cameraRig, "update");
    const overlay = { render: vi.fn() };
    const ball = { position: new THREE.Vector3(1.3, 0.033, 0.1) };
    const view = Object.assign(Object.create(SceneManager.prototype), {
      cameraRig, camera: cameraRig.camera, fade: overlay,
      shakeTime: 0, scene: new THREE.Scene(), renderer: { render: vi.fn() },
      table: { ball, updateCameraTransparency: vi.fn(), counters: { red: { update: vi.fn() }, blue: { update: vi.fn() } } },
    }) as SceneManager;
    const replay = { progress: 1, remaining: 0, fade: 0.6, slowMotion: true };
    view.render(1 / 60, "replay", replay);
    expect(updateCamera).toHaveBeenLastCalledWith(1 / 60, ball.position, "replay", replay);
    expect(view.renderer.render).toHaveBeenLastCalledWith(view.scene, view.camera);
    expect(overlay.render).toHaveBeenLastCalledWith(view.renderer, replay);
    view.render(1 / 60, "paused", replay);
    expect(overlay.render).toHaveBeenLastCalledWith(view.renderer, replay);
  });

  it("blends black over the existing canvas without clearing the table render", () => {
    const fade = new ReplayFade();
    const opacity: number[] = [];
    const renderer = {
      autoClear: true,
      render: vi.fn((scene: THREE.Scene, camera: THREE.Camera) => {
        expect(renderer.autoClear).toBe(false);
        expect(camera).toBeInstanceOf(THREE.OrthographicCamera);
        const quad = scene.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
        expect(quad.material.color.getHex()).toBe(0);
        expect(quad.material.depthTest).toBe(false);
        expect(quad.material.depthWrite).toBe(false);
        expect(quad.material.toneMapped).toBe(false);
        opacity.push(quad.material.opacity);
      }),
    };
    const state = { progress: 1, slowMotion: true, remaining: 0 };
    fade.render(renderer as unknown as THREE.WebGLRenderer);
    fade.render(renderer as unknown as THREE.WebGLRenderer, { ...state, fade: 0 });
    expect(renderer.render).not.toHaveBeenCalled();
    for (const value of [0.1, 0.55, 1, 4]) {
      fade.render(renderer as unknown as THREE.WebGLRenderer, { ...state, fade: value });
      expect(renderer.autoClear).toBe(true);
    }
    expect(opacity).toEqual([0.1, 0.55, 1, 1]);
    fade.render(renderer as unknown as THREE.WebGLRenderer, { ...state, fade: NaN });
    fade.render(renderer as unknown as THREE.WebGLRenderer, { ...state, fade: -1 });
    expect(renderer.render).toHaveBeenCalledTimes(4);
    fade.dispose();
  });

  it("restores renderer state after an interrupted overlay and releases its resources", () => {
    const fade = new ReplayFade();
    let scene: THREE.Scene | undefined;
    const renderer = { autoClear: false, render: vi.fn((overlay: THREE.Scene) => {
      scene = overlay;
      throw new Error("context lost");
    }) };
    expect(() => fade.render(renderer as unknown as THREE.WebGLRenderer,
      { progress: 0, slowMotion: false, fade: 0.5 })).toThrow("context lost");
    expect(renderer.autoClear).toBe(false);
    const quad = scene!.children[0] as THREE.Mesh;
    const geometry = vi.spyOn(quad.geometry, "dispose");
    const material = vi.spyOn(quad.material as THREE.Material, "dispose");
    fade.dispose();
    expect(geometry).toHaveBeenCalledOnce();
    expect(material).toHaveBeenCalledOnce();
  });
});
