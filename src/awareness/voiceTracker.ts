/** Voice tracker - the live awareness loop. Registers a voiceStateUpdate
 * listener so the bot passively knows who is in the fractal voice channel,
 * for how long, and whether their camera is on. Turns roster capture from a
 * one-shot snapshot into a continuous presence record, and captures the
 * camera-on signal (the +10 scoring input) automatically.
 *
 * Thin + defensive by design (the pure interpretation lives in
 * lib/voicePresence.ts): every DB write is best-effort and logged on failure,
 * because a listener that throws would take down the whole gateway connection.
 * Passive only - it observes and records, it never posts to Discord.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { type Client, Events, type VoiceState } from 'discord.js';
import { classifyVoiceTransition, type VoiceSnapshot } from '../lib/voicePresence.js';

function toSnapshot(s: VoiceState): VoiceSnapshot {
  return {
    channelId: s.channelId,
    selfVideo: Boolean(s.selfVideo),
    streaming: Boolean(s.streaming),
  };
}

/** Start the voice awareness loop. `trackedChannelIds` limits tracking to
 * specific fractal voice channels; empty = track every voice channel. */
export function startVoiceTracker(
  client: Client,
  supabase: SupabaseClient,
  trackedChannelIds: string[] = [],
): void {
  const tracked = new Set(trackedChannelIds);

  client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
      const member = newState.member ?? oldState.member;
      const discordId = member?.id;
      if (!discordId) return;

      const events = classifyVoiceTransition(toSnapshot(oldState), toSnapshot(newState), tracked);
      if (events.length === 0) return;

      const guildId = newState.guild?.id ?? oldState.guild?.id ?? null;
      const displayName = member?.displayName ?? null;
      const at = new Date().toISOString();

      // 1. Append to the awareness event log (append-only, cheap).
      const { error: evErr } = await supabase.from('discord_bot_events').insert(
        events.map((e) => ({
          event_type: `voice_${e.type}`,
          discord_id: discordId,
          guild_id: guildId,
          channel_id: e.channelId,
          detail: { displayName },
          created_at: at,
        })),
      );
      if (evErr) console.error('voiceTracker: event log write failed', evErr.message);

      // 2. Maintain the live presence rows (one open row per member per stay).
      for (const e of events) {
        if (e.type === 'joined' || e.type === 'moved') {
          const { error } = await supabase.from('discord_voice_presence').insert({
            guild_id: guildId,
            channel_id: e.channelId,
            discord_id: discordId,
            display_name: displayName,
            joined_at: at,
            camera_on: Boolean(newState.selfVideo),
            streaming: Boolean(newState.streaming),
          });
          if (error) console.error('voiceTracker: presence open failed', error.message);
        } else if (e.type === 'left') {
          const { error } = await supabase
            .from('discord_voice_presence')
            .update({ left_at: at })
            .eq('discord_id', discordId)
            .is('left_at', null);
          if (error) console.error('voiceTracker: presence close failed', error.message);
        } else if (e.type === 'camera_on' || e.type === 'camera_off') {
          const { error } = await supabase
            .from('discord_voice_presence')
            .update({ camera_on: e.type === 'camera_on' })
            .eq('discord_id', discordId)
            .is('left_at', null);
          if (error) console.error('voiceTracker: camera update failed', error.message);
        } else if (e.type === 'stream_on' || e.type === 'stream_off') {
          const { error } = await supabase
            .from('discord_voice_presence')
            .update({ streaming: e.type === 'stream_on' })
            .eq('discord_id', discordId)
            .is('left_at', null);
          if (error) console.error('voiceTracker: stream update failed', error.message);
        }
      }
    } catch (err) {
      // Never let a listener throw - it would drop the gateway connection.
      console.error('voiceTracker: unexpected error', err);
    }
  });
}
