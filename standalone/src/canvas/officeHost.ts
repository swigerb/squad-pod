import { lstat, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { createObserver } from '../observer.js';
import { startTransport } from '../transport.js';
import { createOfficeControl } from '../officeControl.js';
import type { OutboundMessage } from '../../../src/types.js';
import { CanvasActivity } from './activity.js';

/** Explicit local inputs supplied by a host adapter, not by a browser request. */
export interface CanvasOfficeHostOptions {
  projectRoot: string;
  bundledAssetsRoot: string;
  staticRoot: string;
  sessionId?: string;
}

/** Instance-owned office. The fragment contains only a single-use viewer secret. */
export interface CanvasOfficeHost {
  url: string;
  snapshot(): Promise<OutboundMessage[]>;
  acceptActivity?(event: unknown): void;
  clearActivity?(): void;
  dispose(): Promise<void>;
}

function localAbsolute(root: string): boolean {
  return isAbsolute(root) && !/^[\\/]{2}|^\\|^\/(?:mnt\/[a-z](?:\/|$)|wsl(?:\/|$))/i.test(root)
    && !root.includes('\0');
}

async function validateRoot(selected: string): Promise<string> {
  if (typeof selected !== 'string' || !localAbsolute(selected)) {
    throw new Error('CANVAS_INVALID_ROOT');
  }
  let root: string;
  try {
    root = await realpath(selected);
    if (!localAbsolute(root) || !(await stat(root)).isDirectory()) {
      throw new Error('invalid');
    }
  } catch { throw new Error('CANVAS_INVALID_ROOT'); }
  for (const name of ['.squad', '.ai-team']) {
    try {
      const marker = await lstat(join(root, name));
      if (!marker.isDirectory() || marker.isSymbolicLink()) { break; }
      return root;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { break; }
    }
  }
  throw new Error('CANVAS_TEAM_REQUIRED');
}

/**
 * Start an isolated loopback office without SDK, terminal, CLI-log or stdout use.
 * Canonical root validation is not session authority; the caller must establish it.
 * Startup failures expose only stable codes and release any acquired resources.
 */
export async function startCanvasOfficeHost(options: CanvasOfficeHostOptions): Promise<CanvasOfficeHost> {
  const root = await validateRoot(options.projectRoot);
  let observer: ReturnType<typeof createObserver> | undefined;
  let transport: Awaited<ReturnType<typeof startTransport>> | undefined;
  const listeners = new Set<(messages: OutboundMessage[]) => void>();
  const live = options.sessionId ? new CanvasActivity(options.sessionId,
    message => { for (const listener of listeners) listener([message]); }) : undefined;
  const snapshot = async () => {
    const messages = await observer!.snapshot();
    return live ? [...live.snapshot(messages), ...live.current()] : messages;
  };
  try {
    observer = createObserver(root, options.bundledAssetsRoot, 1000, { liveActivity: false, fileActivity: false });
    await snapshot();
    transport = await startTransport({
      staticRoot: options.staticRoot, canvas: true,
      officeControl: createOfficeControl(root),
      snapshot, subscribe: listener => {
        listeners.add(listener);
        const stop = observer!.subscribe(messages => listener(live ? live.snapshot(messages) : messages));
        return () => { listeners.delete(listener); stop(); };
      }, onRead: async message => {
        const messages = await observer!.onRead(message);
        return live ? live.snapshot(messages) : messages;
      },
    });
  } catch {
    try { await transport?.dispose(); } finally { observer?.dispose(); }
    throw new Error('CANVAS_START_FAILED');
  }
  const ownedObserver = observer;
  const ownedTransport = transport;
  let disposal: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${ownedTransport.port}/#c=${ownedTransport.token}`,
    snapshot,
    acceptActivity: event => live?.accept(event),
    clearActivity: () => live?.clear(),
    dispose() {
      if (!disposal) {
        live?.clear();
        listeners.clear();
        ownedObserver.dispose();
        disposal = ownedTransport.dispose().catch(() => { throw new Error('CANVAS_DISPOSE_FAILED'); });
      }
      return disposal;
    },
  };
}
