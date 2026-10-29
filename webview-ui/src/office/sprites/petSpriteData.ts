import type { SpriteData } from '../types.js';

export interface PetSpriteAsset {
  id: string;
  name: string;
  petType: number;
  sprite: SpriteData;
}

export interface PetSpriteFrames {
  walkDown: [SpriteData, SpriteData, SpriteData];
  idleDown: [SpriteData, SpriteData, SpriteData];
  walkUp: [SpriteData, SpriteData, SpriteData];
  idleUp: [SpriteData, SpriteData, SpriteData];
  walkRight: [SpriteData, SpriteData, SpriteData];
  walkLeft: [SpriteData, SpriteData, SpriteData];
  idleRight: [SpriteData, SpriteData, SpriteData];
  idleLeft: [SpriteData, SpriteData, SpriteData];
}

function frame(sheet: SpriteData, x: number, y: number, width: number, height: number): SpriteData {
  return sheet.slice(y, y + height).map((row) => row.slice(x, x + width));
}

function triple(
  sheet: SpriteData,
  x: number,
  y: number,
  width: number,
  height: number,
): [SpriteData, SpriteData, SpriteData] {
  return [
    frame(sheet, x, y, width, height),
    frame(sheet, x + width, y, width, height),
    frame(sheet, x + width * 2, y, width, height),
  ];
}

function flipHorizontal(sprite: SpriteData): SpriteData {
  return sprite.map((row) => [...row].reverse());
}

export function splitPetSpriteSheet(sheet: SpriteData): PetSpriteFrames | null {
  if (sheet.length !== 96 || sheet.some((row) => row.length !== 96)) return null;
  const walkDown = triple(sheet, 0, 0, 16, 32);
  const idleDown = triple(sheet, 48, 0, 16, 32);
  const walkUp = triple(sheet, 0, 32, 16, 32);
  const idleUp = triple(sheet, 48, 32, 16, 32);
  const walkRight = triple(sheet, 0, 64, 32, 32);
  const walkLeft: [SpriteData, SpriteData, SpriteData] = walkRight.map(flipHorizontal) as [
    SpriteData,
    SpriteData,
    SpriteData,
  ];
  return {
    walkDown,
    idleDown,
    walkUp,
    idleUp,
    walkRight,
    walkLeft,
    idleRight: idleDown,
    idleLeft: idleUp,
  };
}

let petAssets = new Map<number, PetSpriteAsset>();
let petFrames = new Map<number, PetSpriteFrames | null>();

export function setPetTemplates(assets: PetSpriteAsset[]): void {
  petAssets = new Map(assets.map((asset) => [asset.petType, asset]));
  petFrames = new Map(assets.map((asset) => [asset.petType, splitPetSpriteSheet(asset.sprite)]));
}

export function getPetSprites(petType: number): PetSpriteFrames | null {
  return petFrames.get(petType) ?? null;
}

export function getPetCount(): number {
  return petAssets.size;
}

export function getPetTypes(): number[] {
  return [...petAssets.keys()].sort((a, b) => a - b);
}

export function getPetName(petType: number): string {
  return petAssets.get(petType)?.name ?? `Pet ${petType + 1}`;
}

export function getPetAssetId(petType: number): string | null {
  return petAssets.get(petType)?.id ?? null;
}

export function resetPetTemplates(): void {
  petAssets.clear();
  petFrames.clear();
}
