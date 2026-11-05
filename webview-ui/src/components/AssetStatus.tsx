import type { AssetSnapshot } from '../../../src/manifestAssets.js';
import type { PlacedFurniture } from '../office/types.js';
import { getAssetProblem } from '../office/layout/furnitureCatalog.js';
import { useHostClient } from '../HostClientContext.js';

export type AssetStatusData = Pick<AssetSnapshot, 'directories' | 'diagnostics'>;

export function AssetWarnings({ status, furniture }: { status: AssetStatusData; furniture: PlacedFurniture[] }) {
  const missing = [...new Set(furniture.map(getAssetProblem).filter(Boolean))];
  if (!missing.length && !status.diagnostics.length) return null;
  return (
    <details style={{ position: 'absolute', top: 8, right: 8, maxWidth: 360, maxHeight: '40%', overflow: 'auto', zIndex: 65, background: '#252526', color: '#eee', padding: 8 }}>
      <summary>Asset warnings ({status.diagnostics.length + missing.length})</summary>
      <p>Unavailable art is shown as grey markers. Your layout is unchanged. Export a backup before manually replacing items; unknown dimensions block placement.</p>
      {[...status.diagnostics, ...missing].map((message) => <p key={message}>{message}</p>)}
    </details>
  );
}

export function AssetDirectories({ status }: { status?: AssetStatusData }) {
  const client = useHostClient();
  const canAdd = client.capabilities.actions.includes('addAssetDirectory');
  const canRemove = client.capabilities.actions.includes('removeAssetDirectory');
  return (
    <div>
      <strong>Local furniture assets</strong>
      {canAdd && <p>Changes reload automatically. Removing a directory does not delete files or layout items.</p>}
      {!canAdd && <p role="status">External asset directories are unavailable: this host cannot browse local folders. Bundled art and third-party notices are unchanged.</p>}
      <button disabled={!canAdd} title={!canAdd ? 'Local folder access is unavailable in this host.' : undefined}
        onClick={() => { if (canAdd) client.send({ type: 'addAssetDirectory' }); }}>Add Asset Directory</button>
      {status?.directories.map((directory) => (
        <p key={directory}>{directory} <button disabled={!canRemove}
          title={!canRemove ? 'Asset directory management is unavailable in this host.' : undefined}
          onClick={() => { if (canRemove) client.send({ type: 'removeAssetDirectory', directory }); }}>Unload</button></p>
      ))}
      {status?.diagnostics.map((message) => <p role="alert" key={message}>{message}</p>)}
    </div>
  );
}
