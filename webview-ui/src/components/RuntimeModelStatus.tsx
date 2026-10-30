import type { LiveModelSnapshot, LiveSourceStatus, RuntimeModelObservation } from '../../../src/types.js';

export function memberRuntimeModel(
  snapshot: LiveModelSnapshot | null | undefined,
  memberId: string,
): RuntimeModelObservation | null {
  return snapshot && Object.hasOwn(snapshot.members, memberId) ? snapshot.members[memberId] : null;
}

export function liveModelUnavailableReason(
  status: LiveSourceStatus | undefined,
  readOnly = false,
): string {
  if (!status) {return 'Live source status is unavailable; no runtime model observation is available.';}
  switch (status?.state ?? 'off') {
    case 'off': return readOnly
      ? 'Live Activity is off; approve the session-log scope and restart the local CLI with --live-activity. It cannot be enabled from the browser.'
      : 'Live Activity is off; enable it to observe runtime model events.';
    case 'searching': return 'No matching Copilot CLI session is currently being followed.';
    case 'error': return 'The selected Copilot CLI session could not be read.';
    case 'following': return 'The runtime has not emitted a supported current model observation for this session or member.';
  }
}

function modelLabel(model: string): string {
  return model.trim().toLowerCase() === 'auto'
    ? 'Automatic selection (auto; not a concrete model)' : model;
}

function observationKind(kind: RuntimeModelObservation['kind']): string {
  switch (kind) {
    case 'session-selection': return 'Runtime session selection';
    case 'assistant-message': return 'Model emitted for an assistant response';
    case 'tool-call': return 'Model emitted for a tool call';
    case 'subagent-model': return 'Resolved subagent model';
  }
}

export function RuntimeModelStatus({
  label,
  observation,
  unavailableReason,
}: {
  label: string;
  observation: RuntimeModelObservation | null | undefined;
  unavailableReason: string;
}) {
  return (
    <div>
      <strong>{label}:</strong> {observation ? modelLabel(observation.model) : 'unavailable'}
      {observation ? (
        <div>
          {observationKind(observation.kind)} ({observation.source}) at{' '}
          <time dateTime={observation.timestamp}>{observation.timestamp}</time>
        </div>
      ) : <div role="status">{unavailableReason}</div>}
    </div>
  );
}
