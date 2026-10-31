import { useEffect, useId, useRef, useState, type Ref } from 'react';
import { useHostClient } from '../HostClientContext.js';
import type { DirectoryCatalog, DirectoryEntry } from '../../../src/types.js';

interface DirectoryModalProps {
  catalog: DirectoryCatalog | null;
  error: string | null;
  notice: string | null;
  browseAvailable?: boolean;
  onClose: () => void;
}

function ActionButton({
  children,
  onClick,
  disabled = false,
  title,
  ariaLabel,
  ariaDescribedBy,
  buttonRef,
  variant = 'secondary',
  buttonType = 'button',
}: {
  children: string;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  variant?: 'primary' | 'secondary' | 'danger';
  buttonType?: 'button' | 'submit';
}) {
  return (
    <button
      type={buttonType}
      ref={buttonRef}
      className={`directory-action directory-action--${variant}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
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
  const statusId = useId();
  const reasonId = useId();
  const errorId = useId();
  const sourceLabel = source === 'workspace'
    ? 'Workspace folder'
    : source === 'saved' ? 'Saved directory' : 'Recent launch request';
  const unavailableReason = 'This folder is missing or cannot be accessed.';

  return (
    <article
      className="directory-row"
      aria-label={`${sourceLabel}: ${entry.name}`}
      data-directory-row={entry.id}
    >
      <div className="directory-row__details">
        <div className="directory-row__heading">
          <strong className="directory-row__name">{entry.name}</strong>
          <span
            id={statusId}
            className={`directory-status ${entry.valid ? 'directory-status--ready' : 'directory-status--missing'}`}
          >
            {entry.valid ? 'Available' : 'Unavailable'}
          </span>
        </div>
        <code
          className="directory-row__path"
          title={entry.path}
          aria-label={`Full path for ${entry.name}: ${entry.path}`}
          tabIndex={0}
        >
          {entry.path}
        </code>
        {!entry.valid && <p id={reasonId} className="directory-row__reason">{unavailableReason}</p>}
        {entry.lastLaunchedAt && (
          <p className="directory-row__timestamp">
            Request recorded {new Date(entry.lastLaunchedAt).toLocaleString()}
          </p>
        )}
        {entry.error && (
          <details className="directory-row__error">
            <summary>{entry.valid ? 'Status details' : 'Why is this unavailable?'}</summary>
            <pre id={errorId}>{entry.error}</pre>
          </details>
        )}
      </div>
      <div className="directory-row__actions">
        <ActionButton
          variant="primary"
          disabled={!entry.valid}
          title={entry.valid ? undefined : `Launch unavailable: ${unavailableReason}`}
          ariaLabel={`Launch ${entry.name}`}
          ariaDescribedBy={entry.valid ? undefined : `${statusId} ${reasonId}`}
          onClick={() => client.send({ type: 'launchDirectory', id: entry.id, source })}
        >
          Launch
        </ActionButton>
      </div>
      {source === 'saved' && onNameChange && (
        <details className="directory-row__manage">
          <summary aria-label={`Manage directory actions for ${entry.name}`}>Manage</summary>
          <div className="directory-row__manage-content">
            <label className="directory-field">
              <span>Name</span>
              <input
                className="directory-input"
                aria-label={`Name for ${entry.name}`}
                value={nameValue ?? entry.name}
                onChange={(event) => onNameChange(event.currentTarget.value)}
                maxLength={80}
              />
            </label>
            <div className="directory-row__secondary-actions">
              <ActionButton
                ariaLabel={`Rename ${entry.name}`}
                onClick={() => client.send({
                  type: 'updateDirectoryName', id: entry.id, name: nameValue ?? entry.name,
                })}
              >
                Rename
              </ActionButton>
              <ActionButton
                ariaLabel={`Change folder for ${entry.name}`}
                onClick={() => client.send({ type: 'changeDirectoryPath', id: entry.id })}
              >
                Change folder
              </ActionButton>
              <ActionButton
                variant="danger"
                ariaLabel={`Remove ${entry.name}`}
                onClick={() => client.send({ type: 'removeDirectory', id: entry.id })}
              >
                Remove
              </ActionButton>
            </div>
          </div>
        </details>
      )}
      {source === 'recent' && (
        <details className="directory-row__manage">
          <summary aria-label={`Manage recent request for ${entry.name}`}>Manage</summary>
          <div className="directory-row__manage-content">
            <div className="directory-row__secondary-actions">
              <ActionButton
                ariaLabel={`Forget recent request for ${entry.name}`}
                onClick={() => client.send({ type: 'forgetDirectoryLaunch', id: entry.id })}
              >
                Forget request
              </ActionButton>
            </div>
          </div>
        </details>
      )}
    </article>
  );
}

export function DirectoryModal({
  catalog,
  error,
  notice,
  browseAvailable = true,
  onClose,
}: DirectoryModalProps) {
  const client = useHostClient();
  const dialogRef = useRef<HTMLElement>(null);
  const browseButtonRef = useRef<HTMLButtonElement>(null);
  const directoryPathRef = useRef<HTMLInputElement>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [directoryPath, setDirectoryPath] = useState('');
  const [directoryName, setDirectoryName] = useState('');
  const [manualOpen, setManualOpen] = useState(!browseAvailable);
  const workspaceDirectories = catalog?.workspaceDirectories ?? [];
  const savedDirectories = catalog?.savedDirectories ?? [];
  const recentLaunches = catalog?.recentLaunches ?? [];
  const squadHistory = catalog?.squadHistory ?? [];

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (browseButtonRef.current ?? directoryPathRef.current ?? dialogRef.current)?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="directory-modal__backdrop" onClick={onClose}>
      <section
        ref={dialogRef}
        className="directory-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-modal-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== 'Tab') return;

          const dialog = dialogRef.current;
          if (!dialog) return;
          const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), summary, [href], [tabindex]:not([tabindex="-1"])',
          )).filter((element) => (
            element.getAttribute('aria-hidden') !== 'true'
            && (!element.closest('details:not([open])') || element.matches('summary'))
          ));
          const first = focusable[0];
          const last = focusable.at(-1);
          if (!first || !last) {
            event.preventDefault();
            dialog.focus();
            return;
          }
          const active = document.activeElement;
          if (!dialog.contains(active)) {
            event.preventDefault();
            first.focus();
          } else if (event.shiftKey && (active === first || active === dialog)) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (active === last || active === dialog)) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header className="directory-modal__header">
          <div>
            <p className="directory-modal__eyebrow">FOLDERS</p>
            <h2 id="directory-modal-title">Launch directory</h2>
          </div>
          <button
            type="button"
            className="directory-icon-button"
            onClick={onClose}
            aria-label="Close directories"
          >
            ×
          </button>
        </header>

        <p className="directory-modal__intro">
          Choose a folder to launch Squad explicitly.
        </p>
        <details className="directory-modal__disclosure">
          <summary>How directory launches work</summary>
          <div>
            <p>
              Launch submits <code>copilot --agent squad</code> in a new VS Code terminal at the selected folder.
            </p>
            <p>
              Recent launch requests are recorded when the command is submitted; they do not prove the CLI started.
            </p>
          </div>
        </details>

        {error && (
          <div className="directory-global-error" role="alert">
            <strong>Directory action needs attention</strong>
            <details>
              <summary>Show error details</summary>
              <pre>{error}</pre>
            </details>
          </div>
        )}
        {notice && <p className="directory-notice" role="status">{notice}</p>}

        <div
          className="directory-list"
          role="region"
          aria-label="Directory list"
          style={{ overflowY: 'auto', overflowX: 'hidden' }}
        >
          <section className="directory-section" aria-labelledby="workspace-directories-heading">
            <div className="directory-section__heading">
              <h3 id="workspace-directories-heading">Workspace folders</h3>
              <span>{workspaceDirectories.length}</span>
            </div>
            {workspaceDirectories.length ? workspaceDirectories.map((entry) => (
              <DirectoryRow key={entry.id} entry={entry} source="workspace" />
            )) : <p className="directory-empty">No workspace folders are open.</p>}
          </section>

          <section className="directory-section" aria-labelledby="saved-directories-heading">
            <div className="directory-section__heading">
              <h3 id="saved-directories-heading">Saved directories</h3>
              <span>{savedDirectories.length}</span>
            </div>
            {savedDirectories.length ? savedDirectories.map((entry) => (
              <DirectoryRow
                key={entry.id}
                entry={entry}
                source="saved"
                nameValue={names[entry.id] ?? entry.name}
                onNameChange={(name) => setNames((previous) => ({ ...previous, [entry.id]: name }))}
              />
            )) : <p className="directory-empty">No saved directories yet.</p>}
          </section>

          <section className="directory-section" aria-labelledby="recent-launches-heading">
            <div className="directory-section__heading">
              <h3 id="recent-launches-heading">Recent launch requests</h3>
              <span>{recentLaunches.length}</span>
            </div>
            {recentLaunches.length ? recentLaunches.map((entry) => (
              <DirectoryRow key={entry.id} entry={entry} source="recent" />
            )) : <p className="directory-empty">No launch requests have been recorded.</p>}
          </section>
        </div>

        <footer className="directory-add">
          <div>
            <h3>Add a directory</h3>
            <p>Save a folder so you can launch it explicitly later.</p>
          </div>
          {browseAvailable && (
            <ActionButton
              variant="primary"
              ariaLabel="Browse for a directory"
              buttonRef={browseButtonRef}
              onClick={() => client.send({ type: 'addDirectory' })}
            >
              Browse for a directory
            </ActionButton>
          )}
          <details
            className="directory-manual"
            open={manualOpen}
            onToggle={(event) => setManualOpen(event.currentTarget.open)}
          >
            <summary>Enter a path manually or choose a recent Squad folder</summary>
            {squadHistory.length > 0 && (
              <section className="directory-suggestions" aria-label="Recent Squad directories">
                <p>Suggestions fill the form only. They are not saved or launched automatically.</p>
                <div>
                  {squadHistory.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      className="directory-suggestion"
                      title={entry.path}
                      onClick={() => {
                        setDirectoryPath(entry.path);
                        setDirectoryName(entry.name);
                        setManualOpen(true);
                        directoryPathRef.current?.focus();
                      }}
                    >
                      {entry.name}
                    </button>
                  ))}
                </div>
              </section>
            )}
            <form
              aria-label="Manual directory entry"
              onSubmit={(event) => {
                event.preventDefault();
                if (directoryPath && directoryName.trim()) {
                  client.send({ type: 'addDirectory', path: directoryPath, name: directoryName });
                }
              }}
            >
              <label className="directory-field">
                <span>Directory path</span>
                <input
                  ref={directoryPathRef}
                  className="directory-input"
                  aria-label="Directory path"
                  value={directoryPath}
                  onChange={(event) => setDirectoryPath(event.currentTarget.value)}
                  required
                />
              </label>
              <label className="directory-field">
                <span>Directory name</span>
                <input
                  className="directory-input"
                  aria-label="Directory name"
                  value={directoryName}
                  onChange={(event) => setDirectoryName(event.currentTarget.value)}
                  maxLength={80}
                  required
                />
              </label>
              <ActionButton
                buttonType="submit"
                variant="secondary"
                ariaLabel="Save directory"
                disabled={!directoryPath || !directoryName.trim()}
              >
                Save directory
              </ActionButton>
            </form>
          </details>
        </footer>
      </section>
    </div>
  );
}
