import { DEFAULT_SETTINGS, type Team } from "../../shared/types";
import { GAME_CONFIG as C } from "../GameConfig";
import type { PhysicsWorld } from "../physics/PhysicsWorld";
import { ComputerOpponent } from "./ComputerOpponent";
import { isOutOfBounds, scoringTeam } from "./GameRules";

/** Background play on the lobby's existing table, without a match lifecycle. */
export class LobbyDemo {
  static readonly goalsToWin = 5;
  readonly scores: Record<Team, number> = { red: 0, blue: 0 };
  private computers = (["red", "blue"] as const).map(
    (team) => new ComputerOpponent("beginner", Math.random, team),
  );
  private stuckTime = 0;
  private serveSide = Math.random() < 0.5 ? -1 : 1;

  constructor(private physics: PhysicsWorld) {
    this.physics.resetRods();
    this.serve();
  }

  private serve() {
    this.physics.neutralize();
    for (const computer of this.computers) computer.reset();
    this.physics.serve(this.serveSide);
    this.serveSide *= -1;
    this.stuckTime = 0;
  }

  /** Returns whether the physical score beads need updating. */
  step(dt: number): boolean {
    for (const computer of this.computers) {
      const inputs = computer.update(dt, {
        ball: {
          position: this.physics.ball.translation(),
          velocity: this.physics.ball.linvel(),
        },
        rods: this.physics.rods
          .filter((rod) => rod.layout.team === computer.team)
          .map((rod) => ({
            id: rod.layout.id,
            translation: rod.state.translation,
            angle: rod.state.angle,
            velocity: rod.state.velocity,
            pinnedDirection: this.physics.groundedPinDirection(rod.layout.team, rod.layout.id),
          })),
      });
      for (const input of inputs) this.physics.input(computer.team, input);
    }
    this.physics.step(dt, DEFAULT_SETTINGS.rotationDamping);
    // The demo neither plays sounds nor records replay/contact history.
    this.physics.drainImpacts();
    this.physics.drainBallTouches();

    const position = this.physics.ball.translation();
    const scored = scoringTeam(position);
    if (scored) {
      this.scores[scored]++;
      if (this.scores[scored] >= LobbyDemo.goalsToWin) {
        this.scores.red = 0;
        this.scores.blue = 0;
        this.physics.resetRods();
      }
      this.serve();
      return true;
    }
    const velocity = this.physics.ball.linvel();
    this.stuckTime = Math.hypot(velocity.x, velocity.y, velocity.z) < C.ball.stuckSpeed
      ? this.stuckTime + dt : 0;
    if (isOutOfBounds(position) || this.stuckTime >= 6) this.serve();
    return false;
  }
}
