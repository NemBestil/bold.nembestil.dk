import * as THREE from "three";
import type { FootballClub, MatchPhase, MatchSettings, ReplayState, TableFrame, Team } from "../../shared/types";
import { TableModel } from "./TableModel";
import { addTableLighting } from "./TableLighting";
import { HostCameraRig } from "./HostCamera";
import { ReplayFade } from "./ReplayFade";
import { bindCanvasLabel } from "./CanvasAccessibility";

export const CONTROLLER_VIEW_BOUNDS = {
  halfLength: 1.82,
  halfWidth: 0.97,
} as const;

export interface ControllerViewport {
  scale: number;
  x: number;
  z: number;
}

/** The touch layer and fixed camera use exactly the same world-to-pixel mapping. */
export function configureControllerCamera(
  camera: THREE.OrthographicCamera,
  width: number,
  height: number,
  viewport?: ControllerViewport,
) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const view = viewport ?? {
    scale: Math.min(
      w / (CONTROLLER_VIEW_BOUNDS.halfLength * 2),
      h / (CONTROLLER_VIEW_BOUNDS.halfWidth * 2),
    ),
    x: w / 2,
    z: h / 2,
  };
  const scale = Math.max(0.001, view.scale);
  camera.left = -view.x / scale;
  camera.right = (w - view.x) / scale;
  camera.top = view.z / scale;
  camera.bottom = -(h - view.z) / scale;
  camera.position.set(0, 5, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

function disposeLighting(scene: THREE.Scene) {
  for (const object of scene.children) {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material)
        ? object.material
        : [object.material]) material.dispose();
    }
    if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
  }
}

/** Draws host poses with the controller's local visual prediction. */
export class ControllerScene {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-2, 2, 1, -1, 0.1, 12);
  private cameraRig = new HostCameraRig(
    typeof window !== "undefined" && (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false),
  );
  readonly renderer: THREE.WebGLRenderer;
  readonly table: TableModel;
  private disposed = false;
  private lost = false;
  private clubKey = "";
  private scoreKey = "";
  private kits: TableFrame["kits"] | null = null;
  private phase: MatchPhase = "playing";
  private replayView = false;
  private ghostOpponents = true;
  private shakeTime = 0;
  private fade = new ReplayFade();
  private goodGraphics = false;
  private appliedGraphics?: boolean;
  private light: THREE.DirectionalLight;

  constructor(
    private container: HTMLElement,
    private team: Team,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: "low-power",
    });
    let table: TableModel | undefined;
    try {
      this.renderer.setPixelRatio(1);
      this.renderer.shadowMap.enabled = false;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.toneMappingExposure = 1.3;
      this.renderer.setClearColor(0x101710, 0);
      this.renderer.domElement.style.cssText =
        "width:100%;height:100%;display:block;pointer-events:none";
      this.renderer.domElement.setAttribute("role", "img");
      bindCanvasLabel(this.renderer.domElement, container);
      this.renderer.domElement.addEventListener(
        "webglcontextlost",
        this.onContextLost,
      );
      this.renderer.domElement.addEventListener(
        "webglcontextrestored",
        this.onContextRestored,
      );
      container.appendChild(this.renderer.domElement);
      table = new TableModel();
      table.setControllerAppearance(team);
      table.ball.visible = false;
      this.scene.add(table.group);
      this.light = addTableLighting(this.scene, 512);
      this.applyGraphics();
      this.resize(container.clientWidth, container.clientHeight);
      this.table = table;
      void table.loadOptionalShell();
    } catch (error) {
      this.fade.dispose();
      table?.dispose();
      disposeLighting(this.scene);
      this.renderer.domElement.removeEventListener(
        "webglcontextlost",
        this.onContextLost,
      );
      this.renderer.domElement.removeEventListener(
        "webglcontextrestored",
        this.onContextRestored,
      );
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      this.renderer.domElement.remove();
      throw error;
    }
  }

  private onContextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
  };
  private onContextRestored = () => {
    this.lost = false;
  };

  setTeam(team: Team) {
    if (this.disposed || team === this.team) return;
    this.team = team;
    this.table.setControllerAppearance(team, this.ghostOpponents);
  }

  setClubs(clubs: Record<Team, FootballClub>, locale?: string) {
    if (this.disposed) return;
    const key = `${locale ?? ""}:` + JSON.stringify(
      (["red", "blue"] as const).map((team) => {
        const club = clubs[team];
        return [
          club.id,
          club.name,
          club.shortName,
          club.primaryColor,
          club.secondaryColor,
        ];
      }),
    );
    if (key === this.clubKey) return;
    this.clubKey = key;
    this.table.setClubs(clubs, locale);
    if (this.kits) this.table.setKits(this.kits);
  }

  resize(width: number, height: number, viewport?: ControllerViewport) {
    if (this.disposed) return;
    const w = Math.max(1, width);
    const h = Math.max(1, height);
    configureControllerCamera(this.camera, w, h, viewport);
    this.cameraRig.resize(w / h);
    this.renderer.setSize(w, h, false);
  }

  settings(_settings: MatchSettings) {
    // Match-wide settings must not overwrite this device's graphics choice.
    this.applyGraphics();
  }

  setGoodGraphics(enabled: boolean) {
    this.goodGraphics = enabled;
    this.applyGraphics();
  }

  private applyGraphics() {
    if (this.disposed) return;
    const good = this.goodGraphics || this.replayView;
    if (this.appliedGraphics === good) return;
    this.appliedGraphics = good;
    const ratio = good ? 1.5 : 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, ratio));
    this.renderer.shadowMap.enabled = good;
    this.light.castShadow = good;
  }

  shake(duration = 0.25) {
    this.shakeTime = duration;
  }

  get activeCamera(): THREE.Camera {
    return this.replayView || this.phase === "lobby" ? this.cameraRig.camera : this.camera;
  }

  /** Used by the local host after its one authoritative engine has set the poses. */
  renderPose(dt: number, phase: MatchPhase = "playing", replay?: ReplayState) {
    if (this.disposed || this.lost) return;
    if (phase === "replay") this.replayView = true;
    else if (phase !== "paused" && !(phase === "countdown" &&
      (this.phase === "paused" || this.phase === "countdown"))) this.replayView = false;
    this.phase = phase;
    this.applyGraphics();
    const ghost = phase !== "lobby" && !this.replayView;
    if (ghost !== this.ghostOpponents) {
      this.ghostOpponents = ghost;
      this.table.setControllerAppearance(this.team, ghost);
    }
    // Keep the perspective camera following during play, so replay starts from
    // the same visual history as the host instead of a new arbitrary angle.
    this.cameraRig.update(dt, this.table.ball.position, phase, replay);
    this.shakeTime = Math.max(0, this.shakeTime - dt);
    if (this.replayView && this.shakeTime > 0 && !this.cameraRig.reducedMotion) {
      const amplitude = this.shakeTime * 0.055;
      this.cameraRig.camera.position.x += Math.sin(this.shakeTime * 100) * amplitude;
      this.cameraRig.camera.position.y += Math.cos(this.shakeTime * 130) * amplitude;
    }
    this.table.counters.red.update(dt);
    this.table.counters.blue.update(dt);
    this.table.updateCameraTransparency(this.activeCamera.position, dt);
    this.renderer.render(this.scene, this.activeCamera);
    this.fade.render(this.renderer, replay);
  }

  render(
    frame: TableFrame | null,
    dt: number,
    _active?: ReadonlySet<number>,
    scores?: Record<Team, number>,
    target = 5,
  ) {
    if (this.disposed || this.lost) return;
    this.table.ball.visible = !!frame;
    if (frame) {
      this.table.ball.position.copy(frame.ball.position);
      this.table.ball.quaternion.copy(frame.ball.rotation);
      for (const [index, rod] of this.table.rods.entries()) {
        const transform = frame.rods[index];
        if (!transform) continue;
        rod.position.z = transform.translation;
        rod.rotation.z = transform.angle;
      }
      this.kits = frame.kits;
      this.table.setKits(frame.kits);
    }
    if (scores) {
      const key = `${scores.red}:${scores.blue}:${target}`;
      if (key !== this.scoreKey) {
        this.scoreKey = key;
        for (const team of ["red", "blue"] as const)
          this.table.counters[team].setScore(scores[team], target);
      }
    }
    this.renderPose(dt, frame?.phase ?? "playing", frame?.replay);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.domElement.removeEventListener(
      "webglcontextlost",
      this.onContextLost,
    );
    this.renderer.domElement.removeEventListener(
      "webglcontextrestored",
      this.onContextRestored,
    );
    this.table.dispose();
    disposeLighting(this.scene);
    this.fade.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
