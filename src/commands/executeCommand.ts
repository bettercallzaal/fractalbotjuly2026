import type { SupabaseClient } from '@supabase/supabase-js';
import { type Member, resolveRoster } from '../lib/nameResolver.js';
import { distributeIntoGroups } from './randomize.js';

type ActionResult = { status: 'done' | 'failed' | 'already_processed'; result?: unknown };

/** Action runner context. Actions that only transform their params ignore it
 * (e.g. randomize); actions that read state use `ctx.supabase`. */
interface ActionContext {
  supabase: SupabaseClient;
}

const ACTIONS: Record<
  string,
  (params: Record<string, unknown>, ctx: ActionContext) => unknown | Promise<unknown>
> = {
  randomize: (params) => {
    const memberIds = params.memberIds as string[];
    const maxGroupSize = params.maxGroupSize as number;
    return { groups: distributeIntoGroups(memberIds, maxGroupSize) };
  },

  /** Resolve a roster of raw Discord display names to Respect members
   * (name + wallet), so a fractal's scoring writes to the right rows.
   * Returns matched / ambiguous / unmatched so the caller can score the
   * clean matches, prompt a human on the ambiguous ones, and register the
   * unmatched. Reads the shared `respect_members` table. */
  resolveMembers: async (params, ctx) => {
    const names = params.names as string[];
    if (!Array.isArray(names)) {
      throw new Error('resolveMembers requires a `names` string array');
    }
    const { data, error } = await ctx.supabase
      .from('respect_members')
      .select('name, wallet_address, fid');
    if (error) throw error;
    const members = (data ?? []) as Member[];
    const resolution = resolveRoster(names, members);
    return {
      matched: resolution.matched.map((m) => ({
        query: m.query,
        name: m.member?.name ?? null,
        wallet: m.member?.wallet_address ?? null,
        fid: m.member?.fid ?? null,
        confidence: m.confidence,
      })),
      ambiguous: resolution.ambiguous.map((m) => ({
        query: m.query,
        candidates: (m.candidates ?? []).map((c) => ({
          name: c.name,
          wallet: c.wallet_address,
        })),
      })),
      unmatched: resolution.unmatched,
    };
  },
};

/** Single entry point for running a bot command, called by both the
 * Supabase Realtime listener and the HTTP fallback route. Dedupes by
 * `idempotencyKey`: claims the pending row via UPDATE transition from
 * 'pending' to 'processing'. Only one caller can win the claim race. */
export async function executeCommand(
  supabase: SupabaseClient,
  action: string,
  params: Record<string, unknown>,
  idempotencyKey: string,
  requestedBy: string,
): Promise<ActionResult> {
  // Reject unknown actions before attempting to claim the row.
  // This ensures invalid actions fail fast without wasting a database claim.
  const runner = ACTIONS[action];
  if (!runner) {
    throw new Error(`Unknown action: ${action}`);
  }

  // Attempt to claim the pending row by transitioning it to 'processing'.
  // This is a conditional update that only matches rows in 'pending' status.
  const { data: claimed, error: claimError } = await supabase
    .from('bot_commands')
    .update({ status: 'processing' })
    .eq('idempotency_key', idempotencyKey)
    .eq('status', 'pending')
    .select()
    .single();

  // If the update did not match any rows, determine why: another caller
  // already claimed it, or there's no row at all (caller error).
  if (claimError) {
    // Supabase returns PGRST116 "no rows returned" when .single() has no matches.
    // This means the row exists but is not in 'pending' state (already claimed
    // or finished), or no row exists at all.
    if (claimError.code === 'PGRST116') {
      const { data: existing } = await supabase
        .from('bot_commands')
        .select()
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();

      if (existing) {
        // Row exists but is not pending - another caller already claimed or finished it.
        return { status: 'already_processed', result: existing.result };
      }

      // No row exists at all - this is a genuine error, not a race condition.
      throw new Error(`No pending command found for idempotency_key: ${idempotencyKey}`);
    }

    // Some other database error occurred during the claim attempt.
    throw claimError;
  }

  // Successfully claimed the row - now run the action. `await` handles both
  // sync actions (randomize) and async ones (resolveMembers, which reads the DB).
  let result: unknown;
  try {
    result = await runner(params, { supabase });
  } catch (err) {
    // Runner threw - update row with failure status and re-throw the error
    // after recording it in the database.
    const { error: updateError } = await supabase
      .from('bot_commands')
      .update({ status: 'failed', result: { error: String(err) }, completed_at: new Date().toISOString() })
      .eq('id', claimed.id);

    if (updateError) {
      // Safe access to error message with fallback to String() conversion
      const errorMessage = updateError?.message ?? String(updateError);
      throw new Error(`Failed to update row after execution failure: ${errorMessage}`);
    }

    return { status: 'failed' };
  }

  // Runner succeeded - update row with success status
  const { error: updateError } = await supabase
    .from('bot_commands')
    .update({ status: 'done', result, completed_at: new Date().toISOString() })
    .eq('id', claimed.id);

  if (updateError) {
    // Safe access to error message with fallback to String() conversion
    const errorMessage = updateError?.message ?? String(updateError);
    throw new Error(`Failed to update row after successful execution: ${errorMessage}`);
  }

  return { status: 'done', result };
}
