import { spawn } from 'node:child_process';

const children: ReturnType<typeof spawn>[] = [];
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
const emit = (value: unknown) => process.stdout.write(`\r\nFIXTURE ${JSON.stringify(value)}\r\n`);
emit({ ready: true, pid: process.pid, cwd: process.cwd(), argv: process.argv.slice(2),
  unicode: '\u00e9\u4e2d\ud83d\ude80', envKeys: Object.keys(process.env).sort(),
  cols: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', () => emit({ resized: true, cols: process.stdout.columns, rows: process.stdout.rows }));
process.stdin.on('data', data => {
  const text = String(data);
  emit({ input: text });
  if (text.includes('CHILD')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'inherit' });
    children.push(child);
    emit({ child: child.pid });
  }
  if (text.includes('BURST')) {
    for (let i = 0; i < 160; i++) process.stdout.write(`\r\nBURST ${i} ${'x'.repeat(8192)}\r\n`);
    emit({ burstDone: true });
  }
  if (text.includes('EXIT')) process.exit(7);
});
setInterval(() => {}, 1000);
