import { describe, expect, it } from 'vitest';
import { getWalletRegistry } from './getWalletRegistry.js';

interface FakeSupabaseResult {
  client: any;
  calls: {
    ilike: { column: string; pattern: string } | null;
    order: { column: string; options: any } | null;
  };
}

function makeFakeSupabase(rows: { discord_id: string; wallet_address: string }[]): FakeSupabaseResult {
  const calls = {
    ilike: null as { column: string; pattern: string } | null,
    order: null as { column: string; options: any } | null,
  };

  const client = {
    from: () => ({
      select: () => ({
        ilike: (column: string, pattern: string) => {
          calls.ilike = { column, pattern };
          return {
            then: async (resolve: (v: unknown) => void) => {
              const needle = pattern.replace(/%/g, '').toLowerCase();
              resolve({
                data: rows.filter(
                  (r) =>
                    r.discord_id.toLowerCase().includes(needle) || r.wallet_address.toLowerCase().includes(needle),
                ),
                error: null,
              });
            },
          };
        },
        order: (column: string, options: any) => {
          calls.order = { column, options };
          return {
            then: async (resolve: (v: unknown) => void) => {
              resolve({ data: rows, error: null });
            },
          };
        },
      }),
    }),
  };

  return { client, calls };
}

describe('getWalletRegistry', () => {
  it('returns all wallets when no search term is given', async () => {
    const { client, calls } = makeFakeSupabase([
      { discord_id: 'd1', wallet_address: '0xabc' },
      { discord_id: 'd2', wallet_address: '0xdef' },
    ]);
    const result = await getWalletRegistry(client as any);
    expect(result).toEqual([
      { discordId: 'd1', walletAddress: '0xabc' },
      { discordId: 'd2', walletAddress: '0xdef' },
    ]);
    expect(calls.order).toBeTruthy();
    expect(calls.ilike).toBeNull();
  });

  it('filters by search term against discord ID or wallet address', async () => {
    const { client, calls } = makeFakeSupabase([
      { discord_id: 'd1', wallet_address: '0xabc' },
      { discord_id: 'd2', wallet_address: '0xdef' },
    ]);
    const result = await getWalletRegistry(client as any, 'def');
    expect(result).toEqual([{ discordId: 'd2', walletAddress: '0xdef' }]);
    expect(calls.ilike).toBeTruthy();
    expect(calls.ilike?.column).toBe('wallet_address');
    expect(calls.ilike?.pattern).toBe('%def%');
    expect(calls.order).toBeNull();
  });

  it('handles case-insensitive search across discord ID', async () => {
    const { client, calls } = makeFakeSupabase([
      { discord_id: 'Alice123', wallet_address: '0xabc' },
      { discord_id: 'Bob456', wallet_address: '0xdef' },
    ]);
    const result = await getWalletRegistry(client as any, 'ALICE');
    expect(result).toEqual([{ discordId: 'Alice123', walletAddress: '0xabc' }]);
    expect(calls.ilike?.column).toBe('wallet_address');
  });

  it('returns empty array when search matches nothing', async () => {
    const { client, calls } = makeFakeSupabase([
      { discord_id: 'd1', wallet_address: '0xabc' },
      { discord_id: 'd2', wallet_address: '0xdef' },
    ]);
    const result = await getWalletRegistry(client as any, 'xyz');
    expect(result).toEqual([]);
    expect(calls.ilike).toBeTruthy();
  });

  it('returns empty array when data is null', async () => {
    const client = {
      from: () => ({
        select: () => ({
          order: () => ({
            then: async (resolve: (v: unknown) => void) => {
              resolve({ data: null, error: null });
            },
          }),
        }),
      }),
    };
    const result = await getWalletRegistry(client as any);
    expect(result).toEqual([]);
  });
});
