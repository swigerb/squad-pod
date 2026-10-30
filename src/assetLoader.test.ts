import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDefaultOfficeLayout } from './defaultOfficeLayout.js';
import { loadDefaultLayoutForExport } from './assetLoader.js';

describe('loadDefaultLayoutForExport', () => {
  let extensionPath: string;

  beforeEach(() => {
    extensionPath = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-assets-'));
  });

  afterEach(() => {
    fs.rmSync(extensionPath, { recursive: true, force: true });
  });

  it('uses the shared starter only when the package has no default layout file', () => {
    expect(loadDefaultLayoutForExport(extensionPath)).toEqual(createDefaultOfficeLayout());

    const assetsPath = path.join(extensionPath, 'dist', 'assets');
    fs.mkdirSync(assetsPath, { recursive: true });
    const bundledLayout = {
      version: 2,
      cols: 1,
      rows: 1,
      tiles: [1],
      furniture: [{ uid: 'existing', type: 'legacy', col: 0, row: 0, rotation: 0 }],
    };
    fs.writeFileSync(path.join(assetsPath, 'layout.json'), JSON.stringify(bundledLayout), 'utf8');

    expect(loadDefaultLayoutForExport(extensionPath)).toEqual(bundledLayout);
  });

  it('does not hide a malformed bundled default behind the starter fallback', () => {
    const assetsPath = path.join(extensionPath, 'dist', 'assets');
    fs.mkdirSync(assetsPath, { recursive: true });
    fs.writeFileSync(path.join(assetsPath, 'layout.json'), '{ invalid', 'utf8');

    expect(loadDefaultLayoutForExport(extensionPath)).toBeNull();
  });
});
