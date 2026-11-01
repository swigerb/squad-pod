const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { RELEASE_WORKFLOWS, findReleaseWorkflowViolations } = require('./release-workflows.cjs');

const workflowDir = path.join(__dirname, '..', '.github', 'workflows');

function reportOnly({ on = 'on:\n  workflow_dispatch:', permissions = 'permissions: {}', step = 'echo report-only' } = {}) {
  return [
    'name: Fixture',
    on,
    permissions,
    'jobs:',
    '  report:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - name: Step',
    '        run: |',
    `          ${step}`,
    '',
  ].join('\n');
}

test('the inherited release and promote workflows are manual and report-only', () => {
  for (const name of RELEASE_WORKFLOWS) {
    const text = fs.readFileSync(path.join(workflowDir, name), 'utf8');
    assert.deepEqual(findReleaseWorkflowViolations(text.replace(/\r\n/g, '\n')), [], `${name} (LF)`);
    assert.deepEqual(findReleaseWorkflowViolations(text.replace(/\r?\n/g, '\r\n')), [], `${name} (CRLF)`);
  }
});

test('accepts manual triggers in mapping, scalar and list form', () => {
  for (const on of ['on:\n  workflow_dispatch:', 'on: workflow_dispatch', '"on": [workflow_dispatch] # manual']) {
    assert.deepEqual(findReleaseWorkflowViolations(reportOnly({ on })), [], on);
  }
});

test('rejects automatic, scheduled, reusable or missing triggers', () => {
  for (const on of [
    'on:\n  push:\n    branches: [main]',
    'on: [push, workflow_dispatch]',
    'on: workflow_call',
    'on:\n  workflow_dispatch:\n  schedule:\n    - cron: "0 0 * * *"',
    '',
  ]) {
    const violations = findReleaseWorkflowViolations(reportOnly({ on }));
    assert.ok(violations.some((violation) => violation.startsWith('must trigger only on workflow_dispatch')), on);
  }
});

test('rejects missing or write-capable permissions', () => {
  for (const permissions of [
    '',
    'permissions:\n  contents: write',
    'permissions: write-all',
    'permissions:\n  contents: read\n  id-token: write',
  ]) {
    assert.notDeepEqual(findReleaseWorkflowViolations(reportOnly({ permissions })), [], permissions || '(none)');
  }
  assert.deepEqual(findReleaseWorkflowViolations(reportOnly({ permissions: 'permissions:\n  contents: read' })), []);
});

test('rejects inherited tag, release, promotion, publication and test-glob steps', () => {
  const steps = {
    'git tag -a "v1.0.0" -m "Release v1.0.0"': 'runs a git write command',
    'git push origin preview': 'runs a git write command',
    'git merge origin/dev --no-commit --no-ff': 'runs a git write command',
    'git commit -m "chore: promote dev"': 'runs a git write command',
    'gh release create "v1.0.0" --generate-notes': 'runs the GitHub CLI',
    'npm publish': 'publishes a package',
    'npx @vscode/vsce publish --packagePath squad-pod.vsix': 'publishes a package',
    'npx ovsx publish squad-pod.vsix': 'publishes a package',
    'echo "${{ secrets.VSCE_PAT }}"': 'references a credential',
    'echo "${{ github.token }}"': 'references a credential',
    'npm install -g @bradygaster/squad-cli@insider': 'advertises the Squad CLI package',
    'node --test test/*.test.cjs': 'runs the obsolete test glob',
  };
  for (const [step, reason] of Object.entries(steps)) {
    const violations = findReleaseWorkflowViolations(reportOnly({ step }));
    assert.ok(violations.some((violation) => violation.startsWith(reason)), `${step}: ${violations.join('; ')}`);
  }
});

test('rejects actions and job-level write permissions', () => {
  const withAction = reportOnly().replace('      - name: Step', '      - uses: softprops/action-gh-release@v2\n      - name: Step');
  assert.ok(findReleaseWorkflowViolations(withAction).some((violation) => violation.startsWith('uses an action')));

  for (const permissions of ['    permissions:\n      contents: write', '    permissions: { contents: write }']) {
    const jobWrite = reportOnly().replace('    runs-on:', `${permissions}\n    runs-on:`);
    assert.ok(findReleaseWorkflowViolations(jobWrite).some((violation) => violation.startsWith('grants write permission')), permissions);
  }
});

test('applies the same rules to quoted YAML keys and values', () => {
  for (const [on, permissions] of [
    ['"on": ["workflow_dispatch"]', '"permissions": {}'],
    ["'on':\n  'workflow_dispatch':", "permissions:\n  'contents': 'read'"],
    ['on: "workflow_dispatch"', 'permissions: "read-all"'],
  ]) {
    assert.deepEqual(findReleaseWorkflowViolations(reportOnly({ on, permissions })), [], `${on} / ${permissions}`);
  }
  for (const on of ['"on": ["push", "workflow_dispatch"]', "'on':\n  'push':"]) {
    assert.ok(findReleaseWorkflowViolations(reportOnly({ on })).some((v) => v.startsWith('must trigger only')), on);
  }
  for (const permissions of ['permissions: "write-all"', 'permissions:\n  "contents": "write"']) {
    assert.notDeepEqual(findReleaseWorkflowViolations(reportOnly({ permissions })), [], permissions);
  }

  const rejected = {
    '    permissions: { "contents": "write" }\n    runs-on:': 'grants write permission',
    "    permissions: { 'contents': 'write' }\n    runs-on:": 'grants write permission',
    '    permissions:\n      "id-token": "write"\n    runs-on:': 'grants write permission',
    '    permissions: { contents: "\\x77rite" }\n    runs-on:': 'uses an escape in a double-quoted string',
    '    ? permissions\n    : write-all\n    runs-on:': 'uses an explicit YAML key',
  };
  for (const [job, reason] of Object.entries(rejected)) {
    const text = reportOnly().replace('    runs-on:', job);
    assert.ok(findReleaseWorkflowViolations(text).some((v) => v.startsWith(reason)), job);
  }
  for (const step of [
    '      - "uses": softprops/action-gh-release@v2',
    "      - 'uses': 'actions/checkout@v4'",
    '      - uses : actions/checkout@v4',
    '      - "\\x75ses": actions/checkout@v4',
  ]) {
    const text = reportOnly().replace('      - name: Step', `${step}\n      - name: Step`);
    assert.ok(findReleaseWorkflowViolations(text).some((v) => /^uses an (?:action|escape)/.test(v)), step);
  }
  for (const [step, reason] of Object.entries({
    '"git" push origin main': 'runs a git write command',
    "npm install -g '@bradygaster/squad-cli'": 'advertises the Squad CLI package',
  })) {
    assert.ok(findReleaseWorkflowViolations(reportOnly({ step })).some((v) => v.startsWith(reason)), step);
  }
});

test('ignores full-line comments that describe forbidden operations', () => {
  const text = `# Retired: never git push or npm publish from here.\n${reportOnly()}`;
  assert.deepEqual(findReleaseWorkflowViolations(text), []);
});
