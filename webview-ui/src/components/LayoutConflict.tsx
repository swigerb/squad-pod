import { useState } from 'react';
import type { LayoutDraft } from '../office/editor/layoutDraft.js';
import { vscode } from '../vscodeApi.js';

export function LayoutConflict({ protection, onResolve }: {
  protection: LayoutDraft;
  onResolve: (id: number, choice: 'local' | 'incoming') => void;
}) {
  const [confirmId, setConfirmId] = useState<number | null>(null);
  const { draft, pending, retained } = protection.state;
  if (!pending.length && !retained.length && !protection.error) return null;
  return <section aria-label="Layout recovery" style={{
    position: 'absolute', top: 8, right: 8, zIndex: 300, maxWidth: 480,
    maxHeight: '65%', overflow: 'auto', padding: 12, border: '2px solid var(--vscode-focusBorder)',
    background: 'var(--vscode-editor-background)', color: 'var(--vscode-foreground)',
  }}>
    <strong>{pending.length ? `Layout conflict: ${pending.length} pending snapshot(s)` : 'Layout recovery copies'}</strong>
    <p>Both versions are retained. Keep editing locally, or explicitly use an incoming snapshot.
      Save is blocked until every pending snapshot is resolved. Imported layouts need Save to reach disk.</p>
    <p>Recovery uses this VS Code panel&apos;s state, not a durable backup. Export copies before closing the panel or changing workspace.</p>
    {protection.error && <p role="alert">{protection.error}</p>}
    {protection.invalidRecovery && <details><summary>Inspect original recovery state (copy before reopening)</summary>
      <pre>{JSON.stringify(protection.recoveryInput, null, 2)}</pre>
    </details>}
    {draft && <details><summary>Inspect local draft</summary>
      <pre>{JSON.stringify(draft, null, 2)}</pre>
      <button onClick={() => vscode.postMessage({ type: 'exportLayoutSnapshot', layout: draft })}>Export local draft</button>
    </details>}
    {pending.map((snapshot) => <div key={snapshot.id}>
      <details><summary>Incoming {snapshot.source} #{snapshot.id}</summary>
        {snapshot.workspaceRoot && <p>Source workspace: {snapshot.workspaceRoot}</p>}
        <pre>{JSON.stringify(snapshot.layout, null, 2)}</pre>
        <button onClick={() => vscode.postMessage({ type: 'exportLayoutSnapshot', layout: snapshot.layout })}>Export snapshot #{snapshot.id}</button>
      </details>
      <button onClick={() => { onResolve(snapshot.id, 'local'); setConfirmId(null); }}>Keep local draft #{snapshot.id}</button>
      {confirmId === snapshot.id
        ? <><p>Replace the working canvas? The current local draft will remain in recovery copies.</p>
          <button onClick={() => { onResolve(snapshot.id, 'incoming'); setConfirmId(null); }}>Confirm incoming #{snapshot.id}</button>
          <button onClick={() => setConfirmId(null)}>Cancel replacement</button></>
        : <button onClick={() => setConfirmId(snapshot.id)}>Use incoming #{snapshot.id}...</button>}
    </div>)}
    {!!retained.length && <details><summary>Retained recovery copies ({retained.length})</summary>
      {retained.map((snapshot) => <details key={snapshot.id}>
        <summary>Retained {snapshot.source} #{snapshot.id}</summary>
        <pre>{JSON.stringify(snapshot.layout, null, 2)}</pre>
        <button onClick={() => vscode.postMessage({ type: 'exportLayoutSnapshot', layout: snapshot.layout })}>Export retained #{snapshot.id}</button>
      </details>)}
    </details>}
  </section>;
}
