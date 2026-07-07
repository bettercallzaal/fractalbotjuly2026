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

  it('rejects when the HTTP fallback fetch fails', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'row-1', idempotency_key: 'k3' }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { status: 'pending' }, error: null }),
          }),
        }),
      }),
    };

    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('bot unreachable');
    }));

    await expect(
      dispatchCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a'], maxGroupSize: 6 },
        'admin-1',
        'http://bot:8080',
        'secret',
        { pollIntervalMs: 1, timeoutMs: 5, fetchTimeoutMs: 100 },
      ),
    ).rejects.toThrow('bot unreachable');

    expect(fetch).toHaveBeenCalled();
  });

  it('rejects when the HTTP fallback fetch times out', async () => {
    const supabase = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'row-1', idempotency_key: 'k4' }, error: null }),
          }),
        }),
        select: () => ({
          eq: () => ({
            single: async () => ({ data: { status: 'pending' }, error: null }),
          }),
        }),
      }),
    };

    vi.stubGlobal('fetch', vi.fn(async (url: string, options: any) => {
      const signal = options.signal as AbortSignal;
      return new Promise((_, reject) => {
        const onAbort = () => {
          signal.removeEventListener('abort', onAbort);
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        };
        if (signal) {
          signal.addEventListener('abort', onAbort);
        }
      });
    }));

    await expect(
      dispatchCommand(
        supabase as any,
        'randomize',
        { memberIds: ['a'], maxGroupSize: 6 },
        'admin-1',
        'http://bot:8080',
        'secret',
        { pollIntervalMs: 1, timeoutMs: 5, fetchTimeoutMs: 20 },
      ),
    ).rejects.toThrow('The operation was aborted.');

    expect(fetch).toHaveBeenCalled();
  });
});
