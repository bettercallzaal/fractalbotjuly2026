import { describe, expect, it } from 'vitest';
import { type Member, matchMember, normalizeName, resolveRoster } from './nameResolver.js';

const members: Member[] = [
  { name: 'Zaal', wallet_address: '0xaaa', fid: 1 },
  { name: 'Ohnahji', wallet_address: '0xbbb', fid: 2 },
  { name: 'Jose', wallet_address: '0xccc', fid: 3 },
  { name: 'Tom Fellenz', wallet_address: '0xddd', fid: null },
  { name: 'MetaMu', wallet_address: '0xeee', fid: null },
];

describe('normalizeName', () => {
  it('strips discord discriminator', () => {
    expect(normalizeName('ohnahji #4213')).toBe('ohnahji');
  });
  it('strips name-service suffixes', () => {
    expect(normalizeName('ohnahji.eth')).toBe('ohnahji');
  });
  it('strips bracketed role tags and separator bars', () => {
    expect(normalizeName('Zaal | ZAO')).toBe('zaal');
    expect(normalizeName('Jose (core team)')).toBe('jose');
  });
  it('strips emoji and punctuation', () => {
    expect(normalizeName('Jose 🎵')).toBe('jose');
  });
  it('collapses whitespace and lowercases', () => {
    expect(normalizeName('  Tom   FELLENZ ')).toBe('tom fellenz');
  });
});

describe('matchMember', () => {
  it('exact match on normalized name', () => {
    const m = matchMember('Zaal', members);
    expect(m.confidence).toBe('exact');
    expect(m.member?.wallet_address).toBe('0xaaa');
  });
  it('matches through discord decoration', () => {
    const m = matchMember('Ohnahji.eth #4213 🔥', members);
    expect(m.confidence).toBe('exact');
    expect(m.member?.name).toBe('Ohnahji');
  });
  it('fuzzy-matches a shared first name', () => {
    const m = matchMember('Tom', members);
    expect(m.confidence).toBe('fuzzy');
    expect(m.member?.name).toBe('Tom Fellenz');
  });
  it('fuzzy-matches a small typo', () => {
    const m = matchMember('Metamoo', members); // Metamu -> Metamoo (edit distance 2)
    expect(m.confidence).toBe('fuzzy');
    expect(m.member?.name).toBe('MetaMu');
  });
  it('returns none for an unknown name', () => {
    const m = matchMember('Nemesis', members);
    expect(m.confidence).toBe('none');
    expect(m.member).toBeNull();
  });
  it('returns none for an empty/emoji-only name', () => {
    expect(matchMember('🎵🔥', members).confidence).toBe('none');
  });
  it('flags ambiguity when two members share a first name', () => {
    const dupes: Member[] = [
      { name: 'Jose Acabrera', wallet_address: '0x1', fid: null },
      { name: 'Jose Goats', wallet_address: '0x2', fid: null },
    ];
    const m = matchMember('Jose', dupes);
    expect(m.confidence).toBe('ambiguous');
    expect(m.candidates).toHaveLength(2);
    expect(m.member).toBeNull();
  });
});

describe('resolveRoster', () => {
  it('partitions a roster into matched / ambiguous / unmatched', () => {
    const roster = ['Zaal | ZAO', 'Ohnahji #1', 'Nemesis', 'NewPerson'];
    const res = resolveRoster(roster, members);
    expect(res.matched.map((m) => m.member?.name).sort()).toEqual(['Ohnahji', 'Zaal']);
    expect(res.unmatched.sort()).toEqual(['Nemesis', 'NewPerson']);
    expect(res.ambiguous).toHaveLength(0);
  });

  it('routes ambiguous names to the ambiguous bucket, not matched', () => {
    const dupes: Member[] = [
      { name: 'Jose Acabrera', wallet_address: '0x1', fid: null },
      { name: 'Jose Goats', wallet_address: '0x2', fid: null },
    ];
    const res = resolveRoster(['Jose'], dupes);
    expect(res.matched).toHaveLength(0);
    expect(res.ambiguous).toHaveLength(1);
    expect(res.ambiguous[0].candidates).toHaveLength(2);
  });

  it('handles an empty roster', () => {
    const res = resolveRoster([], members);
    expect(res).toEqual({ matched: [], ambiguous: [], unmatched: [] });
  });
});
