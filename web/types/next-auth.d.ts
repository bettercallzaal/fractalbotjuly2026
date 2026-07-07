import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface User {
    walletAddress?: string;
  }

  interface Session {
    discordId: string | null;
    walletAddress: string | null;
    discordRoleIds: string[];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    discordId?: string | null;
    walletAddress?: string | null;
    discordRoleIds?: string[];
  }
}
