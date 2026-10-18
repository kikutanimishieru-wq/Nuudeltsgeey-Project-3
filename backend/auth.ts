import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { consumeLoginGrant, identityCookie } from '@/lib/identity';
import { enforceRateLimit } from '@/lib/rate-limit';
import { writeAudit } from '@/lib/audit';

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
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
        if (!user || !valid || ['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus)) return null;
        return prisma.$transaction(async tx => {
          // Re-read current state inside the login transaction.
          const current = await tx.user.findUnique({ where: { id: user.id }, select: { id: true, email: true, role: true, accountStatus: true, publicNmdId: true } });
          if (!current || ['SUSPENDED', 'BADGE_REVOKED'].includes(current.accountStatus)) return null;
          await writeAudit(tx, { actorId: current.id, action: 'PASSWORD_SIGN_IN', entityType: 'User', entityId: current.id });
          return current;
        });
      },
    }),
    Credentials({
      id: 'linked-identity', name: 'Verified linked identity',
      credentials: { ticket: { type: 'password' }, provider: { type: 'text' } },
      async authorize(credentials) {
        if (typeof credentials.ticket !== 'string' || !['STEAM', 'DISCORD'].includes(String(credentials.provider))) return null;
        const provider = credentials.provider as 'STEAM' | 'DISCORD';
        const browser = (await cookies()).get(identityCookie(provider))?.value;
        return consumeLoginGrant(credentials.ticket, browser);
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
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
