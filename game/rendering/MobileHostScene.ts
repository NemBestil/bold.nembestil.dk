import type { FootballClub, MatchPhase, MatchSettings, ReplayState, Team } from "../../shared/types";
import { ControllerScene, type ControllerViewport } from "./ControllerScene";
import type { GameView } from "./GameView";
import { bindCanvasLabel } from "./CanvasAccessibility";

/** The mobile host shares its existing canvas with the local touch controller. */
export class MobileHostScene implements GameView {
  private view: ControllerScene;
  private disposed = false;

  constructor(container: HTMLElement, team: Team = "red") {
    this.view = new ControllerScene(container, team);
    this.view.table.ball.visible = true;
  }

  get table() { return this.view.table; }
  get renderer() { return this.view.renderer; }
  get scene() { return this.view.scene; }
  get camera() { return this.view.activeCamera; }

  attach(container: HTMLElement, width = container.clientWidth, height = container.clientHeight, viewport?: ControllerViewport) {
    if (this.disposed) return;
    container.appendChild(this.renderer.domElement);
    bindCanvasLabel(this.renderer.domElement, container);
    this.resize(width, height, viewport);
  }

  detach() {
    if (!this.disposed) this.renderer.domElement.remove();
  }

  resize(width: number, height: number, viewport?: ControllerViewport) {
    this.view.resize(width, height, viewport);
  }

  setTeam(team: Team) { this.view.setTeam(team); }
  setClubs(clubs: Record<Team, FootballClub>) { this.view.setClubs(clubs); }
  settings(settings: MatchSettings) { this.view.settings(settings); }
  setGoodGraphics(enabled: boolean) { this.view.setGoodGraphics(enabled); }
  shake(duration?: number) { this.view.shake(duration); }
  render(dt: number, phase: MatchPhase = "playing", replay?: ReplayState) { this.view.renderPose(dt, phase, replay); }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.view.dispose();
  }
}
