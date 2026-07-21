/** Governance awareness - viem reads of ZAO's live OREC contract on Optimism.
 * Makes the bot aware of the governance layer: the real voting/veto window
 * lengths, the minimum weight to pass, which token confers vote weight, and
 * the stage of any given proposal. Reads on-chain directly (no ornode/orclient
 * config needed), so it works immediately and is testable against live chain.
 *
 * "viem for reads, orclient for writes" is ZAO's integration pattern; this is
 * the reads half. Per-proposal *content* (titles, breakout rosters) lives in
 * ornode and needs orclient - that is a later, config-dependent addition. What
 * is here is the pure on-chain truth.
 *
 * The OREC ABI is a minimal viem subset of the functions this module calls,
 * taken from @ordao/orec. Stage/VoteStatus enums match @ordao/ortypes.
 */

import { createPublicClient, http, type PublicClient } from 'viem';
import { optimism } from 'viem/chains';
import { OG_RESPECT_ADDRESS, OREC_EXECUTOR_ADDRESS, ZOR_RESPECT_ADDRESS } from '@fractalbot/shared';

export const OREC_ABI = [
  { type: 'function', name: 'voteLen', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'vetoLen', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'minWeight', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'respectContract', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'getStage', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'getVoteStatus', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'proposalExists', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'respectOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const;

// Match @ordao/ortypes Stage + VoteStatus.
const STAGES = ['Voting', 'Veto', 'Execution', 'Expired'] as const;
const VOTE_STATUSES = ['Passing', 'Failing', 'Passed', 'Failed'] as const;

export function stageLabel(stage: number): string {
  return STAGES[stage] ?? `Unknown(${stage})`;
}
export function voteStatusLabel(status: number): string {
  return VOTE_STATUSES[status] ?? `Unknown(${status})`;
}

/** Which known Respect token is OREC's configured vote-weight source? Answers
 * the OG-vs-ZOR question from ground truth rather than docs. */
export function labelRespectContract(address: string): string {
  const a = address.toLowerCase();
  if (a === OG_RESPECT_ADDRESS.toLowerCase()) return 'OG (frozen historical ledger)';
  if (a === ZOR_RESPECT_ADDRESS.toLowerCase()) return 'ZOR (active reward ledger)';
  return 'unknown';
}

export function makeOptimismClient(rpcUrl = process.env.OPTIMISM_RPC_URL): PublicClient {
  return createPublicClient({ chain: optimism, transport: http(rpcUrl) }) as PublicClient;
}

export interface OrecConfig {
  orec: string;
  voteLenSeconds: number;
  vetoLenSeconds: number;
  minWeight: string;
  respectContract: string;
  respectContractLabel: string;
  owner: string;
}

/** Read OREC's global governance parameters - the real ZAO values, not the
 * generic OREC defaults the docs quote. */
export async function readOrecConfig(
  client: PublicClient,
  orec: `0x${string}` = OREC_EXECUTOR_ADDRESS,
): Promise<OrecConfig> {
  const call = (functionName: (typeof OREC_ABI)[number]['name']) =>
    client.readContract({ address: orec, abi: OREC_ABI, functionName });

  const [voteLen, vetoLen, minWeight, respectContract, owner] = (await Promise.all([
    call('voteLen'),
    call('vetoLen'),
    call('minWeight'),
    call('respectContract'),
    call('owner'),
  ])) as [bigint, bigint, bigint, string, string];

  return {
    orec,
    voteLenSeconds: Number(voteLen),
    vetoLenSeconds: Number(vetoLen),
    minWeight: minWeight.toString(),
    respectContract,
    respectContractLabel: labelRespectContract(respectContract),
    owner,
  };
}

export interface ProposalStatus {
  propId: string;
  exists: boolean;
  stage: string; // Voting | Veto | Execution | Expired
  voteStatus: string; // Passing | Failing | Passed | Failed
}

/** Read the live stage + vote status of a specific proposal by its on-chain
 * id. (Enumerating all live proposals needs ornode or event logs - not here.) */
export async function readProposalStatus(
  client: PublicClient,
  propId: `0x${string}`,
  orec: `0x${string}` = OREC_EXECUTOR_ADDRESS,
): Promise<ProposalStatus> {
  const exists = (await client.readContract({
    address: orec,
    abi: OREC_ABI,
    functionName: 'proposalExists',
    args: [propId],
  })) as boolean;
  if (!exists) {
    return { propId, exists: false, stage: 'n/a', voteStatus: 'n/a' };
  }
  const [stage, status] = (await Promise.all([
    client.readContract({ address: orec, abi: OREC_ABI, functionName: 'getStage', args: [propId] }),
    client.readContract({ address: orec, abi: OREC_ABI, functionName: 'getVoteStatus', args: [propId] }),
  ])) as [number, number];
  return {
    propId,
    exists: true,
    stage: stageLabel(Number(stage)),
    voteStatus: voteStatusLabel(Number(status)),
  };
}
