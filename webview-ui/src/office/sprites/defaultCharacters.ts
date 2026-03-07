import { Direction, SpriteData } from '../types.js';

export interface CharacterSprites {
  walk: Record<Direction, SpriteData[]>;
  typing: Record<Direction, SpriteData[]>;
  reading: Record<Direction, SpriteData[]>;
}

const EMPTY_16x24: SpriteData = Array(24).fill(null).map(() => Array(16).fill(''));

function createCharacterWalkDown(shirtColor: string, skinColor: string, pantsColor: string): SpriteData {
  const sprite: SpriteData = EMPTY_16x24.map(row => [...row]);
  
  for (let y = 2; y < 8; y++) {
    for (let x = 5; x < 11; x++) {
      sprite[y][x] = skinColor;
    }
  }
  sprite[4][6] = '#000000';
  sprite[4][9] = '#000000';
  
  for (let y = 8; y < 16; y++) {
    for (let x = 4; x < 12; x++) {
      sprite[y][x] = shirtColor;
    }
  }
  
  for (let y = 16; y < 24; y++) {
    for (let x = 5; x < 7; x++) {
      sprite[y][x] = pantsColor;
    }
    for (let x = 9; x < 11; x++) {
      sprite[y][x] = pantsColor;
    }
  }
  
  return sprite;
}

function createCharacterWalkFrame2(shirtColor: string, skinColor: string, pantsColor: string): SpriteData {
  const sprite: SpriteData = EMPTY_16x24.map(row => [...row]);
  
  for (let y = 2; y < 8; y++) {
    for (let x = 5; x < 11; x++) {
      sprite[y][x] = skinColor;
    }
  }
  sprite[4][6] = '#000000';
  sprite[4][9] = '#000000';
  
  for (let y = 8; y < 16; y++) {
    for (let x = 4; x < 12; x++) {
      sprite[y][x] = shirtColor;
    }
  }
  
  for (let y = 16; y < 24; y++) {
    for (let x = 3; x < 5; x++) {
      sprite[y][x] = pantsColor;
    }
    for (let x = 9; x < 11; x++) {
      sprite[y][x] = pantsColor;
    }
  }
  
  return sprite;
}

function createCharacterWalkFrame4(shirtColor: string, skinColor: string, pantsColor: string): SpriteData {
  const sprite: SpriteData = EMPTY_16x24.map(row => [...row]);
  
  for (let y = 2; y < 8; y++) {
    for (let x = 5; x < 11; x++) {
      sprite[y][x] = skinColor;
    }
  }
  sprite[4][6] = '#000000';
  sprite[4][9] = '#000000';
  
  for (let y = 8; y < 16; y++) {
    for (let x = 4; x < 12; x++) {
      sprite[y][x] = shirtColor;
    }
  }
  
  for (let y = 16; y < 24; y++) {
    for (let x = 5; x < 7; x++) {
      sprite[y][x] = pantsColor;
    }
    for (let x = 11; x < 13; x++) {
      sprite[y][x] = pantsColor;
    }
  }
  
  return sprite;
}

function createCharacterTypingFrame1(shirtColor: string, skinColor: string, pantsColor: string): SpriteData {
  const sprite: SpriteData = EMPTY_16x24.map(row => [...row]);
  
  for (let y = 2; y < 8; y++) {
    for (let x = 5; x < 11; x++) {
      sprite[y][x] = skinColor;
    }
  }
  sprite[4][6] = '#000000';
  sprite[4][9] = '#000000';
  
  for (let y = 8; y < 16; y++) {
    for (let x = 4; x < 12; x++) {
      sprite[y][x] = shirtColor;
    }
  }
  
  sprite[10][2] = skinColor;
  sprite[11][2] = skinColor;
  sprite[10][13] = skinColor;
  sprite[11][13] = skinColor;
  
  for (let y = 16; y < 24; y++) {
    for (let x = 5; x < 7; x++) {
      sprite[y][x] = pantsColor;
    }
    for (let x = 9; x < 11; x++) {
      sprite[y][x] = pantsColor;
    }
  }
  
  return sprite;
}

function createCharacterTypingFrame2(shirtColor: string, skinColor: string, pantsColor: string): SpriteData {
  const sprite: SpriteData = EMPTY_16x24.map(row => [...row]);
  
  for (let y = 2; y < 8; y++) {
    for (let x = 5; x < 11; x++) {
      sprite[y][x] = skinColor;
    }
  }
  sprite[4][6] = '#000000';
  sprite[4][9] = '#000000';
  
  for (let y = 8; y < 16; y++) {
    for (let x = 4; x < 12; x++) {
      sprite[y][x] = shirtColor;
    }
  }
  
  sprite[12][2] = skinColor;
  sprite[13][2] = skinColor;
  sprite[12][13] = skinColor;
  sprite[13][13] = skinColor;
  
  for (let y = 16; y < 24; y++) {
    for (let x = 5; x < 7; x++) {
      sprite[y][x] = pantsColor;
    }
    for (let x = 9; x < 11; x++) {
      sprite[y][x] = pantsColor;
    }
  }
  
  return sprite;
}

const palettes = [
  { shirt: '#4169E1', skin: '#FDBCB4', pants: '#2C3E50' },
  { shirt: '#DC143C', skin: '#FDBCB4', pants: '#2C3E50' },
  { shirt: '#32CD32', skin: '#C68642', pants: '#2C3E50' },
  { shirt: '#9370DB', skin: '#8D5524', pants: '#2C3E50' },
  { shirt: '#FF8C00', skin: '#FDBCB4', pants: '#2C3E50' },
  { shirt: '#20B2AA', skin: '#C68642', pants: '#2C3E50' }
];

let characterTemplates: CharacterSprites[] | null = null;

export function setCharacterTemplates(templates: CharacterSprites[]): void {
  characterTemplates = templates;
  generatedSpriteCache.clear();
}

function hueShiftColor(hex: string, hueShift: number): string {
  if (hueShift === 0) return hex;
  
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  
  if (delta === 0) return hex;
  
  let h = 0;
  if (max === r) {
    h = ((g - b) / delta) % 6;
  } else if (max === g) {
    h = (b - r) / delta + 2;
  } else {
    h = (r - g) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;
  
  h = (h + hueShift) % 360;
  
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  
  let rPrime = 0, gPrime = 0, bPrime = 0;
  if (h < 60) {
    rPrime = c; gPrime = x; bPrime = 0;
  } else if (h < 120) {
    rPrime = x; gPrime = c; bPrime = 0;
  } else if (h < 180) {
    rPrime = 0; gPrime = c; bPrime = x;
  } else if (h < 240) {
    rPrime = 0; gPrime = x; bPrime = c;
  } else if (h < 300) {
    rPrime = x; gPrime = 0; bPrime = c;
  } else {
    rPrime = c; gPrime = 0; bPrime = x;
  }
  
  const rFinal = Math.round((rPrime + m) * 255);
  const gFinal = Math.round((gPrime + m) * 255);
  const bFinal = Math.round((bPrime + m) * 255);
  
  return `#${rFinal.toString(16).padStart(2, '0')}${gFinal.toString(16).padStart(2, '0')}${bFinal.toString(16).padStart(2, '0')}`;
}

function applyHueShift(sprite: SpriteData, hueShift: number): SpriteData {
  if (hueShift === 0) return sprite;
  return sprite.map(row => row.map(color => {
    if (!color || color === '' || color === '#000000' || color === '#ffffff') return color;
    return hueShiftColor(color, hueShift);
  }));
}

// Cache for generated (fallback) character sprites — keyed by "palette:hueShift".
// Without this, getCharacterSprites creates new arrays every frame, which means
// getCachedSprite's WeakMap cache never hits and new offscreen canvases are
// allocated every frame.
const generatedSpriteCache = new Map<string, CharacterSprites>();

export function getCharacterSprites(palette: number, hueShift: number): CharacterSprites {
  if (characterTemplates && characterTemplates[palette]) {
    const template = characterTemplates[palette];
    if (hueShift === 0) return template;
    
    const cacheKey = `t:${palette}:${hueShift}`;
    const cached = generatedSpriteCache.get(cacheKey);
    if (cached) return cached;
    
    const result: CharacterSprites = {
      walk: {
        [Direction.DOWN]: template.walk[Direction.DOWN].map(s => applyHueShift(s, hueShift)),
        [Direction.LEFT]: template.walk[Direction.LEFT].map(s => applyHueShift(s, hueShift)),
        [Direction.RIGHT]: template.walk[Direction.RIGHT].map(s => applyHueShift(s, hueShift)),
        [Direction.UP]: template.walk[Direction.UP].map(s => applyHueShift(s, hueShift))
      },
      typing: {
        [Direction.DOWN]: template.typing[Direction.DOWN].map(s => applyHueShift(s, hueShift)),
        [Direction.LEFT]: template.typing[Direction.LEFT].map(s => applyHueShift(s, hueShift)),
        [Direction.RIGHT]: template.typing[Direction.RIGHT].map(s => applyHueShift(s, hueShift)),
        [Direction.UP]: template.typing[Direction.UP].map(s => applyHueShift(s, hueShift))
      },
      reading: {
        [Direction.DOWN]: template.reading[Direction.DOWN].map(s => applyHueShift(s, hueShift)),
        [Direction.LEFT]: template.reading[Direction.LEFT].map(s => applyHueShift(s, hueShift)),
        [Direction.RIGHT]: template.reading[Direction.RIGHT].map(s => applyHueShift(s, hueShift)),
        [Direction.UP]: template.reading[Direction.UP].map(s => applyHueShift(s, hueShift))
      }
    };
    generatedSpriteCache.set(cacheKey, result);
    return result;
  }
  
  const cacheKey = `p:${palette}:${hueShift}`;
  const cached = generatedSpriteCache.get(cacheKey);
  if (cached) return cached;
  
  const p = palettes[palette % palettes.length];
  
  const walkStanding = createCharacterWalkDown(p.shirt, p.skin, p.pants);
  const walkLeft = createCharacterWalkFrame2(p.shirt, p.skin, p.pants);
  const walkRight = createCharacterWalkFrame4(p.shirt, p.skin, p.pants);
  
  const typingFrame1 = createCharacterTypingFrame1(p.shirt, p.skin, p.pants);
  const typingFrame2 = createCharacterTypingFrame2(p.shirt, p.skin, p.pants);
  
  const sprites: CharacterSprites = {
    walk: {
      [Direction.DOWN]: [walkStanding, walkLeft, walkStanding, walkRight].map(s => applyHueShift(s, hueShift)),
      [Direction.LEFT]: [walkStanding, walkLeft, walkStanding, walkRight].map(s => applyHueShift(s, hueShift)),
      [Direction.RIGHT]: [walkStanding, walkLeft, walkStanding, walkRight].map(s => applyHueShift(s, hueShift)),
      [Direction.UP]: [walkStanding, walkLeft, walkStanding, walkRight].map(s => applyHueShift(s, hueShift))
    },
    typing: {
      [Direction.DOWN]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift)),
      [Direction.LEFT]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift)),
      [Direction.RIGHT]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift)),
      [Direction.UP]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift))
    },
    reading: {
      [Direction.DOWN]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift)),
      [Direction.LEFT]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift)),
      [Direction.RIGHT]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift)),
      [Direction.UP]: [typingFrame1, typingFrame2].map(s => applyHueShift(s, hueShift))
    }
  };
  
  generatedSpriteCache.set(cacheKey, sprites);
  return sprites;
}

export const BUBBLE_PERMISSION_SPRITE: SpriteData = [
  ['', '', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '', ''],
  ['', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', ''],
  ['#ffffff', '#ffffff', '', '', '', '#000000', '#000000', '', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '#000000', '', '', '#000000', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '#000000', '', '', '#000000', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '', '#000000', '#000000', '', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '', '#000000', '', '', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '', '', '', '', '', '', '#ffffff', '#ffffff'],
  ['', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', ''],
  ['', '', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '', '']
];

export const BUBBLE_WAITING_SPRITE: SpriteData = [
  ['', '', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '', ''],
  ['', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', ''],
  ['#ffffff', '#ffffff', '', '', '', '', '', '', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '#000000', '', '#000000', '', '#000000', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '#000000', '', '#000000', '', '#000000', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '', '', '', '', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '', '', '', '', '', '', '#ffffff', '#ffffff'],
  ['#ffffff', '#ffffff', '', '', '', '', '', '', '', '', '#ffffff', '#ffffff'],
  ['', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', ''],
  ['', '', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '#ffffff', '', '']
];
