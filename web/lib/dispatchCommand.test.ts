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
