const initial = () => ({
  documentRequests: 0, scriptRequests: 0,
  officeContextSuccesses: 0, officeContextRefusals: 0,
  viewerBootstrapSuccesses: 0, viewerBootstrapRefusals: 0,
  officeSocketAdmissions: 0, officeSocketClosures: 0, webviewReady: 0,
});
export type ReadinessEvent = keyof ReturnType<typeof initial>;
export type ReadinessSnapshot = NonNullable<ReturnType<CanvasReadiness['snapshot']>>;

/** Fixed-size, instance-owned observations; never renderer visibility or host fault evidence. */
export class CanvasReadiness {
  private counters = initial();
  private disposed = false;

  /** Accept only allowlisted facts, saturating independently at 65535. */
  observe(event: ReadinessEvent): void {
    if (!this.disposed && Object.hasOwn(this.counters, event)) {
      this.counters[event] = Math.min(65535, this.counters[event] + 1);
    }
  }

  /** Return a detached safe projection for the authorized Canvas action only. */
  snapshot() {
    return this.disposed ? undefined : {
      semantics: 'requests-observed-not-visible-renderer-or-host-defect' as const,
      counterLimit: 65535, counters: { ...this.counters },
    };
  }

  /** Erase observations and ignore late transport callbacks. */
  dispose(): void { this.disposed = true; this.counters = initial(); }
}
