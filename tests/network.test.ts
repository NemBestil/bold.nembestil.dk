import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, INITIAL_MATCH, type MatchSnapshot } from "../shared/types";
import { isClientEnvelope, isSettingsPatch, NETWORK_CONFIG } from "../network/MessageProtocol";
import { session, now } from "./helpers/seatSession";

const playing = () => ({ ...structuredClone(INITIAL_MATCH), phase: "playing" as const });
describe("authoritative controller-led session", () => {
  it("lets either controller end a paused match for everyone and start a new match", () => {
    const { manager, join, start, callbacks } = session();
    const first = join("red"), second = join("blue");
    start(first);
    manager.setMatch({ ...playing(), scores: { red: 2, blue: 1 } });
    expect(manager.handle(second.playerId, { type: "leave-match" }, now).code).toBe("inactive");
    manager.handle(second.playerId, { type: "pause", paused: true }, now);
    expect(manager.handle(second.playerId, { type: "leave-match" }, now).ok).toBe(true);
    expect(manager.state.match).toEqual(INITIAL_MATCH);
    expect(manager.state.players.filter(p => !p.computer).every(p => p.connected && !p.ready && !p.rematch)).toBe(true);
    expect(callbacks.onReset).toHaveBeenCalledOnce();
    expect(callbacks.onState.mock.lastCall?.[0].match.phase).toBe("lobby");
    expect(start(first).ok).toBe(true);
    expect(callbacks.onStart).toHaveBeenCalledTimes(2);
  });
  it("admits four phones without a host setting and rejects a fifth", () => {
    const {manager,join}=session();
    for(let i=0;i<4;i++) expect(join().playerId).toBeTruthy();
    expect(manager.admit(undefined,now)).toMatchObject({code:"full"});
    expect(manager.state.players.filter(p=>!p.computer)).toHaveLength(4);
  });
  it("does not start from readiness votes; only the first controller starts", () => {
    const {manager,join,start,callbacks}=session();
    const first=join("red"), second=join("blue");
    manager.handle(first.playerId,{type:"set-ready",ready:true},now);
    manager.handle(second.playerId,{type:"set-ready",ready:true},now);
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(start(second)).toMatchObject({code:"admin-only"});
    expect(start(first).ok).toBe(true);
    expect(callbacks.onStart).toHaveBeenCalledOnce();
    expect(start(first)).toMatchObject({code:"inactive"});
  });
  it("requires each connected phone to select a role before starting", () => {
    const {manager,join,start}=session(); const first=join("red"),second=join();
    expect(start(first)).toMatchObject({code:"incomplete"});
    manager.handle(second.playerId,{type:"reserve-seat",team:"blue",role:"attack"},now);
    expect(start(first).ok).toBe(true);
  });
  it("protects match rules and rejects shared graphics or forced roster edits", () => {
    const {manager,join}=session(); const first=join("red"),second=join("blue");
    expect(manager.handle(second.playerId,{type:"update-settings",settings:{goalsToWin:10}},now)).toMatchObject({code:"admin-only"});
    expect(manager.handle(first.playerId,{type:"update-settings",settings:{goalsToWin:10,rotationDamping:2.2,bumpStrength:.2}},now).ok).toBe(true);
    expect(manager.state.settings).toMatchObject({goalsToWin:10,rotationDamping:2.2,bumpStrength:.2});
    for(const settings of [{graphics:"low"},{playerCount:1},{teamControls:{red:{computer:"full",level:"normal"},blue:{computer:"full",level:"normal"}}}])
      expect(manager.handle(first.playerId,{type:"update-settings",settings},now).ok).toBe(false);
  });
  it("shares the captain's ball speed setting while retaining the internal physics defaults", () => {
    const { manager, join, start, callbacks } = session();
    const first = join("red"), second = join("blue");
    expect(manager.state.settings.ballSpeed).toBe(1);
    expect(manager.handle(second.playerId, { type: "update-settings", settings: { ballSpeed: 2 } }, now).code).toBe("admin-only");
    expect(manager.handle(first.playerId, { type: "update-settings", settings: { ballSpeed: 2 } }, now).ok).toBe(true);
    expect(manager.state.settings).toMatchObject({
      ballSpeed: 2,
      rotationDamping: DEFAULT_SETTINGS.rotationDamping,
      bumpStrength: DEFAULT_SETTINGS.bumpStrength,
    });
    start(first);
    expect(callbacks.onStart.mock.lastCall?.[0].ballSpeed).toBe(2);
    expect(manager.handle(first.playerId, { type: "update-settings", settings: { ballSpeed: 0.5 } }, now).code).toBe("locked");
    manager.setMatch({ ...playing(), phase: "paused" });
    expect(manager.handle(first.playerId, { type: "update-settings", settings: { ballSpeed: 0.5 } }, now).ok).toBe(true);
    expect(manager.state.settings.ballSpeed).toBe(0.5);
  });
  it("protects rod ownership, sequence ordering and immediate flick releases", () => {
    const {manager,join,start,callbacks}=session(); const first=join("red"),second=join("red","attack"); start(first); manager.setMatch(playing());
    const input={type:"rod-input",rodId:2,sequence:1,translation:.6,angularVelocity:20,active:false,flick:true};
    expect(manager.handle(first.playerId,input,now)).toMatchObject({code:"rod-not-owned"});
    expect(manager.handle(second.playerId,input,now).ok).toBe(true);
    expect(callbacks.onInput).toHaveBeenLastCalledWith("red",expect.objectContaining({rodId:2,flick:true}));
    expect(manager.handle(second.playerId,input,now)).toMatchObject({code:"stale-input"});
    expect(isClientEnvelope({...input,team:"blue"})).toBe(false);
  });
  it("pauses on disconnect, reserves the exact rods and authenticates a reconnect", () => {
    const {manager,join,start,callbacks}=session(); const first=join("red"),second=join("blue","attack"); start(first); manager.setMatch(playing());
    manager.disconnect(second.playerId,now+10);
    expect(callbacks.onPause).toHaveBeenCalledOnce();
    expect(manager.admit('forged',now+20)).toMatchObject({code:"invalid-token"});
    expect(manager.admit(second.token,now+20)).toMatchObject({reconnected:true,playerId:second.playerId});
    expect(manager.state.players.find(p=>p.id===second.playerId)?.rodIds).toEqual([2,3]);
    expect(manager.handle(second.playerId,{type:"pause",paused:false},now+30)).toMatchObject({code:"admin-only"});
    expect(manager.handle(first.playerId,{type:"pause",paused:false},now+30).ok).toBe(true);
    expect(callbacks.onResume).toHaveBeenCalledOnce();
  });
  it("cancels an opening countdown if a selected player disconnects", () => {
    const {manager,join,start,callbacks}=session();const first=join("red"),second=join("blue");start(first);manager.disconnect(second.playerId,now+1);
    expect(manager.state.match.phase).toBe("lobby");expect(callbacks.onReset).toHaveBeenCalledOnce();
  });
  it("transfers administration and expires a disconnected lobby reservation without moving its teammate", () => {
    const {manager,join}=session();const first=join("red"),second=join("red","attack");manager.disconnect(first.playerId,now);
    expect(manager.state.players.find(p=>p.id===second.playerId)?.admin).toBe(true);
    manager.touch(second.playerId,now+NETWORK_CONFIG.lobbyReservationTimeout);
    manager.expire(now+NETWORK_CONFIG.lobbyReservationTimeout);
    expect(manager.state.players.find(p=>p.id===second.playerId)?.rodIds).toEqual([2,3]);
    expect(manager.admit(first.token,now+NETWORK_CONFIG.lobbyReservationTimeout)).toMatchObject({code:"invalid-token"});
    expect(manager.state.players.find(p=>p.computer&&p.team==="red")?.rodIds).toEqual([0,1]);
  });
  it("pauses when a remote heartbeat expires",()=>{const {manager,join,start,callbacks}=session();const first=join("red"),second=join("blue");start(first);manager.setMatch(playing());manager.touch(first.playerId,now+NETWORK_CONFIG.heartbeatTimeout+1);manager.expire(now+NETWORK_CONFIG.heartbeatTimeout+1);expect(manager.state.players.find(p=>p.id===second.playerId)?.connected).toBe(false);expect(callbacks.onPause).toHaveBeenCalledOnce();});
  it("uses the shared bump cooldown without checking whether the ball is stuck",()=>{const {manager,join,start,callbacks}=session();const first=join("red");start(first);manager.setMatch({...playing(),bumpAvailable:true});expect(manager.handle(first.playerId,{type:"table-bump",sequence:1},now).ok).toBe(true);expect(callbacks.onBump).toHaveBeenCalledWith("red");expect(manager.handle(first.playerId,{type:"table-bump",sequence:1},now).code).toBe("stale-input");manager.setMatch({...playing(),bumpAvailable:true,bumpCooldown:2});expect(manager.handle(first.playerId,{type:"table-bump",sequence:2},now).code).toBe("bump-unavailable");});
  it("retains human rematch votes and returns to the lobby for a new setup",()=>{const {manager,join,start,callbacks}=session();const first=join("red"),second=join("blue");start(first);manager.setMatch({...playing(),phase:"finished",winner:"red"});manager.handle(first.playerId,{type:"rematch"},now);expect(callbacks.onStart).toHaveBeenCalledTimes(1);manager.handle(second.playerId,{type:"rematch"},now);expect(callbacks.onStart).toHaveBeenCalledTimes(2);manager.setMatch({...playing(),phase:"finished"});manager.handle(first.playerId,{type:"new-match"},now);expect(manager.state.match.phase).toBe("lobby");expect(callbacks.onReset).toHaveBeenCalledOnce();});
  it("returns detached snapshots",()=>{const {manager,join}=session();join("red");const snapshot=manager.state;snapshot.settings.goalsToWin=999;snapshot.players.length=0;expect(manager.state.settings.goalsToWin).toBe(5);expect(manager.state.players.length).toBeGreaterThan(0);});
});

describe("controller departures after the final goal", () => {
  const finalMatch: MatchSnapshot = {
    ...playing(),
    scores: { red: 5, blue: 2 },
    winner: "red",
    notice: "Rødt hold vinder!",
  };
  const archivedReplay: NonNullable<MatchSnapshot["replay"]> = {
    progress: 0.4,
    slowMotion: true,
    fullMatch: true,
    mode: "highlights",
    playing: true,
    time: 42,
    duration: 100,
    goalIndex: 3,
    goalCount: 7,
    scores: { red: 2, blue: 1 },
  };
  const completedStates: { label: string; match: MatchSnapshot }[] = [
    { label: "finished result", match: { ...finalMatch, phase: "finished" } },
    { label: "finished phase without a winner", match: { ...finalMatch, phase: "finished", winner: null } },
    { label: "winning goal celebration", match: { ...finalMatch, phase: "goal", scoringTeam: "red", notice: "Mål til rødt hold!" } },
    { label: "winning goal replay", match: { ...finalMatch, phase: "replay", replay: { progress: 0.4, slowMotion: true } } },
    { label: "post-match highlights", match: { ...finalMatch, phase: "replay", replay: archivedReplay, notice: "Mål 3/7" } },
    { label: "full match replay", match: { ...finalMatch, phase: "replay", replay: { ...archivedReplay, mode: "full", slowMotion: false }, notice: "Hele kampen" } },
    { label: "stopped replay playback", match: { ...finalMatch, phase: "replay", replay: { ...archivedReplay, playing: false }, notice: "Mål 3/7" } },
    { label: "globally paused archived replay", match: { ...finalMatch, phase: "paused", replay: archivedReplay, notice: "Pause" } },
    { label: "completed replay resume countdown", match: { ...finalMatch, phase: "countdown", replay: archivedReplay, countdown: 2, notice: "Fortsætter om 2" } },
  ];

  it.each(completedStates.flatMap(state => (["close", "heartbeat"] as const).map(cause => ({ ...state, cause }))))(
    "preserves $label after a controller $cause and reconnect",
    ({ match, cause }) => {
      const { manager, join, start, callbacks } = session();
      const first = join("red"), second = join("blue", "attack");
      start(first);
      manager.setMatch(playing());
      manager.setMatch(match);
      callbacks.onState.mockClear();
      callbacks.onInput.mockClear();
      const disconnectedAt = now + NETWORK_CONFIG.heartbeatTimeout + 1;
      manager.touch(first.playerId, disconnectedAt);

      if (cause === "close") manager.disconnect(second.playerId, disconnectedAt);
      else manager.expire(disconnectedAt);

      expect(manager.state.match).toEqual(match);
      expect(manager.state.players.find(p => p.id === second.playerId)).toMatchObject({
        connected: false,
        ready: false,
        team: "blue",
        rodIds: [2, 3],
      });
      expect(callbacks.onState).toHaveBeenCalledOnce();
      expect(callbacks.onState.mock.lastCall?.[0].match).toEqual(match);
      expect(callbacks.onPause).not.toHaveBeenCalled();
      expect(callbacks.onResume).not.toHaveBeenCalled();
      expect(callbacks.onReset).not.toHaveBeenCalled();
      expect(callbacks.onInput).not.toHaveBeenCalled();
      manager.disconnect(second.playerId, disconnectedAt + 1);
      expect(callbacks.onState).toHaveBeenCalledOnce();

      expect(manager.admit(second.token, disconnectedAt + 2)).toMatchObject({
        reconnected: true,
        playerId: second.playerId,
      });
      expect(manager.state.match).toEqual(match);
      expect(manager.state.players.find(p => p.id === second.playerId)?.connected).toBe(true);
    },
  );

  it("clears a previous live reconnect notice when a completed replay arrives", () => {
    const { manager, join, start, callbacks } = session();
    const first = join("red"), second = join("blue");
    start(first);
    manager.setMatch(playing());
    manager.disconnect(second.playerId, now + 1);
    expect(callbacks.onPause).toHaveBeenCalledOnce();

    const pausedReplay: MatchSnapshot = { ...finalMatch, phase: "paused", replay: archivedReplay, notice: "Pause i kampens replay" };
    manager.setMatch(pausedReplay);
    expect(manager.state.match).toEqual(pausedReplay);
    manager.setMatch({ ...pausedReplay, replay: { ...archivedReplay, time: 50 } });
    expect(manager.state.match.notice).toBe(pausedReplay.notice);
  });
});

describe("network protocol validation", () => {
  it.each([0.5, 1, 1.3, 2])("accepts a ball speed multiplier of %s", ballSpeed => {
    expect(isSettingsPatch({ ballSpeed })).toBe(true);
    expect(isClientEnvelope({ type: "update-settings", settings: { ballSpeed } })).toBe(true);
  });
  it.each([0.499, 2.001, 0, -1, NaN, Infinity, -Infinity, null, "1"])("rejects an invalid ball speed multiplier of %s", ballSpeed => {
    expect(isSettingsPatch({ ballSpeed })).toBe(false);
    const { manager, join } = session();
    const first = join("red");
    expect(manager.handle(first.playerId, { type: "update-settings", settings: { ballSpeed } }, now).code).toBe("invalid-message");
    expect(manager.state.settings.ballSpeed).toBe(1);
  });
  it.each([
    null,
    [],
    "hello",
    { type: "delete-session" },
    { type: "hello", version: 0 },
    { type: "hello", version: 1 },
    { type: "hello", version: 2 },
    { type: "table-bump", sequence: -1 },
    {
      type: "rod-input",
      rodId: 0,
      sequence: 1,
      translation: NaN,
      angularVelocity: 0,
      active: true,
    },
    {
      type: "rod-input",
      rodId: 0,
      sequence: 1,
      translation: 0,
      angularVelocity: Infinity,
      active: true,
    },
    {
      type: "rod-input",
      rodId: 0,
      sequence: 1,
      translation: 0,
      angularVelocity: 36,
      active: true,
    },
    { type: "update-settings", settings: { goalsToWin: 999 } },
    { type: "update-settings", settings: { physics: "off" } },
    { type: "update-settings", settings: {} },
  ])("rejects malformed/unbounded data: %j", (value) => {
    expect(isClientEnvelope(value)).toBe(false);
  });
});
