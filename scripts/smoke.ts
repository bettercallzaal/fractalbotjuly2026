/** Awareness smoke test - exercises the bot's live-external awareness against
 * real services so you can see it working WITHOUT the full deploy or the
 * Supabase migrations. Run: `npm run smoke`.
 *
 * What it hits:
 *  - Governance awareness: ZAO's OREC contract on Optimism (public RPC, no key).
 *  - Farcaster awareness: Neynar (only if NEYNAR_API_KEY is set).
 *  - Respect weight: on-chain OG + ZOR balance for a sample wallet.
 *
 * It does NOT need SUPABASE_URL, a Discord token, or the migrations - it only
 * reads public chain + Farcaster data. Pass a wallet / fid / propId as args to
 * probe specific ones:  npm run smoke -- --wallet 0x.. --fid 3338501 --prop 0x..
 */

import { formatEther } from 'viem';
import { fetchFarcasterProfiles } from '../src/lib/farcaster.js';
import {
  makeOptimismClient,
  readOrecConfig,
  readProposalStatus,
} from '../src/lib/governance.js';
import { OG_RESPECT_ADDRESS, ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const ERC20_BAL = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
const ERC1155_BAL = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }, { type: 'uint256' }], outputs: [{ type: 'uint256' }] }] as const;

async function main() {
  const line = (s = '') => console.log(s);
  line('=== Fractal bot awareness smoke test ===\n');

  const client = makeOptimismClient();

  // 1. Governance awareness (live OREC config).
  line('[1] Governance awareness - ZAO OREC (Optimism):');
  const cfg = await readOrecConfig(client);
  line(`    OREC            ${cfg.orec}`);
  line(`    voteLen         ${cfg.voteLenSeconds}s (${Math.round((cfg.voteLenSeconds / 3600) * 10) / 10}h)`);
  line(`    vetoLen         ${cfg.vetoLenSeconds}s (${Math.round((cfg.vetoLenSeconds / 3600) * 10) / 10}h)`);
  line(`    minWeight       ${formatEther(BigInt(cfg.minWeight))} Respect`);
  line(`    respectContract ${cfg.respectContract}  -> ${cfg.respectContractLabel}`);
  line(`    owner           ${cfg.owner}${cfg.owner.toLowerCase() === cfg.orec.toLowerCase() ? ' (self-owned)' : ''}`);
  line();

  const propId = arg('prop');
  if (propId) {
    const p = await readProposalStatus(client, propId as `0x${string}`);
    line(`    proposal ${p.propId}: exists=${p.exists} stage=${p.stage} status=${p.voteStatus}`);
    line();
  }

  // 2. Respect weight for a sample wallet (defaults to zaal.eth's).
  const wallet = (arg('wallet') ?? '0x7234c36a71ec237c2ae7698e8916e0735001e9af') as `0x${string}`;
  line(`[2] Respect weight (on-chain) for ${wallet}:`);
  const [og, zor] = await Promise.all([
    client.readContract({ address: OG_RESPECT_ADDRESS, abi: ERC20_BAL, functionName: 'balanceOf', args: [wallet] }),
    client.readContract({ address: ZOR_RESPECT_ADDRESS, abi: ERC1155_BAL, functionName: 'balanceOf', args: [wallet, 0n] }),
  ]);
  const ogN = Number(formatEther(og as bigint));
  const zorN = Number(zor as bigint);
  line(`    OG ${ogN}  +  ZOR ${zorN}  =  weight ${Math.round(ogN + zorN)}`);
  line(`    (governance vote weight uses OG only: ${Math.round(ogN)})`);
  line();

  // 3. Farcaster awareness (only if a key is present).
  const fid = Number(arg('fid') ?? process.env.FARCASTER_BOT_FID ?? 3338501);
  line(`[3] Farcaster awareness - fid ${fid}:`);
  if (!process.env.NEYNAR_API_KEY) {
    line('    NEYNAR_API_KEY not set - skipped (set it to test Farcaster reads).');
  } else {
    const profiles = await fetchFarcasterProfiles([fid]);
    const p = profiles.get(fid);
    line(p ? `    @${p.username} (${p.displayName}) - verified: ${p.verifiedAddresses.join(', ') || 'none'}` : '    no profile returned');
  }
  line('\n=== smoke test done ===');
}

main().catch((err) => {
  console.error('smoke test failed:', err);
  process.exit(1);
});
