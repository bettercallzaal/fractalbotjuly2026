/** Test the awareness stack against yesterday's fractal (week 107, 2026-07-20)
 * using LIVE data - on-chain Respect weight, Farcaster identity resolved from
 * just a wallet, and the governance state a submission would land in.
 *
 * Honest scope: the live voice/camera capture can't be replayed (the bot was
 * not running yesterday, so that data does not exist). Week 107's breakout
 * roster was never recorded either - only the two video participants are known,
 * which is the exact gap roster-capture closes going forward. What runs here is
 * everything that reads live services.
 *
 *   npm run test:yesterday
 */

import { formatEther } from 'viem';
import { makeOptimismClient, readOrecConfig } from '../src/lib/governance.js';
import { OG_RESPECT_ADDRESS, ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';

// Week 107 (2026-07-20) known participants (name + wallet).
const PARTICIPANTS = [
  { name: 'Ohnahji', wallet: '0x64a15b1d2de581097cb48e5d82619203e24bb3e1' },
  { name: 'Zaal', wallet: '0x7234c36a71ec237c2ae7698e8916e0735001e9af' },
];

const ERC20_BAL = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
const ERC1155_BAL = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const;

/** Resolve wallets to Farcaster accounts via Neynar's by-address lookup - the
 * bot usually has a wallet, not an fid, so this is the real resolution path. */
async function farcasterByAddress(addresses: string[], apiKey: string | undefined) {
  const out = new Map<string, { username: string; fid: number }>();
  if (!apiKey) return out;
  const url = `https://api.neynar.com/v2/farcaster/user/bulk-by-address?addresses=${addresses.join(',')}`;
  const res = await fetch(url, { headers: { 'x-api-key': apiKey, accept: 'application/json' } });
  if (!res.ok) return out;
  const body = (await res.json()) as Record<string, { username: string; fid: number }[]>;
  for (const [addr, users] of Object.entries(body)) {
    if (users && users[0]) out.set(addr.toLowerCase(), { username: users[0].username, fid: users[0].fid });
  }
  return out;
}

async function main() {
  const client = makeOptimismClient();
  console.log('=== Awareness test - week 107 fractal (2026-07-20) ===\n');

  // Governance state the submission would land in.
  const cfg = await readOrecConfig(client);
  console.log('Governance target (live OREC):');
  console.log(`  vote ${cfg.voteLenSeconds / 3600}h / veto ${cfg.vetoLenSeconds / 3600}h, minWeight ${formatEther(BigInt(cfg.minWeight))} Respect`);
  console.log(`  vote weight token: ${cfg.respectContractLabel}\n`);

  const fc = await farcasterByAddress(PARTICIPANTS.map((p) => p.wallet), process.env.NEYNAR_API_KEY);

  console.log('Participants (resolved live):\n');
  for (const p of PARTICIPANTS) {
    const [og, zor] = await Promise.all([
      client.readContract({ address: OG_RESPECT_ADDRESS, abi: ERC20_BAL, functionName: 'balanceOf', args: [p.wallet as `0x${string}`] }),
      client.readContract({ address: ZOR_RESPECT_ADDRESS, abi: ERC1155_BAL, functionName: 'balanceOf', args: [p.wallet as `0x${string}`, 0n] }),
    ]);
    const ogN = Number(formatEther(og as bigint));
    const zorN = Number(zor as bigint);
    const f = fc.get(p.wallet.toLowerCase());
    console.log(`  ${p.name}`);
    console.log(`    wallet     ${p.wallet}`);
    console.log(`    respect    OG ${ogN} + ZOR ${zorN} = ${Math.round(ogN + zorN)}  (vote weight: ${Math.round(ogN)} OG-only)`);
    console.log(`    farcaster  ${f ? '@' + f.username + ' (fid ' + f.fid + ')' : process.env.NEYNAR_API_KEY ? 'no verified fc account' : 'skipped (no NEYNAR_API_KEY)'}`);
    console.log('');
  }

  console.log('Not testable retroactively (needs the bot running live):');
  console.log('  - voice presence + duration, camera-on award (no data captured yesterday)');
  console.log('  - full breakout roster (week 107 recorded only the 2 video participants)');
  console.log('\n=== done ===');
}

main().catch((e) => { console.error('test failed:', e); process.exit(1); });
