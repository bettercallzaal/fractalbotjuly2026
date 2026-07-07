'use client';

import { useState } from 'react';

export function RandomizeButton() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function handleClick() {
    setStatus('loading');
    try {
      const res = await fetch('/api/commands/randomize', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ params: { memberIds: [], maxGroupSize: 6 } }),
      });
      if (!res.ok) throw new Error(await res.text());
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  return (
    <button onClick={handleClick} disabled={status === 'loading'}>
      {status === 'loading' ? 'Randomizing...' : 'Randomize now'}
    </button>
  );
}
