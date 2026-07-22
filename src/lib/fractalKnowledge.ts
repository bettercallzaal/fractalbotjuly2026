/** Fractal knowledge base - the consolidated, canonical documentation the bot
 * carries and serves in Discord. One clean source of truth for "what is the
 * fractal, how does it work, what are the real numbers" - pulled together from
 * the ZAOfractal whitepaper and the governance parameters verified on-chain,
 * so a member can ask the bot instead of digging through docs.
 *
 * Pure data + lookup (no DB, no network), same convention as the other lib
 * modules. Facts here that came from a live on-chain read are marked so; they
 * are the ground truth, not the generic-OREC defaults the ecosystem docs quote.
 * Keep entries concise - they are Discord messages, not chapters. Depth lives
 * in the whitepaper at zaofractal.vercel.app, which each entry can point to.
 */

export interface KnowledgeEntry {
  key: string; // canonical topic slug
  title: string;
  aliases: string[]; // other things a member might type
  body: string;
  see: string[]; // related topic keys
}

const WHITEPAPER = 'zaofractal.vercel.app';

export const FRACTAL_KNOWLEDGE: KnowledgeEntry[] = [
  {
    key: 'fractal',
    title: 'What the ZAO Fractal is',
    aliases: ['overview', 'what is the fractal', 'about', 'start', 'intro'],
    body: [
      'ZAO Fractal is The ZAO\'s weekly governance ritual. Members meet in small breakout circles, discuss what each person actually contributed, and rank the circle. Those rankings mint Respect - earned, soulbound reputation - and Respect is the vote.',
      'No tokens are bought. Standing is earned in the open, recorded on Optimism.',
      `Full account: ${WHITEPAPER}`,
    ].join('\n\n'),
    see: ['respect', 'game', 'governance'],
  },
  {
    key: 'respect',
    title: 'Respect',
    aliases: ['respect token', 'reputation', 'zor', 'og'],
    body: [
      'Respect is soulbound, earned reputation - it cannot be bought, sold, or transferred. It is minted only by a passed governance proposal, so every token traces to peer recognition.',
      'Two ledgers: OG Respect (the frozen historical ledger, and the source of on-chain vote weight) and ZOR Respect (the active ledger every weekly award now mints). See "ledgers" for how they differ.',
    ].join('\n\n'),
    see: ['ledgers', 'tokens', 'scoring'],
  },
  {
    key: 'game',
    title: 'The Respect Game',
    aliases: ['the game', 'respect game', 'how it works', 'weekly', 'breakout'],
    body: [
      'Each week members split into circles of up to six. Each circle discusses contribution and reaches consensus on a ranking. The circle result is submitted as a governance proposal; once it passes, Respect is minted to each member by rank.',
      'The process is off-chain (human consensus); the enforcement is on-chain (the vote gate). See "scoring" for the point values.',
    ].join('\n\n'),
    see: ['scoring', 'governance', 'roster'],
  },
  {
    key: 'scoring',
    title: 'Scoring',
    aliases: ['points', 'ranks', 'awards', 'values', 'fibonacci'],
    body: [
      'Ranked awards (rank 1 to 6): 110, 68, 42, 26, 16, 10. These already include the current x2 era multiplier (base is 55, 34, 21, 13, 8, 5).',
      'Even split: 40 each. Camera-on: +10 for the session - which the bot can now capture automatically from voice state.',
    ].join('\n\n'),
    see: ['game', 'respect'],
  },
  {
    key: 'governance',
    title: 'Governance - ORDAO and OREC',
    aliases: ['ordao', 'orec', 'voting', 'proposals', 'veto'],
    body: [
      'ZAO governs through OREC - an Optimistic Respect-based Executive Contract. A proposal runs three phases: a voting window, a veto window (a challenge period where opposition can still block), then execution, which anyone can trigger.',
      'It is consent-based, not majority-based: a small active minority can pass routine proposals, and a roughly one-third minority can veto.',
      'Live parameters (read on-chain): 72h voting, 72h veto, minimum weight to pass 1000 Respect. These are ZAO\'s own values and can change - the bot reads them live.',
    ].join('\n\n'),
    see: ['ledgers', 'tokens', 'fractal'],
  },
  {
    key: 'ledgers',
    title: 'The two ledgers (and the vote-weight gap)',
    aliases: ['two ledgers', 'og vs zor', 'vote weight', 'og zor'],
    body: [
      'Vote weight is read from OG Respect only, snapshot at the block a proposal is created. OG has been frozen since late 2025.',
      'ZOR - the token every weekly award now mints - is a verifiable record of contribution but does not yet carry a vote. So a member who joined after the freeze and holds only ZOR currently has no on-chain vote weight.',
      'Closing that gap - giving the active ledger a path to voting weight without discarding OG history - is the honest open problem, named in the whitepaper.',
    ].join('\n\n'),
    see: ['governance', 'tokens', 'roadmap'],
  },
  {
    key: 'tokens',
    title: 'Contract addresses (Optimism)',
    aliases: ['contracts', 'addresses', 'onchain', 'on-chain'],
    body: [
      'OG Respect (ERC-20, vote weight): 0x34cE89baA7E4a4B00E17F7E4C0cb97105C216957',
      'ZOR Respect (ERC-1155, weekly mints): 0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c',
      'OREC executor (governance, and sole minter of ZOR): 0xcB05F9254765CA521F7698e61E0A6CA6456Be532',
      'OREC is self-owned - no human holds a key to mint Respect directly.',
    ].join('\n'),
    see: ['governance', 'ledgers'],
  },
  {
    key: 'roster',
    title: 'Running a fractal (roster + awards)',
    aliases: ['run', 'how to run', 'roster capture', 'attendance', 'present'],
    body: [
      'The bot captures who is present in a session - from voice channel members, recent text activity, reactions, or a typed list - and resolves each to a Respect member. Bound members resolve by wallet; the rest fall to name matching, and unmatched names are flagged for a quick register.',
      'It also tracks live voice presence and camera-on continuously, so attendance and the camera award record themselves.',
    ].join('\n\n'),
    see: ['scoring', 'game', 'roadmap'],
  },
  {
    key: 'roadmap',
    title: 'What the bot does now, and what is next',
    aliases: ['ideas', 'next', 'awareness', 'plans', 'todo'],
    body: [
      'Now: name resolution, roster capture, live voice + camera awareness, one identity across Discord + wallet + Farcaster, and live governance reads. All passive - it observes and records, it does not post on its own.',
      'Next: publish fractal results to Farcaster (human-gated, as @zolbot), surface a session on the dashboard, and design how the active ZOR ledger earns a real vote.',
    ].join('\n\n'),
    see: ['roster', 'ledgers', 'governance'],
  },
];

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Find the best entry for a free-text query. Tiers: exact key/alias, then
 * unique alias/title substring, then a shared-token match. Returns null when
 * nothing is plausible (the caller then lists available topics). */
export function findEntry(query: string, entries: KnowledgeEntry[] = FRACTAL_KNOWLEDGE): KnowledgeEntry | null {
  const q = norm(query);
  if (!q) return null;

  // 1. exact key or alias
  for (const e of entries) {
    if (norm(e.key) === q || e.aliases.some((a) => norm(a) === q)) return e;
  }
  // 2. substring against key / title / aliases
  const subs = entries.filter(
    (e) =>
      norm(e.title).includes(q) ||
      norm(e.key).includes(q) ||
      e.aliases.some((a) => norm(a).includes(q) || q.includes(norm(a))),
  );
  if (subs.length === 1) return subs[0];
  if (subs.length > 1) return subs[0]; // most specific first-listed wins

  // 3. shared token (>= 3 chars) against title/aliases
  const qTokens = new Set(q.split(' ').filter((t) => t.length >= 3));
  const scored = entries
    .map((e) => {
      const hay = norm([e.title, e.key, ...e.aliases].join(' ')).split(' ');
      const score = hay.filter((t) => qTokens.has(t)).length;
      return { e, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.length ? scored[0].e : null;
}

/** All topic keys + titles, for a "what can I ask" listing. */
export function listTopics(entries: KnowledgeEntry[] = FRACTAL_KNOWLEDGE): { key: string; title: string }[] {
  return entries.map((e) => ({ key: e.key, title: e.title }));
}
