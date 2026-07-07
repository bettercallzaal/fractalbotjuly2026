import { describe, expect, it } from 'vitest';
import { resolveMemberIdentity } from './resolveMemberIdentity.js';

function makeFakeSupabase(rows: { discord_id: string; wallet_address: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            const row = rows.find((r) => (r as any)[column] === value);
            return { data: row ?? null, error: null };
          },
        }),
      }),
    }),
  };
}

describe('resolveMemberIdentity', () => {
  it('resolves a Discord login to its linked wallet', async () => {
    const supabase = makeFakeSupabase([{ discord_id: 'discord-1', wallet_address: '0xabc' }]);
    const result = await resolveMemberIdentity(supabase as any, { discordId: 'discord-1' });
    expect(result).toEqual({ discordId: 'discord-1', walletAddress: '0xabc', linked: true });
  });

  it('resolves a wallet login to its linked Discord ID', async () => {
    const supabase = makeFakeSupabase([{ discord_id: 'discord-1', wallet_address: '0xabc' }]);
    const result = await resolveMemberIdentity(supabase as any, { walletAddress: '0xabc' });
    expect(result).toEqual({ discordId: 'discord-1', walletAddress: '0xabc', linked: true });
  });

  it('returns a partial identity when there is no link yet', async () => {
    const supabase = makeFakeSupabase([]);
    const result = await resolveMemberIdentity(supabase as any, { discordId: 'discord-2' });
    expect(result).toEqual({ discordId: 'discord-2', walletAddress: null, linked: false });
  });
});
