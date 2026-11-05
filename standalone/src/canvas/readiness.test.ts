import { expect, it } from 'vitest';
import { CanvasReadiness, type ReadinessEvent } from './readiness.js';

it('allowlists, saturates and detaches each instance snapshot; disposal erases and disables it', () => {
  const first = new CanvasReadiness();
  const second = new CanvasReadiness();
  const zero = first.snapshot()!;
  expect(Object.keys(zero.counters)).toEqual([
    'documentRequests', 'scriptRequests', 'officeContextSuccesses', 'officeContextRefusals',
    'viewerBootstrapSuccesses', 'viewerBootstrapRefusals',
    'officeSocketAdmissions', 'officeSocketClosures', 'webviewReady',
  ]);
  for (const key of Object.keys(zero.counters) as ReadinessEvent[]) {
    for (let n = 0; n < 65537; n++) first.observe(key);
    expect(first.snapshot()!.counters[key]).toBe(65535);
  }
  for (const key of ['__proto__', 'constructor', 'SECRET', null, {}]) first.observe(key as ReadinessEvent);
  expect(first.snapshot()).toEqual({
    semantics: 'requests-observed-not-visible-renderer-or-host-defect', counterLimit: 65535,
    counters: Object.fromEntries(Object.keys(zero.counters).map(key => [key, 65535])),
  });
  zero.counters.documentRequests = 12;
  expect(first.snapshot()!.counters.documentRequests).toBe(65535);
  expect(second.snapshot()!.counters.documentRequests).toBe(0);
  first.dispose(); first.dispose(); first.observe('documentRequests');
  expect(first.snapshot()).toBeUndefined();
  expect(new CanvasReadiness().snapshot()).toEqual(second.snapshot());
});
