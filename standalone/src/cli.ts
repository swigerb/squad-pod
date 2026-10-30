import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { createObserver } from './observer.js';
import { startTransport } from './transport.js';

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1 || args.length > 3 || (args.length > 1 && args[1] !== '--port')) {
    throw new Error('Usage: squad-pod-observer <absolute-project-path> [--port <0..65535>]');
  }
  const port = args.length === 1 ? 3210 : Number(args[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535.');
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const observer = createObserver(args[0], path.join(packageRoot, 'dist', 'assets'));
  let server: Awaited<ReturnType<typeof startTransport>>;
  try {
    server = await startTransport({
      port, staticRoot: path.join(packageRoot, 'dist', 'browser'),
      snapshot: observer.snapshot, subscribe: observer.subscribe, onRead: observer.onRead,
    });
  } catch (error) { observer.dispose(); throw error; }
  // Credentials are never written to disk, URLs, access logs, or automatic diagnostics.
  console.log(`Squad Pod read-only observer: http://127.0.0.1:${server.port}`);
  console.log('Paste this runtime credential into the authentication form (do not share the console):');
  console.log(server.token);
  console.log('No terminals, writes, home-log discovery, or external assets. Type rotate to revoke all viewers; quit to stop.');
  const input = createInterface({ input: process.stdin });
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    input.close();
    process.stdin.destroy();
    observer.dispose();
    await server.dispose();
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
  }
  input.on('line', (line) => {
    if (line.trim() === 'rotate') {
      console.log('Viewers revoked. New runtime credential:');
      console.log(server.rotate());
    } else if (line.trim() === 'quit') void stop();
  });
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(`Observer could not start: ${String(error)}`);
  process.exitCode = 1;
});
