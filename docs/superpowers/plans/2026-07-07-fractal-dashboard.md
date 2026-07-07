# Fractal Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Next.js dashboard (`web/`) for the ZAO Fractal bot, with Discord OAuth + SIWE login, an admin view that controls the live bot via a Supabase command queue (with HTTP fallback), and a member view with a migrated Respect leaderboard - all sharing one Respect-scoring implementation with the bot via a new `packages/shared` workspace.

**Architecture:** npm workspaces monorepo: existing bot at repo root (`src/`), new `packages/shared` (Respect formula + config constants, consumed by both), new `web/` (Next.js 14 App Router dashboard). The bot and dashboard talk through Supabase: a new `bot_commands` table is the primary command channel (Realtime subscription on the bot side), with a small authenticated HTTP server on the bot as fallback.

**Tech Stack:** TypeScript (strict), discord.js 14.26.4, viem 2.54.6, `@supabase/supabase-js` ^2.45.0, Next.js 14, NextAuth (Auth.js) v5 beta, `siwe` for Sign-In-With-Ethereum, Express (bot's fallback HTTP server), Vitest for all tests.

## Global Constraints

- Node >= 20 (per root `package.json` `engines`).
- `discord.js@14.26.4`, `viem@2.54.6` - exact versions already pinned, do not bump without cause.
- TypeScript `strict: true` everywhere (root `tsconfig.json` already sets this - new `tsconfig.json` files must match).
- All tests via Vitest (`vitest run`), no other test runner.
- `packages/shared` is the only place `computeRespectWeight` and the config constants (`RESPECT_POINTS`, contract addresses) may be defined. Nothing outside it redefines them.
- `bot_commands` row access is gated by the Supreme Admin Discord-role check - same authorization concept the bot itself already uses (`is_supreme_admin` pattern from the Python bot's `BaseCog`).
- The bot's HTTP fallback endpoints are protected by a shared secret header (`x-bot-api-secret`, from `BOT_API_SECRET` env var) - never left open.
- Every command carries an idempotency key; both the queue path and the HTTP fallback path resolve through one `executeCommand` function so a command can never run twice for the same key.
- HTTP fallback triggers if the queue hasn't acknowledged (row status != `pending`) within **10 seconds**.
- This plan implements exactly one action type end-to-end: `randomize`. Other actions (`force_round`, `reset_waiting_room`, `end_fractal`) follow the identical pattern in a future plan - do not stub them here.

---

## Phase 1: Shared package + workspace setup

### Task 1: Convert to npm workspaces, extract `packages/shared`

**Files:**
- Modify: `package.json` (repo root)
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Move: `src/config.ts` -> `packages/shared/src/config.ts`
- Move: `src/lib/respectWeight.ts` -> `packages/shared/src/respectWeight.ts`
- Move: `src/lib/respectWeight.test.ts` -> `packages/shared/src/respectWeight.test.ts`
- Modify: `src/lib/voteThreshold.ts` (no content change - stays bot-only, imports `RESPECT_POINTS` etc. from `@fractalbot/shared` if it ever needs to; currently it doesn't import config at all)
- Create: `vitest.config.ts` (repo root, so root `vitest run` only picks up `src/**`, not the workspace packages)

**Interfaces:**
- Produces: `@fractalbot/shared` package exporting `computeRespectWeight`, `BalanceRead`, `RespectWeight` (from `respectWeight.ts`) and `OG_RESPECT_ADDRESS`, `ZOR_RESPECT_ADDRESS`, `OREC_EXECUTOR_ADDRESS`, `ZOR_TOKEN_ID`, `RESPECT_POINTS`, `MAX_GROUP_MEMBERS`, `MIN_GROUP_MEMBERS`, `STARTING_LEVEL`, `ENDING_LEVEL`, `OPTIMISM_RPC_URL` (from `config.ts`) - all re-exported from `packages/shared/src/index.ts`.

- [ ] **Step 1: Create the shared package's `package.json`**

```json
{
  "name": "@fractalbot/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "viem": "2.54.6"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^1.6.0"
  }
}
```

Save as `packages/shared/package.json`.

- [ ] **Step 2: Create the shared package's `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

Save as `packages/shared/tsconfig.json`.

- [ ] **Step 3: Move `config.ts` and `respectWeight.ts` (+ its test) into the shared package**

```bash
mkdir -p packages/shared/src
git mv src/config.ts packages/shared/src/config.ts
git mv src/lib/respectWeight.ts packages/shared/src/respectWeight.ts
git mv src/lib/respectWeight.test.ts packages/shared/src/respectWeight.test.ts
```

The moved files' contents are unchanged - `config.ts` and `respectWeight.ts` don't import anything from elsewhere in `src/`, so no import paths inside them need fixing.

- [ ] **Step 4: Create the shared package's barrel export**

```typescript
export * from './config.js';
export * from './respectWeight.js';
```

Save as `packages/shared/src/index.ts`.

- [ ] **Step 5: Add npm workspaces to the root `package.json`**

Modify `package.json` (repo root) - add a `"workspaces"` field and a dependency on the new shared package:

```json
{
  "name": "fractalbotjuly2026",
  "version": "0.1.0",
  "private": true,
  "description": "ZAO Fractal Discord bot - discord.js + viem + Supabase rebuild",
  "type": "module",
  "workspaces": [
    "packages/*",
    "web"
  ],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "npm run build -w @fractalbot/shared && tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:all": "npm test -w @fractalbot/shared && npm test -w web && npm test",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fractalbot/shared": "*",
    "discord.js": "14.26.4",
    "viem": "2.54.6",
    "@ordao/orclient": "latest",
    "@supabase/supabase-js": "^2.45.0",
    "dotenv": "^16.4.5"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "typescript": "^5.5.4",
    "tsx": "^4.16.2",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 6: Create a root `vitest.config.ts` scoping tests to `src/`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

Save as `vitest.config.ts` (repo root). Without this, root `vitest run` would also try to pick up `packages/shared/src/**/*.test.ts` and `web/**/*.test.ts`, double-running those suites.

- [ ] **Step 7: Install workspace dependencies and build the shared package**

Run: `npm install`
Expected: npm links `@fractalbot/shared` from `packages/shared` into the workspace (no network fetch for it, it's a symlink).

Run: `npm run build -w @fractalbot/shared`
Expected: creates `packages/shared/dist/index.js`, `dist/config.js`, `dist/respectWeight.js`, and matching `.d.ts` files, no errors.

- [ ] **Step 8: Verify the shared package's own tests pass from the new location**

Run: `npm test -w @fractalbot/shared`
Expected:
```
✓ src/respectWeight.test.ts (3 tests)
Test Files  1 passed (1)
     Tests  10 passed (10)
```
(exact count: 3 tests, matching the file moved unchanged from the original scaffold)

- [ ] **Step 9: Verify the bot's own remaining tests still pass**

Run: `npm test`
Expected:
```
✓ src/lib/voteThreshold.test.ts (7 tests)
Test Files  1 passed (1)
     Tests  7 passed (7)
```

- [ ] **Step 10: Typecheck the whole workspace**

Run: `npm run typecheck -w @fractalbot/shared && npm run typecheck`
Expected: both exit 0 with no output.

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json vitest.config.ts packages/shared
git commit -m "Extract packages/shared: computeRespectWeight + config, workspace setup"
```

---

## Phase 2: Supabase schema + bot command queue

### Task 2: Create the `bot_commands` table migration

**Files:**
- Create: `supabase/migrations/0001_bot_commands.sql`

**Interfaces:**
- Produces: a `bot_commands` Postgres table with columns `id`, `action`, `params`, `idempotency_key`, `requested_by`, `status`, `result`, `created_at`, `completed_at`, consumed by Task 3 (bot's `executeCommand`) and Task 11 (dashboard's `dispatchCommand` API route).

- [ ] **Step 1: Write the migration SQL**

```sql
create table if not exists public.bot_commands (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  params jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique,
  requested_by text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  result jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists bot_commands_status_idx on public.bot_commands (status);

alter table public.bot_commands enable row level security;

-- Only rows inserted through the service role (Next.js API route, after the
-- Supreme Admin check) or the bot's own service-role connection may touch
-- this table - no anon/authenticated-role policy is defined, which means
-- only requests using the Supabase service role key can read/write it.
```

Save as `supabase/migrations/0001_bot_commands.sql`.

- [ ] **Step 2: Apply the migration**

Run: `supabase db push` (or execute the SQL file directly against the project's Supabase instance via the SQL editor if the CLI isn't linked locally)
Expected: `bot_commands` table exists; verify with:

Run: `supabase db diff --linked` (or a direct query) to confirm no pending diff.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_bot_commands.sql
git commit -m "Add bot_commands table migration"
```

---

### Task 3: `executeCommand` - the shared dedupe-and-run function (bot side)

**Files:**
- Create: `src/commands/executeCommand.ts`
- Create: `src/commands/executeCommand.test.ts`
- Create: `src/commands/randomize.ts`
- Create: `src/commands/randomize.test.ts`
- Create: `src/lib/supabaseClient.ts`

**Interfaces:**
- Consumes: `RESPECT_POINTS`, `MAX_GROUP_MEMBERS` from `@fractalbot/shared` (not needed by `randomize.ts` itself, but `MAX_GROUP_MEMBERS` is - see Step 4).
- Produces:
  - `distributeIntoGroups(memberIds: string[], maxGroupSize: number): string[][]` from `src/commands/randomize.ts` - pure grouping algorithm, consumed directly by this task's own `executeCommand` (Step 8 below), and indirectly by Task 4's Realtime listener and Task 5's HTTP route (both call `executeCommand`, never `distributeIntoGroups` directly).
  - `executeCommand(supabase: SupabaseClient, action: string, params: Record<string, unknown>, idempotencyKey: string, requestedBy: string): Promise<{ status: 'done' | 'failed' | 'already_processed'; result?: unknown }>` from `src/commands/executeCommand.ts` - called by both the Realtime listener (Task 4) and the HTTP fallback route (Task 5).
  - `getSupabaseClient(): SupabaseClient` from `src/lib/supabaseClient.ts`.

- [ ] **Step 1: Write the failing test for the pure grouping algorithm**

```typescript
import { describe, expect, it } from 'vitest';
import { distributeIntoGroups } from './randomize.js';

describe('distributeIntoGroups', () => {
  it('splits members evenly into groups no larger than maxGroupSize', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const groups = distributeIntoGroups(members, 6);
    expect(groups.length).toBe(2);
    expect(groups.flat().sort()).toEqual([...members].sort());
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(6);
    }
  });

  it('returns one group when everyone fits', () => {
    const groups = distributeIntoGroups(['a', 'b', 'c'], 6);
    expect(groups).toEqual([['a', 'b', 'c']]);
  });

  it('returns an empty array for an empty member list', () => {
    expect(distributeIntoGroups([], 6)).toEqual([]);
  });
});
```

Save as `src/commands/randomize.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `Cannot find module './randomize.js'`

- [ ] **Step 3: Implement `distributeIntoGroups`**

```typescript
/** Greedy round-robin distribution: always place the next member into the
 * currently-smallest group. Deterministic given the same input order - the
 * caller is responsible for shuffling `memberIds` first if randomness is
 * wanted (kept separate so this function stays trivially testable). */
export function distributeIntoGroups(memberIds: string[], maxGroupSize: number): string[][] {
  if (memberIds.length === 0) return [];

  const groupCount = Math.ceil(memberIds.length / maxGroupSize);
  const groups: string[][] = Array.from({ length: groupCount }, () => []);

  for (const memberId of memberIds) {
    const smallest = groups.reduce((min, group, idx) =>
      group.length < groups[min].length ? idx : min, 0);
    groups[smallest].push(memberId);
  }

  return groups;
}
```

Save as `src/commands/randomize.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected:
```
✓ src/commands/randomize.test.ts (3 tests)
✓ src/lib/voteThreshold.test.ts (7 tests)
Test Files  2 passed (2)
     Tests  10 passed (10)
```

- [ ] **Step 5: Create the Supabase client wrapper**

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

/** Service-role Supabase client for the bot process. Never expose
 * SUPABASE_SERVICE_ROLE_KEY to any browser-facing code - this file must
 * only ever run in the bot's Node process. */
export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  client = createClient(url, key);
  return client;
}
```

Save as `src/lib/supabaseClient.ts`.

- [ ] **Step 6: Write the failing test for `executeCommand`'s dedupe behavior**

```typescript
import { describe, expect, it, vi } from 'vitest';
import { executeCommand } from './executeCommand.js';

function makeFakeSupabase(existingRow: Record<string, unknown> | null) {
  const updateCalls: Record<string, unknown>[] = [];
  return {
    updateCalls,
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => {
            if (existingRow) {
              return { data: null, error: { code: '23505' } }; // unique_violation
            }
            return { data: { id: 'row-1', status: 'processing' }, error: null };
          },
        }),
      }),
      select: () => ({
        eq: () => ({
          single: async () => ({ data: existingRow, error: null }),
        }),
      }),
      update: (values: Record<string, unknown>) => ({
        eq: () => {
          updateCalls.push(values);
          return { then: (resolve: (v: unknown) => void) => resolve({ error: null }) };
        },
      }),
    }),
  };
}

describe('executeCommand', () => {
  it('runs the action and marks the row done on first execution', async () => {
    const supabase = makeFakeSupabase(null);
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b', 'c'], maxGroupSize: 6 },
      'idem-key-1',
      'admin-discord-id',
    );
    expect(result.status).toBe('done');
    expect(supabase.updateCalls[0]).toMatchObject({ status: 'done' });
  });

  it('returns already_processed without re-running when the row is already done', async () => {
    const supabase = makeFakeSupabase({ id: 'row-1', status: 'done', result: { groups: [['a']] } });
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a'], maxGroupSize: 6 },
      'idem-key-1',
      'admin-discord-id',
    );
    expect(result.status).toBe('already_processed');
    expect(supabase.updateCalls.length).toBe(0);
  });

  it('rejects an unknown action', async () => {
    const supabase = makeFakeSupabase(null);
    await expect(
      executeCommand(supabase as any, 'nonexistent_action', {}, 'idem-key-2', 'admin-discord-id'),
    ).rejects.toThrow('Unknown action: nonexistent_action');
  });
});
```

Save as `src/commands/executeCommand.test.ts`.

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `Cannot find module './executeCommand.js'`

- [ ] **Step 8: Implement `executeCommand`**

```typescript
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
```

Save as `src/commands/executeCommand.ts`.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test`
Expected:
```
✓ src/commands/executeCommand.test.ts (3 tests)
✓ src/commands/randomize.test.ts (3 tests)
✓ src/lib/voteThreshold.test.ts (7 tests)
Test Files  3 passed (3)
     Tests  13 passed (13)
```

- [ ] **Step 10: Commit**

```bash
git add src/commands src/lib/supabaseClient.ts
git commit -m "Add executeCommand with idempotent dedupe + randomize action"
```

---

### Task 4: Bot subscribes to `bot_commands` via Supabase Realtime

**Files:**
- Create: `src/commands/subscribeToCommands.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` from `src/lib/supabaseClient.ts`, `executeCommand` from `src/commands/executeCommand.ts`.
- Produces: `subscribeToCommands(supabase: SupabaseClient): RealtimeChannel` - called once from `src/index.ts` at bot startup.

- [ ] **Step 1: Implement the Realtime subscription**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeCommand } from './executeCommand.js';

/** Listens for new rows in bot_commands and executes them. Only reacts to
 * status='pending' inserts - rows inserted directly as 'processing' (e.g.
 * by the HTTP fallback racing ahead) are left alone since executeCommand's
 * own dedupe already claimed them. */
export function subscribeToCommands(supabase: SupabaseClient) {
  return supabase
    .channel('bot_commands_listener')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'bot_commands' },
      async (payload) => {
        const row = payload.new as { action: string; params: Record<string, unknown>; idempotency_key: string; requested_by: string; status: string };
        if (row.status !== 'pending') return;

        try {
          await executeCommand(supabase, row.action, row.params, row.idempotency_key, row.requested_by);
        } catch (err) {
          console.error(`Failed to execute command ${row.idempotency_key}:`, err);
        }
      },
    )
    .subscribe();
}
```

Save as `src/commands/subscribeToCommands.ts`. Not unit tested directly (it's a thin wrapper over Supabase's own Realtime API, which requires a live connection) - the logic it delegates to (`executeCommand`) already has full coverage from Task 3.

- [ ] **Step 2: Wire it into bot startup**

Modify `src/index.ts` - add the subscription after login:

```typescript
import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { subscribeToCommands } from './commands/subscribeToCommands.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required - see .env.example');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const supabase = getSupabaseClient();
  subscribeToCommands(supabase);
  console.log('Subscribed to bot_commands');
});

await client.login(token);
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/commands/subscribeToCommands.ts src/index.ts
git commit -m "Subscribe bot to bot_commands Realtime channel on startup"
```

---

### Task 5: Bot HTTP fallback server

**Files:**
- Create: `src/http/server.ts`
- Create: `src/http/server.test.ts`
- Modify: `src/index.ts`
- Modify: `package.json` (add `express` dependency)
- Modify: `.env.example`

**Interfaces:**
- Consumes: `executeCommand` from `src/commands/executeCommand.ts`, `getSupabaseClient` from `src/lib/supabaseClient.ts`.
- Produces: `createHttpServer(supabase: SupabaseClient): express.Express` - an Express app exposing `POST /commands/:action`, started from `src/index.ts`.

- [ ] **Step 1: Add `express` to dependencies**

Run: `npm install express @types/express`
Expected: adds `express` to `dependencies` and `@types/express` to `devDependencies` in `package.json`, updates `package-lock.json`.

- [ ] **Step 2: Write the failing test for auth + dispatch behavior**

```typescript
import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createHttpServer } from './server.js';

vi.mock('../commands/executeCommand.js', () => ({
  executeCommand: vi.fn(async () => ({ status: 'done', result: { groups: [['a', 'b']] } })),
}));

describe('createHttpServer', () => {
  const fakeSupabase = {} as any;

  it('rejects requests missing the shared secret', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(401);
  });

  it('accepts requests with the correct shared secret and runs the command', async () => {
    const app = createHttpServer(fakeSupabase, 'correct-secret');
    const res = await request(app)
      .post('/commands/randomize')
      .set('x-bot-api-secret', 'correct-secret')
      .send({ params: { memberIds: ['a', 'b'], maxGroupSize: 6 }, idempotencyKey: 'k1', requestedBy: 'admin1' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'done' });
  });
});
```

Save as `src/http/server.test.ts`.

- [ ] **Step 3: Install the test-only `supertest` dependency**

Run: `npm install -D supertest @types/supertest`

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL - `Cannot find module './server.js'`

- [ ] **Step 5: Implement the HTTP server**

```typescript
import express from 'express';
import type { SupabaseClient } from '@supabase/supabase-js';
import { executeCommand } from '../commands/executeCommand.js';

/** Fallback control surface for the dashboard when the Supabase command
 * queue doesn't ack in time. Every request must carry the shared secret in
 * `x-bot-api-secret` - there is no other authentication on this server, so
 * it must never be exposed without that header check passing first. */
export function createHttpServer(supabase: SupabaseClient, apiSecret: string) {
  const app = express();
  app.use(express.json());

  app.post('/commands/:action', async (req, res) => {
    if (req.header('x-bot-api-secret') !== apiSecret) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }

    const { params, idempotencyKey, requestedBy } = req.body as {
      params: Record<string, unknown>;
      idempotencyKey: string;
      requestedBy: string;
    };

    try {
      const result = await executeCommand(supabase, req.params.action, params, idempotencyKey, requestedBy);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  return app;
}
```

Save as `src/http/server.ts`.

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test`
Expected:
```
✓ src/http/server.test.ts (2 tests)
✓ src/commands/executeCommand.test.ts (3 tests)
✓ src/commands/randomize.test.ts (3 tests)
✓ src/lib/voteThreshold.test.ts (7 tests)
Test Files  4 passed (4)
     Tests  15 passed (15)
```

- [ ] **Step 7: Wire the server into bot startup**

Modify `src/index.ts` - start the HTTP server alongside the Realtime subscription:

```typescript
import 'dotenv/config';
import { Client, Events, GatewayIntentBits } from 'discord.js';
import { getSupabaseClient } from './lib/supabaseClient.js';
import { subscribeToCommands } from './commands/subscribeToCommands.js';
import { createHttpServer } from './http/server.js';

const token = process.env.DISCORD_TOKEN;
if (!token) {
  throw new Error('DISCORD_TOKEN is required - see .env.example');
}
const apiSecret = process.env.BOT_API_SECRET;
if (!apiSecret) {
  throw new Error('BOT_API_SECRET is required - see .env.example');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);

  const supabase = getSupabaseClient();
  subscribeToCommands(supabase);
  console.log('Subscribed to bot_commands');

  const port = Number(process.env.HTTP_PORT ?? 8080);
  createHttpServer(supabase, apiSecret).listen(port, () => {
    console.log(`HTTP fallback server listening on port ${port}`);
  });
});

await client.login(token);
```

- [ ] **Step 8: Add the new env vars to `.env.example`**

```
DISCORD_TOKEN=your_discord_token_here
OPTIMISM_RPC_URL=https://mainnet.optimism.io
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
BOT_PRIVATE_KEY=
BOT_API_SECRET=
HTTP_PORT=8080
```

- [ ] **Step 9: Typecheck**

Run: `npm run typecheck`
Expected: exit 0, no errors.

- [ ] **Step 10: Commit**

```bash
git add src/http package.json package-lock.json .env.example
git commit -m "Add authenticated HTTP fallback server for bot commands"
```

---

## Phase 3: Dashboard scaffold + auth

### Task 6: Next.js app scaffold under `web/`

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.mjs`
- Create: `web/vitest.config.ts`
- Create: `web/app/layout.tsx`
- Create: `web/app/page.tsx`

**Interfaces:**
- Consumes: `@fractalbot/shared` (workspace dependency).
- Produces: a running Next.js dev server, and `web`'s own `vitest run` test command for later tasks.

- [ ] **Step 1: Create `web/package.json`**

```json
{
  "name": "@fractalbot/web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@fractalbot/shared": "*",
    "@supabase/supabase-js": "^2.45.0",
    "next": "14.2.5",
    "next-auth": "5.0.0-beta.20",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "siwe": "^2.3.2",
    "viem": "2.54.6",
    "wagmi": "^2.12.0"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "typescript": "^5.5.4",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `web/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "incremental": true,
    "plugins": [{ "name": "next" }]
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Create `web/next.config.mjs`**

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@fractalbot/shared'],
};

export default nextConfig;
```

- [ ] **Step 4: Create `web/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.test.ts', '**/*.test.tsx'],
    exclude: ['node_modules', '.next'],
  },
});
```

- [ ] **Step 5: Create a minimal root layout and home page**

```tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

Save as `web/app/layout.tsx`.

```tsx
export default function HomePage() {
  return <h1>ZAO Fractal Dashboard</h1>;
}
```

Save as `web/app/page.tsx`.

- [ ] **Step 6: Install and build**

Run: `npm install`
Expected: links `@fractalbot/web` into the workspace, installs Next.js and its deps.

Run: `npm run build -w @fractalbot/web`
Expected: `Compiled successfully`, no type errors.

- [ ] **Step 7: Verify the (currently empty) web test command runs cleanly**

Run: `npm test -w @fractalbot/web`
Expected: `No test files found` is acceptable at this stage - Task 7 onward adds real tests. Confirm the command exits 0, not that it finds tests yet.

- [ ] **Step 8: Commit**

```bash
git add web package.json package-lock.json
git commit -m "Scaffold Next.js dashboard app under web/"
```

---

### Task 7: SIWE signature verification (pure, testable logic)

**Files:**
- Create: `web/lib/siwe.ts`
- Create: `web/lib/siwe.test.ts`

**Interfaces:**
- Produces: `verifySiweSignature(message: string, signature: `0x${string}`): Promise<{ address: string; valid: boolean }>` - consumed by Task 8's NextAuth Credentials provider.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';
import { verifySiweSignature } from './siwe.js';

describe('verifySiweSignature', () => {
  it('validates a correctly-signed SIWE message', async () => {
    const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890a');
    const siweMessage = new SiweMessage({
      domain: 'localhost',
      address: account.address,
      statement: 'Sign in to ZAO Fractal Dashboard',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 10,
      nonce: 'abcd1234',
    });
    const preparedMessage = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: preparedMessage });

    const result = await verifySiweSignature(preparedMessage, signature);
    expect(result.valid).toBe(true);
    expect(result.address.toLowerCase()).toBe(account.address.toLowerCase());
  });

  it('rejects a tampered message', async () => {
    const account = privateKeyToAccount('0x0123456789012345678901234567890123456789012345678901234567890a');
    const siweMessage = new SiweMessage({
      domain: 'localhost',
      address: account.address,
      statement: 'Sign in to ZAO Fractal Dashboard',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 10,
      nonce: 'abcd1234',
    });
    const preparedMessage = siweMessage.prepareMessage();
    const signature = await account.signMessage({ message: preparedMessage });

    const result = await verifySiweSignature(preparedMessage.replace('abcd1234', 'zzzz9999'), signature);
    expect(result.valid).toBe(false);
  });
});
```

Save as `web/lib/siwe.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './siwe.js'`

- [ ] **Step 3: Implement `verifySiweSignature`**

```typescript
import { createPublicClient, http } from 'viem';
import { optimism } from 'viem/chains';
import { SiweMessage } from 'siwe';

const client = createPublicClient({ chain: optimism, transport: http() });

/** Verifies a SIWE-signed message and returns the recovered address. Uses
 * viem's verifyMessage (which also handles smart-contract wallets via
 * ERC-6492/1271) rather than a raw ecrecover, so Safe/smart-account signers
 * work too, not just EOAs. */
export async function verifySiweSignature(
  message: string,
  signature: `0x${string}`,
): Promise<{ address: string; valid: boolean }> {
  const siwe = new SiweMessage(message);

  const valid = await client.verifyMessage({
    address: siwe.address as `0x${string}`,
    message,
    signature,
  });

  return { address: siwe.address, valid };
}
```

Save as `web/lib/siwe.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/siwe.test.ts (2 tests)
Test Files  1 passed (1)
     Tests  2 passed (2)
```

- [ ] **Step 5: Commit**

```bash
git add web/lib/siwe.ts web/lib/siwe.test.ts
git commit -m "Add SIWE signature verification"
```

---

### Task 8: Identity reconciliation (Discord + wallet -> one member)

**Files:**
- Create: `web/lib/resolveMemberIdentity.ts`
- Create: `web/lib/resolveMemberIdentity.test.ts`
- Create: `web/lib/supabaseClient.ts`

**Interfaces:**
- Consumes: a Supabase client reading the existing wallet-registry table (`wallets` - Discord ID -> wallet address, as already written by the bot's `/register` command).
- Produces: `resolveMemberIdentity(supabase: SupabaseClient, identity: { discordId?: string; walletAddress?: string }): Promise<{ discordId: string | null; walletAddress: string | null; linked: boolean }>` - consumed by Task 9's NextAuth callbacks.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { resolveMemberIdentity } from './resolveMemberIdentity.js';

function makeFakeSupabase(rows: { discord_id: string; wallet_address: string }[]) {
  return {
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            const row = rows.find((r) => (r as any)[column] === value);
            return { data: row ?? null, error: null };
          },
        }),
      }),
    }),
  };
}

describe('resolveMemberIdentity', () => {
  it('resolves a Discord login to its linked wallet', async () => {
    const supabase = makeFakeSupabase([{ discord_id: 'discord-1', wallet_address: '0xabc' }]);
    const result = await resolveMemberIdentity(supabase as any, { discordId: 'discord-1' });
    expect(result).toEqual({ discordId: 'discord-1', walletAddress: '0xabc', linked: true });
  });

  it('resolves a wallet login to its linked Discord ID', async () => {
    const supabase = makeFakeSupabase([{ discord_id: 'discord-1', wallet_address: '0xabc' }]);
    const result = await resolveMemberIdentity(supabase as any, { walletAddress: '0xabc' });
    expect(result).toEqual({ discordId: 'discord-1', walletAddress: '0xabc', linked: true });
  });

  it('returns a partial identity when there is no link yet', async () => {
    const supabase = makeFakeSupabase([]);
    const result = await resolveMemberIdentity(supabase as any, { discordId: 'discord-2' });
    expect(result).toEqual({ discordId: 'discord-2', walletAddress: null, linked: false });
  });
});
```

Save as `web/lib/resolveMemberIdentity.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './resolveMemberIdentity.js'`

- [ ] **Step 3: Create the web app's Supabase client**

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

export function getSupabaseClient(): SupabaseClient {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  }

  client = createClient(url, key);
  return client;
}
```

Save as `web/lib/supabaseClient.ts`.

- [ ] **Step 4: Implement `resolveMemberIdentity`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

interface PartialIdentity {
  discordId?: string;
  walletAddress?: string;
}

interface ResolvedIdentity {
  discordId: string | null;
  walletAddress: string | null;
  linked: boolean;
}

/** Looks up the `wallets` table (Discord ID <-> wallet address, the same
 * table the bot's /register command writes to) to merge a Discord login or
 * a SIWE wallet login into one member identity. */
export async function resolveMemberIdentity(
  supabase: SupabaseClient,
  identity: PartialIdentity,
): Promise<ResolvedIdentity> {
  if (identity.discordId) {
    const { data } = await supabase
      .from('wallets')
      .select()
      .eq('discord_id', identity.discordId)
      .maybeSingle();

    return {
      discordId: identity.discordId,
      walletAddress: data?.wallet_address ?? null,
      linked: Boolean(data),
    };
  }

  if (identity.walletAddress) {
    const { data } = await supabase
      .from('wallets')
      .select()
      .eq('wallet_address', identity.walletAddress)
      .maybeSingle();

    return {
      discordId: data?.discord_id ?? null,
      walletAddress: identity.walletAddress,
      linked: Boolean(data),
    };
  }

  return { discordId: null, walletAddress: null, linked: false };
}
```

Save as `web/lib/resolveMemberIdentity.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/resolveMemberIdentity.test.ts (3 tests)
✓ lib/siwe.test.ts (2 tests)
Test Files  2 passed (2)
     Tests  5 passed (5)
```

- [ ] **Step 6: Commit**

```bash
git add web/lib/resolveMemberIdentity.ts web/lib/resolveMemberIdentity.test.ts web/lib/supabaseClient.ts
git commit -m "Add identity reconciliation between Discord and wallet logins"
```

---

### Task 9: NextAuth setup (Discord OAuth + SIWE Credentials + guild roles)

**Files:**
- Create: `web/lib/getGuildMemberRoleIds.ts`
- Create: `web/lib/getGuildMemberRoleIds.test.ts`
- Create: `web/auth.ts`
- Create: `web/app/api/auth/[...nextauth]/route.ts`
- Modify: `web/.env.example` (create if absent)

**Interfaces:**
- Consumes: `verifySiweSignature` (Task 7), `resolveMemberIdentity` (Task 8), `getSupabaseClient` (Task 8).
- Produces:
  - `getGuildMemberRoleIds(discordId: string, guildId: string, botToken: string): Promise<string[]>`.
  - `auth`, `signIn`, `signOut`, `handlers` exported from `web/auth.ts`. The session object carries `discordId: string | null`, `walletAddress: string | null`, and **`discordRoleIds: string[]`** - this last field is what Task 11 (admin API route), Task 12 (admin page), Task 13 (audit log), and Task 14 (wallet registry page) all read via `isSupremeAdmin(discordRoleIds, ...)`. Every later task that checks admin access depends on this field actually being populated here, not left undefined.

- [ ] **Step 1: Write the failing test for guild role lookup**

```typescript
import { describe, expect, it, vi, afterEach } from 'vitest';
import { getGuildMemberRoleIds } from './getGuildMemberRoleIds.js';

describe('getGuildMemberRoleIds', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the roles array from the Discord API response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ roles: ['111', '222'] }) })),
    );

    const roles = await getGuildMemberRoleIds('discord-1', 'guild-1', 'bot-token');
    expect(roles).toEqual(['111', '222']);
    expect(fetch).toHaveBeenCalledWith(
      'https://discord.com/api/v10/guilds/guild-1/members/discord-1',
      expect.objectContaining({ headers: { Authorization: 'Bot bot-token' } }),
    );
  });

  it('returns an empty array if the member is not found (404)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    const roles = await getGuildMemberRoleIds('discord-2', 'guild-1', 'bot-token');
    expect(roles).toEqual([]);
  });
});
```

Save as `web/lib/getGuildMemberRoleIds.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './getGuildMemberRoleIds.js'`

- [ ] **Step 3: Implement `getGuildMemberRoleIds`**

```typescript
/** Looks up a guild member's role IDs using the bot's own token (not the
 * user's OAuth access token) - this avoids requiring the `guilds.members.read`
 * OAuth scope, which needs separate Discord approval for production apps.
 * The bot is already in the guild, so its own token can read member data
 * directly. Returns an empty array if the member can't be found (e.g. they
 * authenticated but aren't actually in the guild). */
export async function getGuildMemberRoleIds(discordId: string, guildId: string, botToken: string): Promise<string[]> {
  const response = await fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`, {
    headers: { Authorization: `Bot ${botToken}` },
  });

  if (!response.ok) return [];

  const member = (await response.json()) as { roles: string[] };
  return member.roles;
}
```

Save as `web/lib/getGuildMemberRoleIds.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/getGuildMemberRoleIds.test.ts (2 tests)
```

- [ ] **Step 5: Implement the NextAuth configuration**

```typescript
import NextAuth from 'next-auth';
import Discord from 'next-auth/providers/discord';
import Credentials from 'next-auth/providers/credentials';
import { verifySiweSignature } from './lib/siwe.js';
import { resolveMemberIdentity } from './lib/resolveMemberIdentity.js';
import { getGuildMemberRoleIds } from './lib/getGuildMemberRoleIds.js';
import { getSupabaseClient } from './lib/supabaseClient.js';

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Discord({
      clientId: process.env.DISCORD_CLIENT_ID!,
      clientSecret: process.env.DISCORD_CLIENT_SECRET!,
    }),
    Credentials({
      id: 'siwe',
      name: 'Ethereum',
      credentials: {
        message: { label: 'Message', type: 'text' },
        signature: { label: 'Signature', type: 'text' },
      },
      async authorize(credentials) {
        const message = credentials?.message as string | undefined;
        const signature = credentials?.signature as `0x${string}` | undefined;
        if (!message || !signature) return null;

        const { address, valid } = await verifySiweSignature(message, signature);
        if (!valid) return null;

        return { id: address, walletAddress: address };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      const supabase = getSupabaseClient();

      if (account?.provider === 'discord') {
        const identity = await resolveMemberIdentity(supabase, { discordId: account.providerAccountId });
        token.discordId = identity.discordId;
        token.walletAddress = identity.walletAddress;
      } else if (account?.provider === 'siwe' && user) {
        const identity = await resolveMemberIdentity(supabase, { walletAddress: (user as any).walletAddress });
        token.discordId = identity.discordId;
        token.walletAddress = identity.walletAddress;
      }

      token.discordRoleIds = token.discordId
        ? await getGuildMemberRoleIds(token.discordId as string, process.env.DISCORD_GUILD_ID!, process.env.DISCORD_BOT_TOKEN!)
        : [];

      return token;
    },
    async session({ session, token }) {
      (session as any).discordId = token.discordId;
      (session as any).walletAddress = token.walletAddress;
      (session as any).discordRoleIds = token.discordRoleIds ?? [];
      return session;
    },
  },
});
```

Save as `web/auth.ts`.

- [ ] **Step 6: Wire the App Router route handler**

```typescript
import { handlers } from '../../../../auth.js';

export const { GET, POST } = handlers;
```

Save as `web/app/api/auth/[...nextauth]/route.ts`.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 8: Add the required env vars**

Create `web/.env.example`:

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_BOT_TOKEN=
DISCORD_GUILD_ID=
NEXTAUTH_SECRET=
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=
```

- [ ] **Step 9: Commit**

```bash
git add web/lib/getGuildMemberRoleIds.ts web/lib/getGuildMemberRoleIds.test.ts web/auth.ts web/app/api/auth web/.env.example
git commit -m "Add NextAuth with Discord OAuth, SIWE, and guild role lookup for admin gating"
```

---

## Phase 4: Admin view

### Task 10: Supreme Admin authorization check

**Files:**
- Create: `web/lib/isSupremeAdmin.ts`
- Create: `web/lib/isSupremeAdmin.test.ts`

**Interfaces:**
- Produces: `isSupremeAdmin(discordRoleIds: string[], supremeAdminRoleId: string): boolean` - consumed by Task 11 (admin API route guard), Task 12 (admin sessions page guard), Task 13 (same page, audit log section), and Task 14 (wallet registry page guard).

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { isSupremeAdmin } from './isSupremeAdmin.js';

describe('isSupremeAdmin', () => {
  it('returns true when the role list includes the Supreme Admin role', () => {
    expect(isSupremeAdmin(['111', '222'], '222')).toBe(true);
  });

  it('returns false when the role list does not include it', () => {
    expect(isSupremeAdmin(['111', '333'], '222')).toBe(false);
  });

  it('returns false for an empty role list', () => {
    expect(isSupremeAdmin([], '222')).toBe(false);
  });
});
```

Save as `web/lib/isSupremeAdmin.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './isSupremeAdmin.js'`

- [ ] **Step 3: Implement it**

```typescript
/** Matches the same Supreme Admin role concept the bot itself checks
 * (SUPREME_ADMIN_ROLE_ID in the Python bot's config). discordRoleIds is
 * the caller's list of role IDs in the guild, fetched separately via the
 * Discord API using the OAuth access token. */
export function isSupremeAdmin(discordRoleIds: string[], supremeAdminRoleId: string): boolean {
  return discordRoleIds.includes(supremeAdminRoleId);
}
```

Save as `web/lib/isSupremeAdmin.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/isSupremeAdmin.test.ts (3 tests)
```
(plus all previously-added `web/lib/*.test.ts` files still passing)

- [ ] **Step 5: Commit**

```bash
git add web/lib/isSupremeAdmin.ts web/lib/isSupremeAdmin.test.ts
git commit -m "Add Supreme Admin role check for the dashboard"
```

---

### Task 11: Admin command API route (queue + HTTP fallback)

**Files:**
- Create: `web/app/api/commands/[action]/route.ts`
- Create: `web/lib/dispatchCommand.ts`
- Create: `web/lib/dispatchCommand.test.ts`

**Interfaces:**
- Consumes: `getSupabaseClient` (Task 8), `randomUUID` from Node's `crypto`.
- Produces: `dispatchCommand(supabase: SupabaseClient, action: string, params: Record<string, unknown>, requestedBy: string, botApiUrl: string, botApiSecret: string): Promise<{ status: string; result?: unknown }>` - consumed by the route handler.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { dispatchCommand } from './dispatchCommand.js';

describe('dispatchCommand', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the queue result when the bot acks within the poll window', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'row-1', idempotency_key: 'k1' }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { status: 'done', result: { groups: [['a']] } }, error: null }),
          }),
        }),
      }),
    };

    vi.stubGlobal('fetch', vi.fn());

    const result = await dispatchCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a'], maxGroupSize: 6 },
      'admin-1',
      'http://bot:8080',
      'secret',
      { pollIntervalMs: 1, timeoutMs: 20 },
    );

    expect(result.status).toBe('done');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the HTTP endpoint when the queue does not ack in time', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'row-1', idempotency_key: 'k2' }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { status: 'pending' }, error: null }),
          }),
        }),
      }),
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ status: 'done', result: { groups: [['a']] } }) })),
    );

    const result = await dispatchCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a'], maxGroupSize: 6 },
      'admin-1',
      'http://bot:8080',
      'secret',
      { pollIntervalMs: 1, timeoutMs: 5 },
    );

    expect(result.status).toBe('done');
    expect(fetch).toHaveBeenCalledWith(
      'http://bot:8080/commands/randomize',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
```

Save as `web/lib/dispatchCommand.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './dispatchCommand.js'`

- [ ] **Step 3: Implement `dispatchCommand`**

```typescript
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
```

Save as `web/lib/dispatchCommand.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/dispatchCommand.test.ts (2 tests)
```
(plus all previously-added `web/lib/*.test.ts` files still passing)

- [ ] **Step 5: Implement the API route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '../../../../auth.js';
import { getSupabaseClient } from '../../../../lib/supabaseClient.js';
import { isSupremeAdmin } from '../../../../lib/isSupremeAdmin.js';
import { dispatchCommand } from '../../../../lib/dispatchCommand.js';

export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  const session = await auth();
  if (!session || !(session as any).discordId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const discordRoleIds = (session as any).discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const supabase = getSupabaseClient();

  const result = await dispatchCommand(
    supabase,
    params.action,
    body.params ?? {},
    (session as any).discordId,
    process.env.BOT_API_URL!,
    process.env.BOT_API_SECRET!,
  );

  return NextResponse.json(result);
}
```

Save as `web/app/api/commands/[action]/route.ts`.

- [ ] **Step 6: Add the new env vars**

Modify `web/.env.example` - add:

```
SUPREME_ADMIN_ROLE_ID=
BOT_API_URL=
BOT_API_SECRET=
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 8: Commit**

```bash
git add web/app/api/commands web/lib/dispatchCommand.ts web/lib/dispatchCommand.test.ts web/.env.example
git commit -m "Add admin command API route with queue + HTTP fallback dispatch"
```

---

### Task 12: Admin UI page

**Files:**
- Create: `web/app/(admin)/sessions/page.tsx`
- Create: `web/app/(admin)/sessions/RandomizeButton.tsx`

**Interfaces:**
- Consumes: `auth` (Task 9), `isSupremeAdmin` (Task 10).
- Produces: the `/sessions` admin page, gated server-side.

- [ ] **Step 1: Implement the gated admin page**

```tsx
import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { isSupremeAdmin } from '../../../lib/isSupremeAdmin.js';
import { RandomizeButton } from './RandomizeButton.js';

export default async function SessionsPage() {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordRoleIds = (session as any).discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    redirect('/');
  }

  return (
    <main>
      <h1>Fractal Session Control</h1>
      <RandomizeButton />
    </main>
  );
}
```

Save as `web/app/(admin)/sessions/page.tsx`.

- [ ] **Step 2: Implement the client-side action button**

```tsx
'use client';

import { useState } from 'react';

export function RandomizeButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleClick() {
    setStatus('loading');
    try {
      const res = await fetch('/api/commands/randomize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: { memberIds: [], maxGroupSize: 6 } }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <button onClick={handleClick} disabled={status === 'loading'}>
      {status === 'loading' ? 'Randomizing...' : 'Randomize now'}
    </button>
  );
}
```

Save as `web/app/(admin)/sessions/RandomizeButton.tsx`.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add "web/app/(admin)"
git commit -m "Add admin sessions page with Randomize control"
```

---

### Task 13: Command audit log + live status on the admin page

**Files:**
- Create: `web/lib/getRecentCommands.ts`
- Create: `web/lib/getRecentCommands.test.ts`
- Modify: `web/app/(admin)/sessions/page.tsx`

**Interfaces:**
- Produces: `getRecentCommands(supabase: SupabaseClient, limit?: number): Promise<{ id: string; action: string; status: string; requestedBy: string; createdAt: string }[]>` - most recent first.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { getRecentCommands } from './getRecentCommands.js';

function makeFakeSupabase(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: async () => ({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

describe('getRecentCommands', () => {
  it('maps rows into the expected shape', async () => {
    const supabase = makeFakeSupabase([
      { id: 'row-1', action: 'randomize', status: 'done', requested_by: 'admin-1', created_at: '2026-07-07T00:00:00Z' },
    ]);
    const commands = await getRecentCommands(supabase as any);
    expect(commands).toEqual([
      { id: 'row-1', action: 'randomize', status: 'done', requestedBy: 'admin-1', createdAt: '2026-07-07T00:00:00Z' },
    ]);
  });

  it('returns an empty array when there are no commands yet', async () => {
    const supabase = makeFakeSupabase([]);
    expect(await getRecentCommands(supabase as any)).toEqual([]);
  });
});
```

Save as `web/lib/getRecentCommands.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './getRecentCommands.js'`

- [ ] **Step 3: Implement `getRecentCommands`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

interface CommandLogEntry {
  id: string;
  action: string;
  status: string;
  requestedBy: string;
  createdAt: string;
}

export async function getRecentCommands(supabase: SupabaseClient, limit = 20): Promise<CommandLogEntry[]> {
  const { data } = await supabase
    .from('bot_commands')
    .select()
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!data) return [];

  return data.map((row: any) => ({
    id: row.id,
    action: row.action,
    status: row.status,
    requestedBy: row.requested_by,
    createdAt: row.created_at,
  }));
}
```

Save as `web/lib/getRecentCommands.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/getRecentCommands.test.ts (2 tests)
```
(plus all previously-added `web/lib/*.test.ts` files still passing)

- [ ] **Step 5: Add the audit log + live status to the admin page**

Modify `web/app/(admin)/sessions/page.tsx` - add the recent-commands list below the `RandomizeButton`:

```tsx
import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { isSupremeAdmin } from '../../../lib/isSupremeAdmin.js';
import { getRecentCommands } from '../../../lib/getRecentCommands.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';
import { RandomizeButton } from './RandomizeButton.js';

export default async function SessionsPage() {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordRoleIds = (session as any).discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    redirect('/');
  }

  const supabase = getSupabaseClient();
  const recentCommands = await getRecentCommands(supabase);

  return (
    <main>
      <h1>Fractal Session Control</h1>
      <RandomizeButton />

      <h2>Recent Commands</h2>
      <table>
        <thead>
          <tr>
            <th>Action</th>
            <th>Status</th>
            <th>Requested By</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {recentCommands.map((cmd) => (
            <tr key={cmd.id}>
              <td>{cmd.action}</td>
              <td>{cmd.status}</td>
              <td>{cmd.requestedBy}</td>
              <td>{cmd.createdAt}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

This page is server-rendered on each request (no client-side polling in this
plan), so "live" here means fresh-on-reload, not push-updating - matches
what the queue/audit data already gives us without adding a Realtime
subscription to the frontend, which is a reasonable follow-up but not
required for the admin view to be useful today.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/getRecentCommands.ts web/lib/getRecentCommands.test.ts "web/app/(admin)/sessions/page.tsx"
git commit -m "Add command audit log to the admin sessions page"
```

---

### Task 14: Wallet registry admin page

**Files:**
- Create: `web/lib/getWalletRegistry.ts`
- Create: `web/lib/getWalletRegistry.test.ts`
- Create: `web/app/(admin)/wallets/page.tsx`

**Interfaces:**
- Produces: `getWalletRegistry(supabase: SupabaseClient, search?: string): Promise<{ discordId: string; walletAddress: string }[]>`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { getWalletRegistry } from './getWalletRegistry.js';

function makeFakeSupabase(rows: { discord_id: string; wallet_address: string }[]) {
  return {
    from: () => ({
      select: () => ({
        ilike: (_column: string, pattern: string) => ({
          then: async (resolve: (v: unknown) => void) => {
            const needle = pattern.replace(/%/g, '').toLowerCase();
            resolve({
              data: rows.filter(
                (r) => r.discord_id.toLowerCase().includes(needle) || r.wallet_address.toLowerCase().includes(needle),
              ),
              error: null,
            });
          },
        }),
        order: () => ({
          then: async (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
        }),
      }),
    }),
  };
}

describe('getWalletRegistry', () => {
  it('returns all wallets when no search term is given', async () => {
    const supabase = makeFakeSupabase([
      { discord_id: 'd1', wallet_address: '0xabc' },
      { discord_id: 'd2', wallet_address: '0xdef' },
    ]);
    const result = await getWalletRegistry(supabase as any);
    expect(result).toEqual([
      { discordId: 'd1', walletAddress: '0xabc' },
      { discordId: 'd2', walletAddress: '0xdef' },
    ]);
  });

  it('filters by search term against discord ID or wallet address', async () => {
    const supabase = makeFakeSupabase([
      { discord_id: 'd1', wallet_address: '0xabc' },
      { discord_id: 'd2', wallet_address: '0xdef' },
    ]);
    const result = await getWalletRegistry(supabase as any, 'def');
    expect(result).toEqual([{ discordId: 'd2', walletAddress: '0xdef' }]);
  });
});
```

Save as `web/lib/getWalletRegistry.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './getWalletRegistry.js'`

- [ ] **Step 3: Implement `getWalletRegistry`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';

interface WalletEntry {
  discordId: string;
  walletAddress: string;
}

export async function getWalletRegistry(supabase: SupabaseClient, search?: string): Promise<WalletEntry[]> {
  const query = supabase.from('wallets').select();
  const { data } = search
    ? await (query as any).ilike('wallet_address', `%${search}%`)
    : await (query as any).order('discord_id');

  if (!data) return [];

  return data.map((row: any) => ({ discordId: row.discord_id, walletAddress: row.wallet_address }));
}
```

Save as `web/lib/getWalletRegistry.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/getWalletRegistry.test.ts (2 tests)
```
(plus all previously-added `web/lib/*.test.ts` files still passing)

- [ ] **Step 5: Implement the wallet registry page**

```tsx
import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { isSupremeAdmin } from '../../../lib/isSupremeAdmin.js';
import { getWalletRegistry } from '../../../lib/getWalletRegistry.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';

export default async function WalletsPage({ searchParams }: { searchParams: { q?: string } }) {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordRoleIds = (session as any).discordRoleIds ?? [];
  if (!isSupremeAdmin(discordRoleIds, process.env.SUPREME_ADMIN_ROLE_ID!)) {
    redirect('/');
  }

  const supabase = getSupabaseClient();
  const wallets = await getWalletRegistry(supabase, searchParams.q);

  return (
    <main>
      <h1>Wallet Registry</h1>
      <form>
        <input type="text" name="q" defaultValue={searchParams.q ?? ''} placeholder="Search by wallet address" />
        <button type="submit">Search</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>Discord ID</th>
            <th>Wallet</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.discordId}>
              <td>{w.discordId}</td>
              <td>{w.walletAddress}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

Save as `web/app/(admin)/wallets/page.tsx`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/getWalletRegistry.ts web/lib/getWalletRegistry.test.ts "web/app/(admin)/wallets"
git commit -m "Add wallet registry admin page"
```

---

## Phase 5: Member view + leaderboard

### Task 15: Leaderboard data + page

**Files:**
- Create: `web/lib/getLeaderboard.ts`
- Create: `web/lib/getLeaderboard.test.ts`
- Create: `web/app/(public)/leaderboard/page.tsx`

**Interfaces:**
- Consumes: `computeRespectWeight` from `@fractalbot/shared`.
- Produces: `getLeaderboard(supabase: SupabaseClient): Promise<{ discordId: string; walletAddress: string; weight: number }[]>` - sorted descending by weight.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { getLeaderboard } from './getLeaderboard.js';

function makeFakeSupabase(rows: { discord_id: string; wallet_address: string; onchain_og: string; onchain_zor: string }[]) {
  return {
    from: () => ({
      select: async () => ({ data: rows, error: null }),
    }),
  };
}

describe('getLeaderboard', () => {
  it('sorts members by Respect weight, descending', async () => {
    const supabase = makeFakeSupabase([
      { discord_id: 'a', wallet_address: '0x1', onchain_og: '0', onchain_zor: '10' },
      { discord_id: 'b', wallet_address: '0x2', onchain_og: '1000000000000000000', onchain_zor: '0' }, // 1 OG
    ]);

    const leaderboard = await getLeaderboard(supabase as any);
    expect(leaderboard.map((m) => m.discordId)).toEqual(['b', 'a']);
    expect(leaderboard[0].weight).toBe(1);
    expect(leaderboard[1].weight).toBe(10);
  });

  it('returns an empty array when there are no members', async () => {
    const supabase = makeFakeSupabase([]);
    expect(await getLeaderboard(supabase as any)).toEqual([]);
  });
});
```

Save as `web/lib/getLeaderboard.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @fractalbot/web`
Expected: FAIL - `Cannot find module './getLeaderboard.js'`

- [ ] **Step 3: Implement `getLeaderboard`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeRespectWeight } from '@fractalbot/shared';

interface LeaderboardEntry {
  discordId: string;
  walletAddress: string;
  weight: number;
}

export async function getLeaderboard(supabase: SupabaseClient): Promise<LeaderboardEntry[]> {
  const { data } = await supabase.from('respect_members').select();
  if (!data) return [];

  const entries = data.map((row: any) => {
    const { weight } = computeRespectWeight(
      { status: 'success', result: BigInt(row.onchain_og ?? '0') },
      { status: 'success', result: BigInt(row.onchain_zor ?? '0') },
    );
    return { discordId: row.discord_id, walletAddress: row.wallet_address, weight };
  });

  return entries.sort((a, b) => b.weight - a.weight);
}
```

Save as `web/lib/getLeaderboard.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @fractalbot/web`
Expected:
```
✓ lib/getLeaderboard.test.ts (2 tests)
✓ lib/getWalletRegistry.test.ts (2 tests)
✓ lib/getRecentCommands.test.ts (2 tests)
✓ lib/dispatchCommand.test.ts (2 tests)
✓ lib/isSupremeAdmin.test.ts (3 tests)
✓ lib/getGuildMemberRoleIds.test.ts (2 tests)
✓ lib/resolveMemberIdentity.test.ts (3 tests)
✓ lib/siwe.test.ts (2 tests)
Test Files  8 passed (8)
     Tests  18 passed (18)
```

- [ ] **Step 5: Implement the public leaderboard page**

```tsx
import { getLeaderboard } from '../../../lib/getLeaderboard.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';

export default async function LeaderboardPage() {
  const supabase = getSupabaseClient();
  const leaderboard = await getLeaderboard(supabase);

  return (
    <main>
      <h1>ZAO Fractal Respect Leaderboard</h1>
      <table>
        <thead>
          <tr>
            <th>Rank</th>
            <th>Discord ID</th>
            <th>Wallet</th>
            <th>Respect</th>
          </tr>
        </thead>
        <tbody>
          {leaderboard.map((entry, i) => (
            <tr key={entry.discordId}>
              <td>{i + 1}</td>
              <td>{entry.discordId}</td>
              <td>{entry.walletAddress}</td>
              <td>{entry.weight}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
```

Save as `web/app/(public)/leaderboard/page.tsx`.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 7: Commit**

```bash
git add web/lib/getLeaderboard.ts web/lib/getLeaderboard.test.ts "web/app/(public)"
git commit -m "Add leaderboard data function and public leaderboard page"
```

---

### Task 16: Member profile page

**Files:**
- Create: `web/app/(member)/me/page.tsx`

**Interfaces:**
- Consumes: `auth` (Task 9), `resolveMemberIdentity` (Task 8), `getLeaderboard` (Task 15, reused to find the current member's row).

- [ ] **Step 1: Implement the profile page**

```tsx
import { redirect } from 'next/navigation';
import { auth } from '../../../auth.js';
import { getLeaderboard } from '../../../lib/getLeaderboard.js';
import { getSupabaseClient } from '../../../lib/supabaseClient.js';

export default async function ProfilePage() {
  const session = await auth();
  if (!session) redirect('/api/auth/signin');

  const discordId = (session as any).discordId as string | null;
  const walletAddress = (session as any).walletAddress as string | null;

  const supabase = getSupabaseClient();
  const leaderboard = await getLeaderboard(supabase);
  const me = leaderboard.find(
    (entry) => (discordId && entry.discordId === discordId) || (walletAddress && entry.walletAddress === walletAddress),
  );

  return (
    <main>
      <h1>My Profile</h1>
      <p>Discord: {discordId ?? 'not linked'}</p>
      <p>Wallet: {walletAddress ?? 'not linked'}</p>
      <p>Respect: {me?.weight ?? 0}</p>
    </main>
  );
}
```

Save as `web/app/(member)/me/page.tsx`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w @fractalbot/web`
Expected: exit 0, no errors.

- [ ] **Step 3: Commit**

```bash
git add "web/app/(member)"
git commit -m "Add member profile page"
```

---

## Final verification

- [ ] **Step 1: Run every test suite in the workspace**

Run: `npm run test:all`
Expected: all three workspaces (`@fractalbot/shared`, `@fractalbot/web`, root bot) report passing, zero failures.

- [ ] **Step 2: Typecheck every workspace**

Run: `npm run typecheck -w @fractalbot/shared && npm run typecheck -w @fractalbot/web && npm run typecheck`
Expected: all three exit 0.

- [ ] **Step 3: Build every workspace**

Run: `npm run build -w @fractalbot/shared && npm run build -w @fractalbot/web && npm run build`
Expected: all three succeed with no errors.

- [ ] **Step 4: Final commit if anything is outstanding**

```bash
git status --short
```

If clean, no further action. If anything is untracked/modified, review it and commit.

## Explicitly out of scope for this plan (per the design spec)

- Updating ZAOOS's `/respect` page to link to this dashboard instead of hosting its own copy - separate repo, separate PR.
- Additional command actions beyond `randomize` (`force_round`, `reset_waiting_room`, `end_fractal`) - same pattern, future plan.
- Actual deployment/hosting decision for the bot's public HTTPS endpoint (needed for the HTTP fallback to work outside local dev).
- The week-by-week historical fractal data verification pass - tracked separately, happens after this dashboard ships since it needs the admin/history views built here to be practical to use.
