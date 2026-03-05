import { parseSessionFile, parseLogEntry } from './squadWatcher.js';

describe('parseSessionFile', () => {
  it('parses valid session JSON with messages', () => {
    const content = JSON.stringify({
      id: 'sess-001',
      createdAt: '2025-01-15T10:00:00Z',
      lastActiveAt: '2025-01-15T10:05:00Z',
      agent: 'homer-simpson',
      messages: [
        { role: 'user', content: 'Fix the bug', timestamp: '2025-01-15T10:00:00Z' },
        { role: 'assistant', content: 'On it', timestamp: '2025-01-15T10:01:00Z' },
      ],
    });

    const session = parseSessionFile(content);

    expect(session).not.toBeNull();
    expect(session!.id).toBe('sess-001');
    expect(session!.createdAt).toBe('2025-01-15T10:00:00Z');
    expect(session!.agent).toBe('homer-simpson');
    expect(session!.messages).toHaveLength(2);
    expect(session!.messages[0].role).toBe('user');
    expect(session!.messages[0].content).toBe('Fix the bug');
  });

  it('returns null for invalid JSON', () => {
    expect(parseSessionFile('not json {')).toBeNull();
  });

  it('returns null when required fields are missing', () => {
    // Missing 'id'
    const noId = JSON.stringify({ createdAt: '2025-01-15T10:00:00Z' });
    expect(parseSessionFile(noId)).toBeNull();

    // Missing 'createdAt'
    const noDate = JSON.stringify({ id: 'test-1' });
    expect(parseSessionFile(noDate)).toBeNull();
  });

  it('handles session with no messages array', () => {
    const content = JSON.stringify({
      id: 'sess-002',
      createdAt: '2025-01-15T10:00:00Z',
    });
    const session = parseSessionFile(content);
    expect(session).not.toBeNull();
    expect(session!.messages).toEqual([]);
  });
});

describe('parseLogEntry', () => {
  it('extracts agent and timestamp from **Agent:** and **Timestamp:** fields', () => {
    const content = `# Log Entry

**Timestamp:** 2025-01-15T10:30:00Z
**Agent:** Lisa Simpson (Core Dev)

Implemented the new feature for the extension.
`;

    const result = parseLogEntry(content);

    expect(result).not.toBeNull();
    expect(result!.agent).toBe('lisa-simpson');
    expect(result!.timestamp).toBe('2025-01-15T10:30:00Z');
    expect(result!.summary).toBe('Implemented the new feature for the extension.');
  });

  it('extracts agent from heading-based format (# Log — Agent Name)', () => {
    const content = `# Orchestration Log — Lisa Simpson

Some orchestration details here.
`;

    const result = parseLogEntry(content);

    expect(result).not.toBeNull();
    expect(result!.agent).toBe('lisa-simpson');
    expect(result!.summary).toBe('Some orchestration details here.');
  });

  it('returns null for empty content', () => {
    expect(parseLogEntry('')).toBeNull();
    expect(parseLogEntry('   \n  \n  ')).toBeNull();
  });

  it('returns null when there is no agent and no meaningful summary', () => {
    // Only headings and metadata fields — no agent, no summary
    const content = `# Title
**Timestamp:** 2025-01-15
**Status:** done
`;
    const result = parseLogEntry(content);
    expect(result).toBeNull();
  });

  it('extracts timestamp from ISO date in first line when no **Timestamp:** field', () => {
    const content = `2025-01-15T10:30:00Z — something happened

**Agent:** Homer Simpson (Lead)

Built the new donut feature.
`;
    const result = parseLogEntry(content);
    expect(result).not.toBeNull();
    expect(result!.timestamp).toBe('2025-01-15T10:30:00Z');
    expect(result!.agent).toBe('homer-simpson');
  });

  it('returns a result with summary even without agent if summary is meaningful', () => {
    const content = `# Activity Log

This is a meaningful summary of what happened during the session.
`;
    const result = parseLogEntry(content);
    // Has summary but no agent — still should return a result
    expect(result).not.toBeNull();
    expect(result!.agent).toBeNull();
    expect(result!.summary).toContain('meaningful summary');
  });
});
