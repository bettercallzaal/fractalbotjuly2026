import { describe, expect, it } from 'vitest';
import {
  classifyVoiceTransition,
  isTrackedChannel,
  summarizePresence,
  type VoiceSnapshot,
} from './voicePresence.js';

const none: VoiceSnapshot = { channelId: null, selfVideo: false, streaming: false };
const inA = (v = false, s = false): VoiceSnapshot => ({ channelId: 'A', selfVideo: v, streaming: s });
const inB = (v = false, s = false): VoiceSnapshot => ({ channelId: 'B', selfVideo: v, streaming: s });

describe('isTrackedChannel', () => {
  it('empty tracked set means track everything', () => {
    expect(isTrackedChannel('A', new Set())).toBe(true);
  });
  it('null channel is never tracked', () => {
    expect(isTrackedChannel(null, new Set())).toBe(false);
  });
  it('respects an explicit tracked set', () => {
    expect(isTrackedChannel('A', new Set(['A']))).toBe(true);
    expect(isTrackedChannel('B', new Set(['A']))).toBe(false);
  });
});

describe('classifyVoiceTransition', () => {
  it('emits joined when entering a tracked channel', () => {
    expect(classifyVoiceTransition(none, inA())).toEqual([{ type: 'joined', channelId: 'A' }]);
  });

  it('emits left when leaving to nowhere', () => {
    expect(classifyVoiceTransition(inA(), none)).toEqual([{ type: 'left', channelId: 'A' }]);
  });

  it('emits moved between two tracked channels', () => {
    expect(classifyVoiceTransition(inA(), inB())).toEqual([{ type: 'moved', channelId: 'B' }]);
  });

  it('joining with camera already on emits joined + camera_on', () => {
    expect(classifyVoiceTransition(none, inA(true))).toEqual([
      { type: 'joined', channelId: 'A' },
      { type: 'camera_on', channelId: 'A' },
    ]);
  });

  it('toggling camera on while present emits only camera_on', () => {
    expect(classifyVoiceTransition(inA(false), inA(true))).toEqual([
      { type: 'camera_on', channelId: 'A' },
    ]);
  });

  it('toggling camera off while present emits camera_off', () => {
    expect(classifyVoiceTransition(inA(true), inA(false))).toEqual([
      { type: 'camera_off', channelId: 'A' },
    ]);
  });

  it('screenshare on/off emits stream events', () => {
    expect(classifyVoiceTransition(inA(false, false), inA(false, true))).toEqual([
      { type: 'stream_on', channelId: 'A' },
    ]);
  });

  it('ignores camera toggles in an untracked channel', () => {
    const tracked = new Set(['A']);
    expect(classifyVoiceTransition(inB(false), inB(true), tracked)).toEqual([]);
  });

  it('leaving does not emit a spurious camera_off', () => {
    expect(classifyVoiceTransition(inA(true), none)).toEqual([{ type: 'left', channelId: 'A' }]);
  });

  it('no-op transition (same state) emits nothing', () => {
    expect(classifyVoiceTransition(inA(true), inA(true))).toEqual([]);
  });
});

describe('summarizePresence', () => {
  it('computes a simple present-then-leave interval', () => {
    const r = summarizePresence('u1', [
      { type: 'joined', channelId: 'A', at: 0 },
      { type: 'left', channelId: 'A', at: 10_000 },
    ], 99_999);
    expect(r).toHaveLength(1);
    expect(r[0].joinedAt).toBe(0);
    expect(r[0].leftAt).toBe(10_000);
    expect(r[0].cameraOnMs).toBe(0);
  });

  it('accumulates camera-on duration across on/off toggles', () => {
    const r = summarizePresence('u1', [
      { type: 'joined', channelId: 'A', at: 0 },
      { type: 'camera_on', channelId: 'A', at: 1_000 },
      { type: 'camera_off', channelId: 'A', at: 4_000 }, // 3s on
      { type: 'camera_on', channelId: 'A', at: 6_000 },
      { type: 'left', channelId: 'A', at: 8_000 }, // 2s on
    ], 99_999);
    expect(r[0].cameraOnMs).toBe(5_000);
    expect(r[0].leftAt).toBe(8_000);
  });

  it('closes a still-open interval at nowMs and marks leftAt null', () => {
    const r = summarizePresence('u1', [
      { type: 'joined', channelId: 'A', at: 0 },
      { type: 'camera_on', channelId: 'A', at: 1_000 },
    ], 5_000);
    expect(r[0].leftAt).toBeNull();
    expect(r[0].cameraOnMs).toBe(4_000); // 1000 -> nowMs 5000
  });

  it('a move closes the first interval and opens a second', () => {
    const r = summarizePresence('u1', [
      { type: 'joined', channelId: 'A', at: 0 },
      { type: 'moved', channelId: 'B', at: 3_000 },
      { type: 'left', channelId: 'B', at: 5_000 },
    ], 99_999);
    expect(r).toHaveLength(2);
    expect(r[0].channelId).toBe('A');
    expect(r[0].leftAt).toBe(3_000);
    expect(r[1].channelId).toBe('B');
    expect(r[1].leftAt).toBe(5_000);
  });
});
