import { describe, expect, it, vi } from 'vitest';
import {
  authorizeTerminal, decodeTerminalCommand, decodeTerminalEvent, decodeTerminalFrame,
  encodeTerminalFrame, runId, terminalCapabilities, TERMINAL_LIMITS, utf8Bytes,
  type RunEntry, type TerminalCommand, type TerminalFrame,
} from './terminalFrames.js';

const id = runId('run_test-1');
const base = { version: 1, runId: id } as const;
const parse = (value: unknown) => decodeTerminalFrame(JSON.stringify(value));

describe('versioned terminal wire boundary', () => {
  it.each([
    null, [], {}, { ...base, type: 'future' }, { ...base, version: 2, type: 'terminate' },
    { ...base, runId: '../external', type: 'terminate' },
    { ...base, type: 'terminate', owned: true },
    ...[-1, 0.1, Number.MAX_SAFE_INTEGER + 1, null, '1'].map(cursor => ({ ...base, type: 'attach', cursor })),
    ...[0, -1, 1.1, 1001, null].map(cols => ({ ...base, type: 'resize', cols, rows: 24 })),
    { ...base, type: 'resize', cols: 80, rows: 0 },
    { ...base, type: 'output', seq: 0, data: 'x' },
    { ...base, type: 'output', seq: 1, data: '' },
    { ...base, type: 'output', seq: 1, data: '\ud800' },
    { ...base, type: 'input', data: '\udc00' },
    { ...base, type: 'replayStart', cursor: 3, through: 2 },
    { ...base, type: 'replayEnd', through: -1 },
    { ...base, type: 'resync', reason: 'unknown', earliest: 1, latest: 0 },
    { ...base, type: 'resync', reason: ['overflow'], earliest: 1, latest: 0 },
    { ...base, type: 'resync', reason: 'history-gap', earliest: 3, latest: 1 },
  ])('rejects malformed, unsupported or invalid fields: %j', value => {
    expect(() => parse(value)).toThrow();
  });

  it('rejects non-JSON, nonfinite numbers and direction confusion', () => {
    expect(() => decodeTerminalFrame('{')).toThrow();
    expect(() => decodeTerminalFrame(`{"version":1,"runId":"${id}","type":"attach","cursor":1e999}`)).toThrow();
    expect(() => decodeTerminalCommand(encodeTerminalFrame({ ...base, type: 'replayEnd', through: 0 }))).toThrow();
    expect(() => decodeTerminalEvent(encodeTerminalFrame({ ...base, type: 'terminate' }))).toThrow();
  });

  it('round-trips every supported kind and the maximum safe cursor', () => {
    const frames: TerminalFrame[] = [
      { ...base, type: 'attach', cursor: Number.MAX_SAFE_INTEGER },
      { ...base, type: 'input', data: '\u001b[31m\u00e9\u4e2d\ud83d\ude80' },
      { ...base, type: 'resize', cols: 1000, rows: 1 }, { ...base, type: 'terminate' },
      { ...base, type: 'output', seq: Number.MAX_SAFE_INTEGER, data: 'text' },
      { ...base, type: 'replayStart', cursor: 0, through: 1 },
      { ...base, type: 'replayEnd', through: 1 },
      { ...base, type: 'resync', reason: 'overflow', earliest: 1, latest: 0 },
    ];
    for (const frame of frames) {expect(decodeTerminalFrame(encodeTerminalFrame(frame))).toEqual(frame);}
  });

  it('enforces exact serialized UTF-8 frame and input byte ceilings, not character counts', () => {
    const frame: TerminalFrame = { ...base, type: 'output', seq: 1, data: 'x' };
    const overhead = utf8Bytes(JSON.stringify(frame)) - 1;
    frame.data = 'x'.repeat(TERMINAL_LIMITS.frameBytes - overhead - 4) + '\ud83d\ude80';
    const encoded = encodeTerminalFrame(frame);
    expect(utf8Bytes(encoded)).toBe(TERMINAL_LIMITS.frameBytes);
    expect(decodeTerminalFrame(encoded)).toEqual(frame);
    expect(() => encodeTerminalFrame({ ...frame, data: frame.data + 'x' })).toThrow('byte limit');
    const input: TerminalCommand = { ...base, type: 'input', data: '\ud83d\ude80'.repeat(TERMINAL_LIMITS.inputBytes / 4) };
    expect(decodeTerminalCommand(encodeTerminalFrame(input))).toEqual(input);
    expect(() => encodeTerminalFrame({ ...input, data: input.data + 'x' })).toThrow('fields');
  });
});

describe('owned versus observed authority', () => {
  it('never promotes an observed entry, even with forged owned fields', () => {
    const observed = { kind: 'observed', observationId: 'external', runId: id } as const;
    const owned: RunEntry = { kind: 'owned', runId: id };
    const process = { input: vi.fn(), resize: vi.fn(), terminate: vi.fn() };
    const commands: TerminalCommand[] = [
      { ...base, type: 'attach', cursor: 0 }, { ...base, type: 'input', data: 'x' },
      { ...base, type: 'resize', cols: 80, rows: 24 }, { ...base, type: 'terminate' },
    ];
    expect(terminalCapabilities(observed)).toEqual({ attach: false, input: false, resize: false, terminate: false });
    expect(terminalCapabilities(owned)).toEqual({ attach: true, input: true, resize: true, terminate: true });
    const dispatch = (entry: RunEntry, command: TerminalCommand) => {
      authorizeTerminal(entry, command);
      if (command.type === 'input') {process.input(command.data);}
      if (command.type === 'resize') {process.resize(command.cols, command.rows);}
      if (command.type === 'terminate') {process.terminate();}
    };
    for (const command of commands) {expect(() => dispatch(observed, command)).toThrow('owned');}
    expect(process.terminate).not.toHaveBeenCalled();
    expect(process.input).not.toHaveBeenCalled();
    expect(process.resize).not.toHaveBeenCalled();
    expect(() => dispatch(owned, { ...base, runId: runId('another-run'), type: 'terminate' })).toThrow('owned');
    for (const command of commands) {dispatch(owned, command);}
    expect(process.terminate).toHaveBeenCalledOnce();
    expect(process.input).toHaveBeenCalledWith('x');
    expect(process.resize).toHaveBeenCalledWith(80, 24);
  });
});
