/** Simple in-memory TTL cache for guild member role lookups.
 * Keyed by discordId, caches role arrays with expiration.
 * Reduces repeated Discord API calls during the same session. */

interface CacheEntry {
  roles: string[];
  expiresAt: number;
}

const ROLE_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const roleCache = new Map<string, CacheEntry>();

export function getCachedRoles(discordId: string): string[] | null {
  const entry = roleCache.get(discordId);
  if (!entry) return null;

  if (Date.now() >= entry.expiresAt) {
    roleCache.delete(discordId);
    return null;
  }

  return entry.roles;
}

export function setCachedRoles(discordId: string, roles: string[]): void {
  roleCache.set(discordId, {
    roles,
    expiresAt: Date.now() + ROLE_CACHE_TTL_MS,
  });
}
