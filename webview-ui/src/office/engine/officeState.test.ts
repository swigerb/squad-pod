import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OfficeState } from './officeState.js';
import { updateCharacter } from './characters.js';
import { TileType, CharacterState } from '../types.js';
import type { OfficeLayout } from '../types.js';
import { resetPetTemplates, setPetTemplates } from '../sprites/petSpriteData.js';

describe('OfficeState', () => {
  let officeState: OfficeState;

  beforeEach(() => {
    const layout: OfficeLayout = {
      version: 1,
      cols: 5,
      rows: 5,
      tiles: [
        TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL,
        TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL,
        TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL,
        TileType.WALL, TileType.FLOOR_1, TileType.FLOOR_1, TileType.FLOOR_1, TileType.WALL,
        TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL, TileType.WALL
      ],
      furniture: [
        { uid: 'desk-1', type: 'desk', col: 2, row: 1, rotation: 0 },
        { uid: 'chair-1', type: 'chair', col: 2, row: 2, rotation: 0 }
      ]
    };
    officeState = new OfficeState(layout);
  });

  it('operates on legacy layouts as an empty pet list without mutating their source', () => {
    const legacy: OfficeLayout = {
      version: 2, cols: 2, rows: 2, tiles: Array(4).fill(TileType.FLOOR_1), furniture: [],
    };
    const original = structuredClone(legacy);
    const state = new OfficeState(legacy);
    expect(state.getLayout().pets).toBeUndefined();
    expect(state.pets).toEqual([]);
    expect(legacy).toEqual(original);
  });

  it('restores persisted pet identities and keeps runtime state when the layout is rebuilt', () => {
    setPetTemplates([{ id: 'claudio', name: 'Claudio', petType: 0, sprite: Array.from({ length: 96 }, () => Array(96).fill('#fff')) }]);
    const layout: OfficeLayout = {
      version: 2, cols: 5, rows: 5, tiles: Array(25).fill(TileType.FLOOR_1), furniture: [],
      pets: [{ id: 'companion-1', petType: 0 }],
    };
    const state = new OfficeState(layout);
    expect(state.getActivePetTypes()).toEqual([0]);
    expect(state.pets).toHaveLength(1);
    expect(state.pets[0]).toMatchObject({ id: 'companion-1', petType: 0, name: 'Claudio' });
    const pet = state.pets[0];
    pet.x = 47;
    state.togglePetBubble(pet.id);
    state.rebuildFromLayout({ ...layout, customMetadata: { keep: true } } as OfficeLayout);
    expect(state.pets[0]).toBe(pet);
    expect(state.pets[0]).toMatchObject({ id: 'companion-1', petType: 0, x: 47, bubbleType: 'heart' });
    expect(state.getLayout()).toMatchObject({
      pets: [{ id: 'companion-1', petType: 0 }],
      customMetadata: { keep: true },
    });
    const reloaded = new OfficeState(JSON.parse(JSON.stringify(state.getLayout())) as OfficeLayout);
    expect(reloaded.getLayout().pets).toEqual([{ id: 'companion-1', petType: 0 }]);
    expect(reloaded.pets[0].id).toBe('companion-1');
  });

  it('keeps stable pet species types across asset failure and recovery', () => {
    const sheet = Array.from({ length: 96 }, () => Array(96).fill('#fff'));
    const claudio = { id: 'claudio', name: 'Claudio', petType: 0, sprite: sheet };
    const gitcat = { id: 'gitcat', name: 'Gitcat', petType: 1, sprite: sheet };
    setPetTemplates([gitcat]);
    const layout: OfficeLayout = {
      version: 2, cols: 5, rows: 5, tiles: Array(25).fill(TileType.FLOOR_1), furniture: [],
      pets: [{ id: 'claudio-instance', petType: 0 }, { id: 'gitcat-instance', petType: 1 }],
    };
    const state = new OfficeState(layout);
    expect(state.pets.map(({ id, petType, name }) => [id, petType, name])).toEqual([
      ['claudio-instance', 0, 'Pet 1'], ['gitcat-instance', 1, 'Gitcat'],
    ]);
    const restoredFromSavedLayout = new OfficeState(JSON.parse(JSON.stringify(state.getLayout())) as OfficeLayout);
    expect(restoredFromSavedLayout.pets.map(({ id, petType, name }) => [id, petType, name])).toEqual([
      ['claudio-instance', 0, 'Pet 1'], ['gitcat-instance', 1, 'Gitcat'],
    ]);
    setPetTemplates([gitcat, claudio]);
    restoredFromSavedLayout.refreshAssets();
    expect(restoredFromSavedLayout.pets.map(({ id, petType, name }) => [id, petType, name])).toEqual([
      ['claudio-instance', 0, 'Claudio'], ['gitcat-instance', 1, 'Gitcat'],
    ]);
  });

  it('re-homes a persisted pet if a layout rebuild blocks its tile or remaining path', () => {
    setPetTemplates([{
      id: 'claudio', name: 'Claudio', petType: 0,
      sprite: Array.from({ length: 96 }, () => Array(96).fill('#fff')),
    }]);
    const layout: OfficeLayout = {
      version: 2, cols: 5, rows: 5, tiles: Array(25).fill(TileType.FLOOR_1), furniture: [],
      pets: [{ id: 'companion-1', petType: 0 }],
    };
    const state = new OfficeState(layout);
    const pet = state.pets[0];
    pet.tileCol = 2; pet.tileRow = 2; pet.x = 40; pet.y = 40;
    pet.path = [{ col: 2, row: 3 }];
    const changed = [...layout.tiles];
    changed[2 * layout.cols + 2] = TileType.WALL;
    changed[3 * layout.cols + 2] = TileType.VOID;
    state.rebuildFromLayout({ ...layout, tiles: changed });
    expect(state.pets).toHaveLength(1);
    expect(state.pets[0]).toMatchObject({ id: 'companion-1', petType: 0 });
    expect(state.walkableTiles.has(`${state.pets[0].tileCol},${state.pets[0].tileRow}`)).toBe(true);
    expect(state.pets[0].path.every((tile) => state.walkableTiles.has(`${tile.col},${tile.row}`))).toBe(true);
  });

  it('keeps a pet placement persisted while no walkable tiles exist and restores it when they return', () => {
    const layout: OfficeLayout = {
      version: 2, cols: 4, rows: 4, tiles: Array(16).fill(TileType.FLOOR_1), furniture: [],
      pets: [{ id: 'companion-1', petType: 0 }],
    };
    const state = new OfficeState(layout);
    const noFloor: OfficeLayout = {
      ...layout, cols: 1, rows: 1, tiles: [TileType.WALL],
    };
    state.rebuildFromLayout(noFloor);
    expect(state.pets).toEqual([]);
    expect(state.getLayout().pets).toEqual([{ id: 'companion-1', petType: 0 }]);
    state.rebuildFromLayout({ ...noFloor, tiles: [TileType.FLOOR_1] });
    expect(state.pets).toHaveLength(1);
    expect(state.pets[0]).toMatchObject({ id: 'companion-1', petType: 0, tileCol: 0, tileRow: 0 });
  });

  afterEach(() => resetPetTemplates());

  describe('constructor', () => {
    it('creates empty state with default layout', () => {
      const emptyState = new OfficeState();

      expect(emptyState.characters.size).toBe(0);
      expect(emptyState.layout.cols).toBe(0);
      expect(emptyState.layout.rows).toBe(0);
    });

    it('creates state with provided layout', () => {
      expect(officeState.layout.cols).toBe(5);
      expect(officeState.layout.rows).toBe(5);
      expect(officeState.tileMap.length).toBe(5);
      expect(officeState.tileMap[0].length).toBe(5);
    });
  });

  describe('addAgent', () => {
    it('adds an agent and assigns seat', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      expect(officeState.characters.size).toBe(1);
      expect(officeState.characters.has('homer-simpson')).toBe(true);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.id).toBe('homer-simpson');
      expect(character.name).toBe('Homer Simpson');
      expect(character.role).toBe('Lead');
      expect(character.seatId).toBe('chair-1');

      const seat = officeState.seats.find(s => s.id === 'chair-1');
      expect(seat?.occupant).toBe('homer-simpson');
    });

    it('does not create duplicate when adding same ID twice', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      expect(officeState.characters.size).toBe(1);
    });

    it('assigns preferred seat if available', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead', 0, 0, 'chair-1');

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBe('chair-1');
    });

    it('prefers mapped Areas, then unzoned seats, then any remaining seat', () => {
      const cols = 9;
      const furniture = [1, 3, 5, 7].flatMap((col, index) => [
        { uid: `desk-${index}`, type: 'desk', col, row: 0, rotation: 0 },
        { uid: `chair-${index}`, type: 'chair', col, row: 1, rotation: 0 },
      ]);
      const areaTiles: Array<string | null> = Array(cols * 3).fill(null);
      areaTiles[cols + 1] = 'Alpha';
      areaTiles[cols + 3] = 'Beta';
      areaTiles[cols + 7] = 'Other';
      const state = new OfficeState({
        version: 2,
        cols,
        rows: 3,
        tiles: Array(cols * 3).fill(TileType.FLOOR_1),
        furniture,
        areas: [
          { label: 'Alpha', color: '#112233' },
          { label: 'Beta', color: '#223344' },
          { label: 'Other', color: '#334455' },
        ],
        areaTiles,
        areaMappings: { 'workspace:file:///selected-root': ['Alpha', 'Beta'] },
      });

      state.addAgent('member-1', 'A synthetic display name', 'Dev', undefined, undefined, undefined, 'workspace:file:///selected-root');
      state.addAgent('member-2', 'Another synthetic name', 'Dev', undefined, undefined, undefined, 'workspace:file:///selected-root');
      state.addAgent('member-3', 'Third member', 'Dev', undefined, undefined, undefined, 'workspace:file:///selected-root');
      state.addAgent('member-4', 'Fourth member', 'Dev', undefined, undefined, undefined, 'workspace:file:///selected-root');

      expect([...state.characters.values()].map((character) => character.seatId)).toEqual([
        'chair-0', 'chair-1', 'chair-2', 'chair-3',
      ]);
      expect(state.characters.get('member-1')?.directoryId).toBe('workspace:file:///selected-root');
      expect(state.characters.get('member-4')?.name).toBe('Fourth member');
    });

    it('keeps an available persisted seat ahead of directory Area preference', () => {
      const layout: OfficeLayout = {
        ...officeState.getLayout(),
        areas: [{ label: 'Mapped', color: '#112233' }],
        areaTiles: Array(25).fill(null).map((value, index) => index === 2 * 5 + 2 ? 'Mapped' : value),
        areaMappings: { 'saved-stable-id': ['Mapped'] },
      };
      const state = new OfficeState(layout);
      state.addAgent('member', 'Synthetic member', 'Dev', undefined, undefined, 'chair-1', 'saved-stable-id');
      expect(state.characters.get('member')?.seatId).toBe('chair-1');
    });

    it('combines stable workspace and saved mapping identities for observed-agent seat allocation', () => {
      const cols = 7;
      const furniture = [1, 3, 5].flatMap((col, index) => [
        { uid: `desk-${index}`, type: 'desk', col, row: 0, rotation: 0 },
        { uid: `chair-${index}`, type: 'chair', col, row: 1, rotation: 0 },
      ]);
      const areaTiles: Array<string | null> = Array(cols * 3).fill(null);
      areaTiles[cols + 1] = 'Saved Area';
      areaTiles[cols + 3] = 'Workspace Area';
      const state = new OfficeState({
        version: 2,
        cols,
        rows: 3,
        tiles: Array(cols * 3).fill(TileType.FLOOR_1),
        furniture,
        areas: [
          { label: 'Saved Area', color: '#112233' },
          { label: 'Workspace Area', color: '#223344' },
        ],
        areaTiles,
        areaMappings: {
          'saved-stable-id': ['Saved Area'],
          'workspace:file:///selected-root': ['Workspace Area'],
        },
      });

      state.addAgent(
        'mapped-member',
        'Synthetic member',
        'Dev',
        undefined,
        undefined,
        undefined,
        'workspace:file:///selected-root',
        ['workspace:file:///selected-root', 'saved-stable-id'],
      );

      expect(state.characters.get('mapped-member')?.seatId).toBe('chair-0');
      expect(state.characters.get('mapped-member')?.directoryId).toBe('workspace:file:///selected-root');
    });

    it('assigns palette and hue shift', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead', 2, 120);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.palette).toBe(2);
      expect(character.hueShift).toBe(120);
    });

    it('auto-assigns palette when not provided', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.palette).toBeGreaterThanOrEqual(0);
      expect(character.palette).toBeLessThan(6);
      expect(character.hueShift).toBeGreaterThanOrEqual(0);
    });
  });

  describe('removeAgent', () => {
    it('removes agent and frees seat', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.removeAgent('homer-simpson');

      expect(officeState.characters.has('homer-simpson')).toBe(false);

      const seat = officeState.seats.find(s => s.id === 'chair-1');
      expect(seat?.occupant).toBeNull();
    });

    it('clears selected agent if removed', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.selectedAgentId = 'homer-simpson';
      officeState.removeAgent('homer-simpson');

      expect(officeState.selectedAgentId).toBeNull();
    });

    it('does nothing when agent does not exist', () => {
      officeState.removeAgent('nonexistent');
      expect(officeState.characters.size).toBe(0);
    });
  });

  describe('reassignSeat', () => {
    it('reassigns agent to different seat', () => {
      const layout: OfficeLayout = {
        version: 1,
        cols: 5,
        rows: 5,
        tiles: Array(25).fill(TileType.FLOOR_1),
        furniture: [
          { uid: 'desk-1', type: 'desk', col: 1, row: 1, rotation: 0 },
          { uid: 'chair-1', type: 'chair', col: 1, row: 2, rotation: 0 },
          { uid: 'desk-2', type: 'desk', col: 3, row: 1, rotation: 0 },
          { uid: 'chair-2', type: 'chair', col: 3, row: 2, rotation: 0 }
        ]
      };
      officeState = new OfficeState(layout);

      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      const oldSeatId = officeState.characters.get('homer-simpson')!.seatId;
      expect(oldSeatId).toBe('chair-1');

      officeState.reassignSeat('homer-simpson', 'chair-2');

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBe('chair-2');

      const oldSeat = officeState.seats.find(s => s.id === 'chair-1');
      expect(oldSeat?.occupant).toBeNull();

      const newSeat = officeState.seats.find(s => s.id === 'chair-2');
      expect(newSeat?.occupant).toBe('homer-simpson');
    });
  });

  describe('getSeatAtTile', () => {
    it('returns seat ID for occupied tile', () => {
      const seatId = officeState.getSeatAtTile(2, 2);
      expect(seatId).toBe('chair-1');
    });

    it('returns null for empty tile', () => {
      const seatId = officeState.getSeatAtTile(1, 1);
      expect(seatId).toBeNull();
    });
  });

  describe('rebuildFromLayout', () => {
    it('rebuilds with new layout and retains character seats', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      const newLayout: OfficeLayout = {
        version: 1,
        cols: 5,
        rows: 5,
        tiles: Array(25).fill(TileType.FLOOR_1),
        furniture: [
          { uid: 'desk-1', type: 'desk', col: 2, row: 1, rotation: 0 },
          { uid: 'chair-1', type: 'chair', col: 2, row: 2, rotation: 0 }
        ]
      };

      officeState.rebuildFromLayout(newLayout, true);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBe('chair-1');
      expect(character.col).toBe(2);
      expect(character.row).toBe(2);
    });

    it('places character randomly if seat no longer exists', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');

      const newLayout: OfficeLayout = {
        version: 1,
        cols: 5,
        rows: 5,
        tiles: Array(25).fill(TileType.FLOOR_1),
        furniture: []
      };

      officeState.rebuildFromLayout(newLayout, true);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.seatId).toBeNull();
      expect(character.col).toBeGreaterThanOrEqual(0);
      expect(character.row).toBeGreaterThanOrEqual(0);
    });
  });

  describe('setAgentActive', () => {
    it('sets agent active and changes state to TYPE', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      const character = officeState.characters.get('homer-simpson')!;
      character.state = CharacterState.IDLE;

      officeState.setAgentActive('homer-simpson', true);

      expect(character.active).toBe(true);
      expect(character.state).toBe(CharacterState.TYPE);
    });

    it('keeps a walking character in motion and redirects it to its assigned seat on activation', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      const character = officeState.characters.get('homer-simpson')!;
      character.col = 3;
      character.row = 1;
      character.x = 56;
      character.y = 24;
      character.path = [{ col: 3, row: 2 }, { col: 3, row: 3 }];
      character.moveProgress = 0.5;
      character.state = CharacterState.WALK;

      officeState.setAgentActive('homer-simpson', true);
      expect(character.state).toBe(CharacterState.WALK);
      expect(character.moveProgress).toBe(0.5);

      updateCharacter(
        character, 0, officeState.walkableTiles, officeState.seats,
        officeState.tileMap, officeState.blockedTiles,
      );

      expect(character.state).toBe(CharacterState.WALK);
      expect(character.path[0]).toEqual({ col: 3, row: 2 });
      expect(character.path.at(-1)).toEqual({ col: 2, row: 2 });
      expect(officeState.walkableTiles.has('2,2')).toBe(false);
    });

    it('does not start seated work when an assigned seat is unreachable or missing', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      const character = officeState.characters.get('homer-simpson')!;
      character.col = 1;
      character.row = 1;
      character.x = 24;
      character.y = 24;
      officeState.tileMap[2][1] = TileType.WALL;
      officeState.tileMap[2][3] = TileType.WALL;
      officeState.tileMap[3][2] = TileType.WALL;
      officeState.tileMap[1][2] = TileType.WALL;

      officeState.setAgentActive('homer-simpson', true);
      expect(character.state).toBe(CharacterState.IDLE);
      expect(character.path).toEqual([]);

      character.active = false;
      character.seatId = 'missing-seat';
      officeState.setAgentActive('homer-simpson', true);
      expect(character.state).toBe(CharacterState.IDLE);
      expect(character.path).toEqual([]);
    });

    it('sets agent inactive and changes state to IDLE', () => {
      officeState.addAgent('homer-simpson', 'Homer Simpson', 'Lead');
      officeState.setAgentActive('homer-simpson', true);

      officeState.setAgentActive('homer-simpson', false);

      const character = officeState.characters.get('homer-simpson')!;
      expect(character.active).toBe(false);
      expect(character.state).toBe(CharacterState.IDLE);
    });

    it('does nothing when agent does not exist', () => {
      officeState.setAgentActive('nonexistent', true);
      expect(officeState.characters.size).toBe(0);
    });
  });
});
