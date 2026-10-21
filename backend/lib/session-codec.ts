/** Adapter algorithms; encryption and chunking remain Auth.js's responsibility. */
import { parseClaims, type Claims } from './persistent-session';
export type Token = Record<string,unknown>;
export type CryptoBoundary = { encode(input: {token:Token;maxAge:number;secret:string|string[];salt:string}):Promise<string>; decode(input:{token:string;secret:string|string[];salt:string}):Promise<Token|null> };
export async function encodeAbsolute(crypto:CryptoBoundary, token:Token, secret:string|string[],salt:string, now=Date.now):Promise<string> {
  const claims=parseClaims(token.sessionCore);
  if (!claims || token.authProtocol !== 1 || now()<claims.authenticatedAt) throw Error('INVALID_SESSION_CLAIMS');
  const remaining=Math.floor(claims.expiresAt/1000)-Math.floor(now()/1000)-1;
  if (remaining<=0) throw Error('SESSION_EXPIRED');
  const encoded=await crypto.encode({token,maxAge:remaining,secret,salt});
  const result=await crypto.decode({token:encoded,secret,salt});
  const actual=parseClaims(result?.sessionCore);
  if (!actual || result?.authProtocol!==1 || (Object.keys(claims) as Array<keyof Claims>).some(key=>actual[key]!==claims[key])
    || typeof result.exp!=='number' || !Number.isSafeInteger(result.exp) || result.exp>Math.floor(claims.expiresAt/1000)
    || now()>=result.exp*1000 || now()>=claims.expiresAt) throw Error('ENCODED_AUTHORITY_INVALID');
  return encoded;
}
export function decodedClaims(token:Token|null, now=Date.now):{claims:Claims;exp:number}|null {
  const c=parseClaims(token?.sessionCore); const exp=token?.exp;
  if (!c || token?.authProtocol!==1 || typeof exp!=='number' || !Number.isSafeInteger(exp)
    || exp>Math.floor(c.expiresAt/1000) || now()<c.authenticatedAt || now()>=exp*1000 || now()>=c.expiresAt) return null;
  return {claims:c,exp};
}
export type Cookie = {name:string;value:string;options:Record<string,unknown>};
export function boundCookies(cookies:Cookie[], sessionName:string, expiresAt:number, now=Date.now):Cookie[] {
  if (!Number.isSafeInteger(expiresAt) || now()>=expiresAt) throw Error('COOKIE_DEADLINE_INVALID');
  return cookies.map(c=>{
    const session=c.name===sessionName || c.name.startsWith(sessionName+'.');
    if (!session) return {...c,options:{...c.options}};
    if (c.name!==sessionName && !/^\d+$/.test(c.name.slice(sessionName.length+1))) throw Error('COOKIE_CHUNK_INVALID');
    const options={...c.options};
    if (c.value==='' && options.maxAge===0) {
      if(options.path!=='/' || options.domain!==undefined) throw Error('COOKIE_DELETION_SCOPE_INVALID');
      return {...c,options};
    }
    if (options.httpOnly!==true || !['lax','strict','none'].includes(String(options.sameSite).toLowerCase())
      || typeof options.secure!=='boolean' || options.path!=='/' || options.domain!==undefined
      || sessionName.startsWith('__Secure-') && options.secure!==true) throw Error('COOKIE_POLICY_INVALID');
    const existing=options.expires;
    if (!(existing instanceof Date) || !Number.isFinite(existing.getTime()) || existing.getTime()<=now()) throw Error('COOKIE_EXPIRY_INVALID');
    options.expires=new Date(Math.min(existing.getTime(),expiresAt));
    if (options.maxAge!==undefined && (typeof options.maxAge!=='number' || options.maxAge<=0)) throw Error('COOKIE_MAX_AGE_INVALID');
    delete options.maxAge;
    return {...c,options};
  });
}

/** Apply ordered descriptors to the trusted incoming cookie snapshot. No crypto or
 * manual token concatenation: the reviewed Auth.js reader still decodes the result.
 * Every surviving session cookie must come from this response, never stale input.
 */
export function effectiveSessionCookies(existing:Array<{name:string;value:string}>, descriptors:Cookie[], sessionName:string):Cookie[] {
  const isSession=(name:string)=>name===sessionName || name.startsWith(sessionName+'.');
  const validName=(name:string)=>name===sessionName || /^(0|[1-9][0-9]*)$/.test(name.slice(sessionName.length+1));
  const state=new Map<string,Cookie>();
  const written=new Set<string>();
  for(const c of existing){
    if(!isSession(c.name) || !validName(c.name) || !c.value || state.has(c.name)) throw Error('COOKIE_SNAPSHOT_INVALID');
    state.set(c.name,{...c,options:{}});
  }
  for(const c of descriptors){
    if(!isSession(c.name))continue;
    if(!validName(c.name))throw Error('COOKIE_CHUNK_INVALID');
    if(c.value==='' && c.options.maxAge===0){state.delete(c.name);written.delete(c.name);}
    else {
      if(!c.value || c.options.maxAge===0)throw Error('COOKIE_STATE_INVALID');
      state.set(c.name,c);written.add(c.name);
    }
  }
  const result=[...state.values()];
  if(!result.length || result.some(c=>!written.has(c.name)))throw Error('COOKIE_MISSING_OR_STALE');
  if(state.has(sessionName)){
    if(result.length!==1)throw Error('COOKIE_REPRESENTATION_CONFLICT');
    return result;
  }
  result.sort((a,b)=>Number(a.name.slice(sessionName.length+1))-Number(b.name.slice(sessionName.length+1)));
  if(result.some((c,i)=>c.name!==sessionName+'.'+i))throw Error('COOKIE_CHUNK_GAP');
  return result;
}
