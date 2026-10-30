import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterEach, describe, expect, it } from 'vitest';
import { runId } from '../../src/core/terminalFrames.js';
import { OwnedRuns, resolveCopilot, terminalEnvironment } from './ownedRuns.js';

const folders: string[] = [];
const runtimes: OwnedRuns[] = [];
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.dispose()));
  await Promise.all(folders.splice(0).map(folder => rm(folder, {
    recursive: true, force: true, maxRetries: 5, retryDelay: 100,
  })));
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'owned PTY fixture '));
  folders.push(root);
  const project = join(root, 'project with spaces');
  await mkdir(project);
  const script = join(root, 'synthetic fixture.mjs');
  const brokerFolder = await mkdtemp(resolve('.native-broker-'));
  folders.push(brokerFolder);
  const broker = join(brokerFolder, 'ptyHost.mjs');
  await build({ entryPoints: [resolve('src/fixture.ts')], outfile: script, platform: 'node', bundle: true, format: 'esm' });
  await build({ entryPoints: [resolve('src/ptyHost.ts')], outfile: broker, platform: 'node', bundle: true, packages: 'external', format: 'esm' });
  const runtime = new OwnedRuns({ project, enabled: true, fixture: script, broker });
  runtimes.push(runtime);
  return { runtime, project, script, broker };
}
async function until(predicate: () => boolean | Promise<boolean>, description: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out: ${description}`);
}
function alive(pid: number) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; }
}

describe('owned native PTY (no Windows skip)', () => {
  it('executes exact shell-free argv/cwd, Unicode, input/resize, exit and bounded output', async () => {
    const { runtime, project } = await fixture();
    expect(runtime.reason).toBeNull();
    const info = await runtime.launch();
    const history = runtime.source(info.runId);
    const text = async () => (await history.snapshot(0)).frames.map(frame => frame.data).join('');
    await until(async () => (await text()).includes('"ready":true'), 'native fixture ready');
    let output = await text();
    expect(output).toContain(JSON.stringify(realpathSync(project)));
    expect(output).toContain(JSON.stringify(['argument with spaces', 'literal"quote', 'trailing\\']));
    expect(output).toContain('\u00e9\u4e2d\ud83d\ude80');
    await runtime.command({ version: 1, type: 'resize', runId: info.runId, cols: 101, rows: 37 });
    await runtime.command({ version: 1, type: 'input', runId: info.runId, data: 'hello \u00e9\u4e2d\ud83d\ude80' });
    await until(async () => (await text()).includes('"input":'), 'input echo');
    await until(async () => (await text()).includes('"cols":101,"rows":37'), 'real PTY resize event');
    await runtime.command({ version: 1, type: 'input', runId: info.runId, data: 'BURST' });
    await until(async () => (await text()).includes('"burstDone":true'), 'bounded output burst');
    const snapshot = await history.snapshot(0);
    expect(snapshot.earliest).toBeGreaterThan(1);
    expect(snapshot.frames.reduce((bytes, frame) => bytes + Buffer.byteLength(JSON.stringify(frame)), 0)).toBeLessThanOrEqual(1024 * 1024);
    output = await text();
    expect(output).not.toContain('\ufffd');
    await runtime.command({ version: 1, type: 'input', runId: info.runId, data: 'EXIT' });
    await until(() => runtime.status().runs[0].state === 'exited', 'native normal exit');
    expect(runtime.status().runs[0].exitCode).toBe(7);
    expect(() => runtime.command({ version: 1, type: 'input', runId: info.runId, data: 'late' })).toThrow('exited');
    await runtime.close(info.runId);
    expect(runtime.status().runs).toEqual([]);
  }, 20_000);

  it.each(['close', 'shutdown'] as const)('cleans owned console descendants on %s and leaves an unrelated process alive', async action => {
    const { runtime } = await fixture();
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' });
    try {
      const info = await runtime.launch();
      const history = runtime.source(info.runId);
      let output = '';
      const unsubscribe = history.subscribe(frame => { output += frame.data; });
      await until(() => output.includes('"ready":true'), 'fixture ready');
      await runtime.command({ version: 1, type: 'input', runId: info.runId, data: 'CHILD' });
      await until(() => /"child":\d+/.test(output), 'owned descendant ready');
      const child = Number(output.match(/"child":(\d+)/)![1]);
      expect(alive(child)).toBe(true);
      if (action === 'close') await runtime.close(info.runId);
      else await runtime.dispose();
      await until(() => !alive(info.pid) && !alive(child), 'owned root and descendant cleanup');
      expect(alive(unrelated.pid!)).toBe(true);
      unsubscribe();
    } finally { unrelated.kill(); }
  }, 20_000);

  it('rejects unknown/observed identities and replaced cwd; failed spawn creates no entry', async () => {
    const { runtime, project, script, broker } = await fixture();
    expect(() => runtime.source(runId('observed-agent'))).toThrow('Unknown owned');
    expect(() => runtime.command({ version: 1, type: 'input', runId: runId('forged'), data: 'x' })).toThrow('Unknown owned');
    await rename(project, `${project} displaced`);
    await mkdir(project);
    await expect(runtime.launch()).rejects.toThrow('changed');
    const broken = new OwnedRuns({ project, enabled: true, fixture: script, broker });
    runtimes.push(broken);
    // Missing script starts node and yields a real failed process, not a successful fabricated run.
    await rm(script);
    const info = await broken.launch();
    await until(() => broken.status().runs[0].state === 'exited', 'entrypoint failure');
    expect(broken.status().runs[0].exitCode).not.toBe(0);
    expect((await broken.source(info.runId).snapshot(0)).frames.map(frame => frame.data).join('')).toMatch(/MODULE_NOT_FOUND|Cannot find module/);
  }, 15_000);

  it('can immediately close a silent owned process without waiting for user output', async () => {
    const { runtime, script } = await fixture();
    await writeFile(script, 'setInterval(()=>{},1000);');
    const info = await runtime.launch();
    await runtime.close(info.runId);
    await until(() => !alive(info.pid), 'silent root cleanup');
  }, 15_000);

  it('cancels a revoked pending launch and waits for in-flight launch during shutdown', async () => {
    const { runtime } = await fixture();
    await expect(runtime.launch(() => false)).rejects.toThrow('revoked');
    expect(runtime.status().runs).toEqual([]);
    const starting = runtime.launch();
    const stopping = runtime.dispose();
    await expect(starting).rejects.toThrow('revoked');
    await stopping;
    expect(runtime.status().runs).toEqual([]);
  }, 15_000);

  it('bounds outstanding broker input, releases failed/successful actions, and permits cumulative input above 1 MiB', async () => {
    const { project, script, broker } = await fixture();
    // A deliberately delayed-ack broker isolates host queue accounting; the
    // other native cases exercise the real production broker and PTY.
    await build({ stdin: { contents: `
      process.on('message', message => {
        if (message.type === 'start') process.send({type:'spawned',pid:process.pid});
        if (message.type === 'input') setTimeout(() => process.send(message.data.startsWith('FAIL')
          ? {type:'error',id:message.id,message:'synthetic native write failure'}
          : {type:'ack',id:message.id}), 5);
        if (message.type === 'kill') process.send({type:'exit',exitCode:0}, () => process.exit(0));
      });
      process.send({type:'ready'});
    `, loader: 'js' }, outfile: broker, platform: 'node', bundle: true, format: 'esm' });
    const runtime = new OwnedRuns({ project, enabled: true, fixture: script, broker });
    runtimes.push(runtime);
    const info = await runtime.launch();
    const input = (data: string) => runtime.command({ version: 1, type: 'input', runId: info.runId, data });
    const chunk = 'x'.repeat(16 * 1024);
    for (let count = 0; count < 100; count++) await input(chunk);
    await expect(input('FAIL')).rejects.toThrow('synthetic native write failure');
    const outstanding = Array.from({ length: 64 }, () => input(chunk));
    expect(() => input(chunk)).toThrow('Outstanding owned input budget');
    await Promise.all(outstanding);
    await input(chunk);
    expect(runtime.status().runs[0]).toMatchObject({ runId: info.runId, state: 'running' });
  }, 15_000);

  it('forces a nonresponsive owned broker to exit, cleans its console, and reports the failure', async () => {
    const { project, script, broker } = await fixture();
    await build({ stdin: { contents: `
      import { createRequire } from 'node:module';
      const { spawn } = createRequire(import.meta.url)('node-pty');
      let term;
      process.on('message', message => {
        if (message.type === 'start') {
          term = spawn(message.file, message.args, { cwd: message.cwd, env: message.env,
            cols: 80, rows: 24, useConpty: true, useConptyDll: true });
          term.onData(data => process.send({type:'data',data}));
          process.send({type:'spawned',pid:term.pid});
        } else if (message.type === 'input') {
          term.write(message.data);
          process.send({type:'ack',id:message.id});
        }
      });
      process.send({type:'ready'});
    `, loader: 'js' }, outfile: broker, platform: 'node', bundle: true, packages: 'external', format: 'esm' });
    const runtime = new OwnedRuns({ project, enabled: true, fixture: script, broker });
    runtimes.push(runtime);
    const info = await runtime.launch();
    let output = '';
    runtime.source(info.runId).subscribe(frame => { output += frame.data; });
    await until(() => output.includes('"ready":true'), 'unresponsive broker fixture');
    await runtime.command({ version: 1, type: 'input', runId: info.runId, data: 'CHILD' });
    await until(() => /"child":\d+/.test(output), 'unresponsive broker descendant');
    const descendant = Number(output.match(/"child":(\d+)/)![1]);
    await expect(runtime.close(info.runId)).rejects.toThrow('forced to stop');
    await until(() => !alive(info.pid) && !alive(descendant), 'forced broker cleanup');
    await expect(runtime.source(info.runId).snapshot(0)).rejects.toThrow('continuity');
  }, 15_000);
});

it('preserves no-terminal observation and does not inherit injection/auth environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'no terminal '));
  folders.push(root);
  const runtime = new OwnedRuns({ project: root, enabled: false });
  runtimes.push(runtime);
  expect(runtime.status()).toMatchObject({ available: false, runs: [], reason: expect.stringContaining('--terminals') });
  await expect(runtime.launch()).rejects.toThrow('disabled');
  const env = terminalEnvironment({ PATH: 'approved', HOME: 'synthetic', NODE_OPTIONS: '--require malware',
    LD_PRELOAD: 'malware', GH_TOKEN: 'never-forward', COPILOT_GITHUB_TOKEN: 'never-forward', SECRET: 'never-forward' });
  expect(env).toEqual({ PATH: 'approved', HOME: 'synthetic', TERM: 'xterm-256color', COLORTERM: 'truecolor' });
  await writeFile(join(root, 'copilot.cmd'), '@echo forbidden');
  expect(() => resolveCopilot({ PATH: root })).toThrow('shell-free');
  expect(() => resolveCopilot({ PATH: '.' })).toThrow('shell-free');
});

it('resolves fixed native/Node launch argv without execvp text or shell-wrapper fallback', async () => {
  const root = await mkdtemp(join(tmpdir(), 'copilot executable fixture '));
  folders.push(root);
  const executable = join(root, process.platform === 'win32' ? 'copilot.exe' : 'copilot');
  await writeFile(executable, 'echo forbidden shell fallback\n');
  await chmod(executable, 0o755);
  expect(() => resolveCopilot({ PATH: root })).toThrow('shell-free');
  await writeFile(executable, '#!/bin/sh\necho forbidden\n');
  expect(() => resolveCopilot({ PATH: root })).toThrow('shell-free');
  if (process.platform === 'win32') {
    await writeFile(executable, 'MZsynthetic native-header-only fixture (never executed)');
    expect(resolveCopilot({ PATH: root })).toEqual({
      file: realpathSync(executable), args: ['--agent', 'squad'],
    });
  } else {
    await writeFile(executable, '#!/usr/bin/env node\n// synthetic entry point (never executed)\n');
    expect(resolveCopilot({ PATH: root })).toEqual({
      file: realpathSync(process.execPath), args: [realpathSync(executable), '--agent', 'squad'],
    });
    await writeFile(executable, Buffer.from([0x7f, 0x45, 0x4c, 0x46]));
    expect(resolveCopilot({ PATH: root })).toEqual({
      file: realpathSync(executable), args: ['--agent', 'squad'],
    });
  }
});
