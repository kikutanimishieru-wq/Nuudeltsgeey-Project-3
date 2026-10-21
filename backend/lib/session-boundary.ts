import {parseClaims,publicSession,validateSession,revokeSession,type SessionStore} from './persistent-session';
import {decodedClaims,type Token,type Cookie} from './session-codec';
export interface SessionBoundaryDependencies {
  store:SessionStore;
  sessionCookieName:string;
  decodeCookie(request:Request):Promise<Token|null>; // Cookie only, configured name/salt/chunk handling; no Bearer fallback.
  clearCookie(request:Request):Promise<Cookie[]>; // Private raw Auth.js result, held before publication.
  now?:()=>number;
}
export function sessionBoundary(deps:SessionBoundaryDependencies) {
  const now=deps.now??Date.now;
  async function read(request:Request) {
    let token:Token|null;
    try {token=await deps.decodeCookie(request);} catch {return {status:401,body:{error:'SESSION_INVALID'},cookies:[] as Cookie[]};}
    if (!token) return {status:200,body:null,cookies:[] as Cookie[]};
    if (token.authProtocol!==1 && !('sessionCore' in token)) return {status:409,body:{error:'LEGACY_SESSION'},cookies:[] as Cookie[]};
    const decoded=decodedClaims(token,now);
    if (!decoded) return {status:401,body:{error:'SESSION_INVALID_OR_EXPIRED'},cookies:[] as Cookie[]};
    const result=await validateSession(deps.store,decoded.claims);
    if (result.status==='UNAVAILABLE') return {status:503,body:{error:'SESSION_REGISTRY_UNAVAILABLE'},cookies:[] as Cookie[]};
    if (result.status!=='VALID') return {status:401,body:{error:'SESSION_'+result.status},cookies:[] as Cookie[]};
    if (!decodedClaims(token,now)) return {status:401,body:{error:'SESSION_EXPIRED'},cookies:[] as Cookie[]};
    return {status:200,body:publicSession(result,decoded.exp),cookies:[] as Cookie[]};
  }
  async function logout(request:Request) {
    let token:Token|null;
    try {token=await deps.decodeCookie(request);} catch {return {status:401,body:{status:'INVALID_COOKIE_NO_DURABLE_REVOCATION'},cookies:[] as Cookie[]};}
    // Runtime supplies an approved legacy policy; no versioned downgrade.
    if (!token || token.authProtocol!==1 && !('sessionCore' in token)) return {status:409,body:{status:'LEGACY_LOGOUT_POLICY_REQUIRED'},cookies:[] as Cookie[]};
    const claims=parseClaims(token.sessionCore);
    if (token.authProtocol!==1 || !claims) return {status:401,body:{status:'SESSION_INVALID'},cookies:[] as Cookie[]};
    const result=await revokeSession(deps.store,claims);
    if (result==='UNCONFIRMED') return {status:503,body:{status:'REVOCATION_UNCONFIRMED'},cookies:[] as Cookie[]};
    if (result==='INVALID') return {status:401,body:{status:'SESSION_REGISTRY_MISSING_OR_MISMATCHED'},cookies:[] as Cookie[]};
    try {const cookies=await deps.clearCookie(request);
      if (!cookies.length || cookies.some(c=>c.value!=='' || c.options.maxAge!==0 || c.options.path!=='/'
        || !(c.name===deps.sessionCookieName || c.name.startsWith(deps.sessionCookieName+'.') && /^\d+$/.test(c.name.slice(deps.sessionCookieName.length+1))))) throw Error('CLEAR_UNCONFIRMED');
      return {status:200,body:{status:result==='EXPIRED'?'EXPIRED_LOCAL_COOKIE_CLEARED':'SESSION_REVOKED'},cookies};
    } catch {return {status:503,body:{status:result==='EXPIRED'?'EXPIRED_COOKIE_CLEAR_UNCONFIRMED':'SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED'},cookies:[] as Cookie[]};}
  }
  async function dispatch(request:Request) {
    const path=new URL(request.url).pathname;
    if (path==='/api/auth/session' && ['GET','POST'].includes(request.method)) return read(request);
    if (['/api/auth/logout','/api/auth/signout'].includes(path)) {
      if (request.method==='POST') return logout(request);
      return {status:405,body:{error:'POST_REQUIRED'},cookies:[] as Cookie[]};
    }
    return {status:400,body:{error:'UNSUPPORTED_AUTH_ACTION'},cookies:[] as Cookie[]};
  }
  return {read,logout,dispatch};
}
