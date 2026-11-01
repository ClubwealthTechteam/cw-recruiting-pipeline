/** The pre-interview non-negotiables (Recruiting Process sheet, WEDNESDAY tab), on screen during the session. */
export default function NonNegotiables({ open = false }: { open?: boolean }) {
  return (
    <details className="panel nonneg" open={open}>
      <summary><strong>Non-negotiables</strong> <span className="muted small">read out at the 2:00 PM pre-interview</span></summary>
      <div className="nonneg-cols">
        <div>
          <h3>Experience</h3>
          <ul><li>Solid experience; must have worked for a US-based company (US licensed realtor where the role needs it). No beginners.</li></ul>
          <h3>Basic</h3>
          <ul>
            <li>Direct client, not an agency. Ideally start the same week as the offer.</li>
            <li>Full-time, long-term. Not freelance, part-time or project-based.</li>
            <li>Pacific time hours only (night shift).</li>
            <li>Time Doctor clock in/out is mandatory. Paid hourly, 40 hrs/week.</li>
            <li>Camera on all shift, facing forward. Working webcam and noise-cancelling headset.</li>
            <li>Professional dress (head to chest). Clients may join the Zoom helpdesk.</li>
            <li>No phone use during work hours.</li>
            <li>Paid only through their own verified Wise account.</li>
          </ul>
        </div>
        <div>
          <h3>Strict: communication and tech</h3>
          <ul>
            <li>Professional, fluent English with a neutral accent.</li>
            <li>Internet at least 50 Mbps up and down, on Ethernet (LAN). Not Wi-Fi only.</li>
            <li>Reliable headset and working camera.</li>
            <li>Computer: i5 or better (or i3 12th gen+ / Ryzen 5 5500+) and 8 GB RAM or more. Check with dxdiag.</li>
          </ul>
          <h3>After passing</h3>
          <ul>
            <li>Pre-onboarding Thursday 6:00 AM PT on the CW Zoom. No lates.</li>
            <li>Two-week probation commitment; any emergency must be communicated.</li>
            <li>Forms and new-hire agreement done before 6:00 AM PT Thursday.</li>
          </ul>
        </div>
      </div>
    </details>
  );
}
