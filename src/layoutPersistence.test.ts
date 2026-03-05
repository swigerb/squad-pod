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
    version: 1,
    rooms: [{ id: 'room-1', x: 0, y: 0, width: 200, height: 150 }],
    furniture: [{ id: 'desk-1', type: 'desk', x: 50, y: 50, roomId: 'room-1' }],
    seats: [{ id: 'seat-1', x: 60, y: 55, direction: 'down', roomId: 'room-1' }],
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

  it('adds version: 1 when reading a layout that has no version field', () => {
    const layoutNoVersion = {
      rooms: [{ id: 'r1', x: 0, y: 0, width: 100, height: 100 }],
      furniture: [],
      seats: [],
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
    expect(result!.version).toBe(1);
  });
});
