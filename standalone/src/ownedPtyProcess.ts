import { fork } from 'node:child_process';
import type { LaunchSpec } from './ownedRuns.js';

export async function launchOwnedPty(broker: string, launch: LaunchSpec, cwd: string,
  env: Record<string, string>, authorized: () => boolean,
  onData: (data: string) => void, onExit: (code: number) => void, onFailure: () => void,
  directoryIdentity: { dev: number; ino: number }) {
  const child = fork(broker, [], { env, execArgv: [], stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true });
  let nativePid = 0;
  let started = false;
  let exitReported = false;
  let sequence = 0;
  const pending = new Map<number, { resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  let diagnostics = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (data: string) => { diagnostics = (diagnostics + data).slice(-4096); });
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  let killing: Promise<void> | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Native broker startup timed out.'));
    }, 10_000);
    const fail = (error: Error) => { clearTimeout(timer); reject(error); };
    child.once('error', fail);
    child.once('exit', code => {
      if (!exitReported) {
        if (nativePid && process.platform !== 'win32') {
          try { process.kill(-nativePid, 'SIGKILL'); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') {
              console.error(`Owned process-group cleanup failed: ${String(error)}`);
            }
          }
        }
        exitReported = true;
        onFailure();
        onExit(code ?? -1);
      }
      for (const action of pending.values()) { clearTimeout(action.timer); action.reject(new Error('Native broker exited.')); }
      pending.clear();
      fail(new Error(`Native broker exited before launch: ${diagnostics || code}`));
    });
    child.on('message', (message: { type: string; pid?: number; data?: string; exitCode?: number; id?: number; message?: string }) => {
      if (message.type === 'ready') {
        if (!authorized()) { child.disconnect(); child.kill(); fail(new Error('Terminal authorization revoked before native launch.')); return; }
        started = true;
        child.send({ type: 'start', ...launch, cwd, env, directoryIdentity });
      } else if (message.type === 'spawned') {
        nativePid = message.pid!;
        clearTimeout(timer);
        resolve();
      } else if (message.type === 'data') onData(message.data!);
      else if (message.type === 'overflow') onFailure();
      else if (message.type === 'exit') {
        exitReported = true;
        onExit(message.exitCode!);
      } else if ((message.type === 'ack' || message.type === 'error') && message.id !== undefined && pending.has(message.id)) {
        const action = pending.get(message.id)!;
        clearTimeout(action.timer);
        if (message.type === 'error') action.reject(new Error(message.message));
        else action.resolve();
        pending.delete(message.id);
      } else if (message.type === 'error') {
        fail(new Error(message.message));
        if (!nativePid) child.kill();
      }
    });
  });
  try { await ready; }
  catch (error) {
    if (started && child.connected) child.send({ type: 'kill' });
    else child.kill();
    await exited;
    throw error;
  }
  return {
    pid: nativePid,
    action(command: { type: 'input'; data: string } | { type: 'resize'; cols: number; rows: number }): Promise<void> {
      if (pending.size >= 64) return Promise.reject(new Error('Owned native action limit reached; command was not queued.'));
      if (!child.connected) return Promise.reject(new Error('Owned native console exited.'));
      return new Promise<void>((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Owned native action timed out.'));
        }, 5000);
        pending.set(id, { resolve, reject, timer });
        child.send({ ...command, id }, error => {
          if (error && pending.has(id)) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
      });
    },
    kill(): Promise<void> {
      if (killing) return killing;
      killing = (async () => {
        if (child.connected) child.send({ type: 'kill' });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const graceful = await Promise.race([
          exited.then(() => true),
          new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 6000); }),
        ]);
        clearTimeout(timer);
        if (graceful) return;
        onFailure();
        if (process.platform !== 'win32') {
          try { process.kill(-nativePid, 'SIGKILL'); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
        }
        // The ChildProcess handle addresses this broker only; Windows releases
        // its ConPTY handles when it exits. No PID/name-based system-wide kill.
        child.kill();
        await exited;
        throw new Error('Owned native broker forced to stop after cleanup timeout. Terminal continuity was invalidated.');
      })();
      return killing;
    },
    exited,
  };
}
