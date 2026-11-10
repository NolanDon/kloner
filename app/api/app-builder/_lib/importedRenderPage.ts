/** Build the generated page without interpreting imported HTML as template syntax. */
export function buildImportedRenderPage(html: string): string {
    const serializedHtml = JSON.stringify(html);
    return `export const dynamic = 'force-dynamic';

export default function Home() {
  return (
    <main className="kloner-shell">
      <div className="kloner-card">
        <div className="kloner-top">
          <div className="kloner-brand">
            <span className="kloner-dot" aria-hidden="true" />
            <span>Kloner</span>
          </div>
          <div className="kloner-meta">Imported render</div>
        </div>
        <div className="kloner-body">
          <div dangerouslySetInnerHTML={{ __html: ${serializedHtml} }} />
        </div>
      </div>
    </main>
  );
}`;
}
