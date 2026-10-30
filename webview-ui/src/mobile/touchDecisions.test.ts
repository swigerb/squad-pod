import { describe, expect, it } from 'vitest';
import {
  canLongPress, findSafeTerminalLinks, isShortTap, moveTap, officePanStep, pinchZoom, safeTerminalUrl,
  startTap, terminalTapAction, type TouchSample,
} from './touchDecisions.js';
const touch = (x = 0, y = 0, time = 0, id = 1): TouchSample => ({ x, y, time, id });
describe('terminal taps and selection intent', () => {
  it('uses inclusive 10px radial slop and 350ms duration, including release without move', () => {
    const track = startTap(touch());
    expect(isShortTap(track, touch(6, 8, 350))).toBe(true);
    expect(isShortTap(track, touch(6, 8, 351))).toBe(false);
    expect(isShortTap(track, touch(8, 8, 100))).toBe(false);
    expect(isShortTap(track, touch(0, 0, -1))).toBe(false);
    expect(isShortTap(track, touch(0, 0, 100, 2))).toBe(false);
  });
  it('latches sideways drag out-and-back; ignores an untracked finger and rejects cancellation', () => {
    const initial = startTap(touch());
    expect(moveTap(initial, touch(40, 0, 100, 2))).toBe(initial);
    const returned = moveTap(moveTap(initial, touch(11, 0, 100)), touch(0, 0, 200));
    expect(terminalTapAction(returned, touch(0, 0, 250), false, 'https://example.com')).toEqual({ type: 'none' });
    expect(canLongPress(returned, 500)).toBe(false);
    expect(isShortTap({ ...initial, cancelled: true }, touch(0, 0, 100))).toBe(false);
  });
  it('long-press/selection never opens links; an ordinary short tap focuses or opens a safe URL', () => {
    const track = startTap(touch());
    expect(canLongPress(track, 499)).toBe(false);
    expect(canLongPress(track, 500)).toBe(true);
    expect(terminalTapAction(track, touch(0, 0, 500), false, 'https://example.com')).toEqual({ type: 'none' });
    expect(terminalTapAction(track, touch(0, 0, 100), true, 'https://example.com')).toEqual({ type: 'none' });
    expect(terminalTapAction(track, touch(0, 0, 100), false, null)).toEqual({ type: 'focus' });
    expect(terminalTapAction(track, touch(0, 0, 100), false, 'https://example.com/path')).toEqual({
      type: 'openUrl', url: 'https://example.com/path',
    });
  });
  it.each(['javascript:alert(1)', 'data:text/html,test', 'file:///tmp/test', '//example.com',
    'https://', 'http://[bad', ' https://example.com', 'https://example.com\n', 'https://example.com/a b',
    'https://user:pass@example.com', 'http:///example.com', 'https://?q=example.com',
    'https:\\\\example.com'])('rejects unsafe/malformed URL %j', url => {
    expect(safeTerminalUrl(url)).toBeNull();
  });
  it.each(['http://localhost:3000/path?q=1#part', 'https://example.com/', 'HTTPS://example.com/'])('allows explicit HTTP(S) %s', url => {
    expect(safeTerminalUrl(url)).toBe(new URL(url).href);
  });
  it('finds only safe delimited terminal URLs and excludes sentence punctuation', () => {
    expect(findSafeTerminalLinks('See https://example.com/path?q=1, or javascript:alert(1)')).toEqual([
      { start: 4, end: 32, url: 'https://example.com/path?q=1' },
    ]);
    expect(findSafeTerminalLinks('joinedhttps://example.com and https://user:pass@example.com/')).toEqual([]);
  });
});
describe('office pinch versus manual pan', () => {
  it('keeps CSS-pixel deltas independent of device-pixel ratio and breaks follow only after slop', () => {
    const anchor = { point: { x: 100, y: 100 }, pan: { x: 4, y: 8 }, panned: false };
    expect(pinchZoom(100, 200, 2)).toBe(4);
    const still = officePanStep(anchor, { x: 106, y: 108 });
    expect(still.breakFollow).toBe(false);
    expect(still.pan).toEqual({ x: 4, y: 8 });
    const moved = officePanStep(anchor, { x: 111, y: 100 });
    expect(moved.breakFollow).toBe(true);
    expect(moved.pan).toEqual({ x: 15, y: 8 });
    expect(officePanStep(moved.anchor, { x: 120, y: 100 }).breakFollow).toBe(false);
  });
  it('keeps integer zoom bounded and handles coincident fingers without NaN', () => {
    expect(pinchZoom(100, 1, 2)).toBe(1);
    expect(pinchZoom(100, 10000, 2)).toBe(10);
    expect(pinchZoom(0, 0, 2)).toBe(2);
    expect(pinchZoom(100, Infinity, 2)).toBe(2);
  });
});
