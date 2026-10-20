import {describe,expect,it} from "vitest";
import {INITIAL_MATCH} from "../shared/types";
import {isClientEnvelope,NETWORK_CONFIG} from "../network/MessageProtocol";
import {computerAssignments} from "../shared/matchSettings";
import {session,now} from "./helpers/seatSession";

describe("explicit multiplayer seats",()=>{
  it.each([1,2,3,4])("starts with %i human seats and automatically fills the rest",count=>{
    const {manager,join,start,callbacks}=session();
    const seats=[['red','defense'],['red','attack'],['blue','defense'],['blue','attack']] as const;
    const players=seats.slice(0,count).map(([team,role])=>join(team,role));
    expect(start(players[0]!).ok).toBe(true);
    const roster=manager.state.players;
    expect(roster.filter(p=>!p.computer)).toHaveLength(count);
    for(const team of ['red','blue'] as const){
      const all=roster.filter(p=>p.team===team).flatMap(p=>p.rodIds);
      expect(all.sort()).toEqual([0,1,2,3]);
    }
    expect(callbacks.onStart).toHaveBeenCalledOnce();
  });
  it("takes both halves by explicit choice and never steals or reallocates another phone's rods",()=>{
    const {manager,join}=session();const first=join('red'),second=join();
    expect(manager.handle(first.playerId,{type:'reserve-seat',team:'red',role:'attack'},now).ok).toBe(true);
    expect(manager.state.players.find(p=>p.id===first.playerId)?.rodIds).toEqual([0,1,2,3]);
    expect(manager.handle(second.playerId,{type:'reserve-seat',team:'red',role:'attack'},now).code).toBe('seat-taken');
    manager.handle(first.playerId,{type:'reserve-seat',team:'red',role:'attack'},now);
    expect(manager.handle(second.playerId,{type:'reserve-seat',team:'red',role:'attack'},now).ok).toBe(true);
    expect(manager.state.players.find(p=>p.id===first.playerId)?.rodIds).toEqual([0,1]);
  });
  it("rejects further admissions when two phones have deliberately taken all four roles",()=>{
    const {manager,join}=session();const red=join('red'),blue=join('blue');
    manager.handle(red.playerId,{type:'reserve-seat',team:'red',role:'attack'},now);
    manager.handle(blue.playerId,{type:'reserve-seat',team:'blue',role:'attack'},now);
    expect(manager.admit(undefined,now)).toMatchObject({code:'full'});
    expect(manager.state.players.filter(p=>!p.computer)).toHaveLength(2);
  });
  it("atomically rejects contested team switches while keeping the old seat",()=>{
    const {manager,join}=session();const first=join('red'),second=join('blue');
    expect(manager.handle(first.playerId,{type:'reserve-seat',team:'blue',role:'defense'},now).code).toBe('seat-taken');
    expect(manager.state.players.find(p=>p.id===first.playerId)?.team).toBe('red');
    expect(manager.handle(first.playerId,{type:'reserve-seat',team:'blue',role:'attack'},now).ok).toBe(true);
    expect(manager.state.players.find(p=>p.id===first.playerId)?.rodIds).toEqual([2,3]);
  });
  it("gives the first person to choose a side its name, even when another phone joined earlier",()=>{
    const {manager,join}=session();const admin=join(),captain=join('red');
    manager.handle(admin.playerId,{type:'reserve-seat',team:'red',role:'attack'},now);
    expect(manager.state.players.find(p=>p.id===captain.playerId)?.teamCaptain).toBe(true);
    expect(manager.handle(admin.playerId,{type:'team-name',name:'Tidlig telefon'},now).code).toBe('captain-only');
    expect(manager.handle(captain.playerId,{type:'team-name',name:'Første på holdet'},now).ok).toBe(true);
    expect(manager.state.teamNames.red).toBe('Første på holdet');
  });
  it("defaults to red and blue names and can restore the default after a custom name",()=>{
    const {manager,join,start}=session();const player=join('red');
    expect(manager.state.players.find(p=>p.id===player.playerId)).toMatchObject({teamCaptain:true});
    expect(manager.state.teamNames).toEqual({red:'Rød',blue:'Blå'});
    manager.handle(player.playerId,{type:'team-name',name:'Hjemmeholdet'},now);
    expect(manager.state.teamNames.red).toBe('Hjemmeholdet');
    manager.handle(player.playerId,{type:'team-name',name:'   '},now);
    expect(manager.state.teamNames.red).toBe('Rød');
    expect(start(player).ok).toBe(true);
  });
  it("does not allow role edits after kickoff",()=>{const {manager,join,start}=session();const player=join('red');start(player);expect(manager.handle(player.playerId,{type:'reserve-seat',team:'blue',role:'attack'},now).code).toBe('locked');});
  it("retains the exact role after a reconnect and gives expired space to a computer",()=>{
    const {manager,join}=session();const first=join('red'),second=join('red','attack');manager.disconnect(first.playerId,now);
    expect(manager.admit(first.token,now+1)).toMatchObject({reconnected:true});
    expect(manager.state.players.find(p=>p.id===first.playerId)?.rodIds).toEqual([0,1]);
    manager.disconnect(first.playerId,now+2);manager.touch(second.playerId,now+20_000);manager.expire(now+20_000);
    expect(manager.state.players.find(p=>p.id===second.playerId)?.rodIds).toEqual([2,3]);
    expect(computerAssignments(manager.state.settings).find(p=>p.team==='red')?.rodIds).toEqual([0,1]);
  });
});

describe("multiplayer protocol trust boundary", () => {
  it.each([
    { active: true, flick: true, rotationOnly: true },
    { active: true, rotationOnly: true },
    { active: false, rotationOnly: true },
    { active: false, flick: false, rotationOnly: true },
    { active: false, flick: true, rotationOnly: "yes" },
  ])(
    "rejects rotation-only flags outside an intentional inactive flick: %j",
    (flags) => {
      expect(
        isClientEnvelope({
          type: "rod-input",
          sequence: 1,
          rodId: 0,
          translation: 0,
          angularVelocity: 20,
          ...flags,
        }),
      ).toBe(false);
    },
  );
  it.each([
    { type: "update-settings", settings: { playerCount: -1 } },
    { type: "update-settings", settings: { playerCount: 2.5 } },
    { type: "update-settings", settings: { computerOpponent: "expert" } },
    {
      type: "rod-input",
      sequence: 1,
      rodId: 0,
      translation: 0,
      angularVelocity: 10,
      active: true,
      flick: true,
    },
    {
      type: "rod-input",
      sequence: 1,
      rodId: 0,
      translation: 0,
      angularVelocity: 10,
      active: false,
      flick: "yes",
    },
    {
      type: "rod-input",
      sequence: 1,
      rodId: 0,
      translation: 0,
      angularVelocity: 10,
      active: false,
      rodIds: [0, 1],
    },
  ])("rejects forged mode/role/flick data %j", (message) =>
    expect(isClientEnvelope(message)).toBe(false),
  );

  it("accepts a bounded inactive flick and explicit player/AI settings", () => {
    expect(
      isClientEnvelope({
        type: "rod-input",
        sequence: 1,
        rodId: 0,
        translation: 1,
        angularVelocity: -35,
        active: false,
        flick: true,
        rotationOnly: true,
      }),
    ).toBe(true);
    expect(
      isClientEnvelope({
        type: "update-settings",
        settings: { playerCount: 2, computerOpponent: "advanced" },
      }),
    ).toBe(true);
  });
});
