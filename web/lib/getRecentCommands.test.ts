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
