import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import Credentials from 'next-auth/providers/credentials';
import { verifySiweSignature } from './lib/siwe.js';
import { resolveMemberIdentity } from './lib/resolveMemberIdentity.js';
import { getGuildMemberRoleIds } from './lib/getGuildMemberRoleIds.js';
import { getSupabaseClient } from './lib/supabaseClient.js';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
    Credentials({
      id: 'siwe',
      name: 'Ethereum',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials) {
        const message = credentials?.message as string | undefined;
        const signature = credentials?.signature as `0x${string}` | undefined;
        if (!message || !signature) return null;

        const { address, valid } = await verifySiweSignature(message, signature);
        if (!valid) return null;

        return { id: address, walletAddress: address };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      const supabase = getSupabaseClient();

      if (account?.provider === 'discord') {
        const identity = await resolveMemberIdentity(supabase, { discordId: account.providerAccountId });
        token.discordId = identity.discordId;
        token.walletAddress = identity.walletAddress;
      } else if (account?.provider === 'siwe' && user) {
        const identity = await resolveMemberIdentity(supabase, { walletAddress: (user as any).walletAddress });
        token.discordId = identity.discordId;
        token.walletAddress = identity.walletAddress;
      }

      token.discordRoleIds = token.discordId
        ? await getGuildMemberRoleIds(token.discordId as string, process.env.DISCORD_GUILD_ID!, process.env.DISCORD_BOT_TOKEN!)
        : [];

      return token;
    },
    async session({ session, token }) {
      (session as any).discordId = token.discordId;
      (session as any).walletAddress = token.walletAddress;
      (session as any).discordRoleIds = token.discordRoleIds ?? [];
      return session;
    },
  },
});
