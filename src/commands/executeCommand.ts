import type { SupabaseClient } from '@supabase/supabase-js';
import { distributeIntoGroups } from './randomize.js';

type ActionResult = { status: 'done' | 'failed' | 'already_processed'; result?: unknown };

const ACTIONS: Record<string, (params: Record<string, unknown>) => unknown> = {
  randomize: (params) => {
    const memberIds = params.memberIds as string[];
    const maxGroupSize = params.maxGroupSize as number;
    return { groups: distributeIntoGroups(memberIds, maxGroupSize) };
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

  // Successfully claimed the row - now run the action.
  let result: unknown;
  try {
    result = runner(params);
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
