/// <reference types="vitest/globals" />
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { LayoutData } from './types.js';
import {
  readPersistedLayout,
  writePersistedLayout,
  deletePersistedLayout,
} from './layoutPersistence.js';

describe('layoutPersistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'squad-pod-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const sampleLayout: LayoutData = {
    version: 2,
    cols: 10,
    rows: 8,
    tiles: Array(80).fill(1),
    furniture: [{ uid: 'desk-1', type: 'desk', col: 3, row: 2, rotation: 0 }],
  };

  it('round-trips a layout through write then read', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    const result = readPersistedLayout(tmpDir);

    expect(result).toEqual(sampleLayout);
  });

  it('returns null when layout file does not exist', () => {
    expect(readPersistedLayout(tmpDir)).toBeNull();
  });

  it('returns null when layout file contains invalid JSON', () => {
    const dir = path.join(tmpDir, '.squad-pod');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'layout.json'), 'not valid json!!!', 'utf-8');

    expect(readPersistedLayout(tmpDir)).toBeNull();
  });

  it('deletes a persisted layout', () => {
    writePersistedLayout(tmpDir, sampleLayout);
    expect(readPersistedLayout(tmpDir)).not.toBeNull();

    deletePersistedLayout(tmpDir);
    expect(readPersistedLayout(tmpDir)).toBeNull();
  });

  it('migrates version-less layouts to version 2 and strips stale tileColors', () => {
    const layoutNoVersion = {
      cols: 5,
      rows: 5,
      tiles: Array(25).fill(1),
      furniture: [],
      tileColors: { '0,0': { h: 210, s: 25, b: 0, c: 0 } },
    };

    const dir = path.join(tmpDir, '.squad-pod');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'layout.json'),
      JSON.stringify(layoutNoVersion, null, 2),
      'utf-8',
    );

    const result = readPersistedLayout(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe(2);
    // v1→v2 migration strips tileColors so ensureTileColors regenerates with warm colors
    expect(result!.tileColors).toBeUndefined();
  });
});
