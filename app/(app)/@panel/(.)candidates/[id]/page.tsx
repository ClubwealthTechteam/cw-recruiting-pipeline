import { Suspense } from 'react';
import CandidateView from '@/components/CandidateView';
import Drawer from '@/components/Drawer';

/** Clicking a name in a list opens the profile in a side panel, so the list stays where it was. */
export default async function CandidatePanel({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Drawer>
      <Suspense fallback={<div className="loading"><div className="sk sk-title" /><div className="sk sk-panel" /><div className="sk sk-panel short" /></div>}>
        <CandidateView appId={decodeURIComponent(id)} panel />
      </Suspense>
    </Drawer>
  );
}
