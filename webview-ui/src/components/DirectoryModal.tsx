import { useState } from 'react';
import { useHostClient } from '../HostClientContext.js';
import type { DirectoryCatalog, DirectoryEntry } from '../../../src/types.js';

interface DirectoryModalProps {
  catalog: DirectoryCatalog | null;
  error: string | null;
  notice: string | null;
  onClose: () => void;
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  title,
  ariaLabel,
}: {
  children: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      style={{
        padding: '6px 9px',
        border: '1px solid var(--vscode-button-border, var(--vscode-panel-border))',
        borderRadius: '4px',
        background: disabled ? 'var(--vscode-button-secondaryBackground)' : 'var(--vscode-button-background)',
        color: disabled ? 'var(--vscode-disabledForeground)' : 'var(--vscode-button-foreground)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: '12px',
      }}
    >
      {children}
    </button>
  );
}

function DirectoryRow({
  entry,
  source,
  onNameChange,
  nameValue,
}: {
  entry: DirectoryEntry;
  source: 'workspace' | 'saved' | 'recent';
  onNameChange?: (name: string) => void;
  nameValue?: string;
}) {
  const client = useHostClient();
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px',
        borderBottom: '1px solid var(--vscode-panel-border)',
        minWidth: 0,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {source === 'saved' ? (
          <label style={{ display: 'block', marginBottom: '4px' }}>
            <span style={{ display: 'block', fontSize: '11px', opacity: 0.75, marginBottom: '3px' }}>Name</span>
            <input
              aria-label={`Name for ${entry.name}`}
              value={nameValue ?? entry.name}
              onChange={(event) => onNameChange?.(event.currentTarget.value)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '5px' }}
            />
          </label>
        ) : (
          <div style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{entry.name}</div>
        )}
        <code style={{ display: 'block', fontSize: '11px', opacity: 0.8, overflowWrap: 'anywhere' }}>{entry.path}</code>
        {entry.lastLaunchedAt && (
          <div style={{ fontSize: '11px', opacity: 0.7 }}>
            Request recorded: {new Date(entry.lastLaunchedAt).toLocaleString()}
          </div>
        )}
        {entry.error && <div role="alert" style={{ color: 'var(--vscode-errorForeground)', fontSize: '12px' }}>{entry.error}</div>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: '6px', flexShrink: 0 }}>
        <ActionButton
          disabled={!entry.valid}
          title={entry.valid ? undefined : entry.error ?? 'This directory is invalid.'}
          ariaLabel={`Launch ${entry.name}`}
          onClick={() => client.send({ type: 'launchDirectory', id: entry.id, source })}
        >
          Launch
        </ActionButton>
        {source === 'saved' && onNameChange && (
          <>
            <ActionButton
              onClick={() => client.send({
                type: 'updateDirectoryName', id: entry.id, name: nameValue ?? entry.name,
              })}
            >
              Save name
            </ActionButton>
            <ActionButton onClick={() => client.send({ type: 'changeDirectoryPath', id: entry.id })}>
              Change folder
            </ActionButton>
            <ActionButton onClick={() => client.send({ type: 'removeDirectory', id: entry.id })}>
              Remove
            </ActionButton>
          </>
        )}
        {source === 'recent' && (
          <ActionButton onClick={() => client.send({ type: 'forgetDirectoryLaunch', id: entry.id })}>
            Forget
          </ActionButton>
        )}
      </div>
    </div>
  );
}

export function DirectoryModal({ catalog, error, notice, onClose }: DirectoryModalProps) {
  const client = useHostClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const workspaceDirectories = catalog?.workspaceDirectories ?? [];
  const savedDirectories = catalog?.savedDirectories ?? [];
  const recentLaunches = catalog?.recentLaunches ?? [];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Launch directory"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        background: 'rgba(0, 0, 0, 0.65)',
      }}
      onClick={onClose}
    >
      <section
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: 'min(760px, 96vw)',
          maxHeight: '90vh',
          background: 'var(--vscode-editor-background)',
          color: 'var(--vscode-foreground)',
          border: '1px solid var(--vscode-panel-border)',
          borderRadius: '8px',
          padding: '18px',
          boxSizing: 'border-box',
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '16px' }}>Launch directory</h2>
          <button type="button" onClick={onClose} aria-label="Close directories">×</button>
        </header>

        <p style={{ fontSize: '12px', margin: '10px 0' }}>
          Launches use <code>copilot --agent squad</code> in a new terminal at the selected folder. Squad Pod does not auto-launch.
        </p>
        <p style={{ fontSize: '12px', margin: '0 0 10px' }}>
          Squad history suggestions are unavailable because Squad does not expose a supported directory-launch history source.
          Recent launch requests below are recorded by Squad Pod when it submits the command; they do not prove the CLI started.
        </p>

        {error && <div role="alert" style={{ color: 'var(--vscode-errorForeground)', marginBottom: '8px' }}>{error}</div>}
        {notice && <div role="status" style={{ marginBottom: '8px' }}>{notice}</div>}

        <div
          aria-label="Directory list"
          style={{
            minHeight: 0,
            overflowY: 'auto',
            borderTop: '1px solid var(--vscode-panel-border)',
            borderBottom: '1px solid var(--vscode-panel-border)',
          }}
        >
          <h3 style={{ fontSize: '13px', margin: '12px 10px 4px' }}>Workspace folders</h3>
          {workspaceDirectories.length ? workspaceDirectories.map((entry) => (
            <DirectoryRow key={entry.id} entry={entry} source="workspace" />
          )) : <p style={{ padding: '0 10px', opacity: 0.75 }}>No workspace folders are open.</p>}

          <h3 style={{ fontSize: '13px', margin: '12px 10px 4px' }}>Saved directories</h3>
          {savedDirectories.length ? savedDirectories.map((entry) => (
            <DirectoryRow
              key={entry.id}
              entry={entry}
              source="saved"
              nameValue={names[entry.id] ?? entry.name}
              onNameChange={(name) => setNames((previous) => ({ ...previous, [entry.id]: name }))}
            />
          )) : <p style={{ padding: '0 10px', opacity: 0.75 }}>No saved directories yet.</p>}

          <h3 style={{ fontSize: '13px', margin: '12px 10px 4px' }}>Recent Squad Pod launch requests</h3>
          {recentLaunches.length ? recentLaunches.map((entry) => (
            <DirectoryRow key={entry.id} entry={entry} source="recent" />
          )) : <p style={{ padding: '0 10px', opacity: 0.75 }}>No launch records yet.</p>}
        </div>

        <footer style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', paddingTop: '12px' }}>
          <ActionButton onClick={() => client.send({ type: 'addDirectory' })}>Add directory</ActionButton>
          <ActionButton onClick={onClose}>Close</ActionButton>
        </footer>
      </section>
    </div>
  );
}
