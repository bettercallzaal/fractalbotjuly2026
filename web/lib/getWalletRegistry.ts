import type { SupabaseClient } from '@supabase/supabase-js';

interface WalletEntry {
  discordId: string;
  walletAddress: string;
}

export async function getWalletRegistry(supabase: SupabaseClient, search?: string): Promise<WalletEntry[]> {
  const query = supabase.from('wallets').select();
  const { data } = search
    ? await (query as any).ilike('wallet_address', `%${search}%`)
    : await (query as any).order('discord_id');

  if (!data) return [];

  return data.map((row: any) => ({ discordId: row.discord_id, walletAddress: row.wallet_address }));
}
