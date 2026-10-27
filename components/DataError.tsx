export default function DataError({ error }: { error: unknown }) {
  return (
    <div className="panel error-panel">
      <h2>The pipeline data could not be loaded</h2>
      <p>{error instanceof Error ? error.message : 'Unknown error'}. Please try again in a minute. If it keeps happening, tell Miguel.</p>
    </div>
  );
}
