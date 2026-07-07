import { describe, expect, it } from 'vitest';
import { distributeIntoGroups } from './randomize.js';

describe('distributeIntoGroups', () => {
  it('splits members evenly into groups no larger than maxGroupSize', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const groups = distributeIntoGroups(members, 6);
    expect(groups.length).toBe(2);
    expect(groups.flat().sort()).toEqual([...members].sort());
    for (const group of groups) {
      expect(group.length).toBeLessThanOrEqual(6);
    }
  });

  it('returns one group when everyone fits', () => {
    const groups = distributeIntoGroups(['a', 'b', 'c'], 6);
    expect(groups).toEqual([['a', 'b', 'c']]);
  });

  it('returns an empty array for an empty member list', () => {
    expect(distributeIntoGroups([], 6)).toEqual([]);
  });
});
