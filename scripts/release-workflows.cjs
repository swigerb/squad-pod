'use strict';

// Inherited Squad CLI release/promote workflows that must stay report-only.
const RELEASE_WORKFLOWS = Object.freeze([
  'squad-insider-release.yml',
  'squad-promote.yml',
  'squad-release.yml',
]);

const FORBIDDEN = [
  [/"[^"]*\\[^"]*"/, 'uses an escape in a double-quoted string'],
  [/^\s*(?:-\s+)?\?(?:\s|$)/, 'uses an explicit YAML key'],
  [/\buses\s*:/, 'uses an action'],
  [/\bgit\s+(?:tag|push|commit|merge)\b/, 'runs a git write command'],
  [/\bgh\s+\S/, 'runs the GitHub CLI'],
  [/\b(?:npm|pnpm|yarn|vsce|ovsx)\s+publish\b/, 'publishes a package'],
  [/\bsecrets\.|\bgithub\.token\b|\b(?:GITHUB_TOKEN|GH_TOKEN|NODE_AUTH_TOKEN|VSCE_PAT|OVSX_PAT)\b/, 'references a credential'],
  [/\bid-token\b/, 'requests an OIDC token'],
  [/@bradygaster\/squad-cli/, 'advertises the Squad CLI package'],
  [/\btest\/\*\.test\.cjs\b/, 'runs the obsolete test glob'],
  [/\b[\w-]+\s*:\s*write\b|\bwrite-all\b/, 'grants write permission'],
];

function topLevel(lines, key) {
  const pattern = new RegExp(`^(?:${key}|"${key}"|'${key}'):(.*)$`);
  for (let index = 0; index < lines.length; index += 1) {
    const match = pattern.exec(lines[index]);
    if (!match) continue;
    const children = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (!line.trim()) continue;
      if (!/^\s/.test(line)) break;
      children.push(line);
    }
    return { value: match[1].trim(), children };
  }
  return undefined;
}

function triggerNames(block) {
  if (block.value) {
    return block.value.replace(/^\[|\]$/g, '').split(',').map((name) => name.trim()).filter(Boolean);
  }
  const indent = Math.min(...block.children.map((line) => line.search(/\S/)));
  return block.children
    .filter((line) => line.search(/\S/) === indent)
    .map((line) => line.trim().replace(/^-\s*/, '').replace(/:.*$/, ''));
}

function permissionViolations(block) {
  if (!block) return ['does not declare top-level permissions'];
  if (block.value === '{}' || block.value === 'read-all') return [];
  if (block.value) return [`declares permissions: ${block.value}`];
  return block.children
    .map((line) => line.trim())
    .filter((line) => !/^[\w-]+:\s*(?:read|none)$/.test(line))
    .map((line) => `declares permission ${line}`);
}

// Unquote simple quoted scalars so "uses": or 'contents': 'write' match like plain YAML.
function unquote(line) {
  return line.replace(/(["'])([\w.\/@*-]+)\1/g, '$2');
}

function findReleaseWorkflowViolations(text) {
  const raw = text.split('\n').map((line) => line.trimEnd()).filter((line) => !/^\s*#/.test(line));
  const lines = raw.map(unquote);
  const structural = lines.map((line) => line.replace(/\s+#.*$/, ''));
  const violations = [];

  const on = topLevel(structural, 'on');
  const triggers = on ? triggerNames(on) : [];
  if (triggers.length !== 1 || triggers[0] !== 'workflow_dispatch') {
    violations.push(`must trigger only on workflow_dispatch (found: ${triggers.join(', ') || 'none'})`);
  }
  violations.push(...permissionViolations(topLevel(structural, 'permissions')));

  lines.forEach((line, index) => {
    for (const [pattern, reason] of FORBIDDEN) {
      if (pattern.test(line) || pattern.test(raw[index])) violations.push(`${reason}: ${raw[index].trim()}`);
    }
  });
  return violations;
}

module.exports = { RELEASE_WORKFLOWS, findReleaseWorkflowViolations };
