/** Private Auth.js dependency boundary. No public raw sign-out or cookie writer. */
import {getToken,encode,decode} from 'next-auth/jwt';
import {cookies} from 'next/headers';
import {applicationOrigin} from './request-security';
import {sessionBoundary} from './session-boundary';
import {unavailableSessionStore} from './session-runtime';
import {encodeAbsolute,type Cookie,type Token} from './session-codec';
import {SecurityError} from './security-error';
export const authJsCrypto={
  encode:async(p:Parameters<typeof encode>[0])=>encode(p),
  decode:async(p:Parameters<typeof decode>[0])=>decode(p) as Promise<Token|null>,
};
export async function encodeVersioned(token:Token,secret:string|string[],salt:string){
  return encodeAbsolute(authJsCrypto,token,secret,salt);
}
export async function cookieToken(request:Request):Promise<Token|null>{
  const secure=applicationOrigin().startsWith('https:');
  // Deliberately omit Authorization; getToken's Bearer fallback cannot authorize a browser session.
  return getToken({req:{headers:new Headers({cookie:request.headers.get('cookie')??''})},secret:process.env.AUTH_SECRET,
    cookieName:secure?'__Secure-authjs.session-token':'authjs.session-token',secureCookie:secure,
    salt:secure?'__Secure-authjs.session-token':'authjs.session-token'}) as Promise<Token|null>;
}
export async function currentRequest(){
  const jar=await cookies();
  return new Request(applicationOrigin()+'/api/auth/session',{headers:{cookie:jar.getAll().map(c=>`${c.name}=${c.value}`).join('; ')}});
}
export function versioned(token:Token|null){return Boolean(token && ('authProtocol' in token || 'sessionCore' in token));}
export function runtimeBoundary(){return sessionBoundary({store:unavailableSessionStore,sessionCookieName:applicationOrigin().startsWith('https:')?'__Secure-authjs.session-token':'authjs.session-token',decodeCookie:cookieToken,
  // Raw core cookie publication is NOT enabled before schema/client and adapter review.
  async clearCookie():Promise<Cookie[]>{throw new SecurityError('SESSION_COOKIE_ADAPTER_REQUIRED',503);}});}
export function boundaryResponse(result:{status:number;body:unknown;cookies:Cookie[]}){
  if(result.cookies.length)throw new SecurityError('SESSION_COOKIE_ADAPTER_REQUIRED',503);
  return Response.json(result.body,{status:result.status,headers:{'Cache-Control':'no-store'}});
}
