'use client';
import { useAction } from './useAction';

/** Pause / resume every automatic invite (Settings AUTO_INVITES). Manual invites from a profile still work. */
export default function InvitesSwitch({ on }: { on: boolean }) {
  const { run, busy } = useAction();
  function flip() {
    const msg = on
      ? 'Pause all automatic invites? New applicants are still screened but nobody is invited automatically until you resume.'
      : 'Resume automatic invites? New applicants who fit get invited again. People who applied while paused are not invited automatically; invite them from Candidates.';
    if (confirm(msg)) run({ action: 'setAutoInvites', on: !on }, { success: on ? 'Automatic invites paused' : 'Automatic invites resumed ✓' });
  }
  return (
    <div className="kv-row" data-tour="invites-switch" style={{ alignItems: 'center' }}>
      <span>Automatic invites: <span className={`badge ${on ? 'green' : 'amber'}`}>{on ? 'On' : 'Paused'}</span></span>
      <button type="button" className="btn small-btn" disabled={busy} onClick={flip}>{on ? 'Pause' : 'Resume'}</button>
    </div>
  );
}
