import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = typeof credentials?.email === 'string' ? credentials.email.toLowerCase() : '';
        const password = typeof credentials?.password === 'string' ? credentials.password : '';
        if (!email || !password) return null;
        const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, role: true, accountStatus: true, passwordHash: true, publicNmdId: true } });
        if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;
        if (['SUSPENDED', 'BADGE_REVOKED'].includes(user.accountStatus)) return null;
        return { id: user.id, email: user.email, role: user.role, accountStatus: user.accountStatus, publicNmdId: user.publicNmdId };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.accountStatus = user.accountStatus;
        token.publicNmdId = user.publicNmdId;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? '';
        session.user.role = token.role;
        session.user.accountStatus = token.accountStatus;
        session.user.publicNmdId = token.publicNmdId;
      }
      return session;
    },
  },
});
