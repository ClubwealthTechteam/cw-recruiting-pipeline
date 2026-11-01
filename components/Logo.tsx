/** CWCRM logo: rising bars (pipeline stages) + wordmark. tone="dark" for the navy sidebar, "light" for white cards. */
export default function Logo({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const box = tone === 'dark' ? '#1f5fbf' : '#14233c';
  const bar = tone === 'dark' ? '#ffffff' : '#4d8ef0';
  return (
    <div className={`logo logo-${tone}`}>
      <svg viewBox="0 0 64 64" width="32" height="32" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill={box} />
        <rect x="12" y="34" width="10" height="18" rx="2" fill={bar} opacity=".55" />
        <rect x="27" y="24" width="10" height="28" rx="2" fill={bar} opacity=".8" />
        <rect x="42" y="12" width="10" height="40" rx="2" fill="#fff" />
      </svg>
      <span className="logo-word">CW<b>CRM</b></span>
    </div>
  );
}
