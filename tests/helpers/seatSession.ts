import { vi } from 'vitest';
import { SessionManager, type Admission } from '../../network/SessionManager';
import type { FootballClub, SeatRole, Team } from '../../shared/types';
export const firstClub: FootballClub = { id:'home', name:'Home FC', country:'Danmark', primaryColor:'#ff0000', secondaryColor:'#ffffff' };
export const secondClub: FootballClub = { ...firstClub, id:'away', name:'Away FC', primaryColor:'#0000ff' };
export const now = 100_000;
export function session() {
  let next = 0;
  const callbacks = { onState:vi.fn(), onStart:vi.fn(), onInput:vi.fn(), onBump:vi.fn(), onPause:vi.fn(), onResume:vi.fn(), onReset:vi.fn() };
  const manager = new SessionManager('test', callbacks, () => `id-${++next}`);
  function join(team?:Team, role:SeatRole='defense') {
    const player = manager.admit(undefined,now) as Admission;
    if (team) manager.handle(player.playerId, {type:'reserve-seat',team,role},now);
    return player;
  }
  const start = (player:Admission) => manager.handle(player.playerId,{type:'start-match'},now);
  return {manager,callbacks,join,start};
}
