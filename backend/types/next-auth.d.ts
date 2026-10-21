import type { Claims } from '../lib/persistent-session';
import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
    sessionCore?: Claims;
    role: string;
    accountStatus: string;
    publicNmdId: string;
  }

  interface Session {
    user: {
      id: string;
      role: string;
      accountStatus: string;
      publicNmdId: string;
    } & Session['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionCore?: Claims;
    authProtocol?: 1;
    role?: string;
    accountStatus?: string;
    publicNmdId?: string;
  }
}
