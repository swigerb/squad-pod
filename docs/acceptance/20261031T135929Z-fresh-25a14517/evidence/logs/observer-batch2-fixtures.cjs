const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const root = path.dirname(__dirname);
const project = path.join(root, 'runtime', 'project-A');
const baselineFile = path.join(__dirname, 'observer-batch2-baseline.json');
const logFile = path.join(__dirname, 'observer-batch2-fixture-actions.jsonl');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const action = process.argv[2];
const sessionPath = path.join('.squad', 'sessions', 'batch2-ada.json');
const usagePath = path.join('.squad', 'log', 'usage.jsonl');
const allowed = new Set([sessionPath, usagePath]);

function snapshot() {
  const files = [];
  function walk(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      const full = path.join(directory, entry.name);
      const stat = fs.lstatSync(full);
      assert(!stat.isSymbolicLink(), 'Fixture links are not allowed');
      if (stat.isDirectory()) walk(full, name);
      else {
        assert(stat.isFile(), 'Unexpected nonregular fixture');
        const bytes = fs.readFileSync(full);
        files.push({ path: name.replaceAll('\\', '/'), bytes: bytes.length, sha256: digest(bytes) });
      }
    }
  }
  walk(project);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function writeFixture(relative, content) {
  assert(allowed.has(relative), 'Fixture target is not allowlisted');
  fs.writeFileSync(path.join(project, relative), content);
}

function knownUsage() {
  return [
    { version: 1, kind: 'turn-start', sessionId: 'fixture-1', turnId: 't1', timestamp: '2026-01-01T10:00:00Z' },
    { version: 1, kind: 'turn-start', sessionId: 'fixture-1', turnId: 't1', timestamp: '2026-01-01T10:00:00Z' },
    { version: 1, kind: 'turn-start', sessionId: 'fixture-2', turnId: 't2', timestamp: '2026-01-01T10:00:00Z' },
    { version: 1, kind: 'usage', sessionId: 'fixture-1', turnId: 't1', agentName: 'ada', model: 'fixture-model', inputTokens: 10, outputTokens: 5, estimatedCost: 0.02, timestamp: '2026-01-01T10:01:00Z' },
    { version: 1, kind: 'usage', sessionId: 'fixture-1', turnId: 't1', agentName: 'ada', model: 'fixture-model', inputTokens: 10, outputTokens: 5, estimatedCost: 0.02, timestamp: '2026-01-01T10:01:00Z' },
    { version: 1, kind: 'usage', sessionId: 'fixture-2', model: 'unknown', inputTokens: 0, outputTokens: 0, estimatedCost: 0.02, timestamp: '2026-01-01T10:02:00Z' },
  ];
}

assert(fs.realpathSync(project) === project, 'Unexpected fixture canonical root');
assert(Date.now() < Date.parse('2026-10-31T15:44:29.243Z') || action === 'restore' || action === 'check', 'Testing cutoff reached');
const before = snapshot();
if (action === 'baseline') {
  assert(!fs.existsSync(baselineFile), 'Baseline already exists');
  for (const relative of allowed) assert(!fs.existsSync(path.join(project, relative)), 'Generated target already exists');
  fs.writeFileSync(baselineFile, JSON.stringify({ capturedAtUtc: new Date().toISOString(), files: before }, null, 2) + '\n', { flag: 'wx' });
} else {
  assert(fs.existsSync(baselineFile), 'Baseline required');
  const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const originals = before.filter(file => !allowed.has(file.path.replaceAll('/', path.sep)));
  assert.deepEqual(originals, baseline.files, 'Original fixture changed unexpectedly; stop');
  if (action === 'activity-new' || action === 'activity-edit') {
    const target = path.join(project, sessionPath);
    assert(fs.existsSync(target) === (action === 'activity-edit'), 'Unexpected activity fixture state');
    writeFixture(sessionPath, JSON.stringify({
      id: 'batch2-ada-fixture', createdAt: '2026-01-01T10:00:00Z', agent: 'ada',
      messages: [{ role: 'assistant', content: action === 'activity-new' ? 'Synthetic acceptance file activity one' : 'Synthetic acceptance file activity two', timestamp: '2026-01-01T10:00:00Z' }],
    }) + '\n');
  } else if (['usage-known', 'usage-partial', 'usage-scope', 'usage-limit'].includes(action)) {
    const rows = knownUsage();
    if (action === 'usage-scope') rows[3].sessionId = 'different-fixture-session';
    if (action === 'usage-limit') {
      rows.splice(0, rows.length, ...Array.from({ length: 45 }, (_, i) => ({
        version: 1, kind: 'usage', sessionId: 'fixture-many', turnId: `t${i}`,
        agentName: 'ada', model: 'fixture-model', inputTokens: 1, outputTokens: 2,
        estimatedCost: 0.001, timestamp: '2026-01-01T10:00:00Z',
      })));
    }
    let text = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    if (action === 'usage-partial') text += '{not-json}\n' + JSON.stringify({ version: 2, kind: 'usage' }) + '\n' + JSON.stringify(rows[3]);
    writeFixture(usagePath, text);
  } else if (action === 'restore') {
    const archive = path.join(__dirname, 'observer-batch2-retained-fixtures');
    fs.mkdirSync(archive, { recursive: true });
    for (const relative of allowed) {
      const source = path.join(project, relative);
      if (!fs.existsSync(source)) continue;
      const destination = path.join(archive, path.basename(relative));
      assert(!fs.existsSync(destination), 'Retained fixture already exists');
      fs.renameSync(source, destination);
    }
    assert.deepEqual(snapshot(), baseline.files, 'Restored fixture does not match baseline');
  } else assert(action === 'check', 'Unknown fixture action');
}
const result = { utc: new Date().toISOString(), action, evidenceClass: 'FIXTURE', before, after: snapshot() };
fs.appendFileSync(logFile, JSON.stringify(result) + '\n');
console.log(JSON.stringify({ utc: result.utc, action, originalFilesPreserved: true, files: result.after.length }));
