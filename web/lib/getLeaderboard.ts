import type { SupabaseClient } from '@supabase/supabase-js';
import { computeRespectWeight } from '@fractalbot/shared';

interface LeaderboardEntry {
  discordId: string;
  walletAddress: string;
  weight: number;
}

export async function getLeaderboard(supabase: SupabaseClient): Promise<LeaderboardEntry[]> {
  const { data } = await supabase.from('respect_members').select();
  if (!data) return [];

  const entries = data.map((row: any) => {
    const { weight } = computeRespectWeight(
      { status: 'success', result: BigInt(row.onchain_og ?? '0') },
      { status: 'success', result: BigInt(row.onchain_zor ?? '0') },
    );
    return { discordId: row.discord_id, walletAddress: row.wallet_address, weight };
  });

  return entries.sort((a, b) => b.weight - a.weight);
}
