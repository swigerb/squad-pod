import { createRequire } from 'node:module';
import { realpathSync, statSync } from 'node:fs';

// One native console per isolated broker. Native helper threads cannot keep the
// office host alive after this console exits. This module is never an HTTP entry point.
const native = createRequire(import.meta.url)('node-pty') as typeof import('node-pty');
let pty: import('node-pty').IPty | undefined;
let outputSeen = false;
let queued = 0;
const send = (message: unknown) => {
  const bytes = Buffer.byteLength(JSON.stringify(message));
  if (queued + bytes > 1024 * 1024) {
    process.send?.({ type: 'overflow' });
    pty?.kill();
    return;
  }
  queued += bytes;
  if (queued > 512 * 1024) pty?.pause();
  process.send?.(message, error => {
    queued -= bytes;
    if (error) { pty?.kill(); process.exit(1); }
    if (queued < 256 * 1024) pty?.resume();
  });
};
process.on('message', (message: { type: string; file?: string; args?: string[]; cwd?: string;
  env?: Record<string, string>; data?: string; cols?: number; rows?: number; id?: number;
  directoryIdentity?: { dev: number; ino: number } }) => {
  try {
    if (message.type === 'start' && !pty) {
      const current = realpathSync(message.cwd!);
      const stat = statSync(current);
      const expected = message.directoryIdentity!;
      if (current !== message.cwd || !stat.isDirectory() || stat.ino !== expected.ino ||
        (stat.dev !== expected.dev && !(process.platform === 'win32' && expected.dev === 0))) {
        throw new Error('Selected project changed before native launch.');
      }
      pty = native.spawn(message.file!, message.args!, { cwd: message.cwd, env: message.env,
        cols: 80, rows: 24, name: 'xterm-256color', useConpty: true, useConptyDll: true });
      pty.onData(data => { outputSeen = true; send({ type: 'data', data }); });
      pty.onExit(event => {
        if (process.platform !== 'win32') {
          try { process.kill(-pty!.pid, 'SIGKILL'); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              process.send?.({ type: 'overflow' });
              console.error(`Owned process-group cleanup failed: ${String(error)}`);
            }
          }
        }
        process.send?.({ type: 'exit', exitCode: event.exitCode }, () => process.exit(0));
      });
      send({ type: 'spawned', pid: pty.pid });
    } else if (message.type === 'kill' && pty) {
      if (process.platform === 'win32') pty.kill();
      else {
        try { process.kill(-pty.pid, 'SIGKILL'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
      }
    } else if (pty && (message.type === 'input' || message.type === 'resize')) {
      if (!outputSeen && process.platform === 'win32') throw new Error('Native console is not ready for input/resize yet.');
      if (message.type === 'input') pty.write(message.data!);
      else pty.resize(message.cols!, message.rows!);
      send({ type: 'ack', id: message.id });
    } else throw new Error('Invalid native broker state.');
  } catch (error) {
    send({ type: 'error', id: message.id, message: String(error) });
  }
});
process.once('disconnect', () => {
  pty?.kill();
  // Closing this broker releases its owned ConPTY handles, not any other console.
  setTimeout(() => process.exit(1), 8000).unref();
});
send({ type: 'ready' });
