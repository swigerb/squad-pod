import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createObserver } from './observer.js';
import { startTransport } from './transport.js';
import { OwnedRuns } from './ownedRuns.js';
import { createOfficeControl } from './officeControl.js';
import { resolveCopilotHome } from '../../src/copilotSessionState.js';

async function main() {
  const raw = process.argv.slice(2);
  const enabled = raw.includes('--terminals') || raw.includes('--fixture');
  const fixture = raw.includes('--fixture');
  const control = raw.includes('--office-control');
  const liveActivity = raw.includes('--live-activity');
  const args = raw.filter(arg => !['--terminals', '--fixture', '--office-control', '--live-activity'].includes(arg));
  if (args.length < 1 || args.length > 3 || (args.length > 1 && args[1] !== '--port')) {
    throw new Error('Usage: squad-pod-observer <absolute-project-path> [--port <0..65535>] [--terminals | --fixture] [--office-control] [--live-activity]');
  }
  const port = args.length === 1 ? 3210 : Number(args[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  if (liveActivity) {
    console.log(`Live activity opted in: bounded session-state directory metadata and workspace.yaml cwd reads under ${resolveCopilotHome()}; events.jsonl only for exact selected-project Squad sessions.`);
    console.log('Displays whitelisted task/tool/context fields only, never prompts or outputs. With --terminals, new owned launches use a server-generated --session-id UUID when child/observer homes match; otherwise exact observation is unavailable. With no active owned run, selects the newest matching-project Squad session (not an owned-terminal correlation).');
  }
  const terminals = new OwnedRuns({ project: args[0], enabled,
    fixture: fixture ? path.join(packageRoot, 'dist', 'fixture.mjs') : undefined, liveActivity });
  const observer = createObserver(args[0], path.join(packageRoot, 'dist', 'assets'), 1000, {
    liveActivity, sessionSelection: () => terminals.observationSelection(),
  });
  let server: Awaited<ReturnType<typeof startTransport>>;
  try {
    server = await startTransport({
      port, staticRoot: path.join(packageRoot, 'dist', 'browser'),
      snapshot: observer.snapshot, subscribe: observer.subscribe, onRead: observer.onRead,
      terminals,
      officeControl: control ? createOfficeControl(args[0]) : undefined,
    });
  } catch (error) { observer.dispose(); throw error; }
  // Credentials are never written to disk, URLs, access logs, or automatic diagnostics.
  console.log(`Squad Pod read-only observer: http://127.0.0.1:${server.port}`);
  console.log('Paste this runtime credential into the authentication form (do not share the console):');
  console.log(server.token);
  console.log('Terminal authority credential (separate from office viewing):');
  console.log(server.terminalToken);
  console.log(terminals.reason ?? (fixture ? 'Synthetic fixture terminals enabled; no Copilot/Squad is executed.' : 'Owned terminals enabled: copilot --agent squad (normal permissions).'));
  if (server.controlToken) {
    console.log('Office control authority credential (separate from observation and terminals):');
    console.log(server.controlToken);
  }
  console.log('Office is read-only unless separately authenticated for opted-in control. Type rotate to revoke all channels; quit to stop and clean up owned runs.');
  const input = createInterface({ input: process.stdin });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    input.close();
    process.stdin.destroy();
    observer.dispose();
    try { await server.dispose(); }
    catch (error) { console.error(`Owned cleanup failed: ${String(error)}`); process.exitCode = 1; }
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  input.on('line', (line) => {
    if (line.trim() === 'rotate') {
      console.log('Viewers revoked. New runtime credential:');
      console.log(server.rotate());
      console.log('New terminal authority credential:');
      console.log(server.terminalToken);
      if (server.controlToken) {
        console.log('New office control authority credential:');
        console.log(server.controlToken);
      }
    } else if (line.trim() === 'quit') void stop();
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(`Observer could not start: ${String(error)}`);
  process.exitCode = 1;
});
