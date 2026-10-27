/** Shown instantly on every click while the page's data loads. */
export default function Loading() {
  return (
    <div className="loading" aria-busy="true" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk-row">{Array.from({ length: 5 }, (_, i) => <div key={i} className="sk sk-tile" />)}</div>
      <div className="sk sk-panel" />
      <div className="sk sk-panel short" />
    </div>
  );
}
