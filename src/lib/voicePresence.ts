/** Voice presence - pure interpretation of Discord voiceStateUpdate transitions
 * into typed awareness events. This is how the bot passively knows the room:
 * who is in the fractal voice channel, for how long, and whether their camera
 * is on (which feeds the +10 camera-on scoring input that is captured by hand
 * today).
 *
 * Kept pure (no discord.js, no DB) so it stays trivially testable, same
 * convention as nameResolver + rosterCapture. The listener in
 * awareness/voiceTracker.ts feeds it simplified snapshots; the DB writes live
 * there too.
 *
 * discord.js fires one voiceStateUpdate per change with (oldState, newState).
 * A member can join, leave, move channel, and toggle camera/stream/mute all
 * through this one event, so a single transition can yield several events.
 */

export type VoiceEventType =
  | 'joined' // entered a tracked channel (from nowhere or from an untracked channel)
  | 'left' // left a tracked channel (to nowhere or to an untracked channel)
  | 'moved' // moved between two tracked channels
  | 'camera_on'
  | 'camera_off'
  | 'stream_on'
  | 'stream_off';

/** The slice of a Discord VoiceState this module needs. `channelId` is null
 * when the member is not in any voice channel. */
export interface VoiceSnapshot {
  channelId: string | null;
  selfVideo: boolean; // camera on
  streaming: boolean; // screenshare on
}

export interface VoiceEvent {
  type: VoiceEventType;
  channelId: string | null; // the tracked channel the event pertains to
}

/** Is this channel one the bot treats as a fractal voice channel? An empty
 * tracked set means "track every voice channel". */
export function isTrackedChannel(channelId: string | null, tracked: Set<string>): boolean {
  if (!channelId) return false;
  return tracked.size === 0 || tracked.has(channelId);
}

/** Interpret a single voiceStateUpdate (prev -> next) into zero or more
 * awareness events, scoped to tracked channels. Presence events (joined/left/
 * moved) come first; camera/stream toggles are only reported while the member
 * is in a tracked channel (we do not care about a camera toggling in some
 * unrelated call). */
export function classifyVoiceTransition(
  prev: VoiceSnapshot,
  next: VoiceSnapshot,
  tracked: Set<string> = new Set(),
): VoiceEvent[] {
  const events: VoiceEvent[] = [];
  const wasIn = isTrackedChannel(prev.channelId, tracked);
  const isIn = isTrackedChannel(next.channelId, tracked);

  // Presence transitions.
  if (!wasIn && isIn) {
    events.push({ type: 'joined', channelId: next.channelId });
  } else if (wasIn && !isIn) {
    events.push({ type: 'left', channelId: prev.channelId });
  } else if (wasIn && isIn && prev.channelId !== next.channelId) {
    events.push({ type: 'moved', channelId: next.channelId });
  }

  // Camera / stream toggles only matter while present in a tracked channel.
  // On join, an already-on camera counts as camera_on; on leave, we do not
  // emit an off (the 'left' event already closes the interval).
  if (isIn) {
    const prevVideo = wasIn ? prev.selfVideo : false;
    const prevStream = wasIn ? prev.streaming : false;
    if (!prevVideo && next.selfVideo) events.push({ type: 'camera_on', channelId: next.channelId });
    if (prevVideo && !next.selfVideo) events.push({ type: 'camera_off', channelId: next.channelId });
    if (!prevStream && next.streaming) events.push({ type: 'stream_on', channelId: next.channelId });
    if (prevStream && !next.streaming) events.push({ type: 'stream_off', channelId: next.channelId });
  }

  return events;
}

export interface PresenceInterval {
  discordId: string;
  channelId: string;
  joinedAt: number;
  leftAt: number | null; // null = still present
  cameraOnMs: number; // total ms with camera on within this interval
}

interface OpenInterval extends PresenceInterval {
  cameraOnSince: number | null; // ms timestamp camera last turned on, or null
}

/** Fold a time-ordered stream of one member's events into presence intervals
 * with camera-on duration. Used to summarize a captured session from the
 * event log (e.g. "who was present, and for how long was each camera on").
 * Each event is { type, channelId, at } where `at` is an ms timestamp. A
 * trailing open interval (no 'left') is closed at `nowMs`. */
export function summarizePresence(
  discordId: string,
  events: { type: VoiceEventType; channelId: string | null; at: number }[],
  nowMs: number,
): PresenceInterval[] {
  const closed: PresenceInterval[] = [];
  let open: OpenInterval | null = null;

  const closeCamera = (o: OpenInterval, at: number) => {
    if (o.cameraOnSince !== null) {
      o.cameraOnMs += Math.max(0, at - o.cameraOnSince);
      o.cameraOnSince = null;
    }
  };
  const finish = (o: OpenInterval, at: number) => {
    closeCamera(o, at);
    closed.push({
      discordId: o.discordId,
      channelId: o.channelId,
      joinedAt: o.joinedAt,
      leftAt: at,
      cameraOnMs: o.cameraOnMs,
    });
  };

  for (const e of events) {
    if (e.type === 'joined' || e.type === 'moved') {
      if (open) finish(open, e.at); // moved closes the prior interval
      open = {
        discordId,
        channelId: e.channelId as string,
        joinedAt: e.at,
        leftAt: null,
        cameraOnMs: 0,
        cameraOnSince: null,
      };
    } else if (e.type === 'left') {
      if (open) {
        finish(open, e.at);
        open = null;
      }
    } else if (e.type === 'camera_on') {
      if (open && open.cameraOnSince === null) open.cameraOnSince = e.at;
    } else if (e.type === 'camera_off') {
      if (open) closeCamera(open, e.at);
    }
  }

  if (open) {
    // Still present: close at now, but leave leftAt null to signal "open".
    closeCamera(open, nowMs);
    closed.push({
      discordId: open.discordId,
      channelId: open.channelId,
      joinedAt: open.joinedAt,
      leftAt: null,
      cameraOnMs: open.cameraOnMs,
    });
  }

  return closed;
}
