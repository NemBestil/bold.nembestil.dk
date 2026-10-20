import type { MatchSettings, SessionState, TableFrame, Team } from "../../shared/types";
import { TableFrameBuffer } from "../../network/TableFrameBuffer";
import { SceneManager } from "./SceneManager";
import { getTeamIdentities } from "../../shared/teamIdentity";

/** A second desktop only draws received poses; it never creates a physics world. */
export class RemoteTable {
  private view: SceneManager;
  private frames = new TableFrameBuffer();
  private animation = 0;
  private previous = performance.now();
  private state?: SessionState;
  private counterKey = "";
  private clubKey = "";
  private teamNameFormatter = (_team: Team, name: string) => name;
  private teamNameLocale?: string;
  constructor(container: HTMLElement) {
    this.view = new SceneManager(container);
    this.animation = requestAnimationFrame(this.render);
  }
  frame(frame: TableFrame) { this.frames.push(frame); }
  settings(settings: MatchSettings) { this.view.settings(settings); }
  setTeamNameFormatter(formatter: (team: Team, name: string) => string, locale?: string) {
    this.teamNameFormatter = formatter;
    this.teamNameLocale = locale;
    if (this.state) this.update(this.state);
  }
  update(state: SessionState) {
    this.state = state;
    if (state.match.phase === "lobby") return;
    const names = getTeamIdentities(state.teamNames);
    const identities = getTeamIdentities({
      red: this.teamNameFormatter("red", names.red.name),
      blue: this.teamNameFormatter("blue", names.blue.name),
    });
    const key = JSON.stringify([this.teamNameLocale, identities]);
    if (key !== this.clubKey) { this.clubKey = key; this.view.table.setClubs(identities, this.teamNameLocale); }
  }
  private render = (now: number) => {
    const dt = Math.max(0, Math.min(0.1, (now - this.previous) / 1000));
    this.previous = now;
    const frame = this.frames.sample(now);
    this.view.table.ball.visible = !!frame;
    if (frame) {
      this.view.table.ball.position.copy(frame.ball.position);
      this.view.table.ball.quaternion.copy(frame.ball.rotation);
      for (const [index, rod] of this.view.table.rods.entries()) {
        const pose = frame.rods[index]!;
        rod.position.z = pose.translation;
        rod.rotation.z = pose.angle;
      }
      this.view.table.setKits(frame.kits);
    }
    const scores = frame?.scores ?? this.state?.match.scores;
    const target = frame?.goalsToWin ?? this.state?.settings.goalsToWin ?? 5;
    if (scores) {
      const key = `${scores.red}:${scores.blue}:${target}`;
      if (key !== this.counterKey) {
        this.counterKey = key;
        for (const team of ["red", "blue"] as const) this.view.table.counters[team].setScore(scores[team], target);
      }
    }
    this.view.render(dt, frame?.phase ?? this.state?.match.phase ?? "lobby", frame?.replay, frame?.camera);
    this.animation = requestAnimationFrame(this.render);
  };
  dispose() { cancelAnimationFrame(this.animation); this.frames.clear(); this.view.dispose(); }
}
