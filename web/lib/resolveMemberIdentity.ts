import type { SupabaseClient } from '@supabase/supabase-js';

interface PartialIdentity {
  discordId?: string;
  walletAddress?: string;
}

interface ResolvedIdentity {
  discordId: string | null;
  walletAddress: string | null;
  linked: boolean;
}

/** Looks up the `wallets` table (Discord ID <-> wallet address, the same
 * table the bot's /register command writes to) to merge a Discord login or
 * a SIWE wallet login into one member identity. */
export async function resolveMemberIdentity(
  supabase: SupabaseClient,
  identity: PartialIdentity,
): Promise<ResolvedIdentity> {
  if (identity.discordId) {
    const { data } = await supabase
      .from('wallets')
      .select()
      .eq('discord_id', identity.discordId)
      .maybeSingle();

    return {
      discordId: identity.discordId,
      walletAddress: data?.wallet_address ?? null,
      linked: Boolean(data),
    };
  }

  if (identity.walletAddress) {
    const { data } = await supabase
      .from('wallets')
      .select()
      .eq('wallet_address', identity.walletAddress)
      .maybeSingle();

    return {
      discordId: data?.discord_id ?? null,
      walletAddress: identity.walletAddress,
      linked: Boolean(data),
    };
  }

  return { discordId: null, walletAddress: null, linked: false };
}
