/**
 * Did Zapier really send it? (Miguel, 2026-11-13, after 4 onboarding emails showed Sent on Nov 12 but never arrived.)
 * Zapier answers "got it" the moment it receives an email, before its Microsoft step sends it, so "Sent" in the Outbox
 * only means "handed to Zapier". The Zap's last step now calls /api/email/delivered, which fills "Delivered At" (or
 * marks the email Failed with Zapier's error). An email handed over and not confirmed within CONFIRM_WAIT_MIN minutes is
 * shown as not delivered. Checking starts with the first confirmation ever received (kv zapConfirmSince), so emails
 * sent before the Zap was updated are never flagged.
 */
export const DELIVERY_COL = 'Delivered At';
export const CONFIRM_WAIT_MIN = 10;
const FAILED_DAYS = 3;
const MAIL_TYPES = ['Invite', 'Re-invite', 'Reminder', 'Confirmation', 'Reply', 'Hired', 'Rejected', 'Benched', 'Onboarding'];

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === undefined || v === null ? '' : String(v));

export type DeliveryProblem = {
  id: string; applicantId: string; name: string; type: string; to: string; at: string;
  kind: 'failed' | 'unconfirmed'; error: string;
};

/**
 * Emails that need someone to look: failed (last few days) or handed to Zapier and never confirmed.
 * Times are Pacific "yyyy-MM-dd HH:mm:ss" strings, as the Outbox stores them; now is the same format.
 */
export function deliveryProblems(outbox: Row[], applicants: Row[], since: string | undefined, now: string): DeliveryProblem[] {
  const names = new Map(applicants.map((a) => [s(a['Applicant ID']), `${s(a['First Name'])} ${s(a['Last Name'])}`.trim()]));
  const shift = (min: number) => {
    const d = new Date(now.replace(' ', 'T') + 'Z'); // treat as UTC only to do the arithmetic; the format is unchanged
    d.setUTCMinutes(d.getUTCMinutes() - min);
    return d.toISOString().slice(0, 19).replace('T', ' ');
  };
  const waitedUntil = shift(CONFIRM_WAIT_MIN);
  const failedSince = shift(FAILED_DAYS * 24 * 60);
  const out: DeliveryProblem[] = [];
  for (const e of outbox) {
    if (!MAIL_TYPES.includes(s(e.Type)) || s(e[DELIVERY_COL])) continue;
    const status = s(e.Status);
    const at = s(e['Sent At']) || s(e['Queued At']);
    let kind: DeliveryProblem['kind'] | null = null;
    if (status === 'Sent' && since && at >= since && at <= waitedUntil) kind = 'unconfirmed';
    else if (status === 'Failed' && at >= failedSince) kind = 'failed';
    if (!kind) continue;
    const id = s(e['Applicant ID']);
    out.push({
      id: s(e['Email ID']), applicantId: id, name: names.get(id) || s(e.To), type: s(e.Type), to: s(e.To), at: at.slice(0, 16), kind,
      error: kind === 'failed' ? s(e.Error) || 'Failed' : `Zapier did not confirm it was sent (handed over ${CONFIRM_WAIT_MIN}+ min ago)`
    });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
