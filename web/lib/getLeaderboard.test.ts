import { describe, expect, it } from 'vitest';
import { getLeaderboard } from './getLeaderboard.js';

function makeFakeSupabase(rows: { discord_id: string; wallet_address: string; onchain_og: string; onchain_zor: string }[]) {
  return {
    from: () => ({
      select: async () => ({ data: rows, error: null }),
    }),
  };
}

describe('getLeaderboard', () => {
  it('sorts members by Respect weight, descending', async () => {
    const supabase = makeFakeSupabase([
      { discord_id: 'a', wallet_address: '0x1', onchain_og: '0', onchain_zor: '10' },
      { discord_id: 'b', wallet_address: '0x2', onchain_og: '1000000000000000000', onchain_zor: '0' }, // 1 OG
    ]);

    const leaderboard = await getLeaderboard(supabase as any);
    expect(leaderboard.map((m) => m.discordId)).toEqual(['a', 'b']);
    expect(leaderboard[0].weight).toBe(10);
    expect(leaderboard[1].weight).toBe(1);
  });

  it('returns an empty array when there are no members', async () => {
    const supabase = makeFakeSupabase([]);
    expect(await getLeaderboard(supabase as any)).toEqual([]);
  });
});
