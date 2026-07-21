/** Name <-> member resolution for the Fractal bot.
 *
 * Running a fractal means turning Discord display names ("Zaal | ZAO",
 * "ohnahji.eth #4213", "Jose 🎵") into canonical Respect members
 * (name + wallet) so scoring writes to the right row. This module is the
 * pure matching logic - no DB, no side effects - kept separate so it stays
 * trivially testable (same convention as distributeIntoGroups). The DB read
 * lives in the resolveMembers action, which feeds a member list in here.
 */

export interface Member {
  name: string;
  wallet_address: string | null;
  fid: number | null;
}

export type MatchConfidence = 'exact' | 'fuzzy' | 'ambiguous' | 'none';

export interface Match {
  query: string;
  confidence: MatchConfidence;
  member: Member | null;
  candidates?: Member[]; // populated when confidence === 'ambiguous'
}

export interface RosterResolution {
  matched: Match[]; // exact or unique fuzzy - safe to score
  ambiguous: Match[]; // multiple plausible members - needs a human pick
  unmatched: string[]; // no member - needs registration
}

/** Strip Discord decoration down to comparable name tokens. Removes the
 * `#1234` discriminator, bracketed/parenthesised role tags, emoji and other
 * non-alphanumerics, and collapses whitespace. "Zaal | ZAO 🎵 #4213" -> "zaal". */
export function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/#\d+/g, '') // discord discriminator
    .replace(/\.(eth|base|sol)\b/g, '') // ENS/name-service suffixes
    .replace(/[([{].*?[)\]}]/g, ' ') // bracketed role tags
    .replace(/[|/\\].*$/g, ' ') // everything after a separator bar
    .replace(/[^a-z0-9\s]/g, ' ') // emoji + punctuation
    .replace(/\s+/g, ' ')
    .trim();
}

/** Bounded Levenshtein - returns edit distance, or `cap + 1` once it is clear
 * the distance exceeds `cap` (cheap early-out for the typo check). */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Match a single query name against the member list. Tiers, best first:
 *  1. exact normalized equality -> 'exact'
 *  2. unique substring / token-subset / first-token / small-typo -> 'fuzzy'
 *  3. more than one plausible member -> 'ambiguous' (candidates returned)
 *  4. nothing plausible -> 'none'
 */
export function matchMember(query: string, members: Member[]): Match {
  const q = normalizeName(query);
  if (!q) return { query, confidence: 'none', member: null };

  const normalized = members.map((m) => ({ m, n: normalizeName(m.name) }));

  // 1. exact
  const exact = normalized.filter((x) => x.n === q);
  if (exact.length === 1) return { query, confidence: 'exact', member: exact[0].m };
  if (exact.length > 1) {
    // same normalized name on multiple members - genuinely ambiguous
    return { query, confidence: 'ambiguous', member: null, candidates: exact.map((x) => x.m) };
  }

  // 2. fuzzy candidates
  const qTokens = new Set(q.split(' '));
  const fuzzy = normalized.filter((x) => {
    if (!x.n) return false;
    if (x.n.includes(q) || q.includes(x.n)) return true; // substring either way
    const nTokens = x.n.split(' ');
    if (nTokens[0] === q.split(' ')[0]) return true; // shared first name
    if (nTokens.some((t) => qTokens.has(t) && t.length >= 3)) return true; // shared token
    if (editDistance(q, x.n, 2) <= 2) return true; // small typo
    return false;
  });

  if (fuzzy.length === 1) return { query, confidence: 'fuzzy', member: fuzzy[0].m };
  if (fuzzy.length > 1) {
    return { query, confidence: 'ambiguous', member: null, candidates: fuzzy.map((x) => x.m) };
  }

  return { query, confidence: 'none', member: null };
}

/** Resolve a whole roster of raw names in one pass. */
export function resolveRoster(queries: string[], members: Member[]): RosterResolution {
  const matched: Match[] = [];
  const ambiguous: Match[] = [];
  const unmatched: string[] = [];

  for (const query of queries) {
    const m = matchMember(query, members);
    if (m.confidence === 'exact' || m.confidence === 'fuzzy') matched.push(m);
    else if (m.confidence === 'ambiguous') ambiguous.push(m);
    else unmatched.push(query);
  }

  return { matched, ambiguous, unmatched };
}
