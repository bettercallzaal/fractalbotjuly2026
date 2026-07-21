import { describe, expect, it } from 'vitest';
import { labelRespectContract, stageLabel, voteStatusLabel } from './governance.js';

describe('stageLabel', () => {
  it('maps the OREC stage enum', () => {
    expect(stageLabel(0)).toBe('Voting');
    expect(stageLabel(1)).toBe('Veto');
    expect(stageLabel(2)).toBe('Execution');
    expect(stageLabel(3)).toBe('Expired');
  });
  it('labels an unknown stage rather than throwing', () => {
    expect(stageLabel(9)).toBe('Unknown(9)');
  });
});

describe('voteStatusLabel', () => {
  it('maps the OREC vote-status enum', () => {
    expect(voteStatusLabel(0)).toBe('Passing');
    expect(voteStatusLabel(1)).toBe('Failing');
    expect(voteStatusLabel(2)).toBe('Passed');
    expect(voteStatusLabel(3)).toBe('Failed');
  });
});

describe('labelRespectContract', () => {
  it('identifies OG as the frozen ledger', () => {
    expect(labelRespectContract('0x34cE89baA7E4a4B00E17F7E4C0cb97105C216957')).toContain('OG');
  });
  it('identifies ZOR as the active ledger', () => {
    expect(labelRespectContract('0x9885CCeEf7E8371Bf8d6f2413723D25917E7445c')).toContain('ZOR');
  });
  it('is case-insensitive and flags unknown tokens', () => {
    expect(labelRespectContract('0x34ce89baa7e4a4b00e17f7e4c0cb97105c216957')).toContain('OG');
    expect(labelRespectContract('0xdeadbeef')).toBe('unknown');
  });
});
