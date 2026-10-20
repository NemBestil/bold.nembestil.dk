import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { TableModel } from "../game/rendering/TableModel";
import { GAME_CONFIG as C, ROD_LAYOUT } from "../game/GameConfig";
import { ControllerScene, configureControllerCamera } from "../game/rendering/ControllerScene";
import { HostCameraRig } from "../game/rendering/HostCamera";
import { MobileHostScene } from "../game/rendering/MobileHostScene";
import { ReplayFade } from "../game/rendering/ReplayFade";
import { tableViewport } from "../app/components/controller/tableProjection";
import { DEFAULT_SETTINGS, type TableFrame } from "../shared/types";
import { getTeamIdentities } from "../shared/teamIdentity";

const models: TableModel[] = [];
const text: { value: string; x: number; y: number; align: string }[] = [];
function model() {
  const table = new TableModel();
  models.push(table);
  return table;
}
function meshes(root: THREE.Object3D) {
  const found: THREE.Mesh[] = [];
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}
function materials(root: THREE.Object3D) {
  return meshes(root).flatMap((mesh) => Array.isArray(mesh.material) ? mesh.material : [mesh.material]);
}
function shirt(table: TableModel, index: number) {
  const figure = table.rods[index]!.children.find((child) => child instanceof THREE.Group)!;
  return (figure.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial;
}
function geometrySignature(table: TableModel) {
  table.group.updateMatrixWorld(true);
  return meshes(table.group).map((mesh) => ({
    type: mesh.geometry.type,
    vertices: mesh.geometry.getAttribute("position").count,
    index: mesh.geometry.getIndex()?.count,
    position: mesh.getWorldPosition(new THREE.Vector3()).toArray(),
    rotation: mesh.quaternion.toArray(),
  }));
}

beforeEach(() => {
  vi.stubGlobal("window", { devicePixelRatio: 2 });
  text.length = 0;
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 1,
      height: 1,
      getContext: () => new Proxy({} as Record<string, unknown>, {
        get: (state, key) => key in state ? state[key as string] : (...args: unknown[]) => {
          if (key === "fillText") text.push({ value: args[0] as string, x: args[1] as number,
            y: args[2] as number, align: state.textAlign as string });
        },
        set: (state, key, value) => { state[key as string] = value; return true; },
      }),
    }),
  });
});
afterEach(() => {
  models.splice(0).forEach((table) => table.dispose());
  vi.unstubAllGlobals();
});

describe("shared 3D controller table", () => {
  it("renders Turkish team signs with the correct uppercase letters without changing names", () => {
    const table = model();
    const teams = getTeamIdentities({ red: "Kırmızı", blue: "Mavi" });
    table.setClubs(teams, "tr");
    expect(text.some(entry => entry.value === "KIRMIZI")).toBe(true);
    expect(text.some(entry => entry.value === "MAVİ")).toBe(true);
    expect(teams.blue.name).toBe("Mavi");
    table.setClubs(teams, "en");
    expect(text.some(entry => entry.value === "MAVI")).toBe(true);
    expect(teams.blue.name).toBe("Mavi");
  });
  it("renders raised boards around the pitch while retaining the goal and serving openings", () => {
    const table = model();
    table.updateCameraTransparency({x:2,z:3});
    table.group.updateMatrixWorld(true);
    const boards = meshes(table.group).filter((mesh) =>
      /^(side-board|end-board|serving-lintel|goal-lintel)-/.test(mesh.name),
    );
    expect(boards).toHaveLength(12);
    const ray = new THREE.Raycaster();
    for (const side of [-1, 1]) {
      // The ball must meet the visible board above its former 24 cm height.
      for (const x of [0, 0.75]) {
        ray.set(new THREE.Vector3(x, 0.35, 0), new THREE.Vector3(0, 0, side));
        expect(ray.intersectObjects(boards).length).toBeGreaterThan(0);
      }
      for (const z of [0, 0.52]) {
        ray.set(new THREE.Vector3(0, 0.35, z), new THREE.Vector3(side, 0, 0));
        expect(ray.intersectObjects(boards).length).toBeGreaterThan(0);
      }
      ray.set(new THREE.Vector3(0, C.table.servingHoleHeight / 2, 0), new THREE.Vector3(0, 0, side));
      expect(ray.intersectObjects(boards)).toEqual([]);
      ray.set(new THREE.Vector3(0, C.table.goalHeight / 2, 0), new THREE.Vector3(side, 0, 0));
      expect(ray.intersectObjects(boards)).toEqual([]);
    }
    for (const board of boards) {
      const bounds = new THREE.Box3().setFromObject(board);
      expect(bounds.max.y).toBeCloseTo(C.table.wallHeight, 6);
      const material = board.material as THREE.MeshStandardMaterial;
      if (board.name.startsWith("side-board-1-") || board.name === "serving-lintel-1") {
        expect(material.transparent).toBe(true);
        expect(board.castShadow).toBe(false);
      }
    }
    for (const counter of Object.values(table.counters)) {
      const bounds = new THREE.Box3().setFromObject(counter.group);
      expect(bounds.min.y).toBeGreaterThan(C.table.wallHeight);
    }
  });

  it("makes exactly the nearest long side and end translucent in every camera quadrant",()=>{
    const table=model();
    for(const x of [-3,3]) for(const z of [-4,4]) {
      table.updateCameraTransparency({x,z}, 1);
      for(const object of meshes(table.group)){
        const long=/^side-board-(-?1)-/.exec(object.name)||/^serving-lintel-(-?1)$/.exec(object.name);
        const end=/^end-board-(-?1)-/.exec(object.name)||/^goal-lintel-(-?1)$/.exec(object.name);
        if(!long&&!end) continue;
        const side=Number((long||end)![1]); const near=side*(long?z:x)>0;
        expect((object.material as THREE.Material).transparent).toBe(near);
        expect(object.castShadow).toBe(!near);
      }
    }
  });

  it.each([30, 60, 120])("fades opposite borders over one second at %i fps", (fps) => {
    const table = model();
    const board = (side: number) => meshes(table.group).find(mesh => mesh.name === `side-board-${side}-1`)!;
    const opacity = (side: number) => (board(side).material as THREE.Material).opacity;
    table.updateCameraTransparency({ x: 3, z: 4 });
    expect(opacity(1)).toBe(0.22);
    expect(opacity(-1)).toBe(1);
    for (let frame = 0; frame < fps / 2; frame++)
      table.updateCameraTransparency({ x: 3, z: -4 }, 1 / fps);
    expect(opacity(1)).toBeCloseTo(0.61, 6);
    expect(opacity(-1)).toBeCloseTo(0.61, 6);
    for (let frame = 0; frame < fps / 2; frame++)
      table.updateCameraTransparency({ x: 3, z: -4 }, 1 / fps);
    expect(opacity(1)).toBe(1);
    expect((board(1).material as THREE.Material).transparent).toBe(false);
    expect(opacity(-1)).toBeCloseTo(0.22, 6);
    expect(board(-1).castShadow).toBe(false);
  });

  it("reverses an unfinished fade from its current opacity without a jump", () => {
    const table = model();
    const board = meshes(table.group).find(mesh => mesh.name === "side-board-1-1")!;
    const opacity = () => (board.material as THREE.Material).opacity;
    table.updateCameraTransparency({ x: 3, z: 4 });
    table.updateCameraTransparency({ x: 3, z: -4 }, 0.5);
    const midway = opacity();
    table.updateCameraTransparency({ x: 3, z: 4 }, 0);
    expect(opacity()).toBe(midway);
    table.updateCameraTransparency({ x: 3, z: 4 }, 0.5);
    expect(opacity()).toBeCloseTo((midway + 0.22) / 2, 6);
    table.updateCameraTransparency({ x: 3, z: 4 }, 0.5);
    expect(opacity()).toBeCloseTo(0.22, 6);
  });

  it("keeps exactly two borders transparent when the orbit crosses a camera axis",()=>{
    const table=model();
    for(const camera of [{x:0,z:3},{x:3,z:0},{x:0,z:0}]) {
      table.updateCameraTransparency(camera, 1);
      const transparent=new Set(meshes(table.group).filter(mesh=>(mesh.material as THREE.Material).transparent).flatMap(mesh=>{
        const match=/^(side|end)-board-(-?1)-/.exec(mesh.name);
        return match?[`${match[1]}:${match[2]}`]:[];
      }));
      expect(transparent.size).toBe(2);
    }
  });

  it("gives every visible boot the shared rounded superellipse profile and physical sole height", () => {
    const table = model();
    const feet = table.rods.flatMap(meshes).filter((mesh) => mesh.name === "figure-foot");
    expect(feet).toHaveLength(22);
    for (const foot of feet) {
      const vertices = foot.geometry.getAttribute("position");
      let radius = 0;
      for (let i = 0; i < vertices.count; i++)
        radius = Math.max(radius, Math.hypot(vertices.getX(i), vertices.getZ(i)));
      expect(radius).toBeCloseTo((C.figure.footHalfSize - C.figure.footEdgeBevel) * 2 ** 0.25 + C.figure.footEdgeBevel, 7);
      foot.geometry.computeBoundingBox();
      const bounds = foot.geometry.boundingBox!;
      expect(bounds.max.y - bounds.min.y).toBeCloseTo(C.figure.footHalfSize * 2, 7);
      expect(bounds.max.x).toBeCloseTo(C.figure.footHalfSize, 7);
      expect(bounds.max.z).toBeCloseTo(C.figure.footHalfSize, 7);
      expect(C.table.rodHeight + foot.position.y + bounds.min.y).toBeCloseTo(0.018, 7);
      expect(foot.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    }
  });

  it("retains the host table geometry, all eight rods, 22 figures, physical ball and score counters", () => {
    const host = model();
    const phone = model();
    phone.setControllerAppearance("blue");
    expect(geometrySignature(phone)).toEqual(geometrySignature(host));
    expect(phone.rods).toHaveLength(8);
    phone.rods.forEach((rod, index) => {
      expect(rod.position.x).toBe(ROD_LAYOUT[index]!.x);
      expect(rod.children.filter((child) => child instanceof THREE.Group)).toHaveLength(ROD_LAYOUT[index]!.count);
    });
    const sphere = phone.ball.geometry as THREE.SphereGeometry;
    expect(sphere.parameters.radius).toBe(C.ball.radius);
    expect(phone.ball.visible).toBe(true);
    expect(phone.counters.red.group.parent).toBe(phone.group);
    expect(phone.counters.blue.group.parent).toBe(phone.group);
  });

  it("makes only the opponent rods translucent without changing host or own-team materials", () => {
    const host = model();
    const phone = model();
    const hostAppearance = host.rods.map((rod) => materials(rod).map((material) => ({
      opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
    })));
    phone.setControllerAppearance("red");
    phone.rods.forEach((rod, index) => {
      const own = ROD_LAYOUT[index]!.team === "red";
      for (const material of materials(rod)) {
        expect(material.opacity).toBe(own ? 1 : 0.3);
        expect(material.transparent).toBe(!own);
        expect(material.depthWrite).toBe(own);
      }
      if (!own) for (const mesh of meshes(rod)) expect(mesh.castShadow).toBe(false);
    });
    expect(host.rods.map((rod) => materials(rod).map((material) => ({
      opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite,
    })))).toEqual(hostAppearance);
    const own = new Set(materials(phone.rods[0]!));
    for (const opponent of materials(phone.rods[2]!)) expect(own.has(opponent)).toBe(false);
    const resources = new Set(phone.rods.flatMap(materials));
    phone.setControllerAppearance("blue");
    expect(new Set(phone.rods.flatMap(materials))).toEqual(resources);
    phone.rods.forEach((rod, index) => {
      for (const material of materials(rod))
        expect(material.opacity).toBe(ROD_LAYOUT[index]!.team === "blue" ? 1 : 0.3);
    });
  });

  it("applies authoritative kits to the actual figure meshes after making the opponent transparent", () => {
    const host = model();
    const phone = model();
    const originalHostKits = host.getKits();
    phone.setControllerAppearance("blue");
    phone.setKits({
      red: { primaryColor: "#ef6725", secondaryColor: "#d4e786" },
      blue: { primaryColor: "#a52bc1", secondaryColor: "#cae7f2" },
    });
    ROD_LAYOUT.forEach((rod, index) => {
      expect(`#${shirt(phone, index).color.getHexString()}`).toBe(rod.team === "red" ? "#ef6725" : "#a52bc1");
      expect(shirt(phone, index).opacity).toBe(rod.team === "red" ? 0.3 : 1);
    });
    expect(host.getKits()).toEqual(originalHostKits);
  });

  it("keeps play top-down and switches the same table into the host perspective for replay", () => {
    const table = model();
    table.setControllerAppearance("blue");
    const camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 12);
    configureControllerCamera(camera, 844, 270, tableViewport(844, 270));
    const cameraRig = new HostCameraRig();
    const updateCamera = vi.spyOn(cameraRig, "update");
    const fade = new ReplayFade();
    const renderFade = vi.spyOn(fade, "render");
    const view = Object.assign(Object.create(ControllerScene.prototype), {
      table, camera, scene: new THREE.Scene(), renderer: { render: vi.fn(), setPixelRatio: vi.fn(), shadowMap: {}, setSize: vi.fn() },
      light: { castShadow: false }, goodGraphics: false, appliedGraphics: false, width: 844, height: 270,
      disposed: false, lost: false, scoreKey: "", kits: null,
      cameraRig, phase: "playing", replayView: false,
      ghostOpponents: true, team: "blue", shakeTime: 0,
      fade,
    }) as ControllerScene;
    const fixedView = {
      world: camera.matrixWorld.toArray(), projection: camera.projectionMatrix.toArray(),
    };
    view.render(null, 1 / 60);
    expect(table.ball.visible).toBe(false);
    const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 1.3);
    const snapshot: TableFrame = {
      sequence: 1, time: 100, epoch: 1, phase: "playing",
      ball: { position: { x: -1.34, y: 0.06, z: 0.7 }, rotation: { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w } },
      rods: ROD_LAYOUT.map((rod, index) => ({ translation: rod.travel / 2, angle: 0.3 + index * 4.5 })),
      kits: { red: { primaryColor: "#ff0000", secondaryColor: "#ffffff" }, blue: { primaryColor: "#00aaff", secondaryColor: "#eeeeee" } },
    };
    const original = structuredClone(snapshot);
    view.render(snapshot, 0.5, new Set([2]), { red: 3, blue: 2 }, 7);
    expect(table.ball.visible).toBe(true);
    expect(table.ball.position.toArray()).toEqual([-1.34, 0.06, 0.7]);
    expect(table.ball.quaternion.toArray()).toEqual(rotation.toArray());
    table.rods.forEach((rod, index) => {
      expect(rod.position.x).toBe(ROD_LAYOUT[index]!.x);
      expect(rod.position.z).toBe(snapshot.rods[index]!.translation);
      expect(rod.rotation.z).toBe(snapshot.rods[index]!.angle);
    });
    expect(snapshot).toEqual(original);
    expect(view.activeCamera).toBe(camera);
    expect(view.renderer.shadowMap.enabled).not.toBe(true);
    view.settings({ ...DEFAULT_SETTINGS, graphics: "high" });
    expect(view.renderer.shadowMap.enabled).not.toBe(true);
    for (const [team, score] of [["red", 3], ["blue", 2]] as const) {
      const beads = meshes(table.counters[team].group).filter((mesh) =>
        mesh.geometry instanceof THREE.CylinderGeometry && mesh.geometry.parameters.radiusTop === 0.04,
      );
      expect(beads.filter((bead) => bead.visible)).toHaveLength(7);
      expect(beads.slice(0, score).every((bead) => bead.position.z > 0)).toBe(true);
      expect(beads.slice(score, 7).every((bead) => bead.position.z < 0)).toBe(true);
    }
    snapshot.sequence++;
    snapshot.phase = "replay";
    snapshot.replay = { progress: 0.85, remaining: 1.2, fade: 0, slowMotion: true };
    snapshot.ball.position = { x: 1.34, y: 0.13, z: -0.7 };
    view.render(snapshot, 1 / 60, new Set(), { red: 3, blue: 2 }, 7);
    expect(table.ball.position.toArray()).toEqual([1.34, 0.13, -0.7]);
    expect(camera.matrixWorld.toArray()).toEqual(fixedView.world);
    expect(camera.projectionMatrix.toArray()).toEqual(fixedView.projection);
    expect(view.activeCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    expect(view.renderer.shadowMap.enabled).toBe(true);
    expect(updateCamera).toHaveBeenLastCalledWith(1 / 60, table.ball.position, "replay", snapshot.replay);
    expect(renderFade).toHaveBeenLastCalledWith(view.renderer, snapshot.replay);
    expect(view.renderer.render).toHaveBeenLastCalledWith(view.scene, view.activeCamera);
    expect(view.activeCamera.getWorldDirection(new THREE.Vector3()).y).toBeGreaterThan(-0.95);
    for (const material of table.rods.flatMap(materials)) expect(material.opacity).toBe(1);
    view.render({ ...snapshot, phase: "paused" }, 1 / 60);
    expect(view.activeCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    view.render({ ...snapshot, phase: "countdown" }, 1 / 60);
    expect(view.activeCamera).toBeInstanceOf(THREE.PerspectiveCamera);
    view.render(snapshot, 1 / 60);
    view.render({ ...snapshot, phase: "countdown" }, 1 / 60);
    expect(view.activeCamera).toBe(camera);
    expect(view.renderer.shadowMap.enabled).toBe(false);
    view.setGoodGraphics(true);
    expect(view.renderer.shadowMap.enabled).toBe(true);
    view.settings({ ...DEFAULT_SETTINGS, graphics: "low" });
    expect(view.renderer.shadowMap.enabled).toBe(true);
    view.render(snapshot, 1 / 60);
    view.render({ ...snapshot, phase: "playing" }, 1 / 60);
    expect(view.renderer.shadowMap.enabled).toBe(true);
    view.setGoodGraphics(false);
    expect(view.renderer.shadowMap.enabled).toBe(false);
    expect(table.rods[0]!.children[0]).toBeDefined();
    expect(materials(table.rods[0]!)[0]!.opacity).toBe(0.3);
    expect(camera.matrixWorld.toArray()).toEqual(fixedView.world);
    expect(camera.projectionMatrix.toArray()).toEqual(fixedView.projection);
    fade.dispose();
  });

  it("balances NEM and BOLD around the pitch center line and renames the cabinet sign", () => {
    model();
    const nem = text.find((entry) => entry.value === "NEM")!;
    const bold = text.find((entry) => entry.value === "BOLD")!;
    expect(nem.align).toBe("right");
    expect(bold.align).toBe("left");
    expect(nem.y).toBe(bold.y);
    expect(512 - nem.x).toBe(bold.x - 512);
    expect(text.some((entry) => entry.value === "NEM BOLD")).toBe(true);
    expect(text.some((entry) => /NEMFUSS/.test(entry.value))).toBe(false);
  });
});

describe("one renderer on a mobile host", () => {
  it("moves the existing canvas into the controller and renders direct authoritative poses once", () => {
    const canvas = { remove: vi.fn(), setAttribute: vi.fn(), removeAttribute: vi.fn() };
    const delegate = {
      renderer: { domElement: canvas }, table: {}, scene: {}, activeCamera: {},
      renderPose: vi.fn(), resize: vi.fn(), setTeam: vi.fn(), setGoodGraphics: vi.fn(), dispose: vi.fn(),
    };
    const view = Object.assign(Object.create(MobileHostScene.prototype), { view: delegate, disposed: false }) as MobileHostScene;
    const container = { clientWidth: 844, clientHeight: 270, appendChild: vi.fn() } as unknown as HTMLElement;
    const viewport = tableViewport(844, 270);
    view.attach(container, 844, 270, viewport);
    expect(container.appendChild).toHaveBeenCalledWith(canvas);
    expect(delegate.resize).toHaveBeenCalledWith(844, 270, viewport);
    view.setGoodGraphics(true);
    expect(delegate.setGoodGraphics).toHaveBeenCalledWith(true);
    view.render(1 / 60, "playing");
    const replay = { progress: 0.9, slowMotion: true, remaining: 0.8, fade: 0.4 };
    view.render(1 / 60, "replay", replay);
    expect(delegate.renderPose.mock.calls).toEqual([[1 / 60, "playing", undefined], [1 / 60, "replay", replay]]);
    expect(view.table).toBe(delegate.table);
    expect(view.renderer).toBe(delegate.renderer);
    view.detach();
    expect(canvas.remove).toHaveBeenCalledOnce();
    expect(delegate.dispose).not.toHaveBeenCalled();
    view.dispose();
    view.dispose();
    expect(delegate.dispose).toHaveBeenCalledOnce();
  });
});

describe("fixed top-down controller camera", () => {
  it("aligns the actual 3D pitch with the touch areas without distorting heights", () => {
    for (const [width, height] of [[844, 270], [360, 600], [1512, 820]] as const) {
      const viewport = tableViewport(width, height);
      const camera = new THREE.OrthographicCamera();
      configureControllerCamera(camera, width, height, viewport);
      camera.updateMatrixWorld(true);
      const direction = camera.getWorldDirection(new THREE.Vector3());
      expect(direction.x).toBeCloseTo(0);
      expect(direction.y).toBeCloseTo(-1);
      expect(direction.z).toBeCloseTo(0);
      for (const x of [-1.23, -0.3, 0.66, 1.23]) {
        for (const z of [-0.6, 0, 0.6]) {
          for (const y of [C.ball.radius, C.table.rodHeight, 0.45]) {
            const point = new THREE.Vector3(x, y, z).project(camera);
            expect((point.x + 1) * width / 2).toBeCloseTo(viewport.x + x * viewport.scale, 6);
            expect((1 - point.y) * height / 2).toBeCloseTo(viewport.z + z * viewport.scale, 6);
          }
        }
      }
    }
  });

  it("shows the whole playable surface, both goals, cabinet rails, ball and counters", () => {
    for (const [width, height] of [[844, 270], [360, 600], [1512, 820]] as const) {
      const camera = new THREE.OrthographicCamera();
      configureControllerCamera(camera, width, height, tableViewport(width, height));
      camera.updateMatrixWorld(true);
      const points: THREE.Vector3[] = [];
      for (const x of [-1.74, 1.74])
        for (const z of [-0.94, 0.94])
          points.push(new THREE.Vector3(x, 0.28, z));
      for (const x of [-C.table.goalBackX, C.table.goalBackX])
        for (const z of [-C.table.goalHalfWidth, C.table.goalHalfWidth])
          points.push(new THREE.Vector3(x, C.table.goalHeight, z));
      for (const x of [-1.35, 1.35])
        for (const z of [-0.72, 0.72])
          points.push(new THREE.Vector3(x, C.ball.radius, z));
      for (const x of [-1.61, 1.61])
        for (const z of [-0.7, 0.7])
          points.push(new THREE.Vector3(x, 0.4, z));
      for (const point of points) {
        const screen = point.project(camera);
        expect(Math.abs(screen.x)).toBeLessThan(1);
        expect(Math.abs(screen.y)).toBeLessThan(1);
        expect(Math.abs(screen.z)).toBeLessThan(1);
      }
    }
  });
});
