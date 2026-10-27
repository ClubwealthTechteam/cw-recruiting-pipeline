'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Posts one action to /api/action, then refreshes the page data. */
export function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function run(body: Record<string, unknown>) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || 'Something went wrong');
      router.refresh();
      return json.data;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      return null;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error };
}
