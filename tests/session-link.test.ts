import {describe,expect,it} from 'vitest';
import {sessionIdFromQuery,sessionLink} from '../app/utils/sessionLink';
import {isMobileControllerDevice,joinSessionFromLink} from '../app/utils/touchStart';
const id='nf-12345678-1234-4234-8234-123456789abc';
describe('session invitation links',()=>{
  it('creates a session URL for QR codes, copying and phone joining',()=>{
    const link=sessionLink('https://bold.nembestil.dk','/',id);
    expect(link).toBe(`https://bold.nembestil.dk/?session=${id}`);
    expect(joinSessionFromLink(link)).toBe(id);
    expect(sessionIdFromQuery(new URL(link).searchParams.get('session'))).toBe(id);
  });
  it.each([undefined,'bad-session',['nf-forged'],'nf-'+ 'a'.repeat(300)])('rejects invalid incoming session IDs: %j',value=>expect(sessionIdFromQuery(value)).toBe(''));
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)',10,false],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)',0,false],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS)',5,true],
    ['Mozilla/5.0 (Linux; Android 15)',5,true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X)',5,true],
  ] as const)('routes %s with %i touch points to mobile=%s',(agent,points,expected)=>expect(isMobileControllerDevice(agent,points)).toBe(expected));
});
