import * as THREE from "three";

/** Real moving beads, mounted at each end rather than drawn over the game. */
export class ScoreCounter {
  readonly group = new THREE.Group();
  private beads: THREE.Mesh[] = [];
  private targets: number[] = [];
  private material: THREE.MeshStandardMaterial;
  constructor(
    x: number,
    color: string,
    private goals = 5,
  ) {
    this.group.position.set(x, 0.32, 0);
    this.material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.28,
      metalness: 0.2,
    });
    const metal = new THREE.MeshStandardMaterial({
      color: "#bec8bf",
      metalness: 0.85,
      roughness: 0.24,
    });
    const bar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.009, 0.009, 1.3, 10),
      metal,
    );
    bar.rotation.x = Math.PI / 2;
    this.group.add(bar);
    for (const z of [-0.67, 0.67]) {
      const support = new THREE.Mesh(
        new THREE.BoxGeometry(0.1, 0.07, 0.055),
        metal,
      );
      support.position.set(0, -0.025, z);
      this.group.add(support);
    }
    const geometry = new THREE.CylinderGeometry(0.04, 0.04, 0.054, 16);
    for (let i = 0; i < 10; i++) {
      const bead = new THREE.Mesh(geometry, this.material);
      bead.rotation.x = Math.PI / 2;
      bead.castShadow = true;
      this.beads.push(bead);
      this.group.add(bead);
    }
    this.setScore(0, goals, true);
  }
  setColor(color: string) {
    this.material.color.set(color);
  }
  setScore(score: number, goals = this.goals, immediate = false) {
    this.goals = goals;
    for (let i = 0; i < this.beads.length; i++) {
      this.beads[i]!.visible = i < goals;
      this.targets[i] =
        i < score ? 0.59 - i * 0.068 : -0.59 + (i - score) * 0.068;
      if (immediate) this.beads[i]!.position.z = this.targets[i]!;
    }
  }
  update(dt: number) {
    for (let i = 0; i < this.beads.length; i++)
      this.beads[i]!.position.z +=
        (this.targets[i]! - this.beads[i]!.position.z) * Math.min(1, dt * 8);
  }
}
