import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface User {
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
    role?: string;
    accountStatus?: string;
    publicNmdId?: string;
  }
}
