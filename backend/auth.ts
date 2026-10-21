import { persistentSessionsEnabled, sessionTransactionAdapter } from '@/lib/session-runtime';
import { issueSession, type Claims } from '@/lib/persistent-session';
import { cookieToken, currentRequest, versioned, runtimeBoundary, boundaryResponse, encodeVersioned, authJsCrypto } from '@/lib/session-auth-adapter';
import { SecurityError } from '@/lib/security-error';
import { assertPublicAuthSchema } from '@/lib/discord-accounts';
import NextAuth, { type Session } from 'next-auth';
import { NextRequest } from 'next/server';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { consumeLoginGrant, identityCookie } from '@/lib/identity';
import { enforceRateLimit } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';

const engine = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  jwt: { async encode(parameters) {
    const token=parameters.token??{};
    if ('authProtocol' in token || 'sessionCore' in token) {
      if (!persistentSessionsEnabled()) throw new SecurityError('SESSION_CORE_NOT_ACTIVATED',503);
      return encodeVersioned(token,parameters.secret,parameters.salt);
    }
    return authJsCrypto.encode(parameters);
  } },
  logger: { error() { console.error('Authentication operation failed'); }, warn(code) { console.warn('Authentication warning', code); }, debug() {} },
  providers: [
    Credentials({
      credentials: { email: { label: 'Email', type: 'email' }, password: { label: 'Password', type: 'password' } },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || email.length > 254 || !password || password.length > 128) return null;
        await enforceRateLimit('password-account', email, 8, 600);
        const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, accountStatus: true, passwordHash: true, publicNmdId: true } });
        // Keep the expensive password check for unknown accounts too.
        const valid = await bcrypt.compare(password, user?.passwordHash ?? '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
        if (!user || typeof user.passwordHash !== 'string' || !user.passwordHash || !valid || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus)) return null;
        return prisma.$transaction(async tx => {
          await assertPublicAuthSchema(tx);
          // Reserve the account row, then compare the credential snapshot privately.
          await tx.$queryRaw`SELECT "id" FROM public."User" WHERE "id" = ${user.id} FOR UPDATE`;
          const current = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, passwordHash: true, role: true, accountStatus: true, publicNmdId: true } });
          if (!current || current.passwordHash !== user.passwordHash || ['SUSPENDED', 'BADGE_REVOKED'].includes(current.accountStatus)) return null;
          let sessionCore: Claims | undefined;
          if (persistentSessionsEnabled()) {
            const adapter = sessionTransactionAdapter(tx);
            const account = await adapter.lockAccount(current.id);
            if (!account) return null;
            sessionCore = await issueSession(adapter, {userId:current.id,expectedGeneration:account.generation,method:'LEGACY_PASSWORD',verifiedPasswordHash:user.passwordHash});
          }
          await writeAudit(tx, { actorId: current.id, action: 'PASSWORD_SIGN_IN', entityType: 'User', entityId: current.id });
          return { id: current.id, email: current.email, role: current.role, accountStatus: current.accountStatus, publicNmdId: current.publicNmdId, ...(sessionCore ? {sessionCore} : {}) };
        });
      },
    }),
    Credentials({
      id: 'linked-identity', name: 'Verified linked identity',
      credentials: { ticket: { type: 'password' }, provider: { type: 'text' } },
      async authorize(credentials) {
        if (typeof credentials.ticket !== 'string' || credentials.provider !== 'DISCORD') return null;
        const provider = credentials.provider as 'STEAM' | 'DISCORD';
        const browser = (await cookies()).get(identityCookie(provider))?.value;
        return consumeLoginGrant(credentials.ticket, browser);
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.sessionCore) { token.sessionCore = user.sessionCore; token.authProtocol = 1; }
      if (user) { token.role = user.role; token.accountStatus = user.accountStatus; token.publicNmdId = user.publicNmdId; }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? ''; session.user.role = token.role;
        session.user.accountStatus = token.accountStatus; session.user.publicNmdId = token.publicNmdId;
      }
      return session;
    },
  },
});


/** Public application surface: raw engine handlers/auth/signOut are never exported. */
export const signIn = engine.signIn; // Versioned issuance remains blocked by schema/adapter gate.
export async function auth():Promise<Session|null> {
  const request = await currentRequest();
  let token;
  try { token = await cookieToken(request); } catch { throw new SecurityError('SESSION_INVALID',401); }
  if (!versioned(token)) return engine.auth();
  const result = await runtimeBoundary().read(request);
  if (result.status===503) throw new SecurityError('SESSION_REGISTRY_UNAVAILABLE',503);
  if (result.status!==200) return null;
  // Nonoperational until the persistence adapter exists; no private claims are projected.
  return result.body as Session;
}
export async function signOut(_options?: {redirect?:boolean}) {
  const request = await currentRequest();
  let token;
  try { token=await cookieToken(request); } catch { throw new SecurityError('SESSION_INVALID',401); }
  if (!versioned(token)) {
    const present=/(?:^|;)\s*(?:__Secure-)?authjs\.session-token(?:\.\d+)?=/.test(request.headers.get('cookie')??'');
    await engine.signOut({redirect:false});
    if (!token) return {status:present?'INVALID_COOKIE_CLEARED' as const:'NO_SESSION_COOKIE' as const};
    return {status:'LEGACY_COOKIE_CLEARED' as const}; // No durable revocation claim.
  }
  const result=await runtimeBoundary().logout(request);
  if(result.status!==200) throw new SecurityError(String(result.body?.status??'REVOCATION_UNCONFIRMED'),503);
  if(result.cookies.length) throw new SecurityError('SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED',503);
  return {status:'SESSION_REVOKED' as const};
}
async function dispatch(request:Request) {
  const url=new URL(request.url);
  // Reject ambiguous auth aliases before any framework normalization/dispatch.
  if (/%|\\|\/\/|(?:^|\/)\.{1,2}(?:\/|$)/.test(url.pathname) || !/^\/api\/auth\/[a-z0-9-]+(?:\/[a-z0-9-]+)?$/.test(url.pathname))
    return Response.json({error:'INVALID_AUTH_ACTION'},{status:400,headers:{'Cache-Control':'no-store'}});
  if(url.pathname==='/api/auth/signout' || url.pathname==='/api/auth/logout') {
    if(request.method!=='POST') return Response.json({error:'POST_REQUIRED'},{status:405});
    const {assertSameOrigin}=await import('@/lib/request-security');assertSameOrigin(request);
    try{return Response.json(await signOut({redirect:false}),{headers:{'Cache-Control':'no-store'}});}
    catch(error){
      const partialCodes=['SESSION_REVOKED_COOKIE_CLEAR_UNCONFIRMED','EXPIRED_COOKIE_CLEAR_UNCONFIRMED'];
      const code=error instanceof SecurityError && partialCodes.includes(error.code)?error.code:'REVOCATION_UNCONFIRMED';
      return Response.json({error:code},{status:503,headers:{'Cache-Control':'no-store'}});
    }
  }
  if(url.pathname==='/api/auth/session') {
    let token;
    try {token=await cookieToken(request);} catch{return Response.json({error:'SESSION_INVALID'},{status:401,headers:{'Cache-Control':'no-store'}});}
    if(versioned(token))return boundaryResponse(await runtimeBoundary().dispatch(request));
  }
  if(persistentSessionsEnabled())throw new SecurityError('SESSION_COOKIE_ADAPTER_REQUIRED',503);
  return request.method==='GET'?engine.handlers.GET(new NextRequest(request)):engine.handlers.POST(new NextRequest(request));
}
export const handlers={GET:dispatch,POST:dispatch};
