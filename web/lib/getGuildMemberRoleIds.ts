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
