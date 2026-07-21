-- ============================================================
-- Bot awareness layer - liveness + live voice presence + camera
--
-- Passive-record tables for making the fractal bot "aware": a heartbeat so the
-- dashboard knows it is alive, an append-only event log of what it observed,
-- and a live voice-presence record (who is in the fractal voice channel, for
-- how long, camera on/off). The camera signal auto-feeds the +10 camera-on
-- scoring input that is captured by hand today.
--
-- Written by the bot (service role); read by the /fractals dashboard (anon).
-- discord_ prefix + RLS + public read, same convention as discord_roster.
--
-- NOTE: numbered 0003 to sit after 0002_discord_roster (PR #4). If merged
-- before that PR, the gap is harmless - migrations need not be contiguous.
-- ============================================================

-- Liveness: one upserted row per bot.
create table if not exists public.discord_bot_heartbeats (
  bot_name text primary key,
  status text not null default 'up',
  guild_count integer,
  last_seen timestamptz not null default now()
);

comment on table public.discord_bot_heartbeats is
  'Bot liveness. Upserted every ~60s by the fractal bot; dashboard reads last_seen to show up/down.';

-- Append-only observation log.
create table if not exists public.discord_bot_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,          -- e.g. 'voice_joined', 'voice_camera_on'
  discord_id text,
  guild_id text,
  channel_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists discord_bot_events_type_idx on public.discord_bot_events (event_type);
create index if not exists discord_bot_events_discord_id_idx on public.discord_bot_events (discord_id);
create index if not exists discord_bot_events_created_idx on public.discord_bot_events (created_at desc);

comment on table public.discord_bot_events is
  'Append-only log of what the bot observed (voice joins/leaves, camera toggles). Feeds session reconstruction + the dashboard activity view.';

-- Live voice presence: one row per member per stay. left_at IS NULL = present.
create table if not exists public.discord_voice_presence (
  id uuid primary key default gen_random_uuid(),
  guild_id text,
  channel_id text,
  discord_id text not null,
  display_name text,
  joined_at timestamptz not null default now(),
  left_at timestamptz,               -- null while still in the channel
  camera_on boolean not null default false,
  streaming boolean not null default false
);

create index if not exists discord_voice_presence_open_idx
  on public.discord_voice_presence (discord_id) where left_at is null;
create index if not exists discord_voice_presence_channel_idx on public.discord_voice_presence (channel_id);

comment on table public.discord_voice_presence is
  'Live voice presence per member per stay. left_at NULL = currently present. camera_on feeds the +10 camera-on scoring input.';

-- RLS: bot writes via service role (bypasses RLS); dashboard reads via anon.
alter table public.discord_bot_heartbeats enable row level security;
alter table public.discord_bot_events enable row level security;
alter table public.discord_voice_presence enable row level security;

create policy "Public read" on public.discord_bot_heartbeats for select using (true);
create policy "Public read" on public.discord_bot_events for select using (true);
create policy "Public read" on public.discord_voice_presence for select using (true);

-- Live dashboard updates as presence + heartbeats change.
alter publication supabase_realtime add table public.discord_bot_heartbeats;
alter publication supabase_realtime add table public.discord_voice_presence;
