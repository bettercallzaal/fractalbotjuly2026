/** Greedy round-robin distribution: always place the next member into the
 * currently-smallest group. Deterministic given the same input order - the
 * caller is responsible for shuffling `memberIds` first if randomness is
 * wanted (kept separate so this function stays trivially testable). */
export function distributeIntoGroups(memberIds: string[], maxGroupSize: number): string[][] {
  if (memberIds.length === 0) return [];

  const groupCount = Math.ceil(memberIds.length / maxGroupSize);
  const groups: string[][] = Array.from({ length: groupCount }, () => []);

  for (const memberId of memberIds) {
    const smallest = groups.reduce((min, group, idx) =>
      group.length < groups[min].length ? idx : min, 0);
    groups[smallest].push(memberId);
  }

  return groups;
}
