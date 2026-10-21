/** Held Auth.js output only. The caller must finish its DB transaction BEFORE this
 * stage. No runtime publisher is configured in Sprint 2C.
 */
import {boundCookies,decodedClaims,effectiveSessionCookies,type Cookie,type Token} from './session-codec';
import {parseClaims,type Claims} from './persistent-session';
export type HeldResponse={status:number;cookies:Cookie[]};
export async function publishIssuedSession(input:{
  response:HeldResponse;
  expectedClaims:Claims; // Trusted result of committed issuance, never browser input.
  existingSessionCookies:Array<{name:string;value:string}>; // Complete trusted request snapshot.
  sessionCookieName:string;
  decodeIssued(cookies:Cookie[]):Promise<Token|null>; // Auth.js cookie reader; no manual crypto/chunking.
  publish(cookies:Cookie[]):Promise<void>; // Reviewed framework writer, one attempt only.
  now?:()=>number;
}):Promise<'PUBLISHED'|'SESSION_ISSUED_COOKIE_UNCONFIRMED'>{
  const now=input.now??Date.now;
  try{
    if(!Number.isInteger(input.response.status) || input.response.status<200 || input.response.status>=400) throw Error('AUTH_RESPONSE_REJECTED');
    const expected=parseClaims(input.expectedClaims);
    if(!expected)throw Error('ISSUANCE_BINDING_REQUIRED');
    // Clamp and validate descriptors before evaluating their ordered effects.
    const cookies=boundCookies(input.response.cookies,input.sessionCookieName,expected.expiresAt,now);
    const effective=effectiveSessionCookies(input.existingSessionCookies,cookies,input.sessionCookieName);
    const token=await input.decodeIssued(effective);
    const decoded=decodedClaims(token,now);
    if(!decoded || (Object.keys(expected) as Array<keyof Claims>).some(key=>decoded.claims[key]!==expected[key]))
      throw Error('ISSUED_TOKEN_MISMATCH');
    const bounded=boundCookies(cookies,input.sessionCookieName,Math.min(expected.expiresAt,decoded.exp*1000),now);
    if(!decodedClaims(token,now))throw Error('PUBLICATION_EXPIRED');
    await input.publish(bounded);
    return 'PUBLISHED';
  }catch{return 'SESSION_ISSUED_COOKIE_UNCONFIRMED';}
}
