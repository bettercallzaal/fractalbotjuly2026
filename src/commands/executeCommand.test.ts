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
