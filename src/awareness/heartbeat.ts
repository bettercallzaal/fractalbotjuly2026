/** Heartbeat - liveness awareness. Periodically records that the bot is alive
 * and some coarse state (how many guilds it sees), so the dashboard can tell
 * whether the fractal bot is actually running rather than guessing. One row
 * per bot, upserted. Best-effort: a failed write is logged, never thrown.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Client } from 'discord.js';

const BOT_NAME = 'fractalbot';

/** Begin writing heartbeats every `intervalMs` (default 60s). Returns the
 * timer so callers can clear it in tests/shutdown. The timer is unref'd so it
 * never keeps the process alive on its own. */
export function startHeartbeat(
  client: Client,
  supabase: SupabaseClient,
  intervalMs = 60_000,
): NodeJS.Timeout {
  const write = async () => {
    try {
      const { error } = await supabase.from('discord_bot_heartbeats').upsert(
        {
          bot_name: BOT_NAME,
          status: 'up',
          guild_count: client.guilds.cache.size,
          last_seen: new Date().toISOString(),
        },
        { onConflict: 'bot_name' },
      );
      if (error) console.error('heartbeat: write failed', error.message);
    } catch (err) {
      console.error('heartbeat: unexpected error', err);
    }
  };

  void write(); // fire one immediately on start
  const timer = setInterval(() => void write(), intervalMs);
  timer.unref?.();
  return timer;
}
