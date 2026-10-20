import {
  DEFAULT_SETTINGS,
  INITIAL_MATCH,
  type FootballClub,
  type MatchPhase,
  type MatchSettings,
  type MatchSnapshot,
  type MatchRecording,
  type RodInput,
  type TableFrame,
  type Team,
  type GameSoundEvent,
} from "../shared/types";
import { computerAssignments } from "../shared/matchSettings";
import type { ReplayFileData } from "../shared/replayFile";
import { getTeamIdentities } from "../shared/teamIdentity";
import { GAME_CONFIG as C } from "./GameConfig";
import { GameLoop } from "./GameLoop";
import { PhysicsWorld } from "./physics/PhysicsWorld";
import { SceneManager } from "./rendering/SceneManager";
import { MobileHostScene } from "./rendering/MobileHostScene";
import type { GameView } from "./rendering/GameView";
import { GameAudio } from "./audio/GameAudio";
import { canBump, isOutOfBounds, scoringTeam } from "./systems/GameRules";
import { ComputerOpponent } from "./systems/ComputerOpponent";
import { LobbyDemo } from "./systems/LobbyDemo";
import {
  ReplayRecorder,
  type GoalReplay,
  type MontageSample,
  type ReplayFrame,
  type ReplayPose,
  type ReplaySample,
} from "./systems/GoalReplay";

import { MatchReplayPlayer, MatchReplayRecorder } from "./systems/MatchReplay";

/** The complete authoritative simulation. It has no Vue or networking dependencies. */
export class GameEngine {
  private state: MatchSnapshot = structuredClone(INITIAL_MATCH);
  private settings = { ...DEFAULT_SETTINGS };
  private recordingSettings: MatchSettings | null = null;
  private clubs: Record<Team, FootballClub> | null = null;
  private teamNameFormatter = (_team: Team, name: string) => name;
  private teamNameLocale?: string;
  private loop: GameLoop;
  private phaseTime = 0;
  private cooldown = 0;
  private publishTime = 0;
  private nextServeSide = 1;
  private resumePhase: MatchPhase = "playing";
  private countdownTarget: MatchPhase = "serving";
  private countdownPreservesBall = false;
  private resumePhaseTime = 0;
  private resumeNotice = "";
  private disposed = false;
  private recorder = new ReplayRecorder();
  private replay: GoalReplay | null = null;
  private matchRecorder = new MatchReplayRecorder();
  private matchPlayback: MatchReplayPlayer | null = null;
  private matchPlaybackCut = -1;
  private highlights: GoalReplay[] = [];
  private replayFrame: ReplayFrame | null = null;
  private replayElapsed = 0;
  private replayStartedAt = 0;
  private postReplayPhase: "serving" | "finished" = "serving";
  private frameSequence = 0;
  private frameEpoch = 0;
  private frameTime = Infinity;
  private replaySegment = -1;
  private replayGoal = 0;
  private computers: ComputerOpponent[] = [];
  private computerKey = "";
  private lobbyDemo: LobbyDemo | null = null;
  private lobbyDemoEnabled = false;
  private audio = new GameAudio();
  private soundSequence = 0;
  private openingWhistle = false;
  private constructor(
    private physics: PhysicsWorld,
    private view: GameView,
    private onSnapshot: (snapshot: MatchSnapshot) => void,
    private onFrame?: (frame: TableFrame) => void,
    private onSound?: (event: GameSoundEvent) => void,
    private renderFps: number = C.rendering.targetFps,
  ) {
    this.loop = new GameLoop(this.step, this.render, renderFps);
    this.loop.start();
    document.addEventListener("visibilitychange", this.visibility);
    this.emit();
  }
  static async create(
    container: HTMLElement,
    onSnapshot: (snapshot: MatchSnapshot) => void,
    onFrame?: (frame: TableFrame) => void,
    onSound?: (event: GameSoundEvent) => void,
  ): Promise<GameEngine> {
    const physics = await PhysicsWorld.create();
    try {
      return new GameEngine(
        physics,
        new SceneManager(container),
        onSnapshot,
        onFrame,
        onSound,
      );
    } catch (error) {
      physics.dispose();
      throw error;
    }
  }
  static async createMobile(
    container: HTMLElement,
    onSnapshot: (snapshot: MatchSnapshot) => void,
    onFrame?: (frame: TableFrame) => void,
    onSound?: (event: GameSoundEvent) => void,
  ): Promise<GameEngine> {
    const physics = await PhysicsWorld.create();
    try {
      return new GameEngine(
        physics,
        new MobileHostScene(container),
        onSnapshot,
        onFrame,
        onSound,
      );
    } catch (error) {
      physics.dispose();
      throw error;
    }
  }
  get mobileView(): MobileHostScene | null {
    return this.view instanceof MobileHostScene ? this.view : null;
  }
  /** Presentation is local to this screen; recordings keep the original names. */
  setTeamNameFormatter(formatter: (team: Team, name: string) => string, locale?: string) {
    this.teamNameFormatter = formatter;
    this.teamNameLocale = locale;
    this.updateTeamSigns();
  }
  private updateTeamSigns() {
    if (!this.clubs) return;
    this.view.table.setClubs(getTeamIdentities({
      red: this.teamNameFormatter("red", this.clubs.red.name),
      blue: this.teamNameFormatter("blue", this.clubs.blue.name),
    }), this.teamNameLocale);
  }
  get muted(): boolean {
    return this.audio.muted;
  }
  unlockAudio(): Promise<void> {
    return this.audio.unlock();
  }
  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }
  private sound(kind: GameSoundEvent["kind"], strength = 1) {
    const event = { id: ++this.soundSequence, kind, strength };
    this.audio.play(event);
    this.onSound?.(event);
  }
  get matchRecording(): MatchRecording | null {
    return this.matchRecorder.goals.length ? this.matchRecorder.metadata : null;
  }
  private get pointTarget(): number {
    return this.state.winner ? this.recordingSettings?.goalsToWin ?? this.settings.goalsToWin : this.settings.goalsToWin;
  }
  exportMatchReplay(): ReplayFileData | null {
    if (!this.state.winner || !this.clubs || !this.matchRecorder.goals.length) return null;
    return {
      format: "nem-bold-replay",
      version: 1,
      createdAt: new Date().toISOString(),
      teams: structuredClone(this.clubs),
      settings: structuredClone(this.recordingSettings ?? this.settings),
      recording: this.matchRecorder.toArchive(),
    };
  }
  /** Open a validated local file in an engine dedicated to replay viewing. */
  loadMatchReplay(file: ReplayFileData): boolean {
    const result = file.recording.goals.at(-1);
    if (this.disposed || (!this.state.winner && this.state.phase !== "lobby") || !result || result.scores[result.team] !== file.settings.goalsToWin) return false;
    this.lobbyDemo = null;
    this.lobbyDemoEnabled = false;
    this.clearReplay();
    this.highlights = [];
    this.matchRecorder = MatchReplayRecorder.fromArchive(file.recording);
    this.settings = structuredClone(file.settings);
    this.physics.setBallSpeed(file.settings.ballSpeed);
    this.recordingSettings = structuredClone(file.settings);
    this.clubs = getTeamIdentities({ red: file.teams.red.name, blue: file.teams.blue.name });
    this.physics.neutralize();
    this.physics.resetRods();
    this.physics.parkBall();
    this.resetComputers();
    this.audio.stop();
    this.openingWhistle = false;
    this.view.settings(this.settings);
    this.updateTeamSigns();
    const lastGoal = this.matchRecorder.goals.at(-1)!;
    this.state = {
      ...structuredClone(INITIAL_MATCH),
      phase: "finished",
      scores: { ...lastGoal.scores },
      winner: lastGoal.team,
    };
    this.cooldown = this.phaseTime = 0;
    this.postReplayPhase = "finished";
    this.startMatchReplay("full");
    return true;
  }
  startMatchReplay(mode: "highlights" | "full" = "full") {
    if (this.disposed || !this.state.winner || !this.matchRecorder.goals.length || (!["finished", "replay"].includes(this.state.phase) && !(this.state.phase === "paused" && this.matchPlayback))) return;
    this.physics.neutralize();
    this.resetComputers();
    this.audio.stop();
    this.matchPlayback = new MatchReplayPlayer(this.matchRecorder, mode);
    this.matchPlaybackCut = -1;
    this.replay = null;
    this.state.phase = "replay";
    this.state.bumpAvailable = false;
    this.state.scoringTeam = null;
    this.replayElapsed = 0;
    this.replayStartedAt = performance.now();
    this.applyMatchReplay(0);
    this.emit();
  }
  private activateMatchReplayControls() {
    if (!this.matchPlayback || !this.state.winner || !["replay", "paused"].includes(this.state.phase)) return false;
    if (this.state.phase === "paused") {
      // Browsing an already finished match needs no live-game resume countdown.
      this.state.phase = "replay";
      this.state.countdown = 0;
      this.frameEpoch++;
      this.frameTime = Infinity;
    }
    return true;
  }
  setMatchReplayPlaying(playing: boolean) {
    if (!this.activateMatchReplayControls()) return;
    if (!playing) this.audio.stop();
    this.matchPlayback!.playing = playing;
    this.replayElapsed = 0;
    this.replayStartedAt = performance.now();
    this.applyMatchReplay(0);
    this.emit();
  }
  seekMatchReplay(time: number) {
    if (!Number.isFinite(time)) return;
    if (!this.matchPlayback && this.state.phase === "finished") this.startMatchReplay("full");
    if (!this.activateMatchReplayControls()) return;
    this.audio.stop();
    this.matchPlayback!.seek(time);
    this.replayElapsed = 0;
    this.replayStartedAt = performance.now();
    this.applyMatchReplay(0);
    this.emit();
  }
  seekMatchReplayHighlight(index: number) {
    if (!Number.isInteger(index) || !this.matchRecorder.goals.some(goal => goal.index === index)) return;
    if (!this.matchPlayback && this.state.phase === "finished") this.startMatchReplay("full");
    if (!this.activateMatchReplayControls()) return;
    this.audio.stop();
    this.matchPlayback!.seekHighlight(index);
    this.replayElapsed = 0;
    this.replayStartedAt = performance.now();
    this.applyMatchReplay(0);
    this.emit();
  }
  setMatchReplayMode(mode: "highlights" | "full") {
    if (!this.activateMatchReplayControls()) return;
    this.audio.stop();
    this.matchPlayback!.setMode(mode);
    this.replayElapsed = 0;
    this.replayStartedAt = performance.now();
    this.applyMatchReplay(0);
    this.emit();
  }
  stopMatchReplay() {
    if (!this.matchPlayback) return;
    this.postReplayPhase = "finished";
    this.finishReplay();
  }
  get snapshot(): MatchSnapshot {
    return structuredClone(this.state);
  }
  private emit() {
    if (!this.disposed) this.onSnapshot(this.snapshot);
  }
  startLobbyDemo() {
    if (this.disposed) return;
    this.lobbyDemoEnabled = true;
    if (this.state.phase !== "lobby" || this.lobbyDemo) return;
    this.lobbyDemo = new LobbyDemo(this.physics);
    this.updateCounters(true);
  }
  start(settings: MatchSettings, clubs: Record<Team, FootballClub>) {
    this.lobbyDemo = null;
    this.clearReplay();
    this.highlights = [];
    this.matchRecorder.clear();
    this.settings = { ...settings };
    this.physics.setBallSpeed(settings.ballSpeed);
    this.recordingSettings = structuredClone(settings);
    this.configureComputer();
    this.resetComputers();
    this.audio.stop();
    this.openingWhistle = true;
    this.clubs = getTeamIdentities({ red: clubs.red.name, blue: clubs.blue.name });
    this.view.settings(settings);
    this.updateTeamSigns();
    this.state = {
      ...structuredClone(INITIAL_MATCH),
      phase: "countdown",
      notice: "Gør jer klar",
    };
    this.physics.resetRods();
    this.physics.parkBall();
    this.cooldown = 0;
    this.publishTime = 0;
    this.nextServeSide = Math.random() < 0.5 ? -1 : 1;
    this.countdownTarget = "serving";
    this.countdownPreservesBall = false;
    this.phaseTime = C.match.countdownDuration;
    this.updateCounters(true);
    this.emit();
  }
  input(team: Team, input: RodInput) {
    if (
      this.state.phase !== "playing" ||
      this.computers.some(
        (computer) =>
          computer.team === team && computer.rodIds.includes(input.rodId),
      ) ||
      !Number.isInteger(input.rodId) ||
      input.rodId < 0 ||
      input.rodId > 3 ||
      !Number.isSafeInteger(input.sequence) ||
      !Number.isFinite(input.translation) ||
      !Number.isFinite(input.angularVelocity)
    )
      return;
    this.physics.input(team, input);
  }
  private canBump() {
    const velocity = this.physics.ball.linvel();
    return canBump(this.state.phase, this.cooldown, Math.hypot(velocity.x, velocity.y, velocity.z));
  }
  bump() {
    if (!this.canBump())
      return false;
    this.physics.bump(this.settings.bumpStrength);
    this.cooldown = C.bump.cooldown;
    this.state.bumpAvailable = false;
    this.state.bumpCooldown = C.bump.cooldown;
    this.view.shake();
    this.emit();
    return true;
  }
  pause() {
    if (["lobby", "paused", "finished"].includes(this.state.phase)) return;
    this.resumePhase = this.state.phase;
    if (this.state.phase !== "countdown") {
      this.resumePhaseTime = this.phaseTime;
      this.resumeNotice = this.state.notice;
    }
    this.physics.neutralize();
    this.resetComputers();
    this.audio.stop();
    this.physics.drainImpacts();
    this.state.phase = "paused";
    this.state.notice = "Kampen er sat på pause";
    this.state.bumpAvailable = false;
    this.emit();
  }
  resume() {
    if (this.state.phase !== "paused") return;
    if (this.resumePhase !== "countdown") {
      this.countdownTarget = this.resumePhase;
      this.countdownPreservesBall = true;
    }
    this.state.phase = "countdown";
    this.state.countdown = C.match.countdownDuration;
    this.state.notice = "Kampen fortsætter";
    this.phaseTime = C.match.countdownDuration;
    this.emit();
  }
  reset() {
    this.lobbyDemo = null;
    this.clearReplay();
    this.highlights = [];
    this.matchRecorder.clear();
    this.state = structuredClone(INITIAL_MATCH);
    this.recordingSettings = null;
    this.physics.neutralize();
    this.resetComputers();
    this.audio.stop();
    this.openingWhistle = false;
    this.physics.resetRods();
    this.physics.parkBall();
    this.cooldown = 0;
    this.phaseTime = 0;
    if (this.lobbyDemoEnabled) this.startLobbyDemo();
    this.updateCounters(true);
    this.emit();
  }
  updateSettings(settings: MatchSettings) {
    // The point target becomes effective with the next match, so a paused match cannot finish accidentally.
    const target =
      this.state.phase === "lobby" || this.state.phase === "finished"
        ? settings.goalsToWin
        : this.settings.goalsToWin;
    this.settings = { ...settings, goalsToWin: target };
    this.physics.setBallSpeed(settings.ballSpeed);
    if (!this.lobbyDemo) this.configureComputer();
    this.view.settings(settings);
    this.state.bumpAvailable = this.canBump();
    this.updateCounters();
    this.emit();
  }
  private visibility = () => {
    if (document.hidden) this.pause();
  };
  private configureComputer() {
    const assignments = computerAssignments(this.settings);
    const key = JSON.stringify(assignments);
    if (key === this.computerKey) return;
    for (const computer of this.computers)
      this.physics.neutralize(computer.team, computer.rodIds);
    this.resetComputers();
    this.computers = assignments.map(({ team, level, rodIds }) => {
      this.physics.neutralize(team, rodIds);
      return new ComputerOpponent(level, Math.random, team, rodIds);
    });
    this.computerKey = key;
  }
  private resetComputers() {
    for (const computer of this.computers) computer.reset();
  }
  private beginServe() {
    this.resetComputers();
    this.clearReplay();
    this.physics.serve(this.nextServeSide);
    // Even a goal on the first simulated serve step has a real starting pose.
    const pose = this.capturePose();
    this.recorder.record(0, pose, []);
    this.matchRecorder.beginRally(pose);
    this.state.phase = "serving";
    this.state.scoringTeam = null;
    this.state.notice = "Bolden serveres";
    this.state.countdown = 0;
    this.state.bumpAvailable = false;
    this.phaseTime = C.serving.duration;
    if (this.openingWhistle) {
      this.openingWhistle = false;
      this.sound("whistle");
    }
    this.emit();
  }
  private clearReplay() {
    this.frameEpoch++;
    this.frameTime = Infinity;
    this.replaySegment = -1;
    this.replayGoal = 0;
    this.recorder.clear();
    this.replay = null;
    this.matchPlayback = null;
    this.matchPlaybackCut = -1;
    this.replayFrame = null;
    this.replayElapsed = 0;
    delete this.state.replay;
  }
  private capturePose(): ReplayPose {
    return {
      ball: {
        position: this.physics.ball.translation(),
        rotation: this.physics.ball.rotation(),
      },
      rods: this.physics.rods.map((rod) => ({
        translation: rod.state.translation,
        angle: rod.state.angle,
      })),
    };
  }
  private beginReplay() {
    this.state.scoringTeam = null;
    if (this.postReplayPhase === "finished" && this.matchRecorder.goals.length) {
      this.state.phase = "finished";
      this.startMatchReplay("highlights");
      return;
    }
    const playback = this.replay;
    if (!playback) {
      this.finishReplay();
      return;
    }
    this.state.phase = "replay";
    this.replayElapsed = 0;
    this.replayStartedAt = performance.now();
    this.replaySegment = -1;
    this.applyReplaySample(playback.sample(0));
    this.phaseTime = playback.duration;
    this.publishTime = 0;
    this.emit();
  }
  private applyMatchReplay(dt: number) {
    if (!this.matchPlayback) return false;
    const sample = this.matchPlayback.advance(dt);
    if (sample.cut !== this.matchPlaybackCut) {
      this.frameEpoch++;
      this.frameTime = Infinity;
      this.matchPlaybackCut = sample.cut;
    }
    this.replayFrame = sample.frame;
    this.state.replay = sample.replay;
    this.state.notice = sample.replay.mode === "highlights" ? "Kampens mål" : "Hele kampen";
    this.updateCounters();
    for (let goal = 0; goal < sample.goals.length; goal++) {
      this.sound("goal");
      this.view.shake(0.35);
    }
    return sample.done;
  }
  private applyReplaySample(sample: ReplaySample | MontageSample) {
    const goal = "goalIndex" in sample ? sample.goalIndex : 0;
    if (sample.segment !== this.replaySegment || goal !== this.replayGoal) {
      // Phone interpolation must snap at separated touches and between goals.
      this.frameEpoch++;
      this.frameTime = Infinity;
      this.replaySegment = sample.segment;
      this.replayGoal = goal;
    }
    this.replayFrame = sample.frame;
    this.state.replay = {
      progress: sample.progress,
      slowMotion: sample.slowMotion,
      remaining: sample.remaining,
      fade: "fade" in sample ? sample.fade : 0,
      ...("summary" in sample
        ? {
            summary: true,
            goalIndex: sample.goalIndex,
            goalCount: sample.goalCount,
          }
        : {}),
    };
    this.state.notice =
      "summary" in sample
        ? "Kampens mål"
        : sample.slowMotion
          ? "Det sidste sekund · Slowmotion"
          : "De sidste berøringer";
  }
  private finishReplay() {
    this.audio.stop();
    this.frameEpoch++;
    this.frameTime = Infinity;
    this.replay = null;
    this.matchPlayback = null;
    this.matchPlaybackCut = -1;
    this.replayFrame = null;
    delete this.state.replay;
    this.updateCounters(true);
    if (this.postReplayPhase === "finished") {
      this.state.phase = "finished";
      this.state.notice = `${this.clubs?.[this.state.winner!].name || (this.state.winner === "red" ? "Rødt hold" : "Blåt hold")} vinder!`;
      this.emit();
    } else this.beginServeCountdown();
  }
  private beginServeCountdown() {
    this.state.phase = "countdown";
    this.state.countdown = C.match.countdownDuration;
    this.state.notice = "Ny bold om";
    this.state.bumpAvailable = false;
    this.phaseTime = C.match.countdownDuration;
    this.countdownTarget = "serving";
    this.countdownPreservesBall = false;
    this.emit();
  }
  private updateCounters(immediate = false) {
    const scores = this.lobbyDemo?.scores ?? this.state.replay?.scores ?? this.state.scores;
    const goals = this.lobbyDemo ? LobbyDemo.goalsToWin : this.pointTarget;
    this.view.table.counters.red.setScore(
      scores.red,
      goals,
      immediate,
    );
    this.view.table.counters.blue.setScore(
      scores.blue,
      goals,
      immediate,
    );
  }
  private step = (dt: number) => {
    const phase = this.state.phase;
    if (phase === "lobby") {
      if (!document.hidden && this.lobbyDemo?.step(dt)) this.updateCounters();
      return;
    }
    if (phase === "paused" || phase === "finished") return;
    if (phase === "countdown") {
      this.phaseTime -= dt;
      const number = Math.max(1, Math.ceil(this.phaseTime));
      if (number !== this.state.countdown) {
        this.state.countdown = number;
        this.emit();
      }
      if (this.phaseTime <= 0) {
        if (this.countdownTarget === "serving" && !this.countdownPreservesBall)
          this.beginServe();
        else {
          this.state.phase = this.countdownTarget;
          this.state.countdown = 0;
          this.state.notice = this.resumeNotice;
          this.phaseTime = this.resumePhaseTime;
          this.countdownPreservesBall = false;
          if (this.state.phase === "replay")
            this.replayStartedAt =
              performance.now() - this.replayElapsed * 1000;
          this.emit();
        }
      }
      return;
    }
    if (phase === "replay") {
      if (this.matchPlayback) {
        if (!this.matchPlayback.playing) return;
        const elapsed = Math.max(this.replayElapsed + dt, (performance.now() - this.replayStartedAt) / 1000);
        const done = this.applyMatchReplay(elapsed - this.replayElapsed);
        this.replayElapsed = elapsed;
        if (done) this.finishReplay();
        else {
          this.publishTime += dt;
          if (this.publishTime >= 1 / 15) { this.publishTime = 0; this.emit(); }
        }
        return;
      }
      const playback = this.replay;
      if (!playback) {
        this.finishReplay();
        return;
      }
      // Active playback has a wall-clock cap, even when a slow host drops physics frames.
      this.replayElapsed = Math.max(
        this.replayElapsed + dt,
        (performance.now() - this.replayStartedAt) / 1000,
      );
      const sample = playback.sample(this.replayElapsed);
      this.applyReplaySample(sample);
      this.phaseTime = Math.max(0, playback.duration - this.replayElapsed);
      if (sample.done) this.finishReplay();
      else {
        this.publishTime += dt;
        const publishInterval =
          sample.remaining === 0 || this.state.replay!.fade ? 1 / 30 : 0.1;
        if (this.publishTime >= publishInterval) {
          this.publishTime = 0;
          this.emit();
        }
      }
      return;
    }
    if (phase === "goal" || phase === "out") {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) {
        if (phase === "goal") this.beginReplay();
        else this.beginServe();
      }
      return;
    }
    if (phase === "playing")
      for (const computer of this.computers) {
        const inputs = computer.update(dt, {
          ball: {
            position: this.physics.ball.translation(),
            velocity: this.physics.ball.linvel(),
          },
          rods: this.physics.rods
            .filter(
              (rod) =>
                rod.layout.team === computer.team &&
                computer.rodIds.includes(rod.layout.id),
            )
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
    this.physics.step(dt, this.settings.rotationDamping);
    for (const impact of this.physics.drainImpacts())
      this.sound(impact.kind, impact.strength);
    const pose = this.capturePose();
    this.recorder.record(dt, pose, this.physics.drainBallTouches());
    this.matchRecorder.record(dt, pose);
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (phase === "serving") {
      this.phaseTime -= dt;
      if (this.phaseTime <= 0) {
        this.state.phase = "playing";
        this.state.notice = "";
        this.emit();
      }
    }
    const position = this.physics.ball.translation();
    const scored = scoringTeam(position);
    if (scored) {
      this.state.scores[scored]++;
      this.matchRecorder.goal(scored, this.state.scores, pose);
      this.state.bumpAvailable = false;
      this.physics.neutralize();
      this.resetComputers();
      this.sound("goal");
      this.view.shake(0.35);
      this.updateCounters();
      this.replay = this.recorder.build();
      if (this.replay) {
        this.highlights.push(this.replay);
        // A legal first-to-ten match has at most nineteen goals.
        if (this.highlights.length > 19) this.highlights.shift();
      }
      this.recorder.clear();
      this.state.phase = "goal";
      this.state.scoringTeam = scored;
      this.state.notice = `Mål til ${this.clubs?.[scored].name || (scored === "red" ? "rødt hold" : "blåt hold")}!`;
      this.phaseTime = C.match.goalDuration;
      if (this.state.scores[scored] >= this.settings.goalsToWin) {
        this.postReplayPhase = "finished";
        this.state.winner = scored;
      } else {
        this.postReplayPhase = "serving";
        this.nextServeSide = scored === "red" ? -1 : 1;
      }
      this.emit();
      return;
    }
    if (isOutOfBounds(position)) {
      this.state.phase = "out";
      this.state.notice = "Bolden er ude";
      this.state.bumpAvailable = false;
      this.phaseTime = C.match.outDuration;
      this.nextServeSide = Math.random() < 0.5 ? -1 : 1;
      this.physics.neutralize();
      this.resetComputers();
      this.emit();
      return;
    }
    const bumpChanged = this.state.bumpAvailable !== this.canBump();
    this.state.bumpAvailable = this.canBump();
    this.state.bumpCooldown = Math.ceil(this.cooldown * 10) / 10;
    if (bumpChanged) this.emit();
    this.publishTime += dt;
    if (this.publishTime >= 0.1) {
      this.publishTime = 0;
      this.emit();
    }
  };
  private render = (dt: number) => {
    const pose = this.replayFrame ?? this.capturePose();
    const { position: ball, rotation } = pose.ball;
    this.view.table.ball.position.set(ball.x, ball.y, ball.z);
    this.view.table.ball.quaternion.set(
      rotation.x,
      rotation.y,
      rotation.z,
      rotation.w,
    );
    for (let i = 0; i < this.physics.rods.length; i++) {
      const state = pose.rods[i]!,
        rod = this.view.table.rods[i]!;
      rod.position.z = state.translation;
      rod.rotation.z = state.angle;
    }
    this.view.render(dt, this.state.phase, this.state.replay);
    this.frameTime += dt;
    if (
      this.onFrame &&
      // GameLoop already schedules these draws at the stream rate. A second
      // accumulator would discard valid short draws on 90/144 Hz displays.
      (this.renderFps <= C.rendering.tableStreamFps ||
        this.frameTime + 1e-9 >= 1 / C.rendering.tableStreamFps)
    ) {
      this.frameTime = Number.isFinite(this.frameTime)
        ? Math.max(
            0,
            this.frameTime -
              Math.floor((this.frameTime + 1e-9) * C.rendering.tableStreamFps) /
                C.rendering.tableStreamFps,
          )
        : 0;
      // Send the displayed pose, including replay and pause, rather than a second simulation.
      this.onFrame({
        sequence: ++this.frameSequence,
        time: performance.now(),
        epoch: this.frameEpoch,
        phase: this.state.phase,
        ball: { position: { ...ball }, rotation: { ...rotation } },
        rods: pose.rods.map((rod) => ({ ...rod })),
        kits: this.view.table.getKits(),
        scores: { ...(this.lobbyDemo?.scores ?? this.state.replay?.scores ?? this.state.scores) },
        goalsToWin: this.lobbyDemo ? LobbyDemo.goalsToWin : this.pointTarget,
        ...(this.view.captureCamera ? { camera: this.view.captureCamera() } : {}),
        ...(this.state.replay ? { replay: { ...this.state.replay, ...(this.state.replay.scores ? { scores: { ...this.state.replay.scores } } : {}) } } : {}),
      });
    }
  };
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.resetComputers();
    this.computers = [];
    this.lobbyDemo = null;
    this.highlights = [];
    this.replay = null;
    this.matchPlayback = null;
    this.matchPlaybackCut = -1;
    this.replayFrame = null;
    this.recorder.clear();
    this.matchRecorder.clear();
    this.audio.dispose();
    this.loop.dispose();
    document.removeEventListener("visibilitychange", this.visibility);
    this.physics.dispose();
    this.view.dispose();
  }
}
