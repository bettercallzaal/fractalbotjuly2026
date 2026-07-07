# Neon Postgres Migration Design

Moves this repo's persistence layer off Supabase onto a dedicated Vercel
Postgres (Neon-backed) database - the bot's own, not shared with ZAOOS.
Replaces Supabase Realtime (the `bot_commands` queue's push mechanism) with
Postgres `LISTEN`/`NOTIFY`. Sets up the schema the week-by-week fractal data
verification/import pass (the next project after this one) will populate.

## Why

- The design decision from doc 982/the original dashboard spec assumed
  reusing ZAOOS's Supabase project. On reflection, this bot's Respect/fractal
  data should live in its own database - not entangled with ZAOOS's schema,
  not subject to ZAOOS's migrations or outages.
- Identity/profile data (bio, avatar, social links, display name) now has a
  proper home: `ZAODEVZ/ZAOmemberz`, a dedicated ecosystem-wide identity
  service (separate project, separate design doc, being built in parallel).
  This repo's database should NOT try to own identity - only Respect/fractal
  facts, keyed by `wallet_address`/`discord_id` as plain join columns other
  services (ZAOmemberz, ZAOOS) can look up against.

## Schema

Four tables, replacing the five Supabase tables from the original design
(`wallets` + `respect_members` merge into `respect_balances`; `bot_commands`
carries over unchanged in shape):

- **`respect_balances`** - `wallet_address` (unique), `discord_id` (unique,
  nullable), `onchain_og`, `onchain_zor`, `updated_at`. Plain join keys only
  - no `display_name`/`avatar_url`/`bio`. Those live in ZAOmemberz; anything
  consuming this data joins by `wallet_address` or `discord_id` at the
  application level, not a cross-database foreign key.
- **`fractal_weeks`** - `id`, `week_number`, `group_number`, `session_date`,
  `facilitator_wallet_address`, `source` (`'onchain' | 'history_json' |
  'reconciled'`), `notes`. The `source` field exists for the verification
  pass - at a glance, which weeks came from where, which were manually
  reconciled.
- **`fractal_scores`** - `id`, `fractal_week_id` (FK to `fractal_weeks`),
  `wallet_address` (plain column, no FK to `respect_balances` - a member can
  be scored in a fractal before their `respect_balances` row exists; a hard
  FK would create insert-order dependencies the import pass doesn't need),
  `rank`, `level`, `respect_awarded`.
- **`bot_commands`** - same shape as the Supabase version: `id`, `action`,
  `params`, `idempotency_key` (unique), `requested_by`, `status`, `result`,
  `created_at`, `completed_at`.

Additionally, a trigger + function on `bot_commands`:

```sql
CREATE FUNCTION notify_bot_commands() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('bot_commands_channel', NEW.id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bot_commands_notify
  AFTER INSERT ON bot_commands
  FOR EACH ROW EXECUTE FUNCTION notify_bot_commands();
```

Postgres does not auto-notify on insert - this trigger is what makes
`LISTEN` work at all. Both the schema and this trigger are defined as
Drizzle migrations (`drizzle-kit generate` + a raw-SQL migration for the
trigger/function, since Drizzle's schema DSL doesn't model triggers).

## Queue mechanism: LISTEN/NOTIFY replaces Supabase Realtime

- The bot holds a **second, dedicated raw Postgres connection** (separate
  from its normal Drizzle query pool - `LISTEN` needs one connection held
  open indefinitely, which a pooled/serverless-style client can't do) that
  runs `LISTEN bot_commands_channel` and reacts to `notification` events by
  calling `executeCommand` - same function, same UPDATE-based claiming logic
  already fixed in the dashboard build (claim `pending` -> `processing` via
  a conditional UPDATE, not INSERT), just running through Drizzle/`pg`
  instead of `supabase-js`.
- This connection needs reconnect-on-drop handling: a dropped connection
  silently stops listening with no error surfaced elsewhere, so the bot must
  detect the drop and re-`LISTEN` automatically.
- **`dispatchCommand.ts` (dashboard side) barely changes.** It never
  depended on Supabase Realtime - it inserts a row and polls a normal query
  for the row's status to change, then falls back to the bot's HTTP
  endpoint. Only the client swaps from `supabase-js` to Drizzle; the
  polling/timeout/fallback logic is unchanged.
- Every `web/lib/get*.ts` reader (`getLeaderboard`, `getWalletRegistry`,
  `getRecentCommands`) - Supabase query-builder calls become Drizzle
  queries. Same return shapes, same tests conceptually (the tests' fake
  Supabase clients become fake Drizzle query builders).

## Files that change

- `src/lib/supabaseClient.ts` -> `src/lib/db.ts` (Drizzle client + a
  separate raw `pg` client for `LISTEN`).
- `web/lib/supabaseClient.ts` -> `web/lib/db.ts` (Drizzle client only - the
  dashboard never needs a `LISTEN` connection, it's serverless).
- `packages/shared/src/` gains the Drizzle schema definitions (`schema.ts`)
  so both the bot and the dashboard import the same table definitions - one
  more thing added to what `packages/shared` already unifies
  (`computeRespectWeight`, config constants).
- `src/commands/executeCommand.ts` - swap `SupabaseClient` type/calls for
  Drizzle equivalents; UPDATE-based claiming logic is portable SQL, doesn't
  conceptually change.
- `src/commands/subscribeToCommands.ts` - full rewrite: Supabase Realtime
  subscription becomes a raw `pg` `LISTEN` client with reconnect handling.
- `src/http/server.ts` - swap client only, logic unchanged.
- `web/lib/dispatchCommand.ts` - swap client only, polling/fallback logic
  unchanged.
- `web/lib/getLeaderboard.ts`, `web/lib/getWalletRegistry.ts`,
  `web/lib/getRecentCommands.ts` - swap Supabase query builder for Drizzle
  queries.
- `web/lib/resolveMemberIdentity.ts` - queries `respect_balances` instead of
  a `wallets` table; still resolves by `wallet_address`/`discord_id`.
- `supabase/migrations/0001_bot_commands.sql` -> replaced by Drizzle-managed
  migrations (`drizzle/` directory, `drizzle-kit` generated + the hand
  written trigger/function migration above).
- Every `.env.example` - `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` replaced
  by two variables: `DATABASE_URL` (Neon's pooled connection string, via
  PgBouncer - used for normal Drizzle queries from both the bot and the
  serverless dashboard) and `DATABASE_URL_UNPOOLED` (Neon's direct
  connection string - required for the bot's `LISTEN` connection, since
  PgBouncer's transaction-pooling mode does not support session-level
  features like `LISTEN`/`NOTIFY`; using the pooled URL there would silently
  never deliver notifications). Only the bot process needs
  `DATABASE_URL_UNPOOLED`; the dashboard only ever uses the pooled one.

## What does NOT change

- `web/auth.ts`, `web/types/next-auth.d.ts`, `web/lib/siwe.ts`,
  `web/lib/getGuildMemberRoleIds.ts`, `web/lib/guildRoleCache.ts`,
  `web/lib/isSupremeAdmin.ts` - none of these touch Supabase at all, no
  changes needed.
- `packages/shared/src/respectWeight.ts`, `config.ts` - unchanged; the
  Respect-weight formula doesn't care what database it's fed from.
- `src/commands/randomize.ts` - pure function, no database dependency.
- The admin/member page components (`web/app/(admin)/*`,
  `web/app/(public)/leaderboard/page.tsx`, `web/app/(member)/me/page.tsx`) -
  they call the `get*.ts`/`dispatchCommand.ts` functions, which keep the
  same exported signatures; the pages themselves don't touch the database
  client directly.

## Relationship to ZAOmemberz

Two separate Postgres databases (this one, Neon; ZAOmemberz's, also Neon but
a distinct project), joined only at the application level by
`wallet_address` or `discord_id` - never a cross-database foreign key. This
repo's dashboard would call ZAOmemberz's public read API
(`GET /api/profiles/:wallet`) to show bio/avatar alongside Respect data on
the leaderboard; that's a follow-up integration, not part of this migration.

## Explicitly out of scope for this design

- Provisioning the actual Neon project / getting a real `DATABASE_URL` -
  that's a Vercel Marketplace action for Zaal to do, not something this
  design or its implementation plan can do unattended.
- ZAOmemberz's own build - separate repo, separate design, in progress
  elsewhere.
- The week-by-week historical data import/verification pass itself - this
  design only gets the schema and infrastructure ready for it. The import
  pass is the next project after this one ships.
- Any actual leaderboard/profile integration between this repo and
  ZAOmemberz (calling ZAOmemberz's read API from the dashboard) - noted
  above as a future follow-up, not built here.
