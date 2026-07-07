import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

interface DispatchOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

/** Inserts a command into the bot_commands queue, polls for the bot to ack
 * it, and falls back to calling the bot's HTTP endpoint directly if it
 * hasn't acked within the timeout (default 10s, per the design spec). Both
 * paths use the same idempotency key, so the bot's own dedupe in
 * executeCommand prevents a double-run if both eventually fire. */
export async function dispatchCommand(
  supabase: SupabaseClient,
  action: string,
  params: Record<string, unknown>,
  requestedBy: string,
  botApiUrl: string,
  botApiSecret: string,
  options: DispatchOptions = {},
) {
  const pollIntervalMs = options.pollIntervalMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 10_000;

  const idempotencyKey = randomUUID();

  await supabase
    .from('bot_commands')
    .insert({ action, params, idempotency_key: idempotencyKey, requested_by: requestedBy, status: 'pending' })
    .select()
    .single();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { data } = await supabase
      .from('bot_commands')
      .select()
      .eq('idempotency_key', idempotencyKey)
      .single();

    if (data && data.status !== 'pending') {
      return { status: data.status, result: data.result };
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const response = await fetch(`${botApiUrl}/commands/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bot-api-secret': botApiSecret },
    body: JSON.stringify({ params, idempotencyKey, requestedBy }),
  });

  return response.json();
}
