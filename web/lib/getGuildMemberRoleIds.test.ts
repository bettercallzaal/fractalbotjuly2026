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
