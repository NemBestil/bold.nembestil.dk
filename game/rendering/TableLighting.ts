import * as THREE from "three";

/** Shared lighting keeps the host and top-down phone view on the same table. */
export function addTableLighting(scene: THREE.Scene, shadowSize: number) {
  scene.add(new THREE.HemisphereLight("#eee9d2", "#59604f", 2.3));
  const light = new THREE.DirectionalLight("#fff1d5", 3.3);
  light.position.set(-2.5, 5, 2.8);
  light.castShadow = true;
  light.shadow.mapSize.set(shadowSize, shadowSize);
  light.shadow.camera.left = -3;
  light.shadow.camera.right = 3;
  light.shadow.camera.top = 3;
  light.shadow.camera.bottom = -3;
  light.shadow.camera.near = 0.5;
  light.shadow.camera.far = 12;
  light.shadow.normalBias = 0.018;
  light.shadow.bias = -0.0003;
  scene.add(light);
  const rim = new THREE.DirectionalLight("#d5ead6", 1.6);
  rim.position.set(3, 2, -3);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.ShadowMaterial({ color: "#000000", opacity: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1;
  floor.receiveShadow = true;
  scene.add(floor);
  return light;
}
