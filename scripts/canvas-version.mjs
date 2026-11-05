import { readFileSync } from 'node:fs';

const source = new URL('../standalone/canvas-plugin.json', import.meta.url);
// SemVer 2.0.0: numeric core/prerelease identifiers cannot have leading zeroes.
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export function readCanvasVersion(path = source) {
  const version = JSON.parse(readFileSync(path, 'utf8'))?.version;
  if (typeof version !== 'string' || version !== version.trim() || !semver.test(version)) {
    throw new Error('Canvas plugin: version source must contain a valid SemVer version');
  }
  return version;
}
