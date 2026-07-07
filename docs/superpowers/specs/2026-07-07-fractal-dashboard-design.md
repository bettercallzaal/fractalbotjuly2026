# ZAO Fractal Dashboard Design

Companion Next.js web dashboard for the fresh ZAO Fractal Discord bot rebuild
(`fractalbotjuly2026`). The Discord bot is the backend of record for live
fractal sessions; this dashboard is the frontend, with two-way interaction
between them.

## Goals

- Admin view: control live fractal sessions from the web, not just Discord.
- Member view: profile + fractal history + wallet management.
- Canonical Respect leaderboard, migrated from ZAOOS's `/respect` page.
  ZAOOS's own `/respect` page becomes a pointer to this dashboard instead of
  hosting a duplicate.
- Two login methods that resolve to one member identity: Discord OAuth and
  Sign-In With Ethereum (SIWE).
- No drift between the bot's and the dashboard's Respect-scoring logic - one
  shared implementation, not two copies (the gap identified in ZAOOS research
  doc 981/982).

## Architecture

```
fractalbotjuly2026-rebuild/
  src/                    existing Discord bot (discord.js)
  packages/
    shared/               NEW - computeRespectWeight, config constants
                          (RESPECT_POINTS, contract addresses). Imported by
                          BOTH src/ (bot) and web/ (dashboard).
  web/                    NEW - Next.js 14 app, own package.json
    app/
      (public)/leaderboard/    no login required to view
      (member)/me/             requires login (Discord or wallet)
      (admin)/sessions/        requires Supreme Admin role
```

One repo, two deployables: the bot process (unchanged, wherever it's
hosted) and the Next.js app under `web/` deployed to Vercel.

## Interaction layer: dashboard controls the bot

Two channels, primary + fallback, both built in this phase:

1. **Primary: Supabase command queue.** A new `bot_commands` table. Admin
   clicks an action in the dashboard -> a Next.js API route inserts a row
   (action, params, requester, idempotency key) -> the bot subscribes via
   Supabase Realtime, executes the same internal function its own slash
   command would call, and writes a status/result back to the row. RLS on
   the table is gated by the Supreme Admin check - same authorization
   surface used everywhere else.

2. **Fallback: direct HTTP API on the bot.** The bot runs a small
   authenticated HTTP server (extends the existing health-check server
   pattern already in the current Python bot) exposing endpoints like
   `POST /commands/randomize`, protected by a shared secret
   (`BOT_API_SECRET`). If the queue insert fails, or the bot doesn't ack
   within **10 seconds**, the same API route falls back to calling this
   endpoint directly.

3. **Idempotency.** Every command carries an idempotency key. If the queue
   command succeeds *after* the HTTP fallback already fired (or vice versa),
   the bot recognizes the duplicate key and no-ops the second execution -
   prevents e.g. double-randomizing a room.

**Open dependency, not solved in this doc:** the HTTP fallback requires the
bot process to have a stable public HTTPS endpoint reachable from Vercel.
Whatever host runs the bot needs to support that (a plain shared host like
bot-hosting.net may not) - this is a hosting decision for the deployment
phase, called out here so it isn't forgotten.

## Auth flow

NextAuth with two providers:

- **Discord OAuth** - standard provider, same pattern used elsewhere in the
  ZAO ecosystem.
- **SIWE (Credentials provider)** - user connects a wallet (wagmi/viem),
  signs a Sign-In-With-Ethereum message, the API route verifies the
  signature server-side (`viem`'s `verifyMessage`) and issues a session.

**Identity reconciliation:** both providers resolve against the bot's
existing wallet-registry table in Supabase (the same one `/register`
already writes to).

- Discord login + that Discord ID has a registered wallet -> full merged
  profile (Discord identity + wallet + Respect balance).
- SIWE login with a wallet that's linked to a Discord ID -> same merged
  identity, resolved from the other direction.
- Either login method with no link on the other side -> a partial profile
  (wallet-only or Discord-only) until the member links the missing piece
  from their profile page.

**Admin gating:** after login, check the authenticated Discord ID against
the guild's Supreme Admin role (same check the bot itself uses) to decide
whether the admin view is shown. No separate admin allowlist.

## Admin view

- Live session status: subscribed to `bot_commands` / `fractal_sessions` via
  Supabase Realtime.
- Action buttons: Randomize, Force Round, Reset Waiting Room, End Fractal -
  each wired through the interaction layer above.
- Wallet registry: searchable table of Discord ID -> wallet mappings.
- Command audit log: who triggered what and when, sourced from
  `bot_commands`.

## Member view

- **My Profile:** Respect breakdown (OG + ZOR + fractal-earned), fractal
  history, wallet linking/management.
- **Leaderboard:** the full community leaderboard, migrated from ZAOOS's
  `/respect` page, computed via the shared `computeRespectWeight`. This
  becomes the canonical leaderboard; ZAOOS's own page is updated separately
  (out of scope for this repo) to link here instead of duplicating it.

## Data flow

- Existing Supabase tables stay as-is and are shared across the bot, this
  dashboard, and ZAOOS: `respect_members`, `fractal_sessions`,
  `fractal_scores`.
- New tables: `bot_commands` (the command queue) and NextAuth's own
  session/account tables.
- `packages/shared` is the single place `computeRespectWeight` and the
  config constants (`RESPECT_POINTS`, contract addresses) live - both
  `src/` and `web/` import from here, closing the two-formula drift risk
  flagged in doc 981.

## Testing

- Vitest across `packages/shared` (already has passing tests from the
  initial bot scaffold - `voteThreshold.test.ts`, `respectWeight.test.ts`).
- New Vitest coverage for the command-queue insert/idempotency logic.
- Extend the bot's test suite to cover command-handler execution (mock a
  Supabase Realtime event, assert the correct internal function - e.g.
  randomize - gets invoked with the right params).

## Explicitly out of scope for this phase

- Updating ZAOOS's `/respect` page to point here - separate repo, separate
  PR, tracked but not part of this build.
- Any change to the bot's hosting/deployment target - the HTTP fallback's
  public-endpoint requirement is flagged above but not solved here.
