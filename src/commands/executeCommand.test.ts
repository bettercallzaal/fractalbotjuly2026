import { describe, expect, it } from 'vitest';
import { executeCommand } from './executeCommand.js';

interface MockScenario {
  existingRows: Record<string, any>[];
  updateToFinalStatusShouldFail?: boolean;
}

function makeFakeSupabase(scenario: MockScenario) {
  const rows = scenario.existingRows;

  return {
    from: () => ({
      update: (values: Record<string, any>) => {
        const isClaimUpdate = values.status === 'processing';

        if (isClaimUpdate) {
          // Claim update: update status to 'processing' where idempotency_key=X and status='pending'
          return {
            eq: (keyName: string, keyValue: string) => ({
              eq: (statusKeyName: string, statusValue: string) => ({
                select: () => ({
                  single: async () => {
                    const row = rows.find(
                      (r) => r.idempotency_key === keyValue && r.status === 'pending'
                    );
                    if (!row) {
                      return { data: null, error: { code: 'PGRST116' } };
                    }
                    row.status = 'processing';
                    return { data: row, error: null };
                  },
                }),
              }),
            }),
          };
        } else {
          // Final update: update status to 'done' or 'failed'
          // Return object with .eq() method that returns an awaitable
          const self = {
            eq: () => {
              // Return a thenable/awaitable object
              return Promise.resolve(
                scenario.updateToFinalStatusShouldFail
                  ? { error: { message: 'Simulated update failure' } }
                  : { error: null }
              );
            },
          };
          return self;
        }
      },

      select: () => ({
        eq: (keyName: string, keyValue: string) => ({
          maybeSingle: async () => {
            const row = rows.find((r) => r.idempotency_key === keyValue);
            return { data: row || null, error: null };
          },
        }),
      }),
    }),
  };
}

describe('executeCommand with UPDATE-based claiming', () => {
  it('(a) successfully claims pending row, runs action, and marks row done', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-a', status: 'pending', action: 'randomize', params: {} },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b', 'c'], maxGroupSize: 6 },
      'idem-a',
      'admin-discord-id'
    );

    expect(result.status).toBe('done');
    expect(result.result).toBeDefined();
    expect(result.result).toHaveProperty('groups');
  });

  it('(b) returns already_processed without re-running when row is already processing (race lost)', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-b', status: 'processing' },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b'], maxGroupSize: 6 },
      'idem-b',
      'admin-discord-id'
    );

    expect(result.status).toBe('already_processed');
  });

  it('(c) returns already_processed with existing result when row is already done', async () => {
    const existingRows = [
      {
        id: 'row-1',
        idempotency_key: 'idem-c',
        status: 'done',
        result: { groups: [['a', 'b']] },
      },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: ['a', 'b'], maxGroupSize: 6 },
      'idem-c',
      'admin-discord-id'
    );

    expect(result.status).toBe('already_processed');
    expect(result.result).toEqual({ groups: [['a', 'b']] });
  });

  it('(d) throws clear error when no row exists at all for the idempotency_key', async () => {
    const supabase = makeFakeSupabase({ existingRows: [] });

    await expect(
      executeCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a'], maxGroupSize: 6 },
        'idem-does-not-exist',
        'admin-discord-id'
      )
    ).rejects.toThrow('No pending command found for idempotency_key: idem-does-not-exist');
  });

  it('(e) rejects unknown action before attempting to claim', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-e', status: 'pending' },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    await expect(
      executeCommand(supabase as any, 'nonexistent_action', {}, 'idem-e', 'admin-discord-id')
    ).rejects.toThrow('Unknown action: nonexistent_action');
  });

  it('(f) catches action execution failure and records it as failed', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-f', status: 'pending' },
    ];
    const supabase = makeFakeSupabase({ existingRows });

    // Pass invalid memberIds to cause action to throw
    const result = await executeCommand(
      supabase as any,
      'randomize',
      { memberIds: { invalid: 'not-an-array' }, maxGroupSize: 6 },
      'idem-f',
      'admin-discord-id'
    );

    expect(result.status).toBe('failed');
  });

  it('(g) throws error if final update fails after successful execution', async () => {
    const existingRows = [
      { id: 'row-1', idempotency_key: 'idem-g', status: 'pending' },
    ];
    const supabase = makeFakeSupabase({ existingRows, updateToFinalStatusShouldFail: true });

    await expect(
      executeCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a', 'b'], maxGroupSize: 6 },
        'idem-g',
        'admin-discord-id'
      )
    ).rejects.toThrow('Failed to update row after successful execution');
  });
});
