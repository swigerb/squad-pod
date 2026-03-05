import {
  startActivityTimer,
  cancelActivityTimer,
  resetActivityTimer,
  cancelAllTimers,
} from './timerManager.js';

describe('timerManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelAllTimers();
    vi.useRealTimers();
  });

  it('fires callback after the specified delay', () => {
    const cb = vi.fn();
    startActivityTimer('agent-1', 1000, cb);

    vi.advanceTimersByTime(999);
    expect(cb).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('resetActivityTimer restarts the countdown', () => {
    const cb = vi.fn();
    startActivityTimer('agent-1', 1000, cb);

    vi.advanceTimersByTime(800);
    expect(cb).not.toHaveBeenCalled();

    // Reset with a new 1000ms timer
    resetActivityTimer('agent-1', 1000, cb);

    // Old timer's 200ms remaining should NOT fire
    vi.advanceTimersByTime(200);
    expect(cb).not.toHaveBeenCalled();

    // Advance to the full new delay
    vi.advanceTimersByTime(800);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('cancelActivityTimer prevents callback from firing', () => {
    const cb = vi.fn();
    startActivityTimer('agent-1', 1000, cb);

    vi.advanceTimersByTime(500);
    cancelActivityTimer('agent-1');

    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it('cancelAllTimers stops all pending timers', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const cb3 = vi.fn();

    startActivityTimer('a', 1000, cb1);
    startActivityTimer('b', 2000, cb2);
    startActivityTimer('c', 3000, cb3);

    cancelAllTimers();

    vi.advanceTimersByTime(5000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).not.toHaveBeenCalled();
    expect(cb3).not.toHaveBeenCalled();
  });

  it('startActivityTimer is a no-op if timer already exists for the key', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    startActivityTimer('agent-1', 1000, cb1);
    // Second call with same key — should be ignored
    startActivityTimer('agent-1', 500, cb2);

    vi.advanceTimersByTime(500);
    // cb2 would have fired at 500 if it replaced cb1
    expect(cb2).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500);
    // cb1 fires at 1000
    expect(cb1).toHaveBeenCalledOnce();
    expect(cb2).not.toHaveBeenCalled();
  });

  it('resetActivityTimer DOES overwrite an existing timer', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    startActivityTimer('agent-1', 1000, cb1);
    resetActivityTimer('agent-1', 500, cb2);

    vi.advanceTimersByTime(500);
    expect(cb2).toHaveBeenCalledOnce();
    expect(cb1).not.toHaveBeenCalled();

    // Original timer should not fire either
    vi.advanceTimersByTime(1000);
    expect(cb1).not.toHaveBeenCalled();
  });
});
