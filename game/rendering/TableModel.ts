import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../GameConfig";
import { ScoreCounter } from "./ScoreCounter";
import { createPlayingSurfaceGeometry } from "./PlayingSurfaceGeometry";
import { footRenderMesh } from "../physics/FootProfile";
import type { FootballClub, TableFrame, Team } from "../../shared/types";
import { getTeamIdentity } from "../../shared/teamIdentity";

function canvasTexture(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  paint(ctx);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
export class TableModel {
  readonly group = new THREE.Group();
  readonly rods: THREE.Group[] = [];
  readonly ball: THREE.Mesh;
  readonly counters: Record<Team, ScoreCounter>;
  private geometry = new Map<string, THREE.BufferGeometry>();
  private shirts: Record<Team, THREE.MeshStandardMaterial>;
  private shorts: Record<Team, THREE.MeshStandardMaterial>;
  private clubSigns: Record<Team, THREE.Mesh>;
  private disposed = false;
  private assetAbort = new AbortController();
  private shell = new THREE.Group();
  private controllerMaterials: Record<Team, Set<THREE.Material>> | null = null;
  private retiredMaterials = new Set<THREE.Material>();
  private cameraRails: { axis: "x" | "z"; side: number; mesh: THREE.Mesh; solid: THREE.Material; glass: THREE.Material; near?: boolean; opacity: number; fromOpacity: number; fadeTime: number }[] = [];
  private rodShadows = new WeakMap<
    THREE.Mesh,
    { castShadow: boolean; receiveShadow: boolean }
  >();

  constructor() {
    const woodMap = canvasTexture(512, 256, (ctx) => {
      ctx.fillStyle = "#654730";
      ctx.fillRect(0, 0, 512, 256);
      for (let i = 0; i < 180; i++) {
        const y = i * 1.6;
        ctx.strokeStyle = `rgba(${i % 3 ? "38,20,11" : "177,132,78"},${0.07 + (i % 8) * 0.008})`;
        ctx.lineWidth = i % 4 === 0 ? 2 : 1;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.bezierCurveTo(
          170,
          y + Math.sin(i) * 3,
          340,
          y + Math.cos(i) * 2,
          512,
          y + Math.sin(i * 0.8) * 4,
        );
        ctx.stroke();
      }
    });
    const wood = new THREE.MeshStandardMaterial({
      map: woodMap,
      color: "#c1a282",
      roughness: 0.6,
    });
    const edge = new THREE.MeshStandardMaterial({
      color: "#252724",
      roughness: 0.33,
      metalness: 0.25,
    });
    const trim = new THREE.MeshStandardMaterial({
      color: "#b5beb5",
      roughness: 0.26,
      metalness: 0.85,
    });
    const rubber = new THREE.MeshStandardMaterial({
      color: "#20231f",
      roughness: 0.85,
    });
    const field = new THREE.MeshStandardMaterial({
      map: canvasTexture(1024, 512, (ctx) => {
        ctx.fillStyle = "#2b6650";
        ctx.fillRect(0, 0, 1024, 512);
        for (let stripe = 0; stripe < 10; stripe++) {
          ctx.fillStyle = stripe % 2 ? "#316e56" : "#2c674f";
          ctx.fillRect(stripe * 102.4, 0, 103, 512);
        }
        ctx.strokeStyle = "rgba(239,239,207,.78)";
        ctx.lineWidth = 4;
        ctx.strokeRect(28, 24, 968, 464);
        ctx.beginPath();
        ctx.moveTo(512, 24);
        ctx.lineTo(512, 488);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(512, 256, 74, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(512, 256, 4, 0, Math.PI * 2);
        ctx.fillStyle = "#f2efdc";
        ctx.fill();
        ctx.strokeRect(28, 124, 128, 264);
        ctx.strokeRect(868, 124, 128, 264);
        ctx.strokeRect(28, 190, 58, 132);
        ctx.strokeRect(938, 190, 58, 132);
        ctx.fillStyle = "rgba(240,241,214,.22)";
        ctx.font = "700 32px Arial";
        ctx.textAlign = "right";
        ctx.fillText("NEM", 474, 410);
        ctx.textAlign = "left";
        ctx.fillText("BOLD", 550, 410);
      }),
      roughness: 0.95,
      flatShading: true,
    });
    this.group.add(this.shell);
    this.box(this.shell, 0, -0.135, 0, 3.42, 0.25, 1.86, wood);
    const surface = new THREE.Mesh(createPlayingSurfaceGeometry(), field);
    surface.name = "playing-surface";
    surface.receiveShadow = true;
    this.shell.add(surface);
    this.box(this.shell, 0, -0.26, 0, 3.43, 0.055, 1.88, edge);
    const wallHeight = C.table.wallHeight;
    for (const side of [-1, 1]) {
      const railWood = wood, railEdge = edge, railTrim = trim;
      const rail = (mesh: THREE.Mesh) => this.cameraRail(mesh, "z", side);
      const end = (mesh: THREE.Mesh) => this.cameraRail(mesh, "x", side);
      // The gap beneath the middle rail is a real serving opening.
      for (const sign of [-1, 1])
        rail(
          this.box(
            this.shell,
            sign * 0.755,
            wallHeight / 2,
            side * 0.82,
            1.3,
            wallHeight,
            0.14,
            railWood,
          ),
        ).name = `side-board-${side}-${sign}`;
      rail(
        this.box(
          this.shell, 0, (wallHeight + C.table.servingHoleHeight) / 2,
          side * 0.82, C.table.servingHoleHalfWidth * 2,
          wallHeight - C.table.servingHoleHeight, 0.14, railWood,
        ),
      ).name = `serving-lintel-${side}`;
      rail(
        this.box(this.shell, 0, wallHeight + 0.01, side * 0.82, 3.4, 0.035, 0.17, railEdge),
      );
      rail(
        this.box(
          this.shell,
          0,
          wallHeight + 0.032,
          side * 0.825,
          3.35,
          0.012,
          0.035,
          railTrim,
        ),
      );
      const hole = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.013, 8, 24),
        railTrim,
      );
      hole.position.set(0, 0.075, side * 0.902);
      this.shell.add(hole);
      rail(hole);
      for (const wing of [-1, 1])
        end(this.box(
          this.shell,
          side * 1.52,
          wallHeight / 2,
          wing * 0.52,
          0.2,
          wallHeight,
          0.58,
          wood,
        )).name = `end-board-${side}-${wing}`;
      end(this.box(
        this.shell, side * 1.52, (wallHeight + C.table.goalHeight) / 2,
        0, 0.2, wallHeight - C.table.goalHeight, C.table.goalHalfWidth * 2, wood,
      )).name = `goal-lintel-${side}`;
      end(this.box(this.shell, side * 1.52, wallHeight + 0.025, 0, 0.2, 0.065, 1.63, edge));
      end(this.box(this.shell, side * 1.7, 0.08, 0, 0.035, 0.17, 0.49, edge));
      this.box(this.shell, side * 1.59, -0.02, 0, 0.3, 0.04, 0.49, rubber);
      // A fine goal net gives the recess depth without expensive transparency.
      const net = new THREE.LineBasicMaterial({
        color: "#828b7a",
        transparent: true,
        opacity: 0.35,
      });
      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= 8; i++) {
        const z = -0.22 + i * 0.055;
        points.push(
          new THREE.Vector3(side * 1.677, 0.015, z),
          new THREE.Vector3(side * 1.677, 0.205, z),
        );
      }
      for (let i = 0; i <= 4; i++) {
        const y = 0.015 + i * 0.0475;
        points.push(
          new THREE.Vector3(side * 1.677, y, -0.22),
          new THREE.Vector3(side * 1.677, y, 0.22),
        );
      }
      this.shell.add(
        new THREE.LineSegments(
          new THREE.BufferGeometry().setFromPoints(points),
          net,
        ),
      );
      for (const z of [-0.65, 0.65]) {
        this.box(this.shell, side * 1.17, -0.59, z, 0.16, 0.75, 0.16, edge);
        this.box(this.shell, side * 1.17, -0.95, z, 0.22, 0.06, 0.22, trim);
      }
    }
    this.shirts = {
      red: new THREE.MeshStandardMaterial({ color: "#d9473f", roughness: 0.4 }),
      blue: new THREE.MeshStandardMaterial({
        color: "#4383bb",
        roughness: 0.4,
      }),
    };
    this.shorts = {
      red: new THREE.MeshStandardMaterial({ color: "#f1e9d7", roughness: 0.5 }),
      blue: new THREE.MeshStandardMaterial({
        color: "#e6ddc6",
        roughness: 0.5,
      }),
    };
    const skin = new THREE.MeshStandardMaterial({
      color: "#dfc29a",
      roughness: 0.55,
    });
    const boots = new THREE.MeshStandardMaterial({
      color: "#252721",
      roughness: 0.4,
    });
    const redMarker = new THREE.MeshStandardMaterial({
      color: "#f25243",
      roughness: 0.3,
      emissive: "#9b2017",
      emissiveIntensity: 0.08,
    });
    const blueMarker = new THREE.MeshStandardMaterial({
      color: "#5aaff0",
      roughness: 0.3,
      emissive: "#1b577a",
      emissiveIntensity: 0.08,
    });
    for (const layout of ROD_LAYOUT) {
      const rod = new THREE.Group();
      rod.position.set(layout.x, C.table.rodHeight, 0);
      this.cylinder(rod, 0, 0, 0, 0.012, 2.32, trim);
      const handleZ = layout.team === "red" ? 1.18 : -1.18;
      const handle = this.cylinder(rod, 0, 0, handleZ, 0.042, 0.3, rubber);
      handle.castShadow = true;
      for (let i = 0; i < 6; i++)
        this.cylinder(
          rod,
          0,
          0,
          handleZ + (i - 2.5) * 0.04,
          0.046,
          0.008,
          edge,
        );
      for (let i = 0; i < layout.count; i++) {
        const z = (i - (layout.count - 1) / 2) * layout.spacing;
        const figure = new THREE.Group();
        figure.position.z = z;
        this.box(
          figure,
          0,
          0.012,
          0,
          0.086,
          0.15,
          0.084,
          this.shirts[layout.team],
          0.013,
        );
        this.box(
          figure,
          0,
          -0.092,
          0,
          0.077,
          0.061,
          0.082,
          this.shorts[layout.team],
          0.008,
        );
        this.box(
          figure,
          0,
          -0.152,
          0,
          0.066,
          0.066,
          0.068,
          this.shirts[layout.team],
          0.006,
        );
        const foot = new THREE.Mesh(this.bootGeometry(), boots);
        foot.name = "figure-foot";
        foot.position.y = C.figure.footY;
        foot.castShadow = true;
        foot.receiveShadow = true;
        figure.add(foot);
        const head = new THREE.Mesh(this.sphereGeometry(0.043), skin);
        head.position.y = 0.125;
        head.castShadow = true;
        figure.add(head);
        this.cylinder(
          figure,
          0,
          0,
          0,
          0.022,
          0.1,
          layout.team === "red" ? redMarker : blueMarker,
        );
        rod.add(figure);
      }
      this.rods.push(rod);
      this.group.add(rod);
      for (const z of [-0.84, 0.84])
        this.cylinder(
          this.shell,
          layout.x,
          C.table.rodHeight,
          z,
          0.032,
          0.13,
          rubber,
        );
    }
    const ballMap = canvasTexture(256, 128, (ctx) => {
      ctx.fillStyle = "#fff8e6";
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = "#394134";
      for (let y = 0; y < 3; y++)
        for (let x = 0; x < 5; x++) {
          const cx = x * 64 + (y % 2) * 32,
            cy = y * 60;
          ctx.beginPath();
          for (let p = 0; p < 5; p++) {
            const a = (p * Math.PI * 2) / 5;
            const px = cx + Math.cos(a) * 12,
              py = cy + Math.sin(a) * 12;
            p ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
        }
    });
    this.ball = new THREE.Mesh(
      this.sphereGeometry(C.ball.radius),
      new THREE.MeshStandardMaterial({ map: ballMap, roughness: 0.5 }),
    );
    this.ball.castShadow = true;
    this.ball.position.set(0.07, C.ball.radius + 0.004, -0.04);
    this.group.add(this.ball);
    this.counters = {
      red: new ScoreCounter(-1.61, "#e95948"),
      blue: new ScoreCounter(1.61, "#569cce"),
    };
    for (const counter of Object.values(this.counters))
      counter.group.position.y = wallHeight + 0.08;
    this.group.add(this.counters.red.group, this.counters.blue.group);
    const labelMaterial = () =>
      new THREE.MeshBasicMaterial({
        map: canvasTexture(512, 128, (ctx) => {
          ctx.fillStyle = "#eae3cd";
          ctx.font = "bold 48px Arial";
          ctx.textAlign = "center";
          ctx.fillText("NEM BOLD", 256, 82);
        }),
        transparent: true,
      });
    const title = new THREE.Mesh(
      new THREE.PlaneGeometry(0.68, 0.17),
      labelMaterial(),
    );
    title.position.set(0, -0.12, 0.934);
    this.shell.add(title);
    this.clubSigns = { red: this.makeSign(-1.1), blue: this.makeSign(1.1) };
  }
  private sphereGeometry(radius: number) {
    const key = `sphere${radius}`;
    if (!this.geometry.has(key))
      this.geometry.set(key, new THREE.SphereGeometry(radius, 16, 12));
    return this.geometry.get(key)!;
  }
  /** Rounded superellipse mesh generated from the same dimensions as the collider. */
  private bootGeometry() {
    const key = "boot";
    if (!this.geometry.has(key)) {
      const mesh = footRenderMesh();
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
      geometry.setIndex(mesh.indices);
      geometry.computeVertexNormals();
      this.geometry.set(key, geometry);
    }
    return this.geometry.get(key)!;
  }
  private box(
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    material: THREE.Material,
    radius = 0,
  ) {
    const key = `box${width},${height},${depth},${radius}`;
    if (!this.geometry.has(key))
      this.geometry.set(
        key,
        radius
          ? new RoundedBoxGeometry(width, height, depth, 2, radius)
          : new THREE.BoxGeometry(width, height, depth),
      );
    const mesh = new THREE.Mesh(this.geometry.get(key), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private cylinder(
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    radius: number,
    length: number,
    material: THREE.Material,
  ) {
    const key = `cyl${radius},${length}`;
    if (!this.geometry.has(key))
      this.geometry.set(
        key,
        new THREE.CylinderGeometry(radius, radius, length, 12),
      );
    const mesh = new THREE.Mesh(this.geometry.get(key), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
  private makeSign(x: number) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.54, 0.13),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, C.table.wallHeight + 0.039, 0.82);
    this.shell.add(mesh);
    return mesh;
  }
  getKits() {
    const kit = (team: Team) => ({
      primaryColor: `#${this.shirts[team].color.getHexString()}`,
      secondaryColor: `#${this.shorts[team].color.getHexString()}`,
    });
    return { red: kit("red"), blue: kit("blue") };
  }
  /** Apply the host's fixed team kits to the received poses. */
  setKits(kits: TableFrame["kits"]) {
    for (const team of ["red", "blue"] as const) {
      this.shirts[team].color.set(kits[team].primaryColor);
      this.shorts[team].color.set(kits[team].secondaryColor);
    }
  }
  /** The same geometry is used on phones; opponent rods are only a visual guide. */
  setControllerAppearance(ownTeam: Team, ghostOpponent = true) {
    if (!this.controllerMaterials) {
      this.controllerMaterials = { red: new Set(), blue: new Set() };
      const copies: Record<Team, Map<THREE.Material, THREE.Material>> = {
        red: new Map(),
        blue: new Map(),
      };
      for (const [index, rod] of this.rods.entries()) {
        const team = ROD_LAYOUT[index]!.team;
        const clone = (material: THREE.Material) => {
          let copy = copies[team].get(material);
          if (!copy) {
            copy = material.clone();
            copies[team].set(material, copy);
            this.controllerMaterials![team].add(copy);
            this.retiredMaterials.add(material);
          }
          return copy;
        };
        rod.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          this.rodShadows.set(object, {
            castShadow: object.castShadow,
            receiveShadow: object.receiveShadow,
          });
          object.material = Array.isArray(object.material)
            ? object.material.map(clone)
            : clone(object.material);
        });
      }
      for (const team of ["red", "blue"] as const) {
        this.shirts[team] = copies[team].get(
          this.shirts[team],
        ) as THREE.MeshStandardMaterial;
        this.shorts[team] = copies[team].get(
          this.shorts[team],
        ) as THREE.MeshStandardMaterial;
      }
    }
    for (const team of ["red", "blue"] as const) {
      const opponent = ghostOpponent && team !== ownTeam;
      for (const material of this.controllerMaterials[team]) {
        material.transparent = opponent;
        material.opacity = opponent ? 0.3 : 1;
        material.depthWrite = !opponent;
        material.needsUpdate = true;
      }
    }
    for (const [index, rod] of this.rods.entries()) {
      const opponent = ghostOpponent && ROD_LAYOUT[index]!.team !== ownTeam;
      rod.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const original = this.rodShadows.get(object)!;
        object.castShadow = opponent ? false : original.castShadow;
        object.receiveShadow = opponent ? false : original.receiveShadow;
      });
    }
  }
  setClubs(clubs: Record<Team, FootballClub>, locale?: string) {
    for (const team of ["red", "blue"] as const) {
      const club = getTeamIdentity(team, clubs[team].name);
      this.shirts[team].color.set(club.primaryColor);
      this.shorts[team].color.set(club.secondaryColor);
      const signMaterial = this.clubSigns[team]
        .material as THREE.MeshBasicMaterial;
      signMaterial.map?.dispose();
      signMaterial.map = canvasTexture(512, 128, (ctx) => {
        ctx.fillStyle = "#eae5d4";
        ctx.font = "bold 34px Arial";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          club.name.toLocaleUpperCase(locale),
          256,
          64,
          500,
        );
      });
      signMaterial.opacity = 1;
      signMaterial.needsUpdate = true;
    }
  }
  /** A supplied model is inspected and normalized; procedural moving parts remain authoritative. */
  async loadOptionalShell() {
    try {
      const response = await fetch("/models/foosball-table.glb", {
        signal: this.assetAbort.signal,
      });
      if (
        !response.ok ||
        (!(response.headers.get("content-type") || "").includes("model") &&
          !(response.headers.get("content-type") || "").includes(
            "octet-stream",
          ))
      )
        return;
      const gltf = await new GLTFLoader().parseAsync(
        await response.arrayBuffer(),
        "/models/",
      );
      if (this.disposed) {
        this.disposeObject(gltf.scene);
        return;
      }
      // Only separately named static pieces are safe to use; duplicate rods would break visuals.
      const staticMeshes: THREE.Mesh[] = [];
      gltf.scene.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          /frame|cabinet|leg|table.?body/i.test(object.name) &&
          !/player|rod|handle|counter|pitch|field/i.test(object.name)
        )
          staticMeshes.push(object);
      });
      if (!staticMeshes.length) {
        this.disposeObject(gltf.scene);
        return;
      }
      const imported = new THREE.Group();
      for (const mesh of staticMeshes) {
        mesh.updateWorldMatrix(true, false);
        const clone = mesh.clone(false);
        clone.geometry = mesh.geometry.clone();
        const copyMaterial = (material: THREE.Material) => {
          const copy = material.clone();
          for (const [key, value] of Object.entries(material)) {
            if (value instanceof THREE.Texture)
              (copy as unknown as Record<string, unknown>)[key] = value.clone();
          }
          return copy;
        };
        clone.material = Array.isArray(mesh.material)
          ? mesh.material.map(copyMaterial)
          : copyMaterial(mesh.material);
        clone.matrix.copy(mesh.matrixWorld);
        clone.matrix.decompose(clone.position, clone.quaternion, clone.scale);
        clone.castShadow = true;
        clone.receiveShadow = true;
        imported.add(clone);
      }
      // Clones own their render resources, so discarded players and textures can be freed safely.
      this.disposeObject(gltf.scene);
      const bounds = new THREE.Box3().setFromObject(imported),
        size = bounds.getSize(new THREE.Vector3()),
        center = bounds.getCenter(new THREE.Vector3());
      const scale = 3.42 / Math.max(size.x, size.z);
      imported.scale.setScalar(scale);
      imported.position.set(
        -center.x * scale,
        -0.22 - bounds.max.y * scale,
        -center.z * scale,
      );
      // The licensed cabinet is placed beneath the reconstructed playable surface.
      this.group.add(imported);
    } catch {
      /* The specified model requires a Sketchfab login; the geometric table is fully playable. */
    }
  }
  private cameraRail(mesh: THREE.Mesh, axis: "x" | "z", side: number) {
    const solid = mesh.material as THREE.Material;
    const glass = solid.clone();
    glass.transparent = true;
    glass.opacity = 0.22;
    glass.depthWrite = false;
    this.retiredMaterials.add(solid);
    this.retiredMaterials.add(glass);
    this.cameraRails.push({ axis, side, mesh, solid, glass, opacity: 1, fromOpacity: 1, fadeTime: 1 });
    return mesh;
  }

  /** Fade the nearest borders over one second, continuing from the current opacity on reversal. */
  updateCameraTransparency(camera: { x: number; z: number }, dt = 0) {
    const elapsed = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    for (const rail of this.cameraRails) {
      const near = (camera[rail.axis] >= 0 ? 1 : -1) === rail.side;
      const target = near ? 0.22 : 1;
      if (rail.near === undefined) {
        // Set the initial view immediately; only subsequent side changes fade.
        rail.opacity = target;
        rail.fromOpacity = target;
      } else if (near !== rail.near) {
        rail.fromOpacity = rail.opacity;
        rail.fadeTime = 0;
      }
      rail.near = near;
      rail.fadeTime = Math.min(1, rail.fadeTime + elapsed);
      if (rail.fadeTime >= 1 - 1e-9) rail.fadeTime = 1;
      const blend = rail.fadeTime * rail.fadeTime * (3 - 2 * rail.fadeTime);
      rail.opacity = rail.fromOpacity + (target - rail.fromOpacity) * blend;
      const solid = !near && rail.fadeTime === 1;
      rail.glass.opacity = rail.opacity;
      rail.mesh.material = solid ? rail.solid : rail.glass;
      rail.mesh.castShadow = solid;
      rail.mesh.receiveShadow = solid;
    }
  }

  private disposeObject(
    root: THREE.Object3D,
    extraMaterials: Iterable<THREE.Material> = [],
  ) {
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>(extraMaterials),
      textures = new Set<THREE.Texture>();
    root.traverse((object) => {
      if (!(
        object instanceof THREE.Mesh || object instanceof THREE.LineSegments
      ))
        return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) {
        materials.add(material);
      }
    });
    for (const material of materials)
      for (const value of Object.values(material))
        if (value instanceof THREE.Texture) textures.add(value);
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }
  dispose() {
    this.disposed = true;
    this.assetAbort.abort();
    this.disposeObject(this.group, this.retiredMaterials);
    this.retiredMaterials.clear();
  }
}
