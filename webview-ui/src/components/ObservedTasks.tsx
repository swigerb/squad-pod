import type { LiveSourceStatus } from '../../../src/types.js';
import type { ObservedTaskSnapshot } from '../../../src/observedTasks.js';

export function ObservedTasks({ snapshot, source }: {
  snapshot: ObservedTaskSnapshot | null;
  source?: LiveSourceStatus;
}) {
  const following = source?.state === 'following';
  const tasks = following ? snapshot?.tasks ?? [] : [];
  const unavailable = source?.state === 'off' || !source
    ? 'Live Activity is off. Enable it in Settings and accept the confirmation.'
    : source.state === 'error'
      ? 'Live source unavailable. Task state cleared.'
      : 'Searching for a current session. Stale or missing task state is cleared.';
  return (
    <section aria-label="Observed transient tasks" style={{
      padding: '6px 12px', borderBottom: '1px solid var(--vscode-panel-border)',
      flexShrink: 0, maxHeight: '55%', overflowY: 'auto', overflowWrap: 'anywhere',
      fontSize: 12, color: 'var(--vscode-foreground)',
    }}>
      <h3 style={{ margin: '0 0 4px', fontSize: 12 }}>Observed transient tasks ({tasks.length})</h3>
      <p style={{ margin: '0 0 4px' }}>
        Session-local, not durable membership or recorded usage.
      </p>
      {!following ? <p role="status" style={{ margin: 0 }}>{unavailable}</p> : <>
        <details style={{ marginBottom: 4 }}>
          <summary>Coverage: bounded, best-effort</summary>
          <p style={{ margin: 0 }}>
            Session {source.sessionId ?? 'unknown'}. Startup restores in-flight calls only;
            at most 64 tasks and 16 recent completions. Older calls may be unavailable.
          </p>
        </details>
        {snapshot?.limited && <p role="status" style={{ margin: '0 0 4px' }}>
          Partial coverage: source data or task history was omitted by safety limits.
        </p>}
        {!tasks.length ? <p style={{ margin: 0 }}>No in-flight or recent task calls observed.</p> :
          <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {tasks.map((task, index) => {
              const parent = tasks.findIndex(candidate => candidate.sessionId === task.sessionId
                && candidate.toolCallId === task.parentToolCallId);
              return <li key={JSON.stringify([task.sessionId, task.toolCallId])}
                data-observed-task={task.toolCallId} style={{ marginBottom: 6 }}>
                <strong>#{index + 1} {task.name || 'Unnamed task'}</strong> - {task.state}
                <div>{task.agentId ? `Roster match: ${task.agentId}` : 'Unattributed'}
                  {' | '}{task.agentType || 'Unknown type'}{' | '}{task.mode || 'Unknown mode'}
                  {' | '}Parent: {parent >= 0 ? `task #${parent + 1}` : 'unknown'}
                </div>
                {task.description && <div>{task.description}</div>}
                {task.fieldsTruncated && <div>Display metadata truncated or omitted.</div>}
              </li>;
            })}
          </ol>}
      </>}
    </section>
  );
}
