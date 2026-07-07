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
 * `idempotencyKey`: if a row for this key already exists and isn't
 * `pending`, the action is not re-run. */
export async function executeCommand(
  supabase: SupabaseClient,
  action: string,
  params: Record<string, unknown>,
  idempotencyKey: string,
  requestedBy: string,
): Promise<ActionResult> {
  const runner = ACTIONS[action];
  if (!runner) {
    throw new Error(`Unknown action: ${action}`);
  }

  const { data: inserted, error: insertError } = await supabase
    .from('bot_commands')
    .insert({ action, params, idempotency_key: idempotencyKey, requested_by: requestedBy, status: 'processing' })
    .select()
    .single();

  if (insertError) {
    // Unique violation on idempotency_key means this command was already
    // claimed (by the queue listener or the HTTP fallback, whichever won
    // the race) - look up its current state instead of running again.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('bot_commands')
        .select()
        .eq('idempotency_key', idempotencyKey)
        .single();
      return { status: 'already_processed', result: existing?.result };
    }
    throw insertError;
  }

  try {
    const result = runner(params);
    await supabase.from('bot_commands').update({ status: 'done', result, completed_at: new Date().toISOString() }).eq('id', inserted.id);
    return { status: 'done', result };
  } catch (err) {
    await supabase.from('bot_commands').update({ status: 'failed', result: { error: String(err) }, completed_at: new Date().toISOString() }).eq('id', inserted.id);
    return { status: 'failed' };
  }
}
