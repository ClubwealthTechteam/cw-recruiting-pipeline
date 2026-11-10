'use client';
import { useAction } from './useAction';

/** Profile: pause invites for this one applicant (tag "Invites paused"), or resume them. */
export default function PauseInvitesButton({ id, paused }: { id: string; paused: boolean }) {
  const { run, busy } = useAction();
  return (
    <button type="button" className="btn small-btn" disabled={busy} data-tour="pause-invites"
      onClick={() => run({ action: 'pauseInvites', id, paused: !paused }, { success: paused ? 'Invites resumed for this applicant ✓' : 'Invites paused for this applicant' })}>
      {paused ? 'Resume invites' : 'Pause invites'}
    </button>
  );
}
